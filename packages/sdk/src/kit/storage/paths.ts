/**
 * Path helpers for storage backends. Paths are POSIX-style, root-relative,
 * '/'-separated, with no leading/trailing slashes.
 */

/** Split a path into non-empty segments, collapsing `.` and redundant slashes. */
export function segments(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0 && s !== '.');
}

/** Normalize to a canonical root-relative path (`''` for the root). */
export function normalize(path: string): string {
  return segments(path).join('/');
}

/** Split into `[parentDir, baseName]`. Root entries have `parent === ''`. */
export function dirAndBase(path: string): [string, string] {
  const segs = segments(path);
  const base = segs.pop() ?? '';
  return [segs.join('/'), base];
}

/** Join path parts into a normalized path. */
export function join(...parts: string[]): string {
  return normalize(parts.join('/'));
}
