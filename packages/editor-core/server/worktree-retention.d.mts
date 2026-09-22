export function registerTaskWorktree(
  repo: string,
  target: string,
  owner: string,
  branch: string,
): void;
export function markTaskWorktreeCreated(repo: string, target: string): void;
export function finishTaskWorktree(
  repo: string,
  target: string,
  options?: { owner?: string; mergedInto?: string; consumersRetired?: boolean },
): void;
export function removeArchivedWorktree(repo: string, target: string): void;
