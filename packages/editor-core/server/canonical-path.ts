/**
 * Canonicalize a project root path (T6.2 slice 3 finding; reported in the
 * slice-3 "Report back").
 *
 * Vite's own module resolver calls `fs.realpathSync` when resolving a
 * STATIC relative import — e.g. a react world's entry module's own
 * `import { useWorldState } from '@vgai/game-runtime/react/world-state'` — which
 * collapses a symlinked path segment (macOS's `/var` -> `/private/var`,
 * hit by every project scaffolded under `os.tmpdir()`, as every e2e spec
 * that calls `scaffoldProject()` does) to its real form.
 * `binding-resolver.ts`'s hand-built `/@fs/${projectRoot}/...` dynamic-import
 * strings (which must bypass Vite's static analysis via `@vite-ignore` — the
 * path is only known at runtime) do NOT go through that same resolution. So
 * if `projectRoot` itself isn't already canonical, two DIFFERENT `/@fs/`
 * URLs get produced for the exact same file: Vite's realpath'd rewrite of
 * the entry module's own relative import vs. our raw, non-realpath'd string
 * used to import `WorldProvider` for the `<WorldProvider>` wrap. Browser ES
 * module identity is per-URL, so the SAME `game-state.tsx` loads as TWO
 * separate module instances with TWO separate top-level `createContext()`
 * calls — `useWorldState`'s `useGame()` then throws "no Game in context"
 * even though `<WorldProvider>` genuinely wraps the entry (this is exactly
 * what the T6.2 slice-3 AC e2e's first real-browser run of a react world
 * caught).
 *
 * The fix is upstream of any one `/@fs/` string: canonicalize the project
 * root ONCE, at the points a project path enters server state (dev/prod
 * boot from `VGAI_PROJECT`, and the `/__editor/open-project` route) — every
 * `/@fs/${projectRoot}` string built anywhere afterwards (browser-side,
 * repo-wide, not just the react-world resolver) then already matches
 * whatever Vite's own resolver would independently arrive at for that same
 * project.
 */
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Resolve `rawPath` to an absolute, symlink-canonicalized path. Falls back to
 * a plain `path.resolve` if the path doesn't exist yet or `realpathSync`
 * otherwise fails (e.g. a permissions error) — never throws, so a bad/odd
 * path degrades to today's pre-canonicalization behavior rather than
 * blocking project open.
 */
export function canonicalProjectRoot(rawPath: string): string {
  const absolute = resolve(rawPath);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}
