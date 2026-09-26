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
  builtinConversion,
  convertedValue,
  lowerOfficialExpression,
  lowerTypeDefault,
} from './lower-official-expression';
import {
  type LoweringContext,
  type OfficialBoundLoweringRequirement,
  officialBoundIdentifier,
  officialBoundPropertyName,
  officialBoundSpan,
} from './official-bound-lowering-context';
import type { TargetTsClassMember, TargetTsParameter, TargetTsStatement } from './target-ts-syntax';

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

/**
 * `for i in n` over an int: `n` is evaluated once and `i` takes 0 … n-1
 * (`GDScriptCompiler::_parse_block` FOR over an int, the VM's `ITERATE_BEGIN_INT`).
 */
function lowerIntegerRange(
  context: LoweringContext,
  node: Extract<GodotBoundNode, { kind: 'FOR' }>,
  iterableNode: GodotBoundNode,
): LoweredStatements {
  const structuralRequirements = context.structural(node, 'for-range', [iterableNode], 'for-range:int');
  const iterable = settleForStatement(context, lowerExpression(context, iterableNode));
  const body = lowerOfficialSuite(context, context.node(node.loop, node));
  const limit = context.temporary();
  const counter = context.temporary();
  const span = officialBoundSpan(context.script, node);
  return {
    statements: [
      ...iterable.before,
      { kind: 'variable-statement', declaration: 'const', name: limit, initializer: iterable.value },
      ...iterable.after,
      {
        kind: 'variable-statement',
        declaration: 'let',
        name: counter,
        initializer: { kind: 'literal-expression', value: 0 },
      },
      {
        kind: 'while-statement',
        condition: {
          kind: 'binary-expression',
          operator: '<',
          left: { kind: 'identifier-expression', name: counter },
          right: { kind: 'identifier-expression', name: limit },
        },
        body: [
          {
            kind: 'variable-statement',
            declaration: 'let',
            name: officialBoundIdentifier(context, node.variable, node),
            initializer: { kind: 'identifier-expression', name: counter },
          },
          {
            kind: 'expression-statement',
            expression: {
              kind: 'assignment-expression',
              operator: '+=',
              target: { kind: 'identifier-expression', name: counter },
              value: { kind: 'literal-expression', value: 1 },
            },
          },
          ...body.statements,
        ],
        span,
      },
    ],
    requirements: [...structuralRequirements, ...iterable.requirements, ...body.requirements],
  };
}

/** A declared variable whose initializer has another type converts it on assignment. */
function declaredConversion(
  node: Extract<GodotBoundNode, { kind: 'VARIABLE' | 'CONSTANT' }>,
  initializerNode: GodotBoundNode | undefined,
): boolean {
  if (initializerNode === undefined || node.inferDatatype) return false;
  return builtinConversion(node, initializerNode);
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
      const conversion = declaredConversion(node, initializerNode);
      const structuralRequirements = context.structural(
        node,
        construct,
        initializerNode === undefined ? [] : conversion ? [initializerNode, node] : [initializerNode],
        `${construct}:${node.inferDatatype ? 'inferred' : 'declared'}:${
          node.kind === 'CONSTANT' ? 'local' : node.static ? 'static' : 'instance'
        }${conversion ? ':conversion' : ''}`,
      );
      const initializer =
        initializerNode === undefined
          ? node.kind === 'VARIABLE'
            ? lowerTypeDefault(context, node)
            : undefined
          : settleForStatement(
              context,
              convertedValue(context, node, initializerNode, lowerExpression(context, initializerNode)),
            );
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
      const valueNode = node.returnValue < 0 ? undefined : context.node(node.returnValue, node);
      // A converting return (`useConversion`) has its own rule per (return type, value type).
      const returnType = context.returnType;
      if (node.useConversion && returnType === undefined) {
        return context.refuse(node, 'a converting return outside a typed function');
      }
      const converts =
        valueNode !== undefined &&
        returnType !== undefined &&
        (builtinConversion(returnType, valueNode) ||
          // A flagged conversion into a built-in of the value's own type is the identity.
          (node.useConversion && returnType.datatype.kind !== 'BUILTIN'));
      const structuralRequirements = context.structural(
        node,
        'return',
        valueNode === undefined
          ? []
          : converts
            ? [valueNode, returnType as GodotBoundNode]
            : [valueNode],
        `return:${node.voidReturn ? 'void' : 'value'}${converts ? ':conversion' : ''}`,
      );
      if (node.voidReturn || valueNode === undefined) {
        return {
          statements: [{ kind: 'return-statement', span: officialBoundSpan(context.script, node) }],
          requirements: structuralRequirements,
        };
      }
      const value = settleForStatement(
        context,
        returnType === undefined
          ? lowerExpression(context, valueNode)
          : convertedValue(context, returnType, valueNode, lowerExpression(context, valueNode)),
      );
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
      if (iterableNode.datatype.kind === 'BUILTIN' && iterableNode.datatype.builtinType === 'int') {
        return lowerIntegerRange(context, node, iterableNode);
      }
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
): LoweredClassMember & { readonly onready?: LoweredStatements } {
  if (
    node.kind === 'VARIABLE' &&
    (node.setter >= 0 ||
      node.getter >= 0 ||
      (node.propertyStyle !== '' && node.propertyStyle !== 'PROP_NONE'))
  ) {
    return context.refuse(node, 'property accessor fields need structured accessor lowering');
  }
  const onready = node.kind === 'VARIABLE' && node.onready;
  const initializerNode = node.initializer < 0 ? undefined : context.node(node.initializer, node);
  const conversion = declaredConversion(node, initializerNode);
  const structuralRequirements = context.structural(
    node,
    node.kind === 'VARIABLE' ? 'variable' : 'constant',
    initializerNode === undefined ? [] : conversion ? [initializerNode, node] : [initializerNode],
    `${node.kind === 'VARIABLE' ? 'variable' : 'constant'}:${
      node.inferDatatype ? 'inferred' : 'declared'
    }:${classFieldScope(node)}${conversion ? ':conversion' : ''}`,
  );
  const targetType = context.targetType(node);
  const name = officialBoundPropertyName(context, node.identifier, node);
  const isStatic = node.kind === 'CONSTANT' || node.static;
  assertDirectClassElementName(context, context.node(node.identifier, node), name, isStatic);
  // An instance field is first cleared to its type's default, then (unless @onready) given its
  // initializer at construction; an @onready initializer runs in `@implicit_ready`, right before
  // `_ready` (`GDScriptCompiler::_parse_function`, `gdscript_compiler.cpp:2365` and `:2398`).
  const fieldInitializer =
    initializerNode === undefined || onready
      ? node.kind === 'VARIABLE' && !node.static
        ? lowerTypeDefault(context, node)
        : undefined
      : convertedValue(context, node, initializerNode, lowerExpression(context, initializerNode));
  const readyValue =
    onready && initializerNode !== undefined
      ? settleForStatement(
          context,
          convertedValue(context, node, initializerNode, lowerExpression(context, initializerNode)),
        )
      : undefined;
  return {
    member: {
      kind: 'field-member',
      name,
      type: targetType.type,
      modifiers: [
        ...(node.kind === 'CONSTANT' ? ['static' as const, 'readonly' as const] : []),
        ...(node.kind === 'VARIABLE' && node.static ? ['static' as const] : []),
      ],
      ...(fieldInitializer === undefined
        ? {}
        : { initializer: inlineValue(context, initializerNode ?? node, fieldInitializer) }),
      span: officialBoundSpan(context.script, node),
    },
    requirements: [
      ...structuralRequirements,
      ...targetType.requirements,
      ...(fieldInitializer?.requirements ?? []),
    ],
    ...(readyValue === undefined
      ? {}
      : {
          onready: {
            statements: [
              ...readyValue.before,
              {
                kind: 'expression-statement',
                expression: {
                  kind: 'assignment-expression',
                  operator: '=',
                  target: {
                    kind: 'property-expression',
                    object: { kind: 'this-expression' },
                    property: name,
                  },
                  value: readyValue.value,
                },
                span: officialBoundSpan(context.script, node),
              },
              ...readyValue.after,
            ],
            requirements: readyValue.requirements,
          },
        }),
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
  const sourceName = officialBoundPropertyName(context, node.identifier, node);
  // With @onready fields in the script chain, the class's `_ready` is the implicit-ready wrapper
  // and the source `_ready` body becomes `$source_ready` (see implicitReadyMembers).
  const name =
    sourceName === '_ready' && !node.static && context.implicitReady?.self === true
      ? '$source_ready'
      : sourceName;
  assertDirectClassElementName(context, context.node(node.identifier, node), sourceName, node.static);
  const returnTypeForBody = node.returnType < 0 ? undefined : context.node(node.returnType, node);
  const body = context.withReturnType(returnTypeForBody, () =>
    !node.static && name !== '_init'
      ? context.withInstanceAutoloadAccess(() => lowerOfficialSuite(context, bodyNode))
      : lowerOfficialSuite(context, bodyNode),
  );
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

function thisCall(method: string, object: 'this' | 'super' = 'this'): TargetTsStatement {
  return {
    kind: 'expression-statement',
    expression: {
      kind: 'call-expression',
      callee: {
        kind: 'property-expression',
        object: object === 'this' ? { kind: 'this-expression' } : { kind: 'identifier-expression', name: 'super' },
        property: method,
      },
      arguments: [],
    },
  };
}

function voidMethod(name: string, body: readonly TargetTsStatement[]): TargetTsClassMember {
  return {
    kind: 'method-member',
    name,
    parameters: [],
    result: { kind: 'keyword-type', keyword: 'void' },
    body,
  };
}

/**
 * Godot runs every script's `@implicit_ready` (its @onready initializers), base script first,
 * whenever `_ready` is called on the instance, and then `_ready` itself
 * (`GDScriptInstance::callp` → `_call_implicit_ready_recursively`, `gdscript.cpp:1937` and
 * `:1946`); `NOTIFICATION_READY` calls `_ready` even where no script defines it. So a class whose
 * chain has @onready fields gets `$implicit_ready()` (base first, then its own initializers) and
 * `_ready()` = `$implicit_ready(); $source_ready()`, where `$source_ready` is the nearest source
 * `_ready` or nothing.
 */
function implicitReadyMembers(
  context: LoweringContext,
  root: GodotBoundClassNode,
  onready: readonly LoweredStatements[],
): LoweredClassMembers {
  const chain = context.implicitReady;
  if (chain === undefined || !chain.self) {
    if (onready.length > 0) return context.refuse(root, 'onready fields without their implicit-ready chain');
    return { members: [], requirements: [] };
  }
  const requirements = context.structural(root, 'implicit-ready', [], 'implicit-ready');
  const definesReady = root.members.some((id) => {
    const member = context.node(id, root);
    return (
      member.kind === 'FUNCTION' &&
      !member.static &&
      officialBoundPropertyName(context, member.identifier, member) === '_ready'
    );
  });
  const members: TargetTsClassMember[] = [
    voidMethod('$implicit_ready', [
      ...(chain.base ? [thisCall('$implicit_ready', 'super')] : []),
      ...onready.flatMap((entry) => entry.statements),
    ]),
    voidMethod('_ready', [thisCall('$implicit_ready'), thisCall('$source_ready')]),
  ];
  if (!definesReady && !chain.base) {
    members.push(
      voidMethod('$source_ready', chain.ancestorDefinesReady ? [thisCall('_ready', 'super')] : []),
    );
  }
  return {
    members,
    requirements: [...requirements, ...onready.flatMap((entry) => entry.requirements)],
  };
}

export function lowerOfficialClassMembers(
  context: LoweringContext,
  root: GodotBoundClassNode,
): LoweredClassMembers {
  const onready: LoweredStatements[] = [];
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
      if (field.onready !== undefined) onready.push(field.onready);
      return { members: [field.member], requirements: field.requirements };
    }
    if (node.kind === 'FUNCTION') {
      const method = lowerMethod(context, node);
      return { members: [method.member], requirements: method.requirements };
    }
    if (node.kind === 'ENUM') return lowerEnum(context, node);
    return context.refuse(node, `${node.kind} class member needs an evidenced direct lowering`);
  });
  const ready = implicitReadyMembers(context, root, onready);
  return {
    members: [...lowered.flatMap((entry) => entry.members), ...ready.members],
    requirements: [...lowered.flatMap((entry) => entry.requirements), ...ready.requirements],
  };
}
