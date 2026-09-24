/**
 * The game loop's own types. The PHASE VOCABULARY is not here: `SystemPhase`,
 * `PHASE_ORDER`, `SystemPhaseName`, `SystemFn` and `SystemOptions` live in the
 * project contract (`@volter/editor-project/core/system-phase`) because the three.js
 * twin's animation clock orders its evaluators by the same `PHASE_ORDER`, and
 * a vocabulary two shipped twins both read may not be one twin's.
 */
import type { SystemFn, SystemPhaseName } from '@volter/editor-project/core/system-phase';

export {
  PHASE_ORDER,
  type SystemFn,
  type SystemOptions,
  SystemPhase,
  type SystemPhaseName,
} from '@volter/editor-project/core/system-phase';

export interface SystemRunObserver {
  beginSystem(scope: string, phase: SystemPhaseName, name: string): void;
  endSystem(scope: string, phase: SystemPhaseName, name: string): void;
}

/** A lifecycle system with init/update/dispose hooks. */
export interface SystemDef {
  /** Stable diagnostic label; falls back to the update function name. */
  readonly name?: string;
  /** Which phase the update function runs in */
  phase: SystemPhaseName;
  /** One-time setup after all entities are spawned, before the first frame */
  init?(): void;
  /** Per-frame update */
  update: SystemFn;
  /** Cleanup when the system is removed or the scene unloads */
  dispose?(): void;
}

export interface GameLoopConfig {
  /** Fixed timestep in seconds (default: 1/60) */
  fixedTimestep?: number;
  /** Max physics substeps per frame to prevent spiral of death (default: 8) */
  maxSubSteps?: number;
  /**
   * Called once per consumed fixed substep — the SIM half. A real frame whose
   * accumulator produces zero substeps calls this zero times, which is exactly
   * why {@link GameLoopConfig.render} exists.
   *
   * Whether the `render`/`preRender` phases run inside this call is the
   * CALLER's choice, not this loop's: a host that also passes `render` below
   * asks `Game.runFrame` to skip them (`skipRenderPhases`), a host that does
   * not keeps them here as the tail of `PHASE_ORDER`. See `game-loop.ts`'s
   * module doc.
   */
  update: (dt: number) => void;
  /**
   * Called EXACTLY ONCE per real (rAF) frame — the PRESENTATION half.
   *
   * - `alpha` — `accumulator / fixedDt` after this frame's substeps were
   *   consumed, in `[0, 1]`: how far presentation sits past the last
   *   completed fixed state. `core/frame-pacing.ts` computes it.
   * - `displayDt` — this display frame's own delta in seconds, clamped and
   *   `timeScale`d exactly like the sim's time. Integrate per-display-frame
   *   motion against this, never against `fixedTimestep`.
   *
   * Optional. Never invoked at all in {@link GameLoopConfig.externalDrive}
   * mode, where `frame()` itself never runs.
   */
  render?: (alpha: number, displayDt: number) => void;
  /**
   * External-drive mode (I2): when `true`, `start()` never arms a
   * `requestAnimationFrame` chain and never installs the
   * `visibilitychange`/`document.hidden` auto-stop handler — so a
   * headless/backgrounded capture page cannot have its loop silently killed by
   * the tab-hidden guard, and `config.update` is never invoked by
   * wall-clock/RAF timing at all. The caller (a render harness) drives frames
   * itself instead — see `runtime/render-control.ts`, which calls a world's
   * phase hooks directly rather than going through this loop's `update`
   * callback. Default `false` (normal wall-clock RAF playback, unchanged).
   */
  externalDrive?: boolean;
}

/**
 * Truthful liveness classification for `createGameLoop`'s returned loop
 * (issue #175 — "state must never claim health it cannot observe"). See
 * `GameLoop.liveness`'s doc comment in `game-loop.ts` for the full contract;
 * exported here (rather than only inline on the loop's return type) so
 * callers elsewhere in the engine (`runtime/game.ts`, `runtime/
 * debug-registry.ts`) can name the union without importing `game-loop.ts`
 * as a value.
 *
 * - `'running'` — a real rAF callback arrived recently (or, for an
 *   `externalDrive` loop, `start()` has been called — see that mode's own
 *   liveness note below).
 * - `'loop-starved'` — the host loop has made no recent rAF progress: either
 *   the T2.1 visibility gate deliberately parked it, or an armed visible-page
 *   callback has not arrived within the starvation threshold. This reports
 *   the LOOP measurement, never a conclusion about where the browser tab is.
 * - `'stopped'` — `stop()` was called, or `start()` was never called.
 *
 * `isRunning` says whether the rAF chain is armed; it can therefore remain
 * `true` while a visible browser starves callbacks. Read `liveness` wherever
 * "is this host loop actually advancing" matters.
 */
export type GameLoopLiveness = 'running' | 'loop-starved' | 'stopped';
