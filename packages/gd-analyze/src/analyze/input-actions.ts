/**
 * The input actions a project names (analysis, docs/GODOT.md row 2): each string argument of a
 * call to a method of an input class in its scripts. A call whose arguments include a computed
 * value may name any action, and GUI nodes navigate with the built-in `ui_*` actions: either keeps
 * every action (`'all'`). The plan keeps only these of the project's InputMap.
 */
import type { GodotBoundScript } from '../godot-frontend/bound-program';

/** The classes whose methods take an action by name. */
const ACTION_CLASSES = new Set([
  'Input',
  'InputMap',
  'InputEvent',
  'InputEventAction',
  'InputEventKey',
  'InputEventMouseButton',
  'InputEventJoypadButton',
  'InputEventJoypadMotion',
  'InputEventScreenTouch',
  'InputEventMouseMotion',
  'InputEventScreenDrag',
  'InputEventWithModifiers',
  'InputEventFromWindow',
  'InputEventMouse',
]);

export function namedInputActions(programs: readonly GodotBoundScript[], hasControls: boolean): readonly string[] | 'all' {
  if (hasControls) return 'all';
  const used = new Set<string>();
  for (const program of programs) {
    const nodes = program.nodes;
    for (const node of nodes) {
      if (node.kind !== 'CALL' || !ACTION_CLASSES.has(node.compilerTarget.owner)) continue;
      for (const id of node.arguments) {
        const argument = nodes[id];
        if (argument?.kind === 'LITERAL' && (argument.value.kind === 'string' || argument.value.kind === 'string-name')) {
          used.add(argument.value.value);
        } else if (argument?.datatype.kind !== 'BUILTIN' || (argument.datatype.builtinType !== 'bool' && argument.datatype.builtinType !== 'float' && argument.datatype.builtinType !== 'int')) {
          return 'all';
        }
      }
    }
  }
  return [...used].sort();
}
