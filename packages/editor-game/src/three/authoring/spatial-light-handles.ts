/**
 * Native Three light projection onto the format-neutral spatial-handle seam.
 *
 * The live THREE.Light remains the value owner and the R3F adapter remains the
 * persistence owner. This module only converts native distance/angle values to
 * world-space geometry and a dragged world point back to the same native prop.
 */

import type { SpatialHandleLayer, SpatialPoint3 } from '@volter/editor-project/adapter';
import * as THREE from 'three';
import { applyTypedField, type TypedThreeField, typedFieldForPath } from './typed-three-inspector';

const RANGE_COLOR = '#ffd166';
const ANGLE_COLOR = '#ff9f43';
const ROUND_TO = 1000;

export type LightHandleId = 'light-range' | 'light-angle';

export interface LightHandleEdit {
  readonly field: TypedThreeField;
  readonly value: number;
}

function tuple(value: THREE.Vector3): SpatialPoint3 {
  return [value.x, value.y, value.z];
}

function rounded(value: number): number {
  return Math.round(value * ROUND_TO) / ROUND_TO;
}

function lightFrame(object: THREE.Object3D): {
  origin: THREE.Vector3;
  rangeAxis: THREE.Vector3;
} {
  object.updateWorldMatrix(true, false);
  const rotation = object.getWorldQuaternion(new THREE.Quaternion());
  return {
    origin: object.getWorldPosition(new THREE.Vector3()),
    rangeAxis: new THREE.Vector3(1, 0, 0).applyQuaternion(rotation).normalize(),
  };
}

function spotFrame(light: THREE.SpotLight): {
  origin: THREE.Vector3;
  direction: THREE.Vector3;
  radial: THREE.Vector3;
} {
  light.updateWorldMatrix(true, false);
  light.target.updateWorldMatrix(true, false);
  const origin = light.getWorldPosition(new THREE.Vector3());
  const target = light.target.getWorldPosition(new THREE.Vector3());
  const direction = target.sub(origin).normalize();
  if (direction.lengthSq() < 1e-8) {
    direction.set(0, 0, -1).applyQuaternion(light.getWorldQuaternion(new THREE.Quaternion()));
  }
  const reference =
    Math.abs(direction.y) > 0.98 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const radial = new THREE.Vector3().crossVectors(direction, reference).normalize();
  return { origin, direction, radial };
}

function pointOnSpotCone(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  radial: THREE.Vector3,
  length: number,
  halfAngle: number,
): THREE.Vector3 {
  return origin
    .clone()
    .addScaledVector(direction, Math.cos(halfAngle) * length)
    .addScaledVector(radial, Math.sin(halfAngle) * length);
}

/** Point/spot range and spot cone geometry. A zero Three distance means
 * unbounded, so it deliberately has no finite range ring or drag point. */
export function lightHandleLayer(
  object: THREE.Object3D,
  writable: (path: string) => boolean,
): SpatialHandleLayer | null {
  const light = object as THREE.Object3D &
    Partial<THREE.PointLight> & {
      isPointLight?: boolean;
      isSpotLight?: boolean;
    };
  if (!light.isPointLight && !light.isSpotLight) return null;

  const { origin, rangeAxis } = lightFrame(object);
  const distance = typeof light.distance === 'number' ? light.distance : 0;
  const guides: SpatialHandleLayer['guides'][number][] = [];
  const handles: SpatialHandleLayer['handles'][number][] = [];

  if (distance > 0) {
    guides.push({
      kind: 'sphere',
      center: tuple(origin),
      radius: distance,
      color: RANGE_COLOR,
      opacity: 0.62,
    });
    handles.push({
      id: 'light-range',
      label: 'Light range',
      position: tuple(origin.clone().addScaledVector(rangeAxis, distance)),
      color: RANGE_COLOR,
      writable: writable('light.distance'),
    });
  }

  if (light.isSpotLight) {
    const spot = object as THREE.SpotLight;
    const { direction, radial } = spotFrame(spot);
    // With an unbounded spot, target distance supplies only a readable guide
    // length; it never becomes an authored light value.
    const targetDistance = origin.distanceTo(spot.target.getWorldPosition(new THREE.Vector3()));
    const length = distance > 0 ? distance : Math.max(1, targetDistance);
    const fullAngle = THREE.MathUtils.radToDeg(spot.angle * 2);
    guides.push({
      kind: 'cone',
      origin: tuple(origin),
      direction: tuple(direction),
      length,
      angle: fullAngle,
      color: ANGLE_COLOR,
      opacity: 0.75,
    });
    handles.push({
      id: 'light-angle',
      label: 'Spot angle',
      position: tuple(pointOnSpotCone(origin, direction, radial, length, spot.angle)),
      color: ANGLE_COLOR,
      writable: writable('light.angle'),
    });
  }

  return guides.length > 0 || handles.length > 0
    ? { id: 'light', category: 'lights', guides, handles }
    : null;
}

/** Translate a drag point into the exact native/source field it edits. */
export function lightEditFromWorld(
  object: THREE.Object3D,
  sourceTag: string | undefined,
  handleId: string,
  worldPosition: SpatialPoint3,
): LightHandleEdit | null {
  const light = object as THREE.Object3D &
    Partial<THREE.PointLight> & {
      isPointLight?: boolean;
      isSpotLight?: boolean;
    };
  const point = new THREE.Vector3(...worldPosition);
  let path: string;
  let value: number;

  if (handleId === 'light-range' && (light.isPointLight || light.isSpotLight)) {
    path = 'light.distance';
    value = Math.max(0.01, rounded(point.distanceTo(lightFrame(object).origin)));
  } else if (handleId === 'light-angle' && light.isSpotLight) {
    path = 'light.angle';
    const { origin, direction } = spotFrame(object as THREE.SpotLight);
    const delta = point.sub(origin);
    const axial = delta.dot(direction);
    const radial = Math.sqrt(Math.max(0, delta.lengthSq() - axial * axial));
    value = rounded(Math.max(0.01, Math.min(Math.PI / 2, Math.atan2(radial, axial))));
  } else {
    return null;
  }

  const field = typedFieldForPath(object, null, path, sourceTag);
  return field ? { field, value } : null;
}

export function previewLightEdit(object: THREE.Object3D, edit: LightHandleEdit): void {
  applyTypedField(object, null, edit.field, edit.value);
}
