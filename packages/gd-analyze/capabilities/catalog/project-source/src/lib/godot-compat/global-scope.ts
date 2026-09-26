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
 * `sin`, `cos` and `acos` are `std::sin`/`std::cos`/`std::acos` on doubles, which the official
 * macOS build takes from the platform libm: it is not correctly rounded (`sin(4.0)` is one ulp
 * off) and V8's `Math.sin`/`Math.cos`/`Math.acos` differ from it by one ulp on other inputs
 * (`cos(0.1)`, `acos(0.3)`), so they are not transcribed here.
 *
 * The global random number generator is Godot's `static RandomPCG default_rand`
 * (`core/math/math_funcs.cpp:36`), a PCG32 (`thirdparty/misc/pcg.cpp`), held here as module state.
 */

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
 * record (a built-in value) are not Objects. Freed Objects are not represented, so a freed Object
 * is not recognised.
 *
 * @godot @GlobalScope.is_instance_valid
 * @source core/variant/variant_utility.cpp:1133
 */
export function is_instance_valid(instance: unknown): boolean {
  if (typeof instance !== 'object' || instance === null) return false;
  if (Array.isArray(instance) || instance instanceof Map) return false;
  if (Object.getPrototypeOf(instance) === Object.prototype && Object.isFrozen(instance)) return false;
  return true;
}

/**
 * `lerpf(from, to, weight)` for `int` or `float` endpoints (`core/variant/variant_utility.cpp:474`).
 *
 * @godot @GlobalScope.lerp
 * @source core/variant/variant_utility.cpp:445
 */
export function lerp(from: unknown, to: unknown, weight: number): number {
  return lerpDouble(requireNumber('lerp', from), requireNumber('lerp', to), weight);
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
 * `RandomPCG::randomize` (`core/math/random_pcg.cpp:42`): seed from
 * `(unix time + ticks usec) * state + PCG_DEFAULT_INC_64`. The host clock supplies both times.
 *
 * @godot @GlobalScope.randomize
 * @source core/variant/variant_utility.cpp:776
 */
export function randomize(): void {
  const unixTime = BigInt(Math.floor(Date.now() / 1000));
  const ticksUsec = BigInt(Math.floor(globalThis.performance.now() * 1000));
  seedPcg(((unixTime + ticksUsec) * pcg.state + PCG_DEFAULT_INC_64) & U64);
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
