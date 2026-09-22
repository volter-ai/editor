/**
 * Surgical native TypeScript edit for “Apply to Component”. The selected
 * instance supplies a literal value; the OID index supplies the component
 * declaration name. Only an existing literal destructuring default is
 * writable — computed defaults are source-owned logic and are refused.
 */

import ts from 'typescript';
import { parseAuthoringTsx } from './ts-ast';

export interface ComponentDefaultEditResult {
  readonly code: string;
  readonly changed: boolean;
  readonly dynamic: boolean;
  readonly error?: string;
}

function componentParameter(node: ts.Node, componentName: string): ts.ParameterDeclaration | null {
  if (ts.isFunctionDeclaration(node) && node.name?.text === componentName) {
    return node.parameters[0] ?? null;
  }
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.name.text === componentName &&
    node.initializer &&
    (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
  ) {
    return node.initializer.parameters[0] ?? null;
  }
  return null;
}

function findComponentParameter(
  node: ts.Node,
  componentName: string,
): ts.ParameterDeclaration | null {
  const direct = componentParameter(node, componentName);
  if (direct) return direct;
  let nested: ts.ParameterDeclaration | null = null;
  node.forEachChild((child) => {
    if (!nested) nested = findComponentParameter(child, componentName);
  });
  return nested;
}

function stringReplacement(initializer: ts.Expression, value: string): string | null {
  if (!ts.isStringLiteral(initializer) && !ts.isNoSubstitutionTemplateLiteral(initializer)) {
    return null;
  }
  const quote = initializer.getText()[0];
  if (quote === "'") {
    return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('\n', '\\n')}'`;
  }
  if (quote === '`') {
    return `\`${value
      .replaceAll('\\', '\\\\')
      .replaceAll('`', '\\`')
      .replaceAll('${', '\\${')
      .replaceAll('\n', '\\n')}\``;
  }
  return JSON.stringify(value);
}

function literalReplacement(initializer: ts.Expression, value: string): string | null {
  const stringLiteral = stringReplacement(initializer, value);
  if (stringLiteral !== null) return stringLiteral;
  if (
    ts.isNumericLiteral(initializer) ||
    (ts.isPrefixUnaryExpression(initializer) && ts.isNumericLiteral(initializer.operand))
  ) {
    return Number.isFinite(Number(value)) ? value : null;
  }
  if (
    initializer.kind === ts.SyntaxKind.TrueKeyword ||
    initializer.kind === ts.SyntaxKind.FalseKeyword
  ) {
    return value === 'true' || value === 'false' ? value : null;
  }
  if (ts.isArrayLiteralExpression(initializer)) {
    const trimmed = value.trim();
    return /^\[\s*-?(?:\d+(?:\.\d+)?|\.\d+)(?:\s*,\s*-?(?:\d+(?:\.\d+)?|\.\d+))*\s*\]$/.test(
      trimmed,
    )
      ? trimmed
      : null;
  }
  return null;
}

export function writeComponentDefault(
  code: string,
  fileName: string,
  componentName: string,
  prop: string,
  value: string,
): ComponentDefaultEditResult {
  const source = parseAuthoringTsx(fileName, code);
  const parameter = findComponentParameter(source, componentName);
  if (!parameter || !ts.isObjectBindingPattern(parameter.name)) {
    return {
      code,
      changed: false,
      dynamic: true,
      error: `${componentName} does not declare literal destructured defaults.`,
    };
  }
  const binding = parameter.name.elements.find((element) => {
    const authoredName = element.propertyName ?? element.name;
    return ts.isIdentifier(authoredName) && authoredName.text === prop;
  });
  if (!binding?.initializer) {
    return {
      code,
      changed: false,
      dynamic: true,
      error: `${componentName}.${prop} has no declared default initializer.`,
    };
  }
  const replacement = literalReplacement(binding.initializer, value);
  if (replacement === null) {
    return {
      code,
      changed: false,
      dynamic: true,
      error: `${componentName}.${prop} uses a computed or incompatible default.`,
    };
  }
  const start = binding.initializer.getStart(source);
  const end = binding.initializer.getEnd();
  const next = code.slice(0, start) + replacement + code.slice(end);
  return { code: next, changed: next !== code, dynamic: false };
}
