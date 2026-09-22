import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { isContainedRelativePath } from '@volter/editor-sdk/session/relative-path-guard';
// The wire types live in the leaf module both sides of the route import.
import type {
  GitChangedPath,
  GitDiffHunk,
  GitHistoryCommit,
  GitWorkflowStatus,
} from '../src/api/git-wire';
import { resolveWorktreeIdentity } from './worktree-identity';
export type { GitChangedPath, GitDiffHunk, GitHistoryCommit, GitWorkflowStatus };

function git(root: string, args: readonly string[]): string {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 8 * 1024 * 1024,
    }).trim();
  } catch (error) {
    const detail = (error as { stderr?: string | Buffer }).stderr;
    throw new Error(
      (typeof detail === 'string' ? detail : detail?.toString())?.trim() ||
        `git ${args.join(' ')} failed.`,
    );
  }
}

function gitRaw(root: string, args: readonly string[]): string {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error) {
    const detail = (error as { stderr?: string | Buffer }).stderr;
    throw new Error(
      (typeof detail === 'string' ? detail : detail?.toString())?.trim() ||
        `git ${args.join(' ')} failed.`,
    );
  }
}

function gitInput(root: string, args: readonly string[], input: string): string {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      input,
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 8 * 1024 * 1024,
    }).trim();
  } catch (error) {
    const detail = (error as { stderr?: string | Buffer }).stderr;
    throw new Error(
      (typeof detail === 'string' ? detail : detail?.toString())?.trim() ||
        `git ${args.join(' ')} failed.`,
    );
  }
}

function commandAsync(
  command: string,
  args: readonly string[],
  options: { cwd: string; signal: AbortSignal; env?: NodeJS.ProcessEnv },
): Promise<string> {
  return new Promise((resolveOutput, rejectOutput) => {
    execFile(
      command,
      [...args],
      {
        cwd: options.cwd,
        signal: options.signal,
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
        ...(options.env ? { env: options.env } : {}),
      },
      (error, stdout, stderr) => {
        if (error) {
          rejectOutput(
            new Error(
              options.signal.aborted
                ? 'Git operation cancelled.'
                : stderr.trim() || stdout.trim() || error.message,
            ),
          );
          return;
        }
        resolveOutput(stdout.trim());
      },
    );
  });
}

function optionalGit(root: string, args: readonly string[]): string | null {
  try {
    return git(root, args) || null;
  } catch {
    return null;
  }
}

function baseRef(root: string): string | null {
  const originHead = optionalGit(root, [
    'symbolic-ref',
    '--quiet',
    '--short',
    'refs/remotes/origin/HEAD',
  ]);
  for (const candidate of [originHead, 'origin/main', 'main', 'master']) {
    if (candidate && optionalGit(root, ['rev-parse', '--verify', candidate])) return candidate;
  }
  return null;
}

function commitCounts(
  root: string,
  comparisonRef: string | null,
): { behind: number | null; ahead: number | null } {
  if (!comparisonRef) return { behind: null, ahead: null };
  const counts = optionalGit(root, [
    'rev-list',
    '--left-right',
    '--count',
    `${comparisonRef}...HEAD`,
  ])
    ?.split(/\s+/)
    .map(Number);
  return {
    behind: counts && Number.isInteger(counts[0]) ? counts[0]! : null,
    ahead: counts && Number.isInteger(counts[1]) ? counts[1]! : null,
  };
}

function changedPaths(root: string): GitChangedPath[] {
  const raw = gitRaw(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (!raw) return [];
  const records = raw.split('\0');
  const changed: GitChangedPath[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.length < 4) continue;
    const status = record.slice(0, 2);
    changed.push({ path: record.slice(3), index: status[0]!, worktree: status[1]! });
    if (status.includes('R') || status.includes('C')) index += 1;
  }
  return changed;
}

function parseDiffHunks(path: string, staged: boolean, patch: string): GitDiffHunk[] {
  if (!patch || patch.includes('GIT binary patch') || patch.includes('Binary files ')) return [];
  const lines = patch.split(/(?<=\n)/);
  const firstHunk = lines.findIndex((line) => line.startsWith('@@ '));
  if (firstHunk === -1) return [];
  const fileHeader = lines.slice(0, firstHunk).join('');
  const chunks: string[] = [];
  let current = '';
  for (const line of lines.slice(firstHunk)) {
    if (line.startsWith('@@ ') && current) chunks.push(current);
    current += line;
  }
  if (current) chunks.push(current);
  return chunks.map((chunk) => {
    const header = chunk.split(/\r?\n/, 1)[0] ?? '@@';
    const additions = chunk.split(/\r?\n/).filter((line) => line.startsWith('+')).length;
    const deletions = chunk.split(/\r?\n/).filter((line) => line.startsWith('-')).length;
    return {
      id: createHash('sha256')
        .update(`${path}\0${staged ? 'staged' : 'unstaged'}\0${fileHeader}${chunk}`)
        .digest('base64url')
        .slice(0, 24),
      path,
      staged,
      header,
      additions,
      deletions,
    };
  });
}

function diffPatch(root: string, path: string, staged: boolean): string {
  return gitRaw(root, [
    'diff',
    '--no-ext-diff',
    '--no-color',
    '--unified=3',
    ...(staged ? ['--cached'] : []),
    '--',
    path,
  ]);
}

function diffHunks(root: string, changed: readonly GitChangedPath[]): GitDiffHunk[] {
  return changed.flatMap((entry) => [
    ...parseDiffHunks(entry.path, false, diffPatch(root, entry.path, false)),
    ...parseDiffHunks(entry.path, true, diffPatch(root, entry.path, true)),
  ]);
}

function gitHistory(root: string): GitHistoryCommit[] {
  const output = optionalGit(root, ['log', '-30', '--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e']);
  if (!output) return [];
  return output
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .flatMap((record): GitHistoryCommit[] => {
      const [sha, shortSha, author, authoredAt, subject] = record.split('\x1f');
      return sha && shortSha && author && authoredAt && subject
        ? [{ sha, shortSha, author, authoredAt, subject }]
        : [];
    });
}

function gitConflictState(root: string): { conflicts: string[]; rebaseInProgress: boolean } {
  const gitPath = (name: string) => optionalGit(root, ['rev-parse', '--git-path', name]);
  return {
    conflicts:
      optionalGit(root, ['diff', '--name-only', '--diff-filter=U'])
        ?.split(/\r?\n/)
        .filter(Boolean) ?? [],
    rebaseInProgress: ['rebase-merge', 'rebase-apply'].some((name) => {
      const path = gitPath(name);
      return Boolean(path && existsSync(isAbsolute(path) ? path : resolve(root, path)));
    }),
  };
}

export function gitWorkflowStatus(projectRoot: string): GitWorkflowStatus {
  const identity = resolveWorktreeIdentity(projectRoot);
  const available = identity.headCommit !== null;
  if (!available) {
    return {
      available,
      ...identity,
      baseRef: null,
      upstream: null,
      remoteUrl: null,
      dirty: false,
      ahead: null,
      behind: null,
      baseAhead: null,
      baseBehind: null,
      changed: [],
      hunks: [],
      history: [],
      conflicts: [],
      rebaseInProgress: false,
      github: false,
    };
  }
  const upstream = optionalGit(identity.worktreeRoot, [
    'rev-parse',
    '--abbrev-ref',
    '--symbolic-full-name',
    '@{upstream}',
  ]);
  const resolvedBaseRef = baseRef(identity.worktreeRoot);
  const upstreamCounts = commitCounts(identity.worktreeRoot, upstream);
  const baseCounts = commitCounts(identity.worktreeRoot, resolvedBaseRef);
  const changed = changedPaths(identity.worktreeRoot);
  const conflictState = gitConflictState(identity.worktreeRoot);
  const remoteUrl = optionalGit(identity.worktreeRoot, ['config', '--get', 'remote.origin.url']);
  return {
    available,
    ...identity,
    baseRef: resolvedBaseRef,
    upstream,
    remoteUrl,
    dirty: changed.length > 0,
    behind: upstreamCounts.behind,
    ahead: upstreamCounts.ahead,
    baseBehind: baseCounts.behind,
    baseAhead: baseCounts.ahead,
    changed,
    hunks: diffHunks(identity.worktreeRoot, changed),
    history: gitHistory(identity.worktreeRoot),
    ...conflictState,
    github: Boolean(remoteUrl && /(?:^|[.@/:])github\.com(?::|\/)/i.test(remoteUrl)),
  };
}

function hunkPatch(root: string, path: string, staged: boolean, id: string): string {
  const patch = diffPatch(root, path, staged);
  const lines = patch.split(/(?<=\n)/);
  const firstHunk = lines.findIndex((line) => line.startsWith('@@ '));
  if (firstHunk === -1) throw new Error('That diff hunk no longer exists. Refresh Git status.');
  const fileHeader = lines.slice(0, firstHunk).join('');
  let current = '';
  const chunks: string[] = [];
  for (const line of lines.slice(firstHunk)) {
    if (line.startsWith('@@ ') && current) chunks.push(current);
    current += line;
  }
  if (current) chunks.push(current);
  const match = chunks.find((chunk) => {
    const candidate = createHash('sha256')
      .update(`${path}\0${staged ? 'staged' : 'unstaged'}\0${fileHeader}${chunk}`)
      .digest('base64url')
      .slice(0, 24);
    return candidate === id;
  });
  if (!match) throw new Error('That diff hunk changed. Refresh Git status before staging it.');
  return `${fileHeader}${match}`;
}

export function stageGitSelection(
  projectRoot: string,
  input: { path: string; hunkId?: string; staged: boolean },
): GitWorkflowStatus {
  const status = gitWorkflowStatus(projectRoot);
  const path = confinedSelection(status, [input.path])[0]!;
  if (input.hunkId) {
    const patch = hunkPatch(status.worktreeRoot, path, input.staged, input.hunkId);
    gitInput(
      status.worktreeRoot,
      ['apply', '--cached', ...(input.staged ? ['--reverse'] : []), '--'],
      patch,
    );
  } else if (input.staged) {
    git(status.worktreeRoot, ['restore', '--staged', '--', path]);
  } else {
    git(status.worktreeRoot, ['add', '--', path]);
  }
  return gitWorkflowStatus(projectRoot);
}

export async function fetchGitRemotesAsync(
  projectRoot: string,
  signal: AbortSignal,
): Promise<GitWorkflowStatus> {
  const status = gitWorkflowStatus(projectRoot);
  if (!status.remoteUrl) throw new Error('No origin remote is configured.');
  await commandAsync('git', ['fetch', '--prune', 'origin'], {
    cwd: status.worktreeRoot,
    signal,
  });
  return gitWorkflowStatus(projectRoot);
}

export function resolveGitRebase(
  projectRoot: string,
  action: 'continue' | 'abort',
): GitWorkflowStatus {
  const status = gitWorkflowStatus(projectRoot);
  if (!status.rebaseInProgress) throw new Error('No rebase is in progress.');
  if (action === 'continue') {
    if (status.conflicts.length > 0) throw new Error('Resolve and stage every conflict first.');
    try {
      execFileSync('git', ['-C', status.worktreeRoot, 'rebase', '--continue'], {
        encoding: 'utf8',
        env: { ...process.env, GIT_EDITOR: 'true' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      const detail = (error as { stderr?: string | Buffer }).stderr;
      throw new Error(
        (typeof detail === 'string' ? detail : detail?.toString())?.trim() ||
          'Could not continue the rebase.',
      );
    }
  } else {
    git(status.worktreeRoot, ['rebase', '--abort']);
  }
  return gitWorkflowStatus(projectRoot);
}

function confinedSelection(status: GitWorkflowStatus, paths: readonly string[]): string[] {
  if (paths.length === 0 || paths.length > 100) throw new Error('Select 1 through 100 paths.');
  const dirty = new Set(status.changed.map((entry) => entry.path));
  const selected = [...new Set(paths)];
  for (const path of selected) {
    if (!isContainedRelativePath(path) || !dirty.has(path)) {
      throw new Error(`Cannot checkpoint path outside the current Git changes: ${path}`);
    }
  }
  return selected;
}

export function checkpointGitChanges(
  projectRoot: string,
  input: {
    paths: readonly string[];
    message: string;
    author: { participantId: string; accountId: string; email: string; name: string };
  },
): GitWorkflowStatus {
  const status = gitWorkflowStatus(projectRoot);
  if (!status.available || !status.branch) throw new Error('Checkpoint requires a Git branch.');
  const message = input.message.trim();
  if (!message || message.length > 200) throw new Error('Commit message must be 1–200 characters.');
  const selected = confinedSelection(status, input.paths);
  const staged = optionalGit(status.worktreeRoot, ['diff', '--cached', '--name-only', '-z'])
    ?.split('\0')
    .filter(Boolean);
  const selectedSet = new Set(selected);
  const unrelated = staged?.filter((path) => !selectedSet.has(path)) ?? [];
  if (unrelated.length > 0) {
    throw new Error(`Refusing to include already-staged unrelated paths: ${unrelated.join(', ')}`);
  }
  const stagedSet = new Set(staged ?? []);
  const unstagedSelections = selected.filter((path) => !stagedSet.has(path));
  if (unstagedSelections.length > 0) {
    git(status.worktreeRoot, ['add', '--', ...unstagedSelections]);
  }
  const stagedAfter = optionalGit(status.worktreeRoot, ['diff', '--cached', '--name-only', '-z'])
    ?.split('\0')
    .filter(Boolean);
  if (!stagedAfter || stagedAfter.length === 0) throw new Error('No selected changes are staged.');
  git(status.worktreeRoot, [
    'commit',
    '-m',
    message,
    '-m',
    `VGAI-Participant: ${input.author.participantId}\nVGAI-Account: ${input.author.accountId}`,
    `--author=${input.author.name} <${input.author.email}>`,
  ]);
  return gitWorkflowStatus(projectRoot);
}

export async function publishGitBranchAsync(
  projectRoot: string,
  signal: AbortSignal,
): Promise<GitWorkflowStatus> {
  const status = gitWorkflowStatus(projectRoot);
  if (!status.available || !status.branch) throw new Error('Publish requires a named Git branch.');
  if (!status.remoteUrl) throw new Error('No origin remote is configured; use Git directly.');
  await commandAsync('git', ['push', '--set-upstream', 'origin', status.branch], {
    cwd: status.worktreeRoot,
    signal,
  });
  return gitWorkflowStatus(projectRoot);
}

export function createGitPullRequest(
  projectRoot: string,
  input: { title: string; body?: string },
): { url: string; status: GitWorkflowStatus } {
  const status = gitWorkflowStatus(projectRoot);
  if (!status.github)
    throw new Error('Pull-request creation is available only for GitHub remotes.');
  if (!status.upstream) throw new Error('Publish the branch before creating a pull request.');
  const title = input.title.trim();
  if (!title || title.length > 200) throw new Error('PR title must be 1–200 characters.');
  const args = ['pr', 'create', '--title', title, '--body', (input.body ?? '').slice(0, 20_000)];
  if (status.baseRef) args.push('--base', status.baseRef.replace(/^origin\//, ''));
  const url = execFileSync('gh', args, {
    cwd: status.worktreeRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  return { url, status: gitWorkflowStatus(projectRoot) };
}

export async function mergeGitPullRequestAsync(
  projectRoot: string,
  signal: AbortSignal,
): Promise<{ url: string; merged: boolean }> {
  const readiness = validateGitMergeReadiness(projectRoot);
  if (!readiness.ready) throw new Error(readiness.reasons.join(' '));
  const pullRequest = gitPullRequestStatus(projectRoot);
  if (!pullRequest.available || !pullRequest.url) {
    throw new Error(pullRequest.reason ?? 'No pull request is available.');
  }
  if (pullRequest.draft) throw new Error('Mark the pull request ready before merging it.');
  if ((pullRequest.checks?.failed ?? 0) > 0 || (pullRequest.checks?.pending ?? 0) > 0) {
    throw new Error('Pull-request checks must pass before merge.');
  }
  if (pullRequest.reviewDecision === 'CHANGES_REQUESTED') {
    throw new Error('Requested review changes must be resolved before merge.');
  }
  await commandAsync('gh', ['pr', 'merge', '--merge'], {
    cwd: readiness.status.worktreeRoot,
    signal,
  });
  return { url: pullRequest.url, merged: true };
}

export function gitPullRequestStatus(projectRoot: string): {
  available: boolean;
  url?: string;
  state?: string;
  draft?: boolean;
  mergeState?: string;
  reviewDecision?: string;
  checks?: { total: number; pending: number; failed: number; passed: number };
  reason?: string;
} {
  const status = gitWorkflowStatus(projectRoot);
  if (!status.github) return { available: false, reason: 'The origin remote is not GitHub.' };
  if (!status.upstream) return { available: false, reason: 'Publish the branch first.' };
  try {
    const raw = execFileSync(
      'gh',
      [
        'pr',
        'view',
        '--json',
        'url,state,isDraft,mergeStateStatus,reviewDecision,statusCheckRollup',
      ],
      {
        cwd: status.worktreeRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const value = JSON.parse(raw) as {
      url?: unknown;
      state?: unknown;
      isDraft?: unknown;
      mergeStateStatus?: unknown;
      reviewDecision?: unknown;
      statusCheckRollup?: unknown;
    };
    const rollup = Array.isArray(value.statusCheckRollup)
      ? (value.statusCheckRollup as Array<Record<string, unknown>>)
      : [];
    const conclusions = rollup.map((check) =>
      typeof check['conclusion'] === 'string'
        ? check['conclusion'].toUpperCase()
        : typeof check['state'] === 'string'
          ? check['state'].toUpperCase()
          : typeof check['status'] === 'string'
            ? check['status'].toUpperCase()
            : '',
    );
    const failedStates = new Set(['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED']);
    const passedStates = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
    return {
      available: true,
      ...(typeof value.url === 'string' ? { url: value.url } : {}),
      ...(typeof value.state === 'string' ? { state: value.state } : {}),
      ...(typeof value.isDraft === 'boolean' ? { draft: value.isDraft } : {}),
      ...(typeof value.mergeStateStatus === 'string' ? { mergeState: value.mergeStateStatus } : {}),
      ...(typeof value.reviewDecision === 'string' ? { reviewDecision: value.reviewDecision } : {}),
      checks: {
        total: conclusions.length,
        failed: conclusions.filter((state) => failedStates.has(state)).length,
        passed: conclusions.filter((state) => passedStates.has(state)).length,
        pending: conclusions.filter((state) => !failedStates.has(state) && !passedStates.has(state))
          .length,
      },
    };
  } catch (error) {
    const detail = (error as { stderr?: string | Buffer }).stderr;
    return {
      available: false,
      reason:
        (typeof detail === 'string' ? detail : detail?.toString())?.trim() ||
        'No pull request was found, or the GitHub CLI is unavailable.',
    };
  }
}

export async function updateGitBranchAsync(
  projectRoot: string,
  signal: AbortSignal,
): Promise<GitWorkflowStatus> {
  const status = gitWorkflowStatus(projectRoot);
  if (!status.available || !status.branch || !status.baseRef) {
    throw new Error('Update requires a named branch and discoverable base branch.');
  }
  if (status.dirty) throw new Error('Checkpoint or clean this worktree before rebasing.');
  if (status.remoteUrl) {
    await commandAsync('git', ['fetch', '--prune', 'origin'], {
      cwd: status.worktreeRoot,
      signal,
    });
  }
  await commandAsync('git', ['rebase', status.baseRef], {
    cwd: status.worktreeRoot,
    signal,
    env: { ...process.env, GIT_EDITOR: 'true' },
  });
  return gitWorkflowStatus(projectRoot);
}

export function validateGitMergeReadiness(projectRoot: string): {
  ready: boolean;
  reasons: string[];
  validation: string | null;
  status: GitWorkflowStatus;
} {
  const status = gitWorkflowStatus(projectRoot);
  const reasons: string[] = [];
  if (!status.available || !status.branch) reasons.push('A named Git branch is required.');
  if (status.dirty) reasons.push('The worktree has uncheckpointed changes.');
  if (!status.upstream) reasons.push('The branch is not published.');
  if ((status.baseBehind ?? 0) > 0) {
    reasons.push(
      `The branch is ${status.baseBehind} commit(s) behind ${status.baseRef ?? 'its base'}.`,
    );
  }
  let validation: string | null = null;
  const packagePath = join(status.worktreeRoot, 'package.json');
  if (reasons.length === 0 && existsSync(packagePath)) {
    const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as {
      scripts?: Record<string, unknown>;
    };
    if (typeof pkg.scripts?.['validate-merge-integrity'] === 'string') {
      validation = execFileSync('npm', ['run', 'validate-merge-integrity'], {
        cwd: status.worktreeRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    }
  }
  return { ready: reasons.length === 0, reasons, validation, status };
}
