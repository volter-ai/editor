/**
 * A vendored game committed as a SERVED BUNDLE, opened locally as a project.
 *
 * `public/ingest/<id>/` holds games vendored as build output rather than as
 * source (CLAUDE.md, "Repo layout"). Those folders carry their own
 * `vgai.project.json`, so `vgai edit public/ingest/<id>` opens them like any
 * other project — and the manifest ingest route then built the entry's import
 * url with `fsImportPath`, i.e. `/@fs/<abs>/…`, putting a file that lives in
 * VITE'S OWN `public/` DIRECTORY into Vite's module graph.
 *
 * That is the one thing Vite refuses outright. Measured on this route
 * (2026-08-20, `vgai edit public/ingest/tanks`, identically for `simcity`):
 *
 *   [vite] Internal Server Error
 *   Cannot import non-asset file /ingest/tanks/three-r170.module.js which is
 *   inside /public. JS/CSS files inside /public are copied as-is on build and
 *   can only be referenced via <script src> or <link href> in html.
 *
 * → 500 → `Failed to fetch dynamically imported module: …/@fs/…/tanks-entry.js`
 * → mount failed, no world, nothing on screen.
 *
 * `discovery-public-ingest.ts`'s header already states the rule this route
 * broke: `public/` is deliberately OUTSIDE the module graph in both builds,
 * "and importing from it is explicitly unsupported" — which is exactly why the
 * hosted lane fetches these bundles as ordinary static files and bundles them
 * client-side (`browser-transpile.ts`'s `importServedModule`). A bundle does
 * not stop being served because the door that opened it was a session rather
 * than a `?project=` id, so the LOCAL route resolves the same way: by URL.
 *
 * The `__VGAI_ENGINE_ROOT__` read is the exact inverse of
 * `imported-gallery.ts`'s `importedProjectPath` (gallery card → absolute folder);
 * this is absolute folder → served URL.
 */

import { importServedModule } from '../host/browser-transpile';
import { ensureServedBundleRuntimeModules } from '../host/served-bundle-runtime-modules';
import { bootDeclaredDocument, declaresClassicEntry, readDeclaredBoot } from './served-html-boot';

declare const __VGAI_ENGINE_ROOT__: string;

function withoutTrailingSlash(path: string): string {
  return path.endsWith('/') ? path.slice(0, -1) : path;
}

/**
 * The root-relative URL base a project folder is SERVED at, or `undefined`
 * when this project is not served by the editor's own static root.
 *
 * `<engineRoot>/public/ingest/tanks` → `/ingest/tanks/`. Deliberately
 * id-generic and not `ingest`-specific: what makes a folder served is that it
 * sits under the editor app root's `public/`, which is a fact about the
 * checkout, not about the game.
 */
export function servedProjectBaseUrl(projectRoot: string): string | undefined {
  if (typeof __VGAI_ENGINE_ROOT__ !== 'string' || !__VGAI_ENGINE_ROOT__) return undefined;
  const publicRoot = `${withoutTrailingSlash(__VGAI_ENGINE_ROOT__)}/public/`;
  const dir = `${withoutTrailingSlash(projectRoot)}/`;
  if (!dir.startsWith(publicRoot) || dir === publicRoot) return undefined;
  return `/${dir.slice(publicRoot.length)}`;
}

/**
 * Import one module out of a served bundle, in the host realm — the ONE
 * loader both the hosted lane (`discovery-public-ingest.ts`) and the local
 * session route (`ingest/resolve-three.ts`'s `resolveIngestDescriptor`) use, so
 * the two doors onto the same folder cannot diverge in how they run it.
 */
export function servedModuleLoader(baseUrl: string, relPath: string): () => Promise<unknown> {
  const url = servedUrl(baseUrl, relPath);
  return async () => {
    await ensureServedBundleRuntimeModules();
    return importServedModule(url);
  };
}

function servedUrl(baseUrl: string, relPath: string): string {
  const rel = relPath.startsWith('/') ? relPath.slice(1) : relPath;
  return `${baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`}${rel}`;
}

/**
 * The loader for a served bundle's ENTRY specifically — the one module whose
 * LANGUAGE MODE the bundle's own `index.html` gets to decide.
 *
 * Its siblings (`ingest.contractShim`, `ingest.dataWriter`) stay on
 * {@link servedModuleLoader}: those are host-authored ES modules by contract,
 * and nothing declares them anywhere else. Only the entry is the game's own
 * build output, and only for the entry does "is this an ES module?" have an
 * answer that is not the host's to assume — see `served-html-boot.ts`.
 */
export function servedEntryLoader(baseUrl: string, relPath: string): () => Promise<unknown> {
  const url = servedUrl(baseUrl, relPath);
  return async () => {
    await ensureServedBundleRuntimeModules();
    const boot = await readDeclaredBoot(baseUrl);
    if (!declaresClassicEntry(boot, url)) {
      // A module entry's document still gets its say: its BODY is staged and
      // its CLASSIC PRELUDE scripts run first (a page may load a CDN global
      // like `THREE` classically and read it from the module —
      // server-survival's declared boot). `bootDeclaredDocument` skips module
      // scripts, so the entry itself is imported exactly once, below.
      if (boot) await bootDeclaredDocument(boot, url);
      return importServedModule(url);
    }
    // `boot` is non-null whenever `declaresClassicEntry` answered true.
    await bootDeclaredDocument(boot as NonNullable<typeof boot>, url);
    return {};
  };
}
