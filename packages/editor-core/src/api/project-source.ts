/**
 * Reading and writing the project's own files.
 *
 * `public/` operations route through the backend-agnostic `StorageBackend`
 * (`../storage`): `HttpStorage` over the same `/__editor/*` routes, wrapped by
 * the frame's file door once its provider lands.
 *
 * The SPA-fallback check here is load-bearing: a dev server answers 200 with
 * the editor's own `index.html` for a missing file, so "did I get the file"
 * cannot be asked of the status code alone.
 */

import { resolveUrl } from '@volter/editor-threejs/loader';
import { base64ToBytes } from '../bytes-codec';
import { getStorageBackend } from '../storage';
/**
 * Read a project text file from the session that owns the project namespace.
 *
 * The storage backend is NOT the door here: `HttpStorage` is rooted at
 * `public/`, not at the project root, so asking it for `src/...` produces a
 * known-false asset-list 404 before the real Vite read. This goes directly to
 * HTTP. Returns null when the file is not served.
 */
export async function readProjectTextFile(path: string): Promise<string | null> {
  try {
    const res = await fetch(resolveUrl(path));
    if (res.ok) return await res.text();
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * What a probe can honestly conclude about a project file. THREE answers,
 * because "no" and "I could not tell" are different facts and a boolean has
 * to spend one of them.
 */
export type ProjectFilePresence = 'present' | 'absent' | 'unreachable';

/**
 * A 200 that is really the SPA FALLBACK, not the file.
 *
 * MEASURED, dev server, project root `public/ingest/cuberun/` (which owns no
 * `vgai.adapter.ts`):
 *
 *   curl -sI /vgai.adapter.ts   -> 200, Content-Type: text/html      (index.html)
 *   curl -sI /vgai.project.json -> 200, Content-Type: application/json; charset=utf-8
 *
 * The fallback serves the editor's own `index.html`, so it is identifiable by
 * the one thing it cannot hide: it is an HTML DOCUMENT. Nothing this probe is
 * ever pointed at — a module, a manifest, an asset — is served as `text/html`,
 * and the storage backend answers first for anything that could be.
 *
 * This shape is not dev-only: `docs/DEPLOY.md` §Surface 3 specifies serving
 * `dist/` with an index.html fallback, i.e. "a missing asset returns
 * `index.html`". Both shipped surfaces answer the same way.
 */
function isSpaFallbackDocument(response: Response): boolean {
  return (response.headers.get('content-type') ?? '').toLowerCase().includes('text/html');
}

/**
 * Does this project file exist? — CONTENT-DISCRIMINATED, because on both
 * surfaces this product ships an existence probe that trusts `res.ok` is a
 * constant `true`.
 *
 * `HttpStorage` is deliberately rooted at
 * `public/`, while this probe accepts project-root paths such as
 * `src/prefabs/Player.tsx`; asking that backend first turns an ordinary source
 * probe into a noisy `/__editor/assets?dir=src` 404. This therefore
 * asks Vite directly with HEAD. Both routes remain existence-only — neither
 * downloads the file body.
 *
 * The HTTP probe classifies rather than trusting `res.ok`:
 *
 *   - not ok            -> `absent` (a real 404 from a real route);
 *   - ok + `text/html`  -> `absent`  — {@link isSpaFallbackDocument}, the
 *     measured false positive;
 *   - ok, anything else -> `present` (a real file answering with its own
 *     content type);
 *   - the fetch throws  -> `unreachable`. NOT `absent`: an unanswered probe is
 *     a fact about the transport, and a caller that must not act on a guess
 *     (see `project-adapter.ts`, which chooses a BINDING TABLE off this) is
 *     entitled to know the difference.
 *
 * This function's earlier docblock already recorded the false positive —
 * "the dev server's SPA fallback also answers a HEAD/GET for a MISSING path
 * with 200 (it serves `index.html` rather than 404), so `res.ok` alone cannot
 * fully distinguish 'exists' from 'missing'" — and dismissed it as harmless
 * because "a false positive here just means a subsequent real open attempt
 * fails through its own error path". That held for the then-only caller
 * (`workspace-state-persistence`, probing `public/`-rooted asset paths the
 * storage backend answers authoritatively). It stopped holding the moment a
 * project-ROOT path was probed AHEAD of a branch that would otherwise have
 * succeeded: the "own error path" then reports a load failure for a file the
 * project never had, and the real binding is never reached. The discrimination
 * lives HERE, inside the probe, so the next caller cannot re-inherit the blind
 * question.
 */
export async function probeProjectFile(path: string): Promise<ProjectFilePresence> {
  // Ask the origin; the fallback detector below keeps a SPA 200 from counting
  // as the file.
  try {
    const res = await fetch(resolveUrl(path), { method: 'HEAD' });
    if (!res.ok) return 'absent';
    return isSpaFallbackDocument(res) ? 'absent' : 'present';
  } catch {
    return 'unreachable';
  }
}

/**
 * Check whether a project file exists WITHOUT reading its content — the
 * boolean face of {@link probeProjectFile}, for callers with nothing to do
 * about the difference between "no" and "could not tell". Prefer this over
 * `readProjectTextFile(...) !== null` when only existence is needed, since
 * that reads and discards the whole body.
 */
export async function projectFileExists(path: string): Promise<boolean> {
  return (await probeProjectFile(path)) === 'present';
}

/** Save a file to public/. Returns true on success. */
export async function saveFile(
  path: string,
  content: string,
  encoding?: 'base64',
): Promise<boolean> {
  try {
    // base64 content → raw bytes; the backend re-encodes per its transport.
    // `base64ToBytes` is a LOOP; `Uint8Array.from(atob(…), (c) => …)` calls the
    // mapping callback once per CHARACTER (measured 27.7x slower at 3MB).
    const data: string | Uint8Array = encoding === 'base64' ? base64ToBytes(content) : content;
    await getStorageBackend().write(path, data);
    return true;
  } catch {
    return false;
  }
}

/**
 * Project-relative source files matching `globs` (`src/models/**\/*.ts`; `*`
 * within a segment, `**` across segments) — what a finder's `include`
 * reads through (`FinderInput.sources`), answered by the session's
 * `/__editor/source-files` route.
 */
export async function listProjectSourceFiles(
  globs: readonly string[],
  options: { readonly order?: 'name' | 'mtime' } = {},
): Promise<string[]> {
  if (globs.length === 0) return [];
  const res = await fetch(
    `/__editor/source-files?${new URLSearchParams([
      ...globs.map((g): [string, string] => ['include', g]),
      ...(options.order === 'mtime' ? [['order', 'mtime'] as [string, string]] : []),
    ])}`,
  );
  if (!res.ok) return [];
  const body = (await res.json()) as { files?: string[] };
  return body.files ?? [];
}
