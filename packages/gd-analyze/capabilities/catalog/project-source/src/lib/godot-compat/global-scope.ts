/**
 * @godot-class @GlobalScope
 * @role PROTOCOL
 *
 * Godot 4.7's `@GlobalScope` utility functions, transcribed from `core/variant/variant_utility.cpp`
 * and `core/math/math_funcs.h` at revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`. Their
 * arguments are Variant `int`/`float` (doubles), so there is no `real_t` rounding here.
 *
 * A JS number represents both Godot `int` and `float`. The Variant-typed functions (`abs`, `sign`,
 * `round`, `clamp`, `lerp`, `max`, `min`, `wrap`) give the same number for an int and for an equal
 * float in every case measured; their built-in vector arguments are not transcribed and throw.
 * `str` cannot tell `1` from `1.0` and throws for numbers.
 *
 * `sin`, `cos` and `acos` are `std::sin`/`std::cos`/`std::acos` on doubles: Godot delegates them to
 * the platform C library, whose result differs across Godot's own platforms. The official macOS
 * build's libm is not correctly rounded (`sin(4.0)` is one ulp off) and V8's `Math.sin`/`Math.cos`/
 * `Math.acos` differ from it by one ulp on other inputs (`cos(0.1)`, `acos(0.3)`); their claims are
 * within the platform C library's error, and record the measured distance.
 *
 * The global random number generator is Godot's `static RandomPCG default_rand`
 * (`core/math/math_funcs.cpp:36`), a PCG32 (`thirdparty/misc/pcg.cpp`), held here as module state.
 */

import { godot_node_is_freed } from './node';

const U64 = (1n << 64n) - 1n;
const PCG_MULTIPLIER = 6364136223846793005n;
/** `PCG_DEFAULT_INC_64` (`thirdparty/misc/pcg.h:9`). */
const PCG_DEFAULT_INC_64 = 1442695040888963407n;
/** `RandomPCG::DEFAULT_SEED` (`core/math/random_pcg.h:60`). */
const DEFAULT_SEED = 12047754176567800795n;
const CMP_EPSILON = 0.00001;
const PI = 3.1415926535897932384626433833;
const TAU = 6.2831853071795864769252867666;

/** `pcg32_random_t`: 64-bit state and increment. */
const pcg = { state: 0n, inc: 0n };

/** `pcg32_random_r` (`thirdparty/misc/pcg.cpp:6`): XSH RR output of the old state. */
function pcg32Random(): number {
  const oldstate = pcg.state;
  pcg.state = (oldstate * PCG_MULTIPLIER + (pcg.inc | 1n)) & U64;
  const xorshifted = Number((((oldstate >> 18n) ^ oldstate) >> 27n) & 0xffffffffn);
  const rot = Number(oldstate >> 59n);
  return ((xorshifted >>> rot) | (xorshifted << (-rot & 31))) >>> 0;
}

/** `pcg32_srandom_r` (`thirdparty/misc/pcg.cpp:18`). */
function pcg32Seed(initstate: bigint, initseq: bigint): void {
  pcg.state = 0n;
  pcg.inc = ((initseq << 1n) | 1n) & U64;
  pcg32Random();
  pcg.state = (pcg.state + initstate) & U64;
  pcg32Random();
}

/** `pcg32_boundedrand_r` (`thirdparty/misc/pcg.cpp:30`). */
function pcg32BoundedRand(bound: number): number {
  const threshold = ((0x100000000 - bound) >>> 0) % bound;
  for (;;) {
    const r = pcg32Random();
    if (r >= threshold) return r % bound;
  }
}

/** `RandomPCG::seed` (`core/math/random_pcg.h:65`) with `current_inc = DEFAULT_INC`. */
function seedPcg(value: bigint): void {
  pcg32Seed(value & U64, PCG_DEFAULT_INC_64);
}

seedPcg(DEFAULT_SEED);

/** `CLZ32` (`core/math/random_pcg.h:40`), `__builtin_clz` on a non-zero value. */
function clz32(value: number): number {
  return Math.clz32(value);
}

/**
 * `RandomPCG::randd` (`core/math/random_pcg.h:96`): `ldexp((double)significand, -64 - clz)`, the
 * uint64 significand rounded to double as C++ converts it (nearest, ties to even).
 */
function randd(): number {
  const protoExpOffset = pcg32Random();
  if (protoExpOffset === 0) return 0;
  const high = BigInt(pcg32Random());
  const low = BigInt(pcg32Random());
  const significand = (high << 32n) | low | 0x8000000000000001n;
  return Number(significand) * 2 ** (-64 - clz32(protoExpOffset));
}

function requireNumber(name: string, value: unknown): number {
  if (typeof value !== 'number') {
    throw new TypeError(`godot-compat: @GlobalScope.${name} is transcribed for int and float arguments only.`);
  }
  return value;
}

/** `SIGN` (`core/typedefs.h:137`). */
function signOf(value: number): number {
  return value > 0 ? 1 : value < 0 ? -1 : 0;
}

/** `Math::is_equal_approx(double, double)` (`core/math/math_funcs.h:528`). */
function isEqualApprox(left: number, right: number): boolean {
  if (left === right) return true;
  let tolerance = CMP_EPSILON * Math.abs(left);
  if (tolerance < CMP_EPSILON) tolerance = CMP_EPSILON;
  return Math.abs(left - right) < tolerance;
}

/** `Math::lerp(double, double, double)` (`core/math/math_funcs.h:335`). */
function lerpDouble(from: number, to: number, weight: number): number {
  return from + (to - from) * weight;
}

/** `std::fmod`: JS `%` on numbers is the same IEEE remainder-with-truncation. */
function fmod(x: number, y: number): number {
  return x % y;
}

/**
 * `abs` over `int` and `float` (`Math::abs`).
 *
 * @godot @GlobalScope.abs
 * @source core/variant/variant_utility.cpp:243
 */
export function abs(x: unknown): number {
  return Math.abs(requireNumber('abs', x));
}

/**
 * @godot @GlobalScope.absf
 * @source core/variant/variant_utility.cpp:279
 */
export function absf(x: number): number {
  return Math.abs(x);
}

/**
 * @godot @GlobalScope.atan2
 * @source core/variant/variant_utility.cpp:79
 */
export function atan2(y: number, x: number): number {
  return Math.atan2(y, x);
}

/**
 * `value < min ? min : value`, then `value > max ? max : value`, through Variant comparison.
 *
 * @godot @GlobalScope.clamp
 * @source core/variant/variant_utility.cpp:730
 */
export function clamp(value: unknown, min: unknown, max: unknown): number {
  let result = requireNumber('clamp', value);
  const low = requireNumber('clamp', min);
  const high = requireNumber('clamp', max);
  if (result < low) result = low;
  if (result > high) result = high;
  return result;
}

/**
 * `CLAMP(x, min, max)` (`core/typedefs.h:152`).
 *
 * @godot @GlobalScope.clampf
 * @source core/variant/variant_utility.cpp:762
 */
export function clampf(x: number, min: number, max: number): number {
  return x < min ? min : x > max ? max : x;
}

/**
 * `Math::sin(double)` is `std::sin` (`core/math/math_funcs.h:41`), the platform C library's.
 *
 * @godot @GlobalScope.sin
 * @source core/variant/variant_utility.cpp:43
 */
export function sin(x: number): number {
  return Math.sin(x);
}

/**
 * `Math::cos(double)` is `std::cos` (`core/math/math_funcs.h:48`), the platform C library's.
 *
 * @godot @GlobalScope.cos
 * @source core/variant/variant_utility.cpp:47
 */
export function cos(x: number): number {
  return Math.cos(x);
}

/**
 * `Math::acos(double)` clamps its argument's domain and otherwise is `std::acos`
 * (`core/math/math_funcs.h:106`), the platform C library's.
 *
 * @godot @GlobalScope.acos
 * @source core/variant/variant_utility.cpp:71
 */
export function acos(x: number): number {
  return x < -1 ? PI : x > 1 ? 0 : Math.acos(x);
}

/**
 * `p_y * (PI / 180.0)` (`core/math/math_funcs.h:321`).
 *
 * @godot @GlobalScope.deg_to_rad
 * @source core/variant/variant_utility.cpp:568
 */
export function deg_to_rad(angle: number): number {
  return angle * (PI / 180.0);
}

/**
 * True only for a live Object. An Object's representation is its native entity or script
 * instance; a JS primitive, an Array, a Map (Dictionary), a function (Callable) and a frozen plain
 * record (a built-in value) are not Objects. A freed Object is not valid.
 *
 * @godot @GlobalScope.is_instance_valid
 * @source core/variant/variant_utility.cpp:1133
 */
export function is_instance_valid(instance: unknown): boolean {
  if (typeof instance !== 'object' || instance === null) return false;
  if (Array.isArray(instance) || instance instanceof Map) return false;
  if (Object.getPrototypeOf(instance) === Object.prototype && Object.isFrozen(instance)) return false;
  return !godot_node_is_freed(instance);
}

/**
 * `lerpf(from, to, weight)` for `int` or `float` endpoints (`core/variant/variant_utility.cpp:474`).
 *
 * @godot @GlobalScope.lerp
 * @source core/variant/variant_utility.cpp:445
 */
export function lerp<Value>(from: Value, to: Value, weight: number): Value {
  if (typeof from === 'number') return lerpDouble(from, requireNumber('lerp', to), weight) as Value;
  // A vector or a colour: member by member (`Vector3::lerp`, `Color::lerp`).
  if (typeof from === 'object' && from !== null && typeof to === 'object' && to !== null && Object.isFrozen(from)) {
    const target = to as Readonly<Record<string, unknown>>;
    const members = Object.entries(from as Readonly<Record<string, unknown>>).map(([name, value]) => [name, lerpDouble(requireNumber('lerp', value), requireNumber('lerp', target[name]), weight)] as const);
    return Object.freeze(Object.fromEntries(members)) as Value;
  }
  return lerpDouble(requireNumber('lerp', from), requireNumber('lerp', to), weight) as Value;
}

/**
 * `from + angle_difference(from, to) * weight` (`core/math/math_funcs.h:490`), where
 * `angle_difference` is `fmod(2 * fmod(to - from, TAU), TAU) - fmod(to - from, TAU)` (`:481`).
 *
 * @godot @GlobalScope.lerp_angle
 * @source core/variant/variant_utility.cpp:544
 */
export function lerp_angle(from: number, to: number, weight: number): number {
  const difference = fmod(to - from, TAU);
  const distance = fmod(2.0 * difference, TAU) - difference;
  return from + distance * weight;
}

/**
 * @godot @GlobalScope.lerpf
 * @source core/variant/variant_utility.cpp:510
 */
export function lerpf(from: number, to: number, weight: number): number {
  return lerpDouble(from, to, weight);
}

/**
 * `log(linear) * 8.6858896380650365530225783783321` (`core/math/math_funcs.h:610`).
 *
 * @godot @GlobalScope.linear_to_db
 * @source core/variant/variant_utility.cpp:576
 */
export function linear_to_db(linear: number): number {
  return Math.log(linear) * 8.6858896380650365530225783783321;
}

/**
 * @godot @GlobalScope.log
 * @source core/variant/variant_utility.cpp:335
 */
export function log(x: number): number {
  return Math.log(x);
}

/**
 * The first argument, replaced by each later one it is less than (`OP_LESS`); at least two.
 *
 * @godot @GlobalScope.max
 * @source core/variant/variant_utility.cpp:642
 */
export function max(...args: readonly unknown[]): number {
  if (args.length < 2) throw new TypeError('godot-compat: @GlobalScope.max needs at least 2 arguments.');
  let base = requireNumber('max', args[0]);
  for (let i = 1; i < args.length; i += 1) {
    const next = requireNumber('max', args[i]);
    if (base < next) base = next;
  }
  return base;
}

/**
 * The first argument, replaced by each later one it is greater than (`OP_GREATER`).
 *
 * @godot @GlobalScope.min
 * @source core/variant/variant_utility.cpp:686
 */
export function min(...args: readonly unknown[]): number {
  if (args.length < 2) throw new TypeError('godot-compat: @GlobalScope.min needs at least 2 arguments.');
  let base = requireNumber('min', args[0]);
  for (let i = 1; i < args.length; i += 1) {
    const next = requireNumber('min', args[i]);
    if (base > next) base = next;
  }
  return base;
}

/**
 * `MIN(x, y)` is `x < y ? x : y` (`core/typedefs.h:142`).
 *
 * @godot @GlobalScope.minf
 * @source core/variant/variant_utility.cpp:722
 */
export function minf(x: number, y: number): number {
  return x < y ? x : y;
}

/**
 * A float in `[0, 1]` from the global generator (`Math::randf`, `core/math/math_funcs.cpp:65`).
 *
 * @godot @GlobalScope.randf
 * @source core/variant/variant_utility.cpp:784
 */
export function randf(): number {
  return randd();
}

/**
 * A normally distributed float of `mean` and `deviation` (`RandomPCG::randfn`, the Box-Muller
 * transform, `core/math/random_pcg.h:132`).
 *
 * @godot @GlobalScope.randfn
 * @source core/variant/variant_utility.cpp:800
 */
export function randfn(mean: number, deviation: number): number {
  let u = randd();
  while (u <= 0) u = randd();
  const v = randd();
  return mean + deviation * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * `randd() * (to - from) + from` (`core/math/random_pcg.cpp:71`) on the global generator.
 *
 * @godot @GlobalScope.randf_range
 * @source core/variant/variant_utility.cpp:796
 */
export function randf_range(from: number, to: number): number {
  return randd() * (to - from) + from;
}

/**
 * `Math::rand()`: the next PCG32 output (`core/math/math_funcs.cpp:53`).
 *
 * @godot @GlobalScope.randi
 * @source core/variant/variant_utility.cpp:780
 */
export function randi(): number {
  return pcg32Random();
}

/**
 * `RandomPCG::random(int, int)` (`core/math/random_pcg.cpp:79`) over both bounds narrowed to
 * `int32_t`: inclusive, in either order, through `pcg32_boundedrand_r`.
 *
 * @godot @GlobalScope.randi_range
 * @source core/variant/variant_utility.cpp:792
 */
export function randi_range(from: number, to: number): number {
  const a = from | 0;
  const b = to | 0;
  if (a === b) return a;
  const low = Math.min(a, b);
  const high = Math.max(a, b);
  const diff = (high - low) >>> 0;
  if (diff === 0xffffffff) return pcg32Random() + low;
  return pcg32BoundedRand((diff + 1) >>> 0) + low;
}

/**
 * Reseeds the global generator unpredictably, as Godot's clock-derived seed does
 * (`RandomPCG::randomize`, `core/math/random_pcg.cpp:42`): from the platform's random source.
 *
 * @godot @GlobalScope.randomize
 * @source core/variant/variant_utility.cpp:776
 */
export function randomize(): void {
  seedPcg(globalThis.crypto.getRandomValues(new BigUint64Array(1))[0] as bigint);
}

/**
 * `Math::remap(double...)`: `lerp(ostart, ostop, inverse_lerp(istart, istop, value))`
 * (`core/math/math_funcs.h:504`).
 *
 * @godot @GlobalScope.remap
 * @source core/variant/variant_utility.cpp:552
 */
export function remap(value: number, istart: number, istop: number, ostart: number, ostop: number): number {
  return lerpDouble(ostart, ostop, (value - istart) / (istop - istart));
}

/**
 * `std::round` on a float (half away from zero); an int is returned unchanged.
 *
 * @godot @GlobalScope.round
 * @source core/variant/variant_utility.cpp:199
 */
export function round(x: unknown): number {
  const value = requireNumber('round', x);
  if (!Number.isFinite(value) || value === 0) return value;
  const truncated = Math.trunc(value);
  // `value - truncated` is exact, so no half-way case is misjudged.
  return Math.abs(value - truncated) >= 0.5 ? truncated + Math.sign(value) : truncated;
}

/**
 * `seed(int)`: `RandomPCG::seed` on the global generator, the int reinterpreted as `uint64_t`.
 *
 * @godot @GlobalScope.seed
 * @source core/variant/variant_utility.cpp:800
 */
export function seed(value: number): void {
  seedPcg(BigInt.asUintN(64, BigInt(value)));
}

/**
 * `SIGN` of an int or float (`core/typedefs.h:137`).
 *
 * @godot @GlobalScope.sign
 * @source core/variant/variant_utility.cpp:287
 */
export function sign(x: unknown): number {
  return signOf(requireNumber('sign', x));
}

/**
 * @godot @GlobalScope.signf
 * @source core/variant/variant_utility.cpp:323
 */
export function signf(x: number): number {
  return signOf(x);
}

/**
 * The arguments' `Variant::stringify` (`core/variant/variant.cpp:1597`) concatenated. Transcribed
 * for String (itself), bool (`true`/`false`) and null (`<null>`); a number cannot be told apart
 * as int or float here and throws, as does any other type.
 *
 * @godot @GlobalScope.str
 * @source core/variant/variant_utility.cpp:935
 */
export function str(...args: readonly unknown[]): string {
  if (args.length < 1) throw new TypeError('godot-compat: @GlobalScope.str needs at least 1 argument.');
  return args
    .map((value) => {
      if (typeof value === 'string') return value;
      if (typeof value === 'boolean') return value ? 'true' : 'false';
      if (value === null) return '<null>';
      throw new TypeError(`godot-compat: @GlobalScope.str is not transcribed for a ${typeof value} argument.`);
    })
    .join('');
}

/**
 * `print(...)`: the arguments' text joined with nothing between them, printed as one line
 * (`join_string`, then `print_line`), which on the web is the console's log. Lowering passes each
 * argument as the text `Variant::stringify` gives it for its analysed type, as it does for `str`.
 *
 * @godot @GlobalScope.print
 * @source core/variant/variant_utility.cpp:960
 */
export function print(...args: readonly string[]): void {
  console.log(args.join(''));
}

/**
 * `wrapf` for int or float arguments (`Math::wrapf`, `core/math/math_funcs.h:631`): an empty range
 * gives `min`; a result approximately equal to `max` gives `min`. Godot wraps three ints with
 * `wrapi` over values narrowed to `int` (`core/variant/variant_utility.cpp:615`); for int32 values
 * the two agree, and ints outside int32 are not transcribed.
 *
 * @godot @GlobalScope.wrap
 * @source core/variant/variant_utility.cpp:584
 */
export function wrap(value: unknown, min: unknown, max: unknown): number {
  const x = requireNumber('wrap', value);
  const low = requireNumber('wrap', min);
  const high = requireNumber('wrap', max);
  const range = high - low;
  if (Math.abs(range) < CMP_EPSILON) return low;
  const result = x - range * Math.floor((x - low) / range);
  if (isEqualApprox(result, high)) return low;
  return result;
}

/**
 * `push_error(...)`: the arguments' text joined, reported as an error (`ERR_PRINT`), which on the
 * web is the console's error. Lowering passes each argument as its `Variant::stringify` text.
 *
 * @godot @GlobalScope.push_error
 * @source core/variant/variant_utility.cpp:1017
 */
export function push_error(...args: readonly string[]): void {
  console.error(args.join(''));
}

/**
 * `push_warning(...)`: as `push_error`, reported as a warning (`WARN_PRINT`).
 *
 * @godot @GlobalScope.push_warning
 * @source core/variant/variant_utility.cpp:1027
 */
export function push_warning(...args: readonly string[]): void {
  console.warn(args.join(''));
}

/**
 * `printerr(...)`: the arguments' text joined, printed to the error stream.
 *
 * @godot @GlobalScope.printerr
 * @source core/variant/variant_utility.cpp:981
 */
export function printerr(...args: readonly string[]): void {
  console.error(args.join(''));
}

/**
 * @godot @GlobalScope.exp
 * @source core/variant/variant_utility.cpp:339
 */
export function exp(x: number): number {
  return Math.exp(x);
}

/**
 * @godot @GlobalScope.sqrt
 * @source core/variant/variant_utility.cpp:95
 */
export function sqrt(x: number): number {
  return Math.sqrt(x);
}

/**
 * @godot @GlobalScope.pow
 * @source core/variant/variant_utility.cpp:331
 */
export function pow(x: number, y: number): number {
  return Math.pow(x, y);
}

/**
 * @godot @GlobalScope.tan
 * @source core/variant/variant_utility.cpp:51
 */
export function tan(x: number): number {
  return Math.tan(x);
}

/**
 * `floor` of an int or float (an int is itself); vectors are not bound.
 *
 * @godot @GlobalScope.floor
 * @source core/variant/variant_utility.cpp:111
 */
export function floor(x: unknown): number {
  return Math.floor(requireNumber('floor', x));
}

/**
 * @godot @GlobalScope.floorf
 * @source core/variant/variant_utility.cpp:147
 */
export function floorf(x: number): number {
  return Math.floor(x);
}

/**
 * @godot @GlobalScope.floori
 * @source core/variant/variant_utility.cpp:151
 */
export function floori(x: number): number {
  return Math.floor(x);
}

/**
 * `ceil` of an int or float (an int is itself); vectors are not bound.
 *
 * @godot @GlobalScope.ceil
 * @source core/variant/variant_utility.cpp:155
 */
export function ceil(x: unknown): number {
  return Math.ceil(requireNumber('ceil', x));
}

/**
 * @godot @GlobalScope.ceilf
 * @source core/variant/variant_utility.cpp:191
 */
export function ceilf(x: number): number {
  return Math.ceil(x);
}

/**
 * @godot @GlobalScope.ceili
 * @source core/variant/variant_utility.cpp:195
 */
export function ceili(x: number): number {
  return Math.ceil(x);
}

/**
 * `Math::round` rounds half away from zero.
 *
 * @godot @GlobalScope.roundi
 * @source core/variant/variant_utility.cpp:239
 */
export function roundi(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x));
}

/**
 * @godot @GlobalScope.absi
 * @source core/variant/variant_utility.cpp:283
 */
export function absi(x: number): number {
  return Math.abs(x);
}

/**
 * @godot @GlobalScope.signi
 * @source core/variant/variant_utility.cpp:327
 */
export function signi(x: number): number {
  return Math.sign(x);
}

/**
 * @godot @GlobalScope.maxi
 * @source core/variant/variant_utility.cpp:682
 */
export function maxi(x: number, y: number): number {
  return Math.max(x, y);
}

/**
 * @godot @GlobalScope.maxf
 * @source core/variant/variant_utility.cpp:678
 */
export function maxf(x: number, y: number): number {
  return x > y ? x : y;
}

/**
 * @godot @GlobalScope.mini
 * @source core/variant/variant_utility.cpp:726
 */
export function mini(x: number, y: number): number {
  return Math.min(x, y);
}

/**
 * `CLAMP(x, min, max)`: below `min` gives `min`, then above `max` gives `max`.
 *
 * @godot @GlobalScope.clampi
 * @source core/variant/variant_utility.cpp:766
 */
export function clampi(x: number, min: number, max: number): number {
  return x < min ? min : x > max ? max : x;
}

/**
 * @godot @GlobalScope.is_zero_approx
 * @source core/variant/variant_utility.cpp:355
 */
export function is_zero_approx(x: number): boolean {
  return Math.abs(x) < CMP_EPSILON;
}

/**
 * @godot @GlobalScope.is_equal_approx
 * @source core/variant/variant_utility.cpp:351
 */
export function is_equal_approx(x: number, y: number): boolean {
  return isEqualApprox(x, y);
}

/**
 * @godot @GlobalScope.move_toward
 * @source core/variant/variant_utility.cpp:560
 */
export function move_toward(from: number, to: number, delta: number): number {
  return Math.abs(to - from) <= delta ? to : from + signOf(to - from) * delta;
}

/**
 * `Math::wrapi`: an empty range gives `min`.
 *
 * @godot @GlobalScope.wrapi
 * @source core/variant/variant_utility.cpp:630
 */
export function wrapi(value: number, min: number, max: number): number {
  const range = max - min;
  return range === 0 ? min : min + ((((value - min) % range) + range) % range);
}

/**
 * @godot @GlobalScope.fposmod
 * @source core/variant/variant_utility.cpp:103
 */
export function fposmod(x: number, y: number): number {
  let value = x % y;
  if ((value < 0 && y > 0) || (value > 0 && y < 0)) value += y;
  return value;
}

/**
 * @godot @GlobalScope.posmod
 * @source core/variant/variant_utility.cpp:107
 */
export function posmod(x: number, y: number): number {
  let value = x % y;
  if ((value < 0 && y > 0) || (value > 0 && y < 0)) value += y;
  return value;
}

/**
 * @godot @GlobalScope.rad_to_deg
 * @source core/variant/variant_utility.cpp:572
 */
export function rad_to_deg(angle_rad: number): number {
  return angle_rad * (180 / PI);
}
