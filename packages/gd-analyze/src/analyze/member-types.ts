/**
 * The datatype of a script's untyped member variable (`var coins = 0`), where every value the
 * project stores in it has one type (`member-assignment-type`): its initializer and every
 * assignment to it (`coins = v`, `coins += v` in its script and the scripts extending it, and
 * `obj.coins = v` / `obj.coins += v` anywhere, whatever `obj` is). The member is not typed when it
 * has a setter, is exported (a scene may store any value), has no initializer, when some value's
 * type is unknown or they disagree, or when a string names it (`set("coins", v)` is reflection the
 * analysis does not follow).
 *
 * An exported member (`@export var jump_strength = 7`) is untyped too: the parser gives the
 * inspector its initializer's type (`export_annotations`, `gdscript_parser.cpp:4745`) and a scene
 * stores whatever value it authors. It is typed as above when, in addition, every value any scene
 * authors for a property of its name has the initializer's type.
 */
import type { GodotBoundDatatype, GodotBoundNode, GodotBoundScript } from '../godot-frontend/bound-program';
import type { GodotApiDump } from './api-dump';
import type { GodotValue } from '../read/godot-value';
import { OPERATOR_SPELLING } from './project-setting-types';

/** The key of a member: its declaring script's path and its name. */
export function memberKey(resPath: string, member: string): string {
  return `${resPath}\0${member}`;
}

function known(datatype: GodotBoundDatatype): boolean {
  return (datatype.kind === 'BUILTIN' || datatype.kind === 'NATIVE' || datatype.kind === 'CLASS' || datatype.kind === 'SCRIPT' || datatype.kind === 'ENUM') && !datatype.metaType && datatype.builtinType !== 'Nil';
}

function sameType(a: GodotBoundDatatype, b: GodotBoundDatatype): boolean {
  const builtin = (d: GodotBoundDatatype) => (d.kind === 'ENUM' ? 'int' : d.builtinType);
  const kind = (d: GodotBoundDatatype) => (d.kind === 'ENUM' ? 'BUILTIN' : d.kind);
  return kind(a) === kind(b) && builtin(a) === builtin(b) && a.nativeType === b.nativeType && a.scriptPath === b.scriptPath;
}

export interface MemberTypeInputs {
  readonly programs: readonly GodotBoundScript[];
  /** A script's ancestors, nearest first. */
  readonly scriptAncestors: (resPath: string) => readonly string[];
  readonly apiDump: GodotApiDump;
  /** Every value some scene node authors for a property of this name. */
  readonly sceneValues?: (name: string) => readonly GodotValue[];
}

/** The built-in type a scene value is serialized as, where it is a plain one. */
function sceneValueType(value: GodotValue): string | undefined {
  if (value.kind === 'number') return value.variantType;
  if (value.kind === 'bool') return 'bool';
  if (value.kind === 'string') return 'String';
  return undefined;
}

export function typeMembers(inputs: MemberTypeInputs): ReadonlyMap<string, GodotBoundDatatype> {
  const identifierName = (program: GodotBoundScript, id: number): string | undefined => {
    const node = program.nodes[id];
    return node?.kind === 'IDENTIFIER' ? node.name : undefined;
  };
  // Names a string literal spells anywhere: reflection may reach them.
  const spelled = new Set<string>();
  for (const program of inputs.programs) {
    for (const node of program.nodes) {
      if (node.kind === 'LITERAL' && (node.value.kind === 'string' || node.value.kind === 'string-name')) spelled.add(node.value.value);
    }
  }
  // The values stored by name through an attribute (`obj.name = v`), from any script.
  const attributeValues = new Map<string, Stored[]>();
  // A stored value: a plain assignment's value, or a compound assignment's operator applied to the
  // member's candidate type and the value (Godot's operator table), recorded as the pair.
  type Stored = { readonly value: GodotBoundDatatype | undefined; readonly operator?: number };
  const valueOf = (program: GodotBoundScript, node: Extract<GodotBoundNode, { kind: 'ASSIGNMENT' }>): Stored => {
    const raw = program.nodes[node.assignedValue]?.datatype;
    const value = raw !== undefined && known(raw) ? raw : undefined;
    return node.operation === 'OP_NONE' ? { value } : { value, operator: node.variantOperatorId };
  };
  const builtinName = (d: GodotBoundDatatype) => (d.kind === 'ENUM' ? 'int' : d.builtinType);
  /** What a stored value leaves in a member of type `candidate`. */
  const resultOf = (stored: Stored, candidate: GodotBoundDatatype): GodotBoundDatatype | undefined => {
    if (stored.value === undefined) return undefined;
    if (stored.operator === undefined) return stored.value;
    if (candidate.kind !== 'BUILTIN' && candidate.kind !== 'ENUM') return undefined;
    const spelling = OPERATOR_SPELLING[stored.operator];
    const returned = (inputs.apiDump.builtinClasses ?? [])
      .find((entry) => entry.name === builtinName(candidate))
      ?.operatorSignatures?.find((entry) => entry.name === spelling && entry.rightType === builtinName(stored.value as GodotBoundDatatype))?.returnType;
    return returned === builtinName(candidate) ? candidate : undefined;
  };
  for (const program of inputs.programs) {
    for (const node of program.nodes) {
      if (node.kind !== 'ASSIGNMENT') continue;
      const assignee = program.nodes[node.assignee];
      if (assignee?.kind !== 'SUBSCRIPT' || !assignee.isAttribute) continue;
      const name = identifierName(program, assignee.attribute);
      if (name === undefined) continue;
      const rows = attributeValues.get(name) ?? [];
      rows.push(valueOf(program, node));
      attributeValues.set(name, rows);
    }
  }
  const types = new Map<string, GodotBoundDatatype>();
  for (const program of inputs.programs) {
    const root = program.nodes[program.rootNodeId];
    if (root?.kind !== 'CLASS') continue;
    // The scripts that inherit this one's members (their own `name = v` store into it).
    const family = inputs.programs.filter((other) => other.resPath === program.resPath || inputs.scriptAncestors(other.resPath).includes(program.resPath));
    for (const memberId of root.members) {
      const member = program.nodes[memberId];
      if (member?.kind !== 'VARIABLE' || member.static || member.setter >= 0 || member.datatypeSpecifier >= 0 || member.initializer < 0) continue;
      // Untyped (no specifier): the analyzer's datatype is at most its initializer's, a weak one.
      const name = identifierName(program, member.identifier);
      if (name === undefined || spelled.has(name)) continue;
      const initial = program.nodes[member.initializer]?.datatype;
      const candidate = initial !== undefined && known(initial) ? initial : undefined;
      if (candidate === undefined) continue;
      if (member.exported) {
        const values = inputs.sceneValues?.(name);
        if (values === undefined || candidate.kind !== 'BUILTIN' || !values.every((value) => sceneValueType(value) === candidate.builtinType)) continue;
      }
      const stored: Stored[] = [...(attributeValues.get(name) ?? [])];
      for (const script of family) {
        for (const node of script.nodes) {
          if (node.kind !== 'ASSIGNMENT') continue;
          const assignee = script.nodes[node.assignee];
          if (assignee?.kind === 'IDENTIFIER' && assignee.name === name && (assignee.source === 'MEMBER_VARIABLE' || assignee.source === 'INHERITED_VARIABLE')) stored.push(valueOf(script, node));
        }
      }
      if (!stored.every((entry) => {
        const result = resultOf(entry, candidate);
        return result !== undefined && sameType(result, candidate);
      })) continue;
      types.set(memberKey(program.resPath, name), candidate.kind === 'ENUM' ? { ...candidate, kind: 'BUILTIN', builtinType: 'int', display: 'int', nativeType: '', enumType: '' } : candidate);
    }
  }
  return types;
}
