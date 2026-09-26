/** Godot HashingContext with synchronous MD5/SHA-1/SHA-256 accumulation. */

import { registerGodotObjectIdentity } from './object';
import { packedByteArray, type PackedByteArray } from './packed-array';
import { md5Bytes, sha1Bytes, sha256Bytes } from './string-encoding';

export const GodotHashType = { MD5: 0, SHA1: 1, SHA256: 2 } as const;

export function godotHashDigest(type: number, bytes: Uint8Array): PackedByteArray {
  if (type !== 0 && type !== 1 && type !== 2) return packedByteArray();
  return packedByteArray(type === 0 ? md5Bytes(bytes) : type === 1 ? sha1Bytes(bytes) : sha256Bytes(bytes));
}

const OK = 0;
const ERR_UNCONFIGURED = 3;
const ERR_ALREADY_IN_USE = 22;
const ERR_INVALID_PARAMETER = 31;

export class GodotHashingContext {
  private type: number | undefined;
  private chunks: Uint8Array[] = [];

  constructor() { registerGodotObjectIdentity(this, 'HashingContext'); }

  start(type: number): number {
    if (this.type !== undefined) return ERR_ALREADY_IN_USE;
    if (type !== 0 && type !== 1 && type !== 2) return ERR_INVALID_PARAMETER;
    this.type = type;
    this.chunks = [];
    return OK;
  }

  update(chunk: Iterable<number>): number {
    if (this.type === undefined) return ERR_UNCONFIGURED;
    const bytes = chunk instanceof Uint8Array ? chunk : Uint8Array.from(chunk);
    this.chunks.push(bytes.slice());
    return OK;
  }

  finish(): PackedByteArray {
    if (this.type === undefined) return packedByteArray();
    const length = this.chunks.reduce((total, chunk) => total + chunk.length, 0);
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of this.chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const type = this.type;
    this.type = undefined;
    this.chunks = [];
    return godotHashDigest(type, bytes);
  }
}

export function createGodotHashingContext(): GodotHashingContext { return new GodotHashingContext(); }
