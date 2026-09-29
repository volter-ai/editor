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

/**
 * The built-in conversions that are no conversion in the output: a value of the first type IS a
 * value of the second (an int stored as a float is the same JS number). Every other conversion
 * between built-ins goes through the target type's constructor (`convertedValue`).
 */
const WIDENINGS: ReadonlySet<string> = new Set(['int>float']);

export function godotBuiltinWidens(from: string, to: string): boolean {
  return WIDENINGS.has(`${from}>${to}`);
}
