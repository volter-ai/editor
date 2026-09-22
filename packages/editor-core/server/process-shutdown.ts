import { type ChildProcess, execFileSync } from 'node:child_process';
import type { Server } from 'node:http';

/** How long a detached child gets between SIGTERM and SIGKILL when its caller
 *  does not say. A caller INSIDE the session's shutdown list passes a smaller
 *  number, because its own budget is smaller than this — see
 *  `createProcessShutdown`'s note on the arithmetic. */
const DEFAULT_STOP_GRACE_MS = 5_000;

/**
 * Terminate a detached child and its whole process tree. Shared by the e2e
 * server harness and the packaged E2E runner: keeping this under `server/`
 * makes the runtime utility part of the editor package instead of forcing a
 * published command to import an unshipped e2e helper.
 *
 * `graceMs` is the SIGTERM→SIGKILL window. It is a parameter because the
 * session's shutdown list has a tighter budget than this default: a child that
 * outlives its caller's own exit is an ORPHAN holding a reserved port, so the
 * escalation has to complete inside the caller's window, not after it.
 */
export function stopProcess(proc: ChildProcess, graceMs = DEFAULT_STOP_GRACE_MS): Promise<void> {
  const signalGroup = (signal: NodeJS.Signals) => {
    if (proc.pid === undefined) return;
    if (process.platform === 'win32') {
      try {
        execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {
        /* already dead, or taskkill unavailable */
      }
      try {
        proc.kill(signal);
      } catch {
        /* already dead */
      }
      return;
    }
    try {
      process.kill(-proc.pid, signal);
    } catch {
      try {
        proc.kill(signal);
      } catch {
        /* already dead */
      }
    }
  };

  return new Promise((resolve) => {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      signalGroup('SIGKILL');
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signalGroup('SIGKILL');
      resolve();
    }, graceMs);
    proc.on('exit', () => {
      clearTimeout(timer);
      signalGroup('SIGKILL');
      resolve();
    });
    signalGroup('SIGTERM');
  });
}

/**
 * ONE RESOURCE THIS SESSION IS STOPPING, and the name a post-mortem will read.
 *
 * The name is required because the failure this list exists to survive is
 * UNATTENDED: a task that never settles is only visible as the ABSENCE of
 * everything after it, and "cleanup timed out" with no name leaves a reader
 * guessing which resource is still alive.
 */
export interface ShutdownTask {
  /** What this stops, in the words a journal line should carry. */
  readonly name: string;
  run(): void | Promise<void>;
}

export interface ProcessShutdownOptions {
  /** The WHOLE list's backstop. Bigger than `taskTimeoutMs` and nothing more:
   *  with every task bounded and independent, the list's own duration is the
   *  slowest task's, and this only catches a bug in the bounding itself. */
  timeoutMs?: number;
  /** Each task's OWN bound. See the note on `createProcessShutdown`. */
  taskTimeoutMs?: number;
  tasks: ReadonlyArray<ShutdownTask>;
  exit?: (code: number) => void;
  log?: (message: string) => void;
  /** Where a task that did not finish, or threw, is RECORDED — the session
   *  journal, handed in by the host because this module owns no project. */
  journal?: (record: {
    readonly task: string;
    readonly outcome: 'timeout' | 'failed';
    readonly ms: number;
    readonly detail?: string;
  }) => void;
}

/** Stop accepting requests and forcibly release persistent HTTP/SSE sockets. */
export function closeHttpServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      server.closeAllConnections?.();
      resolve();
      return;
    }
    server.close((error) => (error ? reject(error) : resolve()));
    // `server.close()` waits for persistent SSE/keep-alive connections. They
    // have no useful work after process shutdown begins, so close them after
    // removing the listener and eliminate the restart race on the HTTP port.
    server.closeAllConnections?.();
  });
}

/**
 * Build an idempotent, bounded signal handler.
 *
 * Node's default signal exit is disabled as soon as an application installs
 * a SIGTERM/SIGINT listener. Tooling loaders (notably tsx/esbuild) may retain
 * internal handles even after every application server and watcher closes,
 * so waiting for an empty event loop is not a shutdown contract. Resources
 * get one bounded graceful window and then the process exits explicitly.
 *
 * EVERY TASK RUNS INDEPENDENTLY AND EVERY TASK IS BOUNDED BY ITSELF. Both
 * halves were bought by one measurement (2026-09-21, load average ~30, one
 * `vgai close`): the session's journal had no `session-shutdown` line, the
 * Code-OSS server survived as PPID 1 still holding its reserved `frame` port,
 * and the next `vgai edit` refused by name. A shared bound is what makes one
 * slow resource spend everybody's window, and the arithmetic has to close:
 * `vgai close` SIGTERMs, waits 5.5 s and SIGKILLs the session's process GROUP —
 * which never reaches the Code-OSS server, because that child is spawned
 * detached into a group of its own. So the last of these tasks has to have
 * FINISHED by then, not merely started, or a child outlives its parent with
 * nobody left to signal it.
 *
 * A TASK THAT DOES NOT FINISH IS NAMED (`journal`), because the only other
 * evidence it leaves is the absence of everything downstream of it.
 */
export function createProcessShutdown(
  options: ProcessShutdownOptions,
): (why: string) => Promise<void> {
  // 4 s per task, 4.8 s for the list: the whole shutdown fits inside `vgai
  // close`'s 5.5 s grace with room for the process's own exit, which the old
  // 2 s tab wait plus a 5 s shared cleanup budget did not. The 4 s is sized so
  // a task that must follow the tab-close notice (whose own budget is 2 s)
  // still has ~2 s of its own — see dev.ts's list.
  const taskTimeoutMs = options.taskTimeoutMs ?? 4_000;
  const timeoutMs = options.timeoutMs ?? 4_800;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const log = options.log ?? ((message: string) => process.stderr.write(`${message}\n`));
  const journal = options.journal ?? (() => {});
  let pending: Promise<void> | null = null;

  /** One task, bounded by itself. Rejects with the task's NAME in the message,
   *  so the aggregate line below reads as a list of resources. */
  const runTask = async (task: ShutdownTask): Promise<void> => {
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const outcome = await Promise.race([
        Promise.resolve(task.run()).then(() => 'done' as const),
        new Promise<'timeout'>((resolve) => {
          timer = setTimeout(() => resolve('timeout'), taskTimeoutMs);
        }),
      ]);
      if (outcome === 'timeout') {
        journal({ task: task.name, outcome: 'timeout', ms: Date.now() - startedAt });
        throw new Error(`${task.name} did not finish within ${taskTimeoutMs}ms`);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (!detail.endsWith(`within ${taskTimeoutMs}ms`))
        journal({ task: task.name, outcome: 'failed', ms: Date.now() - startedAt, detail });
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  return (why: string) => {
    if (pending) return pending;
    pending = (async () => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const cleanup = Promise.allSettled(options.tasks.map(runTask));
      const result = await Promise.race([
        cleanup.then((settled) => ({ type: 'settled' as const, settled })),
        new Promise<{ type: 'timeout' }>((resolve) => {
          timeout = setTimeout(() => resolve({ type: 'timeout' }), timeoutMs);
        }),
      ]);
      if (timeout) clearTimeout(timeout);

      if (result.type === 'timeout') {
        log(`[vgai-editor] cleanup timed out after ${timeoutMs}ms (${why}); forcing exit`);
        exit(1);
        return;
      }
      const failures = result.settled.filter(
        (item): item is PromiseRejectedResult => item.status === 'rejected',
      );
      if (failures.length > 0) {
        log(
          `[vgai-editor] cleanup failed (${why}): ${failures
            .map((item) =>
              item.reason instanceof Error ? item.reason.message : String(item.reason),
            )
            .join('; ')}`,
        );
        exit(1);
        return;
      }
      exit(0);
    })();
    return pending;
  };
}
