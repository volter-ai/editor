/**
 * Where `GameClient.screenshot(x)` actually writes.
 *
 * WHY THIS IS ITS OWN MODULE (measured 2026-08-02, live session):
 * `game.screenshot('.vgai/tmp/dragon/play-live.png')` — driven through
 * `volter-game-editor eval`, the documented general door onto a running game — reported
 * success and left NOTHING at the path the caller named. The argument was
 * being read as a LABEL and run through `sanitizeLabel`, so the bytes landed
 * at `<project>/.vgai/last-run/001--vgai-tmp-dragon-play-live-png.png`.
 * Both artifacts are still on disk in the reproduction project. A call that
 * reports success while the file the caller asked for does not exist is
 * fabricated evidence — the exact failure mode `volter-game-editor screenshot` was built to
 * prevent, reintroduced one layer down.
 *
 * The fix is to honour what the caller wrote. A LABEL ("waitfor-timeout") is
 * a bare identifier: it keeps the numbered-artifact behaviour every run
 * depends on. A PATH (anything with a separator, or any name carrying a file
 * extension) is a destination: it is written EXACTLY there, relative paths
 * resolved against the process cwd — the same rule `volter-game-editor screenshot --out`
 * already documents.
 */

import { isAbsolute, relative, resolve } from 'node:path';

/** A caller's argument, classified. */
export type ScreenshotArgKind = 'path' | 'label';

/**
 * PATH when the argument names a location: absolute, containing a `/` or `\`
 * separator, an explicit `./`-style relative prefix, or carrying a file
 * extension (`shot.png`). LABEL otherwise — the bare-identifier form specs
 * pass (`'waitfor-timeout'`, `'events-expect-failure'`).
 *
 * The extension rule is what makes `screenshot('frame.png')` land at
 * `./frame.png` instead of `.../001-frame-png.png`: a caller who typed an
 * extension asked for a file, not a caption.
 */
export function classifyScreenshotArg(arg: string): ScreenshotArgKind {
  if (arg === '') return 'label';
  if (isAbsolute(arg)) return 'path';
  if (arg.includes('/') || arg.includes('\\')) return 'path';
  if (/\.[a-zA-Z0-9]{1,8}$/.test(arg)) return 'path';
  return 'label';
}

/** Non-filename characters collapse to `-` for the label form. */
export function sanitizeScreenshotLabel(label: string): string {
  return label.replace(/[^a-zA-Z0-9-_]+/g, '-');
}

export interface ScreenshotTargetInput {
  /** The caller's argument — a label or a path (see {@link classifyScreenshotArg}). */
  readonly arg: string;
  /** Artifacts directory for the label form. */
  readonly artifactsDir: string;
  /** 1-based ordinal for the label form's `NNN-` prefix. */
  readonly sequence: number;
  /** Base for resolving a relative path/artifactsDir — the process cwd. */
  readonly cwd: string;
  /** The project root the dev server is SERVING, when it is known. Only used
   *  to say whether the destination lands under the file watcher — see
   *  {@link ScreenshotTarget.underWatchedProjectRoot}. */
  readonly projectRoot?: string | undefined;
}

export interface ScreenshotTarget {
  readonly kind: ScreenshotArgKind;
  /** Absolute destination. */
  readonly path: string;
  /** True when the caller's own ordinal was consumed (label form only), so a
   *  path-form call never perturbs the numbering of the artifacts around it. */
  readonly consumedSequence: boolean;
  /**
   * The served project root this destination falls under, when it does.
   *
   * The dev server watches the project root for source changes and its
   * `server.watch.ignored` list names build output only (`dist/`, `.vercel/`,
   * `logs/`, `.claude/worktrees/`) — nothing about capture output. So a PNG
   * written anywhere under the root goes through the watcher on every shot,
   * and the cost is not theoretical: measured ~3x slower frame rates while a
   * capture loop wrote under the project. This does not CHANGE where anything
   * is written; it lets the capture say what it costs
   * ({@link import('./capture-notes.js').describeCaptureCaveat}).
   */
  readonly underWatchedProjectRoot?: string;
}

/** Is `file` inside `root` (not merely sharing a path prefix)? */
function isUnder(root: string, file: string): boolean {
  const rel = relative(resolve(root), file);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/** The watched-root note, when the destination has one. */
function watchedRoot(
  path: string,
  projectRoot: string | undefined,
): { underWatchedProjectRoot: string } | Record<string, never> {
  if (projectRoot === undefined || projectRoot === '') return {};
  return isUnder(projectRoot, path) ? { underWatchedProjectRoot: resolve(projectRoot) } : {};
}

/**
 * Resolve the absolute file a screenshot call must write. Pure — no I/O, no
 * `process.cwd()` read — so the contract above is testable without a browser,
 * a session, or a filesystem.
 */
export function resolveScreenshotTarget(input: ScreenshotTargetInput): ScreenshotTarget {
  const kind = classifyScreenshotArg(input.arg);
  if (kind === 'path') {
    const withExtension = /\.[a-zA-Z0-9]{1,8}$/.test(input.arg) ? input.arg : `${input.arg}.png`;
    const path = isAbsolute(withExtension) ? withExtension : resolve(input.cwd, withExtension);
    return {
      kind,
      path,
      consumedSequence: false,
      ...watchedRoot(path, input.projectRoot),
    };
  }
  const fileName = `${String(input.sequence).padStart(3, '0')}-${sanitizeScreenshotLabel(input.arg)}.png`;
  const dir = isAbsolute(input.artifactsDir)
    ? input.artifactsDir
    : resolve(input.cwd, input.artifactsDir);
  const path = resolve(dir, fileName);
  return {
    kind,
    path,
    consumedSequence: true,
    ...watchedRoot(path, input.projectRoot),
  };
}
