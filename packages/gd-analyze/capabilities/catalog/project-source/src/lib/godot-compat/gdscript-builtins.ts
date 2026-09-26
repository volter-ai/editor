/** Complete Godot 4.7 `@GDScript` utility protocol, ported from VariantUtilityFunctions. */

import { godotDecodeVariant, godotEncodeVariant } from './godot-variant-marshals';
import { createGodotJSON, godotJSONParse3, godotJSONPrint3 } from './json';
import { godotChar, godotErrorString, godotLen, godotOrd } from './language';
import { godotNodePathNew, godotNodePathString, isGodotNodePath } from './node-path';
import { isGodotObjectFreed } from './object-liveness';
import {
  isGodotPackedArray,
  type PackedByteArray,
  packedArrayKind,
  packedByteArray,
  packedInt64Array,
} from './packed-array';
import type { GodotRandom } from './random';
import {
  godotAbsi,
  godotCeili,
  godotClampi,
  godotFloori,
  godotMaxi,
  godotMini,
  godotPosmod,
  godotRoundi,
  godotSigni,
  godotSnappedi,
  godotStepDecimals,
  godotWrapi,
} from './scalar-int';
import { godotNumericVariantTag } from './variant-number';

export const GODOT_PI = Math.PI;
export const GODOT_TAU = Math.PI * 2;
export const GODOT_INF = Number.POSITIVE_INFINITY;
export const GODOT_NAN = Number.NaN;

/** Runtime-representable builtin Variant tests. `number` means Godot's `int or float` union.
 * Individual numeric tags are available only at boundaries that explicitly retain them. */
export function godotVariantIsBuiltin(
  value: unknown,
  type: 'String' | 'bool' | 'Nil' | 'number' | 'int' | 'float' | 'Dictionary',
): boolean {
  switch (type) {
    case 'String':
      return typeof value === 'string';
    case 'bool':
      return typeof value === 'boolean';
    case 'Nil':
      return value === null || value === undefined;
    case 'number':
      return (
        typeof value === 'number' ||
        typeof value === 'bigint' ||
        godotNumericVariantTag(value) !== undefined
      );
    case 'int':
    case 'float': {
      const tag = godotNumericVariantTag(value);
      if (tag === undefined) {
        throw new TypeError(
          `godot-compat: lone Variant is ${type} requires a retained numeric Variant tag.`,
        );
      }
      return tag === type;
    }
    case 'Dictionary':
      return value instanceof Map;
  }
}

export interface GodotBuiltinServices {
  readonly random?: GodotRandom;
  readonly load?: (path: string) => unknown;
  readonly typeExists?: (name: string) => boolean;
  readonly isInstanceOf?: (value: unknown, className: string) => boolean;
  readonly print?: (level: 'log' | 'error' | 'warning' | 'trace', message: string) => void;
  readonly verbose?: boolean;
}

export interface GodotRid {
  readonly id: bigint;
}

function requireGodotRid(value: unknown, member: string): GodotRid {
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as Partial<GodotRid>).id !== 'bigint'
  ) {
    throw new Error(`godot-compat: RID.${member} requires an actual RID value.`);
  }
  return value as GodotRid;
}

/** RID's default/copy constructors. Zero is the engine's null RID; copies retain handle identity. */
export function godotRidNew(from?: unknown): GodotRid {
  if (from === undefined) return Object.freeze({ id: 0n });
  const source = requireGodotRid(from, 'new');
  return Object.freeze({ id: source.id });
}

/** Build the exact unsigned 64-bit RID bit pattern used by rid_from_int64/type conversion. */
export function godotRidFromInt64(value: unknown): GodotRid {
  const integerValue = typeof value === 'bigint' ? value : BigInt(Math.trunc(Number(value)));
  return Object.freeze({ id: BigInt.asUintN(64, integerValue) });
}

/** Allocate from the process-wide RID owner already shared by every retained server resource. */
export function allocateGodotRid(): GodotRid {
  return Object.freeze({ id: nextRid++ });
}

export function godotRidIsValid(value: unknown): boolean {
  return requireGodotRid(value, 'is_valid').id !== 0n;
}

export function godotRidGetId(value: unknown): bigint {
  return requireGodotRid(value, 'get_id').id;
}

/** Source-shaped RID operators compare opaque owner IDs, never JavaScript wrapper identity. */
export function godotRidOperator(
  operator: string,
  leftValue: unknown,
  rightValue?: unknown,
): boolean {
  const left = requireGodotRid(leftValue, `operator ${operator}`);
  if (operator === 'not') return left.id === 0n;
  if (operator === 'in') {
    if (Array.isArray(rightValue)) {
      return rightValue.some(
        (candidate) =>
          typeof candidate === 'object' &&
          candidate !== null &&
          typeof (candidate as Partial<GodotRid>).id === 'bigint' &&
          (candidate as GodotRid).id === left.id,
      );
    }
    if (rightValue instanceof Map) {
      for (const candidate of rightValue.keys()) {
        if (
          typeof candidate === 'object' &&
          candidate !== null &&
          typeof (candidate as Partial<GodotRid>).id === 'bigint' &&
          (candidate as GodotRid).id === left.id
        )
          return true;
      }
      return false;
    }
    throw new Error('godot-compat: RID operator in requires an Array or Dictionary receiver.');
  }
  const rightIsRid =
    typeof rightValue === 'object' &&
    rightValue !== null &&
    typeof (rightValue as Partial<GodotRid>).id === 'bigint';
  if (operator === '==') return rightIsRid && left.id === (rightValue as GodotRid).id;
  if (operator === '!=') return !rightIsRid || left.id !== (rightValue as GodotRid).id;
  const right = requireGodotRid(rightValue, `operator ${operator}`);
  if (operator === '<') return left.id < right.id;
  if (operator === '<=') return left.id <= right.id;
  if (operator === '>') return left.id > right.id;
  if (operator === '>=') return left.id >= right.id;
  throw new Error(`godot-compat: unsupported RID operator ${operator}.`);
}

export interface GodotWeakRef {
  get_ref(): unknown;
}

/** WeakRef.new()/weakref() share the native weak identity; an empty WeakRef resolves to null. */
export function createGodotWeakRef(target: unknown = null): GodotWeakRef {
  const object =
    (typeof target === 'object' && target !== null) || typeof target === 'function'
      ? (target as object)
      : null;
  const NativeWeakRef = globalThis.WeakRef;
  const reference =
    object !== null && typeof NativeWeakRef === 'function' ? new NativeWeakRef(object) : undefined;
  // A host without native WeakRef cannot observe collection. Holding the target is the only exact
  // fallback for every observable state: explicit Godot free remains visible through liveness.
  const fallback = reference === undefined ? object : null;
  return {
    get_ref: () => {
      const value = reference?.deref() ?? fallback;
      return value === null || value === undefined || isGodotObjectFreed(value) ? null : value;
    },
  };
}

/** Global weakref(obj) requires a live Object; WeakRef.new() alone is the empty constructor. */
export function godotWeakRef(target: unknown): GodotWeakRef {
  if (
    !((typeof target === 'object' && target !== null) || typeof target === 'function') ||
    isGodotObjectFreed(target as object)
  ) {
    throw new TypeError('weakref() requires a live Object value.');
  }
  return createGodotWeakRef(target);
}

type NumericRecord = Record<string, number>;

const CMP_EPSILON = 0.00001;
const TYPE_NAMES = [
  'Nil',
  'bool',
  'int',
  'float',
  'String',
  'Vector2',
  'Vector2i',
  'Rect2',
  'Rect2i',
  'Vector3',
  'Vector3i',
  'Transform2D',
  'Vector4',
  'Vector4i',
  'Plane',
  'Quaternion',
  'AABB',
  'Basis',
  'Transform3D',
  'Projection',
  'Color',
  'StringName',
  'NodePath',
  'RID',
  'Object',
  'Callable',
  'Signal',
  'Dictionary',
  'Array',
  'PackedByteArray',
  'PackedInt32Array',
  'PackedInt64Array',
  'PackedFloat32Array',
  'PackedFloat64Array',
  'PackedStringArray',
  'PackedVector2Array',
  'PackedVector3Array',
  'PackedColorArray',
  'PackedVector4Array',
] as const;
const BUILTIN_TYPES: ReadonlySet<string> = new Set(TYPE_NAMES);
const INSTANCE_IDS = new WeakMap<object, bigint>();
const INSTANCES = new Map<bigint, WeakRef<object>>();
let nextInstanceId = 1n;
let nextRid = 1n;
const RID_BY_CARRIER = new WeakMap<object, GodotRid>();
const CARRIER_BY_RID = new Map<bigint, WeakRef<object>>();

const number = (value: unknown): number => Number(value);
const integer = (value: unknown): number => Math.trunc(number(value));
const requirePackedByteArray = (value: unknown, member: string): PackedByteArray => {
  if (!isGodotPackedArray(value) || packedArrayKind(value) !== 'byte') {
    throw new TypeError(`${member} requires PackedByteArray.`);
  }
  return packedByteArray(value);
};
const round = (value: number): number =>
  value < 0 ? Math.ceil(value - 0.5) : Math.floor(value + 0.5);
const sign = (value: number): number => (value > 0 ? 1 : value < 0 ? -1 : 0);
const minimum = (left: number, right: number): number => (left < right ? left : right);
const maximum = (left: number, right: number): number => (left > right ? left : right);
const clamp = (value: number, low: number, high: number): number =>
  value < low ? low : value > high ? high : value;
const scalarLerp = (from: number, to: number, weight: number): number =>
  from + (to - from) * weight;
const fposmod = (value: number, modulus: number): number => {
  let result = value % modulus;
  if ((result < 0 && modulus > 0) || (result > 0 && modulus < 0)) result += modulus;
  return result + 0;
};
const wrapf = (value: number, low: number, high: number): number => {
  const range = high - low;
  if (Math.abs(range) < CMP_EPSILON) return low;
  const result = value - range * Math.floor((value - low) / range);
  const tolerance = Math.max(CMP_EPSILON * Math.abs(result), CMP_EPSILON);
  return result === high || Math.abs(result - high) < tolerance ? low : result;
};
const snapped = (value: number, step: number): number =>
  step === 0 ? value : Math.floor(value / step + 0.5) * step;
const angleDifference = (from: number, to: number): number => {
  const difference = (to - from) % GODOT_TAU;
  return ((2 * difference) % GODOT_TAU) - difference;
};
const cubic = (from: number, to: number, pre: number, post: number, weight: number): number =>
  0.5 *
  (from * 2 +
    (-pre + to) * weight +
    (2 * pre - 5 * from + 4 * to - post) * weight ** 2 +
    (-pre + 3 * from - 3 * to + post) * weight ** 3);
const cubicTime = (
  from: number,
  to: number,
  pre: number,
  post: number,
  weight: number,
  toTime: number,
  preTime: number,
  postTime: number,
): number => {
  const time = scalarLerp(0, toTime, weight);
  const a1 = scalarLerp(pre, from, preTime === 0 ? 0 : (time - preTime) / -preTime);
  const a2 = scalarLerp(from, to, toTime === 0 ? 0.5 : time / toTime);
  const a3 = scalarLerp(
    to,
    post,
    postTime - toTime === 0 ? 1 : (time - toTime) / (postTime - toTime),
  );
  const b1 = scalarLerp(a1, a2, toTime - preTime === 0 ? 0 : (time - preTime) / (toTime - preTime));
  const b2 = scalarLerp(a2, a3, postTime === 0 ? 1 : time / postTime);
  return scalarLerp(b1, b2, toTime === 0 ? 0.5 : time / toTime);
};

function numericKeys(value: object): string[] {
  return Object.keys(value).filter((key) => typeof Reflect.get(value, key) === 'number');
}

function mapNumeric(value: unknown, fn: (component: number) => number): unknown {
  if (typeof value === 'number') return fn(value);
  if (typeof value !== 'object' || value === null) throw new TypeError('expected numeric Variant');
  const output: NumericRecord = {};
  for (const key of numericKeys(value)) output[key] = fn(number(Reflect.get(value, key)));
  return output;
}

function zipNumeric(left: unknown, right: unknown, fn: (a: number, b: number) => number): unknown {
  if (typeof left === 'number' && typeof right === 'number') return fn(left, right);
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null)
    throw new TypeError('expected matching numeric Variants');
  const output: NumericRecord = {};
  for (const key of numericKeys(left))
    output[key] = fn(number(Reflect.get(left, key)), number(Reflect.get(right, key)));
  return output;
}

function lerpVariant(from: unknown, to: unknown, weight: number): unknown {
  if (typeof from === 'number' && typeof to === 'number') return scalarLerp(from, to, weight);
  return zipNumeric(from, to, (a, b) => scalarLerp(a, b, weight));
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: this is the source-shaped Variant stringify dispatch.
function godotString(value: unknown): string {
  if (value === null || value === undefined) return '<null>';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'nan';
    if (value === Number.POSITIVE_INFINITY) return 'inf';
    if (value === Number.NEGATIVE_INFINITY) return '-inf';
    return String(value);
  }
  if (typeof value === 'bigint') return value.toString();
  if (isGodotNodePath(value)) return godotNodePathString(value);
  if (Array.isArray(value)) return `[${value.map(godotString).join(', ')}]`;
  if (value instanceof Map)
    return `{ ${[...value].map(([key, entry]) => `${godotString(key)}: ${godotString(entry)}`).join(', ')} }`;
  if (typeof value === 'object') {
    const keys = numericKeys(value);
    if (keys.length > 0)
      return `(${keys.map((key) => godotString(Reflect.get(value, key))).join(', ')})`;
  }
  return String(value);
}

/**
 * The retained exact scalar subset of Godot 3's `Variant::operator String()` used by the variadic
 * `@GDScript.str` global. Carriers whose source printer is not yet exact stay loud instead of
 * falling through to JavaScript `String`, whose output differs from Godot.
 */
function godot3String(value: unknown): string {
  if (value === null || value === undefined) return 'Null';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'nan';
    if (value === Number.POSITIVE_INFINITY) return 'inf';
    if (value === Number.NEGATIVE_INFINITY) return '-inf';
    if (Number.isSafeInteger(value) && !Object.is(value, -0)) return String(value);
    throw new TypeError(
      'godot-compat: Godot 3 str float formatting is not retained; JavaScript String(number) ' +
        'uses different precision and cannot be substituted exactly.',
    );
  }
  if (typeof value === 'bigint') return value.toString();
  if (isGodotNodePath(value)) return godotNodePathString(value);
  throw new TypeError(
    'godot-compat: Godot 3 str received a Variant carrier whose exact source printer is not retained.',
  );
}

/** Godot 3.6 `TEXT_STR`: stringify one or more Variants and concatenate without a separator. */
export function godotStr3(args: readonly unknown[]): string {
  if (args.length < 1)
    throw new TypeError('godot-compat: Godot 3 str requires at least one argument.');
  return args.map(godot3String).join('');
}

function variantText(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(variantText).join(', ')}]`;
  if (value instanceof Map)
    return `{${[...value].map(([key, entry]) => `${variantText(key)}: ${variantText(entry)}`).join(', ')}}`;
  if (typeof value === 'object' && value !== null) {
    const keys = Object.keys(value);
    return `{${keys.map((key) => `${JSON.stringify(key)}: ${variantText(Reflect.get(value, key))}`).join(', ')}}`;
  }
  return godotString(value);
}

function parseVariantText(text: string): unknown {
  const normalized = text
    .replace(/\bnan\b/g, 'null')
    .replace(/\binf\b/g, '1e999')
    .replace(/\b-inf\b/g, '-1e999');
  try {
    return JSON.parse(normalized);
  } catch {
    return null;
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: every branch is one pinned Variant type tag.
function variantType(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'boolean') return 1;
  if (typeof value === 'number' || typeof value === 'bigint')
    return Number.isInteger(Number(value)) ? 2 : 3;
  if (typeof value === 'string') return 4;
  if (isGodotNodePath(value)) return 22;
  if (value instanceof Map) return 27;
  if (Array.isArray(value)) {
    const marker = Object.getOwnPropertySymbols(value).find(
      (symbol) => symbol.description === 'godot-packed-array-kind',
    );
    if (marker !== undefined) {
      const kind = Reflect.get(value, marker) as string;
      return (
        (
          {
            byte: 29,
            int32: 30,
            int64: 31,
            float32: 32,
            float64: 33,
            string: 34,
            vector2: 35,
            vector3: 36,
            color: 37,
            vector4: 38,
          } as Record<string, number>
        )[kind] ?? 28
      );
    }
    return 28;
  }
  if (typeof value === 'function') return 25;
  if (typeof value === 'object') {
    if ('r' in value && 'g' in value && 'b' in value && 'a' in value) return 20;
    if ('w' in value && 'x' in value && 'y' in value && 'z' in value) return 12;
    if ('z' in value && 'x' in value && 'y' in value) return 9;
    if ('x' in value && 'y' in value) return 5;
    if ('id' in value && typeof Reflect.get(value, 'id') === 'bigint') return 23;
    return 24;
  }
  return 0;
}

function typeConvert(value: unknown, type: number): unknown {
  switch (type) {
    case 0:
      return null;
    case 1:
      return Boolean(value);
    case 2:
      return integer(value);
    case 3:
      return number(value);
    case 4:
    case 21:
      return godotString(value);
    case 22:
      return isGodotNodePath(value)
        ? godotNodePathNew(value)
        : godotNodePathNew(godotString(value));
    case 23:
      return godotRidFromInt64(value);
    case 27:
      return value instanceof Map ? value : new Map();
    case 28:
      return Array.isArray(value) ? [...value] : [];
    case 29:
      return packedByteArray(Array.isArray(value) ? value : []);
    case 31:
      return packedInt64Array(Array.isArray(value) ? value : []);
    default:
      return value;
  }
}

function objectId(value: object): bigint {
  const current = INSTANCE_IDS.get(value);
  if (current !== undefined) return current;
  const id = nextInstanceId++;
  INSTANCE_IDS.set(value, id);
  INSTANCES.set(id, new WeakRef(value));
  return id;
}

function godotIsInstanceOf(
  value: unknown,
  type: unknown,
  services?: GodotBuiltinServices,
): boolean {
  if (typeof type === 'function') return value instanceof type;
  if (typeof type !== 'string') return false;
  const fromRuntime = services?.isInstanceOf?.(value, type);
  if (fromRuntime !== undefined) return fromRuntime;
  if (value === null || value === undefined) return false;
  const builtin = TYPE_NAMES.indexOf(type as (typeof TYPE_NAMES)[number]);
  if (builtin >= 0 && builtin !== 24) return variantType(value) === builtin;
  if (typeof value !== 'object' && typeof value !== 'function') return false;
  const declared = Reflect.get(value, '__godotClass');
  if (declared === type) return true;
  return type === 'Object';
}

function godotHash(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number' && Number.isInteger(value)) {
    let mixed = BigInt.asUintN(64, BigInt(value));
    mixed = BigInt.asUintN(64, ~mixed + (mixed << 18n));
    mixed ^= mixed >> 31n;
    mixed = BigInt.asUintN(64, mixed * 21n);
    mixed ^= mixed >> 11n;
    mixed = BigInt.asUintN(64, mixed + (mixed << 6n));
    mixed ^= mixed >> 22n;
    return Number(BigInt.asUintN(32, mixed));
  }
  const bytes = new TextEncoder().encode(variantText(value));
  let hash = 5381;
  for (const byte of bytes) hash = ((hash * 33) ^ byte) >>> 0;
  return hash;
}

function range(args: readonly unknown[]): number[] {
  const [start, stop, step] =
    args.length === 1
      ? [0, integer(args[0]), 1]
      : [integer(args[0]), integer(args[1]), args.length > 2 ? integer(args[2]) : 1];
  if (step === 0) throw new RangeError('godot-compat: range step cannot be zero');
  const output: number[] = [];
  if (step > 0) for (let value = start; value < stop; value += step) output.push(value);
  else for (let value = start; value > stop; value += step) output.push(value);
  return output;
}

function printBuiltin(
  name: string,
  args: readonly unknown[],
  services?: GodotBuiltinServices,
): null {
  const separator = name === 'printt' ? '\t' : name === 'prints' ? ' ' : '';
  const message = args.map(godotString).join(separator);
  if (name === 'print_verbose' && !services?.verbose) return null;
  const level =
    name === 'printerr' || name === 'push_error'
      ? 'error'
      : name === 'push_warning'
        ? 'warning'
        : name === 'print_stack'
          ? 'trace'
          : 'log';
  if (services?.print !== undefined) {
    services.print(level, message);
    return null;
  }
  // biome-ignore lint/suspicious/noConsole: these are Godot's console-print utility functions.
  if (name === 'printraw') console.log(message);
  // biome-ignore lint/suspicious/noConsole: these are Godot's console-print utility functions.
  else if (name === 'printerr' || name === 'push_error') console.error(message);
  // biome-ignore lint/suspicious/noConsole: these are Godot's console-print utility functions.
  else if (name === 'push_warning') console.warn(message);
  // biome-ignore lint/suspicious/noConsole: these are Godot's console-print utility functions.
  else if (name === 'print_stack') console.trace();
  // biome-ignore lint/suspicious/noConsole: these are Godot's console-print utility functions.
  else console.log(message);
  return null;
}

type GodotNumberBuiltin =
  | 'sin'
  | 'cos'
  | 'tan'
  | 'sinh'
  | 'cosh'
  | 'tanh'
  | 'asin'
  | 'acos'
  | 'atan'
  | 'atan2'
  | 'asinh'
  | 'acosh'
  | 'atanh'
  | 'sqrt'
  | 'fmod'
  | 'fposmod'
  | 'posmod'
  | 'pow'
  | 'floorf'
  | 'floori'
  | 'ceilf'
  | 'ceili'
  | 'roundf'
  | 'roundi'
  | 'absf'
  | 'absi'
  | 'signf'
  | 'signi'
  | 'step_decimals'
  | 'ease'
  | 'snappedf'
  | 'snappedi'
  | 'lerpf'
  | 'cubic_interpolate'
  | 'cubic_interpolate_angle'
  | 'cubic_interpolate_in_time'
  | 'cubic_interpolate_angle_in_time'
  | 'bezier_interpolate'
  | 'bezier_derivative'
  | 'angle_difference'
  | 'lerp_angle'
  | 'inverse_lerp'
  | 'remap'
  | 'smoothstep'
  | 'move_toward'
  | 'rotate_toward'
  | 'deg_to_rad'
  | 'rad_to_deg'
  | 'linear_to_db'
  | 'db_to_linear'
  | 'linear2db'
  | 'db2linear'
  | 'stepify'
  | 'wrap'
  | 'wrapi'
  | 'wrapf'
  | 'maxf'
  | 'maxi'
  | 'minf'
  | 'mini'
  | 'clampf'
  | 'clampi'
  | 'nearest_po2'
  | 'pingpong'
  | 'randi'
  | 'randf'
  | 'randfn'
  | 'randi_range'
  | 'randf_range'
  | 'typeof'
  | 'hash'
  | 'len'
  | 'ord'
  | 'rid_allocate_id';
type GodotBooleanBuiltin =
  | 'is_nan'
  | 'is_inf'
  | 'is_equal_approx'
  | 'is_zero_approx'
  | 'is_finite'
  | 'type_exists'
  | 'is_instance_id_valid'
  | 'is_instance_valid'
  | 'is_instance_of'
  | 'is_same';
type GodotStringBuiltin =
  | 'char'
  | 'str'
  | 'error_string'
  | 'type_string'
  | 'var_to_str'
  | 'to_json'
  | 'validate_json';
type GodotNullBuiltin =
  | 'randomize'
  | 'seed'
  | 'assert'
  | 'print'
  | 'print_debug'
  | 'print_rich'
  | 'print_stack'
  | 'print_verbose'
  | 'printerr'
  | 'printraw'
  | 'prints'
  | 'printt'
  | 'push_error'
  | 'push_warning';
type GodotSameValueBuiltin =
  | 'abs'
  | 'floor'
  | 'ceil'
  | 'round'
  | 'sign'
  | 'snapped'
  | 'lerp'
  | 'max'
  | 'min'
  | 'clamp';

/** Call a pinned Godot 4.7 utility. Literal-name overloads preserve emitted TypeScript types. */
export function godotGlobalCall<T>(
  name: GodotSameValueBuiltin,
  args: readonly [T, ...unknown[]],
  services?: GodotBuiltinServices,
): T;
export function godotGlobalCall(
  name: GodotNumberBuiltin,
  args: readonly unknown[],
  services?: GodotBuiltinServices,
): number;
export function godotGlobalCall(
  name: GodotBooleanBuiltin,
  args: readonly unknown[],
  services?: GodotBuiltinServices,
): boolean;
export function godotGlobalCall(
  name: GodotStringBuiltin,
  args: readonly unknown[],
  services?: GodotBuiltinServices,
): string;
export function godotGlobalCall(
  name: GodotNullBuiltin,
  args: readonly unknown[],
  services?: GodotBuiltinServices,
): null;
export function godotGlobalCall(
  name: 'range',
  args: readonly unknown[],
  services?: GodotBuiltinServices,
): number[];
export function godotGlobalCall(
  name: 'rand_from_seed',
  args: readonly unknown[],
  services?: GodotBuiltinServices,
): (number | bigint)[];
export function godotGlobalCall(
  name: 'var_to_bytes' | 'var_to_bytes_with_objects' | 'var2bytes',
  args: readonly unknown[],
  services?: GodotBuiltinServices,
): number[];
export function godotGlobalCall(
  name: 'Color8',
  args: readonly unknown[],
  services?: GodotBuiltinServices,
): Readonly<{ r: number; g: number; b: number; a: number }>;
export function godotGlobalCall(
  name: 'weakref',
  args: readonly unknown[],
  services?: GodotBuiltinServices,
): GodotWeakRef;
export function godotGlobalCall(
  name: 'rid_from_int64',
  args: readonly unknown[],
  services?: GodotBuiltinServices,
): GodotRid;
export function godotGlobalCall<T = unknown>(
  name: string,
  args: readonly unknown[],
  services?: GodotBuiltinServices,
): T;
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: this switch is the source-shaped utility table.
export function godotGlobalCall(
  name: string,
  args: readonly unknown[],
  services?: GodotBuiltinServices,
): unknown {
  const a = (index: number): number => number(args[index]);
  let result: unknown;
  switch (name) {
    case 'sin':
      result = Math.sin(a(0));
      break;
    case 'cos':
      result = Math.cos(a(0));
      break;
    case 'tan':
      result = Math.tan(a(0));
      break;
    case 'sinh':
      result = Math.sinh(a(0));
      break;
    case 'cosh':
      result = Math.cosh(a(0));
      break;
    case 'tanh':
      result = Math.tanh(a(0));
      break;
    case 'asin':
      result = Math.asin(clamp(a(0), -1, 1));
      break;
    case 'acos':
      result = Math.acos(clamp(a(0), -1, 1));
      break;
    case 'atan':
      result = Math.atan(a(0));
      break;
    case 'atan2':
      result = Math.atan2(a(0), a(1));
      break;
    case 'asinh':
      result = Math.asinh(a(0));
      break;
    case 'acosh':
      result = a(0) < 1 ? 0 : Math.acosh(a(0));
      break;
    case 'atanh':
      result =
        a(0) <= -1
          ? Number.NEGATIVE_INFINITY
          : a(0) >= 1
            ? Number.POSITIVE_INFINITY
            : Math.atanh(a(0));
      break;
    case 'sqrt':
      result = Math.sqrt(a(0));
      break;
    case 'fmod':
      result = a(0) % a(1);
      break;
    case 'fposmod':
      result = fposmod(a(0), a(1));
      break;
    case 'posmod':
      result = godotPosmod(a(0), a(1));
      break;
    case 'floor':
      result = mapNumeric(args[0], Math.floor);
      break;
    case 'floorf':
      result = Math.floor(a(0));
      break;
    case 'floori':
      result = godotFloori(a(0));
      break;
    case 'ceil':
      result = mapNumeric(args[0], Math.ceil);
      break;
    case 'ceilf':
      result = Math.ceil(a(0));
      break;
    case 'ceili':
      result = godotCeili(a(0));
      break;
    case 'round':
      result = mapNumeric(args[0], round);
      break;
    case 'roundf':
      result = round(a(0));
      break;
    case 'roundi':
      result = godotRoundi(a(0));
      break;
    case 'abs':
      result = mapNumeric(args[0], Math.abs);
      break;
    case 'absf':
      result = Math.abs(a(0));
      break;
    case 'absi':
      result = godotAbsi(a(0));
      break;
    case 'sign':
      result = mapNumeric(args[0], sign);
      break;
    case 'signf':
      result = sign(a(0));
      break;
    case 'signi':
      result = godotSigni(a(0));
      break;
    case 'snapped':
      result = zipNumeric(args[0], args[1], snapped);
      break;
    case 'snappedf':
      result = snapped(a(0), a(1));
      break;
    case 'snappedi':
      result = godotSnappedi(a(0), a(1));
      break;
    case 'pow':
      result = a(0) ** a(1);
      break;
    case 'log':
      result = Math.log(a(0));
      break;
    case 'exp':
      result = Math.exp(a(0));
      break;
    case 'is_nan':
      result = Number.isNaN(a(0));
      break;
    case 'is_inf':
      result = a(0) === Number.POSITIVE_INFINITY || a(0) === Number.NEGATIVE_INFINITY;
      break;
    case 'is_equal_approx':
      result =
        a(0) === a(1) ||
        Math.abs(a(0) - a(1)) < Math.max(CMP_EPSILON * Math.abs(a(0)), CMP_EPSILON);
      break;
    case 'is_zero_approx':
      result = Math.abs(a(0)) < CMP_EPSILON;
      break;
    case 'is_finite':
      result = Number.isFinite(a(0));
      break;
    case 'ease': {
      const x = clamp(a(0), 0, 1);
      const curve = a(1);
      result =
        curve > 0
          ? curve < 1
            ? 1 - (1 - x) ** (1 / curve)
            : x ** curve
          : curve < 0
            ? x < 0.5
              ? (x * 2) ** -curve * 0.5
              : (1 - (1 - (x - 0.5) * 2) ** -curve) * 0.5 + 0.5
            : 0;
      break;
    }
    case 'step_decimals':
      result = godotStepDecimals(a(0));
      break;
    case 'lerp':
      result = lerpVariant(args[0], args[1], a(2));
      break;
    case 'lerpf':
      result = scalarLerp(a(0), a(1), a(2));
      break;
    case 'cubic_interpolate':
      result = cubic(a(0), a(1), a(2), a(3), a(4));
      break;
    case 'cubic_interpolate_in_time':
      result = cubicTime(a(0), a(1), a(2), a(3), a(4), a(5), a(6), a(7));
      break;
    case 'cubic_interpolate_angle':
      result = cubic(
        a(0),
        a(0) + angleDifference(a(0), a(1)),
        a(0) - angleDifference(a(2), a(0)),
        a(0) + angleDifference(a(0), a(3)),
        a(4),
      );
      break;
    case 'cubic_interpolate_angle_in_time':
      result = cubicTime(
        a(0),
        a(0) + angleDifference(a(0), a(1)),
        a(0) - angleDifference(a(2), a(0)),
        a(0) + angleDifference(a(0), a(3)),
        a(4),
        a(5),
        a(6),
        a(7),
      );
      break;
    case 'bezier_interpolate': {
      const t = a(4);
      const omt = 1 - t;
      result = omt ** 3 * a(0) + 3 * omt ** 2 * t * a(1) + 3 * omt * t ** 2 * a(2) + t ** 3 * a(3);
      break;
    }
    case 'bezier_derivative': {
      const t = a(4);
      const omt = 1 - t;
      result =
        3 * omt ** 2 * (a(1) - a(0)) + 6 * omt * t * (a(2) - a(1)) + 3 * t ** 2 * (a(3) - a(2));
      break;
    }
    case 'angle_difference':
      result = angleDifference(a(0), a(1));
      break;
    case 'lerp_angle':
      result = a(0) + angleDifference(a(0), a(1)) * a(2);
      break;
    case 'inverse_lerp':
      result = (a(2) - a(0)) / (a(1) - a(0));
      break;
    case 'remap':
      result = scalarLerp(a(3), a(4), (a(0) - a(1)) / (a(2) - a(1)));
      break;
    case 'smoothstep': {
      const equal =
        a(0) === a(1) ||
        Math.abs(a(0) - a(1)) < Math.max(CMP_EPSILON * Math.abs(a(0)), CMP_EPSILON);
      if (equal) result = a(0) <= a(1) ? (a(2) <= a(0) ? 0 : 1) : a(2) <= a(1) ? 1 : 0;
      else {
        const x = clamp((a(2) - a(0)) / (a(1) - a(0)), 0, 1);
        result = x * x * (3 - 2 * x);
      }
      break;
    }
    case 'move_toward': {
      const difference = a(1) - a(0);
      result = Math.abs(difference) <= a(2) ? a(1) : a(0) + sign(difference) * a(2);
      break;
    }
    case 'rotate_toward': {
      const difference = angleDifference(a(0), a(1));
      const distance = Math.abs(difference);
      const step = clamp(a(2), distance - Math.PI, distance);
      result = a(0) + step * (difference >= 0 ? 1 : -1);
      break;
    }
    case 'deg_to_rad':
      result = a(0) * (Math.PI / 180);
      break;
    case 'rad_to_deg':
      result = a(0) * (180 / Math.PI);
      break;
    case 'linear_to_db':
    case 'linear2db':
      result = Math.log(a(0)) * 8.685889638065037;
      break;
    case 'db_to_linear':
    case 'db2linear':
      result = Math.exp(a(0) * 0.11512925464970229);
      break;
    case 'stepify':
      result = snapped(a(0), a(1));
      break;
    case 'wrap':
      result =
        Number.isInteger(args[0]) && Number.isInteger(args[1]) && Number.isInteger(args[2])
          ? godotWrapi(a(0), a(1), a(2))
          : wrapf(a(0), a(1), a(2));
      break;
    case 'wrapi':
      result = godotWrapi(a(0), a(1), a(2));
      break;
    case 'wrapf':
      result = wrapf(a(0), a(1), a(2));
      break;
    case 'max':
      result = args
        .slice(1)
        .reduce((best, value) => (number(best) < number(value) ? value : best), args[0]);
      break;
    case 'maxf':
      result = maximum(a(0), a(1));
      break;
    case 'maxi':
      result = godotMaxi(a(0), a(1));
      break;
    case 'min':
      result = args
        .slice(1)
        .reduce((best, value) => (number(best) > number(value) ? value : best), args[0]);
      break;
    case 'minf':
      result = minimum(a(0), a(1));
      break;
    case 'mini':
      result = godotMini(a(0), a(1));
      break;
    case 'clamp':
      result =
        number(args[0]) < number(args[1])
          ? args[1]
          : number(args[0]) > number(args[2])
            ? args[2]
            : args[0];
      break;
    case 'clampf':
      result = clamp(a(0), a(1), a(2));
      break;
    case 'clampi':
      result = godotClampi(a(0), a(1), a(2));
      break;
    case 'nearest_po2': {
      let value = BigInt.asUintN(64, BigInt(integer(args[0])));
      value -= 1n;
      value |= value >> 1n;
      value |= value >> 2n;
      value |= value >> 4n;
      value |= value >> 8n;
      value |= value >> 16n;
      value |= value >> 32n;
      result = Number(BigInt.asUintN(64, value + 1n));
      break;
    }
    case 'pingpong': {
      const length = a(1);
      if (length === 0) result = 0;
      else {
        const scaled = (a(0) - length) / (length * 2);
        result = Math.abs((scaled - Math.floor(scaled)) * length * 2 - length);
      }
      break;
    }
    case 'randomize':
      services?.random?.randomize();
      result = null;
      break;
    case 'randi':
      result = services?.random?.randi();
      break;
    case 'randf':
      result = services?.random?.randf();
      break;
    case 'randfn':
      result = services?.random?.randfn(a(0), a(1));
      break;
    case 'randi_range':
      result = services?.random?.randiRange(a(0), a(1));
      break;
    case 'randf_range':
      result = services?.random?.randRange(a(0), a(1));
      break;
    case 'seed':
      services?.random?.seed(args[0] as number);
      result = null;
      break;
    case 'rand_from_seed':
      result = packedInt64Array(services?.random?.randFromSeed(args[0] as number) ?? [0, 0n]);
      break;
    case 'weakref': {
      result = godotWeakRef(args[0]);
      break;
    }
    case 'typeof':
      result = variantType(args[0]);
      break;
    case 'type_convert':
    case 'convert':
      result = typeConvert(args[0], integer(args[1]));
      break;
    case 'str':
      result = args.map(godotString).join('');
      break;
    case 'error_string':
      result = godotErrorString(a(0));
      break;
    case 'type_string':
      result = TYPE_NAMES[integer(args[0])] ?? '<invalid type>';
      break;
    case 'var_to_str':
      result = variantText(args[0]);
      break;
    case 'str_to_var':
      result = parseVariantText(String(args[0]));
      break;
    case 'var_to_bytes':
    case 'var_to_bytes_with_objects': {
      const allowObjects = name === 'var_to_bytes_with_objects';
      result = godotEncodeVariant(args[0], allowObjects);
      break;
    }
    case 'var2bytes': {
      if (args.length < 1 || args.length > 2)
        throw new TypeError('var2bytes requires value and optional full_objects bool.');
      if (args.length === 2 && typeof args[1] !== 'boolean')
        throw new TypeError('var2bytes full_objects requires bool.');
      result = godotEncodeVariant(args[0], args[1] === true);
      break;
    }
    case 'bytes_to_var':
    case 'bytes_to_var_with_objects':
      result = godotDecodeVariant(
        requirePackedByteArray(args[0], name),
        0,
        name === 'bytes_to_var_with_objects',
      );
      break;
    case 'bytes2var': {
      if (args.length < 1 || args.length > 2)
        throw new TypeError('bytes2var requires bytes and optional allow_objects bool.');
      if (args.length === 2 && typeof args[1] !== 'boolean')
        throw new TypeError('bytes2var allow_objects requires bool.');
      result = godotDecodeVariant(
        requirePackedByteArray(args[0], 'bytes2var'),
        0,
        args[1] === true,
      );
      break;
    }
    case 'parse_json': {
      if (args.length !== 1) throw new TypeError('parse_json requires one String argument.');
      const parsed = godotJSONParse3(args[0]);
      result = parsed.error === 0 ? parsed.result : null;
      break;
    }
    case 'validate_json': {
      if (args.length !== 1) throw new TypeError('validate_json requires one String argument.');
      const json = createGodotJSON();
      result = json.parse(args[0]) === 0 ? '' : json.get_error_message();
      break;
    }
    case 'to_json':
      if (args.length !== 1) throw new TypeError('to_json requires one Variant argument.');
      result = godotJSONPrint3(args[0]);
      break;
    case 'hash':
      result = godotHash(args[0]);
      break;
    case 'instance_from_id':
      result = INSTANCES.get(BigInt(integer(args[0])))?.deref() ?? null;
      break;
    case 'is_instance_id_valid':
      result = INSTANCES.get(BigInt(integer(args[0])))?.deref() !== undefined;
      break;
    case 'is_instance_valid':
      result = typeof args[0] === 'object' && args[0] !== null;
      break;
    case 'rid_allocate_id':
      result = Number(nextRid++);
      break;
    case 'rid_from_int64':
      result = godotRidFromInt64(args[0]);
      break;
    case 'is_same':
      result = Object.is(args[0], args[1]);
      break;
    case 'len':
      result = godotLen(args[0]);
      break;
    case 'char':
      result = godotChar(a(0));
      break;
    case 'ord':
      result = godotOrd(String(args[0]));
      break;
    case 'range':
      result = range(args);
      break;
    case 'Color8':
      result = {
        r: Math.fround(a(0) / 255),
        g: Math.fround(a(1) / 255),
        b: Math.fround(a(2) / 255),
        a: Math.fround((args.length > 3 ? a(3) : 255) / 255),
      };
      break;
    case 'type_exists':
      result = services?.typeExists?.(String(args[0])) ?? BUILTIN_TYPES.has(String(args[0]));
      break;
    case 'is_instance_of':
      result = godotIsInstanceOf(args[0], args[1], services);
      break;
    case 'dict_to_inst':
      result = args[0] instanceof Map ? Object.fromEntries(args[0]) : null;
      break;
    case 'inst_to_dict':
      result =
        typeof args[0] === 'object' && args[0] !== null ? new Map(Object.entries(args[0])) : null;
      break;
    case 'get_stack':
      result = [{ function: '<javascript>', line: 0, source: new Error().stack ?? '' }];
      break;
    case 'load':
    case 'preload':
      result = services?.load?.(String(args[0]));
      break;
    case 'assert':
      if (!args[0]) throw new Error(args.length > 1 ? String(args[1]) : 'Assertion failed.');
      result = null;
      break;
    case 'print':
    case 'print_debug':
    case 'print_rich':
    case 'print_stack':
    case 'print_verbose':
    case 'printerr':
    case 'printraw':
    case 'prints':
    case 'printt':
    case 'push_error':
    case 'push_warning':
      result = printBuiltin(name, args, services);
      break;
    default:
      throw new Error(`godot-compat: unsupported @GDScript.${name}`);
  }
  return result;
}

/** Register a live object for `instance_from_id`; runtime adapters may call this at ownership seams. */
export function godotInstanceId(value: object): bigint {
  return objectId(value);
}

/** Stable RID identity for a real retained native owner such as a Rapier body or server resource. */
export function godotRidOfCarrier(carrier: object): GodotRid {
  const current = RID_BY_CARRIER.get(carrier);
  if (current !== undefined) return current;
  const rid = allocateGodotRid();
  RID_BY_CARRIER.set(carrier, rid);
  CARRIER_BY_RID.set(rid.id, new WeakRef(carrier));
  return rid;
}

/** Resolve only RIDs minted for a retained native carrier; synthetic/server-owner IDs stay opaque. */
export function godotCarrierOfRid(value: unknown): object | undefined {
  const rid = requireGodotRid(value, 'carrier');
  const carrier = CARRIER_BY_RID.get(rid.id)?.deref();
  if (carrier === undefined) CARRIER_BY_RID.delete(rid.id);
  return carrier;
}
