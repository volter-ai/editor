/**
 * THE platform browser hand-off — the one open ladder (darwin / win32 / WSL
 * explorer.exe→powershell.exe / xdg-open), owned here because the editor
 * server must keep maintaining its tab (tab-bijection self-heal,
 * ensure-driven opens) long after any launching CLI process has exited. The
 * CLI imports this module; it does not carry its own copy — the old
 * "no editor-package dependency" premise stopped being true when the CLI
 * grew six editor-server imports and an `@vgai/editor` dependency, and the
 * two ladders had already drifted (`-g` background support on one side
 * only).
 */

import { existsSync, readFileSync } from 'node:fs';
import { spawnOpener } from './spawn-opener';

function isWSL(): boolean {
  if (process.platform !== 'linux') return false;
  try {
    return readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft');
  } catch {
    return false;
  }
}

/**
 * The path segment that identifies a session rooted in an AGENT's git
 * worktree. Agents take one of these before they write code
 * (docs/LOCAL-DEV.md), so it is the one honest, always-present signal that a
 * tab belongs to a background builder rather than to the person at the
 * keyboard.
 */
const AGENT_WORKTREE_MARKER = '/.claude/worktrees/';

/** Env override for the placement decision (`1` background, `0` foreground). */
export const TAB_BACKGROUND_ENV = 'VGAI_TAB_BACKGROUND';

export interface TabOpenPlacementInput {
  /**
   * The session's project root, ALREADY symlink-resolved
   * (`canonicalProjectRoot`) — the marker check is on the real path, because
   * a worktree reached through a symlinked parent would otherwise read as a
   * human checkout.
   */
  readonly projectRoot: string | null | undefined;
  readonly env: Readonly<Record<string, string | undefined>>;
}

/**
 * Decide whether this session's ONE tab should open behind the human's
 * current window instead of stealing focus.
 *
 * Measured (owner, three times in one day): every builder/reviewer `vgai edit`
 * auto-opened a FOREGROUND tab on the one display, so the owner kept ending up
 * looking at an agent's session instead of their own. A session rooted in an
 * agent worktree therefore opens in the BACKGROUND; the human flow — a normal
 * checkout, or a scaffolded game anywhere else — keeps foreground, because for
 * a person the whole point of `vgai edit` is that the editor comes up in front
 * of them.
 *
 * `VGAI_TAB_BACKGROUND` overrides in BOTH directions: `1` backgrounds a tab
 * that would have been foreground, `0` foregrounds one inside a worktree (an
 * agent deliberately showing the owner something).
 *
 * Pure: the caller supplies the resolved root and the environment.
 */
export function shouldOpenTabInBackground(input: TabOpenPlacementInput): boolean {
  const override = input.env[TAB_BACKGROUND_ENV];
  if (override !== undefined && override !== '') {
    return override !== '0' && override.toLowerCase() !== 'false';
  }
  const root = input.projectRoot;
  if (root === null || root === undefined || root === '') return false;
  return root.replaceAll('\\', '/').includes(AGENT_WORKTREE_MARKER);
}

export interface OpenBrowserUrlOptions {
  /**
   * Open behind the frontmost window instead of activating the browser.
   * Honored on macOS only (`open -g`) — Windows `start` and `xdg-open` have no
   * portable equivalent, so every other platform keeps its existing
   * focus-stealing behavior rather than getting a half-kept promise.
   */
  readonly background?: boolean;
}

/** Best-effort open of `browserUrl` in the platform default browser. */
export function openBrowserUrl(browserUrl: string, options?: OpenBrowserUrlOptions): void {
  if (process.platform === 'darwin') {
    // `-g` = do not bring the opened application to the foreground. The tab
    // still opens, still loads, and still registers with the bijection — it
    // just does not seize the display.
    spawnOpener('open', options?.background === true ? ['-g', browserUrl] : [browserUrl]);
  } else if (process.platform === 'win32') {
    // `start` is a cmd builtin, not an executable — it needs cmd itself.
    spawnOpener('cmd', ['/c', 'start', '', browserUrl]);
  } else if (isWSL()) {
    // WSL has no display of its own; hand the URL to the Windows side. A dead
    // interop socket (stale background session) means no Windows .exe can
    // launch — name it instead of failing silently.
    const interop = process.env['WSL_INTEROP'];
    if (interop && !existsSync(interop)) {
      console.error(
        `[vgai-editor] cannot open a browser from this shell — the WSL interop socket ` +
          `(${interop}) is gone, so Windows executables cannot launch. Open ${browserUrl} ` +
          'from any regular terminal or browser instead.',
      );
      return;
    }
    // Explorer is the direct Windows shell-association path. Start-Process
    // can exit zero even when a transient browser process fails to forward
    // the URL to the existing browser, so PowerShell is the fallback.
    spawnOpener('explorer.exe', [browserUrl], () =>
      spawnOpener('powershell.exe', ['-NoProfile', '-Command', `Start-Process '${browserUrl}'`]),
    );
  } else {
    spawnOpener('xdg-open', [browserUrl]);
  }
}
