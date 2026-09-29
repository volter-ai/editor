import type { GodotBoundDatatype, GodotBoundScript } from '../godot-frontend/bound-program';

/** An argument that passes a project script's instance to a project function's engine-typed parameter. */
export interface BoundGodotNodeArgument {
  readonly argumentId: number;
  /** The parameter's type: an engine class, which holds the node the instance is attached to. */
  readonly datatype: GodotBoundDatatype;
}

/**
 * The arguments, in one script, that pass a project script's instance (or `self`) to a parameter a
 * project function types as an engine class: as a typed assignment does, the parameter holds the
 * node the script is attached to. The callee is the script's own function (`script-self`) or a
 * method of a receiver typed as a project script; `parameterTypes` finds its declaration up the
 * callee script's chain.
 */
export function nodeArguments(
  program: GodotBoundScript,
  parameterTypes: (scriptPath: string, name: string) => readonly GodotBoundDatatype[] | undefined,
): readonly BoundGodotNodeArgument[] {
  const found: BoundGodotNodeArgument[] = [];
  for (const node of program.nodes) {
    if (node?.kind !== 'CALL') continue;
    const callee = program.nodes[node.callee];
    let scriptPath: string | undefined;
    if (node.compilerTarget.kind === 'script-self') scriptPath = program.resPath;
    else if (callee?.kind === 'SUBSCRIPT' && callee.isAttribute) {
      const receiver = program.nodes[callee.base]?.datatype;
      if (receiver !== undefined && receiver.kind === 'CLASS' && !receiver.metaType && receiver.scriptPath !== '') scriptPath = receiver.scriptPath;
    }
    if (scriptPath === undefined) continue;
    const name = node.compilerTarget.kind === 'script-self' ? node.compilerTarget.member : node.functionName;
    const parameters = parameterTypes(scriptPath, name);
    if (parameters === undefined) continue;
    node.arguments.forEach((argumentId, index) => {
      const parameter = parameters[index];
      const argument = program.nodes[argumentId]?.datatype;
      if (parameter === undefined || argument === undefined) return;
      if (parameter.kind !== 'NATIVE' || parameter.metaType) return;
      if (argument.kind !== 'CLASS' || argument.metaType || argument.scriptPath === '') return;
      found.push({ argumentId, datatype: parameter });
    });
  }
  return found;
}
