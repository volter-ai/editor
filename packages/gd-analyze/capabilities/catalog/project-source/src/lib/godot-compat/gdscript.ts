/**
 * @godot-class @GDScript
 * @role BINDING
 *
 * GDScript's own utility functions (`modules/gdscript/gdscript_utility_functions.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`), which the engine's API dump does not carry. An
 * Array is a JS array here.
 */

/**
 * `range(end)`, `range(begin, end)` and `range(begin, end, step)`: the ints from `begin` (0) up to,
 * not including, `end`, `step` (1) apart, as a new Array. Each argument is read as an int (a float
 * truncates, as `int64_t count = *p_args[0]` converts it in a release build); a zero step makes
 * nothing, as Godot reports "Step argument is zero!" and returns no Array.
 *
 * @godot @GDScript.range
 * @source modules/gdscript/gdscript_utility_functions.cpp:136
 */
export function range(...args: readonly [number] | readonly [number, number] | readonly [number, number, number]): number[] {
  const [begin, end, step] = args.length === 1 ? [0, args[0], 1] : [args[0], args[1], args[2] ?? 1];
  const from = Math.trunc(begin);
  const to = Math.trunc(end);
  const increment = Math.trunc(step);
  const values: number[] = [];
  if (increment > 0) for (let value = from; value < to; value += increment) values.push(value);
  else if (increment < 0) for (let value = from; value > to; value += increment) values.push(value);
  return values;
}
