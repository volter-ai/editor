import type {
  GodotBoundClassNode,
  GodotBoundEnumNode,
  GodotBoundFunctionNode,
  GodotBoundNode,
} from '../../godot-frontend/bound-program';
import { godotMatchComparedAs } from '../data/operand-types';
import {
  type LoweredExpression,
  type LoweredParameters,
  type LoweredStatements,
  builtinConversion,
  convertedValue,
  lowerOfficialExpression,
  lowerTruth,
  lowerTypeDefault,
  numericTag,
} from './lower-official-expression';
import {
  type LoweringContext,
  type OfficialBoundLoweringRequirement,
  type OfficialBoundTypeUse,
  officialBoundIdentifier,
  officialBoundPropertyName,
  officialBoundSpan,
} from './official-bound-lowering-context';
import type { TargetTsClassMember, TargetTsExpression, TargetTsParameter, TargetTsStatement, TargetTsType } from './target-ts-syntax';
import { builtinDatatype } from '../../analyze/refined-types';
import { godotCountsLoopCall } from '../data/counted-loops';
import { godotBuiltinConverts, godotIteratesRange, godotReturnsNothing } from '../data/lowering-shapes';

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
  // A value with no effect of its own (what a store made of statements leaves) is not a statement.
  const inert = plan.value.kind === 'identifier-expression' || plan.value.kind === 'literal-expression';
  return {
    statements: [
      ...plan.before,
      ...(inert
        ? []
        : [
            {
              kind: 'expression-statement' as const,
              expression: plan.value,
              span: officialBoundSpan(context.script, node),
            },
          ]),
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
 * A field's initial value: its expression, or, where it needs statements of its own (a built-in
 * read once for its member, `linear_velocity.length()`), those statements run as the field is
 * initialized, in a function called there, which returns the value.
 */
function fieldValue(context: LoweringContext, plan: LoweredExpression): TargetTsExpression {
  if (plan.before.length === 0 && plan.after.length === 0) return plan.value;
  const value = context.temporary();
  return {
    kind: 'call-expression',
    callee: {
      kind: 'parenthesized-expression',
      expression: {
        kind: 'arrow-expression',
        parameters: [],
        body: [
          ...plan.before,
          { kind: 'variable-statement', declaration: 'const', name: value, initializer: plan.value },
          ...plan.after,
          { kind: 'return-statement', expression: { kind: 'identifier-expression', name: value } },
        ],
      },
    },
    arguments: [],
  };
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

/** An int literal's value, through a unary minus: the sign of a constant step, known when lowering. */
function constantInt(context: LoweringContext, node: GodotBoundNode): number | undefined {
  if (node.kind === 'LITERAL') {
    const value = node.reduced ? node.reducedValue : node.value;
    return value.kind === 'int' ? Number(value.value) : undefined;
  }
  if (node.kind === 'UNARY_OPERATOR' && node.operation === 'OP_NEGATIVE') {
    const operand = constantInt(context, context.node(node.operand, node));
    return operand === undefined ? undefined : -operand;
  }
  return undefined;
}

/**
 * `for i in range(...)`: the counted loop Godot compiles (gdscript_compiler.cpp:2070-2076), from
 * `begin` (0) while below `end` (above it for a negative step), `step` (1) apart, with `end`
 * evaluated once before the loop. The step's sign decides the comparison, so a step that is not a
 * constant is refused by name, as is a body that assigns the loop variable (Godot counts on a
 * hidden counter the variable is copied from).
 */
function lowerCountedRange(
  context: LoweringContext,
  node: Extract<GodotBoundNode, { kind: 'FOR' }>,
  call: Extract<GodotBoundNode, { kind: 'CALL' }>,
): LoweredStatements {
  const argumentNodes = call.arguments.map((id) => context.node(id, call));
  const variable = context.node(node.variable, node);
  // A typed loop variable (`for i: float in range(n)`) takes each int as it is assigned; a place
  // whose type holds an int as the same number (an int, a float or an enum) is the counter itself.
  // Any other type is refused, whatever converting into it would do.
  const counts =
    variable.datatype.kind === 'ENUM' ||
    (variable.datatype.kind === 'BUILTIN' && !variable.datatype.metaType && !godotBuiltinConverts(builtinDatatype('int'), variable.datatype));
  if (node.useConversionAssign && !counts) {
    return context.refuse(node, `a range() loop into a ${variable.datatype.display} variable: the counted loop's variable is an int, a float or an enum`);
  }
  const structuralRequirements = context.structural(node, 'for-range', argumentNodes, 'for-range:call');
  const [beginNode, endNode, stepNode] = argumentNodes.length === 1 ? [undefined, argumentNodes[0], undefined] : argumentNodes;
  if (endNode === undefined) return context.refuse(call, 'range() takes one to three arguments');
  const step = stepNode === undefined ? 1 : constantInt(context, stepNode);
  if (step === undefined) return context.refuse(stepNode ?? call, 'a range() loop whose step is known only at run time: its comparison depends on the sign');
  if (step === 0) return context.refuse(stepNode ?? call, 'a range() loop with a zero step makes nothing (Godot reports "Step argument is zero!")');
  const name = officialBoundIdentifier(context, node.variable, node);
  const loopNode = context.node(node.loop, node);
  const within = (inner: GodotBoundNode) =>
    (inner.startLine > loopNode.startLine || (inner.startLine === loopNode.startLine && inner.startColumn >= loopNode.startColumn)) &&
    (inner.endLine < loopNode.endLine || (inner.endLine === loopNode.endLine && inner.endColumn <= loopNode.endColumn));
  const assignsVariable = context.script.nodes.some((candidate) => {
    if (candidate.kind !== 'ASSIGNMENT' || !within(candidate)) return false;
    const assignee = context.script.nodes[candidate.assignee];
    return assignee?.kind === 'IDENTIFIER' && variable.kind === 'IDENTIFIER' && assignee.name === variable.name;
  });
  if (assignsVariable) return context.refuse(node, 'a range() loop whose body assigns its variable, which Godot copies from a hidden counter');
  const begin = beginNode === undefined ? undefined : settleForStatement(context, lowerExpression(context, beginNode));
  const end = settleForStatement(context, lowerExpression(context, endNode));
  const body = lowerOfficialSuite(context, loopNode);
  const span = officialBoundSpan(context.script, node);
  // A literal end is read in place; any other end is read once, before the loop, as Godot does.
  const endInPlace = endNode.kind === 'LITERAL' && end.before.length === 0 && end.after.length === 0;
  const limit = endInPlace ? undefined : context.temporary();
  // An end read before the loop would run ahead of a begin that is not a literal: that begin is
  // read first, into its own local, keeping Godot's argument order.
  const start = limit !== undefined && beginNode !== undefined && beginNode.kind !== 'LITERAL' ? context.temporary() : undefined;
  const read: TargetTsExpression = { kind: 'identifier-expression', name };
  return {
    statements: [
      ...(begin?.before ?? []),
      ...(start === undefined || begin === undefined ? [] : [{ kind: 'variable-statement' as const, declaration: 'const' as const, name: start, initializer: begin.value }]),
      ...(begin?.after ?? []),
      ...end.before,
      ...(limit === undefined ? [] : [{ kind: 'variable-statement' as const, declaration: 'const' as const, name: limit, initializer: end.value }]),
      ...end.after,
      {
        kind: 'for-statement',
        binding: name,
        initializer: start !== undefined ? { kind: 'identifier-expression', name: start } : (begin?.value ?? { kind: 'literal-expression', value: 0 }),
        condition: {
          kind: 'binary-expression',
          operator: step > 0 ? '<' : '>',
          left: read,
          right: limit === undefined ? end.value : { kind: 'identifier-expression', name: limit },
        },
        update:
          Math.abs(step) === 1
            ? { kind: 'postfix-update-expression', operator: step > 0 ? '++' : '--', operand: read }
            : { kind: 'assignment-expression', operator: step > 0 ? '+=' : '-=', target: read, value: { kind: 'literal-expression', value: Math.abs(step) } },
        body: body.statements,
        span,
      },
    ],
    requirements: [
      ...structuralRequirements,
      ...(begin?.requirements ?? []),
      ...end.requirements,
      ...body.requirements,
    ],
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
  const children = node.statements.map((id) =>
    context.recover<LoweredStatements>({ statements: [], requirements: [] }, () =>
      lowerStatement(context, context.node(id, node)),
    ),
  );
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
      const targetType = nullableDeclaration(context, context.targetType(node), node);
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
    case 'AWAIT':
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
      // The condition is its truth (`Variant::booleanize`): an Object false when null or freed.
      const condition = settleForStatement(context, lowerTruth(context, conditionNode, lowerExpression(context, conditionNode)));
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
      // The condition's truth, lowered once.
      const condition = lowerTruth(context, conditionNode, lowerExpression(context, conditionNode));
      const body = lowerOfficialSuite(context, context.node(node.loop, node));
      // A condition that needs statements (its operands', or its truth's own, as a Vector read
      // once for its members) runs them at the top of each pass, as Godot evaluates it before each
      // iteration (`GDScriptByteCodeGenerator::write_while`): the loop is `while (true)`, leaving
      // when the condition fails, so `continue` evaluates it again.
      if (condition.before.length > 0 || condition.after.length > 0) {
        const settled = settleForStatement(context, condition);
        const falsehood: TargetTsExpression = { kind: 'unary-expression', operator: '!', operand: settled.value };
        return {
          statements: [
            {
              kind: 'while-statement',
              condition: { kind: 'literal-expression', value: true },
              body: [
                ...settled.before,
                {
                  kind: 'if-statement',
                  condition: falsehood,
                  // biome-ignore lint/suspicious/noThenProperty: TargetTsSyntax names the source branch.
                  then: [{ kind: 'break-statement' }],
                },
                ...body.statements,
              ],
              span: officialBoundSpan(context.script, node),
            },
          ],
          requirements: [...structuralRequirements, ...settled.requirements, ...body.requirements],
        };
      }
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
      const iterableNode = context.node(node.list, node);
      if (!node.useConversionAssign && godotIteratesRange(iterableNode.datatype)) {
        return lowerIntegerRange(context, node, iterableNode);
      }
      if (
        iterableNode.kind === 'CALL' &&
        iterableNode.compilerTarget.kind === 'gdscript-utility' &&
        godotCountsLoopCall(iterableNode.compilerTarget.owner, iterableNode.compilerTarget.member)
      ) {
        return lowerCountedRange(context, node, iterableNode);
      }
      // A typed loop variable over elements of another type converts each element as it is
      // assigned (`GDScriptByteCodeGenerator::write_for`, gdscript_byte_codegen.cpp:1607, from gdscript_compiler.cpp:2101): the element bound
      // to a temporary, the variable declared from it through the type's constructor binding.
      const variableNode = context.node(node.variable, node);
      const structuralRequirements = context.structural(
        node,
        'for-of',
        node.useConversionAssign ? [iterableNode, variableNode] : [iterableNode],
        node.useConversionAssign ? 'for-of:conversion' : 'for-of:direct-binding',
      );
      const iterable = settleForStatement(context, listAsVariableElements(context, variableNode, lowerExpression(context, iterableNode)));
      const body = lowerOfficialSuite(context, context.node(node.loop, node));
      const name = officialBoundIdentifier(context, node.variable, node);
      let binding = name;
      const prefix: TargetTsStatement[] = [];
      const conversion: OfficialBoundLoweringRequirement[] = [];
      if (node.useConversionAssign) {
        // A built-in converts through its constructor; an object is stated as its class, which
        // Godot's typed assignment checks (`convertedValue`).
        const object = (variableNode.datatype.kind === 'NATIVE' || variableNode.datatype.kind === 'CLASS') && !variableNode.datatype.metaType;
        if (variableNode.datatype.kind !== 'BUILTIN' && !object) {
          return context.refuse(node, `a ${variableNode.datatype.display} loop variable's conversion has no binding`);
        }
        binding = context.temporary();
        const element = { ...iterableNode, datatype: { ...iterableNode.datatype, kind: 'VARIANT' as const } };
        const converted = convertedValue(context, variableNode, element, {
          before: [],
          value: { kind: 'identifier-expression', name: binding, span: officialBoundSpan(context.script, node) },
          after: [],
          requirements: [],
        });
        if (converted.before.length > 0 || converted.after.length > 0) {
          return context.refuse(node, 'a sequenced loop variable conversion needs a restructuring recipe');
        }
        prefix.push({ kind: 'variable-statement', declaration: 'const', name, initializer: converted.value, span: officialBoundSpan(context.script, node) });
        conversion.push(...converted.requirements);
      }
      return {
        statements: [
          ...iterable.before,
          {
            kind: 'for-of-statement',
            binding,
            iterable: iterable.value,
            body: [...prefix, ...body.statements],
            span: officialBoundSpan(context.script, node),
          },
          ...iterable.after,
        ],
        requirements: [...structuralRequirements, ...iterable.requirements, ...conversion, ...body.requirements],
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
      // The release template compiles no asserts (`GDScriptCompiler::_parse_block`, ASSERT under
      // `DEBUG_ENABLED`, gdscript_compiler.cpp:2182): the page is that build (`os.ts`).
      return { statements: [], requirements: context.structural(node, 'assert') };
    case 'MATCH':
      return lowerMatch(context, node);
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
    // A built-in default of another built-in type converts as the parameter is bound (the typed
    // argument assignment), which a JS default does not (`lowering-shapes.ts`).
    if (initializerNode !== undefined && godotBuiltinConverts(initializerNode.datatype, node.datatype)) {
      context.refuse(node, `a ${initializerNode.datatype.display} default converts into the ${node.datatype.display} parameter, which a JS default does not`);
    }
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

/**
 * A loop whose variable the analysis typed from the elements its body reads (`refined-types.ts`,
 * `iterated-element-type`) iterates its list as an array of that type, so the variable is that
 * type to TypeScript as it is to the analysis.
 */
function listAsVariableElements(context: LoweringContext, variable: GodotBoundNode, iterable: LoweredExpression): LoweredExpression {
  if (!context.narrowed(variable) || !context.hasTargetType(variable)) return iterable;
  const element = context.targetType(variable);
  return {
    ...iterable,
    value: { kind: 'as-expression', expression: iterable.value, type: { kind: 'array-type', element: element.type } },
    requirements: [...iterable.requirements, ...element.requirements],
  };
}

/**
 * An object-typed variable that holds null at some time, as analysis found it
 * (`nullable-variables.ts`: cleared to null, `@onready`, or initialized or assigned `null`), is
 * stated `T | null`; a use that calls on it goes through `godot_node_entity`, which raises Godot's
 * null-instance error.
 */
function nullableDeclaration(context: LoweringContext, type: OfficialBoundTypeUse, node: GodotBoundNode): OfficialBoundTypeUse {
  const datatype = node.datatype;
  if (!context.nullableDeclarations.has(node.id) || datatype.metaType || (datatype.kind !== 'NATIVE' && datatype.kind !== 'CLASS')) return type;
  return { ...type, type: { kind: 'union-type', members: [type.type, { kind: 'type-reference', name: 'null', arguments: [] }] } };
}

function classFieldScope(
  node: Extract<GodotBoundNode, { kind: 'VARIABLE' | 'CONSTANT' }>,
): 'class-static' | 'instance' | 'static' {
  if (node.kind === 'CONSTANT') return 'class-static';
  return node.static ? 'static' : 'instance';
}

/**
 * A variable's inline accessors as a TS getter and setter over its backing field `#name`: the
 * source's `get:` and `set(value):` bodies, in which the property's own name is the backing field
 * (`LoweringContext.withAccessorOf`), else the plain read and write Godot generates.
 */
function propertyAccessors(
  context: LoweringContext,
  node: Extract<GodotBoundNode, { kind: 'VARIABLE' }>,
  name: string,
  type: TargetTsType,
): LoweredClassMembers {
  const backing: TargetTsExpression = { kind: 'property-expression', object: { kind: 'this-expression' }, property: `#${name}` };
  // A named accessor (`set = set_mood`, PROP_SETGET) is the script's function, called with the
  // value; its own writes of the member are the backing field's (`namedAccessorOf`).
  const named = (id: number, argument: boolean): LoweredStatements | undefined => {
    const reference = context.node(id, node);
    if (reference.kind !== 'IDENTIFIER') return undefined;
    const call: TargetTsExpression = {
      kind: 'call-expression',
      callee: { kind: 'property-expression', object: { kind: 'this-expression' }, property: reference.name },
      arguments: argument ? [{ kind: 'identifier-expression', name: 'value' }] : [],
    };
    return { statements: [argument ? { kind: 'expression-statement', expression: call } : { kind: 'return-statement', expression: call }], requirements: [] };
  };
  const accessorBody = (id: number): LoweredStatements => {
    const fn = context.node(id, node);
    if (fn.kind !== 'FUNCTION') return context.refuse(fn, 'a property accessor that is not a function');
    return context.withAccessorOf(name, () => lowerOfficialSuite(context, context.node(fn.body, fn)));
  };
  const namedGetter = node.getter >= 0 ? named(node.getter, false) : undefined;
  const namedSetter = node.setter >= 0 ? named(node.setter, true) : undefined;
  const getter = namedGetter ?? (node.getter >= 0 ? accessorBody(node.getter) : { statements: [{ kind: 'return-statement' as const, expression: backing }], requirements: [] });
  if (namedSetter !== undefined) {
    return {
      members: [
        { kind: 'getter-member', name, result: type, body: getter.statements },
        { kind: 'setter-member', name, parameter: { name: 'value', type }, body: namedSetter.statements },
      ],
      requirements: [...getter.requirements, ...namedSetter.requirements],
    };
  }
  const setterFn = node.setter >= 0 ? context.node(node.setter, node) : undefined;
  if (setterFn !== undefined && setterFn.kind !== 'FUNCTION') return context.refuse(setterFn, 'a property setter that is not a function');
  const parameters = setterFn === undefined ? undefined : lowerOfficialParameters(context, setterFn);
  const parameter = parameters?.parameters[0] ?? { name: 'value' };
  const setter =
    setterFn === undefined
      ? { statements: [{ kind: 'expression-statement' as const, expression: { kind: 'assignment-expression' as const, operator: '=' as const, target: backing, value: { kind: 'identifier-expression' as const, name: 'value' } } }], requirements: [] }
      : accessorBody(node.setter);
  return {
    members: [
      { kind: 'getter-member', name, result: type, body: getter.statements },
      { kind: 'setter-member', name, parameter: { ...parameter, type }, body: setter.statements },
    ],
    requirements: [...getter.requirements, ...(parameters?.requirements ?? []), ...setter.requirements],
  };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: exhaustive field lowering
function lowerField(
  context: LoweringContext,
  node: Extract<GodotBoundNode, { kind: 'VARIABLE' | 'CONSTANT' }>,
): LoweredClassMember & { readonly onready?: LoweredStatements; readonly accessors?: LoweredClassMembers } {
  const accessorStyle = node.kind === 'VARIABLE' && (node.setter >= 0 || node.getter >= 0 || (node.propertyStyle !== '' && node.propertyStyle !== 'PROP_NONE'));
  if (accessorStyle && node.kind === 'VARIABLE') {
    // Named accessor functions (`set = _set_x`) and accessors of a static or @onready variable are
    // not carried; an inline `set(value):`/`get:` is (`propertyAccessors`).
    if (node.propertyStyle !== 'PROP_INLINE' && node.propertyStyle !== 'PROP_SETGET') return context.refuse(node, `a ${node.propertyStyle} property's accessors are not lowered`);
    if (node.static || node.onready) return context.refuse(node, 'accessors of a static or @onready variable are not lowered');
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
  const targetType = nullableDeclaration(context, context.targetType(node), node);
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
      : context.isNumericVariable(node)
        ? // An int-or-float member starts as its initializer's type (`numeric-variant`).
          numericTag(context, node, initializerNode, lowerExpression(context, initializerNode))
        : convertedValue(context, node, initializerNode, lowerExpression(context, initializerNode));
  const readyValue =
    onready && initializerNode !== undefined
      ? settleForStatement(
          context,
          convertedValue(context, node, initializerNode, lowerExpression(context, initializerNode)),
        )
      : undefined;
  // A property with inline accessors keeps its value in a private backing field, which its
  // initializer sets without calling the setter (member initialization assigns directly).
  const accessors = accessorStyle && node.kind === 'VARIABLE' ? propertyAccessors(context, node, name, targetType.type) : undefined;
  return {
    ...(accessors === undefined ? {} : { accessors }),
    member: {
      kind: 'field-member',
      name: accessors === undefined ? name : `#${name}`,
      type: targetType.type,
      modifiers: [
        ...(node.kind === 'CONSTANT' ? ['static' as const, 'readonly' as const] : []),
        ...(node.kind === 'VARIABLE' && node.static ? ['static' as const] : []),
      ],
      ...(fieldInitializer === undefined ? {} : { initializer: fieldValue(context, fieldInitializer) }),
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
    return context.refuse(node, 'rest parameters need a rest binding the lane does not lower');
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
  // A member's named accessor (`set = set_mood`) writes and reads the member itself, not through
  // its accessors (`GDScriptCompiler::_parse_assignment`: inside the member's setter the member is
  // the plain storage, `member_property_is_in_setter`, gdscript_compiler.cpp:1035).
  const accessorOf = namedAccessorOf(context, sourceName);
  const lowerBody = () =>
    context.withReturnType(returnTypeForBody, () =>
      !node.static && name !== '_init'
        ? context.withInstanceAutoloadAccess(() => lowerOfficialSuite(context, bodyNode))
        : lowerOfficialSuite(context, bodyNode),
    );
  const body = accessorOf === undefined ? lowerBody() : context.withAccessorOf(accessorOf, lowerBody);
  const parameters = lowerOfficialParameters(context, node);
  // `-> void` returns nothing, though the analyzer types it Nil as it types a null value. The
  // datatype rules are keyed by the datatype alone, and a Nil return type and a Nil value share
  // one (`BUILTIN:null`, stated `null`), so no datatype rule can say `void` here; the keyword needs
  // no import, so the rule's only requirement, a type import, has nothing to carry.
  const result =
    returnTypeNode === undefined
      ? undefined
      : godotReturnsNothing(returnTypeNode.datatype)
        ? { type: { kind: 'keyword-type', keyword: 'void' } as const, requirements: [] }
        : context.targetType(returnTypeNode);
  // A coroutine (the bound function awaits, `GDScriptFunction` state) is an async method, whose
  // declared type is the promise of what it returns: `-> void` is `Promise<void>`.
  const resultType =
    result === undefined || !node.coroutine ? result?.type : ({ kind: 'type-reference', name: 'Promise', arguments: [result.type] } as const);
  return {
    member: {
      kind: 'method-member',
      name,
      parameters: parameters.parameters,
      ...(resultType === undefined ? {} : { result: resultType }),
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

/** The member whose named accessor (`set = f`, `get = f`) the script's function `name` is. */
function namedAccessorOf(context: LoweringContext, name: string): string | undefined {
  for (const node of context.script.nodes) {
    if (node.kind !== 'VARIABLE' || node.propertyStyle !== 'PROP_SETGET') continue;
    for (const id of [node.setter, node.getter]) {
      const reference = id < 0 ? undefined : context.script.nodes[id];
      const identifier = context.script.nodes[node.identifier];
      if (reference?.kind === 'IDENTIFIER' && reference.name === name && identifier?.kind === 'IDENTIFIER') return identifier.name;
    }
  }
  return undefined;
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
  const lowered = root.members.map((id): LoweredClassMembers =>
    context.recover<LoweredClassMembers>({ members: [], requirements: [] }, () => lowerMember(id)),
  );
  function lowerMember(id: number): LoweredClassMembers {
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
      return {
        members: [field.member, ...(field.accessors?.members ?? [])],
        requirements: [...field.requirements, ...(field.accessors?.requirements ?? [])],
      };
    }
    if (node.kind === 'FUNCTION') {
      const method = lowerMethod(context, node);
      return { members: [method.member], requirements: method.requirements };
    }
    if (node.kind === 'ENUM') return lowerEnum(context, node);
    if (node.kind === 'SIGNAL') {
      // `signal name(...)`: the instance's Signal, a field holding compat's script signal
      // (`Signal(owner, name)`, gdscript.cpp:1651), emitted through `Signal.emit`.
      const requirements = context.structural(node, 'signal', [], 'signal');
      return {
        members: [
          {
            kind: 'field-member',
            name: officialBoundPropertyName(context, node.identifier, node),
            initializer: { kind: 'call-expression', callee: { kind: 'identifier-expression', name: 'godot_script_signal' }, arguments: [] },
          },
        ],
        requirements: [
          ...requirements,
          { kind: 'compat-import-requirement', module: 'lib/godot-compat/signal-value', imported: 'godot_script_signal', local: 'godot_script_signal', typeOnly: false },
        ],
      };
    }
    return context.refuse(node, `${node.kind} class member has no lowering`);
  }
  const ready = context.recover<LoweredClassMembers>({ members: [], requirements: [] }, () =>
    implicitReadyMembers(context, root, onready),
  );
  return {
    members: [...lowered.flatMap((entry) => entry.members), ...ready.members],
    requirements: [...lowered.flatMap((entry) => entry.requirements), ...ready.requirements],
  };
}

/** The type a match compares a value as (`godotMatchComparedAs`), an enum as its int. */
function matchedType(datatype: GodotBoundNode['datatype']): string | undefined {
  if (datatype.metaType) return undefined;
  if (datatype.kind === 'ENUM') return godotMatchComparedAs('int');
  return datatype.kind === 'BUILTIN' ? godotMatchComparedAs(datatype.builtinType) : undefined;
}

/**
 * `match value:` as an `if` chain over the value, evaluated once: a branch runs when one of its
 * patterns matches, the first that does (`GDScriptCompiler::_parse_block`, MATCH,
 * gdscript_compiler.cpp:1810). A literal or constant expression pattern matches a value of its own
 * type that equals it (`_parse_match_pattern`, `:1540`, the type check then `==`), which for the
 * value types a match here compares is `===` once the types are the same; a wildcard or a bind
 * matches anything, the bind naming the value in its branch. Array and dictionary patterns, and
 * guards, refuse by name.
 */
function lowerMatch(context: LoweringContext, node: Extract<GodotBoundNode, { kind: 'MATCH' }>): LoweredStatements {
  const testNode = context.node(node.test, node);
  const tested = matchedType(testNode.datatype);
  if (tested === undefined) return context.refuse(node, `a match over a ${testNode.datatype.display} value, which is not compared by value here`);
  const requirements: OfficialBoundLoweringRequirement[] = [...context.structural(node, 'match', [testNode])];
  const subject = settleForStatement(context, lowerExpression(context, testNode));
  requirements.push(...subject.requirements);
  const local = context.temporary();
  const read: TargetTsExpression = { kind: 'identifier-expression', name: local };
  const branches = node.branches.map((id) => context.node(id, node));
  type Arm = { readonly condition: TargetTsExpression | undefined; readonly statements: readonly TargetTsStatement[] };
  const arms: Arm[] = [];
  for (const branch of branches) {
    if (branch.kind !== 'MATCH_BRANCH') return context.refuse(node, `a match branch of kind ${branch.kind}`);
    if (branch.guardBody >= 0) return context.refuse(branch, 'a match branch guard (`when`) is not lowered');
    const binds: TargetTsStatement[] = [];
    const tests: TargetTsExpression[] = [];
    let always = false;
    for (const id of branch.patterns) {
      const pattern = context.node(id, branch);
      if (pattern.kind !== 'PATTERN') return context.refuse(branch, `a match pattern of kind ${pattern.kind}`);
      if (pattern.patternType === 'PT_WILDCARD') {
        always = true;
      } else if (pattern.patternType === 'PT_BIND') {
        always = true;
        const bound = pattern.binds[0];
        if (bound === undefined) return context.refuse(pattern, 'a bind pattern without its name');
        binds.push({ kind: 'variable-statement', declaration: 'const', name: officialBoundIdentifier(context, bound.identifier, pattern), initializer: read });
      } else if (pattern.patternType === 'PT_LITERAL' || pattern.patternType === 'PT_EXPRESSION') {
        const valueNode = context.node(pattern.patternType === 'PT_LITERAL' ? pattern.literal : pattern.expression, pattern);
        if (matchedType(valueNode.datatype) !== tested) return context.refuse(pattern, `a ${valueNode.datatype.display} pattern over a ${testNode.datatype.display} value`);
        const value = settleForStatement(context, lowerExpression(context, valueNode));
        if (value.before.length > 0 || value.after.length > 0) return context.refuse(pattern, 'a match pattern that needs statements of its own');
        requirements.push(...value.requirements);
        tests.push({ kind: 'binary-expression', operator: '===', left: read, right: value.value });
      } else {
        return context.refuse(pattern, `a ${pattern.patternType} match pattern is not lowered`);
      }
    }
    const block = lowerOfficialSuite(context, context.node(branch.block, branch));
    requirements.push(...block.requirements);
    const condition = always ? undefined : tests.reduce<TargetTsExpression | undefined>((joined, test) => (joined === undefined ? test : { kind: 'binary-expression', operator: '||', left: joined, right: test }), undefined);
    arms.push({ condition, statements: [...binds, ...block.statements] });
    // Branches after one that always matches never run.
    if (always) break;
  }
  let chain: readonly TargetTsStatement[] = [];
  for (const arm of [...arms].reverse()) {
    chain =
      arm.condition === undefined
        ? arm.statements
        : [
            {
              kind: 'if-statement',
              condition: arm.condition,
              // biome-ignore lint/suspicious/noThenProperty: TargetTsSyntax names the source branch.
              then: arm.statements,
              ...(chain.length === 0 ? {} : { else: chain }),
            },
          ];
  }
  return {
    statements: [
      ...subject.before,
      { kind: 'variable-statement', declaration: 'const', name: local, initializer: subject.value, span: officialBoundSpan(context.script, node) },
      ...subject.after,
      // A match with a bind or no chain keeps its branch's names to its own block.
      { kind: 'block-statement', body: chain },
    ],
    requirements,
  };
}
