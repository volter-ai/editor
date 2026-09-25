/**
 * `/__editor/project-tools/**` and `/__editor/generations/**` — the doors that RUN something on the
 * editor's machine rather than read or write a file.
 *
 * Callable project tools are loaded on the NODE side: merely listing a native
 * asset/map build script must never import it into the editor browser or make
 * it reachable from a standalone game bundle. Vite's `ssrLoadModule` is
 * injected by the owning server, which gives normal TS transform and project
 * dependency resolution without a second script runtime.
 */

import type { Request, Response } from 'express';
import type { EditorServerRouter } from '../editor-server';
import { broadcast } from '../editor-sse';
import { forgetGenerationJob, markGenerationJobRead, readGenerationJobs } from '../generation-jobs';
import { reconcileGenerationJobs } from '../generation-reconciler';
import { discoverProjectTools, executeProjectTool } from '../project-tools';
import type { RouteContext } from './context';
import { TOOL_CONTRIBUTION_SUFFIXES } from '@volter/editor-sdk/session/tool-contribution-convention';

export function registerToolRoutes(router: EditorServerRouter, ctx: RouteContext): void {
  const { account, engineRoot, loadProjectModule } = ctx;

  // ---- Registered project tools ----
  //
  // Callable modules are loaded on the NODE side. Merely listing a native
  // asset/map build script must never import it
  // into the editor browser or make it reachable from a standalone game
  // bundle. Vite's ssrLoadModule is injected by the owning server and gives
  // us normal TS transform + project dependency resolution without a second
  // script runtime.
  router.get('/__editor/project-tools', async (_req: Request, res: Response) => {
    if (ctx.projectRoot === engineRoot) {
      res.json({ tools: [], loadErrors: [] });
      return;
    }
    res.json({
      ...(await discoverProjectTools(ctx.projectRoot, loadProjectModule)),
      suffixes: TOOL_CONTRIBUTION_SUFFIXES,
    });
  });

  router.post('/__editor/project-tools/run', async (req: Request, res: Response) => {
    if (ctx.projectRoot === engineRoot) {
      res.status(400).json({
        ok: false,
        error: { code: 'NO_PROJECT_OPEN', message: 'Open a project before running a tool.' },
      });
      return;
    }
    const body = req.body as {
      name?: unknown;
      input?: unknown;
      confirm?: unknown;
      instance?: unknown;
    };
    if (typeof body.name !== 'string' || body.name.trim() === '') {
      res.status(400).json({
        ok: false,
        error: { code: 'INVALID_TOOL_NAME', message: 'Expected a non-empty tool name.' },
      });
      return;
    }
    const controller = new AbortController();
    req.once('aborted', () => controller.abort());
    // The credential read belongs to the tool's own provider and happens
    // inside `executeProjectTool`, which is where that provider is known.
    const result = await executeProjectTool({
      account: ctx.account,
      projectRoot: ctx.projectRoot,
      loadModule: loadProjectModule,
      name: body.name,
      input: Object.hasOwn(body, 'input') ? body.input : {},
      confirmed: body.confirm === true,
      ...(typeof body.instance === 'string' ? { instance: body.instance } : {}),
      signal: controller.signal,
    });
    // A project command may create an ordinary file anywhere below public/.
    // The public watcher validates files and detects moves, but it deliberately
    // does not broadcast every add/change. Tell every editor client to rescan
    // its Assets view after a successful declared mutation; no generator- or
    // asset-specific operation contract is needed.
    if (result.changedProject) broadcast('assets-changed', {});
    res.status(result.status).json(result.body);
  });

  // ---- First-party generation job activity ----
  // Provider inputs/results stay on their native registered operations. This
  // API exposes only the lifecycle shared by genuine provider implementers.
  router.get('/__editor/generations', async (_req: Request, res: Response) => {
    if (ctx.projectRoot === engineRoot) {
      res.json({ version: 1, jobs: [] });
      return;
    }
    try {
      res.json(await readGenerationJobs(ctx.projectRoot));
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.post('/__editor/generations/reconcile', async (_req: Request, res: Response) => {
    if (ctx.projectRoot === engineRoot) {
      res.json({ attempted: 0, succeeded: 0, failed: [] });
      return;
    }
    try {
      // Same as the session's own timer: a pass with no pending job reads no
      // credential, and a job's own provider is read when its poll tool runs.
      res.json(await reconcileGenerationJobs(ctx.projectRoot, loadProjectModule, 3, account));
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.delete('/__editor/generations/:id', async (req: Request, res: Response) => {
    if (ctx.projectRoot === engineRoot) {
      res.status(400).json({ error: 'No project open.' });
      return;
    }
    try {
      const parameter = req.params['id'];
      const id = Array.isArray(parameter) ? (parameter[0] ?? '') : (parameter ?? '');
      res.json({ removed: await forgetGenerationJob(ctx.projectRoot, id) });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.post('/__editor/generations/:id/read', async (req: Request, res: Response) => {
    if (ctx.projectRoot === engineRoot) {
      res.status(400).json({ error: 'No project open.' });
      return;
    }
    try {
      const parameter = req.params['id'];
      const id = Array.isArray(parameter) ? (parameter[0] ?? '') : (parameter ?? '');
      res.json({ read: await markGenerationJobRead(ctx.projectRoot, id) });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
