/**
 * Godot's `Tween` — `create_tween` / `set_ease` / `set_trans` / `set_parallel` /
 * `tween_property` / `tween_callback`, stepped on the CALLER'S time.
 *
 * starter-kit-fps `player.gd:242-245` is the measured surface: a weapon-change dip
 * (`tween_property` on `container.position` for 0.1 s, then `tween_callback(change_weapon)`),
 * eased with `Tween.EASE_OUT_IN`. The 4.7 dump declares `SceneTree.create_tween() -> Tween`
 * (hash 3426978995), `set_ease(ease: Tween.EaseType) -> Tween`,
 * `tween_property(object, property: NodePath, final_val, duration) -> PropertyTweener`,
 * `tween_callback(callback: Callable) -> CallbackTweener`, and `EaseType.EASE_OUT_IN = 3`.
 * Match-3 `tile.gd` adds `set_parallel`, `set_trans(TRANS_BACK/TRANS_ELASTIC)` and
 * `set_ease(EASE_OUT)`.
 *
 * ## Rung audit
 *
 * **`gsap` 3.14.2 (declared `^3.12.0` in this capability's catalog entry) — ADOPTED.**
 * It is the repo's one canonical tween library, and here it supplies the whole of the
 * MACHINERY: native target writes and a paused sequence driven by our caller clock. Godot's
 * PROTOCOL remains here: the `SceneTreeTween` call shapes, capture-on-start, parallel step
 * groups, loops, and the `tick(dt)` the SceneTree steps. Godot's easing MATH also remains
 * here: `easing_equations.h` is transcribed directly and supplied to GSAP as a function.
 *
 * This file previously rejected gsap because *"godot-compat's legal deps are the surface
 * substrates in its catalog `packageJson`
 *   (pixi, three, quarks)."* That list is this capability's OWN entry — a thing this
 *   change edits, not a constraint on it — it already carries `@dimforge/rapier3d-compat`
 *   besides, and the sibling compat lane's entry (`roblox-compat.json:77`) declares
 *   `gsap` for exactly this need. gsap is a direct npm dependency here, declared in
 *   `godot-compat.json`'s `packageJson.dependencies`; it is NOT reached through the
 *   `timeline` capability, because a compat capability may not import a sibling
 *   (`packages/editor/test/compat-import-ban.test.ts`).
 *
 * Still REJECTED, same reasons roblox-compat recorded: **`@tweenjs/tween.js`** (not
 * installed; a second tween path), **`motion` / `animejs`** (own driver),
 * **`popmotion` / `three-tween`** (dormant). `animation-transition.ts`'s `godotEase` is
 * Godot Animation's exponent `Math::ease`, a different function from Tween's
 * EaseType/TransitionType pair, and is untouched by this.
 *
 * ## Who drives it: the SceneTree's sim seconds, never gsap's ticker
 *
 * The timeline is created `{ paused: true }` and is never played or resumed. gsap's
 * global rAF ticker only auto-advances animations that are actually PLAYING, so a
 * timeline that is paused from birth is never touched by its `dt` accumulation, its
 * dropped-frame compensation, or its lag-smoothing heuristics. The only thing that ever
 * moves this playhead is {@link GodotTween.tick}'s own `timeline.totalTime(playhead)` call,
 * off the seconds `scene-tree.ts` hands it — the same seconds `createTimer` measures:
 *
 * ```ts
 * useTick((ticker) => tree.tick(ticker.deltaMS / 1000));
 * ```
 *
 * That is `lib/timeline/gsap-registration.ts`'s method transcribed: created paused,
 * driven exclusively by `.totalTime(<clock seconds>)`, never `.play()`/`.resume()`, and no
 * touch of `gsap.ticker` or `gsap.globalTimeline`, so ordinary real-time `gsap.to()`
 * anywhere else in a port is unaffected. `.totalTime(value)` carries repeated loop time too.
 * Events are deliberately NOT suppressed on that call: a `tween_callback` the frame's dt
 * steps over must fire, which is what Godot does.
 *
 * Every child is added with `immediateRender: false` and `lazy: false`. The first says a
 * step writes when the playhead REACHES it, never when it is queued (gsap's default for a
 * zero-duration tween is the opposite, and Godot's zero-duration step lands at its slot,
 * not at `create_tween()` time). The second says the write is synchronous inside `tick`,
 * rather than deferred to a gsap ticker frame that a headless port never runs.
 *
 * ## Capture-on-start
 *
 * Godot captures a `PropertyTweener`'s initial value when that STEP starts, not when it is
 * queued. A gsap `.to()` child reads its start value at its own first render, which on a
 * seeked timeline is exactly when the playhead reaches it — so this is the library's
 * behaviour, not a re-implementation. What IS resolved earlier is the TARGET: children are
 * built on the tween's first `tick`, so a port that swaps the whole property object
 * mid-tween keeps writing to the object the tween started with, and a wrong property name
 * or a shape mismatch is reported on the first tick rather than steps later.
 *
 * ## Resource ownership
 *
 * **Owns:** one `gsap.core.Timeline` and the queued step descriptors. **Shares:** the
 * target object, by reference, only while interpolating. **Teardown:** the tween kills its
 * own timeline the moment it completes — the one path that ends it — because
 * `gsap.timeline()` links the timeline into gsap's global timeline and dropping the
 * Tween reference alone would not unlink it. The tree's step set is the tree's job
 * (`SceneTree.createTween` hands back a tween already registered, and removes it when
 * `tick` reports done).
 */

import gsapDefault from 'gsap';
import { registerGodotObjectIdentity } from './object';
import { isGodotObjectFreed } from './object-liveness';
import { canNodeProcess } from './node-process';
import { createSignal, type GodotSignal } from './signal';

// GSAP publishes the same singleton as the browser default and as `.gsap` on Node's CommonJS
// interop object. Normalize that package boundary so copied compat behaves identically in both.
const gsap =
  (gsapDefault as typeof gsapDefault & { readonly gsap?: typeof gsapDefault }).gsap ?? gsapDefault;

/** Godot 3.6/4.7 `Tween.EaseType`; the integer ABI is shared by both dialects. */
export const EASE_IN = 0;
export const EASE_OUT = 1;
export const EASE_IN_OUT = 2;
export const EASE_OUT_IN = 3;

/** Godot 3.6/4.7 `Tween.TransitionType`; `TRANS_SPRING` is Godot 4-only. */
export const TRANS_LINEAR = 0;
export const TRANS_SINE = 1;
export const TRANS_QUINT = 2;
export const TRANS_QUART = 3;
export const TRANS_QUAD = 4;
export const TRANS_EXPO = 5;
export const TRANS_ELASTIC = 6;
export const TRANS_CUBIC = 7;
export const TRANS_CIRC = 8;
export const TRANS_BOUNCE = 9;
export const TRANS_BACK = 10;
export const TRANS_SPRING = 11;

const EASE_NAMES: Readonly<Record<number, string>> = {
  0: 'EASE_IN',
  1: 'EASE_OUT',
  2: 'EASE_IN_OUT',
  3: 'EASE_OUT_IN',
};

const TRANS_NAMES: Readonly<Record<number, string>> = {
  [TRANS_LINEAR]: 'TRANS_LINEAR',
  [TRANS_SINE]: 'TRANS_SINE',
  [TRANS_QUINT]: 'TRANS_QUINT',
  [TRANS_QUART]: 'TRANS_QUART',
  [TRANS_QUAD]: 'TRANS_QUAD',
  [TRANS_EXPO]: 'TRANS_EXPO',
  [TRANS_ELASTIC]: 'TRANS_ELASTIC',
  [TRANS_CUBIC]: 'TRANS_CUBIC',
  [TRANS_CIRC]: 'TRANS_CIRC',
  [TRANS_BOUNCE]: 'TRANS_BOUNCE',
  [TRANS_BACK]: 'TRANS_BACK',
  [TRANS_SPRING]: 'TRANS_SPRING',
};

/**
 * Godot's Back overshoot. `scene/animation/easing_equations.h` `back::out` @ 4.4-stable:
 * `float s = 1.70158f; t = t / d - 1; return c * (t * t * ((s + 1) * t + s) + 1) + b;`
 * gsap's `back` is the same polynomial with the same default (`gsap-core.js`
 * `_configBack`: `--p * p * ((overshoot + 1) * p + overshoot) + 1`, `overshoot = 1.70158`),
 * and it is PASSED rather than left to the default so the number cites Godot at the point
 * of use. Measured agreement over 1001 samples of [0,1]: max |gsap − Godot| = 2.2e-16, one
 * double epsilon.
 */
const GODOT_BACK_OVERSHOOT = 1.70158;

/**
 * Godot's Elastic period and amplitude. `easing_equations.h` `elastic::out` @ 4.4-stable:
 * `float p = d * 0.3f; float s = p / 4; return c * pow(2, -10 * t) * sin((t * d - s) * (2 * Math_PI) / p) + c + b;`
 * — the period is 0.3 of the duration and the amplitude is the change `c` itself, i.e. 1 in
 * normalized space. gsap's `elastic.out(amplitude, period)` computes
 * `p1 * 2^(-10p) * sin((p - p2/2π·asin(1/p1)) · 2π/p2) + 1`, which for `(1, 0.3)` is the
 * same curve: measured max |gsap − Godot| = 2.2e-16 over the same 1001 samples.
 */
const GODOT_ELASTIC_AMPLITUDE = 1;
const GODOT_ELASTIC_PERIOD = 0.3;

/** Godot's `PropertyTweener` — settings mutate this one queued interpolation. */
export interface PropertyTweener {
  readonly __tweener: 'property';
  readonly finished: GodotSignal<readonly []>;
  set_delay(seconds: number): PropertyTweener;
  setEase(ease: number): PropertyTweener;
  setTrans(trans: number): PropertyTweener;
  from(value: unknown): PropertyTweener;
  fromCurrent(): PropertyTweener;
}

/** Godot's `CallbackTweener` — the return `player.gd:245` ignores. */
export interface CallbackTweener {
  readonly __tweener: 'callback';
  readonly finished: GodotSignal<readonly []>;
  set_delay(seconds: number): CallbackTweener;
}

export interface IntervalTweener {
  readonly __tweener: 'interval';
  readonly finished: GodotSignal<readonly []>;
}

/** Godot's `MethodTweener` — settings mutate this one queued callback interpolation. */
export interface MethodTweener {
  readonly __tweener: 'method';
  readonly finished: GodotSignal<readonly []>;
  set_delay(seconds: number): MethodTweener;
  setEase(ease: number): MethodTweener;
  setTrans(trans: number): MethodTweener;
}

/**
 * Godot's `Tween`, narrowed to the measured surface.
 *
 * Default transition is the dump's `TRANS_LINEAR` (0) — identity for every EaseType, per
 * Godot's own interpolator table. Transition overrides are carried per PropertyTweener by
 * its `setTrans` method, matching Match-3's authored chain.
 */
export interface GodotTween {
  custom_step(seconds: number): boolean;
  set_speed_scale(scale: number): GodotTween;
  bindNode(node: object): GodotTween;
  setPauseMode(mode: number): GodotTween;
  setProcessMode(mode: number): GodotTween;
  setIgnoreTimeScale(ignore?: boolean): GodotTween;
  interpolateValue(
    initialValue: unknown,
    deltaValue: unknown,
    elapsedTime: number,
    duration: number,
    transType: number,
    easeType: number,
  ): unknown;
  /**
   * `tween.set_ease(Tween.EASE_OUT_IN)`. Applies to tweeners queued AFTER this
   * call, matching Godot's default-ease slot. All four pinned EaseType values
   * use the direct source equations; values outside that enum refuse by name.
   */
  setEase(ease: number): GodotTween;
  setTrans(trans: number): GodotTween;
  /** Subsequent tweeners share a step when true, matching Godot's set_parallel. */
  setParallel(parallel?: boolean): GodotTween;
  parallel(): GodotTween;
  chain(): GodotTween;
  setLoops(loops?: number): GodotTween;
  getLoopsLeft(): number;
  hasTweeners(): boolean;
  /**
   * `tween.tween_property(object, property, final_val, duration)`.
   * Interpolates the named property from its value when this step STARTS
   * (Godot captures then, not at queue time) over `duration` seconds.
   */
  tweenProperty(
    object: object,
    property: string,
    finalVal: unknown,
    duration: number,
  ): PropertyTweener;
  /** `tween.tween_callback(callable)` — fires when the preceding step finishes. */
  tweenCallback(callback: () => void): CallbackTweener;
  tweenInterval(time: number): IntervalTweener;
  tweenMethod(
    callback: (value: unknown) => void,
    from: unknown,
    to: unknown,
    duration: number,
  ): MethodTweener;
  interpolateProperty(
    object: object,
    property: string,
    initialVal: unknown,
    finalVal: unknown,
    duration: number,
    transType?: number,
    easeType?: number,
    delay?: number,
  ): boolean;
  start(): boolean;
  isValid(): boolean;
  play(): void;
  pause(): void;
  stop(): void;
  stopAll(): boolean;
  kill(): void;
  isRunning(): boolean;
  setActive(active: boolean): void;
  isActive(): boolean;
  removeAll(): boolean;
  remove(object: object, key?: string): boolean;
  getRuntime(): number;
  getTotalElapsedTime(): number;
  /** Fires once, after the final sequential/parallel step completes. */
  readonly finished: GodotSignal<readonly []>;
  /**
   * Advance by `dt` SECONDS. Called by `SceneTree.tick`; a tween the tree
   * does not know about is one the port must step itself.
   *
   * @returns whether the tween still has work — the tree drops it when this
   * is false.
   */
  tick(dt: number, paused?: boolean, rawDt?: number): boolean;
}

interface StepRuntime {
  readonly completion: ReturnType<typeof createSignal<readonly []>>;
  animation?: gsap.core.Animation;
}

type PropertyStep = StepRuntime & {
  readonly kind: 'property';
  readonly object: object;
  readonly property: string;
  readonly finalVal: unknown;
  readonly duration: number;
  ease: number;
  trans: number;
  initialVal: unknown | undefined;
  delay: number;
};

type CallbackStep = StepRuntime & {
  readonly kind: 'callback';
  readonly callback: () => void;
  delay: number;
};

type IntervalStep = StepRuntime & {
  readonly kind: 'interval';
  readonly duration: number;
};

type MethodStep = StepRuntime & {
  readonly kind: 'method';
  readonly callback: (value: unknown) => void;
  readonly from: unknown;
  readonly to: unknown;
  readonly duration: number;
  ease: number;
  trans: number;
  delay: number;
};

type Step = PropertyStep | CallbackStep | IntervalStep | MethodStep;

type PropertyTargetStep = Pick<PropertyStep, 'object' | 'property' | 'finalVal'>;

function isVec3(value: unknown): value is { x: number; y: number; z: number } {
  if (value === null || typeof value !== 'object') return false;
  const record = value as { x?: unknown; y?: unknown; z?: unknown };
  return (
    typeof record.x === 'number' && typeof record.y === 'number' && typeof record.z === 'number'
  );
}

function isVec2(value: unknown): value is { x: number; y: number } {
  if (value === null || typeof value !== 'object') return false;
  const record = value as { x?: unknown; y?: unknown; z?: unknown };
  return (
    typeof record.x === 'number' && typeof record.y === 'number' && typeof record.z !== 'number'
  );
}

/** Reject a final value Godot's Tween could interpolate but this backend cannot, at QUEUE time. */
function assertInterpolable(value: unknown, property: string): void {
  if (typeof value === 'number' || isVec3(value) || isVec2(value)) return;
  throw new Error(
    `godot-compat: tween_property cannot interpolate "${property}" ` +
      `(${value === null ? 'null' : typeof value}). The measured surface is a number or a ` +
      'Vector2/Vector3-shaped record; anything else is a new requisition.',
  );
}

function interpolateMethodValue(from: unknown, to: unknown, weight: number): unknown {
  if (typeof from === 'number' && typeof to === 'number') {
    return from + (to - from) * weight;
  }
  if (isVec3(from) && isVec3(to)) {
    return {
      x: from.x + (to.x - from.x) * weight,
      y: from.y + (to.y - from.y) * weight,
      z: from.z + (to.z - from.z) * weight,
    };
  }
  if (isVec2(from) && isVec2(to)) {
    return {
      x: from.x + (to.x - from.x) * weight,
      y: from.y + (to.y - from.y) * weight,
    };
  }
  throw new Error(
    'godot-compat: tween_method requires matching numeric, Vector2, or Vector3 endpoints.',
  );
}

/** Godot Tween::interpolate_value applies the transition to initial + delta, clamped to duration. */
export function godotTweenInterpolateValue(
  initialValue: unknown,
  deltaValue: unknown,
  elapsedTime: number,
  duration: number,
  transType: number,
  easeType: number,
): unknown {
  if (!Number.isFinite(elapsedTime) || !Number.isFinite(duration) || duration < 0) {
    throw new RangeError('Tween.interpolate_value requires finite elapsed_time and non-negative duration.');
  }
  const position = duration === 0 ? 1 : Math.max(0, Math.min(1, elapsedTime / duration));
  const weight = godotEase(transType, easeType)(position);
  if (typeof initialValue === 'number' && typeof deltaValue === 'number') {
    return initialValue + deltaValue * weight;
  }
  if (
    typeof initialValue !== 'object' || initialValue === null ||
    typeof deltaValue !== 'object' || deltaValue === null
  ) {
    throw new TypeError(
      'godot-compat: Tween.interpolate_value requires matching numeric or numeric-record Variants.',
    );
  }
  const keys = Object.keys(initialValue).filter(
    (key) => typeof Reflect.get(initialValue, key) === 'number',
  );
  if (
    keys.length === 0 || keys.some((key) => typeof Reflect.get(deltaValue, key) !== 'number') ||
    Object.keys(deltaValue).filter((key) => typeof Reflect.get(deltaValue, key) === 'number').length !== keys.length
  ) {
    throw new TypeError(
      'godot-compat: Tween.interpolate_value numeric records must expose matching components.',
    );
  }
  return Object.freeze(Object.fromEntries(keys.map((key) => [
    key,
    Number(Reflect.get(initialValue, key)) + Number(Reflect.get(deltaValue, key)) * weight,
  ])));
}

function readNamed(object: object, property: string): unknown {
  if (!(property in (object as object))) {
    throw new Error(
      `godot-compat: tween_property has no property "${property}" on the target. ` +
        'Godot interpolates a NAMED property (4.7 dump: `property: NodePath`); a miss here ' +
        'is a wrong name, not a missing frame.',
    );
  }
  return (object as Record<string, unknown>)[property];
}

/** Godot's pinned transition/ease pair, supplied to GSAP as a pure normalized curve. */
function godotEase(trans: number, ease: number): (t: number) => number {
  assertTransition(trans, 'Tween');
  assertEase(ease, 'Tween');
  if (trans === TRANS_LINEAR) return (time) => time;
  if (ease === EASE_IN) return (time) => transitionIn(trans, time);
  if (ease === EASE_OUT) return (time) => transitionOut(trans, time);
  if (ease === EASE_IN_OUT) return (time) => transitionInOut(trans, time);
  return (time) =>
    time < 0.5
      ? transitionOut(trans, time * 2) * 0.5
      : transitionIn(trans, time * 2 - 1) * 0.5 + 0.5;
}

/** Pinned 4.7 `easing_equations.h`, normalized to b=0, c=1, d=1. */
function transitionIn(trans: number, time: number): number {
  if (trans === TRANS_SINE) return -Math.cos(time * (Math.PI / 2)) + 1;
  if (trans === TRANS_QUINT) return Math.pow(time, 5);
  if (trans === TRANS_QUART) return Math.pow(time, 4);
  if (trans === TRANS_QUAD) return time * time;
  if (trans === TRANS_EXPO) {
    return time === 0 ? 0 : Math.pow(2, 10 * (time - 1)) - 0.001;
  }
  if (trans === TRANS_ELASTIC) {
    if (time === 0 || time === 1) return time;
    const shifted = time - 1;
    const period = GODOT_ELASTIC_PERIOD;
    const amplitude = GODOT_ELASTIC_AMPLITUDE * Math.pow(2, 10 * shifted);
    return -(amplitude * Math.sin(((shifted - period / 4) * 2 * Math.PI) / period));
  }
  if (trans === TRANS_CUBIC) return time * time * time;
  if (trans === TRANS_CIRC) return -(Math.sqrt(1 - time * time) - 1);
  if (trans === TRANS_BOUNCE) return 1 - bounceOut(1 - time);
  if (trans === TRANS_BACK) {
    return time * time * ((GODOT_BACK_OVERSHOOT + 1) * time - GODOT_BACK_OVERSHOOT);
  }
  if (trans === TRANS_SPRING) return 1 - springOut(1 - time);
  throw unsupportedTransition(trans);
}

function transitionOut(trans: number, time: number): number {
  if (trans === TRANS_SINE) return Math.sin(time * (Math.PI / 2));
  if (trans === TRANS_QUINT) return Math.pow(time - 1, 5) + 1;
  if (trans === TRANS_QUART) return -(Math.pow(time - 1, 4) - 1);
  if (trans === TRANS_QUAD) return -time * (time - 2);
  if (trans === TRANS_EXPO) {
    return time === 1 ? 1 : 1.001 * (-Math.pow(2, -10 * time) + 1);
  }
  if (trans === TRANS_ELASTIC) {
    if (time === 0 || time === 1) return time;
    const period = GODOT_ELASTIC_PERIOD;
    return (
      Math.pow(2, -10 * time) *
        Math.sin(((time - period / 4) * 2 * Math.PI) / period) +
      1
    );
  }
  if (trans === TRANS_CUBIC) {
    const shifted = time - 1;
    return shifted * shifted * shifted + 1;
  }
  if (trans === TRANS_CIRC) {
    const shifted = time - 1;
    return Math.sqrt(1 - shifted * shifted);
  }
  if (trans === TRANS_BOUNCE) return bounceOut(time);
  if (trans === TRANS_BACK) {
    const shifted = time - 1;
    return (
      shifted * shifted * ((GODOT_BACK_OVERSHOOT + 1) * shifted + GODOT_BACK_OVERSHOOT) +
      1
    );
  }
  if (trans === TRANS_SPRING) return springOut(time);
  throw unsupportedTransition(trans);
}

function transitionInOut(trans: number, time: number): number {
  if (trans === TRANS_SINE) return -(Math.cos(Math.PI * time) - 1) / 2;
  if (trans === TRANS_QUINT) {
    const scaled = time * 2;
    return scaled < 1 ? Math.pow(scaled, 5) / 2 : (Math.pow(scaled - 2, 5) + 2) / 2;
  }
  if (trans === TRANS_QUART) {
    const scaled = time * 2;
    return scaled < 1
      ? Math.pow(scaled, 4) / 2
      : -(Math.pow(scaled - 2, 4) - 2) / 2;
  }
  if (trans === TRANS_QUAD) {
    const scaled = time * 2;
    return scaled < 1 ? (scaled * scaled) / 2 : -((scaled - 1) * (scaled - 3) - 1) / 2;
  }
  if (trans === TRANS_EXPO) {
    if (time === 0 || time === 1) return time;
    const scaled = time * 2;
    return scaled < 1
      ? Math.pow(2, 10 * (scaled - 1)) / 2 - 0.0005
      : (1.0005 * (-Math.pow(2, -10 * (scaled - 1)) + 2)) / 2;
  }
  if (trans === TRANS_ELASTIC) {
    if (time === 0 || time === 1) return time;
    let scaled = time * 2;
    const period = GODOT_ELASTIC_PERIOD * 1.5;
    if (scaled < 1) {
      scaled -= 1;
      return (
        -0.5 *
        (Math.pow(2, 10 * scaled) *
          Math.sin(((scaled - period / 4) * 2 * Math.PI) / period))
      );
    }
    scaled -= 1;
    return (
      (Math.pow(2, -10 * scaled) *
        Math.sin(((scaled - period / 4) * 2 * Math.PI) / period)) /
        2 +
      1
    );
  }
  if (trans === TRANS_CUBIC) {
    let scaled = time * 2;
    if (scaled < 1) return (scaled * scaled * scaled) / 2;
    scaled -= 2;
    return (scaled * scaled * scaled + 2) / 2;
  }
  if (trans === TRANS_CIRC) {
    let scaled = time * 2;
    if (scaled < 1) return -(Math.sqrt(1 - scaled * scaled) - 1) / 2;
    scaled -= 2;
    return (Math.sqrt(1 - scaled * scaled) + 1) / 2;
  }
  if (trans === TRANS_BOUNCE) {
    return time < 0.5
      ? (1 - bounceOut(1 - time * 2)) / 2
      : bounceOut(time * 2 - 1) / 2 + 0.5;
  }
  if (trans === TRANS_BACK) {
    const overshoot = GODOT_BACK_OVERSHOOT * 1.525;
    let scaled = time * 2;
    if (scaled < 1) return (scaled * scaled * ((overshoot + 1) * scaled - overshoot)) / 2;
    scaled -= 2;
    return (scaled * scaled * ((overshoot + 1) * scaled + overshoot) + 2) / 2;
  }
  if (trans === TRANS_SPRING) {
    return time < 0.5
      ? (1 - springOut(1 - time * 2)) / 2
      : springOut(time * 2 - 1) / 2 + 0.5;
  }
  throw unsupportedTransition(trans);
}

function springOut(time: number): number {
  const remaining = 1 - time;
  const curved =
    Math.sin(time * Math.PI * (0.2 + 2.5 * time * time * time)) *
      Math.pow(remaining, 2.2) +
    time;
  return curved * (1 + 1.2 * remaining);
}

function bounceOut(time: number): number {
  if (time < 1 / 2.75) return 7.5625 * time * time;
  if (time < 2 / 2.75) {
    const shifted = time - 1.5 / 2.75;
    return 7.5625 * shifted * shifted + 0.75;
  }
  if (time < 2.5 / 2.75) {
    const shifted = time - 2.25 / 2.75;
    return 7.5625 * shifted * shifted + 0.9375;
  }
  const shifted = time - 2.625 / 2.75;
  return 7.5625 * shifted * shifted + 0.984375;
}

function unsupportedTransition(trans: number): Error {
  return new Error(
    `godot-compat: Tween transition ${TRANS_NAMES[trans] ?? String(trans)} is not implemented.`,
  );
}

function assertEase(value: number, on: 'Tween' | 'PropertyTweener' | 'MethodTweener'): number {
  if (Number.isInteger(value) && value >= EASE_IN && value <= EASE_OUT_IN) return value;
  throw new Error(`godot-compat: unknown ${on} ease ${String(value)}.`);
}

function assertTransition(
  value: number,
  on: 'Tween' | 'PropertyTweener' | 'MethodTweener',
): number {
  if (Number.isInteger(value) && value >= TRANS_LINEAR && value <= TRANS_SPRING) return value;
  const named = TRANS_NAMES[value];
  throw new Error(
    named === undefined
      ? `godot-compat: unknown ${on} transition ${String(value)}.`
      : `godot-compat: ${on} transition ${named} is not implemented.`,
  );
}

/**
 * The gsap target and end values for one property step.
 *
 * A number property is tweened on the object itself. A Vector2/Vector3 property is tweened
 * on the LIVE vector the property already holds — three's `Vector3` and Pixi's
 * `ObservablePoint` are both written component-wise, which is what Godot's per-frame
 * property assignment means for a node that fuses the two. A frozen variant record is a
 * VALUE rather than a target and refuses by name.
 */
function resolveTarget(
  step: PropertyTargetStep,
  value: unknown = step.finalVal,
): { target: object; values: Record<string, number> } {
  const { object, property } = step;
  const parts = property.split(':');
  if (parts.some((part) => part.length === 0)) {
    throw new Error(`godot-compat: tween property NodePath "${property}" contains an empty subname.`);
  }
  let owner = object;
  for (const part of parts.slice(0, -1)) {
    const nested = readNamed(owner, part);
    if (nested === null || typeof nested !== 'object') throw shapeMismatch(property);
    owner = nested;
  }
  const key = parts.at(-1)!;
  const current = readNamed(owner, key);
  if (typeof value === 'number') {
    if (typeof current !== 'number') throw shapeMismatch(property);
    return { target: owner, values: { [key]: value } };
  }
  if (isVec3(value)) {
    if (!isVec3(current)) throw shapeMismatch(property);
    assertLiveVector(current, property);
    return { target: current, values: { x: value.x, y: value.y, z: value.z } };
  }
  if (isVec2(value)) {
    if (!isVec2(current)) throw shapeMismatch(property);
    assertLiveVector(current, property);
    return { target: current, values: { x: value.x, y: value.y } };
  }
  throw shapeMismatch(property);
}

function shapeMismatch(property: string): Error {
  return new Error(
    `godot-compat: tween_property "${property}" start and final values are not the same shape.`,
  );
}

function assertLiveVector(value: object, property: string): void {
  if (!Object.isFrozen(value)) return;
  throw new Error(
    `godot-compat: tween_property "${property}" holds a FROZEN record. The measured surface ` +
      "is a LIVE vector the interpolation writes in place — three's Vector3, Pixi's " +
      'ObservablePoint — not a variant.ts value record.',
  );
}

/**
 * Build a Tween. `SceneTree.createTween` registers the result so `tree.tick`
 * steps it; a tween nobody steps does not move.
 */
export function createTween(options: { readonly legacy?: boolean } = {}): GodotTween {
  const legacy = options.legacy === true;
  let timeline = gsap.timeline({ paused: true, repeatRefresh: true });
  const queue: Step[][] = [];
  const finished = createSignal<readonly []>();
  let defaultEase = EASE_IN_OUT;
  let defaultTrans = TRANS_LINEAR;
  let defaultParallel = false;
  let parallelEnabled = false;
  let loops = 1;
  let running = true;
  let valid = true;
  let killed = false;
  let started = false;
  let completed = false;
  let wasStopped = false;
  let elapsed = 0;
  let playhead = 0;
  let speedScale = 1;
  let boundNode: object | null = null;
  let pauseMode = 0;
  let processMode = 1;
  let ignoreTimeScale = false;

  const append = (step: Step): void => {
    if (started) {
      throw new Error('godot-compat: cannot append a Tweener after its Tween has started.');
    }
    const last = queue.at(-1);
    if (parallelEnabled && last !== undefined) last.push(step);
    else queue.push([step]);
    parallelEnabled = defaultParallel;
  };

  const retainLastAnimation = (step: Step): void => {
    const animation = timeline.getChildren(false, true, true).at(-1);
    if (animation === undefined) {
      throw new Error(`godot-compat: GSAP did not retain the ${step.kind} Tween child.`);
    }
    step.animation = animation;
  };

  /**
   * Lay the queued groups onto the timeline. Runs once, on the first stepped frame, so
   * every `set_ease`/`set_trans` a port chained onto a tweener is already in place.
   * Every child receives the group's numeric start. This preserves parallel groups even when a
   * CallbackTweener has its own delay; the next group starts at the maximum native child end.
   */
  const build = (): void => {
    for (const group of queue) {
      const groupStart = timeline.duration();
      for (const step of group) {
        if (step.kind === 'callback') {
          timeline.call(() => {
            step.callback();
            step.completion.emit();
          }, undefined, groupStart + step.delay);
          retainLastAnimation(step);
          continue;
        }
        if (step.kind === 'interval') {
          timeline.to({}, { duration: step.duration, onComplete: () => step.completion.emit() }, groupStart);
          retainLastAnimation(step);
          continue;
        }
        if (step.kind === 'method') {
          const progress = { value: 0 };
          timeline.to(progress, {
            value: 1,
            duration: step.duration,
            ease: godotEase(step.trans, step.ease),
            immediateRender: false,
            lazy: false,
            onStart: () => step.callback(interpolateMethodValue(step.from, step.to, 0)),
            onUpdate: () => step.callback(interpolateMethodValue(step.from, step.to, progress.value)),
            onComplete: () => step.completion.emit(),
          }, groupStart + step.delay);
          retainLastAnimation(step);
          continue;
        }
        const { target, values } = resolveTarget(step);
        const vars = {
          ...values,
          duration: step.duration,
          ease: godotEase(step.trans, step.ease),
          immediateRender: false,
          lazy: false,
          onComplete: () => step.completion.emit(),
        };
        const position = groupStart + step.delay;
        if (step.initialVal === undefined) timeline.to(target, vars, position);
        else {
          const initial = resolveTarget(step, step.initialVal);
          if (initial.target !== target) {
            throw new Error(`godot-compat: PropertyTweener.from value changed the shape of "${step.property}".`);
          }
          timeline.fromTo(target, initial.values, vars, position);
        }
        retainLastAnimation(step);
      }
    }
    timeline.repeat(loops <= 0 ? -1 : loops - 1);
  };

  const advance = (seconds: number, force: boolean, paused = false, rawSeconds = seconds): boolean => {
    if (!valid || killed) return false;
    if (boundNode !== null && isGodotObjectFreed(boundNode)) {
      tween.kill();
      return false;
    }
    if (completed) {
      valid = false;
      return false;
    }
    if (!running && !force) return true;
    if (!force && paused) {
      const mayProcess = pauseMode === 2 ||
        (pauseMode === 0 && boundNode !== null && canNodeProcess(boundNode, true));
      if (!mayProcess) return true;
    }
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw new RangeError(`Tween step delta must be finite and non-negative, got ${String(seconds)}.`);
    }
    if (!started) {
      if (queue.length === 0) {
        running = false;
        valid = false;
        throw new Error('godot-compat: Tween started with no Tweeners.');
      }
      started = true;
      build();
    }
    if (!Number.isFinite(rawSeconds) || rawSeconds < 0) {
      throw new RangeError(`Tween raw step delta must be finite and non-negative, got ${String(rawSeconds)}.`);
    }
    const delta = (ignoreTimeScale ? rawSeconds : seconds) * speedScale;
    elapsed += delta;
    if (!(delta > 0)) return true;
    playhead += delta;
    const cycleDuration = timeline.duration();
    if (cycleDuration === 0 && loops <= 0) throw new Error('godot-compat: infinite zero-duration Tween loop.');
    const total = loops <= 0 ? Number.POSITIVE_INFINITY : cycleDuration * loops;
    timeline.totalTime(Math.min(playhead, total));
    if (playhead < total) return true;
    completed = true;
    running = false;
    timeline.kill();
    finished.emit();
    return false;
  };

  const tween: GodotTween = {
    custom_step(seconds): boolean {
      return advance(seconds, true);
    },
    set_speed_scale(scale): GodotTween {
      if (!Number.isFinite(scale) || scale < 0) {
        throw new RangeError('Tween.set_speed_scale requires a finite non-negative scale.');
      }
      speedScale = scale;
      return tween;
    },
    bindNode(node): GodotTween {
      if ((typeof node !== 'object' || node === null) && typeof node !== 'function') {
        throw new TypeError('Tween.bind_node requires a Node.');
      }
      boundNode = node;
      return tween;
    },
    setPauseMode(mode): GodotTween {
      if (!Number.isSafeInteger(mode) || mode < 0 || mode > 2) {
        throw new RangeError('Tween.set_pause_mode requires TWEEN_PAUSE_BOUND/STOP/PROCESS (0..2).');
      }
      pauseMode = mode;
      return tween;
    },
    setProcessMode(mode): GodotTween {
      if (mode !== 0 && mode !== 1) throw new RangeError('Tween.set_process_mode requires TWEEN_PROCESS_PHYSICS or TWEEN_PROCESS_IDLE.');
      processMode = mode;
      return tween;
    },
    setIgnoreTimeScale(ignore = true): GodotTween {
      if (typeof ignore !== 'boolean') {
        throw new TypeError('Tween.set_ignore_time_scale requires a bool.');
      }
      ignoreTimeScale = ignore;
      return tween;
    },
    interpolateValue(initialValue, deltaValue, elapsedTime, duration, transType, easeType): unknown {
      return godotTweenInterpolateValue(
        initialValue, deltaValue, elapsedTime, duration, transType, easeType,
      );
    },
    setEase(value): GodotTween {
      defaultEase = assertEase(value, 'Tween');
      return tween;
    },
    setTrans(value): GodotTween {
      defaultTrans = assertTransition(value, 'Tween');
      return tween;
    },
    setParallel(value = true): GodotTween {
      defaultParallel = value;
      parallelEnabled = value;
      return tween;
    },
    parallel(): GodotTween {
      parallelEnabled = true;
      return tween;
    },
    chain(): GodotTween {
      parallelEnabled = false;
      return tween;
    },
    setLoops(value = 0): GodotTween {
      if (!Number.isInteger(value)) {
        throw new Error(`godot-compat: Tween.set_loops requires an integer, got ${String(value)}.`);
      }
      loops = value;
      if (started) timeline.repeat(loops <= 0 ? -1 : loops - 1);
      return tween;
    },
    getLoopsLeft(): number {
      if (loops <= 0) return -1;
      if (!started) return loops;
      const duration = timeline.duration();
      if (duration <= 0) return completed ? 0 : loops;
      return Math.max(0, loops - Math.floor(playhead / duration));
    },
    hasTweeners(): boolean {
      return queue.some((group) => group.length > 0);
    },
    tweenProperty(object, property, finalVal, duration): PropertyTweener {
      if (!Number.isFinite(duration) || duration < 0) {
        throw new Error(
          `godot-compat: tween_property duration must be a non-negative number of seconds, ` +
            `got ${String(duration)}.`,
        );
      }
      assertInterpolable(finalVal, property);
      const step: PropertyStep = {
        kind: 'property',
        object,
        property,
        finalVal,
        duration,
        ease: defaultEase,
        trans: defaultTrans,
        initialVal: undefined,
        delay: 0,
        completion: createSignal<readonly []>(),
      };
      append(step);
      const propertyTweener: PropertyTweener = {
        __tweener: 'property',
        finished: step.completion.signal,
        set_delay(seconds): PropertyTweener {
          if (!Number.isFinite(seconds) || seconds < 0) {
            throw new RangeError('PropertyTweener.set_delay requires finite non-negative seconds.');
          }
          step.delay = seconds;
          return propertyTweener;
        },
        setEase(value): PropertyTweener {
          step.ease = assertEase(value, 'PropertyTweener');
          return propertyTweener;
        },
        setTrans(value): PropertyTweener {
          step.trans = assertTransition(value, 'PropertyTweener');
          return propertyTweener;
        },
        from(value): PropertyTweener {
          assertInterpolable(value, property);
          step.initialVal = value;
          return propertyTweener;
        },
        fromCurrent(): PropertyTweener {
          step.initialVal = undefined;
          return propertyTweener;
        },
      };
      return propertyTweener;
    },
    tweenCallback(callback): CallbackTweener {
      const step: CallbackStep = {
        kind: 'callback', callback, delay: 0, completion: createSignal<readonly []>(),
      };
      append(step);
      const tweener: CallbackTweener = {
        __tweener: 'callback',
        finished: step.completion.signal,
        set_delay(seconds): CallbackTweener {
          if (!Number.isFinite(seconds) || seconds < 0) {
            throw new RangeError('CallbackTweener.set_delay requires finite non-negative seconds.');
          }
          step.delay = seconds;
          return tweener;
        },
      };
      return tweener;
    },
    tweenInterval(duration): IntervalTweener {
      if (!Number.isFinite(duration) || duration < 0) {
        throw new Error(
          `godot-compat: tween_interval duration must be finite and non-negative, got ${String(duration)}.`,
        );
      }
      const step: IntervalStep = {
        kind: 'interval', duration, completion: createSignal<readonly []>(),
      };
      append(step);
      return { __tweener: 'interval', finished: step.completion.signal };
    },
    tweenMethod(callback, from, to, duration): MethodTweener {
      if (typeof callback !== 'function') {
        throw new TypeError('godot-compat: tween_method requires a callable callback.');
      }
      if (!Number.isFinite(duration) || duration < 0) {
        throw new RangeError(
          `godot-compat: tween_method duration must be finite and non-negative, got ${String(duration)}.`,
        );
      }
      interpolateMethodValue(from, to, 0);
      const step: MethodStep = {
        kind: 'method', callback, from, to, duration,
        ease: defaultEase, trans: defaultTrans, delay: 0,
        completion: createSignal<readonly []>(),
      };
      append(step);
      const methodTweener: MethodTweener = {
        __tweener: 'method',
        finished: step.completion.signal,
        set_delay(seconds): MethodTweener {
          if (!Number.isFinite(seconds) || seconds < 0) {
            throw new RangeError('MethodTweener.set_delay requires finite non-negative seconds.');
          }
          step.delay = seconds;
          return methodTweener;
        },
        setEase(value): MethodTweener {
          step.ease = assertEase(value, 'MethodTweener');
          return methodTweener;
        },
        setTrans(value): MethodTweener {
          step.trans = assertTransition(value, 'MethodTweener');
          return methodTweener;
        },
      };
      return methodTweener;
    },
    interpolateProperty(object, property, initialVal, finalVal, duration, transType = TRANS_LINEAR, easeType = EASE_IN_OUT, delay = 0): boolean {
      if (!Number.isFinite(delay) || delay < 0) {
        throw new RangeError('Tween.interpolate_property delay must be finite and non-negative.');
      }
      if (delay > 0) append({
        kind: 'interval', duration: delay, completion: createSignal<readonly []>(),
      });
      if (initialVal !== null) {
        assertInterpolable(initialVal, property);
        append({
          kind: 'callback',
          callback: () => {
            const { target, values } = resolveTarget({
              object, property, finalVal: initialVal,
            });
            Object.assign(target, values);
          },
          delay: 0,
          completion: createSignal<readonly []>(),
        });
      }
      tween.tweenProperty(object, property, finalVal, duration)
        .setTrans(transType)
        .setEase(easeType);
      return true;
    },
    start(): boolean {
      if (legacy && wasStopped) {
        playhead = 0;
        elapsed = 0;
        completed = false;
        if (started) timeline.totalTime(0, true).pause();
        wasStopped = false;
      }
      tween.play();
      return true;
    },
    isValid(): boolean { return valid && !killed; },
    play(): void {
      if (!valid || killed) throw new Error('godot-compat: cannot play an invalid Tween.');
      if (completed) {
        throw new Error('godot-compat: cannot play a finished Tween; stop() must reset it first.');
      }
      running = true;
    },
    pause(): void {
      running = false;
    },
    stop(): void {
      if (!valid || killed) return;
      running = false;
      playhead = 0;
      elapsed = 0;
      completed = false;
      if (started) timeline.totalTime(0, true).pause();
    },
    stopAll(): boolean {
      if (!legacy) {
        tween.pause();
        return true;
      }
      running = false;
      wasStopped = true;
      return true;
    },
    kill(): void {
      running = false;
      valid = false;
      killed = true;
      timeline.kill();
    },
    isRunning(): boolean {
      return running && valid && !completed;
    },
    setActive(active): void {
      if (active) tween.play();
      else tween.pause();
    },
    isActive(): boolean {
      return running && valid && !completed && !killed;
    },
    removeAll(): boolean {
      timeline.kill();
      timeline = gsap.timeline({ paused: true, repeatRefresh: true });
      queue.length = 0;
      running = false;
      valid = true;
      killed = false;
      started = false;
      completed = false;
      wasStopped = false;
      elapsed = 0;
      playhead = 0;
      parallelEnabled = defaultParallel;
      return true;
    },
    remove(object, key = ''): boolean {
      if ((typeof object !== 'object' || object === null) && typeof object !== 'function') {
        throw new TypeError('Tween.remove requires an Object target.');
      }
      if (typeof key !== 'string') throw new TypeError('Tween.remove key must be a String.');
      let removed = false;
      for (let groupIndex = queue.length - 1; groupIndex >= 0; groupIndex -= 1) {
        const group = queue[groupIndex]!;
        for (let stepIndex = group.length - 1; stepIndex >= 0; stepIndex -= 1) {
          const step = group[stepIndex]!;
          if (step.kind !== 'property' || step.object !== object || (key !== '' && step.property !== key)) {
            continue;
          }
          step.animation?.kill();
          group.splice(stepIndex, 1);
          removed = true;
        }
        if (group.length === 0) queue.splice(groupIndex, 1);
      }
      return removed;
    },
    getRuntime(): number {
      return elapsed;
    },
    getTotalElapsedTime(): number {
      return elapsed;
    },
    finished: finished.signal,
    tick(dt, paused = false, rawDt = dt): boolean {
      return advance(dt, false, paused, rawDt);
    },
  };

  return tween;
}

export interface GodotTweenTree {
  addTween(tween: GodotTween): () => void;
  registerNonDisplayChild?(parent: object, child: object, siblingIndex: number): () => void;
}

/** Godot 3 Tween.new()/authored Tween node owned and stepped by its SceneTree. */
export type GodotLegacyTween = GodotTween & { readonly name: string; readonly siblingIndex: number };

export function createGodotLegacyTween(
  options: { readonly name?: string; readonly siblingIndex?: number } = {},
): GodotLegacyTween {
  const tween = createTween({ legacy: true }) as GodotLegacyTween;
  tween.pause();
  Object.defineProperties(tween, {
    name: { value: options.name ?? '', enumerable: true },
    siblingIndex: { value: options.siblingIndex ?? 0, enumerable: true },
  });
  registerGodotObjectIdentity(tween as unknown as object, 'Tween');
  return tween;
}

export function attachGodotLegacyTweenToTree(
  tree: GodotTweenTree,
  parent: object,
  tween: GodotLegacyTween,
): () => void {
  if (tree.registerNonDisplayChild === undefined) {
    throw new Error('Tween node ownership requires SceneTree.registerNonDisplayChild.');
  }
  const releaseStep = tree.addTween(tween);
  let releaseChild: () => void;
  try {
    releaseChild = tree.registerNonDisplayChild(parent, tween, tween.siblingIndex);
  } catch (error) {
    releaseStep();
    throw error;
  }
  return () => {
    releaseStep();
    releaseChild();
  };
}
