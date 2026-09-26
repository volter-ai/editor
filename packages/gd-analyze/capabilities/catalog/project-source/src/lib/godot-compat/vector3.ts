/** Complete Godot 4.7 Vector3 protocol, derived from `core/math/vector3.{h,cpp}`. */

import { type Vector2, vec2 } from './vector2';
import {
  cross3,
  dot3,
  equals3,
  length3,
  lerp3,
  limitLength3,
  normalized3,
  rotated3,
  type Vector3,
  vec3,
} from './variant-3d';

type BasisLike = readonly [Vector3, Vector3, Vector3];
type TransformLike = Readonly<{ basis: BasisLike; origin: Vector3 }>;
type QuaternionLike = Readonly<{ x: number; y: number; z: number; w: number }>;
const CMP_EPSILON = 0.00001;
const UNIT_EPSILON = 0.001;
const godotMin = (a: number, b: number): number => (a < b ? a : b);
const godotMax = (a: number, b: number): number => (a > b ? a : b);
const godotClamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;
const godotSign = (value: number): number => (value > 0 ? 1 : value < 0 ? -1 : 0);

export const VECTOR3_AXIS = Object.freeze({ AXIS_X: 0, AXIS_Y: 1, AXIS_Z: 2 });
export const VECTOR3_INF = vec3(Infinity, Infinity, Infinity);
export const VECTOR3_LEFT = vec3(-1, 0, 0);
export const VECTOR3_RIGHT = vec3(1, 0, 0);
export const VECTOR3_DOWN = vec3(0, -1, 0);
export const VECTOR3_BACK = vec3(0, 0, 1);
export const VECTOR3_MODEL_LEFT = vec3(1, 0, 0);
export const VECTOR3_MODEL_RIGHT = vec3(-1, 0, 0);
export const VECTOR3_MODEL_TOP = vec3(0, 1, 0);
export const VECTOR3_MODEL_BOTTOM = vec3(0, -1, 0);
export const VECTOR3_MODEL_FRONT = vec3(0, 0, 1);
export const VECTOR3_MODEL_REAR = vec3(0, 0, -1);

const components = (v: Vector3): readonly [number, number, number] => [v.x, v.y, v.z];
const map = (v: Vector3, fn: (n: number, axis: number) => number): Vector3 =>
  vec3(fn(v.x, 0), fn(v.y, 1), fn(v.z, 2));
const zip = (a: Vector3, b: Vector3, fn: (x: number, y: number, axis: number) => number): Vector3 =>
  vec3(fn(a.x, b.x, 0), fn(a.y, b.y, 1), fn(a.z, b.z, 2));
const lengthSquared = (v: Vector3): number => dot3(v, v);
const approx = (a: number, b: number, tolerance?: number): boolean => {
  if (a === b) return true;
  const limit = tolerance ?? Math.max(CMP_EPSILON * Math.abs(a), CMP_EPSILON);
  return Math.abs(a - b) < limit;
};
const fposmod = (value: number, mod: number): number => {
  let result = value % mod;
  if ((result < 0 && mod > 0) || (result > 0 && mod < 0)) result += mod;
  return result + 0;
};
const snapped = (value: number, step: number): number =>
  step === 0 ? value : Math.floor(value / step + 0.5) * step;
const rounded = (value: number): number =>
  value < 0 ? Math.ceil(value - 0.5) : Math.floor(value + 0.5);
const cubic = (a: number, b: number, pre: number, post: number, t: number): number =>
  0.5 *
  (2 * a +
    (-pre + b) * t +
    (2 * pre - 5 * a + 4 * b - post) * t ** 2 +
    (-pre + 3 * a - 3 * b + post) * t ** 3);
const cubicTime = (
  a: number,
  b: number,
  pre: number,
  post: number,
  t: number,
  bt: number,
  pret: number,
  postt: number,
): number => {
  const time = bt * t;
  const lerp = (x: number, y: number, w: number): number => x + (y - x) * w;
  const a1 = lerp(pre, a, pret === 0 ? 0 : (time - pret) / -pret);
  const a2 = lerp(a, b, bt === 0 ? 0.5 : time / bt);
  const a3 = lerp(b, post, postt === bt ? 1 : (time - bt) / (postt - bt));
  const b1 = lerp(a1, a2, bt === pret ? 0 : (time - pret) / (bt - pret));
  const b2 = lerp(a2, a3, postt === 0 ? 1 : time / postt);
  return lerp(b1, b2, bt === 0 ? 0.5 : time / bt);
};
const bezier = (a: number, c1: number, c2: number, end: number, t: number): number => {
  const u = 1 - t;
  return u ** 3 * a + 3 * u ** 2 * t * c1 + 3 * u * t ** 2 * c2 + t ** 3 * end;
};
const bezierDerivative = (a: number, c1: number, c2: number, end: number, t: number): number => {
  const u = 1 - t;
  return 3 * u ** 2 * (c1 - a) + 6 * u * t * (c2 - c1) + 3 * t ** 2 * (end - c2);
};

export function godotVector3OctahedronDecode(uv: Vector2): Vector3 {
  const x = uv.x * 2 - 1;
  const y = uv.y * 2 - 1;
  const z = 1 - Math.abs(x) - Math.abs(y);
  const t = godotClamp(-z, 0, 1);
  return normalized3(vec3(x + (x >= 0 ? -t : t), y + (y >= 0 ? -t : t), z));
}

export function godotVector3Call<T = unknown>(
  method: string,
  value: Vector3,
  args: readonly unknown[],
): T;
export function godotVector3Call(
  method: string,
  value: Vector3,
  args: readonly unknown[],
): unknown {
  const v = (i: number): Vector3 => args[i] as Vector3;
  const n = (i: number): number => Number(args[i]);
  switch (method) {
    case 'min_axis_index': {
      const c = components(value);
      return c[0] < c[1] ? (c[0] < c[2] ? 0 : 2) : c[1] < c[2] ? 1 : 2;
    }
    case 'max_axis_index': {
      const c = components(value);
      return c[0] < c[1] ? (c[1] < c[2] ? 2 : 1) : c[0] < c[2] ? 2 : 0;
    }
    case 'angle_to':
      return Math.atan2(length3(cross3(value, v(0))), dot3(value, v(0)));
    case 'signed_angle_to': {
      const cross = cross3(value, v(0));
      const angle = Math.atan2(length3(cross), dot3(value, v(0)));
      return dot3(cross, v(1)) < 0 ? -angle : angle;
    }
    case 'direction_to':
      return normalized3(zip(v(0), value, (to, from) => to - from));
    case 'distance_squared_to':
      return lengthSquared(zip(v(0), value, (to, from) => to - from));
    case 'distance_to':
      return length3(zip(v(0), value, (to, from) => to - from));
    case 'length':
      return length3(value);
    case 'length_squared':
      return lengthSquared(value);
    case 'limit_length':
      return limitLength3(value, args.length === 0 ? 1 : n(0));
    case 'normalized':
      return normalized3(value);
    case 'is_normalized':
      return approx(lengthSquared(value), 1, UNIT_EPSILON);
    case 'is_equal_approx':
      return components(value).every((x, i) => approx(x, components(v(0))[i]!));
    case 'is_zero_approx':
      return components(value).every((x) => Math.abs(x) < CMP_EPSILON);
    case 'is_finite':
      return components(value).every(Number.isFinite);
    case 'inverse':
      return map(value, (x) => 1 / x);
    case 'clamp':
      return zip(value, v(0), (x, min, i) => godotClamp(x, min, components(v(1))[i]!));
    case 'clampf':
      return map(value, (x) => godotClamp(x, n(0), n(1)));
    case 'snapped':
      return zip(value, v(0), snapped);
    case 'snappedf':
      return map(value, (x) => snapped(x, n(0)));
    case 'rotated':
      return rotated3(value, v(0), n(1));
    case 'lerp':
      return lerp3(value, v(0), n(1));
    case 'slerp': {
      const to = v(0);
      const startSq = lengthSquared(value);
      const endSq = lengthSquared(to);
      if (startSq === 0 || endSq === 0) return lerp3(value, to, n(1));
      const axis = cross3(value, to);
      const axisSq = lengthSquared(axis);
      if (axisSq === 0) return lerp3(value, to, n(1));
      const start = Math.sqrt(startSq);
      const resultLength = start + (Math.sqrt(endSq) - start) * n(1);
      const angle = Math.atan2(Math.sqrt(axisSq), dot3(value, to));
      return map(
        rotated3(
          value,
          map(axis, (x) => x / Math.sqrt(axisSq)),
          angle * n(1),
        ),
        (x) => x * (resultLength / start),
      );
    }
    case 'cubic_interpolate':
      return map(value, (x, i) =>
        cubic(x, components(v(0))[i]!, components(v(1))[i]!, components(v(2))[i]!, n(3)),
      );
    case 'cubic_interpolate_in_time':
      return map(value, (x, i) =>
        cubicTime(
          x,
          components(v(0))[i]!,
          components(v(1))[i]!,
          components(v(2))[i]!,
          n(3),
          n(4),
          n(5),
          n(6),
        ),
      );
    case 'bezier_interpolate':
      return map(value, (x, i) =>
        bezier(x, components(v(0))[i]!, components(v(1))[i]!, components(v(2))[i]!, n(3)),
      );
    case 'bezier_derivative':
      return map(value, (x, i) =>
        bezierDerivative(x, components(v(0))[i]!, components(v(1))[i]!, components(v(2))[i]!, n(3)),
      );
    case 'move_toward': {
      const delta = zip(v(0), value, (to, from) => to - from);
      const len = length3(delta);
      return len <= n(1) || len < CMP_EPSILON
        ? v(0)
        : zip(value, delta, (x, d) => x + (d / len) * n(1));
    }
    case 'dot':
      return dot3(value, v(0));
    case 'cross':
      return cross3(value, v(0));
    case 'outer': {
      const other = v(0);
      return Object.freeze([
        vec3(value.x * other.x, value.y * other.x, value.z * other.x),
        vec3(value.x * other.y, value.y * other.y, value.z * other.y),
        vec3(value.x * other.z, value.y * other.z, value.z * other.z),
      ]) as BasisLike;
    }
    case 'abs':
      return map(value, Math.abs);
    case 'floor':
      return map(value, Math.floor);
    case 'ceil':
      return map(value, Math.ceil);
    case 'round':
      return map(value, rounded);
    case 'posmod':
      return map(value, (x) => fposmod(x, n(0)));
    case 'posmodv':
      return zip(value, v(0), fposmod);
    case 'project':
      return map(v(0), (x) => x * (dot3(value, v(0)) / lengthSquared(v(0))));
    case 'slide':
      return zip(value, v(0), (x, normal) => x - normal * dot3(value, v(0)));
    case 'reflect':
      return zip(v(0), value, (normal, x) => 2 * normal * dot3(value, v(0)) - x);
    case 'bounce':
      return map(godotVector3Call('reflect', value, args) as Vector3, (x) => -x);
    case 'sign':
      return map(value, godotSign);
    case 'octahedron_encode': {
      const scale = Math.abs(value.x) + Math.abs(value.y) + Math.abs(value.z);
      const unit = map(value, (x) => x / scale);
      const x = unit.z >= 0 ? unit.x : (1 - Math.abs(unit.y)) * (unit.x >= 0 ? 1 : -1);
      const y = unit.z >= 0 ? unit.y : (1 - Math.abs(unit.x)) * (unit.y >= 0 ? 1 : -1);
      return vec2(x * 0.5 + 0.5, y * 0.5 + 0.5);
    }
    case 'octahedron_decode': {
      return godotVector3OctahedronDecode(args[0] as Vector2);
    }
    case 'min':
      return zip(value, v(0), godotMin);
    case 'minf':
      return map(value, (x) => godotMin(x, n(0)));
    case 'max':
      return zip(value, v(0), godotMax);
    case 'maxf':
      return map(value, (x) => godotMax(x, n(0)));
    default:
      throw new Error(`godot-compat: unsupported Vector3.${method}`);
  }
}

const less = (a: Vector3, b: Vector3): boolean =>
  a.x === b.x ? (a.y === b.y ? a.z < b.z : a.y < b.y) : a.x < b.x;
const lessEqual = (a: Vector3, b: Vector3): boolean =>
  a.x === b.x ? (a.y === b.y ? a.z <= b.z : a.y < b.y) : a.x < b.x;
const greater = (a: Vector3, b: Vector3): boolean =>
  a.x === b.x ? (a.y === b.y ? a.z > b.z : a.y > b.y) : a.x > b.x;
const greaterEqual = (a: Vector3, b: Vector3): boolean =>
  a.x === b.x ? (a.y === b.y ? a.z >= b.z : a.y > b.y) : a.x > b.x;

const basisXform = (basis: BasisLike, value: Vector3): Vector3 =>
  vec3(
    basis[0].x * value.x + basis[1].x * value.y + basis[2].x * value.z,
    basis[0].y * value.x + basis[1].y * value.y + basis[2].y * value.z,
    basis[0].z * value.x + basis[1].z * value.y + basis[2].z * value.z,
  );
const basisXformInverse = (value: Vector3, basis: BasisLike): Vector3 =>
  vec3(dot3(basis[0], value), dot3(basis[1], value), dot3(basis[2], value));
const quaternionXform = (quaternion: QuaternionLike, value: Vector3): Vector3 => {
  const axis = vec3(quaternion.x, quaternion.y, quaternion.z);
  const uv = cross3(axis, value);
  const uuv = cross3(axis, uv);
  return zip(
    value,
    zip(uv, uuv, (a, b) => 2 * (a * quaternion.w + b)),
    (a, b) => a + b,
  );
};
const quaternionInverseXform = (value: Vector3, quaternion: QuaternionLike): Vector3 =>
  quaternionXform({ x: -quaternion.x, y: -quaternion.y, z: -quaternion.z, w: quaternion.w }, value);
const isTransform = (value: unknown): value is TransformLike =>
  typeof value === 'object' && value !== null && Array.isArray(Reflect.get(value, 'basis'));
const isQuaternion = (value: unknown): value is QuaternionLike =>
  typeof value === 'object' && value !== null && typeof Reflect.get(value, 'w') === 'number';

export function godotVector3LeftMultiply(left: unknown, value: Vector3): Vector3 {
  if (Array.isArray(left)) return basisXform(left as unknown as BasisLike, value);
  if (isTransform(left)) return zip(basisXform(left.basis, value), left.origin, (a, b) => a + b);
  if (isQuaternion(left)) return quaternionXform(left, value);
  return map(value, (x) => x * Number(left));
}

export function godotVector3Operator(
  operator: '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in',
  left: Vector3,
  right: unknown,
): boolean;
export function godotVector3Operator(
  operator: '+' | '-' | '*' | '/',
  left: Vector3,
  right: unknown,
): Vector3;
export function godotVector3Operator(operator: string, left: Vector3, right: unknown): unknown;
export function godotVector3Operator(operator: string, left: Vector3, right: unknown): unknown {
  const vector = right as Vector3;
  switch (operator) {
    case '==':
      return typeof right === 'object' && right !== null && equals3(left, vector);
    case '!=':
      return !(typeof right === 'object' && right !== null && equals3(left, vector));
    case '+':
      return zip(left, vector, (a, b) => a + b);
    case '-':
      return zip(left, vector, (a, b) => a - b);
    case '*':
      if (typeof right === 'number') return map(left, (x) => x * right);
      if (Array.isArray(right)) return basisXformInverse(left, right as unknown as BasisLike);
      if (isTransform(right))
        return basisXformInverse(
          zip(left, right.origin, (a, b) => a - b),
          right.basis,
        );
      if (isQuaternion(right)) return quaternionInverseXform(left, right);
      return zip(left, vector, (a, b) => a * b);
    case '/':
      return typeof right === 'number'
        ? map(left, (x) => x / right)
        : zip(left, vector, (a, b) => a / b);
    case '<':
      return less(left, vector);
    case '<=':
      return lessEqual(left, vector);
    case '>':
      return greater(left, vector);
    case '>=':
      return greaterEqual(left, vector);
    case 'in':
      if (Array.isArray(right))
        return right.some(
          (entry) => typeof entry === 'object' && entry !== null && equals3(left, entry as Vector3),
        );
      if (right instanceof Map)
        return [...right.keys()].some(
          (entry) => typeof entry === 'object' && entry !== null && equals3(left, entry as Vector3),
        );
      return false;
    default:
      throw new Error(`godot-compat: unsupported Vector3 operator ${operator}`);
  }
}

export const godotVector3Not = (value: Vector3): boolean => equals3(value, vec3(0, 0, 0));
export const godotVector3Positive = (value: Vector3): Vector3 => vec3(value.x, value.y, value.z);
