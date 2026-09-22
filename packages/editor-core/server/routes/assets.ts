/**
 * Listing and serving BINARY project content, plus the engine-repo thumbnails
 * the New Project screen shows: `/__editor/project-components`,
 * `/__editor/assets`, `/__editor/download`, `/__editor/learn-thumbnail`.
 *
 * Online asset BROWSING is a separate router
 * (`asset-library-routes.ts`, mounted at `/__editor/asset-library`); this
 * family is the local half — what is already in the project, and what the
 * engine checkout itself ships.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { WEB_BUILD_ARTIFACT } from '@volter/editor-sdk/session/build-report';
import { isContainedRelativePath } from '@volter/editor-sdk/session/relative-path-guard';
import type { Request, Response } from 'express';
import type { EditorServerRouter } from '../editor-server';
import { projectBuildArtifactPath } from '../project-build-artifact';
import {
  assetListingErrorResponse,
  isCanonicalPathInside,
  isPathInside,
  resolveListedAssetRoot,
  sanitizeContentDispositionFilename,
} from '../server-utils';
import type { RouteContext } from './context';

interface AssetEntry {
  name: string;
  type: 'file' | 'directory';
  size: number;
  mtime: number;
}


export function registerAssetRoutes(router: EditorServerRouter, ctx: RouteContext): void {
  const { currentProjectComponents, engineRoot, trustedShareIdentity } = ctx;

  // ---- Asset listing ----
  router.get('/__editor/project-components', async (_req: Request, res: Response) => {
    if (ctx.projectRoot === engineRoot) {
      res.json({ components: [] });
      return;
    }
    res.json({ components: await currentProjectComponents() });
  });

  router.get('/__editor/assets', async (req: Request, res: Response) => {
    const dir = (req.query['dir'] as string) ?? '';
    // `root` names WHICH of the project's asset roots to list — `public` (the
    // default, and what every existing caller means) or `references`. It is an
    // enum, never a path: the directory is resolved from the open project by
    // `resolveListedAssetRoot`, so nothing a client sends can widen the scope.
    const rootName = (req.query['root'] as string) ?? 'public';
    if (rootName !== 'public' && rootName !== 'references') {
      res.status(400).json({ error: 'Unknown asset root.' });
      return;
    }

    // `dir === ''` IS the root listing and stays legal; everything else must be
    // a contained project-relative path. (The old pair was `includes('..')`,
    // which rejected a legitimate `..bak` folder, plus `rel.startsWith('..')`,
    // which did the same one layer down.)
    if (dir !== '' && !isContainedRelativePath(dir)) {
      res.status(400).json({ error: 'Path traversal not allowed.' });
      return;
    }

    const absRoot = resolveListedAssetRoot(ctx.projectRoot, engineRoot, rootName);
    const absDir = join(absRoot, dir);

    if (!isPathInside(absRoot, absDir)) {
      res.status(400).json({ error: 'Path outside root.' });
      return;
    }

    try {
      if (trustedShareIdentity(req) && !(await isCanonicalPathInside(absRoot, absDir))) {
        res.status(403).json({ error: 'Shared asset path leaves the public project root.' });
        return;
      }
      const dirents = await readdir(absDir, { withFileTypes: true });
      const entries: AssetEntry[] = [];

      for (const d of dirents) {
        if (d.name.startsWith('.')) continue;
        const entryPath = join(absDir, d.name);
        const s = await stat(entryPath);
        if (d.isDirectory()) {
          entries.push({ name: d.name, type: 'directory', size: 0, mtime: s.mtimeMs });
        } else if (d.isFile()) {
          entries.push({ name: d.name, type: 'file', size: s.size, mtime: s.mtimeMs });
        }
      }

      entries.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      res.json({ entries });
    } catch (err: unknown) {
      // S-8: a project with NO `public/` at all lists empty, it does not fail
      // (see `assetListingErrorResponse` for why that is the true answer, and
      // why a named subdirectory still 404s).
      const outcome = assetListingErrorResponse(dir, (err as NodeJS.ErrnoException).code);
      if (outcome.kind === 'empty') res.json({ entries: [] });
      else res.status(outcome.status).json({ error: outcome.message });
    }
  });

  // ---- Download build artifact ----
  router.get('/__editor/download', async (req: Request, res: Response) => {
    const file = (req.query['file'] as string) ?? '';

    if (!isContainedRelativePath(file) || file.includes('/')) {
      res.status(400).json({ error: 'Invalid file.' });
      return;
    }

    if (file !== WEB_BUILD_ARTIFACT) {
      res.status(404).json({ error: 'Unknown build artifact.' });
      return;
    }
    const absPath = projectBuildArtifactPath(ctx.projectRoot);

    try {
      const data = await readFile(absPath);
      const s = await stat(absPath);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        // S7: strip control/quote chars from the user-supplied filename.
        'Content-Disposition': `attachment; filename="${sanitizeContentDispositionFilename(file)}"`,
        'Content-Length': s.size,
      });
      res.end(data);
    } catch {
      res.status(404).json({ error: 'File not found.' });
    }
  });
  // ---- Registry/learn thumbnails (G4) ----
  // Template-registry entries and example `learn` blocks reference their
  // thumbnails as ENGINE-REPO-RELATIVE paths (data, not URLs — FT-11 keeps
  // them regenerable in place). This read-only route serves those images so
  // the wizard gallery can consume the paths generically with zero hardcoded
  // directories. It is NOT a static file server: only paths the registry or
  // an example manifest actually declares are servable (the §5 intent), and
  // symlinks may not carry a read outside the engine root.
  //
  // Allowlist cache: declared PATHS only change with a registry/manifest
  // edit, which in every supported flow comes with a server restart (G3's
  // thumbnail regeneration rewrites the FILES, not the paths). Lazy so a
  // deployment without examples/registry costs nothing until first use.
}
