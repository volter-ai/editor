/**
 * The boot wait — "has the editor WE just spawned come up?" — as data in /
 * outcome out, so the launch path can tell three states apart that its
 * predecessor collapsed into one timeout.
 *
 * `waitForServer` used to poll `${serverUrl}/__editor/project` for a flat 30s
 * and treat any 200 as success. Two measured defects (FX-1) come straight out
 * of that shape:
 *
 * - **A slow boot was reported as a failed one, and then killed.** A project's
 *   FIRST editor boot pays Vite's cold dependency optimization; the probe's
 *   second `npm run dev` died on `Editor server did not start within 30s` and
 *   its third, unchanged, succeeded in ~50s. The 30s ceiling did not merely
 *   mis-report — the CLI's `process.on('exit')` teardown killed the healthy
 *   half-finished boot on the way out, throwing away the partial dep cache, so
 *   the ceiling made the next attempt cold again. Nothing named cold boot as
 *   the cause or the retry, which is how "detach it with nohup and retry once"
 *   became folk practice in a scaffold's agent.
 * - **Any answer counted as our answer.** The editor exits(1) on EADDRINUSE
 *   (`friendlyListenError` in dev.ts/packaged.ts), so when something already
 *   holds the port, the poll is answered by the STRANGER while our own child
 *   is already dead — and the CLI printed `Editor ready at …` and opened a tab
 *   on a session that dies with someone else's process.
 *
 * So the wait asks two questions the old one never did: is the thing answering
 * OURS (the project it reports), and is the child we spawned still alive. A
 * dead child fails immediately with its exit code instead of waiting out a
 * ceiling; a live child keeps its (much larger) budget and gets progress
 * lines; and the timeout message names cold boot and the exact retry.
 *
 * Everything is injectable — `fetchImpl`, `childExit`, the intervals — so the
 * whole matrix is unit-testable with no dev server, no browser and no ports.
 */

/**
 * How long a spawned editor gets to answer while its process is still alive.
 *
 * Measured on this repo's dev path (`packages/editor/server/dev.ts`, template
 * project, cold vs warm `node_modules/.vite-editor`): the express listen comes
 * up in ~1.3s either way, because Vite in middleware mode defers dep-optimize
 * past listen. The probe's >30s and ~50s boots are the PACKAGED path on a
 * freshly `npm install`ed scaffold, where a cold module graph and the first
 * esbuild prebundle are paid up front on a loaded machine. The number is
 * therefore deliberately generous rather than tuned: a healthy boot is
 * recognised by its process still being alive, and this is only the backstop
 * for a process that hangs forever without exiting.
 */
export const DEFAULT_EDITOR_BOOT_TIMEOUT_MS = 180_000;

/** How the child process ended, once it has. `null` while it is still alive. */
export interface ChildExitStatus {
  code: number | null;
  signal: NodeJS.Signals | string | null;
}

export type EditorBootOutcome =
  /** OUR server is answering for THIS project. */
  | { status: 'ready' }
  /** The process we spawned ended before it served this project. `occupant` is
   *  the project a server on that port reports, when one answers at all — the
   *  EADDRINUSE case, where the port belongs to somebody else's session. */
  | {
      status: 'exited';
      code: number | null;
      signal: NodeJS.Signals | string | null;
      occupant: string | null;
    }
  /** The child is still alive and still has not served this project. */
  | { status: 'timeout'; elapsedMs: number; occupant: string | null };

export interface EditorBootWaitOptions {
  serverUrl: string;
  /** Does a project path reported by a server on this port belong to the
   *  launch we are waiting on? (The caller owns path canonicalization.) */
  isOurs: (reportedProject: string | null) => boolean;
  /** The spawned child's exit status, or `null` while it is still running. */
  childExit: () => ChildExitStatus | null;
  timeoutMs?: number;
  intervalMs?: number;
  progressIntervalMs?: number;
  /** Called at most once per `progressIntervalMs` while a live child is still
   *  booting, so a human watching a cold boot sees proof of life. */
  onProgress?: (elapsedMs: number) => void;
  fetchImpl?: typeof fetch;
}

/** The project a server on this port reports, `null` for a projectless one, or
 *  `'down'` when nothing answers. Never throws. */
async function probeProject(
  serverUrl: string,
  fetchImpl: typeof fetch,
): Promise<string | null | 'down'> {
  try {
    const res = await fetchImpl(`${serverUrl}/__editor/project`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return 'down';
    const body = (await res.json()) as { project?: { path?: unknown } | null };
    const path = body.project?.path;
    return typeof path === 'string' ? path : null;
  } catch {
    return 'down';
  }
}

export async function waitForOwnEditorServer(
  opts: EditorBootWaitOptions,
): Promise<EditorBootOutcome> {
  const {
    serverUrl,
    isOurs,
    childExit,
    timeoutMs = DEFAULT_EDITOR_BOOT_TIMEOUT_MS,
    intervalMs = 300,
    progressIntervalMs = 20_000,
    onProgress,
    fetchImpl = fetch,
  } = opts;

  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  let lastProgressAt = startedAt;
  let occupant: string | null = null;

  for (;;) {
    const exit = childExit();
    const reported = await probeProject(serverUrl, fetchImpl);
    if (reported !== 'down' && !isOurs(reported)) occupant = reported;

    // A dead child is never "ready", whatever the port says: an answer from a
    // port our process never bound is somebody else's server.
    if (exit !== null) {
      return {
        status: 'exited',
        code: exit.code,
        signal: exit.signal,
        occupant: reported === 'down' ? occupant : reported,
      };
    }
    if (reported !== 'down' && isOurs(reported)) return { status: 'ready' };

    const now = Date.now();
    if (now >= deadline) return { status: 'timeout', elapsedMs: now - startedAt, occupant };
    if (onProgress && now - lastProgressAt >= progressIntervalMs) {
      lastProgressAt = now;
      onProgress(now - startedAt);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export interface EditorBootFailureContext {
  serverUrl: string;
  /** Canonical root of the project this launch is for. */
  project: string;
  port: number;
  timeoutMs: number;
  /** Detach mode's per-port log file, when there is one. */
  logPath?: string | null;
}

/**
 * The line a failed boot prints. Honest by construction: it never blames a
 * timeout for a process that exited, never blames the boot for a port somebody
 * else holds, and — the FX-1 case — says out loud that a first boot is slow
 * and what to re-run, instead of leaving that to folklore.
 */
export function describeEditorBootFailure(
  outcome: Exclude<EditorBootOutcome, { status: 'ready' }>,
  ctx: EditorBootFailureContext,
): string {
  const logs = ctx.logPath ? ` Editor logs: ${ctx.logPath}.` : '';
  const occupied =
    outcome.occupant === null
      ? ''
      : ` Port ${ctx.port} is being served by an editor for ${outcome.occupant} — close it ` +
        `(run \`volter-editor close\` from that project's directory), or launch on another port.`;

  if (outcome.status === 'exited') {
    const how =
      outcome.signal !== null
        ? `was killed by ${String(outcome.signal)}`
        : `exited with code ${outcome.code}`;
    return (
      `The editor process for ${ctx.project} ${how} before it started serving ` +
      `${ctx.serverUrl}/.${occupied}${logs}`
    );
  }

  return (
    `The editor for ${ctx.project} has not answered ${ctx.serverUrl}/ within ` +
    `${Math.round(ctx.timeoutMs / 1000)}s, and its process is still running.${occupied}` +
    " A project's FIRST editor boot is the slow one — it pays Vite's cold dependency " +
    `optimization into ${ctx.project}/node_modules/.vite-editor, and later boots reuse it. ` +
    `Re-run \`volter-editor edit ${ctx.project}\`: the retry starts from whatever that first boot ` +
    `already cached.${logs}`
  );
}
