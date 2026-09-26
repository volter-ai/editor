import type {
  GodotBoundClassNode,
  GodotBoundEnumNode,
  GodotBoundFunctionNode,
  GodotBoundNode,
} from '../../godot-frontend/bound-program';
import {
  type LoweredExpression,
  type LoweredParameters,
  type LoweredStatements,
  lowerOfficialExpression,
} from './lower-official-expression';
import {
  type LoweringContext,
  type OfficialBoundLoweringRequirement,
  officialBoundIdentifier,
  officialBoundPropertyName,
  officialBoundSpan,
} from './official-bound-lowering-context';
import type { TargetTsClassMember, TargetTsParameter } from './target-ts-syntax';

export interface LoweredClassMembers {
  readonly members: readonly TargetTsClassMember[];
  readonly requirements: readonly OfficialBoundLoweringRequirement[];
}

interface LoweredClassMember {
  readonly member: TargetTsClassMember;
  readonly requirements: readonly OfficialBoundLoweringRequirement[];
}

function lowerExpression(context: LoweringContext, node: GodotBoundNode): LoweredExpression {
  return lowerOfficialExpression(context, node, lowerOfficialSuite, lowerOfficialParameters);
}

function enumValue(value: string, node: GodotBoundEnumNode, context: LoweringContext): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    return context.refuse(node, `enum value ${value} is outside TypeScript's exact integer range`);
  }
  return parsed;
}

function assertDirectClassElementName(
  context: LoweringContext,
  node: GodotBoundNode,
  name: string,
  isStatic: boolean,
): void {
  if (name === 'constructor') {
    context.refuse(node, 'class element constructor needs computed-property target syntax');
  }
  if (isStatic && name === 'prototype') {
    context.refuse(node, 'static class element prototype needs computed-property target syntax');
  }
}

function lowerEnum(context: LoweringContext, node: GodotBoundEnumNode): LoweredClassMembers {
  const requirements = context.structural(
    node,
    'enum',
    [],
    `enum:${node.identifier < 0 ? 'anonymous' : 'named'}`,
  );
  const members = node.values.map((value) => ({
    name: officialBoundPropertyName(context, value.identifier, node),
    value: enumValue(value.value, node, context),
    source: context.node(value.identifier, node),
  }));
  if (node.identifier < 0) {
    for (const member of members) {
      assertDirectClassElementName(context, member.source, member.name, true);
    }
    return {
      members: members.map((member) => ({
        kind: 'field-member',
        name: member.name,
        modifiers: ['static', 'readonly'],
        initializer: { kind: 'literal-expression', value: member.value },
        span: officialBoundSpan(context.script, node),
      })),
      requirements,
    };
  }
  const enumName = officialBoundPropertyName(context, node.identifier, node);
  assertDirectClassElementName(context, context.node(node.identifier, node), enumName, true);
  return {
    members: [
      {
        kind: 'field-member',
        name: enumName,
        modifiers: ['static', 'readonly'],
        initializer: {
          kind: 'object-expression',
          properties: members.map((member) => ({
            key: member.name,
            value: { kind: 'literal-expression', value: member.value },
          })),
        },
        span: officialBoundSpan(context.script, node),
      },
    ],
    requirements,
  };
}

function expressionStatement(
  context: LoweringContext,
  node: GodotBoundNode,
  plan: LoweredExpression,
): LoweredStatements {
  return {
    statements: [
      ...plan.before,
      {
        kind: 'expression-statement',
        expression: plan.value,
        span: officialBoundSpan(context.script, node),
      },
      ...plan.after,
    ],
    requirements: plan.requirements,
  };
}

function settleForStatement(context: LoweringContext, plan: LoweredExpression): LoweredExpression {
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

function inlineValue(context: LoweringContext, owner: GodotBoundNode, plan: LoweredExpression) {
  if (plan.before.length > 0 || plan.after.length > 0) {
    context.refuse(owner, 'this expression requires statement sequencing at an inline-only site');
  }
  return plan.value;
}

export function lowerOfficialSuite(
  context: LoweringContext,
  node: GodotBoundNode,
): LoweredStatements {
  if (node.kind !== 'SUITE') context.refuse(node, `expected SUITE, received ${node.kind}`);
  const requirements = context.structural(node, 'suite');
  const children = node.statements.map((id) => lowerStatement(context, context.node(id, node)));
  return {
    statements: children.flatMap((child) => child.statements),
    requirements: [...requirements, ...children.flatMap((child) => child.requirements)],
  };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: exhaustive official statement union
function lowerStatement(context: LoweringContext, node: GodotBoundNode): LoweredStatements {
  switch (node.kind) {
    case 'VARIABLE':
    case 'CONSTANT': {
      const construct = node.kind === 'VARIABLE' ? 'variable' : 'constant';
      const initializerNode =
        node.initializer < 0 ? undefined : context.node(node.initializer, node);
      const structuralRequirements = context.structural(
        node,
        construct,
        initializerNode === undefined ? [] : [initializerNode],
        `${construct}:${node.inferDatatype ? 'inferred' : 'declared'}:${
          node.kind === 'CONSTANT' ? 'local' : node.static ? 'static' : 'instance'
        }`,
      );
      const initializer =
        initializerNode === undefined
          ? undefined
          : settleForStatement(context, lowerExpression(context, initializerNode));
      const targetType = context.targetType(node);
      return {
        statements: [
          ...(initializer?.before ?? []),
          {
            kind: 'variable-statement',
            declaration: node.kind === 'VARIABLE' ? 'let' : 'const',
            name: officialBoundIdentifier(context, node.identifier, node),
            type: targetType.type,
            ...(initializer === undefined ? {} : { initializer: initializer.value }),
            span: officialBoundSpan(context.script, node),
          },
          ...(initializer?.after ?? []),
        ],
        requirements: [
          ...structuralRequirements,
          ...targetType.requirements,
          ...(initializer?.requirements ?? []),
        ],
      };
    }
    case 'ASSIGNMENT':
    case 'CALL':
      return expressionStatement(context, node, lowerExpression(context, node));
    case 'RETURN': {
      if (node.useConversion) {
        return context.refuse(node, 'return conversion needs an evidenced conversion recipe');
      }
      const valueNode = node.returnValue < 0 ? undefined : context.node(node.returnValue, node);
      const structuralRequirements = context.structural(
        node,
        'return',
        valueNode === undefined ? [] : [valueNode],
        `return:${node.voidReturn ? 'void' : 'value'}`,
      );
      if (node.voidReturn || valueNode === undefined) {
        return {
          statements: [{ kind: 'return-statement', span: officialBoundSpan(context.script, node) }],
          requirements: structuralRequirements,
        };
      }
      const value = settleForStatement(context, lowerExpression(context, valueNode));
      return {
        statements: [
          ...value.before,
          {
            kind: 'return-statement',
            expression: value.value,
            span: officialBoundSpan(context.script, node),
          },
          ...value.after,
        ],
        requirements: [...structuralRequirements, ...value.requirements],
      };
    }
    case 'IF': {
      const conditionNode = context.node(node.condition, node);
      const structuralRequirements = context.structural(node, 'if', [conditionNode]);
      const condition = settleForStatement(context, lowerExpression(context, conditionNode));
      const whenTrue = lowerOfficialSuite(context, context.node(node.trueBlock, node));
      const whenFalse =
        node.falseBlock < 0
          ? undefined
          : lowerOfficialSuite(context, context.node(node.falseBlock, node));
      return {
        statements: [
          ...condition.before,
          {
            kind: 'if-statement',
            condition: condition.value,
            // biome-ignore lint/suspicious/noThenProperty: TargetTsSyntax names the source branch.
            then: whenTrue.statements,
            ...(whenFalse === undefined ? {} : { else: whenFalse.statements }),
            span: officialBoundSpan(context.script, node),
          },
          ...condition.after,
        ],
        requirements: [
          ...structuralRequirements,
          ...condition.requirements,
          ...whenTrue.requirements,
          ...(whenFalse?.requirements ?? []),
        ],
      };
    }
    case 'WHILE': {
      const conditionNode = context.node(node.condition, node);
      const structuralRequirements = context.structural(node, 'while', [conditionNode]);
      const condition = lowerExpression(context, conditionNode);
      if (condition.before.length > 0 || condition.after.length > 0) {
        return context.refuse(
          conditionNode,
          'sequenced while condition needs an evidenced loop restructuring recipe',
        );
      }
      const body = lowerOfficialSuite(context, context.node(node.loop, node));
      return {
        statements: [
          {
            kind: 'while-statement',
            condition: condition.value,
            body: body.statements,
            span: officialBoundSpan(context.script, node),
          },
        ],
        requirements: [...structuralRequirements, ...condition.requirements, ...body.requirements],
      };
    }
    case 'FOR': {
      if (node.useConversionAssign) {
        return context.refuse(node, 'for binding conversion needs an evidenced conversion recipe');
      }
      const iterableNode = context.node(node.list, node);
      const structuralRequirements = context.structural(
        node,
        'for-of',
        [iterableNode],
        'for-of:direct-binding',
      );
      const iterable = settleForStatement(context, lowerExpression(context, iterableNode));
      const body = lowerOfficialSuite(context, context.node(node.loop, node));
      return {
        statements: [
          ...iterable.before,
          {
            kind: 'for-of-statement',
            binding: officialBoundIdentifier(context, node.variable, node),
            iterable: iterable.value,
            body: body.statements,
            span: officialBoundSpan(context.script, node),
          },
          ...iterable.after,
        ],
        requirements: [...structuralRequirements, ...iterable.requirements, ...body.requirements],
      };
    }
    case 'BREAK':
      return {
        statements: [{ kind: 'break-statement', span: officialBoundSpan(context.script, node) }],
        requirements: context.structural(node, 'break'),
      };
    case 'CONTINUE':
      return {
        statements: [{ kind: 'continue-statement', span: officialBoundSpan(context.script, node) }],
        requirements: context.structural(node, 'continue'),
      };
    case 'PASS':
      return {
        statements: [{ kind: 'empty-statement', span: officialBoundSpan(context.script, node) }],
        requirements: context.structural(node, 'pass'),
      };
    case 'ASSERT':
      return context.refuse(node, 'assert needs its evidenced Godot error protocol binding');
    case 'MATCH':
      return context.refuse(node, 'match patterns need their evidenced structured lowering');
    case 'BREAKPOINT':
      return context.refuse(node, 'breakpoint is an editor-only source operation');
    default:
      return context.refuse(node, `${node.kind} is not a statement lowering`);
  }
}

export function lowerOfficialParameters(
  context: LoweringContext,
  fn: GodotBoundFunctionNode,
): LoweredParameters {
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: exhaustive parameter lowering
  const lowered = fn.parameters.map((id) => {
    const node = context.node(id, fn);
    if (node.kind !== 'PARAMETER') {
      context.refuse(node, `expected PARAMETER, received ${node.kind}`);
    }
    const initializerNode = node.initializer < 0 ? undefined : context.node(node.initializer, node);
    const structuralRequirements = context.structural(
      node,
      'parameter',
      initializerNode === undefined ? [] : [initializerNode],
      `parameter:${node.inferDatatype ? 'inferred' : 'declared'}:${
        initializerNode === undefined ? 'required' : 'defaulted'
      }`,
    );
    const targetType = context.targetType(node);
    const initializer =
      initializerNode === undefined ? undefined : lowerExpression(context, initializerNode);
    return {
      parameter: {
        name: officialBoundIdentifier(context, node.identifier, node),
        type: targetType.type,
        ...(initializer === undefined
          ? {}
          : { initializer: inlineValue(context, initializerNode ?? node, initializer) }),
      } satisfies TargetTsParameter,
      requirements: [
        ...structuralRequirements,
        ...targetType.requirements,
        ...(initializer?.requirements ?? []),
      ],
    };
  });
  return {
    parameters: lowered.map((entry) => entry.parameter),
    requirements: lowered.flatMap((entry) => entry.requirements),
  };
}

function classFieldScope(
  node: Extract<GodotBoundNode, { kind: 'VARIABLE' | 'CONSTANT' }>,
): 'class-static' | 'instance' | 'static' {
  if (node.kind === 'CONSTANT') return 'class-static';
  return node.static ? 'static' : 'instance';
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: exhaustive field lowering
function lowerField(
  context: LoweringContext,
  node: Extract<GodotBoundNode, { kind: 'VARIABLE' | 'CONSTANT' }>,
): LoweredClassMember {
  if (
    node.kind === 'VARIABLE' &&
    (node.onready ||
      node.setter >= 0 ||
      node.getter >= 0 ||
      (node.propertyStyle !== '' && node.propertyStyle !== 'PROP_NONE'))
  ) {
    return context.refuse(
      node,
      'onready and property accessor fields need structured initialization lowering',
    );
  }
  const initializerNode = node.initializer < 0 ? undefined : context.node(node.initializer, node);
  const structuralRequirements = context.structural(
    node,
    node.kind === 'VARIABLE' ? 'variable' : 'constant',
    initializerNode === undefined ? [] : [initializerNode],
    `${node.kind === 'VARIABLE' ? 'variable' : 'constant'}:${
      node.inferDatatype ? 'inferred' : 'declared'
    }:${classFieldScope(node)}`,
  );
  const targetType = context.targetType(node);
  const initializer =
    initializerNode === undefined ? undefined : lowerExpression(context, initializerNode);
  const name = officialBoundPropertyName(context, node.identifier, node);
  const isStatic = node.kind === 'CONSTANT' || node.static;
  assertDirectClassElementName(context, context.node(node.identifier, node), name, isStatic);
  return {
    member: {
      kind: 'field-member',
      name,
      type: targetType.type,
      modifiers: [
        ...(node.kind === 'CONSTANT' ? ['static' as const, 'readonly' as const] : []),
        ...(node.kind === 'VARIABLE' && node.static ? ['static' as const] : []),
      ],
      ...(initializer === undefined
        ? {}
        : { initializer: inlineValue(context, initializerNode ?? node, initializer) }),
      span: officialBoundSpan(context.script, node),
    },
    requirements: [
      ...structuralRequirements,
      ...targetType.requirements,
      ...(initializer?.requirements ?? []),
    ],
  };
}

function lowerMethod(context: LoweringContext, node: GodotBoundFunctionNode): LoweredClassMember {
  if (node.abstract)
    return context.refuse(node, 'abstract functions need a target declaration recipe');
  if (node.restParameter >= 0) {
    return context.refuse(node, 'rest parameters need an evidenced rest binding recipe');
  }
  const bodyNode = context.node(node.body, node);
  const structuralRequirements = context.structural(
    node,
    'function',
    [],
    `function:${node.static ? 'static' : 'instance'}:${
      node.coroutine ? 'coroutine' : 'synchronous'
    }`,
  );
  const returnTypeNode = node.returnType < 0 ? undefined : context.node(node.returnType, node);
  const name = officialBoundPropertyName(context, node.identifier, node);
  assertDirectClassElementName(context, context.node(node.identifier, node), name, node.static);
  const body =
    !node.static && name !== '_init'
      ? context.withInstanceAutoloadAccess(() => lowerOfficialSuite(context, bodyNode))
      : lowerOfficialSuite(context, bodyNode);
  const parameters = lowerOfficialParameters(context, node);
  const result = returnTypeNode === undefined ? undefined : context.targetType(returnTypeNode);
  return {
    member: {
      kind: 'method-member',
      name,
      parameters: parameters.parameters,
      ...(result === undefined ? {} : { result: result.type }),
      body: body.statements,
      modifiers: [
        ...(node.static ? ['static' as const] : []),
        ...(node.coroutine ? ['async' as const] : []),
      ],
      span: officialBoundSpan(context.script, node),
    },
    requirements: [
      ...structuralRequirements,
      ...parameters.requirements,
      ...(result?.requirements ?? []),
      ...body.requirements,
    ],
  };
}

export function lowerOfficialClassMembers(
  context: LoweringContext,
  root: GodotBoundClassNode,
): LoweredClassMembers {
  const lowered = root.members.map((id): LoweredClassMembers => {
    const node = context.node(id, root);
    if (node.kind === 'ANNOTATION') {
      const requirements = context.structural(
        node,
        'annotation-elision',
        [],
        `annotation-elision:${node.name}:${node.applied ? 'applied' : 'unapplied'}`,
      );
      return { members: [], requirements };
    }
    if (node.kind === 'VARIABLE' || node.kind === 'CONSTANT') {
      const field = lowerField(context, node);
      return { members: [field.member], requirements: field.requirements };
    }
    if (node.kind === 'FUNCTION') {
      const method = lowerMethod(context, node);
      return { members: [method.member], requirements: method.requirements };
    }
    if (node.kind === 'ENUM') return lowerEnum(context, node);
    return context.refuse(node, `${node.kind} class member needs an evidenced direct lowering`);
  });
  return {
    members: lowered.flatMap((entry) => entry.members),
    requirements: lowered.flatMap((entry) => entry.requirements),
  };
}
