/**
 * @godot-class String
 * @role PROTOCOL
 *
 * Godot 4.7's `String`, transcribed from `core/string/ustring.cpp` at revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`. A Godot String is an immutable value of `char32_t`
 * code points; its representation here is a JS string, and where Godot indexes characters
 * (`split`'s positions) the transcription indexes code points, not UTF-16 units. A
 * PackedByteArray is a `Uint8Array`, a PackedStringArray a frozen array of strings and a
 * PackedFloat64Array a frozen array of numbers.
 */

/**
 * `String::split(splitter, allow_empty, maxsplit)` with the Variant defaults `""`, `true`, `0`
 * (`core/variant/variant_call.cpp:2054`); an empty splitter splits every character. The result is a
 * `PackedStringArray`, represented as a frozen JS array of strings.
 *
 * @godot String.split
 * @source core/string/ustring.cpp:1013
 */
export function split(self: string, p_splitter = '', p_allow_empty = true, p_maxsplit = 0): readonly string[] {
  const ret: string[] = [];
  const text = Array.from(self);
  if (text.length === 0) {
    if (p_allow_empty) ret.push('');
    return Object.freeze(ret);
  }
  const splitter = Array.from(p_splitter);
  const len = text.length;
  const find = (from: number): number => {
    for (let at = from; at + splitter.length <= len; at += 1) {
      if (splitter.every((character, index) => text[at + index] === character)) return at;
    }
    return -1;
  };
  const substr = (from: number, count: number): string => text.slice(from, from + count).join('');
  let from = 0;
  for (;;) {
    let end: number;
    if (splitter.length === 0) {
      end = from + 1;
    } else {
      end = find(from);
      if (end < 0) end = len;
    }
    if (p_allow_empty || end > from) {
      if (p_maxsplit <= 0) {
        ret.push(substr(from, end - from));
      } else {
        if (p_maxsplit === ret.length) {
          ret.push(substr(from, len));
          break;
        }
        ret.push(substr(from, end - from));
      }
    }
    if (end === len) break;
    from = end + splitter.length;
  }
  return Object.freeze(ret);
}

/**
 * Strips characters `<= 32` from either end; the Variant defaults are `left = true, right = true`
 * (`core/variant/variant_call.cpp:2065`). Every such character is one UTF-16 unit.
 *
 * @godot String.strip_edges
 * @source core/string/ustring.cpp:4067
 */
export function strip_edges(self: string, left = true, right = true): string {
  const len = self.length;
  let beg = 0;
  let end = len;
  if (left) {
    for (let i = 0; i < len; i += 1) {
      if (self.charCodeAt(i) <= 32) beg += 1;
      else break;
    }
  }
  if (right) {
    for (let i = len - 1; i >= 0; i -= 1) {
      if (self.charCodeAt(i) <= 32) end -= 1;
      else break;
    }
  }
  if (beg === 0 && end === len) return self;
  return self.substring(beg, end);
}

/**
 * `String + String` and `String + StringName` concatenate (`OperatorEvaluatorStringConcat`,
 * `core/variant/variant_op.h:705`, registered for both at `core/variant/variant_op.cpp:222`).
 *
 * @godot String.OP_ADD
 * @source core/variant/variant_op.h:705
 */
export function op_add(left: string, right: string): string {
  return left + right;
}

/**
 * `String == String` and `String == StringName` compare characters
 * (`core/variant/variant_op.cpp:493`); against null (the `Variant` right operand) it is false
 * (`core/variant/variant_op.cpp:536`).
 *
 * @godot String.OP_EQUAL
 * @source core/variant/variant_op.cpp:493
 */
export function op_equal(left: string, right: string | null): boolean {
  return left === right;
}

/**
 * The Variant constructors: none (the empty string), `from: String`, `from: StringName` and
 * `from: NodePath` (their text). A String, a StringName and a NodePath are all JS strings here.
 *
 * @godot String.String
 * @source core/variant/variant_construct.cpp:79
 */
export function construct(from?: string): string {
  return from === undefined ? '' : String(from);
}

/** The code points of a string: Godot's `char32_t` characters. */
function cps(text: string): number[] {
  return Array.from(text, (character) => character.codePointAt(0) ?? 0);
}

/** A string from code points. */
function fromCps(points: readonly number[]): string {
  let out = '';
  for (let i = 0; i < points.length; i += 4096) out += String.fromCodePoint(...points.slice(i, i + 4096));
  return out;
}

/** `is_digit` (`core/string/char_utils.h:103`). */
function isDigit(c: number): boolean {
  return c >= 48 && c <= 57;
}

/** `is_hex_digit` (`core/string/char_utils.h:107`). */
function isHexDigit(c: number): boolean {
  return isDigit(c) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70);
}

/** `is_ascii_identifier_char` (`core/string/char_utils.h:123`). */
function isAsciiIdentifierChar(c: number): boolean {
  return (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || isDigit(c) || c === 95;
}

/** `is_whitespace` (`core/string/char_utils.h:135`). */
function isWhitespace(c: number): boolean {
  return (
    c === 32 || c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200b) || c === 0x202f || c === 0x205f ||
    c === 0x3000 || c === 0x2028 || c === 0x2029 || (c >= 9 && c <= 13) || c === 0x85
  );
}

/** `is_unicode_upper_case` (`core/string/char_utils.h:81`): Unicode uppercase letters. */
function isUpper(c: number): boolean {
  return /\p{Lu}/u.test(String.fromCodePoint(c));
}

/** `is_unicode_lower_case` (`core/string/char_utils.h:85`): Unicode lowercase letters. */
function isLower(c: number): boolean {
  return /\p{Ll}/u.test(String.fromCodePoint(c));
}

/** `_find_upper` (`core/string/ucaps.h:3037`): the simple uppercase mapping of one character. */
function upper(c: number): number {
  const mapped = String.fromCodePoint(c).toUpperCase();
  const points = cps(mapped);
  return points.length === 1 ? (points[0] ?? c) : c;
}

/** `_find_lower` (`core/string/ucaps.h:3057`): the simple lowercase mapping of one character. */
function lower(c: number): number {
  const mapped = String.fromCodePoint(c).toLowerCase();
  const points = cps(mapped);
  return points.length === 1 ? (points[0] ?? c) : c;
}

/** `Span::find_sequence` from `from` (`core/templates/span.h:151`). */
function findSequence(text: readonly number[], what: readonly number[], from: number, fold: boolean): number {
  const eq = (a: number, b: number): boolean => (fold ? lower(a) === lower(b) : a === b);
  for (let i = from; i <= text.length - what.length; i += 1) {
    let match = true;
    for (let j = 0; j < what.length; j += 1) {
      if (!eq(text[i + j] ?? 0, what[j] ?? 0)) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
}

/** `String::find` / `findn` on code points (`core/string/ustring.cpp:3033`, `:3120`). */
function findIn(text: readonly number[], what: readonly number[], p_from: number, fold: boolean): number {
  let from = p_from;
  if (from < 0) from = text.length - what.length + from + 1;
  if (from < 0 || from > text.length - what.length || what.length === 0) return -1;
  return findSequence(text, what, from, fold);
}

/** `String::rfind` / `rfindn` on code points (`core/string/ustring.cpp:3165`, `:3213`). */
function rfindIn(text: readonly number[], what: readonly number[], p_from: number, fold: boolean): number {
  let from = p_from;
  if (from < 0) from = text.length - what.length + from + 1;
  if (from < 0 || from > text.length - what.length || what.length === 0) return -1;
  const eq = (a: number, b: number): boolean => (fold ? lower(a) === lower(b) : a === b);
  for (let i = from; i >= 0; i -= 1) {
    if (what.every((c, j) => eq(text[i + j] ?? 0, c))) return i;
  }
  return -1;
}

/** `String::substr` on code points (`core/string/ustring.cpp:3011`). */
function substrCps(text: readonly number[], p_from: number, p_chars = -1): number[] {
  let chars = p_chars === -1 ? text.length - p_from : p_chars;
  if (text.length === 0 || p_from < 0 || p_from >= text.length || chars <= 0) return [];
  if (p_from + chars > text.length) chars = text.length - p_from;
  return text.slice(p_from, p_from + chars);
}

/** A script error that aborts the calling function. */
function scriptError(message: string): never {
  throw new Error(`godot-compat: ${message}`);
}

/**
 * Code point by code point; a string that ends first is less. -1, 0 or 1.
 *
 * @godot String.casecmp_to
 * @source core/string/ustring.cpp:476
 */
export function casecmp_to(self: string, p_to: string): number {
  if (self.length === 0 && p_to.length === 0) return 0;
  if (self.length === 0) return -1;
  if (p_to.length === 0) return 1;
  const a = cps(self);
  const b = cps(p_to);
  for (let i = 0; ; i += 1) {
    const x = a[i];
    const y = b[i];
    if (x === undefined && y === undefined) return 0;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x < y) return -1;
    if (x > y) return 1;
  }
}

/**
 * As `casecmp_to`, each character upper-cased first.
 *
 * @godot String.nocasecmp_to
 * @source core/string/ustring.cpp:444
 */
export function nocasecmp_to(self: string, p_to: string): number {
  return casecmp_to(fromCps(cps(self).map(upper)), fromCps(cps(p_to).map(upper)));
}

/** `natural_cmp_common` (`core/string/ustring.cpp`): two digit runs compared by value. */
function naturalCmpCommon(a: readonly number[], b: readonly number[], at: { i: number; j: number }): number {
  let thisSub = at.i;
  let thatSub = at.j;
  while (isDigit(a[at.i] ?? 0)) at.i += 1;
  while (isDigit(b[at.j] ?? 0)) at.j += 1;
  while (a[thisSub] === 48) thisSub += 1;
  while (b[thatSub] === 48) thatSub += 1;
  const thisLen = at.i - thisSub;
  const thatLen = at.j - thatSub;
  if (thisLen < thatLen) return -1;
  if (thisLen > thatLen) return 1;
  while (thisSub !== at.i && thatSub !== at.j) {
    const x = a[thisSub] ?? 0;
    const y = b[thatSub] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
    thisSub += 1;
    thatSub += 1;
  }
  return 0;
}

/** `naturalcasecmp_to_base` / `naturalnocasecmp_to_base` from positions `at`. */
function naturalCompare(a: readonly number[], b: readonly number[], fold: boolean, at = { i: 0, j: 0 }): number {
  const ch = (text: readonly number[], k: number): number => text[k] ?? 0;
  while (ch(a, at.i) === 46 || ch(b, at.j) === 46) {
    if (ch(a, at.i++) !== 46) return 1;
    if (ch(b, at.j++) !== 46) return -1;
    if (!ch(b, at.j)) return 1;
    if (!ch(a, at.i)) return -1;
  }
  while (ch(a, at.i)) {
    const x = ch(a, at.i);
    const y = ch(b, at.j);
    if (!y) return 1;
    if (isDigit(x)) {
      if (!isDigit(y)) return -1;
      const ret = naturalCmpCommon(a, b, at);
      if (ret) return ret;
    } else if (isDigit(y)) {
      return 1;
    } else {
      const cx = fold ? upper(x) : x;
      const cy = fold ? upper(y) : y;
      if (cx < cy) return -1;
      if (cx > cy) return 1;
      at.i += 1;
      at.j += 1;
    }
  }
  return ch(b, at.j) ? -1 : 0;
}

/**
 * "Natural" order: digit runs compare by numeric value, leading dots first. -1, 0 or 1.
 *
 * @godot String.naturalcasecmp_to
 * @source core/string/ustring.cpp:599
 */
export function naturalcasecmp_to(self: string, p_to: string): number {
  return naturalCompare(cps(self), cps(p_to), false);
}

/**
 * @godot String.naturalnocasecmp_to
 * @source core/string/ustring.cpp:656
 */
export function naturalnocasecmp_to(self: string, p_to: string): number {
  return naturalCompare(cps(self), cps(p_to), true);
}

/** `file_cmp_common`: leading underscores and dots, as file managers sort them. */
function fileCompare(self: string, p_to: string, fold: boolean): number {
  const a = cps(self);
  const b = cps(p_to);
  const at = { i: 0, j: 0 };
  const ch = (text: readonly number[], k: number): number => text[k] ?? 0;
  while ((ch(a, at.i) === 95 && ch(b, at.j)) || (ch(a, at.i) && ch(b, at.j) === 95)) {
    if (ch(a, at.i) !== 95) return ch(a, at.i) === 46 ? -1 : 1;
    if (ch(b, at.j) !== 95) return ch(b, at.j) === 46 ? 1 : -1;
    at.i += 1;
    at.j += 1;
  }
  return naturalCompare(a, b, fold, at);
}

/**
 * Natural order after leading `_` and `.` rules (a file manager's sort).
 *
 * @godot String.filecasecmp_to
 * @source core/string/ustring.cpp:679
 */
export function filecasecmp_to(self: string, p_to: string): number {
  return fileCompare(self, p_to, false);
}

/**
 * @godot String.filenocasecmp_to
 * @source core/string/ustring.cpp:691
 */
export function filenocasecmp_to(self: string, p_to: string): number {
  return fileCompare(self, p_to, true);
}

/**
 * The number of characters (code points).
 *
 * @godot String.length
 * @source core/string/ustring.h:304
 */
export function length(self: string): number {
  return cps(self).length;
}

/**
 * `len` characters from `from`; the Variant default `len = -1` takes the rest.
 *
 * @godot String.substr
 * @source core/string/ustring.cpp:3011
 */
export function substr(self: string, p_from: number, p_len = -1): string {
  return fromCps(substrCps(cps(self), p_from, p_len));
}

/**
 * The `slice`-th piece between delimiters; the whole string when the delimiter is absent, "" when
 * the string or the delimiter is empty or the slice is out of range.
 *
 * @godot String.get_slice
 * @source core/string/ustring.cpp:861
 */
export function get_slice(self: string, p_delimiter: string, p_slice: number): string {
  if (self.length === 0 || p_delimiter.length === 0 || p_slice < 0) return '';
  const text = cps(self);
  const del = cps(p_delimiter);
  if (findIn(text, del, 0, false) === -1) return self;
  let pos = 0;
  let prev = 0;
  for (let i = 0; ; i += 1) {
    pos = findIn(text, del, pos, false);
    if (pos === -1) pos = text.length;
    if (p_slice === i) return fromCps(substrCps(text, prev, pos - prev));
    if (pos === text.length) return '';
    pos += del.length;
    prev = pos;
  }
}

/**
 * As `get_slice` with a one-character delimiter given by its code.
 *
 * @godot String.get_slicec
 * @source core/string/ustring.cpp:942
 */
export function get_slicec(self: string, p_delimiter: number, p_slice: number): string {
  if (self.length === 0 || p_slice < 0) return '';
  const text = cps(self);
  let prev = 0;
  let count = 0;
  for (let i = 0; ; i += 1) {
    const c = text[i];
    if (c === undefined || c === p_delimiter) {
      if (p_slice === count) return fromCps(substrCps(text, prev, i - prev));
      if (c === undefined) return '';
      count += 1;
      prev = i + 1;
    }
  }
}

/**
 * The number of pieces the delimiter splits the string into; 0 for an empty string or delimiter.
 *
 * @godot String.get_slice_count
 * @source core/string/ustring.cpp:822
 */
export function get_slice_count(self: string, p_delimiter: string): number {
  if (self.length === 0 || p_delimiter.length === 0) return 0;
  const text = cps(self);
  const del = cps(p_delimiter);
  let pos = 0;
  let slices = 1;
  while ((pos = findIn(text, del, pos, false)) >= 0) {
    slices += 1;
    pos += del.length;
  }
  return slices;
}

/**
 * The first index of `what` at or after `from` (counted from the end when negative; the Variant
 * default is 0), else -1; an empty `what` is never found.
 *
 * @godot String.find
 * @source core/string/ustring.cpp:3033
 */
export function find(self: string, p_what: string, p_from = 0): number {
  return findIn(cps(self), cps(p_what), p_from, false);
}

/**
 * `find`, ignoring case.
 *
 * @godot String.findn
 * @source core/string/ustring.cpp:3120
 */
export function findn(self: string, p_what: string, p_from = 0): number {
  return findIn(cps(self), cps(p_what), p_from, true);
}

/** `String::_count` (`core/string/ustring.cpp`): non-overlapping occurrences in `[from, to)`. */
function countIn(self: string, what: string, p_from: number, p_to: number, fold: boolean): number {
  const w = cps(what);
  if (w.length === 0) return 0;
  const text = cps(self);
  if (text.length < w.length) return 0;
  if (p_from < 0 || p_to < 0) return 0;
  let to = p_to;
  if (to === 0) to = text.length;
  else if (p_from >= to) return 0;
  const str = p_from === 0 && to === text.length ? text : substrCps(text, p_from, to - p_from);
  let c = 0;
  let idx = 0;
  while ((idx = findIn(str, w, idx, fold)) !== -1) {
    idx += w.length;
    c += 1;
  }
  return c;
}

/**
 * Non-overlapping occurrences of `what` between `from` and `to` (the Variant defaults are 0 and 0,
 * where a `to` of 0 means the end).
 *
 * @godot String.count
 * @source core/string/ustring.cpp:3426
 */
export function count(self: string, p_what: string, p_from = 0, p_to = 0): number {
  return countIn(self, p_what, p_from, p_to, false);
}

/**
 * `count`, ignoring case.
 *
 * @godot String.countn
 * @source core/string/ustring.cpp:3434
 */
export function countn(self: string, p_what: string, p_from = 0, p_to = 0): number {
  return countIn(self, p_what, p_from, p_to, true);
}

/**
 * The last index of `what` at or before `from` (the Variant default -1 is the end), else -1.
 *
 * @godot String.rfind
 * @source core/string/ustring.cpp:3165
 */
export function rfind(self: string, p_what: string, p_from = -1): number {
  return rfindIn(cps(self), cps(p_what), p_from, false);
}

/**
 * `rfind`, ignoring case.
 *
 * @godot String.rfindn
 * @source core/string/ustring.cpp:3213
 */
export function rfindn(self: string, p_what: string, p_from = -1): number {
  return rfindIn(cps(self), cps(p_what), p_from, true);
}

/** `_wildcard_match` (`core/string/ustring.cpp`): `*` any run, `?` one character but `.`. */
function wildcard(pattern: readonly number[], text: readonly number[], pi: number, ti: number, caseSensitive: boolean): boolean {
  const p = pattern[pi];
  const t = text[ti];
  if (p === undefined) return t === undefined;
  if (p === 42) return wildcard(pattern, text, pi + 1, ti, caseSensitive) || (t !== undefined && wildcard(pattern, text, pi, ti + 1, caseSensitive));
  if (p === 63) return t !== undefined && t !== 46 && wildcard(pattern, text, pi + 1, ti + 1, caseSensitive);
  if (t === undefined) return false;
  const same = caseSensitive ? t === p : upper(t) === upper(p);
  return same && wildcard(pattern, text, pi + 1, ti + 1, caseSensitive);
}

/**
 * A wildcard match of the whole string (`*`, `?`); false when either is empty.
 *
 * @godot String.match
 * @source core/string/ustring.cpp:3535
 */
export function match(self: string, p_expr: string): boolean {
  if (p_expr.length === 0 || self.length === 0) return false;
  return wildcard(cps(p_expr), cps(self), 0, 0, true);
}

/**
 * `match`, ignoring case.
 *
 * @godot String.matchn
 * @source core/string/ustring.cpp:3543
 */
export function matchn(self: string, p_expr: string): boolean {
  if (p_expr.length === 0 || self.length === 0) return false;
  return wildcard(cps(p_expr), cps(self), 0, 0, false);
}

/**
 * @godot String.begins_with
 * @source core/string/ustring.cpp:3295
 */
export function begins_with(self: string, p_text: string): boolean {
  return self.startsWith(p_text);
}

/**
 * @godot String.ends_with
 * @source core/string/ustring.cpp:3258
 */
export function ends_with(self: string, p_text: string): boolean {
  return self.endsWith(p_text);
}

/** `_base_is_subsequence_of` (`core/string/ustring.cpp`). */
function isSubsequence(self: string, p_text: string, fold: boolean): boolean {
  const src = cps(self);
  const tgt = cps(p_text);
  if (src.length === 0) return true;
  if (src.length > tgt.length) return false;
  let at = 0;
  for (const c of tgt) {
    const s = src[at] ?? 0;
    if (fold ? lower(s) === lower(c) : s === c) {
      at += 1;
      if (at === src.length) return true;
    }
  }
  return false;
}

/**
 * Whether every character appears in `text` in order.
 *
 * @godot String.is_subsequence_of
 * @source core/string/ustring.cpp:3335
 */
export function is_subsequence_of(self: string, p_text: string): boolean {
  return isSubsequence(self, p_text, false);
}

/**
 * `is_subsequence_of`, ignoring case.
 *
 * @godot String.is_subsequence_ofn
 * @source core/string/ustring.cpp:3339
 */
export function is_subsequence_ofn(self: string, p_text: string): boolean {
  return isSubsequence(self, p_text, true);
}

/**
 * Every pair of adjacent characters.
 *
 * @godot String.bigrams
 * @source core/string/ustring.cpp:3476
 */
export function bigrams(self: string): readonly string[] {
  const text = cps(self);
  const out: string[] = [];
  for (let i = 0; i < text.length - 1; i += 1) out.push(fromCps(text.slice(i, i + 2)));
  return Object.freeze(out);
}

/**
 * The Sorensen-Dice coefficient of the two strings' bigrams: 1 for equal strings, 0 when either has
 * fewer than two characters.
 *
 * @godot String.similarity
 * @source core/string/ustring.cpp:3491
 */
export function similarity(self: string, p_text: string): number {
  if (self === p_text) return 1;
  const a = cps(self);
  const b = cps(p_text);
  if (a.length < 2 || b.length < 2) return 0;
  const srcSize = a.length - 1;
  const tgtSize = b.length - 1;
  let inter = 0;
  for (let i = 0; i < srcSize; i += 1) {
    for (let j = 0; j < tgtSize; j += 1) {
      if (a[i] === b[j] && a[i + 1] === b[j + 1]) {
        inter += 1;
        break;
      }
    }
  }
  return Math.fround(Math.fround(2 * inter) / (srcSize + tgtSize));
}

/** `%.<digits>lf` of a finite double: its exact value rounded half to even at `digits` places. */
function printfFixed(value: number, digits: number): string {
  const negative = value < 0 || Object.is(value, -0);
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, Math.abs(value));
  const high = view.getUint32(0);
  const low = view.getUint32(4);
  const exponentBits = (high >>> 20) & 0x7ff;
  let mantissa = (BigInt(high & 0xfffff) << 32n) | BigInt(low);
  let exponent: number;
  if (exponentBits === 0) exponent = -1074;
  else {
    mantissa |= 1n << 52n;
    exponent = exponentBits - 1075;
  }
  let numerator = mantissa * 10n ** BigInt(digits);
  let denominator = 1n;
  if (exponent >= 0) numerator <<= BigInt(exponent);
  else denominator <<= BigInt(-exponent);
  let quotient = numerator / denominator;
  const twice = 2n * (numerator % denominator);
  if (twice > denominator || (twice === denominator && (quotient & 1n) === 1n)) quotient += 1n;
  let text = quotient.toString();
  if (digits > 0) {
    text = text.padStart(digits + 1, '0');
    text = `${text.slice(0, -digits)}.${text.slice(-digits)}`;
  }
  return `${negative ? '-' : ''}${text}`;
}

/** `String::num_real(double, true)` (`core/string/ustring.cpp:1573`): a float's text. */
function numReal(value: number): string {
  if (Number.isNaN(value) || !Number.isFinite(value)) return num(value, 0);
  if (Number.isInteger(value) && Math.abs(value) < 2 ** 63) return `${BigInt(value).toString()}.0`;
  let decimals = 14;
  if (Math.abs(value) > 10) decimals -= Math.floor(Math.log10(Math.abs(value)));
  return num(value, decimals);
}

/**
 * The text a value converts to (`Variant::stringify`, `core/variant/variant.cpp:1597`) as this
 * representation holds it: an integer-valued number as an int, any other as a float; strings inside
 * containers quoted.
 */
function stringify(value: unknown, nested = false): string {
  if (typeof value === 'string') return nested ? `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"` : value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value === null || value === undefined) return '<null>';
  if (typeof value === 'number') return Number.isInteger(value) ? BigInt(value).toString() : numReal(value);
  if (Array.isArray(value)) return `[${value.map((element) => stringify(element, true)).join(', ')}]`;
  if (value instanceof Map) {
    if (value.size === 0) return '{  }';
    return `{ ${[...value].map(([k, v]) => `${stringify(k, true)}: ${stringify(v, true)}`).join(', ')} }`;
  }
  if (typeof value === 'object' && Object.isFrozen(value) && Object.getPrototypeOf(value) === Object.prototype) {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).join(',');
    if (keys === 'r,g,b,a') return `(${['r', 'g', 'b', 'a'].map((k) => num(record[k] as number, 4)).join(', ')})`;
    const members = Object.values(record).map((member) =>
      typeof member === 'number' ? (Number.isInteger(member) ? String(member) : numReal(member)) : stringify(member, true),
    );
    return `(${members.join(', ')})`;
  }
  return String(value);
}

/** `String::replace` / `replacen` (`_replace_common`, `core/string/ustring.cpp`). */
function replaceAllIn(self: string, what: string, forwhat: string, fold: boolean): string {
  const w = cps(what);
  if (w.length === 0 || self.length === 0) return self;
  const text = cps(self);
  const out: number[] = [];
  const with_ = cps(forwhat);
  let last = 0;
  let at = 0;
  while ((at = findIn(text, w, at, fold)) >= 0) {
    out.push(...text.slice(last, at), ...with_);
    at += w.length;
    last = at;
  }
  if (last === 0 && out.length === 0) return self;
  out.push(...text.slice(last));
  return fromCps(out);
}

/** `String::replace_first` (`core/string/ustring.cpp`). */
function replaceFirst(self: string, what: string, forwhat: string): string {
  const text = cps(self);
  const w = cps(what);
  const at = findIn(text, w, 0, false);
  if (at < 0) return self;
  return fromCps([...text.slice(0, at), ...cps(forwhat), ...text.slice(at + w.length)]);
}

/**
 * Each placeholder (the Variant default is `"{_}"`, `_` standing for the key) replaced: an Array of
 * values by index (or, without `_`, each value in turn into the first placeholder), an Array of
 * `[key, value]` pairs, or a Dictionary by key. Another argument is an error that returns the string.
 *
 * @godot String.format
 * @source core/string/ustring.cpp:3550
 */
export function format(self: string, p_values: unknown, p_placeholder = '{_}'): string {
  let out = self;
  if (Array.isArray(p_values)) {
    p_values.forEach((value, i) => {
      if (Array.isArray(value)) {
        if (value.length === 2) out = replaceAllIn(out, replaceAllIn(p_placeholder, '_', stringify(value[0]), false), stringify(value[1]), false);
      } else if (p_placeholder.includes('_')) {
        out = replaceAllIn(out, replaceAllIn(p_placeholder, '_', String(i), false), stringify(value), false);
      } else {
        out = replaceFirst(out, p_placeholder, stringify(value));
      }
    });
  } else if (p_values instanceof Map) {
    for (const [key, value] of p_values) out = replaceAllIn(out, replaceAllIn(p_placeholder, '_', stringify(key), false), stringify(value), false);
  }
  return out;
}

/**
 * Every occurrence of `what` replaced.
 *
 * @godot String.replace
 * @source core/string/ustring.cpp:3717
 */
export function replace(self: string, p_what: string, p_forwhat: string): string {
  return replaceAllIn(self, p_what, p_forwhat, false);
}

/**
 * `replace`, matching case-insensitively.
 *
 * @godot String.replacen
 * @source core/string/ustring.cpp:3910
 */
export function replacen(self: string, p_what: string, p_forwhat: string): string {
  return replaceAllIn(self, p_what, p_forwhat, true);
}

/**
 * Every character with code `key` replaced by the character `with`; a NUL `with` is an error that
 * returns the string.
 *
 * @godot String.replace_char
 * @source core/string/ustring.cpp:3799
 */
export function replace_char(self: string, p_key: number, p_with: number): string {
  if (p_with === 0 || p_key === 0) return self;
  return fromCps(cps(self).map((c) => (c === p_key ? p_with : c)));
}

/**
 * Every character in `keys` replaced by the character `with`.
 *
 * @godot String.replace_chars
 * @source core/string/ustring.cpp:3902
 */
export function replace_chars(self: string, p_keys: string, p_with: number): string {
  if (p_with === 0) return self;
  const keys = new Set(cps(p_keys));
  if (keys.size === 0) return self;
  return fromCps(cps(self).map((c) => (keys.has(c) ? p_with : c)));
}

/**
 * Every character with code `what` removed.
 *
 * @godot String.remove_char
 * @source core/string/ustring.cpp:2898
 */
export function remove_char(self: string, p_what: number): string {
  if (p_what === 0) return self;
  return fromCps(cps(self).filter((c) => c !== p_what));
}

/**
 * Every character in `chars` removed.
 *
 * @godot String.remove_chars
 * @source core/string/ustring.cpp:3003
 */
export function remove_chars(self: string, p_chars: string): string {
  const chars = new Set(cps(p_chars));
  if (chars.size === 0) return self;
  return fromCps(cps(self).filter((c) => !chars.has(c)));
}

/**
 * The string `count` times; a negative count is an error that returns "".
 *
 * @godot String.repeat
 * @source core/string/ustring.cpp:3918
 */
export function repeat(self: string, p_count: number): string {
  if (p_count < 0) return '';
  return self.repeat(p_count);
}

/**
 * The characters in reverse order.
 *
 * @godot String.reverse
 * @source core/string/ustring.cpp:3945
 */
export function reverse(self: string): string {
  return fromCps(cps(self).reverse());
}

/**
 * `what` inserted before character `position` (clamped to the end); an empty `what` or a negative
 * position returns the string.
 *
 * @godot String.insert
 * @source core/string/ustring.cpp:2849
 */
export function insert(self: string, p_position: number, p_what: string): string {
  if (p_what.length === 0 || p_position < 0) return self;
  const text = cps(self);
  const at = Math.min(p_position, text.length);
  return fromCps([...text.slice(0, at), ...cps(p_what), ...text.slice(at)]);
}

/**
 * `chars` characters removed from `position` (the Variant default is 1); a negative position or
 * count is an error that returns "".
 *
 * @godot String.erase
 * @source core/string/ustring.cpp:2881
 */
export function erase(self: string, p_position: number, p_chars = 1): string {
  if (p_position < 0 || p_chars < 0) return '';
  return left(self, p_position) + substr(self, p_position + p_chars);
}

/**
 * `_separate_compound_words` (`core/string/ustring.cpp`): case, digit and separator boundaries
 * become spaces, and the result is lower-cased.
 */
function separateCompoundWords(self: string): string {
  const text = cps(self);
  if (text.length === 0) return self;
  const out: number[] = [];
  let start = 0;
  let prevUpper = isUpper(text[0] ?? 0);
  let prevLower = isLower(text[0] ?? 0);
  let prevDigit = isDigit(text[0] ?? 0);
  for (let i = 1; i < text.length; i += 1) {
    const c = text[i] ?? 0;
    const currUpper = isUpper(c);
    const currLower = isLower(c);
    const currDigit = isDigit(c);
    const nextLower = i + 1 < text.length && isLower(text[i + 1] ?? 0);
    const condA = prevLower && currUpper;
    const condB = (prevUpper || prevDigit) && currUpper && nextLower;
    const condC = prevDigit && currLower && nextLower;
    const condD = (prevUpper || prevLower) && currDigit;
    if (condA || condB || condC || condD) {
      out.push(...text.slice(start, i), 32);
      start = i;
    }
    prevUpper = currUpper;
    prevLower = currLower;
    prevDigit = currDigit;
  }
  out.push(...text.slice(start));
  return fromCps(out.map((c) => (isWhitespace(c) || c === 95 || c === 45 || c === 0x2010 || c === 0x2011 ? 32 : lower(c))));
}

/** The non-empty space-separated words of `_separate_compound_words().strip_edges()`. */
function compoundWords(self: string): string[] {
  return strip_edges(separateCompoundWords(self)).split(' ').filter((word) => word.length > 0);
}

/** A word with its first character mapped. */
function mapFirst(word: string, fn: (c: number) => number): string {
  const text = cps(word);
  return fromCps([fn(text[0] ?? 0), ...text.slice(1)]);
}

/**
 * Words separated and each capitalized, joined with spaces (`"move_local_x"` is `"Move Local X"`).
 *
 * @godot String.capitalize
 * @source core/string/ustring.cpp:756
 */
export function capitalize(self: string): string {
  return compoundWords(self).map((word) => mapFirst(word, upper)).join(' ');
}

/**
 * @godot String.to_camel_case
 * @source core/string/ustring.cpp:772
 */
export function to_camel_case(self: string): string {
  return compoundWords(self).map((word, i) => mapFirst(word, i === 0 ? lower : upper)).join('');
}

/**
 * @godot String.to_pascal_case
 * @source core/string/ustring.cpp:789
 */
export function to_pascal_case(self: string): string {
  return compoundWords(self).map((word) => mapFirst(word, upper)).join('');
}

/**
 * @godot String.to_snake_case
 * @source core/string/ustring.cpp:802
 */
export function to_snake_case(self: string): string {
  return separateCompoundWords(self).replaceAll(' ', '_');
}

/**
 * @godot String.to_kebab_case
 * @source core/string/ustring.cpp:806
 */
export function to_kebab_case(self: string): string {
  return separateCompoundWords(self).replaceAll(' ', '-');
}

/**
 * `split` from the right: with `maxsplit` the leftmost remainder stays whole. The Variant defaults
 * are `""`, `true`, `0`; an empty delimiter splits every character.
 *
 * @godot String.rsplit
 * @source core/string/ustring.cpp:1110
 */
export function rsplit(self: string, p_delimiter = '', p_allow_empty = true, p_maxsplit = 0): readonly string[] {
  const text = cps(self);
  const del = cps(p_delimiter);
  const ret: string[] = [];
  let remaining = text.length;
  for (;;) {
    if (remaining < del.length || (p_maxsplit > 0 && p_maxsplit === ret.length)) {
      if (p_allow_empty || remaining > 0) ret.push(fromCps(substrCps(text, 0, remaining)));
      break;
    }
    let leftEdge: number;
    if (del.length === 0) {
      leftEdge = remaining - 1;
      if (leftEdge === 0) leftEdge -= 1;
    } else {
      leftEdge = rfindIn(text, del, remaining - del.length, false);
    }
    if (leftEdge < 0) {
      ret.push(fromCps(substrCps(text, 0, remaining)));
      break;
    }
    const start = leftEdge + del.length;
    if (p_allow_empty || start < remaining) ret.push(fromCps(substrCps(text, start, remaining - start)));
    remaining = leftEdge;
  }
  return Object.freeze(ret.reverse());
}

/**
 * Each piece between delimiters read as a float (`to_float`); the Variant default for
 * `allow_empty` is true.
 *
 * @godot String.split_floats
 * @source core/string/ustring.cpp:1195
 */
export function split_floats(self: string, p_delimiter: string, p_allow_empty = true): readonly number[] {
  const text = cps(self);
  const ret: number[] = [];
  if (text.length === 0) return Object.freeze(ret);
  const del = cps(p_delimiter);
  let from = 0;
  for (;;) {
    let end = findIn(text, del, from, false);
    if (end < 0) end = text.length;
    if (p_allow_empty || end > from) ret.push(strtod(text.slice(from)));
    if (end === text.length) break;
    from = end + del.length;
  }
  return Object.freeze(ret);
}

/**
 * The parts joined with this string between them.
 *
 * @godot String.join
 * @source core/string/ustring.cpp:1319
 */
export function join(self: string, p_parts: readonly string[]): string {
  return p_parts.join(self);
}

/**
 * Each character through the simple uppercase mapping.
 *
 * @godot String.to_upper
 * @source core/string/ustring.cpp:1368
 */
export function to_upper(self: string): string {
  return fromCps(cps(self).map(upper));
}

/**
 * Each character through the simple lowercase mapping.
 *
 * @godot String.to_lower
 * @source core/string/ustring.cpp:1387
 */
export function to_lower(self: string): string {
  return fromCps(cps(self).map(lower));
}

/**
 * The first `length` characters; a negative length drops that many from the end.
 *
 * @godot String.left
 * @source core/string/ustring.cpp:3962
 */
export function left(self: string, p_length: number): string {
  const text = cps(self);
  const len = p_length < 0 ? text.length + p_length : p_length;
  if (len <= 0) return '';
  return len >= text.length ? self : fromCps(text.slice(0, len));
}

/**
 * The last `length` characters; a negative length drops that many from the start.
 *
 * @godot String.right
 * @source core/string/ustring.cpp:3980
 */
export function right(self: string, p_length: number): string {
  const text = cps(self);
  const len = p_length < 0 ? text.length + p_length : p_length;
  if (len <= 0) return '';
  return len >= text.length ? self : fromCps(text.slice(text.length - len));
}

/**
 * Every character below 32 removed.
 *
 * @godot String.strip_escapes
 * @source core/string/ustring.cpp:4098
 */
export function strip_escapes(self: string): string {
  return fromCps(cps(self).filter((c) => c >= 32));
}

/**
 * Leading characters found in `chars` removed.
 *
 * @godot String.lstrip
 * @source core/string/ustring.cpp:4111
 */
export function lstrip(self: string, p_chars: string): string {
  const text = cps(self);
  const chars = new Set(cps(p_chars));
  let beg = 0;
  while (beg < text.length && chars.has(text[beg] ?? 0)) beg += 1;
  return beg === 0 ? self : fromCps(text.slice(beg));
}

/**
 * Trailing characters found in `chars` removed.
 *
 * @godot String.rstrip
 * @source core/string/ustring.cpp:4128
 */
export function rstrip(self: string, p_chars: string): string {
  const text = cps(self);
  const chars = new Set(cps(p_chars));
  let end = text.length - 1;
  while (end >= 0 && chars.has(text[end] ?? 0)) end -= 1;
  return end === text.length - 1 ? self : fromCps(text.slice(0, end + 1));
}

/** The last `/` or `\` in the string, or -1. */
function lastSeparator(self: string): number {
  const text = cps(self);
  for (let i = text.length - 1; i >= 0; i -= 1) if (text[i] === 47 || text[i] === 92) return i;
  return -1;
}

/**
 * The text after the last `.` of the file name, else "".
 *
 * @godot String.get_extension
 * @source core/string/ustring.cpp:5034
 */
export function get_extension(self: string): string {
  const text = cps(self);
  const pos = text.lastIndexOf(46);
  if (pos < 0 || pos < lastSeparator(self)) return '';
  return fromCps(text.slice(pos + 1));
}

/**
 * The path without the file name's last extension.
 *
 * @godot String.get_basename
 * @source core/string/ustring.cpp:5133
 */
export function get_basename(self: string): string {
  const text = cps(self);
  const pos = text.lastIndexOf(46);
  if (pos < 0 || pos < lastSeparator(self)) return self;
  return fromCps(text.slice(0, pos));
}

/**
 * `path` appended after a `/` unless one side already supplies it.
 *
 * @godot String.path_join
 * @source core/string/ustring.cpp:5043
 */
export function path_join(self: string, p_path: string): string {
  if (self.length === 0) return p_path;
  if (self.endsWith('/') || p_path.startsWith('/')) return self + p_path;
  return `${self}/${p_path}`;
}

/**
 * The code of the character at `at`; an index outside the string is an error that returns 0.
 *
 * @godot String.unicode_at
 * @source core/string/ustring.cpp:3998
 */
export function unicode_at(self: string, p_at: number): number {
  const text = cps(self);
  if (p_at < 0 || p_at >= text.length) return 0;
  return text[p_at] ?? 0;
}

/**
 * Every non-empty line prefixed.
 *
 * @godot String.indent
 * @source core/string/ustring.cpp:4003
 */
export function indent(self: string, p_prefix: string): string {
  return self
    .split('\n')
    .map((line) => (line.length === 0 ? line : p_prefix + line))
    .join('\n');
}

/**
 * The indentation of the first line with text removed from every line that shares it.
 *
 * @godot String.dedent
 * @source core/string/ustring.cpp:4024
 */
export function dedent(self: string): string {
  const text = cps(self);
  const out: number[] = [];
  let indentText: number[] = [];
  let hasIndent = false;
  let hasText = false;
  let lineStart = 0;
  let indentStop = -1;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i] ?? 0;
    if (c === 10) {
      if (hasText) out.push(...substrCps(text, indentStop, i - indentStop));
      out.push(10);
      hasText = false;
      lineStart = i + 1;
      indentStop = -1;
    } else if (!hasText) {
      if (c > 32) {
        hasText = true;
        if (!hasIndent) {
          hasIndent = true;
          indentText = text.slice(lineStart, i);
          indentStop = i;
        }
      }
      if (hasIndent && indentStop < 0) {
        const j = i - lineStart;
        if (j >= indentText.length || c !== indentText[j]) indentStop = i;
      }
    }
  }
  if (hasText) out.push(...substrCps(text, indentStop, text.length - indentStop));
  return fromCps(out);
}

/**
 * djb2 over the code points (`hash * 33 + c`), a 32-bit unsigned value.
 *
 * @godot String.hash
 * @source core/string/ustring.cpp:2755
 */
export function hash(self: string): number {
  let h = 5381;
  for (const c of cps(self)) h = (Math.imul(h, 33) + c) >>> 0;
  return h;
}

/** The UTF-8 bytes of a string (`String::utf8`). */
function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Lowercase hex of bytes (`String::hex_encode_buffer`, `core/string/ustring.cpp`). */
function hexEncode(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** MD5 (RFC 1321) of bytes, as `CryptoCore::md5` computes it. */
function md5(bytes: Uint8Array): Uint8Array {
  const shifts = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const k = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, (bytes.length * 8) >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bytes.length / 0x20000000), true);
  let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let offset = 0; offset < padded.length; offset += 64) {
    const m = (j: number): number => view.getUint32(offset + j * 4, true);
    let [a, b, c, d] = [a0, b0, c0, d0];
    for (let i = 0; i < 64; i += 1) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const s = shifts[(i >> 4) * 4 + (i % 4)] ?? 0;
      const sum = (a + f + (k[i] ?? 0) + m(g)) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((sum << s) | (sum >>> (32 - s)))) >>> 0;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  const out = new Uint8Array(16);
  const outView = new DataView(out.buffer);
  [a0, b0, c0, d0].forEach((word, i) => outView.setUint32(i * 4, word, true));
  return out;
}

/** Big-endian 64-byte-block padding for SHA-1 and SHA-256. */
function shaPad(bytes: Uint8Array): DataView {
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bytes.length / 0x20000000));
  view.setUint32(padded.length - 4, (bytes.length * 8) >>> 0);
  return view;
}

/** SHA-1 (FIPS 180-4) of bytes, as `CryptoCore::sha1` computes it. */
function sha1(bytes: Uint8Array): Uint8Array {
  const view = shaPad(bytes);
  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const w = new Uint32Array(80);
  const rotl = (x: number, n: number): number => ((x << n) | (x >>> (32 - n))) >>> 0;
  for (let offset = 0; offset < view.byteLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 80; i += 1) w[i] = rotl((w[i - 3] ?? 0) ^ (w[i - 8] ?? 0) ^ (w[i - 14] ?? 0) ^ (w[i - 16] ?? 0), 1);
    let [a, b, c, d, e] = h as [number, number, number, number, number];
    for (let i = 0; i < 80; i += 1) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const t = (rotl(a, 5) + f + e + k + (w[i] ?? 0)) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = t;
    }
    [a, b, c, d, e].forEach((v, i) => {
      h[i] = ((h[i] ?? 0) + v) >>> 0;
    });
  }
  const out = new Uint8Array(20);
  const outView = new DataView(out.buffer);
  h.forEach((word, i) => outView.setUint32(i * 4, word));
  return out;
}

/** The first 32 bits of the fractional part of `root(prime)` for the first primes (SHA-256's constants). */
function shaConstants(count: number, root: (x: number) => number): number[] {
  const primes: number[] = [];
  for (let n = 2; primes.length < count; n += 1) if (primes.every((p) => n % p !== 0)) primes.push(n);
  return primes.map((p) => {
    const r = root(p);
    return Math.floor((r - Math.floor(r)) * 2 ** 32) >>> 0;
  });
}

/** SHA-256 (FIPS 180-4) of bytes, as `CryptoCore::sha256` computes it. */
function sha256(bytes: Uint8Array): Uint8Array {
  const k = shaConstants(64, Math.cbrt);
  const h = shaConstants(8, Math.sqrt);
  const view = shaPad(bytes);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number): number => ((x >>> n) | (x << (32 - n))) >>> 0;
  for (let offset = 0; offset < view.byteLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const w15 = w[i - 15] ?? 0;
      const w2 = w[i - 2] ?? 0;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[i] = ((w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i += 1) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + (k[i] ?? 0) + (w[i] ?? 0)) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, hh].forEach((v, i) => {
      h[i] = ((h[i] ?? 0) + v) >>> 0;
    });
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  h.forEach((word, i) => outView.setUint32(i * 4, word));
  return out;
}

/**
 * The MD5 of the UTF-8 bytes, as lowercase hex.
 *
 * @godot String.md5_text
 * @source core/string/ustring.cpp:2785
 */
export function md5_text(self: string): string {
  return hexEncode(md5(utf8(self)));
}

/**
 * The SHA-1 of the UTF-8 bytes, as lowercase hex.
 *
 * @godot String.sha1_text
 * @source core/string/ustring.cpp:2792
 */
export function sha1_text(self: string): string {
  return hexEncode(sha1(utf8(self)));
}

/**
 * The SHA-256 of the UTF-8 bytes, as lowercase hex.
 *
 * @godot String.sha256_text
 * @source core/string/ustring.cpp:2799
 */
export function sha256_text(self: string): string {
  return hexEncode(sha256(utf8(self)));
}

/**
 * @godot String.md5_buffer
 * @source core/string/ustring.cpp:2806
 */
export function md5_buffer(self: string): Uint8Array {
  return md5(utf8(self));
}

/**
 * @godot String.sha1_buffer
 * @source core/string/ustring.cpp:2820
 */
export function sha1_buffer(self: string): Uint8Array {
  return sha1(utf8(self));
}

/**
 * @godot String.sha256_buffer
 * @source core/string/ustring.cpp:2835
 */
export function sha256_buffer(self: string): Uint8Array {
  return sha256(utf8(self));
}

/**
 * Whether the string is not empty.
 *
 * @godot String.is_empty
 * @source core/string/ustring.h:305
 */
export function is_empty(self: string): boolean {
  return self.length === 0;
}

/**
 * `find(what) != -1`: an empty `what` is not contained.
 *
 * @godot String.contains
 * @source core/string/ustring.h:607
 */
export function contains(self: string, p_what: string): boolean {
  return find(self, p_what) !== -1;
}

/**
 * `contains`, ignoring case.
 *
 * @godot String.containsn
 * @source core/string/ustring.h:610
 */
export function containsn(self: string, p_what: string): boolean {
  return findn(self, p_what) !== -1;
}

/**
 * A leading `/` or `\`, or a `:/` or `:\` anywhere.
 *
 * @godot String.is_absolute_path
 * @source core/string/ustring.cpp:4284
 */
export function is_absolute_path(self: string): boolean {
  if (self.length === 0) return false;
  if (self[0] === '/' || self[0] === '\\') return true;
  return cps(self).length > 1 && (self.includes(':/') || self.includes(':\\'));
}

/**
 * @godot String.is_relative_path
 * @source core/string/ustring.cpp:4960
 */
export function is_relative_path(self: string): boolean {
  return !is_absolute_path(self);
}

/**
 * `.` segments dropped and `..` segments folded, the drive (`res://`, `C:/`, `/`, `//`) kept,
 * backslashes and repeated slashes made single slashes.
 *
 * @godot String.simplify_path
 * @source core/string/ustring.cpp:4149
 */
export function simplify_path(self: string): string {
  let s = self;
  let drive = '';
  const p = s.indexOf('://');
  let found = false;
  if (p > 0 && /^[A-Za-z0-9]*$/u.test(s.slice(0, p))) {
    found = true;
    drive = s.slice(0, p + 3);
    s = s.slice(p + 3);
  }
  if (!found) {
    if (s.startsWith('//') || s.startsWith('\\\\')) {
      drive = s.slice(0, 2);
      s = s.slice(2);
    } else if (s.startsWith('/') || s.startsWith('\\')) {
      drive = s.slice(0, 1);
      s = s.slice(1);
    } else {
      let colon = s.indexOf(':/');
      if (colon === -1) colon = s.indexOf(':\\');
      if (colon !== -1 && colon < s.indexOf('/')) {
        drive = s.slice(0, colon + 2);
        s = s.slice(colon + 2);
      }
    }
  }
  s = s.replaceAll('\\', '/');
  while (s.includes('//')) s = s.replaceAll('//', '/');
  const dirs = s.split('/').filter((d) => d.length > 0);
  const absolute = is_absolute_path(self) && !self.startsWith('res://');
  for (let i = 0; i < dirs.length; i += 1) {
    const d = dirs[i];
    if (d === '.') {
      dirs.splice(i, 1);
      i -= 1;
    } else if (d === '..') {
      if (i !== 0 && dirs[i - 1] !== '..') {
        dirs.splice(i - 1, 2);
        i -= 2;
      } else if (absolute && i === 0) {
        dirs.splice(i, 1);
        i -= 1;
      }
    }
  }
  return drive + dirs.join('/');
}

/**
 * The directory part: everything before the last separator, the drive (`res://`, `C:/`, `/`, a
 * network share) kept.
 *
 * @godot String.get_base_dir
 * @source core/string/ustring.cpp:4964
 */
export function get_base_dir(self: string): string {
  const text = cps(self);
  const findStr = (what: string, from = 0): number => findIn(text, cps(what), from, false);
  let end = 0;
  let basepos = findStr('://');
  if (basepos !== -1) end = basepos + 3;
  if (end === 0) {
    basepos = findStr(':/');
    if (basepos === -1) basepos = findStr(':\\');
    if (basepos !== -1) end = basepos + 2;
  }
  if (end === 0 && (self.startsWith('//') || self.startsWith('\\\\'))) {
    basepos = text.indexOf(47, 2);
    if (basepos === -1) basepos = text.indexOf(92, 2);
    let servpos = text.indexOf(47, basepos + 1);
    if (servpos === -1) servpos = text.indexOf(92, basepos + 1);
    if (servpos !== -1) end = servpos + 1;
  }
  if (end === 0 && self.startsWith('/')) end = 1;
  const base = end !== 0 ? fromCps(text.slice(0, end)) : '';
  const rs = end !== 0 ? text.slice(end) : text;
  const sep = Math.max(rs.lastIndexOf(47), rs.lastIndexOf(92));
  if (sep === -1) return base;
  return base + fromCps(rs.slice(0, sep));
}

/**
 * The part after the last `/` or `\`.
 *
 * @godot String.get_file
 * @source core/string/ustring.cpp:5025
 */
export function get_file(self: string): string {
  const sep = lastSeparator(self);
  if (sep === -1) return self;
  return fromCps(cps(self).slice(sep + 1));
}

/**
 * `&`, `<` and `>` as entities, and with `escape_quotes` (the Variant default is false) `'` and `"`.
 *
 * @godot String.xml_escape
 * @source core/string/ustring.cpp:4512
 */
export function xml_escape(self: string, p_escape_quotes = false): string {
  let str = self.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  if (p_escape_quotes) str = str.replaceAll("'", '&apos;').replaceAll('"', '&quot;');
  return str;
}

/**
 * The five named entities and `&#n;` / `&#xh;` character references decoded; anything else kept.
 *
 * @godot String.xml_unescape
 * @source core/string/ustring.cpp:4643
 */
export function xml_unescape(self: string): string {
  const src = cps(self);
  const out: number[] = [];
  const named: readonly (readonly [string, number])[] = [
    ['gt;', 62],
    ['lt;', 60],
    ['amp;', 38],
    ['quot;', 34],
    ['apos;', 39],
  ];
  let i = 0;
  while (i < src.length) {
    if (src[i] !== 38) {
      out.push(src[i] ?? 0);
      i += 1;
      continue;
    }
    const rest = src.length - i;
    if (rest >= 4 && src[i + 1] === 35) {
      let c = 0;
      let eat = 0;
      let overflow = false;
      if (src[i + 2] === 120) {
        for (let k = 3; k < rest; k += 1) {
          eat = k + 1;
          const ct = src[i + k] ?? 0;
          if (ct === 59) break;
          let v: number;
          if (isDigit(ct)) v = ct - 48;
          else if (ct >= 97 && ct <= 102) v = ct - 87;
          else if (ct >= 65 && ct <= 70) v = ct - 55;
          else break;
          if (c > 0xffffffff >>> 4) {
            overflow = true;
            break;
          }
          c = ((c << 4) | v) >>> 0;
        }
      } else {
        for (let k = 2; k < rest; k += 1) {
          eat = k + 1;
          const ct = src[i + k] ?? 0;
          if (ct === 59 || !isDigit(ct)) break;
        }
        if (src[i + eat - 1] === 59) {
          const val = Number(fromCps(src.slice(i + 2, i + eat - 1)) || '0');
          if (val > 0 && val <= 0xffffffff) c = val;
          else overflow = true;
        }
      }
      if (c === 0 || overflow || src[i + eat - 1] !== 59 || c > 0x10ffff) {
        eat = 1;
        c = 38;
      }
      out.push(c);
      i += eat;
      continue;
    }
    const tail = fromCps(src.slice(i + 1, i + 6));
    const entity = named.find(([name]) => tail.startsWith(name));
    if (entity !== undefined) {
      out.push(entity[1]);
      i += entity[0].length + 1;
    } else {
      out.push(38);
      i += 1;
    }
  }
  return fromCps(out);
}

/**
 * The UTF-8 bytes percent-encoded, except ASCII identifier characters, `.`, `-` and `~`.
 *
 * @godot String.uri_encode
 * @source core/string/ustring.cpp:4392
 */
export function uri_encode(self: string): string {
  let res = '';
  for (const ord of utf8(self)) {
    if (ord === 46 || ord === 45 || ord === 126 || isAsciiIdentifierChar(ord)) res += String.fromCharCode(ord);
    else res += `%${ord.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return res;
}

/** `uri_decode` / `uri_file_decode`: `%XX` (digits and uppercase letters) decoded over UTF-8. */
function uriDecode(self: string, plusIsSpace: boolean): string {
  const src = utf8(self);
  const res: number[] = [];
  const isUpperOrDigit = (c: number): boolean => isDigit(c) || (c >= 65 && c <= 90);
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i] ?? 0;
    if (c === 37 && i + 2 < src.length) {
      const o1 = src[i + 1] ?? 0;
      if (isUpperOrDigit(o1)) {
        const o2 = src[i + 2] ?? 0;
        if (isUpperOrDigit(o2)) {
          res.push(Number.parseInt(String.fromCharCode(o1, o2), 16) & 0xff);
          i += 2;
        }
      } else {
        res.push(c);
      }
    } else if (plusIsSpace && c === 43) {
      res.push(32);
    } else {
      res.push(c);
    }
  }
  return new TextDecoder().decode(new Uint8Array(res));
}

/**
 * Percent-escapes decoded and `+` read as a space.
 *
 * @godot String.uri_decode
 * @source core/string/ustring.cpp:4410
 */
export function uri_decode(self: string): string {
  return uriDecode(self, true);
}

/**
 * Percent-escapes decoded; `+` kept (a file path).
 *
 * @godot String.uri_file_decode
 * @source core/string/ustring.cpp:4435
 */
export function uri_file_decode(self: string): string {
  return uriDecode(self, false);
}

/**
 * C escapes for `\`, the control characters `\a\b\f\n\r\t\v`, and both quotes.
 *
 * @godot String.c_escape
 * @source core/string/ustring.cpp:4474
 */
export function c_escape(self: string): string {
  return self
    .replaceAll('\\', '\\\\')
    .replaceAll('\x07', '\\a')
    .replaceAll('\b', '\\b')
    .replaceAll('\f', '\\f')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t')
    .replaceAll('\v', '\\v')
    .replaceAll("'", "\\'")
    .replaceAll('"', '\\"');
}

/**
 * The C escapes of `c_escape` decoded, in Godot's replacement order.
 *
 * @godot String.c_unescape
 * @source core/string/ustring.cpp:4458
 */
export function c_unescape(self: string): string {
  return self
    .replaceAll('\\a', '\x07')
    .replaceAll('\\b', '\b')
    .replaceAll('\\f', '\f')
    .replaceAll('\\n', '\n')
    .replaceAll('\\r', '\r')
    .replaceAll('\\t', '\t')
    .replaceAll('\\v', '\v')
    .replaceAll("\\'", "'")
    .replaceAll('\\"', '"')
    .replaceAll('\\\\', '\\');
}

/**
 * JSON string escapes for `\`, `\b\f\n\r\t\v` and `"`.
 *
 * @godot String.json_escape
 * @source core/string/ustring.cpp:4498
 */
export function json_escape(self: string): string {
  return self
    .replaceAll('\\', '\\\\')
    .replaceAll('\b', '\\b')
    .replaceAll('\f', '\\f')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t')
    .replaceAll('\v', '\\v')
    .replaceAll('"', '\\"');
}

/**
 * Each character a node name cannot hold (`.`, `:`, `@`, `/`, `"`, `%`) replaced by `_`.
 *
 * @godot String.validate_node_name
 * @source core/string/ustring.cpp:5089
 */
export function validate_node_name(self: string): string {
  return self.replace(/[.:@/"%]/gu, '_');
}

/**
 * Edges stripped and each character a file name cannot hold replaced by `_`.
 *
 * @godot String.validate_filename
 * @source core/string/ustring.cpp:4944
 */
export function validate_filename(self: string): string {
  return strip_edges(self).replace(/[:/\\?*"|%<>]/gu, '_');
}

/**
 * ASCII letters, digits and `_`, not starting with a digit.
 *
 * @godot String.is_valid_ascii_identifier
 * @source core/string/ustring.cpp:4340
 */
export function is_valid_ascii_identifier(self: string): boolean {
  const text = cps(self);
  if (text.length === 0 || isDigit(text[0] ?? 0)) return false;
  return text.every(isAsciiIdentifierChar);
}

/**
 * A Unicode identifier: an XID_Start character or `_`, then XID_Continue characters.
 *
 * @godot String.is_valid_unicode_identifier
 * @source core/string/ustring.cpp:4362
 */
export function is_valid_unicode_identifier(self: string): boolean {
  const text = cps(self);
  if (text.length === 0) return false;
  const start = String.fromCodePoint(text[0] ?? 0);
  if (!(start === '_' || /\p{XID_Start}/u.test(start))) return false;
  return text.slice(1).every((c) => /\p{XID_Continue}/u.test(String.fromCodePoint(c)));
}

/**
 * `is_valid_ascii_identifier` (deprecated alias).
 *
 * @godot String.is_valid_identifier
 * @source core/string/ustring.h:654
 */
export function is_valid_identifier(self: string): boolean {
  return is_valid_ascii_identifier(self);
}

/**
 * Digits, optionally after one sign (a lone sign is not valid).
 *
 * @godot String.is_valid_int
 * @source core/string/ustring.cpp:4741
 */
export function is_valid_int(self: string): boolean {
  const text = cps(self);
  if (text.length === 0) return false;
  const from = text.length !== 1 && (text[0] === 43 || text[0] === 45) ? 1 : 0;
  return text.slice(from).every(isDigit);
}

/**
 * Digits, a period and an exponent in the forms `to_float` reads, with at least one mantissa digit.
 *
 * @godot String.is_valid_float
 * @source core/string/ustring.cpp:4799
 */
export function is_valid_float(self: string): boolean {
  const text = cps(self);
  if (text.length === 0) return false;
  let from = 0;
  if (text[0] === 43 || text[0] === 45) from += 1;
  let exponentFound = false;
  let periodFound = false;
  let signFound = false;
  let exponentValuesFound = false;
  let numbersFound = false;
  for (let i = from; i < text.length; i += 1) {
    const c = text[i] ?? 0;
    if (isDigit(c)) {
      if (exponentFound) exponentValuesFound = true;
      else numbersFound = true;
    } else if (numbersFound && !exponentFound && (c === 101 || c === 69)) {
      exponentFound = true;
    } else if (!periodFound && !exponentFound && c === 46) {
      periodFound = true;
    } else if ((c === 45 || c === 43) && exponentFound && !exponentValuesFound && !signFound) {
      signFound = true;
    } else {
      return false;
    }
  }
  return numbersFound;
}

/**
 * Hex digits after an optional sign, and after `0x` when `with_prefix` (the Variant default is
 * false).
 *
 * @godot String.is_valid_hex_number
 * @source core/string/ustring.cpp:4762
 */
export function is_valid_hex_number(self: string, p_with_prefix = false): boolean {
  const text = cps(self);
  if (text.length === 0) return false;
  let from = text.length !== 1 && (text[0] === 43 || text[0] === 45) ? 1 : 0;
  if (p_with_prefix) {
    if (text.length < 3) return false;
    if (text[from] !== 48 || text[from + 1] !== 120) return false;
    from += 2;
  }
  if (from === text.length) return false;
  return text.slice(from).every(isHexDigit);
}

/**
 * `Color.html_is_valid`: 3, 4, 6 or 8 hex digits after an optional `#`.
 *
 * @godot String.is_valid_html_color
 * @source core/string/ustring.cpp:4919
 */
export function is_valid_html_color(self: string): boolean {
  if (self.length === 0) return false;
  const body = self[0] === '#' ? self.slice(1) : self;
  return [3, 4, 6, 8].includes(body.length) && /^[0-9a-fA-F]*$/u.test(body);
}

/** `IPAddress::_parse_ipv4` (`core/io/ip_address.cpp`): four decimal parts, each 0 to 255. */
function isIpv4(text: readonly number[], start: number): boolean {
  let cur = 0;
  let next = 0;
  let parsed = false;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i] ?? 0;
    if (c === 46) {
      if (!parsed) return false;
      parsed = false;
      next = 0;
      cur += 1;
      if (cur > 3) return false;
    } else if (isDigit(c)) {
      parsed = true;
      next = next * 10 + (c - 48);
      if (next > 255) return false;
    } else {
      return false;
    }
  }
  return parsed && cur === 3;
}

/** `IPAddress::_parse_ipv6` (`core/io/ip_address.cpp`), as a validity test. */
function isIpv6(text: readonly number[]): boolean {
  const fields = [0, 0, 0, 0, 0, 0, 0, 0];
  const len = text.length;
  let cur = 0;
  let shift = -1;
  for (let i = 0; i < len; i += 1) {
    for (let j = i; j < len; j += 1) {
      const c = text[j] ?? 0;
      if (c === 58) {
        if (j + 1 === len) return false;
        if (text[j + 1] === 58) {
          if (shift > -1) return false;
          shift = j === 0 ? cur : cur + 1;
          j += 1;
        } else if (i === j) {
          return false;
        }
        i = j;
        break;
      }
      if (j - i > 3) return false;
      if (isHexDigit(c)) {
        fields[cur] = (((fields[cur] ?? 0) << 4) | Number.parseInt(String.fromCharCode(c), 16)) & 0xffff;
      } else if (c === 46) {
        if (cur < 1 || fields[cur - 1] !== 0xffff) return false;
        if (shift < 0 && cur !== 6) return false;
        fields[cur] = 0;
        fields[cur - 1] = 0;
        while (cur > 0) {
          cur -= 1;
          if (fields[cur] !== 0) return false;
        }
        return isIpv4(text, i);
      } else {
        return false;
      }
      if (j + 1 === len) i = j;
    }
    cur += 1;
    if (cur > 8 || (cur === 8 && i + 1 !== len)) return false;
  }
  if (shift < 0) return cur === 8;
  return shift <= 7;
}

/**
 * An IPv4 address, or an IPv6 address (`::` shortening and an IPv4-mapped tail allowed).
 *
 * @godot String.is_valid_ip_address
 * @source core/string/ustring.cpp:4952
 */
export function is_valid_ip_address(self: string): boolean {
  const text = cps(self);
  if (text.length < 40 && text.includes(58)) return isIpv6(text);
  if (text.length < 16) return isIpv4(text, 0);
  return false;
}

/**
 * Not empty, no surrounding whitespace, and none of `: / \ ? * " | % < >`.
 *
 * @godot String.is_valid_filename
 * @source core/string/ustring.cpp:4926
 */
export function is_valid_filename(self: string): boolean {
  const stripped = strip_edges(self);
  if (self !== stripped || stripped.length === 0) return false;
  return !/[:/\\?*"|%<>]/u.test(self);
}

/** The int64 limits as JS numbers (inexact beyond 2^53). */
const INT64_MAX = 9223372036854775807;
const INT64_MIN = -9223372036854775808;

/**
 * The digits before the first `.` read as an integer; other characters are skipped, and a `-` before
 * any digit flips the sign. Overflow is an error that returns the int64 limit.
 *
 * @godot String.to_int
 * @source core/string/ustring.cpp:2300
 */
export function to_int(self: string): number {
  const text = cps(self);
  if (text.length === 0) return 0;
  const dot = text.indexOf(46);
  const to = dot >= 0 ? dot : text.length;
  let integer = 0n;
  let positive = true;
  for (let i = 0; i < to; i += 1) {
    const c = text[i] ?? 0;
    if (isDigit(c)) {
      integer = integer * 10n + BigInt(c - 48);
      if (positive ? integer > 9223372036854775807n : integer > 9223372036854775808n) return positive ? INT64_MAX : INT64_MIN;
    } else if (integer === 0n && c === 45) {
      positive = !positive;
    }
  }
  return Number(positive ? integer : -integer);
}

/**
 * `built_in_strtod` (`core/string/ustring.cpp:2362`): leading spaces, tabs and newlines skipped,
 * then `[+-]digits[.digits][(e|E)[+-]digits]`, at most 18 mantissa digits kept; anything unreadable
 * is 0.
 */
function strtod(text: readonly number[]): number {
  let p = 0;
  while (text[p] === 32 || text[p] === 9 || text[p] === 10) p += 1;
  let sign = false;
  if (text[p] === 45) {
    sign = true;
    p += 1;
  } else if (text[p] === 43) {
    p += 1;
  }
  let decPt = -1;
  let mantSize = 0;
  for (; ; mantSize += 1) {
    const c = text[p + mantSize] ?? 0;
    if (!isDigit(c)) {
      if (c !== 46 || decPt >= 0) break;
      decPt = mantSize;
    }
  }
  const pExp = p + mantSize;
  if (decPt < 0) decPt = mantSize;
  else mantSize -= 1;
  let fracExp: number;
  if (mantSize > 18) {
    fracExp = decPt - 18;
    mantSize = 18;
  } else {
    fracExp = decPt - mantSize;
  }
  if (mantSize === 0) return sign ? -0 : 0;
  let digits = '';
  for (let k = p; digits.length < mantSize; k += 1) {
    const c = text[k] ?? 0;
    if (c !== 46) digits += String.fromCharCode(c);
  }
  let fraction = Number(digits);
  let exp = 0;
  let expSign = false;
  let q = pExp;
  if (text[q] === 69 || text[q] === 101) {
    q += 1;
    if (text[q] === 45) {
      expSign = true;
      q += 1;
    } else if (text[q] === 43) {
      q += 1;
    }
    if (isDigit(text[q] ?? 0)) {
      while (isDigit(text[q] ?? 0)) {
        exp = exp * 10 + ((text[q] ?? 48) - 48);
        q += 1;
      }
    } else {
      expSign = false;
      exp = 0;
    }
  }
  exp = expSign ? fracExp - exp : fracExp + exp;
  const negativeExp = exp < 0;
  exp = Math.min(Math.abs(exp), 511);
  const powers = [10, 100, 1e4, 1e8, 1e16, 1e32, 1e64, 1e128, 1e256];
  let dblExp = 1;
  for (let d = 0; exp !== 0; exp >>= 1, d += 1) if (exp & 1) dblExp *= powers[d] ?? 1;
  fraction = negativeExp ? fraction / dblExp : fraction * dblExp;
  return sign ? -fraction : fraction;
}

/**
 * The leading decimal number (`built_in_strtod`); 0 when there is none.
 *
 * @godot String.to_float
 * @source core/string/ustring.cpp:2677
 */
export function to_float(self: string): number {
  if (self.length === 0) return 0;
  return strtod(cps(self));
}

/** `hex_to_int` / `bin_to_int` (`core/string/ustring.cpp:2184`, `:2225`). */
function radixToInt(self: string, radix: 2 | 16, prefix: number): number {
  const text = cps(self);
  if (text.length === 0) return 0;
  let i = 0;
  const negative = text[0] === 45;
  if (negative) i += 1;
  if (text.length > 2 && text[i] === 48 && lower(text[i + 1] ?? 0) === prefix) i += 2;
  let value = 0n;
  const limit = negative ? 9223372036854775808n : 9223372036854775807n;
  for (; i < text.length; i += 1) {
    const c = lower(text[i] ?? 0);
    const n = Number.parseInt(String.fromCharCode(c), radix);
    if (Number.isNaN(n)) return 0;
    value = value * BigInt(radix) + BigInt(n);
    if (value > limit) return negative ? INT64_MIN : INT64_MAX;
  }
  return Number(negative ? -value : value);
}

/**
 * Hexadecimal digits (after an optional `-` and `0x`) as an integer; an invalid character is an
 * error that returns 0.
 *
 * @godot String.hex_to_int
 * @source core/string/ustring.cpp:2184
 */
export function hex_to_int(self: string): number {
  return radixToInt(self, 16, 120);
}

/**
 * Binary digits (after an optional `-` and `0b`) as an integer; any other character returns 0.
 *
 * @godot String.bin_to_int
 * @source core/string/ustring.cpp:2225
 */
export function bin_to_int(self: string): number {
  return radixToInt(self, 2, 98);
}

/**
 * `character` repeated on the left up to `min_length` characters (the Variant default is `" "`).
 *
 * @godot String.lpad
 * @source core/string/ustring.cpp:5169
 */
export function lpad(self: string, p_min_length: number, p_character = ' '): string {
  const padding = p_min_length - cps(self).length;
  return padding > 0 ? p_character.repeat(padding) + self : self;
}

/**
 * `character` repeated on the right up to `min_length` characters (the Variant default is `" "`).
 *
 * @godot String.rpad
 * @source core/string/ustring.cpp:5159
 */
export function rpad(self: string, p_min_length: number, p_character = ' '): string {
  const padding = p_min_length - cps(self).length;
  return padding > 0 ? self + p_character.repeat(padding) : self;
}

/**
 * The digits after the `.` cut or zero-padded to `digits` (no `.` at 0 digits).
 *
 * @godot String.pad_decimals
 * @source core/string/ustring.cpp:4657
 */
export function pad_decimals(self: string, p_digits: number): string {
  let s = self;
  let c = s.indexOf('.');
  if (c === -1) {
    if (p_digits <= 0) return s;
    s += '.';
    c = s.length - 1;
  } else if (p_digits <= 0) {
    return s.slice(0, c);
  }
  if (s.length - (c + 1) > p_digits) return s.slice(0, c + p_digits + 1);
  return s + '0'.repeat(p_digits - s.length + (c + 1));
}

/**
 * The integer part zero-padded to `digits` digits, after any leading non-digits (a sign).
 *
 * @godot String.pad_zeros
 * @source core/string/ustring.cpp:4681
 */
export function pad_zeros(self: string, p_digits: number): string {
  const text = cps(self);
  let end = text.indexOf(46);
  if (end === -1) end = text.length;
  if (end === 0) return self;
  let begin = 0;
  while (begin < end && !isDigit(text[begin] ?? 0)) begin += 1;
  const zeros = p_digits - (end - begin);
  if (zeros <= 0) return self;
  return insert(self, begin, '0'.repeat(zeros));
}

/**
 * @godot String.trim_prefix
 * @source core/string/ustring.cpp:4708
 */
export function trim_prefix(self: string, p_prefix: string): string {
  return self.startsWith(p_prefix) ? self.slice(p_prefix.length) : self;
}

/**
 * @godot String.trim_suffix
 * @source core/string/ustring.cpp:4725
 */
export function trim_suffix(self: string, p_suffix: string): string {
  return self.endsWith(p_suffix) ? self.slice(0, self.length - p_suffix.length) : self;
}

/**
 * One byte per character; a character above 0x7F becomes a space (`String::ascii`,
 * `core/string/ustring.cpp:1696`).
 *
 * @godot String.to_ascii_buffer
 * @source core/string/ustring.cpp:5617
 */
export function to_ascii_buffer(self: string): Uint8Array {
  return Uint8Array.from(cps(self), (c) => (c <= 0x7f ? c : 0x20));
}

/**
 * @godot String.to_utf8_buffer
 * @source core/string/ustring.cpp:5633
 */
export function to_utf8_buffer(self: string): Uint8Array {
  return utf8(self);
}

/**
 * UTF-16 code units, little-endian.
 *
 * @godot String.to_utf16_buffer
 * @source core/string/ustring.cpp:5649
 */
export function to_utf16_buffer(self: string): Uint8Array {
  const out = new Uint8Array(self.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < self.length; i += 1) view.setUint16(i * 2, self.charCodeAt(i), true);
  return out;
}

/**
 * Code points as 32-bit little-endian words.
 *
 * @godot String.to_utf32_buffer
 * @source core/string/ustring.cpp:5665
 */
export function to_utf32_buffer(self: string): Uint8Array {
  const points = cps(self);
  const out = new Uint8Array(points.length * 4);
  const view = new DataView(out.buffer);
  points.forEach((c, i) => view.setUint32(i * 4, c, true));
  return out;
}

/**
 * `to_utf32_buffer`: `wchar_t` is 32-bit on every platform but Windows, the web included.
 *
 * @godot String.to_wchar_buffer
 * @source core/string/ustring.cpp:5680
 */
export function to_wchar_buffer(self: string): Uint8Array {
  return to_utf32_buffer(self);
}

/**
 * `OS::string_to_multibyte`, which the web platform does not override: the base implementation
 * returns an empty PackedByteArray (`core/os/os.cpp:217`) whatever the encoding (the Variant
 * default is `""`).
 *
 * @godot String.to_multibyte_char_buffer
 * @source core/string/ustring.cpp:5688
 */
export function to_multibyte_char_buffer(self: string, p_encoding = ''): Uint8Array {
  return new Uint8Array(0);
}

/**
 * Pairs of hex digits as bytes; an odd length or a non-hex character is an error that returns an
 * empty array.
 *
 * @godot String.hex_decode
 * @source core/string/ustring.cpp:1658
 */
export function hex_decode(self: string): Uint8Array {
  if (self.length % 2 !== 0 || !/^[0-9a-fA-F]*$/u.test(self)) return new Uint8Array(0);
  const out = new Uint8Array(self.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(self.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * The shortest round-trip digits (grisu2), fixed-point for exponents -4 to 15, otherwise `d.ddde+XX`.
 *
 * @godot String.num_scientific
 * @source core/string/ustring.cpp:1619
 */
export function num_scientific(p_number: number): string {
  if (Number.isNaN(p_number) || !Number.isFinite(p_number)) return num(p_number, 0);
  const negative = p_number < 0 || Object.is(p_number, -0);
  const value = Math.abs(p_number);
  if (value === 0) return negative ? '-0' : '0';
  const [mantissa = '0', exponentText = '0'] = value.toExponential().split('e');
  const digits = mantissa.replace('.', '');
  const k = digits.length;
  const n = Number(exponentText) + 1;
  let body: string;
  if (k <= n && n <= 15) body = digits + '0'.repeat(n - k);
  else if (0 < n && n <= 15) body = `${digits.slice(0, n)}.${digits.slice(n)}`;
  else if (-4 < n && n <= 0) body = `0.${'0'.repeat(-n)}${digits}`;
  else {
    const e = n - 1;
    const exp = `${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(2, '0')}`;
    body = `${k === 1 ? digits : `${digits[0] ?? ''}.${digits.slice(1)}`}e${exp}`;
  }
  return (negative ? '-' : '') + body;
}

/**
 * `%.<decimals>lf` (the Variant default -1 picks 14 significant places, fewer above 10) with
 * trailing zeros trimmed to one after the period; `nan`, `inf`, `-inf`.
 *
 * @godot String.num
 * @source core/string/ustring.cpp:1406
 */
export function num(p_number: number, p_decimals = -1): string {
  if (Number.isNaN(p_number)) return 'nan';
  if (!Number.isFinite(p_number)) return p_number < 0 ? '-inf' : 'inf';
  let places = p_decimals;
  if (places < 0) {
    places = 14;
    const magnitude = Math.abs(p_number);
    if (magnitude > 10) places -= Math.floor(Math.log10(magnitude));
  }
  if (places > 32) places = 32;
  const text = printfFixed(p_number, places < 0 ? 6 : places);
  if (!text.includes('.')) return text;
  const trimmed = text.replace(/0+$/u, '');
  return trimmed.endsWith('.') ? `${trimmed}0` : trimmed;
}

/**
 * The integer in `base` (2 to 36; the Variant defaults are 10 and lowercase); another base is an
 * error that returns "".
 *
 * @godot String.num_int64
 * @source core/string/ustring.cpp:1502
 */
export function num_int64(p_number: number, p_base = 10, p_capitalize_hex = false): string {
  if (p_base < 2 || p_base > 36) return '';
  const text = BigInt(Math.trunc(p_number)).toString(p_base);
  return p_capitalize_hex ? text.toUpperCase() : text;
}

/**
 * The integer read as unsigned 64-bit, in `base` (2 to 36); another base is an error that returns "".
 *
 * @godot String.num_uint64
 * @source core/string/ustring.cpp:1542
 */
export function num_uint64(p_number: number, p_base = 10, p_capitalize_hex = false): string {
  if (p_base < 2 || p_base > 36) return '';
  const text = BigInt.asUintN(64, BigInt(Math.trunc(p_number))).toString(p_base);
  return p_capitalize_hex ? text.toUpperCase() : text;
}

/**
 * The one-character string of a code point.
 *
 * @godot String.chr
 * @source core/string/ustring.h:443
 */
export function chr(p_code: number): string {
  return p_code >= 0 && p_code <= 0x10ffff ? String.fromCodePoint(p_code) : '\ufffd';
}

/**
 * A byte count in B, KiB, MiB, ... EiB, with 2, 1 or 0 decimals by magnitude. The unit names are the
 * untranslated `RTR` keys (no translation is loaded for them in a game).
 *
 * @godot String.humanize_size
 * @source core/string/ustring.cpp:4245
 */
export function humanize_size(p_size: number): string {
  const size = BigInt.asUintN(64, BigInt(Math.trunc(p_size)));
  let magnitude = 0;
  let div = 1n;
  while (size > div * 1024n && magnitude < 6) {
    div *= 1024n;
    magnitude += 1;
  }
  if (magnitude === 0) return `${size.toString()} B`;
  const suffix = ['', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB'][magnitude] ?? '';
  const whole = Number(size / div);
  const digits = whole < 100 ? 2 : whole < 1024 ? 1 : 0;
  return `${pad_decimals(num(Number(size) / Number(div)), digits)} ${suffix}`;
}

/**
 * `String::sprintf` (`core/string/ustring.cpp:5180`): `%s %c %d %o %x %X %f %v %%` with the `-`,
 * `+`, `0`, width, `.precision`, `*` and `N$` modifiers. Returns the text, or the error message with
 * `ok` false.
 */
function sprintf(format: string, values: readonly unknown[]): { text: string; ok: boolean } {
  const fail = (text: string): { text: string; ok: boolean } => ({ text, ok: false });
  const used = values.map(() => false);
  const src = cps(format);
  let out = '';
  let inFormat = false;
  let valueIndex = 0;
  let selected = -1;
  let minChars = 0;
  let minDecimals = 0;
  let inDecimals = false;
  let padZeros = false;
  let leftJustified = false;
  let showSign = false;
  let asUnsigned = false;
  const isNum = (v: unknown): v is number => typeof v === 'number' || typeof v === 'boolean';
  const take = (): { index: number; value: unknown } | null => {
    const index = selected >= 0 ? selected : valueIndex;
    if (index >= values.length) return null;
    return { index, value: values[index] };
  };
  const consumed = (index: number): void => {
    if (selected === -1) valueIndex += 1;
    used[index] = true;
    inFormat = false;
  };
  const padNumber = (digits: string, negative: boolean, finite: boolean): string => {
    const padCount = negative || showSign ? minChars - 1 : minChars;
    const padChar = padZeros && finite ? '0' : ' ';
    const initial = cps(digits).length;
    let str = leftJustified ? rpad(digits, padCount, padChar) : lpad(digits, padCount, padChar);
    if (showSign || negative) {
      const signChar = negative ? '-' : '+';
      str = leftJustified ? signChar + str : insert(str, padZeros && finite ? 0 : cps(str).length - initial, signChar);
    }
    return str;
  };
  for (const c of src) {
    if (!inFormat) {
      if (c === 37) {
        inFormat = true;
        minChars = 0;
        minDecimals = 6;
        padZeros = false;
        leftJustified = false;
        showSign = false;
        inDecimals = false;
        selected = -1;
      } else {
        out += String.fromCodePoint(c);
      }
      continue;
    }
    const ch = String.fromCodePoint(c);
    if (ch === '%') {
      out += '%';
      inFormat = false;
    } else if ('doxX'.includes(ch)) {
      const arg = take();
      if (arg === null) return fail('not enough arguments for format string');
      if (!isNum(arg.value)) return fail('a number is required');
      const value = BigInt(Math.trunc(Number(arg.value)));
      const base = ch === 'd' ? 10 : ch === 'o' ? 8 : 16;
      let digits: string;
      if (!asUnsigned) digits = (value < 0n ? -value : value).toString(base);
      else {
        let u = BigInt.asUintN(64, value);
        if (base === 16 && value < 0n && value >= -2147483648n) u &= 0xffffffffn;
        digits = u.toString(base);
      }
      if (ch === 'X') digits = digits.toUpperCase();
      out += padNumber(digits, value < 0n && !asUnsigned, true);
      consumed(arg.index);
    } else if (ch === 'f') {
      const arg = take();
      if (arg === null) return fail('not enough arguments for format string');
      if (!isNum(arg.value)) return fail('a number is required');
      const value = Number(arg.value);
      const finite = Number.isFinite(value);
      let digits = num(Math.abs(value), minDecimals);
      if (finite) digits = pad_decimals(digits, minDecimals);
      out += padNumber(digits, value < 0 || Object.is(value, -0), finite);
      consumed(arg.index);
    } else if (ch === 'v') {
      const arg = take();
      if (arg === null) return fail('not enough arguments for format string');
      const v = arg.value;
      if (typeof v !== 'object' || v === null || !('x' in v) || !('y' in v)) return fail('%v requires a vector type (Vector2/3/4/2i/3i/4i)');
      const components = Object.values(v as Record<string, unknown>).map(Number);
      const parts = components.map((val) => {
        const finite = Number.isFinite(val);
        let digits = num(Math.abs(val), minDecimals);
        if (finite) digits = pad_decimals(digits, minDecimals);
        const saved = showSign;
        showSign = false;
        const text = padNumber(digits, val < 0, finite);
        showSign = saved;
        return text;
      });
      out += `(${parts.join(', ')})`;
      consumed(arg.index);
    } else if (ch === 's') {
      const arg = take();
      if (arg === null) return fail('not enough arguments for format string');
      const text = stringify(arg.value);
      out += leftJustified ? rpad(text, minChars) : lpad(text, minChars);
      consumed(arg.index);
    } else if (ch === 'c') {
      const arg = take();
      if (arg === null) return fail('not enough arguments for format string');
      let text: string;
      if (isNum(arg.value)) {
        const code = Math.trunc(Number(arg.value));
        if (code < 0) return fail('unsigned integer is lower than minimum');
        if (code >= 0xd800 && code <= 0xdfff) return fail('unsigned integer is invalid Unicode character');
        if (code > 0x10ffff) return fail('unsigned integer is greater than maximum');
        text = String.fromCodePoint(code);
      } else if (typeof arg.value === 'string' && cps(arg.value).length === 1) {
        text = arg.value;
      } else {
        return fail('%c requires number or single-character string');
      }
      out += leftJustified ? rpad(text, minChars) : lpad(text, minChars);
      consumed(arg.index);
    } else if (ch === '-') {
      leftJustified = true;
    } else if (ch === '+') {
      showSign = true;
    } else if (ch === 'u') {
      asUnsigned = true;
    } else if (isDigit(c)) {
      const n = c - 48;
      if (inDecimals) minDecimals = minDecimals * 10 + n;
      else if (c === 48 && minChars === 0) {
        if (!leftJustified) padZeros = true;
      } else minChars = minChars * 10 + n;
    } else if (ch === '$') {
      if (minChars > 0) selected = minChars - 1;
      minChars = 0;
      padZeros = false;
    } else if (ch === '.') {
      if (inDecimals) return fail('too many decimal points in format');
      inDecimals = true;
      minDecimals = 0;
    } else if (ch === '*') {
      const arg = take();
      if (arg === null) return fail('not enough arguments for format string');
      const v = arg.value;
      let size: number;
      if (isNum(v)) size = Math.trunc(Number(v));
      else if (typeof v === 'object' && v !== null && 'x' in v) size = Math.trunc(Number((v as Record<string, unknown>)['x']));
      else return fail('* wants number or vector');
      if (inDecimals) minDecimals = size;
      else minChars = size;
      if (selected === -1) valueIndex += 1;
      used[arg.index] = true;
    } else {
      return fail('unsupported format character');
    }
  }
  if (inFormat) return fail('incomplete format');
  if (used.some((flag) => !flag)) return fail('not all arguments converted during string formatting');
  return { text: out, ok: true };
}

/**
 * `format % values`: `sprintf` with an Array's elements as the values, any other right operand as
 * the single value (`OperatorEvaluatorStringFormat`, `core/variant/variant_op.h:721`). A format error
 * is the script error "String formatting error: ...".
 *
 * @godot String.OP_MODULE
 * @source core/variant/variant_op.h:753
 */
export function op_module(left: string, right: unknown): string {
  const values = Array.isArray(right) ? right : [right];
  const result = sprintf(left, values);
  if (!result.ok) scriptError(`String formatting error: ${result.text}.`);
  return result.text;
}

/**
 * Against null (the `Variant` right operand) it is true.
 *
 * @godot String.OP_NOT_EQUAL
 * @source core/variant/variant_op.cpp:615
 */
export function op_not_equal(left: string, right: string | null): boolean {
  return left !== right;
}

/**
 * `not s` is `s == ""`.
 *
 * @godot String.OP_NOT
 * @source core/variant/variant_op.cpp:887
 */
export function op_not(self: string): boolean {
  return self.length === 0;
}

/**
 * Code point by code point; a prefix is less (`String::operator<`).
 *
 * @godot String.OP_LESS
 * @source core/variant/variant_op.cpp:736
 */
export function op_less(left: string, right: string): boolean {
  return casecmp_to(left, right) < 0;
}

/**
 * @godot String.OP_LESS_EQUAL
 * @source core/variant/variant_op.cpp:736
 */
export function op_less_equal(left: string, right: string): boolean {
  return casecmp_to(left, right) <= 0;
}

/**
 * @godot String.OP_GREATER
 * @source core/variant/variant_op.cpp:736
 */
export function op_greater(left: string, right: string): boolean {
  return casecmp_to(left, right) > 0;
}

/**
 * @godot String.OP_GREATER_EQUAL
 * @source core/variant/variant_op.cpp:736
 */
export function op_greater_equal(left: string, right: string): boolean {
  return casecmp_to(left, right) >= 0;
}

/**
 * `s in text` is `text.find(s) != -1` (an empty `s` is never found,
 * `OperatorEvaluatorInStringFind`, `core/variant/variant_op.cpp:922`); `s in array` and
 * `s in packed_string_array` find an equal element; `s in dict` is `dict.has(s)`. `s in object`
 * (a property lookup through ClassDB and the script) is not transcribed and throws.
 *
 * @godot String.OP_IN
 * @source core/variant/variant_op.h:1142
 */
export function op_in(left: string, right: string | readonly unknown[] | ReadonlyMap<unknown, unknown>): boolean {
  if (typeof right === 'string') return find(right, left) !== -1;
  if (Array.isArray(right)) return right.includes(left);
  if (right instanceof Map) return right.has(left);
  throw new TypeError('godot-compat: `String in Object` (a property lookup) is not transcribed');
}
