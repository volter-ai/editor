/**
 * The node paths a script reads from its own node statically, as the bound program states them:
 * `$Path` and `%Unique` (`GET_NODE`), and `get_node` of a literal path on self, implicit or
 * `self.` (`Node::get_node`), recorded on each bound script (`selfNodePaths`); with the script
 * instances a program makes outside a scene (`instancesMade`). The plan resolves the paths in the
 * scenes running the script (`script-node-paths.ts`) and lowering reads the fields it hands over,
 * by node. `get_node_or_null` is not one: it is called to find a node that may be gone.
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

/**
 * The script instances a program makes or sets outside a scene: the project scripts it makes with
 * `new()`, and whether it stores a node's script (`node.script = s`, `set_script(s)`, `set("script",
 * s)` or `set(name, s)` with a name known only at run time) or makes an instance of a script it
 * does not know (`load(path).new()` with a path known only at run time).
 */
export interface BoundGodotInstancesMade {
  readonly scripts: readonly string[];
  readonly anyScript: boolean;
}

export function instancesMade(script: GodotBoundScript): BoundGodotInstancesMade {
  const nodes = script.nodes;
  const literal = (id: number | undefined) => {
    const entry = id === undefined ? undefined : nodes[id];
    return entry?.kind === 'LITERAL' && (entry.value.kind === 'string' || entry.value.kind === 'string-name') ? entry.value.value : undefined;
  };
  const scripts = new Set<string>();
  let anyScript = false;
  for (const node of nodes) {
    if (node.kind === 'ASSIGNMENT') {
      const assignee = nodes[node.assignee];
      const attribute = assignee?.kind === 'SUBSCRIPT' && assignee.isAttribute ? nodes[assignee.attribute] : undefined;
      if (attribute?.kind === 'IDENTIFIER' && attribute.name === 'script') anyScript = true;
    }
    if (node.kind !== 'CALL') continue;
    if (node.functionName === 'set_script' || (node.functionName === 'set' && [undefined, 'script'].includes(literal(node.arguments[0])))) anyScript = true;
    if (node.functionName !== 'new') continue;
    if (node.datatype.scriptPath !== '') scripts.add(node.datatype.scriptPath);
    else if (node.datatype.kind !== 'NATIVE' && node.datatype.kind !== 'BUILTIN') anyScript = true;
  }
  return { scripts: [...scripts].sort(), anyScript };
}
