/**
 * `git init` + one initial commit for a freshly scaffolded project.
 *
 * WHY THIS EXISTS. Nothing used to initialize git in a scaffold — not the
 * scaffolder, not either CLI — so every new game started without history, and
 * the whole commit-discipline layer a scaffolded project ships with was
 * silently inert in the default environment: the template's own
 * `check-idioms.ts` rule W9 opens with `git rev-parse --is-inside-work-tree`
 * and goes QUIET when the answer is no, and "author in playable slices" has nothing to
 * measure without commits. Those tripwires only work if git exists from
 * minute one.
 *
 * WHY IT IS NOT IN `scaffoldProject`. The scaffold library is called directly
 * by the scaffold-typecheck gate, by probe harnesses, and by the editor
 * dev-server's create-project route — paths that want a cheap, side-effect-free
 * tree on disk and no child processes. So the init belongs to the CREATE
 * COMMANDS — a product's `create` (`game-editor create`, `model-editor
 * create`), which is where a human/agent actually starts a project. Every one
 * of them calls this one function, so the paths cannot drift.
 *
 * EVERY FAILURE IS NON-FATAL. A scaffold that exists but has no history is
 * still a usable project; refusing to finish `create` over it would be a far
 * worse outcome than one printed line. So each outcome carries its own
 * `notice` — the single info line the caller prints — and nothing here
 * throws.
 */

import { spawnSync } from 'node:child_process';

/** What `initGitRepo` did, plus the one line the caller prints about it. */
export type GitInitResult = {
  readonly status: 'initialized' | 'skipped' | 'failed';
  /** Why, for `skipped`/`failed`. Stable identifiers, not prose. */
  readonly reason?: 'git-unavailable' | 'already-in-repo' | 'git-command-failed';
  /** The ONE info line to print. Never empty. */
  readonly notice: string;
};

interface GitRun {
  /** `null` when git never ran (spawn failed). */
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** The `git` binary is not on PATH. */
  readonly unavailable: boolean;
}

function runGit(cwd: string, args: string[]): GitRun {
  const result = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  if (result.error) {
    // ENOENT from spawnSync means the BINARY was not found (the cwd here is a
    // directory this process just scaffolded, so it exists by construction).
    const code = (result.error as NodeJS.ErrnoException).code;
    return { status: null, stdout: '', stderr: '', unavailable: code === 'ENOENT' };
  }
  return {
    status: result.status,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
    unavailable: false,
  };
}

/**
 * Is a committer identity configured (any scope) for a commit run in `cwd`?
 *
 * `git commit` fails outright when it cannot name an author, which on a fresh
 * machine — a CI image, a container, a brand-new laptop — is the common case,
 * and that failure would land on someone who never asked for a commit. So the
 * caller supplies a neutral fallback identity for exactly that case, and ONLY
 * that case: an author the user configured is never overridden.
 */
function hasCommitterIdentity(cwd: string): boolean {
  const name = runGit(cwd, ['config', '--get', 'user.name']);
  const email = runGit(cwd, ['config', '--get', 'user.email']);
  return name.status === 0 && name.stdout !== '' && email.status === 0 && email.stdout !== '';
}

/**
 * Initialize `targetDir` as a git repository and record the whole scaffold as
 * one `scaffold <projectName>` commit.
 *
 * Skips silently (with a notice) when git is not on PATH, or when the target
 * is already inside a work tree — scaffolding into an existing repository is a
 * legitimate thing to do (an example folder inside a monorepo, a games/
 * directory under version control), and a nested repository there would be a
 * surprise, not a service.
 */
export function initGitRepo(targetDir: string, projectName: string): GitInitResult {
  const insideWorkTree = runGit(targetDir, ['rev-parse', '--is-inside-work-tree']);
  if (insideWorkTree.unavailable) {
    return {
      status: 'skipped',
      reason: 'git-unavailable',
      notice: 'Skipped git init — git is not on PATH.',
    };
  }
  if (insideWorkTree.status === 0 && insideWorkTree.stdout === 'true') {
    return {
      status: 'skipped',
      reason: 'already-in-repo',
      notice: 'Skipped git init — the project is already inside a git work tree.',
    };
  }

  // Read the identity BEFORE `git init`, so the answer is the user's real
  // global/system configuration and not something the fresh repo introduced.
  const authorFallback = hasCommitterIdentity(targetDir)
    ? []
    : ['-c', 'user.name=vgai', '-c', 'user.email=scaffold@vgai'];

  const steps: Array<{ label: string; args: string[] }> = [
    { label: 'git init', args: ['init', '--quiet'] },
    { label: 'git add', args: ['add', '-A'] },
    {
      label: 'git commit',
      args: [...authorFallback, 'commit', '--quiet', '-m', `scaffold ${projectName}`],
    },
  ];
  for (const step of steps) {
    const run = runGit(targetDir, step.args);
    if (run.status !== 0) {
      const detail = run.stderr !== '' ? run.stderr.split('\n')[0] : `exit ${run.status ?? 'null'}`;
      return {
        status: 'failed',
        reason: 'git-command-failed',
        notice: `Skipped git init — ${step.label} failed: ${detail}`,
      };
    }
  }

  return {
    status: 'initialized',
    notice: `Initialized a git repository — one commit: "scaffold ${projectName}".`,
  };
}
