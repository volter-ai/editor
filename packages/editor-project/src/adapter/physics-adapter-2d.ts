/**
 * The canvas surface's physics seam. `pixi.js` is a TYPE-ONLY import here: the
 * contract names `Container` because the seam is keyed by the display object,
 * and it ships no Pixi code (the implementer is
 * `@vgai/game-runtime/pixi/system-adapters`).
 */

import type { Container } from 'pixi.js';

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
export interface PhysicsAdapter2D {
  /** Discriminates this shape from the node-id-keyed {@link PhysicsAdapter}
   *  inside `SystemAdapters['physics']`. */
  readonly keyedBy: 'display';
  ownerOf(display: Container): 'physics' | 'none';
  freeze(display: Container): void;
  commit(display: Container, position: [number, number], rotation: number): void;
  unfreeze(display: Container): void;
}
