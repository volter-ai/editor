/**
 * The utility calls a `for` loop counts through instead of iterating the Array they return
 * (docs/GODOT.md §The lane's law, row 3): GDScript's analyzer marks `for i in range(...)` a range
 * loop (`GDScriptAnalyzer::resolve_for`, `is_range`), and its compiler writes a counted from/to/step
 * loop with no Array (gdscript_compiler.cpp:2070-2076). Keyed by the utility's identity
 * (`owner.member`), so lowering selects the shape without naming the function.
 */
const COUNTED_LOOP_CALLS: ReadonlySet<string> = new Set(['@GDScript.range']);

/** Whether `for v in owner.member(...)` counts from/to/step rather than iterating an Array. */
export function godotCountsLoopCall(owner: string, member: string): boolean {
  return COUNTED_LOOP_CALLS.has(`${owner}.${member}`);
}
