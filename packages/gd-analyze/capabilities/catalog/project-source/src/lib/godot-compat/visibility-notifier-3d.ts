/**
 * `VisibilityNotifier` — the `screen_exited` signal, over the active three camera.
 *
 * ## What Godot's node is, and what it is here
 *
 * A `VisibilityNotifier` draws nothing. It carries an `aabb` in its own node space and fires
 * `screen_exited` on the frame that box leaves what a camera can see — Godot's own
 * `VisualServer` raises it from the render frame, against the viewport's active camera. This
 * engine has one active camera (R3F's own, which a translated `.tscn`'s `Camera` becomes), so the
 * notifier tests the box the emitter carried against three's own `Frustum`.
 *
 * It is a stateful factory returning a plain object — the `godot-compat` shape (`createTimer`,
 * `createKinematicBody`, `createPathFollow3D`): the scene that owns the notifier holds one of
 * these and steps it in its own per-frame walk. `visibilityChanged` returns the entered/exited
 * transition a `VisibilityEnabler` consumes, while `screenExited` exposes the visible -> invisible
 * edge a `VisibilityNotifier.screen_exited` signal consumes.
 *
 * ## Resource ownership
 *
 * **Owns:** its own scratch (a `Frustum`, a `Box3`, two `Vector3`s, a `Matrix4`) and the one bit of
 * remembered state — whether the box was on screen last frame. **Shares:** nothing; the camera and
 * node are passed per call. **Teardown:** none — it holds no engine resource.
 */

import { Box3, type Camera, Frustum, Matrix4, type Object3D, Vector3 } from 'three';

/** A `VisibilityNotifier`'s own AABB, in its scene's local space — the box the emitter carried from
 *  the `.tscn`, with the node's authored transform already folded into `position`. */
export interface VisibilityAABB {
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly size: { readonly x: number; readonly y: number; readonly z: number };
}

/** Godot's `VisibilityNotifier`, over the host's active three camera. */
export interface VisibilityNotifier3D {
  /**
   * The camera transition this frame: `true` when the box entered, `false` when it exited, and
   * `undefined` when it stayed put. The first on-screen evaluation is an enter; the first off-screen
   * evaluation is not an exit. That matches a `VisibilityEnabler`, which starts disabled and is
   * enabled by its first `_screen_enter` callback.
   */
  visibilityChanged(camera: Camera, node: Object3D): boolean | undefined;
  /**
   * Whether the notifier's box left the camera's view THIS frame.
   *
   * Godot's `screen_exited` fires on the visible -> invisible TRANSITION, so this returns `true`
   * exactly on that edge — never while the box stays off screen, never on the first frame (it has
   * no previous frame to have exited from). A mob that spawns at the arena's edge is already
   * visible, so the edge is real the first time it drifts out.
   */
  screenExited(camera: Camera, node: Object3D): boolean;
}

/**
 * A `VisibilityNotifier` monitor for one node's `aabb`. One per notifier instance, because the
 * on-screen state it remembers is that instance's own.
 */
export function createVisibilityNotifier3D(aabb: VisibilityAABB): VisibilityNotifier3D {
  const projection = new Matrix4();
  const frustum = new Frustum();
  const box = new Box3();
  const min = new Vector3();
  const max = new Vector3();
  // `undefined` (never evaluated) rather than `false`, so the first frame is not read as a
  // visible -> invisible transition from an on-screen it never actually reported.
  let onScreen: boolean | undefined;

  const visibilityChanged = (camera: Camera, node: Object3D): boolean | undefined => {
    camera.updateWorldMatrix(true, false);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projection);

    node.updateWorldMatrix(true, false);
    min.set(aabb.position.x, aabb.position.y, aabb.position.z);
    max.set(
      aabb.position.x + aabb.size.x,
      aabb.position.y + aabb.size.y,
      aabb.position.z + aabb.size.z,
    );
    box.set(min, max).applyMatrix4(node.matrixWorld);

    const nowOnScreen = frustum.intersectsBox(box);
    const wasOnScreen = onScreen;
    onScreen = nowOnScreen;
    if (wasOnScreen === undefined) return nowOnScreen ? true : undefined;
    return wasOnScreen === nowOnScreen ? undefined : nowOnScreen;
  };

  return {
    visibilityChanged,
    screenExited(camera, node): boolean {
      return visibilityChanged(camera, node) === false;
    },
  };
}
