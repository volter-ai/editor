/**
 * The canvas surface's physics seam, keyed by the substrate's display object
 * (`D`, opaque by default). The implementer names its own display type
 * (`@volter/game-runtime/pixi/system-adapters` is `PhysicsAdapter2D<Container>`).
 */

/**
 * PhysicsAdapter2D — the Pixi analog of the 3D PhysicsAdapter (rapier-physics-adapter).
 * Lets the editor coordinate editing of a Rapier-2D-driven entity WITHOUT owning the
 * simulation: report transform ownership, then freeze → commit → unfreeze so a drag
 * sticks instead of being stomped by the next physics step.
 *
 * KEYED BY THE DISPLAY OBJECT, and that is this surface's own vocabulary rather
 * than a shortcut: the canvas gizmo's real caller
 * (`editor/src/authoring/pixi-live-write-target.ts`) resolves node id → display
 * itself before it asks, so there is no node-id hop on this lane at all.
 *
 * `keyedBy` is REQUIRED here and optional on the 3D {@link PhysicsAdapter} —
 * see that interface's doc comment for why the union has to be tagged, and why
 * the newcomer is the shape obliged to say so.
 */
export interface PhysicsAdapter2D<D = unknown> {
  /** Discriminates this shape from the node-id-keyed {@link PhysicsAdapter}
   *  inside `SystemAdapters['physics']`. */
  readonly keyedBy: 'display';
  ownerOf(display: D): 'physics' | 'none';
  freeze(display: D): void;
  commit(display: D, position: [number, number], rotation: number): void;
  unfreeze(display: D): void;
}
