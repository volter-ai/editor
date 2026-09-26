/** Source-only literal detection shared by the vertical reader and clip freezer. */
import ts from 'typescript';
import { beatAt, beatsOf, formatAt, midiOf } from '@volter/dawproject/notation';

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

/**
 * THE ARRANGER'S STRUCTURAL REWRITES: a gesture that changes several elements at once (a clip
 * moved with its notes, a clip duplicated) builds the whole new file from the source's own tree,
 * and either rewrites every element it must or refuses the whole gesture with the reason.
 */
export interface SourceEdit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** A gesture the source does not allow, said to the person as is. */
export class SourceRefusal extends Error {}

/** `source` with each edit made; edits must not overlap. */
export function applyEdits(source: string, edits: readonly SourceEdit[]): string {
  let text = source;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  return text;
}

/** The line (1-based) a node starts on, for a message. */
export function lineOf(file: ts.SourceFile, node: ts.Node): number {
  return file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
}

/** The JSX element that starts at a source index entry's `line` (1-based) and `col`, when it is a `<tag>`. */
export function elementAt(file: ts.SourceFile, line: number, col: number, tag: string): SourceElement | undefined {
  if (line < 1 || line > file.getLineStarts().length) return undefined;
  const position = file.getPositionOfLineAndCharacter(line - 1, col);
  let found: SourceElement | undefined;
  const visit = (node: ts.Node): void => {
    if (found || node.end < position || node.pos > position) return;
    if ((ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) && node.getStart(file) === position && opening(node).tagName.getText(file) === tag) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** The element's `at` moved by `delta` beats, in the spelling it had (`9` stays a bar, `9:2` a bar:beat). */
function shiftAt(file: ts.SourceFile, node: SourceElement, delta: number, beatsPerBar: number): SourceEdit {
  const tag = opening(node).tagName.getText(file);
  const attr = opening(node).attributes.properties.find((prop) => ts.isJsxAttribute(prop) && prop.name.getText(file) === 'at');
  const value = literalProp(node, 'at');
  if (!attr || !ts.isJsxAttribute(attr) || !attr.initializer || (typeof value !== 'string' && typeof value !== 'number')) {
    throw new SourceRefusal(`Computed: the <${tag}> at line ${lineOf(file, node)} does not write its \`at\` as a literal, so it cannot move with the clip. Freeze the clip first.`);
  }
  const beats = beatAt(value, beatsPerBar) + delta;
  if (beats < -1e-9) throw new SourceRefusal(`The <${tag}> at line ${lineOf(file, node)} would move before bar 1.`);
  const bar = typeof value === 'number' || !String(value).includes(':');
  const written = formatAt(beats, beatsPerBar, { bar });
  const text = typeof value === 'number' && /^\d+$/.test(written) ? `{${written}}` : `"${written}"`;
  return { start: attr.initializer.getStart(file), end: attr.initializer.end, text };
}

/**
 * Every `at` a clip carries, moved by `delta` beats: the clip's own, each note's and each lane
 * point's (all absolute). Refuses, naming the line, when a child is generated (`{…}`) or anything
 * other than literal notes and lanes of literal points, since those cannot move with it.
 */
export function shiftClipEdits(file: ts.SourceFile, clip: SourceElement, delta: number, beatsPerBar: number): SourceEdit[] {
  const edits = [shiftAt(file, clip, delta, beatsPerBar)];
  const children = (node: SourceElement): readonly ts.JsxChild[] => (ts.isJsxElement(node) ? node.children : []);
  const walk = (node: SourceElement, allowed: readonly string[]): void => {
    for (const child of children(node)) {
      if (ts.isJsxText(child)) {
        if (child.text.trim()) throw new SourceRefusal(`The <Clip> at line ${lineOf(file, clip)} holds text at line ${lineOf(file, child)}.`);
        continue;
      }
      if (ts.isJsxExpression(child)) {
        if (!child.expression) continue;
        throw new SourceRefusal(`Generated: \`{…}\` at line ${lineOf(file, child)} makes this clip's contents, which cannot move with it. Freeze the clip first.`);
      }
      if (!ts.isJsxElement(child) && !ts.isJsxSelfClosingElement(child)) {
        throw new SourceRefusal(`The <Clip> at line ${lineOf(file, clip)} holds something at line ${lineOf(file, child)} that is not a note or a lane.`);
      }
      const tag = opening(child).tagName.getText(file);
      if (!allowed.includes(tag)) throw new SourceRefusal(`A <${tag}> at line ${lineOf(file, child)} cannot move with the clip.`);
      if (tag === 'Points') walk(child, ['Point']);
      else edits.push(shiftAt(file, child, delta, beatsPerBar));
    }
  };
  walk(clip, ['Note', 'Points']);
  return edits;
}

/** The whitespace before `node` on its line. */
export function indentOf(source: string, file: ts.SourceFile, node: ts.Node): string {
  const start = node.getStart(file);
  const lineStart = source.lastIndexOf('\n', start - 1) + 1;
  return /^[\t ]*/.exec(source.slice(lineStart, start))?.[0] ?? '';
}
