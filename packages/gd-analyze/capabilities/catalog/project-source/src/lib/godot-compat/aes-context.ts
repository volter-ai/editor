/** Synchronous AES-ECB/AES-CBC context matching Godot's no-padding block API. */

import { registerGodotObjectIdentity } from './object';
import { packedByteArray, type PackedByteArray } from './packed-array';

export const GODOT_AES_MODE_ECB_ENCRYPT = 0;
export const GODOT_AES_MODE_ECB_DECRYPT = 1;
export const GODOT_AES_MODE_CBC_ENCRYPT = 2;
export const GODOT_AES_MODE_CBC_DECRYPT = 3;
export const GODOT_AES_MODE_MAX = 4;

type OwnedBytes = Uint8Array<ArrayBuffer>;

/** Copy arbitrary typed-array storage into memory this AESContext exclusively owns and can wipe. */
function ownBytes(value: Uint8Array<ArrayBufferLike>): OwnedBytes {
  const owned = new Uint8Array(value.byteLength);
  owned.set(value);
  return owned;
}

function gfMultiply(left: number, right: number): number {
  let a = left & 0xff;
  let b = right & 0xff;
  let result = 0;
  while (b !== 0) {
    if ((b & 1) !== 0) result ^= a;
    a = ((a << 1) ^ ((a & 0x80) !== 0 ? 0x11b : 0)) & 0xff;
    b >>>= 1;
  }
  return result;
}

function gfPower(value: number, exponent: number): number {
  let result = 1;
  let base = value;
  let power = exponent;
  while (power > 0) {
    if ((power & 1) !== 0) result = gfMultiply(result, base);
    base = gfMultiply(base, base);
    power >>>= 1;
  }
  return result;
}

function rotateByte(value: number, amount: number): number {
  return ((value << amount) | (value >>> (8 - amount))) & 0xff;
}

function createSboxes(): { readonly forward: OwnedBytes; readonly inverse: OwnedBytes } {
  const forward = new Uint8Array(256);
  const inverse = new Uint8Array(256);
  for (let value = 0; value < 256; value += 1) {
    const reciprocal = value === 0 ? 0 : gfPower(value, 254);
    const transformed = reciprocal ^ rotateByte(reciprocal, 1) ^ rotateByte(reciprocal, 2) ^
      rotateByte(reciprocal, 3) ^ rotateByte(reciprocal, 4) ^ 0x63;
    forward[value] = transformed;
    inverse[transformed] = value;
  }
  return { forward, inverse };
}

const SBOXES = createSboxes();

function bytes(value: unknown, member: string): OwnedBytes {
  if (value instanceof Uint8Array) return ownBytes(value);
  if (Array.isArray(value)) {
    if (!value.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255)) {
      throw new RangeError(`AESContext.${member} requires byte values in 0..255.`);
    }
    return Uint8Array.from(value);
  }
  throw new TypeError(`AESContext.${member} requires PackedByteArray.`);
}

function expandKey(key: Uint8Array<ArrayBufferLike>): { readonly rounds: number; readonly bytes: OwnedBytes } {
  const words = key.length / 4;
  const rounds = words + 6;
  const expanded = new Uint8Array(16 * (rounds + 1));
  expanded.set(key);
  const temp = new Uint8Array(4);
  let generated = key.length;
  let rcon = 1;
  while (generated < expanded.length) {
    temp.set(expanded.subarray(generated - 4, generated));
    if (generated % key.length === 0) {
      const first = temp[0]!;
      temp[0] = SBOXES.forward[temp[1]!]! ^ rcon;
      temp[1] = SBOXES.forward[temp[2]!]!;
      temp[2] = SBOXES.forward[temp[3]!]!;
      temp[3] = SBOXES.forward[first]!;
      rcon = gfMultiply(rcon, 2);
    } else if (words > 6 && generated % key.length === 16) {
      for (let index = 0; index < 4; index += 1) temp[index] = SBOXES.forward[temp[index]!]!;
    }
    for (let index = 0; index < 4; index += 1) {
      expanded[generated] = expanded[generated - key.length]! ^ temp[index]!;
      generated += 1;
    }
  }
  return { rounds, bytes: expanded };
}

function addRoundKey(
  state: Uint8Array<ArrayBufferLike>,
  expanded: Uint8Array<ArrayBufferLike>,
  round: number,
): void {
  const offset = round * 16;
  for (let index = 0; index < 16; index += 1) {
    state[index] = state[index]! ^ expanded[offset + index]!;
  }
}

function substitute(state: Uint8Array<ArrayBufferLike>, box: Uint8Array<ArrayBufferLike>): void {
  for (let index = 0; index < 16; index += 1) state[index] = box[state[index]!]!;
}

function shiftRows(state: Uint8Array<ArrayBufferLike>): void {
  const copy = ownBytes(state);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      state[column * 4 + row] = copy[((column + row) & 3) * 4 + row]!;
    }
  }
}

function inverseShiftRows(state: Uint8Array<ArrayBufferLike>): void {
  const copy = ownBytes(state);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      state[column * 4 + row] = copy[((column - row + 4) & 3) * 4 + row]!;
    }
  }
}

function mixColumns(state: Uint8Array<ArrayBufferLike>): void {
  for (let column = 0; column < 4; column += 1) {
    const offset = column * 4;
    const a = state[offset]!, b = state[offset + 1]!, c = state[offset + 2]!, d = state[offset + 3]!;
    state[offset] = gfMultiply(a, 2) ^ gfMultiply(b, 3) ^ c ^ d;
    state[offset + 1] = a ^ gfMultiply(b, 2) ^ gfMultiply(c, 3) ^ d;
    state[offset + 2] = a ^ b ^ gfMultiply(c, 2) ^ gfMultiply(d, 3);
    state[offset + 3] = gfMultiply(a, 3) ^ b ^ c ^ gfMultiply(d, 2);
  }
}

function inverseMixColumns(state: Uint8Array<ArrayBufferLike>): void {
  for (let column = 0; column < 4; column += 1) {
    const offset = column * 4;
    const a = state[offset]!, b = state[offset + 1]!, c = state[offset + 2]!, d = state[offset + 3]!;
    state[offset] = gfMultiply(a, 14) ^ gfMultiply(b, 11) ^ gfMultiply(c, 13) ^ gfMultiply(d, 9);
    state[offset + 1] = gfMultiply(a, 9) ^ gfMultiply(b, 14) ^ gfMultiply(c, 11) ^ gfMultiply(d, 13);
    state[offset + 2] = gfMultiply(a, 13) ^ gfMultiply(b, 9) ^ gfMultiply(c, 14) ^ gfMultiply(d, 11);
    state[offset + 3] = gfMultiply(a, 11) ^ gfMultiply(b, 13) ^ gfMultiply(c, 9) ^ gfMultiply(d, 14);
  }
}

function encryptBlock(
  block: Uint8Array<ArrayBufferLike>,
  expanded: Uint8Array<ArrayBufferLike>,
  rounds: number,
): OwnedBytes {
  const state = ownBytes(block);
  addRoundKey(state, expanded, 0);
  for (let round = 1; round < rounds; round += 1) {
    substitute(state, SBOXES.forward);
    shiftRows(state);
    mixColumns(state);
    addRoundKey(state, expanded, round);
  }
  substitute(state, SBOXES.forward);
  shiftRows(state);
  addRoundKey(state, expanded, rounds);
  return state;
}

function decryptBlock(
  block: Uint8Array<ArrayBufferLike>,
  expanded: Uint8Array<ArrayBufferLike>,
  rounds: number,
): OwnedBytes {
  const state = ownBytes(block);
  addRoundKey(state, expanded, rounds);
  for (let round = rounds - 1; round > 0; round -= 1) {
    inverseShiftRows(state);
    substitute(state, SBOXES.inverse);
    addRoundKey(state, expanded, round);
    inverseMixColumns(state);
  }
  inverseShiftRows(state);
  substitute(state, SBOXES.inverse);
  addRoundKey(state, expanded, 0);
  return state;
}

export class GodotAESContext {
  private mode: number | null = null;
  private expanded: OwnedBytes = new Uint8Array();
  private rounds = 0;
  private iv: OwnedBytes = new Uint8Array(16);

  constructor() { registerGodotObjectIdentity(this, 'AESContext'); }

  start(modeValue: unknown, keyValue: unknown, ivValue: unknown = []): number {
    if (this.mode !== null) return 22;
    if (typeof modeValue !== 'number' || !Number.isInteger(modeValue) || modeValue < 0 || modeValue >= GODOT_AES_MODE_MAX) return 31;
    const key = bytes(keyValue, 'start key');
    if (key.length !== 16 && key.length !== 24 && key.length !== 32) return 31;
    const mode = modeValue;
    const iv = bytes(ivValue, 'start iv');
    if ((mode === GODOT_AES_MODE_CBC_ENCRYPT || mode === GODOT_AES_MODE_CBC_DECRYPT) && iv.length !== 16) return 31;
    const schedule = expandKey(key);
    this.mode = mode;
    this.expanded = schedule.bytes;
    this.rounds = schedule.rounds;
    this.iv = iv.length === 16 ? iv : new Uint8Array(16);
    return 0;
  }

  update(sourceValue: unknown): PackedByteArray {
    if (this.mode === null) return packedByteArray();
    const source = bytes(sourceValue, 'update');
    if (source.length % 16 !== 0) {
      throw new RangeError('AESContext.update source length must be a multiple of 16 bytes.');
    }
    const output = new Uint8Array(source.length);
    const encrypting = this.mode === GODOT_AES_MODE_ECB_ENCRYPT || this.mode === GODOT_AES_MODE_CBC_ENCRYPT;
    const cbc = this.mode === GODOT_AES_MODE_CBC_ENCRYPT || this.mode === GODOT_AES_MODE_CBC_DECRYPT;
    for (let offset = 0; offset < source.length; offset += 16) {
      const input = source.slice(offset, offset + 16);
      if (cbc && encrypting) {
        for (let index = 0; index < 16; index += 1) {
          input[index] = input[index]! ^ this.iv[index]!;
        }
      }
      const transformed = encrypting
        ? encryptBlock(input, this.expanded, this.rounds)
        : decryptBlock(input, this.expanded, this.rounds);
      if (cbc && !encrypting) {
        for (let index = 0; index < 16; index += 1) {
          transformed[index] = transformed[index]! ^ this.iv[index]!;
        }
      }
      output.set(transformed, offset);
      if (cbc) this.iv = encrypting ? ownBytes(transformed) : input;
    }
    return packedByteArray(output);
  }

  get_iv_state(): PackedByteArray { return packedByteArray(this.iv); }

  finish(): void {
    this.mode = null;
    this.expanded.fill(0);
    this.expanded = new Uint8Array();
    this.rounds = 0;
    this.iv.fill(0);
    this.iv = new Uint8Array(16);
  }
}

export function createGodotAESContext(): GodotAESContext { return new GodotAESContext(); }
