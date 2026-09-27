/**
 * ONE MEMBER OF AN OBJECT-LITERAL PROP, written at the call site: `params.threshold` in
 * `<Device params={{ threshold: -20, ratio: 1.5 }} />`, `params.bands.0.gain` through an array.
 * The same rule every other prop write keeps: only a literal is rewritten (a member bound to an
 * expression answers `dynamic`), and nothing else in the file moves. A missing member is added
 * to its object when asked (`addIfMissing`); `null` takes the member out.
 *
 * `writer.ts` scans strings so the page can run it; this one parses the expression with
 * TypeScript and runs only in the serving process.
 */

import ts from 'typescript';
import { analyzeJsxAttributes, findTagEnd } from './writer';

export interface MemberEditResult {
  readonly code: string;
  readonly changed: boolean;
  readonly dynamic: boolean;
}

const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** A literal written into an object: numbers and booleans bare, anything else a quoted string. */
function formatMember(value: string): string {
  if (NUMBER.test(value.trim()) || value === 'true' || value === 'false') return value.trim();
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** Whether an expression is a literal a gesture may replace: string, number (signed), boolean. */
export function isMemberLiteral(node: ts.Expression): boolean {
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isNumericLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    (ts.isPrefixUnaryExpression(node) &&
      (node.operator === ts.SyntaxKind.MinusToken || node.operator === ts.SyntaxKind.PlusToken) &&
      ts.isNumericLiteral(node.operand))
  );
}

/** A property's key as written (`threshold`, `'high-pass'`), or `null` when it is computed. */
export function memberKey(property: ts.ObjectLiteralElementLike): string | null {
  if (!ts.isPropertyAssignment(property)) return null;
  const name = property.name;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current)) {
    current = current.expression;
  }
  return current;
}

export function writePropMember(
  code: string,
  elementStart: number,
  path: readonly string[],
  newValue: string | null,
  opts?: { addIfMissing?: boolean },
): MemberEditResult {
  const unchanged = { code, changed: false, dynamic: false };
  const [propName, ...members] = path;
  if (!propName || members.length === 0 || code[elementStart] !== '<') return unchanged;
  const tagEnd = findTagEnd(code, elementStart);
  if (tagEnd < 0) return unchanged;
  const attr = analyzeJsxAttributes(code, elementStart, tagEnd).find((candidate) => candidate.name === propName);
  if (!attr || !attr.isExpression) return { code, changed: false, dynamic: attr !== undefined };
  // Parse the expression alone, in parentheses (a bare `{ … }` is a block): an offset in it,
  // less one, is an offset from `attr.valueStart`.
  const text = `(${code.slice(attr.valueStart, attr.valueEnd)})`;
  const file = ts.createSourceFile('member.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const statement = file.statements[0];
  if (!statement || !ts.isExpressionStatement(statement)) return { code, changed: false, dynamic: true };
  let container = unwrap(statement.expression);
  const splice = (start: number, end: number, insert: string): MemberEditResult => {
    const next = code.slice(0, attr.valueStart + start - 1) + insert + code.slice(attr.valueStart + end - 1);
    return { code: next, changed: next !== code, dynamic: false };
  };
  for (let depth = 0; depth < members.length; depth++) {
    const key = members[depth]!;
    const last = depth === members.length - 1;
    if (ts.isArrayLiteralExpression(container)) {
      const element = /^\d+$/.test(key) ? container.elements[Number(key)] : undefined;
      if (!element) return { code, changed: false, dynamic: false };
      if (!last) {
        container = unwrap(element);
        continue;
      }
      if (newValue === null || !isMemberLiteral(element)) return { code, changed: false, dynamic: !isMemberLiteral(element) };
      return splice(element.getStart(file), element.end, formatMember(newValue));
    }
    if (!ts.isObjectLiteralExpression(container)) return { code, changed: false, dynamic: true };
    const properties = container.properties;
    const property = properties.find((candidate) => memberKey(candidate) === key);
    // A spread or computed key could supply this member: the source does not say which value wins.
    const opaque = properties.some((candidate) => ts.isSpreadAssignment(candidate) || (ts.isPropertyAssignment(candidate) && memberKey(candidate) === null));
    if (!property || !ts.isPropertyAssignment(property)) {
      if (!last || newValue === null || !opts?.addIfMissing) return unchanged;
      if (opaque) return { code, changed: false, dynamic: true };
      const entry = `${/^[A-Za-z_$][\w$]*$/.test(key) ? key : `'${key}'`}: ${formatMember(newValue)}`;
      const lastProperty = properties[properties.length - 1];
      if (!lastProperty) return splice(container.getStart(file) + 1, container.end - 1, ` ${entry} `);
      return splice(lastProperty.end, lastProperty.end, `, ${entry}`);
    }
    const value = unwrap(property.initializer);
    if (!last) {
      container = value;
      continue;
    }
    if (!isMemberLiteral(property.initializer)) return { code, changed: false, dynamic: true };
    if (newValue !== null) return splice(property.initializer.getStart(file), property.initializer.end, formatMember(newValue));
    // Take the member out with the comma that separates it from its neighbour.
    const index = properties.indexOf(property);
    const next = properties[index + 1];
    const previous = properties[index - 1];
    if (next) return splice(property.getStart(file), next.getStart(file), '');
    if (previous) return splice(previous.end, properties.hasTrailingComma ? property.end + 1 : property.end, '');
    return splice(container.getStart(file) + 1, container.end - 1, '');
  }
  return unchanged;
}
