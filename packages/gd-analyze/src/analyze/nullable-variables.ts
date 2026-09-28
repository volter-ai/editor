/**
 * The variables Godot clears to null before anything is assigned, and the reads of each
 * (`nullable-variable`): a variable declared with no initializer, or `@onready` (whose initializer
 * runs only at `_ready`), holds null until a store (`gdscript_compiler.cpp:2365`, `:2398`). Lowering
 * types such a variable `T | null` and states an object read from it as present where Godot errs on
 * null (`OPCODE_GET_NAMED`, `gdscript_vm.cpp:1260`).
 *
 * A read resolves to its declaration as GDScript scopes it: a local to the innermost block declaring
 * that name before the read, a member to its script's class, an inherited member to the nearest
 * ancestor script declaring it (one no ancestor declares may be either, so it counts).
 */
import type { GodotBoundNode, GodotBoundScript } from '../godot-frontend/bound-program';

export interface BoundGodotNullableVariable {
  /** The script declaring the variable. */
  readonly resPath: string;
  /** Its VARIABLE declaration, which holds null before a store; -1 for an inherited member no ancestor declares. */
  readonly declaration: number;
  /** This script's IDENTIFIER reads of it. */
  readonly reads: readonly number[];
}

export interface NullableVariableInputs {
  readonly programs: readonly GodotBoundScript[];
  /** A script's ancestors, nearest first. */
  readonly scriptAncestors: (resPath: string) => readonly string[];
}

type Variable = Extract<GodotBoundNode, { kind: 'VARIABLE' }>;

const clearedToNull = (declaration: Variable) => declaration.initializer < 0 || declaration.onready;

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

/** The size of a node's span, for choosing the innermost of the blocks containing a read. */
function extent(node: GodotBoundNode): number {
  return (node.endLine - node.startLine) * 100_000 + (node.endColumn - node.startColumn);
}

function rootMembers(program: GodotBoundScript): ReadonlyMap<string, Variable> {
  const root = program.nodes[program.rootNodeId];
  const members = new Map<string, Variable>();
  for (const id of root?.kind === 'CLASS' ? root.members : []) {
    const member = program.nodes[id];
    const name = member?.kind === 'VARIABLE' ? identifierName(program, member.identifier) : undefined;
    if (member?.kind === 'VARIABLE' && name !== undefined) members.set(name, member);
  }
  return members;
}

export function nullableVariables(inputs: NullableVariableInputs): ReadonlyMap<string, readonly BoundGodotNullableVariable[]> {
  const byPath = new Map(inputs.programs.map((program) => [program.resPath, program] as const));
  const membersOf = new Map(inputs.programs.map((program) => [program.resPath, rootMembers(program)] as const));
  const out = new Map<string, readonly BoundGodotNullableVariable[]>();
  for (const program of inputs.programs) {
    // Each local declaration with the block (SUITE) that declares it.
    const locals: { readonly declaration: Variable; readonly name: string; readonly block: GodotBoundNode }[] = [];
    for (const node of program.nodes) {
      if (node.kind !== 'SUITE') continue;
      for (const id of node.statements) {
        const statement = program.nodes[id];
        const name = statement?.kind === 'VARIABLE' ? identifierName(program, statement.identifier) : undefined;
        if (statement?.kind === 'VARIABLE' && name !== undefined) locals.push({ declaration: statement, name, block: node });
      }
    }
    const found = new Map<string, { resPath: string; declaration: number; reads: number[] }>();
    const record = (resPath: string, declaration: number, read: number) => {
      const key = `${resPath}\0${String(declaration)}`;
      const entry = found.get(key) ?? { resPath, declaration, reads: [] };
      entry.reads.push(read);
      found.set(key, entry);
    };
    for (const node of program.nodes) {
      if (node.kind !== 'IDENTIFIER') continue;
      if (node.source === 'LOCAL_VARIABLE') {
        const declaration = locals
          .filter((local) => local.name === node.name && within(node, local.block) && before(local.declaration, node))
          .sort((left, right) => extent(left.block) - extent(right.block) || (before(left.declaration, right.declaration) ? 1 : -1))[0]?.declaration;
        if (declaration !== undefined && clearedToNull(declaration)) record(program.resPath, declaration.id, node.id);
      } else if (node.source === 'MEMBER_VARIABLE') {
        const declaration = membersOf.get(program.resPath)?.get(node.name);
        if (declaration !== undefined && clearedToNull(declaration)) record(program.resPath, declaration.id, node.id);
      } else if (node.source === 'INHERITED_VARIABLE') {
        const declaring = inputs.scriptAncestors(program.resPath).find((resPath) => membersOf.get(resPath)?.has(node.name) === true);
        const declaration = declaring === undefined ? undefined : membersOf.get(declaring)?.get(node.name);
        if (declaring === undefined || declaration === undefined) record(inputs.scriptAncestors(program.resPath)[0] ?? program.resPath, -1, node.id);
        else if (byPath.has(declaring) && clearedToNull(declaration)) record(declaring, declaration.id, node.id);
      }
    }
    if (found.size > 0) out.set(program.resPath, [...found.values()]);
  }
  return out;
}
