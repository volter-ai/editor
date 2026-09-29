import type { BoundGodotResourceDocument } from '../../analyze/bound-project';
import { builtinDatatype } from '../../analyze/refined-types';
import type { GodotValue } from '../../read/godot-value';
import {
  GODOT_NUMERIC_TYPES,
  type GodotBuiltinSubscriptShape,
  type GodotNumericTag,
  godotAwaitsEmission,
  godotBuiltinCopied,
  godotBuiltinSubscriptShape,
  godotBuiltinTest,
  godotCallShape,
  godotLanguageConstant,
  godotLiteralIsText,
  godotNumericStoresAs,
  godotNumericTag,
  godotStatedValueType,
  godotSubscriptsParameters,
  godotTruthShape,
  godotTweenInterpolates,
  godotTypeDefault,
} from '../data/lowering-shapes';
import { godotBuiltinWidens, godotLiteralPathText } from '../data/operand-types';
import { godotCompatReturnType } from './native-types';
import type {
  GodotBoundCallNode,
  GodotBoundFunctionNode,
  GodotBoundNode,
  GodotBoundVariant,
} from '../../godot-frontend/bound-program';
import {
  GODOT_VARIANT_OPERATOR_NAMES,
  type GodotOfficialSymbolIdentity,
  type GodotTargetBinding,
} from './bindings';
import {
  type LoweringContext,
  type NativePropertyAccessor,
  type OfficialBoundBindingUse,
  type OfficialBoundLoweringRequirement,
  type OfficialBoundResourceLoadTarget,
  officialBoundPropertyName,
  officialBoundSpan,
} from './official-bound-lowering-context';
import type {
  LoweredTargetTsExpression,
  TargetTsAssignmentOperator,
  TargetTsBinaryOperator,
  TargetTsExpression,
  TargetTsParameter,
  TargetTsStatement,
  TargetTsType,
} from './target-ts-syntax';

export type LoweredExpression = LoweredTargetTsExpression<OfficialBoundLoweringRequirement>;

export interface LoweredStatements {
  readonly statements: readonly TargetTsStatement[];
  readonly requirements: readonly OfficialBoundLoweringRequirement[];
}

export interface LoweredParameters {
  readonly parameters: readonly TargetTsParameter[];
  readonly requirements: readonly OfficialBoundLoweringRequirement[];
}

export type LowerOfficialSuite = (
  context: LoweringContext,
  node: GodotBoundNode,
) => LoweredStatements;

export type LowerOfficialParameters = (
  context: LoweringContext,
  fn: GodotBoundFunctionNode,
) => LoweredParameters;

const span = officialBoundSpan;

/**
 * A Dictionary literal: Godot's Dictionary is represented by an insertion-ordered JS `Map`
 * (`lib/godot-compat/dictionary.ts`), built here from its entries in source order.
 */
function dictionaryMap(
  context: LoweringContext,
  node: GodotBoundNode,
  entries: readonly (readonly [TargetTsExpression, TargetTsExpression])[],
): TargetTsExpression {
  return {
    kind: 'new-expression',
    callee: { kind: 'identifier-expression', name: 'Map' },
    // A Dictionary's keys and values are Variants: entries of different types are one Map's.
    ...(entries.length > 0 ? { typeArguments: [ANY, ANY] } : {}),
    arguments: [
      {
        kind: 'array-expression',
        elements: entries.map(([key, value]) => ({ kind: 'array-expression', elements: [key, value] })),
      },
    ],
    span: span(context.script, node),
  };
}

function literal(
  context: LoweringContext,
  node: GodotBoundNode,
  value: GodotBoundVariant,
): TargetTsExpression {
  switch (value.kind) {
    case 'nil':
      return { kind: 'literal-expression', value: null, span: span(context.script, node) };
    case 'bool':
      return { kind: 'literal-expression', value: value.value, span: span(context.script, node) };
    case 'string':
    case 'string-name':
      return { kind: 'literal-expression', value: value.value, span: span(context.script, node) };
    case 'int': {
      const parsed = Number(value.value);
      if (!Number.isSafeInteger(parsed))
        context.refuse(node, `integer is outside exact JavaScript range: ${value.value}`);
      return { kind: 'literal-expression', value: parsed, span: span(context.script, node) };
    }
    case 'float': {
      const parsed = Number(value.value);
      if (!Number.isFinite(parsed))
        context.refuse(node, `non-finite float needs an explicit binding: ${value.value}`);
      return { kind: 'literal-expression', value: parsed, span: span(context.script, node) };
    }
    case 'array':
      return {
        kind: 'array-expression',
        elements: value.value.map((entry) => literal(context, node, entry)),
        span: span(context.script, node),
      };
    case 'dictionary':
      // A Dictionary is an insertion-ordered JS Map (godot-compat/dictionary.ts).
      return dictionaryMap(
        context,
        node,
        value.value.map((entry) => [literal(context, node, entry.key), literal(context, node, entry.value)] as const),
      );
    case 'opaque':
      // A NodePath is its path text (`lowering-shapes.ts`).
      if (godotLiteralIsText(value.type)) {
        return { kind: 'literal-expression', value: value.text, span: span(context.script, node) };
      }
      return context.refuse(node, `opaque bound literal ${value.type} has no target binding`);
    default:
      return value satisfies never;
  }
}

function expression(
  value: TargetTsExpression,
  requirements: readonly OfficialBoundLoweringRequirement[] = [],
): LoweredExpression {
  return { before: [], value, after: [], requirements };
}

/** Settle one child before its next sibling when it carries post-value work. */
function settle(context: LoweringContext, plan: LoweredExpression): LoweredExpression {
  if (plan.after.length === 0) return plan;
  const name = context.temporary();
  return {
    before: [
      ...plan.before,
      { kind: 'variable-statement', declaration: 'const', name, initializer: plan.value },
      ...plan.after,
    ],
    value: { kind: 'identifier-expression', name },
    after: [],
    requirements: plan.requirements,
  };
}

function materialize(context: LoweringContext, plan: LoweredExpression): LoweredExpression {
  const name = context.temporary();
  return {
    before: [
      ...plan.before,
      { kind: 'variable-statement', declaration: 'const', name, initializer: plan.value },
      ...plan.after,
    ],
    value: { kind: 'identifier-expression', name },
    after: [],
    requirements: plan.requirements,
  };
}

function orderedValues(
  context: LoweringContext,
  children: readonly LoweredExpression[],
): {
  readonly before: readonly TargetTsStatement[];
  readonly values: readonly TargetTsExpression[];
  readonly requirements: readonly OfficialBoundLoweringRequirement[];
} {
  const settled = children.map((child) => settle(context, child));
  const futureSequencing = new Array<boolean>(settled.length).fill(false);
  let laterSequences = false;
  for (let index = settled.length - 1; index >= 0; index -= 1) {
    futureSequencing[index] = laterSequences;
    laterSequences = laterSequences || (settled[index]?.before.length ?? 0) > 0;
  }
  const before: TargetTsStatement[] = [];
  const values: TargetTsExpression[] = [];
  for (const [index, child] of settled.entries()) {
    const ordered = futureSequencing[index] ? materialize(context, child) : child;
    before.push(...ordered.before);
    values.push(ordered.value);
  }
  return {
    before,
    values,
    requirements: settled.flatMap((child) => child.requirements),
  };
}

function compose(
  context: LoweringContext,
  children: readonly LoweredExpression[],
  makeValue: (values: readonly TargetTsExpression[]) => TargetTsExpression,
  ownRequirements: readonly OfficialBoundLoweringRequirement[] = [],
): LoweredExpression {
  const ordered = orderedValues(context, children);
  return {
    before: ordered.before,
    value: makeValue(ordered.values),
    after: [],
    requirements: [...ownRequirements, ...ordered.requirements],
  };
}

/** Godot call arguments are completely evaluated before a dynamic receiver or callee. */
function eagerValues(
  context: LoweringContext,
  children: readonly LoweredExpression[],
): {
  readonly before: readonly TargetTsStatement[];
  readonly values: readonly TargetTsExpression[];
  readonly requirements: readonly OfficialBoundLoweringRequirement[];
} {
  const before: TargetTsStatement[] = [];
  const values: TargetTsExpression[] = [];
  const requirements: OfficialBoundLoweringRequirement[] = [];
  for (const child of children) {
    const prepared = materialize(context, child);
    before.push(...prepared.before);
    values.push(prepared.value);
    requirements.push(...prepared.requirements);
  }
  return { before, values, requirements };
}

function prepareReferenceReceiver(
  context: LoweringContext,
  value: TargetTsExpression,
): { readonly before: readonly TargetTsStatement[]; readonly value: TargetTsExpression } {
  const prepared = materialize(context, expression(value));
  return { before: prepared.before, value: prepared.value };
}

interface PreparedAssignmentTarget {
  readonly beforeAssigned: readonly TargetTsStatement[];
  readonly afterAssigned: readonly TargetTsStatement[];
  readonly target: TargetTsExpression;
  /** Where Godot may drop the store: the store (and a compound's read) happens only when this holds. */
  readonly guard?: TargetTsExpression;
  readonly requirements: readonly OfficialBoundLoweringRequirement[];
}

/** An array index counted from the end when negative: `i < 0 ? a.length + i : i`. */
function fromEnd(array: TargetTsExpression, index: TargetTsExpression): TargetTsExpression {
  return {
    kind: 'conditional-expression',
    condition: { kind: 'binary-expression', operator: '<', left: index, right: { kind: 'literal-expression', value: 0 } },
    whenTrue: { kind: 'binary-expression', operator: '+', left: { kind: 'property-expression', object: array, property: 'length' }, right: index },
    whenFalse: index,
  };
}

/**
 * `0 <= place && place < a.length`: whether an Array store lands. A store outside the array is
 * dropped: `VariantIndexedSetGet_Array::set` refuses it (core/variant/variant_setget.cpp:690), and
 * only a debug build reports that as an error ("Out of bounds set index", gdscript_vm.cpp:1084-1098,
 * under `DEBUG_ENABLED`); the release build the originals ship as carries on without storing. A
 * place known non-negative checks only the upper bound.
 */
function arrayStoreInRange(array: TargetTsExpression, place: TargetTsExpression, nonNegative: boolean): TargetTsExpression {
  const below: TargetTsExpression = { kind: 'binary-expression', operator: '<', left: place, right: { kind: 'property-expression', object: array, property: 'length' } };
  return nonNegative
    ? below
    : { kind: 'binary-expression', operator: '&&', left: { kind: 'binary-expression', operator: '>=', left: place, right: { kind: 'literal-expression', value: 0 } }, right: below };
}

function prepareAssignmentTarget(
  context: LoweringContext,
  node: GodotBoundNode,
  lower: (context: LoweringContext, node: GodotBoundNode) => LoweredExpression,
): PreparedAssignmentTarget {
  if (node.kind === 'IDENTIFIER') {
    const target = lower(context, node);
    if (target.before.length > 0 || target.after.length > 0) {
      return context.refuse(node, 'identifier assignment target unexpectedly requires sequencing');
    }
    if (
      target.value.kind !== 'identifier-expression' &&
      target.value.kind !== 'property-expression'
    ) {
      return context.refuse(node, `${target.value.kind} is not an assignable identifier target`);
    }
    return {
      beforeAssigned: [],
      afterAssigned: [],
      target: target.value,
      requirements: target.requirements,
    };
  }
  if (node.kind === 'SUBSCRIPT') {
    const baseNode = context.node(node.base, node);
    const base = materialize(context, lower(context, baseNode));
    if (node.isAttribute) {
      const requirements = context.structural(node, 'subscript-attribute', [baseNode]);
      // A member of an object that may be null is stated present: a store on null is Godot's error.
      const nullable = nullableObject(context, baseNode);
      return {
        beforeAssigned: base.before,
        afterAssigned: [],
        target: {
          kind: 'property-expression',
          object: nullable ? { kind: 'non-null-expression', expression: base.value } : base.value,
          property: officialBoundPropertyName(context, node.attribute, node),
          span: span(context.script, node),
        },
        requirements: [...requirements, ...base.requirements],
      };
    }
    const indexNode = context.node(node.index, node);
    const index = materialize(context, lower(context, indexNode));
    const element = (place: TargetTsExpression): TargetTsExpression => ({ kind: 'element-expression', object: base.value, index: place, span: span(context.script, node) });
    const nonNegative = indexNode.kind === 'LITERAL' && indexNode.value.kind === 'int' && Number(indexNode.value.value) >= 0;
    if (godotBuiltinSubscriptShape(baseNode.datatype)?.kind === 'array-element') {
      // Variant indexing counts a negative index from the end and drops a store outside the array
      // (`arrayStoreInRange`): after the base, then the value, the index is evaluated once and
      // settled to its place against the array's length.
      const requirements = context.structural(node, 'subscript-element', [baseNode, indexNode], 'subscript-element:array');
      const place = nonNegative ? index : materialize(context, expression(fromEnd(base.value, index.value)));
      return {
        beforeAssigned: base.before,
        afterAssigned: [...index.before, ...(nonNegative ? [] : place.before)],
        target: element(place.value),
        guard: arrayStoreInRange(base.value, place.value, nonNegative),
        requirements: [...requirements, ...base.requirements, ...index.requirements],
      };
    }
    if (baseNode.datatype.kind === 'VARIANT') {
      // An untyped base is keyed by its value at run time (`OPCODE_SET_KEYED`, gdscript_vm.cpp:988):
      // an Array would store in range, a Dictionary set the key. Analysis left the value untyped,
      // so no one store is known.
      return context.refuse(node, 'an element store into an untyped value, which may be an Array or a Dictionary');
    }
    const requirements = context.structural(node, 'subscript-element', [baseNode, indexNode]);
    const target = element(index.value);
    return {
      beforeAssigned: base.before,
      afterAssigned: index.before,
      target,
      requirements: [...requirements, ...base.requirements, ...index.requirements],
    };
  }
  return context.refuse(node, `${node.kind} is not an assignable target`);
}

/**
 * GDScript's `and`/`or` compile to jumps, not to a Variant operator evaluation
 * (`GDScriptCompiler::_parse_expression`, BINARY_OPERATOR OP_LOGIC_AND/OR), so they never take the
 * binding route that evaluates both operands.
 */
const SHORT_CIRCUIT_OPERATIONS: ReadonlySet<string> = new Set(['OP_LOGIC_AND', 'OP_LOGIC_OR']);

/** The exact operator rule key, then the Variant-evaluation key a binding rule may be keyed by. */
function operatorRuleKeys(node: { readonly operation: string; readonly variantOperatorId: number }) {
  const exact = `operator:${node.operation}:${String(node.variantOperatorId)}`;
  return SHORT_CIRCUIT_OPERATIONS.has(node.operation)
    ? [exact]
    : [exact, 'operator:variant-evaluate'];
}

function builtinTypeName(node: GodotBoundNode): string {
  return node.datatype.kind === 'BUILTIN' ? node.datatype.builtinType : node.datatype.display;
}

/** `Variant::evaluate(op, left, right)` on a built-in left operand, as its binding. */
function operatorBinding(
  context: LoweringContext,
  node: GodotBoundNode & { readonly variantOperatorId: number },
  leftNode: GodotBoundNode,
  rightNode: GodotBoundNode | undefined,
): OfficialBoundBindingUse {
  const member = GODOT_VARIANT_OPERATOR_NAMES[node.variantOperatorId];
  if (member === undefined) {
    return context.refuse(node, `Variant operator ${String(node.variantOperatorId)} is unknown`);
  }
  const variant = leftNode.datatype.kind === 'VARIANT';
  if ((leftNode.datatype.kind !== 'BUILTIN' && !variant) || leftNode.datatype.metaType) {
    return context.refuse(
      node,
      `${member} on a ${leftNode.datatype.display} left operand has no built-in operator binding`,
    );
  }
  const use = context.bindingUse(
    {
      sourceRevision: context.sourceRevision,
      kind: 'builtin-operator',
      // An untyped left operand selects its evaluator at run time: the Variant operator.
      owner: variant ? 'Variant' : leftNode.datatype.builtinType,
      member,
      signature: rightNode === undefined ? 'unary' : `right:${builtinTypeName(rightNode)}`,
    },
    node,
  );
  if (use.target.use.kind !== 'call' || use.target.use.sourceReceiver !== 'absent') {
    return context.refuse(node, `operator binding ${use.target.localName} is not a plain call`);
  }
  return use;
}

/** A call of compat's Object comparison (`object.ts`), negated when the rule says so. */
function objectCall(name: string, args: readonly TargetTsExpression[], negate: boolean, at: ReturnType<typeof span>): TargetTsExpression {
  const call: TargetTsExpression = { kind: 'call-expression', callee: { kind: 'identifier-expression', name }, arguments: [...args], span: at };
  return negate ? { kind: 'unary-expression', operator: '!', operand: call, span: at } : call;
}

function objectImport(name: string): OfficialBoundLoweringRequirement {
  return { kind: 'compat-import-requirement', module: 'lib/godot-compat/object', imported: name, local: name, typeOnly: false };
}

/** A read with no effect: a name, `this`, or a member of one, which may be read again. */
function pureRead(value: TargetTsExpression): boolean {
  switch (value.kind) {
    case 'identifier-expression':
    case 'this-expression':
      return true;
    case 'property-expression':
      return pureRead(value.object);
    case 'as-expression':
    case 'non-null-expression':
    case 'parenthesized-expression':
      return pureRead(value.expression);
    default:
      return false;
  }
}

/**
 * The truth of a value GDScript tests (`if v:`, `while v:`, a ternary's condition, `and`, `or`,
 * `not`): `Variant::booleanize`, read as the truth shape of the value's datatype
 * (`lowering-shapes.ts`) gives it, so `if count:` is `if (count !== 0)` and `not count` is
 * `count === 0`. `negate` gives the falsehood (`not v`), written at `at` when given.
 */
export function lowerTruth(
  context: LoweringContext,
  node: GodotBoundNode,
  lowered: LoweredExpression,
  negate = false,
  at: ReturnType<typeof span> = span(context.script, node),
): LoweredExpression {
  const shape = godotTruthShape(node.datatype);
  if (shape === undefined) return context.refuse(node, `the truth of a ${node.datatype.display} value has no lowering`);
  const compare = (value: TargetTsExpression, operator: TargetTsBinaryOperator, right: TargetTsExpression): TargetTsExpression => ({
    kind: 'binary-expression',
    operator,
    left: value,
    right,
    span: at,
  });
  const zero: TargetTsExpression = { kind: 'literal-expression', value: 0 };
  const differs: TargetTsBinaryOperator = negate ? '===' : '!==';
  const call = (name: string, module: string) =>
    compose(context, [lowered], ([value]) => objectCall(name, [value as TargetTsExpression], negate, at), [
      { kind: 'compat-import-requirement', module, imported: name, local: name, typeOnly: false },
    ]);
  switch (shape.kind) {
    case 'boolean':
      return negate
        ? compose(context, [lowered], ([value]) => ({ kind: 'unary-expression', operator: '!', operand: value as TargetTsExpression, span: at }))
        : lowered;
    case 'object':
      return call('godot_object_truthy', 'lib/godot-compat/object');
    case 'variant':
      return call('godot_variant_truthy', 'lib/godot-compat/variant-truth');
    case 'nonzero':
      return compose(context, [lowered], ([value]) => compare(value as TargetTsExpression, differs, zero));
    case 'nonempty-text':
      return compose(context, [lowered], ([value]) => compare(value as TargetTsExpression, differs, { kind: 'literal-expression', value: '' }));
    case 'nonempty-array':
      return compose(context, [lowered], ([value]) =>
        compare({ kind: 'property-expression', object: value as TargetTsExpression, property: 'length' }, negate ? '===' : '>', zero),
      );
    case 'nonempty-map':
      return compose(context, [lowered], ([value]) =>
        compare({ kind: 'property-expression', object: value as TargetTsExpression, property: 'size' }, negate ? '===' : '>', zero),
      );
    case 'nonzero-members': {
      // The value is read once per member: a name or a member read is read again, anything else
      // once into a local.
      const settled = settle(context, lowered);
      const once = pureRead(settled.value) ? settled : materialize(context, settled);
      const members = shape.members.map((member) => compare({ kind: 'property-expression', object: once.value, property: member }, differs, zero));
      return {
        ...once,
        value: members.reduce((left, right) => ({ kind: 'binary-expression', operator: negate ? '&&' : '||', left, right, span: at })),
      };
    }
    default:
      return shape satisfies never;
  }
}

/**
 * The module-level record of the script's resolved loads (`resource-loads.ts`): each path string
 * any `load(path)` of the script can be, to the resource it names. A file named by one string is
 * loaded in its entry; one named by several is loaded once, as its own module constant the entries
 * share, since Godot's resource cache hands back one resource per file
 * (core/io/resource_loader.cpp:725).
 */
function resourceTable(context: LoweringContext): { readonly local: string; readonly requirements: readonly OfficialBoundLoweringRequirement[] } {
  const local = '$resources';
  const files = new Map<string, { target: OfficialBoundResourceLoadTarget; values: Set<string> }>();
  for (const targets of context.resourceLoads.values()) {
    for (const target of targets) {
      const file = files.get(target.local) ?? { target, values: new Set<string>() };
      for (const value of target.values) file.values.add(value);
      files.set(target.local, file);
    }
  }
  const ordered = [...files.values()].sort((a, b) => (a.target.local < b.target.local ? -1 : a.target.local > b.target.local ? 1 : 0));
  const shared = ordered.filter((file) => file.values.size > 1);
  const types = new Map(ordered.map((file) => [JSON.stringify(file.target.type), file.target.type] as const));
  const valueType: TargetTsType = types.size === 1 ? ([...types.values()][0] as TargetTsType) : { kind: 'union-type', members: [...types.values()] };
  const properties = ordered.flatMap((file) =>
    [...file.values].sort().map((value) => ({
      key: value,
      value: file.values.size > 1 ? ({ kind: 'identifier-expression', name: file.target.local } as const) : file.target.initializer,
    })),
  );
  return {
    local,
    requirements: [
      ...ordered.flatMap((file) => file.target.requirements),
      // (`$load_…` sorts before `$resources`, so a shared file's constant is declared first.)
      ...shared.map((file): OfficialBoundLoweringRequirement => ({ kind: 'module-constant-requirement', local: file.target.local, initializer: file.target.initializer })),
      {
        kind: 'module-constant-requirement',
        local,
        type: { kind: 'type-reference', name: 'Readonly', arguments: [{ kind: 'type-reference', name: 'Record', arguments: [{ kind: 'keyword-type', keyword: 'string' }, valueType] }] },
        initializer: { kind: 'object-expression', properties },
      },
    ],
  };
}

/** Built-in types whose values Godot copies (`lowering-shapes.ts`); Array and Dictionary are shared references. */
function builtinValueType(node: GodotBoundNode): boolean {
  return godotBuiltinCopied(node.datatype);
}

/**
 * Whether `member` on `node` is a native property of its object: the object is native, or a script
 * instance whose script chain declares no such member (a script member is found first,
 * `OPCODE_GET_NAMED`, modules/gdscript/gdscript_vm.cpp:1260).
 */
function nativeMemberReceiver(context: LoweringContext, node: GodotBoundNode, member: string): boolean {
  if (nativeObjectType(node)) return true;
  const datatype = node.datatype;
  if ((datatype.kind !== 'CLASS' && datatype.kind !== 'SCRIPT') || datatype.metaType || datatype.scriptPath === '') return false;
  const members = context.scriptMembers?.(datatype.scriptPath);
  return members !== undefined && !members.has(member) && datatype.nativeType !== '';
}

/**
 * Whether an object read as a member's base is a variable TS types as `T | null`: one that holds
 * null at some time (cleared to null, or initialized with or assigned a value that may be null), as
 * analysis resolved the read to its declaration (`nullable-variables.ts`). A member read or call on null is Godot's runtime error (`OPCODE_GET_NAMED`, `gdscript_vm.cpp:1260`; `OPCODE_CALL`, `:1903`), so the read
 * states the object as present (`value!`) and a null one throws where Godot errs.
 */
function nullableObject(context: LoweringContext, node: GodotBoundNode): boolean {
  const datatype = node.datatype;
  if (datatype.metaType || (datatype.kind !== 'CLASS' && datatype.kind !== 'NATIVE')) return false;
  return context.nullableReads.has(node.id);
}

/**
 * An object value as the native entity compat's native members take (GODOT.md "Receivers are
 * native"): a script instance's entity, or the object itself (`godot_node_entity`).
 */
function nativeEntity(value: LoweredExpression): LoweredExpression {
  return {
    ...value,
    value: {
      kind: 'call-expression',
      callee: { kind: 'identifier-expression', name: 'godot_node_entity' },
      arguments: [value.value],
    },
    requirements: [
      ...value.requirements,
      {
        kind: 'compat-import-requirement',
        module: 'lib/godot-compat/node',
        imported: 'godot_node_entity',
        local: 'godot_node_entity',
        typeOnly: false,
      },
    ],
  };
}

/**
 * A subscript on an AnimationTree (`tree[&"parameters/run/blend_amount"]`): `Object::set`/`get`,
 * which the tree answers from its parameters (`AnimationTree::_set`/`_get`, animation_tree.cpp:1057).
 * The path must be a literal naming a parameter, resolved here to compat's parameter protocol; any
 * other index refuses by name. Undefined for a subscript on another base.
 */
function treeParameter(
  context: LoweringContext,
  node: GodotBoundNode,
): { readonly baseNode: GodotBoundNode; readonly indexNode: GodotBoundNode; readonly path: string } | undefined {
  if (node.kind !== 'SUBSCRIPT' || node.isAttribute) return undefined;
  return treeParameterAt(context, node, context.node(node.base, node), context.node(node.index, node));
}

/**
 * `tree.set(&"parameters/run/blend_amount", v)` and `tree.get(…)`: `Object::set`/`get` by name on an
 * AnimationTree, which the tree answers from its parameters as its subscript does (`treeParameter`).
 * Undefined for another call, or on another receiver.
 */
function treeParameterCall(
  context: LoweringContext,
  node: GodotBoundCallNode,
  calleeNode: GodotBoundNode,
  argumentNodes: readonly GodotBoundNode[],
): { readonly baseNode: GodotBoundNode; readonly indexNode: GodotBoundNode; readonly path: string; readonly write: boolean } | undefined {
  if (node.compilerTarget.kind !== 'native-method' || (node.functionName !== 'set' && node.functionName !== 'get')) return undefined;
  if (calleeNode.kind !== 'SUBSCRIPT' || !calleeNode.isAttribute) return undefined;
  const indexNode = argumentNodes[0];
  if (indexNode === undefined || argumentNodes.length !== (node.functionName === 'set' ? 2 : 1)) return undefined;
  const found = treeParameterAt(context, node, context.node(calleeNode.base, calleeNode), indexNode);
  return found === undefined ? undefined : { ...found, write: node.functionName === 'set' };
}

function treeParameterAt(
  context: LoweringContext,
  node: GodotBoundNode,
  baseNode: GodotBoundNode,
  indexNode: GodotBoundNode,
): { readonly baseNode: GodotBoundNode; readonly indexNode: GodotBoundNode; readonly path: string } | undefined {
  if (baseNode.datatype.kind !== 'NATIVE' || baseNode.datatype.metaType || !godotSubscriptsParameters(baseNode.datatype.nativeType)) return undefined;
  const value = indexNode.kind === 'LITERAL' ? indexNode.value : undefined;
  const path = value?.kind === 'string' || value?.kind === 'string-name' ? value.value : undefined;
  if (path === undefined) return context.refuse(node, 'an AnimationTree subscript whose path is not a literal');
  // A parameter of a node compat transcribes (`animation-tree.ts`'s `parametersOf`).
  if (!/^parameters\/(.+\/)?(blend_amount|scale|backward|current_length|current_position|current_delta)$/u.test(path)) {
    return context.refuse(node, `an AnimationTree subscript of ${path}, which is not a parameter of a transcribed node`);
  }
  // The tree the receiver is in each scene (`scene-node-receiver`): the path is one of its parameters.
  const missing = context.treeParameters?.(baseNode.id).find((tree) => !tree.parameters.has(path));
  if (missing !== undefined) return context.refuse(node, `${path} is not a parameter of the AnimationTree ${missing.at}`);
  return { baseNode, indexNode, path };
}

/**
 * `tween.tween_property(object, "property", …)`: the property Godot reaches through
 * `Object::get_indexed`/`set_indexed` by name (tween.cpp:104, :627, :671), resolved here to the
 * object's native class's getter and setter bindings, which compat's PropertyTweener reads and
 * writes through (`{ get, set }`, `tween.ts`). The path must be a literal naming one native property
 * of a type Tween interpolates; a sub-property (`position:x`), a script's own property or any other
 * type refuses by name.
 */
function tweenedProperty(
  context: LoweringContext,
  node: GodotBoundNode,
  argumentNodes: readonly GodotBoundNode[],
): LoweredExpression {
  const objectNode = argumentNodes[0];
  const pathNode = argumentNodes[1];
  if (objectNode === undefined || pathNode === undefined) return context.refuse(node, 'tween_property without its object and property');
  const value = pathNode.kind === 'LITERAL' ? pathNode.value : undefined;
  // The path as a string, a StringName or a NodePath (`^"light_energy"`).
  const property = value === undefined ? undefined : godotLiteralPathText(value);
  if (property === undefined) return context.refuse(node, 'tween_property of a property only known at run time');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(property)) return context.refuse(node, `tween_property of the sub-property path ${property}`);
  const className =
    objectNode.kind === 'SELF'
      ? context.nativeBase
      : nativeMemberReceiver(context, objectNode, property)
        ? objectNode.datatype.nativeType
        : undefined;
  // An object only the run time knows: the property selected by name then.
  if ((className === undefined || className === '') && namedAttribute(context, objectNode, property)) return namedAccess(context, node, property);
  if (className === undefined || className === '') {
    return context.refuse(node, `tween_property of ${property} on an object whose native class is not fixed (${objectNode.datatype.display})`);
  }
  if (objectNode.kind === 'SELF' && context.scriptMembers?.(objectNode.datatype.scriptPath)?.has(property) === true) {
    return context.refuse(node, `tween_property of the script's own property ${property}`);
  }
  const found = context.nativeProperty(className, property);
  if (found === undefined) return context.refuse(node, `tween_property of ${property}, which ${className} does not declare`);
  if (found.type === undefined || !godotTweenInterpolates(found.type)) {
    return context.refuse(node, `tween_property of ${found.owner}.${property}, a ${found.type ?? 'untyped'} property Tween's interpolation is not transcribed for`);
  }
  const accessor = (method: NativePropertyAccessor | undefined, which: string): OfficialBoundBindingUse => {
    if (method === undefined) return context.refuse(node, `${found.owner}.${property} has no ${which}`);
    const use = context.bindingUse(
      { sourceRevision: context.sourceRevision, kind: 'native-member', owner: method.owner, member: method.name, signature: method.hash === 0 ? 'unhashed' : `hash:${String(method.hash)}` },
      node,
    );
    if (use.target.use.kind !== 'call' || use.target.use.sourceReceiver !== 'first-argument') {
      return context.refuse(node, `accessor binding ${use.target.localName} does not take its receiver first`);
    }
    return use;
  };
  const getter = accessor(found.getter, 'getter');
  const setter = accessor(found.setter, 'setter');
  // An indexed property (`light_energy`, `set_param(PARAM_ENERGY, v)`): its accessors with its index.
  const index = found.index;
  const read: TargetTsExpression =
    index === undefined
      ? boundTargetExpression(getter.target)
      : {
          kind: 'arrow-expression',
          parameters: [{ name: 'object', type: { kind: 'keyword-type', keyword: 'never' } }],
          body: { kind: 'call-expression', callee: boundTargetExpression(getter.target), arguments: [{ kind: 'identifier-expression', name: 'object' }, { kind: 'literal-expression', value: index }] },
        };
  const write: TargetTsExpression =
    index === undefined
      ? boundTargetExpression(setter.target)
      : {
          kind: 'arrow-expression',
          parameters: [
            { name: 'object', type: { kind: 'keyword-type', keyword: 'never' } },
            { name: 'value', type: { kind: 'keyword-type', keyword: 'never' } },
          ],
          body: {
            kind: 'call-expression',
            callee: boundTargetExpression(setter.target),
            arguments: [{ kind: 'identifier-expression', name: 'object' }, { kind: 'literal-expression', value: index }, { kind: 'identifier-expression', name: 'value' }],
          },
        };
  return expression(
    {
      kind: 'object-expression',
      properties: [
        { key: 'get', value: read },
        { key: 'set', value: write },
      ],
      span: span(context.script, node),
    },
    [...getter.requirements, ...setter.requirements],
  );
}

/** Compat's tree parameter protocol (`animation-tree.ts`): its import. */
function treeProtocol(name: string): OfficialBoundLoweringRequirement {
  return { kind: 'compat-import-requirement', module: 'lib/godot-compat/animation-tree', imported: name, local: name, typeOnly: false };
}

function nativeObjectType(node: GodotBoundNode): boolean {
  return node.datatype.kind === 'NATIVE' && !node.datatype.metaType;
}

/** A property's accessor on a native class, as the ordinary method binding it is. */
function nativeAccessorUse(
  context: LoweringContext,
  node: GodotBoundNode,
  baseNode: GodotBoundNode,
  property: string,
  accessor: 'getter' | 'setter',
): OfficialBoundBindingUse | undefined {
  const found = context.nativeProperty(baseNode.datatype.nativeType, property);
  if (found === undefined) return undefined;
  const method = found[accessor];
  if (method === undefined) {
    return context.refuse(node, `${found.owner}.${property} has no ${accessor}`);
  }
  const use = context.bindingUse(
    {
      sourceRevision: context.sourceRevision,
      kind: 'native-member',
      owner: method.owner,
      member: method.name,
      signature: method.hash === 0 ? 'unhashed' : `hash:${String(method.hash)}`,
    },
    node,
  );
  if (use.target.use.kind !== 'call' || use.target.use.sourceReceiver !== 'first-argument') {
    return context.refuse(node, `accessor binding ${use.target.localName} does not take its receiver first`);
  }
  // An indexed property (`ADD_PROPERTYI`: `light_energy` is `set_param(PARAM_ENERGY, …)`) passes
  // its index before the value (`Object::set` → `ClassDB::set_property`, core/object/class_db.cpp:1569).
  return found.index === undefined ? use : { ...use, index: found.index };
}

/**
 * The script instance's own native entity, the receiver a native binding takes for `self`
 * (godot-compat receivers are native, GODOT.md "Receivers are native"); the generated class holds
 * it as `$native`.
 */
function selfNative(context: LoweringContext, node: GodotBoundNode): TargetTsExpression {
  return {
    kind: 'property-expression',
    object: { kind: 'this-expression' },
    property: '$native',
    span: span(context.script, node),
  };
}

/** A native property accessor of the script's own native base class. */
function selfNativeAccessor(
  context: LoweringContext,
  node: GodotBoundNode,
  property: string,
  accessor: 'getter' | 'setter',
): OfficialBoundBindingUse | undefined {
  const base = context.nativeBase;
  if (base === undefined) return undefined;
  const found = context.nativeProperty(base, property);
  if (found === undefined) return undefined;
  const method = found[accessor];
  if (method === undefined) return context.refuse(node, `${found.owner}.${property} has no ${accessor}`);
  const use = context.bindingUse(
    {
      sourceRevision: context.sourceRevision,
      kind: 'native-member',
      owner: method.owner,
      member: method.name,
      signature: method.hash === 0 ? 'unhashed' : `hash:${String(method.hash)}`,
    },
    node,
  );
  if (use.target.use.kind !== 'call' || use.target.use.sourceReceiver !== 'first-argument') {
    return context.refuse(node, `accessor binding ${use.target.localName} does not take its receiver first`);
  }
  // An indexed property (`ADD_PROPERTYI`: `light_energy` is `set_param(PARAM_ENERGY, …)`) passes
  // its index before the value (`Object::set` → `ClassDB::set_property`, core/object/class_db.cpp:1569).
  return found.index === undefined ? use : { ...use, index: found.index };
}

function bindingCall(
  context: LoweringContext,
  node: GodotBoundNode,
  use: OfficialBoundBindingUse & { readonly index?: number },
  args: readonly TargetTsExpression[],
): TargetTsExpression {
  return {
    kind: 'call-expression',
    callee: boundTargetExpression(use.target),
    arguments:
      use.index === undefined
        ? args
        : [args[0] as TargetTsExpression, { kind: 'literal-expression', value: use.index }, ...args.slice(1)],
    span: span(context.script, node),
  };
}

/**
 * A Dictionary's element `d[k]`: keyed Variant access (`Variant::get` / `Variant::set` with a key,
 * core/variant/variant_setget.cpp), which compat's `Dictionary.get` and `Dictionary.set` are.
 */
function dictionaryElement(
  context: LoweringContext,
  node: GodotBoundNode,
): KeyedElement | undefined {
  if (node.kind !== 'SUBSCRIPT' || node.isAttribute) return undefined;
  const baseNode = context.node(node.base, node);
  const shape = godotBuiltinSubscriptShape(baseNode.datatype);
  if (shape?.kind !== 'keyed-entry') return undefined;
  return { baseNode, indexNode: context.node(node.index, node), shape };
}

type KeyedShape = Extract<GodotBuiltinSubscriptShape, { readonly kind: 'keyed-entry' }>;

interface KeyedElement {
  readonly baseNode: GodotBoundNode;
  readonly indexNode: GodotBoundNode;
  readonly shape: KeyedShape;
}

/** A keyed container's getter or setter method binding (`Dictionary.get` / `Dictionary.set`). */
function dictionaryMethod(context: LoweringContext, node: GodotBoundNode, shape: KeyedShape, access: 'getter' | 'setter'): OfficialBoundBindingUse {
  const member = shape[access];
  const method = context.nativeMethod(shape.owner, member);
  if (method === undefined) return context.refuse(node, `the API dump has no ${shape.owner}.${member}`);
  const use = context.bindingUse(
    {
      sourceRevision: context.sourceRevision,
      kind: 'builtin-member',
      owner: shape.owner,
      member,
      signature: method.hash === 0 ? 'unhashed' : `hash:${String(method.hash)}`,
    },
    node,
  );
  if (use.target.use.kind !== 'call' || use.target.use.sourceReceiver !== 'first-argument') {
    return context.refuse(node, `binding ${use.target.localName} does not take its receiver first`);
  }
  return use;
}

/** A Dictionary element as a place: read through `Dictionary.get`, written through `Dictionary.set`. */
function dictionaryPlace(
  context: LoweringContext,
  node: GodotBoundNode,
  element: KeyedElement,
  lower: (context: LoweringContext, node: GodotBoundNode) => LoweredExpression,
): AssignablePlace {
  const rule = context.selectRule(node, ['subscript-element:dictionary'], [element.baseNode, element.indexNode], ['binding']);
  const getter = dictionaryMethod(context, node, element.shape, 'getter');
  const setter = dictionaryMethod(context, node, element.shape, 'setter');
  const object = storeBase(context, element.baseNode, lower(context, element.baseNode));
  const key = materialize(context, lower(context, element.indexNode));
  return {
    before: object.before,
    afterAssigned: key.before,
    read: bindingCall(context, node, getter, [object.value, key.value]),
    write: (value) => bindingCall(context, node, setter, [object.value, key.value, value]),
    requirements: [...rule.requirements, ...object.requirements, ...key.requirements, ...getter.requirements, ...setter.requirements],
  };
}

/** An element of an untyped value (`v[k]`), keyed at run time by what `v` holds (`variant-index.ts`). */
function variantElement(context: LoweringContext, node: GodotBoundNode): Omit<KeyedElement, 'shape'> | undefined {
  if (node.kind !== 'SUBSCRIPT' || node.isAttribute) return undefined;
  const baseNode = context.node(node.base, node);
  if (baseNode.datatype.kind !== 'VARIANT') return undefined;
  return { baseNode, indexNode: context.node(node.index, node) };
}

function variantIndexCall(name: 'godot_variant_get' | 'godot_variant_set', args: readonly TargetTsExpression[], at?: ReturnType<typeof span>): TargetTsExpression {
  return { kind: 'call-expression', callee: { kind: 'identifier-expression', name }, arguments: [...args], ...(at === undefined ? {} : { span: at }) };
}

function variantIndexImport(name: 'godot_variant_get' | 'godot_variant_set'): OfficialBoundLoweringRequirement {
  return { kind: 'compat-import-requirement', module: 'lib/godot-compat/variant-index', imported: name, local: name, typeOnly: false };
}

/** An untyped value's element as a place: read and stored through compat's keyed access. */
function variantElementPlace(
  context: LoweringContext,
  node: GodotBoundNode,
  element: Omit<KeyedElement, 'shape'>,
  lower: (context: LoweringContext, node: GodotBoundNode) => LoweredExpression,
): AssignablePlace {
  const rule = context.structural(node, 'subscript-element', [element.baseNode, element.indexNode], 'subscript-element:variant');
  const object = materialize(context, lower(context, element.baseNode));
  const key = materialize(context, lower(context, element.indexNode));
  const at = span(context.script, node);
  return {
    before: object.before,
    afterAssigned: key.before,
    read: variantIndexCall('godot_variant_get', [object.value, key.value], at),
    write: (value) => variantIndexCall('godot_variant_set', [object.value, key.value, value], at),
    requirements: [...rule, ...object.requirements, ...key.requirements, variantIndexImport('godot_variant_get'), variantIndexImport('godot_variant_set')],
  };
}

const ANY: TargetTsType = { kind: 'keyword-type', keyword: 'any' };

function namedImport(name: string): OfficialBoundLoweringRequirement {
  return { kind: 'compat-import-requirement', module: 'lib/godot-compat/variant-named', imported: name, local: name, typeOnly: false };
}

/**
 * The engine members a name can select on an untyped value at run time, as the array compat's
 * `variant-named.ts` tries in turn: each class's or built-in type's accessor or method that compat
 * binds, wrapped where the binding takes more than the call's own arguments (an indexed property's
 * index, a tween's creator, a tweened property's accessors). `arity` is the call's argument count.
 */
function namedMembers(
  context: LoweringContext,
  node: GodotBoundNode,
  name: string,
  use: 'get' | 'set' | 'call',
  argumentNodes: readonly GodotBoundNode[] = [],
): LoweredExpression {
  const elements: TargetTsExpression[] = [];
  const requirements: OfficialBoundLoweringRequirement[] = [];
  const parameter = (parameterName: string): TargetTsParameter => ({ name: parameterName, type: ANY });
  const id = (identifier: string): TargetTsExpression => ({ kind: 'identifier-expression', name: identifier });
  for (const candidate of context.namedMembers(name, use)) {
    const symbol: GodotOfficialSymbolIdentity = { sourceRevision: context.sourceRevision, ...candidate.symbol };
    const target = context.bindings.resolve(symbol);
    if (target.kind === 'refusal-binding' || target.use.kind !== 'call' || target.use.sourceReceiver !== 'first-argument') continue;
    const shape = candidate.symbol.kind === 'native-member' && use === 'call' ? godotCallShape(candidate.owner, name) : undefined;
    if (shape === 'script-chain-method') {
      const argument = argumentNodes[0];
      const method = argument?.kind === 'LITERAL' && (argument.value.kind === 'string' || argument.value.kind === 'string-name') ? argument.value.value : undefined;
      if (method === undefined || context.nativeMethod('*', method) !== undefined) continue;
    }
    const bound = boundTargetExpression(target);
    const args = argumentNodes.map((_, index) => `a${String(index)}`);
    let value: TargetTsExpression = bound;
    if (candidate.index !== undefined) {
      const index: TargetTsExpression = { kind: 'literal-expression', value: candidate.index };
      value =
        use === 'get'
          ? { kind: 'arrow-expression', parameters: [parameter('self')], body: { kind: 'call-expression', callee: bound, arguments: [id('self'), index] } }
          : { kind: 'arrow-expression', parameters: [parameter('self'), parameter('value')], body: { kind: 'call-expression', callee: bound, arguments: [id('self'), index, id('value')] } };
    } else if (shape === 'creator-owned') {
      value = { kind: 'arrow-expression', parameters: [parameter('self'), ...args.map(parameter)], body: { kind: 'call-expression', callee: bound, arguments: [id('self'), { kind: 'this-expression' }, ...args.map(id)] } };
    } else if (shape === 'tweened-property') {
      const pathNode = argumentNodes[1];
      const property = pathNode?.kind === 'LITERAL' && (pathNode.value.kind === 'string' || pathNode.value.kind === 'string-name') ? pathNode.value.value : undefined;
      if (property === undefined) continue;
      const access = namedAccess(context, node, property);
      requirements.push(...access.requirements);
      value = { kind: 'arrow-expression', parameters: [parameter('self'), ...args.map(parameter)], body: { kind: 'call-expression', callee: bound, arguments: [id('self'), ...args.map(id), access.value] } };
    }
    // A built-in type's member applies to the values compat recognises as that type.
    let test: TargetTsExpression | undefined;
    if (candidate.builtin) {
      const shape = godotBuiltinTest(candidate.owner);
      if (shape === undefined) continue;
      requirements.push(namedImport(shape.exportName));
      test =
        shape.members === undefined
          ? id(shape.exportName)
          : {
              kind: 'arrow-expression',
              parameters: [parameter('value')],
              body: {
                kind: 'call-expression',
                callee: id(shape.exportName),
                arguments: [id('value'), { kind: 'literal-expression', value: shape.members }, ...(shape.nested === true ? [{ kind: 'literal-expression' as const, value: true }] : [])],
              },
            };
    }
    requirements.push(...context.bindingUse(symbol, node).requirements);
    elements.push({
      kind: 'object-expression',
      properties: [{ key: 'owner', value: { kind: 'literal-expression', value: candidate.owner } }, ...(test === undefined ? [] : [{ key: 'is', value: test }]), { key: use, value }],
    });
  }
  return expression({ kind: 'array-expression', elements }, requirements);
}

/** A property's accessors on a value only known at run time, as a tweener reads and writes it. */
function namedAccess(context: LoweringContext, node: GodotBoundNode, property: string): LoweredExpression {
  const getters = namedMembers(context, node, property, 'get');
  const setters = namedMembers(context, node, property, 'set');
  const name: TargetTsExpression = { kind: 'literal-expression', value: property };
  const object: TargetTsParameter = { name: 'object', type: ANY };
  return expression(
    {
      kind: 'object-expression',
      properties: [
        { key: 'get', value: { kind: 'arrow-expression', parameters: [object], body: { kind: 'call-expression', callee: { kind: 'identifier-expression', name: 'godot_variant_get_named' }, arguments: [{ kind: 'identifier-expression', name: 'object' }, name, getters.value] } } },
        {
          key: 'set',
          value: {
            kind: 'arrow-expression',
            parameters: [object, { name: 'value', type: ANY }],
            body: { kind: 'call-expression', callee: { kind: 'identifier-expression', name: 'godot_variant_set_named' }, arguments: [{ kind: 'identifier-expression', name: 'object' }, name, { kind: 'identifier-expression', name: 'value' }, setters.value] },
          },
        },
      ],
    },
    [...getters.requirements, ...setters.requirements, namedImport('godot_variant_get_named'), namedImport('godot_variant_set_named')],
  );
}

/**
 * Whether `base.name` is selected at run time: the base is untyped, or a native object whose
 * declared class has no such property or signal (a subclass may: `Object::get` asks the object's
 * own class, `object.cpp:333`).
 */
function namedAttribute(context: LoweringContext, baseNode: GodotBoundNode, name: string): boolean {
  if (baseNode.kind === 'IDENTIFIER' && (baseNode.source === 'NATIVE_CLASS' || baseNode.datatype.metaType)) return false;
  if (baseNode.datatype.kind === 'VARIANT') return godotBuiltinSubscriptShape(baseNode.datatype) === undefined;
  if (!nativeMemberReceiver(context, baseNode, name)) return false;
  const className = baseNode.datatype.nativeType;
  return context.nativeProperty(className, name) === undefined && context.nativeSignalOwner?.(className, name) === undefined;
}

/** Whether a store's target is a member selected by name at run time (`namedPlace`). */
function namedTarget(context: LoweringContext, node: GodotBoundNode): boolean {
  if (node.kind !== 'SUBSCRIPT' || !node.isAttribute) return false;
  return namedAttribute(context, context.node(node.base, node), officialBoundPropertyName(context, node.attribute, node));
}

/** `base.name` read on a value only known at run time (`godot_variant_get_named`). */
function namedRead(
  context: LoweringContext,
  node: GodotBoundNode,
  baseNode: GodotBoundNode,
  name: string,
  lower: (context: LoweringContext, node: GodotBoundNode) => LoweredExpression,
): LoweredExpression {
  const members = namedMembers(context, node, name, 'get');
  return compose(
    context,
    [lower(context, baseNode)],
    ([object]) => ({
      kind: 'call-expression',
      callee: { kind: 'identifier-expression', name: 'godot_variant_get_named' },
      arguments: [object as TargetTsExpression, { kind: 'literal-expression', value: name }, members.value],
      span: span(context.script, node),
    }),
    [...members.requirements, namedImport('godot_variant_get_named')],
  );
}

/**
 * `base.name` as a place on a value only known at run time: read by name, and stored by name with
 * the base written back where it came from when the base is a place (a built-in record the store
 * copies), else stored on the object alone.
 */
function namedPlace(
  context: LoweringContext,
  node: GodotBoundNode,
  baseNode: GodotBoundNode,
  name: string,
  lower: (context: LoweringContext, node: GodotBoundNode) => LoweredExpression,
  needsRead: boolean,
): AssignablePlace {
  const getters = needsRead ? namedMembers(context, node, name, 'get') : undefined;
  const setters = namedMembers(context, node, name, 'set');
  const at = span(context.script, node);
  const key: TargetTsExpression = { kind: 'literal-expression', value: name };
  const placed = baseNode.kind === 'IDENTIFIER' ? baseNode.source === 'LOCAL_VARIABLE' || baseNode.source === 'MEMBER_VARIABLE' || baseNode.source === 'FUNCTION_PARAMETER' : baseNode.kind === 'SUBSCRIPT';
  const base = placed ? assignablePlace(context, baseNode, lower) : undefined;
  const object = base === undefined ? materialize(context, lower(context, baseNode)) : undefined;
  const value = base?.read ?? (object as LoweredExpression).value;
  const store = (assigned: TargetTsExpression): TargetTsExpression => ({
    kind: 'call-expression',
    callee: { kind: 'identifier-expression', name: 'godot_variant_set_named' },
    arguments: [value, key, assigned, setters.value],
    span: at,
  });
  return {
    before: base?.before ?? (object as LoweredExpression).before,
    afterAssigned: base?.afterAssigned ?? [],
    read:
      getters === undefined
        ? { kind: 'undefined-expression' }
        : { kind: 'call-expression', callee: { kind: 'identifier-expression', name: 'godot_variant_get_named' }, arguments: [value, key, getters.value], span: at },
    // The store gives the base back (a copy for a record), which its own place takes.
    write: (assigned) => (base === undefined ? store(assigned) : base.write(store(assigned))),
    requirements: [
      ...(base?.requirements ?? (object as LoweredExpression).requirements),
      ...(getters?.requirements ?? []),
      ...setters.requirements,
      namedImport('godot_variant_get_named'),
      namedImport('godot_variant_set_named'),
    ],
  };
}

/** A compat protocol import of `lib/godot-compat/<module>`. */
function compatImport(module: string, name: string): OfficialBoundLoweringRequirement {
  return { kind: 'compat-import-requirement', module: `lib/godot-compat/${module}`, imported: name, local: name, typeOnly: false };
}

/** The members of a record value a resource document stores, by its built-in type. */
const DOCUMENT_RECORDS: Readonly<Record<string, readonly string[]>> = {
  Vector2: ['x', 'y'],
  Vector2i: ['x', 'y'],
  Vector3: ['x', 'y', 'z'],
  Vector3i: ['x', 'y', 'z'],
  Vector4: ['x', 'y', 'z', 'w'],
  Color: ['r', 'g', 'b', 'a'],
  Quaternion: ['x', 'y', 'z', 'w'],
};

/**
 * A project resource document's resource as code that makes it, as the loader reads the file:
 * each value as the Variant it is, a sub-resource or a script resource made in turn
 * (`godot_script_resource_new`); a resource of any other kind is refused.
 */
function documentResource(
  context: LoweringContext,
  node: GodotBoundNode,
  document: BoundGodotResourceDocument,
  data: BoundGodotResourceDocument['resource'],
  requirements: OfficialBoundLoweringRequirement[],
  path: string | undefined,
): TargetTsExpression {
  const valueOf = (value: GodotValue): TargetTsExpression => {
    // A number, a boolean or text: the value itself.
    if ('value' in value && typeof value.value !== 'object') return { kind: 'literal-expression', value: value.value };
    switch (value.kind) {
      case 'null':
        return { kind: 'literal-expression', value: null };
      case 'array':
        return { kind: 'array-expression', elements: value.items.map(valueOf) };
      case 'ctor': {
        if (value.name === 'SubResource' || value.name === 'ExtResource') {
          const id = String((value.args[0] as { readonly value?: unknown } | undefined)?.value ?? '');
          if (value.name === 'SubResource') {
            const sub = document.subResources.find((entry) => String(entry.id) === id);
            if (sub === undefined) return context.refuse(node, `${document.resPath}: SubResource ${id} is not declared`);
            return documentResource(context, node, document, sub, requirements, undefined);
          }
          const ext = document.extResources.find((entry) => String(entry.id) === id);
          const nested = ext === undefined ? undefined : context.resourceDocument(ext.resPath);
          if (nested === undefined) return context.refuse(node, `${document.resPath}: ExtResource ${id} is not a resource document the project has`);
          return documentResource(context, node, nested, nested.resource, requirements, nested.resPath);
        }
        const members = DOCUMENT_RECORDS[value.name];
        if (members === undefined || value.args.some((arg) => arg.kind !== 'number')) return context.refuse(node, `${document.resPath}: a ${value.name} value is not transcribed`);
        return {
          kind: 'call-expression',
          callee: { kind: 'property-expression', object: { kind: 'identifier-expression', name: 'Object' }, property: 'freeze' },
          arguments: [{ kind: 'object-expression', properties: members.map((member, index) => ({ key: member, value: { kind: 'literal-expression', value: (value.args[index] as { readonly value: number } | undefined)?.value ?? 1 } })) }],
        };
      }
      default:
        return context.refuse(node, `${document.resPath}: a ${value.kind} value is not transcribed`);
    }
  };
  const script = data.properties['script'];
  const scriptId = script?.kind === 'ctor' && script.name === 'ExtResource' ? String((script.args[0] as { readonly value?: unknown } | undefined)?.value ?? '') : undefined;
  const scriptPath = scriptId === undefined ? undefined : document.extResources.find((entry) => String(entry.id) === scriptId)?.resPath;
  const found = scriptPath === undefined ? undefined : context.scriptClass?.(scriptPath);
  if (found === undefined) return context.refuse(node, `${document.resPath}: a ${data.type} without a project script is not made in code`);
  if (found.module !== undefined) requirements.push({ kind: 'project-import-requirement', module: found.module, imported: found.name, local: found.name, typeOnly: false });
  requirements.push(compatImport('resource', 'godot_script_resource_new'));
  const fields = Object.entries(data.properties).filter(([name]) => name !== 'script' && name !== 'resource_name' && !name.startsWith('metadata/'));
  return {
    kind: 'call-expression',
    callee: { kind: 'identifier-expression', name: 'godot_script_resource_new' },
    arguments: [
      { kind: 'identifier-expression', name: found.name },
      { kind: 'object-expression', properties: fields.map(([name, value]) => ({ key: name, value: valueOf(value) })) },
      ...(path === undefined ? [] : [{ kind: 'literal-expression' as const, value: path }]),
    ],
  };
}

/**
 * `ResourceLoader.load(path)` and `ResourceSaver.save(resource, path)` through compat's resource
 * protocol: a load's project resources (the one its literal path names, else every resource
 * document with a script) made by code, and the project's script resource classes by path.
 */
function resourceCall(
  context: LoweringContext,
  node: GodotBoundCallNode,
  shape: 'resource-load' | 'resource-save',
  argumentNodes: readonly GodotBoundNode[],
  lowered: readonly LoweredExpression[],
  requirements: readonly OfficialBoundLoweringRequirement[],
): LoweredExpression {
  const own: OfficialBoundLoweringRequirement[] = [];
  const classes: TargetTsExpression = {
    kind: 'object-expression',
    properties: context.resourceScripts.flatMap((resPath) => {
      const found = context.scriptClass?.(resPath);
      if (found === undefined) return [];
      if (found.module !== undefined) own.push({ kind: 'project-import-requirement', module: found.module, imported: found.name, local: found.name, typeOnly: false });
      return [{ key: resPath, value: { kind: 'identifier-expression' as const, name: found.name } }];
    }),
  };
  if (shape === 'resource-save') {
    own.push(compatImport('resource-loader', 'godot_resource_saver_save'));
    return compose(
      context,
      lowered.slice(0, 2),
      ([resource, path]) => ({ kind: 'call-expression', callee: { kind: 'identifier-expression', name: 'godot_resource_saver_save' }, arguments: [resource as TargetTsExpression, path as TargetTsExpression, classes], span: span(context.script, node) }),
      [...requirements, ...own],
    );
  }
  const pathNode = argumentNodes[0];
  const literal = pathNode?.kind === 'LITERAL' && (pathNode.value.kind === 'string' || pathNode.value.kind === 'string-name') ? pathNode.value.value : undefined;
  const paths = literal !== undefined ? (literal.startsWith('res://') ? [literal] : []) : [];
  const project: TargetTsExpression = {
    kind: 'object-expression',
    properties: paths.map((resPath) => {
      const document = context.resourceDocument(resPath);
      const value: TargetTsExpression = document === undefined ? { kind: 'literal-expression', value: null } : documentResource(context, node, document, document.resource, own, resPath);
      return { key: resPath, value: { kind: 'arrow-expression' as const, parameters: [], body: value } };
    }),
  };
  own.push(compatImport('resource-loader', 'godot_resource_loader_load'), compatImport('resource', 'godot_script_resource_new'));
  return compose(
    context,
    lowered.slice(0, 1),
    ([path]) => ({
      kind: 'call-expression',
      callee: { kind: 'identifier-expression', name: 'godot_resource_loader_load' },
      arguments: [path as TargetTsExpression, project, classes, { kind: 'identifier-expression', name: 'godot_script_resource_new' }],
      span: span(context.script, node),
    }),
    [...requirements, ...own],
  );
}

/** `Script.new(...)`: `godot_script_new` over the native root class's constructor. */
function scriptNew(
  context: LoweringContext,
  node: GodotBoundCallNode,
  resPath: string,
  lowered: readonly LoweredExpression[],
  requirements: readonly OfficialBoundLoweringRequirement[],
): LoweredExpression {
  const found = context.scriptClass?.(resPath);
  if (found === undefined) return context.refuse(node, `${resPath} names no generated script class`);
  const root = context.scriptNativeRoot(resPath);
  if (root === undefined) return context.refuse(node, `${resPath} has no native class at the root of its chain`);
  const construct = context.bindingUse({ sourceRevision: context.sourceRevision, kind: 'native-class', owner: root, member: root, signature: 'GDScriptNativeClass' }, node);
  return compose(
    context,
    lowered,
    (values) => ({
      kind: 'call-expression',
      callee: { kind: 'identifier-expression', name: 'godot_script_new' },
      arguments: [
        { kind: 'identifier-expression', name: found.name },
        { kind: 'call-expression', callee: boundTargetExpression(construct.target), arguments: [] },
        { kind: 'array-expression', elements: [...values] },
      ],
      span: span(context.script, node),
    }),
    [
      ...requirements,
      ...construct.requirements,
      { kind: 'compat-import-requirement', module: 'lib/godot-compat/node', imported: 'godot_script_new', local: 'godot_script_new', typeOnly: false },
      ...(found.module === undefined ? [] : [{ kind: 'project-import-requirement' as const, module: found.module, imported: found.name, local: found.name, typeOnly: false }]),
    ],
  );
}

/** `base.name(...)` on a value only known at run time (`godot_variant_call_named`). */
function namedCall(
  context: LoweringContext,
  node: GodotBoundCallNode,
  baseNode: GodotBoundNode,
  argumentNodes: readonly GodotBoundNode[],
  lowered: readonly LoweredExpression[],
  requirements: readonly OfficialBoundLoweringRequirement[],
  lower: (context: LoweringContext, node: GodotBoundNode) => LoweredExpression,
): LoweredExpression {
  const members = namedMembers(context, node, node.functionName, 'call', argumentNodes);
  return compose(
    context,
    [lower(context, baseNode), ...lowered],
    ([object, ...values]) => ({
      kind: 'call-expression',
      callee: { kind: 'identifier-expression', name: 'godot_variant_call_named' },
      arguments: [object as TargetTsExpression, { kind: 'literal-expression', value: node.functionName }, members.value, { kind: 'array-expression', elements: values as TargetTsExpression[] }],
      span: span(context.script, node),
    }),
    [...requirements, ...members.requirements, namedImport('godot_variant_call_named')],
  );
}

/**
 * An element of a built-in array Godot copies (a PackedStringArray; `lowering-shapes.ts`). Its
 * value is copy-on-write (`Vector<T>`, core/templates/vector.h): `a[i] = e` writes the variable's
 * own copy (`Variant::set_indexed` on the variable's slot, and the assign chain sets a copied base
 * back up through its owners, `GDScriptCompiler::_parse_assignment`), so the store is a new array
 * written back to `a`'s place, as a built-in's member write is.
 */
function valueElement(context: LoweringContext, node: GodotBoundNode): Omit<KeyedElement, 'shape'> | undefined {
  if (node.kind !== 'SUBSCRIPT' || node.isAttribute) return undefined;
  const baseNode = context.node(node.base, node);
  if (godotBuiltinSubscriptShape(baseNode.datatype)?.kind !== 'array-element' || !builtinValueType(baseNode)) return undefined;
  return { baseNode, indexNode: context.node(node.index, node) };
}

/** A copied array's element as a place: read as Variant indexing, written back through `with_indexed`. */
function valueElementPlace(
  context: LoweringContext,
  node: GodotBoundNode,
  element: Omit<KeyedElement, 'shape'>,
  lower: (context: LoweringContext, node: GodotBoundNode) => LoweredExpression,
): AssignablePlace {
  const { baseNode, indexNode } = element;
  const base = assignablePlace(context, baseNode, lower);
  const rule = context.structural(node, 'subscript-element', [baseNode, indexNode], 'subscript-element:array');
  const setUse = context.bindingUse(
    {
      sourceRevision: context.sourceRevision,
      kind: 'builtin-indexed-set',
      owner: baseNode.datatype.builtinType,
      member: 'set_indexed',
      signature: 'set',
    },
    node,
  );
  if (setUse.target.use.kind !== 'call' || setUse.target.use.sourceReceiver !== 'first-argument') {
    return context.refuse(node, `element write ${setUse.target.localName} does not take the array first`);
  }
  const current = placeBase(context, baseNode, base);
  const index = materialize(context, lower(context, indexNode));
  const constant = indexNode.kind === 'LITERAL' && indexNode.value.kind === 'int' && Number(indexNode.value.value) >= 0;
  // A compound store reads the element first; `with_indexed` drops the store where it is absent.
  const read: TargetTsExpression = {
    kind: 'non-null-expression',
    expression: constant
      ? { kind: 'element-expression', object: current.value, index: index.value, span: span(context.script, node) }
      : { kind: 'call-expression', callee: { kind: 'property-expression', object: current.value, property: 'at' }, arguments: [index.value], span: span(context.script, node) },
  };
  return {
    before: current.before,
    afterAssigned: index.before,
    read,
    write: (value) => base.write(bindingCall(context, node, setUse, [current.value, index.value, value])),
    requirements: [...base.requirements, ...rule, ...index.requirements, ...setUse.requirements],
  };
}

/** Whether a value lowers to a read of an Array element (`a[i]`, `a.at(i)`), which TS types loosely. */
function arrayElementRead(value: TargetTsExpression): boolean {
  if (value.kind === 'element-expression') return true;
  return value.kind === 'call-expression' && value.callee.kind === 'property-expression' && value.callee.property === 'at';
}

/**
 * An assignable place. Godot writes a member of a built-in value by writing the whole value back
 * (`v.x = e` is `v = v with x`), through a native property by its setter, and evaluates the base
 * chain once, before the assigned value, then the value, then the final key
 * (`GDScriptCompiler::_parse_assignment`, gdscript_compiler.cpp:1124 and :1133).
 */
interface AssignablePlace {
  /** The base chain, evaluated before the assigned value. */
  readonly before: readonly TargetTsStatement[];
  /** The final key, evaluated after the assigned value and before the store. */
  readonly afterAssigned: readonly TargetTsStatement[];
  readonly read: TargetTsExpression;
  readonly write: (value: TargetTsExpression) => TargetTsExpression;
  readonly requirements: readonly OfficialBoundLoweringRequirement[];
}

/**
 * Whether a base is a slot Godot stores into directly: a local, a parameter, or a script member
 * (lowering refuses a member with accessors). Godot takes such a base's address, not a copy
 * (`_parse_assignment`; only a member with a setter, or a static variable, is copied to a
 * temporary), so the store reads it after the value and sees a value that reassigned it. A script
 * parent's member is a `MEMBER_VARIABLE` too (the analyzer's `reduce_identifier_from_base` walks
 * the script's base classes), stored through its `member_indices` address as the script's own;
 * `INHERITED_VARIABLE` is only the native base's property, method or signal, whose property
 * is written through its setter (`inheritedNativePlace`). Any other base is copied before the value.
 */
function slotBase(node: GodotBoundNode): boolean {
  return (
    node.kind === 'IDENTIFIER' &&
    (node.source === 'LOCAL_VARIABLE' ||
      node.source === 'FUNCTION_PARAMETER' ||
      node.source === 'LOCAL_ITERATOR' ||
      node.source === 'LOCAL_BIND' ||
      node.source === 'MEMBER_VARIABLE')
  );
}

/** A store's base value: a slot read where the store writes, anything else copied before the value. */
function storeBase(context: LoweringContext, node: GodotBoundNode, plan: LoweredExpression): LoweredExpression {
  const inline = plan.before.length === 0 && plan.after.length === 0 && (plan.value.kind === 'identifier-expression' || plan.value.kind === 'property-expression');
  return inline && slotBase(node) ? plan : materialize(context, plan);
}

/**
 * The value a written-back place's base holds, with the base chain before it: the base's own final
 * key belongs to the chain, so it is evaluated before the assigned value too.
 */
function placeBase(context: LoweringContext, node: GodotBoundNode, base: AssignablePlace): LoweredExpression {
  const chain = [...base.before, ...base.afterAssigned];
  if (base.read.kind === 'identifier-expression' || (chain.length === 0 && slotBase(node))) {
    return { before: chain, value: base.read, after: [], requirements: [] };
  }
  const copied = materialize(context, expression(base.read));
  return { ...copied, before: [...chain, ...copied.before] };
}

function valueAttributeTarget(
  context: LoweringContext,
  node: GodotBoundNode,
): { readonly baseNode: GodotBoundNode; readonly attribute: string } | undefined {
  if (node.kind !== 'SUBSCRIPT' || !node.isAttribute) return undefined;
  const baseNode = context.node(node.base, node);
  const attribute = officialBoundPropertyName(context, node.attribute, node);
  // An engine singleton's property (`Input.mouse_mode`) is written through its accessors.
  const singleton = baseNode.kind === 'IDENTIFIER' && baseNode.source === 'NATIVE_CLASS' && context.nativeProperty(baseNode.name, attribute) !== undefined;
  if (!singleton && !builtinValueType(baseNode) && !nativeMemberReceiver(context, baseNode, attribute)) return undefined;
  return { baseNode, attribute };
}

function assignablePlace(
  context: LoweringContext,
  node: GodotBoundNode,
  lower: (context: LoweringContext, node: GodotBoundNode) => LoweredExpression,
  // Whether the place's old value is read: by a compound write, or as the base of a member write.
  // A plain `obj.prop = v` only sets (`SET_NAMED`), so its getter is not called.
  needsRead = true,
): AssignablePlace {
  const parameter = treeParameter(context, node);
  if (parameter !== undefined) {
    const rule = context.selectRule(node, ['subscript-element:tree-parameter'], [parameter.baseNode, parameter.indexNode], ['binding'], false);
    const object = materialize(context, nativeEntity(lower(context, parameter.baseNode)));
    const name: TargetTsExpression = { kind: 'literal-expression', value: parameter.path };
    const call = (callee: string, args: readonly TargetTsExpression[]): TargetTsExpression => ({
      kind: 'call-expression',
      callee: { kind: 'identifier-expression', name: callee },
      arguments: [...args],
    });
    return {
      before: object.before,
      afterAssigned: [],
      read: call('godot_animation_tree_parameter', [object.value, name]),
      write: (value) => call('godot_animation_tree_set_parameter', [object.value, name, value]),
      requirements: [...rule.requirements, ...object.requirements, treeProtocol('godot_animation_tree_parameter'), treeProtocol('godot_animation_tree_set_parameter')],
    };
  }
  const element = dictionaryElement(context, node);
  if (element !== undefined) return dictionaryPlace(context, node, element, lower);
  const copiedElement = valueElement(context, node);
  if (copiedElement !== undefined) return valueElementPlace(context, node, copiedElement, lower);
  const untypedElement = variantElement(context, node);
  if (untypedElement !== undefined) return variantElementPlace(context, node, untypedElement, lower);
  if (node.kind === 'SUBSCRIPT' && node.isAttribute) {
    const namedBase = context.node(node.base, node);
    const name = officialBoundPropertyName(context, node.attribute, node);
    if (namedAttribute(context, namedBase, name)) return namedPlace(context, node, namedBase, name, lower, needsRead);
  }
  const attributeTarget = valueAttributeTarget(context, node);
  // The native base's own property as the base of a member write (`transform.basis = b`): read
  // through its getter, written back through its setter.
  const inherited = attributeTarget === undefined ? inheritedNativePlace(context, node, true) : undefined;
  if (inherited !== undefined) return inherited;
  if (attributeTarget === undefined) {
    const target = prepareAssignmentTarget(context, node, lower);
    if (target.afterAssigned.length > 0 || target.guard !== undefined) {
      return context.refuse(node, 'an indexed base of a value write-back needs its index settled');
    }
    return {
      before: target.beforeAssigned,
      afterAssigned: [],
      read: target.target,
      write: (value) => ({
        kind: 'assignment-expression',
        operator: '=',
        target: target.target,
        value,
        span: span(context.script, node),
      }),
      requirements: target.requirements,
    };
  }
  const { baseNode, attribute } = attributeTarget;
  // An engine singleton's property (`Input.mouse_mode = m`): its accessors on the one object,
  // bound without a receiver (`Engine::get_singleton_object`).
  if (baseNode.kind === 'IDENTIFIER' && baseNode.source === 'NATIVE_CLASS') {
    const found = context.nativeProperty(baseNode.name, attribute);
    const accessor = (method: { readonly owner: string; readonly name: string; readonly hash: number } | undefined) => {
      if (method === undefined) return undefined;
      const use = context.bindingUse(
        { sourceRevision: context.sourceRevision, kind: 'native-member', owner: method.owner, member: method.name, signature: method.hash === 0 ? 'unhashed' : `hash:${String(method.hash)}` },
        node,
      );
      return use.target.use.kind === 'call' && use.target.use.sourceReceiver === 'absent' ? use : context.refuse(node, `${method.owner}.${method.name} is not bound on the singleton`);
    };
    const getter = needsRead ? accessor(found?.getter) : undefined;
    const setter = accessor(found?.setter);
    if ((needsRead && getter === undefined) || setter === undefined) return context.refuse(node, `${baseNode.name}.${attribute} is not a singleton property the API dump declares`);
    const rule = context.selectRule(node, ['subscript-attribute:native-property'], [baseNode], ['binding']);
    const read = getter === undefined ? undefined : materialize(context, expression(bindingCall(context, node, getter, [])));
    return {
      before: read?.before ?? [],
      afterAssigned: [],
      // Read only when `needsRead` resolved the getter above.
      read: read?.value ?? { kind: 'undefined-expression' },
      write: (value) => bindingCall(context, node, setter, [value]),
      requirements: [...rule.requirements, ...(getter?.requirements ?? []), ...setter.requirements],
    };
  }
  if (nativeMemberReceiver(context, baseNode, attribute)) {
    const getter = needsRead ? nativeAccessorUse(context, node, baseNode, attribute, 'getter') : undefined;
    const setter = nativeAccessorUse(context, node, baseNode, attribute, 'setter');
    if ((needsRead && getter === undefined) || setter === undefined) {
      return context.refuse(
        node,
        `${baseNode.datatype.nativeType}.${attribute} is not a property the API dump declares`,
      );
    }
    const rule = context.selectRule(node, ['subscript-attribute:native-property'], [baseNode], ['binding']);
    const object = materialize(context, nativeEntity(lower(context, baseNode)));
    const read = getter === undefined ? undefined : materialize(context, expression(bindingCall(context, node, getter, [object.value])));
    return {
      before: [...object.before, ...(read?.before ?? [])],
      afterAssigned: [],
      // Read only when `needsRead` resolved the getter above.
      read: read?.value ?? { kind: 'undefined-expression' },
      write: (value) => bindingCall(context, node, setter, [object.value, value]),
      requirements: [
        ...rule.requirements,
        ...object.requirements,
        ...(getter?.requirements ?? []),
        ...setter.requirements,
      ],
    };
  }
  const base = assignablePlace(context, baseNode, lower);
  const rule = context.structural(node, 'subscript-attribute', [baseNode]);
  const setUse = context.bindingUse(
    {
      sourceRevision: context.sourceRevision,
      kind: 'builtin-member-set',
      owner: baseNode.datatype.builtinType,
      member: attribute,
      signature: 'set',
    },
    node,
  );
  if (setUse.target.use.kind !== 'call' || setUse.target.use.sourceReceiver !== 'first-argument') {
    return context.refuse(node, `member write ${setUse.target.localName} does not take the value first`);
  }
  const current = placeBase(context, baseNode, base);
  return {
    before: current.before,
    afterAssigned: [],
    read: {
      kind: 'property-expression',
      object: current.value,
      property: attribute,
      span: span(context.script, node),
    },
    write: (value) => base.write(bindingCall(context, node, setUse, [current.value, value])),
    requirements: [...base.requirements, ...rule, ...setUse.requirements],
  };
}

/**
 * Whether storing `value` into a place typed like `target` converts it: a typed built-in target
 * receiving another built-in type (or an untyped value) converts on assignment
 * (`write_assign_with_conversion` / the VM's typed assign). An enum value is its int.
 */
export function builtinConversion(target: GodotBoundNode, value: GodotBoundNode): boolean {
  const to = target.datatype;
  if (to.kind !== 'BUILTIN' || to.metaType) return false;
  const from = value.datatype;
  const fromBuiltin = from.kind === 'BUILTIN' || from.kind === 'ENUM' ? from.builtinType : undefined;
  return fromBuiltin !== to.builtinType;
}

/**
 * A Variant stored into a typed built-in converts through that type's constructor
 * (`write_assign_with_conversion` → `Variant::construct`), as the constructor binding of the
 * target type; a value already of the type stores as it is.
 */
export function convertedValue(
  context: LoweringContext,
  target: GodotBoundNode,
  valueNode: GodotBoundNode,
  value: LoweredExpression,
): LoweredExpression {
  const objectKind = (datatype: GodotBoundNode['datatype']) => !datatype.metaType && (datatype.kind === 'NATIVE' || datatype.kind === 'CLASS');
  if (
    objectKind(target.datatype) &&
    (objectKind(valueNode.datatype) || valueNode.datatype.kind === 'VARIANT') &&
    target.datatype.display !== valueNode.datatype.display &&
    context.hasTargetType(target)
  ) {
    // An object or a Variant into a place typed as a class (`var l: DirectionalLight3D =
    // $L.duplicate()`, `var c: Chunk = chunks.get(key)`): the value is that class, which Godot's
    // typed assignment checks.
    const type = context.targetType(target);
    // A class compat types by no receiver of its own (`object`) states nothing the value lacks.
    if (type.type.kind === 'keyword-type' && type.type.keyword === 'object') return value;
    // A script's instance into a place typed as an engine class holds the node it is attached to.
    const scripted = target.datatype.kind === 'NATIVE' && valueNode.datatype.kind === 'CLASS' && valueNode.datatype.scriptPath !== '';
    const held: TargetTsExpression = scripted ? { kind: 'call-expression', callee: { kind: 'identifier-expression', name: 'godot_node_entity' }, arguments: [value.value] } : value.value;
    return {
      ...value,
      value: { kind: 'as-expression', expression: held, type: type.type },
      requirements: [...value.requirements, ...type.requirements, ...(scripted ? [compatImport('node', 'godot_node_entity')] : [])],
    };
  }
  if (target.datatype.kind !== 'BUILTIN') return value;
  // A value of another built-in type converts through the target type's constructor as well
  // (`return flag` in a function returning `int`); an int into a float is the same JS number.
  const from = valueNode.datatype;
  const otherBuiltin = from.kind === 'BUILTIN' && !from.metaType && from.builtinType !== target.datatype.builtinType && !godotBuiltinWidens(from.builtinType, target.datatype.builtinType);
  if (from.kind !== 'VARIANT' && !otherBuiltin) return value;
  const owner = target.datatype.builtinType;
  const use = context.bindingUse(
    {
      sourceRevision: context.sourceRevision,
      kind: 'builtin-constructor',
      owner,
      member: owner,
      signature: 'unhashed',
    },
    valueNode,
  );
  if (use.target.use.kind !== 'call' || use.target.use.sourceReceiver !== 'absent') {
    return context.refuse(valueNode, `constructor binding ${use.target.localName} is not a plain call`);
  }
  // A Variant is stated as the target type, one the constructor takes; the constructor converts
  // whatever the value holds at run time, as `Variant::construct` does.
  const stated = from.kind === 'VARIANT' && context.hasTargetType(target) ? context.targetType(target) : undefined;
  return compose(
    context,
    [value],
    (values) => bindingCall(context, valueNode, use, stated === undefined ? values : values.map((entry) => ({ kind: 'as-expression', expression: entry, type: stated.type }))),
    [...use.requirements, ...(stated?.requirements ?? [])],
  );
}

/**
 * The value a typed variable holds before anything is assigned: GDScript clears a built-in to its
 * zero-argument construction and leaves an object or untyped variable `null`
 * (`GDScriptCompiler::_parse_function` implicit initializer, `gdscript_compiler.cpp:2365`, and a
 * local's `clear_address`, `gdscript_compiler.cpp:2235`). `node` is the VARIABLE whose datatype
 * is cleared; the `type-default` rule for that datatype is the claim.
 */
export function lowerTypeDefault(context: LoweringContext, node: GodotBoundNode): LoweredExpression {
  // The default depends on the datatype alone, not on the declaration's annotations.
  const requirements = context.selectRule(node, ['type-default'], [], ['structural'], true, false)
    .requirements;
  const initial = godotTypeDefault(node.datatype);
  if (initial.kind === 'literal') {
    return expression({ kind: 'literal-expression', value: initial.value, span: span(context.script, node) }, requirements);
  }
  const use = context.bindingUse(
    {
      sourceRevision: context.sourceRevision,
      kind: 'builtin-constructor',
      owner: initial.builtinType,
      member: initial.builtinType,
      signature: 'unhashed',
    },
    node,
  );
  if (use.target.use.kind !== 'call' || use.target.use.sourceReceiver !== 'absent') {
    return context.refuse(node, `constructor binding ${use.target.localName} is not a plain call`);
  }
  return expression(bindingCall(context, node, use, []), [...requirements, ...use.requirements]);
}

function prepareCallReference(
  context: LoweringContext,
  value: TargetTsExpression,
): { readonly before: readonly TargetTsStatement[]; readonly callee: TargetTsExpression } {
  if (value.kind === 'property-expression') {
    const object = prepareReferenceReceiver(context, value.object);
    return { before: object.before, callee: { ...value, object: object.value } };
  }
  if (value.kind === 'element-expression') {
    const object = prepareReferenceReceiver(context, value.object);
    const index = prepareReferenceReceiver(context, value.index);
    return {
      before: [...object.before, ...index.before],
      callee: { ...value, object: object.value, index: index.value },
    };
  }
  if (value.kind === 'parenthesized-expression' || value.kind === 'as-expression') {
    const inner = prepareCallReference(context, value.expression);
    return { before: inner.before, callee: { ...value, expression: inner.callee } };
  }
  const prepared = prepareReferenceReceiver(context, value);
  return { before: prepared.before, callee: prepared.value };
}

/** A compound store's new value from the place's old value and the assigned one; it may need statements of its own. */
type AssignmentCombine = (read: TargetTsExpression, value: TargetTsExpression) => LoweredExpression;

/** A write to the native base's property (`velocity = v`): its setter on the instance. */
function inheritedNativePlace(
  context: LoweringContext,
  targetNode: GodotBoundNode,
  needsRead: boolean,
): AssignablePlace | undefined {
  if (targetNode.kind !== 'IDENTIFIER' || targetNode.source !== 'INHERITED_VARIABLE') return undefined;
  const setter = selfNativeAccessor(context, targetNode, targetNode.name, 'setter');
  if (setter === undefined) return undefined;
  const getter = needsRead
    ? selfNativeAccessor(context, targetNode, targetNode.name, 'getter')
    : undefined;
  const rule = context.selectRule(targetNode, ['member-identifier:native-property'], [], ['binding']);
  const self = selfNative(context, targetNode);
  return {
    before: [],
    afterAssigned: [],
    // Read only by a compound write, which resolved the getter above.
    read: getter === undefined ? self : bindingCall(context, targetNode, getter, [self]),
    write: (value) => bindingCall(context, targetNode, setter, [self, value]),
    requirements: [...rule.requirements, ...setter.requirements, ...(getter?.requirements ?? [])],
  };
}

function assignment(
  context: LoweringContext,
  node: GodotBoundNode,
  combine: AssignmentCombine | undefined,
  targetNode: GodotBoundNode,
  assigned: LoweredExpression,
  lower: (context: LoweringContext, node: GodotBoundNode) => LoweredExpression,
  ownRequirements: readonly OfficialBoundLoweringRequirement[],
): LoweredExpression {
  const place =
    inheritedNativePlace(context, targetNode, combine !== undefined) ??
    (valueAttributeTarget(context, targetNode) !== undefined || treeParameter(context, targetNode) !== undefined || dictionaryElement(context, targetNode) !== undefined || valueElement(context, targetNode) !== undefined || variantElement(context, targetNode) !== undefined || namedTarget(context, targetNode)
      ? assignablePlace(context, targetNode, lower, combine !== undefined)
      : undefined);
  if (place !== undefined) {
    const value = materialize(context, assigned);
    const stored = settle(context, combine === undefined ? expression(value.value) : combine(place.read, value.value));
    return {
      before: [...place.before, ...value.before, ...place.afterAssigned, ...stored.before],
      value: place.write(stored.value),
      after: [],
      requirements: [...ownRequirements, ...place.requirements, ...value.requirements, ...stored.requirements],
    };
  }
  const target = prepareAssignmentTarget(context, targetNode, lower);
  const value = materialize(context, assigned);
  // Godot evaluates the base/intermediate chain, then the RHS, then the final index and old
  // lvalue. JavaScript's native assignment order differs, so all four phases are explicit.
  const sequenced = [...target.beforeAssigned, ...value.before, ...target.afterAssigned];
  // Under its guard the place is in range, so a compound's read of it is present.
  const read: TargetTsExpression = target.guard === undefined ? target.target : { kind: 'non-null-expression', expression: target.target };
  const stored = settle(context, combine === undefined ? expression(value.value) : combine(read, value.value));
  const store: TargetTsExpression = { kind: 'assignment-expression', operator: '=', target: target.target, value: stored.value, span: span(context.script, node) };
  const requirements = [...ownRequirements, ...target.requirements, ...value.requirements, ...stored.requirements];
  if (target.guard !== undefined) {
    // A store Godot may drop is a statement under its guard; the expression left is the assigned
    // value, which a statement drops (`expressionStatement`).
    return {
      before: [...sequenced, { kind: 'if-statement', condition: target.guard, then: [...stored.before, { kind: 'expression-statement', expression: store }] }],
      value: value.value,
      after: [],
      requirements,
    };
  }
  return { before: [...sequenced, ...stored.before], value: store, after: [], requirements };
}

function assignmentBinaryOperator(
  operator: TargetTsAssignmentOperator,
): TargetTsBinaryOperator | undefined {
  if (operator === '=') return undefined;
  const binary = operator.slice(0, -1);
  switch (binary) {
    case '+':
    case '-':
    case '*':
    case '/':
    case '%':
    case '**':
    case '&&':
    case '||':
    case '??':
    case '&':
    case '|':
    case '^':
    case '<<':
    case '>>':
    case '>>>':
      return binary as TargetTsBinaryOperator;
    default:
      throw new Error(`unsupported assignment operator ${operator}`);
  }
}

function dynamicCall(
  context: LoweringContext,
  node: GodotBoundCallNode,
  callee: LoweredExpression,
  args: readonly LoweredExpression[],
  ownRequirements: readonly OfficialBoundLoweringRequirement[],
): LoweredExpression {
  const argumentsPlan = eagerValues(context, args);
  const settledCallee = settle(context, callee);
  const preparedCallee = prepareCallReference(context, settledCallee.value);
  return {
    before: [...argumentsPlan.before, ...settledCallee.before, ...preparedCallee.before],
    value: {
      kind: 'call-expression',
      callee: preparedCallee.callee,
      arguments: argumentsPlan.values,
      span: span(context.script, node),
    },
    after: [],
    requirements: [
      ...ownRequirements,
      ...settledCallee.requirements,
      ...argumentsPlan.requirements,
    ],
  };
}

function inlineValue(
  context: LoweringContext,
  owner: GodotBoundNode,
  plan: LoweredExpression,
): TargetTsExpression {
  if (plan.before.length > 0 || plan.after.length > 0) {
    context.refuse(owner, 'this expression requires statement sequencing at an inline-only site');
  }
  return plan.value;
}

function boundTargetExpression(
  target: Exclude<GodotTargetBinding, { kind: 'refusal-binding' }>,
): TargetTsExpression {
  return { kind: 'identifier-expression', name: target.localName };
}

function nativeClassBinding(
  context: LoweringContext,
  node: Extract<GodotBoundNode, { kind: 'IDENTIFIER' }>,
): OfficialBoundBindingUse {
  if (node.source !== 'NATIVE_CLASS') {
    return context.refuse(
      node,
      `official identifier source ${node.source} has no canonical selected-symbol identity`,
    );
  }
  return context.bindingUse(
    {
      sourceRevision: context.sourceRevision,
      kind: 'native-class',
      owner: node.datatype.nativeType || node.name,
      member: node.name,
      signature: node.datatype.display,
    },
    node,
  );
}

function callSymbol(
  context: LoweringContext,
  node: GodotBoundCallNode,
): GodotOfficialSymbolIdentity | undefined {
  const target = node.compilerTarget;
  const base = {
    sourceRevision: context.sourceRevision,
    owner: target.owner,
    member: target.member,
    signature: target.signatureHash === 0 ? 'unhashed' : `hash:${String(target.signatureHash)}`,
  } as const;
  switch (target.kind) {
    case 'builtin-constructor':
      return { ...base, kind: 'builtin-constructor' };
    case 'variant-utility':
      return { ...base, kind: 'global' };
    case 'gdscript-utility':
      // GDScript's own utilities are not in the API dump and have one signature each: no hash.
      return { ...base, kind: 'global', signature: 'unhashed' };
    case 'native-method':
    case 'native-static':
      return { ...base, kind: 'native-member' };
    case 'builtin-member':
      return { ...base, kind: 'builtin-member' };
    case 'builtin-static':
      // A static built-in method (`Basis.looking_at`) has no receiver: its own symbol kind, and
      // its binding takes the arguments alone.
      return { ...base, kind: 'builtin-static' };
    case 'script-self':
    case 'script-class':
      return undefined;
    case 'dynamic':
    case 'unresolved': {
      const typed = context.callReceivers.get(node.id);
      if (typed === undefined) {
        if (target.kind === 'dynamic' && !context.untypedCalls.has(node.id)) return undefined;
        return context.refuse(
          node,
          `dynamic call ${node.functionName}: ${context.untypedCalls.get(node.id) ?? 'receiver is untyped'}`,
        );
      }
      return {
        sourceRevision: context.sourceRevision,
        kind: typed.target.kind,
        owner: typed.target.owner,
        member: typed.target.member,
        signature: typed.target.signatureHash === 0 ? 'unhashed' : `hash:${String(typed.target.signatureHash)}`,
      };
    }
    case 'super':
      return context.refuse(node, 'super calls require resolved class ancestry');
    default:
      return target.kind satisfies never;
  }
}

function callTargetBinding(
  context: LoweringContext,
  node: GodotBoundCallNode,
): OfficialBoundBindingUse | undefined {
  const symbol = callSymbol(context, node);
  if (symbol === undefined) return undefined;
  return context.bindingUse(symbol, node);
}

function boundCallWithoutReceiver(
  context: LoweringContext,
  node: GodotBoundCallNode,
  use: OfficialBoundBindingUse,
  args: readonly LoweredExpression[],
): LoweredExpression {
  const target = use.target;
  if (target.use.kind === 'value') {
    return context.refuse(node, `binding ${target.localName} is not callable`);
  }
  if (target.use.kind === 'call' && target.use.sourceReceiver !== 'absent') {
    return context.refuse(node, `binding ${target.localName} expects a source receiver`);
  }
  return compose(
    context,
    args,
    (argumentValues) => ({
      kind: target.use.kind === 'construct' ? 'new-expression' : 'call-expression',
      callee: boundTargetExpression(target),
      arguments: argumentValues,
      span: span(context.script, node),
    }),
    use.requirements,
  );
}

function boundInstanceCall(
  context: LoweringContext,
  node: GodotBoundCallNode,
  receiver: LoweredExpression,
  use: OfficialBoundBindingUse,
  args: readonly LoweredExpression[],
): LoweredExpression {
  const target = use.target;
  if (target.use.kind !== 'call' || target.use.sourceReceiver === 'absent') {
    return context.refuse(node, `binding ${target.localName} does not accept an instance receiver`);
  }
  const argumentsPlan = eagerValues(context, args);
  const preparedReceiver = materialize(context, receiver);
  if (target.use.sourceReceiver === 'first-argument') {
    return {
      before: [...argumentsPlan.before, ...preparedReceiver.before],
      value: {
        kind: 'call-expression',
        callee: boundTargetExpression(target),
        arguments: [preparedReceiver.value, ...argumentsPlan.values],
        span: span(context.script, node),
      },
      after: [],
      requirements: [
        ...use.requirements,
        ...preparedReceiver.requirements,
        ...argumentsPlan.requirements,
      ],
    };
  }
  return {
    before: [
      ...argumentsPlan.before,
      ...preparedReceiver.before,
      { kind: 'expression-statement', expression: preparedReceiver.value },
    ],
    value: {
      kind: 'call-expression',
      callee: boundTargetExpression(target),
      arguments: argumentsPlan.values,
      span: span(context.script, node),
    },
    after: [],
    requirements: [
      ...use.requirements,
      ...preparedReceiver.requirements,
      ...argumentsPlan.requirements,
    ],
  };
}

/**
 * The object type a type test or cast names: a script class (its generated class, imported) or a
 * native class (its name, which the Node protocol reads against the class the scene recorded).
 * A built-in type (`value is int`) is a Variant type test, not lowered here.
 */
function objectTypeTest(
  context: LoweringContext,
  node: GodotBoundNode,
  datatype: GodotBoundNode['datatype'],
  operation: 'is' | 'cast',
): {
  readonly kind: 'script' | 'native';
  readonly argument: TargetTsExpression;
  readonly requirements: readonly OfficialBoundLoweringRequirement[];
} {
  const protocol = (name: string): OfficialBoundLoweringRequirement => ({
    kind: 'compat-import-requirement',
    module: 'lib/godot-compat/node',
    imported: name,
    local: name,
    typeOnly: false,
  });
  if ((datatype.kind === 'CLASS' || datatype.kind === 'SCRIPT') && datatype.scriptPath !== '') {
    const found = context.scriptClass?.(datatype.scriptPath);
    if (found === undefined) {
      return context.refuse(node, `${operation} ${datatype.display} names no generated script class`);
    }
    return {
      kind: 'script',
      argument: { kind: 'identifier-expression', name: found.name },
      requirements: [
        protocol(operation === 'is' ? 'godot_is_script' : 'godot_as_script'),
        ...(found.module === undefined
          ? []
          : [
              {
                kind: 'project-import-requirement' as const,
                module: found.module,
                imported: found.name,
                local: found.name,
                typeOnly: false,
              },
            ]),
      ],
    };
  }
  if (datatype.kind === 'NATIVE' && datatype.nativeType !== '') {
    return {
      kind: 'native',
      argument: { kind: 'literal-expression', value: datatype.nativeType },
      requirements: [protocol(operation === 'is' ? 'godot_is_native' : 'godot_as_native')],
    };
  }
  return context.refuse(node, `${operation} ${datatype.display} is not an object type test`);
}

/**
 * Whether a lowered call's compat export returns less than the analysis knows: `unknown`, `object`,
 * a union (an overload family's) or a type it leaves unstated. A call that is not a binding's is
 * the project's own and already typed.
 */
function wideBindingResult(context: LoweringContext, call: TargetTsExpression): boolean {
  if (call.kind !== 'call-expression' || call.callee.kind !== 'identifier-expression') return false;
  const target = context.bindings.targetByLocalName(call.callee.name);
  if (target === undefined || target.kind !== 'compat-binding') return false;
  const returned = godotCompatReturnType(target.module, target.exportName);
  return returned === undefined || returned === 'unknown' || returned === 'object' || returned.includes('|') || returned === 'Variant';
}

/** Each type `str()` states, by the `Variant::stringify` form compat writes it in (`variant-stringify.ts`). */
const STRINGIFY: Readonly<Record<string, string | null>> = {
  int: 'godot_str_int',
  float: 'godot_str_float',
  bool: 'godot_str_bool',
  // A String is itself, and a StringName is its string.
  String: null,
  StringName: null,
  Vector2: 'godot_str_vector2',
  Vector2i: 'godot_str_vector2i',
  Vector3: 'godot_str_vector3',
  Vector3i: 'godot_str_vector3i',
  Color: 'godot_str_color',
};

/**
 * One `str()` argument as the text `Variant::stringify` gives it, chosen by its analysed type; an
 * argument whose type analysis leaves as Variant is refused by name.
 */
function stringifiedArgument(
  context: LoweringContext,
  call: GodotBoundNode,
  argument: GodotBoundNode,
  value: LoweredExpression,
): LoweredExpression {
  const datatype = argument.datatype;
  const type = datatype.kind === 'BUILTIN' && !datatype.metaType ? datatype.builtinType : undefined;
  const form = type === undefined ? undefined : STRINGIFY[type];
  if (form === undefined) {
    const called = call.kind === 'CALL' ? call.functionName : 'str';
    return context.refuse(argument, `${called}() of a ${datatype.display} argument: its Variant::stringify form is not transcribed or its type is not settled`);
  }
  const requirements = context.structural(call, 'stringify', [argument], 'str-argument');
  if (form === null) return { ...value, requirements: [...value.requirements, ...requirements] };
  return {
    ...value,
    value: { kind: 'call-expression', callee: { kind: 'identifier-expression', name: form }, arguments: [value.value], span: span(context.script, argument) },
    requirements: [
      ...value.requirements,
      ...requirements,
      { kind: 'compat-import-requirement', module: 'lib/godot-compat/variant-stringify', imported: form, local: form, typeOnly: false },
    ],
  };
}

function numericImport(name: string): OfficialBoundLoweringRequirement {
  return { kind: 'compat-import-requirement', module: 'lib/godot-compat/numeric', imported: name, local: name, typeOnly: false };
}

function numericCall(name: string, argument: TargetTsExpression): TargetTsExpression {
  return { kind: 'call-expression', callee: { kind: 'identifier-expression', name }, arguments: [argument] };
}

/** The one built-in type a plain value has, as analysis typed it: its one type where an int-or-float variable reaches it, else its own. */
function plainType(context: LoweringContext, node: GodotBoundNode): string | undefined {
  const types = context.numericTypes(node);
  if (types !== undefined) return types.size === 1 ? [...types][0] : undefined;
  return context.plainNumericType(node);
}

/** A plain int or float stored into an int-or-float place: tagged by its type (`numeric-tag`). */
export function numericTag(
  context: LoweringContext,
  site: GodotBoundNode,
  valueNode: GodotBoundNode,
  value: LoweredExpression,
  type: string | undefined = plainType(context, valueNode),
): LoweredExpression {
  const name = godotNumericTag(type)?.tag;
  if (name === undefined) {
    return context.refuse(valueNode, `a ${type ?? valueNode.datatype.display} value stored into an int-or-float variable: only an int or a float is tagged`);
  }
  return {
    ...value,
    value: numericCall(name, value.value),
    requirements: [...value.requirements, ...context.structural(site, 'numeric-tag', [valueNode], 'numeric-tag'), numericImport(name)],
  };
}

export function lowerOfficialExpression(
  context: LoweringContext,
  node: GodotBoundNode,
  lowerSuite: LowerOfficialSuite,
  parameters: LowerOfficialParameters,
): LoweredExpression {
  return lowerExpression(context, node);

  /**
   * A value whose datatype the analysis knows exactly is stated as that type: a binding returns
   * what its compat export declares (`get_node` any node, `get_setting` any Variant), a `$Path`
   * and an `as` cast are the class the analysis resolved, and a local narrowed by `is T` is a T.
   */
  function lowerExpression(context: LoweringContext, node: GodotBoundNode): LoweredExpression {
    // An operand a switch branch reads as one type: the branch's value for it.
    const substituted = context.overrideValue(node);
    if (substituted !== undefined) return expression(substituted);
    // An int-or-float argument to an engine `float` parameter is read as its value (`numeric-convert`).
    const floatCall = context.floatArgumentCall(node);
    if (floatCall !== undefined && tagged(context, node)) {
      const value = involvesNumeric(context, node) ? lowerNumeric(context, node) : lowerTypedExpression(context, node);
      const owner = context.rawNode(floatCall, node);
      return {
        ...value,
        value: numericCall('godot_numeric_value', value.value),
        requirements: [...value.requirements, ...context.structural(owner, 'numeric-convert', [{ ...node, datatype: builtinDatatype('float') } as GodotBoundNode], 'numeric-convert'), numericImport('godot_numeric_value')],
      };
    }
    if (involvesNumeric(context, node)) return lowerNumeric(context, node);
    const plain = lowerTypedExpression(context, node);
    // A value passed to a tagged parameter is tagged by its type at the call.
    const call = context.taggedArgumentCall(node);
    if (call === undefined || tagged(context, node)) return plain;
    const owner = context.rawNode(call, node);
    return numericTag(context, owner, node, plain);
  }

  function lowerTypedExpression(context: LoweringContext, node: GodotBoundNode): LoweredExpression {
    const lowered = lowerExpressionKind(context, node);
    const datatype = node.datatype;
    const typedValue =
      node.kind === 'GET_NODE' ||
      node.kind === 'CAST' ||
      // A node the scene handed over for `get_node("Path")`, stated as `$Path` is.
      (node.kind === 'CALL' && context.nodeFields.has(context.selfNodePaths.get(node.id) ?? '')) ||
      (context.narrowed(node) && node.kind === 'IDENTIFIER') ||
      // A binding's result (a call, an operator or a read through a binding) is what it returns;
      // the analysis may know it more exactly (`get_setting` of a known setting, a ray's `position`).
      (lowered.value.kind === 'call-expression' &&
        (node.kind === 'CALL' || node.kind === 'SUBSCRIPT' || node.kind === 'BINARY_OPERATOR') &&
        wideBindingResult(context, lowered.value)) ||
      // An Array element is `unknown` (or `T | undefined`) to TS; the analysis states what it is.
      (node.kind === 'SUBSCRIPT' && arrayElementRead(lowered.value));
    const known = godotStatedValueType(datatype);
    // (A built-in with no datatype rule of its own keeps the binding's type.)
    if (!typedValue || datatype.metaType || !known || !context.hasTargetType(node)) return lowered;
    const type = context.targetType(node);
    return {
      ...lowered,
      value: { kind: 'as-expression', expression: lowered.value, type: type.type },
      requirements: [...lowered.requirements, ...type.requirements],
    };
  }

  /** The direct operands an operation reads: a switch branches over the tagged ones. */
  function operandsOf(node: GodotBoundNode): readonly number[] {
    if (node.kind === 'BINARY_OPERATOR') return [node.leftOperand, node.rightOperand];
    if (node.kind === 'UNARY_OPERATOR') return [node.operand];
    if (node.kind === 'CALL') return node.arguments;
    return [];
  }

  /** Whether an operation reads an int-or-float value directly (and so switches over its tag). */
  function involvesNumeric(context: LoweringContext, node: GodotBoundNode): boolean {
    if (node.kind === 'ASSIGNMENT') {
      const assignee = context.rawNode(node.assignee, node);
      const value = context.rawNode(node.assignedValue, node);
      return context.isNumericVariable(assignee) || tagged(context, value);
    }
    if (node.kind === 'CALL' && context.numericTypes(node) === undefined) return false;
    if (node.kind !== 'BINARY_OPERATOR' && node.kind !== 'UNARY_OPERATOR' && node.kind !== 'CALL') return false;
    return operandsOf(node).some((id) => tagged(context, context.rawNode(id, node)));
  }

  function tagged(context: LoweringContext, node: GodotBoundNode): boolean {
    const types = context.numericTypes(node);
    return types !== undefined && types.size > 1;
  }

  /**
   * An operation reading an int-or-float value: each tagged operand is evaluated once (every
   * operand is, in order), then a callsite-local switch over the tags runs the operation's own
   * rule for each combination of int and float (`godot_numeric_is_int`), each branch
   * reading the operand as that type. A result that is an int in one branch and a float in another
   * is tagged again; any other result is plain.
   */
  function numericSwitch(
    context: LoweringContext,
    node: GodotBoundNode,
    operandIds: readonly number[],
    given?: ReadonlyMap<number, TargetTsExpression>,
  ): { readonly lowered: LoweredExpression; readonly types: ReadonlySet<string> } {
    const operands = operandIds.map((id) => context.rawNode(id, node));
    const settled = operands.map((operand) => {
      const isTagged = tagged(context, operand);
      const supplied = given?.get(operand.id);
      const value =
        supplied === undefined
          ? materialize(context, isTagged ? lowerExpression(context, operand) : lowerExpression(context, context.node(operand.id, node)))
          : supplied.kind === 'identifier-expression'
            ? expression(supplied)
            : materialize(context, expression(supplied));
      return { operand, isTagged, value };
    });
    const taggedOperands = settled.filter((entry) => entry.isTagged);
    const requirements: OfficialBoundLoweringRequirement[] = [
      ...settled.flatMap((entry) => entry.value.requirements),
      ...context.structural(node, 'numeric-switch', [], 'numeric-switch'),
      numericImport('godot_numeric_is_int'),
      numericImport('godot_numeric_value'),
    ];
    type Branch = { readonly type: string; readonly value: TargetTsExpression };
    const branch = (choice: readonly string[]): Branch => {
      const overrides = new Map<number, { readonly datatype: GodotBoundNode['datatype']; readonly value: TargetTsExpression }>();
      settled.forEach((entry) => {
        const index = taggedOperands.indexOf(entry);
        overrides.set(
          entry.operand.id,
          index >= 0
            ? { datatype: builtinDatatype(choice[index] as string), value: numericCall('godot_numeric_value', entry.value.value) }
            : { datatype: context.node(entry.operand.id, node).datatype, value: entry.value.value },
        );
      });
      return context.withOverrides(overrides, () => {
        const type = context.numericBranchType(node, choice);
        if (type === undefined || type === 'unknown') {
          return context.refuse(node, `the operator table has no result for ${choice.join(' and ')} here`);
        }
        const lowered = lowerTypedExpression(context, { ...node, datatype: builtinDatatype(type) } as GodotBoundNode);
        if (lowered.before.length > 0 || lowered.after.length > 0) {
          return context.refuse(node, 'a branch of an int-or-float switch needs statements of its own');
        }
        requirements.push(...lowered.requirements);
        return { type, value: lowered.value };
      });
    };
    // Every combination, nested in operand order.
    const leaves: { readonly choice: readonly string[]; readonly branch: Branch }[] = [];
    const walk = (prefix: readonly string[]): void => {
      if (prefix.length === taggedOperands.length) leaves.push({ choice: prefix, branch: branch(prefix) });
      else {
        for (const type of GODOT_NUMERIC_TYPES) walk([...prefix, type]);
      }
    };
    walk([]);
    const types = new Set(leaves.map((leaf) => leaf.branch.type));
    const retag = types.size > 1;
    if (retag && [...types].some((type) => godotNumericTag(type) === undefined)) {
      return context.refuse(node, `an int-or-float switch whose branches give ${[...types].join(' and ')}`);
    }
    const valueOf = (leaf: (typeof leaves)[number]): TargetTsExpression => {
      if (!retag) return leaf.branch.value;
      const name = (godotNumericTag(leaf.branch.type) as GodotNumericTag).tag;
      requirements.push(numericImport(name));
      return numericCall(name, leaf.branch.value);
    };
    const build = (depth: number, from: number, to: number): TargetTsExpression => {
      if (to - from === 1) return valueOf(leaves[from] as (typeof leaves)[number]);
      const middle = (from + to) / 2;
      const entry = taggedOperands[depth] as (typeof settled)[number];
      return {
        kind: 'conditional-expression',
        condition: numericCall('godot_numeric_is_int', entry.value.value),
        whenTrue: build(depth + 1, from, middle),
        whenFalse: build(depth + 1, middle, to),
        span: span(context.script, node),
      };
    };
    return {
      lowered: {
        before: settled.flatMap((entry) => entry.value.before),
        value: build(0, 0, leaves.length),
        after: [],
        requirements,
      },
      types,
    };
  }

  /**
   * `clamp(x, min, max)` reaching an int-or-float value: compat's clamp over tagged numbers, which
   * returns x, min or max with its own type (`variant_utility.cpp:730`); plain arguments are tagged.
   */
  function numericClamp(context: LoweringContext, node: Extract<GodotBoundNode, { kind: 'CALL' }>): LoweredExpression {
    const values = node.arguments.map((id) => {
      const argument = context.rawNode(id, node);
      return tagged(context, argument) ? lowerExpression(context, argument) : numericTag(context, node, context.node(id, node), lowerExpression(context, context.node(id, node)));
    });
    return {
      before: values.flatMap((value) => value.before),
      value: { kind: 'call-expression', callee: { kind: 'identifier-expression', name: 'godot_numeric_clamp' }, arguments: values.map((value) => value.value), span: span(context.script, node) },
      after: values.flatMap((value) => value.after),
      requirements: [...values.flatMap((value) => value.requirements), ...context.structural(node, 'numeric-clamp', [], 'numeric-clamp'), numericImport('godot_numeric_clamp')],
    };
  }

  /** An operation or store that reads or writes an int-or-float variable. */
  function lowerNumeric(context: LoweringContext, node: GodotBoundNode): LoweredExpression {
    if (node.kind === 'CALL' && context.utilityShapes.get(node.id) === 'selects-argument') return numericClamp(context, node);
    if (node.kind !== 'ASSIGNMENT') return numericSwitch(context, node, operandsOf(node)).lowered;
    const assignee = context.rawNode(node.assignee, node);
    const valueNode = context.rawNode(node.assignedValue, node);
    const structural = context.structural(node, 'numeric-store', [], 'numeric-store');
    if (node.operation === 'OP_NONE') {
      const value = lowerExpression(context, tagged(context, valueNode) ? valueNode : context.node(valueNode.id, node));
      const stored = numericStored(context, node, assignee, valueNode, value, context.numericTypes(valueNode) ?? new Set([plainType(context, valueNode) ?? 'unknown']));
      return assignment(context, node, undefined, assignee, stored, lowerExpression, structural);
    }
    // A compound (`a op= b` reads as `a op b`) switches its operator over the tags, reading the old
    // value from the place the store prepares, so the place's base and index are evaluated once.
    if (!tagged(context, assignee) && !tagged(context, valueNode)) {
      return context.refuse(node, 'a compound assignment reaching an int-or-float variable reads neither operand as one');
    }
    const binary = {
      ...node,
      kind: 'BINARY_OPERATOR',
      leftOperand: node.assignee,
      rightOperand: node.assignedValue,
    } as unknown as GodotBoundNode;
    const value = lowerExpression(context, tagged(context, valueNode) ? valueNode : context.node(valueNode.id, node));
    return assignment(
      context,
      node,
      (read, assigned) => {
        const switched = numericSwitch(context, binary, [node.assignee, node.assignedValue], new Map([[assignee.id, read], [valueNode.id, assigned]]));
        return numericStored(context, node, assignee, valueNode, switched.lowered, switched.types);
      },
      assignee,
      value,
      lowerExpression,
      structural,
    );
  }

  /** The value an int-or-float store writes into its place: tagged, converted or plain as the place takes it. */
  function numericStored(
    context: LoweringContext,
    node: GodotBoundNode,
    assignee: GodotBoundNode,
    valueNode: GodotBoundNode,
    value: LoweredExpression,
    types: ReadonlySet<string>,
  ): LoweredExpression {
    const isTagged = types.size > 1;
    if (context.isNumericVariable(assignee)) {
      return isTagged ? value : numericTag(context, node, { ...valueNode, datatype: builtinDatatype([...types][0] as string) } as GodotBoundNode, value, [...types][0]);
    }
    if (isTagged) {
      // A tagged number into a typed place converts (`write_assign_with_conversion`): an int place
      // truncates a float (`Variant::operator int64_t`), a float place takes either as its value.
      const place = plainType(context, assignee);
      const name = godotNumericTag(place)?.read;
      if (name === undefined) {
        return context.refuse(node, `an int-or-float value stored into a ${assignee.datatype.display} place, which no conversion takes`);
      }
      return {
        ...value,
        value: numericCall(name, value.value),
        requirements: [...value.requirements, ...context.structural(node, 'numeric-convert', [assignee], 'numeric-convert'), numericImport(name)],
      };
    }
    const type = [...types][0];
    const place = plainType(context, assignee);
    if (!godotNumericStoresAs(type, place)) {
      return context.refuse(node, `a ${type ?? 'value'} from an int-or-float operation stored into a ${assignee.datatype.display} place`);
    }
    return value;
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: exhaustive official expression union
  function lowerExpressionKind(context: LoweringContext, node: GodotBoundNode): LoweredExpression {
    switch (node.kind) {
      case 'LITERAL': {
        const value = node.reduced ? node.reducedValue : node.value;
        const requirements = context.structural(
          node,
          'literal',
          [],
          `literal:${value.kind}:${node.reduced ? 'reduced' : 'source'}`,
        );
        return expression(literal(context, node, value), requirements);
      }
      case 'SELF': {
        return expression(
          { kind: 'this-expression', span: span(context.script, node) },
          context.structural(node, 'self'),
        );
      }
      case 'IDENTIFIER': {
        if (context.isNumericVariable(node) && (node.source === 'FUNCTION_PARAMETER' || node.source === 'MEMBER_VARIABLE' || node.source === 'INHERITED_VARIABLE')) {
          // An int-or-float variable read as its tagged number (`numeric-variant`).
          const local = node.source === 'FUNCTION_PARAMETER';
          return expression(
            local
              ? { kind: 'identifier-expression', name: context.lexicalName(node.name), span: span(context.script, node) }
              : { kind: 'property-expression', object: { kind: 'this-expression' }, property: godotMemberProperty(context, node.name), span: span(context.script, node) },
            context.structural(node, local ? 'local-identifier' : 'member-identifier', [], local ? 'local-identifier:numeric' : 'member-identifier:numeric'),
          );
        }
        if (
          node.source === 'FUNCTION_PARAMETER' ||
          node.source === 'LOCAL_VARIABLE' ||
          node.source === 'LOCAL_CONSTANT' ||
          node.source === 'LOCAL_ITERATOR' ||
          node.source === 'LOCAL_BIND'
        ) {
          return expression(
            {
              kind: 'identifier-expression',
              name: context.lexicalName(node.name),
              span: span(context.script, node),
            },
            context.structural(node, 'local-identifier', [], `local-identifier:${node.source}`),
          );
        }
        if (node.source === 'INHERITED_VARIABLE' && context.nativeBase !== undefined) {
          // A native property of the script's own native base (`position`) reads through its
          // API-dump getter on the instance, as a native method called on self does.
          const getter = selfNativeAccessor(context, node, node.name, 'getter');
          if (getter !== undefined) {
            const rule = context.selectRule(node, ['member-identifier:native-property'], [], ['binding']);
            return expression(
              bindingCall(context, node, getter, [selfNative(context, node)]),
              [...rule.requirements, ...getter.requirements],
            );
          }
        }
        if (node.source === 'INHERITED_VARIABLE' && node.datatype.kind === 'BUILTIN' && context.nativeBase !== undefined) {
          // An engine method of the script's native base named as a value (`queue_free`) is
          // `Callable(self, name)`: its binding called on the instance's native entity.
          const method = context.nativeMethod(context.nativeBase, node.name);
          if (method !== undefined) {
            const use = context.bindingUse(
              { sourceRevision: context.sourceRevision, kind: 'native-member', owner: method.owner, member: method.name, signature: method.hash === 0 ? 'unhashed' : `hash:${String(method.hash)}` },
              node,
            );
            if (use.target.use.kind !== 'call' || use.target.use.sourceReceiver !== 'first-argument') {
              return context.refuse(node, `${method.owner}.${method.name} is not bound as a method of an object`);
            }
            return expression(
              {
                kind: 'call-expression',
                callee: { kind: 'identifier-expression', name: 'godot_callable_native' },
                arguments: [selfNative(context, node), { kind: 'literal-expression', value: node.name }, boundTargetExpression(use.target)],
                span: span(context.script, node),
              },
              [
                ...context.structural(node, 'member-identifier', [], 'member-identifier:native-method'),
                ...use.requirements,
                { kind: 'compat-import-requirement', module: 'lib/godot-compat/callable', imported: 'godot_callable_native', local: 'godot_callable_native', typeOnly: false },
              ],
            );
          }
        }
        if (node.source === 'MEMBER_FUNCTION') {
          // A script function named as a value is `Callable(self, name)` (`callable.ts`).
          return expression(
            {
              kind: 'call-expression',
              callee: { kind: 'identifier-expression', name: 'godot_callable_method' },
              arguments: [{ kind: 'this-expression' }, { kind: 'literal-expression', value: node.name }],
              span: span(context.script, node),
            },
            [
              ...context.structural(node, 'member-identifier', [], `member-identifier:${node.source}`),
              { kind: 'compat-import-requirement', module: 'lib/godot-compat/callable', imported: 'godot_callable_method', local: 'godot_callable_method', typeOnly: false },
            ],
          );
        }
        if (
          node.source === 'MEMBER_VARIABLE' ||
          node.source === 'MEMBER_SIGNAL' ||
          node.source === 'INHERITED_VARIABLE'
        ) {
          return expression(
            {
              kind: 'property-expression',
              object: { kind: 'this-expression' },
              property: node.source === 'MEMBER_VARIABLE' ? godotMemberProperty(context, node.name) : node.name,
              span: span(context.script, node),
            },
            context.structural(node, 'member-identifier', [], `member-identifier:${node.source}`),
          );
        }
        // A ClassDB constant the script's native class inherits (`NOTIFICATION_PREDELETE`), which the
        // analyzer also names a member constant, when the script's chain declares no such member.
        const inherited =
          node.source === 'MEMBER_CONSTANT' && context.nativeBase !== undefined && context.scriptMembers?.(context.script.resPath)?.has(node.name) !== true
            ? context.nativeConstant(context.nativeBase, node.name)
            : undefined;
        if (inherited !== undefined) {
          const rule = context.structural(node, 'literal', [], 'literal:native-constant');
          return expression({ kind: 'literal-expression', value: inherited, span: span(context.script, node) }, rule);
        }
        if (node.source === 'MEMBER_CONSTANT' || node.source === 'STATIC_VARIABLE') {
          return expression(
            {
              kind: 'property-expression',
              object: { kind: 'identifier-expression', name: context.classIdentifier },
              property: node.name,
              span: span(context.script, node),
            },
            context.structural(node, 'member-identifier', [], `member-identifier:${node.source}`),
          );
        }
        const autoload = context.autoload(node);
        if (autoload?.fromTree === true) {
          // Where the script has no autoload field yet, the autoload node under the root.
          return expression(
            {
              kind: 'as-expression',
              expression: {
                kind: 'call-expression',
                callee: { kind: 'identifier-expression', name: 'godot_tree_autoload' },
                arguments: [{ kind: 'literal-expression', value: autoload.reference.name }],
                span: span(context.script, node),
              },
              type: { kind: 'type-reference', name: autoload.reference.typeLocalName, arguments: [] },
            },
            [...autoload.requirements, compatImport('scene-tree', 'godot_tree_autoload')],
          );
        }
        if (autoload !== undefined) {
          return expression(
            {
              kind: 'property-expression',
              object: { kind: 'this-expression' },
              property: autoload.reference.fieldName,
              span: span(context.script, node),
            },
            autoload.requirements,
          );
        }
        if (node.source === 'UNDEFINED_SOURCE' && node.datatype.kind === 'ENUM' && !node.datatype.metaType) {
          // A global enum's constant (`MOUSE_BUTTON_LEFT`, of @GlobalScope's `MouseButton`) is its
          // value, as a ClassDB constant is.
          const value = context.globalEnumConstant(node.datatype.enumType, node.name);
          if (value !== undefined) {
            const rule = context.structural(node, 'literal', [], 'literal:native-constant');
            return expression({ kind: 'literal-expression', value, span: span(context.script, node) }, rule);
          }
        }
        // A global script class named as a value (`Chunk.calculate_block_uvs(...)`, a `class_name`
        // the analyzer resolves through `ScriptServer`) is that script's generated class.
        if (node.source === 'UNDEFINED_SOURCE' && node.datatype.metaType && (node.datatype.kind === 'CLASS' || node.datatype.kind === 'SCRIPT') && node.datatype.scriptPath !== '') {
          const found = context.scriptClass?.(node.datatype.scriptPath);
          if (found === undefined) return context.refuse(node, `${node.datatype.scriptPath} names no generated script class`);
          return expression(
            { kind: 'identifier-expression', name: found.name, span: span(context.script, node) },
            [
              ...context.structural(node, 'bound-identifier', [], 'bound-identifier:script-class'),
              ...(found.module === undefined ? [] : [{ kind: 'project-import-requirement' as const, module: found.module, imported: found.name, local: found.name, typeOnly: false }]),
            ],
          );
        }
        // GDScript's own constants (`PI`, `TAU`, `INF`, `NAN`) are their values.
        const language = node.source === 'UNDEFINED_SOURCE' ? godotLanguageConstant(node.name) : undefined;
        if (language !== undefined) {
          const rule = context.structural(node, 'literal', [], 'literal:native-constant');
          return expression({ kind: 'literal-expression', value: language, span: span(context.script, node) }, rule);
        }
        // The binding is what the identifier means; resolve it before its structural rule so an
        // absent binding is what refuses.
        const use = nativeClassBinding(context, node);
        const structuralRequirements = context.structural(
          node,
          'bound-identifier',
          [],
          `bound-identifier:${node.source}`,
        );
        return expression(
          { ...boundTargetExpression(use.target), span: span(context.script, node) },
          [...structuralRequirements, ...use.requirements],
        );
      }
      case 'ARRAY': {
        const elements = node.elements.map((id) => context.node(id, node));
        const requirements = context.structural(node, 'array-literal', elements);
        return compose(
          context,
          elements.map((element) => lowerExpression(context, element)),
          (values) =>
            // An empty Array holds Variants: its type is not inferred from nothing.
            values.length === 0
              ? { kind: 'as-expression', expression: { kind: 'array-expression', elements: [] }, type: { kind: 'array-type', element: ANY }, span: span(context.script, node) }
              : { kind: 'array-expression', elements: values, span: span(context.script, node) },
          requirements,
        );
      }
      case 'DICTIONARY': {
        const keyNodes = node.elements.map((entry) => context.node(entry.key, node));
        const valueNodes = node.elements.map((entry) => context.node(entry.value, node));
        const requirements = context.structural(
          node,
          'dictionary-object-literal',
          node.elements.flatMap((_, index) => [
            keyNodes[index] as GodotBoundNode,
            valueNodes[index] as GodotBoundNode,
          ]),
          `dictionary-object-literal:${node.style}`,
        );
        // Keys and values evaluate in source order: key, value, key, value.
        return compose(
          context,
          node.elements.flatMap((_, index) => [
            lowerExpression(context, keyNodes[index] as GodotBoundNode),
            lowerExpression(context, valueNodes[index] as GodotBoundNode),
          ]),
          (values) =>
            dictionaryMap(
              context,
              node,
              node.elements.map(
                (_, index) =>
                  [values[index * 2] as TargetTsExpression, values[index * 2 + 1] as TargetTsExpression] as const,
              ),
            ),
          requirements,
        );
      }
      case 'UNARY_OPERATOR': {
        const operandNode = context.node(node.operand, node);
        const rule = context.selectRule(node, operatorRuleKeys(node), [operandNode], [
          'unary',
          'binding',
          'integer-negate',
          'object-truthy',
          'variant-operator',
        ]);
        const recipe = rule.recipe;
        if (recipe.kind === 'variant-operator') {
          return compose(
            context,
            [lowerExpression(context, operandNode)],
            ([operand]) => ({
              kind: 'call-expression',
              callee: { kind: 'identifier-expression', name: 'godot_variant_evaluate' },
              arguments: [{ kind: 'literal-expression', value: node.variantOperatorId }, operand as TargetTsExpression],
              span: span(context.script, node),
            }),
            [...rule.requirements, { kind: 'compat-import-requirement', module: 'lib/godot-compat/variant-operator', imported: 'godot_variant_evaluate', local: 'godot_variant_evaluate', typeOnly: false } as const],
          );
        }
        if (recipe.kind === 'object-truthy') {
          return compose(
            context,
            [lowerExpression(context, operandNode)],
            ([operand]) => objectCall('godot_object_truthy', [operand as TargetTsExpression], recipe.negate, span(context.script, node)),
            [...rule.requirements, objectImport('godot_object_truthy')],
          );
        }
        if (recipe.kind === 'integer-negate') {
          // An int negation never yields -0: `0 - x`.
          return compose(
            context,
            [lowerExpression(context, operandNode)],
            ([operand]) => ({
              kind: 'binary-expression',
              operator: '-',
              left: { kind: 'literal-expression', value: 0 },
              right: operand as TargetTsExpression,
              span: span(context.script, node),
            }),
            rule.requirements,
          );
        }
        if (recipe.kind === 'binding') {
          const use = operatorBinding(context, node, operandNode, undefined);
          return compose(
            context,
            [lowerExpression(context, operandNode)],
            (values) => bindingCall(context, node, use, values),
            [...rule.requirements, ...use.requirements],
          );
        }
        if (recipe.kind !== 'unary') return context.refuse(node, 'unreachable unary recipe');
        const operand = lowerExpression(context, operandNode);
        if (recipe.operator === '!') {
          // `not` is the falsehood of its operand's truth (`Variant::booleanize`).
          const falsehood = lowerTruth(context, operandNode, operand, true, span(context.script, node));
          return { ...falsehood, requirements: [...rule.requirements, ...falsehood.requirements] };
        }
        return compose(
          context,
          [operand],
          ([operand]) => ({
            kind: 'unary-expression',
            operator: recipe.operator,
            operand: operand as TargetTsExpression,
            span: span(context.script, node),
          }),
          rule.requirements,
        );
      }
      case 'BINARY_OPERATOR': {
        const leftNode = context.node(node.leftOperand, node);
        const rightNode = context.node(node.rightOperand, node);
        const rule = context.selectRule(node, operatorRuleKeys(node), [leftNode, rightNode], [
          'binary',
          'binding',
          'integer-binary',
          'object-equal',
          'variant-equal',
          'variant-operator',
        ]);
        const recipe = rule.recipe;
        if (recipe.kind === 'variant-operator') {
          return compose(
            context,
            [lowerExpression(context, leftNode), lowerExpression(context, rightNode)],
            ([leftValue, rightValue]) => ({
              kind: 'call-expression',
              callee: { kind: 'identifier-expression', name: 'godot_variant_evaluate' },
              arguments: [{ kind: 'literal-expression', value: node.variantOperatorId }, leftValue as TargetTsExpression, rightValue as TargetTsExpression],
              span: span(context.script, node),
            }),
            [...rule.requirements, { kind: 'compat-import-requirement', module: 'lib/godot-compat/variant-operator', imported: 'godot_variant_evaluate', local: 'godot_variant_evaluate', typeOnly: false } as const],
          );
        }
        if (recipe.kind === 'variant-equal') {
          return compose(
            context,
            [lowerExpression(context, leftNode), lowerExpression(context, rightNode)],
            ([leftValue, rightValue]) => objectCall('godot_variant_equal', [leftValue as TargetTsExpression, rightValue as TargetTsExpression], recipe.negate, span(context.script, node)),
            [...rule.requirements, { kind: 'compat-import-requirement', module: 'lib/godot-compat/variant-equal', imported: 'godot_variant_equal', local: 'godot_variant_equal', typeOnly: false }],
          );
        }
        if (recipe.kind === 'object-equal') {
          return compose(
            context,
            [lowerExpression(context, leftNode), lowerExpression(context, rightNode)],
            ([leftValue, rightValue]) => objectCall('godot_object_equal', [leftValue as TargetTsExpression, rightValue as TargetTsExpression], recipe.negate, span(context.script, node)),
            [...rule.requirements, objectImport('godot_object_equal')],
          );
        }
        if (recipe.kind === 'binding') {
          const use = operatorBinding(context, node, leftNode, rightNode);
          return compose(
            context,
            [lowerExpression(context, leftNode), lowerExpression(context, rightNode)],
            (values) => bindingCall(context, node, use, values),
            [...rule.requirements, ...use.requirements],
          );
        }
        if (recipe.kind === 'integer-binary') {
          // GDScript int arithmetic on JS numbers: `/` truncates toward zero, and a result is
          // never -0 (an int has no sign on zero; `+ 0` turns -0 into 0).
          return compose(
            context,
            [lowerExpression(context, leftNode), lowerExpression(context, rightNode)],
            ([leftValue, rightValue]) => {
              const raw: TargetTsExpression = {
                kind: 'binary-expression',
                operator: recipe.operator,
                left: leftValue as TargetTsExpression,
                right: rightValue as TargetTsExpression,
              };
              return {
                kind: 'binary-expression',
                operator: '+',
                left:
                  recipe.operator === '/'
                    ? {
                        kind: 'call-expression',
                        callee: {
                          kind: 'property-expression',
                          object: { kind: 'identifier-expression', name: 'Math' },
                          property: 'trunc',
                        },
                        arguments: [raw],
                      }
                    : { kind: 'parenthesized-expression', expression: raw },
                right: { kind: 'literal-expression', value: 0 },
                span: span(context.script, node),
              };
            },
            rule.requirements,
          );
        }
        if (recipe.kind !== 'binary') return context.refuse(node, 'unreachable binary recipe');
        // `and` and `or` test each operand's truth (`Variant::booleanize`) and yield a bool.
        const logic = recipe.operator === '&&' || recipe.operator === '||';
        const left = logic ? lowerTruth(context, leftNode, lowerExpression(context, leftNode)) : lowerExpression(context, leftNode);
        const right = logic ? lowerTruth(context, rightNode, lowerExpression(context, rightNode)) : lowerExpression(context, rightNode);
        if (recipe.operator === '&&' || recipe.operator === '||' || recipe.operator === '??') {
          const settledLeft = settle(context, left);
          if ((recipe.operator === '&&' || recipe.operator === '||') && (right.before.length > 0 || right.after.length > 0)) {
            // A right operand that needs statements runs them only when GDScript evaluates it
            // (the jump `and`/`or` compile to, `GDScriptCompiler::_parse_expression`): the result
            // is the left value, replaced by the right one when the left does not decide it.
            const settledRight = settle(context, right);
            const name = context.temporary();
            const read: TargetTsExpression = { kind: 'identifier-expression', name };
            return {
              before: [
                ...settledLeft.before,
                ...settledLeft.after,
                { kind: 'variable-statement', declaration: 'let', name, initializer: settledLeft.value },
                {
                  kind: 'if-statement',
                  condition: recipe.operator === '&&' ? read : { kind: 'unary-expression', operator: '!', operand: read },
                  then: [
                    ...settledRight.before,
                    { kind: 'expression-statement', expression: { kind: 'assignment-expression', operator: '=', target: read, value: settledRight.value } },
                  ],
                },
              ],
              value: read,
              after: [],
              requirements: [...rule.requirements, ...settledLeft.requirements, ...settledRight.requirements],
            };
          }
          return {
            before: settledLeft.before,
            value: {
              kind: 'binary-expression',
              operator: recipe.operator,
              left: settledLeft.value,
              right: inlineValue(context, rightNode, right),
              span: span(context.script, node),
            },
            after: settledLeft.after,
            requirements: [
              ...rule.requirements,
              ...settledLeft.requirements,
              ...right.requirements,
            ],
          };
        }
        return compose(
          context,
          [left, right],
          ([leftValue, rightValue]) => ({
            kind: 'binary-expression',
            operator: recipe.operator,
            left: leftValue as TargetTsExpression,
            right: rightValue as TargetTsExpression,
            span: span(context.script, node),
          }),
          rule.requirements,
        );
      }
      case 'ASSIGNMENT': {
        const assigneeNode = context.node(node.assignee, node);
        const valueNode = context.node(node.assignedValue, node);
        // A converting assignment (`write_assign_with_conversion`) has its own rule per
        // (target type, value type): int into float is the identity on JS numbers, float into
        // int is not and has no rule.
        const exactKey = `operator:${node.operation}:${String(node.variantOperatorId)}${
          (node.useConversionAssign && assigneeNode.datatype.kind !== 'BUILTIN') ||
          (node.operation === 'OP_NONE' && builtinConversion(assigneeNode, valueNode))
            ? ':conversion'
            : ''
        }`;
        // A compound assignment evaluates its Variant operator like the binary one does.
        const rule = context.selectRule(
          node,
          node.operation === 'OP_NONE' ? [exactKey] : [exactKey, 'operator:variant-evaluate'],
          [assigneeNode, valueNode],
          ['assignment', 'binding', 'variant-operator'],
        );
        const recipe = rule.recipe;
        if (recipe.kind === 'variant-operator') {
          return assignment(
            context,
            node,
            (read, value) =>
              expression({
                kind: 'call-expression',
                callee: { kind: 'identifier-expression', name: 'godot_variant_evaluate' },
                arguments: [{ kind: 'literal-expression', value: node.variantOperatorId }, read, value],
              }),
            assigneeNode,
            lowerExpression(context, valueNode),
            lowerExpression,
            [...rule.requirements, { kind: 'compat-import-requirement', module: 'lib/godot-compat/variant-operator', imported: 'godot_variant_evaluate', local: 'godot_variant_evaluate', typeOnly: false } as const],
          );
        }
        if (recipe.kind === 'binding') {
          const use = operatorBinding(context, node, assigneeNode, valueNode);
          return assignment(
            context,
            node,
            (read, value) => expression(bindingCall(context, node, use, [read, value])),
            assigneeNode,
            lowerExpression(context, valueNode),
            lowerExpression,
            [...rule.requirements, ...use.requirements],
          );
        }
        if (recipe.kind !== 'assignment')
          return context.refuse(node, 'unreachable assignment recipe');
        const binaryOperator = assignmentBinaryOperator(recipe.operator);
        return assignment(
          context,
          node,
          binaryOperator === undefined
            ? undefined
            : (read, value) => expression({ kind: 'binary-expression', operator: binaryOperator, left: read, right: value }),
          assigneeNode,
          node.operation === 'OP_NONE'
            ? convertedValue(context, assigneeNode, valueNode, lowerExpression(context, valueNode))
            : lowerExpression(context, valueNode),
          lowerExpression,
          rule.requirements,
        );
      }
      case 'SUBSCRIPT': {
        const baseNode = context.node(node.base, node);
        if (node.isAttribute && baseNode.kind === 'IDENTIFIER' && baseNode.source === 'NATIVE_CLASS') {
          // `RenderingServer.SHADOW_QUALITY_SOFT_HIGH`: a ClassDB integer constant is its value.
          const value = context.nativeConstant(
            baseNode.name,
            officialBoundPropertyName(context, node.attribute, node),
          );
          if (value !== undefined) {
            const rule = context.structural(node, 'literal', [], 'literal:native-constant');
            return expression(
              { kind: 'literal-expression', value, span: span(context.script, node) },
              rule,
            );
          }
        }
        if (
          node.isAttribute &&
          baseNode.kind === 'IDENTIFIER' &&
          baseNode.datatype.kind === 'BUILTIN' &&
          baseNode.datatype.metaType
        ) {
          // `Vector3.UP`: a built-in type's constant, bound as a value.
          const rule = context.selectRule(node, ['subscript-attribute:builtin-constant'], [], [
            'binding',
          ]);
          const use = context.bindingUse(
            {
              sourceRevision: context.sourceRevision,
              kind: 'builtin-constant',
              owner: baseNode.datatype.builtinType,
              member: officialBoundPropertyName(context, node.attribute, node),
              signature: 'constant',
            },
            node,
          );
          if (use.target.use.kind !== 'value') {
            return context.refuse(node, `constant binding ${use.target.localName} is not a value`);
          }
          return expression(
            { ...boundTargetExpression(use.target), span: span(context.script, node) },
            [...rule.requirements, ...use.requirements],
          );
        }
        // A member of a value whose class only the run time knows: selected by name then.
        if (node.isAttribute && !context.plainCallees.has(node.id) && namedAttribute(context, baseNode, officialBoundPropertyName(context, node.attribute, node))) {
          return namedRead(context, node, baseNode, officialBoundPropertyName(context, node.attribute, node), lowerExpression);
        }
        // On a native object, or a script instance whose script does not declare the name (its
        // native base's signal, as its properties are).
        // An engine singleton's signal (`RenderingServer.frame_post_draw`) is read as an object's is,
        // the singleton's value its receiver.
        const singleton = baseNode.kind === 'IDENTIFIER' && baseNode.source === 'NATIVE_CLASS' && baseNode.datatype.kind === 'NATIVE' && baseNode.datatype.metaType;
        const signalOwner =
          node.isAttribute && (singleton || nativeMemberReceiver(context, baseNode, officialBoundPropertyName(context, node.attribute, node)))
            ? context.nativeSignalOwner?.(baseNode.datatype.nativeType, officialBoundPropertyName(context, node.attribute, node))
            : undefined;
        if (signalOwner !== undefined) {
          // An engine signal read as a value (`player.finished`): Signal(object, name)
          // (`ClassDB::get_property`, class_db.cpp:1660), through the class's accessor on the entity.
          const signal = officialBoundPropertyName(context, node.attribute, node);
          const rule = context.selectRule(node, ['subscript-attribute:native-signal'], [baseNode], ['binding']);
          const use = context.bindingUse(
            { sourceRevision: context.sourceRevision, kind: 'native-signal', owner: signalOwner, member: signal, signature: 'signal' },
            node,
          );
          if (use.target.use.kind !== 'call' || use.target.use.sourceReceiver !== 'first-argument') {
            return context.refuse(node, `signal binding ${use.target.localName} does not take its object first`);
          }
          return compose(
            context,
            [singleton ? lowerExpression(context, baseNode) : nativeEntity(lowerExpression(context, baseNode))],
            (values) => bindingCall(context, node, use, values),
            [...rule.requirements, ...use.requirements],
          );
        }
        if (node.isAttribute && nativeMemberReceiver(context, baseNode, officialBoundPropertyName(context, node.attribute, node))) {
          const property = officialBoundPropertyName(context, node.attribute, node);
          const getter = nativeAccessorUse(context, node, baseNode, property, 'getter');
          if (getter !== undefined) {
            const rule = context.selectRule(node, ['subscript-attribute:native-property'], [
              baseNode,
            ], ['binding']);
            return compose(
              context,
              [nativeEntity(lowerExpression(context, baseNode))],
              (values) => bindingCall(context, node, getter, values),
              [...rule.requirements, ...getter.requirements],
            );
          }
        }
        const keyed = godotBuiltinSubscriptShape(baseNode.datatype);
        if (node.isAttribute && keyed?.kind === 'keyed-entry' && node.datatype.kind !== 'VARIANT') {
          // `d.key` on a Dictionary whose key schema the analysis fixed (`ray-result-schema`) reads
          // the key (`Variant::get_named`, variant_setget.cpp:291) through `Dictionary.get`. An
          // untyped Dictionary's named read stays refused (no rule takes a Variant result).
          const rule = context.selectRule(node, ['subscript-attribute:dictionary-key'], [baseNode], ['binding']);
          const use = dictionaryMethod(context, node, keyed, 'getter');
          const key = officialBoundPropertyName(context, node.attribute, node);
          return compose(
            context,
            [lowerExpression(context, baseNode)],
            (values) => bindingCall(context, node, use, [...values, { kind: 'literal-expression', value: key }]),
            [...rule.requirements, ...use.requirements],
          );
        }
        const base = lowerExpression(context, baseNode);
        if (node.isAttribute) {
          const requirements = context.structural(node, 'subscript-attribute', [baseNode]);
          const nullable = nullableObject(context, baseNode);
          return compose(
            context,
            [base],
            ([object]) => ({
              kind: 'property-expression',
              object: nullable ? { kind: 'non-null-expression', expression: object as TargetTsExpression } : (object as TargetTsExpression),
              property: officialBoundPropertyName(context, node.attribute, node),
              span: span(context.script, node),
            }),
            requirements,
          );
        }
        const parameter = treeParameter(context, node);
        if (parameter !== undefined) {
          const rule = context.selectRule(node, ['subscript-element:tree-parameter'], [parameter.baseNode, parameter.indexNode], ['binding'], false);
          return compose(
            context,
            [nativeEntity(base)],
            ([object]) => ({
              kind: 'call-expression',
              callee: { kind: 'identifier-expression', name: 'godot_animation_tree_parameter' },
              arguments: [object as TargetTsExpression, { kind: 'literal-expression', value: parameter.path }],
            }),
            [...rule.requirements, treeProtocol('godot_animation_tree_parameter')],
          );
        }
        const indexNode = context.node(node.index, node);
        const shape = godotBuiltinSubscriptShape(baseNode.datatype);
        const indexed = shape?.kind === 'indexed-member' ? shape.members : undefined;
        if (indexed !== undefined && indexNode.kind === 'LITERAL' && indexNode.value.kind === 'int') {
          // A built-in's constant in-range index reads the member at that place
          // (`VariantIndexedSetGet_*`, variant_setget.cpp:847-857).
          const member = indexed[Number(indexNode.value.value)];
          if (member === undefined) return context.refuse(node, `index ${indexNode.value.value} is out of range`);
          const rule = context.structural(node, 'subscript-element', [baseNode, indexNode], 'subscript-element:indexed-member');
          return compose(
            context,
            [base],
            ([object]) => ({
              kind: 'property-expression',
              object: object as TargetTsExpression,
              property: member,
              span: span(context.script, node),
            }),
            rule,
          );
        }
        const element = dictionaryElement(context, node);
        if (element !== undefined) {
          const rule = context.selectRule(node, ['subscript-element:dictionary'], [baseNode, indexNode], ['binding']);
          const use = dictionaryMethod(context, node, element.shape, 'getter');
          return compose(
            context,
            [base, lowerExpression(context, indexNode)],
            (values) => bindingCall(context, node, use, values),
            [...rule.requirements, ...use.requirements],
          );
        }
        if (shape?.kind === 'array-element') {
          // Variant indexing counts a negative index from the end, as `Array.prototype.at` does; a
          // constant non-negative index is the element itself.
          const rule = context.structural(node, 'subscript-element', [baseNode, indexNode], 'subscript-element:array');
          const constant = indexNode.kind === 'LITERAL' && indexNode.value.kind === 'int' && Number(indexNode.value.value) >= 0;
          return compose(
            context,
            [base, lowerExpression(context, indexNode)],
            ([object, index]) =>
              constant
                ? { kind: 'element-expression', object: object as TargetTsExpression, index: index as TargetTsExpression, span: span(context.script, node) }
                : {
                    kind: 'call-expression',
                    callee: { kind: 'property-expression', object: object as TargetTsExpression, property: 'at' },
                    arguments: [index as TargetTsExpression],
                    span: span(context.script, node),
                  },
            rule,
          );
        }
        if (baseNode.datatype.kind === 'VARIANT') {
          // An untyped base is keyed by what it holds at run time (`OPCODE_GET_KEYED`).
          const rule = context.structural(node, 'subscript-element', [baseNode, indexNode], 'subscript-element:variant');
          // What analysis typed the element as, TS is told (the read itself is untyped).
          const stated = node.datatype.kind !== 'VARIANT' && godotStatedValueType(node.datatype) ? context.targetType(node) : undefined;
          return compose(
            context,
            [base, lowerExpression(context, indexNode)],
            ([object, index]) => {
              const read = variantIndexCall('godot_variant_get', [object as TargetTsExpression, index as TargetTsExpression], span(context.script, node));
              return stated === undefined ? read : { kind: 'as-expression', expression: read, type: stated.type };
            },
            [...rule, variantIndexImport('godot_variant_get'), ...(stated?.requirements ?? [])],
          );
        }
        const requirements = context.structural(node, 'subscript-element', [baseNode, indexNode]);
        return compose(
          context,
          [base, lowerExpression(context, indexNode)],
          ([object, index]) => ({
            kind: 'element-expression',
            object: object as TargetTsExpression,
            index: index as TargetTsExpression,
            span: span(context.script, node),
          }),
          requirements,
        );
      }
      case 'CALL': {
        const calleeNode = context.node(node.callee, node);
        const argumentNodes = node.arguments.map((id) => context.node(id, node));
        const requirements = context.structural(
          node,
          'call',
          [calleeNode, ...argumentNodes],
          `call:${node.static ? 'static' : 'instance'}`,
        );
        // `get_node("Path")` on self for a path the plan resolved is the node its scene handed
        // over (`script-node-paths.ts`), as `$Path` is.
        const selfPath = context.selfNodePaths.get(node.id);
        const handed = selfPath === undefined ? undefined : context.nodeFields.get(selfPath);
        if (handed !== undefined) {
          return expression({ kind: 'property-expression', object: { kind: 'this-expression' }, property: handed, span: span(context.script, node) }, requirements);
        }
        const stringifying = context.utilityShapes.get(node.id) === 'stringifies';
        const lowered = argumentNodes.map((argument) =>
          stringifying ? stringifiedArgument(context, node, argument, lowerExpression(context, argument)) : lowerExpression(context, argument),
        );
        const loads = node.compilerTarget.kind === 'gdscript-utility' ? context.resourceLoads.get(node.id) : undefined;
        if (loads !== undefined && lowered.length === 1) {
          // `load(path)` over the paths the program fixes: the module's record of every resolved
          // load (`resourceTable`) looked up by the path, null where no file is there
          // (`ResourceLoader::load` finds none).
          const path = materialize(context, lowered[0] as LoweredExpression);
          const table = resourceTable(context);
          const lookup: TargetTsExpression = { kind: 'element-expression', object: { kind: 'identifier-expression', name: table.local }, index: path.value };
          return {
            before: path.before,
            value: {
              kind: 'parenthesized-expression',
              expression: { kind: 'binary-expression', operator: '??', left: lookup, right: { kind: 'literal-expression', value: null } },
              span: span(context.script, node),
            },
            after: [],
            requirements: [...requirements, ...path.requirements, ...table.requirements],
          };
        }
        // `ResourceLoader.load` / `ResourceSaver.save`: the project's resources and the page's storage.
        const nativeShape =
          node.compilerTarget.kind === 'native-method' || node.compilerTarget.kind === 'native-static'
            ? godotCallShape(node.compilerTarget.owner, node.compilerTarget.member)
            : node.compilerTarget.kind === 'gdscript-utility'
              ? godotCallShape('@GDScript', node.compilerTarget.member)
              : undefined;
        if (nativeShape === 'resource-load' || nativeShape === 'resource-save') {
          return resourceCall(context, node, nativeShape, argumentNodes, lowered, requirements);
        }
        // A change to a copied built-in array: the changed copy stored back where the array came from.
        const builtinShape = node.compilerTarget.kind === 'builtin-member' ? godotCallShape(node.compilerTarget.owner, node.compilerTarget.member) : undefined;
        if (builtinShape === 'copied-mutator' && calleeNode.kind === 'SUBSCRIPT' && calleeNode.isAttribute) {
          const use = callTargetBinding(context, node);
          if (use === undefined) return context.refuse(node, `${node.functionName} has no binding`);
          const place = assignablePlace(context, context.node(calleeNode.base, calleeNode), lowerExpression);
          const values = eagerValues(context, lowered);
          return {
            before: [...place.before, ...values.before, ...place.afterAssigned],
            value: place.write(bindingCall(context, node, use, [place.read, ...values.values])),
            after: [],
            requirements: [...requirements, ...use.requirements, ...place.requirements, ...values.requirements],
          };
        }
        // An AnimationTree's parameter by name, as its subscript is (`treeParameterCall`).
        const treeCall = treeParameterCall(context, node, calleeNode, argumentNodes);
        if (treeCall !== undefined) {
          const base = lowerExpression(context, treeCall.baseNode);
          const callee = treeCall.write ? 'godot_animation_tree_set_parameter' : 'godot_animation_tree_parameter';
          return compose(
            context,
            [nativeEntity(base), ...lowered.slice(1)],
            ([object, ...values]) => ({
              kind: 'call-expression',
              callee: { kind: 'identifier-expression', name: callee },
              arguments: [object as TargetTsExpression, { kind: 'literal-expression', value: treeCall.path }, ...(values as TargetTsExpression[])],
              span: span(context.script, node),
            }),
            [...requirements, treeProtocol(callee)],
          );
        }
        // `Script.new(...)`: the script's instance over a new object of its native root class.
        if (calleeNode.kind === 'SUBSCRIPT' && calleeNode.isAttribute && node.functionName === 'new') {
          const classNode = context.node(calleeNode.base, calleeNode);
          const datatype = classNode.datatype;
          if ((datatype.kind === 'CLASS' || datatype.kind === 'SCRIPT') && datatype.metaType && datatype.scriptPath !== '') {
            return scriptNew(context, node, datatype.scriptPath, lowered, requirements);
          }
        }
        // `TerrainGenerator.flat(position)`: a static function of a global script class, called on
        // its generated class (`GDScriptCompiler::_parse_expression` CALL on a class, gdscript_compiler.cpp:651).
        if (calleeNode.kind === 'SUBSCRIPT' && calleeNode.isAttribute) {
          const classNode = context.node(calleeNode.base, calleeNode);
          const datatype = classNode.datatype;
          if (classNode.kind === 'IDENTIFIER' && (datatype.kind === 'CLASS' || datatype.kind === 'SCRIPT') && datatype.metaType && datatype.scriptPath !== '') {
            const receiver = lowerExpression(context, classNode);
            return compose(
              context,
              [receiver, ...lowered],
              ([receiverValue, ...argumentValues]) => ({
                kind: 'call-expression',
                callee: { kind: 'property-expression', object: receiverValue as TargetTsExpression, property: node.functionName, span: span(context.script, calleeNode) },
                arguments: argumentValues as TargetTsExpression[],
                span: span(context.script, node),
              }),
              requirements,
            );
          }
        }
        // A method of a value whose class only the run time knows: selected by name then.
        if (
          (node.compilerTarget.kind === 'dynamic' || node.compilerTarget.kind === 'unresolved') &&
          !context.callReceivers.has(node.id) &&
          context.untypedCalls.has(node.id) &&
          !context.scriptSwitches.has(node.id) &&
          calleeNode.kind === 'SUBSCRIPT' &&
          calleeNode.isAttribute
        ) {
          return namedCall(context, node, context.node(calleeNode.base, calleeNode), argumentNodes, lowered, requirements, lowerExpression);
        }
        const target = callTargetBinding(context, node);
        // `Object.has_method(name)` answers from the script chain first, then ClassDB. Compat answers
        // the script chain (`object.ts`); a name some engine class declares, or one only known at run
        // time, would need ClassDB at run time and is refused by name.
        const selected = node.compilerTarget.kind === 'native-method' ? node.compilerTarget : context.callReceivers.get(node.id)?.target;
        const shape = selected === undefined ? undefined : godotCallShape(selected.owner, selected.member);
        // A tweened property's object is its native entity, and the property's accessors follow the
        // call's own arguments (`tweenedProperty`). A timer or tween is owned by the script that makes
        // it, which the binding takes right after the receiver (`creator-owned`).
        const args =
          shape === 'tweened-property' && lowered[0] !== undefined
            ? [nativeEntity(lowered[0]), ...lowered.slice(1), tweenedProperty(context, node, argumentNodes)]
            : shape === 'creator-owned'
              ? [expression({ kind: 'this-expression', span: span(context.script, node) }), ...lowered]
              : lowered;
        if (shape === 'script-chain-method') {
          const argument = argumentNodes[0];
          const name = argument?.kind === 'LITERAL' && (argument.value.kind === 'string' || argument.value.kind === 'string-name') ? argument.value.value : undefined;
          if (name === undefined) return context.refuse(node, 'has_method of a name only known at run time needs ClassDB at run time');
          const declared = context.nativeMethod('*', name);
          if (declared !== undefined) return context.refuse(node, `has_method("${name}"): the engine class ${declared.owner} declares ${name}, which compat's script-chain answer does not see`);
        }
        if (
          calleeNode.kind === 'SUBSCRIPT' &&
          calleeNode.isAttribute &&
          calleeNode.base >= 0 &&
          node.functionName === 'new'
        ) {
          const classNode = context.node(calleeNode.base, calleeNode);
          if (classNode.kind === 'IDENTIFIER' && classNode.source === 'NATIVE_CLASS') {
            const result = boundCallWithoutReceiver(
              context,
              node,
              nativeClassBinding(context, classNode),
              args,
            );
            return { ...result, requirements: [...requirements, ...result.requirements] };
          }
        }
        if (target !== undefined) {
          const typedReceiver = context.callReceivers.get(node.id);
          const nativeMember =
            node.compilerTarget.kind === 'native-method' ||
            typedReceiver?.target.kind === 'native-member';
          if (
            node.compilerTarget.kind === 'native-method' ||
            node.compilerTarget.kind === 'builtin-member' ||
            typedReceiver !== undefined
          ) {
            if (calleeNode.kind === 'SUBSCRIPT' && calleeNode.isAttribute) {
              const receiverNode = context.node(calleeNode.base, calleeNode);
              if (
                receiverNode.kind === 'IDENTIFIER' &&
                receiverNode.source === 'NATIVE_CLASS' &&
                target.target.use.kind === 'call' &&
                target.target.use.sourceReceiver === 'absent'
              ) {
                // An engine singleton's method (`Input.is_action_pressed`): the singleton is the
                // one object of its class (`Engine::get_singleton_object`), so its binding takes
                // the arguments alone and the singleton identifier lowers to nothing.
                const singleton = context.structural(receiverNode, 'singleton', [], 'singleton');
                const result = boundCallWithoutReceiver(context, node, target, args);
                return { ...result, requirements: [...requirements, ...singleton, ...result.requirements] };
              }
              const result = boundInstanceCall(
                context,
                node,
                receiverNode.kind === 'SELF' && target.target.kind === 'compat-binding' && nativeMember
                  ? expression(selfNative(context, receiverNode), context.structural(receiverNode, 'self'))
                  : target.target.kind === 'compat-binding' && nativeMember
                    ? nativeEntity(lowerExpression(context, receiverNode))
                    : lowerExpression(context, receiverNode),
                target,
                args,
              );
              return { ...result, requirements: [...requirements, ...result.requirements] };
            }
            const result = boundInstanceCall(
              context,
              node,
              expression(
                target.target.kind === 'compat-binding' && nativeMember
                  ? selfNative(context, node)
                  : { kind: 'this-expression', span: span(context.script, node) },
              ),
              target,
              args,
            );
            return { ...result, requirements: [...requirements, ...result.requirements] };
          }
          const result = boundCallWithoutReceiver(context, node, target, args);
          return { ...result, requirements: [...requirements, ...result.requirements] };
        }
        if (
          calleeNode.kind === 'IDENTIFIER' &&
          (node.compilerTarget.kind === 'script-self' || node.compilerTarget.kind === 'script-class')
        ) {
          // A call to the script's own function: `call_self` dispatches on the instance (the most
          // derived script's function), a static or class call on the script class
          // (`GDScriptCompiler::_parse_expression` CALL, gdscript_compiler.cpp:640 and :651).
          const callee: TargetTsExpression = {
            kind: 'property-expression',
            object:
              node.compilerTarget.kind === 'script-self'
                ? { kind: 'this-expression' }
                : { kind: 'identifier-expression', name: context.classIdentifier },
            property: officialBoundPropertyName(context, calleeNode.id, node),
            span: span(context.script, calleeNode),
          };
          return compose(
            context,
            args,
            (argumentValues) => ({
              kind: 'call-expression',
              callee,
              // An object that may be null is passed as the object the parameter types: GDScript
              // passes null to an object parameter, which TS states present.
              arguments: argumentValues.map((value, index) => {
                const argument = argumentNodes[index];
                return argument !== undefined && nullableObject(context, argument) ? { kind: 'non-null-expression', expression: value } : value;
              }),
              span: span(context.script, node),
            }),
            requirements,
          );
        }
        const switched = context.scriptSwitches.get(node.id);
        if (switched !== undefined && calleeNode.kind === 'SUBSCRIPT' && calleeNode.isAttribute) {
          // The project scripts that declare the method, tried in turn; any other receiver is
          // Godot's "Nonexistent function" error (`godot_script_call`).
          const classes = switched.map((resPath) => {
            const found = context.scriptClass?.(resPath);
            if (found === undefined) return context.refuse(node, `${resPath} names no generated script class`);
            return found;
          });
          const receiver = lowerExpression(context, context.node(calleeNode.base, calleeNode));
          return compose(
            context,
            [receiver, ...args],
            ([receiverValue, ...argumentValues]) => ({
              kind: 'call-expression',
              callee: { kind: 'identifier-expression', name: 'godot_script_call' },
              arguments: [
                receiverValue as TargetTsExpression,
                { kind: 'literal-expression', value: node.functionName },
                { kind: 'array-expression', elements: classes.map((found) => ({ kind: 'identifier-expression' as const, name: found.name })) },
                { kind: 'array-expression', elements: argumentValues as TargetTsExpression[] },
              ],
              span: span(context.script, node),
            }),
            [
              ...requirements,
              { kind: 'compat-import-requirement', module: 'lib/godot-compat/node', imported: 'godot_script_call', local: 'godot_script_call', typeOnly: false },
              ...classes.flatMap((found) => (found.module === undefined ? [] : [{ kind: 'project-import-requirement' as const, module: found.module, imported: found.name, local: found.name, typeOnly: false }])),
            ],
          );
        }
        // The callee is the call's own member, not a member read by name.
        context.plainCallees.add(calleeNode.id);
        const callee = lowerExpression(context, calleeNode);
        return dynamicCall(context, node, callee, args, requirements);
      }
      case 'AWAIT': {
        // `await signal` suspends the coroutine until the signal's next emission and resumes with
        // what it emitted (`OPCODE_AWAIT`, `gdscript_vm.cpp:2563`; `GDScriptFunctionState::_signal_callback`,
        // `gdscript_function.cpp:256`): a promise that one-shot connection resolves.
        const awaitedNode = context.node(node.toAwait, node);
        // A call of a coroutine (a script function that awaits) is its async method's promise,
        // awaited whatever the function returns.
        const requirements = context.structural(node, 'await', [awaitedNode], awaitedNode.datatype.coroutine ? 'await:coroutine' : 'await');
        // A coroutine's call is awaited as its promise, even when it returns a Signal. When the call
        // suspends, Godot awaits its function state and resumes with the returned value, which it
        // does not also await. Divergence: a call that returns a Signal without reaching an `await`
        // (an early return) is no function state in Godot, so the Signal itself is awaited until it
        // emits; here the promise resolves with the Signal and the caller resumes at once.
        const isSignal = !awaitedNode.datatype.coroutine && godotAwaitsEmission(awaitedNode.datatype);
        // A value only the run time types: awaited as what it holds (`godot_await_value`).
        if (!isSignal && !awaitedNode.datatype.coroutine && awaitedNode.datatype.kind === 'VARIANT') {
          return compose(
            context,
            [lowerExpression(context, awaitedNode)],
            ([awaited]) => ({
              kind: 'await-expression',
              expression: { kind: 'call-expression', callee: { kind: 'identifier-expression', name: 'godot_await_value' }, arguments: [awaited as TargetTsExpression] },
              span: span(context.script, node),
            }),
            [...requirements, { kind: 'compat-import-requirement', module: 'lib/godot-compat/signal', imported: 'godot_await_value', local: 'godot_await_value', typeOnly: false }],
          );
        }
        return compose(
          context,
          [lowerExpression(context, awaitedNode)],
          ([awaited]) => ({
            kind: 'await-expression',
            expression: isSignal
              ? { kind: 'call-expression', callee: { kind: 'identifier-expression', name: 'signalToPromise' }, arguments: [awaited as TargetTsExpression] }
              : (awaited as TargetTsExpression),
            span: span(context.script, node),
          }),
          [
            ...requirements,
            ...(isSignal ? [{ kind: 'compat-import-requirement', module: 'lib/godot-compat/signal', imported: 'signalToPromise', local: 'signalToPromise', typeOnly: false } as const] : []),
          ],
        );
      }
      case 'TERNARY_OPERATOR': {
        const conditionNode = context.node(node.condition, node);
        const trueNode = context.node(node.trueExpression, node);
        const falseNode = context.node(node.falseExpression, node);
        const requirements = context.structural(node, 'ternary', [
          conditionNode,
          trueNode,
          falseNode,
        ]);
        const condition = settle(context, lowerTruth(context, conditionNode, lowerExpression(context, conditionNode)));
        const whenTrue = lowerExpression(context, trueNode);
        const whenFalse = lowerExpression(context, falseNode);
        return {
          before: condition.before,
          value: {
            kind: 'conditional-expression',
            condition: condition.value,
            whenTrue: inlineValue(context, trueNode, whenTrue),
            whenFalse: inlineValue(context, falseNode, whenFalse),
            span: span(context.script, node),
          },
          after: condition.after,
          requirements: [
            ...requirements,
            ...condition.requirements,
            ...whenTrue.requirements,
            ...whenFalse.requirements,
          ],
        };
      }
      case 'LAMBDA': {
        const fn = context.node(node.function, node);
        if (fn.kind !== 'FUNCTION')
          return context.refuse(fn, 'lambda does not reference an official FUNCTION node');
        if (fn.restParameter >= 0) {
          return context.refuse(fn, 'lambda rest parameter needs a rest binding the lane does not lower');
        }
        if (fn.abstract) {
          return context.refuse(fn, 'abstract lambda has no direct target representation');
        }
        // A lambda captures its outer locals by value when it is created (`GDScriptLambdaCallable`,
        // `modules/gdscript/gdscript_lambda_callable.cpp:39`); an arrow function captures the
        // binding, which reads the same while no captured local is ever assigned again. `self` is
        // the arrow's own `this`.
        if (reassignedCapture(context, node) !== undefined) {
          return context.refuse(
            node,
            `captured lambda needs a by-value capture of '${String(reassignedCapture(context, node))}', which is assigned again`,
          );
        }
        const requirements = context.structural(
          node,
          'lambda',
          [fn],
          `lambda:${fn.coroutine ? 'coroutine' : 'synchronous'}`,
        );
        const functionRequirements = context.structural(
          fn,
          'function',
          [],
          `function:${fn.static ? 'static' : 'instance'}:${
            fn.coroutine ? 'coroutine' : 'synchronous'
          }`,
        );
        const loweredParameters = parameters(context, fn);
        // A typed lambda's returns convert to its return type as a function's do; the arrow's own
        // type is what they return.
        const returnNode = fn.returnType < 0 ? undefined : context.node(fn.returnType, fn);
        const body = context.withReturnType(returnNode, () => lowerSuite(context, context.node(fn.body, fn)));
        return expression(
          {
            kind: 'arrow-expression',
            parameters: loweredParameters.parameters,
            body: body.statements,
            ...(fn.coroutine ? { async: true as const } : {}),
            span: span(context.script, node),
          },
          [
            ...requirements,
            ...functionRequirements,
            ...loweredParameters.requirements,
            ...body.requirements,
          ],
        );
      }
      case 'CAST': {
        // `value as T` on an object type: the value when its class or script is T, else null
        // (`OPCODE_CAST_TO_NATIVE` / `OPCODE_CAST_TO_SCRIPT`), through the Node protocol.
        const operandNode = context.node(node.operand, node);
        // A cast analysis proves always holds is the value itself (`provenCasts`), which the typed
        // read states as the class.
        if (context.provenCasts.has(node.id)) {
          const requirements = context.structural(node, 'cast', [operandNode], 'cast:native');
          const operand = lowerExpression(context, operandNode);
          return { ...operand, requirements: [...operand.requirements, ...requirements] };
        }
        // `value as Enum`: an enum is its int, so the value is itself (`GDScriptAnalyzer::reduce_cast`
        // allows an int or an enum there, gdscript_analyzer.cpp:3780, and the VM converts nothing).
        if (node.datatype.kind === 'ENUM' && !node.datatype.metaType) {
          const requirements = context.structural(node, 'cast', [operandNode], 'cast:enum');
          const operand = lowerExpression(context, operandNode);
          return { ...operand, requirements: [...operand.requirements, ...requirements] };
        }
        const test = objectTypeTest(context, node, node.datatype, 'cast');
        const requirements = context.structural(node, 'cast', [operandNode], `cast:${test.kind}`);
        return compose(
          context,
          [lowerExpression(context, operandNode)],
          ([value]) => ({
            kind: 'call-expression',
            callee: { kind: 'identifier-expression', name: test.kind === 'script' ? 'godot_as_script' : 'godot_as_native' },
            arguments: [value as TargetTsExpression, test.argument],
            span: span(context.script, node),
          }),
          [...requirements, ...test.requirements],
        );
      }
      case 'TYPE_TEST': {
        // `value is T` on an object type (`OPCODE_TYPE_TEST_NATIVE` / `_SCRIPT`), through the Node
        // protocol: the class the scene recorded for its entity, or its script instance's class.
        const operandNode = context.node(node.operand, node);
        const test = objectTypeTest(context, node, node.testDatatype, 'is');
        const requirements = context.structural(node, 'type-test', [operandNode], `type-test:${test.kind}`);
        return compose(
          context,
          [lowerExpression(context, operandNode)],
          ([value]) => ({
            kind: 'call-expression',
            callee: { kind: 'identifier-expression', name: test.kind === 'script' ? 'godot_is_script' : 'godot_is_native' },
            arguments: [value as TargetTsExpression, test.argument],
            span: span(context.script, node),
          }),
          [...requirements, ...test.requirements],
        );
      }
      case 'GET_NODE': {
        const requirements = context.structural(node, 'get-node', [], 'get-node');
        // A path the plan resolved in every scene running the script is the node its scene handed
        // over (`script-node-paths.ts`).
        const selfPath = context.selfNodePaths.get(node.id);
        const field = selfPath === undefined ? undefined : context.nodeFields.get(selfPath);
        if (field !== undefined) {
          return expression({ kind: 'property-expression', object: { kind: 'this-expression' }, property: field, span: span(context.script, node) }, requirements);
        }
        // `$Path` is `get_node(NodePath("Path"))` on self (`GDScriptCompiler::_parse_expression`
        // GET_NODE): the Node.get_node binding, the path a string the binding walks.
        const method = context.nativeMethod('Node', 'get_node');
        if (method === undefined) return context.refuse(node, 'the API dump declares no Node.get_node');
        const use = context.bindingUse(
          {
            sourceRevision: context.sourceRevision,
            kind: 'native-member',
            owner: method.owner,
            member: method.name,
            signature: method.hash === 0 ? 'unhashed' : `hash:${String(method.hash)}`,
          },
          node,
        );
        if (use.target.use.kind !== 'call' || use.target.use.sourceReceiver !== 'first-argument') {
          return context.refuse(node, `binding ${use.target.localName} does not take its receiver first`);
        }
        return expression(
          bindingCall(context, node, use, [
            selfNative(context, node),
            { kind: 'literal-expression', value: node.fullPath },
          ]),
          [...requirements, ...use.requirements],
        );
      }
      case 'PRELOAD': {
        // `preload("res://x.tscn")` is the project scene's resource, made once per path
        // (`ResourceLoader::load`'s cache): the scene component the translation writes for it.
        // `preload("res://x.ogg")`: the imported sound its path loads, from the module's record of
        // the script's loads (`resourceTable`), as `load` of that path is.
        if (context.resourceLoads.has(node.id)) {
          const table = resourceTable(context);
          return expression(
            {
              kind: 'element-expression',
              object: { kind: 'identifier-expression', name: table.local },
              index: { kind: 'literal-expression', value: node.resolvedPath },
              span: span(context.script, node),
            },
            [...context.structural(node, 'preload', [], 'preload:resource'), ...table.requirements],
          );
        }
        const scene = context.packedScene?.(node.resolvedPath);
        if (scene === undefined) {
          // `preload("res://m.tres")`: the project resource, made once per path as the loader caches
          // it (`godot_resource_loader_load` with the one path it names).
          const document = context.resourceDocument(node.resolvedPath);
          if (document === undefined) return context.refuse(node, `preload of ${node.resolvedPath} names no project scene or resource`);
          const own: OfficialBoundLoweringRequirement[] = [...context.structural(node, 'preload', [], 'preload:resource')];
          // A resource without a script: the one its module makes and exports.
          const made = context.resourceModule(node.resolvedPath);
          if (made !== undefined) {
            const local = `$Resource_${made.name}`;
            return expression({ kind: 'identifier-expression', name: local, span: span(context.script, node) }, [...own, { kind: 'project-import-requirement', module: made.module, imported: made.name, local, typeOnly: false }]);
          }
          const value = documentResource(context, node, document, document.resource, own, node.resolvedPath);
          own.push(compatImport('resource-loader', 'godot_resource_loader_load'), compatImport('resource', 'godot_script_resource_new'));
          return expression(
            {
              kind: 'call-expression',
              callee: { kind: 'identifier-expression', name: 'godot_resource_loader_load' },
              arguments: [
                { kind: 'literal-expression', value: node.resolvedPath },
                { kind: 'object-expression', properties: [{ key: node.resolvedPath, value: { kind: 'arrow-expression', parameters: [], body: value } }] },
                { kind: 'object-expression', properties: [] },
                { kind: 'identifier-expression', name: 'godot_script_resource_new' },
              ],
              span: span(context.script, node),
            },
            own,
          );
        }
        const requirements = context.structural(node, 'preload', [], 'preload:packed-scene');
        const local = `$Scene_${scene.name}`;
        return expression(
          {
            kind: 'call-expression',
            callee: { kind: 'identifier-expression', name: 'godot_packed_scene_preload' },
            arguments: [
              { kind: 'literal-expression', value: node.resolvedPath },
              { kind: 'identifier-expression', name: local },
              // The root's script class: `instantiate()` makes its instance before the scene mounts.
              ...(scene.rootScript === undefined ? [] : [{ kind: 'identifier-expression' as const, name: scene.rootScript.name }]),
            ],
            span: span(context.script, node),
          },
          [
            ...requirements,
            ...(scene.rootScript?.module === undefined
              ? []
              : [{ kind: 'project-import-requirement' as const, module: scene.rootScript.module, imported: scene.rootScript.name, local: scene.rootScript.name, typeOnly: false }]),
            {
              kind: 'compat-import-requirement',
              module: 'lib/godot-compat/packed-scene-instance',
              imported: 'godot_packed_scene_preload',
              local: 'godot_packed_scene_preload',
              typeOnly: false,
            },
            { kind: 'project-import-requirement', module: scene.module, imported: scene.name, local, typeOnly: false },
          ],
        );
      }
      default:
        return context.refuse(node, `${node.kind} is not an expression lowering`);
    }
  }
}

/** The name of a local a lambda captures that the script assigns anywhere after declaring it. */
function reassignedCapture(context: LoweringContext, lambda: Extract<GodotBoundNode, { kind: 'LAMBDA' }>): string | undefined {
  const names = new Set<string>();
  for (const id of lambda.captures) {
    const captured = context.script.nodes[id];
    if (captured?.kind === 'IDENTIFIER') names.add(captured.name);
    else if (captured !== undefined && 'identifier' in captured) {
      const identifier = context.script.nodes[captured.identifier as number];
      if (identifier?.kind === 'IDENTIFIER') names.add(identifier.name);
    }
  }
  if (names.size === 0) return undefined;
  for (const candidate of context.script.nodes) {
    if (candidate?.kind !== 'ASSIGNMENT') continue;
    const assignee = context.script.nodes[candidate.assignee];
    if (assignee?.kind === 'IDENTIFIER' && assignee.source !== 'MEMBER_VARIABLE' && names.has(assignee.name)) return assignee.name;
  }
  return undefined;
}

/** A member variable's property: its backing field inside its own accessor (`#name`), else itself. */
export function godotMemberProperty(context: LoweringContext, name: string): string {
  return context.accessorOf === name ? `#${name}` : name;
}
