/**
 * `/__editor/project-tools/**`, `/__editor/comfyui/**` and
 * `/__editor/generations/**` — the doors that RUN something on the
 * editor's machine rather than read or write a file.
 *
 * Callable project tools are loaded on the NODE side: merely listing a native
 * asset/map build script must never import it into the editor browser or make
 * it reachable from a standalone game bundle. Vite's `ssrLoadModule` is
 * injected by the owning server, which gives normal TS transform and project
 * dependency resolution without a second script runtime.
 */

import type { Request, Response } from 'express';
import {
  allowedComfyUIProviderOperation,
  configureComfyUIBridge,
  installComfyUIBridge,
  validComfyUIBridgeAuthorization,
} from '../comfyui-bridge';
import type { EditorServerRouter } from '../editor-server';
import { broadcast } from '../editor-sse';
import { forgetGenerationJob, markGenerationJobRead, readGenerationJobs } from '../generation-jobs';
import { reconcileGenerationJobs } from '../generation-reconciler';
import { discoverProjectTools, executeProjectTool } from '../project-tools';
import type { RouteContext } from './context';

export function registerToolRoutes(router: EditorServerRouter, ctx: RouteContext): void {
  const { account, engineRoot, loadProjectModule, localOwnerRequest, requireLocalOwner } = ctx;

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
    res.json(await discoverProjectTools(ctx.projectRoot, loadProjectModule));
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

  // ---- Native ComfyUI adapter ----
  // The editor configures the installed local ComfyUI Python extension
  // server-to-server with one editor-session token. The browser never receives
  // it, and the Python process never receives reusable account/provider secrets.
  router.post('/__editor/comfyui/bridge/connect', async (req: Request, res: Response) => {
    if (!requireLocalOwner(req, res)) return;
    const baseUrl = (req.body as { baseUrl?: unknown }).baseUrl;
    const localPort = req.socket.localPort;
    if (typeof baseUrl !== 'string' || !baseUrl.trim() || !localPort) {
      res.status(400).json({ error: 'A ComfyUI URL and live editor port are required.' });
      return;
    }
    try {
      res.json(await configureComfyUIBridge(baseUrl, `http://127.0.0.1:${localPort}`));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/__editor/comfyui/bridge/install', async (req: Request, res: Response) => {
    if (!requireLocalOwner(req, res)) return;
    const root = (req.body as { root?: unknown }).root;
    if (typeof root !== 'string' || !root.trim()) {
      res.status(400).json({ error: 'A ComfyUI installation directory is required.' });
      return;
    }
    try {
      res.json(await installComfyUIBridge(root));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/__editor/comfyui/provider-operation', async (req: Request, res: Response) => {
    if (!localOwnerRequest(req)) {
      res
        .status(403)
        .json({ error: 'The ComfyUI provider bridge is local to this editor session.' });
      return;
    }
    const authorization = req.header('authorization') ?? '';
    if (!validComfyUIBridgeAuthorization(authorization)) {
      res.status(403).json({ error: 'Invalid ComfyUI bridge token.' });
      return;
    }
    if (ctx.projectRoot === engineRoot) {
      res.status(400).json({ error: 'Open a project before running a provider operation.' });
      return;
    }
    const body = req.body as { name?: unknown; input?: unknown; confirm?: unknown };
    if (typeof body.name !== 'string') {
      res.status(400).json({ error: 'Expected a registered provider operation name.' });
      return;
    }
    const catalog = await discoverProjectTools(ctx.projectRoot, loadProjectModule);
    const entry = catalog.tools.find((candidate) => candidate.name === body.name);
    if (!allowedComfyUIProviderOperation(entry?.generation)) {
      res.status(403).json({
        error:
          'ComfyUI may call only registered Fal, Tripo, World Labs, or OpenRouter submit/poll/cancel operations.',
      });
      return;
    }
    const controller = new AbortController();
    req.once('aborted', () => controller.abort());
    // The allowlist above already proved this names a provider operation; the
    // credential read for that provider is `executeProjectTool`'s, the one
    // place that resolves a tool's declared provider.
    const result = await executeProjectTool({
      account: ctx.account,
      projectRoot: ctx.projectRoot,
      loadModule: loadProjectModule,
      name: body.name,
      input: Object.hasOwn(body, 'input') ? body.input : {},
      confirmed: body.confirm === true,
      signal: controller.signal,
    });
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
