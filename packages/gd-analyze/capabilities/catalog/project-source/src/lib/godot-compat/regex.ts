/** Godot RegEx/RegExMatch carried by the ECMAScript Unicode regexp intersection. */

import { registerGodotObjectIdentity } from './object';
import { packedStringArray, type PackedStringArray } from './packed-array';
import { godotDictionary, type GodotDictionary } from './variant';

type MatchRange = readonly [number, number];
type MatchIndices = ReadonlyArray<MatchRange | undefined> & {
  readonly groups?: Readonly<Record<string, MatchRange | undefined>>;
};

const unsupportedPcre = [
  /\(\?P[<=]/, /\(\?'/, /\(\?P=/, /\(\?\|/, /\(\?>/, /\(\?\(/, /\(\?R\)/,
  /\(\?[+-]?[imsxUJ]+(?:[-+][imsxUJ]+)?[:)]/, /\(\*[A-Z_]+/, /\\[KCRXG]/,
  /(?:\*|\+|\?|\{\d+(?:,\d*)?\})\+/, /\\g[<{']/, /\\k'/,
  /\\[AZz]/, /\\Q/, /\\E/, /\\N(?:\{|\b)/, /\\[hHvV]/,
];

function codePointToUnit(value: string, offset: number): number {
  if (!Number.isInteger(offset) || offset < 0) throw new RangeError('RegEx offset must be a non-negative integer.');
  let units = 0;
  let points = 0;
  while (units < value.length && points < offset) {
    const code = value.codePointAt(units) ?? 0;
    units += code > 0xffff ? 2 : 1;
    points += 1;
  }
  return units;
}

function unitToCodePoint(value: string, unit: number): number {
  if (unit < 0) return -1;
  return [...value.slice(0, unit)].length;
}

interface CaptureMetadata {
  readonly count: number;
  readonly names: Readonly<Record<string, number>>;
}

function capturesOf(pattern: string): CaptureMetadata {
  let count = 0;
  let inClass = false;
  const names: Record<string, number> = {};
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (character === '[') {
      inClass = true;
      continue;
    }
    if (character === ']' && inClass) {
      inClass = false;
      continue;
    }
    if (inClass || character !== '(') continue;
    if (pattern[index + 1] !== '?') {
      count += 1;
      continue;
    }
    if (pattern[index + 2] !== '<' || pattern[index + 3] === '=' || pattern[index + 3] === '!') continue;
    const end = pattern.indexOf('>', index + 3);
    if (end < 0) continue;
    const name = pattern.slice(index + 3, end);
    count += 1;
    names[name] = count;
  }
  return { count, names: Object.freeze(names) };
}

export class GodotRegExMatch {
  readonly subject: string;
  readonly names: GodotDictionary<string, number>;
  readonly strings: PackedStringArray;
  private readonly nameIndices: Readonly<Record<string, number>>;
  private readonly ranges: readonly (readonly [number, number])[];

  constructor(subject: string, match: RegExpExecArray, names: Readonly<Record<string, number>>) {
    this.subject = subject;
    const indices = match.indices as MatchIndices;
    this.ranges = Array.from({ length: match.length }, (_, index) => {
      const range = indices[index];
      return range === undefined
        ? [-1, -1] as const
        : [unitToCodePoint(subject, range[0]), unitToCodePoint(subject, range[1])] as const;
    });
    this.nameIndices = names;
    this.names = godotDictionary(Object.entries(names));
    this.strings = packedStringArray(this.ranges.map((range) =>
      range[0] < 0 ? '' : [...subject].slice(range[0], range[1]).join('')));
    registerGodotObjectIdentity(this, 'RegExMatch');
  }

  get_subject(): string { return this.subject; }
  get_group_count(): number { return Math.max(0, this.ranges.length - 1); }
  get_names(): GodotDictionary<string, number> { return godotDictionary([...this.names]); }
  get_strings(): PackedStringArray { return packedStringArray(this.strings); }
  get_string(name: number | string = 0): string {
    const index = this.find(name);
    return index < 0 ? '' : this.strings[index] ?? '';
  }
  get_start(name: number | string = 0): number {
    const index = this.find(name);
    return index < 0 ? -1 : this.ranges[index]?.[0] ?? -1;
  }
  get_end(name: number | string = 0): number {
    const index = this.find(name);
    return index < 0 ? -1 : this.ranges[index]?.[1] ?? -1;
  }
  private find(name: number | string): number {
    if (typeof name === 'number' && Number.isInteger(name)) return name >= 0 && name < this.ranges.length ? name : -1;
    if (typeof name === 'string') return this.nameIndices[name] ?? -1;
    return -1;
  }
}

export class GodotRegEx {
  private pattern = '';
  private regex: RegExp | null = null;
  private captures: CaptureMetadata = { count: 0, names: Object.freeze({}) };

  constructor(pattern?: string) {
    registerGodotObjectIdentity(this, 'RegEx');
    if (pattern !== undefined) this.compile(pattern);
  }

  static create_from_string(pattern: string, showError = true): GodotRegEx {
    const regex = new GodotRegEx();
    regex.compile(pattern, showError);
    return regex;
  }

  clear(): void {
    this.pattern = '';
    this.regex = null;
    this.captures = { count: 0, names: Object.freeze({}) };
  }

  compile(pattern: string, _showError = true): number {
    if (typeof pattern !== 'string') throw new TypeError('RegEx.compile requires String.');
    this.pattern = pattern;
    this.regex = null;
    this.captures = { count: 0, names: Object.freeze({}) };
    if (unsupportedPcre.some((one) => one.test(pattern))) return 1;
    try {
      this.regex = new RegExp(pattern, 'dgu');
      this.captures = capturesOf(pattern);
      return 0;
    } catch {
      return 1;
    }
  }

  search(subject: string, offset = 0, end = -1): GodotRegExMatch | null {
    if (this.regex === null) throw new Error('RegEx.search requires a successfully compiled pattern.');
    if (typeof subject !== 'string') throw new TypeError('RegEx.search requires String subject.');
    const source = end >= 0 ? [...subject].slice(0, end).join('') : subject;
    this.regex.lastIndex = codePointToUnit(source, offset);
    const match = this.regex.exec(source);
    return match === null ? null : new GodotRegExMatch(subject, match, this.captures.names);
  }

  search_all(subject: string, offset = 0, end = -1): GodotRegExMatch[] {
    if (offset < 0) throw new RangeError('RegEx search offset must be >= 0.');
    const results: GodotRegExMatch[] = [];
    const limit = end >= 0 ? Math.min([...subject].length, end) : [...subject].length;
    let next = offset;
    while (true) {
      const match = this.search(subject, next, end);
      if (match === null) return results;
      results.push(match);
      next = match.get_end();
      if (match.get_start() === next) next += 1;
      if (next > limit) return results;
    }
  }

  sub(subject: string, replacement: string, all = false, offset = 0, end = -1): string {
    if (typeof replacement !== 'string') throw new TypeError('RegEx.sub requires String replacement.');
    const limit = end >= 0 ? Math.min([...subject].length, end) : [...subject].length;
    const matches = all ? this.search_all(subject, offset, limit) : [this.search(subject, offset, limit)].filter(Boolean) as GodotRegExMatch[];
    if (matches.length === 0) return subject;
    let output = '';
    let cursor = 0;
    const points = [...subject];
    for (const match of matches) {
      const start = match.get_start();
      const finish = match.get_end();
      output += points.slice(cursor, start).join('');
      output += this.expandReplacement(replacement, match);
      cursor = finish;
    }
    return output + points.slice(cursor).join('');
  }

  is_valid(): boolean { return this.regex !== null; }
  get_pattern(): string { return this.pattern; }
  get_group_count(): number {
    if (this.regex === null) return 0;
    return this.captures.count;
  }
  get_names(): PackedStringArray { return packedStringArray(this.regex === null ? [] : Object.keys(this.captures.names)); }

  private expandReplacement(replacement: string, match: GodotRegExMatch): string {
    return replacement.replace(/\$(?:\{([^}]+)\}|([A-Za-z_][A-Za-z0-9_]*|\d+))/g, (_whole, braced, plain) => {
      const key = String(braced ?? plain);
      return match.get_string(/^\d+$/.test(key) ? Number(key) : key);
    });
  }
}

export function createGodotRegEx(pattern?: string): GodotRegEx { return new GodotRegEx(pattern); }
