import { createHash } from 'node:crypto';
import type {
  GodotProjectSnapshot,
  GodotProjectSnapshotBlob,
  GodotProjectSnapshotEntry,
} from './project-snapshot';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function indexBlobs(snapshot: GodotProjectSnapshot): ReadonlyMap<string, GodotProjectSnapshotBlob> {
  const blobs = new Map<string, GodotProjectSnapshotBlob>();
  for (const blob of snapshot.blobs) {
    if (blobs.has(blob.digest)) throw new Error(`project snapshot repeats blob ${blob.digest}`);
    const bytes = Buffer.from(blob.bytesBase64, 'base64');
    if (bytes.byteLength !== blob.size || sha256(bytes) !== blob.digest) {
      throw new Error(`project snapshot blob ${blob.digest} failed integrity validation`);
    }
    blobs.set(blob.digest, blob);
  }
  return blobs;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: complete entry/blob cross-index validation is one trust-boundary pass
function indexEntries(
  snapshot: GodotProjectSnapshot,
  blobs: ReadonlyMap<string, GodotProjectSnapshotBlob>,
): {
  readonly relativePaths: ReadonlyMap<string, GodotProjectSnapshotEntry>;
  readonly resPaths: ReadonlyMap<string, GodotProjectSnapshotEntry>;
} {
  const relativePaths = new Map<string, GodotProjectSnapshotEntry>();
  const resPaths = new Map<string, GodotProjectSnapshotEntry>();
  for (const entry of snapshot.entries) {
    if (relativePaths.has(entry.relativePath)) {
      throw new Error(`project snapshot repeats path ${entry.relativePath}`);
    }
    relativePaths.set(entry.relativePath, entry);
    if (entry.resPath !== undefined) {
      if (resPaths.has(entry.resPath)) {
        throw new Error(`project snapshot repeats resource path ${entry.resPath}`);
      }
      resPaths.set(entry.resPath, entry);
    }
    if (entry.entryType !== 'file') continue;
    if (entry.digest === undefined || entry.size === undefined) {
      throw new Error(`project snapshot file ${entry.relativePath} has no byte identity`);
    }
    if (entry.kind === 'explicit-non-input') continue;
    const blob = blobs.get(entry.digest);
    if (blob === undefined || blob.size !== entry.size) {
      throw new Error(`project snapshot file ${entry.relativePath} has no matching blob`);
    }
  }
  return { relativePaths, resPaths };
}

/**
 * The sole byte-addressed read surface after project capture.
 *
 * Consumers can name captured identities or content digests; they cannot reopen the mutable
 * source directory. Construction verifies the complete immutable blob index before exposing it.
 */
export class GodotProjectSnapshotReader {
  readonly snapshot: GodotProjectSnapshot;
  readonly #entriesByRelativePath: ReadonlyMap<string, GodotProjectSnapshotEntry>;
  readonly #entriesByResPath: ReadonlyMap<string, GodotProjectSnapshotEntry>;
  readonly #blobsByDigest: ReadonlyMap<string, GodotProjectSnapshotBlob>;

  constructor(snapshot: GodotProjectSnapshot) {
    const blobs = indexBlobs(snapshot);
    const { relativePaths, resPaths } = indexEntries(snapshot, blobs);
    this.snapshot = snapshot;
    this.#entriesByRelativePath = relativePaths;
    this.#entriesByResPath = resPaths;
    this.#blobsByDigest = blobs;
  }

  entries(kind?: GodotProjectSnapshotEntry['kind']): readonly GodotProjectSnapshotEntry[] {
    return kind === undefined
      ? this.snapshot.entries
      : this.snapshot.entries.filter((entry) => entry.kind === kind);
  }

  entryByRelativePath(relativePath: string): GodotProjectSnapshotEntry | undefined {
    return this.#entriesByRelativePath.get(relativePath);
  }

  entryByResPath(resPath: string): GodotProjectSnapshotEntry | undefined {
    return this.#entriesByResPath.get(resPath);
  }

  bytesByDigest(digest: string): Uint8Array {
    const blob = this.#blobsByDigest.get(digest);
    if (blob === undefined) throw new Error(`project snapshot has no blob ${digest}`);
    return Buffer.from(blob.bytesBase64, 'base64');
  }

  bytesByResPath(resPath: string): Uint8Array {
    const entry = this.#entriesByResPath.get(resPath);
    if (entry?.entryType !== 'file' || entry.digest === undefined) {
      throw new Error(`project snapshot has no captured file ${resPath}`);
    }
    return this.bytesByDigest(entry.digest);
  }

  textByResPath(resPath: string): string {
    return Buffer.from(this.bytesByResPath(resPath)).toString('utf8');
  }
}
