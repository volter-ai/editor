/** Source-only literal detection shared by the vertical reader and clip freezer. */
import ts from 'typescript';
import { beatAt, beatsOf, midiOf } from '@volter/dawproject/notation';

export type SourceElement = ts.JsxElement | ts.JsxSelfClosingElement;
export type Literal = string | number | boolean;
export function parseSource(text: string, file = 'piece.tsx'): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
export function opening(node: SourceElement): ts.JsxOpeningElement | ts.JsxSelfClosingElement {
  return ts.isJsxElement(node) ? node.openingElement : node;
}
export function elements(root: ts.Node, name: string): SourceElement[] {
  const found: SourceElement[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) && opening(node).tagName.getText() === name) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}
function literal(node: ts.Node): Literal | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand)) {
    if (node.operator === ts.SyntaxKind.MinusToken) return -Number(node.operand.text);
    if (node.operator === ts.SyntaxKind.PlusToken) return Number(node.operand.text);
  }
  return undefined;
}
export function literalProps(node: SourceElement): Record<string, Literal> | null {
  const props: Record<string, Literal> = {};
  for (const attr of opening(node).attributes.properties) {
    if (!ts.isJsxAttribute(attr)) return null;
    const value = !attr.initializer ? true : ts.isJsxExpression(attr.initializer)
      ? attr.initializer.expression && literal(attr.initializer.expression) : literal(attr.initializer);
    if (value === undefined) return null;
    props[attr.name.getText()] = value;
  }
  return props;
}
export function literalProp(node: SourceElement, name: string): Literal | undefined {
  const attr = opening(node).attributes.properties.find((prop) => ts.isJsxAttribute(prop) && prop.name.getText() === name);
  if (!attr || !ts.isJsxAttribute(attr)) return undefined;
  if (!attr.initializer) return true;
  return ts.isJsxExpression(attr.initializer) ? attr.initializer.expression && literal(attr.initializer.expression) : literal(attr.initializer);
}
/** Only JSX directly returned by a top-level component, never an expression or callback. */
export function isStaticElement(node: SourceElement): boolean {
  let current: ts.Node = node;
  while (current.parent && (ts.isJsxElement(current.parent) || ts.isJsxFragment(current.parent) || ts.isParenthesizedExpression(current.parent))) current = current.parent;
  const parent = current.parent;
  let fn: ts.Node | undefined;
  if (parent && ts.isReturnStatement(parent) && ts.isBlock(parent.parent)) fn = parent.parent.parent;
  else if (parent && ts.isArrowFunction(parent) && parent.body === current) fn = parent;
  if (!fn || !(ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn) || ts.isArrowFunction(fn))) return false;
  // The sole enclosing function is the component whose body returned this JSX.
  for (let ancestor = fn.parent; ancestor; ancestor = ancestor.parent) {
    if (ts.isFunctionLike(ancestor) || ts.isJsxExpression(ancestor) || ts.isCallExpression(ancestor)) return false;
  }
  return true;
}
export interface NoteIdentity { readonly start: number; readonly pitch: number; readonly duration: number }
export interface LiteralNote extends NoteIdentity { readonly element: SourceElement; readonly props: Record<string, Literal> }
export function noteIdentity(props: Readonly<Record<string, unknown>>, meter: number): NoteIdentity {
  return {
    start: beatAt(String(props['at']), meter),
    pitch: typeof props['pitch'] === 'number' ? props['pitch'] : midiOf(String(props['pitch'])),
    duration: beatsOf(typeof props['dur'] === 'number' ? props['dur'] : String(props['dur'])),
  };
}
export function literalNotes(root: ts.Node, meter: number): LiteralNote[] {
  return elements(root, 'Note').flatMap((element) => {
    const props = literalProps(element);
    return props && isStaticElement(element) ? [{ element, props, ...noteIdentity(props, meter) }] : [];
  });
}
function key(note: NoteIdentity): string {
  return JSON.stringify([note.start, note.pitch, note.duration]);
}
/** Each source occurrence can account for exactly one mounted note. */
export function noteMultiset(notes: readonly LiteralNote[]): (note: NoteIdentity) => LiteralNote | undefined {
  const buckets = new Map<string, LiteralNote[]>();
  for (const note of notes) {
    const id = key(note);
    const bucket = buckets.get(id) ?? [];
    bucket.push(note);
    buckets.set(id, bucket);
  }
  return (note) => buckets.get(key(note))?.shift();
}
