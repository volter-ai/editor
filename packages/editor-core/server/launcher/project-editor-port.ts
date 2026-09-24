import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { resolveWorktreeIdentity } from '../worktree-identity';
import type { EditorPortSource } from './session-resolution';

const MIN_PORT = 1_024;
const MAX_PORT = 65_535;
export const WORKTREE_EDITOR_PORT_MIN = 20_200;
export const WORKTREE_EDITOR_PORT_MAX = 29_999;
const DEFAULT_PORT_REGISTRY = join(homedir(), '.vgai', 'worktree-ports.json');
const LOCK_STALE_MS = 10_000;
const lockWait = new Int32Array(new SharedArrayBuffer(4));

interface WorktreePortEntry {
  key: string;
  port: number;
}

function assertPort(value: unknown, source: string): number {
  if (!Number.isInteger(value) || (value as number) < MIN_PORT || (value as number) > MAX_PORT) {
    throw new Error(`${source} must be an integer from ${MIN_PORT} through ${MAX_PORT}.`);
  }
  return value as number;
}

function isEntry(value: unknown): value is WorktreePortEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry['key'] === 'string' &&
    Number.isInteger(entry['port']) &&
    (entry['port'] as number) >= WORKTREE_EDITOR_PORT_MIN &&
    (entry['port'] as number) <= WORKTREE_EDITOR_PORT_MAX
  );
}

function readEntries(registryFile: string): WorktreePortEntry[] {
  let raw: string;
  try {
    raw = readFileSync(registryFile, 'utf8');
  } catch (error) {
    // ONLY a missing file means "no ports reserved yet". Anything else
    // (EACCES, EISDIR, an I/O error) must throw: treating it as an empty
    // registry would let the next allocation write a one-entry file over
    // every other worktree's reservation — the RESERVED-port invariant's
    // storage silently wiped by a transient read failure.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new Error(
      `Could not read the worktree port registry at ${registryFile}: ${String(error)}. ` +
        'Refusing to treat an unreadable registry as empty (that would discard every reservation).',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `The worktree port registry at ${registryFile} is not valid JSON (${String(error)}). ` +
        'Fix or delete the file; refusing to overwrite every reservation it may hold.',
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      `The worktree port registry at ${registryFile} is not an array. ` +
        'Fix or delete the file; refusing to overwrite every reservation it may hold.',
    );
  }
  const entries = parsed.filter(isEntry);
  if (entries.length !== parsed.length) {
    throw new Error(
      `The worktree port registry at ${registryFile} holds ${parsed.length - entries.length} ` +
        'entr(ies) this build does not recognize. Fix or delete the file; a write-back that ' +
        'silently dropped them would un-reserve those ports.',
    );
  }
  return entries;
}

function writeEntries(registryFile: string, entries: readonly WorktreePortEntry[]): void {
  mkdirSync(dirname(registryFile), { recursive: true });
  const temp = `${registryFile}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(entries, null, 2)}\n`);
  renameSync(temp, registryFile);
}

function withRegistryLock<T>(registryFile: string, action: () => T): T {
  const lock = `${registryFile}.lock`;
  mkdirSync(dirname(registryFile), { recursive: true });
  const deadline = Date.now() + 5_000;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) {
          rmdirSync(lock);
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for the worktree port registry lock at ${lock}.`);
      }
      Atomics.wait(lockWait, 0, 0, 10);
    }
  }
  try {
    return action();
  } finally {
    try {
      rmdirSync(lock);
    } catch {
      // A removed stale lock cannot make allocation fail after it committed.
    }
  }
}

/**
 * A project needs MORE THAN ONE reserved port in the web + server shape: the
 * `vgai edit` session, the Code-OSS remote extension host that frames it, and the
 * one-origin proxy in front of both (docs/CODE-OSS.md §Boot, WEB + SERVER). Each is
 * a ROLE, and each role gets its own reservation in this same registry under the
 * same worktree/project key — so the whole set is stable per worktree, refuses
 * rather than drifts, and is released together by
 * {@link releaseWorktreeEditorPorts} (whose prefix is the repository/worktree pair
 * and therefore already covers every role).
 *
 * `'editor'` is spelled as the BARE key, with no role suffix, and that is
 * deliberate: it is the key every existing reservation in every developer's
 * `~/.vgai/worktree-ports.json` was written under, and a project's editor port
 * must not move because a second role was added beside it.
 */
export type WorktreePortRole = 'editor' | 'frame' | 'frame-proxy';

function portKey(projectRoot: string, role: WorktreePortRole): string {
  const identity = resolveWorktreeIdentity(projectRoot);
  const base = `${identity.repositoryId}\0${identity.worktreeId}\0${identity.projectRelativePath}`;
  return role === 'editor' ? base : `${base}\0${role}`;
}

export function allocateWorktreeEditorPort(
  projectRoot: string,
  registryFile: string = DEFAULT_PORT_REGISTRY,
  role: WorktreePortRole = 'editor',
): number {
  const key = portKey(projectRoot, role);
  return withRegistryLock(registryFile, () => {
    const entries = readEntries(registryFile);
    const existing = entries.find((entry) => entry.key === key);
    if (existing) return existing.port;

    const span = WORKTREE_EDITOR_PORT_MAX - WORKTREE_EDITOR_PORT_MIN + 1;
    const digest = createHash('sha256').update(key).digest();
    const start = digest.readUInt32BE(0) % span;
    const occupied = new Set(entries.map((entry) => entry.port));
    for (let offset = 0; offset < span; offset += 1) {
      const port = WORKTREE_EDITOR_PORT_MIN + ((start + offset) % span);
      if (occupied.has(port)) continue;
      writeEntries(registryFile, [...entries, { key, port }]);
      return port;
    }
    throw new Error(
      `No free editor port remains in ${WORKTREE_EDITOR_PORT_MIN}-${WORKTREE_EDITOR_PORT_MAX}.`,
    );
  });
}

/** Release every project allocation owned by an archived worktree. */
export function releaseWorktreeEditorPorts(
  repositoryId: string,
  worktreeId: string,
  registryFile: string = DEFAULT_PORT_REGISTRY,
): number {
  const prefix = `${repositoryId}\0${worktreeId}\0`;
  return withRegistryLock(registryFile, () => {
    const entries = readEntries(registryFile);
    const retained = entries.filter((entry) => !entry.key.startsWith(prefix));
    const released = entries.length - retained.length;
    if (released > 0) writeEntries(registryFile, retained);
    return released;
  });
}

/** Explicit environment overrides remain useful for CI and parallel test workers. */
export function readEditorPortEnv(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  return assertPort(Number(value), 'VGAI_EDITOR_PORT');
}

/** Resolve launcher precedence: CLI flag, environment, then worktree-local allocation. */
export function resolveEditorPortRequest(
  projectRoot: string,
  portOverride: number | undefined,
  envValue: string | undefined,
  registryFile?: string,
): { port: number; source: EditorPortSource } {
  if (portOverride !== undefined) {
    return { port: assertPort(portOverride, '--port'), source: 'flag' };
  }
  const fromEnv = readEditorPortEnv(envValue);
  if (fromEnv !== undefined) return { port: fromEnv, source: 'env' };
  return { port: allocateWorktreeEditorPort(projectRoot, registryFile), source: 'worktree' };
}

export function resolveEditorPortPreference(
  projectRoot: string,
  portOverride: number | undefined,
  envValue: string | undefined,
  registryFile?: string,
): number {
  return resolveEditorPortRequest(projectRoot, portOverride, envValue, registryFile).port;
}
