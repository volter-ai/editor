/**
 * Godot's browser Time singleton over the platform's monotonic and civil clocks.
 *
 * Authority: pinned Godot 3.6/4.7 `core/os/time.cpp`. Unix conversions are UTC,
 * system dictionaries honor the authored `utc` argument, weekdays are Sunday=0,
 * and tick counters are monotonic rather than wall-clock derived.
 */

import { packedStringArray, type PackedArrayValue } from './packed-array';

export type GodotDateTimeDictionary = Map<string, number | boolean | string>;

const SECOND_MS = 1_000;

function bool(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`Time.${member} requires a boolean.`);
  return value;
}

function unixSeconds(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new RangeError(`Time.${member} requires an exactly represented integer Unix timestamp.`);
  }
  return value;
}

function dateFromUnix(value: unknown, member: string): Date {
  const date = new Date(unixSeconds(value, member) * SECOND_MS);
  if (Number.isNaN(date.valueOf())) {
    throw new RangeError(`Time.${member} timestamp is outside the browser Date domain.`);
  }
  return date;
}

function datetimeField(
  source: unknown,
  key: string,
  fallback: number | undefined,
  member: string,
): number {
  const value = source instanceof Map
    ? source.get(key)
    : typeof source === 'object' && source !== null
      ? Reflect.get(source, key)
      : undefined;
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TypeError(`Time.${member} requires integer Dictionary field ${key}.`);
  }
  return value;
}

function dateFromDatetimeDictionary(source: unknown, member: string): Date {
  const year = datetimeField(source, 'year', undefined, member);
  const month = datetimeField(source, 'month', undefined, member);
  const day = datetimeField(source, 'day', undefined, member);
  const hour = datetimeField(source, 'hour', 0, member);
  const minute = datetimeField(source, 'minute', 0, member);
  const second = datetimeField(source, 'second', 0, member);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
    throw new RangeError(`Time.${member} received an invalid UTC date/time Dictionary.`);
  }
  // Date.UTC treats years 0..99 as 1900..1999. setUTCFullYear preserves Godot's literal year.
  const date = new Date(0);
  date.setUTCHours(hour, minute, second, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) {
    throw new RangeError(`Time.${member} received a calendar date that does not exist.`);
  }
  return date;
}

function localDst(date: Date): boolean {
  const january = new Date(date.getFullYear(), 0, 1).getTimezoneOffset();
  const july = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
  return date.getTimezoneOffset() < Math.max(january, july);
}

function dictionary(date: Date, utc: boolean, part: 'date' | 'time' | 'datetime'): GodotDateTimeDictionary {
  const result: GodotDateTimeDictionary = new Map();
  if (part !== 'time') {
    result.set('year', utc ? date.getUTCFullYear() : date.getFullYear());
    result.set('month', (utc ? date.getUTCMonth() : date.getMonth()) + 1);
    result.set('day', utc ? date.getUTCDate() : date.getDate());
    result.set('weekday', utc ? date.getUTCDay() : date.getDay());
  }
  if (part !== 'date') {
    result.set('hour', utc ? date.getUTCHours() : date.getHours());
    result.set('minute', utc ? date.getUTCMinutes() : date.getMinutes());
    result.set('second', utc ? date.getUTCSeconds() : date.getSeconds());
  }
  return result;
}

function systemDictionary(utc: boolean, part: 'date' | 'time' | 'datetime'): GodotDateTimeDictionary {
  const date = new Date();
  const result = dictionary(date, utc, part);
  if (part === 'datetime') result.set('dst', utc ? false : localDst(date));
  return result;
}

const pad2 = (value: number): string => String(value).padStart(2, '0');
const padYear = (value: number): string => `${value < 0 ? '-' : ''}${String(Math.abs(value)).padStart(4, '0')}`;

function dateString(date: Date, utc: boolean): string {
  const year = utc ? date.getUTCFullYear() : date.getFullYear();
  const month = (utc ? date.getUTCMonth() : date.getMonth()) + 1;
  const day = utc ? date.getUTCDate() : date.getDate();
  return `${padYear(year)}-${pad2(month)}-${pad2(day)}`;
}

function timeString(date: Date, utc: boolean): string {
  const hour = utc ? date.getUTCHours() : date.getHours();
  const minute = utc ? date.getUTCMinutes() : date.getMinutes();
  const second = utc ? date.getUTCSeconds() : date.getSeconds();
  return `${pad2(hour)}:${pad2(minute)}:${pad2(second)}`;
}

function monotonicMilliseconds(): number {
  if (typeof performance === 'undefined') {
    throw new Error('godot-compat: Time ticks require the browser monotonic Performance clock.');
  }
  return performance.now();
}

export const godotTimeGetTicksMsec = (): number => Math.floor(monotonicMilliseconds());
export const godotTimeGetTicksUsec = (): number => Math.floor(monotonicMilliseconds() * 1_000);
export const godotTimeGetUnixTimeFromSystem = (): number => Date.now() / SECOND_MS;

export function godotTimeGetUnixTimeFromDatetimeDict(value: unknown): number {
  return dateFromDatetimeDictionary(value, 'get_unix_time_from_datetime_dict').valueOf() / SECOND_MS;
}

export function godotTimeGetUnixTimeFromDatetimeString(value: unknown): number {
  if (typeof value !== 'string') {
    throw new TypeError('Time.get_unix_time_from_datetime_string requires a String.');
  }
  const match = /^(-?\d{4,})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})$/u.exec(value);
  if (match === null) {
    throw new RangeError('Time.get_unix_time_from_datetime_string requires YYYY-MM-DDTHH:MM:SS.');
  }
  return godotTimeGetUnixTimeFromDatetimeDict(new Map([
    ['year', Number(match[1])],
    ['month', Number(match[2])],
    ['day', Number(match[3])],
    ['hour', Number(match[4])],
    ['minute', Number(match[5])],
    ['second', Number(match[6])],
  ]));
}

export function godotTimeGetDatetimeDictFromDatetimeString(
  value: unknown,
  weekday = true,
): GodotDateTimeDictionary {
  const timestamp = godotTimeGetUnixTimeFromDatetimeString(value);
  const result = dictionary(dateFromUnix(timestamp, 'get_datetime_dict_from_datetime_string'), true, 'datetime');
  if (!bool(weekday, 'get_datetime_dict_from_datetime_string')) result.delete('weekday');
  return result;
}

export function godotTimeGetDatetimeStringFromDatetimeDict(
  value: unknown,
  useSpace = false,
): string {
  const date = dateFromDatetimeDictionary(value, 'get_datetime_string_from_datetime_dict');
  return `${dateString(date, true)}${bool(useSpace, 'get_datetime_string_from_datetime_dict') ? ' ' : 'T'}${timeString(date, true)}`;
}

export function godotTimeGetOffsetStringFromOffsetMinutes(value: unknown): string {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TypeError('Time.get_offset_string_from_offset_minutes requires an integer minute offset.');
  }
  const sign = value < 0 ? '-' : '+';
  const magnitude = Math.abs(value);
  return `${sign}${pad2(Math.floor(magnitude / 60))}:${pad2(magnitude % 60)}`;
}

export function godotTimeGetDatetimeDictFromUnixTime(value: unknown): GodotDateTimeDictionary {
  return dictionary(dateFromUnix(value, 'get_datetime_dict_from_unix_time'), true, 'datetime');
}

export function godotTimeGetDateDictFromUnixTime(value: unknown): GodotDateTimeDictionary {
  return dictionary(dateFromUnix(value, 'get_date_dict_from_unix_time'), true, 'date');
}

export function godotTimeGetTimeDictFromUnixTime(value: unknown): GodotDateTimeDictionary {
  return dictionary(dateFromUnix(value, 'get_time_dict_from_unix_time'), true, 'time');
}

export function godotTimeGetDatetimeStringFromUnixTime(value: unknown, useSpace = false): string {
  const date = dateFromUnix(value, 'get_datetime_string_from_unix_time');
  return `${dateString(date, true)}${bool(useSpace, 'get_datetime_string_from_unix_time') ? ' ' : 'T'}${timeString(date, true)}`;
}

export function godotTimeGetDateStringFromUnixTime(value: unknown): string {
  return dateString(dateFromUnix(value, 'get_date_string_from_unix_time'), true);
}

export function godotTimeGetTimeStringFromUnixTime(value: unknown): string {
  return timeString(dateFromUnix(value, 'get_time_string_from_unix_time'), true);
}

export function godotTimeGetDatetimeDictFromSystem(utc = false): GodotDateTimeDictionary {
  return systemDictionary(bool(utc, 'get_datetime_dict_from_system'), 'datetime');
}

export function godotTimeGetDateDictFromSystem(utc = false): GodotDateTimeDictionary {
  return systemDictionary(bool(utc, 'get_date_dict_from_system'), 'date');
}

export function godotTimeGetTimeDictFromSystem(utc = false): GodotDateTimeDictionary {
  return systemDictionary(bool(utc, 'get_time_dict_from_system'), 'time');
}

export function godotTimeGetDatetimeStringFromSystem(utc = false, useSpace = false): string {
  const isUtc = bool(utc, 'get_datetime_string_from_system');
  const date = new Date();
  return `${dateString(date, isUtc)}${bool(useSpace, 'get_datetime_string_from_system') ? ' ' : 'T'}${timeString(date, isUtc)}`;
}

export function godotTimeGetDateStringFromSystem(utc = false): string {
  return dateString(new Date(), bool(utc, 'get_date_string_from_system'));
}

export function godotTimeGetTimeStringFromSystem(utc = false): string {
  return timeString(new Date(), bool(utc, 'get_time_string_from_system'));
}

export function godotTimeGetTimeZoneFromSystem(): GodotDateTimeDictionary {
  const date = new Date();
  const name = Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
    .formatToParts(date)
    .find((part) => part.type === 'timeZoneName')?.value;
  if (name === undefined || name === '') {
    throw new Error('godot-compat: Time.get_time_zone_from_system could not obtain the browser time-zone abbreviation.');
  }
  return new Map<string, number | boolean | string>([
    ['bias', -date.getTimezoneOffset()],
    ['name', name],
  ]);
}

/** The browser-export command line is empty unless the host explicitly supplies one. */
export const godotBrowserCommandLine = (): PackedArrayValue<string> => packedStringArray();
