/**
 * The node paths a script reads from its own node statically, as the bound program states them:
 * `$Path` and `%Unique` (`GET_NODE`), and `get_node` of a literal path on self, implicit or
 * `self.` (`Node::get_node`), or on a node itself read so (`%CoinCount.get_node("Parallax")` is
 * `%CoinCount/Parallax`), recorded on each bound script (`selfNodePaths`). The plan resolves
 * the paths in the scenes running the script (`script-node-paths.ts`) and lowering reads the fields
 * it hands over, by node. `get_node_or_null` is not one: it is called to find a node that may be gone.
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
  if (callee?.kind !== 'SUBSCRIPT' || !callee.isAttribute || callee.base < 0) return undefined;
  const base = script.nodes[callee.base];
  if (base?.kind === 'SELF') return text;
  // A relative path from a node read statically joins that node's path.
  const from = base === undefined ? undefined : godotSelfNodePath(script, base);
  if (from === undefined || from.startsWith('/') || from.includes(':')) return undefined;
  return text.startsWith('/') || text.startsWith('%') || text.includes(':') ? undefined : `${from}/${text}`;
}

/** Each node of the program that reads a literal path from self, with the path. */
export function selfNodePaths(script: GodotBoundScript): readonly BoundGodotSelfNodePath[] {
  return script.nodes.flatMap((node) => {
    const path = godotSelfNodePath(script, node);
    return path === undefined ? [] : [{ nodeId: node.id, path }];
  });
}

export interface BoundGodotSelfNodePath {
  readonly nodeId: number;
  readonly path: string;
}
