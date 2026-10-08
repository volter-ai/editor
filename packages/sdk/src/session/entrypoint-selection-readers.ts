/**
 * Pure TS-AST readers over an entrypoint's SELECTION TABLE — shared by the
 * write side (`entrypoint-selection-source.ts`) and the read side
 * (`finders/scenes-from-entrypoint-selection.ts`). These two must agree on
 * what a selection table IS, or play remounts a key the finder never
 * discovered; one spelling here is what makes that agreement structural.
 * (The finder-import boundary bans importing from `finders/` — this sibling
 * sits outside that directory precisely so both sides can share it.)
 */

import ts from 'typescript';

/** The object literal a module-level `const <name> = { … }` binds. */
export function selectionTable(
  sf: ts.SourceFile,
  name: string,
): ts.ObjectLiteralExpression | undefined {
  for (const statement of sf.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue;
      const initializer = declaration.initializer;
      if (initializer && ts.isObjectLiteralExpression(initializer)) return initializer;
    }
  }
  return undefined;
}

/** A property's key when it is a plain identifier or string literal. */
export function propertyKey(property: ts.ObjectLiteralElementLike): string | undefined {
  const name = property.name;
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return undefined;
}

/**
 * The identifier the entrypoint INDEXES the selection table with — the
 * `activeScene` in `scenes[activeScene]`.
 *
 * `undefined` when the module never indexes the table; `null` when it does
 * but not readably (several identifiers, or a non-identifier index). Both
 * are honest "cannot be read" answers the callers turn into their own notes.
 */
export function indexingIdentifier(
  sf: ts.SourceFile,
  selection: string,
): string | undefined | null {
  const names = new Set<string>();
  let unreadable = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === selection
    ) {
      if (ts.isIdentifier(node.argumentExpression)) names.add(node.argumentExpression.text);
      else unreadable = true;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  if (names.size === 0 && !unreadable) return undefined;
  if (names.size !== 1 || unreadable) return null;
  return [...names][0];
}
