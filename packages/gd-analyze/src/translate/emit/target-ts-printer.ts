import ts from 'typescript';
import type {
  TargetTsAssignmentOperator,
  TargetTsBinaryOperator,
  TargetTsClassMember,
  TargetTsExpression,
  TargetTsJsxAttribute,
  TargetTsJsxChild,
  TargetTsJsxElementShape,
  TargetTsModifier,
  TargetTsParameter,
  TargetTsSourceFile,
  TargetTsStatement,
  TargetTsType,
  TargetTsUnaryOperator,
} from '../code/target-ts-syntax';

function unreachable(value: never): never {
  throw new Error(`unhandled TargetTsSyntax variant: ${JSON.stringify(value)}`);
}

function modifier(value: TargetTsModifier): ts.Modifier {
  switch (value) {
    case 'export':
      return ts.factory.createModifier(ts.SyntaxKind.ExportKeyword);
    case 'default':
      return ts.factory.createModifier(ts.SyntaxKind.DefaultKeyword);
    case 'async':
      return ts.factory.createModifier(ts.SyntaxKind.AsyncKeyword);
    case 'static':
      return ts.factory.createModifier(ts.SyntaxKind.StaticKeyword);
    case 'readonly':
      return ts.factory.createModifier(ts.SyntaxKind.ReadonlyKeyword);
    case 'private':
      return ts.factory.createModifier(ts.SyntaxKind.PrivateKeyword);
    default:
      return unreachable(value);
  }
}

function modifiers(
  values: readonly TargetTsModifier[] | undefined,
): readonly ts.Modifier[] | undefined {
  return values === undefined || values.length === 0 ? undefined : values.map(modifier);
}

function typeNode(value: TargetTsType): ts.TypeNode {
  switch (value.kind) {
    case 'keyword-type': {
      const kinds = {
        any: ts.SyntaxKind.AnyKeyword,
        boolean: ts.SyntaxKind.BooleanKeyword,
        never: ts.SyntaxKind.NeverKeyword,
        number: ts.SyntaxKind.NumberKeyword,
        object: ts.SyntaxKind.ObjectKeyword,
        string: ts.SyntaxKind.StringKeyword,
        unknown: ts.SyntaxKind.UnknownKeyword,
        void: ts.SyntaxKind.VoidKeyword,
      } as const;
      return ts.factory.createKeywordTypeNode(kinds[value.keyword]);
    }
    case 'type-reference':
      return ts.factory.createTypeReferenceNode(value.name, value.arguments.map(typeNode));
    case 'array-type':
      return ts.factory.createArrayTypeNode(typeNode(value.element));
    case 'indexed-access-type':
      return ts.factory.createIndexedAccessTypeNode(typeNode(value.object), typeNode(value.index));
    case 'type-query':
      return ts.factory.createTypeQueryNode(ts.factory.createIdentifier(value.name));
    case 'tuple-type':
      return ts.factory.createTupleTypeNode(value.elements.map(typeNode));
    case 'union-type':
      return ts.factory.createUnionTypeNode(value.members.map(typeNode));
    case 'intersection-type':
      return ts.factory.createIntersectionTypeNode(value.members.map(typeNode));
    case 'object-type':
      return ts.factory.createTypeLiteralNode(
        value.properties.map((property) =>
          ts.factory.createPropertySignature(
            property.readonly === true
              ? [ts.factory.createModifier(ts.SyntaxKind.ReadonlyKeyword)]
              : undefined,
            property.name,
            property.optional === true
              ? ts.factory.createToken(ts.SyntaxKind.QuestionToken)
              : undefined,
            typeNode(property.type),
          ),
        ),
      );
    case 'literal-type': {
      if (value.value === null) return ts.factory.createLiteralTypeNode(ts.factory.createNull());
      if (typeof value.value === 'boolean') {
        return ts.factory.createLiteralTypeNode(
          value.value ? ts.factory.createTrue() : ts.factory.createFalse(),
        );
      }
      return ts.factory.createLiteralTypeNode(
        typeof value.value === 'number'
          ? ts.factory.createNumericLiteral(value.value)
          : ts.factory.createStringLiteral(value.value),
      );
    }
    case 'function-type':
      return ts.factory.createFunctionTypeNode(
        undefined,
        value.parameters.map(parameter),
        typeNode(value.result),
      );
    default:
      return unreachable(value);
  }
}

function parameter(value: TargetTsParameter): ts.ParameterDeclaration {
  return ts.factory.createParameterDeclaration(
    undefined,
    value.rest === true ? ts.factory.createToken(ts.SyntaxKind.DotDotDotToken) : undefined,
    value.name,
    undefined,
    value.type === undefined ? undefined : typeNode(value.type),
    value.initializer === undefined ? undefined : expression(value.initializer),
  );
}

function literal(value: string | number | boolean | null): ts.Expression {
  if (value === null) return ts.factory.createNull();
  if (typeof value === 'boolean') return value ? ts.factory.createTrue() : ts.factory.createFalse();
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return ts.factory.createIdentifier('NaN');
    const negative = value < 0 || Object.is(value, -0);
    const magnitude = negative ? -value : value;
    const positive = Number.isFinite(magnitude)
      ? ts.factory.createNumericLiteral(magnitude)
      : ts.factory.createIdentifier('Infinity');
    return negative
      ? ts.factory.createPrefixUnaryExpression(ts.SyntaxKind.MinusToken, positive)
      : positive;
  }
  return ts.factory.createStringLiteral(value);
}

function binaryToken(value: TargetTsBinaryOperator): ts.BinaryOperator {
  const kinds: Readonly<Record<TargetTsBinaryOperator, ts.BinaryOperator>> = {
    '+': ts.SyntaxKind.PlusToken,
    '-': ts.SyntaxKind.MinusToken,
    '*': ts.SyntaxKind.AsteriskToken,
    '/': ts.SyntaxKind.SlashToken,
    '%': ts.SyntaxKind.PercentToken,
    '**': ts.SyntaxKind.AsteriskAsteriskToken,
    '&&': ts.SyntaxKind.AmpersandAmpersandToken,
    '||': ts.SyntaxKind.BarBarToken,
    '??': ts.SyntaxKind.QuestionQuestionToken,
    '===': ts.SyntaxKind.EqualsEqualsEqualsToken,
    '!==': ts.SyntaxKind.ExclamationEqualsEqualsToken,
    '<': ts.SyntaxKind.LessThanToken,
    '<=': ts.SyntaxKind.LessThanEqualsToken,
    '>': ts.SyntaxKind.GreaterThanToken,
    '>=': ts.SyntaxKind.GreaterThanEqualsToken,
    '&': ts.SyntaxKind.AmpersandToken,
    '|': ts.SyntaxKind.BarToken,
    '^': ts.SyntaxKind.CaretToken,
    '<<': ts.SyntaxKind.LessThanLessThanToken,
    '>>': ts.SyntaxKind.GreaterThanGreaterThanToken,
    '>>>': ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken,
    in: ts.SyntaxKind.InKeyword,
    instanceof: ts.SyntaxKind.InstanceOfKeyword,
  };
  return kinds[value];
}

function assignmentToken(value: TargetTsAssignmentOperator): ts.BinaryOperator {
  const kinds: Readonly<Record<TargetTsAssignmentOperator, ts.BinaryOperator>> = {
    '=': ts.SyntaxKind.EqualsToken,
    '+=': ts.SyntaxKind.PlusEqualsToken,
    '-=': ts.SyntaxKind.MinusEqualsToken,
    '*=': ts.SyntaxKind.AsteriskEqualsToken,
    '/=': ts.SyntaxKind.SlashEqualsToken,
    '%=': ts.SyntaxKind.PercentEqualsToken,
    '**=': ts.SyntaxKind.AsteriskAsteriskEqualsToken,
    '&&=': ts.SyntaxKind.AmpersandAmpersandEqualsToken,
    '||=': ts.SyntaxKind.BarBarEqualsToken,
    '??=': ts.SyntaxKind.QuestionQuestionEqualsToken,
    '&=': ts.SyntaxKind.AmpersandEqualsToken,
    '|=': ts.SyntaxKind.BarEqualsToken,
    '^=': ts.SyntaxKind.CaretEqualsToken,
    '<<=': ts.SyntaxKind.LessThanLessThanEqualsToken,
    '>>=': ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
    '>>>=': ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  };
  return kinds[value];
}

function unary(value: TargetTsUnaryOperator, operand: TargetTsExpression): ts.Expression {
  const target = expression(operand);
  switch (value) {
    case '!':
      return ts.factory.createPrefixUnaryExpression(ts.SyntaxKind.ExclamationToken, target);
    case '+':
      return ts.factory.createPrefixUnaryExpression(ts.SyntaxKind.PlusToken, target);
    case '-':
      return ts.factory.createPrefixUnaryExpression(ts.SyntaxKind.MinusToken, target);
    case '~':
      return ts.factory.createPrefixUnaryExpression(ts.SyntaxKind.TildeToken, target);
    case 'typeof':
      return ts.factory.createTypeOfExpression(target);
    case 'void':
      return ts.factory.createVoidExpression(target);
    default:
      return unreachable(value);
  }
}

function jsxAttribute(value: TargetTsJsxAttribute): ts.JsxAttributeLike {
  switch (value.kind) {
    case 'jsx-string-attribute':
      return ts.factory.createJsxAttribute(
        ts.factory.createIdentifier(value.name),
        ts.factory.createStringLiteral(value.value),
      );
    case 'jsx-expression-attribute':
      return ts.factory.createJsxAttribute(
        ts.factory.createIdentifier(value.name),
        ts.factory.createJsxExpression(undefined, expression(value.value)),
      );
    case 'jsx-spread-attribute':
      return ts.factory.createJsxSpreadAttribute(expression(value.value));
    default:
      return unreachable(value);
  }
}

function jsxChild(value: TargetTsJsxChild): ts.JsxChild {
  switch (value.kind) {
    case 'jsx-text-child':
      return ts.factory.createJsxText(value.text);
    case 'jsx-expression-child':
      return ts.factory.createJsxExpression(undefined, expression(value.value));
    case 'jsx-element-child':
      return jsxElement(value);
    default:
      return unreachable(value);
  }
}

function jsxElement(value: TargetTsJsxElementShape): ts.JsxElement | ts.JsxSelfClosingElement {
  const tag = ts.factory.createIdentifier(value.tag);
  const attributes = ts.factory.createJsxAttributes(value.attributes.map(jsxAttribute));
  if (value.children.length === 0) {
    return ts.factory.createJsxSelfClosingElement(tag, undefined, attributes);
  }
  return ts.factory.createJsxElement(
    ts.factory.createJsxOpeningElement(tag, undefined, attributes),
    value.children.map(jsxChild),
    ts.factory.createJsxClosingElement(tag),
  );
}

function isStatementBody(
  body: TargetTsExpression | readonly TargetTsStatement[],
): body is readonly TargetTsStatement[] {
  return Array.isArray(body);
}

function expression(value: TargetTsExpression): ts.Expression {
  switch (value.kind) {
    case 'identifier-expression':
      return ts.factory.createIdentifier(value.name);
    case 'this-expression':
      return ts.factory.createThis();
    case 'literal-expression':
      return literal(value.value);
    case 'undefined-expression':
      return ts.factory.createIdentifier('undefined');
    case 'array-expression':
      return ts.factory.createArrayLiteralExpression(value.elements.map(expression), false);
    case 'object-expression':
      return ts.factory.createObjectLiteralExpression(
        value.properties.map((entry) =>
          ts.factory.createPropertyAssignment(
            typeof entry.key === 'number'
              ? ts.factory.createNumericLiteral(entry.key)
              : ts.factory.createStringLiteral(entry.key),
            expression(entry.value),
          ),
        ),
        true,
      );
    case 'property-expression':
      return value.optional === true
        ? ts.factory.createPropertyAccessChain(expression(value.object), ts.factory.createToken(ts.SyntaxKind.QuestionDotToken), value.property)
        : ts.factory.createPropertyAccessExpression(expression(value.object), value.property);
    case 'element-expression':
      return ts.factory.createElementAccessExpression(
        expression(value.object),
        expression(value.index),
      );
    case 'call-expression':
      // A call through `object?.method` continues the optional chain (`object?.method()`).
      if (value.callee.kind === 'property-expression' && value.callee.optional === true) {
        return ts.factory.createCallChain(expression(value.callee), undefined, value.typeArguments?.map(typeNode), value.arguments.map(expression));
      }
      return ts.factory.createCallExpression(
        expression(value.callee),
        value.typeArguments?.map(typeNode),
        value.arguments.map(expression),
      );
    case 'new-expression':
      return ts.factory.createNewExpression(
        expression(value.callee),
        value.typeArguments?.map(typeNode),
        value.arguments.map(expression),
      );
    case 'unary-expression':
      return unary(value.operator, value.operand);
    case 'binary-expression':
      return ts.factory.createBinaryExpression(
        expression(value.left),
        binaryToken(value.operator),
        expression(value.right),
      );
    case 'assignment-expression':
      return ts.factory.createBinaryExpression(
        expression(value.target),
        assignmentToken(value.operator),
        expression(value.value),
      );
    case 'conditional-expression':
      return ts.factory.createConditionalExpression(
        expression(value.condition),
        ts.factory.createToken(ts.SyntaxKind.QuestionToken),
        expression(value.whenTrue),
        ts.factory.createToken(ts.SyntaxKind.ColonToken),
        expression(value.whenFalse),
      );
    case 'await-expression':
      return ts.factory.createAwaitExpression(expression(value.expression));
    case 'arrow-expression':
      return ts.factory.createArrowFunction(
        value.async === true ? [modifier('async')] : undefined,
        undefined,
        value.parameters.map(parameter),
        undefined,
        ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        isStatementBody(value.body)
          ? ts.factory.createBlock(value.body.map(statement), true)
          : expression(value.body),
      );
    case 'parenthesized-expression':
      return ts.factory.createParenthesizedExpression(expression(value.expression));
    case 'as-expression':
      return ts.factory.createAsExpression(expression(value.expression), typeNode(value.type));
    case 'non-null-expression':
      return ts.factory.createNonNullExpression(expression(value.expression));
    case 'jsx-element-expression': {
      return jsxElement(value);
    }
    case 'jsx-fragment-expression':
      return ts.factory.createJsxFragment(
        ts.factory.createJsxOpeningFragment(),
        value.children.map(jsxChild),
        ts.factory.createJsxJsxClosingFragment(),
      );
    default:
      return unreachable(value);
  }
}

function classMember(value: TargetTsClassMember): ts.ClassElement {
  switch (value.kind) {
    case 'field-member':
      return ts.factory.createPropertyDeclaration(
        modifiers(value.modifiers),
        value.name,
        value.definite === true
          ? ts.factory.createToken(ts.SyntaxKind.ExclamationToken)
          : undefined,
        value.type === undefined ? undefined : typeNode(value.type),
        value.initializer === undefined ? undefined : expression(value.initializer),
      );
    case 'method-member':
      return ts.factory.createMethodDeclaration(
        modifiers(value.modifiers),
        undefined,
        value.name,
        undefined,
        undefined,
        value.parameters.map(parameter),
        value.result === undefined ? undefined : typeNode(value.result),
        ts.factory.createBlock(value.body.map(statement), true),
      );
    case 'constructor-member':
      return ts.factory.createConstructorDeclaration(
        modifiers(value.modifiers),
        value.parameters.map(parameter),
        ts.factory.createBlock(value.body.map(statement), true),
      );
    case 'getter-member':
      return ts.factory.createGetAccessorDeclaration(
        modifiers(value.modifiers),
        value.name,
        [],
        value.result === undefined ? undefined : typeNode(value.result),
        ts.factory.createBlock(value.body.map(statement), true),
      );
    case 'setter-member':
      return ts.factory.createSetAccessorDeclaration(
        modifiers(value.modifiers),
        value.name,
        [parameter(value.parameter)],
        ts.factory.createBlock(value.body.map(statement), true),
      );
    default:
      return unreachable(value);
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one exhaustive mechanical syntax switch
function statement(value: TargetTsStatement): ts.Statement {
  switch (value.kind) {
    case 'import-statement': {
      const named =
        value.namespaceBinding !== undefined
          ? ts.factory.createNamespaceImport(ts.factory.createIdentifier(value.namespaceBinding))
          : value.namedBindings.length > 0
            ? ts.factory.createNamedImports(
                value.namedBindings.map((binding) =>
                  ts.factory.createImportSpecifier(
                    false,
                    binding.imported === binding.local
                      ? undefined
                      : ts.factory.createIdentifier(binding.imported),
                    ts.factory.createIdentifier(binding.local),
                  ),
                ),
              )
            : undefined;
      return ts.factory.createImportDeclaration(
        undefined,
        ts.factory.createImportClause(
          value.typeOnly === true,
          value.defaultBinding === undefined
            ? undefined
            : ts.factory.createIdentifier(value.defaultBinding),
          named,
        ),
        ts.factory.createStringLiteral(value.module),
        undefined,
      );
    }
    case 'destructure-statement':
      return ts.factory.createVariableStatement(
        undefined,
        ts.factory.createVariableDeclarationList(
          [
            ts.factory.createVariableDeclaration(
              ts.factory.createObjectBindingPattern([
                ...value.names.map((name) => ts.factory.createBindingElement(undefined, undefined, name)),
                ...(value.rest === undefined ? [] : [ts.factory.createBindingElement(ts.factory.createToken(ts.SyntaxKind.DotDotDotToken), undefined, value.rest)]),
              ]),
              undefined,
              undefined,
              expression(value.initializer),
            ),
          ],
          ts.NodeFlags.Const,
        ),
      );
    case 'variable-statement':
      return ts.factory.createVariableStatement(
        modifiers(value.modifiers),
        ts.factory.createVariableDeclarationList(
          [
            ts.factory.createVariableDeclaration(
              value.name,
              undefined,
              value.type === undefined ? undefined : typeNode(value.type),
              value.initializer === undefined ? undefined : expression(value.initializer),
            ),
          ],
          value.declaration === 'const' ? ts.NodeFlags.Const : ts.NodeFlags.Let,
        ),
      );
    case 'function-statement':
      return ts.factory.createFunctionDeclaration(
        modifiers(value.modifiers),
        undefined,
        value.name,
        undefined,
        value.parameters.map(parameter),
        value.result === undefined ? undefined : typeNode(value.result),
        ts.factory.createBlock(value.body.map(statement), true),
      );
    case 'class-statement':
      return ts.factory.createClassDeclaration(
        modifiers(value.modifiers),
        value.name,
        undefined,
        value.extends === undefined
          ? undefined
          : [
              ts.factory.createHeritageClause(ts.SyntaxKind.ExtendsKeyword, [
                ts.factory.createExpressionWithTypeArguments(expression(value.extends), undefined),
              ]),
            ],
        value.members.map(classMember),
      );
    case 'expression-statement':
      return ts.factory.createExpressionStatement(expression(value.expression));
    case 'export-default-statement':
      return ts.factory.createExportDefault(expression(value.expression));
    case 'return-statement':
      return ts.factory.createReturnStatement(
        value.expression === undefined ? undefined : expression(value.expression),
      );
    case 'throw-statement':
      return ts.factory.createThrowStatement(expression(value.expression));
    case 'if-statement':
      return ts.factory.createIfStatement(
        expression(value.condition),
        ts.factory.createBlock(value.then.map(statement), true),
        value.else === undefined
          ? undefined
          : ts.factory.createBlock(value.else.map(statement), true),
      );
    case 'while-statement':
      return ts.factory.createWhileStatement(
        expression(value.condition),
        ts.factory.createBlock(value.body.map(statement), true),
      );
    case 'for-of-statement':
      return ts.factory.createForOfStatement(
        undefined,
        ts.factory.createVariableDeclarationList(
          [ts.factory.createVariableDeclaration(value.binding)],
          ts.NodeFlags.Const,
        ),
        expression(value.iterable),
        ts.factory.createBlock(value.body.map(statement), true),
      );
    case 'block-statement':
      return ts.factory.createBlock(value.body.map(statement), true);
    case 'try-statement':
      return ts.factory.createTryStatement(
        ts.factory.createBlock(value.body.map(statement), true),
        ts.factory.createCatchClause(value.binding, ts.factory.createBlock(value.handler.map(statement), true)),
        undefined,
      );
    case 'break-statement':
      return ts.factory.createBreakStatement();
    case 'continue-statement':
      return ts.factory.createContinueStatement();
    case 'empty-statement':
      return ts.factory.createEmptyStatement();
    default:
      return unreachable(value);
  }
}

/** Mechanical formatting only; all semantic choices are already present in {@link source}. */
function printTargetTsSourceFile(source: TargetTsSourceFile): string {
  const sourceFile = ts.factory.updateSourceFile(
    ts.createSourceFile(
      source.sourcePath,
      '',
      ts.ScriptTarget.Latest,
      false,
      source.sourcePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    ),
    source.statements.map(statement),
  );
  return ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(sourceFile);
}

/** Print one planned source file without reparsing target text. */
export function emitTargetTsSourceFile(source: TargetTsSourceFile): string {
  return `${printTargetTsSourceFile(source).trimEnd()}\n`;
}
