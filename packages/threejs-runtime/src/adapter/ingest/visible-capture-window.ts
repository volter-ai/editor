/**
 * The capture window is a budget of VISIBLE time, not of wall-clock time.
 *
 * WHY THIS MODULE EXISTS. An ingest mount waits for the game to render its
 * first frame and fails by name when that never happens
 * (`scene-capture.ts`'s `waitForCapture`). That wait used to be a plain
 * `setTimeout`, i.e. a wall-clock deadline started AT BOOT — and a game cannot
 * render while its tab is hidden, because the browser parks `requestAnimation
 * Frame` for a backgrounded document. The two facts together make one
 * deterministic failure: a tab that opens in the BACKGROUND (the normal human
 * path — `vgai edit` auto-opens a tab that routinely lands behind the current
 * window) burns its whole capture window unable to draw, the deadline fires,
 * the mount dies terminally, and foregrounding the tab later changes nothing.
 * Agents, whose tabs happen to be visible, never saw it.
 *
 * So the clock only runs while the document is VISIBLE. Hidden time is not
 * spent, and while a tab is hidden the wait PARKS rather than expiring: the
 * capture trap stays installed, the game's modules stay live, and the first
 * frame the tab draws after the human brings it forward is trapped exactly as
 * it would have been at boot. That is the retry — no second mount, no
 * re-running `load()` (which would re-construct module-level state: the
 * ARCHITECTURE-CORE "LOADING CONSTRUCTS, once" contract), and no forcing of a
 * frame: the game's own loop resumes on its own when the browser un-parks it.
 *
 * There is deliberately no wall-clock cap on the parked state. An unspent
 * budget is not a failure — a human returning to the tab is what spends it —
 * and a cap would be exactly the boot-time clock this module exists to
 * remove. The parked wait is reported instead of being silent: see
 * `CaptureWaitObserver` in `scene-capture.ts` and `vgai status`'s
 * `ingestCaptureWait`.
 *
 * The state machine is a pure function of (banked segments, now, hidden) so
 * the whole accrual rule is testable with no browser and no timers
 * (`packages/engine/test/visible-capture-window.test.ts`); the runtime half
 * below is only the timer arm/disarm around it.
 */

/**
 * Everything the budget reads about the outside world. Injected so the pure
 * core stays pure and the runtime half is drivable by a fake in tests — and,
 * as a side effect, so this module never hard-depends on `document` existing
 * (unit runners, SSR).
 */
export interface VisibilityClock {
  /** Milliseconds, monotonic-ish; `performance.now()`/`Date.now()` both fit. */
  now(): number;
  /** True while the document is hidden (no rAF, so no frame can be captured). */
  hidden(): boolean;
  /**
   * True while the browser is not presenting frames. This is wider than
   * `hidden()`: WebKit also stops rAF for an unfocused window (and can suspend
   * the page entirely) while `document.hidden` still reads false.
   *
   * Optional for compatibility with injected clocks; absent means `hidden()`.
   */
  suspended?(): boolean;
  /** Why {@link suspended} is true, when the clock can say. */
  suspensionReason?(): 'hidden' | 'unfocused' | 'page-suspended' | null;
  /** Subscribe to visibility transitions; returns the unsubscribe. */
  subscribe(onChange: () => void): () => void;
}

/** The real one: `document.visibilityState` + `visibilitychange`. Falls back
 *  to permanently-visible where there is no `document` at all, which is the
 *  honest answer for a headless caller — it has no tab to background. */
export function documentVisibilityClock(): VisibilityClock {
  const doc = typeof document === 'undefined' ? null : document;
  const win = doc?.defaultView ?? null;
  let pageSuspended = false;
  const reason = (): 'hidden' | 'unfocused' | 'page-suspended' | null => {
    if (pageSuspended) return 'page-suspended';
    if (doc?.hidden === true) return 'hidden';
    // WebKit stops rAF when the browser window becomes inactive, including
    // when another app is in front. Page Visibility can still say `visible`
    // in that state. Focus is a platform fact, not a Safari/UA sniff, and in
    // browsers that keep rendering while unfocused this merely parks the
    // expiry clock until either a frame arrives or focus returns.
    if (doc && typeof doc.hasFocus === 'function' && !doc.hasFocus()) return 'unfocused';
    return null;
  };
  return {
    now: () => (typeof performance === 'undefined' ? Date.now() : performance.now()),
    hidden: () => doc?.hidden === true,
    suspended: () => reason() !== null,
    suspensionReason: reason,
    subscribe(onChange) {
      if (!doc) return () => {};
      const onPageHide = () => {
        pageSuspended = true;
        onChange();
      };
      const onPageShow = () => {
        pageSuspended = false;
        onChange();
      };
      doc.addEventListener('visibilitychange', onChange);
      win?.addEventListener('blur', onChange);
      win?.addEventListener('focus', onChange);
      win?.addEventListener('pagehide', onPageHide);
      win?.addEventListener('pageshow', onPageShow);
      return () => {
        doc.removeEventListener('visibilitychange', onChange);
        win?.removeEventListener('blur', onChange);
        win?.removeEventListener('focus', onChange);
        win?.removeEventListener('pagehide', onPageHide);
        win?.removeEventListener('pageshow', onPageShow);
      };
    },
  };
}

/**
 * The banked halves of the wait plus the segment currently running. Immutable:
 * every transition returns a new value, so a caller can hold one and compare.
 */
export interface VisibleBudgetState {
  /** The window, in VISIBLE milliseconds. */
  readonly budgetMs: number;
  /** Visible time banked from completed segments. */
  readonly visibleMs: number;
  /** Hidden time banked from completed segments (reported, never spent). */
  readonly hiddenMs: number;
  /** When the current segment started. */
  readonly since: number;
  /** Whether the current segment is a hidden one. */
  readonly hidden: boolean;
}

/** Open the window at `now`, in whichever visibility the document is in. */
export function beginVisibleBudget(
  budgetMs: number,
  now: number,
  hidden: boolean,
): VisibleBudgetState {
  return { budgetMs, visibleMs: 0, hiddenMs: 0, since: now, hidden };
}

/**
 * Apply the document's current visibility at `now`: bank the segment that just
 * ended into its own bucket and start the next one. A call that does not change
 * visibility is a no-op *by value* (same accrual, same segment start), so a
 * duplicate `visibilitychange` can never bank a zero-length segment twice or
 * restart the clock.
 */
export function applyVisibility(
  state: VisibleBudgetState,
  now: number,
  hidden: boolean,
): VisibleBudgetState {
  if (hidden === state.hidden) return state;
  const elapsed = Math.max(0, now - state.since);
  return {
    budgetMs: state.budgetMs,
    visibleMs: state.hidden ? state.visibleMs : state.visibleMs + elapsed,
    hiddenMs: state.hidden ? state.hiddenMs + elapsed : state.hiddenMs,
    since: now,
    hidden,
  };
}

/** Visible time spent so far, including the segment in flight. */
export function visibleElapsedMs(state: VisibleBudgetState, now: number): number {
  return state.visibleMs + (state.hidden ? 0 : Math.max(0, now - state.since));
}

/** Hidden time so far, including the segment in flight. Never spent — it is
 *  reported so a failure message can say what the window did NOT count. */
export function hiddenElapsedMs(state: VisibleBudgetState, now: number): number {
  return state.hiddenMs + (state.hidden ? Math.max(0, now - state.since) : 0);
}

/** Visible time left in the window; `0` once it is spent. */
export function visibleRemainingMs(state: VisibleBudgetState, now: number): number {
  return Math.max(0, state.budgetMs - visibleElapsedMs(state, now));
}

/** A live view of one running window, for the status wire and the failure message. */
export interface VisibleCaptureWindow {
  /** The window's size, in visible milliseconds. */
  readonly budgetMs: number;
  /** Visible milliseconds spent so far. */
  elapsedVisibleMs(): number;
  /** Milliseconds this window has spent browser-suspended (not counted). */
  elapsedHiddenMs(): number;
  /**
   * Whether the document itself is hidden. Kept distinct from browser
   * suspension so status never calls an unfocused, still-visible window hidden.
   */
  isHidden(): boolean;
  /** Whether the expiry budget is parked because the browser is not presenting frames. */
  isSuspended(): boolean;
  /** The browser condition parking the budget, when observable. */
  suspensionReason(): 'hidden' | 'unfocused' | 'page-suspended' | null;
  /** Stop the timer and drop the visibility listener. Idempotent. */
  cancel(): void;
}

/**
 * How a caller configures ONE such wait — the options both `waitForCapture`s
 * take (`adapter/ingest/scene-capture.ts` on the three surface,
 * `pixi/scene-capture.ts` on the canvas surface). Passing a bare number
 * instead is `{ timeoutMs }`, the shape every existing caller uses.
 *
 * It lives HERE, with the window, rather than once per lane, because every
 * field is a parameter of the mechanism above and none of them is a parameter
 * of a surface: `timeoutMs` is {@link startVisibleCaptureWindow}'s `budgetMs`,
 * `visibility` is its {@link VisibilityClock}, and `onWait` hands out the
 * {@link VisibleCaptureWindow} it returns. The two lanes had identical copies
 * of this — which is what a shape with no lane-specific field looks like when
 * it is declared per lane — while both already imported those three names from
 * this module. Genuinely per-surface shapes (`CapturedRuntime` vs
 * `CapturedRuntime2D`: a three scene/renderer against a Pixi stage/app) stay in
 * their own lanes and keep their own names.
 */
export interface CaptureWaitOptions {
  /** The capture window, in VISIBLE milliseconds (default 10s). */
  timeoutMs?: number | undefined;
  /** Injected in tests; defaults to the document's own visibility. */
  visibility?: VisibilityClock | undefined;
  /**
   * Called with a LIVE view of the wait when it begins, and with `null` the
   * moment it ends (captured, expired, or the window was cancelled).
   *
   * A wait parked on a hidden tab is otherwise indistinguishable from a hung
   * mount: nothing renders, nothing fails, and every door reports silence.
   * This is the seam the editor publishes to `vgai status` so the answer is
   * "waiting for the first visible frame — the tab is hidden", not a countdown
   * that is not running.
   */
  onWait?: ((wait: VisibleCaptureWindow | null) => void) | undefined;
}

/**
 * Start a window that calls `onExpire` after `budgetMs` of VISIBLE time.
 * While browser frame presentation is suspended the timer is disarmed entirely
 * (so a throttled background timer cannot fire it late either) and re-armed
 * with the remaining budget when frame presentation resumes.
 */
export function startVisibleCaptureWindow(opts: {
  budgetMs: number;
  onExpire: () => void;
  /** Defaults to the document's own visibility. */
  clock?: VisibilityClock;
  /** Defaults to `setTimeout`/`clearTimeout`. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}): VisibleCaptureWindow {
  const clock = opts.clock ?? documentVisibilityClock();
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

  const suspended = () => clock.suspended?.() ?? clock.hidden();
  let state = beginVisibleBudget(opts.budgetMs, clock.now(), suspended());
  let timer: unknown = null;
  let done = false;

  function disarm(): void {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  }

  function arm(): void {
    disarm();
    if (done || state.hidden) return;
    timer = setTimer(
      () => {
        timer = null;
        if (done) return;
        done = true;
        unsubscribe();
        opts.onExpire();
      },
      visibleRemainingMs(state, clock.now()),
    );
  }

  const unsubscribe = clock.subscribe(() => {
    if (done) return;
    state = applyVisibility(state, clock.now(), suspended());
    arm();
  });

  arm();

  return {
    budgetMs: opts.budgetMs,
    elapsedVisibleMs: () => visibleElapsedMs(state, clock.now()),
    elapsedHiddenMs: () => hiddenElapsedMs(state, clock.now()),
    isHidden: () => clock.hidden(),
    isSuspended: () => state.hidden,
    suspensionReason: () =>
      state.hidden ? (clock.suspensionReason?.() ?? (clock.hidden() ? 'hidden' : null)) : null,
    cancel() {
      if (done) return;
      done = true;
      disarm();
      unsubscribe();
    },
  };
}
