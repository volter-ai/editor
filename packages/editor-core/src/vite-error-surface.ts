/**
 * A Vite transform/build failure is REPORTED, never rendered over the app.
 *
 * The editor and the game it is authoring share one page, one Vite instance
 * and one HMR client, so Vite's stock error overlay — fixed, full-screen,
 * z-index 99999 — made a syntax error in the USER'S GAME SOURCE brick the
 * whole editor: nothing behind it clickable, no way out but editing the file
 * blind. Owner, watching it happen: "this error needs to be surfaced but while
 * this error is up, the rest of the app cannot be used which is a problem."
 * The overlay is therefore off (`server.hmr.overlay: false` in
 * `server/dev.ts` and `server/packaged.ts`) and this module is what the
 * payload goes to instead.
 *
 * WHERE IT GOES: the editor's ONE error home — a console line, the
 * `console-counts` status item that counts it, and, for an EDITOR/engine-owned
 * failure, the auto-revealed Console (the same non-blocking "in your face"
 * move a mount failure already makes). No banner, no second surface: see
 * `components/status-contributions.tsx` on why the shell's error banners were
 * deleted.
 *
 * WHY CLASSIFY AT ALL: the two owners deserve different volume. A game that
 * does not compile is ordinary authoring — say so precisely and get out of the
 * way. Our own engine/editor code failing to compile is a defect in the tool
 * the user is holding, so it also pulls the Console open.
 *
 * Vite ALSO logs its own `[vite] Internal Server Error` line to `console.error`
 * whenever the overlay is off, and `installEditorConsoleCapture()` puts that in
 * the console too. That raw line is the trace; the line this module writes is
 * the classified summary — the same trace/summary split
 * `authoring/mount-failure-report.ts` documents, not a second channel.
 *
 * The SAVE-TIME half of the same story is louder and lives on the server:
 * `server/project-validation.ts` parses every `src/` write, and
 * `server/editor-server.ts` prints `✖ Invalid project file`, broadcasts it to
 * every tab, and holds it in `/__editor/state`'s `projectValidation` (what
 * `vgai status` reads) until the file saves clean again. Recovery therefore
 * needs nothing here: this module holds no state to clear.
 */

import { editorConsole } from './editor-console';
import { showConsoleUtility } from './workspace-utility-commands';

/** The `err` half of Vite's `vite:error` HMR payload — only the fields read
 *  here, so a Vite version that adds more does not need this type updated. */
export interface ViteErrorLike {
  readonly message?: string;
  readonly frame?: string;
  /** Vite's module id: an absolute path, possibly `/@fs`-prefixed and
   *  possibly carrying the `?vgai-mount=N` query `project-module-url.ts`
   *  minted. */
  readonly id?: string;
  readonly loc?: { readonly file?: string; readonly line?: number; readonly column?: number };
}

export type ViteErrorOwner = 'project' | 'editor';

/**
 * The absolute filesystem path a payload blames, or `null` when it blames
 * nothing identifiable.
 *
 * Both forms are normalized here because BOTH occur: `loc.file` is a plain
 * absolute path, while `id` is the URL the browser asked for — which for a
 * project module outside the Vite root is the `/@fs`-prefixed, query-carrying
 * string `project-module-url.ts` builds (`fsImportPath` + `?vgai-mount=N`).
 * Undoing exactly that construction is why the two `/@fs` shapes below mirror
 * `fsImportPath`'s own posix/Windows split.
 */
export function viteErrorFile(err: ViteErrorLike): string | null {
  const raw = err.loc?.file ?? err.id ?? null;
  if (!raw) return null;
  const bare = raw.split('?')[0]!.split('#')[0]!;
  if (!bare) return null;
  if (!bare.startsWith('/@fs/')) return bare;
  const unprefixed = bare.slice('/@fs'.length);
  // `/@fs` + a posix root gives `/@fs/abs/path`; `/@fs/` + a Windows root
  // gives `/@fs/C:/path`, whose leading slash is the separator, not the root.
  return /^\/[A-Za-z]:/.test(unprefixed) ? unprefixed.slice(1) : unprefixed;
}

/**
 * Whose code failed: the OPEN PROJECT's, or ours.
 *
 * "The project's own module" is the same question
 * `server/game-globals-shadow.ts`'s `shouldShadowGameGlobals` answers on the
 * server (a prefix test against the canonical project root) — asked here on
 * the client, where the payload arrives as a URL rather than a path, hence the
 * normalization above. An unattributable failure, or one with no project open,
 * counts as ours: over-reporting our own breakage is the safe direction.
 */
export function viteErrorOwner(err: ViteErrorLike, projectRoot: string): ViteErrorOwner {
  const file = viteErrorFile(err);
  if (!file || !projectRoot) return 'editor';
  const root = projectRoot.endsWith('/') ? projectRoot.slice(0, -1) : projectRoot;
  return file === root || file.startsWith(`${root}/`) ? 'project' : 'editor';
}

/** `file:line:col — message`, plus the code frame when the payload carries one
 *  (Babel/esbuild both do, and the frame is the part the deleted overlay was
 *  genuinely good at showing). */
export function formatViteError(err: ViteErrorLike): string {
  const file = viteErrorFile(err);
  const line = err.loc?.line;
  const column = err.loc?.column;
  const where = file
    ? `${file}${line === undefined ? '' : `:${line}${column === undefined ? '' : `:${column}`}`}`
    : null;
  const head = err.message?.trim() || 'Vite could not build this module.';
  const frame = err.frame?.replace(/\s+$/, '');
  return [where ? `${where} — ${head}` : head, frame || null].filter(Boolean).join('\n');
}

/** The minimal slice of `import.meta.hot` this module needs — narrower than
 *  Vite's `ViteHotContext` so the unit test can call it with a fake. */
export interface ViteErrorHotContext {
  on(event: 'vite:error', cb: (payload: { err?: ViteErrorLike }) => void): void;
}

/**
 * Subscribe the editor's error home to `vite:error`. Called once from
 * `main.tsx`; `getProjectRoot` is read per-event because a project can be
 * opened, switched, or closed long after boot.
 */
export function installViteErrorSurface(
  hot: ViteErrorHotContext,
  getProjectRoot: () => string,
): void {
  hot.on('vite:error', (payload) => {
    const err = payload?.err;
    if (!err) return;
    const owner = viteErrorOwner(err, getProjectRoot());
    if (owner === 'project') {
      editorConsole.error(`This game's source did not build.\n${formatViteError(err)}`, 'game');
      return;
    }
    editorConsole.error(
      `The editor's own source did not build.\n${formatViteError(err)}`,
      'editor',
    );
    showConsoleUtility();
  });
}
