/**
 * Editor session registry — the file-backed ledger of live editor dev servers.
 * This module is the WRITER (dev.ts registers on listen, re-registers on
 * project switch, unregisters on shutdown). The FORMAT — entry shape, guards,
 * path, liveness-filtered read — lives once in `@vgai/sdk`'s
 * `session-registry-format`, imported by every reader (this file, the CLI,
 * and both SDK transports) instead of copied.
 *
 * Entries are best-effort — every reader must PID-liveness-filter (a crashed
 * server can't unregister itself), and writers sweep dead entries on write.
 */

import {
  EDITOR_SESSIONS_REGISTRY_FILE,
  type EditorSessionEntry as EditorSession,
  isEditorSessionEntry,
  normalizeEditorSessionEntry,
  pidAlive,
} from '@volter/editor-sdk/session/registry-format';

export type { EditorSessionEntry as EditorSession } from '@volter/editor-sdk/session/registry-format';
export { pidAlive } from '@volter/editor-sdk/session/registry-format';

import { randomBytes, randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveWorktreeIdentity, type WorktreeIdentity } from './worktree-identity';

export type EditorSessionAnnouncement = Pick<
  EditorSession,
  'project' | 'port' | 'pid' | 'startedAt'
>;

const PROCESS_SESSION_ID = randomUUID();
const PROCESS_CONTROL_SECRET = randomBytes(32).toString('base64url');

export function processSessionId(): string {
  return PROCESS_SESSION_ID;
}

export function processControlSecret(): string {
  return PROCESS_CONTROL_SECRET;
}

export function sessionIdentity(project: string | null): WorktreeIdentity | null {
  return project === null ? null : resolveWorktreeIdentity(project);
}

export function materializeSession(
  announcement: EditorSessionAnnouncement,
  id: string = PROCESS_SESSION_ID,
): EditorSession {
  const identity = sessionIdentity(announcement.project);
  return {
    ...announcement,
    sessionId: id,
    controlSecret: PROCESS_CONTROL_SECRET,
    repositoryId: identity?.repositoryId ?? null,
    worktreeId: identity?.worktreeId ?? null,
    worktreeRoot: identity?.worktreeRoot ?? null,
    projectRelativePath: identity?.projectRelativePath ?? null,
    branch: identity?.branch ?? null,
    headCommit: identity?.headCommit ?? null,
    baseCommit: identity?.baseCommit ?? null,
  };
}

const REGISTRY_DIR = join(homedir(), '.vgai');
const REGISTRY_FILE = EDITOR_SESSIONS_REGISTRY_FILE;

export function sessionRegistryPath(): string {
  return REGISTRY_FILE;
}

/**
 * Is this dev server an EPHEMERAL PROBE rather than a session anyone owns?
 *
 * `vgai doctor` spawns a real dev server on the target folder for a few
 * seconds and drives it with its own headless browser. It is not an editing
 * session: nobody should be able to reuse it, `vgai close` should not list
 * it, and — the defect this exists for (SimCity ingest dogfood, S-6) — it
 * must not touch the project's `.vgai/session.json`, which belongs to
 * whichever `vgai edit` session is actually serving that folder. The probe
 * used to OVERWRITE that file at boot with its own throwaway port/pid and
 * then DELETE it on exit, so a live session the user was watching became
 * undiscoverable (`cat .vgai/session.json` → ENOENT) because they ran a
 * read-only diagnostic against it.
 *
 * Same shape as `VGAI_NO_OPEN`: an env flag the spawning tool sets on the
 * child, never a mode the server infers. `'0'` explicitly opts back in, so
 * the variable can be cleared by value in an inherited environment.
 */
export function isEphemeralSession(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env['VGAI_EPHEMERAL_SESSION'];
  return value !== undefined && value !== '' && value !== '0';
}

/**
 * Does this dev server contribute to the PERSON's launcher memory
 * (`~/.vgai/recent-projects.json`, read by the Projects hub and by the
 * opt-in "Reopen last project on launch")?
 *
 * Recents is machine-local state that belongs to a
 * HUMAN at a launcher — it is what the hub shows first and what reopen-last
 * reaches for. Two kinds of dev server have no such human by construction and
 * must therefore stay out of it:
 *
 * - an EPHEMERAL PROBE (`isEphemeralSession`, today `vgai doctor`), which is
 *   not an editing session at all; and
 * - a HEADLESS session (`VGAI_NO_OPEN` — the CLI's `--no-open`), which
 *   maintains no browser tab whatsoever: CI, headless harnesses, and every
 *   background-agent session. Measured: an agent's transient session wrote
 *   its scratchpad project into the owner's Recents, and the owner's next
 *   launcher boot reached for it.
 *
 * The read is the same truthiness `dev.ts`/`packaged.ts` already use for
 * `tabBijection.enabled`, so "this session maintains a tab" and "this session
 * is someone's launcher memory" can never disagree.
 */
export function writesRecentProjects(env: NodeJS.ProcessEnv = process.env): boolean {
  if (isEphemeralSession(env)) return false;
  return !env['VGAI_NO_OPEN'];
}

/** All recorded sessions, unvalidated beyond shape (callers liveness-filter). */
export function readSessions(): EditorSession[] {
  try {
    const raw: unknown = JSON.parse(readFileSync(REGISTRY_FILE, 'utf8'));
    return Array.isArray(raw)
      ? raw.filter(isEditorSessionEntry).map(normalizeEditorSessionEntry)
      : [];
  } catch {
    return [];
  }
}

/** Sessions whose server process is still alive. */
export function liveSessions(): EditorSession[] {
  return readSessions().filter((s) => pidAlive(s.pid));
}

/**
 * Atomic registry replace: write a private temp file, then rename() it over
 * the registry. rename(2) is atomic on POSIX (and effectively so on NTFS), so
 * a concurrent reader always parses either the complete old array or the
 * complete new one — never a torn/truncated file. Torn reads are not
 * hypothetical: `readSessions()` maps ANY parse failure to `[]`, so a
 * reader-that-then-writes (register/unregister — which now runs on every
 * dev-server source-change restart) that catches another writer mid-truncate
 * would persist that empty view and silently wipe every other live session's
 * entry. Reproduced live 2026-07-25: two concurrent restart-churn processes
 * emptied a registry seeded with three entries whose PIDs were still alive —
 * the wiped sessions kept running but became invisible to `vgai
 * edit`/`sessions`/`close`, which is the "new editors starting over and over
 * while strays accumulate" failure mode.
 */
function replaceRegistry(sessions: EditorSession[]): void {
  const tmp = `${REGISTRY_FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(sessions, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, REGISTRY_FILE);
  // Owner-only is the intent; a filesystem without modes (a browser runtime)
  // keeps the file and skips the bit.
  try {
    chmodSync(REGISTRY_FILE, 0o600);
  } catch {
    /* no modes here */
  }
}

const REGISTRY_LOCK = `${REGISTRY_FILE}.lock`;
const LOCK_WAIT_MS = 2_000;

/**
 * One writer at a time. The rename keeps READS whole, but register and
 * unregister read, change and replace the file: two sessions doing that at
 * once each write the array they read, and the later write drops the other's
 * entry, which leaves a live session invisible to `edit`, `status` and
 * `close`. The lock file holds its owner's pid, so a lock left by a dead
 * process is taken over; after LOCK_WAIT_MS the write goes ahead unlocked,
 * because bookkeeping must never stall a server.
 */
function withRegistryLock(write: () => void): void {
  const deadline = Date.now() + LOCK_WAIT_MS;
  const pause = new Int32Array(new SharedArrayBuffer(4));
  let held = false;
  while (!held) {
    try {
      const fd = openSync(REGISTRY_LOCK, 'wx', 0o600);
      writeFileSync(fd, String(process.pid));
      closeSync(fd);
      held = true;
    } catch {
      let recorded: string;
      let age: number;
      try {
        recorded = readFileSync(REGISTRY_LOCK, 'utf8').trim();
        age = Date.now() - statSync(REGISTRY_LOCK).mtimeMs;
      } catch {
        continue; // released between the two calls
      }
      // An empty lock is one being taken right now, unless it is older than
      // any take: then its writer died between creating and filling it.
      const owner = Number(recorded);
      const abandoned =
        recorded === ''
          ? age > LOCK_WAIT_MS
          : !Number.isInteger(owner) || owner <= 0 || !pidAlive(owner);
      if (abandoned) {
        try {
          unlinkSync(REGISTRY_LOCK);
        } catch {
          /* another writer took it over first */
        }
        continue;
      }
      if (Date.now() >= deadline) break;
      Atomics.wait(pause, 0, 0, 25);
    }
  }
  try {
    write();
  } finally {
    if (held) {
      try {
        unlinkSync(REGISTRY_LOCK);
      } catch {
        /* already gone */
      }
    }
  }
}

/**
 * A registry record whose pid is not alive is HISTORY, not identity.
 *
 * A dead record must
 * never contribute a project — or anything else — to the port it used to
 * hold, and no live server may inherit one. The registry is a ledger of what
 * IS running, so every write prunes what is not; a reader that forgets to
 * liveness-filter can then only ever see stale entries this process has not
 * swept yet, never entries the registry deliberately kept.
 *
 * `isAlive` is injectable so the rule is testable against fabricated pids
 * without spawning (or killing) real processes.
 */
export function pruneDeadSessions(
  sessions: readonly EditorSession[],
  isAlive: (pid: number) => boolean = pidAlive,
): EditorSession[] {
  return sessions.filter((s) => isAlive(s.pid));
}

/**
 * The registry as it must look once `incoming` has taken its port: every dead
 * record gone, the previous claim on this pid or this port replaced, and
 * `incoming` appended. Pure, for the same reason as `pruneDeadSessions`.
 */
export function registryAfterRegistration(
  sessions: readonly EditorSession[],
  incoming: EditorSession,
  isAlive: (pid: number) => boolean = pidAlive,
): EditorSession[] {
  const rest = pruneDeadSessions(sessions, isAlive).filter(
    (s) => s.pid !== incoming.pid && s.port !== incoming.port,
  );
  return [...rest, incoming];
}

/**
 * Record (or refresh) this process's session. Sweeps dead entries and any
 * stale claim on the same port while it's here.
 */
export function registerSession(announcement: EditorSessionAnnouncement): void {
  try {
    mkdirSync(REGISTRY_DIR, { recursive: true });
    const incoming = materializeSession(announcement);
    withRegistryLock(() => replaceRegistry(registryAfterRegistration(readSessions(), incoming)));
  } catch {
    // Registry is best-effort — never let bookkeeping kill the server.
  }
}

export function unregisterSession(pid: number): void {
  try {
    // Same rule on the way out: this process's record goes, and so does every
    // record whose server is already gone. Leaving those behind is what lets a
    // dead entry outlive the server it described and keep answering "which
    // project is on port N?" long after nothing is.
    withRegistryLock(() =>
      replaceRegistry(pruneDeadSessions(readSessions().filter((s) => s.pid !== pid))),
    );
  } catch {
    // Best-effort (see registerSession).
  }
}
