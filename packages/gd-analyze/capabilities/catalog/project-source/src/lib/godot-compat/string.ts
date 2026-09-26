/**
 * @godot-class String
 * @role PROTOCOL
 *
 * Godot 4.7's `String`, transcribed from `core/string/ustring.cpp` at revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`. A Godot String is an immutable value of `char32_t`
 * code points; its representation here is a JS string, and where Godot indexes characters
 * (`split`'s positions) the transcription indexes code points, not UTF-16 units.
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
 * (`core/variant/variant_op.cpp:493`).
 *
 * @godot String.OP_EQUAL
 * @source core/variant/variant_op.cpp:493
 */
export function op_equal(left: string, right: string): boolean {
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
