/**
 * The editor's built-in port fallback, and the paired HMR-socket derivation.
 *
 * ONE owner for the number, because it is spelled in a launcher (`vgai edit`),
 * three servers (dev / prod / packaged), and a client default — a duplicated
 * literal across those drifts silently.
 *
 * **Why not Vite's 5173.** It used to be exactly that, and 5173 is the default
 * of every Vite app on the machine. On a box running any other Vite dev server
 * the engine-repo editor and that app fight over one port, and — worse —
 * `http://…:5173` can resolve to a FOREIGN application. Measured 2026-08-07:
 * an unrelated process on 5173 was what the editor's tab self-heal opened.
 *
 * **The band.** 20000-20199 is vgai's own reserved band: fixed, hand-picked
 * ports that must never be minted for a worktree session. Machine-local
 * allocations start at 20200, so one can never land on this default by chance.
 * 20173 keeps Vite's memorable `173` tail while sitting in a range nothing
 * else claims.
 */
export const DEFAULT_EDITOR_PORT = 20_173;

/**
 * The Vite HMR websocket port paired with an editor port.
 *
 * Editor ports in 20000-29999 map into the parallel 30000-39999 band, so two
 * worktree sessions cannot collide merely because their editor ports differ
 * by 100. Anything outside that band keeps the simple +100 offset.
 *
 * `DEFAULT_EDITOR_PORT` derives 30173 through the first arm — no special case,
 * which is the point: the old expression carried a hardcoded `5173 -> 24678`
 * exception precisely because the default sat outside the band it designed.
 */
export function editorHmrPort(editorPort: number): number {
  return editorPort >= 20_000 && editorPort < 30_100 ? editorPort + 10_000 : editorPort + 100;
}

/**
 * Wrap a bare IPv6 literal in brackets so it is legal inside a URL authority.
 * `127.0.0.1`, a hostname, and an already-bracketed literal pass through.
 */
function urlAuthorityHost(host: string): string {
  if (host.startsWith('[')) return host;
  return host.includes(':') ? `[${host}]` : host;
}

/**
 * The ONE composer for an editor origin — every URL vgai PRINTS, OPENS,
 * SELF-HEALS with, records in `.vgai/session.json`, or dials.
 *
 * **It never says `localhost`.** A bare-`localhost` URL is a different address
 * from the one the server is listening on: on a dual-stack box `localhost`
 * resolves `::1` first while the editor binds `127.0.0.1`, so the URL reaches
 * whatever else happens to hold that port on IPv6. Measured 2026-08-07 — the
 * tab bijection's self-heal opened an UNRELATED application in the owner's
 * browser because it composed its reopen URL from `localhost` instead of the
 * host the server had actually bound.
 *
 * `bindHost` is the host the server bound (`resolveBindHost`); callers that
 * only know a port — the CLI and SDK clients dialing a local session — omit it
 * and get the IPv4 loopback literal. A wildcard bind (`0.0.0.0` / `::`, which
 * is what WSL gets) is not an address a browser can visit, so it degrades to
 * that same literal: reachable from the same box, and reachable from Windows
 * through WSL2's loopback forwarding.
 */
export function editorOrigin(port: number, bindHost?: string): string {
  const host = (bindHost ?? '').trim();
  const unusable = host === '' || host === '0.0.0.0' || host === '::' || host === '[::]';
  return `http://${unusable ? '127.0.0.1' : urlAuthorityHost(host)}:${port}`;
}
