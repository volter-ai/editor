/** Godot 4.7 Vector4 value protocol, ported from `core/math/vector4.{h,cpp}`. */

export interface GodotVector4 {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** Godot 4's integer four-vector value. Constructors copy components, never alias them. */
export interface GodotVector4i {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

/** The four column vectors Godot's `Projection` exposes to Variant operators. */
export interface GodotProjection4 {
  readonly x: GodotVector4;
  readonly y: GodotVector4;
  readonly z: GodotVector4;
  readonly w: GodotVector4;
}

type Components = readonly [number, number, number, number];
const CMP_EPSILON = 0.00001;
const UNIT_EPSILON = 0.001;

export function godotVector4(x = 0, y = 0, z = 0, w = 0): GodotVector4 {
  return { x, y, z, w };
}

export function godotVector4New(...args: readonly unknown[]): GodotVector4 {
  if (args.length === 0) return godotVector4();
  if (args.length === 1) {
    const value = args[0] as GodotVector4;
    return godotVector4(value.x, value.y, value.z, value.w);
  }
  return godotVector4(Number(args[0]), Number(args[1]), Number(args[2]), Number(args[3]));
}

const integerComponent = (value: unknown, member: string): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new TypeError(`godot-compat: ${member} requires finite numeric components.`);
  }
  return Math.trunc(numeric);
};

export function godotVector4iNew(...args: readonly unknown[]): GodotVector4i {
  if (args.length === 0) return Object.freeze({ x: 0, y: 0, z: 0, w: 0 });
  if (args.length === 1) {
    const value = args[0];
    if (typeof value !== 'object' || value === null) {
      throw new TypeError('godot-compat: Vector4i(value) requires a Vector4/Vector4i value.');
    }
    return Object.freeze({
      x: integerComponent(Reflect.get(value, 'x'), 'Vector4i'),
      y: integerComponent(Reflect.get(value, 'y'), 'Vector4i'),
      z: integerComponent(Reflect.get(value, 'z'), 'Vector4i'),
      w: integerComponent(Reflect.get(value, 'w'), 'Vector4i'),
    });
  }
  if (args.length !== 4) {
    throw new TypeError(`godot-compat: Vector4i accepts 0, 1, or 4 arguments; received ${args.length}.`);
  }
  return Object.freeze({
    x: integerComponent(args[0], 'Vector4i'),
    y: integerComponent(args[1], 'Vector4i'),
    z: integerComponent(args[2], 'Vector4i'),
    w: integerComponent(args[3], 'Vector4i'),
  });
}

/** Godot's identity Projection, stored as four independent column values. */
export function godotProjectionNew(...args: readonly unknown[]): GodotProjection4 {
  if (args.length === 0) {
    return Object.freeze({
      x: Object.freeze(godotVector4(1, 0, 0, 0)),
      y: Object.freeze(godotVector4(0, 1, 0, 0)),
      z: Object.freeze(godotVector4(0, 0, 1, 0)),
      w: Object.freeze(godotVector4(0, 0, 0, 1)),
    });
  }
  const column = (value: unknown, label: string): GodotVector4 => {
    if (typeof value !== 'object' || value === null) {
      throw new TypeError(`godot-compat: Projection ${label} must be a vector value.`);
    }
    const components = ['x', 'y', 'z', 'w'].map((component) => {
      const numeric = Number(Reflect.get(value, component));
      if (!Number.isFinite(numeric)) {
        throw new TypeError(`godot-compat: Projection ${label}.${component} must be finite.`);
      }
      return numeric;
    });
    return Object.freeze(godotVector4(components[0]!, components[1]!, components[2]!, components[3]!));
  };
  if (args.length === 1) {
    const value = args[0];
    if (typeof value !== 'object' || value === null) {
      throw new TypeError('godot-compat: Projection(value) requires a Projection or Transform3D.');
    }
    const basis = Reflect.get(value, 'basis');
    const origin = Reflect.get(value, 'origin');
    if (Array.isArray(basis) && basis.length === 3 && typeof origin === 'object' && origin !== null) {
      const transformColumn = (axis: unknown, label: string): GodotVector4 => {
        if (typeof axis !== 'object' || axis === null) {
          throw new TypeError(`godot-compat: Projection Transform3D ${label} axis is invalid.`);
        }
        return column({
          x: Reflect.get(axis, 'x'), y: Reflect.get(axis, 'y'),
          z: Reflect.get(axis, 'z'), w: 0,
        }, label);
      };
      return Object.freeze({
        x: transformColumn(basis[0], 'x'),
        y: transformColumn(basis[1], 'y'),
        z: transformColumn(basis[2], 'z'),
        w: column({
          x: Reflect.get(origin, 'x'), y: Reflect.get(origin, 'y'),
          z: Reflect.get(origin, 'z'), w: 1,
        }, 'w'),
      });
    }
    return Object.freeze({
      x: column(Reflect.get(value, 'x'), 'x'),
      y: column(Reflect.get(value, 'y'), 'y'),
      z: column(Reflect.get(value, 'z'), 'z'),
      w: column(Reflect.get(value, 'w'), 'w'),
    });
  }
  if (args.length !== 4) {
    throw new TypeError(`godot-compat: Projection accepts 0, 1, or 4 arguments; received ${args.length}.`);
  }
  return Object.freeze({
    x: column(args[0], 'x'), y: column(args[1], 'y'),
    z: column(args[2], 'z'), w: column(args[3], 'w'),
  });
}

export const VECTOR4_ZERO: GodotVector4 = Object.freeze(godotVector4());
export const VECTOR4_ONE: GodotVector4 = Object.freeze(godotVector4(1, 1, 1, 1));
export const VECTOR4_INF: GodotVector4 = Object.freeze(
  godotVector4(
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ),
);
export const VECTOR4_AXIS = Object.freeze({ AXIS_X: 0, AXIS_Y: 1, AXIS_Z: 2, AXIS_W: 3 });

const components = (value: GodotVector4): Components => [value.x, value.y, value.z, value.w];
const from = (values: Components): GodotVector4 => godotVector4(...values);
const map = (value: GodotVector4, fn: (component: number, axis: number) => number): GodotVector4 =>
  from(components(value).map(fn) as unknown as Components);
const zip = (
  left: GodotVector4,
  right: GodotVector4,
  fn: (a: number, b: number, axis: number) => number,
): GodotVector4 =>
  from(
    components(left).map((value, axis) =>
      fn(value, components(right)[axis]!, axis),
    ) as unknown as Components,
  );
const scalarLerp = (fromValue: number, toValue: number, weight: number): number =>
  fromValue + (toValue - fromValue) * weight;
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
const fposmod = (value: number, modulus: number): number => {
  let result = value % modulus;
  if ((result < 0 && modulus > 0) || (result > 0 && modulus < 0)) result += modulus;
  return result + 0;
};
const snapped = (value: number, step: number): number =>
  step === 0 ? value : Math.floor(value / step + 0.5) * step;
const round = (value: number): number =>
  value < 0 ? Math.ceil(value - 0.5) : Math.floor(value + 0.5);
const approx = (left: number, right: number, tolerance?: number): boolean => {
  if (left === right) return true;
  const limit = tolerance ?? Math.max(CMP_EPSILON * Math.abs(left), CMP_EPSILON);
  return Math.abs(left - right) < limit;
};
const lengthSquared = (value: GodotVector4): number =>
  value.x * value.x + value.y * value.y + value.z * value.z + value.w * value.w;
const normalized = (value: GodotVector4): GodotVector4 => {
  if (!components(value).every(Number.isFinite)) return godotVector4();
  const squared = lengthSquared(value);
  if (squared === 0) return godotVector4();
  const length = Math.sqrt(squared);
  return map(value, (component) => component / length);
};
const compare = (left: GodotVector4, right: GodotVector4): number => {
  for (let axis = 0; axis < 4; axis += 1) {
    const a = components(left)[axis]!;
    const b = components(right)[axis]!;
    if (a !== b) return a < b ? -1 : 1;
  }
  return 0;
};
const equal = (left: GodotVector4, right: unknown): right is GodotVector4 =>
  typeof right === 'object' &&
  right !== null &&
  left.x === Reflect.get(right, 'x') &&
  left.y === Reflect.get(right, 'y') &&
  left.z === Reflect.get(right, 'z') &&
  left.w === Reflect.get(right, 'w');

const isProjection4 = (value: unknown): value is GodotProjection4 =>
  typeof value === 'object' &&
  value !== null &&
  typeof Reflect.get(value, 'x') === 'object' &&
  typeof Reflect.get(value, 'y') === 'object' &&
  typeof Reflect.get(value, 'z') === 'object' &&
  typeof Reflect.get(value, 'w') === 'object';

const projectionXform = (projection: GodotProjection4, value: GodotVector4): GodotVector4 =>
  godotVector4(
    projection.x.x * value.x +
      projection.y.x * value.y +
      projection.z.x * value.z +
      projection.w.x * value.w,
    projection.x.y * value.x +
      projection.y.y * value.y +
      projection.z.y * value.z +
      projection.w.y * value.w,
    projection.x.z * value.x +
      projection.y.z * value.y +
      projection.z.z * value.z +
      projection.w.z * value.w,
    projection.x.w * value.x +
      projection.y.w * value.y +
      projection.z.w * value.z +
      projection.w.w * value.w,
  );

const projectionXformInverse = (value: GodotVector4, projection: GodotProjection4): GodotVector4 =>
  godotVector4(
    projection.x.x * value.x +
      projection.x.y * value.y +
      projection.x.z * value.z +
      projection.x.w * value.w,
    projection.y.x * value.x +
      projection.y.y * value.y +
      projection.y.z * value.z +
      projection.y.w * value.w,
    projection.z.x * value.x +
      projection.z.y * value.y +
      projection.z.z * value.z +
      projection.z.w * value.w,
    projection.w.x * value.x +
      projection.w.y * value.y +
      projection.w.z * value.z +
      projection.w.w * value.w,
  );

export const godotProjectionVector4Multiply = (
  projection: GodotProjection4,
  value: GodotVector4,
): GodotVector4 => projectionXform(projection, value);

export function godotVector4Call(
  method: string,
  value: GodotVector4,
  args: readonly unknown[],
): unknown {
  const vector = (at: number): GodotVector4 => args[at] as GodotVector4;
  const number = (at: number): number => Number(args[at]);
  switch (method) {
    case 'min_axis_index': {
      const values = components(value);
      let best = 0;
      for (let axis = 1; axis < 4; axis += 1) if (values[axis]! <= values[best]!) best = axis;
      return best;
    }
    case 'max_axis_index': {
      const values = components(value);
      let best = 0;
      for (let axis = 1; axis < 4; axis += 1) if (values[axis]! > values[best]!) best = axis;
      return best;
    }
    case 'length_squared':
      return lengthSquared(value);
    case 'length':
      return Math.sqrt(lengthSquared(value));
    case 'abs':
      return map(value, Math.abs);
    case 'sign':
      return map(value, Math.sign);
    case 'floor':
      return map(value, Math.floor);
    case 'ceil':
      return map(value, Math.ceil);
    case 'round':
      return map(value, round);
    case 'lerp':
      return zip(value, vector(0), (a, b) => scalarLerp(a, b, number(1)));
    case 'cubic_interpolate':
      return zip(value, vector(0), (a, b, axis) =>
        cubic(a, b, components(vector(1))[axis]!, components(vector(2))[axis]!, number(3)),
      );
    case 'cubic_interpolate_in_time':
      return zip(value, vector(0), (a, b, axis) =>
        cubicTime(
          a,
          b,
          components(vector(1))[axis]!,
          components(vector(2))[axis]!,
          number(3),
          number(4),
          number(5),
          number(6),
        ),
      );
    case 'posmod':
      return map(value, (component) => fposmod(component, number(0)));
    case 'posmodv':
      return zip(value, vector(0), fposmod);
    case 'snapped':
      return zip(value, vector(0), snapped);
    case 'snappedf':
      return map(value, (component) => snapped(component, number(0)));
    case 'clamp':
      return zip(value, vector(0), (component, minimum, axis) =>
        Math.min(Math.max(component, minimum), components(vector(1))[axis]!),
      );
    case 'clampf':
      return map(value, (component) => Math.min(Math.max(component, number(0)), number(1)));
    case 'normalized':
      return normalized(value);
    case 'is_normalized':
      return approx(lengthSquared(value), 1, UNIT_EPSILON);
    case 'direction_to':
      return normalized(zip(vector(0), value, (to, fromValue) => to - fromValue));
    case 'distance_squared_to':
      return lengthSquared(zip(vector(0), value, (to, fromValue) => to - fromValue));
    case 'distance_to':
      return Math.sqrt(lengthSquared(zip(vector(0), value, (to, fromValue) => to - fromValue)));
    case 'dot':
      return components(value).reduce(
        (sum, component, axis) => sum + component * components(vector(0))[axis]!,
        0,
      );
    case 'inverse':
      return map(value, (component) => 1 / component);
    case 'is_equal_approx':
      return components(value).every((component, axis) =>
        approx(component, components(vector(0))[axis]!),
      );
    case 'is_zero_approx':
      return components(value).every((component) => Math.abs(component) < CMP_EPSILON);
    case 'is_finite':
      return components(value).every(Number.isFinite);
    case 'min':
      return zip(value, vector(0), Math.min);
    case 'minf':
      return map(value, (component) => Math.min(component, number(0)));
    case 'max':
      return zip(value, vector(0), Math.max);
    case 'maxf':
      return map(value, (component) => Math.max(component, number(0)));
    default:
      throw new Error(`godot-compat: unsupported Vector4.${method}`);
  }
}

export function godotVector4Operator(
  operator: string,
  left: GodotVector4,
  right: unknown,
): unknown {
  const vector = right as GodotVector4;
  switch (operator) {
    case '==':
      return equal(left, right);
    case '!=':
      return !equal(left, right);
    case '+':
      return zip(left, vector, (a, b) => a + b);
    case '-':
      return zip(left, vector, (a, b) => a - b);
    case '*':
      return typeof right === 'number'
        ? map(left, (component) => component * right)
        : isProjection4(right)
          ? projectionXformInverse(left, right as GodotProjection4)
          : zip(left, vector, (a, b) => a * b);
    case '/':
      return typeof right === 'number'
        ? map(left, (component) => component / right)
        : zip(left, vector, (a, b) => a / b);
    case '<':
      return compare(left, vector) < 0;
    case '<=':
      return compare(left, vector) <= 0;
    case '>':
      return compare(left, vector) > 0;
    case '>=':
      return compare(left, vector) >= 0;
    case 'in': {
      if (Array.isArray(right)) return right.some((entry) => equal(left, entry));
      if (right instanceof Map) return [...right.keys()].some((entry) => equal(left, entry));
      return typeof right === 'object' && right !== null && Object.hasOwn(right, String(left));
    }
    default:
      throw new Error(`godot-compat: unsupported Vector4 operator ${operator}`);
  }
}

export const godotVector4Not = (value: GodotVector4): boolean => equal(value, VECTOR4_ZERO);
export const godotVector4Positive = (value: GodotVector4): GodotVector4 => godotVector4New(value);
export const godotVector4Negative = (value: GodotVector4): GodotVector4 =>
  map(value, (component) => -component);
