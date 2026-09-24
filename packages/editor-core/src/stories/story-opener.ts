/**
 * THE `story` ADDRESS — one registered opener for every gesture that opens a
 * portable story (`@editor/document-open-registry`).
 *
 * The host used to reach four different ways: `ProjectLayout` branched on
 * `requested.kind === 'story'` and pre-loaded the module itself,
 * `scene-documents` resolved a composed id against the registry,
 * `GameHierarchy` called `openStoryDocumentByStoryId`, and
 * `editor-view-presentation` polled the registry, derived the title and chose
 * the medium. All four were the host knowing what CSF is. They are now ONE
 * address, `story`, and the host asks for it exactly as it asks for
 * `generation` (WORK.md §Stories leave the host, edges 4–7).
 *
 * TWO WAYS TO NAME A STORY, because the gestures genuinely differ: a module
 * path plus an export name (a layout address, a view address, a package that
 * just WROTE the module), or the composed Storybook id (a hierarchy row's
 * node id, a scene-table plan). Both resolve here; neither is the host's
 * problem.
 *
 * WHICH SURFACE it lands on is still the declared medium
 * (`story-declared-medium.ts`) delegated to `story:three` / `story:isolated`,
 * and `mode: 'docs'` to `story:docs`. Those three are `@vgai/game`'s
 * documents: a build without that package has no opener for them and this one
 * answers `null`, which is the same honest answer an undeclared medium gives.
 *
 * SETTLING. `open` is synchronous and a story address routinely arrives before
 * discovery has published the module — on a layout restore, and immediately
 * after a package writes a story module. `document-open-registry.ts` already
 * has the shape for that: try once, let the kind SETTLE, try again. What each
 * former call site did by hand is what `settle` does here, and which one it
 * does depends on what the failed attempt NAMED — a module path settles by
 * loading exactly that module (`ProjectLayout`'s `ensureProjectStoryModule`,
 * whose own loop re-runs when a concurrent discovery pass supersedes it, and
 * which is also what a package that just WROTE a story module needs), an
 * id-only address by waiting for discovery to PUBLISH
 * (`whenProjectStoriesReady`, never a refresh of its own — a later pass
 * supersedes that and it returns over an emptied registry, measured in unit
 * 4). `tierSourceWriteBackend()` comes first on both, because a restored
 * address can arrive before the source backend the discovery scan reads
 * exists — that is the await `ProjectLayout` held.
 */

import { object3DDocumentSession } from '../authoring/object3d-document-session-registry';
import { openRegisteredDocument, registerDocumentOpener } from '../document-open-registry';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import { getCurrentProject } from '../project-manager';
import { tierSourceWriteBackend } from '../ui-source/tier-source-write-backend';
import { DOCUMENT_REGISTRATION_TIMEOUT_MS, waitUntil } from '../wait-until';
import type { WorkspaceStateStore } from '../workspace-document-restore';
import { getProjectStoryRegions } from './project-story-regions';
import { declaredStoryMedium, reportUndeclaredStoryMedium } from './story-declared-medium';
import {
  ISOLATED_STORY_DOCUMENT_OPENER,
  STORY_DOCS_DOCUMENT_OPENER,
  THREE_STORY_DOCUMENT_OPENER,
} from '@volter/editor-sdk/kit/story-document-openers';
import { deriveStoryGroupPath } from './story-grouping';
import {
  ensureProjectStoryModule,
  getProjectStoryModules,
  projectStoriesReady,
  whenProjectStoriesReady,
} from './story-registry';

/** The address a story opens under. */
export const STORY_DOCUMENT_OPENER = 'story';

export interface StoryOpenRequest {
  /** Project-relative CSF module path. With {@link StoryOpenRequest.storyName}
   *  this is the whole address. */
  readonly modulePath?: string;
  /** The story's authored export name. */
  readonly storyName?: string;
  /** The composed Storybook id — the other way to name the same story (a
   *  hierarchy story row's node id IS this id). */
  readonly storyId?: string;
  /** Tab title; derived from the story's own group path when absent. */
  readonly title?: string;
  /** Whether opening also FOCUSES the tab. A click-through opens and focuses;
   *  the Edit tab row offers a standing tab instead and passes `false`. */
  readonly activate?: boolean;
  /** `docs` opens the Storybook Docs companion instead of the preview. */
  readonly mode?: 'preview' | 'docs';
}

/**
 * What a failed attempt NAMED, waiting for `settle` — which takes no request,
 * so this is where the pair meets. Sets rather than one slot each, because
 * several addresses can be in flight at once (a restored layout opening three
 * story tabs) and settling one must not drop another's.
 */
const unsettledModules = new Set<string>();
const unsettledIds = new Set<string>();

interface ResolvedStory {
  readonly modulePath: string;
  readonly storyName: string;
  readonly title: string;
}

/** The title a story gives itself: its group path's leaf, and its own label
 *  when that says something the leaf does not. */
function derivedTitle(story: {
  readonly modulePath: string;
  readonly title?: string | undefined;
  readonly label: string;
}): string {
  const subject = deriveStoryGroupPath({ modulePath: story.modulePath, title: story.title }).leaf;
  return subject === story.label ? subject : `${subject} · ${story.label}`;
}

/** Resolve an address against the live registry, or `null` when nothing
 *  composed answers to it yet. */
function resolve(request: StoryOpenRequest): ResolvedStory | null {
  for (const module_ of getProjectStoryModules()) {
    if (!module_.ok) continue;
    for (const story of module_.stories) {
      const matches =
        request.storyId === undefined
          ? module_.modulePath === request.modulePath && story.name === request.storyName
          : story.id === request.storyId;
      if (!matches) continue;
      return {
        modulePath: module_.modulePath,
        storyName: story.name,
        title:
          request.title ??
          derivedTitle({ modulePath: module_.modulePath, title: story.title, label: story.label }),
      };
    }
  }
  return null;
}

function openResolved(
  store: WorkspaceStateStore,
  request: StoryOpenRequest,
  story: ResolvedStory,
): string | null {
  const base = {
    modulePath: story.modulePath,
    storyName: story.storyName,
    title: story.title,
    ...(request.activate === undefined ? {} : { activate: request.activate }),
  };
  if (request.mode === 'docs') {
    return openRegisteredDocument(STORY_DOCS_DOCUMENT_OPENER, store, base);
  }
  const declared = declaredStoryMedium({
    modulePath: story.modulePath,
    regions: getProjectStoryRegions(),
  });
  if (declared.medium === undefined) {
    // An undeclared story is a NAMED gap, never a candidate for a fallback
    // renderer — and never a reason to settle and try again, so it reports
    // here and the address answers "opened nothing" rather than `null`'s
    // "ask me again".
    reportUndeclaredStoryMedium(story.modulePath, declared.reason);
    return null;
  }
  return openRegisteredDocument(
    declared.medium === 'three' ? THREE_STORY_DOCUMENT_OPENER : ISOLATED_STORY_DOCUMENT_OPENER,
    store,
    base,
  );
}

/** An id no composed story carries. The caller's own refusal can only say
 *  "nothing opened it": the two ways an address fails — an unknown id, and a
 *  module with no declared medium — are both this package's to tell apart. */
function reportUnresolvedStoryId(storyId: string): void {
  editorConsole.warn(
    `No composed portable story carries the id ${JSON.stringify(storyId)}, so nothing opened it.`,
    'editor',
  );
}

export function registerStoryOpener(): () => void {
  return registerDocumentOpener<StoryOpenRequest>({
    id: STORY_DOCUMENT_OPENER,
    owner: './story-opener',
    open: (store, request) => {
      const story = resolve(request);
      if (story) return openResolved(store, request, story);
      if (request.modulePath) unsettledModules.add(request.modulePath);
      else if (request.storyId !== undefined) {
        unsettledIds.add(request.storyId);
        // Only once discovery has PUBLISHED is an unknown id a real answer;
        // before that an empty registry is boot in flight, and a synchronous
        // caller (the Edit tab row, the `open` verb) is the one that needs the
        // name — an async caller settles and asks again first.
        if (projectStoriesReady()) reportUnresolvedStoryId(request.storyId);
      }
      return null;
    },
    settle: async () => {
      await tierSourceWriteBackend();
      const modules = [...unsettledModules];
      const ids = [...unsettledIds];
      unsettledModules.clear();
      unsettledIds.clear();
      // A MODULE-named address settles by loading exactly that module, whose
      // own loop re-runs when a concurrent discovery pass supersedes it. This
      // is also what a package that just WROTE a story needs: the module is
      // new, so nothing published it and the targeted load is the refresh.
      await Promise.all(
        modules.map((modulePath) => ensureProjectStoryModule(getCurrentProject(), modulePath)),
      );
      if (ids.length === 0) return;
      // An ID-only address settles by waiting for discovery to PUBLISH — never
      // by awaiting a refresh of its own, which a later pass supersedes and
      // which then returns over an emptied registry (measured, unit 4).
      await whenProjectStoriesReady();
      for (const storyId of ids) {
        if (!resolve({ storyId })) reportUnresolvedStoryId(storyId);
      }
    },
    /**
     * THIS ADDRESS'S OWN READINESS: a story the presenter just opened is not
     * ready to be DRIVEN until the document it opened into has mounted its
     * stage. The presenter used to hold this rule by spelling the three-story
     * document's id prefix (`editor-view-presentation.ts`'s
     * `documentId.startsWith('three-story:')`); it is this package's, because
     * this package is what chose the medium (`openResolved` above) and
     * therefore what knows a `three` story opens onto a turntable stage while
     * an `isolated` one and a `docs` one do not.
     *
     * The MEDIUM is the declaration here, not the stage's own announcement:
     * the story document constructs its viewport source asynchronously
     * (`@vgai/game`'s `three-story-documents.tsx`), so at this instant nothing
     * has rendered yet and an announcement could only read absent. A `three`
     * medium ALWAYS mounts one, which is what makes the wait unconditional and
     * the refusal honest.
     *
     * The three DIRECT callers of `story:three`
     * (`three-board/ThreeBoardDocument.tsx:189`,
     * `../src/component-states-source.ts`, and `openResolved` above) go
     * through the SYNCHRONOUS door, which by the registry's own contract gets
     * the id and waits on the kind's doors itself.
     */
    ready: async (documentId, request) => {
      if (request.mode === 'docs') return;
      const story = resolve(request);
      if (!story) return;
      const declared = declaredStoryMedium({
        modulePath: story.modulePath,
        regions: getProjectStoryRegions(),
      });
      if (declared.medium !== 'three') return;
      if (
        await waitUntil(
          () => object3DDocumentSession(documentId) !== null,
          DOCUMENT_REGISTRATION_TIMEOUT_MS,
        )
      )
        return;
      throw new Error(`The requested Object3D view did not mount for document: ${documentId}`);
    },
  });
}
