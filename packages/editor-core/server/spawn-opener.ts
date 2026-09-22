/**
 * Best-effort launch of an OS "open a URL" command (`open`, `cmd /c start`,
 * `powershell.exe Start-Process`, `xdg-open`, …), extracted from
 * `index.ts`'s `openBrowser` into its own module so it's unit-testable
 * against a REAL spawned child (see `spawn-opener.test.ts`) without pulling
 * in the whole CLI entry point.
 */

import { type ChildProcess, spawn } from 'node:child_process';

/** Cap on how much of a failed opener's stderr we buffer before printing —
 *  enough for a real error message, small enough to never matter for a
 *  detached fire-and-forget child. */
export const OPENER_STDERR_CAP_BYTES = 2048;

/** An unref'd child's piped stderr only stays readable for as long as THIS
 *  process's event loop keeps ticking — normally guaranteed by the caller's
 *  verified-open poll (>=15s, see waitForVerifiedEditorOpen). Belt-and-
 *  suspenders bound so a genuinely long-lived/never-exiting opener can't
 *  hold the pipe (and this process) open indefinitely if the parent exits
 *  on its own first. */
export const OPENER_EXIT_WATCH_TIMEOUT_MS = 20_000;

/** Fire one open attempt, NAMING the failure instead of swallowing it.
 *  Two failure modes, both silent before this fix:
 *  - meteor-dodge dry-run friction #1: the powershell.exe hand-off died
 *    silently in a background shell — spawn launch failures arrive on the
 *    child's 'error' event, which nothing listened to.
 *  - run-3 dogfood friction #3: a child that LAUNCHES but exits nonzero
 *    (e.g. Start-Process itself failing inside powershell) was silent too —
 *    stdio was fully 'ignore'd and nothing checked the exit code.
 *  Still best-effort: a failure logs one line (stderr captured, capped, and
 *  included when available) and runs `fallback`, if given — never throws,
 *  never blocks. */
export function spawnOpener(cmd: string, cmdArgs: string[], fallback?: () => void): void {
  let child: ChildProcess;
  try {
    child = spawn(cmd, cmdArgs, { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
  } catch (err) {
    console.error(`vgai: auto-open via ${cmd} failed: ${(err as Error).message}`);
    fallback?.();
    return;
  }

  const stderrChunks: Buffer[] = [];
  let stderrBytes = 0;
  child.stderr?.on('data', (chunk: Buffer) => {
    if (stderrBytes >= OPENER_STDERR_CAP_BYTES) return;
    const remaining = OPENER_STDERR_CAP_BYTES - stderrBytes;
    const slice = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
    stderrChunks.push(slice);
    stderrBytes += slice.length;
  });

  child.on('error', (err) => {
    console.error(`vgai: auto-open via ${cmd} failed to launch: ${err.message}`);
    fallback?.();
  });

  child.on('exit', (code) => {
    if (code !== null && code !== 0) {
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
      console.error(`vgai: auto-open via ${cmd} exited ${code}: ${stderr}`);
      fallback?.();
    }
  });

  child.unref();

  const pipeTimeout = setTimeout(() => {
    child.stderr?.destroy();
  }, OPENER_EXIT_WATCH_TIMEOUT_MS);
  pipeTimeout.unref();
}
