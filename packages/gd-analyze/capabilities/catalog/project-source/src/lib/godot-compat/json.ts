/**
 * @godot-class JSON
 * @role BINDING
 *
 * Godot 4.7's `JSON` (`core/io/json.cpp`, revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) onto
 * the browser's `JSON.parse` and `JSON.stringify`, with Godot's Variant mapping: an object is a
 * Dictionary (`Map`, keys in document order), an array an Array, a number a float. Stringifying
 * sorts a Dictionary's keys by default and writes a key as its string, as Godot does. Compat's
 * numbers carry no int/float tag, so an integral number is written as an int (`3`, where Godot
 * writes a float `3.0`); any other number as Godot writes a float, 14 significant digits
 * (`json.cpp:103`). A parse error's message is the browser's, not Godot's wording.
 */

export interface JSON {
  data: unknown;
  error_line: number;
  error_message: string;
  text: string;
}

const OK = 0;
const ERR_PARSE_ERROR = 43;

function toVariant(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(toVariant);
  return new Map(Object.entries(value as Record<string, unknown>).map(([name, item]) => [name, toVariant(item)]));
}

function number(value: number): string {
  if (!Number.isFinite(value)) return Number.isNaN(value) ? 'null' : value > 0 ? '1e99999' : '-1e99999';
  if (Number.isInteger(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER) return String(value);
  const precision = Math.min(100, Math.max(1, 14 - Math.floor(Math.log10(Math.abs(value)))));
  const text = value.toFixed(precision).replace(/0+$/u, '');
  return text.endsWith('.') ? `${text}0` : text;
}

function stringifyValue(value: unknown, indent: string, depth: number, sortKeys: boolean, seen: Set<object>): string {
  const pad = (level: number) => indent.repeat(level);
  const newline = indent === '' ? '' : '\n';
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return number(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return globalThis.JSON.stringify(value);
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) value = Array.from(value as unknown as ArrayLike<unknown>);
  if (Array.isArray(value)) {
    if (seen.has(value)) return '"[...]"';
    if (value.length === 0) return '[]';
    seen.add(value);
    const items = value.map((item) => pad(depth + 1) + stringifyValue(item, indent, depth + 1, sortKeys, seen));
    seen.delete(value);
    return `[${newline}${items.join(`,${newline}`)}${newline}${pad(depth)}]`;
  }
  if (value instanceof Map) {
    if (seen.has(value)) return '"{...}"';
    if (value.size === 0) return '{}';
    seen.add(value);
    const entries = [...value].map(([name, item]) => [String(name), item] as const);
    if (sortKeys) entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const colon = indent === '' ? ':' : ': ';
    const items = entries.map(([name, item]) => `${pad(depth + 1)}${globalThis.JSON.stringify(name)}${colon}${stringifyValue(item, indent, depth + 1, sortKeys, seen)}`);
    seen.delete(value);
    return `{${newline}${items.join(`,${newline}`)}${newline}${pad(depth)}}`;
  }
  return globalThis.JSON.stringify(String(value));
}

/** The 1-based line of the browser's reported error position, when it reports one. */
function errorLine(text: string, error: unknown): number {
  const at = /position (\d+)/u.exec(error instanceof Error ? error.message : '');
  if (at === null) return text.split('\n').length;
  return text.slice(0, Number(at[1])).split('\n').length;
}

/**
 * `JSON.new()`.
 *
 * @godot JSON.JSON
 * @source core/io/json.h:101
 */
export function construct(): JSON {
  return { data: null, error_line: 0, error_message: '', text: '' };
}

/**
 * @godot JSON.parse
 * @source core/io/json.cpp:603
 */
export function parse(self: JSON, json_text: string, keep_text = false): number {
  if (keep_text) self.text = json_text;
  try {
    self.data = toVariant(globalThis.JSON.parse(json_text));
    self.error_line = 0;
    self.error_message = '';
    return OK;
  } catch (error) {
    self.error_line = errorLine(json_text, error);
    self.error_message = error instanceof Error ? error.message : String(error);
    return ERR_PARSE_ERROR;
  }
}

/**
 * @godot JSON.get_data
 * @source core/io/json.h:101
 */
export function get_data(self: JSON): unknown {
  return self.data;
}

/**
 * @godot JSON.set_data
 * @source core/io/json.cpp:639
 */
export function set_data(self: JSON, data: unknown): void {
  self.data = data;
}

/**
 * @godot JSON.get_parsed_text
 * @source core/io/json.cpp:614
 */
export function get_parsed_text(self: JSON): string {
  return self.text;
}

/**
 * @godot JSON.get_error_line
 * @source core/io/json.h:103
 */
export function get_error_line(self: JSON): number {
  return self.error_line;
}

/**
 * @godot JSON.get_error_message
 * @source core/io/json.h:104
 */
export function get_error_message(self: JSON): string {
  return self.error_message;
}

/**
 * The value parsed, or null when the text is not JSON.
 *
 * @godot JSON.parse_string
 * @source core/io/json.cpp:625
 */
export function parse_string(json_string: string): unknown {
  const json = construct();
  return parse(json, json_string) === OK ? json.data : null;
}

/**
 * @godot JSON.stringify
 * @source core/io/json.cpp:618
 */
export function stringify(data: unknown, indent = '', sort_keys = true, _full_precision = false): string {
  return stringifyValue(data, indent, 0, sort_keys, new Set());
}
