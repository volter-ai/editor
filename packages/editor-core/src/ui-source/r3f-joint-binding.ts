/**
 * Source addresses for native `@react-three/rapier` impulse joints.
 *
 * A joint hook has no JSX node of its own, so it cannot carry an OID. The two
 * `<RigidBody ref={…}>` elements are its existing source anchors. This analysis
 * joins a package-recognized hook to those elements inside the same lexical
 * component and records only JSON-shaped data on their OID entries. Literal
 * hook parameters can be written back in place; computed parameters remain
 * identifiable but deliberately read-only.
 */

import ts from 'typescript';
import { enclosingScope, numericLiteral, refIdentifier } from './ts-ast';

export type R3fJointHook =
  | 'useFixedJoint'
  | 'useSphericalJoint'
  | 'useRevoluteJoint'
  | 'usePrismaticJoint'
  | 'useRopeJoint'
  | 'useSpringJoint';

export type R3fJointLiteral = number | boolean | readonly R3fJointLiteral[];
export type R3fJointLiteralRange =
  | { readonly start: number; readonly end: number }
  | readonly R3fJointLiteralRange[];

export interface R3fJointBinding {
  readonly hook: R3fJointHook;
  readonly line: number;
  readonly col: number;
  readonly body1Ref: string;
  readonly body2Ref: string;
  readonly endpoint: 0 | 1;
  readonly params?: readonly R3fJointLiteral[];
  /** Exact leaf token ranges, shape-identical to `params`. Writers change only
   * the numeric/boolean token they own, preserving formatting and comments. */
  readonly paramRanges?: readonly R3fJointLiteralRange[];
}

const JOINT_HOOKS = new Set<R3fJointHook>([
  'useFixedJoint',
  'useSphericalJoint',
  'useRevoluteJoint',
  'usePrismaticJoint',
  'useRopeJoint',
  'useSpringJoint',
]);

function rapierNamedImports(statement: ts.Statement): readonly ts.ImportSpecifier[] {
  if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
    return [];
  }
  if (statement.moduleSpecifier.text !== '@react-three/rapier') return [];
  const bindings = statement.importClause?.namedBindings;
  return bindings && ts.isNamedImports(bindings) ? bindings.elements : [];
}

function imports(sf: ts.SourceFile): {
  hooks: Map<string, R3fJointHook>;
  rigidBodies: Set<string>;
} {
  const hooks = new Map<string, R3fJointHook>();
  const rigidBodies = new Set<string>();
  for (const statement of sf.statements) {
    for (const element of rapierNamedImports(statement)) {
      const imported = element.propertyName?.text ?? element.name.text;
      if (imported === 'RigidBody') rigidBodies.add(element.name.text);
      if (JOINT_HOOKS.has(imported as R3fJointHook)) {
        hooks.set(element.name.text, imported as R3fJointHook);
      }
    }
  }
  return { hooks, rigidBodies };
}

type BodyIndex = Map<ts.FunctionLikeDeclaration | null, Map<string, ts.JsxOpeningLikeElement[]>>;

interface JointBindingPair {
  readonly first: ts.JsxOpeningLikeElement;
  readonly second: ts.JsxOpeningLikeElement;
  readonly binding: Omit<R3fJointBinding, 'endpoint'>;
}

function bindingPairForCall(
  call: ts.CallExpression,
  sf: ts.SourceFile,
  hooks: ReadonlyMap<string, R3fJointHook>,
  bodies: BodyIndex,
): JointBindingPair | null {
  if (!ts.isIdentifier(call.expression)) return null;
  const hook = hooks.get(call.expression.text);
  const body1 = call.arguments[0];
  const body2 = call.arguments[1];
  const paramsExpression = call.arguments[2];
  if (!hook || !body1 || !body2 || !paramsExpression) return null;
  if (!ts.isIdentifier(body1) || !ts.isIdentifier(body2)) return null;
  const scopeBodies = bodies.get(enclosingScope(call));
  const first = scopeBodies?.get(body1.text);
  const second = scopeBodies?.get(body2.text);
  // More than one element using one ref is not a writable address.
  if (first?.length !== 1 || second?.length !== 1) return null;
  const literal = literalValue(paramsExpression);
  const params = Array.isArray(literal) && validParams(hook, literal) ? literal : undefined;
  const ranges = params ? literalRanges(paramsExpression) : undefined;
  const { line, character } = sf.getLineAndCharacterOfPosition(call.getStart(sf));
  return {
    first: first[0]!,
    second: second[0]!,
    binding: {
      hook,
      line: line + 1,
      col: character,
      body1Ref: body1.text,
      body2Ref: body2.text,
      ...(params
        ? {
            params,
            ...(Array.isArray(ranges) ? { paramRanges: ranges } : {}),
          }
        : {}),
    },
  };
}

function literalValue(expression: ts.Expression): R3fJointLiteral | undefined {
  const numeric = numericLiteral(expression);
  if (numeric !== undefined) return numeric;
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (!ts.isArrayLiteralExpression(expression)) return undefined;
  const result: R3fJointLiteral[] = [];
  for (const element of expression.elements) {
    if (ts.isSpreadElement(element) || ts.isOmittedExpression(element)) return undefined;
    const value = literalValue(element);
    if (value === undefined) return undefined;
    result.push(value);
  }
  return result;
}

function literalRanges(expression: ts.Expression): R3fJointLiteralRange | undefined {
  if (numericLiteral(expression) !== undefined) {
    return { start: expression.getStart(), end: expression.getEnd() };
  }
  if (
    expression.kind === ts.SyntaxKind.TrueKeyword ||
    expression.kind === ts.SyntaxKind.FalseKeyword
  ) {
    return { start: expression.getStart(), end: expression.getEnd() };
  }
  if (!ts.isArrayLiteralExpression(expression)) return undefined;
  const result: R3fJointLiteralRange[] = [];
  for (const element of expression.elements) {
    if (ts.isSpreadElement(element) || ts.isOmittedExpression(element)) return undefined;
    const range = literalRanges(element);
    if (!range) return undefined;
    result.push(range);
  }
  return result;
}

function validParams(hook: R3fJointHook, params: readonly R3fJointLiteral[]): boolean {
  const vec = (value: R3fJointLiteral | undefined, length: number): boolean =>
    Array.isArray(value) &&
    value.length === length &&
    value.every((part) => typeof part === 'number');
  switch (hook) {
    case 'useFixedJoint':
      return (
        params.length === 4 &&
        vec(params[0], 3) &&
        vec(params[1], 4) &&
        vec(params[2], 3) &&
        vec(params[3], 4)
      );
    case 'useSphericalJoint':
      return params.length === 2 && vec(params[0], 3) && vec(params[1], 3);
    case 'useRevoluteJoint':
    case 'usePrismaticJoint':
      return (
        (params.length === 3 || params.length === 4) &&
        vec(params[0], 3) &&
        vec(params[1], 3) &&
        vec(params[2], 3) &&
        (params.length === 3 || vec(params[3], 2))
      );
    case 'useRopeJoint':
      return (
        params.length === 3 &&
        vec(params[0], 3) &&
        vec(params[1], 3) &&
        typeof params[2] === 'number'
      );
    case 'useSpringJoint':
      return (
        params.length === 5 &&
        vec(params[0], 3) &&
        vec(params[1], 3) &&
        params.slice(2).every((part) => typeof part === 'number')
      );
  }
}

/** Joint bindings keyed by the existing `<RigidBody>` opening element. */
export function jointBindingsByElement(
  sf: ts.SourceFile,
): Map<ts.JsxOpeningLikeElement, readonly R3fJointBinding[]> {
  const imported = imports(sf);
  const result = new Map<ts.JsxOpeningLikeElement, R3fJointBinding[]>();
  if (imported.hooks.size === 0 || imported.rigidBodies.size === 0) return result;

  const bodies: BodyIndex = new Map();
  const collectBodies = (node: ts.Node): void => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      imported.rigidBodies.has(node.tagName.getText(sf))
    ) {
      const ref = refIdentifier(node);
      if (ref) {
        const scope = enclosingScope(node);
        const scoped = bodies.get(scope) ?? new Map();
        const matches = scoped.get(ref) ?? [];
        matches.push(node);
        scoped.set(ref, matches);
        bodies.set(scope, scoped);
      }
    }
    ts.forEachChild(node, collectBodies);
  };
  collectBodies(sf);

  const attach = (element: ts.JsxOpeningLikeElement, binding: R3fJointBinding): void => {
    const bindings = result.get(element) ?? [];
    bindings.push(binding);
    result.set(element, bindings);
  };

  const collectHooks = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const pair = bindingPairForCall(node, sf, imported.hooks, bodies);
      if (pair) {
        attach(pair.first, { ...pair.binding, endpoint: 0 });
        attach(pair.second, { ...pair.binding, endpoint: 1 });
      }
    }
    ts.forEachChild(node, collectHooks);
  };
  collectHooks(sf);
  return result;
}
