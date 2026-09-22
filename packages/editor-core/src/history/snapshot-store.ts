import { sha256Hex } from '../bytes-codec';
import type { ResourceSnapshot, SnapshotRef } from './types';

interface BlobRecord {
  readonly bytes: Uint8Array;
  references: number;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** In-memory, content-addressed snapshot blobs for one open project session. */
export class SnapshotStore {
  private readonly blobs = new Map<string, BlobRecord>();
  private retainedBytes = 0;

  async put(snapshot: Omit<ResourceSnapshot, 'sha256'>): Promise<SnapshotRef> {
    if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) {
      throw new Error('Snapshot revision must be a non-negative safe integer.');
    }
    const bytes = Uint8Array.from(snapshot.bytes);
    const sha256 = await sha256Hex(bytes);
    const existing = this.blobs.get(sha256);
    if (existing) {
      // A real SHA-256 collision is fantastically unlikely, but silently aliasing
      // different authored bytes would make undo corrupt data.
      if (!bytesEqual(existing.bytes, bytes)) throw new Error(`SHA-256 collision for ${sha256}.`);
      existing.references++;
    } else {
      this.blobs.set(sha256, { bytes, references: 1 });
      this.retainedBytes += bytes.byteLength;
    }
    return {
      revision: snapshot.revision,
      contentType: snapshot.contentType,
      sha256,
      blobKey: sha256,
      byteLength: bytes.byteLength,
    };
  }

  retain(ref: SnapshotRef): void {
    const blob = this.requireBlob(ref);
    blob.references++;
  }

  release(ref: SnapshotRef): void {
    const blob = this.requireBlob(ref);
    blob.references--;
    if (blob.references === 0) {
      this.blobs.delete(ref.blobKey);
      this.retainedBytes -= blob.bytes.byteLength;
    }
  }

  read(ref: SnapshotRef): ResourceSnapshot {
    const blob = this.requireBlob(ref);
    return {
      revision: ref.revision,
      contentType: ref.contentType,
      bytes: Uint8Array.from(blob.bytes),
      sha256: ref.sha256,
    };
  }

  has(ref: SnapshotRef): boolean {
    const blob = this.blobs.get(ref.blobKey);
    return !!blob && blob.bytes.byteLength === ref.byteLength;
  }

  get uniqueBlobCount(): number {
    return this.blobs.size;
  }

  get uniqueByteLength(): number {
    return this.retainedBytes;
  }

  get referenceCount(): number {
    let count = 0;
    for (const blob of this.blobs.values()) count += blob.references;
    return count;
  }

  clear(): void {
    this.blobs.clear();
    this.retainedBytes = 0;
  }

  private requireBlob(ref: SnapshotRef): BlobRecord {
    const blob = this.blobs.get(ref.blobKey);
    if (!blob) throw new Error(`Snapshot blob "${ref.blobKey}" is not retained.`);
    if (ref.sha256 !== ref.blobKey || blob.bytes.byteLength !== ref.byteLength) {
      throw new Error(`Snapshot reference "${ref.blobKey}" does not match its retained blob.`);
    }
    return blob;
  }
}
