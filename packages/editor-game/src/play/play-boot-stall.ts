/**
 * The play boot's stall guard: a BACKGROUNDED editor tab must never turn a
 * network-shaped play-start step into a silent timeout.
 *
 * ## The measurement this exists for
 *
 * Play start is frame-independent — it boots fine on a tab whose
 * `requestAnimationFrame` never fires at all (measured: a hidden real-Chrome
 * tab starts play in ~1s, and so does a tab with rAF stubbed dead). What is
 * NOT independent is the network. A backgrounded tab's requests are
 * deprioritized by the browser, so the fetch-shaped steps of
 * `enterPlayMode` — the log-session POST, the manifest fetch, the dynamic
 * imports that resolve each root's entry — queue behind whatever else that
 * origin is loading. Measured in a hidden tab on a cold Vite graph:
 *
 *     post-logSession        @13125   (9.5s)
 *     post-fetchManifest    @158274   (145s)
 *     pre-resolveAllRootEntries       (still pending at 165s)
 *
 * The relay's own `play` budget is 120s (`server-utils.ts`'s
 * `relayCommandTimeoutMs`), so the caller gets
 * "Command timed out — editor connected but did not respond" — a message that
 * names nothing, points at nothing, and hides the one remedy that works
 * (foreground the tab; the very next `vgai play` then starts in seconds).
 *
 * ## What this does, and deliberately does not do
 *
 * A step that exceeds {@link PLAY_BOOT_STALL_MS} while `document.hidden` is
 * reported as a NAMED failure that states the step, the elapsed budget, and
 * the fix. A step that exceeds it while the tab is VISIBLE is not touched:
 * a foregrounded tab is not being starved, so slow there means genuinely
 * slow, and failing it would be a regression. The visibility is re-read when
 * the timer fires, so a tab foregrounded mid-boot keeps its boot.
 *
 * Rejecting does not cancel the underlying request — it abandons it. Only
 * steps whose abandoned result is inert (a fetch, a module import) are
 * wrapped; the runtime MOUNT is not, because an abandoned mount would leak a
 * live session.
 *
 * (`p-timeout` was considered and rejected: its contract is an unconditional
 * deadline, and the whole point here is that the deadline applies only while
 * the tab is hidden — plus the message is the deliverable.)
 */

/** How long one network-shaped play-boot step may sit while the tab is hidden.
 *  Generous by design: every such step measures in TENS OF MILLISECONDS on a
 *  healthy hidden tab, so this only fires on a genuinely starved one. */
export const PLAY_BOOT_STALL_MS = 15_000;

export interface PlayBootStallOptions {
  /** Whether the editor tab is backgrounded right now. Re-read when the
   *  timer fires, never captured up front. */
  readonly isHidden: () => boolean;
  /** The editor page's own URL, so the message can name the tab to open. */
  readonly editorUrl?: string | undefined;
  readonly stallMs?: number | undefined;
  readonly setTimer?: ((fn: () => void, ms: number) => unknown) | undefined;
  readonly clearTimer?: ((handle: unknown) => void) | undefined;
}

/** The one message. Names the step, the condition, and the remedy. */
export function playBootStallMessage(step: string, stallMs: number, editorUrl?: string): string {
  const open = editorUrl ? ` (open ${editorUrl})` : '';
  return (
    `Play start stalled at "${step}" for ${Math.round(stallMs / 1000)}s and the editor tab is ` +
    'HIDDEN — a backgrounded tab has its network requests deprioritized by the browser, so this ' +
    'step is queued rather than broken. Bring the editor tab to the foreground' +
    `${open} and run play again; the engine loop itself is hidden-safe, only the boot's ` +
    'fetches are starved.'
  );
}

/**
 * Run one network-shaped play-boot step under the hidden-tab stall guard.
 *
 * Resolves/rejects with `work`'s own outcome in every case except one: the
 * step is still pending after the budget AND the tab is hidden, which
 * rejects with {@link playBootStallMessage}.
 */
export function withPlayBootStallGuard<T>(
  step: string,
  work: Promise<T>,
  options: PlayBootStallOptions,
): Promise<T> {
  const stallMs = options.stallMs ?? PLAY_BOOT_STALL_MS;
  const setTimer =
    options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms) as unknown);
  const clearTimer =
    options.clearTimer ??
    ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const handle = setTimer(() => {
      if (settled) return;
      // Re-read visibility HERE: a tab foregrounded during the wait is no
      // longer starved, and must keep the boot it already has in flight.
      if (!options.isHidden()) return;
      settled = true;
      reject(new Error(playBootStallMessage(step, stallMs, options.editorUrl)));
    }, stallMs);

    work.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimer(handle);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimer(handle);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
