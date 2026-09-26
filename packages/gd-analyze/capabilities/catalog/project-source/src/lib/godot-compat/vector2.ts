/** Godot 4.7 Vector2 value protocol, ported from `core/math/vector2.{h,cpp}`. */

/** A mutable value record: component writes are legal, while bindings copy through `copyVector2`. */
export interface Vector2 {
  x: number;
  y: number;
}

/** Structural shape of the Transform2D operand accepted by `Vector2 * Transform2D`. */
export interface GodotTransform2DLike {
  readonly x: Vector2;
  readonly y: Vector2;
  readonly origin: Vector2;
}

const CMP_EPSILON = 0.00001;
const UNIT_EPSILON = 0.001;

export function vec2(x = 0, y = 0): Vector2 {
  return { x, y };
}

export function godotVector2New(...args: readonly unknown[]): Vector2 {
  if (args.length === 0) return vec2();
  if (args.length === 1) return copyVector2(args[0] as Vector2);
  return vec2(Number(args[0]), Number(args[1]));
}

const integerComponent = (value: unknown, member: string): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new TypeError(`godot-compat: ${member} requires finite numeric components.`);
  }
  return Math.trunc(numeric);
};

/**
 * Godot 4's complete `Vector2i` constructor family: zero, a value-copy/conversion from Vector2 or
 * Vector2i, and two integer components. The conversion truncates each float toward zero, matching
 * `Vector2i(const Vector2&)`; every form returns a fresh value rather than aliasing its input.
 */
export function godotVector2iNew(...args: readonly unknown[]): Vector2 {
  if (args.length === 0) return vec2();
  if (args.length === 1) {
    const value = args[0];
    if (typeof value !== 'object' || value === null) {
      throw new TypeError('godot-compat: Vector2i(value) requires a Vector2/Vector2i value.');
    }
    return vec2(
      integerComponent(Reflect.get(value, 'x'), 'Vector2i'),
      integerComponent(Reflect.get(value, 'y'), 'Vector2i'),
    );
  }
  if (args.length !== 2) {
    throw new TypeError(`godot-compat: Vector2i accepts 0, 1, or 2 arguments; received ${args.length}.`);
  }
  return vec2(
    integerComponent(args[0], 'Vector2i'),
    integerComponent(args[1], 'Vector2i'),
  );
}

/** Godot Vector2 assignment is a value copy, never an alias to the source record. */
export function copyVector2(value: Readonly<Vector2>): Vector2 {
  return vec2(value.x, value.y);
}

export const VECTOR2_ZERO: Vector2 = Object.freeze(vec2());
/** Godot 4 Vector2i.ZERO; distinct exported identity with integer-valued components. */
export const VECTOR2I_ZERO: Vector2 = Object.freeze(vec2(0, 0));
/** Godot 4 Vector2i.ONE. */
export const VECTOR2I_ONE: Vector2 = Object.freeze(vec2(1, 1));
/** Godot 4 integer direction constants, with the same screen-space axes as Vector2. */
export const VECTOR2I_LEFT: Vector2 = Object.freeze(vec2(-1, 0));
export const VECTOR2I_RIGHT: Vector2 = Object.freeze(vec2(1, 0));
export const VECTOR2I_UP: Vector2 = Object.freeze(vec2(0, -1));
export const VECTOR2I_DOWN: Vector2 = Object.freeze(vec2(0, 1));
export const VECTOR2_ONE: Vector2 = Object.freeze(vec2(1, 1));
export const VECTOR2_INF: Vector2 = Object.freeze(
  vec2(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY),
);
export const VECTOR2_LEFT: Vector2 = Object.freeze(vec2(-1, 0));
export const VECTOR2_RIGHT: Vector2 = Object.freeze(vec2(1, 0));
export const VECTOR2_UP: Vector2 = Object.freeze(vec2(0, -1));
export const VECTOR2_DOWN: Vector2 = Object.freeze(vec2(0, 1));
export const VECTOR2_AXIS = Object.freeze({ AXIS_X: 0, AXIS_Y: 1 });

const zip = (
  left: Readonly<Vector2>,
  right: Readonly<Vector2>,
  fn: (a: number, b: number) => number,
): Vector2 => vec2(fn(left.x, right.x), fn(left.y, right.y));
const map = (value: Readonly<Vector2>, fn: (component: number) => number): Vector2 =>
  vec2(fn(value.x), fn(value.y));
const scalarLerp = (from: number, to: number, weight: number): number =>
  from + (to - from) * weight;
const minimum = (left: number, right: number): number => (left < right ? left : right);
const maximum = (left: number, right: number): number => (left > right ? left : right);
const clampScalar = (value: number, lower: number, upper: number): number =>
  value < lower ? lower : value > upper ? upper : value;
const signScalar = (value: number): number => (value > 0 ? 1 : value < 0 ? -1 : 0);
const roundScalar = (value: number): number =>
  value < 0 ? Math.ceil(value - 0.5) : Math.floor(value + 0.5);
const fposmod = (value: number, modulus: number): number => {
  let result = value % modulus;
  if ((result < 0 && modulus > 0) || (result > 0 && modulus < 0)) result += modulus;
  return result + 0;
};
const snappedScalar = (value: number, step: number): number =>
  step === 0 ? value : Math.floor(value / step + 0.5) * step;
const approx = (left: number, right: number, tolerance?: number): boolean => {
  if (left === right) return true;
  const limit = tolerance ?? maximum(CMP_EPSILON * Math.abs(left), CMP_EPSILON);
  return Math.abs(left - right) < limit;
};
const cubic = (a: number, b: number, preA: number, postB: number, weight: number): number =>
  0.5 *
  (a * 2 +
    (-preA + b) * weight +
    (2 * preA - 5 * a + 4 * b - postB) * weight ** 2 +
    (-preA + 3 * a - 3 * b + postB) * weight ** 3);
const cubicTime = (
  a: number,
  b: number,
  preA: number,
  postB: number,
  weight: number,
  bTime: number,
  preATime: number,
  postBTime: number,
): number => {
  const time = scalarLerp(0, bTime, weight);
  const a1 = scalarLerp(preA, a, preATime === 0 ? 0 : (time - preATime) / -preATime);
  const a2 = scalarLerp(a, b, bTime === 0 ? 0.5 : time / bTime);
  const a3 = scalarLerp(
    b,
    postB,
    postBTime - bTime === 0 ? 1 : (time - bTime) / (postBTime - bTime),
  );
  const b1 = scalarLerp(
    a1,
    a2,
    bTime - preATime === 0 ? 0 : (time - preATime) / (bTime - preATime),
  );
  const b2 = scalarLerp(a2, a3, postBTime === 0 ? 1 : time / postBTime);
  return scalarLerp(b1, b2, bTime === 0 ? 0.5 : time / bTime);
};
const bezier = (start: number, c1: number, c2: number, end: number, t: number): number => {
  const omt = 1 - t;
  return omt ** 3 * start + 3 * omt ** 2 * t * c1 + 3 * omt * t ** 2 * c2 + t ** 3 * end;
};
const bezierDerivative = (
  start: number,
  c1: number,
  c2: number,
  end: number,
  t: number,
): number => {
  const omt = 1 - t;
  return 3 * omt ** 2 * (c1 - start) + 6 * omt * t * (c2 - c1) + 3 * t ** 2 * (end - c2);
};

/** Godot Vector2 equality is componentwise value equality. */
export function equals(left: Readonly<Vector2>, right: Readonly<Vector2>): boolean {
  return left.x === right.x && left.y === right.y;
}

export function add(left: Readonly<Vector2>, right: Readonly<Vector2>): Vector2 {
  return zip(left, right, (a, b) => a + b);
}

export function sub(left: Readonly<Vector2>, right: Readonly<Vector2>): Vector2 {
  return zip(left, right, (a, b) => a - b);
}

export function mul(value: Readonly<Vector2>, other: Readonly<Vector2> | number): Vector2 {
  return typeof other === 'number'
    ? map(value, (component) => component * other)
    : zip(value, other, (a, b) => a * b);
}

export function div(value: Readonly<Vector2>, other: Readonly<Vector2> | number): Vector2 {
  return typeof other === 'number'
    ? map(value, (component) => component / other)
    : zip(value, other, (a, b) => a / b);
}

export function lengthSquared(value: Readonly<Vector2>): number {
  return value.x * value.x + value.y * value.y;
}

export function length(value: Readonly<Vector2>): number {
  return Math.sqrt(lengthSquared(value));
}

export function normalized(value: Readonly<Vector2>): Vector2 {
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) return vec2();
  const squared = lengthSquared(value);
  if (squared === 0) return vec2();
  return div(value, Math.sqrt(squared));
}

export function limitLength(value: Readonly<Vector2>, limit = 1): Vector2 {
  const current = length(value);
  return current > 0 && limit < current ? mul(div(value, current), limit) : copyVector2(value);
}

export function distanceTo(left: Readonly<Vector2>, right: Readonly<Vector2>): number {
  return length(sub(left, right));
}

export function angle(value: Readonly<Vector2>): number {
  return Math.atan2(value.y, value.x);
}

export function rotated(value: Readonly<Vector2>, by: number): Vector2 {
  const sine = Math.sin(by);
  const cosine = Math.cos(by);
  return vec2(value.x * cosine - value.y * sine, value.x * sine + value.y * cosine);
}

const slerpVector2 = (
  value: Readonly<Vector2>,
  target: Readonly<Vector2>,
  weight: number,
): Vector2 => {
  const startSquared = lengthSquared(value);
  const endSquared = lengthSquared(target);
  if (startSquared === 0 || endSquared === 0)
    return zip(value, target, (a, b) => scalarLerp(a, b, weight));
  const startLength = Math.sqrt(startSquared);
  const resultLength = scalarLerp(startLength, Math.sqrt(endSquared), weight);
  const turn = Math.atan2(
    value.x * target.y - value.y * target.x,
    value.x * target.x + value.y * target.y,
  );
  return mul(rotated(value, turn * weight), resultLength / startLength);
};

const compare = (left: Readonly<Vector2>, right: Readonly<Vector2>): number => {
  if (left.x !== right.x) return left.x < right.x ? -1 : 1;
  if (left.y !== right.y) return left.y < right.y ? -1 : 1;
  return 0;
};
const isTransform2D = (value: unknown): value is GodotTransform2DLike =>
  typeof value === 'object' &&
  value !== null &&
  typeof Reflect.get(value, 'x') === 'object' &&
  typeof Reflect.get(value, 'y') === 'object' &&
  typeof Reflect.get(value, 'origin') === 'object';
const transformInverse = (value: Readonly<Vector2>, transform: GodotTransform2DLike): Vector2 => {
  const translated = sub(value, transform.origin);
  return vec2(
    transform.x.x * translated.x + transform.x.y * translated.y,
    transform.y.x * translated.x + transform.y.y * translated.y,
  );
};
const inContainer = (value: Readonly<Vector2>, container: unknown): boolean => {
  if (Array.isArray(container)) return container.some((entry) => equals(value, entry as Vector2));
  if (container instanceof Map)
    return [...container.keys()].some((entry) => equals(value, entry as Vector2));
  return false;
};

type Vector2BooleanMethod = 'is_equal_approx' | 'is_finite' | 'is_normalized' | 'is_zero_approx';
type Vector2NumberMethod =
  | 'angle'
  | 'angle_to'
  | 'angle_to_point'
  | 'aspect'
  | 'cross'
  | 'distance_squared_to'
  | 'distance_to'
  | 'dot'
  | 'length'
  | 'length_squared'
  | 'max_axis_index'
  | 'min_axis_index';
type Vector2ValueMethod =
  | 'abs'
  | 'bezier_derivative'
  | 'bezier_interpolate'
  | 'bounce'
  | 'ceil'
  | 'clamped'
  | 'clamp'
  | 'clampf'
  | 'cubic_interpolate'
  | 'cubic_interpolate_in_time'
  | 'direction_to'
  | 'floor'
  | 'lerp'
  | 'linear_interpolate'
  | 'limit_length'
  | 'max'
  | 'maxf'
  | 'min'
  | 'minf'
  | 'move_toward'
  | 'normalized'
  | 'orthogonal'
  | 'posmod'
  | 'posmodv'
  | 'project'
  | 'reflect'
  | 'rotated'
  | 'round'
  | 'sign'
  | 'slerp'
  | 'slide'
  | 'snapped'
  | 'snappedf';

export function godotVector2Call(
  method: Vector2BooleanMethod,
  value: Readonly<Vector2>,
  args: readonly unknown[],
): boolean;
export function godotVector2Call(
  method: Vector2NumberMethod,
  value: Readonly<Vector2>,
  args: readonly unknown[],
): number;
export function godotVector2Call(
  method: Vector2ValueMethod,
  value: Readonly<Vector2>,
  args: readonly unknown[],
): Vector2;
export function godotVector2Call(
  method: string,
  value: Readonly<Vector2>,
  args: readonly unknown[],
): unknown;

export function godotVector2Call(
  method: string,
  value: Readonly<Vector2>,
  args: readonly unknown[],
): unknown {
  const vector = (index: number): Vector2 => args[index] as Vector2;
  const number = (index: number): number => Number(args[index]);
  switch (method) {
    case 'angle':
      return angle(value);
    case 'angle_to':
      return Math.atan2(
        value.x * vector(0).y - value.y * vector(0).x,
        value.x * vector(0).x + value.y * vector(0).y,
      );
    case 'angle_to_point':
      return angle(sub(vector(0), value));
    case 'direction_to':
      return normalized(sub(vector(0), value));
    case 'distance_to':
      return distanceTo(value, vector(0));
    case 'distance_squared_to':
      return lengthSquared(sub(value, vector(0)));
    case 'length':
      return length(value);
    case 'length_squared':
      return lengthSquared(value);
    case 'limit_length':
    case 'clamped':
      return limitLength(value, args.length === 0 ? 1 : number(0));
    case 'normalized':
      return normalized(value);
    case 'is_normalized':
      return approx(lengthSquared(value), 1, UNIT_EPSILON);
    case 'is_equal_approx':
      return approx(value.x, vector(0).x) && approx(value.y, vector(0).y);
    case 'is_zero_approx':
      return Math.abs(value.x) < CMP_EPSILON && Math.abs(value.y) < CMP_EPSILON;
    case 'is_finite':
      return Number.isFinite(value.x) && Number.isFinite(value.y);
    case 'posmod':
      return map(value, (component) => fposmod(component, number(0)));
    case 'posmodv':
      return zip(value, vector(0), fposmod);
    case 'project': {
      const onto = vector(0);
      return mul(onto, (value.x * onto.x + value.y * onto.y) / lengthSquared(onto));
    }
    // Godot 3.6 `core/math/vector2.h::linear_interpolate` and Godot 4.7 `lerp` are
    // the same unclamped `from + weight * (to - from)` component equation.
    case 'lerp':
    case 'linear_interpolate':
      return zip(value, vector(0), (a, b) => scalarLerp(a, b, number(1)));
    case 'slerp':
      return slerpVector2(value, vector(0), number(1));
    case 'cubic_interpolate':
      return vec2(
        cubic(value.x, vector(0).x, vector(1).x, vector(2).x, number(3)),
        cubic(value.y, vector(0).y, vector(1).y, vector(2).y, number(3)),
      );
    case 'cubic_interpolate_in_time':
      return vec2(
        cubicTime(
          value.x,
          vector(0).x,
          vector(1).x,
          vector(2).x,
          number(3),
          number(4),
          number(5),
          number(6),
        ),
        cubicTime(
          value.y,
          vector(0).y,
          vector(1).y,
          vector(2).y,
          number(3),
          number(4),
          number(5),
          number(6),
        ),
      );
    case 'bezier_interpolate':
      return vec2(
        bezier(value.x, vector(0).x, vector(1).x, vector(2).x, number(3)),
        bezier(value.y, vector(0).y, vector(1).y, vector(2).y, number(3)),
      );
    case 'bezier_derivative':
      return vec2(
        bezierDerivative(value.x, vector(0).x, vector(1).x, vector(2).x, number(3)),
        bezierDerivative(value.y, vector(0).y, vector(1).y, vector(2).y, number(3)),
      );
    case 'max_axis_index':
      return value.x < value.y ? 1 : 0;
    case 'min_axis_index':
      return value.x < value.y ? 0 : 1;
    case 'move_toward': {
      const target = vector(0);
      const difference = sub(target, value);
      const distance = length(difference);
      return distance <= number(1) || distance < CMP_EPSILON
        ? copyVector2(target)
        : add(value, mul(div(difference, distance), number(1)));
    }
    case 'rotated':
      return rotated(value, number(0));
    case 'orthogonal':
      return vec2(value.y, -value.x);
    case 'floor':
      return map(value, Math.floor);
    case 'ceil':
      return map(value, Math.ceil);
    case 'round':
      return map(value, roundScalar);
    case 'aspect':
      return value.x / value.y;
    case 'dot':
      return value.x * vector(0).x + value.y * vector(0).y;
    case 'slide': {
      const normal = vector(0);
      return sub(value, mul(normal, value.x * normal.x + value.y * normal.y));
    }
    case 'reflect': {
      const normal = vector(0);
      return sub(mul(normal, 2 * (value.x * normal.x + value.y * normal.y)), value);
    }
    case 'bounce':
      return map(godotVector2Call('reflect', value, args) as Vector2, (component) => -component);
    case 'cross':
      return value.x * vector(0).y - value.y * vector(0).x;
    case 'abs':
      return map(value, Math.abs);
    case 'sign':
      return map(value, signScalar);
    case 'clamp':
      return vec2(
        clampScalar(value.x, vector(0).x, vector(1).x),
        clampScalar(value.y, vector(0).y, vector(1).y),
      );
    case 'clampf':
      return map(value, (component) => clampScalar(component, number(0), number(1)));
    case 'snapped':
      return zip(value, vector(0), snappedScalar);
    case 'snappedf':
      return map(value, (component) => snappedScalar(component, number(0)));
    case 'min':
      return zip(value, vector(0), minimum);
    case 'minf':
      return map(value, (component) => minimum(component, number(0)));
    case 'max':
      return zip(value, vector(0), maximum);
    case 'maxf':
      return map(value, (component) => maximum(component, number(0)));
    default:
      throw new Error(`godot-compat: unsupported Vector2.${method}`);
  }
}

export function godotVector2Static(method: 'from_angle', args: readonly unknown[]): Vector2;
export function godotVector2Static(method: string, args: readonly unknown[]): unknown;
export function godotVector2Static(method: string, args: readonly unknown[]): unknown {
  if (method === 'from_angle') return vec2(Math.cos(Number(args[0])), Math.sin(Number(args[0])));
  throw new Error(`godot-compat: unsupported static Vector2.${method}`);
}

function requireVector2OperatorOperand(value: unknown, operator: string): Vector2 {
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof Reflect.get(value, 'x') !== 'number' ||
    typeof Reflect.get(value, 'y') !== 'number'
  ) {
    throw new TypeError(
      `godot-compat: Vector2 operator ${operator} requires a structural Vector2 operand.`,
    );
  }
  return value as Vector2;
}

export function godotVector2Operator(
  operator: '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in',
  left: Readonly<Vector2>,
  right: unknown,
): boolean;
export function godotVector2Operator(
  operator: '+' | '-' | '*' | '/',
  left: Readonly<Vector2>,
  right: unknown,
): Vector2;
export function godotVector2Operator(
  operator: string,
  left: Readonly<Vector2>,
  right: unknown,
): unknown;
export function godotVector2Operator(
  operator: string,
  left: Readonly<Vector2>,
  right: unknown,
): unknown {
  switch (operator) {
    case '==':
      return typeof right === 'object' && right !== null && equals(left, right as Vector2);
    case '!=':
      return !(typeof right === 'object' && right !== null && equals(left, right as Vector2));
    case '+':
      return add(left, requireVector2OperatorOperand(right, operator));
    case '-':
      return sub(left, requireVector2OperatorOperand(right, operator));
    case '*':
      return typeof right === 'number'
        ? mul(left, right)
        : isTransform2D(right)
          ? transformInverse(left, right)
          : mul(left, requireVector2OperatorOperand(right, operator));
    case '/':
      return div(
        left,
        typeof right === 'number' ? right : requireVector2OperatorOperand(right, operator),
      );
    case '<':
      return compare(left, requireVector2OperatorOperand(right, operator)) < 0;
    case '<=':
      return compare(left, requireVector2OperatorOperand(right, operator)) <= 0;
    case '>':
      return compare(left, requireVector2OperatorOperand(right, operator)) > 0;
    case '>=':
      return compare(left, requireVector2OperatorOperand(right, operator)) >= 0;
    case 'in':
      return inContainer(left, right);
    default:
      throw new Error(`godot-compat: unsupported Vector2 operator ${operator}`);
  }
}

export const godotVector2Not = (value: Readonly<Vector2>): boolean => equals(value, VECTOR2_ZERO);
export const godotVector2Positive = (value: Readonly<Vector2>): Vector2 => copyVector2(value);
export const godotVector2Negative = (value: Readonly<Vector2>): Vector2 => vec2(-value.x, -value.y);
