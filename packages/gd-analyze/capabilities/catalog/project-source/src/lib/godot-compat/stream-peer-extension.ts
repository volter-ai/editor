/** Godot StreamPeerExtension protocol for script-defined byte streams. */

import { godotDecodeVariant, godotEncodeVariant } from './godot-variant-marshals';
import { registerGodotObjectIdentity } from './object';
import { packedByteArray, type PackedByteArray } from './packed-array';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface GodotStreamPeerExtensionHooks {
  _get_data(bytes: number): readonly [error: number, data: Uint8Array | readonly number[]];
  _get_partial_data(bytes: number): readonly [error: number, data: Uint8Array | readonly number[]];
  _put_data(data: Uint8Array): readonly [error: number, sent: number] | number;
  _put_partial_data(data: Uint8Array): readonly [error: number, sent: number];
  _get_available_bytes(): number;
}

function byteCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('StreamPeerExtension byte count must be a non-negative integer.');
  }
  return value;
}

function nativeBytes(value: PackedByteArray): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(value);
}

function toHalf(value: number): number {
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
  }
  return sign | (exponent >= 31 ? 0x7c00 : exponent << 10) | (fraction >>> 13);
}

function fromHalf(bits: number): number {
  const sign = (bits & 0x8000) === 0 ? 1 : -1;
  const exponent = (bits >>> 10) & 0x1f;
  const fraction = bits & 0x03ff;
  if (exponent === 0) return sign * 2 ** -14 * fraction / 1024;
  if (exponent === 0x1f) return fraction === 0 ? sign * Infinity : Number.NaN;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

export class GodotStreamPeerExtension {
  private bigEndian = false;

  constructor(private readonly hooks: GodotStreamPeerExtensionHooks) {
    registerGodotObjectIdentity(this, 'StreamPeerExtension');
  }

  _get_data(bytes: number): readonly [number, PackedByteArray] {
    const [error, data] = this.hooks._get_data(byteCount(bytes));
    return [error, packedByteArray(data)];
  }

  _get_partial_data(bytes: number): readonly [number, PackedByteArray] {
    const [error, data] = this.hooks._get_partial_data(byteCount(bytes));
    return [error, packedByteArray(data)];
  }

  _put_data(data: Uint8Array | readonly number[]): readonly [number, number] {
    const bytes = Uint8Array.from(data);
    const result = this.hooks._put_data(bytes);
    return typeof result === 'number' ? [result, result === 0 ? bytes.length : 0] : result;
  }

  _put_partial_data(data: Uint8Array | readonly number[]): readonly [number, number] {
    return this.hooks._put_partial_data(Uint8Array.from(data));
  }

  _get_available_bytes(): number {
    return Math.max(0, Math.trunc(this.hooks._get_available_bytes()));
  }

  put_data(data: Uint8Array | readonly number[]): number { return this._put_data(data)[0]; }

  put_partial_data(data: Uint8Array | readonly number[]): [number, number] {
    const [error, sent] = this._put_partial_data(data);
    return [error, sent];
  }

  get_data(bytes: number): [number, PackedByteArray] {
    const requested = byteCount(bytes);
    const [error, data] = this._get_data(requested);
    if (data.length === requested) return [error, data];
    const padded = new Uint8Array(requested);
    padded.set(data.slice(0, requested));
    return [error === 0 ? 18 : error, packedByteArray(padded)];
  }

  get_partial_data(bytes: number): [number, PackedByteArray] {
    const [error, data] = this._get_partial_data(bytes);
    return [error, data];
  }

  get_available_bytes(): number { return this._get_available_bytes(); }
  set_big_endian(enable: boolean): void { this.bigEndian = Boolean(enable); }
  is_big_endian_enabled(): boolean { return this.bigEndian; }

  put_8(value: number): void { this.writeNumber(1, (view) => view.setInt8(0, value)); }
  put_u8(value: number): void { this.writeNumber(1, (view) => view.setUint8(0, value)); }
  put_16(value: number): void { this.writeNumber(2, (view) => view.setInt16(0, value, !this.bigEndian)); }
  put_u16(value: number): void { this.writeNumber(2, (view) => view.setUint16(0, value, !this.bigEndian)); }
  put_32(value: number): void { this.writeNumber(4, (view) => view.setInt32(0, value, !this.bigEndian)); }
  put_u32(value: number): void { this.writeNumber(4, (view) => view.setUint32(0, value, !this.bigEndian)); }
  put_64(value: number): void {
    this.safeInteger(value, 'put_64');
    this.writeNumber(8, (view) => view.setBigInt64(0, BigInt(value), !this.bigEndian));
  }
  put_u64(value: number): void {
    this.safeInteger(value, 'put_u64', true);
    this.writeNumber(8, (view) => view.setBigUint64(0, BigInt(value), !this.bigEndian));
  }
  put_half(value: number): void { this.writeNumber(2, (view) => view.setUint16(0, toHalf(value), !this.bigEndian)); }
  put_float(value: number): void { this.writeNumber(4, (view) => view.setFloat32(0, value, !this.bigEndian)); }
  put_double(value: number): void { this.writeNumber(8, (view) => view.setFloat64(0, value, !this.bigEndian)); }

  put_string(value: string): void {
    if (/[^\x00-\x7f]/.test(value)) throw new Error('StreamPeerExtension.put_string requires ASCII.');
    const bytes = Uint8Array.from([...value].map((character) => character.charCodeAt(0)));
    this.put_u32(bytes.length);
    this.put_data(bytes);
  }

  put_utf8_string(value: string): void {
    const bytes = encoder.encode(value);
    this.put_u32(bytes.length);
    this.put_data(bytes);
  }

  put_var(value: unknown, fullObjects = false): number {
    const bytes = godotEncodeVariant(value, fullObjects);
    this.put_u32(bytes.length);
    return this.put_data(bytes);
  }

  get_8(): number { return this.readNumber(1, (view) => view.getInt8(0)); }
  get_u8(): number { return this.readNumber(1, (view) => view.getUint8(0)); }
  get_16(): number { return this.readNumber(2, (view) => view.getInt16(0, !this.bigEndian)); }
  get_u16(): number { return this.readNumber(2, (view) => view.getUint16(0, !this.bigEndian)); }
  get_32(): number { return this.readNumber(4, (view) => view.getInt32(0, !this.bigEndian)); }
  get_u32(): number { return this.readNumber(4, (view) => view.getUint32(0, !this.bigEndian)); }
  get_64(): number { return this.readInteger64(false); }
  get_u64(): number { return this.readInteger64(true); }
  get_half(): number { return fromHalf(this.readNumber(2, (view) => view.getUint16(0, !this.bigEndian))); }
  get_float(): number { return this.readNumber(4, (view) => view.getFloat32(0, !this.bigEndian)); }
  get_double(): number { return this.readNumber(8, (view) => view.getFloat64(0, !this.bigEndian)); }

  get_string(bytes = -1): string {
    const data = this.readStringBytes(bytes);
    if (data.some((byte) => byte > 0x7f)) throw new Error('StreamPeerExtension.get_string received non-ASCII data.');
    return String.fromCharCode(...data);
  }

  get_utf8_string(bytes = -1): string { return decoder.decode(nativeBytes(this.readStringBytes(bytes))); }

  get_var(allowObjects = false): unknown {
    const size = this.get_u32();
    const [error, bytes] = this.get_data(size);
    if (error !== 0) return null;
    return godotDecodeVariant(bytes, 0, allowObjects)?.value ?? null;
  }

  private writeNumber(size: number, writer: (view: DataView) => void): void {
    const bytes = new Uint8Array(size);
    writer(new DataView(bytes.buffer));
    const error = this.put_data(bytes);
    if (error !== 0) throw new Error(`StreamPeerExtension write failed with error ${error}.`);
  }

  private readNumber<T>(size: number, reader: (view: DataView) => T): T {
    const [error, bytes] = this.get_data(size);
    if (error !== 0) throw new Error(`StreamPeerExtension read failed with error ${error}.`);
    const native = nativeBytes(bytes);
    return reader(new DataView(native.buffer, native.byteOffset, native.byteLength));
  }

  private readInteger64(unsigned: boolean): number {
    const value = this.readNumber(8, (view) => unsigned
      ? view.getBigUint64(0, !this.bigEndian)
      : view.getBigInt64(0, !this.bigEndian));
    const number = Number(value);
    if (!Number.isSafeInteger(number)) throw new RangeError('StreamPeerExtension 64-bit value exceeds JS safe integer range.');
    return number;
  }

  private readStringBytes(bytes: number): PackedByteArray {
    const size = bytes < 0 ? this.get_u32() : byteCount(bytes);
    const [error, data] = this.get_data(size);
    if (error !== 0) throw new Error(`StreamPeerExtension string read failed with error ${error}.`);
    return data;
  }

  private safeInteger(value: number, member: string, unsigned = false): void {
    if (!Number.isSafeInteger(value) || (unsigned && value < 0)) {
      throw new RangeError(`StreamPeerExtension.${member} requires ${unsigned ? 'a non-negative ' : ''}safe integer.`);
    }
  }
}

export function createGodotStreamPeerExtension(
  hooks: GodotStreamPeerExtensionHooks,
): GodotStreamPeerExtension {
  return new GodotStreamPeerExtension(hooks);
}
