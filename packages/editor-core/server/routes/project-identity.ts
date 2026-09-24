/**
 * WHAT PROJECT IS THIS, and what does the editor know about it:
 * `/__editor/compatibility`, `/__editor/project`, `/__editor/project-verbs`,
 * `/__editor/project-attribution`, and the three `/__editor/manifest` verbs.
 *
 * `/__editor/project` is BOOT ROUTING — every caller of it is on the critical
 * path — which is why `/__editor/project-verbs` is a separate route despite
 * reading the same two files: it is a periodic vitals read, and its failures
 * must never be able to make a session look projectless.
 *
 * The manifest write is the one route in the whole server that HARD-CODES its
 * destination rather than deriving it from the request. `validateManifestWrite`
 * rejects a different filename, a traversal path, or a non-JSON body before
 * the handler touches the filesystem.
 */

import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Request, Response } from 'express';
import { MANIFEST_FILENAME } from '@volter/editor-project/manifest/filename';
import { resolveManifestPath } from '@volter/editor-project/manifest/locate';
import {
  deriveProjectAttributionReport,
  emptyProjectProvenanceDocument,
  formatProjectAttributionMarkdown,
  PROJECT_PROVENANCE_PATH,
  ProjectProvenanceDocumentSchema,
} from '../support/project/provenance';
import type { EditorServerRouter } from '../editor-server';
import type { EngineProvenance } from '../engine-provenance';
import { projectEnginePackageOrigin } from '../project-package-origin';
import { readProjectVerbFacts } from '../project-verbs';
import { readProjectViewResult } from '../project-view';
import {
  isCanonicalPathInside,
  isMonorepoScaffoldRoot,
  isPathInside,
  validateManifestWrite,
} from '../server-utils';
import { isEphemeralSession, processSessionId } from '../session-registry';
import type { RouteContext } from './context';

/**
 * Registered SEPARATELY, and before the project-file-serving middleware,
 * because that is where it sat: this is a read of the project's own
 * provenance document, not a file the middleware should get a chance at.
 */
export function registerProjectAttributionRoute(
  router: EditorServerRouter,
  ctx: RouteContext,
): void {
  const { engineRoot } = ctx;

  // Derived credits view. The sole durable source is central project provenance.
  router.get('/__editor/project-attribution', async (req: Request, res: Response) => {
    if (ctx.projectRoot === engineRoot) {
      res.status(400).json({ error: 'No project is open.' });
      return;
    }
    try {
      const raw = await readFile(join(ctx.projectRoot, PROJECT_PROVENANCE_PATH), 'utf8').catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        },
      );
      const provenance = raw
        ? ProjectProvenanceDocumentSchema.parse(JSON.parse(raw))
        : emptyProjectProvenanceDocument();
      const activeOperations = Object.fromEntries(
        (
          await Promise.all(
            Object.entries(provenance.operations).map(async ([operationId, operation]) => {
              const present = await Promise.all(
                operation.outputs.map(async (output) => {
                  const absolute = resolve(ctx.projectRoot, output.path);
                  if (!isPathInside(ctx.projectRoot, absolute)) return false;
                  return stat(absolute).then(
                    (info) => info.isFile(),
                    () => false,
                  );
                }),
              );
              return present.some(Boolean) ? ([operationId, operation] as const) : null;
            }),
          )
        ).filter((entry): entry is readonly [string, (typeof provenance.operations)[string]] =>
          Boolean(entry),
        ),
      );
      const report = deriveProjectAttributionReport({ version: 1, operations: activeOperations });
      const format = typeof req.query['format'] === 'string' ? req.query['format'] : 'json';
      if (format === 'markdown' || req.accepts(['json', 'text/markdown']) === 'text/markdown') {
        res.type('text/markdown').send(formatProjectAttributionMarkdown(report));
        return;
      }
      res.json(report);
    } catch (error) {
      res.status(500).json({ error: `Project attribution failed: ${error}` });
    }
  });
}

export function registerProjectIdentityRoutes(router: EditorServerRouter, ctx: RouteContext): void {
  const {
    commitProjectMutation,
    compatibilityIdentity,
    currentSessionIdentity,
    engineRoot,
    enginePromise,
    options,
    projectMutationError,
    trustedShareIdentity,
  } = ctx;

  // ---- Browser/server compatibility identity ----
  router.get('/__editor/compatibility', (_req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    res.json(compatibilityIdentity());
  });

  // ---- Current project info ----
  /**
   * Who is answering — the server's own pid, and whether it is a throwaway
   * probe (`VGAI_EPHEMERAL_SESSION`, today `vgai doctor`) rather than a
   * session anyone owns.
   *
   * FX-1: `vgai edit` decided "this project's editor is already open" from the
   * `project.path` above alone, and a probe server answers with exactly that
   * path for the few seconds it lives — so an attach could succeed, exit 0,
   * and leave every control command with nothing to talk to. The CLI now ASKS
   * the session what it is instead of inferring it from the port; the
   * registry's pid is the same `process.pid` reported here
   * (`session-registry.ts`), which is what makes the two views comparable.
   */
  const serverSessionIdentity = (shared = false) => {
    const identity = currentSessionIdentity();
    const value = {
      pid: process.pid,
      ephemeral: isEphemeralSession(),
      sessionId: processSessionId(),
      repositoryId: identity?.repositoryId ?? null,
      worktreeId: identity?.worktreeId ?? null,
      worktreeRoot: identity?.worktreeRoot ?? null,
      projectRelativePath: identity?.projectRelativePath ?? null,
      branch: identity?.branch ?? null,
      headCommit: identity?.headCommit ?? null,
      baseCommit: identity?.baseCommit ?? null,
    };
    if (!shared) return value;
    return {
      ephemeral: value.ephemeral,
      sessionId: value.sessionId,
      repositoryId: value.repositoryId,
      worktreeId: value.worktreeId,
      projectRelativePath: value.projectRelativePath,
      branch: value.branch,
    };
  };

  router.get('/__editor/project', async (req: Request, res: Response) => {
    const session = serverSessionIdentity(trustedShareIdentity(req) !== null);
    // On EVERY branch, including "no project open": the question "what code is
    // this port serving?" is the one a caller asks precisely when nothing else
    // about the session makes sense (engine-provenance.ts).
    const engine: EngineProvenance = await enginePromise;
    // A SERVER fact, not a project one, so it rides at the top level and is
    // answered on every branch: whether this host serves the `/__ui-source/*`
    // recorder decides whether an authoring edit is written to the game's own
    // source or is honestly live-only, and the client asks that question
    // (`src/ui-source/tier-source-write-backend.ts`) about the PORT, not about
    // whatever project happens to be open on it.
    const sourceWrite = options.sourceWriteRoutes === true;
    // The ingest lane's own route, stated beside it and on every branch for the
    // same reason: `/__ingest-source/*` comes from a DIFFERENT plugin, so a host
    // can serve one and not the other, and the client must not infer either
    // from the other.
    const ingestSourceWrite = options.ingestSourceWriteRoutes === true;
    // Which product this port serves — its command and display name are what
    // the page's messages name (`src/product-command.ts`). On every branch.
    const product = options.product?.() ?? null;
    if (ctx.projectRoot === engineRoot) {
      // No project open
      res.json({ project: null, session, engine, sourceWrite, ingestSourceWrite, product });
      return;
    }
    const configResult = await readProjectViewResult(ctx.projectRoot);
    if (!configResult.ok) {
      // Boot routing: this server IS serving a project — it just cannot
      // describe it. Answering a bare `{ project: null }` here is
      // indistinguishable from "no project open", which is how a page for a
      // live, project-serving session ended up rendering the launcher.
      // `serving` names the path and the reason so the client fails loudly
      // instead (boot-routing.ts, `decideServerProjectBoot`).
      res.json({
        project: null,
        serving: { path: ctx.projectRoot, error: configResult.error },
        session,
        engine,
        sourceWrite,
        ingestSourceWrite,
        product,
      });
      return;
    }
    const config = configResult.view;
    // hasUiRegistry: whether the project ships an OPTIONAL src/ui/registry.ts
    // (scene-UI project mode, D9). The client must not
    // probe /@fs for it — a dev server answers 200 (SPA fallback) for missing
    // files, and a dynamic import of a missing module logs an unsuppressible
    // browser network error on every registry-less project.
    const hasUiRegistry = await stat(join(ctx.projectRoot, 'src', 'ui', 'registry.ts')).then(
      (s) => s.isFile(),
      () => false,
    );
    // `packaged`: true iff this server is the no-monorepo-checkout runtime
    // (`packages/editor/server/packaged.ts`) — same `isMonorepoScaffoldRoot`
    // check the "New Project" packaged-mode guard already uses server-side
    // (server-utils.ts). Client-side, `binding-resolver.ts`'s react-world
    // mount reads this to decide whether it must resolve its
    // `react`/`react-dom/client`/`WorldProvider` wrapper from the PROJECT's
    // own module graph (packaged: the editor's prebuilt SPA bundles its OWN
    // separate react copy, so a react world would dual-instance otherwise)
    // or keep the existing static-import path (dev: one shared Vite
    // instance + root `vite.config.ts`'s `resolve.dedupe` — including
    // `@vgai/game-runtime` itself, so `WorldProvider`/`useGame` are one context
    // object — already collapses them, so this flag is `false` there and
    // that path stays unchanged).
    const packaged = !isMonorepoScaffoldRoot(engineRoot);
    const enginePackage = projectEnginePackageOrigin(ctx.projectRoot);
    res.json({
      project: { path: ctx.projectRoot, config, hasUiRegistry, packaged, enginePackage },
      session,
      engine,
      sourceWrite,
      ingestSourceWrite,
      product,
    });
  });

  // The two project files behind the `project.*` coverage family, as raw facts
  // (`server/project-verbs.ts`). A separate route from `/__editor/project`
  // deliberately: that one is BOOT routing and every caller of it is on the
  // critical path, while this is a periodic vitals read whose failures must
  // never be able to make a session look projectless.
  router.get('/__editor/project-verbs', async (_req: Request, res: Response) => {
    res.json(await readProjectVerbFacts(ctx.projectRoot === engineRoot ? null : ctx.projectRoot));
  });
  // ---- Manifest write (A4, D8 — the ONE manifest-write verb) ----
  // Unlike every other write route above, this one HARD-CODES its
  // destination: `join(ctx.projectRoot, 'vgai.project.json')`, NEVER derived from
  // `req.body`. `validateManifestWrite` (server-utils.ts, unit-tested there)
  // rejects anything else (a different filename, a traversal path, a
  // non-string/non-JSON body) before this handler ever touches the
  // filesystem — see `server-security.test.ts` for the rejection matrix.
  router.post('/__editor/manifest', async (req: Request, res: Response) => {
    const body = req.body as { path?: unknown; content?: unknown };
    const result = validateManifestWrite(ctx.projectRoot, engineRoot, body);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    try {
      const revision = await commitProjectMutation(req, [
        { path: MANIFEST_FILENAME, content: result.content },
      ]);
      res.json({ ok: true, revision: revision?.revision ?? null });
    } catch (error) {
      projectMutationError(res, error);
    }
  });

  router.get('/__editor/manifest', async (req: Request, res: Response) => {
    if (ctx.projectRoot === engineRoot) {
      res.status(404).json({ error: 'No project open.' });
      return;
    }
    try {
      const manifestPath = resolveManifestPath(ctx.projectRoot);
      if (
        trustedShareIdentity(req) &&
        !(await isCanonicalPathInside(ctx.projectRoot, manifestPath))
      ) {
        res.status(403).json({ error: 'Shared manifest path leaves the project root.' });
        return;
      }
      res.type('application/json').send(await readFile(manifestPath));
    } catch {
      res.status(404).json({ error: 'Not found.' });
    }
  });

  router.delete('/__editor/manifest', async (req: Request, res: Response) => {
    if (ctx.projectRoot === engineRoot) {
      res.status(400).json({ error: 'No project open.' });
      return;
    }
    try {
      const revision = await commitProjectMutation(req, [
        { path: MANIFEST_FILENAME, content: null },
      ]);
      res.json({ ok: true, revision: revision?.revision ?? null });
    } catch (error) {
      projectMutationError(res, error);
    }
  });
}
