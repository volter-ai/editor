/**
 * Positional-audio projection onto the generic spatial-handle seam.
 *
 * Web Audio owns every value and Three owns the live object. This module only
 * translates those native values into world-space guide geometry and turns a
 * world-space drag point back into one native value. It stores nothing.
 */

import type { SpatialHandleLayer, SpatialPoint3 } from '@volter/editor-project/adapter';
import * as THREE from 'three';
import {
  applyTypedField,
  isPositionalAudioObject,
  type TypedThreeField,
  typedFieldForPath,
} from './typed-three-inspector';

const REF_COLOR = '#42c8ff';
const MAX_COLOR = '#287fb8';
const INNER_COLOR = '#ffd166';
const OUTER_COLOR = '#ff9f43';
const ROUND_TO = 100;

export type AudioHandleId =
  | 'audio-ref-distance'
  | 'audio-max-distance'
  | 'audio-inner-cone'
  | 'audio-outer-cone';

export interface AudioHandleEdit {
  readonly field: TypedThreeField;
  readonly value: number;
}

function tuple(value: THREE.Vector3): SpatialPoint3 {
  return [value.x, value.y, value.z];
}

function worldFrame(object: THREE.Object3D): {
  origin: THREE.Vector3;
  forward: THREE.Vector3;
  right: THREE.Vector3;
} {
  object.updateWorldMatrix(true, false);
  const origin = object.getWorldPosition(new THREE.Vector3());
  const rotation = object.getWorldQuaternion(new THREE.Quaternion());
  return {
    origin,
    // THREE.PositionalAudio writes this same local +Z orientation into its
    // PannerNode in updateMatrixWorld().
    forward: new THREE.Vector3(0, 0, 1).applyQuaternion(rotation).normalize(),
    right: new THREE.Vector3(1, 0, 0).applyQuaternion(rotation).normalize(),
  };
}

function pointOnCone(
  origin: THREE.Vector3,
  forward: THREE.Vector3,
  right: THREE.Vector3,
  length: number,
  fullAngleDegrees: number,
): THREE.Vector3 {
  const halfAngle = THREE.MathUtils.degToRad(fullAngleDegrees / 2);
  return origin
    .clone()
    .addScaledVector(forward, Math.cos(halfAngle) * length)
    .addScaledVector(right, Math.sin(halfAngle) * length);
}

/** Selected-source attenuation and direction, with handles only where the
 * native parameter currently has visible meaning. Web Audio ignores
 * maxDistance outside the linear model, so no ring is drawn there. */
export function positionalAudioHandleLayer(
  object: THREE.Object3D,
  writable: (path: string) => boolean,
): SpatialHandleLayer | null {
  if (!isPositionalAudioObject(object)) return null;
  const { origin, forward, right } = worldFrame(object);
  const refDistance = object.getRefDistance();
  const maxDistance = object.getMaxDistance();
  const distanceModel = object.getDistanceModel();
  const innerAngle = object.panner.coneInnerAngle;
  const outerAngle = object.panner.coneOuterAngle;
  const directional = outerAngle < 359.5;
  const coneLength = Math.max(1, Math.min(8, refDistance * 2.5));

  const guides: SpatialHandleLayer['guides'][number][] = [
    {
      kind: 'sphere',
      center: tuple(origin),
      radius: refDistance,
      color: REF_COLOR,
      opacity: 0.75,
    },
  ];
  const handles: SpatialHandleLayer['handles'][number][] = [
    {
      id: 'audio-ref-distance',
      label: 'Reference distance',
      position: tuple(origin.clone().addScaledVector(right, refDistance)),
      color: REF_COLOR,
      writable: writable('audio.refDistance'),
    },
  ];

  if (distanceModel === 'linear') {
    guides.push({
      kind: 'sphere',
      center: tuple(origin),
      radius: maxDistance,
      color: MAX_COLOR,
      opacity: 0.42,
      dashed: true,
    });
    handles.push({
      id: 'audio-max-distance',
      label: 'Maximum distance',
      position: tuple(origin.clone().addScaledVector(right, maxDistance)),
      color: MAX_COLOR,
      writable: writable('audio.maxDistance'),
    });
  }

  if (directional) {
    guides.push({
      kind: 'cone',
      origin: tuple(origin),
      direction: tuple(forward),
      length: coneLength,
      angle: outerAngle,
      color: OUTER_COLOR,
      opacity: 0.72,
    });
    handles.push({
      id: 'audio-outer-cone',
      label: 'Outer cone angle',
      position: tuple(pointOnCone(origin, forward, right, coneLength, outerAngle)),
      color: OUTER_COLOR,
      writable: writable('audio.coneOuterAngle'),
    });
    if (innerAngle < 359.5) {
      guides.push({
        kind: 'cone',
        origin: tuple(origin),
        direction: tuple(forward),
        length: coneLength,
        angle: innerAngle,
        color: INNER_COLOR,
        opacity: 0.58,
        dashed: true,
      });
      handles.push({
        id: 'audio-inner-cone',
        label: 'Inner cone angle',
        position: tuple(pointOnCone(origin, forward, right, coneLength, innerAngle)),
        color: INNER_COLOR,
        writable: writable('audio.coneInnerAngle'),
      });
    }
  }

  return { id: 'positional-audio', category: 'audio', guides, handles };
}

function rounded(value: number): number {
  return Math.round(value * ROUND_TO) / ROUND_TO;
}

/** Translate a drag point into the one inspector/source field it edits. */
export function positionalAudioEditFromWorld(
  object: THREE.Object3D,
  sourceTag: string | undefined,
  handleId: string,
  worldPosition: SpatialPoint3,
): AudioHandleEdit | null {
  if (!isPositionalAudioObject(object)) return null;
  const { origin, forward } = worldFrame(object);
  const point = new THREE.Vector3(...worldPosition);
  const delta = point.sub(origin);
  let path: string;
  let value: number;

  switch (handleId as AudioHandleId) {
    case 'audio-ref-distance':
      path = 'audio.refDistance';
      value = Math.max(0.01, rounded(delta.length()));
      break;
    case 'audio-max-distance':
      path = 'audio.maxDistance';
      value = Math.max(object.getRefDistance() + 0.01, rounded(delta.length()));
      break;
    case 'audio-inner-cone':
    case 'audio-outer-cone': {
      path = handleId === 'audio-inner-cone' ? 'audio.coneInnerAngle' : 'audio.coneOuterAngle';
      // Keep the signed axial component: angles above 180 degrees place the
      // cone rim behind the source, and Web Audio legitimately accepts the
      // full 0..360 range.
      const axial = delta.dot(forward);
      const radial = Math.sqrt(Math.max(0, delta.lengthSq() - axial * axial));
      value = rounded(THREE.MathUtils.radToDeg(Math.atan2(radial, axial)) * 2);
      break;
    }
    default:
      return null;
  }

  const field = typedFieldForPath(object, null, path, sourceTag);
  return field ? { field, value } : null;
}

/** Apply only to the live native object; source persistence is the adapter's
 * commit step and happens once at pointer-up. */
export function previewPositionalAudioEdit(object: THREE.Object3D, edit: AudioHandleEdit): void {
  applyTypedField(object, null, edit.field, edit.value);
}
