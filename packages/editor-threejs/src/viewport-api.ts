/**
 * THE AUTHORED THREE VIEWPORT'S PUBLIC SHAPE — what a lane that mounts something reaches through
 * `viewport-door.ts`: the rig a camera flight drives, the frame loop it rides, the helpers it
 * shows, every mounted stage, and the one verb that swaps the viewport's subject for a live
 * instance's roots (Play's adoption of the running scene).
 */
import type { MountedRoot } from '@volter/editor-project/adapter/root-adapter';
import type * as THREE from 'three';

/** A live instance's roots, presented as the authored viewport's subject. */
export interface ViewportPresentation {
  /** The root whose native subject the viewport shows. */
  readonly worldId: string;
  /** Restores the viewport's prior subject; idempotent. */
  dispose(): void;
}

/** The authored viewport's camera rig, while a viewport is mounted. */
export interface ViewportRig {
  readonly camera: THREE.PerspectiveCamera;
  /** The camera the stage draws with NOW: {@link camera}, or the orthographic one in an
   *  orthographic view. What a document lighting or picking in step with the picture needs. */
  drawCamera(): THREE.Camera;
  readonly orbit: { readonly target: THREE.Vector3; enabled: boolean; update(): void };
  /** The editor's own scene (helpers live on its editor layer). */
  readonly scene: THREE.Scene;
}

/**
 * ONE MOUNTED 3D STAGE, named by the document it draws. Every 3D document
 * mounts a stage of its own (ARCHITECTURE-CORE §One stage); this is the door
 * to a particular one, where the viewport door's singular members
 * are the door to whichever is primary.
 */
export interface ViewportStage {
  /** The workspace document this stage draws. */
  readonly documentId: string;
  rig(): ViewportRig;
  /** As the viewport door's `setHelper`, on this stage alone. */
  setHelper(kind: string, object: THREE.Object3D | null): void;
  /** Runs after THIS stage's own per-frame update; the return unsubscribes. */
  onFrame(fn: (dtSeconds: number) => void): () => void;
}

/**
 * THE AUTHORED VIEWPORT, as a lane that mounts something reaches it: the rig
 * a camera flight drives, the frame loop it rides, and the one verb that
 * swaps the viewport's subject for a live instance's roots (Play's adoption
 * of the running scene). Which native surface the viewport renders is the
 * host's; a lane that finds no rig (a headless tab, a project with no Three
 * root) mounts without one.
 *
 * THE SINGULAR MEMBERS ARE THE PRIMARY STAGE — the stage presenting live
 * roots if one is, else the FOCUSED stage, else the first bound. A camera
 * flight and Play's adoption want exactly that one, which is why they read
 * here and never enumerate.
 *
 * {@link stages} is EVERY mounted 3D stage. A helper is an `Object3D` and an
 * `Object3D` has one parent, so there is no "set it once for all stages": a
 * helper wanted on every stage is set on each stage through `stages()`, and
 * `onStages` is how a lane keeps up with stages that mount and unmount after
 * it made that pass.
 */
/** A mounted adapter surface offered to the viewport. Execution, input and
 * ticking stay with the caller; presentation requires only identity and mount.
 * A game's richer root instance can satisfy this interface directly.
 */
export interface ViewportRoot {
  readonly id: string;
  readonly mounted: MountedRoot;
}

export interface ViewportDoor {
  rig(): ViewportRig | null;
  /** Null when the viewport has no subject among `roots` (no Three root). */
  presentRoots(roots: readonly ViewportRoot[]): ViewportPresentation | null;
  /** Runs after the viewport's own per-frame update; the return unsubscribes. */
  onFrame(fn: (dtSeconds: number) => void): () => void;
  /**
   * Show an editor-only helper object of `kind` in the authored viewport (a
   * baked navmesh's debug mesh), replacing the previous one of that kind;
   * null clears it. Visibility follows the host's Helpers menu: a kind the
   * menu lists (`navmesh`) toggles on its own, any other follows the master
   * toggle. Kept across viewport remounts.
   */
  setHelper(kind: string, object: THREE.Object3D | null): void;
  /** Every mounted 3D stage, in bind order. */
  stages(): readonly ViewportStage[];
  /** Fires whenever a stage mounts or unmounts; the return unsubscribes. */
  onStages(fn: (stages: readonly ViewportStage[]) => void): () => void;
}

