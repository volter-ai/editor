/** The launcher every product's CLI runs. The core server owns the workbench,
 * proxy and browser tab; the product only says who it is. */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, openSync, closeSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { resolveProductForProject } from '@volter/editor-sdk/session/product-locator';
import { resolveWorkbenchForProject, workbenchUrl } from '@volter/editor-sdk/session/workbench-locator';
import { announceEditorLaunch, waitForPendingEditorLaunch } from '@volter/editor-sdk/session/registry-format';
import { allocateWorktreeEditorPort, resolveEditorPortPreference } from './project-editor-port';
import { verifiedSessions, requestEditorTabEnsure, waitForSessionWorkbench, waitForVerifiedEditorOpen } from './editor-sessions';
import { classifyProjectSession } from './session-resolution';
import { loopbackPortFree } from './loopback-port';
import { waitForOwnEditorServer, describeEditorBootFailure, DEFAULT_EDITOR_BOOT_TIMEOUT_MS, type ChildExitStatus } from './editor-boot';

/** Who is launching: the package a project declares, the id its workbench
 * build carries, and the names a person sees and types. */
export interface LaunchingProduct {
  readonly packageName: string;
  readonly id: string;
  readonly displayName: string;
  readonly command: string;
}

export async function launch(folder: string, launching: LaunchingProduct, options: { workbench?: string; noOpen?: boolean; port?: number } = {}): Promise<void> {
  const project = realpathSync(resolve(folder));
  const product = resolveProductForProject(project);
  if (product.name !== launching.packageName) throw new Error(`${project} declares ${product.name}, not ${launching.displayName}.`);
  const port = resolveEditorPortPreference(project, options.port, process.env['VGAI_EDITOR_PORT']);
  await waitForPendingEditorLaunch(project);
  const sessions = await verifiedSessions(port);
  const verdict = classifyProjectSession(sessions, project);
  if (verdict.kind === 'attach') {
    const serverUrl = `http://127.0.0.1:${verdict.session.port}`;
    const running = await waitForSessionWorkbench(serverUrl);
    if (running.product !== launching.id) throw new Error(`This project is open in ${running.product}; close that session before opening ${launching.displayName}.`);
    const state = await fetch(`${serverUrl}/__editor/state`, { signal: AbortSignal.timeout(5000) }).then(r => r.json());
    if (typeof state.workbenchUrl !== 'string') {
      // The proxy port is reserved by project identity, just like the server.
      console.log(workbenchUrl(allocateWorktreeEditorPort(project, undefined, 'frame-proxy'), project));
    } else console.log(state.workbenchUrl);
    await ensureTab(serverUrl, !!options.noOpen);
    return;
  }
  if (verdict.kind === 'unreachable') throw new Error(`This project's session is ${verdict.reason}; refusing to launch a duplicate.`);
  const workbench = await resolveWorkbenchForProject({ projectRoot: project, product, override: options.workbench, io: { log: console.log } });
  const framePort = allocateWorktreeEditorPort(project, undefined, 'frame');
  const proxyPort = allocateWorktreeEditorPort(project, undefined, 'frame-proxy');
  for (const reserved of [port, framePort, proxyPort]) {
    if (!await loopbackPortFree(reserved)) throw new Error(`Reserved port ${reserved} is occupied; refusing to move this project's session to another port.`);
  }
  const require = createRequire(join(product.dir, 'package.json'));
  const entry = require.resolve('@volter/editor-core/server/packaged');
  const logDirectory = join(project, 'logs');
  mkdirSync(logDirectory, { recursive: true });
  const logPath = join(logDirectory, `editor-${port}.log`);
  const log = openSync(logPath, 'a', 0o600);
  const clearLaunch = announceEditorLaunch(project);
  let child;
  try {
    child = spawn(process.execPath, [entry], {
      cwd: project, detached: true, stdio: ['ignore', log, log],
      env: { ...process.env, VGAI_CLI_ENTRY: resolve(process.argv[1]!),
        VGAI_PROJECT: project, VGAI_PRODUCT_DIR: product.dir, VGAI_EDITOR_PORT: String(port),
        VGAI_WORKBENCH_DIR: workbench.dir, VGAI_FRAME_PORT: String(framePort), VGAI_FRAME_PROXY_PORT: String(proxyPort),
        ...(options.noOpen ? { VGAI_NO_OPEN: '1' } : {}),
      },
    });
  } catch (error) {
    clearLaunch();
    throw error;
  } finally { closeSync(log); }
  let exit: ChildExitStatus | null = null;
  child.once('exit', (code, signal) => { exit = { code, signal }; });
  child.once('error', () => { exit = { code: 1, signal: null }; });
  child.unref();
  const serverUrl = `http://127.0.0.1:${port}`;
  try {
    const outcome = await waitForOwnEditorServer({ serverUrl, isOurs: p => p === project, childExit: () => exit,
      onProgress: ms => console.log(`Starting ${launching.displayName} (${Math.round(ms / 1000)}s); logs: ${logPath}`) });
    if (outcome.status !== 'ready') throw new Error(describeEditorBootFailure(outcome, { serverUrl, project, port, timeoutMs: DEFAULT_EDITOR_BOOT_TIMEOUT_MS, logPath, command: launching.command }));
    await waitForSessionWorkbench(serverUrl);
    console.log(`${launching.displayName}: ${workbenchUrl(proxyPort, project)}`);
    console.log(`Logs: ${logPath}`);
    await ensureTab(serverUrl, !!options.noOpen);
  } finally { clearLaunch(); }
}

async function ensureTab(serverUrl: string, noOpen: boolean): Promise<void> {
  const openAttemptAt = Date.now();
  const result = await requestEditorTabEnsure(serverUrl, !noOpen);
  if (result === 'unsupported') throw new Error(`Session ${serverUrl} could not ensure its tab.`);
  if (noOpen) return;
  if (result === 'disabled') throw new Error('This session was started with automatic tab opening disabled; open its printed URL.');
  const outcome = await waitForVerifiedEditorOpen(serverUrl, { openAttemptAt,
    onProgress: ms => console.log(`Waiting for the editor page (${Math.round(ms / 1000)}s)…`) });
  if (outcome.status !== 'connected') throw new Error(`Editor page ${outcome.status === 'never-arrived' ? 'did not arrive' : 'arrived but did not become ready'}; open the printed workbench URL and inspect the session log.`);
}
