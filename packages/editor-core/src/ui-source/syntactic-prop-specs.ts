/**
 * SYNTACTIC declared-prop specs — the checker-free half of the declared-props
 * story, for the tier that cannot build a `ts.Program`.
 *
 * The dev server resolves a component's prop surface semantically
 * (`component-prop-types.ts`: a real `ts.LanguageService`, so
 * `variant: EnemyVariant` becomes `'raider' | 'sharpshooter'` with no grammar
 * here). The hosted editor has no filesystem to host a program, and until this
 * module it shipped NO specs at all — which silently disabled everything
 * downstream that gates on a spec: the Prefab Instance card's override
 * detection (`isOverride` requires `spec.optional`) and Apply-to-Component
 * (requires `spec.defaultValue`) read as "Overrides (0) — Using component
 * defaults" while the authored divergence sat in plain sight.
 *
 * What syntax alone CAN answer, this answers, by the same WHICH-props rule the
 * checker module documents: the props that belong to a component are the
 * members the author literally wrote in its props type —
 * `Omit<ThreeElements['mesh'], …> & { color?: string }` contributes only
 * `{ color?: string }`; the forwarded native surface is not the author's.
 * Destructured parameter defaults (`{ color = '#c8dce1' }`) supply
 * `optional`/`defaultText`/`defaultValue` — exactly the fields the override
 * and apply gates read, and `writeComponentDefault` rewrites. Types the
 * grammar cannot prove stay `null`, the spec's documented "no honest widget"
 * state; they are never guessed from a default's shape.
 *
 * A component with no authored members but WITH destructured defaults still
 * gets specs for those defaulted names — the spec docstring's own rule
 * ("Declared `?:`, or given a default by the component's destructuring").
 */

import ts from 'typescript';
import type { ComponentPropSpec, R3fTypeAlias } from './oid-transform';

interface AuthoredMember {
  optional: boolean;
  type: ComponentPropSpec['type'];
  options?: Array<string | number>;
}

/** `'a' | 'b'` → enum options; `[number, number, number]` → vec3; keywords →
 *  their widget; everything else → `null` (no honest widget from syntax). */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one bounded type-syntax dispatcher, not application control flow.
function widgetTypeOf(node: ts.TypeNode | undefined): {
  type: ComponentPropSpec['type'];
  options?: Array<string | number>;
} {
  if (!node) return { type: null };
  switch (node.kind) {
    case ts.SyntaxKind.StringKeyword:
      return { type: 'string' };
    case ts.SyntaxKind.NumberKeyword:
      return { type: 'number' };
    case ts.SyntaxKind.BooleanKeyword:
      return { type: 'boolean' };
    default:
      break;
  }
  if (ts.isUnionTypeNode(node)) {
    const options: Array<string | number> = [];
    for (const member of node.types) {
      if (!ts.isLiteralTypeNode(member)) return { type: null };
      if (ts.isStringLiteral(member.literal)) options.push(member.literal.text);
      else if (ts.isNumericLiteral(member.literal)) options.push(Number(member.literal.text));
      else return { type: null };
    }
    return options.length > 0 ? { type: 'enum', options } : { type: null };
  }
  if (
    ts.isTupleTypeNode(node) &&
    node.elements.length === 3 &&
    node.elements.every((element) => element.kind === ts.SyntaxKind.NumberKeyword)
  ) {
    return { type: 'vec3' };
  }
  return { type: null };
}

/** A member's type through the alias it names — `kind: WeaponKind` where
 *  `WeaponKind` is `'pistol' | 'rifle' | 'grenade'` declared in this file or
 *  imported from another the resolver supplied. Without this the member read
 *  `type: null` and a required enum prop had no first option to offer a drop
 *  (`<WeaponPickup>` rendered nothing until `kind` was set — runhuman pass
 *  123; the door built for it answered null on preview-b56). One hop, in the
 *  file the alias was written in. */
function memberTypeNode(
  node: ts.TypeNode | undefined,
  sf: ts.SourceFile,
  importedAliases: ReadonlyMap<string, R3fTypeAlias>,
): ts.TypeNode | undefined {
  if (!node || !ts.isTypeReferenceNode(node) || !ts.isIdentifier(node.typeName)) return node;
  if (node.typeArguments && node.typeArguments.length > 0) return node;
  const name = node.typeName.text;
  const local = localTypeDeclaration(sf, name);
  if (local) return ts.isTypeAliasDeclaration(local) ? local.type : node;
  const imported = importedAliases.get(name);
  return imported ? imported.type : node;
}

function collectMembers(
  members: ts.NodeArray<ts.TypeElement>,
  into: Map<string, AuthoredMember>,
  sf: ts.SourceFile,
  importedAliases: ReadonlyMap<string, R3fTypeAlias>,
): void {
  for (const member of members) {
    if (!ts.isPropertySignature(member)) continue;
    const name =
      ts.isIdentifier(member.name) || ts.isStringLiteral(member.name) ? member.name.text : null;
    if (!name) continue;
    into.set(name, {
      optional: member.questionToken !== undefined,
      ...widgetTypeOf(memberTypeNode(member.type, sf, importedAliases)),
    });
  }
}

/** A named type declared in this same source file, or null. */
function localTypeDeclaration(
  sf: ts.SourceFile,
  name: string,
): ts.TypeAliasDeclaration | ts.InterfaceDeclaration | null {
  for (const statement of sf.statements) {
    if (
      (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) &&
      statement.name.text === name
    ) {
      return statement;
    }
  }
  return null;
}

/**
 * The authored members of a props type node. Follows intersections, same-file
 * aliases/interfaces, and imported aliases the resolver supplied; a reference
 * that resolves to nothing project-authored (`Omit<…>`, `ThreeElements[…]`)
 * contributes nothing — the checker module's WHICH-props rule.
 */
function membersOfTypeNode(
  node: ts.TypeNode,
  sf: ts.SourceFile,
  importedAliases: ReadonlyMap<string, R3fTypeAlias>,
  into: Map<string, AuthoredMember>,
  depth: number,
): void {
  if (depth > 4) return;
  if (ts.isTypeLiteralNode(node)) {
    collectMembers(node.members, into, sf, importedAliases);
    return;
  }
  if (ts.isIntersectionTypeNode(node)) {
    for (const part of node.types) {
      membersOfTypeNode(part, sf, importedAliases, into, depth + 1);
    }
    return;
  }
  if (!ts.isTypeReferenceNode(node) || !ts.isIdentifier(node.typeName)) return;
  const name = node.typeName.text;
  const local = localTypeDeclaration(sf, name);
  if (local) {
    if (ts.isTypeAliasDeclaration(local)) {
      membersOfTypeNode(local.type, sf, importedAliases, into, depth + 1);
    } else {
      collectMembers(local.members, into, sf, importedAliases);
    }
    return;
  }
  const imported = importedAliases.get(name);
  // The alias's own references resolve in the file it was WRITTEN in — the
  // pairing `R3fTypeAlias` exists to carry.
  if (imported) membersOfTypeNode(imported.type, imported.sf, new Map(), into, depth + 1);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one bounded literal-syntax dispatcher, not application control flow.
function defaultOf(
  init: ts.Expression,
  sf: ts.SourceFile,
): { defaultText: string; defaultValue?: string | number | boolean | number[] } {
  const defaultText = init.getText(sf);
  if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) {
    return { defaultText, defaultValue: init.text };
  }
  if (ts.isNumericLiteral(init)) return { defaultText, defaultValue: Number(init.text) };
  if (
    ts.isPrefixUnaryExpression(init) &&
    init.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(init.operand)
  ) {
    return { defaultText, defaultValue: -Number(init.operand.text) };
  }
  if (init.kind === ts.SyntaxKind.TrueKeyword) return { defaultText, defaultValue: true };
  if (init.kind === ts.SyntaxKind.FalseKeyword) return { defaultText, defaultValue: false };
  if (ts.isArrayLiteralExpression(init)) {
    const numbers: number[] = [];
    for (const element of init.elements) {
      if (ts.isNumericLiteral(element)) numbers.push(Number(element.text));
      else if (
        ts.isPrefixUnaryExpression(element) &&
        element.operator === ts.SyntaxKind.MinusToken &&
        ts.isNumericLiteral(element.operand)
      ) {
        numbers.push(-Number(element.operand.text));
      } else return { defaultText };
    }
    return { defaultText, defaultValue: numbers };
  }
  return { defaultText };
}

/** The props parameter of a component declaration, however it is spelled. */
function componentParameterOf(node: ts.Node): {
  name: string;
  parameter: ts.ParameterDeclaration;
} | null {
  if (ts.isFunctionDeclaration(node) && node.name && node.parameters[0]) {
    return { name: node.name.text, parameter: node.parameters[0] };
  }
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.initializer &&
    (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) &&
    node.initializer.parameters[0]
  ) {
    return { name: node.name.text, parameter: node.initializer.parameters[0] };
  }
  return null;
}

/**
 * Every top-level component in `sf` that declares a prop surface syntax can
 * read, by local name. `importedAliases` is the resolver's answer for the
 * file's `import type { X } from './shared'` bindings.
 */
export function localComponentPropSpecs(
  sf: ts.SourceFile,
  importedAliases: ReadonlyMap<string, R3fTypeAlias>,
): Map<string, ComponentPropSpec[]> {
  const found = new Map<string, ComponentPropSpec[]>();
  const visit = (node: ts.Node): void => {
    const component = componentParameterOf(node);
    if (component && /^[A-Z]/.test(component.name) && !found.has(component.name)) {
      const specs = specsOfParameter(component.parameter, sf, importedAliases);
      if (specs.length > 0) found.set(component.name, specs);
    }
    if (ts.isSourceFile(node) || ts.isVariableStatement(node) || ts.isVariableDeclarationList(node))
      ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one bounded pass keeps the destructure-default and type-member halves of a parameter together.
function specsOfParameter(
  parameter: ts.ParameterDeclaration,
  sf: ts.SourceFile,
  importedAliases: ReadonlyMap<string, R3fTypeAlias>,
): ComponentPropSpec[] {
  const defaults = new Map<
    string,
    { defaultText: string; defaultValue?: string | number | boolean | number[] }
  >();
  if (ts.isObjectBindingPattern(parameter.name)) {
    for (const element of parameter.name.elements) {
      if (element.dotDotDotToken) continue;
      const authored = element.propertyName ?? element.name;
      if (!ts.isIdentifier(authored) || !element.initializer) continue;
      defaults.set(authored.text, defaultOf(element.initializer, sf));
    }
  }
  const members = new Map<string, AuthoredMember>();
  if (parameter.type) membersOfTypeNode(parameter.type, sf, importedAliases, members, 0);
  if (members.size > 0) {
    const specs: ComponentPropSpec[] = [];
    for (const [name, member] of members) {
      const withDefault = defaults.get(name);
      specs.push({
        name,
        type: member.type,
        ...(member.options ? { options: member.options } : {}),
        optional: member.optional || withDefault !== undefined,
        ...(withDefault ?? {}),
      });
    }
    return specs;
  }
  // No authored members syntax can see: the destructured defaults are still
  // the author's declaration, and they carry every field the override and
  // apply gates read.
  return [...defaults].map(([name, withDefault]) => ({
    name,
    type: null,
    optional: true,
    ...withDefault,
  }));
}
