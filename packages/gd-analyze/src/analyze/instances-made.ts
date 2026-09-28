import type { GodotBoundScript } from '../godot-frontend/bound-program';

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
