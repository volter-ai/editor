/** Godot 4 PCK packer over the project-owned FileAccess namespace. */

import { FileAccessMode, GodotFileAccess, fileAccessOpen } from './file-access';
import { registerGodotObjectIdentity } from './object';

const OK = 0;
const ERR_UNAVAILABLE = 2;
const ERR_FILE_NOT_FOUND = 7;
const ERR_FILE_CANT_WRITE = 13;
const ERR_ALREADY_IN_USE = 22;
const ERR_INVALID_PARAMETER = 31;
const ERR_ALREADY_EXISTS = 32;
const PACK_HEADER_MAGIC = 0x43504447;
const PACK_FORMAT_VERSION = 3;
const PACK_FILE_REMOVAL = 1;
const encoder = new TextEncoder();

interface PackEntry {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly removal: boolean;
  readonly encrypted: boolean;
}

function integer(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError(`PCKPacker.${member} requires integer.`);
  return value;
}

function pathValue(value: unknown, member: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`PCKPacker.${member} requires non-empty path String.`);
  return value.replace(/\\/g, '/');
}

function targetPath(value: unknown): string {
  let path = pathValue(value, 'target_path');
  if (path.startsWith('res://')) path = path.slice(6);
  path = path.replace(/^\/+/, '').replace(/\/+/g, '/');
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) throw new Error('PCKPacker target path escapes the pack root.');
      parts.pop();
    } else parts.push(part);
  }
  if (parts.length === 0) throw new Error('PCKPacker target path cannot be empty.');
  return `res://${parts.join('/')}`;
}

function alignmentValue(value: unknown): number {
  const alignment = integer(value, 'pck_start alignment');
  if (alignment <= 0 || (alignment & (alignment - 1)) !== 0) {
    throw new RangeError('PCKPacker alignment requires a positive power of two.');
  }
  return alignment;
}

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

class ByteWriter {
  private values: number[] = [];
  get length(): number { return this.values.length; }
  u8(value: number): void { this.values.push(value & 0xff); }
  u32(value: number): void {
    this.u8(value); this.u8(value >>> 8); this.u8(value >>> 16); this.u8(value >>> 24);
  }
  u64(value: number): void {
    const bigint = BigInt(value);
    for (let shift = 0n; shift < 64n; shift += 8n) this.u8(Number((bigint >> shift) & 0xffn));
  }
  bytes(value: Uint8Array | readonly number[]): void { for (const byte of value) this.u8(byte); }
  zeros(count: number): void { for (let index = 0; index < count; index += 1) this.u8(0); }
  pad(alignment: number): void { this.zeros(align(this.length, alignment) - this.length); }
  patchU64(offset: number, value: number): void {
    const bigint = BigInt(value);
    for (let shift = 0n; shift < 64n; shift += 8n) this.values[offset + Number(shift / 8n)] = Number((bigint >> shift) & 0xffn);
  }
  result(): Uint8Array { return Uint8Array.from(this.values); }
}

// PCK's per-file digest is MD5. This compact transcription operates on the exact entry bytes.
function md5(bytes: Uint8Array): Uint8Array {
  const shifts = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  const constants = Array.from({ length: 64 }, (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0);
  const length = bytes.length;
  const padded = new Uint8Array(align(length + 9, 64));
  padded.set(bytes); padded[length] = 0x80;
  const bitLength = BigInt(length) * 8n;
  for (let index = 0; index < 8; index += 1) padded[padded.length - 8 + index] = Number((bitLength >> BigInt(index * 8)) & 0xffn);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const rotate = (value: number, shift: number): number => ((value << shift) | (value >>> (32 - shift))) >>> 0;
  for (let offset = 0; offset < padded.length; offset += 64) {
    const words = new Uint32Array(16);
    for (let index = 0; index < 16; index += 1) {
      const at = offset + index * 4;
      words[index] = (padded[at]! | (padded[at + 1]! << 8) | (padded[at + 2]! << 16) | (padded[at + 3]! << 24)) >>> 0;
    }
    let a = a0, b = b0, c = c0, d = d0;
    for (let index = 0; index < 64; index += 1) {
      let f: number, g: number;
      if (index < 16) { f = (b & c) | (~b & d); g = index; }
      else if (index < 32) { f = (d & b) | (~d & c); g = (5 * index + 1) % 16; }
      else if (index < 48) { f = b ^ c ^ d; g = (3 * index + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * index) % 16; }
      const nextD = d; d = c; c = b;
      b = (b + rotate((a + f + constants[index]! + words[g]!) >>> 0, shifts[index]!)) >>> 0;
      a = nextD;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }
  const result = new Uint8Array(16);
  [a0, b0, c0, d0].forEach((value, word) => {
    for (let index = 0; index < 4; index += 1) result[word * 4 + index] = value >>> (index * 8);
  });
  return result;
}

export class GodotPCKPacker {
  private outputPath = '';
  private alignment = 32;
  private active = false;
  private readonly entries = new Map<string, PackEntry>();

  constructor() { registerGodotObjectIdentity(this, 'PCKPacker'); }

  pck_start(pckPath: unknown, alignment: unknown = 32, key: unknown = '0000000000000000000000000000000000000000000000000000000000000000', encryptDirectory: unknown = false): number {
    if (this.active) return ERR_ALREADY_IN_USE;
    if (typeof key !== 'string' || (key.length !== 0 && !/^[0-9a-fA-F]{64}$/.test(key))) return ERR_INVALID_PARAMETER;
    if (Boolean(encryptDirectory) || (key !== '' && !/^0+$/.test(key))) return ERR_UNAVAILABLE;
    try {
      this.outputPath = pathValue(pckPath, 'pck_start pck_path');
      this.alignment = alignmentValue(alignment);
    } catch { return ERR_INVALID_PARAMETER; }
    this.entries.clear(); this.active = true;
    return OK;
  }

  add_file(target: unknown, source: unknown, encrypt: unknown = false): number {
    if (!this.active) return ERR_ALREADY_IN_USE;
    if (Boolean(encrypt)) return ERR_UNAVAILABLE;
    const sourcePath = pathValue(source, 'source_path');
    if (!GodotFileAccess.file_exists(sourcePath)) return ERR_FILE_NOT_FOUND;
    return this.add_file_from_buffer(target, GodotFileAccess.get_file_as_bytes(sourcePath), false);
  }

  add_file_from_buffer(target: unknown, data: unknown, encrypt: unknown = false): number {
    if (!this.active) return ERR_ALREADY_IN_USE;
    if (Boolean(encrypt)) return ERR_UNAVAILABLE;
    if (!(data instanceof Uint8Array) && !Array.isArray(data)) return ERR_INVALID_PARAMETER;
    let path: string;
    try { path = targetPath(target); } catch { return ERR_INVALID_PARAMETER; }
    if (this.entries.has(path)) return ERR_ALREADY_EXISTS;
    const bytes = data instanceof Uint8Array ? data.slice() : Uint8Array.from(data);
    this.entries.set(path, { path, bytes, removal: false, encrypted: false });
    return OK;
  }

  add_file_removal(target: unknown): number {
    if (!this.active) return ERR_ALREADY_IN_USE;
    let path: string;
    try { path = targetPath(target); } catch { return ERR_INVALID_PARAMETER; }
    if (this.entries.has(path)) return ERR_ALREADY_EXISTS;
    this.entries.set(path, { path, bytes: new Uint8Array(), removal: true, encrypted: false });
    return OK;
  }

  private build(): Uint8Array {
    const writer = new ByteWriter();
    writer.u32(PACK_HEADER_MAGIC); writer.u32(PACK_FORMAT_VERSION);
    writer.u32(4); writer.u32(7); writer.u32(0); writer.u32(0); writer.u64(0);
    writer.zeros(16 * 4); writer.u32(this.entries.size);
    const offsets: { readonly patch: number; readonly entry: PackEntry }[] = [];
    for (const entry of this.entries.values()) {
      const path = encoder.encode(`${entry.path}\0`);
      writer.u32(path.length); writer.bytes(path); writer.pad(4);
      const patch = writer.length; writer.u64(0); writer.u64(entry.bytes.length);
      writer.bytes(md5(entry.bytes)); writer.u32(entry.removal ? PACK_FILE_REMOVAL : 0);
      offsets.push({ patch, entry });
    }
    writer.pad(this.alignment);
    for (const { patch, entry } of offsets) {
      writer.patchU64(patch, writer.length);
      writer.bytes(entry.bytes); writer.pad(this.alignment);
    }
    return writer.result();
  }

  flush(verbose: unknown = false): number {
    if (!this.active) return ERR_ALREADY_IN_USE;
    const output = fileAccessOpen(this.outputPath, FileAccessMode.WRITE);
    if (output === null) return ERR_FILE_CANT_WRITE;
    output.store_buffer(this.build()); output.close();
    if (Boolean(verbose)) console.info(`PCKPacker wrote ${this.entries.size} entries to ${this.outputPath}`);
    this.active = false; this.entries.clear(); this.outputPath = '';
    return OK;
  }
}

export function createGodotPCKPacker(): GodotPCKPacker { return new GodotPCKPacker(); }
