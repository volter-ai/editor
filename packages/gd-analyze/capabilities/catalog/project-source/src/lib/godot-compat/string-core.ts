/** Core Godot 4.7 String algorithms, ported from `core/string/ustring.cpp`. */

import { godotObjectGet, godotObjectGetPropertyList } from './object';

export const codePoints = (value: string): string[] => [...value];
const code = (value: string): number => value.codePointAt(0) ?? 0;
const upper = (value: string): string => value.toUpperCase();

export function compareString(left: string, right: string, insensitive = false): number {
  const a = codePoints(insensitive ? upper(left) : left);
  const b = codePoints(insensitive ? upper(right) : right);
  const count = Math.min(a.length, b.length);
  for (let i = 0; i < count; i += 1) {
    const av = code(a[i] ?? '');
    const bv = code(b[i] ?? '');
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return a.length < b.length ? -1 : a.length > b.length ? 1 : 0;
}

function naturalCompareBase(left: string, right: string, insensitive: boolean): number {
  const a = codePoints(insensitive ? upper(left) : left);
  const b = codePoints(insensitive ? upper(right) : right);
  let i = 0;
  let j = 0;
  while ((a[i] === '.' || b[j] === '.') && (i < a.length || j < b.length)) {
    if (a[i++] !== '.') return 1;
    if (b[j++] !== '.') return -1;
    if (j >= b.length) return 1;
    if (i >= a.length) return -1;
  }
  while (i < a.length) {
    if (j >= b.length) return 1;
    const ac = a[i] ?? '';
    const bc = b[j] ?? '';
    if (/^[0-9]$/u.test(ac)) {
      if (!/^[0-9]$/u.test(bc)) return -1;
      let ai = i;
      let bj = j;
      while (/^[0-9]$/u.test(a[ai] ?? '')) ai += 1;
      while (/^[0-9]$/u.test(b[bj] ?? '')) bj += 1;
      let az = i;
      let bz = j;
      while (a[az] === '0') az += 1;
      while (b[bz] === '0') bz += 1;
      const al = ai - az;
      const bl = bj - bz;
      if (al !== bl) return al < bl ? -1 : 1;
      while (az < ai && bz < bj) {
        if (a[az] !== b[bz]) return (a[az] ?? '') < (b[bz] ?? '') ? -1 : 1;
        az += 1;
        bz += 1;
      }
      i = ai;
      j = bj;
      continue;
    }
    if (/^[0-9]$/u.test(bc)) return 1;
    if (ac !== bc) return ac < bc ? -1 : 1;
    i += 1;
    j += 1;
  }
  return j < b.length ? -1 : 0;
}

export function naturalCompareString(left: string, right: string, insensitive = false): number {
  return naturalCompareBase(left, right, insensitive);
}

export function fileCompareString(left: string, right: string, insensitive = false): number {
  const a = codePoints(left);
  const b = codePoints(right);
  let ai = 0;
  let bi = 0;
  while ((a[ai] === '_' && bi < b.length) || (ai < a.length && b[bi] === '_')) {
    if (a[ai] !== '_') return a[ai] === '.' ? -1 : 1;
    if (b[bi] !== '_') return b[bi] === '.' ? 1 : -1;
    ai += 1;
    bi += 1;
  }
  return naturalCompareBase(a.slice(ai).join(''), b.slice(bi).join(''), insensitive);
}

export function stringLength(value: string): number {
  return codePoints(value).length;
}

export function stringSubstr(value: string, from: number, length = -1): string {
  const points = codePoints(value);
  const start = Math.max(0, Math.trunc(from));
  return points
    .slice(start, length < 0 ? undefined : start + Math.max(0, Math.trunc(length)))
    .join('');
}

export function stringSlice(value: string, delimiter: string, slice: number): string {
  if (value.length === 0 || delimiter.length === 0 || slice < 0) return '';
  const parts = value.split(delimiter);
  return parts[Math.trunc(slice)] ?? '';
}

export function stringSliceC(value: string, delimiter: number, slice: number): string {
  return stringSlice(value, String.fromCodePoint(delimiter), slice);
}

export function stringSliceCount(value: string, delimiter: string): number {
  if (value.length === 0 || delimiter.length === 0) return 0;
  return value.split(delimiter).length;
}

export function stringFind(value: string, what: string, from = 0, insensitive = false): number {
  const haystack = codePoints(insensitive ? upper(value) : value);
  const needle = codePoints(insensitive ? upper(what) : what);
  const start = Math.max(0, Math.trunc(from));
  if (needle.length === 0) return start <= haystack.length ? start : -1;
  outer: for (let i = start; i + needle.length <= haystack.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

export function stringRfind(value: string, what: string, from = -1, insensitive = false): number {
  const haystack = codePoints(insensitive ? upper(value) : value);
  const needle = codePoints(insensitive ? upper(what) : what);
  let start = Math.trunc(from);
  if (start < 0 || start > haystack.length - needle.length) start = haystack.length - needle.length;
  if (needle.length === 0) return Math.max(0, start);
  outer: for (let i = start; i >= 0; i -= 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

export function stringCount(
  value: string,
  what: string,
  from = 0,
  to = 0,
  insensitive = false,
): number {
  if (what.length === 0) return 0;
  const points = codePoints(value);
  const end = to <= 0 ? points.length : Math.min(points.length, Math.trunc(to));
  let count = 0;
  let cursor = Math.max(0, Math.trunc(from));
  const step = codePoints(what).length;
  while (cursor < end) {
    const found = stringFind(points.slice(0, end).join(''), what, cursor, insensitive);
    if (found < 0) break;
    count += 1;
    cursor = found + step;
  }
  return count;
}

function globMatch(value: string, pattern: string, insensitive: boolean): boolean {
  if (value.length === 0 || pattern.length === 0) return false;
  const text = codePoints(insensitive ? upper(value) : value);
  const expr = codePoints(insensitive ? upper(pattern) : pattern);
  const memo = new Map<string, boolean>();
  const visit = (i: number, j: number): boolean => {
    const key = `${i}:${j}`;
    const known = memo.get(key);
    if (known !== undefined) return known;
    let result: boolean;
    if (j === expr.length) result = i === text.length;
    else if (expr[j] === '*') result = visit(i, j + 1) || (i < text.length && visit(i + 1, j));
    else if (i < text.length && ((expr[j] === '?' && text[i] !== '.') || expr[j] === text[i]))
      result = visit(i + 1, j + 1);
    else result = false;
    memo.set(key, result);
    return result;
  };
  return visit(0, 0);
}

export const stringMatch = globMatch;

export function stringIsSubsequence(value: string, text: string, insensitive = false): boolean {
  const needle = codePoints(insensitive ? upper(value) : value);
  const haystack = codePoints(insensitive ? upper(text) : text);
  let at = 0;
  for (const char of haystack) if (char === needle[at]) at += 1;
  return at === needle.length;
}

export function stringBigrams(value: string): string[] {
  const points = codePoints(value);
  return points.slice(0, -1).map((char, index) => char + (points[index + 1] ?? ''));
}

export function stringSimilarity(value: string, text: string): number {
  if (value === text) return 1;
  const left = stringBigrams(value);
  const right = stringBigrams(text);
  if (left.length === 0 || right.length === 0) return 0;
  let intersection = 0;
  for (const item of left) {
    if (right.includes(item)) intersection += 1;
  }
  return (2 * intersection) / (left.length + right.length);
}

interface FormatEntry {
  readonly key: string;
  readonly value: unknown;
}

function formatKey(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value === null || value === undefined) return '<null>';
  return godotStringify(value);
}

/**
 * Godot first converts Dictionary input into an Array of two-item Arrays. Array input is then
 * inspected one entry at a time: a two-item Array supplies an explicit key, while every other
 * Variant uses its numeric position. JavaScript objects are not Dictionary Variants and stay
 * loud instead of accidentally formatting enumerable host fields.
 */
function stringFormatEntries(values: unknown): FormatEntry[] {
  if (values instanceof Map) {
    return [...values].map(([key, entry]) => ({ key: formatKey(key), value: entry }));
  }
  if (typeof values === 'object' && values !== null && !Array.isArray(values)) {
    return godotObjectGetPropertyList(values).map((property) => ({
      key: property.name,
      value: godotObjectGet(values, property.name),
    }));
  }
  if (!Array.isArray(values)) {
    throw new TypeError('String.format values requires an Array, Dictionary, or Godot Object Variant.');
  }
  const entries: FormatEntry[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const entry = values[index];
    if (Array.isArray(entry)) {
      if (entry.length !== 2) {
        throw new Error(`String.format pair at index ${String(index)} must contain exactly two values.`);
      }
      entries.push({ key: formatKey(entry[0]), value: entry[1] });
    } else {
      entries.push({ key: String(index), value: entry });
    }
  }
  return entries;
}

export function stringFormat(value: string, values: unknown, placeholder: unknown = '{_}'): string {
  if (typeof placeholder !== 'string') throw new TypeError('String.format placeholder requires String.');
  const entries = stringFormatEntries(values);
  let result = value;
  for (const entry of entries) {
    const token = stringReplace(placeholder, '_', entry.key);
    result = stringReplace(result, token, godotStringify(entry.value));
  }
  return result;
}

export function stringReplace(
  value: string,
  what: string,
  replacement: string,
  insensitive = false,
): string {
  if (what.length === 0) return value;
  if (!insensitive) return value.split(what).join(replacement);
  let result = '';
  let cursor = 0;
  while (cursor < stringLength(value)) {
    const found = stringFind(value, what, cursor, true);
    if (found < 0) return result + stringSubstr(value, cursor);
    result += stringSubstr(value, cursor, found - cursor) + replacement;
    cursor = found + stringLength(what);
  }
  return result;
}

export function replaceChar(value: string, keys: string, replacement: number): string {
  const set = new Set(codePoints(keys));
  const next = String.fromCodePoint(replacement);
  return codePoints(value)
    .map((char) => (set.has(char) ? next : char))
    .join('');
}

export function removeChars(value: string, chars: string): string {
  const set = new Set(codePoints(chars));
  return codePoints(value)
    .filter((char) => !set.has(char))
    .join('');
}

export function stringInsert(value: string, position: number, what: string): string {
  if (what.length === 0 || position < 0) return value;
  const points = codePoints(value);
  const at = Math.min(points.length, Math.trunc(position));
  return [...points.slice(0, at), ...codePoints(what), ...points.slice(at)].join('');
}

export function stringRepeat(value: string, count: number): string {
  if (!Number.isSafeInteger(count)) throw new TypeError('String.repeat count requires int.');
  return count <= 0 ? '' : value.repeat(count);
}

/** Godot counts String positions in UTF-32 code points, including the negative-length forms. */
export function stringLeft(value: string, length: number): string {
  const points = codePoints(value);
  const count = length < 0 ? Math.max(0, points.length + length) : Math.min(points.length, length);
  return points.slice(0, count).join('');
}

export function stringRight(value: string, length: number): string {
  const points = codePoints(value);
  const start = length < 0 ? Math.min(points.length, -length) : Math.max(0, points.length - length);
  return points.slice(start).join('');
}

export function stringErase(value: string, position: number, chars = 1): string {
  const points = codePoints(value);
  const at = Math.max(0, Math.trunc(position));
  return [...points.slice(0, at), ...points.slice(at + Math.max(0, Math.trunc(chars)))].join('');
}

function separateCompoundWords(value: string): string {
  const chars = codePoints(value);
  if (chars.length === 0) return value;
  const out: string[] = [chars[0] ?? ''];
  const isUpper = (char: string): boolean =>
    char !== char.toLowerCase() && char === char.toUpperCase();
  const isLower = (char: string): boolean =>
    char !== char.toUpperCase() && char === char.toLowerCase();
  const isDigit = (char: string): boolean => /^[0-9]$/u.test(char);
  for (let i = 1; i < chars.length; i += 1) {
    const previous = chars[i - 1] ?? '';
    const current = chars[i] ?? '';
    const next = chars[i + 1] ?? '';
    const boundary =
      (isLower(previous) && isUpper(current)) ||
      ((isUpper(previous) || isDigit(previous)) && isUpper(current) && isLower(next)) ||
      (isDigit(previous) && isLower(current) && isLower(next)) ||
      ((isUpper(previous) || isLower(previous)) && isDigit(current));
    if (boundary) out.push(' ');
    out.push(/[\s_-]/u.test(current) ? ' ' : current);
  }
  return out.join('').toLowerCase();
}

const words = (value: string): string[] =>
  separateCompoundWords(value).trim().split(/ +/u).filter(Boolean);
const title = (value: string): string => {
  const chars = codePoints(value);
  if (chars.length > 0) chars[0] = upper(chars[0] ?? '');
  return chars.join('');
};

export const stringCapitalize = (value: string): string => words(value).map(title).join(' ');
export const stringCamel = (value: string): string =>
  words(value)
    .map((word, index) => (index === 0 ? word : title(word)))
    .join('');
export const stringPascal = (value: string): string => words(value).map(title).join('');
export const stringSnake = (value: string): string => words(value).join('_');
export const stringKebab = (value: string): string => words(value).join('-');

export function stringSplit(
  value: string,
  delimiter = '',
  allowEmpty = true,
  maxSplit = 0,
): string[] {
  const points = codePoints(value);
  if (points.length === 0) return allowEmpty ? [''] : [];
  const result: string[] = [];
  let from = 0;
  const delimiterLength = stringLength(delimiter);
  while (true) {
    const end = delimiter.length === 0 ? from + 1 : stringFind(value, delimiter, from);
    const actualEnd = end < 0 ? points.length : end;
    if (allowEmpty || actualEnd > from) {
      if (maxSplit > 0 && maxSplit === result.length) {
        result.push(stringSubstr(value, from));
        break;
      }
      result.push(stringSubstr(value, from, actualEnd - from));
    }
    if (actualEnd === points.length) break;
    from = actualEnd + delimiterLength;
  }
  return result;
}

export function stringRsplit(
  value: string,
  delimiter = '',
  allowEmpty = true,
  maxSplit = 0,
): string[] {
  const result: string[] = [];
  const delimiterLength = stringLength(delimiter);
  let remaining = stringLength(value);
  while (true) {
    if (remaining < delimiterLength || (maxSplit > 0 && maxSplit === result.length)) {
      if (allowEmpty || remaining > 0) result.push(stringSubstr(value, 0, remaining));
      break;
    }
    let edge =
      delimiter.length === 0
        ? remaining - 1
        : stringRfind(value, delimiter, remaining - delimiterLength);
    if (delimiter.length === 0 && edge === 0) edge = -1;
    if (edge < 0) {
      result.push(stringSubstr(value, 0, remaining));
      break;
    }
    const start = edge + delimiterLength;
    if (allowEmpty || start < remaining) result.push(stringSubstr(value, start, remaining - start));
    remaining = edge;
  }
  return result.reverse();
}

export function stringStripEdges(value: string, left = true, right = true): string {
  const whitespace = (char: string): boolean => code(char) <= 32;
  const chars = codePoints(value);
  let start = 0;
  let end = chars.length;
  if (left) while (start < end && whitespace(chars[start] ?? '')) start += 1;
  if (right) while (end > start && whitespace(chars[end - 1] ?? '')) end -= 1;
  return chars.slice(start, end).join('');
}

export function stringStripEscapes(value: string): string {
  return codePoints(value)
    .filter((char) => code(char) >= 32)
    .join('');
}

export function stringStrip(value: string, chars: string, left: boolean): string {
  const set = new Set(codePoints(chars));
  const points = codePoints(value);
  if (left) while (points.length > 0 && set.has(points[0] ?? '')) points.shift();
  else while (points.length > 0 && set.has(points[points.length - 1] ?? '')) points.pop();
  return points.join('');
}

export function stringIndent(value: string, prefix: string): string {
  const lines = value.split('\n');
  return lines.map((line) => (line.length > 0 ? prefix + line : line)).join('\n');
}

export function stringDedent(value: string): string {
  const lines = value.split('\n');
  let indent = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const width = /^\s*/u.exec(line)?.[0].length ?? 0;
    indent = Math.min(indent, width);
  }
  if (!Number.isFinite(indent) || indent === 0) return value;
  return lines.map((line) => (line.trim().length === 0 ? '' : line.slice(indent))).join('\n');
}

export function godotStringify(value: unknown): string {
  if (value === null || value === undefined) return '<null>';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) return `[${value.map(godotStringify).join(', ')}]`;
  if (value instanceof Map) {
    return `{ ${[...value.entries()].map(([key, item]) => `${godotStringify(key)}: ${godotStringify(item)}`).join(', ')} }`;
  }
  const object = value as Record<string, unknown>;
  if ('r' in object && 'g' in object && 'b' in object) {
    return `(${object['r']}, ${object['g']}, ${object['b']}, ${object['a']})`;
  }
  if ('x' in object && 'y' in object) {
    const parts = ['x', 'y', 'z', 'w'].filter((key) => key in object).map((key) => object[key]);
    return `(${parts.join(', ')})`;
  }
  return String(value);
}
