/** Godot 4.7 String numeric, padding, and `%` formatting protocol. */

import { codePoints, godotStringify, stringLength, stringSubstr } from './string-core';

const asBigInt = (value: number | bigint): bigint =>
  typeof value === 'bigint' ? value : BigInt(Math.trunc(value));

export function stringNumInt(
  value: number | bigint,
  base = 10,
  capitalizeHex = false,
  unsigned = false,
): string {
  if (base < 2 || base > 36) return '';
  let integer = unsigned ? BigInt.asUintN(64, asBigInt(value)) : BigInt.asIntN(64, asBigInt(value));
  const negative = !unsigned && integer < 0;
  if (negative) integer = -integer;
  let result = integer.toString(base);
  if (capitalizeHex) result = result.toUpperCase();
  return negative ? `-${result}` : result;
}

export function stringNum(value: number, decimals = -1): string {
  if (Number.isNaN(value)) return 'nan';
  if (value === Number.POSITIVE_INFINITY) return 'inf';
  if (value === Number.NEGATIVE_INFINITY) return '-inf';
  if (decimals >= 0) return value.toFixed(Math.max(0, Math.min(32, Math.trunc(decimals))));
  if (Number.isInteger(value)) return String(value);
  return Number(value.toPrecision(14)).toString();
}

export function stringNumScientific(value: number): string {
  if (!Number.isFinite(value)) return stringNum(value, 0);
  return value.toString().replace(/e\+/u, 'e+');
}

export function stringHumanizeSize(value: number | bigint): string {
  const size = BigInt.asUintN(64, asBigInt(value));
  let divisor = 1n;
  let magnitude = 0;
  while (size >= divisor * 1024n && magnitude < 6) {
    divisor *= 1024n;
    magnitude += 1;
  }
  if (magnitude === 0) return `${size} B`;
  const rounded = Number(size) / Number(divisor);
  const digits = rounded < 100 ? 2 : rounded < 1024 ? 1 : 0;
  return `${rounded.toFixed(digits)} ${['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB'][magnitude]}`;
}

export function stringPad(value: string, minimum: number, character = ' ', left = true): string {
  const needed = Math.max(0, Math.trunc(minimum) - stringLength(value));
  if (needed === 0 || character.length === 0) return value;
  const chars = codePoints(character);
  let padding = '';
  for (let i = 0; i < needed; i += 1) padding += chars[i % chars.length] ?? '';
  return left ? padding + value : value + padding;
}

export function stringPadDecimals(value: string, digits: number): string {
  const count = Math.max(0, Math.trunc(digits));
  let result = value;
  let dot = result.indexOf('.');
  if (dot < 0) {
    if (count === 0) return result;
    result += '.';
    dot = result.length - 1;
  } else if (count === 0) return result.slice(0, dot);
  const decimals = result.length - dot - 1;
  return decimals > count
    ? result.slice(0, dot + count + 1)
    : result + '0'.repeat(count - decimals);
}

export function stringPadZeros(value: string, digits: number): string {
  const count = Math.max(0, Math.trunc(digits));
  const sign = /^[+-]/u.test(value) ? (value[0] ?? '') : '';
  const body = sign.length > 0 ? value.slice(1) : value;
  const dot = body.search(/[.eE]/u);
  const integers = dot < 0 ? body.length : dot;
  return sign + '0'.repeat(Math.max(0, count - integers)) + body;
}

export function stringTrimPrefix(value: string, prefix: string): string {
  return prefix.length > 0 && value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

export function stringTrimSuffix(value: string, suffix: string): string {
  return suffix.length > 0 && value.endsWith(suffix) ? value.slice(0, -suffix.length) : value;
}

function formatOne(spec: string, value: unknown): string {
  const parsed = /^%([+\-0 ]*)(\d+)?(?:\.(\d+))?([scdiouxXfegv%])$/u.exec(spec);
  if (parsed === null) return spec;
  const flags = parsed[1] ?? '';
  const width = Number(parsed[2] ?? 0);
  const precision = parsed[3] === undefined ? undefined : Number(parsed[3]);
  const kind = parsed[4] ?? 's';
  if (kind === '%') return '%';
  let result: string;
  if (kind === 's') result = godotStringify(value);
  else if (kind === 'c') result = String.fromCodePoint(Number(value));
  else if (kind === 'd' || kind === 'i') result = stringNumInt(Number(value));
  else if (kind === 'u') result = stringNumInt(Number(value), 10, false, true);
  else if (kind === 'o') result = stringNumInt(Number(value), 8, false, true);
  else if (kind === 'x' || kind === 'X')
    result = stringNumInt(Number(value), 16, kind === 'X', true);
  else if (kind === 'f') result = Number(value).toFixed(precision ?? 6);
  else if (kind === 'e') result = Number(value).toExponential(precision ?? 6);
  else if (kind === 'g')
    result = Number(value)
      .toPrecision(precision ?? 6)
      .replace(/(?:\.0+|(?:(\.\d*?)0+))(?=e|$)/u, '$1');
  else result = godotStringify(value);
  if (precision !== undefined && kind === 's') result = stringSubstr(result, 0, precision);
  if ('+ diufeg'.includes(kind) && Number(value) >= 0 && flags.includes('+')) result = `+${result}`;
  if (width > stringLength(result)) {
    const pad = flags.includes('0') && !flags.includes('-') ? '0' : ' ';
    const fill = pad.repeat(width - stringLength(result));
    result = flags.includes('-') ? result + fill : fill + result;
  }
  return result;
}

export function godotStringPercent(format: string, input: unknown): string {
  const values = Array.isArray(input) ? input : [input];
  let index = 0;
  return format.replace(/%%|%[+\-0 ]*\d*(?:\.\d+)?[scdiouxXfegv]/gu, (spec) => {
    if (spec === '%%') return '%';
    return formatOne(spec, values[index++]);
  });
}
