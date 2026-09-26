/** Freeze one graph clip into its unique static source location. */
import ts from 'typescript';
import { beatAt, beatsPerBarOf, formatAt, formatDuration, formatPitch, spelledFlat } from '@volter/dawproject/notation';
import type { DawNode } from '@volter/dawproject/render';
import { elements, isStaticElement, literalNotes, literalProp, literalProps, noteIdentity, noteMultiset, opening, parseSource } from './source-notes';
import type { SourceElement } from './source-notes';

function number(value: number): string {
  if (!Number.isFinite(value)) throw new Error('Cannot freeze a non-finite numeric prop.');
  return String(Math.round(value * 1e6) / 1e6);
}
function attr(name: string, value: unknown): string {
  if (typeof value === 'string') return `${name}="${value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/\r/g, '&#13;').replace(/\n/g, '&#10;')}"`;
  if (typeof value === 'number') return `${name}={${number(value)}}`;
  if (typeof value === 'boolean') return `${name}={${value}}`;
  throw new Error(`Cannot freeze unsupported ${name} prop.`);
}
function position(value: unknown, meter: number): string {
  return typeof value === 'string' ? value : formatAt(beatAt(String(value), meter), meter);
}
function writeNote(node: DawNode, meter: number, flats: boolean): string {
  const props = { ...node.props };
  props['at'] = position(props['at'], meter);
  props['pitch'] = typeof props['pitch'] === 'string' ? props['pitch'] : formatPitch(Number(props['pitch']), flats);
  props['dur'] = typeof props['dur'] === 'string' ? props['dur'] : formatDuration(Number(props['dur']));
  // A graph mounted by the editor carries its serve-time stamps (`data-oid`): they are the
  // served file's, never the source's.
  return `<Note ${Object.entries(props).filter(([name, value]) => value !== undefined && !name.startsWith('data-')).map(([name, value]) => attr(name, value)).join(' ')} />`;
}
function nearestTrack(node: SourceElement): SourceElement | undefined {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isJsxElement(parent) && parent.openingElement.tagName.getText() === 'Track') return parent;
  }
  return undefined;
}
function staticLane(node: SourceElement): boolean {
  if (!isStaticElement(node) || !literalProps(node)) return false;
  if (ts.isJsxSelfClosingElement(node)) return true;
  return node.children.every((child) => ts.isJsxExpression(child) && !child.expression || ts.isJsxText(child) && !child.text.trim()
    || (ts.isJsxSelfClosingElement(child) || ts.isJsxElement(child)) && opening(child).tagName.getText() === 'Point' && !!literalProps(child)
      && (ts.isJsxSelfClosingElement(child) || child.children.every((text) => ts.isJsxText(text) && !text.text.trim())));
}
function laneKey(props: Readonly<Record<string, unknown>>, points: readonly Readonly<Record<string, unknown>>[], meter: number): string {
  return JSON.stringify([props['target'], points.map((point) => [beatAt(String(point['at']), meter), point['value'], point['hold'] === true])]);
}
export function freezeClip(source: string, graph: DawNode, trackName: string, index: number): string {
  const tracks = graph.children.filter((node) => node.type === 'Track' && node.props['name'] === trackName);
  if (tracks.length !== 1) throw new Error(`Expected one mounted track named "${trackName}", found ${tracks.length}.`);
  const clip = tracks[0]!.children.filter((node) => node.type === 'Clip')[index - 1];
  if (!clip) throw new Error(`Track "${trackName}" has no clip ${index}.`);
  const meter = beatsPerBarOf(String(graph.children.find((node) => node.type === 'Transport')?.props['meter'] ?? '4/4'));
  const file = parseSource(source);
  const matches = elements(file, 'Clip').filter((node) => {
    const track = nearestTrack(node);
    return track && literalProp(track, 'name') === trackName && literalProp(node, 'at') === clip.props['at'];
  });
  if (matches.length !== 1) throw new Error(`Expected one source Clip with literal at="${clip.props['at']}" in track "${trackName}", found ${matches.length}.`);
  const target = matches[0]!;
  if (!isStaticElement(target)) throw new Error('Cannot freeze a Clip inside an expression container or callback because it has no single static source location.');
  if (!ts.isJsxElement(target)) throw new Error('Cannot freeze a self-closing Clip because it has no source children.');
  if (clip.children.some((child) => child.type !== 'Note' && child.type !== 'Points')) throw new Error('Cannot freeze a Clip containing unsupported child elements.');
  const literals = literalNotes(target, meter);
  const take = noteMultiset(literals);
  const flats = literals.some((note) => spelledFlat(String(note.props['pitch'])));
  const notes = clip.children.filter((node) => node.type === 'Note').map((node) => {
    const identity = noteIdentity(node.props, meter);
    const original = take(identity);
    return { start: identity.start, text: original ? original.element.getText(file) : writeNote(node, meter, flats) };
  }).sort((a, b) => a.start - b.start);
  const literalLanes = elements(target, 'Points').filter(staticLane);
  const lanes = new Map<string, SourceElement[]>();
  for (const lane of literalLanes) {
    const id = laneKey(literalProps(lane)!, elements(lane, 'Point').map((point) => literalProps(point)!), meter);
    lanes.set(id, [...lanes.get(id) ?? [], lane]);
  }
  const lineStart = source.lastIndexOf('\n', target.getStart(file)) + 1;
  const parentIndent = /^\s*/.exec(source.slice(lineStart, target.getStart(file)))?.[0] ?? '';
  const childIndent = /\r?\n([\t ]+)\S/.exec(source.slice(target.openingElement.end, target.closingElement.getStart(file)))?.[1] ?? `${parentIndent}  `;
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const automation = clip.children.filter((node) => node.type === 'Points').map((lane) => {
    const original = lanes.get(laneKey(lane.props, lane.children.map((point) => point.props), meter))?.shift();
    if (original) return original.getText(file);
    const points = lane.children.map((point) => {
      if (point.type !== 'Point') throw new Error('Cannot freeze an automation lane containing unsupported children.');
      return `<Point ${attr('at', position(point.props['at'], meter))} ${attr('value', point.props['value'])}${point.props['hold'] === true ? ' hold' : ''} />`;
    });
    return `<Points ${attr('target', lane.props['target'])}>${newline}${points.map((point) => `${childIndent}  ${point}`).join(newline)}${newline}${childIndent}</Points>`;
  });
  const children = [...notes.map((note) => note.text), ...automation];
  return source.slice(0, target.openingElement.end) + newline + children.map((text) => childIndent + text).join(newline) + newline + parentIndent + source.slice(target.closingElement.getStart(file));
}

/** Ask TypeScript which local declarations/import bindings became unused; leave them in place. */
export function unusedNames(source: string): Set<string> {
  const file = parseSource(source, '/piece.tsx');
  const options: ts.CompilerOptions = { noResolve: true, noLib: true, types: [], noUnusedLocals: true, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ESNext };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (name) => name === file.fileName ? file : undefined;
  const program = ts.createProgram([file.fileName], options, host);
  const names = new Set<string>();
  for (const diagnostic of program.getSemanticDiagnostics(file)) {
    if (![6133, 6192, 6196, 6199].includes(diagnostic.code) || diagnostic.start === undefined) continue;
    const start = diagnostic.start;
    const end = start + (diagnostic.length ?? 0);
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && node.getStart(file) >= start && node.end <= end) {
        const parent = node.parent;
        if ((ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent) || ts.isVariableDeclaration(parent) || ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent) || ts.isTypeAliasDeclaration(parent) || ts.isInterfaceDeclaration(parent)) && parent.name === node) names.add(node.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return names;
}
