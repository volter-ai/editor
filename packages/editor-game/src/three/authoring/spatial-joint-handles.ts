/** Native Rapier impulse-joint anchors projected onto generic viewport guides. */

import type { R3fJointBinding, R3fJointLiteral } from '@volter/editor-react/source/r3f-joint-binding';
import type { PhysicsJointSnapshot, SpatialHandleLayer, SpatialPoint3 } from '@volter/editor-project/adapter';
import * as THREE from 'three';

const JOINT_COLOR = '#ffb020';
const ROUND_TO = 1000;

export interface JointSourceBinding {
  readonly sourceOid: string;
  readonly sourceFile: string;
  readonly source: R3fJointBinding;
  readonly snapshot: PhysicsJointSnapshot;
  readonly writable: boolean;
}

export interface JointAnchorEdit {
  readonly binding: JointSourceBinding;
  readonly endpoint: 0 | 1;
  readonly anchor: readonly [number, number, number];
  readonly params: readonly R3fJointLiteral[];
}

function key(binding: JointSourceBinding): string {
  return `${binding.source.line}:${binding.source.col}`;
}

function handleId(binding: JointSourceBinding, endpoint: 0 | 1): string {
  return `joint:${key(binding)}:${endpoint}`;
}

export function jointHandleLayer(binding: JointSourceBinding): SpatialHandleLayer {
  const snapshot = binding.snapshot;
  const guides: SpatialHandleLayer['guides'][number][] = [
    {
      kind: 'line',
      points: [snapshot.worldAnchor1, snapshot.worldAnchor2],
      color: JOINT_COLOR,
      opacity: 0.9,
    },
  ];
  if (snapshot.worldAxis) {
    const origin = new THREE.Vector3(...snapshot.worldAnchor1);
    const axis = new THREE.Vector3(...snapshot.worldAxis).normalize();
    guides.push({
      kind: 'line',
      points: [
        [origin.x - axis.x, origin.y - axis.y, origin.z - axis.z],
        [origin.x + axis.x, origin.y + axis.y, origin.z + axis.z],
      ],
      color: '#ffd166',
      opacity: 0.82,
      dashed: true,
    });
  }
  return {
    id: `joint:${key(binding)}`,
    category: 'joints',
    guides,
    handles: [
      {
        id: handleId(binding, 0),
        label: 'Joint anchor A',
        position: snapshot.worldAnchor1,
        color: JOINT_COLOR,
        writable: binding.writable,
      },
      {
        id: handleId(binding, 1),
        label: 'Joint anchor B',
        position: snapshot.worldAnchor2,
        color: JOINT_COLOR,
        writable: binding.writable,
      },
    ],
  };
}

function rounded(value: number): number {
  return Math.round(value * ROUND_TO) / ROUND_TO;
}

function parsedHandle(handle: string): { key: string; endpoint: 0 | 1 } | null {
  const match = /^joint:(\d+:\d+):([01])$/.exec(handle);
  return match ? { key: match[1]!, endpoint: Number(match[2]) as 0 | 1 } : null;
}

function anchorParamIndex(binding: JointSourceBinding, endpoint: 0 | 1): number {
  return binding.source.hook === 'useFixedJoint' && endpoint === 1 ? 2 : endpoint;
}

/** Convert a world drag point back to the native hook's body-local anchor. */
export function jointAnchorEditFromWorld(
  bindings: readonly JointSourceBinding[],
  handle: string,
  worldPosition: SpatialPoint3,
): JointAnchorEdit | null {
  const parsed = parsedHandle(handle);
  const binding = parsed ? bindings.find((candidate) => key(candidate) === parsed.key) : undefined;
  if (!binding || !parsed || !binding.writable || !binding.source.params) return null;
  const snapshot = binding.snapshot;
  const position = parsed.endpoint === 0 ? snapshot.body1Position : snapshot.body2Position;
  const rotation = parsed.endpoint === 0 ? snapshot.body1Rotation : snapshot.body2Rotation;
  const local = new THREE.Vector3(...worldPosition)
    .sub(new THREE.Vector3(...position))
    .applyQuaternion(new THREE.Quaternion(...rotation).invert());
  const anchor: [number, number, number] = [rounded(local.x), rounded(local.y), rounded(local.z)];
  const params = binding.source.params.map((value) =>
    Array.isArray(value) ? [...value] : value,
  ) as R3fJointLiteral[];
  params[anchorParamIndex(binding, parsed.endpoint)] = anchor;
  return { binding, endpoint: parsed.endpoint, anchor, params };
}
