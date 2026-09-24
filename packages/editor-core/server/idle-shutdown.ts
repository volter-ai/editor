import { commandLine } from '../src/product-command';
/**
 * Idle self-shutdown — the editor dev server's own lifetime bound.
 *
 * THE PROBLEM THIS EXISTS FOR. Nothing ties a dev server's lifetime to the
 * agent session that started it. The session ends, the server does not: it
 * squats its port, keeps running whatever tab-lifecycle loop it booted with,
 * and reopens browser tabs for a game nobody is editing. The agent contract
 * ("close your session when your task ends") is unenforced and was violated
 * three times in one evening. A bounded self-heal makes an abandoned server
 * quieter; it does not make it not-abandoned. So the server ends itself.
 *
 * OWNERSHIP (the one-place statement).
 * - OWNER: the server process. Nothing else creates, shares, or observes this
 *   timer — there is exactly one per process, created at boot by the host
 *   (`dev.ts` / `packaged.ts`) right after `listen`.
 * - THE ONE TEARDOWN PATH: `onIdle` hands back to the host's EXISTING shutdown
 *   function — the same one SIGINT/SIGTERM use (dereg from the session
 *   registry, remove `.vgai/session.json`, close the blessed tab, close
 *   HTTP/router/Vite, exit). Idle shutdown adds no second path and no special
 *   case; it only supplies a different `why` string, so the server's last-gasp
 *   line names idleness as the cause and a vanished `vgai sessions` entry is
 *   explainable from the log. (The session registry is a ledger of what IS
 *   running — a dead entry is pruned, never annotated — so there is
 *   deliberately no "close reason" recorded there.)
 * - `stop()` is called by that same path; the interval is `unref()`ed besides,
 *   so it can never hold an exiting process open.
 *
 * WHAT RESETS THE TIMER — existing signals only, no new heartbeat protocol:
 * 1. A CONNECTED EDITOR CLIENT. `hasConnectedClients` is the live SSE client
 *    count (`editor-sse.ts`'s `clientCount()`), the same number `vgai status`
 *    reports as `connected`. It is polled rather than evented, which makes a
 *    connected tab PERMANENTLY non-idle while it is open: every tick with a
 *    client present stamps the clock forward, so the window can only start
 *    running once the last tab is gone.
 * 2. AN HTTP REQUEST. The hosts call `noteActivity()` from one `app.use`
 *    ahead of every route, so the control API (`/__editor/command` relay,
 *    `/__editor/state`, `/__vgai/*` eval + screenshot) and ordinary page/module
 *    requests all count. Counting every request rather than only `/__editor/*`
 *    is deliberate and is the SAFE direction of error: a superset of "control
 *    traffic" can only delay a shutdown, and anything fetching modules from
 *    this server is something using it.
 *
 * Autosave means a shutdown loses nothing, and `vgai edit` brings the session
 * back in seconds — which is what makes 45 minutes a cheap default rather than
 * a risky one.
 */

/** Idle window when `VGAI_IDLE_SHUTDOWN_MINUTES` is unset. */
export const DEFAULT_IDLE_SHUTDOWN_MINUTES = 45;

export const IDLE_SHUTDOWN_MINUTES_ENV = 'VGAI_IDLE_SHUTDOWN_MINUTES';

/**
 * The configured idle window in milliseconds; `0` means "never self-shut".
 *
 * Fractional minutes are accepted on purpose (`0.05` = 3s) — that is how the
 * behaviour is verified live without waiting three quarters of an hour, and a
 * second seconds-only env var would just be a second thing to keep in sync.
 *
 * Disabled when:
 * - `VGAI_IDLE_SHUTDOWN_MINUTES=0` — the explicit opt-out;
 * - `CI` is set — a CI runner already owns and reaps its child processes, and
 *   a lane that pauses longer than the window must not lose its server;
 * - the session is EPHEMERAL (`VGAI_EPHEMERAL_SESSION`, today `vgai doctor`) —
 *   a probe's whole lifetime belongs to the tool that spawned it.
 *
 * `VGAI_NO_OPEN` deliberately does NOT disable it: a headless session is
 * exactly the kind that gets abandoned. Harnesses that drive their own server
 * stay alive because driving it is activity (see the header).
 *
 * A malformed value falls back to the default rather than disabling — the
 * failure mode of a typo must not be an immortal server.
 */
export function resolveIdleShutdownMs(env: NodeJS.ProcessEnv = process.env): number {
  if (env['CI']) return 0;
  const ephemeral = env['VGAI_EPHEMERAL_SESSION'];
  if (ephemeral !== undefined && ephemeral !== '' && ephemeral !== '0') return 0;
  const raw = env[IDLE_SHUTDOWN_MINUTES_ENV];
  if (raw === undefined || raw.trim() === '') return DEFAULT_IDLE_SHUTDOWN_MINUTES * 60_000;
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes < 0) return DEFAULT_IDLE_SHUTDOWN_MINUTES * 60_000;
  return Math.round(minutes * 60_000);
}

/** Human-readable window for the shutdown line (`45m`, `90s`, `1.5s`). */
export function formatIdleWindow(idleMs: number): string {
  if (idleMs >= 60_000) {
    const minutes = idleMs / 60_000;
    return `${Number.isInteger(minutes) ? minutes : minutes.toFixed(2).replace(/\.?0+$/, '')}m`;
  }
  const seconds = idleMs / 1000;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(2).replace(/\.?0+$/, '')}s`;
}

export interface IdleShutdownOptions {
  /** Window in ms; `0` disables (the controller then never arms a timer). */
  readonly idleMs: number;
  /** Live SSE client count > 0 — see reset source 1 in the header. */
  readonly hasConnectedClients: () => boolean;
  /**
   * The host's existing shutdown function, called ONCE with a `why` string
   * naming the idle window. Never a second teardown path.
   */
  readonly onIdle: (why: string) => void;
  /** Poll cadence override; defaults to a tenth of the window (1s–30s). */
  readonly pollMs?: number;
}

export interface IdleShutdown {
  /** Stamp "used just now". Wired to one `app.use` in each host. */
  noteActivity(): void;
  /** Stop polling. Called from the host's shutdown path. */
  stop(): void;
  /** `false` when the window is 0 — nothing was armed. */
  readonly armed: boolean;
}

/**
 * Poll cadence: fine enough that the observed shutdown lands close to the
 * configured window, coarse enough that a 45-minute window is not a per-second
 * wakeup. A tenth of the window, clamped to [1s, 30s].
 */
function defaultPollMs(idleMs: number): number {
  return Math.min(30_000, Math.max(1_000, Math.round(idleMs / 10)));
}

export function createIdleShutdown(options: IdleShutdownOptions): IdleShutdown {
  const { idleMs, hasConnectedClients, onIdle } = options;
  if (idleMs <= 0) {
    return { noteActivity: () => {}, stop: () => {}, armed: false };
  }

  let lastActivity = Date.now();
  let fired = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const stop = (): void => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  const tick = (): void => {
    if (fired) return;
    // A connected tab is not merely activity, it is continuous occupancy: while
    // one is open the clock can never start running.
    if (hasConnectedClients()) {
      lastActivity = Date.now();
      return;
    }
    if (Date.now() - lastActivity < idleMs) return;
    fired = true;
    stop();
    onIdle(
      `idle ${formatIdleWindow(idleMs)} — no editor tab connected and no request served ` +
        `(${IDLE_SHUTDOWN_MINUTES_ENV}=0 disables; ${commandLine('edit')} restarts the session)`,
    );
  };

  timer = setInterval(tick, options.pollMs ?? defaultPollMs(idleMs));
  // Bookkeeping must never be the reason a process stays up.
  timer.unref?.();

  return {
    noteActivity: () => {
      if (!fired) lastActivity = Date.now();
    },
    stop,
    armed: true,
  };
}
