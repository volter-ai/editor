/**
 * What code is this editor session actually serving?
 *
 * Measured defect (2026-08-09): a user's editor server came from an engine
 * checkout parked on a dead feature branch, 162 commits behind `origin/main`.
 * Three fixes that had already merged were simply absent from the running
 * editor, and hours went into debugging their absence as live bugs — because
 * NOTHING in the product reported which commit was being served. The URL, the
 * project name, the session id and the engine's npm version were all correct
 * and all useless for that question.
 *
 * So the server computes its own checkout's git provenance and reports it
 * everywhere a human or an agent looks: the `/__editor/project` payload, the
 * server's own startup banner, `vgai edit`'s ready line, and `vgai status`.
 *
 * Two rules this module exists to hold:
 *
 * - **Report, never refuse.** A stale checkout still serves. Nothing here
 *   gates, delays, or fails a boot; every field degrades to `null` on any
 *   error (no git, not a repo, no `origin/main` ref) and the line still
 *   prints.
 * - **Never touch the network.** `behindOriginMain` is measured against the
 *   LOCAL `origin/main` ref only. A fetch here would make every editor boot
 *   depend on a remote being reachable, which is exactly the kind of
 *   always-on dependency a diagnostic must not introduce. The number is
 *   therefore "behind the last main you fetched", and that is still the
 *   number that would have caught the 162-commit case.
 */

import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface EngineProvenance {
  /** Current branch, or `null` when detached / unknown. */
  branch: string | null;
  /** Short HEAD commit, or `null` when unknown. */
  commit: string | null;
  /** Commits on the LOCAL `origin/main` ref that HEAD does not have. */
  behindOriginMain: number | null;
  /** Tracked-file modifications in the working tree. */
  dirty: boolean | null;
}

export const UNKNOWN_ENGINE_PROVENANCE: EngineProvenance = {
  branch: null,
  commit: null,
  behindOriginMain: null,
  dirty: null,
};

/**
 * Runs `git <args>` in the engine checkout. Returns trimmed stdout on success
 * — `''` is a legitimate success (a clean `git status --porcelain`) and must
 * stay distinguishable from failure, which is `null`.
 */
export type GitRunner = (args: readonly string[]) => Promise<string | null>;

export function createGitRunner(cwd: string): GitRunner {
  return async (args) => {
    try {
      const { stdout } = await execFileAsync('git', args, {
        cwd,
        encoding: 'utf8',
        timeout: 5_000,
        maxBuffer: 1024 * 1024,
      });
      return stdout.trim();
    } catch {
      return null;
    }
  };
}

function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/**
 * `engineRoot` must BE the repository git discovers, not merely live inside
 * one. A registry-installed editor sits at `<game>/node_modules/@vgai/editor`,
 * where `rev-parse --show-toplevel` happily answers with the GAME's repo — and
 * reporting the game's branch under the word "engine" is worse than reporting
 * nothing. Mismatch therefore degrades to all-null, the same as no git at all.
 */
export async function computeEngineProvenance(
  engineRoot: string,
  run: GitRunner,
): Promise<EngineProvenance> {
  const toplevel = await run(['rev-parse', '--show-toplevel']);
  if (toplevel === null || toplevel === '') return UNKNOWN_ENGINE_PROVENANCE;
  if (canonical(toplevel) !== canonical(engineRoot)) return UNKNOWN_ENGINE_PROVENANCE;

  const [rawBranch, commit, rawBehind, rawStatus] = await Promise.all([
    run(['rev-parse', '--abbrev-ref', 'HEAD']),
    run(['rev-parse', '--short', 'HEAD']),
    run(['rev-list', '--count', 'HEAD..origin/main']),
    run(['status', '--porcelain', '--untracked-files=no']),
  ]);

  // Detached HEAD answers the literal string `HEAD`, which would print as
  // `engine: HEAD @ abc1234`. That is a branch name nobody has.
  const branch = rawBranch === null || rawBranch === '' || rawBranch === 'HEAD' ? null : rawBranch;
  const behind = rawBehind === null ? Number.NaN : Number.parseInt(rawBehind, 10);

  return {
    branch,
    commit: commit === null || commit === '' ? null : commit,
    behindOriginMain: Number.isFinite(behind) ? behind : null,
    dirty: rawStatus === null ? null : rawStatus !== '',
  };
}

/**
 * One provenance read per engine checkout per process. The value is stable for
 * a server's lifetime: changing engine source restarts the server
 * (`engine-source-restart.ts`), so there is nothing to invalidate. Keyed by
 * root rather than module-global so a test — or a process hosting two roots —
 * cannot poison another's answer.
 */
const cache = new Map<string, Promise<EngineProvenance>>();

export function engineProvenance(engineRoot: string, run?: GitRunner): Promise<EngineProvenance> {
  const key = canonical(engineRoot);
  const cached = cache.get(key);
  if (cached) return cached;
  // Never let a rejection escape into a boot path or an HTTP handler.
  const pending = computeEngineProvenance(engineRoot, run ?? createGitRunner(key)).catch(
    () => UNKNOWN_ENGINE_PROVENANCE,
  );
  cache.set(key, pending);
  return pending;
}

/**
 * The ONE wording. The server banner, `vgai edit` and `vgai status` all print
 * this exact string, so a reader comparing two surfaces is never left deciding
 * whether they disagree or are merely phrased differently.
 */
export function formatEngineProvenanceLine(provenance: EngineProvenance | null): string {
  if (
    provenance === null ||
    (provenance.branch === null &&
      provenance.commit === null &&
      provenance.behindOriginMain === null &&
      provenance.dirty === null)
  ) {
    return 'engine: provenance unavailable';
  }
  const branch = provenance.branch ?? 'detached';
  const commit = provenance.commit ?? 'unknown commit';
  const behind =
    provenance.behindOriginMain === null
      ? 'distance from origin/main unknown'
      : `${provenance.behindOriginMain} behind origin/main`;
  const dirty = provenance.dirty === true ? ' [dirty]' : '';
  const stale =
    provenance.behindOriginMain !== null && provenance.behindOriginMain > 0
      ? ' — STALE: fixes merged to main are not running here'
      : '';
  return `engine: ${branch} @ ${commit} (${behind})${dirty}${stale}`;
}
