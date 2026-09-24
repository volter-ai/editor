/** Source addresses for Drei's native THREE.LOD projection (`<Detailed>`). */

import ts from 'typescript';
import { jsxAttribute, numericLiteral } from './ts-ast';

import type { R3fLodBinding, R3fLodNumberBinding } from '@volter/editor-sdk/source-authoring';
export type { R3fLodBinding, R3fLodNumberBinding } from '@volter/editor-sdk/source-authoring';

function detailedNames(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    if (!statement.moduleSpecifier.text.startsWith('@react-three/drei')) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if ((element.propertyName?.text ?? element.name.text) === 'Detailed') {
          names.add(element.name.text);
        }
      }
    } else if (bindings && ts.isNamespaceImport(bindings)) {
      names.add(`${bindings.name.text}.Detailed`);
    }
  }
  return names;
}

function expressionOf(attribute: ts.JsxAttribute | undefined): ts.Expression | undefined {
  return attribute?.initializer && ts.isJsxExpression(attribute.initializer)
    ? attribute.initializer.expression
    : undefined;
}

function numberBinding(
  expression: ts.Expression,
  sf: ts.SourceFile,
): R3fLodNumberBinding | undefined {
  const value = numericLiteral(expression);
  return value === undefined
    ? undefined
    : { value, start: expression.getStart(sf), end: expression.getEnd() };
}

/** Bind every recognized `<Detailed>` even when its values are computed: the
 * live THREE.LOD remains inspectable, while only literal tokens are writable. */
export function lodBindingsByElement(
  sf: ts.SourceFile,
): Map<ts.JsxOpeningLikeElement, R3fLodBinding> {
  const names = detailedNames(sf);
  const result = new Map<ts.JsxOpeningLikeElement, R3fLodBinding>();
  const visit = (node: ts.Node): void => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      names.has(node.tagName.getText(sf))
    ) {
      const distancesExpression = expressionOf(jsxAttribute(node, 'distances'));
      const distanceBindings =
        distancesExpression && ts.isArrayLiteralExpression(distancesExpression)
          ? distancesExpression.elements.map((element) => numberBinding(element, sf))
          : [];
      const distances =
        distanceBindings.length > 0 && distanceBindings.every((value) => value !== undefined)
          ? (distanceBindings as R3fLodNumberBinding[])
          : undefined;
      const hysteresisExpression = expressionOf(jsxAttribute(node, 'hysteresis'));
      const hysteresis = hysteresisExpression ? numberBinding(hysteresisExpression, sf) : undefined;
      const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      result.set(node, {
        line: line + 1,
        col: character,
        ...(distances ? { distances } : {}),
        ...(hysteresis ? { hysteresis } : {}),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return result;
}
