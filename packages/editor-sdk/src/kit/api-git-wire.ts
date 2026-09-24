/**
 * The git-workflow wire — the status shape `/__editor/git/*` answers with,
 * declared ONCE in a leaf module both sides import (the browser client in
 * `../share-control-client.ts`, the producing `../../server/git-workflow.ts`).
 * Import-free so the server's tsconfig can reach it without the client's
 * module graph. The share wire next door (`@volter/editor-sdk/share`) had this
 * fix applied first; the git wire in the same panel had been re-spelled
 * inline, twenty lines below the header describing that fix.
 */

export interface GitChangedPath {
  path: string;
  index: string;
  worktree: string;
}

export interface GitDiffHunk {
  id: string;
  path: string;
  staged: boolean;
  header: string;
  additions: number;
  deletions: number;
}

export interface GitHistoryCommit {
  sha: string;
  shortSha: string;
  author: string;
  authoredAt: string;
  subject: string;
}

export interface GitWorkflowStatus {
  available: boolean;
  repositoryId: string;
  worktreeId: string;
  worktreeRoot: string;
  projectRelativePath: string;
  branch: string | null;
  headCommit: string | null;
  baseRef: string | null;
  upstream: string | null;
  remoteUrl: string | null;
  dirty: boolean;
  ahead: number | null;
  behind: number | null;
  baseAhead: number | null;
  baseBehind: number | null;
  changed: GitChangedPath[];
  hunks: GitDiffHunk[];
  history: GitHistoryCommit[];
  conflicts: string[];
  rebaseInProgress: boolean;
  github: boolean;
}
