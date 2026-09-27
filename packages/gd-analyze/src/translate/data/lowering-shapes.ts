/**
 * Godot members whose lowering takes a shape of its own beyond a bound call (docs/GODOT.md §The
 * lane's law, row 3): the plan-time table lowering reads, by the member's Godot identity, so
 * lowering itself never compares a class name.
 */

/** How a call to a Godot method is lowered, beyond its binding. */
export type GodotCallShape =
  /**
   * `tween_property(object, "property", …)`: the object is its native entity and the property's
   * getter and setter bindings follow the call's own arguments (tween.cpp:104).
   */
  | 'tweened-property'
  /**
   * `has_method(name)`: compat answers from the script chain, so the name must be a literal that no
   * engine class declares (object.cpp:1601).
   */
  | 'script-chain-method';

const CALL_SHAPES: Readonly<Record<string, GodotCallShape>> = {
  'Tween.tween_property': 'tweened-property',
  'Object.has_method': 'script-chain-method',
};

/** The call shape of the Godot method `owner.member`, if it has one. */
export function godotCallShape(owner: string, member: string): GodotCallShape | undefined {
  return CALL_SHAPES[`${owner}.${member}`];
}

/**
 * The native classes a subscript reads its parameters from (`tree[&"parameters/…"]`, which
 * `AnimationTree::_set`/`_get` answers, animation_tree.cpp:1057).
 */
const PARAMETER_SUBSCRIPTS: ReadonlySet<string> = new Set(['AnimationTree']);

/** Whether a subscript on a value of the native class `className` reads a tree parameter. */
export function godotSubscriptsParameters(className: string): boolean {
  return PARAMETER_SUBSCRIPTS.has(className);
}
