/**
 * The one slot that says an ingest mount is WAITING for the game's first
 * frame, and whether that wait is parked because the tab is hidden.
 *
 * WHY IT EXISTS. The capture window is a budget of VISIBLE time
 * (`@volter/threejs-runtime/adapter/ingest/visible-capture-window`), so a tab that boots in the
 * background — the normal human path — no longer burns its window unable to
 * draw. What it does instead is WAIT, potentially for as long as the human
 * takes to come back to the tab, and a wait is exactly the state every door
 * used to report as silence: nothing mounted, nothing failed, `vgai status`
 * counting down a clock that was not running. So the wait is published:
 * `collectState`'s `ingestCaptureWait` carries it, and `vgai status` prints
 * "waiting for first visible frame — tab is hidden" instead of a countdown.
 *
 * A LIVE VIEW, never a snapshot — same rule as `IngestMount.realmLoopVerdict`
 * and the `__vgaiIngest` hook's `reflected`/`sceneChildren`: the elapsed
 * numbers move on their own, so a frozen copy starts lying the instant it is
 * taken. The slot holds the window itself and derives the report at read time.
 *
 * RESOURCE OWNERSHIP: the MOUNT owns this slot. `mountIngestGame`'s
 * `waitForCapture` sets it when the wait begins and clears it (with `null`) the
 * moment the wait ends — captured, expired, or torn down — through the same
 * `onWait` callback, so there is exactly one writer and no second teardown
 * path. A second mount replaces the first's entry; there is only ever one wait.
 */

import { notifyLiveSessionsChanged } from '@volter/editor-core/live-session-registry';
import type { VisibleCaptureWindow } from '@volter/threejs-runtime/adapter/ingest/visible-capture-window';

/** The wait as `vgai status` reports it. */
export interface CaptureWaitStatus {
  /** The world whose first frame is being waited for. */
  readonly worldId: string;
  /** The capture window, in VISIBLE milliseconds. */
  readonly budgetMs: number;
  /**
   * Visible milliseconds spent so far — the only ones the window counts.
   *
   * There is deliberately no hidden-time counterpart here. The server holds
   * the last snapshot a tab POSTed, and a hidden tab posts nothing while it
   * waits, so a hidden-ms field would be frozen at whatever it was when the
   * wait began and read as "0ms hidden" after an hour of it. This one cannot
   * go stale in the state that matters: while the tab is hidden it is not
   * moving. (Hidden time IS measured live in the page, where it is honest —
   * the capture-timeout error quotes it.)
   */
  readonly elapsedVisibleMs: number;
  /** Whether the wait is parked RIGHT NOW because the tab is hidden. */
  readonly hidden: boolean;
  /** Whether the browser is currently presenting frames. Wider than hidden:
   * WebKit also suspends an unfocused window while Page Visibility says visible. */
  readonly suspended: boolean;
  /** The observed browser condition parking the capture budget. */
  readonly suspensionReason: 'hidden' | 'unfocused' | 'page-suspended' | null;
  /** The wait in one sentence, for a reader who sees only this line. */
  readonly reason: string;
}

interface ActiveWait {
  readonly worldId: string;
  readonly window: VisibleCaptureWindow;
}

let _wait: ActiveWait | null = null;
const _listeners = new Set<() => void>();

function notify(): void {
  for (const listener of _listeners) listener();
}

/**
 * Subscribe to wait start/end. Visibility transitions do NOT come through
 * here — `command-listener.ts` already re-POSTs state on `visibilitychange`
 * (its `reportPresence`), which is the same event this wait parks and resumes
 * on, so a second listener for it would be a duplicate reporter of one event.
 */
export function subscribeToCaptureWait(callback: () => void): () => void {
  _listeners.add(callback);
  return () => {
    _listeners.delete(callback);
  };
}

/** Publish the running wait, or `null` when it ends. The mount's `onWait`. */
export function setCaptureWait(worldId: string, window: VisibleCaptureWindow | null): void {
  _wait = window ? { worldId, window } : null;
  notify();
  // The state report's external-change channel (`command-listener.ts`
  // re-reports on the registry's version).
  notifyLiveSessionsChanged();
}

/** The live wait, derived at read time, or `null` when nothing is waiting. */
export function captureWaitStatus(): CaptureWaitStatus | null {
  const active = _wait;
  if (!active) return null;
  const hidden = active.window.isHidden();
  const suspended = active.window.isSuspended();
  const suspensionReason = active.window.suspensionReason();
  return {
    worldId: active.worldId,
    budgetMs: active.window.budgetMs,
    elapsedVisibleMs: Math.round(active.window.elapsedVisibleMs()),
    hidden,
    suspended,
    suspensionReason,
    reason:
      suspensionReason === 'hidden'
        ? 'waiting for first visible frame — tab is hidden (a hidden tab cannot render, so the ' +
          'capture window is parked, not counting down; bring the tab to the foreground)'
        : suspensionReason === 'unfocused'
          ? 'waiting for the browser to resume frame presentation — the editor window is ' +
            'unfocused (WebKit can suspend requestAnimationFrame in this state, so the capture ' +
            'window is parked; focus the editor window)'
          : suspensionReason === 'page-suspended'
            ? 'waiting for the browser to restore the suspended editor page — the capture ' +
              'window is parked, not counting down'
            : suspended
              ? 'waiting for the browser to resume frame presentation — the capture window is parked'
              : "waiting for the game's first rendered frame",
  };
}
