/**
 * THE MECHANICAL TypeScript-AST HELPERS every `ui-source/` reader repeats.
 *
 * Not an abstraction over the TypeScript compiler API — each function here
 * hands back the compiler's OWN node and gets out of the way, and every caller
 * keeps programming against `ts.*`. What they remove is the retyping: the
 * eleven modules in this directory that read a TSX module each spelled the same
 * four or five little walks out again, and the copies had begun to disagree
 * about things that matter.
 *
 * What "matters" means, concretely — this is the drift these functions existed
 * in nine, three, three, two and two copies of, and what each copy got wrong:
 *
 *   - {@link parseAuthoringTsx}: `ts.createSourceFile(file, code,
 *     ScriptTarget.Latest, true, ScriptKind.TSX)` appeared at NINE sites, two of
 *     them already wrapped in a local `parseTsx`/`sourceFile` whose only
 *     difference was argument order. Both of the last two arguments are silent
 *     if wrong: `setParentNodes: false` leaves `node.parent` undefined, which
 *     breaks every upward walk here (including {@link enclosingScope}) at
 *     runtime rather than at compile time, and a missing `ScriptKind.TSX`
 *     parses JSX as type assertions.
 *   - {@link hasModifier}: two copies, ALREADY drifted —
 *     `plan-fork-component.ts`'s guarded with `ts.canHaveModifiers` and
 *     `r3f-project-contracts.ts`'s cast the node to `ts.HasModifiers` and hoped.
 *     The guarded form is the one kept.
 *   - {@link enclosingScope}: three copies of one loop, returning
 *     `FunctionLikeDeclaration` in two and `SignatureDeclaration` in the third
 *     for the same four node kinds.
 *   - {@link numericLiteral}: three copies (`numeric`, `numericLiteral`) of the
 *     unary-sign rule — the part a fourth author would plausibly write without,
 *     silently losing every negative literal.
 *   - {@link jsxAttribute} / {@link refIdentifier}: two and three copies of
 *     "find this attribute", one of the `refIdentifier`s returning `undefined`
 *     where the others return `null`.
 *
 * Deliberately NOT here: anything whose two versions differ for a caller's own
 * reason. `plan-fork-component.ts`'s `jsxAtOffset` and `reparent-guard.ts`'s
 * `jsxElementAt` look like twins and are not — one wants the OPENING element to
 * read its tag, the other wants the whole `ts.JsxElement` to move it, and the
 * second prunes the walk by span while the first does not.
 */

import * as ts from 'typescript';

/**
 * Parse one authored TSX/TS module the way every reader in this directory
 * needs it: newest syntax, parent pointers set, JSX enabled.
 *
 * `file` is the module's path — it is what the compiler reports in positions
 * and what `node.getText(sf)` reads against, so pass the real one where there
 * is one.
 */
/**
 * ONE parse per (file, bytes) — the same source is parsed several times over
 * for one bundle otherwise.
 *
 * `ProjectContractResolver` calls this three times for a single file
 * (`importedForSource`, `typeAliasesForSource`, `propSpecsForSource`), the
 * stamping transform parses it again, and every one of those runs on EVERY
 * structural edit.
 * Measured on `examples/third-person`, the contract walk alone costs 380ms of
 * the ~1.1s an edit spends on CPU.
 *
 * Keyed on the BYTES, so it is sound in a way an analysis cache is not: a
 * parse is a pure function of its input, while what a file MEANS also depends
 * on the files it imports. Edited bytes miss the cache and re-parse; the entry
 * for the old bytes is dropped, so the map holds one node tree per live file
 * rather than one per revision.
 */
const parsedByFile = new Map<
  string,
  { readonly code: string; readonly sourceFile: ts.SourceFile }
>();

export function parseAuthoringTsx(file: string, code: string): ts.SourceFile {
  const cached = parsedByFile.get(file);
  if (cached && cached.code === code) return cached.sourceFile;
  const sourceFile = ts.createSourceFile(
    file,
    code,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );
  parsedByFile.set(file, { code, sourceFile });
  return sourceFile;
}

/** Drop every cached parse — for a project switch, where the next project's
 *  files may reuse these paths with different bytes. Bytes are compared on
 *  every hit anyway, so this is hygiene against unbounded growth, not
 *  correctness. */
export function clearAuthoringParseCache(): void {
  parsedByFile.clear();
}

/** Whether `node` carries a given modifier (`export`, `default`, …). False for
 *  a node kind that cannot carry modifiers at all, rather than throwing. */
export function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  return (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind);
}

/**
 * The nearest function-like ancestor of `node` — the scope a hook call, a ref
 * declaration or a JSX element belongs to.
 *
 * Requires parent pointers, so the source must come from
 * {@link parseAuthoringTsx} (or another parse that set them).
 */
export function enclosingScope(node: ts.Node): ts.FunctionLikeDeclaration | null {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (
      ts.isArrowFunction(current) ||
      ts.isFunctionExpression(current) ||
      ts.isFunctionDeclaration(current) ||
      ts.isMethodDeclaration(current)
    ) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

/**
 * The number an expression literally IS, or `undefined` when it is anything
 * computed. A leading `-`/`+` counts: `position={[-1, 0, 2]}` is authored
 * constantly and its first entry is a `PrefixUnaryExpression`, not a numeric
 * literal.
 */
export function numericLiteral(expression: ts.Expression): number | undefined {
  if (ts.isNumericLiteral(expression)) return Number(expression.text);
  if (
    ts.isPrefixUnaryExpression(expression) &&
    (expression.operator === ts.SyntaxKind.MinusToken ||
      expression.operator === ts.SyntaxKind.PlusToken) &&
    ts.isNumericLiteral(expression.operand)
  ) {
    const value = Number(expression.operand.text);
    return expression.operator === ts.SyntaxKind.MinusToken ? -value : value;
  }
  return undefined;
}

/** The named attribute on a JSX opening element, or `undefined`. Spread
 *  attributes are not attributes and are skipped. */
export function jsxAttribute(
  element: ts.JsxOpeningLikeElement,
  name: string,
): ts.JsxAttribute | undefined {
  return element.attributes.properties.find(
    (candidate): candidate is ts.JsxAttribute =>
      ts.isJsxAttribute(candidate) && candidate.name.getText() === name,
  );
}

/**
 * The identifier a `ref={x}` attribute binds on this element, or `null`.
 *
 * `null` for both "no `ref`" and "a `ref` bound to something that is not a bare
 * identifier" (`ref={(n) => …}`, `ref={refs[i]}`): every caller is matching the
 * ref against a `useRef` declaration by NAME, and neither case has one.
 */
export function refIdentifier(element: ts.JsxOpeningLikeElement): string | null {
  const ref = jsxAttribute(element, 'ref');
  const initializer = ref?.initializer;
  if (!initializer || !ts.isJsxExpression(initializer) || !initializer.expression) return null;
  return ts.isIdentifier(initializer.expression) ? initializer.expression.text : null;
}
