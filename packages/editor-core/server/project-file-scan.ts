/**
 * Reading a project's files as FACTS: install its dependencies, hash a tree,
 * snapshot it for collaboration, and name a file's content type.
 *
 * None of this holds session state — every function takes the paths it works
 * on. The collaboration snapshot in particular is a pure read: it is what a
 * joining participant is told the project currently contains.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { type Dirent, readFileSync } from 'node:fs';
import { readdir, readFile, stat, unlink } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { join, relative, sep } from 'node:path';
import { isContainedRelativePath } from '@volter/editor-sdk/session/relative-path-guard';

export async function installProjectDependencies(projectPath: string): Promise<void> {
  await new Promise<void>((resolveInstall, rejectInstall) => {
    const child = spawn(
      'npm',
      ['install', '--prefer-offline', '--no-audit', '--no-fund', '--loglevel=error'],
      {
        cwd: projectPath,
        stdio: 'ignore',
        shell: true,
      },
    );
    child.once('error', rejectInstall);
    child.once('close', (code) => {
      if (code === 0) resolveInstall();
      else rejectInstall(new Error(`npm install exited with code ${code ?? 'unknown'}`));
    });
  });
}

export function readRunningEngineVersion(engineRoot: string): string | null {
  const candidates = [
    join(engineRoot, 'packages', 'editor-core', 'package.json'),
    join(engineRoot, 'node_modules', '@volter', 'editor-core', 'package.json'),
  ];
  for (const path of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { version?: unknown };
      if (typeof parsed.version === 'string') return parsed.version;
    } catch {
      // Try the next supported checkout/installed-package layout.
    }
  }
  // Packaged mode passes the installed `@vgai/editor` package as engineRoot.
  // npm/pnpm may hoist its runtime-package dependencies to the PROJECT's
  // node_modules, outside both candidates above; reading that project copy
  // would merely echo the manifest pin and make every mismatch look healthy.
  // Release-train package versions are synchronized, so the installed
  // editor's own version is the authoritative identity in this layout. Keep
  // the name check strict: the monorepo root has its own unrelated package
  // version and must never masquerade as the engine version.
  try {
    const parsed = JSON.parse(readFileSync(join(engineRoot, 'package.json'), 'utf-8')) as {
      name?: unknown;
      version?: unknown;
    };
    if (parsed.name === '@volter/editor-core' && typeof parsed.version === 'string') {
      return parsed.version;
    }
  } catch {
    // No packaged-editor identity at this root.
  }
  return null;
}

// ---------------------------------------------------------------------------
// File hashing — partial hash for large files (first 64KB + size)
// ---------------------------------------------------------------------------

const PARTIAL_HASH_THRESHOLD = 10 * 1024 * 1024; // 10MB

export async function hashAndSize(absPath: string): Promise<{ hash: string; size: number }> {
  const data = await readFile(absPath);
  const hash = createHash('sha256');
  if (data.length > PARTIAL_HASH_THRESHOLD) {
    hash.update(data.subarray(0, 65536));
    hash.update(`\0size:${data.length}`);
  } else {
    hash.update(data);
  }
  return { hash: hash.digest('hex').slice(0, 16), size: data.length };
}

export async function unlinkIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export async function scanDirForHashes(
  dir: string,
  hashCache: Map<string, string>,
  sizeCache: Map<string, number>,
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await scanDirForHashes(full, hashCache, sizeCache);
    } else if (entry.isFile()) {
      try {
        const { hash, size } = await hashAndSize(full);
        hashCache.set(full, hash);
        sizeCache.set(full, size);
      } catch {
        /* skip unreadable files */
      }
    }
  }
}

const COLLABORATION_IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'coverage',
  'logs',
  '.git',
  '.vgai',
]);

/** The project-owned estate: every file under the project root except the
 *  installed, generated and private directories above, and every dotfile.
 *  The same set `collaborationSourceSnapshot` publishes to a joining
 *  participant — one line, not a second weaker one. */
export function isProjectOwnedRelativePath(path: string): boolean {
  if (!isContainedRelativePath(path)) return false;
  return !path
    .split('/')
    .some((segment) => segment.startsWith('.') || COLLABORATION_IGNORED_DIRS.has(segment));
}

/** The project's own files with size and mtime — a listing, not a read, so
 *  asking what is there does not cost what is in it. */
export async function projectFileIndex(
  projectRoot: string,
): Promise<Array<{ path: string; size: number; mtime: number }>> {
  const files: Array<{ path: string; size: number; mtime: number }> = [];
  const visit = async (dir: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || COLLABORATION_IGNORED_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(full);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const info = await stat(full);
        files.push({
          path: relative(projectRoot, full).split(sep).join('/'),
          size: info.size,
          mtime: info.mtimeMs,
        });
      } catch {
        /* vanished between readdir and stat: it is not in the project now */
      }
    }
  };
  await visit(projectRoot);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

export async function collaborationSourceSnapshot(
  projectRoot: string,
): Promise<Array<{ path: string; sha: string }>> {
  const resources: Array<{ path: string; sha: string }> = [];
  const visit = async (dir: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || COLLABORATION_IGNORED_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const { hash } = await hashAndSize(full);
      resources.push({
        path: relative(projectRoot, full).split(sep).join('/'),
        sha: hash,
      });
    }
  };
  await visit(projectRoot);
  return resources.sort((left, right) => left.path.localeCompare(right.path));
}

// ---------------------------------------------------------------------------
// MIME type detection
export const mimeTypes: Record<string, string> = {
  json: 'application/json',
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  gif: 'image/gif',
};

/** One raw request header as a single string (Node hands back `string[]` for
 *  the repeatable ones). The share-claim headers are all single-valued. */
export function headerValue(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}
