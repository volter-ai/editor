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

/** An attribute as source text: a string between quotes, a number or boolean in braces. */
export function attributeText(name: string, value: Literal): string {
  if (typeof value === 'string') return `${name}="${value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"`;
  if (typeof value === 'number') return `${name}={${Math.round(value * 1e6) / 1e6}}`;
  return `${name}={${value}}`;
}

/** One note a whole-file gesture changes: found by where its element starts (the source index's `line`/`col`). */
export interface NoteRewrite {
  /** 1-based line and 0-based column of the element's `<`. */
  readonly line: number;
  readonly col: number;
  /** What the element must still write: an index older than the file refuses instead of editing the wrong note. */
  readonly expect: Readonly<Record<string, string>>;
  /** Attributes to write; `null` takes one off. */
  readonly set?: Readonly<Record<string, Literal | null>>;
  readonly remove?: boolean;
}

/** A new note: its absolute start in beats and its `<Note … />` text. */
export interface NoteInsert {
  readonly start: number;
  readonly text: string;
}

/**
 * A multi-note gesture as ONE new source text: each target element edited or taken out, and each
 * new note put after the literal sibling that precedes it in time (first in the clip when none
 * does). Throws, naming why, when any target is not a static literal note where the index says
 * it is, so a gesture is never written in part.
 */
export function rewriteNotes(
  source: string,
  clip: { readonly line: number; readonly col: number } | null,
  notes: readonly NoteRewrite[],
  inserts: readonly NoteInsert[],
  meter: number,
): string {
  const file = parseSource(source);
  const at = (line: number, col: number): number => file.getPositionOfLineAndCharacter(line - 1, col);
  const byStart = new Map<number, SourceElement>();
  for (const element of elements(file, 'Note')) byStart.set(element.getStart(file), element);
  const edits: { start: number; end: number; text: string }[] = [];
  const removed = new Set<SourceElement>();
  for (const note of notes) {
    const element = byStart.get(at(note.line, note.col));
    if (!element) throw new Error(`No <Note> starts at line ${note.line}: the source index is behind the file; try again.`);
    if (!isStaticElement(element) || !literalProps(element)) {
      throw new Error(`The <Note> at line ${note.line} is generated or computed, not a literal: edit its code, or Freeze the clip first.`);
    }
    for (const [name, value] of Object.entries(note.expect)) {
      const written = literalProp(element, name);
      if (written === undefined || String(written) !== value) throw new Error(`The <Note> at line ${note.line} no longer writes ${name}="${value}": the source index is behind the file; try again.`);
    }
    if (note.remove) {
      removed.add(element);
      const start = element.getStart(file);
      const lineStart = source.lastIndexOf('\n', start - 1) + 1;
      const lineEnd = source.indexOf('\n', element.end);
      const alone = !source.slice(lineStart, start).trim() && !source.slice(element.end, lineEnd < 0 ? source.length : lineEnd).trim();
      edits.push(alone ? { start: lineStart, end: lineEnd < 0 ? source.length : lineEnd + 1, text: '' } : { start, end: element.end, text: '' });
      continue;
    }
    const open = opening(element);
    const attributes = open.attributes.properties;
    let added = '';
    for (const [name, value] of Object.entries(note.set ?? {})) {
      const i = attributes.findIndex((attr) => ts.isJsxAttribute(attr) && attr.name.getText(file) === name);
      const attr = attributes[i];
      if (attr && value === null) {
        const from = i > 0 ? attributes[i - 1]!.end : open.tagName.end;
        edits.push({ start: from, end: attr.end, text: '' });
      } else if (attr && value !== null) {
        edits.push({ start: attr.getStart(file), end: attr.end, text: attributeText(name, value) });
      } else if (value !== null) {
        added += ` ${attributeText(name, value)}`;
      }
    }
    if (added) {
      const end = attributes.length > 0 ? attributes[attributes.length - 1]!.end : open.tagName.end;
      edits.push({ start: end, end, text: added });
    }
  }
  if (inserts.length > 0) {
    const target = clip ? elements(file, 'Clip').find((element) => element.getStart(file) === at(clip.line, clip.col)) : undefined;
    if (!target || !ts.isJsxElement(target) || !isStaticElement(target)) throw new Error('This clip is not a literal <Clip> with children in the source, so new notes have no single place to go.');
    const siblings = target.children
      .filter((child): child is SourceElement => (ts.isJsxSelfClosingElement(child) || ts.isJsxElement(child)) && opening(child).tagName.getText(file) === 'Note' && !removed.has(child))
      .flatMap((element) => {
        const props = literalProps(element);
        return props ? [{ element, start: noteIdentity(props, meter).start }] : [];
      });
    const newline = source.includes('\r\n') ? '\r\n' : '\n';
    const lineStart = source.lastIndexOf('\n', target.getStart(file)) + 1;
    const parentIndent = /^\s*/.exec(source.slice(lineStart, target.getStart(file)))?.[0] ?? '';
    const childIndent = /\r?\n([\t ]+)\S/.exec(source.slice(target.openingElement.end, target.closingElement.getStart(file)))?.[1] ?? `${parentIndent}  `;
    const groups = new Map<number, NoteInsert[]>();
    for (const insert of inserts) {
      const before = siblings.filter((sibling) => sibling.start <= insert.start + 1e-9).at(-1);
      const position = before ? before.element.end : target.openingElement.end;
      groups.set(position, [...(groups.get(position) ?? []), insert]);
    }
    for (const [position, group] of groups) {
      const text = [...group].sort((a, b) => a.start - b.start).map((insert) => `${newline}${childIndent}${insert.text}`).join('');
      edits.push({ start: position, end: position, text });
    }
  }
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let next = source;
  let floor = Number.POSITIVE_INFINITY;
  for (const edit of edits) {
    if (edit.end > floor) throw new Error('Two parts of this gesture touch the same source; nothing was written.');
    next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
    floor = edit.start;
  }
  return next;
}
