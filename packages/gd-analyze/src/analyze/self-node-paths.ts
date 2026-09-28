/**
 * The node paths a script reads from its own node statically, as the bound program states them:
 * `$Path` and `%Unique` (`GET_NODE`), and `get_node` of a literal path on self, implicit or
 * `self.` (`Node::get_node`). The plan resolves them in the scenes running the script
 * (`script-node-paths.ts`) and lowering reads the fields it hands over for them, so both read them
 * here. `get_node_or_null` is not one: it is called to find a node that may be gone.
 */

import type { GodotBoundNode, GodotBoundScript } from '../godot-frontend/bound-program';

/** The literal path a node reads from self, or undefined when it reads none statically. */
export function godotSelfNodePath(script: GodotBoundScript, node: GodotBoundNode): string | undefined {
  if (node.kind === 'GET_NODE') return node.fullPath;
  if (node.kind !== 'CALL' || node.compilerTarget.kind !== 'native-method' || node.compilerTarget.member !== 'get_node' || node.arguments.length !== 1) return undefined;
  const argument = script.nodes[node.arguments[0] as number];
  if (argument?.kind !== 'LITERAL') return undefined;
  const value = argument.value;
  const text = value.kind === 'string' ? value.value : value.kind === 'opaque' && value.type === 'NodePath' ? value.text : undefined;
  if (text === undefined || text === '') return undefined;
  const callee = node.callee >= 0 ? script.nodes[node.callee] : undefined;
  if (callee?.kind === 'IDENTIFIER') return text;
  if (callee?.kind === 'SUBSCRIPT' && callee.isAttribute && callee.base >= 0 && script.nodes[callee.base]?.kind === 'SELF') return text;
  return undefined;
}
