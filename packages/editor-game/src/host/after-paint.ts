/**
 * Deferring a step until the browser has painted, in a tab that may never paint.
 *
 * READ THIS BEFORE WRITING `requestAnimationFrame` INTO A BOOT PATH.
 * **rAF does not fire in a hidden tab, ever** — not throttled, not late:
 * zero callbacks until the tab is foregrounded. And "hidden at boot" is the
 * ORDINARY case for this editor, not an edge: every `vgai edit` session rooted
 * in an agent worktree opens its one tab behind the human's window
 * (`server/open-browser.ts` → `open -g`), and any `vgai edit` that fires while
 * the browser is not frontmost lands the same way. Measured twice in one hour:
 * an editor whose shell mount sat behind a bare double-rAF heartbeat for 20
 * minutes with the relay answering, `document.visibilityState: "hidden"`, and
 * zero console errors, while every `vgai play` refused with "the editor shell
 * is not bound yet".
 *
 * A paint deferral is only ever an OPTIMISATION — let the committed chrome
 * reach the compositor before something expensive (a WebGL context, a dock
 * rebuild) starts. A hidden tab has no compositor turn to wait for, so the
 * deferral has nothing left to buy and the work runs immediately. That is the
 * whole rule: **the render loop may pause while hidden; nothing that makes the
 * editor command-capable may.**
 */

/**
 * A visible tab whose rAF chain has produced nothing for this long is starved
 * (occluded window, GPU stall, a browser that missed its own visibility
 * event). The deferral is an optimisation, so it gives up rather than holding
 * the caller's work hostage to a frame that is not coming.
 */
const PAINT_STARVATION_FALLBACK_MS = 1_000;

/**
 * Run `step` after the current chrome has had its paint turn — or straight
 * away when this tab cannot paint at all.
 *
 * Visible: two frames (the first commits the pending render, the second lands
 * after the compositor has taken it), exactly the double-rAF this replaced.
 * Hidden, or hidden while waiting, or rAF-starved: a timer runs it instead.
 *
 * Returns a cancel function; calling it after `step` has run is a no-op.
 */
export function scheduleAfterPaint(step: () => void): () => void {
  let settled = false;
  let firstFrame = 0;
  let secondFrame = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const hidden = (): boolean => typeof document !== 'undefined' && document.hidden;

  const onVisibilityChange = (): void => {
    // Going hidden mid-wait kills the armed rAF chain silently. Take the
    // timer path the moment that happens rather than waiting out the
    // starvation fallback.
    if (hidden()) fire();
  };

  const release = (): void => {
    if (typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    }
    if (timer !== undefined) clearTimeout(timer);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
  };

  function fire(): void {
    if (settled) return;
    settled = true;
    release();
    step();
  }

  if (hidden() || typeof requestAnimationFrame !== 'function') {
    timer = setTimeout(fire, 0);
  } else {
    firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(fire);
    });
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }
    timer = setTimeout(fire, PAINT_STARVATION_FALLBACK_MS);
  }

  return () => {
    if (settled) return;
    settled = true;
    release();
  };
}

/** One frame at 60Hz is ~16ms, so a visible tab's real frame always wins this
 * race and only a tab that cannot paint takes the timer. */
const PAINT_POLL_FALLBACK_MS = 32;

/**
 * Await one paint turn — the awaitable form of the rule above, for a poll loop
 * that settles a surface frame by frame. A bare `await rAF` inside such a loop
 * does not merely skip its optimisation in a hidden tab: it never completes an
 * iteration, so a bounded loop hangs on its FIRST one, forever.
 */
export function nextPaint(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') {
    return new Promise((resolve) => setTimeout(resolve, PAINT_POLL_FALLBACK_MS));
  }
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
    setTimeout(resolve, PAINT_POLL_FALLBACK_MS);
  });
}
