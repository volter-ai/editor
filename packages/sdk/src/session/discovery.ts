/** Registered-session discovery; never selects another project's session. */
import { readLiveRegisteredSessions, servedProjectAnswer } from './registry-format.js';
export { servedProjectAnswer } from './registry-format.js';

export const EDITOR_SESSION_DISCOVERY_TIMEOUT_MS = 2000;

export const EDITOR_PROBE_TIMEOUT_MS = 1500;

export class EditorTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = 'EditorTimeoutError';
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new EditorTimeoutError(label, ms)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolvePromise(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

export interface EditorSessionInfo {
  /** The port this session's dev server is bound to. */
  port: number;
  /** Canonical project root path currently open, or null when none. */
  project: string | null;
  /** Dev-server process id, when known from the local session registry (null for an unregistered/legacy server the caller only probed by port). */
  pid: number | null;
  /** Exact explicitly targeted editor origin/base URL, including protocol and host. */
  url?: string;
  /**
   * Why this server cannot DESCRIBE the `project` it is serving — its
   * manifest's own parse/validation failure, naming the failing key. `null`
   * when the project reads fine, and `undefined` from a probe that did not ask
   * (or a server too old to say). See {@link servedProjectAnswer}: a session in
   * this state is still THIS project's session, and callers must report the
   * reason rather than treat it as no session at all.
   */
  manifestError?: string | null;
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`GET /__editor/project returned HTTP ${res.status}`);
  return await res.json();
}

function baseUrl(session: EditorSessionInfo): string {
  return session.url ?? `http://127.0.0.1:${session.port}`;
}

export interface SessionListingTransport { listSessions(timeoutMs: number): Promise<EditorSessionInfo[]>; }
export class HttpSessionDiscovery implements SessionListingTransport {
  async listSessions(timeoutMs: number): Promise<EditorSessionInfo[]> {
    const registered = readLiveRegisteredSessions();
    const perProbeTimeout = Math.min(EDITOR_PROBE_TIMEOUT_MS, Math.max(200, timeoutMs));
    const failures: string[] = [];
    const probes = await Promise.all(
      registered.map(async (s) => {
        try {
          const body = await fetchJson(
            `${baseUrl({ port: s.port, project: null, pid: s.pid })}/__editor/project`,
            perProbeTimeout,
          );
          const served = servedProjectAnswer(body);
          const info: EditorSessionInfo = {
            port: s.port,
            project: served.path,
            pid: s.pid,
            manifestError: served.manifestError,
          };
          return info;
        } catch (error) {
          const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
          failures.push(`port ${s.port}: ${detail}`);
          return undefined;
        }
      }),
    );
    const sessions = probes.filter((p): p is EditorSessionInfo => p !== undefined);
    // A readable registry with registered live processes is not an empty
    // registry just because every HTTP discovery request failed. Keep any
    // verified sessions usable, but refuse an entirely unanswered inventory
    // rather than telling the caller to launch a second editor.
    if (registered.length > 0 && sessions.length === 0) {
      throw new Error(`Registered editor sessions could not be inspected: ${failures.join('; ')}`);
    }
    return sessions;
  }
}
