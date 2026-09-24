/**
 * A DESIGN-TIME MOUNT IS REGISTERED, NOT DISPATCHED — the fifth registry in
 * the family of `workspace-document-restore.ts` (a kind owns its persisted
 * state), `document-open-registry.ts` (a kind owns how it opens),
 * `chrome-slot-registry.ts` (the host owns the place, a package owns what
 * sits there) and `content-entry-source-registry.ts` (the host owns the
 * Content scope, a package owns why a component is content). Here: the host
 * owns the design-time layer STACK and a package owns how a medium MOUNTS
 * into it.
 *
 * WHY IT EXISTS. `design-time-layers.ts` dispatched the two media in ONE
 * expression — `candidate.kind === 'canvas' ? mountCanvasLayer(…) :
 * mountReactLayer(…)` — against a single `LayerMountResult` contract whose
 * own docblock said the failure/teardown/play lifecycle is "the SAME for both
 * media". A contract two implementations already share, chosen by a literal
 * the host spells, is a registry that has not been written yet. Past the
 * dispatch it hard-coded two more per-medium facts: canvas REMOUNTS when a
 * write lands with no HMR channel, dom RE-PROJECTS when the story registry
 * publishes, and canvas layers are always interactive because the 2D scene IS
 * the document's subject. Each is a statement about a MEDIUM, made in the
 * host (WORK.md §The open-source launch item 12, §Stories leave the host edge
 * 9).
 *
 * THE SHAPE is transcribed from `content-entry-source-registry.ts:96-134`:
 * register / list / subscribe, with the same owner-replaces-owner rule so an
 * HMR re-evaluation leaves one mount and not two. Two deliberate differences,
 * each with its reason:
 *
 *  - NO VERSION COUNTER. That registry publishes one because a React panel
 *    reads it through `useSyncExternalStore`; this one's only reader is the
 *    layer stack, which subscribes and re-reads. A counter with no caller is
 *    a name that gets built because it was named.
 *  - THE INVALIDATION HOOKS ARE NOT RE-FANNED into `subscribeDesignTimeMounts`
 *    (the content registry re-fans its sources' `subscribe` into one signal).
 *    A staleness signal is not a registration change: it must reach the ONE
 *    layer stack that mounted that medium, carrying which action to take
 *    (remount, which tears down first, or re-project, which keeps the old
 *    layer up until the new one settles). The stack binds them itself, per
 *    mount, and unbinds on teardown.
 *
 * WHAT THE HOST STILL OWNS, and why it is not a leak: the layer ELEMENT and
 * everything about its place in the stack — the mount epoch that supersedes
 * an in-flight mount, the z-order, the pan transform, the eye, the play
 * handoff and Stop's rebuild, and the `BoundaryAuthoringAdapter` disclosure a
 * failed or unregistered mount degrades to. A mount is handed a layer and
 * asked to fill it; it never decides when it exists.
 *
 * NOTHING REGISTERED IS A REAL ANSWER. A build whose package list carries no
 * mount for a medium leaves that world's Boundary node standing with a reason
 * that names the kind and says no package registered a mount for it — the
 * same honest emptiness a document kind with no registered opener gives, and
 * the reason the stack waits rather than fails: contributions load
 * asynchronously (`project-tool-discovery.ts` defers the pass behind the
 * first viewport frame), so "not registered yet" and "not registered at all"
 * are different answers and only the second is worth showing.
 */

import type * as THREE from 'three';
import type { EditorShellStore } from '../editor-shell-store';
import type { CompositeAuthoringAdapter } from './composite-authoring-adapter';
import type { DesignTimeRootDescriptor, LayerMountResult } from './design-time-layers';
import type { RootViewController } from '@volter/editor-sdk/kit/world-pan-state';

/**
 * Everything a mount reads from the HOST, and deliberately nothing more — the
 * stack does not hand over itself. Measured against the two mount functions
 * as they stood: `mountReactLayer` read the project root, the shell store and
 * the activation document id; `mountCanvasLayer` read those three plus the
 * presentation's view controller.
 */
export interface DesignTimeMountContext {
  /** The open project's absolute root path — resolved once by the stack, and
   *  the reason it refuses to mount anything when there is no project. */
  readonly projectRootPath: string;
  /** The ONE format-neutral shell store (selection, history handle, play
   *  state) every authoring adapter is constructed against. */
  readonly store: EditorShellStore;
  /** Present only when the document this layer belongs to presents its own
   *  independent editor camera and viewport renderer rather than the shared
   *  artboard (`mountDesignTimeLayers`' `presentation`). A mount that has no
   *  camera of its own ignores it. */
  readonly view?: RootViewController;
  /** When set, first-mount work writes named segments onto this document's
   *  activation clock (`viewport-activation-timings`). */
  readonly activationDocumentId?: string;
}

/**
 * A medium that mounts into a LAYER of the design-time stack, over the shared
 * artboard: `dom` and `canvas`.
 */
export type DesignTimeLayerKind = DesignTimeRootDescriptor['kind'];

/**
 * A medium that mounts onto the WORLD ROOT's 3D stage instead of into a layer
 * over it: `three`. Its design session adopts the stage's own renderer and
 * scene rather than being handed an element to fill — the same question ("how
 * does this medium mount at design time?"), answered on a different surface,
 * which is why it is this registry's second shape and not a second registry.
 */
export type DesignTimeStageKind = 'three';

export type DesignTimeMountKind = DesignTimeLayerKind | DesignTimeStageKind;

/** What every registration carries, whichever surface it mounts on. */
interface DesignTimeMountBase {
  /** The medium this mounts, in the descriptor's own vocabulary. */
  readonly kind: DesignTimeMountKind;
  /** Which module registered it. Re-registering the same owner+kind REPLACES,
   *  so an HMR re-evaluation leaves one mount, not two. */
  readonly owner: string;
  /**
   * This medium's mounted worlds are STALE and must be torn down and mounted
   * again from current source. The mount owns the condition (which tier, which
   * watch, which debounce); the stack owns whether it may act right now (not
   * while play is running, not after teardown). Returns its teardown.
   */
  readonly remountWhen?: (invalidate: () => void) => () => void;
  /**
   * The same staleness, for a medium that can mount the NEW world before
   * taking the old one down — no visible reload flash. Returns its teardown.
   */
  readonly reprojectWhen?: (invalidate: () => void) => () => void;
}

export interface DesignTimeLayerMount extends DesignTimeMountBase {
  readonly kind: DesignTimeLayerKind;
  /** The resolved adapter identity a mount failure is reported under
   *  (`MountFailureReport['identity']`, e.g. `default-react`/`default-pixi`).
   *  It lives here because it is a fact about the mount; the host used to
   *  spell both literals in its own catch block. */
  readonly identity: string;
  /** This medium's layer always forwards pointer events: its content IS the
   *  document's subject (a click on it is how you select in it), so the
   *  `interactive` toggle — which exists for a medium whose design-time
   *  hover/press testing competes with authoring gestures — does not apply. */
  readonly alwaysInteractive?: boolean;
  /**
   * Fill `layer` with this medium's design-time world and report what the
   * stack should publish for it. Throwing is the sanctioned failure: the
   * stack degrades that world to its Boundary disclosure node with the
   * thrown message, exactly as it always did.
   */
  readonly mount: (
    candidate: DesignTimeRootDescriptor,
    layer: HTMLElement,
    context: DesignTimeMountContext,
  ) => Promise<LayerMountResult>;
}

/** Everything the world root's stage hands its medium's design session. It is
 *  the stage's own three handles: nothing here is a layer, a candidate or a
 *  project path, because the session resolves its world from the manifest
 *  itself. Measured against `mountR3FDesignSession` as it stood. */
export interface WorldRootSessionContext {
  /** The ONE format-neutral shell store the session's adapter is built over. */
  readonly store: EditorShellStore;
  /** The edit-mode composite the session swaps its own child adapter into. */
  readonly composite: CompositeAuthoringAdapter;
  /** The stage's renderer — the session adopts it rather than building one. */
  readonly renderer: THREE.WebGLRenderer;
}

export interface DesignTimeStageMount extends DesignTimeMountBase {
  readonly kind: DesignTimeStageKind;
  /**
   * Mount this medium's design session onto the world root's stage. Returns
   * its teardown. Throwing is the sanctioned failure, the same as a layer
   * mount's.
   */
  readonly mountWorldRootSession: (context: WorldRootSessionContext) => Promise<() => void>;
}

export type DesignTimeMount = DesignTimeLayerMount | DesignTimeStageMount;

const _mounts: DesignTimeMount[] = [];
const listeners = new Set<() => void>();

function publish(): void {
  for (const listener of listeners) listener();
}

/** Install a mount for one medium. Returns the teardown. */
export function registerDesignTimeMount(mount: DesignTimeMount): () => void {
  const stale = _mounts.findIndex((item) => item.owner === mount.owner && item.kind === mount.kind);
  if (stale >= 0) _mounts.splice(stale, 1);
  _mounts.push(mount);
  publish();
  return () => {
    const at = _mounts.indexOf(mount);
    if (at < 0) return;
    _mounts.splice(at, 1);
    publish();
  };
}

const EMPTY: readonly DesignTimeMount[] = [];

/** Everything registered, in registration order. A stable array while nothing
 *  changes, so a reader can compare identities across a notification. */
export function designTimeMounts(): readonly DesignTimeMount[] {
  return _mounts.length === 0 ? EMPTY : _mounts;
}

/** The mount for one medium, or `null` — "no package registered one", which
 *  is a real answer and never an error. The LAST registration wins, the same
 *  way a later chrome-slot filler of the same order does. The overloads are
 *  how a caller that knows its surface gets the shape that surface mounts
 *  with, without narrowing at the call site. */
export function designTimeMountFor(kind: DesignTimeLayerKind): DesignTimeLayerMount | null;
export function designTimeMountFor(kind: DesignTimeStageKind): DesignTimeStageMount | null;
export function designTimeMountFor(kind: DesignTimeMountKind): DesignTimeMount | null;
export function designTimeMountFor(kind: DesignTimeMountKind): DesignTimeMount | null {
  for (let i = _mounts.length - 1; i >= 0; i--) {
    const mount = _mounts[i];
    if (mount && mount.kind === kind) return mount;
  }
  return null;
}

/** Registration changes only. A mounted layer's own staleness travels through
 *  that mount's `remountWhen`/`reprojectWhen` instead — see the module note. */
export function subscribeDesignTimeMounts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only reset (mirrors the restore, open, chrome-slot and content-source
 *  registries'). */
export function __resetDesignTimeMountsForTest(): void {
  _mounts.length = 0;
  publish();
}
