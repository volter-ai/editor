/**
 * Godot 4.7's integer-specialized `@GDScript` scalar utilities.
 *
 * Generated TypeScript keeps one call per source call while this module owns the exact rounding,
 * signed-remainder, zero-range, and zero-divisor behavior. This keeps language-to-TypeScript
 * lowering small and leaves reusable Godot semantics in compat.
 *
 * Authority: Godot 4.7-stable at `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`:
 * `core/variant/variant_utility.cpp` (signatures/dispatch), `core/math/math_funcs.h`
 * (`posmod`, `wrapi`, scalar primitives), and `core/math/math_funcs.cpp` (`snapped`,
 * `step_decimals`).
 *
 * Godot integers are signed 64-bit values. The translation target currently stores them as
 * JavaScript numbers, so values outside JavaScript's exact integer domain refuse loudly rather
 * than silently rounding a different integer.
 */

function requireTranslatedInteger(value: number, utility: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(
      `${utility} requires an exactly represented Godot integer; received ${String(value)}.`,
    );
  }
}

function requireFiniteNumber(value: number, utility: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${utility} requires a finite number; received ${String(value)}.`);
  }
}

function exactIntegerResult(value: number, utility: string): number {
  requireTranslatedInteger(value, utility);
  return Object.is(value, -0) ? 0 : value;
}

/** `absi(x)` — `Math::abs(int64_t)`. */
export function godotAbsi(x: number): number {
  requireTranslatedInteger(x, 'absi');
  return Math.abs(x);
}

/** `ceili(x)` — `int64_t(Math::ceil(x))`. */
export function godotCeili(x: number): number {
  requireFiniteNumber(x, 'ceili');
  return exactIntegerResult(Math.ceil(x), 'ceili');
}

/** `clampi(value, min, max)` — Godot's ordered `CLAMP` template. */
export function godotClampi(value: number, min: number, max: number): number {
  requireTranslatedInteger(value, 'clampi');
  requireTranslatedInteger(min, 'clampi');
  requireTranslatedInteger(max, 'clampi');
  return value < min ? min : value > max ? max : value;
}

/** `floori(x)` — `int64_t(Math::floor(x))`. */
export function godotFloori(x: number): number {
  requireFiniteNumber(x, 'floori');
  return exactIntegerResult(Math.floor(x), 'floori');
}

/** `maxi(a, b)` — Godot's `MAX` template, including its ordered comparison. */
export function godotMaxi(a: number, b: number): number {
  requireTranslatedInteger(a, 'maxi');
  requireTranslatedInteger(b, 'maxi');
  return a > b ? a : b;
}

/** `mini(a, b)` — Godot's `MIN` template, including its ordered comparison. */
export function godotMini(a: number, b: number): number {
  requireTranslatedInteger(a, 'mini');
  requireTranslatedInteger(b, 'mini');
  return a < b ? a : b;
}

/**
 * `posmod(x, y)` — remainder with the divisor's sign. Godot reports an engine error for a zero
 * divisor and returns `0`; the observable result is kept without manufacturing a logging channel.
 */
export function godotPosmod(x: number, y: number): number {
  requireTranslatedInteger(x, 'posmod');
  requireTranslatedInteger(y, 'posmod');
  if (y === 0) return 0;
  let value = x % y;
  if ((value < 0 && y > 0) || (value > 0 && y < 0)) value += y;
  return exactIntegerResult(value, 'posmod');
}

/** `roundi(x)` — C++ `std::round`, whose exact halves go away from zero. */
export function godotRoundi(x: number): number {
  requireFiniteNumber(x, 'roundi');
  const magnitude = Math.round(Math.abs(x));
  return exactIntegerResult(x < 0 ? -magnitude : magnitude, 'roundi');
}

/** `signi(x)` — `-1`, `0`, or `1`; signed zero returns the integer `0`. */
export function godotSigni(x: number): number {
  requireTranslatedInteger(x, 'signi');
  return x > 0 ? 1 : x < 0 ? -1 : 0;
}

/**
 * `snappedi(x, step)` — `int64_t(Math::snapped(x, step))`.
 *
 * This intentionally uses `floor(x / step + 0.5)`, not `roundi`: Godot's snapping ties point
 * toward positive infinity even though `roundi`'s ties go away from zero. A zero step returns `x`
 * before the exported function's integer conversion, hence the final truncation.
 */
export function godotSnappedi(x: number, step: number): number {
  requireFiniteNumber(x, 'snappedi');
  requireTranslatedInteger(step, 'snappedi');
  const snapped = step === 0 ? x : Math.floor(x / step + 0.5) * step;
  return exactIntegerResult(Math.trunc(snapped), 'snappedi');
}

const STEP_DECIMAL_THRESHOLDS = [
  0.9999,
  0.09999,
  0.009999,
  0.0009999,
  0.00009999,
  0.000009999,
  0.0000009999,
  0.00000009999,
  0.000000009999,
  0.0000000009999,
] as const;

/** `step_decimals(step)` — the exact ten-threshold scan in `Math::step_decimals`. */
export function godotStepDecimals(step: number): number {
  requireFiniteNumber(step, 'step_decimals');
  const absolute = Math.abs(step);
  const decimals = absolute - Math.trunc(absolute);
  for (let index = 0; index < STEP_DECIMAL_THRESHOLDS.length; index += 1) {
    if (decimals >= STEP_DECIMAL_THRESHOLDS[index]!) return index;
  }
  return 0;
}

/** `wrapi(value, min, max)` — wrap into `[min, max)`, with a zero range returning `min`. */
export function godotWrapi(value: number, min: number, max: number): number {
  requireTranslatedInteger(value, 'wrapi');
  requireTranslatedInteger(min, 'wrapi');
  requireTranslatedInteger(max, 'wrapi');
  const range = max - min;
  requireTranslatedInteger(range, 'wrapi');
  if (range === 0) return min;
  const relative = value - min;
  requireTranslatedInteger(relative, 'wrapi');
  return exactIntegerResult(min + (((relative % range) + range) % range), 'wrapi');
}
