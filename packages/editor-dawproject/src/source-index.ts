/**
 * THE SOURCE SIDE of a gesture: which props of a rendered element are literals in the piece's
 * own source, and the write that changes one. Both are `@volter/editor-react`'s JSX authoring
 * routes, the same ones the three.js and Pixi lanes write through: `/__ui-source/index` names
 * every stamped element with the props physically authored on it (`authoredProps`, each with
 * `literal`), and `/__ui-source/prop` rewrites one literal in place, refusing (`dynamic`) an
 * expression-bound one. Every write carries the session's attribution, so the collaboration
 * record says who changed the piece.
 */

import { editorHost } from '@volter/editor-sdk/host';
import type { OidEntry } from '@volter/editor-sdk/source-authoring';
import { handleProjectMutationFailure } from '@volter/editor-sdk/kit/source-conflict';
import {
  setCollaborationRevision,
  sourceMutationAttribution,
} from '@volter/editor-sdk/kit/editor-session-attribution';

export type SourceIndex = ReadonlyMap<string, OidEntry>;

/** A value a gesture writes into an attribute: `at="9:2"`, `vel={0.6}`, `mute={true}`. */
export type Literal = number | string | boolean;

export async function readSourceIndex(): Promise<SourceIndex> {
  const response = await fetch('/__ui-source/index');
  if (!response.ok) throw new Error(`Reading the source index failed (${response.status}).`);
  const body = (await response.json()) as Record<string, OidEntry>;
  return new Map(Object.entries(body));
}

/**
 * Why a prop of this element cannot be written by a gesture, or `null` when it can. The answer
 * is the source's: the element must be the only node its source element rendered, and the prop
 * must be written on it as a literal.
 */
export function propRefusal(
  index: SourceIndex,
  oid: string | null,
  prop: string,
  renderedCount: number,
): string | null {
  if (!oid) return 'This note has no source element (the piece was rendered outside the editor).';
  const entry = index.get(oid);
  if (!entry) return 'The source index has not caught up with this note yet.';
  if (renderedCount > 1) {
    return `Generated: one <${entry.tag}> at ${entry.file}:${entry.line} renders ${renderedCount} notes. Edit the code that generates them, or ask the agent to write them out.`;
  }
  const authored = entry.authoredProps?.find((candidate) => candidate.name === prop);
  if (!authored) return `\`${prop}\` is not written on <${entry.tag}> at ${entry.file}:${entry.line}.`;
  if (!authored.literal) {
    return `Computed: \`${prop}={${authored.valueText}}\` at ${entry.file}:${entry.line}. Edit the expression, or ask the agent to freeze it.`;
  }
  return null;
}

/**
 * Write each prop's new literal onto the element, adding the attribute when the element does not
 * write it yet; `null` takes the attribute off (the element's default applies again). Resolves
 * `true` when the source changed.
 */
export async function writeProps(oid: string, props: Readonly<Record<string, Literal | null>>): Promise<boolean> {
  let changed = false;
  for (const [prop, value] of Object.entries(props)) {
    // A number is written as a number; a string as the text between an attribute's quotes
    // (`at="9:2.5"`), which is what the JSX writer replaces for a string attribute.
    const text = typeof value === 'number' ? formatNumber(value) : typeof value === 'boolean' ? String(value) : value;
    const body = { oid, prop, value: text, addIfMissing: true, ...sourceMutationAttribution() };
    const response = await fetch('/__ui-source/prop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.status === 409) {
      await handleProjectMutationFailure(response, {
        label: `Set ${prop}`,
        attempted: {},
        reapply: () => writeProps(oid, { [prop]: value }).then(() => undefined),
      });
      return changed;
    }
    const answer = (await response.json()) as { changed?: boolean; dynamic?: boolean; error?: string; revision?: number };
    if (!response.ok || answer.error) throw new Error(answer.error ?? `Writing ${prop} failed (${response.status}).`);
    if (answer.dynamic) throw new Error(`\`${prop}\` is computed in the source and was not written.`);
    if (typeof answer.revision === 'number') setCollaborationRevision(answer.revision);
    changed = changed || answer.changed === true;
  }
  return changed;
}

/** A beat or pitch as source text, rounded to a millionth so float noise never reaches the file. */
export function formatNumber(value: number): string {
  return String(Math.round(value * 1e6) / 1e6);
}

/** What a structural write did to its file: the whole source before and after, for undo. */
export interface StructWrite {
  readonly file: string;
  readonly prevSource: string;
  readonly newSource: string;
}

/**
 * A structural edit through `/__ui-source/struct`: `delete` the element, `create` a `snippet`
 * as its last child, or `create-sibling` to put the `snippet` right after it. The same route
 * the UI and scene editors add and remove elements through; its answer carries the whole file
 * before and after, which is the undo.
 */
export async function writeStruct(
  oid: string,
  op: 'delete' | 'create' | 'create-sibling',
  snippet?: string,
): Promise<StructWrite | null> {
  const body = { oid, op, ...(snippet === undefined ? {} : { snippet }), ...sourceMutationAttribution() };
  const response = await fetch('/__ui-source/struct', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (response.status === 409) {
    await handleProjectMutationFailure(response, {
      label: op === 'delete' ? 'Delete Note' : 'Add Note',
      attempted: {},
      reapply: () => writeStruct(oid, op, snippet).then(() => undefined),
    });
    return null;
  }
  const answer = (await response.json()) as {
    changed?: boolean;
    error?: string;
    revision?: number;
    file?: string;
    prevSource?: string;
    newSource?: string;
  };
  if (!response.ok || answer.error) throw new Error(answer.error ?? `The ${op} failed (${response.status}).`);
  if (typeof answer.revision === 'number') setCollaborationRevision(answer.revision);
  if (!answer.changed || answer.file === undefined || answer.prevSource === undefined || answer.newSource === undefined) return null;
  return { file: answer.file, prevSource: answer.prevSource, newSource: answer.newSource };
}

/**
 * A source path as the project's files door names it. The JSX routes answer with absolute
 * paths, the door takes project-relative ones; the piece's own file, known both ways (its
 * document names it relative, the index absolute), gives the project's root. `null` for a file
 * outside the project (an installed package's source).
 */
export function projectPath(index: SourceIndex, pieceFile: string, absolute: string): string | null {
  const suffix = `/${pieceFile}`;
  for (const entry of index.values()) {
    if (!entry.file.endsWith(suffix)) continue;
    const root = entry.file.slice(0, -pieceFile.length);
    return absolute.startsWith(root) ? absolute.slice(root.length) : null;
  }
  return null;
}

/**
 * Why a gesture may not set `prop` on this element, or `null` when it may: the element must be
 * the only node its source element rendered, and the prop, when written at all, a literal. An
 * unwritten prop is fine: the write adds it.
 */
export function setRefusal(index: SourceIndex, oid: string | null, prop: string, renderedCount: number): string | null {
  if (!oid || renderedCount !== 1) return propRefusal(index, oid, prop, renderedCount);
  const authored = index.get(oid)?.authoredProps?.find((candidate) => candidate.name === prop);
  return authored && !authored.literal ? propRefusal(index, oid, prop, renderedCount) : null;
}

/** The literal the element writes for `prop` now, or `null` when it writes none. */
export function writtenLiteral(index: SourceIndex, oid: string, prop: string): Literal | null {
  const authored = index.get(oid)?.authoredProps?.find((candidate) => candidate.name === prop);
  if (!authored) return null;
  const text = authored.valueText.trim();
  if (text === '' || text === 'true') return true;
  if (text === 'false') return false;
  if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)) return Number(text);
  const quoted = /^(["'])(.*)\1$/s.exec(text);
  return quoted ? (quoted[2] ?? '') : text;
}

/**
 * Set props on one element as ONE undoable edit on the workbench's stack: undo writes back what
 * the element wrote before (taking off an attribute it did not write), redo the new values.
 */
export async function setProps(
  label: string,
  index: SourceIndex,
  oid: string,
  props: Readonly<Record<string, Literal | null>>,
  resource: { readonly file: string; readonly documentId: string | null },
): Promise<void> {
  const before: Record<string, Literal | null> = {};
  for (const prop of Object.keys(props)) before[prop] = writtenLiteral(index, oid, prop);
  const changed = await writeProps(oid, props);
  if (!changed) return;
  editorHost().history.record({
    id: globalThis.crypto?.randomUUID?.() ?? `${label}-${Date.now()}`,
    label,
    resources: [resource.file],
    document: resource.documentId,
    undo: () => writeProps(oid, before).then(() => true, () => false),
    redo: () => writeProps(oid, props).then(() => true, () => false),
  });
}

/**
 * One entry on the workbench's undo stack for a structural write: undo puts back the whole file
 * as it was, redo the file as the write left it, each only while the file is still exactly what
 * the other left (a later edit by anyone, the agent included, makes the entry refuse rather than
 * overwrite it).
 */
export function recordStructWrite(
  label: string,
  write: StructWrite,
  where: { readonly index: SourceIndex; readonly pieceFile: string; readonly documentId: string | null },
  onMessage: (message: string | null) => void,
): void {
  const file = projectPath(where.index, where.pieceFile, write.file);
  const documentId = where.documentId;
  if (file === null) {
    onMessage(`“${label}” wrote ${write.file}, outside the project, so it cannot be undone here.`);
    return;
  }
  const restore = async (expected: string, next: string): Promise<boolean> => {
    const files = editorHost().files;
    const current = await files.read(file);
    if (current !== expected) {
      let at = 0;
      while (at < current.length && current[at] === expected[at]) at++;
      const line = current.slice(0, at).split('\n').length;
      onMessage(`${file} changed after “${label}” (line ${line} differs), so it was left as it is.`);
      return false;
    }
    await files.write(file, next);
    return true;
  };
  const fail = (error: unknown): boolean => {
    onMessage(`“${label}” could not be undone: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  };
  editorHost().history.record({
    id: globalThis.crypto?.randomUUID?.() ?? `struct-${Date.now()}`,
    label,
    resources: [file],
    document: documentId,
    undo: () => restore(write.newSource, write.prevSource).catch(fail),
    redo: () => restore(write.prevSource, write.newSource).catch(fail),
  });
}

