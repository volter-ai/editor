/**
 * Shared plumbing for B2's `project.*` operations.
 *
 * Every `project.*` op is file-native (host: 'node', requires: { project: true })
 * and runs with NO editor process — it resolves `ctx.projectRoot`, reads/writes
 * plain files on disk, and reuses the engine's existing Zod schemas.
 *
 * Two cross-cutting decisions live here so every
 * operation module applies them identically:
 *
 *  - DRY-RUN: every mutation's input carries an optional `dryRun` field
 *    (`DryRunInputShape`). When true, the impl computes the same
 *    before/after/filesChanged summary as a real write but returns before
 *    ever calling `writeFileAtomic` — `MutationEnvelope.written` is `false`
 *    and the file(s) on disk are provably unchanged (round-tripped by tests).
 *  - EXTERNAL-CHANGE DETECTION: every mutation's input carries an optional
 *    `baseHash` field (`BaseHashInputShape`) — the `contentHash` a prior
 *    `read`-shaped op returned. `checkNotStale` compares it against the hash
 *    of the file's CURRENT on-disk content (read fresh, inside the mutating
 *    op, right before the write decision) and throws the declared `CONFLICT`
 *    error on mismatch — the file changed between the caller's read and this
 *    write. Omitting `baseHash` skips the check (an agent that never read the
 *    file first has nothing to compare against; this mirrors optimistic-
 *    concurrency/ETag conventions, not a hidden requirement).
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, win32 } from 'node:path';
import { z } from 'zod';
import { ToolError } from '@volter/editor-sdk/tools/errors';
import type { ToolErrorDefinition } from '@volter/editor-sdk/tools/registry';
import type { ToolContext } from '@volter/editor-sdk/tools/types';

// ---------------------------------------------------------------------------
// Project-root resolution
// ---------------------------------------------------------------------------

export const NO_PROJECT_ROOT_ERROR: ToolErrorDefinition = {
  code: 'NO_PROJECT_ROOT',
  summary: 'dispatch() was called without ctx.projectRoot.',
  data: z.object({}).describe('No additional data.'),
};

/** Every `project.*` op needs `ctx.projectRoot` — this is the one place that enforces it. */
export function requireProjectRoot(ctx: ToolContext): string {
  if (!ctx.projectRoot) {
    throw new ToolError('NO_PROJECT_ROOT', 'dispatch() was called without ctx.projectRoot.', {});
  }
  return ctx.projectRoot;
}

export const PATH_OUTSIDE_PROJECT_ERROR: ToolErrorDefinition = {
  code: 'PATH_OUTSIDE_PROJECT',
  summary: 'A given relative path escapes ctx.projectRoot lexically or through a symbolic link.',
  data: z.object({ projectRoot: z.string(), path: z.string() }),
};

/**
 * Resolve a project-relative path against `projectRoot`, rejecting absolute
 * paths and any `..` escape — every `project.*` op that takes a path input
 * (scene/manifest/input-map/asset) goes through this so an op can never be
 * pointed outside the project directory.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: lexical and physical path confinement must be one atomic decision.
export function resolveProjectPath(projectRoot: string, relativePath: string): string {
  // Inputs are protocol data and may have been produced on a different OS.
  // Treat both separator styles as path separators and reject Windows drive /
  // UNC absolutes even when the SDK process itself is running on POSIX.
  const portablePath = relativePath.replace(/\\/g, '/');
  if (isAbsolute(portablePath) || win32.isAbsolute(relativePath)) {
    throw new ToolError(
      'PATH_OUTSIDE_PROJECT',
      `"${relativePath}" must be project-relative, not absolute.`,
      {
        projectRoot,
        path: relativePath,
      },
    );
  }
  const root = resolve(projectRoot);
  const resolved = resolve(root, portablePath);
  const rel = relative(root, resolved);
  if (
    rel === '..' ||
    rel.startsWith(`..${'/'}`) ||
    rel.startsWith(`..${'\\'}`) ||
    isAbsolute(rel)
  ) {
    throw new ToolError('PATH_OUTSIDE_PROJECT', `"${relativePath}" escapes the project root.`, {
      projectRoot,
      path: relativePath,
    });
  }

  // A lexical containment check is not sufficient: `public/escape/file`
  // can still leave the project when `escape` is a symlink. Resolve every
  // existing prefix (including a dangling final symlink) and require its
  // physical target to remain under the physical project root. Nonexistent
  // suffixes are safe to create only after their nearest existing ancestor
  // has passed this check.
  let physicalRoot: string;
  try {
    physicalRoot = realpathSync(root);
  } catch {
    // A confinement root such as `<project>/public` may not exist yet for an
    // import. Canonicalize its nearest existing ancestor, then retain the
    // nonexistent suffix as the physical boundary that may be created.
    let ancestor = dirname(root);
    while (!existsSync(ancestor)) {
      const parent = dirname(ancestor);
      if (parent === ancestor) throw new Error(`No existing ancestor for ${root}`);
      ancestor = parent;
    }
    physicalRoot = resolve(realpathSync(ancestor), relative(ancestor, root));
  }
  let current = root;
  const segments = rel === '' ? [] : rel.split(/[\\/]+/);
  for (const segment of segments) {
    current = join(current, segment);
    try {
      lstatSync(current);
    } catch {
      break;
    }
    let physicalCurrent: string;
    try {
      physicalCurrent = realpathSync(current);
    } catch {
      // `lstatSync` succeeded but `realpathSync` failed: the path is most
      // commonly a dangling symlink. It must not become a write-through
      // escape when its target later appears.
      throw new ToolError(
        'PATH_OUTSIDE_PROJECT',
        `"${relativePath}" contains an unresolved symbolic link.`,
        { projectRoot, path: relativePath },
      );
    }
    const physicalRel = relative(physicalRoot, physicalCurrent);
    if (
      physicalRel === '..' ||
      physicalRel.startsWith(`..${'/'}`) ||
      physicalRel.startsWith(`..${'\\'}`) ||
      isAbsolute(physicalRel)
    ) {
      throw new ToolError(
        'PATH_OUTSIDE_PROJECT',
        `"${relativePath}" escapes the project root through a symbolic link.`,
        { projectRoot, path: relativePath },
      );
    }
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Content hashing / atomic write / conflict detection
// ---------------------------------------------------------------------------

export function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

export interface FileRead {
  raw: string;
  hash: string;
}

export const FILE_NOT_FOUND_ERROR: ToolErrorDefinition = {
  code: 'FILE_NOT_FOUND',
  summary: 'The referenced project file does not exist on disk.',
  data: z.object({ path: z.string() }),
};

/** Read a file's raw text + its content hash. Throws the declared `FILE_NOT_FOUND` shape when absent. */
export function readFileWithHash(absPath: string): FileRead {
  if (!existsSync(absPath)) {
    throw new ToolError('FILE_NOT_FOUND', `File not found: ${absPath}`, { path: absPath });
  }
  const raw = readFileSync(absPath, 'utf-8');
  return { raw, hash: sha256Hex(raw) };
}

/** Write `content` to `absPath`, creating parent directories, via a temp-file + rename so a reader never observes a partial write. */
export function writeFileAtomic(absPath: string, content: string): void {
  const dir = dirname(absPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}.tmp`);
  writeFileSync(tmp, content, 'utf-8');
  renameSync(tmp, absPath);
}

export const CONFLICT_ERROR: ToolErrorDefinition = {
  code: 'CONFLICT',
  summary:
    'The target file changed on disk since it was last read (baseHash mismatch) — the write ' +
    'was refused rather than silently clobbering the external change.',
  data: z.object({ path: z.string(), expectedHash: z.string(), actualHash: z.string() }),
};

/**
 * External-change detection (see module jsdoc). `actualHash` is the hash of
 * what THIS op just read from disk; `baseHash` is the caller-supplied hash
 * from a prior read. A mismatch means something wrote to the file in
 * between — refuse rather than clobber.
 */
export function checkNotStale(
  path: string,
  actualHash: string,
  baseHash: string | undefined,
): void {
  if (baseHash !== undefined && actualHash !== baseHash) {
    throw new ToolError(
      'CONFLICT',
      `"${path}" changed on disk since it was last read (baseHash mismatch) — refusing to overwrite an external change.`,
      { path, expectedHash: baseHash, actualHash },
    );
  }
}

// ---------------------------------------------------------------------------
// Shared Zod input fragments
// ---------------------------------------------------------------------------

export const DryRunField = z
  .boolean()
  .optional()
  .describe(
    'When true, compute the before/after summary and the files that WOULD change, but write ' +
      'nothing to disk. Defaults to false (a real write).',
  );

export const BaseHashField = z
  .string()
  .optional()
  .describe(
    'The `contentHash` a prior read-shaped op returned for this file. When given, the write is ' +
      "refused with a CONFLICT error if the file's current on-disk content hash no longer " +
      'matches (external-change detection). Omit to skip the check.',
  );

/** The envelope every mutation op's result carries, parameterized by the op's own `after` shape. */
export function mutationResultSchema<T extends z.ZodType>(afterSchema: T) {
  return z.object({
    dryRun: z.boolean().describe('True when this call computed the change without writing it.'),
    written: z.boolean().describe('True iff bytes were actually written to disk this call.'),
    filesChanged: z
      .array(z.string())
      .describe('Absolute path(s) written (dryRun:false) or that WOULD be written (dryRun:true).'),
    before: z.unknown().describe('Summary of the relevant state before this change.'),
    after: afterSchema.describe(
      'Summary of the relevant state after this change (or that WOULD result).',
    ),
  });
}

// ---------------------------------------------------------------------------
// Project-wide file discovery (shared by project.discover / story /
// xstate discovery ops — all "find files matching X under the project" ops).
// ---------------------------------------------------------------------------

/** Directories never worth descending into for project-content discovery. */
const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  'dist-server',
  '.vgai',
  '.ci-scaffold',
]);

/**
 * Recursively list every file under `projectRoot` for which `matches(relPath)`
 * is true, returning POSIX-style project-relative paths, sorted. Used for
 * best-effort discovery ops (stories/XState machines) —
 * a plain filename-pattern walk, not a build-tool glob dependency.
 */
/** `readdirSync`, swallowing a race/permission error into `[]` (a directory that vanished mid-walk is not this function's problem). */
function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** Classify without following symlinks; discovery must never walk out of the project. */
function safeEntryKind(abs: string): 'directory' | 'file' | 'skip' {
  try {
    const stat = lstatSync(abs);
    if (stat.isSymbolicLink()) return 'skip';
    return stat.isDirectory() ? 'directory' : 'file';
  } catch {
    return 'skip';
  }
}

export function listProjectFiles(
  projectRoot: string,
  matches: (relPath: string) => boolean,
): string[] {
  const out: string[] = [];
  function walk(dir: string): void {
    for (const name of safeReaddir(dir)) {
      const abs = join(dir, name);
      const kind = safeEntryKind(abs);
      if (kind === 'skip') continue;
      if (kind === 'directory') {
        if (!SKIP_DIR_NAMES.has(name)) walk(abs);
        continue;
      }
      const rel = relative(projectRoot, abs).split('\\').join('/');
      if (matches(rel)) out.push(rel);
    }
  }
  walk(projectRoot);
  return out.sort();
}
