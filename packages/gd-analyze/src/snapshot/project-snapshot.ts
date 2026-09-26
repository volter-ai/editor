import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { chmodSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { asNumber, stringItems } from '../read/godot-value';
import { parseGodotTextFile } from '../read/text-format';

export const GODOT_PROJECT_SNAPSHOT_VERSION = 1 as const;

export type GodotProjectInputKind =
  | 'source-config'
  | 'source-engine-resource'
  | 'opaque-asset'
  | 'import-metadata'
  | 'explicit-non-input';

export interface GodotProjectSnapshotEntry {
  readonly relativePath: string;
  readonly resPath?: string;
  readonly entryType: 'file' | 'directory';
  readonly kind: GodotProjectInputKind;
  readonly reason: string;
  readonly digest?: string;
  readonly size?: number;
}

export interface GodotProjectSnapshotBlob {
  readonly digest: string;
  readonly size: number;
  readonly bytesBase64: string;
}

export interface GodotProjectSnapshot {
  readonly version: typeof GODOT_PROJECT_SNAPSHOT_VERSION;
  readonly digest: string;
  readonly engine: {
    readonly configVersion: number;
    readonly major: 3 | 4;
    readonly features: readonly string[];
  };
  readonly entries: readonly GodotProjectSnapshotEntry[];
  readonly blobs: readonly GodotProjectSnapshotBlob[];
}

const EXCLUDED_DIRECTORIES = new Map<string, string>([
  ['.git', 'version-control metadata'],
  ['.github', 'repository automation metadata'],
  ['.godot', 'Godot editor/import cache'],
  ['.import', 'Godot 3 import cache'],
  ['node_modules', 'dependency installation cache'],
  ['export', 'source-engine build output'],
  ['build', 'build output'],
  ['dist', 'build output'],
]);

const SOURCE_CONFIG_EXTENSIONS = new Set([
  '.cfg',
  '.gd',
  '.gdextension',
  '.gdshader',
  '.gdnlib',
  '.shader',
]);
const SOURCE_ENGINE_RESOURCE_EXTENSIONS = new Set([
  '.escn',
  '.gdns',
  '.material',
  '.mesh',
  '.res',
  '.scn',
  '.tres',
  '.tscn',
]);
const IMPORT_METADATA_EXTENSIONS = new Set(['.import', '.uid']);
const OPAQUE_ASSET_EXTENSIONS = new Set([
  '.aac',
  '.avi',
  '.bmp',
  '.csv',
  '.dae',
  '.dll',
  '.dylib',
  '.fbx',
  '.flac',
  '.fla',
  '.gif',
  '.glb',
  '.gltf',
  '.ico',
  '.jpeg',
  '.jpg',
  '.js',
  '.json',
  '.ktx',
  '.ktx2',
  '.m4a',
  '.md',
  '.mid',
  '.mjs',
  '.mp3',
  '.mp4',
  '.mts',
  '.obj',
  '.ogg',
  '.ogv',
  '.otf',
  '.pck',
  '.png',
  '.so',
  '.svg',
  '.tga',
  '.ts',
  '.tsv',
  '.tsx',
  '.ttf',
  '.txt',
  '.url',
  '.wasm',
  '.wav',
  '.webm',
  '.webp',
  '.woff',
  '.woff2',
  '.xml',
  '.yaml',
  '.yml',
  '.zip',
]);
const NON_INPUT_BASENAMES = new Set([
  '.git',
  '.DS_Store',
  '.editorconfig',
  '.gitattributes',
  '.gitignore',
  '.gdignore',
  'LICENSE',
  'LICENSE.md',
  'README',
  'README.md',
]);
const NON_INPUT_EXTENSIONS = new Set(['.lock', '.sfk', '.tmp']);

export class GodotProjectSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GodotProjectSnapshotError';
  }
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function posixRelative(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join('/');
}

function classifyFile(relativePath: string): { kind: GodotProjectInputKind; reason: string } {
  const basename = path.posix.basename(relativePath);
  const extension = path.posix.extname(relativePath).toLowerCase();
  if (relativePath === 'project.godot') {
    return { kind: 'source-config', reason: 'project configuration' };
  }
  if (SOURCE_CONFIG_EXTENSIONS.has(extension)) {
    return { kind: 'source-config', reason: `source/config ${extension}` };
  }
  if (SOURCE_ENGINE_RESOURCE_EXTENSIONS.has(extension)) {
    return { kind: 'source-engine-resource', reason: `Godot resource ${extension}` };
  }
  if (IMPORT_METADATA_EXTENSIONS.has(extension)) {
    return { kind: 'import-metadata', reason: `Godot import metadata ${extension}` };
  }
  if (OPAQUE_ASSET_EXTENSIONS.has(extension)) {
    return { kind: 'opaque-asset', reason: `opaque project asset ${extension}` };
  }
  if (NON_INPUT_BASENAMES.has(basename) || NON_INPUT_EXTENSIONS.has(extension)) {
    return { kind: 'explicit-non-input', reason: 'project-adjacent metadata' };
  }
  throw new GodotProjectSnapshotError(
    `${relativePath}: unclassified project input; classify this file kind before import`,
  );
}

function readDeclaredEngine(projectBytes: Buffer): GodotProjectSnapshot['engine'] {
  const parsed = parseGodotTextFile(projectBytes.toString('utf8'), 'project.godot');
  const configVersion = asNumber(parsed.leading['config_version']);
  const major = configVersion === 4 ? 3 : configVersion === 5 ? 4 : undefined;
  if (configVersion === undefined || major === undefined) {
    throw new GodotProjectSnapshotError(
      `project.godot: unsupported or missing config_version ${String(configVersion)}`,
    );
  }
  const application = parsed.sections.find((section) => section.kind === 'application');
  return {
    configVersion,
    major,
    features: stringItems(application?.properties['config/features']),
  };
}

/** Capture every eligible byte exactly once; the returned product contains no source root path. */
export function captureGodotProjectSnapshot(projectRoot: string): GodotProjectSnapshot {
  const root = path.resolve(projectRoot);
  const rootInfo = lstatSync(root, { throwIfNoEntry: false });
  if (rootInfo === undefined || !rootInfo.isDirectory()) {
    throw new GodotProjectSnapshotError(`${root}: project root is missing or not a directory`);
  }
  const entries: GodotProjectSnapshotEntry[] = [];
  const blobs = new Map<string, GodotProjectSnapshotBlob>();

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: this is the one closed census over every filesystem entry kind
  const visit = (directory: string, inheritedExclusion?: string): void => {
    let children: Dirent<string>[];
    try {
      children = readdirSync(directory, { withFileTypes: true, encoding: 'utf8' });
    } catch (error) {
      throw new GodotProjectSnapshotError(
        `${posixRelative(root, directory) || '.'}: cannot read directory: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, child.name);
      const relativePath = posixRelative(root, absolute);
      if (child.isSymbolicLink()) {
        throw new GodotProjectSnapshotError(
          `${relativePath}: symbolic links are not accepted project inputs`,
        );
      }
      if (child.isDirectory()) {
        const excluded = inheritedExclusion ?? EXCLUDED_DIRECTORIES.get(child.name);
        entries.push({
          relativePath,
          entryType: 'directory',
          kind: 'explicit-non-input',
          reason: excluded ?? 'directory container; descendants are classified independently',
        });
        visit(absolute, excluded);
        continue;
      }
      if (!child.isFile()) {
        throw new GodotProjectSnapshotError(
          `${relativePath}: only regular files and directories are accepted project inputs`,
        );
      }
      let bytes: Buffer;
      try {
        bytes = readFileSync(absolute);
      } catch (error) {
        throw new GodotProjectSnapshotError(
          `${relativePath}: cannot read file: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const classification =
        inheritedExclusion === undefined
          ? classifyFile(relativePath)
          : { kind: 'explicit-non-input' as const, reason: inheritedExclusion };
      const digest = sha256(bytes);
      entries.push({
        relativePath,
        ...(classification.kind === 'explicit-non-input'
          ? {}
          : { resPath: `res://${relativePath}` }),
        entryType: 'file',
        ...classification,
        digest,
        size: bytes.byteLength,
      });
      if (classification.kind !== 'explicit-non-input' && !blobs.has(digest)) {
        blobs.set(digest, {
          digest,
          size: bytes.byteLength,
          bytesBase64: bytes.toString('base64'),
        });
      }
    }
  };
  visit(root);
  const projectEntry = entries.find((entry) => entry.relativePath === 'project.godot');
  if (projectEntry?.digest === undefined) {
    throw new GodotProjectSnapshotError('project.godot: missing from project snapshot');
  }
  const projectBlob = blobs.get(projectEntry.digest);
  if (projectBlob === undefined) {
    throw new GodotProjectSnapshotError('project.godot: captured bytes are missing');
  }
  const orderedEntries = [...entries].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
  const digest = sha256(
    orderedEntries
      .map((entry) =>
        [entry.entryType, entry.kind, entry.relativePath, entry.digest ?? '', entry.reason].join(
          '\0',
        ),
      )
      .join('\n'),
  );
  return {
    version: GODOT_PROJECT_SNAPSHOT_VERSION,
    digest,
    engine: readDeclaredEngine(Buffer.from(projectBlob.bytesBase64, 'base64')),
    entries: orderedEntries,
    blobs: [...blobs.values()].sort((left, right) => left.digest.localeCompare(right.digest)),
  };
}

/** Transitional reader bridge: reconstruct only captured bytes and make them read-only. */
export function materializeGodotProjectSnapshot(
  snapshot: GodotProjectSnapshot,
  destination: string,
): void {
  const blobs = new Map(snapshot.blobs.map((blob) => [blob.digest, blob]));
  mkdirSync(destination, { recursive: false });
  for (const entry of snapshot.entries) {
    if (entry.kind === 'explicit-non-input') continue;
    const target = path.join(destination, entry.relativePath);
    if (entry.entryType === 'directory') {
      if (entry.reason.startsWith('directory container')) mkdirSync(target, { recursive: true });
      continue;
    }
    if (entry.digest === undefined)
      throw new Error(`${entry.relativePath}: snapshot digest missing`);
    const blob = blobs.get(entry.digest);
    if (blob === undefined) throw new Error(`${entry.relativePath}: snapshot blob missing`);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, Buffer.from(blob.bytesBase64, 'base64'), { mode: 0o444 });
  }
  chmodSync(destination, 0o555);
}
