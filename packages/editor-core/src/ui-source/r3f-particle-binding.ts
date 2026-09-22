/** Source address for a native three.quarks `ParticleSystem` emitter shape. */

import ts from 'typescript';
import { enclosingScope, numericLiteral } from './ts-ast';

export type QuarksEmitterShape =
  | 'point'
  | 'sphere'
  | 'hemisphere'
  | 'cone'
  | 'circle'
  | 'donut'
  | 'rectangle'
  | 'grid';

export interface R3fParticleNumberBinding {
  readonly value: number;
  readonly start: number;
  readonly end: number;
}

export interface R3fParticleBinding {
  readonly system: string;
  readonly shape: QuarksEmitterShape;
  readonly constructor: string;
  readonly line: number;
  readonly col: number;
  readonly fields: Readonly<Record<string, R3fParticleNumberBinding>>;
}

const SHAPES: Record<string, QuarksEmitterShape> = {
  PointEmitter: 'point',
  SphereEmitter: 'sphere',
  HemisphereEmitter: 'hemisphere',
  ConeEmitter: 'cone',
  CircleEmitter: 'circle',
  DonutEmitter: 'donut',
  RectangleEmitter: 'rectangle',
  GridEmitter: 'grid',
};

interface Imports {
  readonly particleSystems: Set<string>;
  readonly shapes: Map<string, { imported: string; shape: QuarksEmitterShape }>;
  readonly useMemo: Set<string>;
}

function namedImports(statement: ts.Statement, module: string): readonly ts.ImportSpecifier[] {
  if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
    return [];
  }
  if (statement.moduleSpecifier.text !== module) return [];
  const bindings = statement.importClause?.namedBindings;
  return bindings && ts.isNamedImports(bindings) ? bindings.elements : [];
}

function importsOf(sf: ts.SourceFile): Imports {
  const particleSystems = new Set<string>();
  const shapes = new Map<string, { imported: string; shape: QuarksEmitterShape }>();
  const useMemo = new Set<string>();
  for (const statement of sf.statements) {
    for (const element of namedImports(statement, 'three.quarks')) {
      const imported = element.propertyName?.text ?? element.name.text;
      if (imported === 'ParticleSystem') particleSystems.add(element.name.text);
      const shape = SHAPES[imported];
      if (shape) shapes.set(element.name.text, { imported, shape });
    }
    for (const element of namedImports(statement, 'quarks.core')) {
      const imported = element.propertyName?.text ?? element.name.text;
      const shape = SHAPES[imported];
      if (shape) shapes.set(element.name.text, { imported, shape });
    }
    for (const element of namedImports(statement, 'react')) {
      const imported = element.propertyName?.text ?? element.name.text;
      if (imported === 'useMemo') useMemo.add(element.name.text);
    }
  }
  return { particleSystems, shapes, useMemo };
}

function returnedExpression(
  fn: ts.ArrowFunction | ts.FunctionExpression,
): ts.Expression | undefined {
  if (!ts.isBlock(fn.body)) return fn.body;
  return fn.body.statements.find(ts.isReturnStatement)?.expression;
}

function particleSystemExpression(
  expression: ts.Expression,
  imported: Imports,
): ts.NewExpression | undefined {
  if (
    ts.isNewExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    imported.particleSystems.has(expression.expression.text)
  ) {
    return expression;
  }
  if (
    !ts.isCallExpression(expression) ||
    !ts.isIdentifier(expression.expression) ||
    !imported.useMemo.has(expression.expression.text)
  ) {
    return undefined;
  }
  const factory = expression.arguments[0];
  if (!factory || (!ts.isArrowFunction(factory) && !ts.isFunctionExpression(factory)))
    return undefined;
  const returned = returnedExpression(factory);
  return returned ? particleSystemExpression(returned, imported) : undefined;
}

function propertyName(name: ts.PropertyName, sf: ts.SourceFile): string {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)
    ? name.text
    : name.getText(sf);
}

function property(
  object: ts.ObjectLiteralExpression,
  name: string,
  sf: ts.SourceFile,
): ts.PropertyAssignment | undefined {
  return object.properties.find(
    (candidate): candidate is ts.PropertyAssignment =>
      ts.isPropertyAssignment(candidate) && propertyName(candidate.name, sf) === name,
  );
}

function bindingOf(
  system: string,
  declaration: ts.VariableDeclaration,
  sf: ts.SourceFile,
  imported: Imports,
): R3fParticleBinding | undefined {
  const initializer = declaration.initializer;
  if (!initializer) return undefined;
  const construction = particleSystemExpression(initializer, imported);
  const options = construction?.arguments?.[0];
  if (!options || !ts.isObjectLiteralExpression(options)) return undefined;
  const shapeProperty = property(options, 'shape', sf);
  const shapeExpression = shapeProperty?.initializer;
  if (
    !shapeExpression ||
    !ts.isNewExpression(shapeExpression) ||
    !ts.isIdentifier(shapeExpression.expression)
  ) {
    return undefined;
  }
  const shape = imported.shapes.get(shapeExpression.expression.text);
  if (!shape) return undefined;
  const parameters = shapeExpression.arguments?.[0];
  const fields: Record<string, R3fParticleNumberBinding> = {};
  if (parameters && ts.isObjectLiteralExpression(parameters)) {
    for (const candidate of parameters.properties) {
      if (!ts.isPropertyAssignment(candidate)) continue;
      const value = numericLiteral(candidate.initializer);
      if (value === undefined) continue;
      fields[propertyName(candidate.name, sf)] = {
        value,
        start: candidate.initializer.getStart(sf),
        end: candidate.initializer.getEnd(),
      };
    }
  }
  const { line, character } = sf.getLineAndCharacterOfPosition(shapeExpression.getStart(sf));
  return {
    system,
    shape: shape.shape,
    constructor: shape.imported,
    line: line + 1,
    col: character,
    fields,
  };
}

function primitiveSystem(element: ts.JsxOpeningLikeElement): string | undefined {
  if (element.tagName.getText() !== 'primitive') return undefined;
  const object = element.attributes.properties.find(
    (candidate): candidate is ts.JsxAttribute =>
      ts.isJsxAttribute(candidate) && candidate.name.getText() === 'object',
  );
  const expression =
    object?.initializer && ts.isJsxExpression(object.initializer)
      ? object.initializer.expression
      : undefined;
  return expression &&
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.name.text === 'emitter'
    ? expression.expression.text
    : undefined;
}

/** Native particle bindings keyed by `<primitive object={system.emitter}>`. */
export function particleBindingsByElement(
  sf: ts.SourceFile,
): Map<ts.JsxOpeningLikeElement, R3fParticleBinding> {
  const imported = importsOf(sf);
  const byScope = new Map<ts.FunctionLikeDeclaration | null, Map<string, R3fParticleBinding>>();
  const collectSystems = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const binding = bindingOf(node.name.text, node, sf, imported);
      if (binding) {
        const scope = enclosingScope(node);
        const systems = byScope.get(scope) ?? new Map();
        systems.set(node.name.text, binding);
        byScope.set(scope, systems);
      }
    }
    ts.forEachChild(node, collectSystems);
  };
  collectSystems(sf);

  const result = new Map<ts.JsxOpeningLikeElement, R3fParticleBinding>();
  const resolve = (node: ts.Node, system: string): R3fParticleBinding | undefined => {
    let scope: ts.FunctionLikeDeclaration | null = enclosingScope(node);
    for (;;) {
      const binding = byScope.get(scope)?.get(system);
      if (binding) return binding;
      if (scope === null) return undefined;
      scope = enclosingScope(scope);
    }
  };
  const join = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const system = primitiveSystem(node);
      const binding = system ? resolve(node, system) : undefined;
      if (binding) result.set(node, binding);
    }
    ts.forEachChild(node, join);
  };
  join(sf);
  return result;
}
