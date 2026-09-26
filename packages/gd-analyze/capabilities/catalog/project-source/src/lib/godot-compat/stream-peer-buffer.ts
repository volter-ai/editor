/** Godot StreamPeerBuffer over its native contiguous byte buffer. */

import { godotDecodeVariant, godotEncodeVariant } from './godot-variant-marshals';
import { registerGodotObjectIdentity } from './object';
import { packedByteArray, type PackedByteArray } from './packed-array';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesOf(value: Uint8Array | readonly number[]): Uint8Array {
  return value instanceof Uint8Array ? value : Uint8Array.from(value);
}

function halfToNumber(bits: number): number {
  const sign = (bits & 0x8000) === 0 ? 1 : -1;
  const exponent = (bits >>> 10) & 0x1f;
  const fraction = bits & 0x03ff;
  if (exponent === 0) return sign * 2 ** -14 * fraction / 1024;
  if (exponent === 0x1f) return fraction === 0 ? sign * Infinity : Number.NaN;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

function numberToHalf(value: number): number {
  const float = new Float32Array([value]);
  const bits = new Uint32Array(float.buffer)[0] ?? 0;
  const sign = (bits >>> 16) & 0x8000;
  let exponent = ((bits >>> 23) & 0xff) - 112;
  let fraction = bits & 0x7fffff;
  if (exponent <= 0) {
    if (exponent < -10) return sign;
    fraction = (fraction | 0x800000) >>> (1 - exponent);
    return sign | ((fraction + 0x1000) >>> 13);
  }
  if (exponent >= 31) return sign | (fraction === 0 ? 0x7c00 : 0x7e00);
  fraction += 0x1000;
  if ((fraction & 0x800000) !== 0) {
    fraction = 0;
    exponent += 1;
    if (exponent >= 31) return sign | 0x7c00;
  }
  return sign | (exponent << 10) | (fraction >>> 13);
}

export class GodotStreamPeerBuffer {
  private data = new Uint8Array();
  private position = 0;
  private bigEndian = false;

  constructor() {
    registerGodotObjectIdentity(this, 'StreamPeerBuffer');
  }

  put_data(value: Uint8Array | readonly number[]): number {
    const input = bytesOf(value);
    if (input.length === 0) return 0;
    const required = this.position + input.length;
    if (required > this.data.length) {
      const grown = new Uint8Array(required);
      grown.set(this.data);
      this.data = grown;
    }
    this.data.set(input, this.position);
    this.position = required;
    return 0;
  }

  put_partial_data(value: Uint8Array | readonly number[]): [number, number] {
    const input = bytesOf(value);
    return [this.put_data(input), input.length];
  }

  get_data(bytes: number): [number, PackedByteArray] {
    const requested = this.byteCount(bytes);
    const [error, result] = this.read(requested);
    if (result.length === requested) return [error, packedByteArray(result)];
    const padded = new Uint8Array(requested);
    padded.set(result);
    return [18, packedByteArray(padded)];
  }

  get_partial_data(bytes: number): [number, PackedByteArray] {
    const [, result] = this.read(this.byteCount(bytes));
    return [0, packedByteArray(result)];
  }

  get_available_bytes(): number { return this.data.length - this.position; }

  set_big_endian(enabled: boolean): void {
    if (typeof enabled !== 'boolean') throw new TypeError('StreamPeer.big_endian requires bool.');
    this.bigEndian = enabled;
  }

  is_big_endian_enabled(): boolean { return this.bigEndian; }

  put_8(value: number): void { this.write(1, (view) => view.setInt8(0, value)); }
  put_u8(value: number): void { this.write(1, (view) => view.setUint8(0, value)); }
  put_16(value: number): void { this.write(2, (view) => view.setInt16(0, value, !this.bigEndian)); }
  put_u16(value: number): void { this.write(2, (view) => view.setUint16(0, value, !this.bigEndian)); }
  put_32(value: number): void { this.write(4, (view) => view.setInt32(0, value, !this.bigEndian)); }
  put_u32(value: number): void { this.write(4, (view) => view.setUint32(0, value, !this.bigEndian)); }
  put_64(value: number): void {
    this.int64(value);
    this.write(8, (view) => view.setBigInt64(0, BigInt(value), !this.bigEndian));
  }
  put_u64(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('StreamPeer.put_u64 requires a non-negative safe integer.');
    this.write(8, (view) => view.setBigUint64(0, BigInt(value), !this.bigEndian));
  }
  put_half(value: number): void {
    this.write(2, (view) => view.setUint16(0, numberToHalf(value), !this.bigEndian));
  }
  put_float(value: number): void { this.write(4, (view) => view.setFloat32(0, value, !this.bigEndian)); }
  put_double(value: number): void { this.write(8, (view) => view.setFloat64(0, value, !this.bigEndian)); }

  put_string(value: string): void {
    if (typeof value !== 'string' || /[^\x00-\x7f]/.test(value)) {
      throw new Error('StreamPeer.put_string carries ASCII only; use put_utf8_string for Unicode.');
    }
    const bytes = Uint8Array.from([...value].map((character) => character.charCodeAt(0)));
    this.put_u32(bytes.length);
    this.put_data(bytes);
  }

  put_utf8_string(value: string): void {
    if (typeof value !== 'string') throw new TypeError('StreamPeer.put_utf8_string requires String.');
    const bytes = encoder.encode(value);
    this.put_u32(bytes.length);
    this.put_data(bytes);
  }

  put_var(value: unknown, fullObjects = false): void {
    if (fullObjects) throw new Error('StreamPeer.put_var(full_objects=true) cannot serialize arbitrary Objects.');
    const bytes = godotEncodeVariant(value);
    this.put_32(bytes.length);
    this.put_data(bytes);
  }

  get_8(): number { return this.readNumber(1, (view) => view.getInt8(0)); }
  get_u8(): number { return this.readNumber(1, (view) => view.getUint8(0)); }
  get_16(): number { return this.readNumber(2, (view) => view.getInt16(0, !this.bigEndian)); }
  get_u16(): number { return this.readNumber(2, (view) => view.getUint16(0, !this.bigEndian)); }
  get_32(): number { return this.readNumber(4, (view) => view.getInt32(0, !this.bigEndian)); }
  get_u32(): number { return this.readNumber(4, (view) => view.getUint32(0, !this.bigEndian)); }
  get_64(): number { return this.safeInt64(this.readNumber(8, (view) => view.getBigInt64(0, !this.bigEndian))); }
  get_u64(): number { return this.safeInt64(this.readNumber(8, (view) => view.getBigUint64(0, !this.bigEndian))); }
  get_half(): number { return halfToNumber(this.readNumber(2, (view) => view.getUint16(0, !this.bigEndian))); }
  get_float(): number { return this.readNumber(4, (view) => view.getFloat32(0, !this.bigEndian)); }
  get_double(): number { return this.readNumber(8, (view) => view.getFloat64(0, !this.bigEndian)); }

  get_string(bytes = -1): string {
    const data = this.lengthPrefixed(bytes);
    if (data.some((byte) => byte > 0x7f)) {
      throw new Error('StreamPeer.get_string encountered non-ASCII bytes; use get_utf8_string.');
    }
    return String.fromCharCode(...data);
  }

  get_utf8_string(bytes = -1): string { return decoder.decode(this.lengthPrefixed(bytes)); }

  get_var(allowObjects = false): unknown {
    if (allowObjects) throw new Error('StreamPeer.get_var(allow_objects=true) cannot instantiate arbitrary Objects.');
    const length = this.get_32();
    if (length < 0) return null;
    const [, bytes] = this.read(length);
    if (bytes.length !== length) return null;
    return godotDecodeVariant(packedByteArray(bytes))?.value ?? null;
  }

  seek(position: number): void {
    if (!Number.isInteger(position) || position < 0 || position > this.data.length) {
      throw new RangeError(`StreamPeerBuffer.seek must be within 0..${this.data.length}.`);
    }
    this.position = position;
  }

  get_size(): number { return this.data.length; }
  get_position(): number { return this.position; }

  resize(size: number): void {
    if (!Number.isInteger(size) || size < 0) throw new RangeError('StreamPeerBuffer.resize requires a non-negative integer.');
    const resized = new Uint8Array(size);
    resized.set(this.data.subarray(0, size));
    this.data = resized;
    this.position = Math.min(this.position, size);
  }

  set_data_array(data: Uint8Array | readonly number[]): void {
    this.data = bytesOf(data).slice();
    this.position = 0;
  }

  get_data_array(): PackedByteArray { return packedByteArray(this.data); }

  clear(): void {
    this.data = new Uint8Array();
    this.position = 0;
  }

  duplicate(): GodotStreamPeerBuffer {
    const copy = new GodotStreamPeerBuffer();
    copy.data = this.data.slice();
    return copy;
  }

  private byteCount(value: number): number {
    if (!Number.isInteger(value) || value < 0) throw new RangeError('StreamPeer byte count must be non-negative.');
    return value;
  }

  private read(size: number): [number, Uint8Array] {
    const available = Math.max(0, this.data.length - this.position);
    const received = Math.min(size, available);
    const result = this.data.slice(this.position, this.position + received);
    this.position += received;
    return [0, result];
  }

  private readNumber<T>(size: number, read: (view: DataView) => T): T {
    const [, bytes] = this.read(size);
    const padded = new Uint8Array(size);
    padded.set(bytes);
    return read(new DataView(padded.buffer));
  }

  private write(size: number, write: (view: DataView) => void): void {
    const bytes = new Uint8Array(size);
    write(new DataView(bytes.buffer));
    this.put_data(bytes);
  }

  private lengthPrefixed(bytes: number): Uint8Array {
    const length = bytes < 0 ? this.get_u32() : this.byteCount(bytes);
    return this.read(length)[1];
  }

  private int64(value: number): void {
    if (!Number.isSafeInteger(value)) throw new RangeError('StreamPeer int64 requires a safe integer.');
  }

  private safeInt64(value: bigint): number {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) throw new RangeError(`StreamPeer int64 exceeds JavaScript safe range: ${value}.`);
    return number;
  }
}

export function createGodotStreamPeerBuffer(): GodotStreamPeerBuffer {
  return new GodotStreamPeerBuffer();
}
