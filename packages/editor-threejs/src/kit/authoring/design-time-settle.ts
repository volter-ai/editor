/**
 * THE DESIGN-TIME SETTLE, and the only place its constants are spelled.
 *
 * This is deliberately NOT an interactive-document boot step. Scene and Asset
 * Lab documents show authored state immediately and advance content only when
 * the user starts an explicit simulation or animation transport. A hidden
 * settle before reveal violated Edit ≠ Play and made a complex local scene wait
 * up to four seconds for construction quiescence plus 90 invisible steps.
 *
 * The remaining callers are deliberate off-screen preview/capture operations
 * that ask for a derived rest pose. That is why {@link settleDesignWorld} takes
 * a {@link SettleTarget} rather than a viewport type: the seam is "a world with
 * a host-driven tick," while the caller owns the decision to simulate.
 *
 * **The settle is a PURE FUNCTION OF SOURCE.** It never reads accumulated
 * state, never persists a result, and is never a second truth beside the
 * source: every mount re-derives the world from the file and re-runs the same
 * bounded simulation from the same authored spawn. That is what makes the two
 * interaction contracts hold — a gizmo commit writes the JSX literal, the
 * session re-derives from source, and the settle re-runs from the EDIT's
 * position (the edit wins, nothing snaps back); and two mounts of identical
 * source produce the same rest state.
 *
 * ## THE SEAM IT DRIVES, and why it is not a physics API
 *
 * `MountedThreeRoot.update(dt)` — the world's own host-driven tick, the exact
 * one `runFrameImpl` (`@vgai/game-runtime/runtime/game`) calls at play time. For an R3F
 * world that is `world3d-react/r3f-adapter.tsx`'s `update()`: it runs the
 * engine phases and then `advance(elapsed, true, state)`, which under
 * `frameloop: 'never'` is what runs every `useFrame` subscriber.
 *
 * A physics integration is one of those subscribers, so driving `update()`
 * drives the world's physics THROUGH THE WORLD'S OWN DECLARATION — including
 * whatever gravity/iterations/solver props its own `<Physics>` element
 * carries. Worked example, `@react-three/cannon@6.6.0`: its provider registers
 * `useFrame(loop)` (`node_modules/@react-three/cannon/dist/index.js:12166`)
 * and `loop` posts `worker.step({ maxSubSteps, stepSize, timeSinceLastCalled })`
 * (`:12032`) to its own Web Worker. Nothing here knows any of that, and
 * nothing here should: the editor reaching for a named physics library's step
 * API would be an editor that only settles the physics engines it has heard
 * of.
 *
 * ## WHY IT IS ASYNC, and why it steps in ROUNDS
 *
 * That worker is OFF-THREAD. `worker.step()` posts a message; the resulting
 * pose arrives on a later task and is applied to `object.matrix` from the
 * worker's own `frame` handler (`:12120`). A synchronous burst of `update()`
 * calls would therefore measure nothing but the spawn pose. So the settle
 * yields to the event loop, and it does so once per ROUND of
 * {@link SETTLE_STEPS_PER_ROUND} steps rather than once per step: the worker
 * queue is FIFO, so a round's steps pipeline and its frames land together,
 * which costs one event-loop turn per round instead of one per step.
 *
 * ## WHY REST IS ONLY DECLARED AFTER MOTION
 *
 * The naive rest test — "the scene did not move this round, so we are done" —
 * is TRUE at round one for the exact reason the settle exists: an off-thread
 * physics engine has not answered yet, so nothing has moved YET. Declaring
 * rest there would settle to the spawn pose and call it a rest state. Rest is
 * therefore gated on having OBSERVED motion first; a world that never moves
 * under simulation ends at {@link SETTLE_MAX_ROUNDS} with reason `'still'`,
 * which costs it that many event-loop turns and nothing else.
 *
 * Non-finite poses are the same class of not-yet-answered and are handled the
 * same way: `@react-three/cannon` writes `object.matrix` from worker buffers
 * that are unwritten at frame zero, so two of racing-game's meshes are
 * measurably `NaN` before the first frame lands (see `content-bounds.ts`'s own
 * measurement of exactly this). A round whose sample is non-finite is
 * NOT COMPARABLE: it resets the rest run and is never counted as motion.
 */

import type * as THREE from 'three';

/**
 * What a settle needs from a world, and nothing more: the graph to measure and
 * the world's OWN host-driven tick to advance. `MountedThreeRoot` satisfies it
 * structurally, and so does every other design-time surface's source (a story
 * mount's `advance`, a project contribution's `build().update`) — which is the
 * point: one settle, one shape, no per-surface copy.
 */
export interface SettleTarget {
  /** The subtree whose motion is measured. A whole `THREE.Scene` for a mounted
   *  root; a story's own wrapper group for an off-screen story mount. */
  readonly scene: THREE.Object3D;
  /** The world's own tick. Absent ⇒ nothing to advance (`'unsupported'`). */
  readonly update?: ((dt: number) => void) | undefined;
  /**
   * Whether this mount has an off-thread physics stepper subscribed (a
   * `<Physics>` provider, a cannon worker, a first-party adapter).
   *
   * The quiet-wait and still-rounds exist because that stepper is SILENT at
   * spawn: declaring rest before it answers would freeze a vehicle at a pose
   * the game never has. A tree, a jump pad, a mesh with no physics has
   * nothing that can move later, so both waits are wasted — pass `false` and
   * the settle returns immediately. Omitted is the SAFE default (settle):
   * callers that have not looked must not skip a rigid body.
   */
  readonly hasPhysicsSubscriber?: boolean;
}

/** The simulated timestep each settle step advances — the engine's own fixed
 *  timestep (`core/game-loop.ts`'s `fixedTimestep ?? 1/60`), so a settle step
 *  is the same quantum a play frame is. */
export const SETTLE_STEP_SECONDS = 1 / 60;

/** Steps advanced between event-loop yields. 6 steps = 0.1 simulated second —
 *  enough that an off-thread physics worker's frames for the round have
 *  something to show, small enough that rest is detected within 0.1s of it
 *  happening. */
export const SETTLE_STEPS_PER_ROUND = 6;

/** Hard budget: 15 rounds = 90 steps = **1.5 simulated seconds**. A body
 *  dropped onto its own suspension or resolved out of an interpenetration
 *  reaches rest well inside that; a world that is still moving at 1.5s is
 *  animating rather than settling, and Edit mode owes it a freeze, not a
 *  longer run. */
export const SETTLE_MAX_ROUNDS = 15;

/** Rest threshold: world units moved by the FASTEST-moving node across one
 *  round. 1e-4 units per 0.1s is 1 millimetre per second in a metres-scaled
 *  world — below it, nothing a viewer or a capture can distinguish is
 *  happening. */
export const SETTLE_REST_EPSILON = 1e-4;

/** Consecutive quiet rounds required before rest is declared, so a body
 *  pausing at the top of a bounce is not mistaken for a rest state. */
export const SETTLE_REST_ROUNDS = 2;

/** After the last step, event-loop turns awaited for an off-thread physics
 *  engine's in-flight frames to land. This is what makes "then FREEZES" true
 *  rather than asserted: the settle does not return while a pose it caused is
 *  still on its way. */
export const SETTLE_DRAIN_TURNS = 10;

/**
 * How long the scene graph must stop CHANGING SHAPE before the settle starts
 * stepping, and the hard ceiling on waiting for that.
 *
 * WHY THIS EXISTS, measured. A world's `mount()` resolves at fiber's first
 * commit, which is NOT the end of construction: suspended asset loads
 * (racing-game's Draco chassis/track GLBs and its HDR environment) add nodes —
 * including physics bodies — for as long as they take. Step the world during
 * that window and a body created at round 3 gets 12 fewer steps than one
 * created at round 0, so the SAME source settles differently depending on how
 * warm the HTTP cache was. Measured directly: two boots of unchanged
 * racing-game source produced chassis Y = 0.7549 and 0.7927.
 *
 * So the settle waits for the world to stop being BUILT before it simulates.
 * Node count is the signal (an asset resolving adds nodes; a texture arriving
 * does not change the count and does not change physics either). Both bounds
 * are wall-clock because what is being waited on is I/O, not frames.
 */
export const SETTLE_BUILD_STABLE_MS = 250;
export const SETTLE_BUILD_TIMEOUT_MS = 4000;

/** Why the settle ended. */
export type SettleOutcome =
  /** The world moved and then came to rest. */
  | 'rest'
  /** The world was still moving when the step budget ran out. */
  | 'budget'
  /** Nothing in the world ever moved under simulation. */
  | 'still'
  /** The world is not host-driven — there is no `update(dt)` to advance. */
  | 'unsupported';

export interface SettleReport {
  readonly outcome: SettleOutcome;
  /** Simulation steps actually advanced. */
  readonly steps: number;
  /** World units the fastest node moved across the final measured round. */
  readonly lastMotion: number;
  /** Milliseconds spent waiting for the world to stop being BUILT, and whether
   *  that wait ended because the graph went quiet (`true`) or because it hit
   *  {@link SETTLE_BUILD_TIMEOUT_MS} (`false` — the settle then runs against a
   *  world still loading, and its result is honestly not reproducible). */
  readonly buildWaitMs: number;
  readonly buildSettled: boolean;
}

/** Injectables. Real callers pass nothing; a test drives the loop and the
 *  clock so the wall-clock bounds above cost it no wall clock. */
export interface SettleHooks {
  yieldTurn?: () => Promise<void>;
  now?: () => number;
}

/** Every node's world position, flattened. Length changes (an async model
 *  resolving mid-settle) make two samples NOT COMPARABLE, which is the honest
 *  answer rather than a wrong distance. */
function samplePositions(scene: THREE.Object3D): number[] {
  scene.updateMatrixWorld(true);
  const out: number[] = [];
  scene.traverse((object) => {
    const e = object.matrixWorld.elements;
    out.push(e[12] as number, e[13] as number, e[14] as number);
  });
  return out;
}

/** How many nodes the world currently has — the build-quiesce signal. */
function countNodes(scene: THREE.Object3D): number {
  let n = 0;
  scene.traverse(() => {
    n++;
  });
  return n;
}

/**
 * The largest distance any node moved between two samples, or `NaN` when the
 * two are not comparable (different node counts, or a pose that is not a
 * number yet).
 */
function maxMotion(before: number[], after: number[]): number {
  if (before.length !== after.length) return Number.NaN;
  let max = 0;
  for (let i = 0; i < after.length; i += 3) {
    const dx = (after[i] as number) - (before[i] as number);
    const dy = (after[i + 1] as number) - (before[i + 1] as number);
    const dz = (after[i + 2] as number) - (before[i + 2] as number);
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!Number.isFinite(d)) return Number.NaN;
    if (d > max) max = d;
  }
  return max;
}

/** One event-loop turn — a MACROtask, because an off-thread worker's message
 *  cannot land in a microtask drain. */
const nextTurn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Block until the world's node count has held still for
 * {@link SETTLE_BUILD_STABLE_MS}, or {@link SETTLE_BUILD_TIMEOUT_MS} runs out.
 * See those constants for the measurement that put this phase here.
 */
async function awaitConstructionQuiesced(
  scene: THREE.Object3D,
  yieldTurn: () => Promise<void>,
  now: () => number,
): Promise<{ buildWaitMs: number; buildSettled: boolean }> {
  const start = now();
  let nodes = countNodes(scene);
  let quietSince = start;
  let buildSettled = false;
  while (now() - start < SETTLE_BUILD_TIMEOUT_MS) {
    if (now() - quietSince >= SETTLE_BUILD_STABLE_MS) {
      buildSettled = true;
      break;
    }
    await yieldTurn();
    const next = countNodes(scene);
    if (next !== nodes) {
      nodes = next;
      quietSince = now();
    }
  }
  return { buildWaitMs: now() - start, buildSettled };
}

function idleSettleReport(outcome: 'unsupported' | 'still'): SettleReport {
  return { outcome, steps: 0, lastMotion: 0, buildWaitMs: 0, buildSettled: true };
}

/**
 * The narrow skip: no physics subscriber means nothing can move after spawn,
 * so the construction quiet-wait and the still-rounds are both wasted. Omitted
 * is treated as "yes, settle" — a caller that has not looked must not skip a
 * rigid body. The predicate lives here so a revert (always-skip, or treating
 * omitted as skip) reds the physics rest test.
 */
export function designWorldHasPhysicsSubscriber(root: SettleTarget): boolean {
  return root.hasPhysicsSubscriber !== false;
}

/**
 * Derive a rest pose for a caller that explicitly requested one, then leave the
 * world frozen. Advances the world's OWN `update(dt)` — see this module's
 * header for why that is the seam and why the loop is shaped the way it is.
 */
export async function settleDesignWorld(
  root: SettleTarget,
  hooks: SettleHooks = {},
): Promise<SettleReport> {
  const yieldTurn = hooks.yieldTurn ?? nextTurn;
  const now = hooks.now ?? (() => Date.now());
  const update = root.update?.bind(root);
  if (!update) return idleSettleReport('unsupported');
  if (!designWorldHasPhysicsSubscriber(root)) return idleSettleReport('still');

  // ---- 1. wait for the world to stop being BUILT
  const { buildWaitMs, buildSettled } = await awaitConstructionQuiesced(root.scene, yieldTurn, now);

  // ---- 2. the bounded settle itself
  let previous = samplePositions(root.scene);
  let steps = 0;
  let quietRounds = 0;
  let observedMotion = false;
  let lastMotion = 0;
  let outcome: SettleOutcome = 'still';

  for (let round = 0; round < SETTLE_MAX_ROUNDS; round++) {
    for (let step = 0; step < SETTLE_STEPS_PER_ROUND; step++) {
      update(SETTLE_STEP_SECONDS);
      steps++;
    }
    await yieldTurn();
    const current = samplePositions(root.scene);
    const motion = maxMotion(previous, current);
    previous = current;
    if (!Number.isFinite(motion)) {
      // Not comparable — the world is mid-answer. Never rest, never motion.
      quietRounds = 0;
      continue;
    }
    lastMotion = motion;
    if (motion > SETTLE_REST_EPSILON) {
      observedMotion = true;
      quietRounds = 0;
      outcome = 'budget';
      continue;
    }
    quietRounds++;
    if (observedMotion && quietRounds >= SETTLE_REST_ROUNDS) {
      outcome = 'rest';
      break;
    }
  }

  // ---- 3. FREEZE. Nothing is stepped from here; the drain only waits out
  // poses this settle already caused, so the scene the editor draws from now
  // on is a real rest state rather than one still being written into.
  for (let turn = 0; turn < SETTLE_DRAIN_TURNS; turn++) {
    await yieldTurn();
    const current = samplePositions(root.scene);
    const motion = maxMotion(previous, current);
    previous = current;
    if (Number.isFinite(motion) && motion <= SETTLE_REST_EPSILON) break;
  }

  return { outcome, steps, lastMotion, buildWaitMs, buildSettled };
}
