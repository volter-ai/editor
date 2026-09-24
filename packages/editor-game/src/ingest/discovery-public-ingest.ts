/**
 * Vendored ingest discovery by id.
 *
 * The three sibling of `surface-canvas.ts` (the pixi lane, which is the idiom
 * benchmark this file is modelled on): a game vendored under
 * `public/ingest/<id>/` carries its own declarative `vgai.project.json`, and
 * its id resolves it into the SAME `IngestGame` descriptor every other three
 * ingest route produces. Adding a fourth vendored game is a folder plus a
 * manifest — no edit to this file, no per-game page, no branch anywhere.
 *
 * ## Why `fetch`, where the in-tree lane uses `import.meta.glob`
 *
 * `registry.ts` globs IN-TREE fixture manifests under
 * `packages/editor/src/ingest/games/`, which Vite knows statically (
 * ONE manifest-driven registry, with only the per-surface MOUNT still split —
 * `surface-three.ts`/`surface-canvas.ts`/`surface-dom.ts`).
 * These manifests live in `public/`, which is deliberately OUTSIDE the module
 * graph in both builds: Vite serves it verbatim in dev and copies it into
 * `dist/` at build, and importing from it is explicitly unsupported (that
 * verbatim serving is exactly why the vendored bundles can keep their absolute
 * `import '/ingest/<id>/three-rNNN.module.js'` specifiers un-rewritten). A
 * root-relative `fetch` is therefore the id-generic route that works
 * identically on the dev server and on the deployed hosted editor — no
 * dev-server middleware, nothing to build.
 *
 * There is deliberately no enumeration here: the caller supplies the id,
 * and a 404 means "not a vendored three ingest", cleanly. A gallery that needs
 * the LIST wants a build-time aggregate (the
 * `project-scripts-by-example.generated.ts` pattern), not a runtime directory scan.
 */

import {
  isSafeIngestId,
  PUBLIC_INGEST_BASE,
  publicIngestManifestUrl,
} from '../host/staged-projects';
import { extractUpstreamPin } from '@volter/game-runtime/adapter/ingest/upstream-pin';
import type { IngestGame2D } from '@volter/game-runtime/pixi/ingest';
import { declaredRoots } from '@volter/editor-project/adapter/manifest-interpreter';
import { loadGameManifest } from '@volter/editor-project/manifest/load';
import { composeIngestLoad, ingestDataWriter } from './entry-load';
import { servedEntryLoader, servedModuleLoader } from './served-bundle';
import type { IngestGame } from './types';

/** What a vendored three ingest manifest resolves to. */
export interface PublicIngestResolution {
  game: IngestGame;
}

/** What a vendored canvas ingest manifest resolves to. */
export interface PublicCanvasIngestResolution {
  game: IngestGame2D;
}

/** Import a module served out of a vendored game's folder, in the host realm.
 *  The loader itself is `served-bundle.ts`'s — shared with the LOCAL session
 *  route so both doors onto one folder run it identically. */
function publicIngestModuleLoader(folderId: string, relPath: string): () => Promise<unknown> {
  return servedModuleLoader(`${PUBLIC_INGEST_BASE}${folderId}/`, relPath);
}

/** The game's own entry module, preceded by its `contractShim` when it declares one. */
function publicIngestLoad(
  folderId: string,
  entry: string,
  contractShim: string | undefined,
): () => Promise<unknown> {
  return composeIngestLoad(
    servedEntryLoader(`${PUBLIC_INGEST_BASE}${folderId}/`, entry),
    contractShim === undefined ? undefined : publicIngestModuleLoader(folderId, contractShim),
  );
}

/** The single ingest root a vendored game's manifest must declare. */
function readVendoredIngestRoot(
  folderId: string,
  raw: unknown,
  expect: { surface: 'three' | 'canvas'; identity: 'ingest-three' | 'ingest-pixi' },
) {
  const manifest = loadGameManifest(raw, { configurationKinds: 'defer' });
  const roots = declaredRoots(manifest);
  if (roots.length !== 1) {
    throw new Error(
      `vendored ingest discovery: "${folderId}/vgai.project.json" must declare exactly one root ` +
        `(found ${roots.length}).`,
    );
  }
  const root = roots[0]!;
  if (
    root.surface !== expect.surface ||
    root.adapter.type !== 'ingest' ||
    root.adapter.identity !== expect.identity
  ) {
    throw new Error(
      `vendored ingest discovery: "${folderId}/vgai.project.json" must declare one ` +
        `${expect.surface} { ingest } root (found surface "${root.surface}", adapter identity ` +
        `"${root.adapter.identity}").`,
    );
  }
  if (!root.entry) {
    throw new Error(
      `vendored ingest discovery: "${folderId}" has no \`entry\` — an ingest root mounts the ` +
        "game's own entry module.",
    );
  }
  return { manifest, root, adapter: root.adapter, entry: root.entry };
}

/**
 * Build the descriptor from a folder id and its parsed manifest JSON. Pure —
 * the unit-testable half, with every rejection a NAMED error rather than a
 * silent skip (the anti-shim rule: an unmountable manifest must say why).
 */
export function buildPublicIngestGame(folderId: string, raw: unknown): PublicIngestResolution {
  const { manifest, root, adapter, entry } = readVendoredIngestRoot(folderId, raw, {
    surface: 'three',
    identity: 'ingest-three',
  });
  const game: IngestGame = {
    id: root.id,
    name: manifest.name,
    description: root.description ?? '',
    gameVersion: manifest.version,
    load: publicIngestLoad(folderId, entry, adapter.contractShim),
    ...ingestDataWriter(adapter.dataWriter, (rel) => publicIngestModuleLoader(folderId, rel)),
    ...(adapter.assets !== undefined ? { assets: adapter.assets } : {}),
    ...(adapter.captureTimeoutMs !== undefined
      ? { captureTimeoutMs: adapter.captureTimeoutMs }
      : {}),
    ...(adapter.domStubs !== undefined ? { domStubs: adapter.domStubs } : {}),
  };
  return { game };
}

/**
 * Canvas-surface sibling of {@link buildPublicIngestGame}. `ingest-pixi` is
 * the existing schema identity for canvas ingest roots; nothing here infers
 * Pixi from it. The mount recognizes the actual library in the live realm
 * (`mount-canvas-ingest-root.ts` -> `authoring/canvas-runtime-recognition.ts`)
 * and fails loudly when no structural adapter exists.
 */
export function buildPublicCanvasIngestGame(
  folderId: string,
  raw: unknown,
): PublicCanvasIngestResolution {
  const { manifest, root, adapter, entry } = readVendoredIngestRoot(folderId, raw, {
    surface: 'canvas',
    identity: 'ingest-pixi',
  });
  return {
    game: {
      id: root.id,
      name: manifest.name,
      description: root.description ?? '',
      load: publicIngestLoad(folderId, entry, adapter.contractShim),
      ...(adapter.captureTimeoutMs !== undefined
        ? { captureTimeoutMs: adapter.captureTimeoutMs }
        : {}),
    },
  };
}

/**
 * Resolve a vendored game id against `public/ingest/<id>/vgai.project.json`.
 *
 * `null` means "no such vendored three ingest" (no manifest served at that
 * path) — the caller falls through to its own unknown-id report. A manifest
 * that EXISTS but is unmountable THROWS, naming the reason: silently treating a
 * malformed vendored manifest as absent is exactly the failure the anti-shim
 * rule forbids.
 */
export async function fetchPublicIngestGame(
  id: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<PublicIngestResolution | null> {
  if (!isSafeIngestId(id)) return null;
  const url = publicIngestManifestUrl(id);
  let res: Response;
  try {
    res = await fetchImpl(url);
  } catch {
    return null;
  }
  if (!res.ok) return null;
  // The dev server answers an unknown path with the editor's index.html rather
  // than a 404, so an OK response is not by itself proof of a manifest — parse
  // failure on this route means "not a vendored ingest", not a broken game.
  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return null;
  }
  return buildPublicIngestGame(id, raw);
}

/** Resolve a vendored canvas game, preserving the same 404 rules. */
export async function fetchPublicCanvasIngestGame(
  id: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<PublicCanvasIngestResolution | null> {
  if (!isSafeIngestId(id)) return null;
  let response: Response;
  try {
    response = await fetchImpl(publicIngestManifestUrl(id));
  } catch {
    return null;
  }
  if (!response.ok) return null;
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    return null;
  }
  return buildPublicCanvasIngestGame(id, raw);
}

/**
 * Read THIS vendored game's own `UPSTREAM.md` pin (R5's overlay-identity check
 * — an overlay is bound to the upstream commit the game was vendored at, not
 * only to a static manifest `version`).
 *
 * Deliberately NOT `ingest/mount-ingest-root.ts`'s `readVendoredUpstreamPin`, which fetches
 * the OPEN PROJECT's root `/UPSTREAM.md`: on this route the open project is
 * whatever the editor happens to have open, and its pin has nothing to do with
 * the vendored game being mounted. Every failure resolves to `null` — a missing
 * or unparseable record is reported as "no pin", never fabricated.
 */
export async function fetchPublicIngestUpstreamPin(
  id: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<string | null> {
  if (!isSafeIngestId(id)) return null;
  try {
    const res = await fetchImpl(`${PUBLIC_INGEST_BASE}${id}/UPSTREAM.md`);
    if (!res.ok) return null;
    return extractUpstreamPin(await res.text());
  } catch {
    return null;
  }
}
