/**
 * `~/.vgai/editor-sessions.json` — the ONE spelling of the editor-session
 * registry contract, and the shared machinery every reader was hand-copying.
 *
 * The registry's WRITE half stays with its owner
 * (`packages/editor/server/session-registry.ts`); this module owns the
 * FORMAT: the entry shape, the shape guards, the file path, the
 * liveness-filtered read, the `/__editor/project` answer parser, and the
 * pending-launch coordination. It existed as FOUR drifting copies
 * (server registry, the CLI, and both vgai-sdk transports) held together by
 * a "the CLI has no editor dependency" premise that had stopped being true —
 * and the drift was already real: one copy's `/__editor/project` parser
 * dropped `manifestError`, reporting a degraded session as belonging to no
 * project.
 */

import {
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

/** One registry entry, exactly as the server's write half records it. */
export interface EditorSessionEntry {
  /** Canonical project root currently open, or null when none. */
  project: string | null;
  port: number;
  /** PID of the dev-server process. */
  pid: number;
  /** ISO timestamp of server start. */
  startedAt: string;
  sessionId: string | null;
  /** Private loopback control credential — never returned by an editor HTTP
   *  route; exists only in this user-private registry. */
  controlSecret?: string | null;
  repositoryId: string | null;
  worktreeId: string | null;
  worktreeRoot: string | null;
  projectRelativePath: string | null;
  branch: string | null;
  headCommit: string | null;
  baseCommit: string | null;
}

export const EDITOR_SESSIONS_REGISTRY_FILE = join(homedir(), '.vgai', 'editor-sessions.json');

export function isEditorSessionEntry(v: unknown): v is EditorSessionEntry {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  const optionalIdentity = (value: unknown) =>
    value === undefined || value === null || typeof value === 'string';
  return (
    (typeof s['project'] === 'string' || s['project'] === null) &&
    typeof s['port'] === 'number' &&
    typeof s['pid'] === 'number' &&
    typeof s['startedAt'] === 'string' &&
    optionalIdentity(s['sessionId']) &&
    optionalIdentity(s['controlSecret']) &&
    optionalIdentity(s['repositoryId']) &&
    optionalIdentity(s['worktreeId']) &&
    optionalIdentity(s['worktreeRoot']) &&
    optionalIdentity(s['projectRelativePath']) &&
    optionalIdentity(s['branch']) &&
    optionalIdentity(s['headCommit']) &&
    optionalIdentity(s['baseCommit'])
  );
}

export function normalizeEditorSessionEntry(session: EditorSessionEntry): EditorSessionEntry {
  return {
    ...session,
    sessionId: session.sessionId ?? null,
    controlSecret: session.controlSecret ?? null,
    repositoryId: session.repositoryId ?? null,
    worktreeId: session.worktreeId ?? null,
    worktreeRoot: session.worktreeRoot ?? null,
    projectRelativePath: session.projectRelativePath ?? null,
    branch: session.branch ?? null,
    headCommit: session.headCommit ?? null,
    baseCommit: session.baseCommit ?? null,
  };
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The registry's live entries — shape-validated and PID-liveness-filtered. */
export function readLiveRegisteredSessions(): EditorSessionEntry[] {
  try {
    const raw: unknown = JSON.parse(readFileSync(EDITOR_SESSIONS_REGISTRY_FILE, 'utf8'));
    return Array.isArray(raw)
      ? raw
          .filter(isEditorSessionEntry)
          .map(normalizeEditorSessionEntry)
          .filter((s) => pidAlive(s.pid))
      : [];
  } catch {
    return [];
  }
}

/** Announce a launch before the server can register. Each launcher owns its file. */
export function announceEditorLaunch(project: string): () => void {
  const directory = join(project, '.vgai', 'editor-launches');
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `${process.pid}.json`);
  writeFileSync(file, JSON.stringify({ pid: process.pid }));
  const clear = () => {
    process.removeListener('exit', clear);
    try {
      unlinkSync(file);
    } catch {
      // Already cleared when the server became ready.
    }
  };
  process.once('exit', clear);
  return clear;
}

function hasPendingEditorLaunch(project: string): boolean {
  const directory = join(project, '.vgai', 'editor-launches');
  try {
    return readdirSync(directory).some((name) => {
      if (!/^\d+\.json$/.test(name)) return false;
      const pid = Number(name.slice(0, -5));
      return pid !== process.pid && pidAlive(pid);
    });
  } catch {
    return false;
  }
}

/** Wait only for an observed live launcher, never for a missing editor. */
export async function waitForPendingEditorLaunch(project: string): Promise<void> {
  const canon = canonicalizeProjectPath(project);
  const ready = () =>
    readLiveRegisteredSessions().some(
      (session) => session.project !== null && canonicalizeProjectPath(session.project) === canon,
    );
  if (ready() || !hasPendingEditorLaunch(canon)) return;
  const deadline = Date.now() + 180_000;
  while (!ready()) {
    if (!hasPendingEditorLaunch(canon)) {
      // The launcher clears its announcement only after registration.
      if (ready()) return;
      throw new Error(`The editor launch for ${canon} ended before registering a session.`);
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `The editor launch for ${canon} is still running but has not registered within 180s.`,
      );
    }
    await delay(100);
  }
}

/**
 * WHICH PROJECT a `/__editor/project` body says its server is serving.
 *
 * `serving` is that server's own statement of "I AM serving this project, I
 * just cannot describe it" (its manifest is unparseable or fails strict
 * validation) — added to the route precisely because a bare
 * `{ project: null }` is indistinguishable from "no project open". Reading
 * only `project.path` collapses the two, and the cost is that every
 * project-matched command loses a live session the moment a save breaks its
 * manifest, reporting it as belonging to no project rather than as this
 * project's degraded session.
 */
export function servedProjectAnswer(body: unknown): {
  path: string | null;
  manifestError: string | null;
} {
  const b = body as {
    project?: { path?: string } | null;
    serving?: { path?: string; error?: string } | null;
  };
  return {
    path: b.project?.path ?? b.serving?.path ?? null,
    manifestError: b.project ? null : (b.serving?.error ?? null),
  };
}

/** Canonical (realpathed when possible) absolute form of a project path. */
function canonicalizeProjectPath(p: string): string {
  const absolute = resolve(p);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}
