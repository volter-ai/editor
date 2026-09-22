import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve } from 'node:path';

export interface WorktreeIdentity {
  repositoryId: string;
  worktreeId: string;
  worktreeRoot: string;
  projectRelativePath: string;
  branch: string | null;
  headCommit: string | null;
  baseCommit: string | null;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

export function worktreeIdForRoot(repositoryId: string, worktreeRoot: string): string {
  return `worktree-${hash(`${repositoryId}\0${canonical(worktreeRoot)}`)}`;
}

function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function git(cwd: string, args: readonly string[]): string | null {
  try {
    const output = execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return output === '' ? null : output;
  } catch {
    return null;
  }
}

function resolveGitPath(worktreeRoot: string, rawPath: string | null): string | null {
  if (!rawPath) return null;
  return canonical(isAbsolute(rawPath) ? rawPath : resolve(worktreeRoot, rawPath));
}

function defaultBaseCommit(worktreeRoot: string, headCommit: string | null): string | null {
  if (!headCommit) return null;
  const originHead = git(worktreeRoot, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']);
  const candidates = [
    originHead,
    'refs/remotes/origin/main',
    'refs/heads/main',
    'refs/heads/master',
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const base = git(worktreeRoot, ['merge-base', 'HEAD', candidate]);
    if (base) return base;
  }
  return headCommit;
}

/**
 * Resolve the Git/materialization identity for a project. A project outside
 * Git still gets an honest local repository/worktree identity rooted at the
 * project, but carries no branch or commits.
 */
export function resolveWorktreeIdentity(projectRoot: string): WorktreeIdentity {
  const project = canonical(projectRoot);
  const discoveredRoot = git(project, ['rev-parse', '--show-toplevel']);
  if (!discoveredRoot) {
    const repositoryId = `local-${hash(project)}`;
    return {
      repositoryId,
      worktreeId: `worktree-${hash(`${repositoryId}\0${project}`)}`,
      worktreeRoot: project,
      projectRelativePath: '.',
      branch: null,
      headCommit: null,
      baseCommit: null,
    };
  }

  const worktreeRoot = canonical(discoveredRoot);
  const commonDir = resolveGitPath(
    worktreeRoot,
    git(worktreeRoot, ['rev-parse', '--git-common-dir']),
  );
  const remote = git(worktreeRoot, ['config', '--get', 'remote.origin.url']);
  const repositoryKey = remote ?? commonDir ?? worktreeRoot;
  const repositoryId = `repository-${hash(repositoryKey)}`;
  const branch = git(worktreeRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const headCommit = git(worktreeRoot, ['rev-parse', '--verify', 'HEAD']);
  const projectRelativePath = relative(worktreeRoot, project) || '.';

  if (
    projectRelativePath === '..' ||
    projectRelativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
  ) {
    throw new Error(`Project ${project} is outside its reported Git worktree ${worktreeRoot}.`);
  }

  return {
    repositoryId,
    worktreeId: worktreeIdForRoot(repositoryId, worktreeRoot),
    worktreeRoot,
    projectRelativePath,
    branch,
    headCommit,
    baseCommit: defaultBaseCommit(worktreeRoot, headCommit),
  };
}

/** Git's main-worktree `--git-dir` is `<root>/.git`; linked worktrees use a
 * common-dir child. Kept exported for focused identity tests. */
export function worktreeName(identity: WorktreeIdentity): string {
  return identity.branch ?? (basename(identity.worktreeRoot) || 'detached');
}
