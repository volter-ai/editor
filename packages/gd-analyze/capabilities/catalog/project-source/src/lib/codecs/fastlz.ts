/**
 * FastLZ 0.5.0 block codec.
 *
 * This is a direct TypeScript port of the MIT-licensed reference implementation vendored at
 * Godot 4.7-stable `thirdparty/misc/fastlz.c` (revision 5b4e0cb0). It deliberately lives outside
 * godot-compat: the codec is general supply; Godot's mode selection and error protocol are not.
 *
 * Original implementation copyright (C) 2005-2020 Ariya Hidayat.
 */

const MAX_COPY = 32;
const MAX_LEN = 264;
const MAX_L1_DISTANCE = 8192;
const MAX_L2_DISTANCE = 8191;
const MAX_FAR_DISTANCE = 65_535 + MAX_L2_DISTANCE - 1;
const HASH_LOG = 13;
const HASH_SIZE = 1 << HASH_LOG;
const HASH_MASK = HASH_SIZE - 1;

function readU16(input: Uint8Array, offset: number): number {
  return (input[offset] ?? 0) | ((input[offset + 1] ?? 0) << 8);
}

function hash(input: Uint8Array, offset: number): number {
  let value = readU16(input, offset);
  value ^= readU16(input, offset + 1) ^ (value >>> (16 - HASH_LOG));
  return value & HASH_MASK;
}

function compressLevel(input: Uint8Array, level: 1 | 2): Uint8Array {
  const length = input.length;
  const output = new Uint8Array(length + 66 + Math.floor((length * 5) / 100));
  if (length === 0) return output.subarray(0, 0);
  if (length < 4) {
    output[0] = length - 1;
    output.set(input, 1);
    return output.subarray(0, length + 1);
  }

  const table = new Uint32Array(HASH_SIZE);
  const inputBound = length - 2;
  // The reference uses `ip + length - 12 - 1`, not the looser `length - 12`.
  const inputLimit = length - 13;
  let inputAt = 0;
  let outputAt = 0;
  let copy = 2;
  output[outputAt++] = MAX_COPY - 1;
  output[outputAt++] = input[inputAt++] as number;
  output[outputAt++] = input[inputAt++] as number;

  while (inputAt < inputLimit) {
    const anchor = inputAt;
    let reference = 0;
    let distance = 0;
    let matchLength = 3;
    let matched = false;

    if (
      level === 2 &&
      input[inputAt] === input[inputAt - 1] &&
      input[inputAt] === input[inputAt + 1] &&
      input[inputAt + 1] === input[inputAt + 2]
    ) {
      distance = 1;
      inputAt += 3;
      reference = anchor + 2;
      matched = true;
    }

    if (!matched) {
      const slot = hash(input, inputAt);
      reference = table[slot] as number;
      table[slot] = anchor;
      distance = anchor - reference;
      if (
        distance === 0 ||
        (level === 1 ? distance >= MAX_L1_DISTANCE : distance >= MAX_FAR_DISTANCE) ||
        input[reference++] !== input[inputAt++] ||
        input[reference++] !== input[inputAt++] ||
        input[reference++] !== input[inputAt++]
      ) {
        output[outputAt++] = input[anchor] as number;
        inputAt = anchor + 1;
        copy += 1;
        if (copy === MAX_COPY) {
          copy = 0;
          output[outputAt++] = MAX_COPY - 1;
        }
        continue;
      }
      if (level === 2 && distance >= MAX_L2_DISTANCE) {
        if (input[inputAt++] !== input[reference++] || input[inputAt++] !== input[reference++]) {
          output[outputAt++] = input[anchor] as number;
          inputAt = anchor + 1;
          copy += 1;
          if (copy === MAX_COPY) {
            copy = 0;
            output[outputAt++] = MAX_COPY - 1;
          }
          continue;
        }
        matchLength += 2;
      }
    }

    inputAt = anchor + matchLength;
    distance -= 1;
    if (distance === 0) {
      const repeated = input[inputAt - 1] as number;
      while (inputAt < inputBound) {
        if (input[reference++] !== repeated) break;
        inputAt += 1;
      }
    } else {
      for (;;) {
        if (input[reference++] !== input[inputAt++]) break;
        if (input[reference++] !== input[inputAt++]) break;
        if (input[reference++] !== input[inputAt++]) break;
        if (input[reference++] !== input[inputAt++]) break;
        if (input[reference++] !== input[inputAt++]) break;
        if (input[reference++] !== input[inputAt++]) break;
        if (input[reference++] !== input[inputAt++]) break;
        if (input[reference++] !== input[inputAt++]) break;
        while (inputAt < inputBound) {
          if (input[reference++] !== input[inputAt++]) break;
        }
        break;
      }
    }

    if (copy !== 0) output[outputAt - copy - 1] = copy - 1;
    else outputAt -= 1;
    copy = 0;
    inputAt -= 3;
    let lengthCode = inputAt - anchor;

    if (level === 1) {
      while (lengthCode > MAX_LEN - 2) {
        output[outputAt++] = (7 << 5) + (distance >> 8);
        output[outputAt++] = MAX_LEN - 2 - 7 - 2;
        output[outputAt++] = distance & 255;
        lengthCode -= MAX_LEN - 2;
      }
      if (lengthCode < 7) {
        output[outputAt++] = (lengthCode << 5) + (distance >> 8);
        output[outputAt++] = distance & 255;
      } else {
        output[outputAt++] = (7 << 5) + (distance >> 8);
        output[outputAt++] = lengthCode - 7;
        output[outputAt++] = distance & 255;
      }
    } else if (distance < MAX_L2_DISTANCE) {
      if (lengthCode < 7) {
        output[outputAt++] = (lengthCode << 5) + (distance >> 8);
        output[outputAt++] = distance & 255;
      } else {
        output[outputAt++] = (7 << 5) + (distance >> 8);
        for (lengthCode -= 7; lengthCode >= 255; lengthCode -= 255) output[outputAt++] = 255;
        output[outputAt++] = lengthCode;
        output[outputAt++] = distance & 255;
      }
    } else {
      distance -= MAX_L2_DISTANCE;
      if (lengthCode < 7) {
        output[outputAt++] = (lengthCode << 5) + 31;
      } else {
        output[outputAt++] = (7 << 5) + 31;
        for (lengthCode -= 7; lengthCode >= 255; lengthCode -= 255) output[outputAt++] = 255;
        output[outputAt++] = lengthCode;
      }
      output[outputAt++] = 255;
      output[outputAt++] = distance >> 8;
      output[outputAt++] = distance & 255;
    }

    let slot = hash(input, inputAt);
    table[slot] = inputAt++;
    slot = hash(input, inputAt);
    table[slot] = inputAt++;
    output[outputAt++] = MAX_COPY - 1;
  }

  const finalInput = inputBound + 1;
  while (inputAt <= finalInput) {
    output[outputAt++] = input[inputAt++] as number;
    copy += 1;
    if (copy === MAX_COPY) {
      copy = 0;
      output[outputAt++] = MAX_COPY - 1;
    }
  }
  if (copy !== 0) output[outputAt - copy - 1] = copy - 1;
  else outputAt -= 1;
  if (level === 2) output[0] = (output[0] as number) | (1 << 5);
  return output.subarray(0, outputAt);
}

function copyMatch(output: Uint8Array, at: number, reference: number, length: number): number {
  for (let index = 0; index < length; index += 1)
    output[at + index] = output[reference + index] as number;
  return at + length;
}

function decompressLevel(
  input: Uint8Array,
  maximumOutput: number,
  level: 1 | 2,
): Uint8Array | null {
  if (input.length === 0 || maximumOutput < 0) return null;
  const output = new Uint8Array(maximumOutput);
  const inputLimit = input.length;
  const inputBound = inputLimit - 2;
  let inputAt = 1;
  let outputAt = 0;
  let control = (input[0] as number) & 31;

  for (;;) {
    if (control >= 32) {
      let length = (control >> 5) - 1;
      let offset = (control & 31) << 8;
      let reference = outputAt - offset - 1;
      if (length === 6) {
        if (level === 1) {
          if (inputAt > inputBound) return null;
          length += input[inputAt++] as number;
        } else {
          let code = 0;
          do {
            if (inputAt > inputBound) return null;
            code = input[inputAt++] as number;
            length += code;
          } while (code === 255);
        }
      }
      if (inputAt >= inputLimit) return null;
      const distanceCode = input[inputAt++] as number;
      reference -= distanceCode;
      length += 3;
      if (level === 2 && distanceCode === 255 && offset === 31 << 8) {
        if (inputAt >= inputBound) return null;
        offset = ((input[inputAt++] as number) << 8) + (input[inputAt++] as number);
        reference = outputAt - offset - MAX_L2_DISTANCE - 1;
      }
      if (outputAt + length > maximumOutput || reference < 0) return null;
      outputAt = copyMatch(output, outputAt, reference, length);
    } else {
      const length = control + 1;
      if (outputAt + length > maximumOutput || inputAt + length > inputLimit) return null;
      output.set(input.subarray(inputAt, inputAt + length), outputAt);
      inputAt += length;
      outputAt += length;
    }
    if (level === 1 ? inputAt > inputBound : inputAt >= inputLimit) break;
    control = input[inputAt++] as number;
  }
  return output.subarray(0, outputAt);
}

/** Encode exactly the byte stream produced by the pinned FastLZ reference implementation. */
export function fastLzCompress(input: Uint8Array): Uint8Array {
  return compressLevel(input, input.length < 65_536 ? 1 : 2);
}

/** Decode a FastLZ block into an exact caller-owned maximum output size. */
export function fastLzDecompress(input: Uint8Array, maximumOutput: number): Uint8Array | null {
  if (input.length === 0) return null;
  const level = ((input[0] as number) >> 5) + 1;
  return level === 1 || level === 2 ? decompressLevel(input, maximumOutput, level) : null;
}
