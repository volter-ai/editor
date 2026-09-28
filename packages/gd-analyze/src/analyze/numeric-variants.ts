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

/** The variables and calls one script lowers as tagged numbers (`numericVariants`). */
export interface ScriptNumericVariables {
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

/** What one script lowers as tagged numbers, with the types of the values they reach. */
export interface ScriptNumericVariants extends ScriptNumericVariables {
  /** The built-in types of the values the tagged variables reach and of the plain values stored or passed among them (`numericNodeTypes`). */
  readonly nodeTypes: readonly NumericNodeTypes[];
}

/**
 * One value's built-in types where an int-or-float variable is involved, for lowering to select
 * its rules by: `reached` where such a variable reaches it (the variable, an operation on it,
 * `clamp` or `str` of it), `plain` for a value it does not reach that is stored into, passed to or
 * operated on with one, and `branches` for an operation lowering switches over the tags of its
 * int-or-float operands. `unknown` marks a combination Godot's operator table does not type.
 */
export interface NumericNodeTypes {
  readonly nodeId: number;
  readonly reached?: readonly string[];
  readonly plain?: string;
  /** The operation's result for each combination of its int-or-float operands' types, in operand order. */
  readonly branches?: readonly { readonly choice: readonly string[]; readonly type: string }[];
}

/** Godot's operator table (`Variant::get_operator_return_type`): `left op right`'s result type, right absent for a unary. */
export type OperatorResult = (left: string | undefined, operator: number, right: string | undefined) => string | undefined;

export function operatorResultTable(apiDump: GodotApiDump): OperatorResult {
  const builtins = new Map((apiDump.builtinClasses ?? []).map((entry) => [entry.name, entry] as const));
  return (left, operator, right) => {
    const spelling = OPERATOR_SPELLING[operator];
    if (spelling === undefined || left === undefined) return undefined;
    const found = builtins.get(left)?.operatorSignatures?.find((entry) => entry.name === spelling && entry.rightType === right)?.returnType;
    return found === undefined || found === 'Variant' ? undefined : found;
  };
}

const NUMERIC: ReadonlySet<string> = new Set(['int', 'float']);

function builtinOf(datatype: GodotBoundDatatype): string | undefined {
  if (datatype.metaType) return undefined;
  if (datatype.kind === 'ENUM') return 'int';
  return datatype.kind === 'BUILTIN' && datatype.builtinType !== 'Nil' ? datatype.builtinType : undefined;
}

export function numericVariants(inputs: NumericVariantInputs): ReadonlyMap<string, ScriptNumericVariables> {
  const builtins = new Map((inputs.apiDump.builtinClasses ?? []).map((entry) => [entry.name, entry] as const));
  const operatorResult = operatorResultTable(inputs.apiDump);
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
    if (node.kind === 'CALL' && variantUtilityShape(node) === 'selects-argument' && node.arguments.length === 3) {
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

  const out = new Map<string, ScriptNumericVariables>();
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

/**
 * The Variant utility functions whose result over int-or-float values depends on the function
 * itself (`VariantUtilityShape`): `clamp` returns one of its arguments as it is
 * (`variant_utility.cpp:730`), so its result is an argument's own type; `str` stringifies its
 * arguments (`VariantUtilityFunctions::str`), each printed as its own type.
 */
export type VariantUtilityShape = 'selects-argument' | 'stringifies';

const UTILITY_SHAPES: ReadonlyMap<string, VariantUtilityShape> = new Map([
  ['clamp', 'selects-argument'],
  ['str', 'stringifies'],
]);

/** A call's utility shape: the Variant utility it calls, where the table gives it one. */
export function variantUtilityShape(node: GodotBoundNode): VariantUtilityShape | undefined {
  return node.kind === 'CALL' && node.compilerTarget.kind === 'variant-utility' ? UTILITY_SHAPES.get(node.compilerTarget.member) : undefined;
}

/** Each call in a script to a utility with a shape, for lowering to select its rule by. */
export function variantUtilityCalls(program: GodotBoundScript): readonly { readonly nodeId: number; readonly shape: VariantUtilityShape }[] {
  return program.nodes.flatMap((node) => {
    const shape = variantUtilityShape(node);
    return shape === undefined ? [] : [{ nodeId: node.id, shape }];
  });
}

export interface NumericNodeTypeInputs {
  /** The program as the analysis refined its datatypes (the one lowering reads, `refinedProgram`). */
  readonly program: GodotBoundScript;
  readonly variants: ScriptNumericVariables;
  readonly operatorResult: OperatorResult;
}

/**
 * The types of the values one script's int-or-float variables reach (`NumericNodeTypes`), over
 * the refined program: a tagged variable is an int or a float; an operation on one is Godot's
 * operator table over its operands' types, except that `and` and `or` short-circuit to a bool
 * (`write_end_and`/`write_end_or` assign true or false, `gdscript_compiler.cpp:873`, `:889`);
 * `clamp` is one of its arguments as it is; `str` is a String. An enum value is an int.
 */
export function numericNodeTypes(inputs: NumericNodeTypeInputs): readonly NumericNodeTypes[] {
  const { program, variants, operatorResult } = inputs;
  const variables = new Set(variants.variables);
  const own = (datatype: GodotBoundDatatype): string => (datatype.kind === 'ENUM' ? 'int' : datatype.kind === 'BUILTIN' ? datatype.builtinType : 'unknown');
  const plainOf = (node: GodotBoundNode): string | undefined => {
    const datatype = node.datatype;
    if (datatype.kind === 'ENUM') return 'int';
    return datatype.kind === 'BUILTIN' && !datatype.metaType ? datatype.builtinType : undefined;
  };
  const stringifies = (node: GodotBoundNode): boolean => variantUtilityShape(node) === 'stringifies';
  const operandsOf = (node: GodotBoundNode): readonly number[] | undefined => {
    if (node.kind === 'BINARY_OPERATOR') return [node.leftOperand, node.rightOperand];
    if (node.kind === 'UNARY_OPERATOR') return [node.operand];
    if (node.kind === 'CALL') return node.arguments;
    if (node.kind === 'ASSIGNMENT') return [node.assignee, node.assignedValue];
    return undefined;
  };
  const logical = (node: GodotBoundNode) => node.kind === 'BINARY_OPERATOR' && (node.operation === 'OP_LOGIC_AND' || node.operation === 'OP_LOGIC_OR');

  const memo = new Map<number, readonly string[] | undefined>();
  const reached = (id: number): readonly string[] | undefined => {
    if (memo.has(id)) return memo.get(id);
    memo.set(id, undefined);
    const node = program.nodes[id];
    const result = node === undefined ? undefined : reach(node);
    memo.set(id, result);
    return result;
  };
  const types = (node: GodotBoundNode): readonly string[] => reached(node.id) ?? [own(node.datatype)];
  const reach = (node: GodotBoundNode): readonly string[] | undefined => {
    if (node.kind === 'IDENTIFIER') return variables.has(node.id) ? ['int', 'float'] : undefined;
    const argumentSelecting = variantUtilityShape(node) === 'selects-argument' && node.kind === 'CALL' && node.arguments.length === 3;
    if (node.kind !== 'BINARY_OPERATOR' && node.kind !== 'UNARY_OPERATOR' && !argumentSelecting && !stringifies(node)) return undefined;
    const children = (operandsOf(node) ?? []).map((id) => program.nodes[id]);
    if (children.some((child) => child === undefined)) return undefined;
    const operands = children as GodotBoundNode[];
    if (!operands.some((child) => reached(child.id) !== undefined)) return undefined;
    if (stringifies(node)) return ['String'];
    if (argumentSelecting) return [...new Set(operands.flatMap(types))];
    if (logical(node)) return ['bool'];
    const [left, right] = operands.map(types);
    const results = new Set<string>();
    for (const l of left ?? []) {
      for (const r of right ?? [undefined]) results.add(operatorResult(l, (node as { variantOperatorId: number }).variantOperatorId, r) ?? 'unknown');
    }
    return [...results];
  };
  const tagged = (id: number) => (reached(id)?.length ?? 0) > 1;

  // The operations lowering switches over: an operator or `str` reading a tagged operand directly,
  // and a compound store (`a op= b` reads as `a op b`) with a tagged side.
  const branchesOf = (node: GodotBoundNode): NumericNodeTypes['branches'] => {
    const switching =
      node.kind === 'BINARY_OPERATOR' || node.kind === 'UNARY_OPERATOR' || stringifies(node) || (node.kind === 'ASSIGNMENT' && node.operation !== 'OP_NONE');
    const operandIds = switching ? (operandsOf(node) ?? []) : [];
    const operands = operandIds.map((id) => program.nodes[id]);
    if (operands.some((operand) => operand === undefined) || !operandIds.some(tagged)) return undefined;
    const taggedIds = operandIds.filter(tagged);
    const out: { choice: readonly string[]; type: string }[] = [];
    const walk = (choice: readonly string[]): void => {
      if (choice.length < taggedIds.length) {
        for (const type of ['int', 'float']) walk([...choice, type]);
        return;
      }
      const typeOf = (operand: GodotBoundNode): string | undefined => {
        const index = taggedIds.indexOf(operand.id);
        return index >= 0 ? choice[index] : types(operand)[0];
      };
      let type: string;
      if (stringifies(node)) type = 'String';
      else if (logical(node)) type = 'bool';
      else {
        const [left, right] = (operands as GodotBoundNode[]).map(typeOf);
        type = operatorResult(left, (node as { variantOperatorId: number }).variantOperatorId, right) ?? 'unknown';
      }
      out.push({ choice, type });
    };
    walk([]);
    return out;
  };

  // The plain values lowering types among them: the operands of a reached value, both sides of a
  // store reaching a tagged variable or value, the arguments of a call tagging a parameter, and a
  // tagged member's initializer.
  const plainIds = new Set<number>();
  const taggedCalls = new Set(variants.taggedArguments.map((entry) => entry.callId));
  for (const node of program.nodes) {
    const operands = operandsOf(node) ?? [];
    if (node.kind === 'ASSIGNMENT') {
      if (variables.has(node.assignee) || reached(node.assignedValue) !== undefined || reached(node.assignee) !== undefined) operands.forEach((id) => plainIds.add(id));
    } else if (reached(node.id) !== undefined || (node.kind === 'CALL' && taggedCalls.has(node.id))) {
      operands.forEach((id) => plainIds.add(id));
    } else if (node.kind === 'VARIABLE' && variables.has(node.id) && node.initializer >= 0) {
      plainIds.add(node.initializer);
    }
  }

  const out: NumericNodeTypes[] = [];
  for (const node of program.nodes) {
    const reachedTypes = reached(node.id);
    const plain = reachedTypes === undefined && plainIds.has(node.id) ? plainOf(node) : undefined;
    const branches = branchesOf(node);
    if (reachedTypes === undefined && plain === undefined && branches === undefined) continue;
    out.push({ nodeId: node.id, ...(reachedTypes === undefined ? {} : { reached: reachedTypes }), ...(plain === undefined ? {} : { plain }), ...(branches === undefined ? {} : { branches }) });
  }
  return out;
}
