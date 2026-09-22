/** Resolve an existing session for exactly one project.
 * Prefer the project's hint, verify it against the served canonical path,
 * then consult the shared registry. Never fall back to another project.
 * Storage identifiers move with the server in the coordinated migration. */

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { resolveManifestPath } from '@volter/editor-project/manifest/locate';
import {
  EDITOR_SESSION_DISCOVERY_TIMEOUT_MS,
  type EditorSessionInfo,
  type SessionListingTransport as SessionDiscoveryTransport,
  HttpSessionDiscovery,
  servedProjectAnswer,
  withTimeout,
} from '@volter/editor-sdk/session/discovery';

/** Nearest ancestor containing the project's canonical manifest. */
export function findProjectRootFrom(dir: string): string | null {
  let cur = resolve(dir);
  for (;;) {
    if (existsSync(resolveManifestPath(cur))) return cur;
    const parent = dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

/** The minimal slice of `EditorTransport` `resolveSession` actually needs — narrower than the full interface so a test double only has to implement one method. */
export type SessionListingTransport = SessionDiscoveryTransport;

export interface ResolvedSession {
  /** Editor dev-server port the resolved session is listening on. */
  port: number;
  /** Absolute project root — the nearest ancestor of the requested directory containing `vgai.project.json`. */
  projectRoot: string;
}

export interface SessionResolutionDeps {
  /** Session listing + liveness verification — defaults to a real `HttpSessionDiscovery`. Overridable for tests. */
  transport?: SessionListingTransport;
  /** Project-root discovery — defaults to the real fs walk (`findProjectRootFrom` above). Overridable for tests. */
  findProjectRootFrom?: (dir: string) => string | null;
  /** Project-local session hint reader. Defaults to `.vgai/session.json`. */
  readProjectSession?: (projectRoot: string) => ProjectSessionHint | null;
  /** Exact-session verifier. Defaults to GET /__editor/project + canonical project matching. */
  verifyProjectSession?: (hint: ProjectSessionHint, projectRoot: string) => Promise<boolean>;
}

export interface ProjectSessionHint {
  port: number;
  pid: number;
  url: string;
  startedAt: string;
}

function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function readProjectSession(projectRoot: string): ProjectSessionHint | null {
  try {
    const value: unknown = JSON.parse(
      readFileSync(join(projectRoot, '.vgai', 'session.json'), 'utf8'),
    );
    if (typeof value !== 'object' || value === null) return null;
    const hint = value as Record<string, unknown>;
    if (
      typeof hint['port'] !== 'number' ||
      !Number.isInteger(hint['port']) ||
      hint['port'] <= 0 ||
      typeof hint['pid'] !== 'number' ||
      typeof hint['url'] !== 'string' ||
      typeof hint['startedAt'] !== 'string'
    ) {
      return null;
    }
    return hint as unknown as ProjectSessionHint;
  } catch {
    return null;
  }
}

/**
 * WHICH PROJECT a `/__editor/project` body says its server is serving, and the
 * reason it cannot describe it.
 *
 * `serving` is the server's own statement of "I AM serving this project, I
 * just cannot describe it" — its manifest is unparseable or fails strict
 * validation. The route added it because a bare `{ project: null }` there is
 * indistinguishable from "no project open"; reading only `project.path`
 * reproduces that collapse on this side, and the cost is the worst kind of
 * wrong answer: this door refused a session that WAS open on the caller's
 * project with "no live editor session found … (N other live session(s) found,
 * but none open this project)" — sending the operator to start an editor that
 * was already running, with the real defect (their own manifest) never named.
 */

/**
 * What the server on `port` says it serves — `undefined` when it did not
 * answer at all. One probe: the manifest failure arrives with the path, so
 * neither the hint path nor the refusal path pays a second round trip.
 */
async function probeServedProject(
  port: number,
): Promise<{ path: string | null; manifestError: string | null } | undefined> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/__editor/project`, {
      signal: AbortSignal.timeout(EDITOR_SESSION_DISCOVERY_TIMEOUT_MS),
    });
    if (!response.ok) return undefined;
    return servedProjectAnswer(await response.json());
  } catch {
    return undefined;
  }
}

/**
 * The refusal for a session that IS this project's and cannot be driven,
 * because the project's manifest does not load.
 *
 * A refusal, not an attach: with no readable manifest the editor page itself
 * renders its startup-error screen, so there is no editor and no game behind
 * this door to bind `{ editor, game, page, tools, session }` to. What changed
 * is only that it now says the true thing — the failing file and key — instead
 * of "no live editor session found", which sent operators to start an editor
 * that was already running while their actual defect went unnamed.
 */
function manifestRefusal(projectRoot: string, manifestError: string): Error {
  return new Error(
    `@volter/editor-live: the editor session for ${projectRoot} is live, but its vgai.project.json does ` +
      'not load, so there is no editor or game to drive — the editor page is showing this same ' +
      `error. Fix the manifest and retry; the session recovers on save, no restart needed.\n${manifestError}`,
  );
}

/**
 * Resolve `projectDir` (default `process.cwd()`) to the port of its already-
 * running `vgai edit` session. Throws a descriptive error (never hangs
 * indefinitely — bounded by `EDITOR_SESSION_DISCOVERY_TIMEOUT_MS`, and never
 * silently attaches to an unrelated project's session — see the module doc
 * above) when no vgai.project.json is found, or no live session covers it.
 */
/**
 * THE REFUSAL WHEN NOTHING MATCHED — and it says WHICH nothing.
 *
 * "No live editor session found … run `vgai edit`" used to be the answer to
 * four different states, only one of which it described. The other three sent
 * the operator to start an editor that was already running:
 *
 *  - discovery FAILED (a probe timeout under load) — nothing was learned, so
 *    "no session is running" is not a fact anyone established;
 *  - the registry was read and is genuinely empty — the one case the old text
 *    was right about;
 *  - sessions exist, but every one resolves to a different canonical path. In
 *    a repo worked through git worktrees this is the ORDINARY miss: two
 *    checkouts of the same project differ only in a path prefix, and a
 *    symlinked worktree's `realpath` diverges from the path the caller typed.
 *    Naming both sides is what makes it a two-second diagnosis instead of a
 *    hunt.
 *
 * Each branch prescribes only what its own state supports.
 */
function noMatchingSessionRefusal(
  projectRoot: string,
  canon: string,
  sessions: readonly EditorSessionInfo[],
  discoveryFailure: string | null,
): Error {
  if (discoveryFailure !== null) {
    return new Error(
      `@volter/editor-live: could not READ the editor session registry while looking for ${projectRoot} — ` +
        `${discoveryFailure}. This is not the answer "no editor is running": the question went ` +
        'unanswered, so nothing is known about what is live. Retry (a probe can time out while ' +
        'the box is loaded); if it keeps failing, `vgai sessions` asks the same question directly.',
    );
  }
  if (sessions.length === 0) {
    return new Error(
      `@volter/editor-live: the editor session registry is readable and lists NO live sessions, so none ` +
        `covers ${projectRoot}. @volter/editor-live only attaches to an already-running session — it ` +
        'never starts one — so run `volter-editor edit` in that project first, then retry.',
    );
  }
  const listed = sessions
    .map((s) => `    port ${s.port} → ${s.project === null ? '(no project)' : s.project}`)
    .join('\n');
  return new Error(
    `@volter/editor-live: ${sessions.length} live editor session(s) are running, but none of them opens ` +
      `${projectRoot}. @volter/editor-live never silently attaches to a different project.\n` +
      `  looking for (resolved): ${canon}\n` +
      `  live sessions:\n${listed}\n` +
      '  If one of those is meant to be this project, the two paths differ after resolution — ' +
      'the usual cause is a git worktree or a symlink, where the session was opened through a ' +
      'different path to the same files. Run `volter-editor edit` from THIS path, or use the path the ' +
      'session lists.',
  );
}

export async function resolveSession(
  projectDir: string = process.cwd(),
  deps: SessionResolutionDeps = {},
): Promise<ResolvedSession> {
  const findRoot = deps.findProjectRootFrom ?? findProjectRootFrom;
  const transport = deps.transport ?? new HttpSessionDiscovery();

  const projectRoot = findRoot(projectDir);
  if (projectRoot === null) {
    throw new Error(
      `@volter/editor-live: no vgai.project.json found in ${projectDir} or any parent directory — is this a vgai project?`,
    );
  }

  // The editor writes this exact-project hint at boot and removes it on
  // shutdown. Prefer it over a global all-session scan: it is both faster and
  // immune to an unrelated slow/dead registry entry consuming the discovery
  // deadline. The live probe remains authoritative, so a stale file cannot
  // attach us to the wrong project or port.
  const localHint = (deps.readProjectSession ?? readProjectSession)(projectRoot);
  if (localHint) {
    // `deps.verifyProjectSession` is the test-only override and keeps its
    // boolean meaning: "this hint is this project's session, and healthy".
    // With no override we read the probe ourselves, because the same response
    // carries WHY a served project cannot be described.
    if (deps.verifyProjectSession) {
      if (await deps.verifyProjectSession(localHint, projectRoot)) {
        return { port: localHint.port, projectRoot };
      }
    } else {
      const served = await probeServedProject(localHint.port);
      if (served?.path != null && canonicalPath(served.path) === canonicalPath(projectRoot)) {
        if (served.manifestError !== null) throw manifestRefusal(projectRoot, served.manifestError);
        return { port: localHint.port, projectRoot };
      }
    }
  }

  let sessions: EditorSessionInfo[];
  // A FAILED discovery is not an empty one. Collapsing the two into `[]` is
  // what made this door answer "no live editor session found" — and prescribe
  // `vgai edit` — for a probe that merely timed out under load, sending the
  // operator to start an editor that was already running while the real defect
  // went unnamed. The same collapse the manifest refusal above was added for.
  let discoveryFailure: string | null = null;
  try {
    sessions = await withTimeout(
      transport.listSessions(EDITOR_SESSION_DISCOVERY_TIMEOUT_MS),
      EDITOR_SESSION_DISCOVERY_TIMEOUT_MS,
      'editor session discovery',
    );
  } catch (err) {
    sessions = [];
    discoveryFailure = err instanceof Error ? err.message : String(err);
  }

  const canon = canonicalPath(projectRoot);
  const match = sessions.find((s) => s.project !== null && canonicalPath(s.project) === canon);
  if (!match) throw noMatchingSessionRefusal(projectRoot, canon, sessions, discoveryFailure);

  if (match.manifestError != null) throw manifestRefusal(projectRoot, match.manifestError);

  return { port: match.port, projectRoot };
}
