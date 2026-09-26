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
import { color, godotDictionary } from './variant';
import { vec3 } from './variant-3d';
import { vec2 } from './vector2';
import { registerGodotObjectIdentity } from './object';

/** `Error.OK` and `Error.ERR_PARSE_ERROR` in the pinned 3.6.2/4.7 headers. */
const OK = 0;
const ERR_OUT_OF_MEMORY = 6;
const ERR_PARSE_ERROR = 43;
const GODOT4_MAX_RECURSION_DEPTH = 1024;

export interface GodotJSONParseResult {
  readonly error: number;
  readonly error_string: string;
  readonly error_line: number;
  readonly result: unknown;
}

interface ParseOutcome {
  readonly error: number;
  readonly message: string;
  readonly line: number;
  readonly value: unknown;
  /** `_parse_string` writes its `Variant &r_ret` only after a complete root value. */
  readonly assignsValue: boolean;
}

type TokenKind = '{' | '}' | '[' | ']' | ':' | ',' | 'identifier' | 'string' | 'number' | 'eof';

interface Token {
  readonly kind: TokenKind;
  readonly value?: unknown;
}

class JSONReadError extends Error {
  constructor(
    message: string,
    readonly code = ERR_PARSE_ERROR,
  ) {
    super(message);
  }
}

class GodotJSONReader {
  private offset = 0;
  private line = 0;

  constructor(
    private readonly source: string,
    private readonly major: 3 | 4,
  ) {}

  parse(): ParseOutcome {
    if (this.source.length === 0) {
      return {
        error: ERR_PARSE_ERROR,
        message: this.major === 3 ? '' : 'Unknown error getting token',
        line: 0,
        value: null,
        assignsValue: false,
      };
    }
    let assigned = false;
    try {
      const value = this.value(this.token(), 0);
      assigned = true;
      const tail = this.token();
      if (tail.kind !== 'eof') this.fail("Expected 'EOF'");
      return { error: OK, message: '', line: 0, value, assignsValue: true };
    } catch (error) {
      return {
        error: error instanceof JSONReadError ? error.code : ERR_PARSE_ERROR,
        message: error instanceof Error ? error.message : String(error),
        line: this.line,
        value: null,
        // A successfully read root followed by junk is the source's explicit `r_ret = Variant()`.
        // A failure while reading a nested root never assigns its local Array/Dictionary to r_ret.
        assignsValue: assigned,
      };
    }
  }

  private fail(message: string): never {
    throw new JSONReadError(message);
  }

  private token(): Token {
    while (this.offset < this.source.length) {
      const char = this.source[this.offset] ?? '';
      if (char === '\n') {
        this.line += 1;
        this.offset += 1;
        continue;
      }
      if (char.charCodeAt(0) <= 32) {
        this.offset += 1;
        continue;
      }
      if ('{}[]:,'.includes(char)) {
        this.offset += 1;
        return { kind: char as TokenKind };
      }
      if (char === '"') return { kind: 'string', value: this.string() };
      if (char === '-' || (char >= '0' && char <= '9')) return this.number();
      if (/[A-Za-z]/.test(char)) return this.identifier();
      this.fail(this.major === 3 ? 'Unexpected character.' : 'Unexpected character');
    }
    return { kind: 'eof' };
  }

  private identifier(): Token {
    const start = this.offset;
    while (/[A-Za-z]/.test(this.source[this.offset] ?? '')) this.offset += 1;
    return { kind: 'identifier', value: this.source.slice(start, this.offset) };
  }

  private number(): Token {
    const rest = this.source.slice(this.offset);
    // Godot delegates token length to `String::to_float`; this spelling admits the same JSON
    // number grammar while leaving any following byte for the mandatory EOF/comma check.
    const match = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
    if (match === null) this.fail('Expected number');
    this.offset += match[0].length;
    return { kind: 'number', value: Number(match[0]) };
  }

  private string(): string {
    this.offset += 1;
    let result = '';
    while (this.offset < this.source.length) {
      const char = this.source[this.offset++] ?? '';
      if (char === '"') return result;
      if (char === '\n') this.line += 1;
      if (char !== '\\') {
        result += char;
        continue;
      }
      if (this.offset >= this.source.length) this.fail('Unterminated string');
      const escaped = this.source[this.offset++] ?? '';
      const simple: Readonly<Record<string, string>> = {
        b: '\b',
        t: '\t',
        n: '\n',
        f: '\f',
        r: '\r',
        '"': '"',
        '\\': '\\',
        '/': '/',
      };
      if (escaped in simple) {
        result += simple[escaped];
        continue;
      }
      if (escaped !== 'u') {
        // 3.6's `_get_token` deliberately accepts unknown escapes as the escaped character;
        // 4.7 tightened this to `Invalid escape sequence`.
        if (this.major === 3) {
          result += escaped;
          continue;
        }
        this.fail('Invalid escape sequence');
      }
      const lead = this.codeUnit();
      if (this.major === 3) {
        // 3.6 appends each UTF-16 code unit independently. Adjacent lead/trail escapes therefore
        // remain a JS surrogate pair, while an unpaired surrogate is retained rather than refused.
        result += String.fromCharCode(lead);
        continue;
      }
      if (lead >= 0xd800 && lead <= 0xdbff) {
        if (this.source.slice(this.offset, this.offset + 2) !== '\\u')
          this.fail('Invalid UTF-16 sequence in string, unpaired lead surrogate');
        this.offset += 2;
        const trail = this.codeUnit();
        if (trail < 0xdc00 || trail > 0xdfff)
          this.fail('Invalid UTF-16 sequence in string, unpaired lead surrogate');
        result += String.fromCodePoint(0x10000 + ((lead - 0xd800) << 10) + trail - 0xdc00);
      } else {
        if (lead >= 0xdc00 && lead <= 0xdfff)
          this.fail('Invalid UTF-16 sequence in string, unpaired trail surrogate');
        result += String.fromCodePoint(lead);
      }
    }
    this.fail(this.major === 3 ? 'Unterminated String' : 'Unterminated string');
  }

  private codeUnit(): number {
    const text = this.source.slice(this.offset, this.offset + 4);
    if (text.length < 4)
      this.fail(this.major === 3 ? 'Unterminated String' : 'Unterminated string');
    if (!/^[0-9a-fA-F]{4}$/.test(text)) this.fail('Malformed hex constant in string');
    this.offset += 4;
    return Number.parseInt(text, 16);
  }

  private value(token: Token, depth: number): unknown {
    if (this.major === 4 && depth > GODOT4_MAX_RECURSION_DEPTH)
      throw new JSONReadError('JSON structure is too deep', ERR_OUT_OF_MEMORY);
    if (token.kind === '{') return this.object(depth + 1);
    if (token.kind === '[') return this.array(depth + 1);
    if (token.kind === 'string' || token.kind === 'number') return token.value;
    if (token.kind === 'identifier') {
      if (token.value === 'true') return true;
      if (token.value === 'false') return false;
      if (token.value === 'null') return null;
      this.fail(
        this.major === 3
          ? `Expected 'true','false' or 'null', got '${String(token.value)}'.`
          : `Expected 'true', 'false', or 'null', got '${String(token.value)}'`,
      );
    }
    const sourceName: Readonly<Record<TokenKind, string>> = {
      '{': "'{'",
      '}': "'}'",
      '[': "'['",
      ']': "']'",
      identifier: 'identifier',
      string: 'string',
      number: 'number',
      ':': "':'",
      ',': "','",
      eof: 'EOF',
    };
    this.fail(
      this.major === 3
        ? `Expected value, got ${sourceName[token.kind]}.`
        : `Expected value, got '${sourceName[token.kind]}'`,
    );
  }

  private array(depth: number): unknown[] {
    const result: unknown[] = [];
    let needComma = false;
    while (true) {
      const token = this.token();
      if (token.kind === ']') return result;
      if (token.kind === 'eof') this.fail("Expected ']'");
      if (needComma) {
        if (token.kind !== ',') this.fail("Expected ','");
        needComma = false;
        continue;
      }
      result.push(this.value(token, depth));
      needComma = true;
    }
  }

  private object(depth: number): Map<string, unknown> {
    const result: Map<string, unknown> = godotDictionary();
    let needComma = false;
    while (true) {
      const key = this.token();
      if (key.kind === '}') return result;
      if (key.kind === 'eof') this.fail("Expected '}'");
      if (needComma) {
        if (key.kind !== ',') this.fail("Expected '}' or ','");
        needComma = false;
        continue;
      }
      if (key.kind !== 'string') this.fail('Expected key');
      if (this.token().kind !== ':') this.fail("Expected ':'");
      result.set(String(key.value), this.value(this.token(), depth));
      needComma = true;
    }
  }
}

function parseJSON(text: unknown, major: 3 | 4): ParseOutcome {
  return new GodotJSONReader(String(text), major).parse();
}

export function godotJSONParse3(text: unknown): GodotJSONParseResult {
  const parsed = parseJSON(text, 3);
  if (parsed.error !== OK) {
    // `_JSON::parse` uses Godot's ordinary error-reporting seam after constructing the result;
    // direct console error is the same shipped seam `Object.get_meta` and packed arrays use.
    // biome-ignore lint/suspicious/noConsole: source-required Godot parse diagnostic.
    console.error(`Error parsing JSON at line ${parsed.line}: ${parsed.message}`);
  }
  return {
    error: parsed.error,
    error_string: parsed.message,
    error_line: parsed.line,
    result: parsed.value,
  };
}

export function godotJSONParseString(text: unknown): unknown {
  const parsed = parseJSON(text, 4);
  if (parsed.error !== OK) {
    // `JSON::parse_string` is the diagnostic static helper; instance `parse` stays silent and
    // exposes its retained error fields to the caller instead.
    // biome-ignore lint/suspicious/noConsole: source-required Godot parse_string diagnostic.
    console.error(`Parse JSON failed. Error at line ${parsed.line}: ${parsed.message}`);
  }
  return parsed.error === OK ? parsed.value : null;
}

function jsonFloat(value: number, fullPrecision: boolean): string {
  if (Number.isNaN(value)) return 'null';
  if (value === Number.POSITIVE_INFINITY) return '1e99999';
  if (value === Number.NEGATIVE_INFINITY) return '-1e99999';
  if (Object.is(value, 0) || Object.is(value, -0)) return '0.0';
  if (fullPrecision) {
    const text = value.toString();
    return text.includes('.') || /e/i.test(text) ? text : `${text}.0`;
  }
  const magnitude = Math.log10(Math.abs(value));
  const precision = Math.max(1, 14 - Math.floor(magnitude));
  return value.toFixed(Math.min(100, precision)).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

/** Direct port of Godot 4.7 `JSON::_stringify` over translated Variant representations. */
export function godotJSONStringify(
  value: unknown,
  indent = '',
  sortKeys = true,
  fullPrecision = false,
): string {
  const markers = new Set<object>();
  const write = (entry: unknown, depth: number): string => {
    if (depth > 1024) throw new Error('JSON structure is too deep.');
    if (entry === null || entry === undefined) return 'null';
    if (typeof entry === 'boolean') return entry ? 'true' : 'false';
    if (typeof entry === 'bigint') return entry.toString();
    if (typeof entry === 'number') {
      return Number.isInteger(entry) ? String(entry) : jsonFloat(entry, fullPrecision);
    }
    if (typeof entry === 'string') return JSON.stringify(entry);
    if (Array.isArray(entry) || ArrayBuffer.isView(entry)) {
      const identity = entry as object;
      if (markers.has(identity)) return '"[...]"';
      const values = Array.from(entry as ArrayLike<unknown>);
      if (values.length === 0) return '[]';
      markers.add(identity);
      const line = indent === '' ? '' : '\n';
      const body = values
        .map((item) => indent.repeat(depth + 1) + write(item, depth + 1))
        .join(`,${line}`);
      markers.delete(identity);
      return `[${line}${body}${line}${indent.repeat(depth)}]`;
    }
    if (entry instanceof Map) {
      if (markers.has(entry)) return '"{...}"';
      const values = [...entry.entries()];
      if (sortKeys) values.sort(([left], [right]) => String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0);
      if (values.length === 0) return '{}';
      markers.add(entry);
      const line = indent === '' ? '' : '\n';
      const colon = indent === '' ? ':' : ': ';
      const body = values
        .map(([key, item]) =>
          `${indent.repeat(depth + 1)}${JSON.stringify(String(key))}${colon}${write(item, depth + 1)}`,
        )
        .join(`,${line}`);
      markers.delete(entry);
      return `{${line}${body}${line}${indent.repeat(depth)}}`;
    }
    throw new Error(
      `JSON.stringify cannot preserve unsupported translated Variant object ${Object.prototype.toString.call(entry)}.`,
    );
  };
  return write(value, 0);
}

/** Godot 3 `JSON.print(value, indent = "", sort_keys = false)`. */
export function godotJSONPrint3(
  value: unknown,
  indent = '',
  sortKeys = false,
): string {
  if (typeof indent !== 'string') throw new TypeError('JSON.print indent requires a String.');
  if (typeof sortKeys !== 'boolean') throw new TypeError('JSON.print sort_keys requires a boolean.');
  return godotJSONStringify(value, indent, sortKeys, false);
}

export interface GodotJSON {
  data: unknown;
  parse(text: unknown, keepText?: boolean): number;
  get_data(): unknown;
  set_data(value: unknown): void;
  get_parsed_text(): string;
  get_error_line(): number;
  get_error_message(): string;
}

export function createGodotJSON(): GodotJSON {
  let data: unknown = null;
  let errorLine = 0;
  let errorMessage = '';
  let parsedText = '';
  const resource: GodotJSON = {
    get data() {
      return data;
    },
    set data(value: unknown) {
      data = value;
      parsedText = '';
    },
    parse(text: unknown, keepText = false) {
      if (typeof keepText !== 'boolean') throw new TypeError('JSON.parse keep_text requires bool.');
      const parsed = parseJSON(text, 4);
      if (keepText && typeof text === 'string') parsedText = text;
      if (parsed.assignsValue) data = parsed.value;
      if (parsed.error === OK) {
        // `JSON::parse` resets only `err_line`; `err_str` is deliberately retained.
        errorLine = 0;
      } else {
        errorLine = parsed.line;
        errorMessage = parsed.message;
      }
      return parsed.error;
    },
    get_data: () => data,
    set_data: (value) => { data = value; parsedText = ''; },
    get_parsed_text: () => parsedText,
    get_error_line: () => errorLine,
    get_error_message: () => errorMessage,
  };
  registerGodotObjectIdentity(resource, 'JSON');
  return resource;
}

function nativeRecord(type: string, args: readonly unknown[]): Map<string, unknown> {
  return godotDictionary([['type', type], ['args', [...args]]]);
}

const PACKED_TYPE: Readonly<Record<PackedArrayKind, string>> = {
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

function packedNativeArgs(kind: PackedArrayKind, value: readonly unknown[]): unknown[] {
  if (kind === 'vector2') return value.flatMap((one) => [(one as { x: number }).x, (one as { y: number }).y]);
  if (kind === 'vector3') return value.flatMap((one) => [(one as { x: number }).x, (one as { y: number }).y, (one as { z: number }).z]);
  if (kind === 'vector4') return value.flatMap((one) => [(one as { x: number }).x, (one as { y: number }).y, (one as { z: number }).z, (one as { w: number }).w]);
  if (kind === 'color') return value.flatMap((one) => [(one as { r: number }).r, (one as { g: number }).g, (one as { b: number }).b, (one as { a: number }).a]);
  if (kind === 'int64') return value.map((entry) => typeof entry === 'bigint' ? Number(entry) : entry);
  return [...value];
}

function fromNative(value: unknown, fullObjects: boolean, depth: number): unknown {
  if (depth > GODOT4_MAX_RECURSION_DEPTH) throw new Error('JSON.from_native Variant is too deep.');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return `i:${String(value)}`;
    const encoded = Number.isNaN(value)
      ? 'nan'
      : value === Number.POSITIVE_INFINITY
        ? 'inf'
        : value === Number.NEGATIVE_INFINITY
          ? '-inf'
          : String(value);
    return `f:${encoded}`;
  }
  if (typeof value === 'bigint') return `i:${value}`;
  if (typeof value === 'string') return `s:${value}`;
  if (Array.isArray(value)) {
    const kind = packedArrayKind(value as PackedArrayValue<unknown>) as PackedArrayKind | undefined;
    if (kind !== undefined) return nativeRecord(PACKED_TYPE[kind], packedNativeArgs(kind, value));
    return value.map((entry) => fromNative(entry, fullObjects, depth + 1));
  }
  if (value instanceof Map) {
    const args: unknown[] = [];
    for (const [key, entry] of value) {
      args.push(fromNative(key, fullObjects, depth + 1), fromNative(entry, fullObjects, depth + 1));
    }
    return nativeRecord('Dictionary', args);
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (keys.join(',') === 'x,y') return nativeRecord('Vector2', [record['x'], record['y']]);
    if (keys.join(',') === 'x,y,z') return nativeRecord('Vector3', [record['x'], record['y'], record['z']]);
    if (keys.join(',') === 'w,x,y,z') return nativeRecord('Vector4', [record['x'], record['y'], record['z'], record['w']]);
    if (keys.join(',') === 'a,b,g,r') return nativeRecord('Color', [record['r'], record['g'], record['b'], record['a']]);
    if (fullObjects) throw new Error('JSON.from_native cannot encode Godot Object storage properties in this browser export.');
  }
  throw new Error(`JSON.from_native cannot preserve ${Object.prototype.toString.call(value)}.`);
}

function nativeField(value: unknown, key: string): unknown {
  if (value instanceof Map) return value.get(key);
  if (typeof value === 'object' && value !== null) return Reflect.get(value, key);
  return undefined;
}

function numericArgs(value: unknown, type: string): number[] {
  const args = nativeField(value, 'args');
  if (!Array.isArray(args) || args.some((entry) => typeof entry !== 'number')) {
    throw new TypeError(`JSON.to_native ${type}.args must be numeric Array.`);
  }
  return args;
}

function exactArgs(args: readonly number[], count: number, type: string): readonly number[] {
  if (args.length !== count) throw new Error(`JSON.to_native ${type}.args requires ${count} values.`);
  return args;
}

function chunk<T>(args: readonly number[], size: number, create: (values: readonly number[]) => T): T[] {
  if (args.length % size !== 0) throw new Error(`JSON.to_native packed args length must be divisible by ${size}.`);
  const result: T[] = [];
  for (let index = 0; index < args.length; index += size) result.push(create(args.slice(index, index + size)));
  return result;
}

function toNative(value: unknown, allowObjects: boolean, depth: number): unknown {
  if (depth > GODOT4_MAX_RECURSION_DEPTH) throw new Error('JSON.to_native Variant is too deep.');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.startsWith('i:')) {
      const integer = Number(value.slice(2));
      if (!Number.isSafeInteger(integer)) throw new RangeError(`JSON.to_native int exceeds JavaScript safe integer range: ${value.slice(2)}`);
      return integer;
    }
    if (value.startsWith('f:')) {
      const encoded = value.slice(2);
      if (encoded === 'inf') return Number.POSITIVE_INFINITY;
      if (encoded === '-inf') return Number.NEGATIVE_INFINITY;
      if (encoded === 'nan') return Number.NaN;
      const decoded = Number(encoded);
      if (Number.isNaN(decoded)) throw new Error(`JSON.to_native has invalid float spelling ${JSON.stringify(encoded)}.`);
      return decoded;
    }
    if (value.startsWith('s:')) return value.slice(2);
    if (value.startsWith('sn:') || value.startsWith('np:')) return value.slice(value.indexOf(':') + 1);
    throw new Error(`JSON.to_native String lacks a native type prefix: ${JSON.stringify(value)}.`);
  }
  if (Array.isArray(value)) return value.map((entry) => toNative(entry, allowObjects, depth + 1));
  const type = nativeField(value, 'type');
  if (typeof type !== 'string') throw new TypeError('JSON.to_native Dictionary requires a String type field.');
  if (type === 'Dictionary') {
    const args = nativeField(value, 'args');
    if (!Array.isArray(args) || args.length % 2 !== 0) throw new TypeError('JSON.to_native Dictionary.args must contain key/value pairs.');
    const result = godotDictionary();
    for (let index = 0; index < args.length; index += 2) {
      result.set(toNative(args[index], allowObjects, depth + 1), toNative(args[index + 1], allowObjects, depth + 1));
    }
    return result;
  }
  if (type === 'PackedStringArray') {
    const raw = nativeField(value, 'args');
    if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== 'string')) throw new TypeError('JSON.to_native PackedStringArray.args must be strings.');
    return packedStringArray(raw);
  }
  const args = numericArgs(value, type);
  if (type === 'Vector2') { exactArgs(args, 2, type); return vec2(args[0]!, args[1]!); }
  if (type === 'Vector3') { exactArgs(args, 3, type); return vec3(args[0]!, args[1]!, args[2]!); }
  if (type === 'Vector4') { exactArgs(args, 4, type); return { x: args[0]!, y: args[1]!, z: args[2]!, w: args[3]! }; }
  if (type === 'Color') { exactArgs(args, 4, type); return color(args[0]!, args[1]!, args[2]!, args[3]!); }
  if (type === 'PackedByteArray') return packedByteArray(args);
  if (type === 'PackedInt32Array') return packedInt32Array(args);
  if (type === 'PackedInt64Array') return packedInt64Array(args);
  if (type === 'PackedFloat32Array') return packedFloat32Array(args);
  if (type === 'PackedFloat64Array') return packedFloat64Array(args);
  if (type === 'PackedVector2Array') return packedVector2Array(chunk(args, 2, (one) => vec2(one[0]!, one[1]!)));
  if (type === 'PackedVector3Array') return packedVector3Array(chunk(args, 3, (one) => vec3(one[0]!, one[1]!, one[2]!)));
  if (type === 'PackedVector4Array') return packedVector4Array(chunk(args, 4, (one) => ({ x: one[0]!, y: one[1]!, z: one[2]!, w: one[3]! })));
  if (type === 'PackedColorArray') return packedColorArray(chunk(args, 4, (one) => color(one[0]!, one[1]!, one[2]!, one[3]!)));
  if (allowObjects) throw new Error(`JSON.to_native cannot instantiate Godot Object class ${JSON.stringify(type)} in a browser export.`);
  throw new Error(`JSON.to_native refuses unsupported native type ${JSON.stringify(type)}.`);
}

/** Exact JSON-compatible subset of Godot 4.7 JSON.from_native. */
export function godotJSONFromNative(value: unknown, fullObjects = false): unknown {
  if (typeof fullObjects !== 'boolean') throw new TypeError('JSON.from_native full_objects requires bool.');
  return fromNative(value, fullObjects, 0);
}

/** Exact JSON-compatible subset of Godot 4.7 JSON.to_native. */
export function godotJSONToNative(value: unknown, allowObjects = false): unknown {
  if (typeof allowObjects !== 'boolean') throw new TypeError('JSON.to_native allow_objects requires bool.');
  return toNative(value, allowObjects, 0);
}
