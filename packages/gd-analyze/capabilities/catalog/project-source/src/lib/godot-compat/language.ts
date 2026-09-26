/**
 * GDScript language utilities whose result depends on Godot Variant/String representation.
 *
 * These stay in compat rather than the translator: `len(value)` depends on the runtime Variant,
 * `char`/`ord` operate on Godot's UTF-32 String rather than JavaScript's UTF-16 code units, and
 * `error_string` is engine-owned data. The emitter's entire job is therefore to preserve each
 * call and import this protocol.
 *
 * Authority: Godot 4.7-stable at `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88` —
 * `modules/gdscript/gdscript_utility_functions.cpp`, `core/string/ustring.cpp`,
 * `core/variant/variant_utility.cpp`, and `core/error/error_list.cpp`.
 */

/** A JavaScript typed array, excluding DataView (which Godot has no packed-array analogue for). */
function isTypedArrayWithLength(
  value: unknown,
): value is ArrayBufferView & { readonly length: number } {
  return (
    ArrayBuffer.isView(value) &&
    !(value instanceof DataView) &&
    'length' in value &&
    typeof value.length === 'number'
  );
}

/**
 * `@GDScript.len(value)` from Godot 4.7's
 * `modules/gdscript/gdscript_utility_functions.cpp:389-451` at pinned commit
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`.
 *
 * Godot String stores Unicode code points, while JavaScript's `.length` counts UTF-16 code units;
 * iteration is the JavaScript operation with the same code-point count. Dictionary is the Map
 * representation declared in `variant.ts`. Ordinary and packed arrays are native arrays and typed
 * arrays respectively. Unsupported Variants fail instead of acquiring a guessed length.
 */
export function godotLen(value: unknown): number {
  if (typeof value === 'string') {
    let length = 0;
    for (const _codePoint of value) length += 1;
    return length;
  }
  if (value instanceof Map) return value.size;
  if (Array.isArray(value) || isTypedArrayWithLength(value)) return value.length;
  throw new TypeError(`Value can't provide a Godot length.`);
}

const REPLACEMENT_CHARACTER = '\uFFFD';
const MAX_UINT32 = 0xffffffff;

function requireTranslatedInteger(value: number, utility: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(
      `${utility} requires an exactly represented Godot integer; received ${String(value)}.`,
    );
  }
}

/** Godot 4.7 `@GDScript.char`: one validated UTF-32 code point as a String. */
export function godotChar(code: number): string {
  requireTranslatedInteger(code, 'char');
  if (code < 0 || code > MAX_UINT32) {
    throw new RangeError('char expects an integer between 0 and 2^32 - 1.');
  }
  if (code === 0 || (code >= 0xd800 && code <= 0xdfff) || code > 0x10ffff) {
    return REPLACEMENT_CHARACTER;
  }
  return String.fromCodePoint(code);
}

function oneGodotCodePoint(value: string): number | undefined {
  const iterator = value[Symbol.iterator]();
  const first = iterator.next();
  if (first.done || !iterator.next().done) return undefined;
  const point = first.value.codePointAt(0);
  if (
    point === undefined ||
    point === 0 ||
    (point >= 0xd800 && point <= 0xdfff) ||
    point > 0x10ffff
  ) {
    return undefined;
  }
  return point;
}

/** Godot 4.7 `@GDScript.ord`: the UTF-32 value of a String containing exactly one character. */
export function godotOrd(value: string): number {
  const point = oneGodotCodePoint(value);
  if (point === undefined) {
    throw new RangeError('ord expects a string of length 1 (a character).');
  }
  return point;
}

const ERROR_NAMES = [
  'OK',
  'Failed',
  'Unavailable',
  'Unconfigured',
  'Unauthorized',
  'Parameter out of range',
  'Out of memory',
  'File not found',
  'File: Bad drive',
  'File: Bad path',
  'File: Permission denied',
  'File already in use',
  "Can't open file",
  "Can't write file",
  "Can't read file",
  'File unrecognized',
  'File corrupt',
  'Missing dependencies for file',
  'End of file',
  "Can't open",
  "Can't create",
  'Query failed',
  'Already in use',
  'Locked',
  'Timeout',
  "Can't connect",
  "Can't resolve",
  'Connection error',
  "Can't acquire resource",
  "Can't fork",
  'Invalid data',
  'Invalid parameter',
  'Already exists',
  'Does not exist',
  "Can't read database",
  "Can't write database",
  'Compilation failed',
  'Method not found',
  'Link failed',
  'Script failed',
  'Cyclic link detected',
  'Invalid declaration',
  'Duplicate symbol',
  'Parse error',
  'Busy',
  'Skip',
  'Help',
  'Bug',
  'Printer on fire',
] as const;

/** Godot 4.7 `@GDScript.error_string`, including its exact invalid-code sentinel. */
export function godotErrorString(error: number): string {
  requireTranslatedInteger(error, 'error_string');
  return ERROR_NAMES[error] ?? '(invalid error code)';
}
