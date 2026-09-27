/**
 * Camera polish — three small pure functions a follow camera keeps
 * re-deriving, and nothing that owns a camera.
 *
 * Every one of these returns numbers. The caller still writes
 * `camera.position.lerp(…)` and `camera.fov = …` itself, because a camera
 * controller that owns the frame is the shape this repo has rejected three
 * times over.
 *
 *  - `pullInBoom` — NEW DESIGN. A third-person boom that clips through a wall
 *    is the oldest bug in the genre and there is no occlusion handling
 *    anywhere in this repo to extract. One ray from the character to where the
 *    boom wants to be; if something is in the way, the camera stops in front
 *    of it. `camera-controls` does this and much more, but it owns the camera
 *    to do it — this is the twenty lines, over the physics world the game
 *    already has.
 *  - `shake` / `stepShake` / `shakeOffset` — a GENERALIZATION with two cited
 *    consumers: both shooters hand-roll the same damage-driven shake
 *    (`look.current.shake`, raised by the damage pulse, decayed at 3.2/s, read
 *    back as `shake * shake * k` on a sine). The quadratic falloff and the
 *    two-frequency wobble are theirs; the duration is the parameter they never
 *    had.
 *  - `frameAim` / `stepAimBlend` — a GENERALIZATION of third-person's hip/aim
 *    pairs (`Player.tsx:114-116`: `CAMERA_DISTANCE`, `CAMERA_SHOULDER`,
 *    `CAMERA_FOV`, plus the inline height and the `MathUtils.damp` on fov). It
 *    interpolates every framing value from one blend scalar, so adding a third
 *    stance is a third framing, not a fourth pair of constants.
 */

import { EXCLUDE_SENSORS, type RapierCollider, type RapierWorld, type RayFactory } from './rapier';

/** A point this module reads. Rapier vectors and `THREE.Vector3` are both one. */
export interface Point3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface BoomInputs {
  /** Where the boom would like the camera to sit, with nothing in the way. */
  readonly desired: Point3;
  /** The character's own collider — the boom starts inside it. */
  readonly exclude?: RapierCollider;
  /** How far in front of the hit surface the camera stops, metres. */
  readonly padding?: number;
  /** `const { rapier } = useRapier()`. */
  readonly rapier: RayFactory;
  /** What the camera looks at — usually the character's head. */
  readonly target: Point3;
  readonly world: RapierWorld;
}

/** Enough that a near-plane does not eat the wall the camera stopped at. */
export const BOOM_PADDING = 0.25;

/**
 * Where the camera can actually sit: `desired`, or the first thing between it
 * and `target`, minus `padding`.
 *
 * Returns a plain point — lerp toward it exactly as you already lerp toward
 * `desired`, or the camera teleports every time a wall passes behind you.
 */
export function pullInBoom(inputs: BoomInputs): Point3 {
  const { desired, target } = inputs;
  const dx = desired.x - target.x;
  const dy = desired.y - target.y;
  const dz = desired.z - target.z;
  const reach = Math.hypot(dx, dy, dz);
  if (reach < 1e-6) return desired;

  const direction = { x: dx / reach, y: dy / reach, z: dz / reach };
  const hit = inputs.world.castRay(
    new inputs.rapier.Ray(target, direction),
    reach,
    true,
    // A trigger volume is not something the camera can hit. Without this the
    // boom yanks in whenever the character walks through a checkpoint or a
    // kill zone — an occlusion pull toward nothing the player can see.
    EXCLUDE_SENSORS,
    undefined,
    inputs.exclude,
  );
  if (!hit) return desired;

  const distance = Math.max(0, hit.timeOfImpact - (inputs.padding ?? BOOM_PADDING));
  return {
    x: target.x + direction.x * distance,
    y: target.y + direction.y * distance,
    z: target.z + direction.z * distance,
  };
}

/** A shake in flight. Carry it in a ref; `SHAKE_IDLE` is rest. */
export interface ShakeState {
  /** Seconds the shake was started with. */
  readonly duration: number;
  /** Peak strength, in whatever units the caller's amplitude is scaled by. */
  readonly intensity: number;
  /** Seconds left. Zero is rest. */
  readonly remaining: number;
}

export const SHAKE_IDLE: ShakeState = { duration: 0, intensity: 0, remaining: 0 };

/**
 * Start a shake — or reinforce one already running.
 *
 * A weaker hit never cuts a stronger shake short (both examples took
 * `Math.max` for exactly this reason), and a stronger one restarts the clock.
 */
export function shake(state: ShakeState, intensity: number, duration: number): ShakeState {
  const strength = Math.max(0, intensity);
  const running = state.duration > 0 ? state.intensity * (state.remaining / state.duration) : 0;
  return strength < running ? state : { duration, intensity: strength, remaining: duration };
}

/** Age a shake. It reaches exactly `SHAKE_IDLE`, never a lingering epsilon. */
export function stepShake(state: ShakeState, dt: number): ShakeState {
  const remaining = state.remaining - dt;
  return remaining <= 0 ? SHAKE_IDLE : { ...state, remaining };
}

export interface ShakeOffsetOptions {
  /** Radians at full strength. */
  readonly amplitude: number;
  /** Radians per second of the wobble. */
  readonly frequency: number;
}

export const SHAKE_OFFSET: ShakeOffsetOptions = { amplitude: 0.018, frequency: 89 };

/**
 * The two rotations to add to the camera this frame.
 *
 * Strength falls off QUADRATICALLY (`progress²`), which is what both examples'
 * `shake * shake` was doing: a shake that fades linearly reads as a rattle
 * that will not stop, and the square puts almost all the motion in the first
 * third of the window. Roll runs at a different frequency and phase from
 * pitch, or the two axes lock into a diagonal.
 */
export function shakeOffset(
  state: ShakeState,
  elapsed: number,
  options: Partial<ShakeOffsetOptions> = {},
): { readonly pitch: number; readonly roll: number } {
  if (state.remaining <= 0 || state.duration <= 0) return { pitch: 0, roll: 0 };
  const { amplitude, frequency } = { ...SHAKE_OFFSET, ...options };
  const progress = state.remaining / state.duration;
  const strength = state.intensity * progress * progress * amplitude;
  return {
    pitch: Math.sin(elapsed * frequency) * strength,
    roll: Math.sin(elapsed * frequency * 0.8 + 0.8) * strength * 0.45,
  };
}

/** One camera stance: where the boom sits and how wide the lens is. */
export interface CameraFraming {
  /** Metres behind the character. */
  readonly distance: number;
  /** Vertical field of view, degrees. */
  readonly fov: number;
  /** Metres above the look-at target. */
  readonly height: number;
  /** Metres to the character's right — the over-the-shoulder offset. */
  readonly shoulder: number;
}

/**
 * Ease the hip↔aim blend toward `aiming`.
 *
 * Exponential, so it is frame-rate independent: the same 0.2 s of real time
 * covers the same ground at 30 fps and at 240.
 */
export function stepAimBlend(blend: number, aiming: boolean, dt: number, rate = 12): number {
  const target = aiming ? 1 : 0;
  return target + (blend - target) * Math.exp(-rate * dt);
}

/** Interpolate every framing value at once. `blend` is clamped to `[0, 1]`. */
export function frameAim(hip: CameraFraming, aim: CameraFraming, blend: number): CameraFraming {
  const t = Math.min(1, Math.max(0, blend));
  return {
    distance: hip.distance + (aim.distance - hip.distance) * t,
    fov: hip.fov + (aim.fov - hip.fov) * t,
    height: hip.height + (aim.height - hip.height) * t,
    shoulder: hip.shoulder + (aim.shoulder - hip.shoulder) * t,
  };
}
