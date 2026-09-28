/**
 * The variables that hold null at some time, and the reads of each (`nullable-variable`): a
 * variable declared with no initializer, or `@onready` (whose initializer runs only at `_ready`),
 * holds null until a store (`gdscript_compiler.cpp:2365`, `:2398`), as does one initialized with or
 * assigned (by name or as `self.x`) a value that may be null: `null`, a constant holding null, a
 * `get_node_or_null` call (`Node::get_node_or_null`, scene/main/node.cpp:1904) or a ternary with
 * such a branch. A variable of a hard built-in type never holds null (the compiler clears it to its
 * type's default and a `null` store to it does not compile). Lowering types such a
 * declaration `T | null` and states an object read from it as present where Godot errs on null
 * (`OPCODE_GET_NAMED`, `gdscript_vm.cpp:1260`).
 *
 * A read or store resolves to its declaration as GDScript scopes it: a local to the innermost block
 * declaring that name before it, a member to the innermost class containing it (an inner class's
 * own members), an inherited member of the script's class to the nearest ancestor script declaring
 * it. An inherited member no ancestor script declares (an inner class's base, a base outside the
 * project) may be either, so its reads count, one entry per name.
 */
import type { GodotBoundNode, GodotBoundScript } from '../godot-frontend/bound-program';

export interface BoundGodotNullableVariable {
  /** The script declaring the variable; for an inherited member no ancestor declares, the script reading it. */
  readonly resPath: string;
  readonly name: string;
  /** Its VARIABLE declaration in `resPath`; absent for an inherited member no ancestor declares. */
  readonly declaration?: number;
  /** This script's IDENTIFIER reads of it. */
  readonly reads: readonly number[];
}

/** One script's nullable variables: the declarations it makes and the ones it reads. */
export interface ScriptNullableVariables {
  /** This script's VARIABLE declarations (members, inner classes' members and locals) that hold null at some time. */
  readonly declarations: readonly number[];
  /** The nullable variables this script reads, with its reads of each. */
  readonly variables: readonly BoundGodotNullableVariable[];
}

export interface NullableVariableInputs {
  readonly programs: readonly GodotBoundScript[];
  /** A script's ancestors, nearest first. */
  readonly scriptAncestors: (resPath: string) => readonly string[];
}

type Variable = Extract<GodotBoundNode, { kind: 'VARIABLE' }>;

/** What an IDENTIFIER names: a declaration in a script, or an inherited member no ancestor script declares. */
type Resolved = { readonly resPath: string; readonly declaration: Variable } | { readonly resPath: string; readonly name: string };

function identifierName(program: GodotBoundScript, id: number): string | undefined {
  const node = program.nodes[id];
  return node?.kind === 'IDENTIFIER' ? node.name : undefined;
}

function within(inner: GodotBoundNode, outer: GodotBoundNode): boolean {
  return (
    (inner.startLine > outer.startLine || (inner.startLine === outer.startLine && inner.startColumn >= outer.startColumn)) &&
    (inner.endLine < outer.endLine || (inner.endLine === outer.endLine && inner.endColumn <= outer.endColumn))
  );
}

function before(left: GodotBoundNode, right: GodotBoundNode): boolean {
  return left.startLine < right.startLine || (left.startLine === right.startLine && left.startColumn < right.startColumn);
}

/** The size of a node's span, for choosing the innermost of the blocks or classes containing a node. */
function extent(node: GodotBoundNode): number {
  return (node.endLine - node.startLine) * 100_000 + (node.endColumn - node.startColumn);
}

/** Whether a stored value may be null: `null` or a constant holding it, `get_node_or_null`, or a ternary with such a branch. */
function mayBeNull(program: GodotBoundScript, id: number): boolean {
  const node = program.nodes[id];
  if (node === undefined) return false;
  // The analyzer types `null`, and a constant holding it, as Nil.
  if (node.datatype.kind === 'BUILTIN' && node.datatype.builtinType === 'Nil' && !node.datatype.metaType) return true;
  if (node.kind === 'LITERAL') return (node.reduced ? node.reducedValue : node.value).kind === 'nil';
  if (node.kind === 'CALL') return node.functionName === 'get_node_or_null';
  if (node.kind === 'TERNARY_OPERATOR') return mayBeNull(program, node.trueExpression) || mayBeNull(program, node.falseExpression);
  return false;
}

/** A variable the compiler holds to a built-in type (`var x: int`, `var x := 0`), which is never null. */
function hardBuiltin(declaration: Variable): boolean {
  const datatype = declaration.datatype;
  if (declaration.datatypeSpecifier < 0 && !declaration.inferDatatype) return false;
  return !datatype.metaType && (datatype.kind === 'ENUM' || (datatype.kind === 'BUILTIN' && datatype.builtinType !== 'Nil'));
}

function classMembers(program: GodotBoundScript, classNode: GodotBoundNode): ReadonlyMap<string, Variable> {
  const members = new Map<string, Variable>();
  for (const id of classNode.kind === 'CLASS' ? classNode.members : []) {
    const member = program.nodes[id];
    const name = member?.kind === 'VARIABLE' ? identifierName(program, member.identifier) : undefined;
    if (member?.kind === 'VARIABLE' && name !== undefined) members.set(name, member);
  }
  return members;
}

export function nullableVariables(inputs: NullableVariableInputs): ReadonlyMap<string, ScriptNullableVariables> {
  const rootMembers = new Map(
    inputs.programs.map((program) => {
      const root = program.nodes[program.rootNodeId];
      return [program.resPath, root === undefined ? new Map<string, Variable>() : classMembers(program, root)] as const;
    }),
  );

  // Each script's IDENTIFIERs resolved to what they name.
  const resolvedByScript = new Map<string, ReadonlyMap<number, Resolved>>();
  const selfMembersByScript = new Map<string, ReadonlyMap<number, Resolved>>();
  for (const program of inputs.programs) {
    const locals: { readonly declaration: Variable; readonly name: string; readonly block: GodotBoundNode }[] = [];
    for (const node of program.nodes) {
      if (node.kind !== 'SUITE') continue;
      for (const id of node.statements) {
        const statement = program.nodes[id];
        const name = statement?.kind === 'VARIABLE' ? identifierName(program, statement.identifier) : undefined;
        if (statement?.kind === 'VARIABLE' && name !== undefined) locals.push({ declaration: statement, name, block: node });
      }
    }
    const innerClasses = program.nodes
      .filter((node) => node.kind === 'CLASS' && node.id !== program.rootNodeId)
      .map((node) => ({ node, members: classMembers(program, node) }));
    // The innermost inner class containing a node; undefined where the script's class holds it.
    const innerClassOf = (node: GodotBoundNode) =>
      innerClasses.filter((entry) => within(node, entry.node)).sort((left, right) => extent(left.node) - extent(right.node))[0];
    const resolved = new Map<number, Resolved>();
    for (const node of program.nodes) {
      if (node.kind !== 'IDENTIFIER') continue;
      if (node.source === 'LOCAL_VARIABLE') {
        const declaration = locals
          .filter((local) => local.name === node.name && within(node, local.block) && before(local.declaration, node))
          .sort((left, right) => extent(left.block) - extent(right.block) || (before(left.declaration, right.declaration) ? 1 : -1))[0]?.declaration;
        if (declaration !== undefined) resolved.set(node.id, { resPath: program.resPath, declaration });
      } else if (node.source === 'MEMBER_VARIABLE') {
        const declaration = (innerClassOf(node)?.members ?? rootMembers.get(program.resPath))?.get(node.name);
        if (declaration !== undefined) resolved.set(node.id, { resPath: program.resPath, declaration });
      } else if (node.source === 'INHERITED_VARIABLE') {
        const declaring =
          innerClassOf(node) === undefined ? inputs.scriptAncestors(program.resPath).find((resPath) => rootMembers.get(resPath)?.has(node.name) === true) : undefined;
        const declaration = declaring === undefined ? undefined : rootMembers.get(declaring)?.get(node.name);
        resolved.set(node.id, declaring === undefined || declaration === undefined ? { resPath: program.resPath, name: node.name } : { resPath: declaring, declaration });
      }
    }
    // `self.x` names the member x of the class `self` is: the innermost class containing it, else
    // the script's class up its ancestors (a store target; not a read of an IDENTIFIER).
    const selfMembers = new Map<number, Resolved>();
    for (const node of program.nodes) {
      if (node.kind !== 'SUBSCRIPT' || !node.isAttribute || program.nodes[node.base]?.kind !== 'SELF') continue;
      const name = identifierName(program, node.attribute);
      if (name === undefined) continue;
      const inner = innerClassOf(node);
      const declaring = inner === undefined ? [program.resPath, ...inputs.scriptAncestors(program.resPath)].find((resPath) => rootMembers.get(resPath)?.has(name) === true) : undefined;
      const declaration = inner !== undefined ? inner.members.get(name) : declaring === undefined ? undefined : rootMembers.get(declaring)?.get(name);
      if (declaration !== undefined) selfMembers.set(node.id, { resPath: declaring ?? program.resPath, declaration });
    }
    selfMembersByScript.set(program.resPath, selfMembers);
    resolvedByScript.set(program.resPath, resolved);
  }

  // The nullable declarations, by script: cleared to null or initialized with a value that may be
  // null, then stored one.
  const nullable = new Map<string, Set<Variable>>(inputs.programs.map((program) => [program.resPath, new Set<Variable>()] as const));
  for (const program of inputs.programs) {
    for (const node of program.nodes) {
      if (node.kind !== 'VARIABLE' || hardBuiltin(node)) continue;
      if (node.initializer < 0 || node.onready || mayBeNull(program, node.initializer)) nullable.get(program.resPath)?.add(node);
    }
  }
  for (const program of inputs.programs) {
    const resolved = resolvedByScript.get(program.resPath);
    const selfMembers = selfMembersByScript.get(program.resPath);
    for (const node of program.nodes) {
      if (node.kind !== 'ASSIGNMENT' || node.operation !== 'OP_NONE' || !mayBeNull(program, node.assignedValue)) continue;
      const target = resolved?.get(node.assignee) ?? selfMembers?.get(node.assignee);
      if (target !== undefined && 'declaration' in target && !hardBuiltin(target.declaration)) nullable.get(target.resPath)?.add(target.declaration);
    }
  }

  const out = new Map<string, ScriptNullableVariables>();
  for (const program of inputs.programs) {
    const found = new Map<string, { resPath: string; name: string; declaration?: number; reads: number[] }>();
    for (const [read, target] of resolvedByScript.get(program.resPath) ?? []) {
      let entry: { resPath: string; name: string; declaration?: number; reads: number[] };
      if ('declaration' in target) {
        if (nullable.get(target.resPath)?.has(target.declaration) !== true) continue;
        const key = `${target.resPath}\0${String(target.declaration.id)}`;
        entry = found.get(key) ?? { resPath: target.resPath, name: identifierName(program, read) ?? '', declaration: target.declaration.id, reads: [] };
        found.set(key, entry);
      } else {
        const key = `${target.resPath}\0?${target.name}`;
        entry = found.get(key) ?? { resPath: target.resPath, name: target.name, reads: [] };
        found.set(key, entry);
      }
      entry.reads.push(read);
    }
    const declarations = [...(nullable.get(program.resPath) ?? [])].map((declaration) => declaration.id).sort((left, right) => left - right);
    if (declarations.length > 0 || found.size > 0) out.set(program.resPath, { declarations, variables: [...found.values()] });
  }
  return out;
}
