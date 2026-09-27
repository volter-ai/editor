import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import type { GodotProjectSnapshot } from '../snapshot/project-snapshot';
import { GodotProjectSnapshotReader } from '../snapshot/project-snapshot-reader';
import { fsToResPath, isResPath, resToFsPath } from './res-path';

/** Closed byte surface consumed by project/resource readers after project capture. */
export interface GodotProjectFileSource {
  readonly label: string;
  readonly fallbackProjectName?: string;
  readonly resPaths: readonly string[];
  has(resPath: string): boolean;
  bytes(resPath: string): Uint8Array;
  text(resPath: string): string;
}

/** Production source: verified content-addressed blobs, with no filesystem path or lazy handle. */
export function projectFileSourceFromSnapshot(
  snapshot: GodotProjectSnapshot,
): GodotProjectFileSource {
  const reader = new GodotProjectSnapshotReader(snapshot);
  const resPaths = snapshot.entries.flatMap((entry) =>
    entry.entryType === 'file' && entry.resPath !== undefined ? [entry.resPath] : [],
  );
  return {
    label: `snapshot:${snapshot.digest}`,
    resPaths,
    has: (resPath) => reader.entryByResPath(resPath)?.entryType === 'file',
    bytes: (resPath) => reader.bytesByResPath(resPath),
    text: (resPath) => reader.textByResPath(resPath),
  };
}

function walkFiles(root: string, at: string = root, acc: string[] = []): string[] {
  for (const entry of readdirSync(at, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (['.git', '.github', '.import', '.godot', 'node_modules', 'export'].includes(entry.name)) {
        continue;
      }
      if (entry.name === 'tmp' && path.basename(at) === '.vgai') continue;
      walkFiles(root, path.join(at, entry.name), acc);
    } else if (entry.isFile()) {
      acc.push(path.join(at, entry.name));
    }
  }
  return acc;
}

/** Legacy/report source. The production importer never constructs this adapter. */
export function projectFileSourceFromDirectory(projectDir: string): GodotProjectFileSource {
  const root = path.resolve(projectDir);
  const resPaths = walkFiles(root)
    .map((file) => fsToResPath(root, file))
    .sort();
  const has = (resPath: string): boolean => {
    if (!isResPath(resPath)) return false;
    const file = resToFsPath(root, resPath);
    return existsSync(file) && statSync(file).isFile();
  };
  const bytes = (resPath: string): Uint8Array => {
    if (!has(resPath)) throw new Error(`${resPath}: project file is missing`);
    return readFileSync(resToFsPath(root, resPath));
  };
  return {
    label: root,
    fallbackProjectName: path.basename(root),
    resPaths,
    has,
    bytes,
    text: (resPath) => Buffer.from(bytes(resPath)).toString('utf8'),
  };
}
