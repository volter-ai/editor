/**
 * @godot-class StringName
 * @role PROTOCOL
 *
 * Godot 4.7's `StringName` operators (`core/variant/variant_op.cpp` at revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`). A StringName is a JS string here, as a String is, so
 * comparing one with a String or a StringName compares their text, as Godot's
 * `StringName::operator==(const String &)` does.
 */

/**
 * `StringName == String` and `StringName == StringName` compare characters (registered by
 * `register_string_op`, `core/variant/variant_op.cpp:493`).
 *
 * @godot StringName.OP_EQUAL
 * @source core/variant/variant_op.cpp:493
 */
export function op_equal(left: string, right: string): boolean {
  return left === right;
}

/**
 * `StringName != String` and `StringName != StringName` (`core/variant/variant_op.cpp:615`).
 *
 * @godot StringName.OP_NOT_EQUAL
 * @source core/variant/variant_op.cpp:615
 */
export function op_not_equal(left: string, right: string): boolean {
  return left !== right;
}

/**
 * The Variant constructors (`core/variant/variant_construct.cpp`): no arguments (the empty name),
 * or `from` a StringName or a String (a StringName is its text here).
 *
 * @godot StringName.StringName
 * @source core/variant/variant_construct.cpp:176
 */
export function construct(...args: readonly [] | readonly [string]): string {
  return args.length === 0 ? '' : String(args[0]);
}
