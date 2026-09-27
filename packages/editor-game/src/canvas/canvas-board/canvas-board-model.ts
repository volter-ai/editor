/**
 * WHAT IS ON THE 2D BOARD — the canvas board's membership and its mount pass,
 * kept off the React tree so both are readable (and testable) without a
 * document.
 *
 * The board itself is DOM: `CanvasBoardDocument.tsx` lays these rows out with
 * the shared story-board substrate (`authoring/react-story-board.ts`), the same
 * one the `UI` board uses. This module answers only WHICH stories are on it,
 * WHAT each frame is, and how big the frame must be.
 *
 * ## Membership — one exhibit per COMPONENT
 *
 * The unit is the component, not the story VARIANT: a prefab with five
 * design-time states appears once, in the state `pickComponentPreviewStory`
 * selects, and its other states live in its own story frames elsewhere. That is
 * the 3D board's rule and the 3D board's join, so no surface can disagree with
 * another about which state represents a component.
 *
 * ## Membership — declared `canvas`, then mounted as an exhibit
 *
 * A story is a candidate iff `declaredStoryMedium` says `canvas`. An
 * undeclared story is a named gap and is never a candidate — the board does
 * not mount to guess a medium. A declared canvas story is then mounted
 * (`stories/story-pixi-preview.ts`) as the exhibit; a mount that yields no
 * content, or throws, lands in {@link CanvasBoard.skipped} with its reason.
 *
 * Mounts run ONE AT A TIME, on the process-wide turn every other story mount
 * takes (`stories/story-mount-turn.ts`): a story's loaders touch process-global
 * state — Pixi's `Assets` cache and the `@pixi/react` component catalogue are
 * both module-global — so overlapping two mounts interleaves their setup.
 *
 * ## Ghost slots — the project's story-LESS canvas components
 *
 * A `canvas`-surface component with NO story must be VISIBLE AS MISSING rather
 * than silently absent. Discovery reuses the Content gallery's own machinery,
 * never a second scan: the caller hands in the `listProjectComponents()` index
 * and the story↔component join is `pickComponentPreviewStory`. A ghost gets a
 * reserved, named frame and deliberately NO fabricated render — an empty frame
 * is honest and a guessed sprite is not.
 *
 * ## Resource ownership (stated here, once)
 *
 * Each exhibit owns ONE story mount, and {@link disposeCanvasBoard} is the ONE
 * teardown path for the set. A mount owns its own react root, its Application,
 * its renderer and its host element; nothing here destroys any of those
 * directly. A build superseded mid-flight frees what it already mounted inside
 * its own turn, so a caller never receives a board it would have to tear down
 * out of turn.
 */

import type { ProjectComponentEntry } from '@volter/editor-sdk/kit/asset-workflow/project-content';
import { getProjectStoryRegions } from '@volter/editor-sdk/kit/stories/project-story-regions';
import {
  declaredStoryMedium,
  reportUndeclaredStoryMedium,
} from '@volter/editor-sdk/kit/stories/story-declared-medium';
import type { StoryPreviewComponent } from '@volter/editor-sdk/kit/stories/story-preview-component';
import { mountedStoryHasPixiContent } from '../../host/stories/pixi-story-model';
import { deriveStoryGroupPath, storyGroupKey } from '@volter/editor-sdk/kit/stories/story-grouping';
import {
  type MountedStoryPixi,
  type PixiStoryMountInTurn,
  withPixiStoryMountTurn,
} from '../../host/stories/story-pixi-preview';
import { type ProjectStoryModule, pickComponentPreviewStory } from '@volter/editor-sdk/kit/stories/story-registry';

/** The district every ghost slot belongs to, so the storyless components
 *  gather in one trailing block instead of scattering through the museum. */
export const GHOST_DISTRICT = 'No story yet';

/** The square a ghost frame reserves, in px. Not a claim about the component's
 *  size — the frame is empty — just enough room to read as a reserved place. */
export const GHOST_FRAME_SIZE = { width: 160, height: 160 } as const;

/** The cell a canvas story gets when its content reports no usable bounds. */
const FALLBACK_FRAME_SIZE = { width: 240, height: 180 } as const;
/** Small sprites still need a selectable frame and a non-colliding label. */
const MIN_CONTENT_FRAME_SIZE = 96;

export interface CanvasBoardCrop {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Who an exhibit is — the story it composes and what its frame is named. */
export interface CanvasBoardIdentity {
  /** `<modulePath>#<storyName>` — stable within one project. */
  readonly id: string;
  readonly storyName: string;
  readonly modulePath: string;
  /**
   * The DISTRICT this exhibit stands in — the story group path's ancestors
   * (`Gameplay` for a `Gameplay/Hero` story, `prefabs` for an untitled
   * `src/prefabs/Hero.stories.tsx`), empty when the story is ungrouped.
   *
   * The board's unit is the COMPONENT — one exhibit each — so clustering by
   * component would give a column of one-frame blocks. The shelf a museum
   * wants is the group: every Gameplay prefab side by side, comparable at a
   * glance. That is what the district is, and it is derived with the shared
   * grouping model rather than a second one.
   */
  readonly district: string;
  /** What the frame's name prints. The CSF export name alone is NOT it:
   *  `Default` is the conventional export, so a district of five components
   *  would name five different things `Default`. The group's leaf names the
   *  component; the story's own label is appended only where one leaf
   *  contributes more than one exhibit, the only case where it disambiguates. */
  readonly label: string;
}

/** One placed exhibit: who it is, its live mount, and the content frame the
 *  board presents around that mount. */
export interface CanvasBoardExhibit extends CanvasBoardIdentity {
  readonly mounted: MountedStoryPixi;
  readonly frameSize: { readonly width: number; readonly height: number };
  /** Portion of the mounting canvas the frame presents. The Application is a
   *  harness; only a standard Storybook `layout: 'fullscreen'` story presents
   *  its entire declared canvas. */
  readonly crop: CanvasBoardCrop;
}

/** One storyless canvas component's reserved slot. */
export interface CanvasBoardGhost {
  /** `<path>#<name>` — the frame id. */
  readonly key: string;
  readonly name: string;
  /** Project-root-relative source file. */
  readonly path: string;
  readonly line: number;
}

/** A story that could not become an exhibit, and why. */
export interface CanvasBoardSkip {
  readonly id: string;
  readonly modulePath: string;
  readonly storyName: string;
  readonly reason: string;
}

/** Everything one build produced. */
export interface CanvasBoard {
  readonly exhibits: readonly CanvasBoardExhibit[];
  readonly ghosts: readonly CanvasBoardGhost[];
  readonly skipped: readonly CanvasBoardSkip[];
}

/**
 * The skip tally at the granularity that matches reality: a skip is per STORY,
 * but the cause is almost always per MODULE, so a bare count reads as N
 * independent failures when it is one module that simply is not a canvas one.
 */
export function summarizeCanvasBoardSkips(skipped: readonly CanvasBoardSkip[]): {
  readonly stories: number;
  readonly modules: number;
} {
  return {
    stories: skipped.length,
    modules: new Set(skipped.map((entry) => entry.modulePath)).size,
  };
}

interface CanvasBoardCandidate {
  readonly identity: CanvasBoardIdentity;
  readonly Component: StoryPreviewComponent;
  readonly layout: 'centered' | 'padded' | 'fullscreen';
}

function storyLayout(parameters: Record<string, unknown>): CanvasBoardCandidate['layout'] {
  const layout = parameters['layout'];
  return layout === 'fullscreen' || layout === 'padded' || layout === 'centered'
    ? layout
    : 'padded';
}

/**
 * ONE EXHIBIT PER PREFAB — is this story the one that represents its component
 * on the board? The 3D board's rule and the 3D board's join. A story whose CSF
 * declares no `meta.component` is joined to nothing and keeps its own exhibit.
 */
function isComponentPreviewStory(
  modules: readonly ProjectStoryModule[],
  modulePath: string,
  story: { name: string; componentName?: string },
): boolean {
  if (!story.componentName) return true;
  const picked = pickComponentPreviewStory(modules, story.componentName, modulePath);
  return !picked || (picked.modulePath === modulePath && picked.name === story.name);
}

/** The composed stories that REPRESENT a component, named through the shared
 *  story-grouping model. */
export function collectCanvasBoardCandidates(
  modules: readonly ProjectStoryModule[],
): CanvasBoardCandidate[] {
  const draft: {
    identity: Omit<CanvasBoardIdentity, 'label'>;
    leafKey: string;
    leaf: string;
    storyLabel: string;
    Component: StoryPreviewComponent;
    layout: 'centered' | 'padded' | 'fullscreen';
  }[] = [];
  const perLeaf = new Map<string, number>();
  const regions = getProjectStoryRegions();
  for (const module_ of modules) {
    if (!module_.ok) continue;
    for (const story of module_.stories) {
      const declared = declaredStoryMedium({ modulePath: module_.modulePath, regions });
      if (declared.medium !== 'canvas') {
        if (declared.via === 'undeclared') {
          reportUndeclaredStoryMedium(module_.modulePath, declared.reason);
        }
        continue;
      }
      if (!isComponentPreviewStory(modules, module_.modulePath, story)) continue;
      const group = deriveStoryGroupPath({
        modulePath: module_.modulePath,
        ...(story.title === undefined ? {} : { title: story.title }),
      });
      const district = storyGroupKey(group);
      const leafKey = `${district}/${group.leaf}`;
      perLeaf.set(leafKey, (perLeaf.get(leafKey) ?? 0) + 1);
      draft.push({
        identity: {
          id: `${module_.modulePath}#${story.name}`,
          storyName: story.name,
          modulePath: module_.modulePath,
          district,
        },
        leafKey,
        leaf: group.leaf,
        storyLabel: story.label,
        Component: story.Component as unknown as StoryPreviewComponent,
        layout: storyLayout(story.parameters),
      });
    }
  }
  return draft.map(({ identity, leafKey, leaf, storyLabel, Component, layout }) => ({
    identity: {
      ...identity,
      label: (perLeaf.get(leafKey) ?? 0) > 1 ? `${leaf} · ${storyLabel}` : leaf,
    },
    Component,
    layout,
  }));
}

/**
 * The `canvas`-surface components no story represents — the ghost-slot set.
 * The join is the Content gallery's own, so the two surfaces can never disagree
 * about which components "have" a story. Inline-SVG entries are image assets,
 * not components (`contentKind`), and other surfaces belong to other boards.
 */
export function collectStorylessCanvasComponents(
  modules: readonly ProjectStoryModule[],
  components: readonly ProjectComponentEntry[],
): CanvasBoardGhost[] {
  const seen = new Set<string>();
  const storyless: CanvasBoardGhost[] = [];
  for (const component of components) {
    if (component.surface !== 'canvas') continue;
    if (component.contentKind === 'image') continue;
    const key = `${component.path}#${component.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (pickComponentPreviewStory(modules, component.name, component.path)) continue;
    storyless.push({ key, name: component.name, path: component.path, line: component.line });
  }
  return storyless;
}

/** The frame is the story CONTENT, not the `<Application>` needed to mount it.
 *  Storybook's standard `fullscreen` layout is the explicit exception. */
function presentationOf(
  mounted: MountedStoryPixi,
  layout: CanvasBoardCandidate['layout'],
): { frameSize: { width: number; height: number }; crop: CanvasBoardCrop } {
  const source = layout === 'fullscreen' ? mounted.app.screen : mounted.stage.getBounds();
  const padding = layout === 'fullscreen' ? 0 : 8;
  const crop: { x: number; y: number; width: number; height: number } = {
    x: Math.floor(source.x - padding),
    y: Math.floor(source.y - padding),
    width: Math.ceil(source.width + padding * 2),
    height: Math.ceil(source.height + padding * 2),
  };
  if (
    !Number.isFinite(crop.width) ||
    !Number.isFinite(crop.height) ||
    crop.width < 1 ||
    crop.height < 1
  ) {
    return {
      frameSize: { ...FALLBACK_FRAME_SIZE },
      crop: { x: 0, y: 0, ...FALLBACK_FRAME_SIZE },
    };
  }
  if (layout !== 'fullscreen') {
    const width = Math.max(MIN_CONTENT_FRAME_SIZE, crop.width);
    const height = Math.max(MIN_CONTENT_FRAME_SIZE, crop.height);
    crop.x -= (width - crop.width) / 2;
    crop.y -= (height - crop.height) / 2;
    crop.width = width;
    crop.height = height;
  }
  return {
    frameSize: { width: crop.width, height: crop.height },
    crop,
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function mountCandidates(
  candidates: readonly CanvasBoardCandidate[],
  signal: AbortSignal | undefined,
  mount: PixiStoryMountInTurn,
): Promise<{ exhibits: CanvasBoardExhibit[]; skipped: CanvasBoardSkip[] }> {
  const exhibits: CanvasBoardExhibit[] = [];
  const skipped: CanvasBoardSkip[] = [];
  for (const { identity, Component, layout } of candidates) {
    if (signal?.aborted) break;
    const skip = (reason: string): void => {
      skipped.push({
        id: identity.id,
        modulePath: identity.modulePath,
        storyName: identity.storyName,
        reason,
      });
    };
    try {
      const mounted = await mount(Component);
      if (!mountedStoryHasPixiContent(mounted.stage)) {
        // Mounted, but rendered nothing — the honest "not a canvas story"
        // outcome for a story that reconciles to an empty stage.
        mounted.dispose();
        skip('The story mounted no Pixi content.');
        continue;
      }
      // The Application is the story's mounting harness, not an implicit
      // artboard. Default/padded/centered stories expose only the native stage;
      // prefab stories that want checkerboard transparency author Pixi's own
      // `backgroundAlpha={0}` (as the shipped examples do). `fullscreen` is
      // the explicit Storybook spelling for presenting the whole output
      // surface, native background and all.
      exhibits.push({ ...identity, mounted, ...presentationOf(mounted, layout) });
    } catch (error) {
      skip(describeError(error));
    }
  }
  return { exhibits, skipped };
}

/**
 * Build the whole board from a story-registry snapshot plus the project's
 * component index. Resolves once every story has either become an exhibit or
 * been recorded as skipped, and every storyless `canvas` component has its slot.
 *
 * Builds never overlap. A `signal` supersedes this build: it stops mounting
 * further stories, frees whatever it already mounted INSIDE its own turn, and
 * rejects.
 */
export function buildCanvasBoard(
  modules: readonly ProjectStoryModule[],
  components: readonly ProjectComponentEntry[] = [],
  signal?: AbortSignal,
): Promise<CanvasBoard> {
  return withPixiStoryMountTurn(async (mount) => {
    const { exhibits, skipped } = await mountCandidates(
      collectCanvasBoardCandidates(modules),
      signal,
      mount,
    );
    const board: CanvasBoard = {
      exhibits,
      ghosts: collectStorylessCanvasComponents(modules, components),
      skipped,
    };
    if (signal?.aborted) {
      disposeInTurn(board);
      throw new Error('The 2D board build was superseded by a newer one.');
    }
    return board;
  });
}

/** Tear a built board down inside a story-mount turn, so its stories' effect
 *  cleanups never run in the middle of another build's mounts. */
export function disposeCanvasBoard(board: CanvasBoard): Promise<void> {
  return withPixiStoryMountTurn(async () => {
    disposeInTurn(board);
  });
}

function disposeInTurn(board: CanvasBoard): void {
  for (const exhibit of board.exhibits) {
    try {
      exhibit.mounted.dispose();
    } catch (error) {
      // biome-ignore lint/suspicious/noConsole: a failed unmount must stay diagnosable without stranding the remaining mounts
      console.error('[canvas-board] a story mount failed to dispose.', error);
    }
  }
}
