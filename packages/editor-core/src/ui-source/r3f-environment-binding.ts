/** Exact source tokens for native R3F scene attachments.
 *
 * These are not a VGAI environment format. `<color attach="background">`,
 * `<fog attach="fog">`, and `<fogExp2 attach="fog">` are ordinary Fiber
 * projections of THREE.Scene properties. The live Scene remains runtime truth;
 * this metadata only identifies literal constructor arguments that can be
 * changed without interpreting arbitrary project code.
 */

import ts from 'typescript';
import { jsxAttribute, numericLiteral } from './ts-ast';

import type { R3fEnvironmentBinding, R3fEnvironmentNumberBinding, R3fEnvironmentStringBinding } from '@volter/editor-sdk/source-authoring';
export type { R3fEnvironmentBinding, R3fEnvironmentNumberBinding, R3fEnvironmentStringBinding } from '@volter/editor-sdk/source-authoring';

function attributeString(attribute: ts.JsxAttribute | undefined): string | undefined {
  const initializer = attribute?.initializer;
  if (!initializer) return undefined;
  if (ts.isStringLiteral(initializer)) return initializer.text;
  const expression = ts.isJsxExpression(initializer) ? initializer.expression : undefined;
  return expression &&
    (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression))
    ? expression.text
    : undefined;
}

function args(element: ts.JsxOpeningLikeElement): readonly ts.Expression[] | undefined {
  const initializer = jsxAttribute(element, 'args')?.initializer;
  const expression =
    initializer && ts.isJsxExpression(initializer) ? initializer.expression : undefined;
  return expression && ts.isArrayLiteralExpression(expression)
    ? expression.elements.filter(ts.isExpression)
    : undefined;
}

function numberBinding(
  expression: ts.Expression | undefined,
  sf: ts.SourceFile,
): R3fEnvironmentNumberBinding | undefined {
  if (!expression) return undefined;
  const value = numericLiteral(expression);
  return value === undefined
    ? undefined
    : { value, start: expression.getStart(sf), end: expression.getEnd() };
}

function stringBinding(
  expression: ts.Expression | undefined,
  sf: ts.SourceFile,
): R3fEnvironmentStringBinding | undefined {
  if (
    !expression ||
    (!ts.isStringLiteral(expression) && !ts.isNoSubstitutionTemplateLiteral(expression))
  ) {
    return undefined;
  }
  const start = expression.getStart(sf);
  const quote = sf.text[start];
  if (quote !== "'" && quote !== '"' && quote !== '`') return undefined;
  return { value: expression.text, start, end: expression.getEnd(), quote };
}

/** Bind recognized native scene attachments, including dynamic ones. Dynamic
 * arguments deliberately produce a binding with missing tokens: the World
 * Inspector can still identify the native mode but must keep that field
 * read-only. */
export function environmentBindingsByElement(
  sf: ts.SourceFile,
): Map<ts.JsxOpeningLikeElement, R3fEnvironmentBinding> {
  const result = new Map<ts.JsxOpeningLikeElement, R3fEnvironmentBinding>();
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sf);
      const attachedTo = attributeString(jsxAttribute(node, 'attach'));
      const values = args(node);
      if (tag === 'color' && attachedTo === 'background') {
        const color = stringBinding(values?.[0], sf);
        result.set(node, {
          kind: 'background-color',
          ...(color ? { color } : {}),
        });
      } else if (tag === 'fog' && attachedTo === 'fog') {
        const color = stringBinding(values?.[0], sf);
        const near = numberBinding(values?.[1], sf);
        const far = numberBinding(values?.[2], sf);
        result.set(node, {
          kind: 'fog',
          ...(color ? { color } : {}),
          ...(near ? { near } : {}),
          ...(far ? { far } : {}),
        });
      } else if (tag === 'fogExp2' && attachedTo === 'fog') {
        const color = stringBinding(values?.[0], sf);
        const density = numberBinding(values?.[1], sf);
        result.set(node, {
          kind: 'fog-exp2',
          ...(color ? { color } : {}),
          ...(density ? { density } : {}),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return result;
}
