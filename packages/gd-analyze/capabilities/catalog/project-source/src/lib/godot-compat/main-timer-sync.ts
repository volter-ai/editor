/**
 * @godot-class MainTimerSync
 * @role PROTOCOL
 *
 * Godot 4.7's `MainTimerSync` (`main/main_timer_sync.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): how `Main::iteration` turns the wall clock into a
 * process step and a number of physics steps. The wall-clock delta goes through the delta
 * smoother (the web display server always reports vsync enabled, `display_server_web.cpp:1465`, so
 * smoothing runs when `application/run/delta_smoothing` is on), then `advance_checked` and
 * `advance_core` keep the physics step count consistent over the last 12 frames within the
 * physics jitter fix. `--fixed-fps` (Godot's command-line flag) replaces the measured step.
 * Integer arithmetic is `int64_t` in Godot and exact in doubles at these magnitudes.
 */

import { get_setting } from './project-settings';

/** `CONTROL_STEPS` (`main/main_timer_sync.h:112`). */
const CONTROL_STEPS = 12;
/** `MEASURE_FPS_OVER_NUM_FRAMES` (`main/main_timer_sync.h:62`). */
const MEASURE_FPS_OVER_NUM_FRAMES = 64;

/** `int64_t` division truncates toward zero. */
const idiv = (a: number, b: number): number => Math.trunc(a / b);

interface Smoother {
  vsyncDelta: number;
  leftover: number;
  measurementTime: number;
  measurementFrameCount: number;
  measurementEndFrame: number;
  measurementStartTime: number;
  measurementAllowsSmoothing: boolean;
  estimatedFps: number;
  hitsAt: number;
  hitsAbove: number;
  hitsBelow: number;
  hitsOneAbove: number;
  hitsOneBelow: number;
  estimateComplete: boolean;
  estimateLocked: boolean;
  estimatorTotal: number;
  estimatorReadings: number;
}

function newSmoother(): Smoother {
  return {
    vsyncDelta: 16666,
    leftover: 0,
    measurementTime: 0,
    measurementFrameCount: 0,
    measurementEndFrame: MEASURE_FPS_OVER_NUM_FRAMES,
    measurementStartTime: 0,
    measurementAllowsSmoothing: true,
    estimatedFps: 0,
    hitsAt: 0,
    hitsAbove: 0,
    hitsBelow: 0,
    hitsOneAbove: 0,
    hitsOneBelow: 0,
    estimateComplete: false,
    estimateLocked: false,
    estimatorTotal: 0,
    estimatorReadings: 0,
  };
}

const sync = {
  smoother: newSmoother(),
  lastTicks: 0,
  currentTicks: 0,
  timeAccum: 0,
  timeDeficit: 0,
  accumulated: Array.from({ length: CONTROL_STEPS }, (_, i) => i),
  typical: Array.from({ length: CONTROL_STEPS }, (_, i) => i),
  fixedFps: -1,
};

/** `DeltaSmoother::made_new_estimate` (`main_timer_sync.cpp:52`). */
function madeNewEstimate(s: Smoother): void {
  s.hitsAbove = 0;
  s.hitsAt = 0;
  s.hitsBelow = 0;
  s.hitsOneAbove = 0;
  s.hitsOneBelow = 0;
  s.estimateComplete = false;
}

/** `DeltaSmoother::update_refresh_rate_estimator` (`main_timer_sync.cpp:67`). */
function updateEstimator(s: Smoother, delta: number): void {
  if (s.estimateLocked) return;
  s.estimatorTotal += delta;
  s.estimatorReadings += 1;
  const NUM_READINGS = 60;
  if (s.estimatorReadings < NUM_READINGS) return;
  const average = idiv(s.estimatorTotal, NUM_READINGS);
  s.estimatorReadings = 0;
  s.estimatorTotal = 0;
  // `Math::round` rounds half away from zero; the value is positive.
  const fps = Math.floor(1000000.0 / average + 0.5);
  if (s.estimatedFps === 0) {
    if (fps >= 50) s.estimatedFps = fps;
    else return;
  }
  if (fps === s.estimatedFps) {
    s.hitsAt += 1;
    if (s.estimateComplete && s.hitsAt === 20) {
      s.estimateLocked = true;
      return;
    }
    if (!s.estimateComplete && s.hitsAt > 2 && s.estimatedFps !== 0) {
      s.estimateComplete = true;
      s.vsyncDelta = idiv(1000000, s.estimatedFps);
    }
    return;
  }
  const SIGNIFICANCE_UP = 1;
  const SIGNIFICANCE_DOWN = 2;
  if (fps < s.estimatedFps) {
    if (fps === s.estimatedFps - 1) {
      s.hitsOneBelow += 1;
      if (s.hitsOneBelow > s.hitsAt && s.hitsOneBelow > SIGNIFICANCE_DOWN) {
        s.estimatedFps -= 1;
        madeNewEstimate(s);
      }
      return;
    }
    s.hitsBelow += 1;
    const established = s.estimateComplete && s.hitsAt > 10;
    if (!established && idiv(s.hitsBelow, 8) > s.hitsAt && s.hitsBelow > SIGNIFICANCE_DOWN) {
      s.estimatedFps -= 1;
      madeNewEstimate(s);
    }
    return;
  }
  if (fps === s.estimatedFps + 1) {
    s.hitsOneAbove += 1;
    if (s.hitsOneAbove > s.hitsAt && s.hitsOneAbove > SIGNIFICANCE_UP) {
      s.estimatedFps += 1;
      madeNewEstimate(s);
    }
    return;
  }
  s.hitsAbove += 1;
  if (s.hitsAbove > s.hitsAt && s.hitsAbove > SIGNIFICANCE_UP) {
    s.estimatedFps += Math.max(1, idiv(fps - s.estimatedFps, 2));
    madeNewEstimate(s);
  }
}

/** `DeltaSmoother::fps_allows_smoothing` (`main_timer_sync.cpp:219`). */
function fpsAllowsSmoothing(s: Smoother, delta: number): boolean {
  s.measurementTime += delta;
  s.measurementFrameCount += 1;
  if (s.measurementFrameCount === s.measurementEndFrame) {
    if (s.estimateComplete) {
      const passed = idiv(s.measurementTime - s.measurementStartTime, MEASURE_FPS_OVER_NUM_FRAMES);
      if (passed !== 0) {
        const ratio = 1000000.0 / passed / s.estimatedFps;
        s.measurementAllowsSmoothing = ratio > 0.95 && ratio < 1.05;
      }
    }
    s.measurementStartTime = s.measurementTime;
    s.measurementEndFrame += MEASURE_FPS_OVER_NUM_FRAMES;
  }
  return s.measurementAllowsSmoothing;
}

/** `DeltaSmoother::smooth_delta` (`main_timer_sync.cpp:252`), with vsync always enabled on the web. */
function smoothDelta(s: Smoother, delta: number): number {
  if (get_setting('application/run/delta_smoothing', true) !== true) return delta;
  if (delta > 1000000) return delta;
  if (!fpsAllowsSmoothing(s, delta)) return delta;
  if (delta < 1000) return delta;
  updateEstimator(s, delta);
  if (!s.estimateComplete) return delta;
  s.leftover += delta;
  const units = Math.max(idiv(s.leftover, s.vsyncDelta), 1);
  s.leftover -= units * s.vsyncDelta;
  return units * s.vsyncDelta;
}

/** `get_average_physics_steps` (`main_timer_sync.cpp:327`). */
function averagePhysicsSteps(): { readonly consistent: number; readonly min: number; readonly max: number } {
  let min = sync.typical[0] as number;
  let max = min + 1;
  for (let i = 1; i < CONTROL_STEPS; i += 1) {
    const lower = sync.typical[i] as number;
    const currentMin = lower / (i + 1);
    if (currentMin > max) return { consistent: i, min, max };
    if (currentMin > min) min = currentMin;
    const currentMax = (lower + 1) / (i + 1);
    if (currentMax < min) return { consistent: i, min, max };
    if (currentMax < max) max = currentMax;
  }
  return { consistent: CONTROL_STEPS, min, max };
}

/** `advance_core` (`main_timer_sync.cpp:349`): the steps for this frame, kept typical. */
function advanceCore(physicsStep: number, ticksPerSecond: number, processStep: number, jitterFix: number): { processStep: number; physicsSteps: number } {
  sync.timeAccum += processStep;
  let steps = Math.floor(sync.timeAccum * ticksPerSecond);
  let minTypical = sync.typical[0] as number;
  let maxTypical = minTypical + 1;
  let updateTypical = false;
  for (let i = 0; i < CONTROL_STEPS - 1; i += 1) {
    const left = (sync.typical[i + 1] as number) - (sync.accumulated[i] as number);
    if (left > maxTypical || left + 1 < minTypical) {
      updateTypical = true;
      break;
    }
    if (left > minTypical) minTypical = left;
    if (left + 1 < maxTypical) maxTypical = left + 1;
  }
  if (steps < minTypical) {
    const maxPossible = Math.floor(sync.timeAccum * ticksPerSecond + jitterFix);
    if (maxPossible < minTypical) {
      steps = maxPossible;
      updateTypical = true;
    } else {
      steps = minTypical;
    }
  } else if (steps > maxTypical) {
    const minPossible = Math.floor(sync.timeAccum * ticksPerSecond - jitterFix);
    if (minPossible > maxTypical) {
      steps = minPossible;
      updateTypical = true;
    } else {
      steps = maxTypical;
    }
  }
  if (steps < 0) steps = 0;
  sync.timeAccum -= steps * physicsStep;
  for (let i = CONTROL_STEPS - 2; i >= 0; i -= 1) sync.accumulated[i + 1] = (sync.accumulated[i] as number) + steps;
  sync.accumulated[0] = steps;
  if (updateTypical) {
    for (let i = CONTROL_STEPS - 1; i >= 0; i -= 1) {
      const accumulated = sync.accumulated[i] as number;
      if ((sync.typical[i] as number) > accumulated) sync.typical[i] = accumulated;
      else if ((sync.typical[i] as number) < accumulated - 1) sync.typical[i] = accumulated - 1;
    }
  }
  return { processStep, physicsSteps: steps };
}

const clamp = (value: number, min: number, max: number): number => (value < min ? min : value > max ? max : value);

/**
 * Starts the clock at `p_cpu_ticks_usec`, as `Main::start` does before the first iteration.
 *
 * @godot MainTimerSync (protocol)
 * @source main/main_timer_sync.cpp:525
 */
export function godot_main_timer_sync_init(p_cpu_ticks_usec: number): void {
  sync.currentTicks = p_cpu_ticks_usec;
  sync.lastTicks = p_cpu_ticks_usec;
}

/**
 * Godot's `--fixed-fps` (`main/main.cpp:1948`): every process step is `1 / fps`; -1 is off.
 *
 * @godot MainTimerSync (protocol)
 * @source main/main_timer_sync.cpp:534
 */
export function godot_main_timer_sync_set_fixed_fps(p_fixed_fps: number): void {
  sync.fixedFps = p_fixed_fps;
}

/**
 * Whether `--fixed-fps` is set (`Main::iteration` skips the steps-per-frame cap then).
 *
 * @godot MainTimerSync (protocol)
 * @source main/main.cpp:4953
 */
export function godot_main_timer_sync_fixed_fps(): number {
  return sync.fixedFps;
}

/**
 * `advance` (`main_timer_sync.cpp:539`) at the wall clock `p_cpu_ticks_usec`: the smoothed
 * delta since the last call through `advance_checked` (`:432`).
 *
 * @godot MainTimerSync (protocol)
 * @source main/main_timer_sync.cpp:539
 */
export function godot_main_timer_sync_advance(
  p_cpu_ticks_usec: number,
  p_physics_step: number,
  p_physics_ticks_per_second: number,
  p_jitter_fix: number,
): { readonly process_step: number; readonly physics_steps: number; readonly interpolation_fraction: number } {
  sync.currentTicks = p_cpu_ticks_usec;
  const elapsed = smoothDelta(sync.smoother, sync.currentTicks - sync.lastTicks);
  sync.lastTicks = sync.currentTicks;
  let processStep = elapsed / 1000000.0;
  if (sync.fixedFps !== -1) processStep = 1.0 / sync.fixedFps;
  // `float min_output_step`: single precision.
  const minOutputStep = Math.fround(Math.max(Math.fround(processStep / 8), 1e-6));
  processStep += sync.timeDeficit;
  const ret = advanceCore(p_physics_step, p_physics_ticks_per_second, processStep, p_jitter_fix);
  const processMinusAccum = ret.processStep - sync.timeAccum;
  const average = averagePhysicsSteps();
  if (average.consistent > 3) ret.processStep = clamp(ret.processStep, average.min * p_physics_step, average.max * p_physics_step);
  const deviation = p_jitter_fix * p_physics_step;
  ret.processStep = clamp(ret.processStep, processStep - deviation, processStep + deviation);
  ret.processStep = clamp(ret.processStep, processMinusAccum, processMinusAccum + p_physics_step);
  if (ret.processStep < minOutputStep) ret.processStep = minOutputStep;
  sync.timeAccum = ret.processStep - processMinusAccum;
  if (sync.timeAccum > p_physics_step) {
    const extra = Math.floor(sync.timeAccum * p_physics_ticks_per_second);
    sync.timeAccum -= extra * p_physics_step;
    ret.physicsSteps += extra;
  }
  sync.timeDeficit = processStep - ret.processStep;
  return { process_step: ret.processStep, physics_steps: ret.physicsSteps, interpolation_fraction: sync.timeAccum / p_physics_step };
}
