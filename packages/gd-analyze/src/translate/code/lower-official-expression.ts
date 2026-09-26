import type {
  GodotBoundCallNode,
  GodotBoundFunctionNode,
  GodotBoundNode,
  GodotBoundVariant,
} from '../../godot-frontend/bound-program';
import type { GodotOfficialSymbolIdentity, GodotTargetBinding } from './bindings';
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
      return {
        kind: 'object-expression',
        properties: value.value.map((entry) => {
          if (entry.key.kind !== 'string' && entry.key.kind !== 'string-name') {
            context.refuse(
              node,
              'constant dictionary with non-string keys needs the Dictionary protocol',
            );
          }
          return { key: entry.key.value, value: literal(context, node, entry.value) };
        }),
        span: span(context.script, node),
      };
    case 'opaque':
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

function assignment(
  context: LoweringContext,
  node: GodotBoundNode,
  operator: TargetTsAssignmentOperator,
  targetNode: GodotBoundNode,
  assigned: LoweredExpression,
  lower: (context: LoweringContext, node: GodotBoundNode) => LoweredExpression,
  ownRequirements: readonly OfficialBoundLoweringRequirement[],
): LoweredExpression {
  const target = prepareAssignmentTarget(context, targetNode, lower);
  const value = materialize(context, assigned);
  const binaryOperator = assignmentBinaryOperator(operator);
  return {
    // Godot evaluates the base/intermediate chain, then the RHS, then the final index and old
    // lvalue. JavaScript's native assignment order differs, so all four phases are explicit.
    before: [...target.beforeAssigned, ...value.before, ...target.afterAssigned],
    value: {
      kind: 'assignment-expression',
      operator: '=',
      target: target.target,
      value:
        binaryOperator === undefined
          ? value.value
          : {
              kind: 'binary-expression',
              operator: binaryOperator,
              left: target.target,
              right: value.value,
            },
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

function dictionaryLiteralKey(
  context: LoweringContext,
  keyNode: GodotBoundNode,
  lowered: LoweredExpression,
): {
  readonly key: string | number;
  readonly requirements: readonly OfficialBoundLoweringRequirement[];
} {
  if (keyNode.kind !== 'LITERAL') {
    context.refuse(keyNode, 'dynamic dictionary keys need the Dictionary protocol');
  }
  if (lowered.before.length > 0 || lowered.after.length > 0) {
    context.refuse(keyNode, 'literal dictionary key unexpectedly requires sequencing');
  }
  const key = keyNode.reduced ? keyNode.reducedValue : keyNode.value;
  if (key.kind !== 'string' && key.kind !== 'string-name' && key.kind !== 'int') {
    context.refuse(keyNode, 'dictionary key is not a direct object-literal key');
  }
  return {
    key: key.kind === 'int' ? Number(key.value) : key.value,
    requirements: lowered.requirements,
  };
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
    case 'builtin-static':
      return { ...base, kind: 'builtin-member' };
    case 'script-self':
    case 'script-class':
    case 'dynamic':
      return undefined;
    case 'super':
      return context.refuse(node, 'super calls require resolved class ancestry');
    case 'unresolved':
      return context.refuse(node, 'official compiler left this call target unresolved');
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
        const structuralRequirements = context.structural(
          node,
          'bound-identifier',
          [],
          `bound-identifier:${node.source}`,
        );
        const use = nativeClassBinding(context, node);
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
        const keys = keyNodes.map((keyNode) =>
          dictionaryLiteralKey(context, keyNode, lowerExpression(context, keyNode)),
        );
        return compose(
          context,
          valueNodes.map((valueNode) => lowerExpression(context, valueNode)),
          (values) => ({
            kind: 'object-expression',
            properties: values.map((value, index) => ({
              key: (keys[index] as (typeof keys)[number]).key,
              value,
            })),
            span: span(context.script, node),
          }),
          [...requirements, ...keys.flatMap((key) => key.requirements)],
        );
      }
      case 'UNARY_OPERATOR': {
        const operandNode = context.node(node.operand, node);
        const rule = context.rule(
          node,
          `operator:${node.operation}:${String(node.variantOperatorId)}`,
          [operandNode],
          'unary',
        );
        const recipe = rule.recipe;
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
        const rule = context.rule(
          node,
          `operator:${node.operation}:${String(node.variantOperatorId)}`,
          [leftNode, rightNode],
          'binary',
        );
        const recipe = rule.recipe;
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
        if (node.useConversionAssign) {
          return context.refuse(node, 'conversion assignment needs an evidenced conversion recipe');
        }
        const assigneeNode = context.node(node.assignee, node);
        const valueNode = context.node(node.assignedValue, node);
        const rule = context.rule(
          node,
          `operator:${node.operation}:${String(node.variantOperatorId)}`,
          [assigneeNode, valueNode],
          'assignment',
        );
        const recipe = rule.recipe;
        if (recipe.kind !== 'assignment')
          return context.refuse(node, 'unreachable assignment recipe');
        return assignment(
          context,
          node,
          recipe.operator,
          assigneeNode,
          lowerExpression(context, valueNode),
          lowerExpression,
          rule.requirements,
        );
      }
      case 'SUBSCRIPT': {
        const baseNode = context.node(node.base, node);
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
          if (
            node.compilerTarget.kind === 'native-method' ||
            node.compilerTarget.kind === 'builtin-member'
          ) {
            if (calleeNode.kind === 'SUBSCRIPT' && calleeNode.isAttribute) {
              const receiverNode = context.node(calleeNode.base, calleeNode);
              const result = boundInstanceCall(
                context,
                node,
                lowerExpression(context, receiverNode),
                target,
                args,
              );
              return { ...result, requirements: [...requirements, ...result.requirements] };
            }
            const result = boundInstanceCall(
              context,
              node,
              expression({ kind: 'this-expression', span: span(context.script, node) }),
              target,
              args,
            );
            return { ...result, requirements: [...requirements, ...result.requirements] };
          }
          const result = boundCallWithoutReceiver(context, node, target, args);
          return { ...result, requirements: [...requirements, ...result.requirements] };
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
      case 'CAST':
        return context.refuse(node, 'Godot runtime cast semantics need a typed binding');
      case 'TYPE_TEST':
        return context.refuse(node, 'Godot type-test semantics need a typed binding');
      case 'GET_NODE':
        return context.refuse(
          node,
          'node paths lower only after BoundGodotProject joins scene identity',
        );
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
