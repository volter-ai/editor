/**
 * THE spelling of "this string is a project-relative path that cannot escape
 * its root". One helper, because the codebase had four incompatible ones and
 * the weakest of them was load-bearing on a write route.
 *
 * What each of the four missed, and why a single predicate is the fix:
 *
 * - `path.includes('..')` (substring) is both too weak and too strong: it
 *   rejects the innocent `my..file.glb` while accepting nothing extra — but
 *   its real defect is that it says NOTHING about an ABSOLUTE path. A route
 *   that then does `resolve(root, 'public', filePath)` gets `filePath` back
 *   verbatim when it is absolute (that is `resolve`'s contract), so the write
 *   destination was never inside `root` at all and no `..` ever appeared.
 * - `rel.startsWith('..')` false-negatives on a real directory named `..bak`.
 * - `path.split('/').includes('..')` misses `a\..\b` on a Windows-shaped
 *   input; `path.split(/[\\/]/)` is the form that covers both.
 * - none of them rejected a NUL byte or a `C:`-rooted path.
 *
 * Isomorphic on purpose — no `node:path` — so the browser-side resolver
 * (`binding-resolver.ts`'s `guardModulePath`) and the Node-side route handlers
 * enforce the SAME rule instead of two hand-rolled approximations of it. Its
 * Node-side partner is `server/server-utils.ts`'s `isPathInside`, which
 * answers the other half of the question (does the RESOLVED absolute path
 * still land under the root); a write boundary wants both, because this one
 * cannot see symlinks and that one cannot see intent.
 */

/** Why a candidate path is not a contained project-relative path. */
export type RelativePathRejection = 'empty' | 'nul' | 'absolute' | 'traversal';

/**
 * `null` when `path` is a safe project-relative path, otherwise the reason it
 * is not. Callers that want a bespoke error message (see `guardModulePath`)
 * switch on the reason; callers that only gate switch on
 * {@link isContainedRelativePath}.
 */
export function relativePathRejection(path: string): RelativePathRejection | null {
  if (!path || path.trim() === '') return 'empty';
  if (path.includes('\0')) return 'nul';
  // Leading separator (POSIX absolute, UNC) or a Windows drive root. This is
  // the case a `..` scan structurally cannot see.
  // The drive form is `C:/…` / `C:\…` specifically — a POSIX file literally
  // named `C:notes.txt` is relative and stays legal.
  if (path.startsWith('/') || path.startsWith('\\') || /^[a-zA-Z]:[\\/]/.test(path)) {
    return 'absolute';
  }
  // Segment-wise, over BOTH separators — `..bak` is a legitimate directory
  // name and must survive; `a\..\b` must not.
  if (path.split(/[\\/]/).includes('..')) return 'traversal';
  return null;
}

/** True when `path` is a non-empty, relative, traversal-free project path. */
export function isContainedRelativePath(path: string): boolean {
  return relativePathRejection(path) === null;
}
