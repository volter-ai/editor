/**
 * Facts about a script's program that its lowering acts on (analysis, docs/GODOT.md row 2): which
 * of the refined types it states in the output, and which counted loops assign their own variable.
 */
import type { GodotBoundNode, GodotBoundScript } from '../godot-frontend/bound-program';
import type { BoundGodotRefinedType } from './refined-types';

/**
 * The refined types lowering states in the output: a type test's narrowing, a loop variable typed
 * from the elements its body reads (its list stated as an array of that type), and an annotated
 * member variable the scenes fix to a narrower node type (its reads stated as that node).
 */
export function statedRefinements(program: GodotBoundScript, refinedTypes: readonly BoundGodotRefinedType[]): number[] {
  return refinedTypes
    .filter((entry) => {
      if (entry.rule === 'type-test-narrowing') return true;
      if (entry.rule === 'iterated-element-type') return program.nodes.some((node) => node.kind === 'FOR' && node.variable === entry.nodeId);
      const declared = program.nodes[entry.nodeId];
      return entry.rule === 'scene-node-receiver' && declared?.kind === 'IDENTIFIER' && declared.source === 'MEMBER_VARIABLE' && declared.datatype.typeSource === 'ANNOTATED_EXPLICIT';
    })
    .map((entry) => entry.nodeId);
}

/** The `for` loops whose body assigns their own variable (Godot copies it from a hidden counter). */
export function loopsAssigningVariable(program: GodotBoundScript): number[] {
  const within = (inner: GodotBoundNode, outer: GodotBoundNode) =>
    (inner.startLine > outer.startLine || (inner.startLine === outer.startLine && inner.startColumn >= outer.startColumn)) &&
    (inner.endLine < outer.endLine || (inner.endLine === outer.endLine && inner.endColumn <= outer.endColumn));
  return program.nodes.flatMap((node) => {
    if (node.kind !== 'FOR') return [];
    const variable = program.nodes[node.variable];
    const loop = program.nodes[node.loop];
    if (variable?.kind !== 'IDENTIFIER' || loop === undefined) return [];
    const assigns = program.nodes.some((candidate) => {
      if (candidate.kind !== 'ASSIGNMENT' || !within(candidate, loop)) return false;
      const assignee = program.nodes[candidate.assignee];
      return assignee?.kind === 'IDENTIFIER' && assignee.name === variable.name;
    });
    return assigns ? [node.id] : [];
  });
}
