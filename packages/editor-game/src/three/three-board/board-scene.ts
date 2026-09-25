/**
 * The 3D board's SCENE: every qualifying `three` PREFAB mounted once, standing
 * DIRECTLY ON THE FLOOR at true scale where `board-layout.ts` put it, on
 * district floor pads, under one `THREE.Object3D` the caller hands to the
 * Object3D document viewport. Project components that HAVE no story yet appear
 * too, as reserved floor slots — see "Ghost slots" below.
 *
 * ## Membership — one exhibit per COMPONENT
 *
 * The board's unit is the component, not the story VARIANT: a prefab with five
 * design-time states stands on the floor once, in the state
 * `pickComponentPreviewStory` selects, and its other states live in its story
 * document (a double-click away). See {@link isComponentPreviewStory} for what
 * that bought and what it costs a story with no `meta.component`.
 *
 * ## Membership — declared `three`, then mounted as an exhibit
 *
 * A story is a candidate iff `declaredStoryMedium` says `three`. An
 * undeclared story is a named gap and is never a candidate — the board does
 * not mount to guess a medium. A declared three story is then mounted
 * (`stories/story-three-preview.ts`'s `mountStoryObject3D`) as the exhibit;
 * a mount that yields no content, or throws, lands in
 * {@link ThreeBoardScene.skipped} with its reason (same "one bad module never
 * takes the rest down" physics as `story-registry.ts`).
 *
 * The "holds content" half is the shared `mountedStoryHasThreeContent`
 * (`stories/three-story-model.ts`). The board's mount IS the exhibit and
 * must outlive the question, and the board needs the failure REASON, which
 * a boolean would discard.
 *
 * Mounts run ONE AT A TIME, and that is a correctness requirement rather than a
 * simplification. A story's loaders may touch PROCESS-GLOBAL state — the squash
 * fixture's stories each init Rapier and spawn a character into a shared scene
 * tree — so overlapping two mounts interleaves their setup and they collide:
 * measured live, concurrent mounting made the `Player` story fail with
 * "a kinematic body spawned inside geometry it collides with" and silently cost
 * the board an exhibit. Serial mounting is also no slower here, because the
 * thing concurrency was hiding is gone: `CrashNullBoundary` rejects a
 * non-three story in MILLISECONDS instead of burning the 10s `onCreated`
 * ceiling, which is what used to make a serial pass over a DOM board unusable.
 * A story's own loader latency is now the only cost, and paying it in sequence
 * is what keeps each story's world to itself.
 *
 * ## Ghost slots — the project's story-LESS 3D components
 *
 * The board is the project's 3D shelf, so a `three`-surface component with NO
 * story must be VISIBLE AS MISSING rather than silently absent. Discovery
 * reuses the Content gallery's own machinery, never a second scan: the caller
 * hands in the `listProjectComponents()` index (the same source-defined
 * visual-component list the Prefabs section reads), and the story↔component
 * join is `pickComponentPreviewStory` (`stories/story-registry.ts`) — a
 * component that join resolves is REPRESENTED by its story's exhibit; one it
 * cannot resolve becomes a ghost slot in a trailing district. A ghost is a
 * RESERVED RECTANGLE OF FLOOR — a dashed outline on the ground and its name
 * placard, deliberately no fabricated render of the component, because the
 * composed story render is the board's sole visual authority (the anti-shim
 * rule): an empty patch of floor is honest, a guessed render is not.
 * Double-clicking a ghost routes to the component's SOURCE (the document layer
 * wires that through the editor's standing open-source affordance).
 *
 * ## Resource ownership (stated here, once)
 *
 * `ThreeBoardScene` OWNS: the district/exhibit `THREE.Group`s it creates, the
 * pads and reserved-slot meshes it builds (and their
 * geometries/materials), and the ordered list of per-story `dispose()` handles
 * `mountStoryObject3D` returned. {@link ThreeBoardScene.dispose} is the ONE
 * teardown path for all of it; it is idempotent and it never disposes anything
 * the board did not create — a story's own geometry/material lifetime belongs
 * to that story's fiber root, which its `dispose()` unmounts.
 *
 * The board is GENERATED and NEVER PERSISTED: nothing here writes, and nothing
 * anywhere serializes this graph. Rebuilding from the story registry is the
 * only way it comes back.
 */

import { getProjectStoryRegions } from '@volter/editor-sdk/kit/stories/project-story-regions';
import {
  declaredStoryMedium,
  reportUndeclaredStoryMedium,
} from '@volter/editor-sdk/kit/stories/story-declared-medium';
import {
  deriveStoryGroupPath,
  formatStoryGroupPath,
  storyGroupKey,
} from '@volter/editor-core/stories/story-grouping';
import { type ProjectStoryModule, pickComponentPreviewStory } from '@volter/editor-core/stories/story-registry';
import {
  lastStoryMountPhaseTiming,
  type MountedStoryObject3D,
  type StoryMountInTurn,
  type StoryPreviewComponent,
  withStoryMountTurn,
} from '../../host/stories/story-three-preview';
import { mountedStoryHasThreeContent } from '@volter/editor-threejs/kit/stories/three-story-model';
import {
  markViewportSegment,
  noteViewportBreakdownCounts,
  recordViewportStoryMount,
} from '@volter/editor-sdk/kit/viewport-activation-timings';
import { collectContentNodeRecords } from '@volter/editor-threejs/viewport/content-bounds';
import { EDITOR_LAYER } from '@volter/editor-threejs/viewport/editor-layers';
import { setUserData } from '@volter/threejs-runtime/ecs/user-data';
import * as THREE from 'three';
import {
  type BoardHelperKind,
  type BoardHelperVolume,
  type BoardNode,
  frameThreeBoard,
  translateBounds,
} from './board-framing';
import type { BoardBounds, BoardDistrictPlacement, BoardItemPlacement } from './board-layout';

/** `userData` key carrying an exhibit's story id, read by the picking path. */
export const BOARD_STORY_ID_KEY = 'vgaiBoardStoryId';

/** `userData` key carrying a ghost slot's component key (`<path>#<name>`),
 *  read by the picking path exactly like {@link BOARD_STORY_ID_KEY}. */
export const BOARD_COMPONENT_KEY = 'vgaiBoardComponentKey';

/** The district group key ghost slots share. A sentinel outside the story
 *  grouping model's vocabulary, so it can never collide with an authored
 *  group; the scene labels it, the layout only clusters by it. */
export const BOARD_GHOST_GROUP_KEY = 'vgai:board:no-story';

/** Who a given exhibit is — everything the Inspector shows for a picked object. */
export interface BoardStoryIdentity {
  /** `<modulePath>#<storyName>` — stable within one project. */
  readonly id: string;
  /** The CSF export name, exactly as authored. */
  readonly storyName: string;
  /** Project-relative source module. */
  readonly modulePath: string;
  /** `storyGroupKey(...)` — the district this exhibit belongs to. */
  readonly groupKey: string;
  /** The group path's leaf — the component/document name (`Mob`, `Player`). */
  readonly groupLeaf: string;
  /** Human-facing group path (`UI/Button`). */
  readonly groupPath: string;
  /**
   * What the overlay prints under this exhibit. The CSF export name alone is
   * NOT it: `Default` is the conventional export, so a district of five
   * components would label five different things `Default`. The leaf names the
   * component, and the story's own label is appended only where one leaf
   * contributes more than one exhibit — which is the only case where it
   * disambiguates.
   *
   * That appended half is the REGISTRY's label (`ComposedProjectStory.label` —
   * the authored `name`, else `compose-project-stories.ts`'s humanized export
   * name), never the raw export: it is the same string every other story
   * surface prints, so one story reads identically wherever it appears.
   */
  readonly label: string;
}

/** One placed exhibit: who it is, and where the layout put it. */
export interface BoardExhibit extends BoardStoryIdentity {
  readonly placement: BoardItemPlacement;
  /** Authored extent, true scale — includes helper volumes. */
  readonly fullSize: readonly [number, number, number];
  /** Named volumes kept out of the slot and the default camera. */
  readonly helpers: readonly BoardHelperVolume[];
}

/** A helper volume on a specific exhibit, for the status line. */
export interface BoardExhibitHelper {
  readonly exhibitId: string;
  readonly exhibitLabel: string;
  readonly kind: BoardHelperKind;
  readonly size: readonly [number, number, number];
}

/**
 * The narrow slice of the component index a ghost slot needs. Structurally
 * satisfied by `ProjectComponentEntry` (`asset-workflow/project-content.ts`) —
 * the Content gallery's own discovery output, reused rather than re-derived.
 */
export interface BoardComponentRef {
  readonly name: string;
  /** Project-root-relative source file. */
  readonly path: string;
  readonly line: number;
  readonly surface: string;
  readonly contentKind?: string | undefined;
}

/** One storyless component's slot: who it is, and which patch of floor it
 *  reserves. */
export interface BoardGhostSlot {
  /** `<path>#<name>` — the pick tag and the slot's layout id. */
  readonly key: string;
  readonly name: string;
  readonly path: string;
  readonly line: number;
  readonly placement: BoardItemPlacement;
}

/** One district: the group, its label anchor, and the exhibits in it. */
export interface BoardDistrict {
  readonly groupKey: string;
  /** What the overlay prints — the group key, or `Ungrouped` for the flat case. */
  readonly label: string;
  readonly placement: BoardDistrictPlacement;
}

/** A story that could not become an exhibit, and why. */
export interface BoardSkippedStory {
  readonly id: string;
  readonly modulePath: string;
  readonly storyName: string;
  readonly reason: string;
}

/**
 * The skip tally at the granularity that matches reality.
 *
 * A skip is per STORY, but the cause is almost always per MODULE: one `dom`
 * board contributes every one of its stories at once, so a bare `14 not 3D`
 * reads as fourteen independent failures when it is one module that simply is
 * not 3D. Reporting both numbers keeps that honest for a mixed project too,
 * where some modules are partly 3D.
 */
export function summarizeBoardSkips(skipped: readonly BoardSkippedStory[]): {
  readonly stories: number;
  readonly modules: number;
} {
  return {
    stories: skipped.length,
    modules: new Set(skipped.map((entry) => entry.modulePath)).size,
  };
}

export interface ThreeBoardScene {
  /** The generated content graph. Never written anywhere. */
  readonly root: THREE.Object3D;
  readonly exhibits: readonly BoardExhibit[];
  readonly districts: readonly BoardDistrict[];
  /** Storyless 3D components, each marked out as an empty reserved floor slot. */
  readonly ghostSlots: readonly BoardGhostSlot[];
  readonly skipped: readonly BoardSkippedStory[];
  /**
   * Union of every exhibit's PRESENCE box after layout — Frame with no
   * selection fits this, not the authored union. Helper volumes stay in the
   * graph at true scale; they just do not own the overview.
   */
  readonly frameBounds: BoardBounds;
  /** One exhibit's placed presence: the readable first-paint camera. */
  readonly openingFrameBounds: BoardBounds;
  /** Helper volumes the default frame left out, named per exhibit. */
  readonly helperVolumes: readonly BoardExhibitHelper[];
  /** The ONE teardown path (see the module doc). Idempotent. */
  dispose(): void;
}

/** The label an ungrouped district prints. */
const UNGROUPED_LABEL = 'Ungrouped';

/** The label the ghost slots' trailing district prints. */
export const GHOST_DISTRICT_LABEL = 'No story yet';

/** The nominal ground span a ghost slot reserves (metres, square). Not a claim
 *  about the component's size — the slot is empty — just enough floor for the
 *  dashed rectangle to read as a reserved place. It is FLAT: a reserved slot
 *  has no height, because nothing stands in it. */
const GHOST_SLOT_SPAN = 0.9;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One story's mount attempt, resolved to either an exhibit candidate or a skip. */
interface MountAttempt {
  readonly identity: BoardStoryIdentity;
  readonly mounted: MountedStoryObject3D | null;
  readonly reason: string | null;
}

async function attemptMount(
  identity: BoardStoryIdentity,
  Component: StoryPreviewComponent,
  mount: StoryMountInTurn,
): Promise<MountAttempt> {
  const started = Date.now();
  let mounted: MountedStoryObject3D | null = null;
  let reason: string | null = null;
  try {
    mounted = await mount(Component);
    if (!mountedStoryHasThreeContent(mounted.root)) {
      // Mounted, but rendered nothing three-shaped — the honest "not a 3D
      // story" outcome for a story that reconciles to an empty subtree.
      mounted.dispose();
      mounted = null;
      reason = 'The story mounted no three content.';
    }
  } catch (error) {
    reason = describeError(error);
  }
  const phases = lastStoryMountPhaseTiming();
  recordViewportStoryMount({
    id: identity.id,
    ms: Date.now() - started,
    runtimeMs: phases?.runtimeMs ?? 0,
    loadMs: phases?.loadMs ?? 0,
    fiberMs: phases?.fiberMs ?? 0,
    settleMs: phases?.settleMs ?? 0,
    ok: mounted !== null,
  });
  return { identity, mounted, reason };
}

// ---------------------------------------------------------------- furniture

/** Marks one object (and its subtree) as editor chrome per `editor-layers.ts`:
 *  `EDITOR_LAYER` is ENABLED (not set) so layer 0 stays on and the document
 *  host's own lights still light it. */
function markChrome(object: THREE.Object3D): void {
  object.traverse((child) => {
    child.layers.enable(EDITOR_LAYER);
    setUserData(child, 'editorHelper', true);
  });
}

/**
 * THE FLOOR RULE — the board's one anti-z-fighting mechanism, stated once.
 *
 * Everything the board puts on the ground wants the SAME plane, y = 0: every
 * exhibit's base (rule 2), the district pad under it, and a reserved slot's
 * outline and hit plane. That is not incidental — a story's world very often
 * carries a flat ground as its lowest geometry, so grounding an exhibit lands a
 * 180 m plane exactly on the pad's top face. Two coplanar surfaces is what
 * shimmers at grazing angles.
 *
 * The separation is a DEPTH-BUFFER offset on the pad's own material
 * (`polygonOffset`), not a geometric gap — and that choice was MEASURED, not
 * assumed. A geometric epsilon was tried first: 5 mm, which is invisible on a
 * decimetre prop and comfortably above depth resolution at the distances a
 * small district is viewed from. It failed on the starter template's own board,
 * whose `Ground` story is a 180 m plane: framing a district that wide puts the
 * camera hundreds of metres out, where one depth-buffer step is tens of
 * millimetres, and the pad and the plane fought in broad bands of constant
 * depth. No fixed epsilon can be right for a surface whose whole product claim
 * is that it holds a 0.1 m prop and a 180 m ground plane at once, and a
 * scale-derived epsilon buys the far exhibit's correctness by visibly floating
 * the near one off the same pad.
 *
 * `polygonOffset` is exactly the scale-invariant version of the same idea: it
 * biases in units of the depth buffer's own resolution AT THAT FRAGMENT, so
 * "one step behind" means one step at 3 m and one step at 300 m. It costs
 * nothing elsewhere because the pad is CHROME — picks skip editor-owned
 * subtrees, and it only ever receives shadows.
 *
 * So: everything on the board's floor is at y = 0, and the pad is the one thing
 * that yields. The dressing's ground grid keeps its own -0.02 (that module owns
 * it), still occluded inside the pad slab.
 */
const PAD_MATERIAL_PARAMS = {
  color: 0x323b49,
  roughness: 0.92,
  metalness: 0.04,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 2,
};

/** The pad slab's thickness; its TOP face is the exhibit datum y = 0. */
const PAD_THICKNESS = 0.06;
const PAD_TOP_Y = 0;

/** A reserved slot lies flat ON the exhibit datum — that is where the component
 *  WOULD stand. Both its hit plane and its outline share it; the pad beneath
 *  yields to them by the rule above. */
const RESERVED_SLOT_Y = 0;
const GHOST_LINE_COLOR = 0xa9bdd6;
const GHOST_FILL_COLOR = 0x8fa3bd;

/** One district's floor pad. Editor chrome. */
function createDistrictPad(district: BoardDistrictPlacement): THREE.Mesh {
  const width = district.extent.maxX - district.extent.minX;
  const depth = district.extent.maxZ - district.extent.minZ;
  const pad = new THREE.Mesh(
    new THREE.BoxGeometry(width, PAD_THICKNESS, depth),
    new THREE.MeshStandardMaterial(PAD_MATERIAL_PARAMS),
  );
  pad.name = `vgai:board-pad:${district.groupKey || UNGROUPED_LABEL}`;
  pad.position.set(
    (district.extent.minX + district.extent.maxX) / 2,
    PAD_TOP_Y - PAD_THICKNESS / 2,
    (district.extent.minZ + district.extent.maxZ) / 2,
  );
  pad.receiveShadow = true;
  markChrome(pad);
  return pad;
}

/** Dashed outline of a `width × depth` rectangle lying in the ground plane,
 *  centred at the origin. Four explicit segments rather than `EdgesGeometry`
 *  over a degenerate box: a zero-height box has coincident top and bottom
 *  loops, which is the very artifact this whole module is removing. */
function dashedFloorRectangle(width: number, depth: number): THREE.LineSegments {
  const x = width / 2;
  const z = depth / 2;
  const corners: readonly (readonly [number, number])[] = [
    [-x, -z],
    [x, -z],
    [x, z],
    [-x, z],
  ];
  const positions: number[] = [];
  for (let index = 0; index < corners.length; index++) {
    const from = corners[index]!;
    const to = corners[(index + 1) % corners.length]!;
    positions.push(from[0], 0, from[1], to[0], 0, to[1]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const outline = new THREE.LineSegments(
    geometry,
    new THREE.LineDashedMaterial({ color: GHOST_LINE_COLOR, dashSize: 0.09, gapSize: 0.06 }),
  );
  outline.computeLineDistances();
  return outline;
}

/**
 * One ghost slot: a dashed rectangle of RESERVED FLOOR, flat on the ground,
 * and nothing standing in it. NOT chrome — it is pickable content whose
 * double-click routes to the component's source, so it carries
 * {@link BOARD_COMPONENT_KEY} and stays out of the editor-owned layer (picks
 * skip editor-owned subtrees). The barely-tinted hit plane exists because a
 * raycast needs a surface to land on; it depicts nothing.
 */
function createGhostSlot(slot: BoardGhostSlot): THREE.Object3D {
  const group = new THREE.Group();
  group.name = `vgai:board-ghost:${slot.name}`;
  group.userData[BOARD_COMPONENT_KEY] = slot.key;

  const [width, depth] = slot.placement.footprint;
  const hit = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshBasicMaterial({
      color: GHOST_FILL_COLOR,
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  hit.rotation.x = -Math.PI / 2;
  hit.position.y = RESERVED_SLOT_Y;

  const outline = dashedFloorRectangle(width, depth);
  outline.position.y = RESERVED_SLOT_Y;

  group.add(hit, outline);
  group.position.set(slot.placement.anchor[0], 0, slot.placement.anchor[2]);
  return group;
}

// ---------------------------------------------------------------- candidates

interface BoardCandidate {
  readonly identity: BoardStoryIdentity;
  readonly Component: StoryPreviewComponent;
}

/**
 * ONE EXHIBIT PER PREFAB — is this story the one that represents its component
 * on the board?
 *
 * The board's unit is the COMPONENT, not the variant. A component with five
 * design-time states is still one thing standing in the museum; its other
 * states live in its story document, which a double-click opens. Rendering a
 * variant each put the same prefab on the floor N times, and — measured on the
 * vendored racing-game — put two Vehicles there, one of them authored at its
 * GAME position (`[-110, 0.75, 220]`), so that exhibit's bounds were computed
 * around content ~240 units from its own slot and the layout reserved a
 * district-sized hole for a car.
 *
 * The join is `pickComponentPreviewStory` — the same association the Content
 * gallery's cards and `collectStorylessComponents` below already use, so no
 * surface can disagree with another about which state represents a component.
 * It is passed the story's OWN module path as the component path, which is
 * what makes it resolve within one source directory: colocation is the shipped
 * convention (a prefab and its story sit together), so two same-named
 * components in different folders each keep their own exhibit instead of one
 * silently swallowing the other.
 *
 * A story whose CSF declares no `meta.component` is joined to nothing and
 * therefore represents only itself — it keeps its own exhibit rather than
 * being dropped.
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

/** The composed stories that REPRESENT a component (see
 *  {@link isComponentPreviewStory}), with each district resolved through the
 *  shared story-grouping model (authored CSF title first, then the module path
 *  — `story-grouping.ts` owns that precedence). */
/** How many stories this board will visit — the honest N for the building copy. */
export function threeBoardCandidateCount(modules: readonly ProjectStoryModule[]): number {
  return collectCandidates(modules).length;
}

function collectCandidates(modules: readonly ProjectStoryModule[]): BoardCandidate[] {
  const draft: {
    identity: Omit<BoardStoryIdentity, 'label'>;
    /** The registry's own human-facing story label — see {@link BoardStoryIdentity.label}. */
    storyLabel: string;
    Component: StoryPreviewComponent;
  }[] = [];
  const perLeaf = new Map<string, number>();
  const regions = getProjectStoryRegions();
  for (const module_ of modules) {
    if (!module_.ok) continue;
    for (const story of module_.stories) {
      const declared = declaredStoryMedium({ modulePath: module_.modulePath, regions });
      if (declared.medium !== 'three') {
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
      const groupKey = storyGroupKey(group);
      const leafKey = `${groupKey}/${group.leaf}`;
      perLeaf.set(leafKey, (perLeaf.get(leafKey) ?? 0) + 1);
      draft.push({
        identity: {
          id: `${module_.modulePath}#${story.name}`,
          storyName: story.name,
          modulePath: module_.modulePath,
          groupKey,
          groupLeaf: group.leaf,
          groupPath: formatStoryGroupPath(group),
        },
        storyLabel: story.label,
        Component: story.Component as unknown as StoryPreviewComponent,
      });
    }
  }
  return draft.map(({ identity, storyLabel, Component }) => ({
    identity: {
      ...identity,
      label:
        (perLeaf.get(`${identity.groupKey}/${identity.groupLeaf}`) ?? 0) > 1
          ? `${identity.groupLeaf} · ${storyLabel}`
          : identity.groupLeaf,
    },
    Component,
  }));
}

/**
 * The `three`-surface components no story represents — the ghost-slot set.
 *
 * The join is the Content gallery's own (`pickComponentPreviewStory`), so the
 * two surfaces can never disagree about which components "have" a story: the
 * gallery admits exactly the components this filter drops. Inline-SVG entries
 * are image assets, not components (`contentKind`), and non-`three` surfaces
 * belong to other boards.
 */
function collectStorylessComponents(
  modules: readonly ProjectStoryModule[],
  components: readonly BoardComponentRef[],
): BoardComponentRef[] {
  const seen = new Set<string>();
  const storyless: BoardComponentRef[] = [];
  for (const component of components) {
    if (component.surface !== 'three') continue;
    if (component.contentKind === 'image') continue;
    const key = `${component.path}#${component.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (pickComponentPreviewStory(modules, component.name, component.path)) continue;
    storyless.push(component);
  }
  return storyless;
}

/** One exhibit's wrapper: the placement translation, and the story tag the
 *  picking path reads back. The mounted root keeps its own authored transform,
 *  so nothing here touches the exhibit's true scale. */
function createExhibitGroup(
  identity: BoardStoryIdentity,
  placement: BoardItemPlacement,
  mounted: MountedStoryObject3D,
): THREE.Object3D {
  const exhibit = new THREE.Group();
  exhibit.name = `vgai:board-exhibit:${identity.label}`;
  exhibit.position.set(...(placement.translation as [number, number, number]));
  exhibit.add(mounted.root);
  exhibit.userData[BOARD_STORY_ID_KEY] = identity.id;
  return exhibit;
}

/**
 * Tear a built board down, taking a shared story-mount turn so its stories'
 * effect cleanups never run inside another build's mounts. `dispose()` is
 * idempotent, so this is safe even when the scene is already gone.
 */
export function disposeThreeBoard(scene: ThreeBoardScene): Promise<void> {
  return withStoryMountTurn(async () => {
    scene.dispose();
  });
}

/**
 * Build the whole board from a story-registry snapshot plus the project's
 * component index (the Content gallery's `listProjectComponents()` output —
 * see "Ghost slots" in the module doc). Resolves once every story has either
 * become an exhibit or been recorded as skipped, and every storyless `three`
 * component has its ghost slot.
 *
 * Builds never overlap ({@link withStoryMountTurn}). A `signal` supersedes this
 * build: it stops mounting further stories and disposes whatever it already
 * mounted INSIDE its own turn, then rejects — so the caller never receives a
 * scene it would have to tear down out of turn.
 */
export async function buildThreeBoard(
  modules: readonly ProjectStoryModule[],
  components: readonly BoardComponentRef[] = [],
  signal?: AbortSignal,
): Promise<ThreeBoardScene> {
  return withStoryMountTurn((mount) => assembleThreeBoard(modules, components, signal, mount));
}

/** Mount each candidate in turn, stopping the moment the build is superseded. */
async function mountEveryCandidate(
  candidates: readonly BoardCandidate[],
  signal: AbortSignal | undefined,
  mount: StoryMountInTurn,
): Promise<MountAttempt[]> {
  const attempts: MountAttempt[] = [];
  for (const { identity, Component } of candidates) {
    // What a superseded build already mounted is released by its caller,
    // through the scene's own single teardown path.
    if (signal?.aborted) break;
    attempts.push(await attemptMount(identity, Component, mount));
  }
  return attempts;
}

function box3ToBounds(box: THREE.Box3): BoardBounds {
  return { min: box.min.toArray(), max: box.max.toArray() };
}

/** Split mount attempts into the exhibits to place and the skips to report. */
function sortAttempts(attempts: readonly MountAttempt[]): {
  mounts: Map<string, MountedStoryObject3D>;
  identities: Map<string, BoardStoryIdentity>;
  measures: { id: string; groupKey: string; nodes: BoardNode[] }[];
  skipped: BoardSkippedStory[];
} {
  const mounts = new Map<string, MountedStoryObject3D>();
  const identities = new Map<string, BoardStoryIdentity>();
  const measures: { id: string; groupKey: string; nodes: BoardNode[] }[] = [];
  const skipped: BoardSkippedStory[] = [];
  for (const attempt of attempts) {
    if (!attempt.mounted) {
      skipped.push({
        id: attempt.identity.id,
        modulePath: attempt.identity.modulePath,
        storyName: attempt.identity.storyName,
        reason: attempt.reason ?? 'The story produced no Object3D.',
      });
      continue;
    }
    const nodes = collectContentNodeRecords(attempt.mounted.root).map((record) => ({
      bounds: box3ToBounds(record.box),
      overlay: record.overlay,
      enclosure: record.enclosure,
    }));
    mounts.set(attempt.identity.id, attempt.mounted);
    identities.set(attempt.identity.id, attempt.identity);
    measures.push({
      id: attempt.identity.id,
      groupKey: attempt.identity.groupKey,
      nodes,
    });
  }
  return { mounts, identities, measures, skipped };
}

/** A ghost slot reserves a nominal, FLAT patch of ground; the layout's own
 *  slot math then gives it the same breathing room a real exhibit of that
 *  footprint would get. */
function ghostMeasure(component: BoardComponentRef): {
  id: string;
  groupKey: string;
  nodes: BoardBounds[];
} {
  const half = GHOST_SLOT_SPAN / 2;
  return {
    id: `${component.path}#${component.name}`,
    groupKey: BOARD_GHOST_GROUP_KEY,
    nodes: [{ min: [-half, 0, -half], max: [half, 0, half] }],
  };
}

async function assembleThreeBoard(
  modules: readonly ProjectStoryModule[],
  components: readonly BoardComponentRef[],
  signal: AbortSignal | undefined,
  mount: StoryMountInTurn,
): Promise<ThreeBoardScene> {
  const tCandidates = Date.now();
  const candidates = collectCandidates(modules);
  markViewportSegment('candidate-collect', Date.now() - tCandidates);
  noteViewportBreakdownCounts({ candidateCount: candidates.length });

  const tMounts = Date.now();
  const attempts = await mountEveryCandidate(candidates, signal, mount);
  markViewportSegment('story-mounts', Date.now() - tMounts);

  const tBounds = Date.now();
  const { mounts, identities, measures, skipped } = sortAttempts(attempts);
  markViewportSegment('bounds', Date.now() - tBounds);

  const tLayout = Date.now();
  const storyless = collectStorylessComponents(modules, components);
  const ghostByKey = new Map<string, BoardComponentRef>(
    storyless.map((component) => [`${component.path}#${component.name}`, component]),
  );
  // Ghost items APPENDED, so their sentinel group first appears last and the
  // layout's first-appearance rule puts the ghost district behind every real
  // one — a trailing "still to do" shelf, never interleaved with the museum.
  // Layout AND the default camera use each exhibit's PRESENCE box, so an
  // authored overlay volume (the lighthouse beam) or a 180 m ground plane
  // cannot own the opening view.
  const framed = frameThreeBoard([...measures, ...storyless.map(ghostMeasure)]);
  const layout = framed.layout;
  const framedById = new Map(framed.exhibits.map((entry) => [entry.id, entry]));
  markViewportSegment('layout', Date.now() - tLayout);
  const tAssemble = Date.now();

  const root = new THREE.Group();
  root.name = 'vgai:three-board';
  const chrome = new THREE.Group();
  chrome.name = 'vgai:board-chrome';
  markChrome(chrome);
  root.add(chrome);

  const exhibits: BoardExhibit[] = [];
  const districts: BoardDistrict[] = [];
  const ghostSlots: BoardGhostSlot[] = [];
  /** Everything the board itself built (chrome furniture + ghost meshes) —
   *  NEVER an exhibit wrapper, whose subtree is a story's own graph and whose
   *  geometry lifetime belongs to that story's fiber root. */
  const boardOwned: THREE.Object3D[] = [chrome];

  for (const district of layout.districts) {
    const ghostDistrict = district.groupKey === BOARD_GHOST_GROUP_KEY;
    const districtGroup = new THREE.Group();
    districtGroup.name = `vgai:board-district:${
      ghostDistrict ? GHOST_DISTRICT_LABEL : district.groupKey || UNGROUPED_LABEL
    }`;
    root.add(districtGroup);
    chrome.add(createDistrictPad(district));

    for (const placement of district.items) {
      if (ghostDistrict) {
        const component = ghostByKey.get(placement.id);
        if (!component) continue;
        const slot: BoardGhostSlot = {
          key: placement.id,
          name: component.name,
          path: component.path,
          line: component.line,
          placement,
        };
        const ghost = createGhostSlot(slot);
        districtGroup.add(ghost);
        boardOwned.push(ghost);
        ghostSlots.push(slot);
        continue;
      }
      const mounted = mounts.get(placement.id);
      const identity = identities.get(placement.id);
      const framedExhibit = framedById.get(placement.id);
      if (!mounted || !identity || !framedExhibit) continue;
      districtGroup.add(createExhibitGroup(identity, placement, mounted));
      exhibits.push({
        ...identity,
        placement,
        fullSize: [
          framedExhibit.full.max[0] - framedExhibit.full.min[0],
          framedExhibit.full.max[1] - framedExhibit.full.min[1],
          framedExhibit.full.max[2] - framedExhibit.full.min[2],
        ],
        helpers: framedExhibit.helpers,
      });
    }

    districts.push({
      groupKey: district.groupKey,
      label: ghostDistrict ? GHOST_DISTRICT_LABEL : district.groupKey || UNGROUPED_LABEL,
      placement: district,
    });
  }

  const helperVolumes: BoardExhibitHelper[] = exhibits.flatMap((exhibit) =>
    exhibit.helpers.map((helper) => ({
      exhibitId: exhibit.id,
      exhibitLabel: exhibit.label,
      kind: helper.kind,
      size: helper.size,
    })),
  );

  let disposed = false;
  const scene: ThreeBoardScene = {
    root,
    exhibits,
    districts,
    ghostSlots,
    skipped,
    frameBounds: framed.frame,
    openingFrameBounds: framed.exhibits[0]
      ? translateBounds(framed.exhibits[0].presence, framed.exhibits[0].placement.translation)
      : framed.frame,
    helperVolumes,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      // Board-built geometry first: the board created it, so the board frees
      // it. `boardOwned` never contains an exhibit wrapper, so a mounted
      // story's own graph is never walked here.
      for (const owned of boardOwned) {
        owned.traverse((object) => {
          const mesh = object as THREE.Mesh;
          mesh.geometry?.dispose();
          const material = mesh.material;
          if (Array.isArray(material)) for (const entry of material) entry.dispose();
          else material?.dispose();
        });
        owned.removeFromParent();
      }
      // Then every story mount's OWN dispose — the fiber root that built it is
      // the only thing entitled to free its geometries and materials.
      for (const mounted of mounts.values()) {
        try {
          mounted.dispose();
        } catch (error) {
          // biome-ignore lint/suspicious/noConsole: a failed unmount must stay diagnosable without stranding the remaining mounts
          console.error('[three-board] a story mount failed to dispose.', error);
        }
      }
      mounts.clear();
      root.clear();
    },
  };

  // The LAST thing inside the turn: a superseded build hands back nothing, and
  // frees what it mounted here rather than leaving the caller to do it after
  // the turn has passed to the next build.
  markViewportSegment('assemble', Date.now() - tAssemble);
  noteViewportBreakdownCounts({
    exhibitCount: exhibits.length,
    skippedCount: skipped.length,
  });

  if (signal?.aborted) {
    scene.dispose();
    throw new Error('The 3D board build was superseded by a newer one.');
  }
  return scene;
}

/**
 * The story id of the exhibit a picked object belongs to, or `null` when the
 * pick landed on furniture or outside the board. Walks ancestry because a pick
 * hits a leaf mesh, and the identity is tagged on the exhibit wrapper.
 */
export function boardStoryIdForObject(object: THREE.Object3D | null): string | null {
  return tagForObject(object, BOARD_STORY_ID_KEY);
}

/** The ghost slot's component key a picked object belongs to, or `null`. */
export function boardComponentKeyForObject(object: THREE.Object3D | null): string | null {
  return tagForObject(object, BOARD_COMPONENT_KEY);
}

function tagForObject(object: THREE.Object3D | null, key: string): string | null {
  let current: THREE.Object3D | null = object;
  while (current) {
    const value = current.userData[key];
    if (typeof value === 'string') return value;
    current = current.parent;
  }
  return null;
}
