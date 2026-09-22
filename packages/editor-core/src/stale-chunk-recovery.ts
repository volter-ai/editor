/**
 * A LAZY CHUNK THAT NO LONGER EXISTS RELOADS THE PAGE ONCE.
 *
 * The hosted editor is deployed as hashed chunks and a promotion replaces
 * every one of them: a tab that loaded the previous build keeps working until
 * it lazily imports a chunk it has not touched yet — the first Play of a
 * session, an Inspector preview — and gets a 404 for a hash the host no
 * longer serves. Vite surfaces that as `vite:preloadError` on `window`, and
 * the editor showed it as a crash whose Retry could never succeed ("Failed to
 * fetch dynamically imported module … InspectorObjectPreview-…js", runhuman
 * pass 146, a session that straddled a promotion). One ordinary reload picks
 * up the current build; the guard keeps a genuinely broken host from looping.
 */
const RELOAD_GUARD_KEY = 'vgai:stale-chunk-reload';

export function installStaleChunkRecovery(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('vite:preloadError', (event) => {
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) ?? 0);
    } catch {
      // storage unavailable — reload once regardless
    }
    if (Date.now() - last < 60_000) return; // already reloaded for this; let the crash surface show
    try {
      sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
    } catch {
      // storage unavailable
    }
    event.preventDefault();
    window.location.reload();
  });
}
