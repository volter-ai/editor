/**
 * R3F hierarchy reparent hardening — the PURE plan for "move this JSX element into
 * that one", covering R1 (scope safety), R2 (world-transform preservation) and R3
 * (destination legality) before a single byte is written.
 *
 * Why here: `plan-source-edit.ts` is the ONE place both tiers (dev server and hosted
 * browser) route a source edit through, and its `reparent` case used to be a bare
 * `reparentElement` — a textual line-block move that is sound only between two parents
 * in the same lexical scope with identical accumulated transforms. The moment the
 * hierarchy invites arbitrary drags it is unsound three ways, all of them SILENT:
 *
 *   1. Lexical capture — an element authored inside a component function may reference
 *      that function's own bindings (`color={tint}`, a `ref`, a mapped variable).
 *      Textually moving it elsewhere produces code that does not compile, or compiles
 *      against a DIFFERENT binding with the same name.
 *   2. Transform re-basing — a verbatim move preserves the authored `position` tuple,
 *      not the world position. Between identity parents those are the same thing;
 *      between transformed parents the object teleports on the next mount.
 *   3. Boundary blindness — a self-closing destination (which is what nearly every R3F
 *      component callsite is) made `reparentElement` insert a PRECEDING SIBLING instead
 *      of a child, and a destination rendered N times would author the element once and
 *      render it N times.
 *
 * The response to all three is the same and is the anti-shim rule: REFUSE, naming the
 * thing that made the move unsafe. This module never rewrites an expression, never
 * renames a binding, and never writes a computed value over an authored one — the
 * literal-vs-dynamic guard is as sacred here as at the gizmo.
 *
 * R4 (one transaction) falls out of living here: every rule is decided before the first
 * edit, a refusal returns the input string identity-equal, and an accepted move returns
 * ONE new whole-file string (tuple rewrites + slot opening + the move), which the
 * caller's existing whole-file snapshot inverse turns into a single undo step.
 */

import ts from 'typescript';
import { parseAuthoringTsx } from './ts-ast';
import {
  analyzeJsxAttributes,
  findTagEnd,
  isNumberTupleLiteral,
  openChildrenSlot,
  reparentElement,
  type StructEditResult,
  writePropChange,
} from './writer';

import type { ReparentChannel, ReparentRebase } from '@volter/editor-sdk/source-authoring';
export type { ReparentChannel, ReparentRebase } from '@volter/editor-sdk/source-authoring';

const CHANNELS: readonly ReparentChannel[] = ['position', 'rotation', 'scale'];
const NUMBER_RE = /^-?\d+(\.\d+)?$/;
const EPS = 1e-6;

export interface ReparentOptions {
  readonly rebase?: ReparentRebase | undefined;
  /**
   * How many live objects the DESTINATION's oid resolves to. More than one means the
   * destination is authored once and rendered N times (a `.map`ped callsite, or a
   * component definition with N instances), so the moved element would be authored
   * once and rendered N times too — R3 refuses that with the count.
   */
  readonly destinationInstances?: number | undefined;
  /**
   * The same count for the element being MOVED. More than one is the mirrored case and
   * is ALLOWED (it is exactly the de-duplication refactor this feature exists for), so
   * it produces a warning rather than a refusal.
   */
  readonly sourceInstances?: number | undefined;
}

export interface ReparentPlan extends StructEditResult {
  /** The named reason the move was refused. Present iff `changed` is false and the
   *  input was left byte-identical because a rule said no. */
  readonly error?: string;
  /** Applied, but with something the author should know (R3's mirrored case). */
  readonly warning?: string;
}

// ---------------------------------------------------------------- source lookup

export type JsxElementNode = ts.JsxElement | ts.JsxSelfClosingElement;

/** The JSX element whose OPENING tag starts exactly at `offset` — the position basis
 *  every `OidEntry` uses. */
export function jsxElementAt(sf: ts.SourceFile, offset: number): JsxElementNode | null {
  let found: JsxElementNode | null = null;
  const visit = (node: ts.Node): void => {
    if (found) return;
    // A node that ends at or before `offset`, or begins after it, cannot contain an
    // element STARTING at `offset` — prune both directions.
    if (node.getEnd() <= offset || node.getStart(sf) > offset) return;
    if (ts.isJsxSelfClosingElement(node) && node.getStart(sf) === offset) {
      found = node;
      return;
    }
    if (ts.isJsxElement(node) && node.openingElement.getStart(sf) === offset) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function openingTagOf(node: JsxElementNode): ts.JsxOpeningElement | ts.JsxSelfClosingElement {
  return ts.isJsxElement(node) ? node.openingElement : node;
}

function tagTextOf(node: JsxElementNode, sf: ts.SourceFile): string {
  return openingTagOf(node).tagName.getText(sf);
}

function contains(outer: ts.Node, sf: ts.SourceFile, offset: number): boolean {
  return outer.getStart(sf) <= offset && offset < outer.getEnd();
}

// ------------------------------------------------------------- R1: scope safety

/** Every name a declaration binds, flattened through destructuring patterns. */
function boundNames(name: ts.BindingName, into: Set<string>): void {
  if (ts.isIdentifier(name)) {
    into.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) continue;
    boundNames(element.name, into);
  }
}

function declaredByStatement(statement: ts.Statement, into: Set<string>): void {
  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      boundNames(declaration.name, into);
    }
    return;
  }
  if (ts.isFunctionDeclaration(statement) && statement.name) into.add(statement.name.text);
  else if (ts.isClassDeclaration(statement) && statement.name) into.add(statement.name.text);
  else if (ts.isImportDeclaration(statement) && statement.importClause) {
    const clause = statement.importClause;
    if (clause.name) into.add(clause.name.text);
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) into.add(bindings.name.text);
    else if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) into.add(element.name.text);
    }
  }
}

/** The names a single scope-introducing node binds, or null when it is not a scope. */
function scopeBindings(node: ts.Node): Set<string> | null {
  const names = new Set<string>();
  if (ts.isSourceFile(node)) {
    for (const statement of node.statements) declaredByStatement(statement, names);
    return names;
  }
  if (ts.isBlock(node) || ts.isModuleBlock(node) || ts.isCaseBlock(node)) {
    const statements = ts.isCaseBlock(node)
      ? node.clauses.flatMap((clause) => [...clause.statements])
      : [...node.statements];
    for (const statement of statements) declaredByStatement(statement, names);
    return names;
  }
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessor(node) ||
    ts.isSetAccessor(node)
  ) {
    for (const parameter of node.parameters) boundNames(parameter.name, names);
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name) {
      names.add(node.name.text);
    }
    return names;
  }
  if (ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node)) {
    const initializer = node.initializer;
    if (initializer && ts.isVariableDeclarationList(initializer)) {
      for (const declaration of initializer.declarations) boundNames(declaration.name, names);
    }
    return names;
  }
  if (ts.isCatchClause(node)) {
    if (node.variableDeclaration) boundNames(node.variableDeclaration.name, names);
    return names;
  }
  return null;
}

/** The innermost enclosing scope of `from` that binds `name`, or null when nothing
 *  in the lexical chain does (a global, or an unresolved reference — either way not a
 *  capture this move can break). */
export function bindingScopeOf(name: string, from: ts.Node): ts.Node | null {
  let cursor: ts.Node | undefined = from;
  while (cursor) {
    const bindings = scopeBindings(cursor);
    if (bindings?.has(name)) return cursor;
    cursor = cursor.parent;
  }
  return null;
}

/** The nearest named function around `node` — what a refusal calls the owner. */
export function owningFunctionName(node: ts.Node, sf: ts.SourceFile): string {
  let cursor: ts.Node | undefined = node;
  while (cursor) {
    if (ts.isFunctionDeclaration(cursor) && cursor.name) return cursor.name.text;
    if (
      (ts.isArrowFunction(cursor) || ts.isFunctionExpression(cursor)) &&
      cursor.parent &&
      ts.isVariableDeclaration(cursor.parent) &&
      ts.isIdentifier(cursor.parent.name)
    ) {
      return cursor.parent.name.text;
    }
    cursor = cursor.parent;
  }
  return ts.isSourceFile(node) ? 'this module' : `this scope (line ${lineOf(node, sf)})`;
}

function lineOf(node: ts.Node, sf: ts.SourceFile): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

/**
 * The identifiers the element's JSX subtree REFERENCES from outside itself — the R1
 * input. Same machinery as the contract analyzer (a plain `ts` walk over the TSX AST).
 *
 * It counts an identifier it is unsure about, so an unrecognized shape refuses rather
 * than moves. The one deliberate subtraction is names the subtree binds FOR ITSELF —
 * without it, a `.map((angle) => …)` inside the moved element would read as a capture
 * of the outer scope and nothing containing a mapped list could ever move. Stated
 * plainly, because it is not free: a name bound inside the subtree in one place and
 * captured from outside it in another is subtracted too, and that capture is missed.
 * A tighter answer needs a real binder, not a name set; this is the honest limit of
 * the cheap one.
 */
export function referencedIdentifiers(node: JsxElementNode): Map<string, ts.Node> {
  const referenced = new Map<string, ts.Node>();
  const localBindings = new Set<string>();

  const visit = (current: ts.Node): void => {
    // Types name types, not values — a moved element's `as THREE.Group` is not a
    // runtime capture.
    if (ts.isTypeNode(current) || ts.isTypeParameterDeclaration(current)) return;

    const nested = scopeBindings(current);
    if (nested && current !== node) for (const name of nested) localBindings.add(name);

    if (ts.isPropertyAccessExpression(current)) {
      visit(current.expression); // `a.b.c` references `a` only
      return;
    }
    if (ts.isJsxAttribute(current)) {
      if (current.initializer) visit(current.initializer);
      return; // the attribute NAME is not an identifier reference
    }
    if (ts.isPropertyAssignment(current)) {
      if (ts.isComputedPropertyName(current.name)) visit(current.name);
      visit(current.initializer);
      return;
    }
    if (ts.isJsxOpeningElement(current) || ts.isJsxSelfClosingElement(current)) {
      // A lowercase host tag (`<mesh>`) is an intrinsic element, not a binding. A
      // capitalized or dotted one resolves through the lexical scope like any value.
      const tag = current.tagName;
      const root = ts.isPropertyAccessExpression(tag) ? leftmostIdentifier(tag) : tag;
      if (ts.isIdentifier(root) && /^[A-Z_$]/.test(root.text) && !referenced.has(root.text)) {
        referenced.set(root.text, root);
      }
      for (const property of current.attributes.properties) visit(property);
      return;
    }
    if (ts.isJsxClosingElement(current)) return;
    if (ts.isIdentifier(current)) {
      if (!referenced.has(current.text)) referenced.set(current.text, current);
      return;
    }
    ts.forEachChild(current, visit);
  };
  visit(node);

  for (const name of localBindings) referenced.delete(name);
  return referenced;
}

function leftmostIdentifier(node: ts.PropertyAccessExpression): ts.Node {
  let cursor: ts.Node = node;
  while (ts.isPropertyAccessExpression(cursor)) cursor = cursor.expression;
  return cursor;
}

// -------------------------------------------------- R3: destination legality

type ChildrenSlot = 'paired' | 'expandable';

/** Does a component DEFINED IN THIS FILE render whatever children a callsite gives it?
 *  Proven, never guessed: it either names `children` (destructured or `props.children`)
 *  or spreads its props object onto a host element. */
function componentForwardsChildren(sf: ts.SourceFile, name: string): boolean | 'undefined' {
  const definition = findComponentDefinition(sf, name);
  if (!definition) return 'undefined';
  const parameter = definition.parameters[0];
  const spreadable = new Set<string>();
  let bindsChildren = false;
  if (parameter) {
    if (ts.isIdentifier(parameter.name)) spreadable.add(parameter.name.text);
    else if (ts.isObjectBindingPattern(parameter.name)) {
      for (const element of parameter.name.elements) {
        const propertyName = (element.propertyName ?? element.name).getText(sf);
        if (propertyName === 'children') bindsChildren = true;
        if (element.dotDotDotToken && ts.isIdentifier(element.name)) {
          spreadable.add(element.name.text);
        }
      }
    }
  }
  if (bindsChildren) return true;

  let forwards = false;
  const visit = (node: ts.Node): void => {
    if (forwards) return;
    if (ts.isJsxSpreadAttribute(node)) {
      const expression = node.expression;
      if (ts.isIdentifier(expression) && spreadable.has(expression.text)) forwards = true;
      return;
    }
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'children') {
      if (ts.isIdentifier(node.expression) && spreadable.has(node.expression.text)) {
        forwards = true;
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  if (definition.body) visit(definition.body);
  return forwards;
}

function findComponentDefinition(
  sf: ts.SourceFile,
  name: string,
): ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression | null {
  let found: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression | null = null;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      found = node;
      return;
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      found = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

// ------------------------------------------------------------------- the plan

function fmt(value: number): string {
  const rounded = Math.round(value * 1e4) / 1e4;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

function tupleText(values: readonly number[]): string {
  return `[${values.map(fmt).join(', ')}]`;
}

/**
 * Plan a same-file reparent. `elementStart` and `parentStart` are the `<` offsets the
 * OID index resolves to; `options` carries what only the live scene knows.
 *
 * Returns the input string unchanged (identity, so a caller comparing bytes sees no
 * diff) plus a named `error` for every refusal.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one gate per numbered rule, in the order the spec states them; splitting it would hide the "plan everything before writing anything" invariant this function exists to hold.
export function planReparent(
  code: string,
  elementStart: number,
  parentStart: number,
  options: ReparentOptions = {},
): ReparentPlan {
  const refuse = (error: string): ReparentPlan => ({ code, changed: false, error });
  const sf = parseAuthoringTsx('reparent.tsx', code);
  const element = jsxElementAt(sf, elementStart);
  const destination = jsxElementAt(sf, parentStart);
  if (!element) return refuse('the moved element is no longer at its indexed source position.');
  if (!destination) {
    return refuse('the destination is no longer at its indexed source position.');
  }
  const elementTag = tagTextOf(element, sf);
  const destinationTag = tagTextOf(destination, sf);
  if (element === destination) return refuse(`<${elementTag}> cannot be its own parent.`);
  if (contains(element, sf, parentStart)) {
    return refuse(`<${destinationTag}> is inside <${elementTag}> — a move there would be a cycle.`);
  }

  // --- R3: destination legality ------------------------------------------------
  const destinationInstances = options.destinationInstances;
  if (destinationInstances !== undefined && destinationInstances > 1) {
    return refuse(
      `${destinationTag} renders ${destinationInstances} times; moving this into it would ` +
        `author it once and render it ${destinationInstances} times.`,
    );
  }
  const slot: ChildrenSlot = ts.isJsxElement(destination) ? 'paired' : 'expandable';
  if (/^[A-Z_$]/.test(destinationTag) || destinationTag.includes('.')) {
    const forwards = componentForwardsChildren(sf, destinationTag);
    if (forwards === 'undefined') {
      return refuse(
        `${destinationTag} is not defined in this file — the editor cannot prove it renders ` +
          'its children into the world, so it refuses to move anything inside it.',
      );
    }
    if (!forwards) {
      return refuse(
        `${destinationTag} does not render children — nothing can be authored inside it.`,
      );
    }
  }

  // --- R1: scope safety --------------------------------------------------------
  for (const [name, reference] of referencedIdentifiers(element)) {
    const scope = bindingScopeOf(name, reference);
    if (!scope || contains(scope, sf, parentStart)) continue;
    return refuse(
      `<${elementTag}> references '${name}', which only exists inside ` +
        `${owningFunctionName(scope, sf)}.`,
    );
  }

  // --- R2: world-transform preservation ---------------------------------------
  const rebase = options.rebase;
  const tagEnd = findTagEnd(code, elementStart);
  if (tagEnd < 0) return refuse(`<${elementTag}>'s opening tag could not be read.`);
  const attrs = analyzeJsxAttributes(code, elementStart, tagEnd);
  const pending: Array<{ channel: ReparentChannel; values: readonly number[]; scalar: boolean }> =
    [];
  for (const channel of CHANNELS) {
    const values = rebase?.[channel];
    if (!values) continue;
    const attr = attrs.find((candidate) => candidate.name === channel);
    if (attr) {
      const scalar =
        (attr.isExpression && NUMBER_RE.test(attr.rawValue)) ||
        rebase?.scalarChannels?.includes(channel) === true;
      const tuple = attr.isExpression && isNumberTupleLiteral(attr.rawValue);
      if (!scalar && !tuple) {
        return refuse(
          `preserving <${elementTag}>'s world transform needs a new ${channel}, but ` +
            `${channel} is bound to the expression {${attr.rawValue}} — the editor will not ` +
            'write a tuple over an expression.',
        );
      }
      pending.push({ channel, values, scalar });
      continue;
    }
    pending.push({
      channel,
      values,
      scalar: rebase?.scalarChannels?.includes(channel) === true,
    });
  }

  // --- R4: everything above decided; only now does anything get written --------
  let next = code;
  for (const { channel, values, scalar } of pending) {
    const uniform =
      values.length === 3 &&
      Math.abs((values[0] ?? 0) - (values[1] ?? 0)) < EPS &&
      Math.abs((values[1] ?? 0) - (values[2] ?? 0)) < EPS;
    const text =
      scalar && (values.length === 1 || uniform) ? fmt(values[0] ?? 0) : tupleText(values);
    const written = writePropChange(next, elementStart, channel, text, {
      addIfMissing: true,
      allowShapeUpgrade: scalar,
    });
    if (written.dynamic) {
      return refuse(
        `preserving <${elementTag}>'s world transform needs a new ${channel}, but ${channel} ` +
          'is expression-bound.',
      );
    }
    next = written.code;
  }
  // Every tuple rewrite lands strictly inside the moved element's own opening tag, and
  // the destination cannot be inside that element (the cycle gate above), so a
  // destination LATER in the file shifts by exactly the bytes those rewrites added.
  let movedStart = elementStart;
  const destinationStart =
    parentStart > elementStart ? parentStart + (next.length - code.length) : parentStart;

  if (slot === 'expandable') {
    const opened = openChildrenSlot(next, destinationStart);
    if (!opened.changed) {
      return refuse(`<${destinationTag} /> could not be opened to receive a child.`);
    }
    const grew = opened.code.length - next.length;
    next = opened.code;
    if (movedStart > destinationStart) movedStart += grew;
  }

  const moved = reparentElement(next, movedStart, destinationStart);
  if (!moved.changed) return refuse(`<${elementTag}> could not be moved into <${destinationTag}>.`);

  const sourceInstances = options.sourceInstances;
  const warning =
    sourceInstances !== undefined && sourceInstances > 1
      ? `${elementTag} was authored once and rendered ${sourceInstances} times; moving it out ` +
        `leaves ${sourceInstances - 1} of those renders without it.`
      : undefined;
  return {
    code: moved.code,
    changed: true,
    ...(warning ? { warning } : {}),
  };
}
