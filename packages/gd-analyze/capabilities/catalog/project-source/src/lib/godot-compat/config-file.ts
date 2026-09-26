/**
 * Godot ConfigFile over the copied project's existing FileAccess mount.
 *
 * Pinned authority: Godot 3.6 `core/io/config_file.cpp` and Godot 4.7
 * `core/io/config_file.cpp`. Both own the same ordered section → ordered key → Variant table,
 * merge parsed values into the current table, erase NIL assignments, and serialize through
 * Variant text. Storage remains `file-access.ts`'s project-namespaced browser filesystem; this
 * module does not introduce a second persistence model.
 */

import { constructColor } from './color';
import { FileAccessMode, GodotFileAccess } from './file-access';
import { godotNodePathNew, godotNodePathString, type GodotNodePath } from './node-path';
import {
  packedArrayKind,
  packedByteArray,
  packedColorArray,
  packedFloat32Array,
  packedFloat64Array,
  packedInt32Array,
  packedInt64Array,
  packedStringArray,
  packedVector2Array,
  packedVector3Array,
  packedVector4Array,
  type PackedArrayKind,
  type PackedArrayValue,
} from './packed-array';
import { godotRect2iNew, godotRect2New } from './rect2';
import { vec2 } from './vector2';
import { vec3 } from './variant-3d';

const OK = 0;
const ERR_FILE_NOT_FOUND = 7;
const ERR_PARSE_ERROR = 43;

class ConfigSyntaxError extends Error {}

class VariantReader {
  private at = 0;

  constructor(private readonly source: string) {}

  parse(): unknown {
    const value = this.value();
    this.space();
    if (this.at !== this.source.length) this.syntax(`unexpected ${JSON.stringify(this.source[this.at])}`);
    return value;
  }

  private value(): unknown {
    this.space();
    const char = this.source[this.at];
    if (char === '"') return this.string();
    if (char === '#') return this.color();
    if (char === '[') return this.array();
    if (char === '{') return this.dictionary();
    if (char === '+' || char === '-' || char === '.' || (char !== undefined && /\d/.test(char))) {
      return this.numberOrInfinity();
    }
    const identifier = this.identifier();
    switch (identifier) {
      case 'null':
        return null;
      case 'true':
        return true;
      case 'false':
        return false;
      case 'nan':
        return Number.NaN;
      case 'inf':
        return Number.POSITIVE_INFINITY;
      case 'inf_neg':
        return Number.NEGATIVE_INFINITY;
      default:
        this.space();
        if (this.source[this.at] !== '(') this.syntax(`unknown Variant token ${identifier}`);
        return this.constructorValue(identifier);
    }
  }

  private constructorValue(name: string): unknown {
    this.expect('(');
    const args: unknown[] = [];
    this.space();
    while (this.source[this.at] !== ')') {
      args.push(this.value());
      this.space();
      if (this.source[this.at] === ')') break;
      this.expect(',');
    }
    this.expect(')');
    const numbers = (): number[] => args.map((value) => {
      if (typeof value !== 'number') this.syntax(`${name} components must be numbers`);
      return value as number;
    });
    const groupedNumbers = (width: number): number[][] => {
      const values = numbers();
      if (values.length % width !== 0) {
        this.syntax(`${name} requires a component count divisible by ${width}`);
      }
      const groups: number[][] = [];
      for (let at = 0; at < values.length; at += width) groups.push(values.slice(at, at + width));
      return groups;
    };
    switch (name) {
      case 'Vector2': {
        const [x = 0, y = 0] = numbers();
        if (args.length !== 2) this.syntax('Vector2 requires 2 components');
        return vec2(x, y);
      }
      case 'Vector2i': {
        const [x = 0, y = 0] = numbers();
        if (args.length !== 2 || !Number.isInteger(x) || !Number.isInteger(y)) {
          this.syntax('Vector2i requires 2 integer components');
        }
        return vec2(x, y);
      }
      case 'Vector3': {
        const [x = 0, y = 0, z = 0] = numbers();
        if (args.length !== 3) this.syntax('Vector3 requires 3 components');
        return vec3(x, y, z);
      }
      case 'Vector4': {
        const [x = 0, y = 0, z = 0, w = 0] = numbers();
        if (args.length !== 4) this.syntax('Vector4 requires 4 components');
        return { x, y, z, w };
      }
      case 'Color':
        if (args.length !== 3 && args.length !== 4) this.syntax('Color requires 3 or 4 components');
        return constructColor(...numbers());
      case 'Rect2':
        if (args.length !== 4) this.syntax(`${name} requires 4 components`);
        return godotRect2New(...numbers());
      case 'Rect2i':
        if (args.length !== 4 || numbers().some((component) => !Number.isInteger(component))) {
          this.syntax('Rect2i requires 4 integer components');
        }
        return godotRect2iNew(...numbers());
      case 'StringName':
        if (args.length !== 1 || typeof args[0] !== 'string') this.syntax(`${name} requires one string`);
        return args[0];
      case 'NodePath':
        if (args.length !== 1 || typeof args[0] !== 'string') this.syntax('NodePath requires one string');
        return godotNodePathNew(args[0]);
      case 'PoolStringArray':
        if (!args.every((value) => typeof value === 'string')) this.syntax(`${name} requires strings`);
        return packedStringArray(args);
      case 'PackedStringArray':
        if (!args.every((value) => typeof value === 'string')) this.syntax(`${name} requires strings`);
        return packedStringArray(args);
      case 'PackedByteArray':
        if (args.length === 1 && typeof args[0] === 'string') {
          throw new Error(
            'godot-compat: ConfigFile PackedByteArray base64 text is not carried exactly; numeric compatibility-form bytes are supported.',
          );
        }
        return packedByteArray(args);
      case 'PackedInt32Array':
        return packedInt32Array(args);
      case 'PackedInt64Array':
        return packedInt64Array(args);
      case 'PackedFloat32Array':
        return packedFloat32Array(args);
      case 'PackedFloat64Array':
        return packedFloat64Array(args);
      case 'PackedVector2Array':
        return packedVector2Array(groupedNumbers(2).map(([x = 0, y = 0]) => vec2(x, y)));
      case 'PackedVector3Array':
        return packedVector3Array(groupedNumbers(3).map(([x = 0, y = 0, z = 0]) => vec3(x, y, z)));
      case 'PackedVector4Array':
        return packedVector4Array(
          groupedNumbers(4).map(([x = 0, y = 0, z = 0, w = 0]) => ({ x, y, z, w })),
        );
      case 'PackedColorArray':
        return packedColorArray(
          groupedNumbers(4).map(([r = 0, g = 0, b = 0, a = 0]) => ({ r, g, b, a })),
        );
      default:
        throw new Error(
          `godot-compat: ConfigFile Variant constructor ${name} is not carried exactly.`,
        );
    }
  }

  private array(): unknown[] {
    this.expect('[');
    const result: unknown[] = [];
    this.space();
    while (this.source[this.at] !== ']') {
      result.push(this.value());
      this.space();
      if (this.source[this.at] === ']') break;
      this.expect(',');
    }
    this.expect(']');
    return result;
  }

  private dictionary(): Map<unknown, unknown> {
    this.expect('{');
    const result = new Map<unknown, unknown>();
    this.space();
    while (this.source[this.at] !== '}') {
      const key = this.value();
      this.expect(':');
      result.set(key, this.value());
      this.space();
      if (this.source[this.at] === '}') break;
      this.expect(',');
    }
    this.expect('}');
    return result;
  }

  private string(): string {
    const start = this.at;
    this.at += 1;
    let escaped = false;
    while (this.at < this.source.length) {
      const char = this.source[this.at++];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') escaped = true;
      else if (char === '"') {
        try {
          return JSON.parse(this.source.slice(start, this.at)) as string;
        } catch {
          this.syntax('invalid quoted string');
        }
      }
    }
    this.syntax('unterminated quoted string');
  }

  private color(): unknown {
    const match = /^#[0-9A-Fa-f]+/.exec(this.source.slice(this.at))?.[0];
    if (match === undefined) this.syntax('invalid HTML Color token');
    this.at += match.length;
    try {
      return constructColor(match);
    } catch {
      this.syntax(`invalid HTML Color token ${match}`);
    }
  }

  private numberOrInfinity(): number {
    const rest = this.source.slice(this.at);
    const infinity = /^[+-]?inf\b/.exec(rest)?.[0];
    if (infinity !== undefined) {
      this.at += infinity.length;
      return infinity.startsWith('-') ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    }
    const match = /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?/.exec(rest)?.[0];
    if (match === undefined) this.syntax('invalid number');
    this.at += match.length;
    const value = Number(match);
    if (!/[.eE]/.test(match) && !Number.isSafeInteger(value)) {
      throw new RangeError(
        `godot-compat: ConfigFile integer ${match} is outside JavaScript's exact integer domain.`,
      );
    }
    return value;
  }

  private identifier(): string {
    const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.source.slice(this.at))?.[0];
    if (match === undefined) this.syntax('expected Variant value');
    this.at += match.length;
    return match;
  }

  private expect(char: string): void {
    this.space();
    if (this.source[this.at] !== char) this.syntax(`expected ${JSON.stringify(char)}`);
    this.at += 1;
  }

  private space(): void {
    while (/\s/.test(this.source[this.at] ?? '')) this.at += 1;
  }

  private syntax(message: string): never {
    throw new ConfigSyntaxError(`${message} at column ${this.at + 1}`);
  }
}

function stripComment(line: string): string {
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] ?? '';
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoted && char === '\\') escaped = true;
    else if (char === '"') quoted = !quoted;
    else if (!quoted && char === ';') return line.slice(0, index);
  }
  return line;
}

function assignmentAt(line: string): number {
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] ?? '';
    if (escaped) escaped = false;
    else if (quoted && char === '\\') escaped = true;
    else if (char === '"') quoted = !quoted;
    else if (!quoted && char === '=') return index;
  }
  return -1;
}

function statementComplete(source: string): boolean {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (const char of source) {
    if (escaped) escaped = false;
    else if (quoted && char === '\\') escaped = true;
    else if (char === '"') quoted = !quoted;
    else if (!quoted && (char === '[' || char === '{' || char === '(')) depth += 1;
    else if (!quoted && (char === ']' || char === '}' || char === ')')) depth -= 1;
    if (depth < 0) throw new ConfigSyntaxError('unexpected closing delimiter');
  }
  return !quoted && depth === 0;
}

function configStatements(data: string): string[] {
  const statements: string[] = [];
  let pending = '';
  for (const raw of data.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = stripComment(raw).trim();
    if (line === '') continue;
    pending = pending === '' ? line : `${pending}\n${line}`;
    if (statementComplete(pending)) {
      statements.push(pending);
      pending = '';
    }
  }
  if (pending !== '') throw new ConfigSyntaxError('unterminated ConfigFile statement');
  return statements;
}

function decodeKey(source: string): string {
  const key = source.trim();
  if (key.startsWith('"')) {
    try {
      const parsed = JSON.parse(key) as unknown;
      if (typeof parsed === 'string') return parsed;
    } catch {
      // The common syntax error below owns the diagnostic.
    }
    throw new ConfigSyntaxError('invalid quoted property name');
  }
  const unquoted = [...key].filter((char) => (char.codePointAt(0) ?? 0) > 32).join('');
  if (unquoted === '') throw new ConfigSyntaxError('empty property name');
  return unquoted;
}

function encodeKey(key: string): string {
  return /[=";\[\]\s]|[^\x21-\x7E]/.test(key) ? JSON.stringify(key) : key;
}

function isExactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

const PACKED_ARRAY_NAMES: Readonly<Record<PackedArrayKind, string>> = {
  byte: 'PackedByteArray',
  int32: 'PackedInt32Array',
  int64: 'PackedInt64Array',
  float32: 'PackedFloat32Array',
  float64: 'PackedFloat64Array',
  string: 'PackedStringArray',
  vector2: 'PackedVector2Array',
  vector3: 'PackedVector3Array',
  vector4: 'PackedVector4Array',
  color: 'PackedColorArray',
};

function packedVariantText(kind: PackedArrayKind, values: readonly unknown[]): string {
  const flattened: unknown[] = [];
  const fields = kind === 'vector2'
    ? ['x', 'y']
    : kind === 'vector3'
      ? ['x', 'y', 'z']
      : kind === 'vector4'
        ? ['x', 'y', 'z', 'w']
        : kind === 'color'
          ? ['r', 'g', 'b', 'a']
          : undefined;
  if (fields === undefined) flattened.push(...values);
  else {
    for (const value of values) {
      if (typeof value !== 'object' || value === null) {
        throw new TypeError(`ConfigFile ${PACKED_ARRAY_NAMES[kind]} entry must be an object.`);
      }
      for (const field of fields) {
        const component = Reflect.get(value, field);
        if (typeof component !== 'number') {
          throw new TypeError(
            `ConfigFile ${PACKED_ARRAY_NAMES[kind]} entry.${field} must be a number.`,
          );
        }
        flattened.push(component);
      }
    }
  }
  return `${PACKED_ARRAY_NAMES[kind]}(${flattened.map(variantText).join(', ')})`;
}

function variantText(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'nan';
    if (value === Number.POSITIVE_INFINITY) return 'inf';
    if (value === Number.NEGATIVE_INFINITY) return 'inf_neg';
    return String(value);
  }
  if (Array.isArray(value)) {
    const family = packedArrayKind(value as PackedArrayValue<unknown>);
    const entries = value.map(variantText).join(', ');
    return family === undefined ? `[${entries}]` : packedVariantText(family, value);
  }
  if (value instanceof Map) {
    return `{${[...value].map(([key, entry]) => `${variantText(key)}: ${variantText(entry)}`).join(', ')}}`;
  }
  if (typeof value === 'object') {
    if ('absolute' in value && 'names' in value && 'subnames' in value) {
      return `NodePath(${JSON.stringify(godotNodePathString(value as GodotNodePath))})`;
    }
    if ('position' in value && 'size' in value) {
      const position = Reflect.get(value, 'position') as { readonly x?: unknown; readonly y?: unknown };
      const size = Reflect.get(value, 'size') as { readonly x?: unknown; readonly y?: unknown };
      if (
        typeof position?.x === 'number' &&
        typeof position.y === 'number' &&
        typeof size?.x === 'number' &&
        typeof size.y === 'number'
      ) {
        return `Rect2(${variantText(position.x)}, ${variantText(position.y)}, ${variantText(size.x)}, ${variantText(size.y)})`;
      }
    }
    if (isExactKeys(value, ['x', 'y'])) {
      return `Vector2(${variantText(Reflect.get(value, 'x'))}, ${variantText(Reflect.get(value, 'y'))})`;
    }
    if (isExactKeys(value, ['x', 'y', 'z'])) {
      return `Vector3(${variantText(Reflect.get(value, 'x'))}, ${variantText(Reflect.get(value, 'y'))}, ${variantText(Reflect.get(value, 'z'))})`;
    }
    if (isExactKeys(value, ['w', 'x', 'y', 'z'])) {
      return `Vector4(${variantText(Reflect.get(value, 'x'))}, ${variantText(Reflect.get(value, 'y'))}, ${variantText(Reflect.get(value, 'z'))}, ${variantText(Reflect.get(value, 'w'))})`;
    }
    if (isExactKeys(value, ['a', 'b', 'g', 'r'])) {
      return `Color(${variantText(Reflect.get(value, 'r'))}, ${variantText(Reflect.get(value, 'g'))}, ${variantText(Reflect.get(value, 'b'))}, ${variantText(Reflect.get(value, 'a'))})`;
    }
  }
  throw new Error(
    `godot-compat: ConfigFile cannot serialize Variant ${Object.prototype.toString.call(value)} exactly.`,
  );
}

/** The retained ConfigFile object scripts construct and mutate directly. */
export class GodotConfigFile {
  private readonly values = new Map<string, Map<string, unknown>>();

  set_value(section: string, key: string, value: unknown): void {
    this.assertName(section, 'section');
    this.assertName(key, 'key');
    if (value === null || value === undefined) {
      const entries = this.values.get(section);
      entries?.delete(key);
      if (entries?.size === 0) this.values.delete(section);
      return;
    }
    const entries = this.values.get(section) ?? new Map<string, unknown>();
    entries.set(key, value);
    this.values.set(section, entries);
  }

  get_value(section: string, key: string, defaultValue?: unknown): unknown {
    this.assertName(section, 'section');
    this.assertName(key, 'key');
    const entries = this.values.get(section);
    if (entries?.has(key)) return entries.get(key);
    if (defaultValue !== null && defaultValue !== undefined) return defaultValue;
    throw new Error(
      `Couldn't find the given section ${JSON.stringify(section)} and key ${JSON.stringify(key)}, and no default was given.`,
    );
  }

  has_section(section: string): boolean {
    this.assertName(section, 'section');
    return this.values.has(section);
  }

  has_section_key(section: string, key: string): boolean {
    this.assertName(section, 'section');
    this.assertName(key, 'key');
    return this.values.get(section)?.has(key) ?? false;
  }

  get_sections(): PackedArrayValue<string> {
    return packedStringArray(this.values.keys());
  }

  get_section_keys(section: string): PackedArrayValue<string> {
    this.assertName(section, 'section');
    const entries = this.values.get(section);
    if (entries === undefined) throw new Error(`Cannot get keys from nonexistent section ${JSON.stringify(section)}.`);
    return packedStringArray(entries.keys());
  }

  erase_section(section: string): void {
    this.assertName(section, 'section');
    if (!this.values.delete(section)) {
      throw new Error(`Cannot erase nonexistent section ${JSON.stringify(section)}.`);
    }
  }

  erase_section_key(section: string, key: string): void {
    this.assertName(section, 'section');
    this.assertName(key, 'key');
    const entries = this.values.get(section);
    if (entries === undefined) {
      throw new Error(`Cannot erase key ${JSON.stringify(key)} from nonexistent section ${JSON.stringify(section)}.`);
    }
    if (!entries.delete(key)) {
      throw new Error(`Cannot erase nonexistent key ${JSON.stringify(key)} from section ${JSON.stringify(section)}.`);
    }
  }

  clear(): void {
    this.values.clear();
  }

  load(path: string): number {
    if (typeof path !== 'string') throw new TypeError('ConfigFile.load path must be a string.');
    const file = GodotFileAccess.open(path, FileAccessMode.READ);
    if (file === null) return ERR_FILE_NOT_FOUND;
    try {
      return this.parse(file.get_as_text());
    } finally {
      file.close();
    }
  }

  save(path: string): number {
    if (typeof path !== 'string') throw new TypeError('ConfigFile.save path must be a string.');
    const file = GodotFileAccess.open(path, FileAccessMode.WRITE);
    if (file === null) {
      throw new Error(`godot-compat: ConfigFile.save cannot open ${JSON.stringify(path)} for writing.`);
    }
    try {
      file.store_string(this.encode_to_text());
      file.close();
      return OK;
    } catch (error) {
      file.close();
      throw error;
    }
  }

  encode_to_text(): string {
    let text = '';
    let first = true;
    for (const [section, entries] of this.values) {
      if (!first) text += '\n';
      first = false;
      text += `[${section}]\n\n`;
      for (const [key, value] of entries) text += `${encodeKey(key)}=${variantText(value)}\n`;
    }
    return text;
  }

  load_encrypted(_path: string, _key: Uint8Array): never {
    throw new Error(
      'ConfigFile.load_encrypted requires Godot FileAccessEncrypted AES container compatibility, which is unavailable in this browser export.',
    );
  }

  load_encrypted_pass(_path: string, _password: string): never {
    throw new Error(
      'ConfigFile.load_encrypted_pass requires Godot FileAccessEncrypted password/KDF compatibility, which is unavailable in this browser export.',
    );
  }

  save_encrypted(_path: string, _key: Uint8Array): never {
    throw new Error(
      'ConfigFile.save_encrypted requires Godot FileAccessEncrypted AES container compatibility, which is unavailable in this browser export.',
    );
  }

  save_encrypted_pass(_path: string, _password: string): never {
    throw new Error(
      'ConfigFile.save_encrypted_pass requires Godot FileAccessEncrypted password/KDF compatibility, which is unavailable in this browser export.',
    );
  }

  parse(data: string): number {
    if (typeof data !== 'string') throw new TypeError('ConfigFile.parse data must be a string.');
    let section = '';
    let statements: string[];
    try {
      statements = configStatements(data);
    } catch (error) {
      if (error instanceof ConfigSyntaxError) return ERR_PARSE_ERROR;
      throw error;
    }
    for (const line of statements) {
      try {
        if (line.startsWith('[')) {
          if (!line.endsWith(']')) throw new ConfigSyntaxError('unterminated section tag');
          section = line.slice(1, -1);
          continue;
        }
        const equals = assignmentAt(line);
        if (equals < 0) throw new ConfigSyntaxError('expected key=value assignment');
        const key = decodeKey(line.slice(0, equals));
        const value = new VariantReader(line.slice(equals + 1).trim()).parse();
        this.set_value(section, key, value);
      } catch (error) {
        if (error instanceof ConfigSyntaxError) return ERR_PARSE_ERROR;
        throw error;
      }
    }
    return OK;
  }

  private assertName(value: string, kind: string): void {
    if (typeof value !== 'string') {
      throw new TypeError(`ConfigFile ${kind} must be a string; received ${String(value)}.`);
    }
  }
}

export function createGodotConfigFile(): GodotConfigFile {
  return new GodotConfigFile();
}
