import { commandLine, productCommand } from '@volter/editor-sdk/kit/product-command';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { resolveManifestPath } from '@volter/editor-project/manifest/load-file';
import type { RepositorySessionPresence } from './repository-presence';
import { resolveWorktreeIdentity, worktreeIdForRoot } from './worktree-identity';
import {
  markTaskWorktreeCreated,
  registerTaskWorktree,
  removeArchivedWorktree,
} from './worktree-retention.mjs';

export interface WorktreePorcelainRecord {
  root: string;
  headCommit: string | null;
  branch: string | null;
  bare: boolean;
  detached: boolean;
  locked: string | null;
  prunable: string | null;
}

export interface WorktreeSessionRef {
  sessionId: string | null;
  worktreeId: string | null;
  port: number;
  pid: number | null;
  presence?: Pick<RepositorySessionPresence, 'updatedAt' | 'participants'>;
}

/** Project the private session registry down to browser-safe worktree state. */
export function publicWorktreeSessionRefs(
  sessions: readonly WorktreeSessionRef[],
): WorktreeSessionRef[] {
  return sessions.map((session) => ({
    sessionId: session.sessionId,
    worktreeId: session.worktreeId,
    port: session.port,
    pid: session.pid,
  }));
}

/** Attach only the browser-safe repository directory to matching live
 * sessions. Unreachable or mismatched registry entries remain ordinary
 * "editor running" sessions instead of inheriting stale presence. */
export function attachRepositoryPresence(
  worktrees: readonly WorktreeView[],
  directory: readonly RepositorySessionPresence[],
): WorktreeView[] {
  const bySession = new Map(directory.map((entry) => [entry.sessionId, entry]));
  return worktrees.map((worktree) => ({
    ...worktree,
    sessions: worktree.sessions.map((session) => {
      const entry = session.sessionId ? bySession.get(session.sessionId) : undefined;
      return entry && entry.worktreeId === worktree.worktreeId
        ? {
            ...session,
            presence: {
              updatedAt: entry.updatedAt,
              participants: entry.participants.map((participant) => ({ ...participant })),
            },
          }
        : session;
    }),
  }));
}

export interface WorktreeView extends WorktreePorcelainRecord {
  repositoryId: string;
  worktreeId: string;
  current: boolean;
  project: string | null;
  dirty: boolean;
  ahead: number | null;
  behind: number | null;
  sessions: WorktreeSessionRef[];
}

export interface RepositoryBranchView {
  name: string;
  headCommit: string;
  updatedAt: number;
  worktreeId: string | null;
  current: boolean;
}

export interface WorktreeEditorLaunch {
  command: string;
  args: string[];
  cwd: string;
}

/** The product CLI that launched this editor, run again with `args`. */
export function productCliLaunchCommand(input: {
  cwd: string;
  args: readonly string[];
  inheritedCliEntry?: string | undefined;
}): WorktreeEditorLaunch {
  const inheritedCliEntry = input.inheritedCliEntry ? resolve(input.inheritedCliEntry) : null;
  if (inheritedCliEntry && existsSync(inheritedCliEntry)) {
    return {
      command: process.execPath,
      args: [inheritedCliEntry, ...input.args],
      cwd: input.cwd,
    };
  }
  throw new Error(
    `This editor was not launched by ${productCommand() ?? "the editor's command"} and cannot manage another worktree. Restart it with ${commandLine('edit')}.`,
  );
}

export function worktreeEditorLaunchCommand(input: {
  targetProject: string;
  targetWorktreeRoot: string;
  inheritedCliEntry?: string | undefined;
}): WorktreeEditorLaunch {
  return productCliLaunchCommand({
    cwd: input.targetProject,
    args: ['edit', input.targetProject],
    ...(input.inheritedCliEntry ? { inheritedCliEntry: input.inheritedCliEntry } : {}),
  });
}

function applyPorcelainField(record: WorktreePorcelainRecord, key: string, value: string): void {
  if (key === 'HEAD') record.headCommit = value || null;
  else if (key === 'branch') record.branch = value.replace(/^refs\/heads\//, '') || null;
  else if (key === 'locked') record.locked = value || 'locked';
  else if (key === 'prunable') record.prunable = value || 'prunable';
  else if (key === 'bare') record.bare = true;
  else if (key === 'detached') record.detached = true;
}

function git(cwd: string, args: readonly string[]): string {
  try {
    return execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    const stderr = (error as { stderr?: Buffer | string }).stderr;
    const detail = typeof stderr === 'string' ? stderr.trim() : stderr?.toString().trim();
    throw new Error(detail || `git ${args.join(' ')} failed in ${cwd}.`);
  }
}

function gitAsync(cwd: string, args: readonly string[]): Promise<string> {
  return new Promise((resolveOutput, rejectOutput) => {
    execFile('git', ['-C', cwd, ...args], { encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        rejectOutput(new Error(stderr.trim() || `git ${args.join(' ')} failed in ${cwd}.`));
        return;
      }
      resolveOutput(stdout.trim());
    });
  });
}

export function parseWorktreePorcelain(output: string): WorktreePorcelainRecord[] {
  const records: WorktreePorcelainRecord[] = [];
  let current: WorktreePorcelainRecord | null = null;
  const flush = () => {
    if (current) records.push(current);
    current = null;
  };

  for (const line of output.split(/\r?\n/)) {
    if (line === '') {
      flush();
      continue;
    }
    const separator = line.indexOf(' ');
    const key = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? '' : line.slice(separator + 1);
    if (key === 'worktree') {
      flush();
      current = {
        root: value,
        headCommit: null,
        branch: null,
        bare: false,
        detached: false,
        locked: null,
        prunable: null,
      };
      continue;
    }
    if (!current) throw new Error(`Malformed git worktree record: ${line}`);
    applyPorcelainField(current, key, value);
  }
  flush();
  return records;
}

async function aheadBehind(root: string): Promise<{ ahead: number | null; behind: number | null }> {
  try {
    const [behind, ahead] = (
      await gitAsync(root, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'])
    )
      .split(/\s+/)
      .map(Number);
    return {
      ahead: Number.isInteger(ahead) ? (ahead as number) : null,
      behind: Number.isInteger(behind) ? (behind as number) : null,
    };
  } catch {
    return { ahead: null, behind: null };
  }
}

export async function listRepositoryWorktrees(
  projectRoot: string,
  sessions: readonly WorktreeSessionRef[] = [],
): Promise<WorktreeView[]> {
  const currentIdentity = resolveWorktreeIdentity(projectRoot);
  if (currentIdentity.headCommit === null) {
    throw new Error(`${projectRoot} is not inside a Git repository.`);
  }
  const records = parseWorktreePorcelain(
    git(currentIdentity.worktreeRoot, ['worktree', 'list', '--porcelain']),
  );
  return Promise.all(
    records.map(async (record) => {
      const root = realpathSync(record.root);
      const worktreeId = worktreeIdForRoot(currentIdentity.repositoryId, root);
      const project = join(record.root, currentIdentity.projectRelativePath);
      const counts = record.bare ? { ahead: null, behind: null } : await aheadBehind(record.root);
      return {
        ...record,
        ...counts,
        root,
        repositoryId: currentIdentity.repositoryId,
        worktreeId,
        current: worktreeId === currentIdentity.worktreeId,
        project: existsSync(resolveManifestPath(project)) ? project : null,
        dirty: !record.bare && (await gitAsync(record.root, ['status', '--porcelain'])).length > 0,
        sessions: sessions.filter((session) => session.worktreeId === worktreeId),
      };
    }),
  );
}

export function listRepositoryBranches(
  projectRoot: string,
  worktrees: readonly WorktreeView[],
): RepositoryBranchView[] {
  const identity = resolveWorktreeIdentity(projectRoot);
  if (identity.headCommit === null) {
    throw new Error(`${projectRoot} is not inside a Git repository.`);
  }
  const output = git(identity.worktreeRoot, [
    'for-each-ref',
    '--sort=refname',
    '--sort=-committerdate',
    '--format=%(refname:short)\t%(objectname)\t%(committerdate:unix)',
    'refs/heads',
  ]);
  if (!output) return [];
  return output.split(/\r?\n/).map((line) => {
    const [name, headCommit, updatedAtSeconds] = line.split('\t');
    const updatedAt = Number(updatedAtSeconds) * 1_000;
    if (!name || !headCommit || !Number.isFinite(updatedAt)) {
      throw new Error(`Malformed Git branch record: ${line}`);
    }
    const worktree = worktrees.find((candidate) => candidate.branch === name);
    return {
      name,
      headCommit,
      updatedAt,
      worktreeId: worktree?.worktreeId ?? null,
      current: worktree?.current ?? false,
    };
  });
}

export interface CreateWorktreeOptions {
  branch: string;
  from?: string;
  destination?: string;
}

export function createRepositoryWorktree(
  projectRoot: string,
  options: CreateWorktreeOptions,
): { root: string; project: string | null; branch: string; createdBranch: boolean } {
  const identity = resolveWorktreeIdentity(projectRoot);
  if (identity.headCommit === null)
    throw new Error(`${projectRoot} is not inside a Git repository.`);
  git(identity.worktreeRoot, ['check-ref-format', '--branch', options.branch]);
  const branchExists = (() => {
    try {
      git(identity.worktreeRoot, ['show-ref', '--verify', `refs/heads/${options.branch}`]);
      return true;
    } catch {
      return false;
    }
  })();
  const suffix = options.branch.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-|-$/g, '');
  const destination = resolve(
    options.destination ??
      join(dirname(identity.worktreeRoot), `${basename(identity.worktreeRoot)}-${suffix}`),
  );
  if (existsSync(destination))
    throw new Error(`Worktree destination already exists: ${destination}`);
  const args = ['worktree', 'add'];
  if (!branchExists) args.push('-b', options.branch);
  args.push(destination, branchExists ? options.branch : (options.from ?? 'HEAD'));
  registerTaskWorktree(
    identity.worktreeRoot,
    destination,
    `editor:${options.branch}`,
    options.branch,
  );
  git(identity.worktreeRoot, args);
  markTaskWorktreeCreated(identity.worktreeRoot, destination);
  const root = realpathSync(destination);
  const project = join(root, identity.projectRelativePath);
  return {
    root,
    project: existsSync(resolveManifestPath(project)) ? project : null,
    branch: options.branch,
    createdBranch: !branchExists,
  };
}

function runInherited(command: string, args: readonly string[], cwd?: string): Promise<void> {
  return new Promise((resolveRun, rejectRun) => {
    const child = execFile(command, args, { ...(cwd ? { cwd } : {}) });
    child.stdout?.pipe(process.stdout);
    child.stderr?.pipe(process.stderr);
    child.once('error', rejectRun);
    child.once('exit', (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${command} ${args.join(' ')} exited with status ${code}.`));
    });
  });
}

export async function prepareRepositoryWorktree(
  donorProjectRoot: string,
  worktreeRoot: string,
  projectRoot: string,
): Promise<void> {
  const donorRoot = resolveWorktreeIdentity(donorProjectRoot).worktreeRoot;
  // The WORKTREE's copy of the shim, not the donor's: the donor is a parked
  // checkout that drifts by sitting there, so its shim can predate repairs the
  // current script carries (measured 2026-08-21: a donor shim without the
  // stale-workspace-shadow guard mirrored `@vgai/sdk` 0.5.5 into a fresh
  // worktree and one config typechecked red over correct source). The worktree
  // is checked out at the branch being worked, so its script is the one whose
  // repairs match its own lockfile; the donor's is only the fallback for a
  // worktree cut from a state that predates the script.
  const worktreeShim = join(worktreeRoot, 'scripts', 'worktree-node-modules-shim.mjs');
  const shim = existsSync(worktreeShim)
    ? worktreeShim
    : join(donorRoot, 'scripts', 'worktree-node-modules-shim.mjs');
  if (existsSync(shim) && existsSync(join(donorRoot, 'node_modules'))) {
    await runInherited(process.execPath, [shim, donorRoot, worktreeRoot]);
    await runInherited('npm', ['run', 'build:workspace-dists'], worktreeRoot);
    return;
  }
  if (!existsSync(join(projectRoot, 'package-lock.json'))) {
    throw new Error(
      `Created ${worktreeRoot}, but ${projectRoot} has no package-lock.json and cannot be prepared reproducibly.`,
    );
  }
  await runInherited('npm', ['ci', '--no-audit', '--no-fund', '--loglevel=error'], projectRoot);
}

export function archiveRepositoryWorktree(
  projectRoot: string,
  targetRoot: string,
  sessions: readonly WorktreeSessionRef[],
): void {
  const current = resolveWorktreeIdentity(projectRoot);
  const target = resolveWorktreeIdentity(targetRoot);
  if (target.worktreeId === current.worktreeId)
    throw new Error('The active worktree cannot be archived.');
  if (sessions.some((session) => session.worktreeId === target.worktreeId)) {
    throw new Error(`Stop the live session for ${target.worktreeRoot} before archiving it.`);
  }
  if (git(target.worktreeRoot, ['status', '--porcelain']) !== '') {
    throw new Error(
      `Worktree ${target.worktreeRoot} is dirty; checkpoint or clean it before archiving.`,
    );
  }
  removeArchivedWorktree(current.worktreeRoot, target.worktreeRoot);
}
