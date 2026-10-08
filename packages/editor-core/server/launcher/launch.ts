/** The launcher every product's CLI runs. The core server owns the workbench,
 * proxy and browser tab; the product only says who it is. */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, openSync, closeSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { resolveProductForProject } from '@volter/sdk/session/product-locator';
import { resolveWorkbenchForProject, workbenchUrl } from '@volter/sdk/session/workbench-locator';
import { announceEditorLaunch, waitForPendingEditorLaunch } from '@volter/sdk/session/registry-format';
import { allocateWorktreeEditorPort, resolveEditorPortPreference } from './project-editor-port';
import { fetchEditorState, verifiedSessions, requestEditorTabEnsure, waitForSessionWorkbench, waitForVerifiedEditorOpen } from './editor-sessions';
import { classifyProjectSession } from './session-resolution';
import { loopbackPortFree } from './loopback-port';
import { waitForOwnEditorServer, describeEditorBootFailure, DEFAULT_EDITOR_BOOT_TIMEOUT_MS, type ChildExitStatus } from './editor-boot';

/** A static limited view of a project (docs/LIMITED-VIEW.md): a launcher verb, because it runs
 *  the project's own session headless and records what it serves. */
export const VIEW_BUILD_USAGE = 'view build [folder] --out <dir> --workbench <vscode-web dir>';

/**
 * `view build`, loaded only when it runs. Its implementation reaches the session's toolchain
 * (TypeScript, the module crawl), which must never be inlined into a product's CLI bundle: every
 * other verb would pay for it, and TypeScript's CommonJS does not survive an ESM bundle. So it is
 * its own built entry (`scripts/build-session.mjs`) and is imported by package specifier from a
 * variable, which no bundler follows.
 */
export async function viewBuild(
  ...args: Parameters<typeof import('./view-build').viewBuild>
): ReturnType<typeof import('./view-build').viewBuild> {
  const specifier = '@volter/editor-core/server/launcher/view-build';
  const implementation = (await import(/* @vite-ignore */ specifier)) as typeof import('./view-build');
  return implementation.viewBuild(...args);
}

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
  const port = resolveEditorPortPreference(project, options.port, process.env['VOLTER_EDITOR_PORT']);
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
    await refuseIncompatibleProject(serverUrl, launching.command, !!options.noOpen);
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
    // DETACHED ON EVERY PLATFORM: on Windows libuv puts a child that is not detached in a job
    // object killed with this CLI, so an attached session died the moment `npx … edit` returned
    // (measured on 0.5.184). Detached there also means no console of its own, so every child
    // the session starts hides its own console (windowsHide), and the Code-OSS server it starts
    // is hidden but attached, giving the extension host and its gits one invisible console.
    child = spawn(process.execPath, [entry], {
      windowsHide: true,
      cwd: project, detached: true, stdio: ['ignore', log, log],
      env: { ...process.env, VOLTER_CLI_ENTRY: resolve(process.argv[1]!),
        VOLTER_PROJECT: project, VOLTER_PRODUCT_DIR: product.dir, VOLTER_EDITOR_PORT: String(port),
        VOLTER_WORKBENCH_DIR: workbench.dir, VOLTER_FRAME_PORT: String(framePort), VOLTER_FRAME_PROXY_PORT: String(proxyPort),
        ...(options.noOpen ? { VOLTER_NO_OPEN: '1' } : {}),
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
    await refuseIncompatibleProject(serverUrl, launching.command, !!options.noOpen);
    await ensureTab(serverUrl, !!options.noOpen);
  } finally { clearLaunch(); }
}

/**
 * Run the session's own dependency optimizer for `folder` and stop: the step an
 * image build runs so an opened session finds Vite's pre-bundle already made.
 * It is the packaged session itself, with no workbench, port or tab, so what it
 * records is exactly what the session would.
 */
export async function prepareSession(folder: string, launching: LaunchingProduct): Promise<void> {
  const project = realpathSync(resolve(folder));
  const product = resolveProductForProject(project);
  if (product.name !== launching.packageName) throw new Error(`${project} declares ${product.name}, not ${launching.displayName}.`);
  const entry = createRequire(join(product.dir, 'package.json')).resolve('@volter/editor-core/server/packaged');
  const code = await new Promise<number | null>((done, fail) => {
    const child = spawn(process.execPath, [entry], {
      windowsHide: true,
      cwd: project, stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, VOLTER_PROJECT: project, VOLTER_PRODUCT_DIR: product.dir, VOLTER_NO_OPEN: '1', VOLTER_PREPARE: '1' },
    });
    child.once('error', fail);
    child.once('exit', done);
  });
  if (code !== 0) throw new Error(`${launching.command} prepare exited with code ${code} for ${project}.`);
}

/**
 * THE SESSION CANNOT OPEN THIS PROJECT, and the server already knows it: `/__editor/state`'s
 * `projectCompatibility` is the same verdict the page refuses on, computed server-side on every
 * read. Until 2026-10-06 `edit` printed the URL and exited
 * 0 regardless — measured on the owner's stream, `edit . --no-open` on a project pinned to
 * 0.5.185 under a 0.5.189 editor: exit 0, a tab stuck on the product's splash, and the cause only
 * in `status`. So the refusal is printed here, with its fix, and the command fails.
 *
 * The session is left running and (unless `--no-open`) its tab is opened: the page shows the same
 * refusal with a Copy button, and its Retry opens the project once the fix is in, with no second
 * `edit` needed.
 */
async function refuseIncompatibleProject(serverUrl: string, command: string, noOpen: boolean): Promise<void> {
  type Refusal = { error?: unknown; recovery?: { kind?: unknown; guidance?: unknown; verbs?: unknown } };
  const read = async (): Promise<Refusal | null> => {
    try {
      const response = await fetch(`${serverUrl}/__editor/state`, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) return null;
      const refusal = ((await response.json()) as { projectCompatibility?: Refusal | null }).projectCompatibility ?? null;
      return refusal && typeof refusal.error === 'string' ? refusal : null;
    } catch {
      // An unreadable answer is not a refusal; the tab wait below still reports a page that fails.
      return null;
    }
  };
  const refusal = await read();
  if (!refusal) return;
  // Only the PROJECT's verdicts (the engine pin). A server-staleness verdict can be a dev host's
  // restart in flight, which the tab wait below already rides out; a deadline here turned a slow
  // healthy restart into a failed `edit` (#147 review).
  const kind = refusal.recovery?.kind;
  if (kind !== 'use-compatible-editor' && kind !== 'upgrade-project') return;
  const message = refusal.error as string;
  const guidance = typeof refusal.recovery?.guidance === 'string' ? refusal.recovery.guidance : null;
  const verbs: unknown = refusal.recovery?.verbs;
  const run = (Array.isArray(verbs) ? verbs : []).filter((verb): verb is string => typeof verb === 'string')
    .map((verb) => `${command} ${verb}`).join(' && ');
  // A message that already names its fix (the engine pin's does) is not followed by the same
  // command a second time — `AppRoot`'s console line dedupes the same way.
  const named = run !== '' && (message.includes(run) || !!guidance?.includes(run));
  if (!noOpen) await requestEditorTabEnsure(serverUrl, true);
  throw new Error([
    `This session cannot open the project: ${message}`,
    ...(guidance ? [guidance] : []),
    ...(run && !named ? [`Run from the project folder:\n  ${run}`] : []),
    `The session is still running at the URL above; after the fix, press Retry on its page, or run \`${command} edit .\` again.`,
  ].join('\n\n'));
}

async function ensureTab(serverUrl: string, noOpen: boolean): Promise<void> {
  const openAttemptAt = Date.now();
  const result = await requestEditorTabEnsure(serverUrl, !noOpen);
  if (result === 'unsupported') throw new Error(`Session ${serverUrl} could not ensure its tab.`);
  if (noOpen) {
    // NO TAB IS OPENED, BUT ONE MAY ALREADY BE THERE (an attach to a session with its tab up),
    // and a page that refused to start has said so in the console ledger. That is a failure this
    // command can know about, so it is one it reports, rather than printing the URL and exit 0.
    const refused = await startupRefusals(serverUrl);
    if (refused.length > 0)
      throw new Error(`The session's open page did not start:\n${refused.map((message) => `  ${message}`).join('\n')}`);
    return;
  }
  if (result === 'disabled') throw new Error('This session was started with automatic tab opening disabled; open its printed URL.');
  // A PAGE THAT HAS REFUSED IS AN ANSWER, not a page still loading: a refused startup never
  // attaches its command listener, so the wait below would sit out its whole budget (two
  // minutes) before saying what the page said in its first second.
  let settled = false;
  const refusal = (async (): Promise<string[]> => {
    while (!settled) {
      await new Promise((r) => setTimeout(r, 2000));
      if (settled) break;
      // Said by a page that loaded for THIS open, never an earlier page's line.
      const refused = await startupRefusals(serverUrl, openAttemptAt);
      if (refused.length > 0) return refused;
    }
    return [];
  })();
  const outcome = await Promise.race([
    waitForVerifiedEditorOpen(serverUrl, { openAttemptAt,
      onProgress: ms => console.log(`Waiting for the editor page (${Math.round(ms / 1000)}s)…`) }),
    refusal.then((refused) => (refused.length > 0 ? { status: 'refused' as const, refused } : new Promise<never>(() => {}))),
  ]).finally(() => { settled = true; });
  if (outcome.status === 'refused')
    throw new Error(`Editor page did not start:\n${outcome.refused.map((message) => `  ${message}`).join('\n')}`);
  if (outcome.status !== 'connected') {
    // A page that arrived and refused to start says why in the session's console ledger (a pinned
    // engine version, a failed startup): print that, not only where to look.
    const said = outcome.status === 'never-arrived' ? [] : await currentPageErrors(serverUrl);
    throw new Error(
      `Editor page ${outcome.status === 'never-arrived' ? 'did not arrive' : 'arrived but did not become ready'}` +
        (said.length > 0 ? `:\n${said.map((message) => `  ${message}`).join('\n')}` : '; open the printed workbench URL and inspect the session log.'),
    );
  }
}

/**
 * THE REFUSAL A PAGE THAT IS OPEN NOW IS SHOWING (`Startup failed: …`, `AppRoot`'s console line),
 * or `[]`. Only a confirmed one counts (#147 review): a tab must be present, none command-ready,
 * and every present tab must have reported the `no-project` route — which `AppRoot` reports only
 * from its terminal screens, never while detection is still trying. Without those, the ledger's
 * newest "Startup failed" could be a page that has since closed, or one a Retry got past.
 * `since` (epoch ms) keeps only refusals said at or after it — an `open` reading the page it
 * just reloaded.
 */
export async function startupRefusals(serverUrl: string, since = 0): Promise<string[]> {
  const state = await fetchEditorState(serverUrl);
  if (state.tabs.length === 0 || state.tabs.some((tab) => tab.commandListener === 'ready')) return [];
  if (!state.tabs.every((tab) => tab.route === 'no-project')) return [];
  try {
    const response = await fetch(new URL('/__editor/console?all=1', serverUrl), { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return [];
    const body = (await response.json()) as { entries?: { severity?: string; message?: string; lastAt?: number }[] };
    // The NEWEST one: the terminal page said its refusal on its own load, so older lines in the
    // ledger are earlier pages'.
    const newest = (body.entries ?? [])
      .filter((entry) => entry.severity === 'error' && entry.message?.startsWith('Startup failed') && (entry.lastAt ?? 0) >= since)
      .sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0))[0];
    return newest ? [newest.message!.split('\n')[0]!] : [];
  } catch {
    return [];
  }
}

/** The console errors the page now open recorded (acknowledged or not: an error seen before and
 *  acknowledged is still this page's answer), newest last; `[]` when the ledger cannot be read. */
export async function currentPageErrors(serverUrl: string): Promise<string[]> {
  try {
    const response = await fetch(new URL('/__editor/console?all=1', serverUrl), { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return [];
    const body = (await response.json()) as {
      currentLoadId?: string | null;
      entries?: { severity?: string; message?: string; lastLoadId?: string }[];
    };
    if (!body.currentLoadId) return [];
    return (body.entries ?? [])
      .filter(
        (entry) => entry.severity === 'error' && typeof entry.message === 'string' && entry.lastLoadId === body.currentLoadId,
      )
      .map((entry) => entry.message!.split('\n')[0]!);
  } catch {
    return [];
  }
}
