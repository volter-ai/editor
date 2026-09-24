/**
 * THE UNEXPORTED-GAME TRAP: a dev-served standalone game page REFUSES to boot.
 *
 * Owner decision (2026-08-09): until a game is EXPORTED, it is never played
 * outside the editor. The editor is the one authoring, viewing and
 * verification surface; the standalone page exists to serve the exported
 * artifact, not to be a second door during development.
 *
 * Why this is a trap in CODE and not a rule in prose: the rule already
 * existed, and it drifted. When an editor session broke mid-task, an agent
 * "temporarily" switched to `npm run game`, the fallback fed its whole
 * feedback loop (pixels for screenshots), nothing broken ever pushed it back,
 * and hours of verification ran outside the editor without anyone deciding
 * that. A workaround whose cost lands outside the loop that chose it is
 * sticky; the only fix that holds is for the workaround PATH ITSELF to fail
 * immediately, loudly, and with the way back in its hands. That is this file.
 *
 * The boundary is DEV-SERVED vs EXPORTED, decided by the bundler: a Vite dev
 * server strips nothing, so `import.meta.env.DEV` is true; a production build
 * (`vite build` — what `vgai deploy` runs) compiles it false and this module
 * costs an exported game nothing. Headless contexts (unit tests, playtest's
 * node leg) have no real browser page and never trip it — the check requires
 * a document whose `defaultView` is the window, which no test stub wires up.
 *
 * There is deliberately NO opt-out flag, env var, or query param. An escape
 * hatch an agent can reach for is the workaround again, one hop later.
 */

/** What the refusal says — one place, so the page and the thrown Error agree. */
const REFUSAL = [
  'UNEXPORTED GAME, OUTSIDE THE EDITOR — refusing to mount.',
  '',
  'This game has not been exported. Until it is, the ONLY way to run, see,',
  'or drive it is the editor:',
  '',
  '    vgai edit .        open (or reuse) the editor for this project',
  '    vgai play          enter play mode from the terminal',
  "    vgai eval '<js>'   drive and read the running game",
  '',
  'The standalone page serves EXPORTED builds only (`vgai deploy`, or the',
  'production build it runs). Do not script around this page — no headless',
  'browsers, bots, or screenshots against the dev server. Every agent',
  'workflow goes through the editor session.',
].join('\n');

/** True only on a real, dev-served browser page — the one context the trap is for. */
function isDevServedBrowserPage(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  // Test stubs install a bare `document` object; only a real page has the
  // document↔window linkage.
  if (document.defaultView !== window) return false;
  return Boolean(import.meta.env?.DEV);
}

/**
 * Throws (and paints a full-screen refusal, so a human at the tab sees it as
 * immediately as a harness watching the console does) when an unexported game
 * is being mounted on a dev-served page. Called by `mountGameFromManifest`
 * before any root is resolved; exported builds and headless tests pass
 * through untouched.
 */
export function assertExportedOrInEditor(): void {
  if (!isDevServedBrowserPage()) return;

  const screen = document.createElement('pre');
  screen.textContent = REFUSAL;
  screen.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:2147483647',
    'margin:0',
    'padding:48px',
    'background:#1A0E0E',
    'color:#FF9B8A',
    'font:600 15px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace',
    'white-space:pre-wrap',
  ].join(';');
  document.body.appendChild(screen);
  document.title = 'UNEXPORTED — use the editor';

  throw new Error(`mountGameFromManifest: ${REFUSAL}`);
}
