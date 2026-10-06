/**
 * EVERY CHILD OF THE SESSION STARTS WITHOUT A WINDOW ON WINDOWS — including the ones its
 * dependencies start.
 *
 * The session runs detached (launcher/launch.ts: on Windows an attached child is in a job object
 * killed with the CLI that started it), and detached on Windows means no console of its own. A
 * console program it then starts without `windowsHide` gets a console of its own, which Windows
 * Terminal opens as an empty window on the person's screen. The editor's own calls all pass
 * windowsHide; its dependencies do not — Vite probes for network drives with `exec('net use')`
 * at startup, measured as one empty Terminal window per `edit` on volter-desktop (2026-10-06).
 *
 * So on Windows this module, imported first by the session entry, makes `windowsHide: true` the
 * default of every child_process call in this process. A caller that names windowsHide keeps its
 * own value. `syncBuiltinESMExports` carries the change to ESM named imports, and each function's
 * `util.promisify` shape is preserved. Elsewhere it does nothing.
 */
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';

type Callable = (...args: unknown[]) => unknown;
const NAMES = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'] as const;

const isOptions = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The arguments with windowsHide defaulted, in the slot where that function takes its options:
 *  exec/execSync(command, options?, callback?); the others (file, args?, options?, callback?). */
function hidden(name: (typeof NAMES)[number], args: unknown[]): unknown[] {
  const next = [...args];
  const at = name !== 'exec' && name !== 'execSync' && Array.isArray(next[1]) ? 2 : 1;
  const current = next[at];
  if (isOptions(current)) {
    if (current['windowsHide'] === undefined) next[at] = { ...current, windowsHide: true };
  } else if (current === undefined && next.length <= at) {
    next.push({ windowsHide: true });
  } else if (typeof current === 'function') {
    next.splice(at, 0, { windowsHide: true }); // options go before the callback
  }
  return next;
}

if (process.platform === 'win32') {
  const target = childProcess as unknown as Record<string, Callable & { [promisify.custom]?: Callable }>;
  for (const name of NAMES) {
    const original = target[name];
    if (typeof original !== 'function') continue;
    const wrapped = function (this: unknown, ...args: unknown[]) {
      return original.apply(this, hidden(name, args));
    } as Callable & { [promisify.custom]?: Callable };
    const custom = original[promisify.custom];
    if (typeof custom === 'function') {
      wrapped[promisify.custom] = (...args: unknown[]) => custom(...hidden(name, args));
    }
    target[name] = wrapped;
  }
  syncBuiltinESMExports();
}
