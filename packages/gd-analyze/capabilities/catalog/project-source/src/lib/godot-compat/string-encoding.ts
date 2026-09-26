/** Godot 4.7 String encoding, escaping, validation, and digest helpers. */

import { codePoints } from './string-core';

const utf8 = new TextEncoder();
const bytesToHex = (bytes: readonly number[]): string =>
  bytes.map((byte) => (byte & 255).toString(16).padStart(2, '0')).join('');
const rotateLeft = (value: number, bits: number): number =>
  ((value << bits) | (value >>> (32 - bits))) >>> 0;
const rotateRight = (value: number, bits: number): number =>
  ((value >>> bits) | (value << (32 - bits))) >>> 0;

const MD5_SHIFTS = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21] as const;
const MD5_CONSTANTS = Array.from(
  { length: 64 },
  (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0,
);

function padded(bytes: Uint8Array, littleLength: boolean): Uint8Array {
  const size = Math.ceil((bytes.length + 9) / 64) * 64;
  const out = new Uint8Array(size);
  out.set(bytes);
  out[bytes.length] = 0x80;
  const bits = BigInt(bytes.length) * 8n;
  for (let i = 0; i < 8; i += 1) {
    out[size - (littleLength ? 8 - i : 1 + i)] = Number((bits >> BigInt(8 * i)) & 255n);
  }
  return out;
}

function wordsToBytes(words: readonly number[], little: boolean): number[] {
  const out: number[] = [];
  for (const word of words) {
    for (let i = 0; i < 4; i += 1) out.push((word >>> (little ? 8 * i : 24 - 8 * i)) & 255);
  }
  return out;
}

export function md5Bytes(input: Uint8Array): number[] {
  const bytes = padded(input, true);
  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  for (let offset = 0; offset < bytes.length; offset += 64) {
    const m = Array.from({ length: 16 }, (_, i) => {
      const at = offset + i * 4;
      return (
        ((bytes[at] ?? 0) |
          ((bytes[at + 1] ?? 0) << 8) |
          ((bytes[at + 2] ?? 0) << 16) |
          ((bytes[at + 3] ?? 0) << 24)) >>>
        0
      );
    });
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i += 1) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const previousD = d;
      d = c;
      c = b;
      const shift = MD5_SHIFTS[Math.floor(i / 16) * 4 + (i % 4)] ?? 0;
      b = (b + rotateLeft((a + f + (MD5_CONSTANTS[i] ?? 0) + (m[g] ?? 0)) >>> 0, shift)) >>> 0;
      a = previousD;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  return wordsToBytes([a0, b0, c0, d0], true);
}

export function sha1Bytes(input: Uint8Array): number[] {
  const bytes = padded(input, false);
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  for (let offset = 0; offset < bytes.length; offset += 64) {
    const w = new Uint32Array(80);
    for (let i = 0; i < 16; i += 1) {
      const at = offset + i * 4;
      w[i] =
        (((bytes[at] ?? 0) << 24) |
          ((bytes[at + 1] ?? 0) << 16) |
          ((bytes[at + 2] ?? 0) << 8) |
          (bytes[at + 3] ?? 0)) >>>
        0;
    }
    for (let i = 16; i < 80; i += 1)
      w[i] = rotateLeft((w[i - 3] ?? 0) ^ (w[i - 8] ?? 0) ^ (w[i - 14] ?? 0) ^ (w[i - 16] ?? 0), 1);
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i += 1) {
      const f =
        i < 20
          ? (b & c) | (~b & d)
          : i < 40
            ? b ^ c ^ d
            : i < 60
              ? (b & c) | (b & d) | (c & d)
              : b ^ c ^ d;
      const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const temp = (rotateLeft(a, 5) + f + e + k + (w[i] ?? 0)) >>> 0;
      e = d;
      d = c;
      c = rotateLeft(b, 30);
      b = a;
      a = temp;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  return wordsToBytes([h0, h1, h2, h3, h4], false);
}

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

export function sha256Bytes(input: Uint8Array): number[] {
  const bytes = padded(input, false);
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    const w = new Uint32Array(64);
    for (let i = 0; i < 16; i += 1) {
      const at = offset + i * 4;
      w[i] =
        (((bytes[at] ?? 0) << 24) |
          ((bytes[at + 1] ?? 0) << 16) |
          ((bytes[at + 2] ?? 0) << 8) |
          (bytes[at + 3] ?? 0)) >>>
        0;
    }
    for (let i = 16; i < 64; i += 1) {
      const a = w[i - 15] ?? 0;
      const b = w[i - 2] ?? 0;
      const s0 = rotateRight(a, 7) ^ rotateRight(a, 18) ^ (a >>> 3);
      const s1 = rotateRight(b, 17) ^ rotateRight(b, 19) ^ (b >>> 10);
      w[i] = ((w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = [...h] as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (hh + s1 + choice + (SHA256_K[i] ?? 0) + (w[i] ?? 0)) >>> 0;
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    const next = [a, b, c, d, e, f, g, hh];
    for (let i = 0; i < 8; i += 1) h[i] = ((h[i] ?? 0) + (next[i] ?? 0)) >>> 0;
  }
  return wordsToBytes([...h], false);
}

export const stringMd5Buffer = (value: string): number[] => md5Bytes(utf8.encode(value));
export const stringSha1Buffer = (value: string): number[] => sha1Bytes(utf8.encode(value));
export const stringSha256Buffer = (value: string): number[] => sha256Bytes(utf8.encode(value));
export const stringMd5Text = (value: string): string => bytesToHex(stringMd5Buffer(value));
export const stringSha1Text = (value: string): string => bytesToHex(stringSha1Buffer(value));
export const stringSha256Text = (value: string): string => bytesToHex(stringSha256Buffer(value));

export function stringHash(value: string): number {
  let hash = 5381;
  for (const char of codePoints(value))
    hash = (Math.imul(hash, 33) + (char.codePointAt(0) ?? 0)) >>> 0;
  return hash;
}

export const stringUriEncode = (value: string): string =>
  encodeURIComponent(value).replace(
    /[!'()*]/gu,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
function uriDecode(value: string, decodePlus: boolean): string {
  const bytes: number[] = [];
  for (let i = 0; i < value.length; ) {
    const char = value[i] ?? '';
    if (char === '+' && decodePlus) {
      bytes.push(32);
      i += 1;
      continue;
    }
    const encoded = char === '%' ? value.slice(i + 1, i + 3) : '';
    if (/^[0-9A-F]{2}$/u.test(encoded)) {
      bytes.push(Number.parseInt(encoded, 16));
      i += 3;
      continue;
    }
    bytes.push(...utf8.encode(char));
    i += 1;
  }
  return new TextDecoder().decode(Uint8Array.from(bytes));
}
export const stringUriDecode = (value: string): string => uriDecode(value, true);
export const stringUriFileDecode = (value: string): string => uriDecode(value, false);

export function stringCEscape(value: string): string {
  return value
    .replace(/\\/gu, '\\\\')
    .replace(/\u0007/gu, '\\a')
    .replace(/\u0008/gu, '\\b')
    .replace(/\f/gu, '\\f')
    .replace(/\n/gu, '\\n')
    .replace(/\r/gu, '\\r')
    .replace(/\t/gu, '\\t')
    .replace(/\v/gu, '\\v')
    .replace(/'/gu, "\\'")
    .replace(/"/gu, '\\"');
}
export function stringCUnescape(value: string): string {
  return value
    .replace(/\\a/gu, '\u0007')
    .replace(/\\b/gu, '\b')
    .replace(/\\f/gu, '\f')
    .replace(/\\n/gu, '\n')
    .replace(/\\r/gu, '\r')
    .replace(/\\t/gu, '\t')
    .replace(/\\v/gu, '\v')
    .replace(/\\'/gu, "'")
    .replace(/\\"/gu, '"')
    .replace(/\\\\/gu, '\\');
}
export const stringJsonEscape = (value: string): string =>
  stringCEscape(value).replace(/\\'/gu, "'").replace(/\\a/gu, '\u0007');
export function stringXmlEscape(value: string, quotes = false): string {
  let out = value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
  if (quotes) out = out.replace(/'/gu, '&apos;').replace(/"/gu, '&quot;');
  return out;
}
export function stringXmlUnescape(value: string): string {
  return value.replace(
    /&#x([0-9a-f]+);|&#([0-9]+);|&(quot|apos|lt|gt|amp);/giu,
    (_all, hex: string | undefined, decimal: string | undefined, named: string | undefined) => {
      if (hex !== undefined) return String.fromCodePoint(Number.parseInt(hex, 16));
      if (decimal !== undefined) return String.fromCodePoint(Number.parseInt(decimal, 10));
      return (
        ({ quot: '"', apos: "'", lt: '<', gt: '>', amp: '&' } as Record<string, string>)[
          named ?? ''
        ] ?? _all
      );
    },
  );
}

const ASCII_IDENTIFIER_START = /^[A-Za-z_]$/u;
const ASCII_IDENTIFIER_CONTINUE = /^[A-Za-z0-9_]$/u;
const UNICODE_IDENTIFIER_START = /^[_\p{ID_Start}]$/u;
const UNICODE_IDENTIFIER_CONTINUE = /^[_\u200c\u200d\p{ID_Continue}]$/u;

function validIdentifier(
  value: string,
  start: RegExp,
  continuation: RegExp,
): boolean {
  const points = codePoints(value);
  if (points.length === 0 || !start.test(points[0] ?? '')) return false;
  for (let index = 1; index < points.length; index += 1) {
    if (!continuation.test(points[index] ?? '')) return false;
  }
  return true;
}

export const stringIsValidAsciiIdentifier = (value: string): boolean =>
  validIdentifier(value, ASCII_IDENTIFIER_START, ASCII_IDENTIFIER_CONTINUE);
export const stringIsValidUnicodeIdentifier = (value: string): boolean =>
  validIdentifier(value, UNICODE_IDENTIFIER_START, UNICODE_IDENTIFIER_CONTINUE);
export const stringIsValidInt = (value: string): boolean => /^[+-]?[0-9]+$/u.test(value);
export const stringIsValidFloat = (value: string): boolean =>
  /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/u.test(value);
export const stringIsValidHex = (value: string, withPrefix = false): boolean =>
  withPrefix ? /^[+-]?0x[0-9a-f]+$/u.test(value) : /^[+-]?[0-9a-f]+$/iu.test(value);
export const stringIsValidHtmlColor = (value: string): boolean =>
  /^#?(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/iu.test(value);
export const stringIsValidIp = (value: string): boolean => {
  if (value.includes(':')) return /^(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}$/iu.test(value);
  const parts = value.split('.');
  return (
    parts.length === 4 &&
    parts.every((part) => /^(?:0|[1-9][0-9]{0,2})$/u.test(part) && Number(part) <= 255)
  );
};

export function stringToInt(value: string): number | bigint {
  type ReadState = 'sign' | 'integer' | 'done';
  let parsed = 0n;
  let negative = false;
  let state: ReadState = 'sign';
  for (const char of codePoints(value)) {
    if (char === '.') break;
    if (state === 'done') break;
    if (state === 'sign') {
      if (char === '+' || char === '-') {
        negative = char === '-';
        state = 'integer';
        continue;
      }
      if (!/^[0-9]$/u.test(char)) continue;
      state = 'integer';
    }
    if (/^[0-9]$/u.test(char)) {
      parsed = parsed * 10n + BigInt(char);
      continue;
    }
    state = 'done';
  }
  const signed = BigInt.asIntN(64, negative ? -parsed : parsed);
  const number = Number(signed);
  return Number.isSafeInteger(number) ? number : signed;
}
export function stringToFloat(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}
export function stringBaseToInt(value: string, base: 2 | 16): number | bigint {
  const points = codePoints(value);
  let cursor = 0;
  let negative = false;
  if (points[cursor] === '-') {
    negative = true;
    cursor += 1;
  }
  if (
    points[cursor] === '0' &&
    (points[cursor + 1] === (base === 16 ? 'x' : 'b') || points[cursor + 1] === (base === 16 ? 'X' : 'B'))
  ) cursor += 2;
  let parsed = 0n;
  let valid = true;
  for (; cursor < points.length; cursor += 1) {
    const point = points[cursor] ?? '';
    const digit = point >= '0' && point <= '9'
      ? point.charCodeAt(0) - 48
      : point >= 'a' && point <= 'f'
        ? point.charCodeAt(0) - 87
        : point >= 'A' && point <= 'F'
          ? point.charCodeAt(0) - 55
          : -1;
    if (digit < 0 || digit >= base) {
      valid = false;
      break;
    }
    parsed = parsed * BigInt(base) + BigInt(digit);
  }
  if (!valid) return 0;
  const signed = BigInt.asIntN(64, negative ? -parsed : parsed);
  const number = Number(signed);
  return Number.isSafeInteger(number) ? number : signed;
}

export const stringAsciiBuffer = (value: string): number[] =>
  codePoints(value).map((char) => Math.min(char.codePointAt(0) ?? 0, 127));
export const stringUtf8Buffer = (value: string): number[] => [...utf8.encode(value)];
export function stringMultibyteBuffer(value: string, encoding = ''): number[] {
  const normalized = encoding.replace(/[-_]/gu, '').toLowerCase();
  if (normalized !== '' && normalized !== 'utf8') {
    throw new Error(
      `godot-compat: browser String.to_multibyte_char_buffer does not support ${encoding}`,
    );
  }
  return [...utf8.encode(value), 0];
}
export function stringUtf16Buffer(value: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < value.length; i += 1)
    out.push(value.charCodeAt(i) & 255, value.charCodeAt(i) >>> 8);
  return out;
}
export function stringUtf32Buffer(value: string): number[] {
  const out: number[] = [];
  for (const char of codePoints(value)) {
    const point = char.codePointAt(0) ?? 0;
    out.push(point & 255, (point >>> 8) & 255, (point >>> 16) & 255, point >>> 24);
  }
  return out;
}
export function stringHexDecode(value: string): number[] {
  if (value.length % 2 !== 0 || !/^[0-9a-f]*$/iu.test(value)) return [];
  return Array.from({ length: value.length / 2 }, (_, index) =>
    Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
  );
}
