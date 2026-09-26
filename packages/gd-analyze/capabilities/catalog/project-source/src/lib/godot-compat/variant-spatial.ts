/** Runtime spatial-property dispatch for a statically open Godot Node/Variant receiver. */

import { Container } from 'pixi.js';
import { Object3D } from 'three';

import { basisScale, basisScaledLocal } from './basis';
import {
  getCanvasControlGlobalPosition,
  getCanvasControlPosition,
  getCanvasControlScale,
  getCanvasControlSize,
  setCanvasControlGlobalPosition,
  setCanvasControlPosition,
  setCanvasControlScale,
  setCanvasControlSize,
} from './canvas-control-state';
import { optionalControlBinding } from './control-state';
import {
  type ControlRectNode,
  getControlGlobalPosition,
  getControlPosition,
  getControlRotation,
  getControlScale,
  getControlSize,
  getGlobalTransformWithCanvas,
  getNode2DTransform,
  getPosition,
  getRotation as getNode2DRotation,
  getRotationDegrees as getNode2DRotationDegrees,
  getScale as getNode2DScale,
  setControlGlobalPosition,
  setControlPosition,
  setControlRotation,
  setControlScale,
  setControlSize,
  setNode2DTransform,
  setPosition,
  setRotation as setNode2DRotation,
  setRotationDegrees as setNode2DRotationDegrees,
  setScale as setNode2DScale,
} from './node';
import {
  getCanvasGlobalPosition2D,
  getCanvasGlobalRotation2D,
  getCanvasGlobalRotationDegrees2D,
  getCanvasGlobalScale2D,
  getCanvasGlobalTransform2D,
  setCanvasGlobalPosition2D,
  setCanvasGlobalRotation2D,
  setCanvasGlobalRotationDegrees2D,
  setCanvasGlobalScale2D,
  setCanvasGlobalTransform2D,
} from './physics-2d';
import {
  getGlobalPosition,
  getGlobalRotation,
  getGlobalTransform,
  getRotation as getSpatialRotation,
  getRotationDegrees as getSpatialRotationDegrees,
  getScale as getSpatialScale,
  getTransform,
  getTranslation,
  setGlobalPosition,
  setGlobalRotation,
  setGlobalTransform,
  setRotation as setSpatialRotation,
  setRotationDegrees as setSpatialRotationDegrees,
  setScale as setSpatialScale,
  setTransform,
  setTranslation,
} from './spatial';
import type { GodotTransform2D } from './transform-2d';
import type { Vector2 } from './vector2';
import { type Transform, type Vector3, vec3 } from './variant-3d';

type SpatialPosition = Vector2 | Vector3;
type SpatialTransform = GodotTransform2D | Transform;
type SpatialScale = Vector2 | Vector3;
type SpatialRotation = number | Vector3;

const RADIANS_TO_DEGREES = 180 / Math.PI;
const DEGREES_TO_RADIANS = Math.PI / 180;

function carrierName(value: unknown): string {
  if (value === null) return 'Nil';
  if (value === undefined) return 'undefined';
  if (typeof value !== 'object') return typeof value;
  return value.constructor?.name ?? 'Object';
}

function controlCarrier(value: unknown): value is object {
  return typeof value === 'object' && value !== null && optionalControlBinding(value) !== undefined;
}

function vector2(value: unknown, property: string): Vector2 {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`godot-compat: ${property} on a 2D carrier requires a finite Vector2.`);
  }
  const candidate = value as Partial<Vector2>;
  if (
    !Number.isFinite(candidate.x) ||
    !Number.isFinite(candidate.y) ||
    'z' in candidate
  ) {
    throw new TypeError(`godot-compat: ${property} on a 2D carrier requires a finite Vector2.`);
  }
  return { x: candidate.x as number, y: candidate.y as number };
}

function vector3(value: unknown, property: string): Vector3 {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`godot-compat: ${property} on a 3D carrier requires a finite Vector3.`);
  }
  const candidate = value as Partial<Vector3>;
  if (
    !Number.isFinite(candidate.x) ||
    !Number.isFinite(candidate.y) ||
    !Number.isFinite(candidate.z)
  ) {
    throw new TypeError(`godot-compat: ${property} on a 3D carrier requires a finite Vector3.`);
  }
  return {
    x: candidate.x as number,
    y: candidate.y as number,
    z: candidate.z as number,
  };
}

function transform2D(value: unknown, property: string): GodotTransform2D {
  if (typeof value !== 'object' || value === null || !('x' in value) || !('y' in value) ||
    !('origin' in value)) {
    throw new TypeError(`godot-compat: ${property} on a 2D carrier requires Transform2D.`);
  }
  const candidate = value as GodotTransform2D;
  vector2(candidate.x, property);
  vector2(candidate.y, property);
  vector2(candidate.origin, property);
  return candidate;
}

function transform3D(value: unknown, property: string): Transform {
  if (typeof value !== 'object' || value === null || !('basis' in value) || !('origin' in value)) {
    throw new TypeError(`godot-compat: ${property} on a 3D carrier requires Transform3D.`);
  }
  const candidate = value as Transform;
  if (!Array.isArray(candidate.basis) || candidate.basis.length !== 3) {
    throw new TypeError(`godot-compat: ${property} on a 3D carrier requires Transform3D.`);
  }
  for (const axis of candidate.basis) vector3(axis, property);
  vector3(candidate.origin, property);
  return candidate;
}

function orthogonalBasis(basis: Transform['basis']): boolean {
  const lengths = basis.map((axis) => Math.hypot(axis.x, axis.y, axis.z));
  if (lengths.some((length) => length <= Number.EPSILON)) return false;
  const normalizedDot = (left: number, right: number): number => {
    const a = basis[left]!;
    const b = basis[right]!;
    return Math.abs((a.x * b.x + a.y * b.y + a.z * b.z) / (lengths[left]! * lengths[right]!));
  };
  return normalizedDot(0, 1) <= 1e-10 && normalizedDot(0, 2) <= 1e-10 &&
    normalizedDot(1, 2) <= 1e-10;
}

function uniformParentBasis(node: Object3D): boolean {
  if (node.parent === null || node.matrixWorldAutoUpdate === false) return true;
  const basis = getGlobalTransform(node.parent).basis;
  if (!orthogonalBasis(basis)) return false;
  const scale = basisScale(basis);
  const magnitudes = [Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)];
  return magnitudes.every((value) => value > Number.EPSILON) &&
    Math.max(...magnitudes) - Math.min(...magnitudes) <= 1e-10 * Math.max(...magnitudes);
}

/** Read local `position`, preserving the native carrier's dimensional value shape. */
export function godotVariantPosition(receiver: unknown): SpatialPosition {
  if (receiver instanceof Object3D) return getTranslation(receiver);
  if (receiver instanceof Container) {
    return optionalControlBinding(receiver) === undefined
      ? getPosition(receiver)
      : getCanvasControlPosition(receiver);
  }
  if (controlCarrier(receiver)) return getControlPosition(receiver as ControlRectNode);
  throw new TypeError(
    `godot-compat: Variant.position requires a retained Node2D, Control, or Node3D carrier; ` +
      `received ${carrierName(receiver)}.`,
  );
}

/** Write local `position` through the same retained transform/layout owner used by exact rows. */
export function setGodotVariantPosition(receiver: unknown, value: unknown): void {
  if (receiver instanceof Object3D) {
    setTranslation(receiver, vector3(value, 'Variant.position'));
    return;
  }
  if (receiver instanceof Container) {
    const point = vector2(value, 'Variant.position');
    if (optionalControlBinding(receiver) === undefined) setPosition(receiver, point);
    else setCanvasControlPosition(receiver, point);
    return;
  }
  if (controlCarrier(receiver)) {
    setControlPosition(receiver as ControlRectNode, vector2(value, 'Variant.position'));
    return;
  }
  throw new TypeError(
    `godot-compat: Variant.position requires a retained Node2D, Control, or Node3D carrier; ` +
      `received ${carrierName(receiver)}.`,
  );
}

/** Godot 3 Spatial.translation on an open/base Node, never a 2D position alias. */
export function godotVariantTranslation(receiver: unknown): Vector3 {
  if (receiver instanceof Object3D) return getTranslation(receiver);
  throw new TypeError(
    `godot-compat: Variant.translation requires a retained Spatial carrier; received ${carrierName(receiver)}.`,
  );
}

/** Write Godot 3 Spatial.translation through the retained native Three transform. */
export function setGodotVariantTranslation(receiver: unknown, value: unknown): void {
  if (receiver instanceof Object3D) {
    setTranslation(receiver, vector3(value, 'Variant.translation'));
    return;
  }
  throw new TypeError(
    `godot-compat: Variant.translation requires a retained Spatial carrier; received ${carrierName(receiver)}.`,
  );
}

/** Read Godot 3 Control.rect_position without widening the owner to arbitrary Node2D carriers. */
export function godotVariantRectPosition(receiver: unknown): Vector2 {
  if (receiver instanceof Container && optionalControlBinding(receiver) !== undefined) {
    return getCanvasControlPosition(receiver);
  }
  if (controlCarrier(receiver)) return getControlPosition(receiver as ControlRectNode);
  throw new TypeError(
    `godot-compat: Variant.rect_position requires a retained Control carrier; received ${carrierName(receiver)}.`,
  );
}

/** Write Godot 3 Control.rect_position through the retained Control layout owner. */
export function setGodotVariantRectPosition(receiver: unknown, value: unknown): void {
  const point = vector2(value, 'Variant.rect_position');
  if (receiver instanceof Container && optionalControlBinding(receiver) !== undefined) {
    setCanvasControlPosition(receiver, point);
    return;
  }
  if (controlCarrier(receiver)) {
    setControlPosition(receiver as ControlRectNode, point);
    return;
  }
  throw new TypeError(
    `godot-compat: Variant.rect_position requires a retained Control carrier; received ${carrierName(receiver)}.`,
  );
}

/** Read Godot 3 Control.rect_size through DOM or Pixi retained layout state. */
export function godotVariantRectSize(receiver: unknown): Vector2 {
  if (receiver instanceof Container && optionalControlBinding(receiver) !== undefined) {
    return getCanvasControlSize(receiver);
  }
  if (controlCarrier(receiver)) return getControlSize(receiver as ControlRectNode);
  throw new TypeError(
    `godot-compat: Variant.rect_size requires a retained Control carrier; received ${carrierName(receiver)}.`,
  );
}

/** Write Godot 3 Control.rect_size through the retained Control layout owner. */
export function setGodotVariantRectSize(receiver: unknown, value: unknown): void {
  const size = vector2(value, 'Variant.rect_size');
  if (receiver instanceof Container && optionalControlBinding(receiver) !== undefined) {
    setCanvasControlSize(receiver, size);
    return;
  }
  if (controlCarrier(receiver)) {
    setControlSize(receiver as ControlRectNode, size);
    return;
  }
  throw new TypeError(
    `godot-compat: Variant.rect_size requires a retained Control carrier; received ${carrierName(receiver)}.`,
  );
}

/** Read local scale as a copied Vector2/Vector3 from the retained native spatial owner. */
export function godotVariantScale(receiver: unknown): SpatialScale {
  if (receiver instanceof Object3D) return getSpatialScale(receiver);
  if (receiver instanceof Container) {
    return optionalControlBinding(receiver) === undefined
      ? getNode2DScale(receiver)
      : getCanvasControlScale(receiver);
  }
  if (controlCarrier(receiver)) return getControlScale(receiver as ControlRectNode);
  throw new TypeError(
    `godot-compat: Variant.scale requires a retained Node2D, Control, or Node3D carrier; ` +
      `received ${carrierName(receiver)}.`,
  );
}

/** Write local scale through Pixi, Control layout state, or Three's native transform. */
export function setGodotVariantScale(receiver: unknown, value: unknown): void {
  if (receiver instanceof Object3D) {
    setSpatialScale(receiver, vector3(value, 'Variant.scale'));
    return;
  }
  if (receiver instanceof Container) {
    const scale = vector2(value, 'Variant.scale');
    if (optionalControlBinding(receiver) === undefined) setNode2DScale(receiver, scale);
    else setCanvasControlScale(receiver, scale);
    return;
  }
  if (controlCarrier(receiver)) {
    setControlScale(receiver as ControlRectNode, vector2(value, 'Variant.scale'));
    return;
  }
  throw new TypeError(
    `godot-compat: Variant.scale requires a retained Node2D, Control, or Node3D carrier; ` +
      `received ${carrierName(receiver)}.`,
  );
}

/** Local rotation is scalar radians in 2D and a copied YXZ Vector3 in 3D. */
export function godotVariantRotation(receiver: unknown): SpatialRotation {
  if (receiver instanceof Object3D) return getSpatialRotation(receiver);
  if (receiver instanceof Container) {
    return optionalControlBinding(receiver) === undefined
      ? getNode2DRotation(receiver)
      : getControlRotation(receiver);
  }
  if (controlCarrier(receiver)) return getControlRotation(receiver);
  throw new TypeError(
    `godot-compat: Variant.rotation requires a retained Node2D, Control, or Node3D carrier; ` +
      `received ${carrierName(receiver)}.`,
  );
}

export function setGodotVariantRotation(receiver: unknown, value: unknown): void {
  if (receiver instanceof Object3D) {
    setSpatialRotation(receiver, vector3(value, 'Variant.rotation'));
    return;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError('godot-compat: Variant.rotation on a 2D carrier requires finite radians.');
  }
  if (receiver instanceof Container) {
    if (optionalControlBinding(receiver) === undefined) setNode2DRotation(receiver, value);
    else setControlRotation(receiver, value);
    return;
  }
  if (controlCarrier(receiver)) {
    setControlRotation(receiver, value);
    return;
  }
  throw new TypeError(
    `godot-compat: Variant.rotation requires a retained Node2D, Control, or Node3D carrier; ` +
      `received ${carrierName(receiver)}.`,
  );
}

/** Degree form over the same retained local rotation; no second rotation state is introduced. */
export function godotVariantRotationDegrees(receiver: unknown): SpatialRotation {
  if (receiver instanceof Object3D) return getSpatialRotationDegrees(receiver);
  if (receiver instanceof Container) {
    return optionalControlBinding(receiver) === undefined
      ? getNode2DRotationDegrees(receiver)
      : getControlRotation(receiver) * RADIANS_TO_DEGREES;
  }
  if (controlCarrier(receiver)) return getControlRotation(receiver) * RADIANS_TO_DEGREES;
  throw new TypeError(
    `godot-compat: Variant.rotation_degrees requires a retained Node2D, Control, or Node3D ` +
      `carrier; received ${carrierName(receiver)}.`,
  );
}

export function setGodotVariantRotationDegrees(receiver: unknown, value: unknown): void {
  if (receiver instanceof Object3D) {
    setSpatialRotationDegrees(receiver, vector3(value, 'Variant.rotation_degrees'));
    return;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError('godot-compat: Variant.rotation_degrees on a 2D carrier requires a finite number.');
  }
  if (receiver instanceof Container) {
    if (optionalControlBinding(receiver) === undefined) setNode2DRotationDegrees(receiver, value);
    else setControlRotation(receiver, value * DEGREES_TO_RADIANS);
    return;
  }
  if (controlCarrier(receiver)) {
    setControlRotation(receiver, value * DEGREES_TO_RADIANS);
    return;
  }
  throw new TypeError(
    `godot-compat: Variant.rotation_degrees requires a retained Node2D, Control, or Node3D ` +
      `carrier; received ${carrierName(receiver)}.`,
  );
}

/** World rotation through the live Pixi/Three parent graph. DOM Controls remain loud. */
export function godotVariantGlobalRotation(
  receiver: unknown,
  presentationRoot: unknown,
  major: 3 | 4,
): SpatialRotation {
  if (receiver instanceof Object3D) {
    if (major === 3) throw new TypeError('godot-compat: Godot 3 Spatial has no global_rotation property.');
    return getGlobalRotation(receiver);
  }
  if (receiver instanceof Container) {
    if (!(presentationRoot instanceof Container)) {
      throw new TypeError('godot-compat: a 2D Variant.global_rotation requires its Pixi root.');
    }
    return getCanvasGlobalRotation2D(receiver, presentationRoot);
  }
  throw new TypeError(
    `godot-compat: Variant.global_rotation requires a retained Pixi Node2D/Control or Node3D ` +
      `carrier; received ${carrierName(receiver)}.`,
  );
}

export function setGodotVariantGlobalRotation(
  receiver: unknown,
  presentationRoot: unknown,
  major: 3 | 4,
  value: unknown,
): void {
  if (receiver instanceof Object3D) {
    if (major === 3) throw new TypeError('godot-compat: Godot 3 Spatial has no global_rotation property.');
    setGlobalRotation(receiver, vector3(value, 'Variant.global_rotation'));
    return;
  }
  if (receiver instanceof Container) {
    if (!(presentationRoot instanceof Container)) {
      throw new TypeError('godot-compat: a 2D Variant.global_rotation requires its Pixi root.');
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError('godot-compat: Variant.global_rotation on a 2D carrier requires finite radians.');
    }
    setCanvasGlobalRotation2D(receiver, presentationRoot, value);
    return;
  }
  throw new TypeError(
    `godot-compat: Variant.global_rotation requires a retained Pixi Node2D/Control or Node3D ` +
      `carrier; received ${carrierName(receiver)}.`,
  );
}

export function godotVariantGlobalRotationDegrees(
  receiver: unknown,
  presentationRoot: unknown,
  major: 3 | 4,
): SpatialRotation {
  if (receiver instanceof Object3D) {
    if (major === 3) {
      throw new TypeError('godot-compat: Godot 3 Spatial has no global_rotation_degrees property.');
    }
    const radians = getGlobalRotation(receiver);
    return vec3(
      radians.x * RADIANS_TO_DEGREES,
      radians.y * RADIANS_TO_DEGREES,
      radians.z * RADIANS_TO_DEGREES,
    );
  }
  if (receiver instanceof Container) {
    if (!(presentationRoot instanceof Container)) {
      throw new TypeError(
        'godot-compat: a 2D Variant.global_rotation_degrees requires its Pixi root.',
      );
    }
    return getCanvasGlobalRotationDegrees2D(receiver, presentationRoot);
  }
  throw new TypeError(
    `godot-compat: Variant.global_rotation_degrees requires a retained Pixi Node2D/Control or ` +
      `Node3D carrier; received ${carrierName(receiver)}.`,
  );
}

export function setGodotVariantGlobalRotationDegrees(
  receiver: unknown,
  presentationRoot: unknown,
  major: 3 | 4,
  value: unknown,
): void {
  if (receiver instanceof Object3D) {
    if (major === 3) {
      throw new TypeError('godot-compat: Godot 3 Spatial has no global_rotation_degrees property.');
    }
    const degrees = vector3(value, 'Variant.global_rotation_degrees');
    setGlobalRotation(receiver, {
      x: degrees.x * DEGREES_TO_RADIANS,
      y: degrees.y * DEGREES_TO_RADIANS,
      z: degrees.z * DEGREES_TO_RADIANS,
    });
    return;
  }
  if (receiver instanceof Container) {
    if (!(presentationRoot instanceof Container)) {
      throw new TypeError(
        'godot-compat: a 2D Variant.global_rotation_degrees requires its Pixi root.',
      );
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(
        'godot-compat: Variant.global_rotation_degrees on a 2D carrier requires a finite number.',
      );
    }
    setCanvasGlobalRotationDegrees2D(receiver, presentationRoot, value);
    return;
  }
  throw new TypeError(
    `godot-compat: Variant.global_rotation_degrees requires a retained Pixi Node2D/Control or ` +
      `Node3D carrier; received ${carrierName(receiver)}.`,
  );
}

/** World scale with full parent propagation through Transform2D/Transform3D basis ownership. */
export function godotVariantGlobalScale(
  receiver: unknown,
  presentationRoot: unknown,
  major: 3 | 4,
): SpatialScale {
  if (receiver instanceof Object3D) {
    if (major === 3) throw new TypeError('godot-compat: Godot 3 Spatial has no global_scale property.');
    return basisScale(getGlobalTransform(receiver).basis);
  }
  if (receiver instanceof Container) {
    if (!(presentationRoot instanceof Container)) {
      throw new TypeError('godot-compat: a 2D Variant.global_scale requires its Pixi root.');
    }
    return getCanvasGlobalScale2D(receiver, presentationRoot);
  }
  throw new TypeError(
    `godot-compat: Variant.global_scale requires a retained Pixi Node2D/Control or Node3D ` +
      `carrier; received ${carrierName(receiver)}.`,
  );
}

export function setGodotVariantGlobalScale(
  receiver: unknown,
  presentationRoot: unknown,
  major: 3 | 4,
  value: unknown,
): void {
  if (receiver instanceof Object3D) {
    if (major === 3) throw new TypeError('godot-compat: Godot 3 Spatial has no global_scale property.');
    const desired = vector3(value, 'Variant.global_scale');
    const current = getGlobalTransform(receiver);
    const scale = basisScale(current.basis);
    const desiredSignsAreCanonical =
      (desired.x > 0 && desired.y > 0 && desired.z > 0) ||
      (desired.x < 0 && desired.y < 0 && desired.z < 0);
    if (
      scale.x === 0 || scale.y === 0 || scale.z === 0 ||
      !orthogonalBasis(current.basis) || !uniformParentBasis(receiver) ||
      !desiredSignsAreCanonical
    ) {
      throw new Error(
        'godot-compat: Variant.global_scale requires non-collapsed orthogonal 3D axes, a ' +
          'uniform unskewed parent basis, and consistently signed nonzero target scale.',
      );
    }
    setGlobalTransform(receiver, {
      basis: basisScaledLocal(current.basis, {
        x: desired.x / scale.x,
        y: desired.y / scale.y,
        z: desired.z / scale.z,
      }),
      origin: current.origin,
    });
    return;
  }
  if (receiver instanceof Container) {
    if (!(presentationRoot instanceof Container)) {
      throw new TypeError('godot-compat: a 2D Variant.global_scale requires its Pixi root.');
    }
    setCanvasGlobalScale2D(receiver, presentationRoot, vector2(value, 'Variant.global_scale'));
    return;
  }
  throw new TypeError(
    `godot-compat: Variant.global_scale requires a retained Pixi Node2D/Control or Node3D ` +
      `carrier; received ${carrierName(receiver)}.`,
  );
}

/** Read world-space `global_position` through Pixi/Control or Three's live transform graph. */
export function godotVariantGlobalPosition(
  receiver: unknown,
  presentationRoot: unknown,
): SpatialPosition {
  if (receiver instanceof Object3D) return getGlobalPosition(receiver);
  if (receiver instanceof Container) {
    if (!(presentationRoot instanceof Container)) {
      throw new TypeError('godot-compat: a 2D Variant.global_position requires its Pixi root.');
    }
    return optionalControlBinding(receiver) === undefined
      ? getCanvasGlobalPosition2D(receiver, presentationRoot)
      : getCanvasControlGlobalPosition(receiver);
  }
  if (controlCarrier(receiver)) return getControlGlobalPosition(receiver as ControlRectNode);
  throw new TypeError(
    `godot-compat: Variant.global_position requires a retained Node2D, Control, or Node3D ` +
      `carrier; received ${carrierName(receiver)}.`,
  );
}

/** Write world-space `global_position` while preserving native parent-transform propagation. */
export function setGodotVariantGlobalPosition(
  receiver: unknown,
  presentationRoot: unknown,
  value: unknown,
): void {
  if (receiver instanceof Object3D) {
    setGlobalPosition(receiver, vector3(value, 'Variant.global_position'));
    return;
  }
  if (receiver instanceof Container) {
    if (!(presentationRoot instanceof Container)) {
      throw new TypeError('godot-compat: a 2D Variant.global_position requires its Pixi root.');
    }
    const point = vector2(value, 'Variant.global_position');
    if (optionalControlBinding(receiver) === undefined) {
      setCanvasGlobalPosition2D(receiver, presentationRoot, point);
    } else {
      setCanvasControlGlobalPosition(receiver, point);
    }
    return;
  }
  if (controlCarrier(receiver)) {
    setControlGlobalPosition(
      receiver as ControlRectNode,
      vector2(value, 'Variant.global_position'),
    );
    return;
  }
  throw new TypeError(
    `godot-compat: Variant.global_position requires a retained Node2D, Control, or Node3D ` +
      `carrier; received ${carrierName(receiver)}.`,
  );
}

/** Read the complete local 2D/3D transform from the retained native spatial carrier. */
export function godotVariantTransform(receiver: unknown): SpatialTransform {
  if (receiver instanceof Object3D) return getTransform(receiver);
  if (receiver instanceof Container) return getNode2DTransform(receiver);
  if (controlCarrier(receiver)) {
    throw new TypeError(
      'godot-compat: Variant.transform on a DOM Control has no native local Transform2D carrier.',
    );
  }
  throw new TypeError(
    `godot-compat: Variant.transform requires a retained Node2D or Node3D carrier; received ` +
      `${carrierName(receiver)}.`,
  );
}

/** Write the complete local transform without bypassing Pixi/Three decomposition. */
export function setGodotVariantTransform(receiver: unknown, value: unknown): void {
  if (receiver instanceof Object3D) {
    setTransform(receiver, transform3D(value, 'Variant.transform'));
    return;
  }
  if (receiver instanceof Container) {
    setNode2DTransform(receiver, transform2D(value, 'Variant.transform'));
    return;
  }
  if (controlCarrier(receiver)) {
    throw new TypeError(
      'godot-compat: Variant.transform on a DOM Control has no native writable Transform2D carrier.',
    );
  }
  throw new TypeError(
    `godot-compat: Variant.transform requires a retained Node2D or Node3D carrier; received ` +
      `${carrierName(receiver)}.`,
  );
}

/** Read the complete world transform through Pixi's or Three's parent transform graph. */
export function godotVariantGlobalTransform(
  receiver: unknown,
  presentationRoot: unknown,
): SpatialTransform {
  if (receiver instanceof Object3D) return getGlobalTransform(receiver);
  if (receiver instanceof Container) {
    if (!(presentationRoot instanceof Container)) {
      throw new TypeError('godot-compat: a 2D Variant.global_transform requires its Pixi root.');
    }
    return getCanvasGlobalTransform2D(receiver, presentationRoot);
  }
  if (controlCarrier(receiver)) {
    return getGlobalTransformWithCanvas(receiver as ControlRectNode);
  }
  throw new TypeError(
    `godot-compat: Variant.global_transform requires a retained Node2D, Control, or Node3D ` +
      `carrier; received ${carrierName(receiver)}.`,
  );
}

/** Write the complete world transform through the native parent-local conversion seam. */
export function setGodotVariantGlobalTransform(
  receiver: unknown,
  presentationRoot: unknown,
  value: unknown,
): void {
  if (receiver instanceof Object3D) {
    setGlobalTransform(receiver, transform3D(value, 'Variant.global_transform'));
    return;
  }
  if (receiver instanceof Container) {
    if (!(presentationRoot instanceof Container)) {
      throw new TypeError('godot-compat: a 2D Variant.global_transform requires its Pixi root.');
    }
    setCanvasGlobalTransform2D(
      receiver,
      presentationRoot,
      transform2D(value, 'Variant.global_transform'),
    );
    return;
  }
  if (controlCarrier(receiver)) {
    throw new TypeError(
      'godot-compat: Variant.global_transform on a DOM Control has no native writable transform.',
    );
  }
  throw new TypeError(
    `godot-compat: Variant.global_transform requires a retained Node2D or Node3D carrier; ` +
      `received ${carrierName(receiver)}.`,
  );
}
