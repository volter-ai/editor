/** Godot Marshalls singleton: exact Base64 doors over supported Variant values and packed bytes. */

import { godotDecodeVariant, godotEncodeVariant } from './godot-variant-marshals';
import { packedByteArray, type PackedByteArray } from './packed-array';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encodeBase64(bytes: Uint8Array): string {
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1] ?? 0;
    const c = bytes[index + 2] ?? 0;
    const value = (a << 16) | (b << 8) | c;
    output += ALPHABET[(value >>> 18) & 63];
    output += ALPHABET[(value >>> 12) & 63];
    output += index + 1 < bytes.length ? ALPHABET[(value >>> 6) & 63] : '=';
    output += index + 2 < bytes.length ? ALPHABET[value & 63] : '=';
  }
  return output;
}

function decodeBase64(value: string): Uint8Array | null {
  if (typeof value !== 'string' || value.length % 4 !== 0) return null;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return null;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const output = new Uint8Array(value.length / 4 * 3 - padding);
  let write = 0;
  for (let index = 0; index < value.length; index += 4) {
    const a = ALPHABET.indexOf(value[index] ?? '');
    const b = ALPHABET.indexOf(value[index + 1] ?? '');
    const c = value[index + 2] === '=' ? 0 : ALPHABET.indexOf(value[index + 2] ?? '');
    const d = value[index + 3] === '=' ? 0 : ALPHABET.indexOf(value[index + 3] ?? '');
    const bits = (a << 18) | (b << 12) | (c << 6) | d;
    if (write < output.length) output[write++] = (bits >>> 16) & 0xff;
    if (write < output.length) output[write++] = (bits >>> 8) & 0xff;
    if (write < output.length) output[write++] = bits & 0xff;
  }
  return output;
}

export function godotVariantToBase64(value: unknown, fullObjects = false): string {
  if (fullObjects) {
    throw new Error('Marshalls.variant_to_base64(full_objects=true) cannot serialize arbitrary Objects.');
  }
  return encodeBase64(Uint8Array.from(godotEncodeVariant(value)));
}

export function godotBase64ToVariant(value: string, allowObjects = false): unknown {
  if (allowObjects) {
    throw new Error('Marshalls.base64_to_variant(allow_objects=true) cannot instantiate arbitrary Objects.');
  }
  const bytes = decodeBase64(value);
  if (bytes === null) return null;
  return godotDecodeVariant(packedByteArray(bytes))?.value ?? null;
}

export function godotRawToBase64(value: Uint8Array | readonly number[]): string {
  return encodeBase64(value instanceof Uint8Array ? value : Uint8Array.from(value));
}

export function godotBase64ToRaw(value: string): PackedByteArray {
  return packedByteArray(decodeBase64(value) ?? []);
}

export function godotUtf8ToBase64(value: string): string {
  if (typeof value !== 'string') throw new TypeError('Marshalls.utf8_to_base64 requires String.');
  return encodeBase64(encoder.encode(value));
}

export function godotBase64ToUtf8(value: string): string {
  const bytes = decodeBase64(value);
  return bytes === null ? '' : decoder.decode(bytes);
}
