/**
 * The neutral transform value used across adapter interfaces. Position + scale
 * are xyz; rotation is a quaternion (xyzw) — matching `Object3D.quaternion`, so
 * adapters never have to agree on an Euler convention.
 */
export interface Transform {
  position: [number, number, number];
  rotation: [number, number, number, number];
  scale: [number, number, number];
}

/**
 * Who currently owns an object's transform — i.e. what writes it each frame.
 * The editor uses this to decide whether a gizmo edit is durable (`editor`),
 * needs simulation coordination (`physics`), or is best-effort/inspect-only
 * (`script`/`network`/`external`).
 */
/**
 * Who drives a node's transform right now.
 *
 * `'unresolved'` is the answer for a node THIS ADAPTER DOES NOT KNOW, and it is
 * a distinct answer on purpose: every other member names a driver, so returning
 * one of them for an unknown id is a positive claim about a node the
 * implementer has never seen. A game-scoped physics adapter is asked about
 * every node the editor touches, including nodes belonging to another root —
 * "not mine" has to be sayable.
 */
export type TransformOwner =
  | 'editor'
  | 'physics'
  | 'animation'
  | 'script'
  | 'network'
  | 'external'
  | 'unresolved';
