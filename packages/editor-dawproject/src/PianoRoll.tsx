/**
 * THE CLIP EDITOR under the arranger (Bitwig's detail editor): the selected clip's notes on a
 * piano roll, its automation lanes and a velocity lane. Every gesture writes the note's own
 * element in the piece's source (`source-index.ts`); a note that is generated is drawn as a
 * ghost and refuses with the reason.
 */

import { formatAt, formatDuration, formatPitch, spelledFlat } from '@volter/dawproject/notation';
import type { Piece, PieceClip, PieceNote } from '@volter/dawproject/piece';
import type { DawNode } from '@volter/dawproject/render';
import { editorHost } from '@volter/editor-sdk/host';
import { themeVars } from '@volter/editor-sdk/widgets';
import { type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import { AutomationLane } from './AutomationLane';
import { freezeClip } from './freeze-clip';
import { applySource, propRefusal, readSource, recordStructWrite, restoreProps, type SourceIndex, writeProps, writeStruct } from './source-index';

const KEY_W = 44;
const ROW_H = 12;
const SNAP = 0.25;
const VEL_H = 56;
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const mono: CSSProperties = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };
const small: CSSProperties = { fontSize: 11, color: themeVars.content.muted };
const button: CSSProperties = {
  background: themeVars.surface.raised,
  color: themeVars.content.primary,
  border: `1px solid ${themeVars.boundary.default}`,
  borderRadius: 3,
  padding: '2px 8px',
  fontSize: 12,
  cursor: 'pointer',
};

function noteName(pitch: number): string {
  return `${NOTE_NAMES[pitch % 12] ?? '?'}${Math.floor(pitch / 12) - 1}`;
}

function snap(value: number): number {
  return Math.round(value / SNAP) * SNAP;
}

interface Drag {
  readonly note: PieceNote;
  readonly startX: number;
  readonly startY: number;
  readonly time: number;
  readonly pitch: number;
}

export function PianoRoll(props: {
  readonly clip: PieceClip;
  readonly color: string;
  readonly trackName: string;
  /** The clip's place among its track's clips, from 1: how the freezer finds it. */
  readonly clipNumber: number;
  readonly graph: DawNode | null;
  readonly piece: Piece;
  readonly index: SourceIndex;
  readonly pxPerBeat: number;
  readonly playhead: number | null;
  readonly onMessage: (message: string | null) => void;
  readonly file: string;
  readonly documentId: string | null;
  /** Whether this document is the workbench's active editor: only then does Delete reach it. */
  readonly active: boolean;
}) {
  const { clip, color, piece, index, pxPerBeat } = props;
  // The gesture lives in a ref, read and written synchronously by every pointer event; the
  // state copy only draws it. A press, its moves and its release can arrive in one task (a fast
  // flick, a scripted gesture) before React commits, and a gesture read from state would miss them.
  const dragRef = useRef<Drag | null>(null);
  const [drag, setDragState] = useState<Drag | null>(null);
  const setDrag = (next: Drag | null): void => {
    dragRef.current = next;
    setDragState(next);
  };
  const [pending, setPending] = useState<ReadonlyMap<string, { time: number; pitch: number }>>(new Map());
  const [selected, setSelected] = useState<string | null>(null);
  const grid = useRef<HTMLDivElement | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const pitches = clip.notes.map((note) => note.pitch);
  const high = Math.min(127, Math.max(...pitches, 72) + 5);
  const low = Math.max(0, Math.min(...pitches, 48) - 5);
  const rows = high - low + 1;
  const width = Math.max(clip.duration, 4) * pxPerBeat;
  const beatsPerBar = piece.transport.beatsPerBar;

  // A source write lands as a re-mount; drop optimistic positions once the piece moves on.
  useEffect(() => setPending(new Map()), [clip]);

  const refusalFor = (note: PieceNote, prop: string): string | null =>
    propRefusal(index, note.oid, prop, note.oid ? (piece.oidCounts.get(note.oid) ?? 0) : 0);

  const onPointerDown = (note: PieceNote, event: ReactPointerEvent): void => {
    const refusal = refusalFor(note, 'at') ?? refusalFor(note, 'pitch');
    if (refusal) {
      props.onMessage(refusal);
      return;
    }
    (event.target as Element).setPointerCapture(event.pointerId);
    props.onMessage(null);
    setSelected(note.id);
    setDrag({ note, startX: event.clientX, startY: event.clientY, time: note.time, pitch: note.pitch });
  };

  const onPointerMove = (event: ReactPointerEvent): void => {
    const drag = dragRef.current;
    if (!drag) return;
    const time = Math.max(0, snap(drag.note.time + (event.clientX - drag.startX) / pxPerBeat));
    const pitch = Math.max(0, Math.min(127, Math.round(drag.note.pitch - (event.clientY - drag.startY) / ROW_H)));
    if (time !== drag.time || pitch !== drag.pitch) setDrag({ ...drag, time, pitch });
  };

  const onPointerUp = (): void => {
    const drag = dragRef.current;
    if (!drag) return;
    const { note, time, pitch } = drag;
    setDrag(null);
    if ((time === note.time && pitch === note.pitch) || !note.oid) return;
    // Written back in the piece's own units: an absolute `bar:beat` and a note name, spelled
    // with flats when the note was.
    const props_: Record<string, string> = {};
    const before: Record<string, string> = {};
    if (time !== note.time) {
      props_['at'] = formatAt(clip.time + time, piece.transport.beatsPerBar);
      before['at'] = note.written.at;
    }
    if (pitch !== note.pitch) {
      props_['pitch'] = formatPitch(pitch, spelledFlat(note.written.pitch));
      before['pitch'] = note.written.pitch;
    }
    setPending((prev) => new Map(prev).set(note.id, { time, pitch }));
    const oid = note.oid;
    const label = props_['pitch'] && !props_['at'] ? 'Transpose Note' : 'Move Note';
    writeProps(oid, props_, before).then(
      () => {
        // One entry on the workbench's one undo stack (Cmd+Z, the Edit menu): undo writes the
        // literals the note had, redo the ones the gesture wrote, through the same source route.
        editorHost().history.record({
          id: globalThis.crypto?.randomUUID?.() ?? `note-${Date.now()}`,
          label,
          resources: [props.file],
          document: props.documentId,
          undo: () => restoreProps(label, oid, props_, before).catch(() => false),
          redo: () => restoreProps(label, oid, before, props_).catch(() => false),
        });
      },
      (error: unknown) => {
        setPending((prev) => {
          const next = new Map(prev);
          next.delete(note.id);
          return next;
        });
        props.onMessage(error instanceof Error ? error.message : String(error));
      },
    );
  };

  // THE VELOCITY LANE (Bitwig's, under the notes): one stem per note, dragged up or down. The
  // write is `vel={…}` on the note's own element, added when the element does not write one;
  // undo puts back what was written, or takes the attribute off again.
  const velRef = useRef<{ note: PieceNote; startY: number; vel: number } | null>(null);
  const [velDrag, setVelDragState] = useState<{ id: string; vel: number } | null>(null);
  const [velPending, setVelPending] = useState<ReadonlyMap<string, number>>(new Map());
  useEffect(() => setVelPending(new Map()), [clip]);
  const velRefusal = (note: PieceNote): string | null => {
    if (!note.oid) return 'This note has no source element.';
    const count = piece.oidCounts.get(note.oid) ?? 0;
    if (count !== 1) return propRefusal(index, note.oid, 'vel', count);
    const authored = index.get(note.oid)?.authoredProps?.find((candidate) => candidate.name === 'vel');
    return authored && !authored.literal ? propRefusal(index, note.oid, 'vel', count) : null;
  };
  const onVelDown = (note: PieceNote, event: ReactPointerEvent): void => {
    const refusal = velRefusal(note);
    if (refusal) {
      props.onMessage(refusal);
      return;
    }
    (event.target as Element).setPointerCapture(event.pointerId);
    props.onMessage(null);
    setSelected(note.id);
    velRef.current = { note, startY: event.clientY, vel: note.vel };
    setVelDragState({ id: note.id, vel: note.vel });
  };
  const onVelMove = (event: ReactPointerEvent): void => {
    const drag = velRef.current;
    if (!drag) return;
    const vel = Math.max(0, Math.min(1, Math.round((drag.note.vel - (event.clientY - drag.startY) / VEL_H) * 100) / 100));
    if (vel === drag.vel) return;
    velRef.current = { ...drag, vel };
    setVelDragState({ id: drag.note.id, vel });
  };
  const onVelUp = (): void => {
    const drag = velRef.current;
    velRef.current = null;
    setVelDragState(null);
    if (!drag || !drag.note.oid || drag.vel === drag.note.vel) return;
    const { note, vel } = drag;
    const oid = drag.note.oid;
    const written = index.get(oid)?.authoredProps?.find((candidate) => candidate.name === 'vel')?.valueText ?? null;
    const before = written === null ? null : Number(written);
    setVelPending((prev) => new Map(prev).set(note.id, vel));
    writeProps(oid, { vel }, { vel: before }).then(
      () =>
        editorHost().history.record({
          id: globalThis.crypto?.randomUUID?.() ?? `vel-${Date.now()}`,
          label: 'Set Velocity',
          resources: [props.file],
          document: props.documentId,
          undo: () => restoreProps('Set Velocity', oid, { vel }, { vel: before }).catch(() => false),
          redo: () => restoreProps('Set Velocity', oid, { vel: before }, { vel }).catch(() => false),
        }),
      (error: unknown) => {
        setVelPending((prev) => {
          const next = new Map(prev);
          next.delete(note.id);
          return next;
        });
        props.onMessage(error instanceof Error ? error.message : String(error));
      },
    );
  };

  // Adding and removing notes are structural writes: a new literal `<Note>` in the clip's
  // source, or the note's element taken out. A note's element must be its own (not one
  // `.map()` renders many times); a new note goes after the literal note that precedes it in
  // time, so the source stays in playing order, or at the end of the clip when none does.
  const deleteNote = (note: PieceNote): void => {
    if (!note.oid || (piece.oidCounts.get(note.oid) ?? 0) !== 1) {
      props.onMessage(refusalFor(note, 'at') ?? 'This note has no source element of its own.');
      return;
    }
    props.onMessage(null);
    setSelected(null);
    writeStruct(note.oid, 'delete').then(
      (write) => {
        if (write) recordStructWrite('Delete Note', write, { index, pieceFile: props.file, documentId: props.documentId }, props.onMessage);
      },
      (error: unknown) => props.onMessage(error instanceof Error ? error.message : String(error)),
    );
  };

  const addNote = (event: ReactMouseEvent): void => {
    const box = grid.current?.getBoundingClientRect();
    if (!box) return;
    if (!clip.oid || (piece.oidCounts.get(clip.oid) ?? 0) !== 1) {
      props.onMessage('This clip is generated: one <Clip> in the source renders it more than once, so a note has no single place to go.');
      return;
    }
    const time = Math.max(0, Math.floor((event.clientX - box.left) / pxPerBeat / SNAP) * SNAP);
    const pitch = Math.max(0, Math.min(127, high - Math.floor((event.clientY - box.top) / ROW_H)));
    if (time >= clip.duration) return;
    const literal = clip.notes.filter((note) => note.oid && (piece.oidCounts.get(note.oid) ?? 0) === 1 && refusalFor(note, 'at') === null);
    const flats = literal.some((note) => spelledFlat(note.written.pitch));
    const chosen = clip.notes.find((note) => note.id === selected);
    const dur = chosen ? chosen.written.dur : formatDuration(1);
    const snippet = `<Note at="${formatAt(clip.time + time, beatsPerBar)}" pitch="${formatPitch(pitch, flats)}" dur="${dur}" />`;
    const before = literal.filter((note) => note.time <= time).sort((a, b) => a.time - b.time).at(-1);
    props.onMessage(null);
    const write = before?.oid ? writeStruct(before.oid, 'create-sibling', snippet) : writeStruct(clip.oid, 'create', snippet);
    write.then(
      (result) => {
        if (result) recordStructWrite('Add Note', result, { index, pieceFile: props.file, documentId: props.documentId }, props.onMessage);
      },
      (error: unknown) => props.onMessage(error instanceof Error ? error.message : String(error)),
    );
  };

  // FREEZE: the clip's generated notes and lanes written out as literal elements, so a person
  // can shape them by hand; the rule that generated them is left in the file, unused.
  const generated =
    clip.notes.some((note) => note.oid !== null && (piece.oidCounts.get(note.oid) ?? 0) > 1) ||
    clip.lanes.some((lane) => lane.oid !== null && (piece.oidCounts.get(lane.oid) ?? 0) > 1);
  const freeze = async (): Promise<void> => {
    if (!props.graph) return;
    const prevSource = await readSource(props.file);
    const newSource = freezeClip(prevSource, props.graph, props.trackName, props.clipNumber);
    if (!(await applySource(props.file, newSource, prevSource))) throw new Error(`${props.file} changed while freezing; try again.`);
    recordStructWrite('Freeze Clip', { file: props.file, prevSource, newSource }, { index, pieceFile: props.file, documentId: props.documentId }, props.onMessage);
  };

  const deleteRef = useRef<() => void>(() => {});
  deleteRef.current = () => {
    const note = clip.notes.find((candidate) => candidate.id === selected);
    if (note) deleteNote(note);
  };
  useEffect(() => {
    if (!props.active) return;
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      event.preventDefault();
      deleteRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.active]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '3px 10px', ...small, borderBottom: `1px solid ${themeVars.boundary.default}` }}>
        <span style={{ color }}>{props.trackName}</span> · {clip.name ?? 'clip'} · bar {Math.floor(clip.time / beatsPerBar) + 1} · {clip.notes.length} notes
        {generated ? (
          <button
            type="button"
            data-control="freeze"
            title="Write this clip's generated notes and lanes out as notes you can edit"
            style={{ ...button, marginLeft: 8, padding: '0 8px', fontSize: 11 }}
            onClick={() => {
              // This button goes away once the clip has nothing generated left. Focus goes to the
              // clip editor first, or it would fall to the page and the workbench's Undo would
              // no longer know which document it is in.
              scroller.current?.focus({ preventScroll: true });
              props.onMessage(null);
              freeze().catch((error: unknown) => props.onMessage(error instanceof Error ? error.message : String(error)));
            }}
          >
            Freeze
          </button>
        ) : null}
      </div>
      <div ref={scroller} tabIndex={-1} style={{ flex: 1, overflow: 'auto', outline: 'none' }}>
        <div style={{ display: 'flex', width: KEY_W + width }}>
        <div style={{ width: KEY_W, flex: 'none', position: 'sticky', left: 0, zIndex: 1, background: themeVars.surface.panel }}>
          {Array.from({ length: rows }, (_, row) => {
            const pitch = high - row;
            const black = [1, 3, 6, 8, 10].includes(pitch % 12);
            return (
              <div key={pitch} style={{ height: ROW_H, fontSize: 8, lineHeight: `${ROW_H}px`, paddingLeft: 3, background: black ? themeVars.surface.inset : themeVars.surface.raised, borderBottom: `1px solid ${themeVars.boundary.default}`, ...mono }}>
                {pitch % 12 === 0 ? noteName(pitch) : ''}
              </div>
            );
          })}
        </div>
        <div
          ref={grid}
          style={{ position: 'relative', width, height: rows * ROW_H, flex: 'none' }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onDoubleClick={(event) => {
            if (event.target === event.currentTarget || (event.target as HTMLElement).dataset['lane'] === 'row') addNote(event);
          }}
        >
          {Array.from({ length: rows }, (_, row) => {
            const pitch = high - row;
            const black = [1, 3, 6, 8, 10].includes(pitch % 12);
            return <div key={pitch} data-lane="row" style={{ position: 'absolute', left: 0, right: 0, top: row * ROW_H, height: ROW_H, background: black ? themeVars.surface.inset : 'transparent', opacity: 0.6 }} />;
          })}
          {Array.from({ length: Math.ceil(Math.max(clip.duration, 4)) + 1 }, (_, beat) => (
            <span key={beat} style={{ position: 'absolute', left: beat * pxPerBeat, top: 0, bottom: 0, width: 1, pointerEvents: 'none', background: themeVars.boundary.default, opacity: beat % beatsPerBar === 0 ? 0.9 : 0.3 }} />
          ))}
          {clip.notes.map((note) => {
            const moving = drag?.note.id === note.id ? drag : null;
            const shown = moving ?? pending.get(note.id) ?? note;
            const refusal = refusalFor(note, 'at') ?? refusalFor(note, 'pitch');
            return (
              <div
                key={note.id}
                onPointerDown={(event) => onPointerDown(note, event)}
                onDoubleClick={() => deleteNote(note)}
                title={refusal ?? `${note.written.pitch} · ${note.written.at} · ${note.written.dur} · vel ${note.vel}`}
                style={{
                  position: 'absolute',
                  left: shown.time * pxPerBeat,
                  width: Math.max(3, note.duration * pxPerBeat - 1),
                  top: (high - shown.pitch) * ROW_H + 1,
                  height: ROW_H - 2,
                  background: refusal ? 'transparent' : color,
                  opacity: refusal ? 0.75 : 0.35 + 0.65 * note.vel,
                  border: refusal ? `1px dashed ${color}` : `1px solid ${note.id === selected ? themeVars.content.primary : themeVars.surface.panel}`,
                  borderRadius: 2,
                  cursor: refusal ? 'not-allowed' : 'grab',
                  boxSizing: 'border-box',
                }}
              />
            );
          })}
          {props.playhead !== null && props.playhead >= clip.time && props.playhead < clip.time + clip.duration ? (
            <span style={{ position: 'absolute', left: (props.playhead - clip.time) * pxPerBeat, top: 0, bottom: 0, width: 1, background: themeVars.content.primary, pointerEvents: 'none' }} />
          ) : null}
        </div>
        </div>
        <div style={{ position: 'sticky', bottom: 0, zIndex: 2, width: KEY_W + width, background: themeVars.surface.panel }}>
        {clip.lanes.map((lane) => (
          <div key={lane.id} style={{ display: 'flex', borderTop: `1px solid ${themeVars.boundary.default}` }}>
            <div style={{ width: KEY_W, flex: 'none', position: 'sticky', left: 0, zIndex: 1, background: themeVars.surface.panel, ...small, fontSize: 9, padding: 3 }}>
              {lane.target}
            </div>
            <AutomationLane
              lane={lane}
              piece={piece}
              index={index}
              clipTime={clip.time}
              clipDuration={clip.duration}
              pxPerBeat={pxPerBeat}
              snap={SNAP}
              width={width}
              color={color}
              pieceFile={props.file}
              documentId={props.documentId}
              onMessage={props.onMessage}
            />
          </div>
        ))}
        <div
          style={{ display: 'flex', height: VEL_H, background: themeVars.surface.panel, borderTop: `1px solid ${themeVars.boundary.default}` }}
        >
          <div style={{ width: KEY_W, flex: 'none', position: 'sticky', left: 0, zIndex: 1, background: themeVars.surface.panel, ...small, fontSize: 9, padding: 3 }}>vel</div>
          <div style={{ position: 'relative', width, flex: 'none' }} onPointerMove={onVelMove} onPointerUp={onVelUp}>
            {clip.notes.map((note) => {
              const vel = velDrag?.id === note.id ? velDrag.vel : (velPending.get(note.id) ?? note.vel);
              const refusal = velRefusal(note);
              const shown = pending.get(note.id) ?? note;
              return (
                <div
                  key={note.id}
                  data-vel={note.id}
                  onPointerDown={(event) => onVelDown(note, event)}
                  title={refusal ?? `${note.written.pitch} · ${note.written.at} · vel ${vel}`}
                  style={{ position: 'absolute', left: shown.time * pxPerBeat - 3, width: 7, top: 0, bottom: 0, cursor: refusal ? 'not-allowed' : 'ns-resize' }}
                >
                  <span style={{ position: 'absolute', left: 3, width: 1, bottom: 0, height: vel * (VEL_H - 6), background: color, opacity: refusal ? 0.4 : 1 }} />
                  <span
                    style={{
                      position: 'absolute',
                      left: 1,
                      width: 5,
                      height: 5,
                      bottom: vel * (VEL_H - 6) - 2,
                      borderRadius: 3,
                      background: refusal ? 'transparent' : color,
                      border: `1px ${refusal ? 'dashed' : 'solid'} ${note.id === selected ? themeVars.content.primary : color}`,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
