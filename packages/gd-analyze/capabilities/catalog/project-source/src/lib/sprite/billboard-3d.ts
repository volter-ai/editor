/**
 * Native Three billboard lifecycle for animated and still 3D sprite objects.
 *
 * The authored quaternion remains the object's truth. A camera-facing pose is
 * installed only for the render call and restored immediately afterwards, so
 * gameplay, hierarchy transforms, animation, and the editor never observe a
 * render-only orientation.
 */

import { Object3D, Quaternion, Vector3, type Camera } from 'three';

export const BILLBOARD_3D_DISABLED = 0;
export const BILLBOARD_3D_ENABLED = 1;
export const BILLBOARD_3D_FIXED_Y = 2;

export type Billboard3DMode =
  | typeof BILLBOARD_3D_DISABLED
  | typeof BILLBOARD_3D_ENABLED
  | typeof BILLBOARD_3D_FIXED_Y;

export interface Billboard3DBinding {
  get mode(): Billboard3DMode;
  set mode(value: Billboard3DMode);
  release(): void;
}

const BINDINGS = new WeakMap<Object3D, Billboard3DBinding>();

function mode(value: number): Billboard3DMode {
  if (!Number.isSafeInteger(value) || value < BILLBOARD_3D_DISABLED || value > BILLBOARD_3D_FIXED_Y) {
    throw new RangeError(`sprite: billboard mode ${value} is outside disabled/enabled/fixed-y.`);
  }
  return value as Billboard3DMode;
}

/**
 * Bind camera-facing render behavior directly to a Three object.
 *
 * Existing render hooks are preserved in their established order: the prior
 * before hook runs before the billboard pose, and the prior after hook runs
 * after the authored quaternion has been restored. That lets a sprite's own
 * material/fixed-size work compose without a second render owner.
 */
export function bindBillboard3D(
  object: Object3D,
  initialMode: Billboard3DMode = BILLBOARD_3D_DISABLED,
): Billboard3DBinding {
  if (BINDINGS.has(object)) throw new Error('sprite: this Three object already has a billboard binding.');

  let currentMode = mode(initialMode);
  let released = false;
  let poseApplied = false;
  const authoredQuaternion = new Quaternion();
  const cameraQuaternion = new Quaternion();
  const parentQuaternion = new Quaternion();
  const worldBillboard = new Quaternion();
  const worldPosition = new Vector3();
  const cameraPosition = new Vector3();
  const previousBeforeRender = object.onBeforeRender;
  const previousAfterRender = object.onAfterRender;

  object.onBeforeRender = (renderer, scene, camera: Camera, geometry, material, group) => {
    previousBeforeRender.call(object, renderer, scene, camera, geometry, material, group);
    if (currentMode === BILLBOARD_3D_DISABLED) return;

    authoredQuaternion.copy(object.quaternion);
    if (currentMode === BILLBOARD_3D_ENABLED) {
      camera.getWorldQuaternion(cameraQuaternion);
      worldBillboard.copy(cameraQuaternion);
    } else {
      object.getWorldPosition(worldPosition);
      camera.getWorldPosition(cameraPosition);
      const yaw = Math.atan2(
        cameraPosition.x - worldPosition.x,
        cameraPosition.z - worldPosition.z,
      );
      worldBillboard.setFromAxisAngle(Object3D.DEFAULT_UP, yaw);
    }

    if (object.parent === null) object.quaternion.copy(worldBillboard);
    else {
      object.parent.getWorldQuaternion(parentQuaternion).invert();
      object.quaternion.copy(parentQuaternion.multiply(worldBillboard));
    }
    object.updateMatrixWorld();
    poseApplied = true;
  };

  object.onAfterRender = (renderer, scene, camera, geometry, material, group) => {
    if (poseApplied) {
      object.quaternion.copy(authoredQuaternion);
      object.updateMatrixWorld();
      poseApplied = false;
    }
    previousAfterRender.call(object, renderer, scene, camera, geometry, material, group);
  };

  const binding: Billboard3DBinding = {
    get mode(): Billboard3DMode {
      return currentMode;
    },
    set mode(value: Billboard3DMode) {
      if (released) throw new Error('sprite: billboard mode was changed after release.');
      currentMode = mode(value);
    },
    release(): void {
      if (released) return;
      released = true;
      if (poseApplied) {
        object.quaternion.copy(authoredQuaternion);
        object.updateMatrixWorld();
        poseApplied = false;
      }
      object.onBeforeRender = previousBeforeRender;
      object.onAfterRender = previousAfterRender;
      BINDINGS.delete(object);
    },
  };
  BINDINGS.set(object, binding);
  return binding;
}
