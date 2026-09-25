/**
 * The project's OWN FILES — reading and writing them, and serving them to the
 * running game.
 *
 * `/__editor/save-file`, `/__editor/vgai-file`, `/__editor/project-resource`,
 * `/__editor/data-file(s)`, `/__editor/story-files`,
 * `/__editor/scoped-game-css`, `/__editor/source-conflict` and the `/@fs`
 * module server.
 *
 * Every WRITE here goes through `ctx.commitProjectMutation` — the one
 * attributed, conflict-checked transaction — and answers failures through
 * `ctx.projectMutationError`, including the structured revision-conflict
 * shape. There is deliberately no second write path.
 */

import { type Dirent, existsSync, readFileSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { isContainedRelativePath } from '@volter/editor-sdk/session/relative-path-guard';
import { globToRegExp } from '@volter/editor-sdk/session/source-glob';
import type { Request, Response } from 'express';
import { resolveManifestPath } from '@volter/editor-project/manifest/locate';
import { projectRegionEntriesFromSources } from '@volter/editor-sdk/kit/asset-workflow/project-source-index';
import { ADAPTER_MODULE_FILENAME } from '@volter/editor-sdk/kit/ui-source/adapter-region-includes';
import { foldDataFileText } from '../data-file-serialize';
import type { EditorServerRouter } from '../editor-server';
import { buildScopedGameStyles } from '../scoped-game-css';
import {
  isCanonicalPathInside,
  isPathInside,
  isReadableVgaiPath,
  isServableFsExtension,
  isServableFsPath,
  isViteDepCachePath,
  isWritableProjectResourcePath,
  isWritableVgaiEditorPath,
  projectStorySourceDirs,
} from '../server-utils';
import type { RouteContext } from './context';
import { shareControlError } from './route-helpers';

// ---------------------------------------------------------------------------
// Recursive file scanning
// ---------------------------------------------------------------------------

async function findFiles(dir: string, ext: string): Promise<string[]> {
  const results: string[] = [];
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await findFiles(full, ext)));
    } else if (entry.isFile() && entry.name.endsWith(ext)) {
      results.push(full);
    }
  }
  return results;
}

export function registerProjectSourceRoutes(router: EditorServerRouter, ctx: RouteContext): void {
  const {
    commitProjectMutation,
    engineRoot,
    projectMutationError,
    readProjectManifest,
    sourceConflictTickets,
    trustedShareIdentity,
  } = ctx;

  /** One project text file as the author wrote it, or `missing` when absent. */
  async function readProjectText(
    req: Request,
    res: Response,
    label: string,
    missing: (path: string) => void,
    found: (path: string, content: string) => void,
  ): Promise<void> {
    const path =
      typeof req.query['path'] === 'string' ? req.query['path'].split('\\').join('/') : '';
    const absolute = resolve(ctx.projectRoot, path);
    if (!isContainedRelativePath(path) || !isPathInside(ctx.projectRoot, absolute)) {
      res.status(400).json({ error: `${label} path is outside the project.` });
      return;
    }
    try {
      if (trustedShareIdentity(req) && !(await isCanonicalPathInside(ctx.projectRoot, absolute))) {
        res.status(403).json({ error: `Shared ${label.toLowerCase()} path leaves the project root.` });
        return;
      }
      const info = await stat(absolute);
      if (!info.isFile() || info.size > 2 * 1024 * 1024) {
        res.status(413).json({ error: `${label} reads are limited to 2 MiB text files.` });
        return;
      }
      found(path, await readFile(absolute, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        missing(path);
        return;
      }
      shareControlError(res, error);
    }
  }

  router.get('/__editor/source-conflict', (req: Request, res: Response) =>
    readProjectText(
      req,
      res,
      'Conflict',
      (path) => res.json({ path, content: null }),
      (path, content) => res.json({ path, content }),
    ),
  );

  // The reading half of `save-file`: a source document shows the file as
  // written, never the dev server's transformed module.
  router.get('/__editor/source-file', (req: Request, res: Response) =>
    readProjectText(
      req,
      res,
      'Source',
      () => res.status(404).json({ error: 'Not found.' }),
      (_path, content) => res.type('text/plain').send(content),
    ),
  );

  router.post('/__editor/source-conflict/resolve', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const ticket =
      typeof body['conflictId'] === 'string'
        ? sourceConflictTickets.get(body['conflictId'])
        : undefined;
    if (!ticket || ticket.expiresAt < Date.now()) {
      if (typeof body['conflictId'] === 'string') sourceConflictTickets.delete(body['conflictId']);
      res.status(409).json({ error: 'This source-conflict resolution expired. Compare again.' });
      return;
    }
    if (!Array.isArray(body['resources']) || body['resources'].length === 0) {
      res.status(400).json({ error: 'Expected at least one resolved source resource.' });
      return;
    }
    const resources: Array<{ path: string; content: string | null }> = [];
    for (const value of body['resources']) {
      if (!value || typeof value !== 'object') {
        res.status(400).json({ error: 'Invalid resolved source resource.' });
        return;
      }
      const resource = value as Record<string, unknown>;
      if (
        typeof resource['path'] !== 'string' ||
        !ticket.paths.has(resource['path']) ||
        (resource['content'] !== null && typeof resource['content'] !== 'string') ||
        (typeof resource['content'] === 'string' && resource['content'].length > 2 * 1024 * 1024)
      ) {
        res.status(400).json({ error: 'Resolved content must match this conflict ticket.' });
        return;
      }
      resources.push({ path: resource['path'], content: resource['content'] });
    }
    try {
      const revision = await commitProjectMutation(req, resources);
      sourceConflictTickets.delete(body['conflictId'] as string);
      res.json({ ok: true, revision: revision?.revision ?? null });
    } catch (error) {
      projectMutationError(res, error);
    }
  });
  // ---- Save file ----
  router.post('/__editor/save-file', async (req: Request, res: Response) => {
    const body = req.body as {
      path: string;
      content?: string;
      encoding?: 'base64';
      delete?: boolean;
    };
    const filePath = body.path ?? '';

    // Both halves are load-bearing, and the pair used to be
    // `includes('..')` + `startsWith(publicRoot)`, which let an ABSOLUTE
    // `body.path` through: `resolve(root, 'public', '/root/publicX/x.js')`
    // returns its last argument verbatim, so no `..` ever appeared and the
    // separator-less prefix test accepted the sibling directory. The write
    // then landed outside `public/`.
    if (!isContainedRelativePath(filePath)) {
      res.status(400).json({ error: 'Invalid path.' });
      return;
    }

    const absPath = resolve(ctx.projectRoot, 'public', filePath);
    if (!isPathInside(ctx.publicRoot, absPath)) {
      res.status(400).json({ error: 'Path outside public directory.' });
      return;
    }

    try {
      if (body.delete) {
        const revision = await commitProjectMutation(req, [
          { path: `public/${filePath}`, content: null },
        ]);
        res.json({ ok: true, path: filePath, revision: revision?.revision ?? null });
        return;
      }
      if (typeof body.content !== 'string') {
        res.status(400).json({ error: 'Missing content.' });
        return;
      }
      const data = body.encoding === 'base64' ? Buffer.from(body.content, 'base64') : body.content;
      const revision = await commitProjectMutation(req, [
        { path: `public/${filePath}`, content: data },
      ]);
      res.json({ ok: true, path: filePath, revision: revision?.revision ?? null });
    } catch (error) {
      projectMutationError(res, error);
    }
  });
  // ---- Project-root `.vgai/` file access ----
  //
  // The editor-state/thumbnail routes above already read/write
  // `<projectRoot>/.vgai/...` directly via `node:fs` — but `StorageBackend`
  // (`HttpStorage`/`/__editor/save-file` above) is hard-rooted at
  // `<projectRoot>/public/`, so anything a client writes through that seam
  // under a `.vgai/` path actually lands at `<projectRoot>/public/.vgai/...`
  // (the two-`.vgai`-dirs finding recorded in T3.3's close-out).
  // This route pair is the fix: project-root-relative, scoped to `.vgai/` only
  // (defense in depth — it is not a general project-file API), mirroring the
  // editor-state route's mkdir-on-write / read-or-empty shape. Today's readers
  // are the provenance ledger (`src/project-provenance.ts`) and the
  // asset-budget optimize pass (`@vgai/game/src/asset-budget/`).
  router.get('/__editor/vgai-file', async (req: Request, res: Response) => {
    const relPath = (req.query['path'] as string) ?? '';
    if (!isReadableVgaiPath(relPath)) {
      res.status(400).json({ error: 'Invalid path.' });
      return;
    }
    if (ctx.projectRoot === engineRoot) {
      res.status(404).json({ error: 'No project open.' });
      return;
    }
    try {
      const absolute = join(ctx.projectRoot, relPath);
      if (trustedShareIdentity(req) && !(await isCanonicalPathInside(ctx.projectRoot, absolute))) {
        res.status(403).json({ error: 'Shared path leaves the project root.' });
        return;
      }
      const raw = await readFile(absolute);
      res.type(relPath.endsWith('.png') ? 'image/png' : 'text/plain').send(raw);
    } catch {
      res.status(404).json({ error: 'Not found.' });
    }
  });

  router.post('/__editor/vgai-file', async (req: Request, res: Response) => {
    const body = req.body as { path?: string; content?: string; encoding?: string };
    const relPath = body.path ?? '';
    if (!isWritableVgaiEditorPath(relPath)) {
      res.status(400).json({ error: 'Invalid path.' });
      return;
    }
    if (ctx.projectRoot === engineRoot) {
      res.status(400).json({ error: 'No project open.' });
      return;
    }
    try {
      const content =
        body.encoding === 'base64'
          ? Buffer.from(body.content ?? '', 'base64')
          : (body.content ?? '');
      const revision = await commitProjectMutation(req, [{ path: relPath, content }]);
      res.json({ ok: true, revision: revision?.revision ?? null });
    } catch (error) {
      projectMutationError(res, error);
    }
  });

  // ---- Project-owned authoring resources ----
  //
  // Asset Lab documents can serialize several native resources as one logical
  // history step. The browser-side history driver reaches each exact byte
  // snapshot through this project-root route; executable source remains owned
  // by `/__ui-source/*`, and project control files remain unreachable.
  // Source files matching `include` globs — what a finder's `include` reads
  // through (ARCHITECTURE-CORE §The project model). Bounded to `src/`.
  router.get('/__editor/source-files', async (req: Request, res: Response) => {
    if (ctx.projectRoot === engineRoot) {
      res.json({ files: [] });
      return;
    }
    const raw = req.query['include'];
    const globs = (Array.isArray(raw) ? raw : [raw]).filter(
      (g): g is string => typeof g === 'string' && g.length > 0 && !g.includes('..'),
    );
    const matchers = globs.map(globToRegExp);
    // `order=mtime` answers newest first: the adapter table takes this order,
    // and a fresh checkout with several documents and no declared default
    // opens on the one most recently written — the one being worked on.
    const byMtime = req.query['order'] === 'mtime';
    const files: { path: string; mtimeMs: number }[] = [];
    const walk = async (absolute: string, rel: string): Promise<void> => {
      let entries: Dirent[];
      try {
        entries = await readdir(absolute, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const path = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(join(absolute, entry.name), path);
        else if (matchers.some((m) => m.test(path))) {
          let mtimeMs = 0;
          if (byMtime) {
            try {
              mtimeMs = (await stat(join(absolute, entry.name))).mtimeMs;
            } catch {
              /* vanished between readdir and stat: sorts last */
            }
          }
          files.push({ path, mtimeMs });
        }
      }
    };
    await walk(join(ctx.projectRoot, 'src'), 'src');
    files.sort((a, b) =>
      byMtime && a.mtimeMs !== b.mtimeMs ? b.mtimeMs - a.mtimeMs : a.path.localeCompare(b.path),
    );
    res.json({ files: files.map((file) => file.path) });
  });
  router.get('/__editor/project-resource', async (req: Request, res: Response) => {
    const relPath = (req.query['path'] as string) ?? '';
    if (!isWritableProjectResourcePath(relPath)) {
      res.status(400).json({ error: 'Invalid project resource path.' });
      return;
    }
    if (ctx.projectRoot === engineRoot) {
      res.status(404).json({ error: 'No project open.' });
      return;
    }
    try {
      const absolute = join(ctx.projectRoot, relPath);
      if (trustedShareIdentity(req) && !(await isCanonicalPathInside(ctx.projectRoot, absolute))) {
        res.status(403).json({ error: 'Shared path leaves the project root.' });
        return;
      }
      res.type('application/octet-stream').send(await readFile(absolute));
    } catch {
      res.status(404).json({ error: 'Not found.' });
    }
  });

  router.post('/__editor/project-resource', async (req: Request, res: Response) => {
    const body = req.body as { path?: string; content?: string; encoding?: string };
    const relPath = body.path ?? '';
    if (!isWritableProjectResourcePath(relPath)) {
      res.status(400).json({ error: 'Invalid project resource path.' });
      return;
    }
    if (ctx.projectRoot === engineRoot) {
      res.status(400).json({ error: 'No project open.' });
      return;
    }
    if (body.encoding !== 'base64' || typeof body.content !== 'string') {
      res.status(400).json({ error: 'Project resource content must be base64.' });
      return;
    }
    const content = Buffer.from(body.content, 'base64');
    if (content.toString('base64') !== body.content) {
      res.status(400).json({ error: 'Project resource content is not valid base64.' });
      return;
    }
    try {
      const revision = await commitProjectMutation(req, [{ path: relPath, content }]);
      res.json({ ok: true, revision: revision?.revision ?? null });
    } catch (error) {
      projectMutationError(res, error);
    }
  });

  router.delete('/__editor/project-resource', async (req: Request, res: Response) => {
    const relPath = (req.body as { path?: string }).path ?? '';
    if (!isWritableProjectResourcePath(relPath)) {
      res.status(400).json({ error: 'Invalid project resource path.' });
      return;
    }
    if (ctx.projectRoot === engineRoot) {
      res.status(400).json({ error: 'No project open.' });
      return;
    }
    try {
      const revision = await commitProjectMutation(req, [{ path: relPath, content: null }]);
      res.json({ ok: true, revision: revision?.revision ?? null });
    } catch (error) {
      projectMutationError(res, error);
    }
  });
  // ---- Data assets (W2) ----
  //
  // The Data dock tab's server half. Discovery is the folder scan, per D3 (no
  // asset database): every `src/data/*.data.json` of the open project, plus
  // the sibling EMITTED `*.schema.json` when present — the editor consumes the
  // JSON Schema interchange artifact and never executes the project's
  // `.schema.ts` (§2.1). Raw file text is returned (not parsed JSON) so the
  // client owns parse errors and can report a malformed file instead of this
  // route 500ing on it.
  //
  // Why not `/__editor/save-file` + `/@fs/` reads: that seam is HARD-ROOTED at
  // `<projectRoot>/public/` (see `HttpStorage`'s doc comment and the
  // two-`.vgai`-dirs finding above) — data assets live under the project
  // root's `src/data/`, outside its reach. Same fix as the `vgai-file` pair:
  // a purpose-scoped route rooted at the project root, deliberately NOT a
  // general project-file API (defense in depth — the write half accepts only
  // `src/data/**/*.data.json`).
  router.get('/__editor/data-files', async (_req: Request, res: Response) => {
    if (ctx.projectRoot === engineRoot) {
      res.json({ files: [] });
      return;
    }
    const dataDir = join(ctx.projectRoot, 'src', 'data');
    const found = await findFiles(dataDir, '.data.json');
    const files: Array<{ path: string; content: string; schema: string | null }> = [];
    for (const abs of found.sort()) {
      let content: string;
      try {
        content = await readFile(abs, 'utf-8');
      } catch {
        continue; // deleted between scan and read — just omit it
      }
      // Sibling emitted schema (D4: generated + committed by default). Absent
      // (project hasn't run `npm run emit-schemas`) → null; the client shows
      // a teaching message rather than guessing widget types.
      let schema: string | null = null;
      try {
        schema = await readFile(abs.replace(/\.data\.json$/, '.schema.json'), 'utf-8');
      } catch {
        /* no emitted schema */
      }
      files.push({ path: relative(ctx.projectRoot, abs).split('\\').join('/'), content, schema });
    }
    res.json({ files });
  });

  // D1 (spec §2.5): a Data-panel edit writes the `.data.json` IMMEDIATELY. A
  // running game picks the write up
  // through the already-shipped HMR path (`dev.ts`'s `.data.json` exemption →
  // the owning module's `import.meta.hot.accept` → `DataHandle.hotSwap`).
  // Undo for a data write is git, so there is no byte-exact replay path and
  // therefore no bytes-in body variant — see the fold note in the handler.
  router.post('/__editor/data-file', async (req: Request, res: Response) => {
    const body = req.body as { path?: string; content?: unknown; values?: unknown };
    const relPath = body.path ?? '';
    if (
      !isContainedRelativePath(relPath) ||
      !relPath.startsWith('src/data/') ||
      !relPath.endsWith('.data.json')
    ) {
      res.status(400).json({ error: 'Invalid path — expected src/data/**/*.data.json.' });
      return;
    }
    if (ctx.projectRoot === engineRoot) {
      res.status(400).json({ error: 'No project open.' });
      return;
    }
    // ONE accepted body: `values`, a parsed next-state object. THIS route folds
    // it against the file's current key order and serializes it
    // (`data-file-serialize.ts`). The data-asset UI ships as a copied
    // capability, so the fold cannot live there: a project that reorganizes its
    // own table UI must not be able to reorganize the file's bytes with it.
    // Raw bytes are deliberately NOT accepted — a caller that could hand over
    // exact text would be a second serializer, and the fold would no longer be
    // the one place the diff contract lives.
    if (body.content !== undefined) {
      res.status(400).json({
        error:
          'This route writes PARSED VALUES, not bytes — post `values` (a JSON object) and the ' +
          "dev server's fold owns key order and the $schema-first serialization.",
      });
      return;
    }
    if (body.values === undefined) {
      res
        .status(400)
        .json({ error: "Missing values — post the file's parsed next state as `values`." });
      return;
    }
    if (!body.values || typeof body.values !== 'object' || Array.isArray(body.values)) {
      res.status(400).json({ error: 'values must be a JSON object.' });
      return;
    }
    let currentText: string | null = null;
    try {
      currentText = await readFile(join(ctx.projectRoot, relPath), 'utf-8');
    } catch {
      /* new file — the posted values define the order */
    }
    const content = foldDataFileText(currentText, body.values as Record<string, unknown>);
    try {
      const revision = await commitProjectMutation(req, [{ path: relPath, content }]);
      res.json({ ok: true, path: relPath, revision: revision?.revision ?? null });
    } catch (error) {
      projectMutationError(res, error);
    }
  });

  // There is deliberately no GET/DELETE on `/__editor/data-file`: reading a
  // data asset is the folder scan (`GET /__editor/data-files`, which returns
  // every file's text), and nothing in the product deletes one through the
  // server. This route is the WRITE seam only.
  // ---- Story discovery (C3, spec §9 — "Add CSF Discovery and Portable
  // Story Mounting") ----
  //
  // Conventional `*.stories.tsx` / `*.stories.ts` files, colocated anywhere
  // under the project's `src/` (Storybook's own convention — unlike
  // `src/contributions/`/`src/data/`, stories are not confined to one folder). Same
  // D3 physics as every other editor list here: a live folder scan, never a
  // cached manifest — add/remove a `*.stories.tsx` and the next refresh sees
  // it. Paths only: the CSF MODULE itself is loaded client-side through
  // Vite's `/@fs/` dynamic-import path (`story-discovery.ts`, mirroring
  // `tool-loader.ts`), so it arrives transpiled with HMR, and the editor
  // never stores a duplicate story definition — the CSF module stays the one
  // source of truth (spec §9 C3 "Story source remains the CSF module").
  //
  // `previewModulePath` rides along in the same response: the project's
  // OPTIONAL `.storybook/preview.tsx`/`.ts` (checked with `existsSync`, same
  // "server tells the truth about disk, client never guesses" contract as
  // the rest of this route), or `null` when the project has no `.storybook/`
  // folder — most projects don't. `story-discovery.ts`'s
  // `loadProjectPreviewAnnotations` used to blind-probe both candidate paths
  // client-side via `/@fs/` and swallow the import failure; that still
  // logged a real failed network request for every project without a
  // preview config (the common case), which is indistinguishable from a
  // genuine broken-editor error to anything watching the page's network/
  // console (e.g. `check-vgai-generated-project-p2p.ts`'s browser-proof).
  // Reporting existence here lets the client only ever import a path that is
  // actually there.
  router.get('/__editor/story-files', async (_req: Request, res: Response) => {
    if (ctx.projectRoot === engineRoot) {
      res.json({ files: [], previewModulePath: null, regions: [] });
      return;
    }
    // NOT `<projectRoot>/src` — the project's own manifest says where its
    // authored source lives (`projectStorySourceDirs`, server-utils.ts). For
    // every scaffolded project and every `examples/<id>` that IS
    // `<projectRoot>/src`; for a project whose root `entry` resolves outside
    // its folder (a repo-vendored game: manifest + host shim under
    // `packages/editor/src/ingest/games/<id>/`, source under
    // `vendor/games/<id>/src/`) it is that game's source tree as well, so a
    // story colocated with the component it declares is DISCOVERED there.
    const scanDirs = projectStorySourceDirs(ctx.projectRoot, readProjectManifest());
    const scans = await Promise.all(
      scanDirs.flatMap((dir) => [findFiles(dir, '.stories.tsx'), findFiles(dir, '.stories.ts')]),
    );
    const found = scans.flat().filter((abs) => !abs.includes(`${sep}node_modules${sep}`));
    const previewCandidates = ['.storybook/preview.tsx', '.storybook/preview.ts'];
    const previewModulePath =
      previewCandidates.find((candidate) => existsSync(join(ctx.projectRoot, candidate))) ?? null;
    let manifestSource = '';
    let adapterSource = '';
    try {
      manifestSource = readFileSync(resolveManifestPath(ctx.projectRoot), 'utf8');
    } catch {
      /* no manifest — regions stay empty */
    }
    try {
      adapterSource = readFileSync(join(ctx.projectRoot, ADAPTER_MODULE_FILENAME), 'utf8');
    } catch {
      /* no adapter — native default, regions still derive from roots */
    }
    const { regions } = projectRegionEntriesFromSources(manifestSource, adapterSource);
    res.json({
      files: found.sort().map((abs) => ({
        path: relative(ctx.projectRoot, abs).split('\\').join('/'),
      })),
      previewModulePath,
      regions,
    });
  });

  // ---- Scoped game CSS (the game's page-level stylesheet, contained) ----
  // A foreign game keeps its HUD layout in a page stylesheet whose `html`/
  // `body`/`*` rules would restyle the EDITOR, so no surface could load it and
  // every surface showing that game's DOM rendered unstyled. Serve it rewritten
  // into `@scope ([data-vgai-game-styles])` instead: the client attaches it once
  // and marks each container that owns game DOM (a story card's content, the
  // ingest surface). The transform is SERVE-TIME — the bytes under
  // `vendor/games/` are read and never written, which is what keeps
  // `vendor/games/verify-unaltered.mjs` green.
  router.get('/__editor/scoped-game-css', (_req: Request, res: Response) => {
    const result = buildScopedGameStyles({
      manifest: readProjectManifest(),
      readStyleSheet: (relPath) => {
        // Same containment every project read here has: a declared path is
        // resolved against the project root and must stay on disk. A vendored
        // game's sheet legitimately sits OUTSIDE the project folder (the
        // manifest lives under `packages/editor/src/ingest/games/<id>/`, the
        // game's source under `vendor/games/<id>/src/`), which is exactly the
        // shape `projectStorySourceDirs` already serves stories from — so the
        // bound is "readable file", not "inside ctx.projectRoot".
        const absolute = resolve(ctx.projectRoot, relPath);
        try {
          return {
            css: readFileSync(absolute, 'utf8'),
            // Vite serves an out-of-root file at `/@fs/<absolute>`; relative
            // `url()`s in the sheet rebase onto that, so a game asset request
            // goes to the game's own folder instead of an editor route.
            servedPath: `/@fs/${absolute.split(sep).join('/')}`,
          };
        } catch {
          return null;
        }
      },
    });
    res.json(result);
  });
}

/**
 * The module transport's missing-module answer, registered SEPARATELY because
 * its POSITION is load-bearing: it must sit after the packaged host's
 * transpiling `/@fs` route so that route's extension resolution runs first.
 * The server calls this immediately after that block, exactly where the
 * middleware used to be written inline.
 */
export function registerModuleTransportNotFound(
  router: EditorServerRouter,
  ctx: RouteContext,
): void {
  const { engineRoot } = ctx;

  // ---- A DELETED project module must 404, not become the editor's HTML ----
  //
  // Measured live (2026-08-19): delete a file the mounted world imports, and
  // `GET /@fs/<abs>/src/scenes/MainScene.tsx` answered `200 text/html` with the
  // editor's own `index.html` (27 KB) — the SPA fallback, which Vite's
  // `htmlFallbackMiddleware` applies to any unmatched GET whose `Accept`
  // includes `*/*`, and a browser's ES-module fetch sends exactly that. The
  // browser then refuses to execute a module served as HTML and reports
  //
  //   TypeError: Failed to fetch dynamically imported module:
  //     http://…/src/world.tsx?vgai-mount=19
  //
  // which names the ENTRY (a file that exists), never the deleted file, and
  // carries a `?vgai-mount=N` that grows per attempt. `vgai play` then refuses
  // four times in a row with a message that reads like the server serving a
  // stale mount graph — which is where a probe went looking, and there is no
  // such bug: the unlink watcher fires, `project-script-hmr.ts` stamps the
  // graph, and restoring the file recovers without a restart. The whole defect
  // was this response.
  //
  // Line 3121's `hasUiRegistry` comment already recorded the behavior ("a dev
  // server answers 200 (SPA fallback) for missing files") and worked around it
  // at one call site. This closes the class instead: `/@fs/` is a MODULE
  // TRANSPORT, and a module that does not exist has exactly one honest answer.
  //
  // Deliberately narrow — anything not provably a missing module falls through
  // untouched: only GET/HEAD, only paths contained in the project or engine
  // root, only the `/@fs/` extensions this server already agrees to serve
  // (`isServableFsExtension`), never the private estates (`isServableFsPath`),
  // never Vite's own dependency-optimizer cache (`isViteDepCachePath` — those
  // files are written asynchronously and absence there means "not bundled
  // YET", which is Vite's middleware to answer, not ours), and only when the
  // path genuinely is not on disk. Registered after the production transpiling
  // route above so its extension-resolution runs first.
  router.use('/@fs', async (req: Request, res: Response, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    const absPath = resolve(req.path);
    if (!isPathInside(ctx.projectRoot, absPath) && !isPathInside(engineRoot, absPath)) {
      next();
      return;
    }
    const ext = absPath.split('.').pop() ?? '';
    // An extensionless path may still resolve (index files, appended
    // extensions), and a private path must not have its existence confirmed
    // or denied here — both keep their existing behavior. The `stat` is async
    // (like the transpiling route's above) because this sits on the module
    // transport a cold boot drives thousands of requests through.
    if (!isServableFsExtension(ext) || !isServableFsPath(absPath)) {
      next();
      return;
    }
    // The optimizer's own output is never "a module the game imports is
    // missing" — mid-run it is simply not written yet. See `isViteDepCachePath`.
    if (isViteDepCachePath(absPath)) {
      next();
      return;
    }
    const present = await stat(absPath).then(
      () => true,
      () => false,
    );
    if (present) {
      next();
      return;
    }
    res
      .status(404)
      .type('text/plain')
      .send(
        `vgai: ${absPath} does not exist.\n\n` +
          'A module the running game imports is missing from disk — deleted or renamed, ' +
          'and the import that names it was not updated. This is a 404 rather than the ' +
          "editor's index.html so the failure names the missing file instead of surfacing " +
          'as an opaque "Failed to fetch dynamically imported module" against the entry.\n\n' +
          'Restore the file, or fix the import that still names it; the editor picks the ' +
          'change up without a restart.\n',
      );
  });
}
