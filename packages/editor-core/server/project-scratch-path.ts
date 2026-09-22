import path from 'node:path';

/** Scratch belongs to its project, not to the project a study may be opened in. */
export function isProjectScratchPath(filename: string, roots: Iterable<string>): boolean {
  const file = path.resolve(filename);
  let owner = '';
  for (const candidate of roots) {
    const root = path.resolve(candidate);
    if (root.length > owner.length && (file === root || file.startsWith(root + path.sep))) {
      owner = root;
    }
  }
  if (!owner) return false;
  const [directory, child] = path.relative(owner, file).split(path.sep);
  return directory === '.vgai' && child === 'tmp';
}

/**
 * An agent-workspace path that is NOT this server's own source.
 *
 * Agent/IDE worktrees and scratch live under `<checkout>/.claude/`, and Vite
 * full-reloads every connected tab when a file under its root changes — so one
 * agent's worktree churn was reloading every OTHER editor served from the
 * checkout (a tab kicked mid-boot). Hence the ignore. But a server can also BE
 * served FROM one of those worktrees, and the path-shaped ignore (`.claude/**`)
 * could not tell the two apart: it swallowed the worktree's own source, so that
 * editor silently stopped watching the very files it serves. MEASURED
 * 2026-09-18: an edit to `editor-chrome-capture.ts` in an agent worktree never
 * reached the page — the dev server transformed the new module on request while
 * the tab kept running the old one, with nothing reporting a problem, and the
 * only way to see a source edit was to restart the session.
 *
 * The discriminator is OWNERSHIP, not the path's shape: a file inside
 * `serverRoot` whose path below that root holds no `.claude` segment is the
 * server's own source and is watched. Everything else under a `.claude`
 * directory — a sibling worktree, the checkout's own agent scratch, this
 * worktree's `.claude/` — is ignored exactly as before, so a server rooted at
 * the checkout itself keeps today's behaviour for every path.
 */
export function isForeignAgentPath(filename: string, serverRoot: string): boolean {
  const file = path.resolve(filename);
  const segments = file.split(path.sep);
  if (!segments.includes('.claude')) return false;
  const root = path.resolve(serverRoot);
  if (file !== root && !file.startsWith(root + path.sep)) return true;
  return path.relative(root, file).split(path.sep).includes('.claude');
}
