/**
 * "This project module was saved" — the ONE subscription for editor surfaces
 * that hold a live, re-executable copy of a project source module.
 *
 * WHICH SIGNAL, AND WHY IT IS THE HMR CHANNEL AND NOT SSE
 * -------------------------------------------------------
 * The editor has two file-change channels and they answer different
 * questions. `asset-events.ts` (SSE) reports FILE-SET changes — a tool or
 * story file appeared/vanished, a `public/` asset changed — and it carries no
 * event for "an arbitrary `src/**` module's bytes changed". Vite's HMR
 * channel does, and it carries something the SSE channel cannot: the dev
 * server has already stamped the changed file HMR-invalid across the
 * project's own subgraph before it sends (`server/project-script-hmr.ts`'s
 * `stampHmrInvalidation`, bounded at editor chrome). That stamp is what makes
 * a cache-busted re-import re-evaluate the module's DEPENDENCIES too; without
 * it a fresh leaf url re-runs against the browser's cached copies of
 * everything it imports, which is the exact stale-restart defect that module's
 * header documents. So the freshness guarantee is the server's, and this
 * subscription is how a document learns the stamp has landed.
 *
 * THE THREE EVENTS are the complete set the server sends for a project source
 * file (`handleProjectScriptHotUpdate`); a live module document takes all
 * three because its subject can be any of those classifications:
 *   - `vgai:restart-required` — a plain `.ts`, or a `.tsx` that is not a Fast
 *     Refresh boundary. THE COMMON CASE for a model module, whose export is a
 *     lowercase builder function.
 *   - `vgai:script-update` — the file is in the editor's lane (`src/contributions/`, `src/tools/`).
 *   - `vgai:r3f-entry-update` — the file is R3F-dialect.
 * A `.tsx` that IS a Fast Refresh boundary rides stock Vite HMR instead and
 * sends none of these, so `vite:afterUpdate` is taken as well: Vite stamped
 * the graph itself on that path, and the accepted path names the file.
 *
 * Nothing here re-imports anything. The subscriber owns what "changed" means
 * for its own surface.
 */

/** Project-relative path of the module that changed, e.g. `src/prefabs/probe.ts`. */
export type ProjectModuleChangeListener = (relativePath: string) => void;

/**
 * WHY THE TRANSFORM ERROR IS RECORDED SEPARATELY: a dynamic `import()` of a
 * module the server could not transform rejects with the browser's own opaque
 * `TypeError: Failed to fetch dynamically imported module: <url>` — the
 * ACTUAL reason (`Unexpected ";"`, at line:col, with a source frame) never
 * reaches the importer. Vite sends it on the HMR channel instead, as
 * `vite:error`, and `editor-console.ts` already prints it. A document showing
 * a build failure needs the same text: "failed to fetch" is not a modeling
 * error message.
 *
 * Kept as a LAST-ERROR-PER-FILE map rather than a subscription because the
 * consumer reads it at the moment its import rejects, which is after the
 * event: the server sends `vite:error` while answering the very request that
 * is about to reject.
 */
interface ViteErrorPayload {
  readonly err?: {
    readonly message?: unknown;
    readonly id?: unknown;
    readonly frame?: unknown;
    readonly loc?: { readonly file?: unknown; readonly line?: unknown; readonly column?: unknown };
  };
}

/** Keyed by the normalized absolute file path Vite reports. */
const lastTransformError = new Map<string, string>();
let transformErrorsWired = false;

function wireTransformErrors(): void {
  if (transformErrorsWired) return;
  const hot = import.meta.hot;
  if (!hot) return;
  transformErrorsWired = true;
  hot.on('vite:error', (payload: ViteErrorPayload) => {
    const err = payload?.err;
    if (!err || typeof err.message !== 'string') return;
    const file =
      typeof err.loc?.file === 'string' ? err.loc.file : typeof err.id === 'string' ? err.id : null;
    if (file === null) return;
    const frame = typeof err.frame === 'string' && err.frame !== '' ? `\n${err.frame}` : '';
    // Vite ids carry the transform query; the record is keyed by the file.
    lastTransformError.set(normalize(file.split('?')[0] ?? file), `${err.message}${frame}`);
  });
}

/**
 * The server's own reason the module at `relativePath` did not transform, if
 * it reported one — see {@link ViteErrorPayload}. `null` when the failure was
 * something else (a throwing top level, a missing dependency at runtime),
 * which is the caller's cue to report what its own `import()` said.
 */
export function projectModuleTransformError(relativePath: string): string | null {
  for (const [file, message] of lastTransformError) {
    if (projectModuleChangeMatches(file, relativePath)) return message;
  }
  return null;
}

/** Drop the recorded transform error for a module that has now built. */
export function clearProjectModuleTransformError(relativePath: string): void {
  for (const file of [...lastTransformError.keys()]) {
    if (projectModuleChangeMatches(file, relativePath)) lastTransformError.delete(file);
  }
}

/** Server-sent event payloads all carry `{ file }` as an ABSOLUTE path. */
interface HotFilePayload {
  readonly file?: unknown;
}

/** Vite's own `vite:afterUpdate` payload, narrowed to what is read here. */
interface ViteUpdatePayload {
  readonly updates?: ReadonlyArray<{ readonly acceptedPath?: unknown; readonly path?: unknown }>;
}

function normalize(path: string): string {
  return path.replaceAll('\\', '/');
}

/**
 * Does `changedPath` (absolute, or already project-relative) name
 * `relativePath` of the open project? Compared by SUFFIX because the two
 * halves spell the same file differently: the dev server reports the absolute
 * path it watched, and a document knows only its project-relative one. The
 * leading separator makes the suffix a whole path segment, so
 * `src/prefabs/probe.ts` never matches `.../not-src/prefabs/probe.ts`.
 */
export function projectModuleChangeMatches(changedPath: string, relativePath: string): boolean {
  const changed = normalize(changedPath);
  const relative = normalize(relativePath).replace(/^\.?\//, '');
  return changed === relative || changed.endsWith(`/${relative}`);
}

/**
 * Call `listener` whenever the dev server reports that a project source module
 * was saved. Returns the unsubscribe. A no-op (and an immediately-returned
 * unsubscribe) outside a Vite dev client — the packaged host has no HMR
 * channel, and a surface that needs one says so itself.
 */
export function subscribeProjectModuleChange(listener: ProjectModuleChangeListener): () => void {
  const hot = import.meta.hot;
  if (!hot) return () => {};
  wireTransformErrors();
  const onFileEvent = (payload: HotFilePayload): void => {
    if (typeof payload?.file === 'string') listener(normalize(payload.file));
  };
  const onViteUpdate = (payload: ViteUpdatePayload): void => {
    for (const update of payload?.updates ?? []) {
      const path = update.acceptedPath ?? update.path;
      // Vite's urls carry the transform query (`?t=…`); the path half is the file.
      if (typeof path === 'string') listener(normalize(path.split('?')[0] ?? path));
    }
  };
  hot.on('vgai:restart-required', onFileEvent);
  hot.on('vgai:script-update', onFileEvent);
  hot.on('vgai:r3f-entry-update', onFileEvent);
  hot.on('vite:afterUpdate', onViteUpdate);
  return () => {
    hot.off('vgai:restart-required', onFileEvent);
    hot.off('vgai:script-update', onFileEvent);
    hot.off('vgai:r3f-entry-update', onFileEvent);
    hot.off('vite:afterUpdate', onViteUpdate);
  };
}
