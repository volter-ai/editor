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
 *
 * `vite:preloadError` is NOT evidence of a stale deployment: Vite's build
 * helper also emits it for any rejection of a wrapped dynamic import. Story
 * discovery imports project modules even while no board or Play mounts them.
 * A syntax error or module-body throw there must reach the story's error
 * surface, never reload the editor or consume the deployment recovery guard.
 */
const RELOAD_GUARD_KEY = 'volter:stale-chunk-reload';

/** Recover only a missing hashed asset beside this editor build's own chunk.
 * Browsers that omit the failed URL cannot establish that fact: leave their
 * error visible. A network failure, transform error or evaluation exception
 * is likewise not evidence that a new editor deployment can repair it. */
export async function isMissingEditorBuildAsset(
  error: unknown,
  editorModuleUrl: string,
  request: typeof fetch = fetch,
): Promise<boolean> {
  if (!error || typeof error !== 'object' || !('message' in error)) return false;
  if (typeof error.message !== 'string') return false;
  const match = /^(?:Failed to fetch dynamically imported module:|error loading dynamically imported module:|Unable to preload CSS for)\s*(\S+)\s*$/.exec(error.message);
  if (!match) return false;
  try {
    const editor = new URL(editorModuleUrl);
    const asset = new URL(match[1]!, editor);
    const hashedAsset = /-[\w-]{8,}\.(?:js|css)$/;
    if (!/^https?:$/.test(editor.protocol) || !hashedAsset.test(editor.pathname)) return false;
    if (asset.origin !== editor.origin || !hashedAsset.test(asset.pathname)) return false;
    if (new URL('.', asset).href !== new URL('.', editor).href) return false;
    const response = await request(asset.href, { method: 'HEAD', cache: 'no-store' });
    return response.status === 404 || response.status === 410;
  } catch {
    return false;
  }
}

export function installStaleChunkRecovery(): void {
  if (typeof window === 'undefined') return;
  let checking = false;
  let reloaded = false;
  window.addEventListener('vite:preloadError', async (event) => {
    if (checking || reloaded) return;
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) ?? 0);
    } catch {
      // The in-memory guard still prevents concurrent recovery in this page.
    }
    if (Date.now() - last < 60_000) return; // already reloaded for this; let the crash surface show
    checking = true;
    let missing: boolean;
    try {
      missing = await isMissingEditorBuildAsset(
        (event as Event & { payload?: unknown }).payload,
        import.meta.url,
      );
    } finally {
      checking = false;
    }
    if (!missing) return;
    reloaded = true;
    try {
      sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
    } catch {
      // storage unavailable
    }
    // Do not suppress the original import rejection. Confirmation is async;
    // the importing surface owns the error while we check the deployment.
    window.location.reload();
  });
}
