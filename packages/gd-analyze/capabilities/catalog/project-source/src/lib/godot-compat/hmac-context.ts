/** Godot HMACContext streaming facade over the exact synchronous digest implementation. */

import { godotHmacDigest } from './crypto';
import { registerGodotObjectIdentity } from './object';
import { packedByteArray, type PackedByteArray } from './packed-array';

export class GodotHmacContext {
  private hashType: number | undefined;
  private key = new Uint8Array();
  private chunks: Uint8Array[] = [];

  constructor() { registerGodotObjectIdentity(this, 'HMACContext'); }

  start(hashType: number, keyValue: Uint8Array | readonly number[]): number {
    if (this.hashType !== undefined) return 22;
    if (hashType !== 0 && hashType !== 1 && hashType !== 2) return 2;
    this.hashType = hashType;
    this.key = keyValue instanceof Uint8Array ? keyValue.slice() : Uint8Array.from(keyValue);
    this.chunks = [];
    return 0;
  }

  update(dataValue: Uint8Array | readonly number[]): number {
    if (this.hashType === undefined) return 3;
    const data = dataValue instanceof Uint8Array ? dataValue : Uint8Array.from(dataValue);
    if (data.length === 0) return 1;
    this.chunks.push(data.slice());
    return 0;
  }

  finish(): PackedByteArray {
    if (this.hashType === undefined) return packedByteArray();
    const length = this.chunks.reduce((total, chunk) => total + chunk.length, 0);
    const message = new Uint8Array(length);
    let offset = 0;
    for (const chunk of this.chunks) {
      message.set(chunk, offset);
      offset += chunk.length;
    }
    const digest = godotHmacDigest(this.hashType, this.key, message);
    this.hashType = undefined;
    this.key = new Uint8Array();
    this.chunks = [];
    return digest;
  }
}

export function createGodotHmacContext(): GodotHmacContext { return new GodotHmacContext(); }
