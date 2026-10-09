/**
 * THE SESSION OWNS THE FRAME. This module is where it does.
 *
 * the editor's `edit` command IS the Code-OSS workbench, and the workbench is two things: the
 * remote extension host (a child process, serving the VS Code page) and the
 * one-origin proxy (a listener in THIS process, `frame-proxy.ts`). Both belong
 * to the session, which is the only owner that can be right: they exist to
 * serve this project's session, they must die when it does, and a the editor's `edit` command
 * that merely REUSES a live session must not have to adopt somebody else's
 * children.
 *
 * RESOURCE OWNERSHIP, stated once (the rule that cost a game-scoped clock).
 *  - OWNER: this session process. It spawns the REH into its own process group
 *    and listens for the proxy itself.
 *  - SHARERS: none. The CLI allocates the two reserved ports and hands them
 *    over; after that it owns nothing of the frame. A second the editor's `edit` command on
 *    this project reuses the session and therefore reuses the frame.
 *  - THE ONE TEARDOWN: the host's shutdown task list (`dev.ts`/`packaged.ts`'s
 *    `createProcessShutdown`), which is the same path the editor's `close` command, SIGTERM and
 *    the idle timer all take — the path that already ends run configurations.
 *    Nothing else may stop it.
 *
 * WHERE THE WORKBENCH IS comes from the project's own declaration
 * (`.volter/workbench.json`) or the editor's `edit --workbench <dir>` command; the CLI resolves it
 * once to refuse early and passes the directory here. `@volter/sdk/session/
 * workbench-locator` is the one resolver and the one set of refusal texts.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { workbenchProductId } from '@volter/sdk/session/product-locator';
import {
  resolveWorkbench,
  type WorkbenchIdentity,
  workbenchUrl,
} from '@volter/sdk/session/workbench-locator';
import { startFrameProxy } from './frame-proxy';
import { stopProcess } from './process-shutdown';
import { sessionProduct } from './session-product';

/** The workbench directory the CLI resolved and handed over. */
const WORKBENCH_DIR_ENV = 'VOLTER_WORKBENCH_DIR';
/** The reserved port for the Code-OSS server. */
const FRAME_PORT_ENV = 'VOLTER_FRAME_PORT';
/** The reserved port for the one-origin proxy — the url a person opens. */
const FRAME_PROXY_PORT_ENV = 'VOLTER_FRAME_PROXY_PORT';

export interface FrameLaunch {
  readonly workbenchDir: string;
  readonly rehPort: number;
  readonly proxyPort: number;
}

/**
 * What this session was told to frame, or `null` when it was told nothing.
 * Reading the three together is deliberate: a launch with a workbench and no
 * ports, or ports and no workbench, is a caller bug and reads as "not framed"
 * rather than as half a frame.
 */
export function frameLaunchFromEnv(): FrameLaunch | null {
  const workbenchDir = process.env[WORKBENCH_DIR_ENV];
  const rehPort = Number(process.env[FRAME_PORT_ENV]);
  const proxyPort = Number(process.env[FRAME_PROXY_PORT_ENV]);
  if (!workbenchDir || !Number.isInteger(rehPort) || !Number.isInteger(proxyPort)) return null;
  return { workbenchDir, rehPort, proxyPort };
}

/**
 * The url the workbench will answer on, known before anything starts.
 *
 * The tab bijection needs it at `createEditorServer` time — under the frame the
 * session's ONE tab is the workbench page, not this server's own — and it is
 * pure arithmetic over the reserved port, so nothing has to have booted yet.
 */
export function frameWorkbenchUrl(launch: FrameLaunch, projectRoot: string): string {
  return workbenchUrl(launch.proxyPort, projectRoot);
}

export interface FrameWorkbench {
  /** What this session is running, for `EditorState.workbench` and the editor's `status` command. */
  readonly identity: WorkbenchIdentity;
  readonly url: string;
  /**
   * STOP THE CODE-OSS SERVER — the detached CHILD, and the one thing here that
   * can outlive this process. Unconditional in the shutdown list: it waits on
   * nothing, least of all a tab (`dev.ts`'s task list).
   */
  stopServer(): Promise<void>;
  /**
   * CLOSE THE ONE-ORIGIN PROXY — a listener in THIS process, and the tab's only
   * route to this session: the page's origin is the proxy's, so every
   * `/__editor/*` call it makes, the tab-close ACK BEACON included, arrives
   * here first. So it closes with the HTTP server, AFTER the tab-close notice,
   * and not with the child above. Measured 2026-09-21: closing it beside the
   * child turned every the editor's `close` command from `session-end-acked … ms 26` into
   * `session-end-unacked … ms 2002` — the page was told, closed itself, and
   * its beacon had nowhere to land.
   */
  closeProxy(): Promise<void>;
  /** Both, in one call — for the boot error path and the source-restart exit,
   *  where there is no tab to preserve a route for. */
  stop(): Promise<void>;
}

/** True while something is listening on `port` of loopback. */
function portTaken(port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const settle = (taken: boolean) => {
      socket.destroy();
      done(taken);
    };
    socket.once('connect', () => settle(true));
    socket.once('error', () => settle(false));
    socket.setTimeout(750, () => settle(false));
  });
}

async function waitForPort(
  port: number,
  what: string,
  child: ChildProcess,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await portTaken(port)) return;
    if (child.exitCode !== null) {
      throw new Error(`${what} exited (code ${child.exitCode}) before it listened on ${port}.`);
    }
    if (Date.now() > deadline) {
      throw new Error(`${what} never listened on ${port} within ${Math.round(timeoutMs / 1000)}s.`);
    }
    await new Promise((settle) => setTimeout(settle, 500));
  }
}

/**
 * Start the workbench for this session: the REH, then the proxy in front of it
 * and of this process.
 *
 * The argv is the same string whichever kind the workbench is — a release is
 * meant to be measured against the sources, and a boot that differed in a flag
 * would be measuring the flag.
 */
export async function startFrameWorkbench(options: {
  launch: FrameLaunch;
  projectRoot: string;
  sessionPort: number;
  /**
   * EXTRA ENVIRONMENT FOR THE REH, and through it for its extension host.
   * Today that is the Chat view's runtime handoff (`frontend-handoff.ts`): the
   * bundled supercode frontend reads `SUPERCODE_FRONTEND_*` at activation. It is
   * a SPAWN argument and not a later call because a child's environment cannot
   * be changed after it starts — which is why the session starts its harness
   * runtime before it gets here, and why there is deliberately no
   * restart-the-REH path when one arrives late.
   */
  env?: Readonly<Record<string, string>>;
  log: (line: string) => void;
}): Promise<FrameWorkbench> {
  const { launch, projectRoot, sessionPort, log } = options;
  // A WORKBENCH IS ONE PRODUCT'S (P3): the editor kit and one product's
  // workbench half are overlaid on the fork together, so a release or checkout
  // built for the other product is refused here BY NAME. The session is the
  // right place for it — the CLI checks the same pair before a server exists,
  // and this is the read that spawns. A project whose product cannot be
  // resolved is not judged: `/__editor/served-modules` is the door that says
  // why, in its own words.
  const product = sessionProduct(projectRoot);
  const workbench = resolveWorkbench(
    launch.workbenchDir,
    product === null ? undefined : workbenchProductId(product.name),
  );

  for (const [port, what] of [
    [launch.rehPort, 'the Code-OSS server'],
    [launch.proxyPort, 'the one-origin proxy'],
  ] as const) {
    if (await portTaken(port)) {
      throw new Error(
        `This project reserves port ${port} for ${what}, and something is already listening there. ` +
          `Free it (\`lsof -nP -iTCP:${port} -sTCP:LISTEN\`) — the frame never drifts to another port.`,
      );
    }
  }

  log(
    `frame: Code-OSS ${workbench.kind} ${workbench.commit.slice(0, 12)} (${workbench.dir}) on ${launch.rehPort}`,
  );
  // A win32 release's server bin is `code-server-oss.cmd`, which node will not spawn without a
  // shell (EINVAL) and which only runs the release's own node.exe on out/server-main.js — so
  // that pair is spawned directly, with no shell to quote the project path through.
  // A win32 CHECKOUT's launcher is `scripts/code-server.sh`, which Windows cannot spawn (EFTYPE);
  // what it runs in the end is node on `scripts/code-server.js` in development mode, so that is
  // spawned here, on this node. The checkout's native modules were built for the fork's `.nvmrc`
  // major, so another major is refused by name here rather than failing later inside the server.
  const sourcesOnWindows = process.platform === 'win32' && workbench.kind === 'sources';
  if (sourcesOnWindows) {
    const wanted = readFileSync(join(workbench.cwd, '.nvmrc'), 'utf8').trim().replace(/^v/, '').split('.')[0];
    const running = process.versions.node.split('.')[0];
    if (wanted && wanted !== running) {
      throw new Error(
        `The fork checkout ${workbench.dir} is built for node ${wanted} (its .nvmrc), and this editor runs on ` +
          `node ${running}. Start the editor on node ${wanted} to serve that checkout.`,
      );
    }
  }
  const [command, entry]: [string, string[]] = process.platform === 'win32' && workbench.serverBin.endsWith('.cmd')
    ? [join(workbench.cwd, 'node.exe'), [join(workbench.cwd, 'out', 'server-main.js')]]
    : sourcesOnWindows
      ? [process.execPath, [join(workbench.cwd, 'scripts', 'code-server.js')]]
      : [workbench.serverBin, []];
  // THE WORKBENCH'S OWN EXTENSIONS FOLDER. Unnamed, Code-OSS's server reads
  // `~/.vscode-server-oss/extensions`, which every Code-OSS server on the machine shares, so an
  // extension a person installed for some other remote session ran inside this editor too
  // (measured 2026-10-08: the OpenAI ChatGPT extension there threw "navigator is now a global
  // in nodejs" into every Cyclotron session). The product's own extensions ship in the release
  // (`extensions/`), so a folder per product, empty unless something installs into it, is all
  // the server needs.
  const extensionsDir = join(homedir(), '.volter', 'workbench-extensions', product === null ? 'default' : workbenchProductId(product.name));
  mkdirSync(extensionsDir, { recursive: true });
  const reh = spawn(
    command,
    [
      ...entry,
      '--extensions-dir',
      extensionsDir,
      '--host',
      '127.0.0.1',
      '--port',
      String(launch.rehPort),
      '--without-connection-token',
      projectRoot,
    ],
    {
      cwd: workbench.cwd,
      stdio: 'ignore',
      // Not detached on Windows, where detached means no console and every console program
      // the server forks (its extension host) would open a visible window; see launch.ts.
      detached: process.platform !== 'win32',
      windowsHide: true,
      env: { ...process.env, ...(sourcesOnWindows ? { NODE_ENV: 'development', VSCODE_DEV: '1' } : {}), ...options.env },
    },
  );
  let proxy: { close(): Promise<void> } | null = null;
  const closeProxy = async (): Promise<void> => {
    const closing = proxy?.close() ?? Promise.resolve();
    proxy = null;
    await closing;
  };
  // 2 s between SIGTERM and SIGKILL, not `stopProcess`'s 5 s default: this
  // runs as ONE TASK of the session's shutdown list, which bounds each task at
  // 4 s so the whole shutdown fits inside the editor's `close` command's 5.5 s grace. The
  // escalation must COMPLETE inside that window — the REH is detached into its
  // own process group, so the group SIGKILL the editor's `close` command sends at 5.5 s never
  // reaches it, and a REH that outlives this process is an orphan on the
  // reserved `frame` port that refuses the next the editor's `edit` command by name (measured
  // 2026-09-21 under load average ~30).
  const stopServer = (): Promise<void> => stopProcess(reh, 2_000);
  const stop = async (): Promise<void> => {
    await Promise.all([closeProxy(), stopServer()]);
  };
  try {
    await waitForPort(launch.rehPort, 'the Code-OSS server', reh, 300_000);
    log(
      `frame: one-origin proxy on ${launch.proxyPort} → workbench ${launch.rehPort} + session ${sessionPort}`,
    );
    const started = await startFrameProxy({
      port: launch.proxyPort,
      upstreamPort: launch.rehPort,
      sessionPort,
      projectRoot,
      // WHICH WAY ROUND THE PAGE PAINTS, from the product resolved above —
      // the same read that decides which workbench may spawn decides the
      // workbench's first frame, so there is one resolution and not two.
      colorTheme: product?.colorTheme ?? null,
      log,
    });
    proxy = started;
    return {
      identity: {
        kind: workbench.kind,
        dir: workbench.dir,
        commit: workbench.commit,
        product: workbench.product,
      },
      url: started.url,
      stopServer,
      closeProxy,
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
