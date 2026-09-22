/**
 * THE TAB BOOTSTRAP, served to the page that runs the editor.
 *
 * The page is the Code-OSS workbench's — VS Code authored its HTML — so the
 * bootstrap that makes it one of this session's TABS cannot be inline in it
 * and cannot be a module of the editor's graph. It is a classic script the
 * fork's contribution loads from this origin, before the React Refresh
 * preamble and before the editor itself; the script takes its base from its
 * own `src`, so every url it builds points at this session rather than at the
 * page.
 *
 * WHAT IT IS FOR: without it a window runs the editor, answers commands and
 * NEVER BEATS — `vgai status` says "TAB PRESENCE — SOMETHING IS OFF", and it
 * is right (docs/CODE-OSS.md §The frame's page is a TAB; WORK.md U11).
 *
 * ONE AUTHOR, and it is `packages/editor/src/tab-bootstrap.js`. This route
 * serves that file's bytes; there is no second copy and nothing to keep in
 * step.
 */

import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where the bootstrap is served from. */
export const TAB_BOOTSTRAP_PATH = '/__editor/tab-bootstrap.js';

/**
 * The bootstrap's own file, resolved from THIS module rather than from an
 * engine root: the two hosts disagree about what that root is (the dev host's
 * is the checkout, the packaged host's is the installed `@vgai/editor`), while
 * `server/` and `dist-server/` are both direct children of the package — so
 * `../src/tab-bootstrap.js` is the same file under either.
 */
const BOOTSTRAP_SOURCE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/tab-bootstrap.js',
);

let cached: { mtimeMs: number; source: string } | null = null;

/**
 * The bootstrap's source. Re-read when the file changes, so an edit is live in
 * the next page without restarting the session; a missing file throws naming
 * the path, because a silent empty answer here is a frame that never beats.
 */
export function readTabBootstrapSource(): string {
  const file = BOOTSTRAP_SOURCE;
  let mtimeMs: number;
  try {
    mtimeMs = statSync(file).mtimeMs;
  } catch (error) {
    throw new Error(
      `${file} is missing, so this session can serve no tab bootstrap and any page it hosts will ` +
        `never beat (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
  if (cached !== null && cached.mtimeMs === mtimeMs) return cached.source;
  const source = readFileSync(file, 'utf8');
  cached = { mtimeMs, source };
  return source;
}
