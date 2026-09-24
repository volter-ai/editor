/**
 * THE in-tree ingest registry — one home, one glob, one manifest convention
 * ONE INGEST HOME.
 *
 * Until this wave there were THREE parallel discovery mechanisms, each named
 * after a rendering library rather than after what it did: `discovery.ts`
 * globbed `games/`, `discovery2d.ts` globbed `games-2d/`, `discovery-react.ts`
 * globbed `games-react/`. Each re-implemented the same four steps (glob the
 * manifests, key them by folder id, parse+validate the single root, cache and
 * look up by id) and each hard-coded the ADAPTER IDENTITY it would accept —
 * `ingest-pixi`, `ingest-react` — which is a library name in a seam that is
 * supposed to be about surfaces. A Phaser or Babylon game had no home.
 *
 * There is now ONE glob over ONE directory, and the discriminator is the
 * manifest's own `surface` (`three | canvas | dom`) — the doctrine vocabulary,
 * "what the host HANDS the root", never which library draws. A vendored Phaser
 * game is a `canvas` root and needs no code here; the library it uses is
 * metadata (`libraryOf`, read off the adapter identity for display/telemetry
 * only, never branched on for mounting).
 *
 * What is deliberately NOT unified: the per-surface MOUNT paths
 * (`surface-three.ts` / `surface-canvas.ts` / `surface-dom.ts`). Mounting a
 * three root, a canvas root and a dom root are genuinely different jobs — a
 * three fixture becomes an `IngestGame`, a canvas fixture an `IngestGame2D`, a
 * dom fixture a `projectRoot` for
 * the `/@fs/` resolver. Those three builders remain, each consuming THIS
 * module's already-parsed entries. Discovery is one; mounting is three.
 *
 * Also not unified, and for a reason that is not library-shaped:
 * `discovery-public-ingest.ts` resolves games vendored under
 * `public/ingest/<id>/`. `public/` is outside Vite's module graph by
 * construction (served verbatim in dev, copied at build), so those manifests
 * are `fetch`ed by id rather than globbed. That split is SERVING-driven, not
 * library-driven, and both halves are id-keyed.
 *
 * ## Why `import.meta.glob`
 *
 * These fixtures live inside this package's own source tree, which Vite (and
 * Vitest, sharing Vite's transform pipeline) knows statically in dev, build and
 * test alike — no runtime fetch, no `/@fs/`, no dev-server middleware.
 * `resolveIngestDescriptor` (ingest/resolve-three.ts) is the route for an EXTERNAL
 * project folder; it is deliberately not used here.
 */

import { declaredRoots } from '@volter/editor-project/adapter/manifest-interpreter';
import type { ResolvedAdapter, ResolvedAdapterRoot } from '@volter/editor-project/manifest/load';
import { loadGameManifest, type ResolvedGameManifest } from '@volter/editor-project/manifest/load';

/** The one manifest glob. Every in-tree ingest fixture, whatever its surface. */
const manifestModules = import.meta.glob('./games/*/vgai.project.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>;

/**
 * The one entry-module glob, shared by every surface: the host imports a
 * fixture's own entry module (and its `contractShim`, when it declares one) in
 * the editor's realm. `.d.ts` is excluded: an ambient declaration file
 * is not a module and must never become a dynamic-import chunk.
 *
 * `vgai.adapter.ts` is excluded too, and for a different reason: it is not a
 * GAME module at all. It is host-realm DECLARATION (see {@link adapterModules}),
 * read without booting anything, and a manifest that named it as an `entry` or
 * a `contractShim` would be nonsense — so it is not in the set those fields
 * resolve against.
 */
export const entryModules = import.meta.glob([
  './games/*/*.js',
  './games/*/*.ts',
  '!./games/*/*.d.ts',
  '!./games/*/vgai.adapter.ts',
]) as Record<string, () => Promise<unknown>>;

/**
 * THE ADAPTER GLOB — one `vgai.adapter.ts` per ingest game, keyed by game id.
 *
 * ARCHITECTURE-CORE §The editor protocol: "Placement follows REALM: game-realm
 * code (a shim that runs inside the game) lives with the game's bundle;
 * host-realm declaration (`vgai.adapter.ts`) lives where the host can import it
 * as a real module — a repo-vendored bundle's adapter file lives in the host's
 * in-tree registry, never inside the verbatim-served bundle." This directory IS
 * that registry, so it holds BOTH populations:
 *
 *   - an in-tree fixture's adapter sits beside its own manifest and entry;
 *   - a public-bundle game's adapter sits in a folder holding ONLY that file —
 *     its bytes are served verbatim from `public/ingest/<id>/` and hashed by
 *     `vendor/games/verify-unaltered.mjs`, so nothing host-owned may go there.
 *
 * A folder with no `vgai.project.json` is invisible to {@link manifestModules}
 * and therefore to {@link discoverIngestEntries} — the second population adds no
 * fixtures, only declarations.
 *
 * LAZY, not eager, on purpose: `defineAdapter` validates at module-evaluation
 * time and THROWS on a malformed table. Eager evaluation would make one bad
 * adapter a boot failure for the whole editor; loading only the open game's
 * adapter keeps that failure where the loader can name it and keep going
 * (`project-adapter.ts`: "an editor that dies on a project's config file cannot
 * be used to fix that file"). Vite resolves the glob statically in dev and in
 * a production build alike, so no generated dispatch table is needed.
 */
const adapterModules = import.meta.glob('./games/*/vgai.adapter.ts') as Record<
  string,
  () => Promise<unknown>
>;

/** The adapter module's filename — the contract's ONE spelling, host side. */
const ADAPTER_FILENAME = 'vgai.adapter.ts';

/** This directory's repo path, so a published `modulePath` names a real file. */
const REGISTRY_REPO_DIR = 'packages/editor/src/ingest/games';

const ADAPTER_KEY_RE = /^\.\/games\/([^/]+)\/vgai\.adapter\.ts$/;

/**
 * THE LOOKUP KEY IS THE GAME ID; THE STORAGE KEY IS THE FOLDER NAME. What makes
 * that the same question is an INVARIANT, not a coincidence.
 *
 * `project-adapter.ts` resolves an ingest project's adapter by the id the
 * project's own manifest declares (`ingestGameIdOf` -> the single `{ ingest }`
 * root's `id`), and the two functions below map that id straight onto
 * `./games/<id>/`. So a folder whose game declares a DIFFERENT id binds that
 * other game's table — silently, because a lookup by key cannot tell a mistaken
 * key from a correct one.
 *
 * The invariant is therefore `folder id === the id that game's manifest
 * declares`, for BOTH populations this registry serves — in-tree fixtures
 * (`./games/<id>/vgai.project.json`) and public bundles
 * (`public/ingest/<id>/vgai.project.json`, whose registry folder holds only the
 * adapter file). It is guarded ONCE, statically, in
 * `packages/editor/test/ingest-adapter-modules.test.ts`, which reads both id
 * spaces off disk — the only realm that can, since `public/` is outside the
 * module graph and reachable here by `fetch` alone.
 */

/** Repo-relative path of a game's adapter module, or `null` when it has none. */
export function ingestAdapterModulePath(gameId: string): string | null {
  if (!adapterModules[gameFileKey(gameId, ADAPTER_FILENAME)]) return null;
  return `${REGISTRY_REPO_DIR}/${gameId}/${ADAPTER_FILENAME}`;
}

/**
 * Import a game's adapter module. `null` = this game declares none, which is
 * the ordinary "absence IS the declared native default" case the loader already
 * knows how to answer; a module that exists and throws is left to throw, so the
 * loader can name the failure rather than swallow it.
 */
export async function importIngestAdapterModule(gameId: string): Promise<unknown | null> {
  const load = adapterModules[gameFileKey(gameId, ADAPTER_FILENAME)];
  return load ? await load() : null;
}

/** Every game id that ships an adapter module, sorted — what conformance scans. */
export function ingestAdapterGameIds(): string[] {
  return Object.keys(adapterModules)
    .map((key) => {
      const match = ADAPTER_KEY_RE.exec(key);
      if (!match?.[1]) throw new Error(`ingest registry: unexpected adapter glob key "${key}"`);
      return match[1];
    })
    .sort((a, b) => a.localeCompare(b));
}

/** Served URLs for a manifest's `assets` map (game-relative path -> URL). */
export const assetUrls = import.meta.glob('./games/*/assets/**', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const MANIFEST_KEY_RE = /^\.\/games\/([^/]+)\/vgai\.project\.json$/;

/** Folder-relative glob key for a file inside a discovered game's folder. */
export function gameFileKey(folderId: string, relPath: string): string {
  return `./games/${folderId}/${relPath}`;
}

/** The `surface` vocabulary, restated by value (never imported from a schema
 *  module, matching how the manifest schema itself mirrors it). */
export type IngestSurface = 'three' | 'canvas' | 'dom';

/** A manifest root already narrowed to the `ingest` adapter — the registry does
 *  that narrowing ONCE, so no per-surface builder repeats the check. */
export type IngestRoot = Omit<ResolvedAdapterRoot, 'adapter'> & {
  readonly adapter: Extract<ResolvedAdapter, { type: 'ingest' }>;
};

/** One discovered in-tree ingest fixture: its folder, its parsed manifest, and
 *  the single ingest root that manifest declares. */
export interface IngestEntry {
  readonly folderId: string;
  readonly manifest: ResolvedGameManifest;
  readonly root: IngestRoot;
  readonly surface: IngestSurface;
}

function folderIdFromManifestKey(key: string): string {
  const match = MANIFEST_KEY_RE.exec(key);
  if (!match?.[1]) {
    throw new Error(`ingest registry: unexpected manifest glob key "${key}"`);
  }
  return match[1];
}

function buildEntry(folderId: string, raw: unknown): IngestEntry {
  const manifest = loadGameManifest(raw, { configurationKinds: 'defer' });
  const roots = declaredRoots(manifest);
  if (roots.length !== 1) {
    throw new Error(
      `ingest registry: "${folderId}/vgai.project.json" must declare exactly one root ` +
        `(found ${roots.length}).`,
    );
  }
  const root = roots[0]!;
  if (root.adapter.type !== 'ingest') {
    throw new Error(
      `ingest registry: "${folderId}/vgai.project.json"'s root must be an { ingest } root ` +
        `(found adapter identity "${root.adapter.identity}").`,
    );
  }
  // `root.adapter.type === 'ingest'` is proven above; TS cannot narrow the
  // whole root through a nested discriminant, so restate it once, here, rather
  // than in each per-surface builder.
  const ingestRoot = root as IngestRoot;
  return { folderId, manifest, root: ingestRoot, surface: ingestRoot.adapter.surface };
}

let _cache: IngestEntry[] | null = null;

/** Every in-tree ingest fixture, whatever its surface, sorted by folder id. */
export function discoverIngestEntries(): IngestEntry[] {
  if (!_cache) {
    _cache = Object.entries(manifestModules)
      .map(([key, raw]) => buildEntry(folderIdFromManifestKey(key), raw))
      .sort((a, b) => a.folderId.localeCompare(b.folderId));
  }
  return _cache;
}

/** Every in-tree fixture on one surface — what each per-surface builder reads. */
export function ingestEntriesOnSurface(surface: IngestSurface): IngestEntry[] {
  return discoverIngestEntries().filter((e) => e.surface === surface);
}

/**
 * The rendering library behind an ingest root, as METADATA — for a report line
 * or a gallery badge, never as a mount discriminator. Derived from the adapter
 * identity the manifest schema resolves, which is why a surface with no
 * library-specific identity honestly answers `undefined` rather than guessing.
 */
export function libraryOf(entry: IngestEntry): string | undefined {
  switch (entry.root.adapter.identity) {
    case 'ingest-three':
      return 'three.js';
    case 'ingest-pixi':
      return 'PixiJS';
    case 'ingest-react':
      return 'React';
    default:
      return undefined;
  }
}
