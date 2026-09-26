/** Exact structural Variant value-property dispatch for statically open value receivers. */

import { basisFromColumns } from './basis';
import { godotTransform2DNew, type GodotTransform2D } from './transform-2d';
import { length3, transform3, type Transform, type Vector3, vec3 } from './variant-3d';
import { length as length2, type Vector2, vec2 } from './vector2';

type VariantVector = Vector2 | Vector3;
type VariantTransform = GodotTransform2D | Transform;
type VariantValue = VariantVector | VariantTransform;
type VariantValueProperty = 'x' | 'y' | 'z' | 'origin' | 'basis';
type ClassifiedVariantValue =
  | { readonly kind: 'Vector2'; readonly value: Vector2 }
  | { readonly kind: 'Vector3'; readonly value: Vector3 }
  | { readonly kind: 'Transform2D'; readonly value: GodotTransform2D }
  | { readonly kind: 'Transform3D'; readonly value: Transform };

function exactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function finite2(value: unknown): value is Vector2 {
  return typeof value === 'object' && value !== null && exactKeys(value, ['x', 'y']) &&
    Number.isFinite((value as Vector2).x) && Number.isFinite((value as Vector2).y);
}

function finite3(value: unknown): value is Vector3 {
  return typeof value === 'object' && value !== null && exactKeys(value, ['x', 'y', 'z']) &&
    Number.isFinite((value as Vector3).x) && Number.isFinite((value as Vector3).y) &&
    Number.isFinite((value as Vector3).z);
}

function transform2DValue(value: unknown): value is GodotTransform2D {
  return typeof value === 'object' && value !== null && exactKeys(value, ['x', 'y', 'origin']) &&
    finite2((value as GodotTransform2D).x) && finite2((value as GodotTransform2D).y) &&
    finite2((value as GodotTransform2D).origin);
}

function basisValue(value: unknown): value is Transform['basis'] {
  return Array.isArray(value) && value.length === 3 && value.every(finite3);
}

function transform3DValue(value: unknown): value is Transform {
  return typeof value === 'object' && value !== null && exactKeys(value, ['basis', 'origin']) &&
    basisValue((value as Transform).basis) && finite3((value as Transform).origin);
}

/**
 * Classify and retain the narrowed carrier together. Returning only a kind loses the proof at the
 * TypeScript boundary even though Godot's Variant has already established the exact value type.
 */
function classifyValue(value: unknown): ClassifiedVariantValue | undefined {
  if (finite2(value)) return { kind: 'Vector2', value };
  if (finite3(value)) return { kind: 'Vector3', value };
  if (transform2DValue(value)) return { kind: 'Transform2D', value };
  if (transform3DValue(value)) return { kind: 'Transform3D', value };
  return undefined;
}

function refused(property: string, value: unknown): never {
  const name = value === null ? 'Nil' : typeof value === 'object'
    ? value?.constructor?.name ?? 'Object'
    : typeof value;
  throw new TypeError(
    `godot-compat: Variant.${property} requires a complete finite Vector2, Vector3, ` +
      `Transform2D, or Transform3D value; received ${name}.`,
  );
}

/** Exact Vector2/Vector3 magnitude for an open Variant `.length()` receiver. */
export function godotVariantValueLength(receiver: unknown): number {
  const classified = classifyValue(receiver);
  if (classified?.kind === 'Vector2') return length2(classified.value);
  if (classified?.kind === 'Vector3') return length3(classified.value);
  return refused('length', receiver);
}

/** Read a value property only after the complete carrier shape proves its Godot built-in kind. */
export function godotVariantValueProperty(
  receiver: unknown,
  property: 'x' | 'y',
): number | Vector2;
export function godotVariantValueProperty(receiver: unknown, property: 'z'): number;
export function godotVariantValueProperty(
  receiver: unknown,
  property: 'origin',
): VariantVector;
export function godotVariantValueProperty(
  receiver: unknown,
  property: 'basis',
): Transform['basis'];
export function godotVariantValueProperty<T>(
  receiver: unknown,
  property: VariantValueProperty,
): T;
export function godotVariantValueProperty(
  receiver: unknown,
  property: VariantValueProperty,
): unknown {
  const classified = classifyValue(receiver);
  if (
    (property === 'x' || property === 'y') &&
    (classified?.kind === 'Vector2' || classified?.kind === 'Vector3')
  ) {
    return classified.value[property];
  }
  if ((property === 'x' || property === 'y') && classified?.kind === 'Transform2D') {
    return vec2(classified.value[property].x, classified.value[property].y);
  }
  if (property === 'z' && classified?.kind === 'Vector3') return classified.value.z;
  if (property === 'origin' && classified?.kind === 'Transform2D') {
    return vec2(classified.value.origin.x, classified.value.origin.y);
  }
  if (property === 'origin' && classified?.kind === 'Transform3D') {
    return vec3(classified.value.origin.x, classified.value.origin.y, classified.value.origin.z);
  }
  if (property === 'basis' && classified?.kind === 'Transform3D') {
    return basisFromColumns(
      classified.value.basis[0],
      classified.value.basis[1],
      classified.value.basis[2],
    );
  }
  return refused(property, receiver);
}

/** Rebuild a value after a component/property write; the caller writes the returned whole value. */
export function godotVariantWithValueProperty(
  receiver: unknown,
  property: VariantValueProperty,
  value: unknown,
): VariantValue {
  const classified = classifyValue(receiver);
  if (classified?.kind === 'Vector2' && (property === 'x' || property === 'y')) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return refused(property, value);
    const scalar = value;
    return vec2(
      property === 'x' ? scalar : classified.value.x,
      property === 'y' ? scalar : classified.value.y,
    );
  }
  if (classified?.kind === 'Vector3' && (property === 'x' || property === 'y' || property === 'z')) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return refused(property, value);
    const scalar = value;
    return vec3(
      property === 'x' ? scalar : classified.value.x,
      property === 'y' ? scalar : classified.value.y,
      property === 'z' ? scalar : classified.value.z,
    );
  }
  if (classified?.kind === 'Transform2D' && (property === 'x' || property === 'y') && finite2(value)) {
    return godotTransform2DNew(
      property === 'x' ? value : classified.value.x,
      property === 'y' ? value : classified.value.y,
      classified.value.origin,
    );
  }
  if (classified?.kind === 'Transform2D' && property === 'origin' && finite2(value)) {
    return godotTransform2DNew(classified.value.x, classified.value.y, value);
  }
  if (classified?.kind === 'Transform3D' && property === 'origin' && finite3(value)) {
    return transform3(classified.value.basis, value);
  }
  if (classified?.kind === 'Transform3D' && property === 'basis' && basisValue(value)) {
    return transform3(value, classified.value.origin);
  }
  return refused(property, receiver);
}
