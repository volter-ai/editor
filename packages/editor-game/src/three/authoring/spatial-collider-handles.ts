/** Native Rapier primitive colliders projected onto the generic viewport seam. */

import type {
  PhysicsColliderShape,
  PhysicsColliderSnapshot,
  SpatialHandleLayer,
  SpatialPoint3,
} from '@volter/editor-project/adapter';
import * as THREE from 'three';

const COLLIDER_COLOR = '#00e58a';
const SENSOR_COLOR = '#c77dff';
const MIN_DIMENSION = 0.01;
const ROUND_TO = 1000;

export interface ColliderSourceBinding {
  readonly sourceOid: string;
  readonly sourceTag: 'CuboidCollider' | 'BallCollider' | 'CapsuleCollider';
  readonly snapshot: PhysicsColliderSnapshot;
  readonly writable: boolean;
}

export interface ColliderHandleEdit {
  readonly sourceOid: string;
  readonly args: readonly number[];
  readonly shape: PhysicsColliderShape;
  readonly colliderId: string;
}

function rounded(value: number): number {
  return Math.round(value * ROUND_TO) / ROUND_TO;
}

function tuple(value: THREE.Vector3): SpatialPoint3 {
  return [value.x, value.y, value.z];
}

function frame(snapshot: PhysicsColliderSnapshot): {
  center: THREE.Vector3;
  rotation: THREE.Quaternion;
} {
  return {
    center: new THREE.Vector3(...snapshot.position),
    rotation: new THREE.Quaternion(...snapshot.rotation),
  };
}

function worldPoint(
  snapshot: PhysicsColliderSnapshot,
  local: readonly [number, number, number],
): SpatialPoint3 {
  const { center, rotation } = frame(snapshot);
  return tuple(new THREE.Vector3(...local).applyQuaternion(rotation).add(center));
}

function handleId(binding: ColliderSourceBinding, part: string): string {
  return `collider:${encodeURIComponent(binding.sourceOid)}:${part}`;
}

export function colliderHandleLayer(binding: ColliderSourceBinding): SpatialHandleLayer {
  const { snapshot } = binding;
  const color = snapshot.sensor ? SENSOR_COLOR : COLLIDER_COLOR;
  const common = { color, writable: binding.writable };
  const guides: SpatialHandleLayer['guides'][number][] = [];
  const handles: SpatialHandleLayer['handles'][number][] = [];

  switch (snapshot.shape.type) {
    case 'cuboid': {
      const halfExtents = snapshot.shape.halfExtents;
      guides.push({
        kind: 'box',
        center: snapshot.position,
        rotation: snapshot.rotation,
        halfExtents,
        color,
        opacity: 0.78,
      });
      for (const [axis, label] of [
        [0, 'X'],
        [1, 'Y'],
        [2, 'Z'],
      ] as const) {
        for (const sign of [-1, 1] as const) {
          const local: [number, number, number] = [0, 0, 0];
          local[axis] = halfExtents[axis] * sign;
          handles.push({
            id: handleId(binding, `${axis}:${sign}`),
            label: `${label} ${sign > 0 ? 'positive' : 'negative'} half extent`,
            position: worldPoint(snapshot, local),
            ...common,
          });
        }
      }
      break;
    }
    case 'ball':
      guides.push({
        kind: 'sphere',
        center: snapshot.position,
        radius: snapshot.shape.radius,
        color,
        opacity: 0.78,
      });
      handles.push({
        id: handleId(binding, 'radius'),
        label: 'Collider radius',
        position: worldPoint(snapshot, [snapshot.shape.radius, 0, 0]),
        ...common,
      });
      break;
    case 'capsule':
      guides.push({
        kind: 'capsule',
        center: snapshot.position,
        rotation: snapshot.rotation,
        radius: snapshot.shape.radius,
        halfHeight: snapshot.shape.halfHeight,
        color,
        opacity: 0.78,
      });
      handles.push(
        {
          id: handleId(binding, 'radius'),
          label: 'Collider radius',
          position: worldPoint(snapshot, [snapshot.shape.radius, 0, 0]),
          ...common,
        },
        {
          id: handleId(binding, 'half-height'),
          label: 'Collider half height',
          position: worldPoint(snapshot, [0, snapshot.shape.halfHeight + snapshot.shape.radius, 0]),
          ...common,
        },
      );
      break;
    // A shape the physics seam does not project (trimesh, heightfield, hull,
    // cylinder, cone, …). It gets no guide and no handles because we do not
    // know its geometry — but it is NOT dropped upstream any more, so a body
    // carrying one still reports having physics rather than reporting none.
    case 'unsupported':
      break;
  }

  return {
    id: `collider:${binding.sourceOid}`,
    category: 'colliders',
    guides,
    handles,
  };
}

function parseHandleId(handle: string): { oid: string; part: string } | null {
  if (!handle.startsWith('collider:')) return null;
  const rest = handle.slice('collider:'.length);
  const separator = rest.indexOf(':');
  if (separator < 1) return null;
  try {
    return { oid: decodeURIComponent(rest.slice(0, separator)), part: rest.slice(separator + 1) };
  } catch {
    return null;
  }
}

function safeScale(value: number): number {
  return value > 1e-8 ? value : 1;
}

/** Convert one world-space drag point into @react-three/rapier's native args
 * and the live scaled Rapier shape used for immediate preview. */
export function colliderEditFromWorld(
  bindings: readonly ColliderSourceBinding[],
  handle: string,
  worldPosition: SpatialPoint3,
): ColliderHandleEdit | null {
  const parsed = parseHandleId(handle);
  const binding = parsed ? bindings.find((candidate) => candidate.sourceOid === parsed.oid) : null;
  if (!binding || !parsed || !binding.writable) return null;
  const { center, rotation } = frame(binding.snapshot);
  const local = new THREE.Vector3(...worldPosition)
    .sub(center)
    .applyQuaternion(rotation.clone().invert());
  const shape = binding.snapshot.shape;
  const scale = binding.snapshot.scale.map(safeScale) as [number, number, number];

  if (shape.type === 'cuboid' && /^[012]:(?:-1|1)$/.test(parsed.part)) {
    const axis = Number(parsed.part[0]) as 0 | 1 | 2;
    const halfExtents: [number, number, number] = [...shape.halfExtents];
    halfExtents[axis] = Math.max(MIN_DIMENSION, rounded(Math.abs(local.getComponent(axis))));
    return {
      sourceOid: binding.sourceOid,
      colliderId: binding.snapshot.id,
      shape: { type: 'cuboid', halfExtents },
      args: halfExtents.map((value, index) => rounded(value / scale[index]!)),
    };
  }

  if (shape.type === 'ball' && parsed.part === 'radius') {
    const radius = Math.max(MIN_DIMENSION, rounded(local.length()));
    return {
      sourceOid: binding.sourceOid,
      colliderId: binding.snapshot.id,
      shape: { type: 'ball', radius },
      args: [rounded(radius / scale[0])],
    };
  }

  if (shape.type === 'capsule') {
    if (parsed.part === 'radius') {
      const radius = Math.max(MIN_DIMENSION, rounded(Math.hypot(local.x, local.z)));
      return {
        sourceOid: binding.sourceOid,
        colliderId: binding.snapshot.id,
        shape: { ...shape, radius },
        args: [rounded(shape.halfHeight / scale[0]), rounded(radius / scale[1])],
      };
    }
    if (parsed.part === 'half-height') {
      const halfHeight = Math.max(MIN_DIMENSION, rounded(Math.abs(local.y) - shape.radius));
      return {
        sourceOid: binding.sourceOid,
        colliderId: binding.snapshot.id,
        shape: { ...shape, halfHeight },
        args: [rounded(halfHeight / scale[0]), rounded(shape.radius / scale[1])],
      };
    }
  }

  return null;
}
