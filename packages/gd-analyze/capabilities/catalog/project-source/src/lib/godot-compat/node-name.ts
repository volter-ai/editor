/**
 * Godot 4.7's `Node::set_name` string rules, shared by the Pixi and three tree backends.
 *
 * `String::validate_node_name` replaces `. : @ / " %` with `_`. When a node already has a
 * parent, `Node::_validate_child_name(..., true)` then makes the result unique by incrementing a
 * trailing decimal suffix (or starting at 2). The default project setting uses no separator, so
 * `Enemy`, `Enemy2`, `Enemy3` is the source engine's default sequence.
 *
 * This helper owns no node identity or registry: each renderer hands it the live sibling names and
 * writes the returned string back to its own native object.
 */

const INVALID_NODE_NAME_CHARACTER = /[.:@/"%]/g;

/** Godot `String::validate_node_name`. */
export function validateNodeName(name: string): string {
  if (name.length === 0) {
    throw new Error('godot-compat: Node.name cannot be empty.');
  }
  return name.replace(INVALID_NODE_NAME_CHARACTER, '_');
}

/**
 * Godot's human-readable sibling collision rule from `Node::_generate_serial_child_name`.
 * `separator` mirrors `editor/naming/node_name_num_separator`; translated projects currently use
 * Godot's default empty separator.
 */
export function uniqueNodeName(
  requestedName: string,
  siblingNames: readonly string[],
  separator = '',
): string {
  const validated = validateNodeName(requestedName);
  const occupied = new Set(siblingNames);
  if (!occupied.has(validated)) return validated;

  let digitStart = validated.length;
  while (digitStart > 0) {
    const code = validated.charCodeAt(digitStart - 1);
    if (code < 48 || code > 57) break;
    digitStart -= 1;
  }

  let base = validated;
  let digits = '';
  if (digitStart < validated.length) {
    const separatorStart = digitStart - separator.length;
    if (separatorStart >= 0 && validated.slice(separatorStart, digitStart) === separator) {
      base = validated.slice(0, digitStart);
      digits = validated.slice(digitStart);
    }
  }

  if (digits.length === 0) {
    base += separator;
    digits = '2';
  }

  for (;;) {
    const candidate = `${base}${digits}`;
    if (!occupied.has(candidate)) return candidate;
    digits = increaseNumericString(digits);
  }
}

/** Godot's decimal carry operation, preserving leading zeroes (`009` -> `010`). */
function increaseNumericString(value: string): string {
  const digits = [...value];
  let carry = true;
  for (let index = digits.length - 1; index >= 0 && carry; index -= 1) {
    if (digits[index] === '9') {
      digits[index] = '0';
    } else {
      digits[index] = String(Number(digits[index]) + 1);
      carry = false;
    }
  }
  return `${carry ? '1' : ''}${digits.join('')}`;
}
