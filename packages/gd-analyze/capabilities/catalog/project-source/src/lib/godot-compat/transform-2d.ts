import type { PointData } from 'pixi.js';
import { godotRect2Call, godotRect2New, type GodotRect2 } from './rect2';

export interface GodotTransform2D {
  x: PointData;
  y: PointData;
  origin: PointData;
}

const vector = (x = 0, y = 0): PointData => ({ x, y });
const copyVector = (v: Readonly<PointData>): PointData => vector(v.x, v.y);
const length = (v: Readonly<PointData>): number => Math.hypot(v.x, v.y);
const dot = (a: Readonly<PointData>, b: Readonly<PointData>): number => a.x * b.x + a.y * b.y;
const normalized = (v: Readonly<PointData>): PointData => {
  const magnitude = length(v);
  return magnitude === 0 ? copyVector(v) : vector(v.x / magnitude, v.y / magnitude);
};

const makeTransform = (
  x: Readonly<PointData>,
  y: Readonly<PointData>,
  origin: Readonly<PointData>,
): GodotTransform2D => {
  return {
    x: copyVector(x),
    y: copyVector(y),
    origin: copyVector(origin),
  };
};

export const TRANSFORM2D_IDENTITY: GodotTransform2D = Object.freeze(
  makeTransform(vector(1, 0), vector(0, 1), vector()),
);
export const TRANSFORM2D_FLIP_X: GodotTransform2D = Object.freeze(
  makeTransform(vector(-1, 0), vector(0, 1), vector()),
);
export const TRANSFORM2D_FLIP_Y: GodotTransform2D = Object.freeze(
  makeTransform(vector(1, 0), vector(0, -1), vector()),
);

export function godotTransform2DNew(...args: unknown[]): GodotTransform2D {
  if (args.length === 0)
    return makeTransform(
      TRANSFORM2D_IDENTITY.x,
      TRANSFORM2D_IDENTITY.y,
      TRANSFORM2D_IDENTITY.origin,
    );
  if (args.length === 1) {
    const from = args[0] as GodotTransform2D;
    return makeTransform(from.x, from.y, from.origin);
  }
  if (args.length === 2) {
    const rotation = Number(args[0]);
    const c = Math.cos(rotation),
      s = Math.sin(rotation);
    return makeTransform(vector(c, s), vector(-s, c), args[1] as PointData);
  }
  if (args.length === 3)
    return makeTransform(args[0] as PointData, args[1] as PointData, args[2] as PointData);
  if (args.length === 4) {
    const rotation = Number(args[0]),
      scale = args[1] as PointData,
      skew = Number(args[2]);
    return makeTransform(
      vector(Math.cos(rotation) * scale.x, Math.sin(rotation) * scale.x),
      vector(-Math.sin(rotation + skew) * scale.y, Math.cos(rotation + skew) * scale.y),
      args[3] as PointData,
    );
  }
  throw new Error(`godot-compat: unsupported Transform2D constructor arity ${args.length}`);
}

/** Historical helper used by CanvasItem runtime services. */
export function transform2DFromOrigin(origin: Readonly<PointData>): GodotTransform2D {
  return godotTransform2DNew(0, origin);
}

export const transform2DDeterminant = (value: GodotTransform2D): number =>
  value.x.x * value.y.y - value.x.y * value.y.x;

export function transform2DScale(value: GodotTransform2D): PointData {
  return vector(length(value.x), Math.sign(transform2DDeterminant(value)) * length(value.y));
}

export function transform2DBasisXform(
  value: GodotTransform2D,
  point: Readonly<PointData>,
): PointData {
  return vector(
    value.x.x * point.x + value.y.x * point.y,
    value.x.y * point.x + value.y.y * point.y,
  );
}

function transform2DBasisXformInv(value: GodotTransform2D, point: Readonly<PointData>): PointData {
  return vector(dot(value.x, point), dot(value.y, point));
}

export function transform2DXform(value: GodotTransform2D, point: Readonly<PointData>): PointData {
  const basis = transform2DBasisXform(value, point);
  return vector(basis.x + value.origin.x, basis.y + value.origin.y);
}

export function transform2DXformInv(value: GodotTransform2D, point: Readonly<PointData>): PointData {
  return transform2DBasisXformInv(
    value,
    vector(point.x - value.origin.x, point.y - value.origin.y),
  );
}

function transformRect(value: GodotTransform2D, rect: GodotRect2): GodotRect2 {
  const x = vector(value.x.x * rect.size.x, value.x.y * rect.size.x);
  const y = vector(value.y.x * rect.size.y, value.y.y * rect.size.y);
  const position = transform2DXform(value, rect.position);
  let result = godotRect2New(position, vector());
  result = godotRect2Call(result, 'expand', [
    vector(position.x + x.x, position.y + x.y),
  ]) as GodotRect2;
  result = godotRect2Call(result, 'expand', [
    vector(position.x + y.x, position.y + y.y),
  ]) as GodotRect2;
  return godotRect2Call(result, 'expand', [
    vector(position.x + x.x + y.x, position.y + x.y + y.y),
  ]) as GodotRect2;
}

function transformRectInverse(value: GodotTransform2D, rect: GodotRect2): GodotRect2 {
  const points = [
    rect.position,
    vector(rect.position.x, rect.end.y),
    rect.end,
    vector(rect.end.x, rect.position.y),
  ].map((p) => transform2DXformInv(value, p));
  let result = godotRect2New(points[0], vector());
  for (const point of points.slice(1))
    result = godotRect2Call(result, 'expand', [point]) as GodotRect2;
  return result;
}

function transformMultiply(a: GodotTransform2D, b: GodotTransform2D): GodotTransform2D {
  return makeTransform(
    transform2DBasisXform(a, b.x),
    transform2DBasisXform(a, b.y),
    transform2DXform(a, b.origin),
  );
}

function rotationTransform(angle: number): GodotTransform2D {
  return godotTransform2DNew(angle, vector());
}

function equalVector(a: Readonly<PointData>, b: Readonly<PointData>): boolean {
  return a.x === b.x && a.y === b.y;
}
function equalTransform(a: GodotTransform2D, b: unknown): boolean {
  if (typeof b !== 'object' || b === null || !('x' in b) || !('y' in b) || !('origin' in b))
    return false;
  const other = b as GodotTransform2D;
  return (
    equalVector(a.x, other.x) && equalVector(a.y, other.y) && equalVector(a.origin, other.origin)
  );
}
function approx(a: number, b: number): boolean {
  if (a === b) return true;
  return Math.abs(a - b) < Math.max(0.00001, 0.00001 * Math.abs(a));
}
function approxVector(a: Readonly<PointData>, b: Readonly<PointData>): boolean {
  return approx(a.x, b.x) && approx(a.y, b.y);
}
function lerpAngle(from: number, to: number, weight: number): number {
  const difference =
    ((((to - from + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
  return from + difference * weight;
}

function inverse(value: GodotTransform2D): GodotTransform2D {
  const basis = makeTransform(vector(value.x.x, value.y.x), vector(value.x.y, value.y.y), vector());
  const origin = transform2DBasisXform(basis, vector(-value.origin.x, -value.origin.y));
  basis.origin = origin;
  return basis;
}

function affineInverse(value: GodotTransform2D): GodotTransform2D {
  const det = transform2DDeterminant(value);
  if (det === 0) return godotTransform2DNew(value);
  const result = makeTransform(
    vector(value.y.y / det, -value.x.y / det),
    vector(-value.y.x / det, value.x.x / det),
    vector(),
  );
  result.origin = transform2DBasisXform(result, vector(-value.origin.x, -value.origin.y));
  return result;
}

export function godotTransform2DCall(
  receiver: GodotTransform2D,
  method: 'get_scale' | 'get_origin',
  args: readonly unknown[],
): PointData;
export function godotTransform2DCall(
  receiver: GodotTransform2D,
  method: 'inverse' | 'affine_inverse',
  args: readonly unknown[],
): GodotTransform2D;
export function godotTransform2DCall(
  receiver: GodotTransform2D,
  method: 'get_rotation' | 'get_skew' | 'determinant',
  args: readonly unknown[],
): number;
export function godotTransform2DCall<T = unknown>(
  receiver: GodotTransform2D,
  method: string,
  args: readonly unknown[],
): T;
export function godotTransform2DCall(
  receiver: GodotTransform2D,
  method: string,
  args: readonly unknown[],
): unknown {
  switch (method) {
    case 'inverse':
      return inverse(receiver);
    case 'affine_inverse':
      return affineInverse(receiver);
    case 'get_rotation':
      return Math.atan2(receiver.x.y, receiver.x.x);
    case 'get_origin':
      return copyVector(receiver.origin);
    case 'get_scale':
      return transform2DScale(receiver);
    case 'get_skew':
      return (
        Math.acos(
          dot(normalized(receiver.x), normalized(receiver.y)) *
            Math.sign(transform2DDeterminant(receiver)),
        ) -
        Math.PI * 0.5
      );
    case 'orthonormalized': {
      const x = normalized(receiver.x);
      const projection = dot(x, receiver.y);
      const y = normalized(
        vector(receiver.y.x - x.x * projection, receiver.y.y - x.y * projection),
      );
      return makeTransform(x, y, receiver.origin);
    }
    case 'rotated':
      return transformMultiply(rotationTransform(Number(args[0])), receiver);
    case 'rotated_local':
      return transformMultiply(receiver, rotationTransform(Number(args[0])));
    case 'scaled': {
      const scale = args[0] as PointData;
      return makeTransform(
        vector(receiver.x.x * scale.x, receiver.x.y * scale.y),
        vector(receiver.y.x * scale.x, receiver.y.y * scale.y),
        vector(receiver.origin.x * scale.x, receiver.origin.y * scale.y),
      );
    }
    case 'scaled_local': {
      const scale = args[0] as PointData;
      return makeTransform(
        vector(receiver.x.x * scale.x, receiver.x.y * scale.x),
        vector(receiver.y.x * scale.y, receiver.y.y * scale.y),
        receiver.origin,
      );
    }
    case 'translated': {
      const offset = args[0] as PointData;
      return makeTransform(
        receiver.x,
        receiver.y,
        vector(receiver.origin.x + offset.x, receiver.origin.y + offset.y),
      );
    }
    case 'translated_local': {
      const offset = transform2DBasisXform(receiver, args[0] as PointData);
      return makeTransform(
        receiver.x,
        receiver.y,
        vector(receiver.origin.x + offset.x, receiver.origin.y + offset.y),
      );
    }
    case 'determinant':
      return transform2DDeterminant(receiver);
    case 'basis_xform':
      return transform2DBasisXform(receiver, args[0] as PointData);
    case 'basis_xform_inv':
      return transform2DBasisXformInv(receiver, args[0] as PointData);
    case 'xform':
      return transform2DXform(receiver, args[0] as PointData);
    case 'xform_inv':
      return transform2DXformInv(receiver, args[0] as PointData);
    case 'interpolate_with': {
      const other = args[0] as GodotTransform2D,
        weight = Number(args[1]);
      const scale = transform2DScale(receiver),
        otherScale = transform2DScale(other);
      const origin = vector(
        receiver.origin.x + (other.origin.x - receiver.origin.x) * weight,
        receiver.origin.y + (other.origin.y - receiver.origin.y) * weight,
      );
      return godotTransform2DNew(
        lerpAngle(Math.atan2(receiver.x.y, receiver.x.x), Math.atan2(other.x.y, other.x.x), weight),
        vector(
          scale.x + (otherScale.x - scale.x) * weight,
          scale.y + (otherScale.y - scale.y) * weight,
        ),
        lerpAngle(
          godotTransform2DCall(receiver, 'get_skew', []) as number,
          godotTransform2DCall(other, 'get_skew', []) as number,
          weight,
        ),
        origin,
      );
    }
    case 'is_conformal':
      return (
        (approx(receiver.x.x, receiver.y.y) && approx(receiver.x.y, -receiver.y.x)) ||
        (approx(receiver.x.x, -receiver.y.y) && approx(receiver.x.y, receiver.y.x))
      );
    case 'is_equal_approx': {
      const other = args[0] as GodotTransform2D;
      return (
        approxVector(receiver.x, other.x) &&
        approxVector(receiver.y, other.y) &&
        approxVector(receiver.origin, other.origin)
      );
    }
    case 'is_finite':
      return [
        receiver.x.x,
        receiver.x.y,
        receiver.y.x,
        receiver.y.y,
        receiver.origin.x,
        receiver.origin.y,
      ].every(Number.isFinite);
    case 'looking_at': {
      const target = (args[0] ?? vector()) as PointData;
      const base = godotTransform2DNew(Math.atan2(receiver.x.y, receiver.x.x), receiver.origin);
      const local = transform2DXform(affineInverse(receiver), target);
      const scale = transform2DScale(receiver);
      const angle = Math.atan2(local.y * scale.y, local.x * scale.x);
      return godotTransform2DNew(
        (godotTransform2DCall(base, 'get_rotation', []) as number) + angle,
        base.origin,
      );
    }
    default:
      throw new Error(`godot-compat: unsupported Transform2D.${method}`);
  }
}

function containsValue(left: GodotTransform2D, right: unknown): boolean {
  if (Array.isArray(right)) return right.some((entry) => equalTransform(left, entry));
  if (right instanceof Map) return [...right.keys()].some((entry) => equalTransform(left, entry));
  return typeof right === 'object' && right !== null && Object.hasOwn(right, String(left));
}

export function godotTransform2DOperator(
  operator: string,
  left: GodotTransform2D,
  right: unknown,
): unknown {
  switch (operator) {
    case '==':
      return equalTransform(left, right);
    case '!=':
      return !equalTransform(left, right);
    case 'not':
      return equalTransform(left, TRANSFORM2D_IDENTITY);
    case 'in':
      return containsValue(left, right);
    case '*':
      if (typeof right === 'number')
        return makeTransform(
          vector(left.x.x * right, left.x.y * right),
          vector(left.y.x * right, left.y.y * right),
          vector(left.origin.x * right, left.origin.y * right),
        );
      if (Array.isArray(right))
        return right.map((point) => transform2DXform(left, point as PointData));
      if (typeof right === 'object' && right !== null && 'position' in right && 'size' in right)
        return transformRect(left, right as GodotRect2);
      if (typeof right === 'object' && right !== null && 'origin' in right)
        return transformMultiply(left, right as GodotTransform2D);
      return transform2DXform(left, right as PointData);
    case '/': {
      const scalar = Number(right);
      return makeTransform(
        vector(left.x.x / scalar, left.x.y / scalar),
        vector(left.y.x / scalar, left.y.y / scalar),
        vector(left.origin.x / scalar, left.origin.y / scalar),
      );
    }
    default:
      throw new Error(`godot-compat: unsupported Transform2D operator ${operator}`);
  }
}

export function godotRect2TransformInverse(
  rect: GodotRect2,
  transform: GodotTransform2D,
): GodotRect2 {
  return transformRectInverse(transform, rect);
}
