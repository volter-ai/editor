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
  type OfficialBoundBindingUse,
  type OfficialBoundLoweringRequirement,
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
      // A NodePath is its path text (`NodePath::operator String`), which Node.get_node walks.
      if (value.type === 'NodePath') {
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
  readonly requirements: readonly OfficialBoundLoweringRequirement[];
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
      return {
        beforeAssigned: base.before,
        afterAssigned: [],
        target: {
          kind: 'property-expression',
          object: base.value,
          property: officialBoundPropertyName(context, node.attribute, node),
          span: span(context.script, node),
        },
        requirements: [...requirements, ...base.requirements],
      };
    }
    const indexNode = context.node(node.index, node);
    const index = materialize(context, lower(context, indexNode));
    const requirements = context.structural(node, 'subscript-element', [baseNode, indexNode]);
    return {
      beforeAssigned: base.before,
      afterAssigned: index.before,
      target: {
        kind: 'element-expression',
        object: base.value,
        index: index.value,
        span: span(context.script, node),
      },
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

/** Built-in types whose values Godot copies; Array and Dictionary are shared references. */
function builtinValueType(node: GodotBoundNode): boolean {
  return (
    node.datatype.kind === 'BUILTIN' &&
    !node.datatype.metaType &&
    node.datatype.builtinType !== 'Array' &&
    node.datatype.builtinType !== 'Dictionary'
  );
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
  if (found.index !== undefined) {
    return context.refuse(node, `${found.owner}.${property} is an indexed property; its accessors take the index`);
  }
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
  return use;
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
  if (found.index !== undefined) {
    return context.refuse(node, `${found.owner}.${property} is an indexed property; its accessors take the index`);
  }
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
  return use;
}

function bindingCall(
  context: LoweringContext,
  node: GodotBoundNode,
  use: OfficialBoundBindingUse,
  args: readonly TargetTsExpression[],
): TargetTsExpression {
  return {
    kind: 'call-expression',
    callee: boundTargetExpression(use.target),
    arguments: args,
    span: span(context.script, node),
  };
}

/**
 * An assignable place. Godot writes a member of a built-in value by writing the whole value back
 * (`v.x = e` is `v = v with x`), through a native property by its setter, and evaluates the base
 * chain once, before the assigned value.
 */
interface AssignablePlace {
  readonly before: readonly TargetTsStatement[];
  readonly read: TargetTsExpression;
  readonly write: (value: TargetTsExpression) => TargetTsExpression;
  readonly requirements: readonly OfficialBoundLoweringRequirement[];
}

function valueAttributeTarget(
  context: LoweringContext,
  node: GodotBoundNode,
): { readonly baseNode: GodotBoundNode; readonly attribute: string } | undefined {
  if (node.kind !== 'SUBSCRIPT' || !node.isAttribute) return undefined;
  const baseNode = context.node(node.base, node);
  if (!builtinValueType(baseNode) && !nativeObjectType(baseNode)) return undefined;
  return { baseNode, attribute: officialBoundPropertyName(context, node.attribute, node) };
}

function assignablePlace(
  context: LoweringContext,
  node: GodotBoundNode,
  lower: (context: LoweringContext, node: GodotBoundNode) => LoweredExpression,
): AssignablePlace {
  const attributeTarget = valueAttributeTarget(context, node);
  if (attributeTarget === undefined) {
    const target = prepareAssignmentTarget(context, node, lower);
    if (target.afterAssigned.length > 0) {
      return context.refuse(node, 'an indexed base of a value write-back needs its index settled');
    }
    return {
      before: target.beforeAssigned,
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
  if (nativeObjectType(baseNode)) {
    const getter = nativeAccessorUse(context, node, baseNode, attribute, 'getter');
    const setter = nativeAccessorUse(context, node, baseNode, attribute, 'setter');
    if (getter === undefined || setter === undefined) {
      return context.refuse(
        node,
        `${baseNode.datatype.nativeType}.${attribute} is not a property the API dump declares`,
      );
    }
    const rule = context.selectRule(node, ['subscript-attribute:native-property'], [baseNode], ['binding']);
    const object = materialize(context, lower(context, baseNode));
    const read = materialize(context, expression(bindingCall(context, node, getter, [object.value])));
    return {
      before: [...object.before, ...read.before],
      read: read.value,
      write: (value) => bindingCall(context, node, setter, [object.value, value]),
      requirements: [
        ...rule.requirements,
        ...object.requirements,
        ...getter.requirements,
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
  const current =
    base.read.kind === 'identifier-expression'
      ? { before: [] as readonly TargetTsStatement[], value: base.read }
      : materialize(context, expression(base.read));
  return {
    before: [...base.before, ...current.before],
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
  if (valueNode.datatype.kind !== 'VARIANT' || target.datatype.kind !== 'BUILTIN') return value;
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
  return compose(context, [value], (values) => bindingCall(context, valueNode, use, values), use.requirements);
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
  const datatype = node.datatype;
  const literalValue = (value: null | boolean | number): LoweredExpression =>
    expression({ kind: 'literal-expression', value, span: span(context.script, node) }, requirements);
  if (datatype.kind === 'ENUM') return literalValue(0);
  if (datatype.kind !== 'BUILTIN' || datatype.metaType) return literalValue(null);
  switch (datatype.builtinType) {
    case 'Nil':
      return literalValue(null);
    case 'bool':
      return literalValue(false);
    case 'int':
    case 'float':
      return literalValue(0);
    default: {
      const use = context.bindingUse(
        {
          sourceRevision: context.sourceRevision,
          kind: 'builtin-constructor',
          owner: datatype.builtinType,
          member: datatype.builtinType,
          signature: 'unhashed',
        },
        node,
      );
      if (use.target.use.kind !== 'call' || use.target.use.sourceReceiver !== 'absent') {
        return context.refuse(node, `constructor binding ${use.target.localName} is not a plain call`);
      }
      return expression(bindingCall(context, node, use, []), [...requirements, ...use.requirements]);
    }
  }
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

type AssignmentCombine = (read: TargetTsExpression, value: TargetTsExpression) => TargetTsExpression;

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
    (valueAttributeTarget(context, targetNode) !== undefined
      ? assignablePlace(context, targetNode, lower)
      : undefined);
  if (place !== undefined) {
    const value = materialize(context, assigned);
    return {
      before: [...place.before, ...value.before],
      value: place.write(combine === undefined ? value.value : combine(place.read, value.value)),
      after: [],
      requirements: [...ownRequirements, ...place.requirements, ...value.requirements],
    };
  }
  const target = prepareAssignmentTarget(context, targetNode, lower);
  const value = materialize(context, assigned);
  return {
    // Godot evaluates the base/intermediate chain, then the RHS, then the final index and old
    // lvalue. JavaScript's native assignment order differs, so all four phases are explicit.
    before: [...target.beforeAssigned, ...value.before, ...target.afterAssigned],
    value: {
      kind: 'assignment-expression',
      operator: '=',
      target: target.target,
      value: combine === undefined ? value.value : combine(target.target, value.value),
      span: span(context.script, node),
    },
    after: [],
    requirements: [...ownRequirements, ...target.requirements, ...value.requirements],
  };
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
    case 'gdscript-utility':
      return { ...base, kind: 'global' };
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

export function lowerOfficialExpression(
  context: LoweringContext,
  node: GodotBoundNode,
  lowerSuite: LowerOfficialSuite,
  parameters: LowerOfficialParameters,
): LoweredExpression {
  return lowerExpression(context, node);

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: exhaustive official expression union
  function lowerExpression(context: LoweringContext, node: GodotBoundNode): LoweredExpression {
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
        if (
          node.source === 'MEMBER_VARIABLE' ||
          node.source === 'MEMBER_FUNCTION' ||
          node.source === 'MEMBER_SIGNAL' ||
          node.source === 'INHERITED_VARIABLE'
        ) {
          return expression(
            {
              kind: 'property-expression',
              object: { kind: 'this-expression' },
              property: node.name,
              span: span(context.script, node),
            },
            context.structural(node, 'member-identifier', [], `member-identifier:${node.source}`),
          );
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
          (values) => ({
            kind: 'array-expression',
            elements: values,
            span: span(context.script, node),
          }),
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
        ]);
        const recipe = rule.recipe;
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
        return compose(
          context,
          [lowerExpression(context, operandNode)],
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
        ]);
        const recipe = rule.recipe;
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
        const left = lowerExpression(context, leftNode);
        const right = lowerExpression(context, rightNode);
        if (recipe.operator === '&&' || recipe.operator === '||' || recipe.operator === '??') {
          const settledLeft = settle(context, left);
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
          ['assignment', 'binding'],
        );
        const recipe = rule.recipe;
        if (recipe.kind === 'binding') {
          const use = operatorBinding(context, node, assigneeNode, valueNode);
          return assignment(
            context,
            node,
            (read, value) => bindingCall(context, node, use, [read, value]),
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
            : (read, value) => ({
                kind: 'binary-expression',
                operator: binaryOperator,
                left: read,
                right: value,
              }),
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
        if (node.isAttribute && nativeObjectType(baseNode)) {
          const property = officialBoundPropertyName(context, node.attribute, node);
          const getter = nativeAccessorUse(context, node, baseNode, property, 'getter');
          if (getter !== undefined) {
            const rule = context.selectRule(node, ['subscript-attribute:native-property'], [
              baseNode,
            ], ['binding']);
            return compose(
              context,
              [lowerExpression(context, baseNode)],
              (values) => bindingCall(context, node, getter, values),
              [...rule.requirements, ...getter.requirements],
            );
          }
        }
        const base = lowerExpression(context, baseNode);
        if (node.isAttribute) {
          const requirements = context.structural(node, 'subscript-attribute', [baseNode]);
          return compose(
            context,
            [base],
            ([object]) => ({
              kind: 'property-expression',
              object: object as TargetTsExpression,
              property: officialBoundPropertyName(context, node.attribute, node),
              span: span(context.script, node),
            }),
            requirements,
          );
        }
        const indexNode = context.node(node.index, node);
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
        const args = argumentNodes.map((argument) => lowerExpression(context, argument));
        const target = callTargetBinding(context, node);
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
              arguments: argumentValues,
              span: span(context.script, node),
            }),
            requirements,
          );
        }
        const callee = lowerExpression(context, calleeNode);
        return dynamicCall(context, node, callee, args, requirements);
      }
      case 'AWAIT': {
        const awaitedNode = context.node(node.toAwait, node);
        const requirements = context.structural(node, 'await', [awaitedNode]);
        return compose(
          context,
          [lowerExpression(context, awaitedNode)],
          ([awaited]) => ({
            kind: 'await-expression',
            expression: awaited as TargetTsExpression,
            span: span(context.script, node),
          }),
          requirements,
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
        const condition = settle(context, lowerExpression(context, conditionNode));
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
          return context.refuse(fn, 'lambda rest parameter needs an evidenced rest binding recipe');
        }
        if (fn.returnType >= 0) {
          return context.refuse(fn, 'typed lambda needs an evidenced target return-type recipe');
        }
        if (fn.abstract) {
          return context.refuse(fn, 'abstract lambda has no direct target representation');
        }
        if (node.captures.length > 0 || node.useSelf) {
          return context.refuse(
            node,
            'captured lambda needs an evidenced by-value capture-environment recipe',
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
        const body = lowerSuite(context, context.node(fn.body, fn));
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
        // `$Path` is `get_node(NodePath("Path"))` on self (`GDScriptCompiler::_parse_expression`
        // GET_NODE): the Node.get_node binding, the path a string the binding walks.
        const requirements = context.structural(node, 'get-node', [], 'get-node');
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
      case 'PRELOAD':
        return context.refuse(
          node,
          'preload lowers only after BoundGodotProject joins resource identity',
        );
      default:
        return context.refuse(node, `${node.kind} is not an expression lowering`);
    }
  }
}
