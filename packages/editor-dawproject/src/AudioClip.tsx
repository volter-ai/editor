/**
 * THE AUDIO CLIP'S EDITOR: what the lower pane shows for a clip that plays recordings
 * (`<Audio file offset gain take>`) instead of notes. Each take is a row: its file, its start in
 * the file (`offset`, seconds) and its level (`gain`, dB), fields that write that `<Audio>`'s
 * literals, one undo entry each.
 *
 * A clip of several takes is COMPED, as Bitwig comps: each take's lane shows where it plays, and
 * dragging across a take's lane picks it for that stretch (snapped to sixteenths). The pick is
 * written as the clip's `<Comp take at>` elements, all of them rewritten as ONE whole-file edit
 * and one undo entry; "Clear comp" takes them out, and the newest take plays throughout.
 */
import { formatAt } from '@volter/dawproject/notation';
import type { Piece, PieceAudio, PieceClip } from '@volter/dawproject/piece';
import { themeVars } from '@volter/sdk/widgets';
import { type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import ts from 'typescript';
import { applySource, readSource, recordStructWrite, type SourceIndex, setProps, setRefusal } from './source-index';
import { attributeText, elementAt, indentOf, isStaticElement, literalProp, opening, parseSource, type SourceElement } from './source-notes';

const small = { fontSize: 11, color: themeVars.content.muted } as const;
const LANE_W = 480;
const LANE_H = 20;
/** Comp edges snap to sixteenth notes. */
const SNAP = 0.25;

interface Pick {
  readonly take: string;
  readonly time: number;
}

/** Which take plays at each point of the clip: the newest until the first pick, then each pick's. */
function picksOf(clip: PieceClip): Pick[] {
  const newest = clip.takes.at(-1)?.take ?? '';
  const names = new Set(clip.takes.map((take) => take.take));
  const picks: Pick[] = [{ take: newest, time: clip.time }];
  for (const comp of clip.comps) {
    if (!names.has(comp.take) || comp.time >= clip.time + clip.duration) continue;
    if (comp.time <= clip.time) picks[0] = { take: comp.take, time: clip.time };
    else picks.push({ take: comp.take, time: comp.time });
  }
  return picks;
}

function takeAt(picks: readonly Pick[], time: number): string {
  return picks.filter((pick) => pick.time <= time + 1e-9).at(-1)?.take ?? picks[0]?.take ?? '';
}

/** The picks with `take` chosen over [from, to), merged where a take follows itself. */
function compRange(clip: PieceClip, take: string, from: number, to: number): Pick[] {
  const before = picksOf(clip);
  const after = takeAt(before, to);
  const kept = before.filter((pick) => pick.time < from - 1e-9 || pick.time > to + 1e-9);
  const next = [...kept, { take, time: from }, ...(to < clip.time + clip.duration - 1e-9 ? [{ take: after, time: to }] : [])].sort((a, b) => a.time - b.time);
  const merged: Pick[] = [];
  for (const pick of next) if (merged.at(-1)?.take !== pick.take) merged.push(pick);
  return merged;
}

/**
 * The source with the clip's `<Comp>`s replaced by `picks` (the first dropped when it is the
 * newest take from the clip's start, as it would play anyway). Throws, naming why, when the clip
 * or any comp is not a static literal element.
 */
function writeComps(source: string, pieceFile: string, piece: Piece, clip: PieceClip, index: SourceIndex, picks: readonly Pick[]): string {
  const entry = clip.oid ? index.get(clip.oid) : undefined;
  if (!clip.oid || !entry || (piece.oidCounts.get(clip.oid) ?? 0) !== 1) throw new Error('This clip is generated, so its comp has no single place to be written.');
  const file = parseSource(source, pieceFile);
  const element = elementAt(file, entry.line, entry.col, 'Clip');
  if (!element || !ts.isJsxElement(element) || !isStaticElement(element)) throw new Error('This clip is not a literal <Clip> in the source; its comp is not written in one place.');
  const children = element.children.filter((child): child is SourceElement => ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child));
  const comps = children.filter((child) => opening(child).tagName.getText(file) === 'Comp');
  for (const comp of comps) {
    if (typeof literalProp(comp, 'take') !== 'string' || literalProp(comp, 'at') === undefined) throw new Error('A <Comp> in this clip is computed, not a literal: edit its code instead.');
  }
  const newest = clip.takes.at(-1)?.take;
  const written = picks[0]?.take === newest && picks[0]?.time === clip.time ? picks.slice(1) : picks;
  const beatsPerBar = piece.transport.beatsPerBar;
  const edits: { start: number; end: number; text: string }[] = [];
  for (const comp of comps) {
    const start = comp.getStart(file);
    const lineStart = source.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = source.indexOf('\n', comp.end);
    const alone = !source.slice(lineStart, start).trim() && !source.slice(comp.end, lineEnd < 0 ? source.length : lineEnd).trim();
    edits.push(alone ? { start: lineStart, end: lineEnd < 0 ? source.length : lineEnd + 1, text: '' } : { start, end: comp.end, text: '' });
  }
  if (written.length > 0) {
    const anchor = children.filter((child) => opening(child).tagName.getText(file) === 'Audio').at(-1) ?? children.at(-1);
    const newline = source.includes('\r\n') ? '\r\n' : '\n';
    const indent = anchor ? indentOf(source, file, anchor) : '';
    const text = written.map((pick) => `${newline}${indent}<Comp ${attributeText('take', pick.take)} ${attributeText('at', formatAt(pick.time, beatsPerBar))} />`).join('');
    const at = anchor ? anchor.end : element.openingElement.end;
    edits.push({ start: at, end: at, text });
  }
  let next = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
  return next;
}

export function AudioClip(props: {
  readonly clip: PieceClip;
  readonly piece: Piece;
  readonly index: SourceIndex;
  readonly file: string;
  readonly documentId: string | null;
  readonly onMessage: (message: string | null) => void;
}) {
  const { clip, piece } = props;
  // The drag lives in a ref, so a press, moves and release arriving in one task are all seen
  // (the piano roll's reason); the state only draws it.
  const [drag, setDragState] = useState<{ take: string; from: number; to: number } | null>(null);
  const dragRef = useRef(drag);
  const setDrag = (next: { take: string; from: number; to: number } | null): void => {
    dragRef.current = next;
    setDragState(next);
  };
  if (!clip.audio) return null;
  const picks = picksOf(clip);
  const beatOf = (event: ReactPointerEvent, box: DOMRect): number => {
    const beat = clip.time + ((event.clientX - box.left) / LANE_W) * clip.duration;
    return Math.max(clip.time, Math.min(clip.time + clip.duration, Math.round(beat / SNAP) * SNAP));
  };
  const writePicks = (label: string, next: readonly Pick[]): void => {
    props.onMessage(null);
    void (async () => {
      const prevSource = await readSource(props.file);
      const newSource = writeComps(prevSource, props.file, piece, clip, props.index, next);
      if (newSource === prevSource) return;
      if (!(await applySource(props.file, newSource, prevSource))) throw new Error(`${props.file} changed during “${label}”; try again.`);
      recordStructWrite(label, { file: props.file, prevSource, newSource }, { index: props.index, pieceFile: props.file, documentId: props.documentId }, props.onMessage);
    })().catch((error: unknown) => props.onMessage(error instanceof Error ? error.message : String(error)));
  };
  const segments = picks.map((pick, i) => ({ take: pick.take, from: pick.time, to: picks[i + 1]?.time ?? clip.time + clip.duration }));
  const x = (beat: number): number => ((beat - clip.time) / clip.duration) * LANE_W;
  return (
    <div tabIndex={-1} data-audio-clip={clip.id} style={{ outline: 'none', padding: 12, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
      {clip.takes.length > 1 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={small}>
            {clip.takes.length} takes · drag across a take to pick it there · bar {formatAt(clip.time, piece.transport.beatsPerBar, { bar: true })} for {clip.duration / piece.transport.beatsPerBar} bars
          </span>
          {clip.comps.length > 0 ? (
            <button
              type="button"
              data-control="clear-comp"
              onClick={(event) => {
                // The button goes with the comp: focus moves to the panel first, or it falls to the
                // page and the workbench's Undo no longer knows which document it is in.
                (event.currentTarget.closest('[tabindex]') as HTMLElement | null)?.focus({ preventScroll: true });
                writePicks('Clear Comp', []);
              }}
              style={{ fontSize: 11 }}
            >
              Clear comp
            </button>
          ) : null}
        </div>
      ) : null}
      {clip.takes.map((take) => (
        <div key={take.oid ?? take.take} data-take={take.take} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 70, fontFamily: 'monospace' }}>{clip.takes.length > 1 ? `take ${take.take}` : 'recording'}</span>
          {clip.takes.length > 1 ? (
            <div
              data-take-lane={take.take}
              onPointerDown={(event) => {
                const box = event.currentTarget.getBoundingClientRect();
                (event.currentTarget as Element).setPointerCapture(event.pointerId);
                const beat = beatOf(event, box);
                setDrag({ take: take.take, from: beat, to: beat });
              }}
              onPointerMove={(event) => {
                const current = dragRef.current;
                if (!current || current.take !== take.take) return;
                setDrag({ ...current, to: beatOf(event, event.currentTarget.getBoundingClientRect()) });
              }}
              onPointerUp={() => {
                const current = dragRef.current;
                setDrag(null);
                if (!current) return;
                const from = Math.min(current.from, current.to);
                const to = Math.max(current.from, current.to);
                if (to - from < SNAP / 2) return;
                writePicks(`Comp Take ${take.take}`, compRange(clip, take.take, from, to));
              }}
              style={{ position: 'relative', width: LANE_W, height: LANE_H, flex: 'none', background: themeVars.surface.inset, borderRadius: 2, cursor: 'crosshair' }}
            >
              {segments
                .filter((segment) => segment.take === take.take)
                .map((segment) => (
                  <span
                    key={segment.from}
                    data-comp-segment={`${formatAt(segment.from, piece.transport.beatsPerBar)}-${formatAt(segment.to, piece.transport.beatsPerBar)}`}
                    style={{ position: 'absolute', top: 2, bottom: 2, left: x(segment.from), width: x(segment.to) - x(segment.from), background: themeVars.semantic.success, opacity: 0.7, borderRadius: 2 }}
                  />
                ))}
              {drag && drag.take === take.take ? (
                <span style={{ position: 'absolute', top: 0, bottom: 0, left: x(Math.min(drag.from, drag.to)), width: Math.abs(x(drag.to) - x(drag.from)), border: `1px solid ${themeVars.content.primary}` }} />
              ) : null}
            </div>
          ) : null}
          <TakeFields take={take} {...props} />
        </div>
      ))}
    </div>
  );
}

/** A take's file, offset and gain: each field writes that `<Audio>`'s own literal. */
function TakeFields(props: {
  readonly take: PieceAudio;
  readonly piece: Piece;
  readonly index: SourceIndex;
  readonly file: string;
  readonly documentId: string | null;
  readonly onMessage: (message: string | null) => void;
}) {
  const { take } = props;
  const write = (prop: 'offset' | 'gain', text: string): void => {
    const value = Number(text);
    if (text.trim() === '' || !Number.isFinite(value) || (prop === 'offset' && value < 0)) {
      props.onMessage(`${prop} is a number${prop === 'offset' ? ' of seconds, 0 or more' : ' of dB'}.`);
      return;
    }
    const count = take.oid ? (props.piece.oidCounts.get(take.oid) ?? 0) : 0;
    const why = setRefusal(props.index, take.oid, prop, count);
    if (why || !take.oid) {
      props.onMessage(why);
      return;
    }
    props.onMessage(null);
    setProps(`Set Audio ${prop}`, props.index, take.oid, { [prop]: value }, { file: props.file, documentId: props.documentId }).catch((error: unknown) =>
      props.onMessage(error instanceof Error ? error.message : String(error)),
    );
  };
  return (
    <>
      <span data-audio-file="" style={{ fontFamily: 'monospace', ...small }}>
        {take.file}
      </span>
      <Field name="offset" label="starts at (s)" value={take.offset} onCommit={(text) => write('offset', text)} />
      <Field name="gain" label="gain (dB)" value={take.gain} onCommit={(text) => write('gain', text)} />
    </>
  );
}

function Field(props: { readonly name: string; readonly label: string; readonly value: number; readonly onCommit: (text: string) => void }) {
  const [text, setText] = useState(String(props.value));
  useEffect(() => setText(String(props.value)), [props.value]);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      props.onCommit(text);
      // Focus back into the document, as the arranger's fields do: a focused field would take
      // the workbench's Undo as its own text undo, and the edit's entry would not be reached.
      (event.currentTarget.closest('[tabindex]') as HTMLElement | null)?.focus({ preventScroll: true });
    }
    if (event.key === 'Escape') setText(String(props.value));
  };
  return (
    <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <span style={small}>{props.label}</span>
      <input
        data-audio-field={props.name}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (text !== String(props.value)) props.onCommit(text);
        }}
        style={{ width: 56, fontFamily: 'monospace' }}
      />
    </label>
  );
}
