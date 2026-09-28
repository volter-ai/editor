/**
 * The untyped variables that hold an int at some times and a float at others (`numeric-variant`):
 * Godot's Variant keeps the type with the value (`OPCODE_ASSIGN` into an untyped variable stores
 * whatever arrives, `gdscript_vm.cpp:1384`), so `gravity = 0` then `gravity += 25 * delta` leaves an
 * int, then a float. JS numbers do not carry that type, so such a variable holds a tagged number
 * (compat's `numeric.ts`) and every operator on it switches over the tag. Every variable the
 * analysis settles to one type stays a plain JS number.
 *
 * - A member: untyped, not exported, no setter, with an initializer, named by no string, never
 *   stored through an attribute (`obj.name = v`), whose initializer and every store (`name = v`,
 *   `name op= v` in its script and the scripts extending it) are int or float, both occurring.
 *   A compound store's value is Godot's operator table over the member's {int, float} and the
 *   value's type.
 * - A parameter: every caller passes an int or a float, both occurring (`parameter-types.ts`'s
 *   `numeric` output), and every function of that name takes it that way, so each call tags it.
 *
 * A value's types are its literal's, a typed parameter's, a member's (`member-types.ts`), a
 * candidate member's types so far, an operator's result over its operands' types, `clamp`'s
 * arguments' types (it returns one of its arguments as it is, `variant_utility.cpp:730`), or the
 * frontend's hard built-in type; anything else is unknown and keeps the variable out.
 *
 * A member's types are the least set closed under its stores: its initializer's types, then each
 * store's, a compound store's taken over the member's types found so far (so `coins = 0` and
 * `coins += 1` leave an int alone, not an int or a float).
 */
import type { GodotBoundDatatype, GodotBoundNode, GodotBoundScript } from '../godot-frontend/bound-program';
import type { GodotApiDump } from './api-dump';
import { memberKey } from './member-types';
import { parameterKey } from './parameter-types';
import { OPERATOR_SPELLING } from './project-setting-types';

export type NumericType = 'int' | 'float';

export interface NumericVariantInputs {
  readonly programs: readonly GodotBoundScript[];
  /** A script's ancestors, nearest first. */
  readonly scriptAncestors: (resPath: string) => readonly string[];
  readonly apiDump: GodotApiDump;
  /** An untyped parameter's one datatype (`parameter-types.ts`). */
  readonly parameterType: (resPath: string, fn: string, parameter: string) => GodotBoundDatatype | undefined;
  /** The parameters every caller passes an int or a float, both occurring (`parameterKey`). */
  readonly numericParameters: ReadonlySet<string>;
  /** An untyped member's one datatype (`member-types.ts`). */
  readonly memberType?: (resPath: string, name: string) => GodotBoundDatatype | undefined;
}

/** What one script lowers as tagged numbers. */
export interface ScriptNumericVariants {
  /** IDENTIFIER reads and writes of a tagged variable, and its VARIABLE or PARAMETER declaration. */
  readonly variables: readonly number[];
  /** Calls whose arguments at these indexes reach a tagged parameter: the caller tags them. */
  readonly taggedArguments: readonly { readonly callId: number; readonly indexes: readonly number[] }[];
  /**
   * Calls whose int-or-float arguments at these indexes reach an engine `float` parameter, which
   * takes either as its value: `Variant::construct` picks the constructor its arguments convert to
   * (`variant_construct.cpp:264`) and converts each (`Variant::operator double`, `variant.cpp:1535`).
   */
  readonly floatArguments?: readonly { readonly callId: number; readonly indexes: readonly number[] }[];
}

const NUMERIC: ReadonlySet<string> = new Set(['int', 'float']);

function builtinOf(datatype: GodotBoundDatatype): string | undefined {
  if (datatype.metaType) return undefined;
  if (datatype.kind === 'ENUM') return 'int';
  return datatype.kind === 'BUILTIN' && datatype.builtinType !== 'Nil' ? datatype.builtinType : undefined;
}

export function numericVariants(inputs: NumericVariantInputs): ReadonlyMap<string, ScriptNumericVariants> {
  const builtins = new Map((inputs.apiDump.builtinClasses ?? []).map((entry) => [entry.name, entry] as const));
  const operatorResult = (left: string, operator: number, right: string | undefined): string | undefined => {
    const spelling = OPERATOR_SPELLING[operator];
    if (spelling === undefined) return undefined;
    const found = builtins.get(left)?.operatorSignatures?.find((entry) => entry.name === spelling && entry.rightType === right)?.returnType;
    return found === undefined || found === 'Variant' ? undefined : found;
  };
  const identifierName = (program: GodotBoundScript, id: number): string | undefined => {
    const node = program.nodes[id];
    return node?.kind === 'IDENTIFIER' ? node.name : undefined;
  };
  const within = (inner: GodotBoundNode, outer: GodotBoundNode) =>
    (inner.startLine > outer.startLine || (inner.startLine === outer.startLine && inner.startColumn >= outer.startColumn)) &&
    (inner.endLine < outer.endLine || (inner.endLine === outer.endLine && inner.endColumn <= outer.endColumn));
  const enclosingFunction = (program: GodotBoundScript, node: GodotBoundNode) => {
    const found = program.nodes.find((candidate) => candidate.kind === 'FUNCTION' && within(node, candidate));
    return found?.kind === 'FUNCTION' ? found : undefined;
  };

  // Names a string literal spells, and names stored through an attribute on any object.
  const spelled = new Set<string>();
  const attributeStored = new Set<string>();
  for (const program of inputs.programs) {
    for (const node of program.nodes) {
      if (node.kind === 'LITERAL' && (node.value.kind === 'string' || node.value.kind === 'string-name')) spelled.add(node.value.value);
      if (node.kind === 'ASSIGNMENT') {
        const assignee = program.nodes[node.assignee];
        if (assignee?.kind === 'SUBSCRIPT' && assignee.isAttribute) {
          const name = identifierName(program, assignee.attribute);
          if (name !== undefined) attributeStored.add(name);
        }
      }
    }
  }

  // The candidate members: [declaring script, name] → its family's programs.
  interface Member {
    readonly key: string;
    readonly program: GodotBoundScript;
    readonly declaration: Extract<GodotBoundNode, { kind: 'VARIABLE' }>;
    readonly name: string;
    readonly family: readonly GodotBoundScript[];
  }
  const members: Member[] = [];
  for (const program of inputs.programs) {
    const root = program.nodes[program.rootNodeId];
    if (root?.kind !== 'CLASS') continue;
    const family = inputs.programs.filter((other) => other.resPath === program.resPath || inputs.scriptAncestors(other.resPath).includes(program.resPath));
    for (const memberId of root.members) {
      const member = program.nodes[memberId];
      // Untyped only: `var x: T` and `var x := v` hold their one type (the compiler converts).
      if (member?.kind !== 'VARIABLE' || member.static || member.exported || member.setter >= 0 || member.datatypeSpecifier >= 0 || member.inferDatatype || member.initializer < 0) continue;
      const name = identifierName(program, member.identifier);
      if (name === undefined || spelled.has(name) || attributeStored.has(name)) continue;
      members.push({ key: memberKey(program.resPath, name), program, declaration: member, name, family });
    }
  }
  const memberOf = (program: GodotBoundScript, name: string): Member | undefined => {
    for (const resPath of [program.resPath, ...inputs.scriptAncestors(program.resPath)]) {
      const found = members.find((member) => member.program.resPath === resPath && member.name === name);
      if (found !== undefined) return found;
    }
    return undefined;
  };

  // Each candidate's types so far (`undefined`: some value it stores is unknown), grown to the least
  // fixpoint from nothing.
  const found = new Map<string, Set<string> | undefined>(members.map((member) => [member.key, new Set<string>()]));
  const parameterOf = (program: GodotBoundScript, node: Extract<GodotBoundNode, { kind: 'IDENTIFIER' }>): { key: string; fn: string } | undefined => {
    const scope = enclosingFunction(program, node);
    const fn = scope === undefined ? undefined : identifierName(program, scope.identifier);
    return fn === undefined ? undefined : { key: parameterKey(program.resPath, fn, node.name), fn };
  };
  const valueTypes = (program: GodotBoundScript, id: number, depth = 0): ReadonlySet<string> | undefined => {
    const node = program.nodes[id];
    if (node === undefined || depth > 32) return undefined;
    if (node.kind === 'LITERAL') {
      const type = builtinOf(node.datatype);
      return type === undefined ? undefined : new Set([type]);
    }
    if (node.kind === 'IDENTIFIER') {
      if (node.source === 'MEMBER_VARIABLE' || node.source === 'INHERITED_VARIABLE') {
        const member = memberOf(program, node.name);
        if (member !== undefined) return found.get(member.key);
        const settled = inputs.memberType?.(program.resPath, node.name);
        const type = settled === undefined ? undefined : builtinOf(settled);
        if (type !== undefined) return new Set([type]);
      }
      if (node.source === 'FUNCTION_PARAMETER') {
        const parameter = parameterOf(program, node);
        if (parameter !== undefined && inputs.numericParameters.has(parameter.key)) return NUMERIC;
        const typed = parameter === undefined ? undefined : inputs.parameterType(program.resPath, parameter.fn, node.name);
        const type = typed === undefined ? undefined : builtinOf(typed);
        if (type !== undefined) return new Set([type]);
      }
      // A variable the frontend holds to a type (`var x: float`, `const`, `:=`).
      const hard = node.datatype.typeSource === 'ANNOTATED_EXPLICIT' || node.datatype.typeSource === 'ANNOTATED_INFERRED' || node.datatype.constant;
      const type = hard ? builtinOf(node.datatype) : undefined;
      return type === undefined ? undefined : new Set([type]);
    }
    if (node.kind === 'BINARY_OPERATOR' || node.kind === 'UNARY_OPERATOR') {
      const left = valueTypes(program, node.kind === 'BINARY_OPERATOR' ? node.leftOperand : node.operand, depth + 1);
      const right = node.kind === 'BINARY_OPERATOR' ? valueTypes(program, node.rightOperand, depth + 1) : new Set([undefined]);
      if (left === undefined || right === undefined) return undefined;
      const results = new Set<string>();
      for (const l of left) {
        for (const r of right as ReadonlySet<string | undefined>) {
          const result = operatorResult(l, node.variantOperatorId, r);
          if (result === undefined) return undefined;
          results.add(result);
        }
      }
      return results;
    }
    // `clamp(x, min, max)` returns x, min or max as it is (`variant_utility.cpp:730`).
    if (node.kind === 'CALL' && node.functionName === 'clamp' && node.compilerTarget.kind === 'variant-utility' && node.arguments.length === 3) {
      const results = new Set<string>();
      for (const argument of node.arguments) {
        const types = valueTypes(program, argument, depth + 1);
        if (types === undefined || ![...types].every((type) => NUMERIC.has(type))) return undefined;
        for (const type of types) results.add(type);
      }
      return results;
    }
    const type = node.datatype.typeSource === 'ANNOTATED_EXPLICIT' || node.datatype.typeSource === 'ANNOTATED_INFERRED' ? builtinOf(node.datatype) : undefined;
    return type === undefined ? undefined : new Set([type]);
  };
  const storedTypes = (member: Member): ReadonlySet<string> | undefined => {
    const all = new Set<string>();
    const initial = valueTypes(member.program, member.declaration.initializer);
    if (initial === undefined) return undefined;
    for (const type of initial) all.add(type);
    for (const script of member.family) {
      for (const node of script.nodes) {
        if (node.kind !== 'ASSIGNMENT') continue;
        const assignee = script.nodes[node.assignee];
        if (assignee?.kind !== 'IDENTIFIER' || assignee.name !== member.name || (assignee.source !== 'MEMBER_VARIABLE' && assignee.source !== 'INHERITED_VARIABLE')) continue;
        const value = valueTypes(script, node.assignedValue);
        if (value === undefined) return undefined;
        if (node.operation === 'OP_NONE') {
          for (const type of value) all.add(type);
          continue;
        }
        const own = found.get(member.key);
        if (own === undefined) return undefined;
        for (const ownType of own) {
          for (const type of value) {
            const result = operatorResult(ownType, node.variantOperatorId, type);
            if (result === undefined) return undefined;
            all.add(result);
          }
        }
      }
    }
    return all;
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (const member of members) {
      const before = found.get(member.key);
      if (before === undefined) continue;
      const stored = storedTypes(member);
      if (stored === undefined || [...stored].some((type) => !before.has(type))) {
        found.set(member.key, stored === undefined ? undefined : new Set([...before, ...stored]));
        changed = true;
      }
    }
  }
  const numeric = new Set(
    members
      .filter((member) => {
        const types = found.get(member.key);
        return types !== undefined && types.size === 2 && [...types].every((type) => NUMERIC.has(type));
      })
      .map((member) => member.key),
  );

  // Parameters: every function of the name takes it numerically, so every call can tag it.
  const functionsByName = new Map<string, { program: GodotBoundScript; node: Extract<GodotBoundNode, { kind: 'FUNCTION' }> }[]>();
  for (const program of inputs.programs) {
    for (const node of program.nodes) {
      if (node.kind !== 'FUNCTION') continue;
      const name = identifierName(program, node.identifier);
      if (name === undefined) continue;
      functionsByName.set(name, [...(functionsByName.get(name) ?? []), { program, node }]);
    }
  }
  const numericIndexes = new Map<string, readonly number[]>();
  for (const [name, sites] of functionsByName) {
    const count = Math.max(...sites.map((site) => site.node.parameters.length));
    const indexes: number[] = [];
    for (let index = 0; index < count; index += 1) {
      const all = sites.every((site) => {
        const parameter = site.program.nodes[site.node.parameters[index] ?? -1];
        const parameterName = parameter?.kind === 'PARAMETER' ? identifierName(site.program, parameter.identifier) : undefined;
        return parameterName !== undefined && inputs.numericParameters.has(parameterKey(site.program.resPath, name, parameterName));
      });
      if (all) indexes.push(index);
    }
    if (indexes.length > 0) numericIndexes.set(name, indexes);
  }

  // Whether an engine call's parameter at `index` is a float: a built-in constructor's, where one
  // overload has that many arguments, or an engine method's.
  const classes = new Map(inputs.apiDump.classes.map((entry) => [entry.name, entry] as const));
  const floatParameter = (call: Extract<GodotBoundNode, { kind: 'CALL' }>, index: number): boolean | undefined => {
    const target = call.compilerTarget;
    if (target.kind === 'builtin-constructor') {
      const overloads = (builtins.get(target.owner)?.constructors ?? []).filter((entry) => entry.arguments.length === call.arguments.length);
      return overloads.length === 1 ? overloads[0]?.arguments[index]?.type === 'float' : undefined;
    }
    if (target.kind === 'native-method') {
      for (let current = classes.get(target.owner); current !== undefined; current = current.base_class === '' ? undefined : classes.get(current.base_class)) {
        const method = current.methods.find((entry) => entry.name === target.member);
        if (method !== undefined) return method.arguments[index]?.type === 'float';
      }
    }
    return undefined;
  };

  const out = new Map<string, ScriptNumericVariants>();
  for (const program of inputs.programs) {
    const variables: number[] = [];
    for (const node of program.nodes) {
      if (node.kind === 'IDENTIFIER' && (node.source === 'MEMBER_VARIABLE' || node.source === 'INHERITED_VARIABLE')) {
        const member = memberOf(program, node.name);
        if (member !== undefined && numeric.has(member.key)) variables.push(node.id);
      } else if (node.kind === 'IDENTIFIER' && node.source === 'FUNCTION_PARAMETER') {
        const parameter = parameterOf(program, node);
        if (parameter !== undefined && inputs.numericParameters.has(parameter.key) && numericIndexes.has(parameter.fn)) {
          variables.push(node.id);
        }
      } else if (node.kind === 'VARIABLE') {
        const name = identifierName(program, node.identifier);
        const member = name === undefined ? undefined : members.find((entry) => entry.declaration === node);
        if (member !== undefined && numeric.has(member.key)) variables.push(node.id);
      }
    }
    for (const node of program.nodes) {
      if (node.kind !== 'FUNCTION') continue;
      const fn = identifierName(program, node.identifier);
      if (fn === undefined || !numericIndexes.has(fn)) continue;
      for (const index of numericIndexes.get(fn) ?? []) {
        const parameter = program.nodes[node.parameters[index] ?? -1];
        if (parameter?.kind === 'PARAMETER') variables.push(parameter.id);
      }
    }
    const taggedArguments = program.nodes.flatMap((node) => {
      if (node.kind !== 'CALL') return [];
      const indexes = numericIndexes.get(node.functionName);
      const reached = indexes?.filter((index) => node.arguments[index] !== undefined);
      return reached === undefined || reached.length === 0 ? [] : [{ callId: node.id, indexes: reached }];
    });
    const floatArguments = program.nodes.flatMap((node) => {
      if (node.kind !== 'CALL') return [];
      const indexes = node.arguments.flatMap((argument, index) => {
        if (floatParameter(node, index) !== true) return [];
        const types = valueTypes(program, argument);
        return types !== undefined && types.size === 2 && [...types].every((type) => NUMERIC.has(type)) ? [index] : [];
      });
      return indexes.length === 0 ? [] : [{ callId: node.id, indexes }];
    });
    if (variables.length > 0 || taggedArguments.length > 0 || floatArguments.length > 0) {
      out.set(program.resPath, { variables: [...new Set(variables)].sort((a, b) => a - b), taggedArguments, ...(floatArguments.length > 0 ? { floatArguments } : {}) });
    }
  }
  return out;
}
