import type { Transform } from '@volter/editor-project/adapter';
import * as THREE from 'three';

export type TransformAxis = 0 | 1 | 2;

/** Present Three.js quaternion rotations as the degree-based XYZ fields editors expect. */
export function rotationDegrees(rotation: Transform['rotation']): [number, number, number] {
  const quaternion = new THREE.Quaternion(...rotation);
  if (quaternion.lengthSq() < Number.EPSILON) quaternion.identity();
  else quaternion.normalize();
  const euler = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
  return [
    THREE.MathUtils.radToDeg(euler.x),
    THREE.MathUtils.radToDeg(euler.y),
    THREE.MathUtils.radToDeg(euler.z),
  ];
}

/**
 * Replace one whole displayed CHANNEL — the wire's write, where
 * {@link withRotationDegrees} is the rendered rows' per-axis one.
 *
 * `rotation` arrives in the units the section publishes and the rows display
 * (Euler XYZ degrees), which is the only reason a caller can hand back a value
 * it read from `data` and get the pose it read.
 */
export function withTransformChannel(
  transform: Transform,
  channel: 'position' | 'rotation' | 'scale',
  value: readonly number[],
): Transform {
  if (value.length !== 3 || value.some((n) => !Number.isFinite(n))) {
    throw new Error(`transform.${channel} expects three finite numbers.`);
  }
  const next: Transform = {
    position: [...transform.position] as [number, number, number],
    rotation: [...transform.rotation] as [number, number, number, number],
    scale: [...transform.scale] as [number, number, number],
  };
  if (channel === 'rotation') {
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        THREE.MathUtils.degToRad(value[0]!),
        THREE.MathUtils.degToRad(value[1]!),
        THREE.MathUtils.degToRad(value[2]!),
        'XYZ',
      ),
    );
    return { ...next, rotation: [q.x, q.y, q.z, q.w] };
  }
  return { ...next, [channel]: [value[0]!, value[1]!, value[2]!] };
}

/** Replace one displayed Euler axis while preserving the other displayed axes. */
export function withRotationDegrees(
  transform: Transform,
  axis: TransformAxis,
  degrees: number,
): Transform {
  const displayed = rotationDegrees(transform.rotation);
  displayed[axis] = degrees;
  const quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(
      THREE.MathUtils.degToRad(displayed[0]),
      THREE.MathUtils.degToRad(displayed[1]),
      THREE.MathUtils.degToRad(displayed[2]),
      'XYZ',
    ),
  );
  return {
    position: [...transform.position] as [number, number, number],
    rotation: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
    scale: [...transform.scale] as [number, number, number],
  };
}
