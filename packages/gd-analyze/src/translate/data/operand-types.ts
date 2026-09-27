/**
 * The Godot operand types a compat operator's TypeScript parameter type stands for: a `number`
 * right operand takes Godot's `float` and `int`, a `string` its `String` and `StringName`; any
 * other type names the Godot type it is (`Vector3`). Plan data (docs/GODOT.md §The lane's law,
 * row 3), read when the binding table is derived from compat.
 */
const OPERAND_TYPES: Readonly<Record<string, readonly string[]>> = {
  number: ['float', 'int'],
  string: ['String', 'StringName'],
};

export function godotOperandTypes(tsType: string): readonly string[] {
  return OPERAND_TYPES[tsType] ?? [tsType];
}
