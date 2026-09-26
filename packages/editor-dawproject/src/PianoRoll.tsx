/**
 * THE CLIP EDITOR under the arranger (Bitwig's detail editor): the selected clip's notes on a
 * piano roll, its automation lanes and a velocity lane. Every gesture writes the note's own
 * element in the piece's source (`source-index.ts`); a note that is generated is drawn as a
 * ghost and refuses with the reason.
 *
 * Bitwig's note-editing basics: a selection (click, Shift-click, a marquee on empty grid, Cmd+A,
 * Escape) that moves and resizes together; a grid every gesture snaps to (view state, never
 * written); Quantize (Q); copy, cut, paste and duplicate (Cmd+C X V D) through an in-memory
 * clipboard; Delete; and the selection's articulation. A gesture on one note writes that note's
 * element (the prop and struct routes); a gesture on several is ONE whole-file edit and ONE undo
 * entry, built from the TypeScript AST (`rewriteNotes`), and refuses whole when any note it
 * touches is generated.
 */

import { formatAt, formatDuration, formatPitch, midiOf, spelledFlat } from '@volter/dawproject/notation';
import type { Piece, PieceClip, PieceNote } from '@volter/dawproject/piece';
import type { DawNode } from '@volter/dawproject/render';
import { editorHost } from '@volter/editor-sdk/host';
import { themeVars } from '@volter/editor-sdk/widgets';
import { type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import { AutomationLane } from './AutomationLane';
import { freezeClip } from './freeze-clip';
import { applySource, type Literal, propRefusal, readSource, recordStructWrite, restoreProps, setProps, setRefusal, type SourceIndex, writeProps, writeStruct } from './source-index';
import { attributeText, type NoteInsert, rewriteNotes } from './source-notes';

const KEY_W = 44;
const ROW_H = 12;
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

/** The grid every gesture snaps to, in beats; `off` places by the pixel. 1/16 is the default. */
const GRIDS: readonly { readonly id: string; readonly step: number | null }[] = [
  { id: '1/4', step: 1 },
  { id: '1/8', step: 0.5 },
  { id: '1/16', step: 0.25 },
  { id: '1/32', step: 0.125 },
  { id: '1/8T', step: 1 / 3 },
  { id: '1/16T', step: 1 / 6 },
  { id: 'off', step: null },
];
/** The shortest note a resize leaves with the grid off: the finest grid step. */
const FINEST = 0.125;
const DEFAULT_VEL = 0.7;
const ARTICS = ['staccato', 'staccatissimo', 'tenuto', 'accent', 'marcato', 'legato', 'pizzicato', 'tremolo'] as const;
const ARTIC_MARK: Readonly<Record<string, string>> = {
  staccato: '·',
  staccatissimo: '▾',
  tenuto: '–',
  accent: '>',
  marcato: '^',
  legato: '⌒',
  pizzicato: 'pz',
  tremolo: '≋',
};

/** A copied note, placed relative to the copy's first start. */
interface Copied {
  readonly offset: number;
  readonly pitch: string;
  readonly dur: string;
  readonly vel: number;
  readonly artic: string | null;
}
/** The piano roll's clipboard: in memory, one for every clip, so a copy in one clip pastes in another. */
let clipboard: { readonly notes: readonly Copied[]; readonly end: number } | null = null;

/** A note gesture in flight: the note pressed, the selection it carries and the deltas so far. */
interface Drag {
  readonly mode: 'move' | 'resize';
  readonly anchor: PieceNote;
  readonly ids: ReadonlySet<string>;
  readonly startX: number;
  readonly startY: number;
  /** Beats, semitones and length the selection has moved by. */
  readonly dt: number;
  readonly dp: number;
  readonly dd: number;
  /** Pressed on a note inside a larger selection: released without moving, it becomes the selection. */
  readonly collapse: boolean;
}

/** A marquee on empty grid, in the grid's pixels. */
interface Marquee {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly base: ReadonlySet<string>;
}

/** Where a note draws while a gesture moves it or its write is landing. */
interface Shown {
  readonly time: number;
  readonly pitch: number;
  readonly duration: number;
}

type Reselect = readonly { readonly start: number; readonly pitch: number }[];

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
  /** Whether this document is the workbench's active editor: only then do its keys reach it. */
  readonly active: boolean;
}) {
  const { clip, color, piece, index, pxPerBeat } = props;
  // Gestures live in refs, read and written synchronously by every pointer event; the state
  // copies only draw them. A press, its moves and its release can arrive in one task (a fast
  // flick, a scripted gesture) before React commits, and a gesture read from state would miss them.
  const dragRef = useRef<Drag | null>(null);
  const [drag, setDragState] = useState<Drag | null>(null);
  const setDrag = (next: Drag | null): void => {
    dragRef.current = next;
    setDragState(next);
  };
  const marqueeRef = useRef<Marquee | null>(null);
  const [marquee, setMarqueeState] = useState<Marquee | null>(null);
  const setMarquee = (next: Marquee | null): void => {
    marqueeRef.current = next;
    setMarqueeState(next);
  };
  const selRef = useRef<ReadonlySet<string>>(new Set());
  const [selection, setSelectionState] = useState<ReadonlySet<string>>(new Set());
  const setSelection = (next: ReadonlySet<string>): void => {
    selRef.current = next;
    setSelectionState(next);
  };
  const [pending, setPending] = useState<ReadonlyMap<string, Shown>>(new Map());
  const [gridId, setGridId] = useState('1/16');
  const step = GRIDS.find((candidate) => candidate.id === gridId)?.step ?? null;
  const snap = (value: number): number => (step === null ? value : Math.round(value / step) * step);
  const minLength = step ?? FINEST;
  const grid = useRef<HTMLDivElement | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const pitches = clip.notes.map((note) => note.pitch);
  const high = Math.min(127, Math.max(...pitches, 72) + 5);
  const low = Math.max(0, Math.min(...pitches, 48) - 5);
  const rows = high - low + 1;
  const width = Math.max(clip.duration, 4) * pxPerBeat;
  const beatsPerBar = piece.transport.beatsPerBar;
  const resource = { file: props.file, documentId: props.documentId };
  const where = { index, pieceFile: props.file, documentId: props.documentId };
  const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

  // A source write lands as a re-mount: drop optimistic positions, and carry the selection to the
  // notes it names now (a gesture says where its notes went; otherwise each keeps its place).
  const reselectRef = useRef<Reselect | null>(null);
  const clipRef = useRef(clip);
  useEffect(() => {
    const previous = clipRef.current;
    clipRef.current = clip;
    setPending(new Map());
    const wanted = reselectRef.current ?? previous.notes.filter((note) => selRef.current.has(note.id)).map((note) => ({ start: note.start, pitch: note.pitch }));
    reselectRef.current = null;
    const next = new Set<string>();
    for (const want of wanted) {
      const hit = clip.notes.find((note) => !next.has(note.id) && Math.abs(note.start - want.start) < 1e-6 && note.pitch === want.pitch);
      if (hit) next.add(hit.id);
    }
    setSelection(next);
  }, [clip]);

  const count = (oid: string | null): number => (oid ? (piece.oidCounts.get(oid) ?? 0) : 0);
  const refusalFor = (note: PieceNote, prop: string): string | null => propRefusal(index, note.oid, prop, count(note.oid));
  /** Why a gesture may not rewrite this note's element, or `null`. */
  const noteRefusal = (note: PieceNote): string | null => {
    const refusal = refusalFor(note, 'at') ?? refusalFor(note, 'pitch') ?? refusalFor(note, 'dur');
    if (refusal) return refusal;
    const entry = note.oid ? index.get(note.oid) : undefined;
    if (entry && entry.file !== props.file && !entry.file.endsWith(`/${props.file}`)) return `This note is written in ${entry.file}, not in ${props.file}.`;
    return null;
  };
  const clipRefusal = (): string | null =>
    clip.oid && count(clip.oid) === 1 ? null : 'This clip is generated: one <Clip> in the source renders it more than once, so a note has no single place to go.';
  const selectedNotes = (): PieceNote[] => clip.notes.filter((note) => selRef.current.has(note.id));
  const notesOf = (ids: ReadonlySet<string>): PieceNote[] => clip.notes.filter((note) => ids.has(note.id));
  const flats = clip.notes.some((note) => spelledFlat(note.written.pitch));

  /**
   * SEVERAL NOTES, ONE EDIT: the file read fresh, every target found where the source index says
   * its element starts, the new text built from the AST, written only while the file is still what
   * was read, and ONE entry on the workbench's undo stack. Any generated target refuses it whole.
   */
  const rewrite = async (
    label: string,
    targets: readonly PieceNote[],
    change: (note: PieceNote) => { readonly set?: Readonly<Record<string, Literal | null>>; readonly remove?: boolean },
    inserts: readonly NoteInsert[],
    reselect: Reselect,
  ): Promise<void> => {
    for (const note of targets) {
      const refusal = noteRefusal(note);
      if (refusal) throw new Error(refusal);
    }
    const clipEntry = clip.oid && count(clip.oid) === 1 ? index.get(clip.oid) : undefined;
    if (inserts.length > 0 && !clipEntry) throw new Error(clipRefusal() ?? 'The source index has not caught up with this clip yet.');
    const prevSource = await readSource(props.file);
    const newSource = rewriteNotes(
      prevSource,
      clipEntry ? { line: clipEntry.line, col: clipEntry.col } : null,
      targets.map((note) => {
        const entry = index.get(note.oid ?? '');
        if (!entry) throw new Error('The source index has not caught up with this note yet.');
        return { line: entry.line, col: entry.col, expect: { at: note.written.at, pitch: note.written.pitch, dur: note.written.dur }, ...change(note) };
      }),
      inserts,
      beatsPerBar,
    );
    if (newSource === prevSource) return;
    reselectRef.current = reselect;
    if (!(await applySource(props.file, newSource, prevSource))) {
      reselectRef.current = null;
      throw new Error(`${props.file} changed while writing; try again.`);
    }
    recordStructWrite(label, { file: props.file, prevSource, newSource }, where, props.onMessage);
  };
  const report = (label: string) => (error: unknown): void => {
    reselectRef.current = null;
    setPending(new Map());
    props.onMessage(`${label}: nothing was written. ${messageOf(error)}`);
  };

  /** ONE note, ONE element: its props written in place, one undo entry that puts them back. */
  const setOne = (label: string, note: PieceNote, next: Readonly<Record<string, Literal | null>>, reselect: Reselect): void => {
    reselectRef.current = reselect;
    setProps(label, index, note.oid ?? '', next, resource).catch(report(label));
  };

  /** One new note through the struct route, after the literal note that precedes it in time. */
  const insertOne = (label: string, time: number, snippet: string, reselect: Reselect): void => {
    const refusal = clipRefusal();
    if (refusal || !clip.oid) {
      props.onMessage(refusal);
      return;
    }
    const literal = clip.notes.filter((note) => note.oid && count(note.oid) === 1 && refusalFor(note, 'at') === null);
    const before = literal.filter((note) => note.time <= time + 1e-9).sort((a, b) => a.time - b.time).at(-1);
    reselectRef.current = reselect;
    const write = before?.oid ? writeStruct(before.oid, 'create-sibling', snippet) : writeStruct(clip.oid, 'create', snippet);
    write.then(
      (result) => {
        if (result) recordStructWrite(label, result, where, props.onMessage);
        else reselectRef.current = null;
      },
      report(label),
    );
  };

  const noteText = (start: number, note: Copied): string =>
    `<Note ${[
      attributeText('at', formatAt(start, beatsPerBar)),
      attributeText('pitch', note.pitch),
      attributeText('dur', note.dur),
      ...(Math.abs(note.vel - DEFAULT_VEL) > 1e-9 ? [attributeText('vel', note.vel)] : []),
      ...(note.artic ? [attributeText('artic', note.artic)] : []),
    ].join(' ')} />`;

  const copied = (notes: readonly PieceNote[]): { notes: Copied[]; end: number } => {
    const origin = Math.min(...notes.map((note) => note.start));
    return {
      notes: [...notes]
        .sort((a, b) => a.start - b.start || a.pitch - b.pitch)
        .map((note) => ({ offset: note.start - origin, pitch: note.written.pitch, dur: note.written.dur, vel: note.vel, artic: note.artic })),
      end: Math.max(...notes.map((note) => note.start + note.duration)),
    };
  };

  /** New notes at `time` (beats from the clip's start), selected once they land. */
  const place = (label: string, notes: readonly Copied[], time: number): void => {
    if (notes.length === 0) return;
    if (time < 0 || notes.some((note) => time + note.offset >= clip.duration - 1e-9)) {
      props.onMessage(`${label}: nothing was written. The notes would land past the clip's end.`);
      return;
    }
    const reselect = notes.map((note) => ({ start: clip.time + time + note.offset, pitch: midiOf(note.pitch) }));
    const [only] = notes;
    if (notes.length === 1 && only) {
      insertOne(`${label} Note`, time + only.offset, noteText(clip.time + time + only.offset, only), reselect);
      return;
    }
    const inserts = notes.map((note) => ({ start: clip.time + time + note.offset, text: noteText(clip.time + time + note.offset, note) }));
    rewrite(`${label} Notes`, [], () => ({}), inserts, reselect).catch(report(`${label} Notes`));
  };

  // Adding and removing notes are structural writes: a new literal `<Note>` in the clip's
  // source, or the note's element taken out. A note's element must be its own (not one
  // `.map()` renders many times); a new note goes after the literal note that precedes it in
  // time, so the source stays in playing order, or at the end of the clip when none does.
  const deleteNote = (note: PieceNote, label = 'Delete Note'): void => {
    if (!note.oid || count(note.oid) !== 1) {
      props.onMessage(refusalFor(note, 'at') ?? 'This note has no source element of its own.');
      return;
    }
    props.onMessage(null);
    reselectRef.current = [];
    writeStruct(note.oid, 'delete').then(
      (write) => {
        if (write) recordStructWrite(label, write, where, props.onMessage);
      },
      report(label),
    );
  };

  const removeNotes = (notes: readonly PieceNote[], verb: 'Delete' | 'Cut'): void => {
    const [only] = notes;
    if (!only) return;
    if (notes.length === 1) {
      deleteNote(only, `${verb} Note`);
      return;
    }
    rewrite(`${verb} Notes`, notes, () => ({ remove: true }), [], []).catch(report(`${verb} Notes`));
  };

  const addNote = (event: ReactMouseEvent): void => {
    const box = grid.current?.getBoundingClientRect();
    if (!box) return;
    const refusal = clipRefusal();
    if (refusal) {
      props.onMessage(refusal);
      return;
    }
    const at = (event.clientX - box.left) / pxPerBeat;
    const time = Math.max(0, step === null ? at : Math.floor(at / step) * step);
    const pitch = Math.max(0, Math.min(127, high - Math.floor((event.clientY - box.top) / ROW_H)));
    if (time >= clip.duration) return;
    const [chosen, ...others] = selectedNotes();
    const dur = chosen && others.length === 0 ? chosen.written.dur : formatDuration(1);
    const snippet = `<Note at="${formatAt(clip.time + time, beatsPerBar)}" pitch="${formatPitch(pitch, flats)}" dur="${dur}" />`;
    props.onMessage(null);
    insertOne('Add Note', time, snippet, [{ start: clip.time + time, pitch }]);
  };

  // THE SELECTION'S COMMANDS, each the header's control or the key Bitwig binds it to.
  const selectAll = (): void => setSelection(new Set(clip.notes.map((note) => note.id)));
  const copy = (): boolean => {
    const notes = selectedNotes();
    if (notes.length === 0) return false;
    clipboard = copied(notes);
    return true;
  };
  const cut = (): boolean => {
    if (!copy()) return false;
    removeNotes(selectedNotes(), 'Cut');
    return true;
  };
  const paste = (): void => {
    if (!clipboard) {
      props.onMessage('Nothing to paste: copy notes first (Cmd+C).');
      return;
    }
    const playhead = props.playhead;
    const selected = selectedNotes();
    const copiedEnd = clipboard.end - clip.time;
    const time =
      playhead !== null && playhead >= clip.time && playhead < clip.time + clip.duration
        ? snap(playhead - clip.time)
        : selected.length > 0
          ? Math.max(...selected.map((note) => note.time + note.duration))
          : copiedEnd >= 0 && copiedEnd < clip.duration
            ? copiedEnd
            : 0;
    place('Paste', clipboard.notes, time);
  };
  const duplicate = (): void => {
    const selected = selectedNotes();
    if (selected.length === 0) return;
    const copy_ = copied(selected);
    place('Duplicate', copy_.notes, copy_.end - clip.time);
  };
  const quantize = (): void => {
    if (step === null) {
      props.onMessage('The grid is off: choose a grid to quantize to.');
      return;
    }
    const selected = selectedNotes();
    const targets = (selected.length > 0 ? selected : clip.notes).filter((note) => Math.abs(snap(note.start) - note.start) > 1e-9);
    const [only] = targets;
    if (!only) return;
    const moved = new Set(targets.map((note) => note.id));
    const reselect = selected.map((note) => ({ start: moved.has(note.id) ? snap(note.start) : note.start, pitch: note.pitch }));
    if (targets.length === 1) {
      const refusal = noteRefusal(only);
      if (refusal) props.onMessage(`Quantize Note: nothing was written. ${refusal}`);
      else setOne('Quantize Note', only, { at: formatAt(snap(only.start), beatsPerBar) }, reselect);
      return;
    }
    rewrite('Quantize Notes', targets, (note) => ({ set: { at: formatAt(snap(note.start), beatsPerBar) } }), [], reselect).catch(report('Quantize Notes'));
  };
  const setArtic = (artic: string | null): void => {
    const selected = selectedNotes();
    const targets = selected.filter((note) => note.artic !== artic);
    const [only] = targets;
    if (!only) return;
    const reselect = selected.map((note) => ({ start: note.start, pitch: note.pitch }));
    if (targets.length === 1) {
      const refusal = setRefusal(index, only.oid, 'artic', count(only.oid));
      if (refusal) props.onMessage(`Set Articulation: nothing was written. ${refusal}`);
      else setOne('Set Articulation', only, { artic }, reselect);
      return;
    }
    rewrite('Set Articulation', targets, () => ({ set: { artic } }), [], reselect).catch(report('Set Articulation'));
  };

  // NOTE GESTURES: a press on a note selects it (Shift toggles it); a drag moves the selection, a
  // drag on a note's right edge changes the selection's lengths.
  const onNoteDown = (note: PieceNote, event: ReactPointerEvent, mode: Drag['mode']): void => {
    event.stopPropagation();
    if (event.button !== 0) return;
    scroller.current?.focus({ preventScroll: true });
    const current = selRef.current;
    if (event.shiftKey) {
      const next = new Set(current);
      if (next.has(note.id)) next.delete(note.id);
      else next.add(note.id);
      setSelection(next);
      return;
    }
    const ids = current.has(note.id) ? current : new Set([note.id]);
    if (ids !== current) setSelection(ids);
    for (const target of notesOf(ids)) {
      const refusal = noteRefusal(target);
      if (refusal) {
        props.onMessage(refusal);
        return;
      }
    }
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    props.onMessage(null);
    setDrag({ mode, anchor: note, ids, startX: event.clientX, startY: event.clientY, dt: 0, dp: 0, dd: 0, collapse: ids === current && current.size > 1 });
  };

  const onGridDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement;
    if (event.button !== 0 || (target !== event.currentTarget && target.dataset['lane'] !== 'row')) return;
    const box = grid.current?.getBoundingClientRect();
    if (!box) return;
    scroller.current?.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    const base = event.shiftKey ? selRef.current : new Set<string>();
    if (!event.shiftKey) setSelection(base);
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    setMarquee({ x0: x, y0: y, x1: x, y1: y, base });
  };

  const onPointerMove = (event: ReactPointerEvent): void => {
    const current = dragRef.current;
    if (current) {
      const dx = (event.clientX - current.startX) / pxPerBeat;
      const targets = notesOf(current.ids);
      if (current.mode === 'move') {
        const earliest = Math.min(...targets.map((note) => note.time));
        const dt = Math.max(-earliest, snap(current.anchor.time + dx) - current.anchor.time);
        const lowest = Math.min(...targets.map((note) => note.pitch));
        const highest = Math.max(...targets.map((note) => note.pitch));
        const dp = Math.max(-lowest, Math.min(127 - highest, Math.round(-(event.clientY - current.startY) / ROW_H)));
        if (dt !== current.dt || dp !== current.dp) setDrag({ ...current, dt, dp });
      } else {
        const dd = snap(current.anchor.duration + dx) - current.anchor.duration;
        if (dd !== current.dd) setDrag({ ...current, dd });
      }
      return;
    }
    const box = marqueeRef.current;
    const rect = grid.current?.getBoundingClientRect();
    if (box && rect) setMarquee({ ...box, x1: event.clientX - rect.left, y1: event.clientY - rect.top });
  };

  const lengthOf = (note: PieceNote, dd: number): number =>
    dd < 0 ? Math.max(Math.min(note.duration, minLength), note.duration + dd) : note.duration + dd;

  const shownOf = (note: PieceNote): Shown => {
    if (drag?.ids.has(note.id)) {
      return drag.mode === 'move'
        ? { time: note.time + drag.dt, pitch: note.pitch + drag.dp, duration: note.duration }
        : { time: note.time, pitch: note.pitch, duration: lengthOf(note, drag.dd) };
    }
    return pending.get(note.id) ?? note;
  };

  const onPointerUp = (): void => {
    const current = dragRef.current;
    if (current) {
      setDrag(null);
      if (current.mode === 'move') commitMove(current);
      else commitResize(current);
      return;
    }
    const box = marqueeRef.current;
    if (!box) return;
    setMarquee(null);
    const left = Math.min(box.x0, box.x1);
    const right = Math.max(box.x0, box.x1);
    const top = Math.min(box.y0, box.y1);
    const bottom = Math.max(box.y0, box.y1);
    if (right - left < 3 && bottom - top < 3) return;
    const next = new Set(box.base);
    for (const note of clip.notes) {
      const x = note.time * pxPerBeat;
      const w = Math.max(3, note.duration * pxPerBeat - 1);
      const y = (high - note.pitch) * ROW_H + 1;
      if (x < right && x + w > left && y < bottom && y + ROW_H - 2 > top) next.add(note.id);
    }
    setSelection(next);
  };

  const commitMove = (current: Drag): void => {
    const { dt, dp } = current;
    if (dt === 0 && dp === 0) {
      if (current.collapse) setSelection(new Set([current.anchor.id]));
      return;
    }
    const targets = notesOf(current.ids);
    const shown = new Map(targets.map((note) => [note.id, { time: note.time + dt, pitch: note.pitch + dp, duration: note.duration }]));
    setPending(shown);
    const reselect = targets.map((note) => ({ start: note.start + dt, pitch: note.pitch + dp }));
    const [note] = targets;
    if (!note) return;
    if (targets.length > 1) {
      const label = dt === 0 ? 'Transpose Notes' : 'Move Notes';
      rewrite(
        label,
        targets,
        (target) => ({
          set: {
            ...(dt !== 0 ? { at: formatAt(target.start + dt, beatsPerBar) } : {}),
            ...(dp !== 0 ? { pitch: formatPitch(target.pitch + dp, spelledFlat(target.written.pitch)) } : {}),
          },
        }),
        [],
        reselect,
      ).catch(report(label));
      return;
    }
    if (!note.oid) return;
    // Written back in the piece's own units: an absolute `bar:beat` and a note name, spelled
    // with flats when the note was.
    const props_: Record<string, string> = {};
    const before: Record<string, string> = {};
    if (dt !== 0) {
      props_['at'] = formatAt(note.start + dt, beatsPerBar);
      before['at'] = note.written.at;
    }
    if (dp !== 0) {
      props_['pitch'] = formatPitch(note.pitch + dp, spelledFlat(note.written.pitch));
      before['pitch'] = note.written.pitch;
    }
    const oid = note.oid;
    const label = props_['pitch'] && !props_['at'] ? 'Transpose Note' : 'Move Note';
    reselectRef.current = reselect;
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
      report(label),
    );
  };

  const commitResize = (current: Drag): void => {
    const targets = notesOf(current.ids).filter((note) => Math.abs(lengthOf(note, current.dd) - note.duration) > 1e-9);
    const [only] = targets;
    if (!only) {
      if (current.collapse) setSelection(new Set([current.anchor.id]));
      return;
    }
    setPending(new Map(targets.map((note) => [note.id, { time: note.time, pitch: note.pitch, duration: lengthOf(note, current.dd) }])));
    const reselect = notesOf(current.ids).map((note) => ({ start: note.start, pitch: note.pitch }));
    if (targets.length === 1) {
      setOne('Set Note Length', only, { dur: formatDuration(lengthOf(only, current.dd)) }, reselect);
      return;
    }
    rewrite('Set Note Lengths', targets, (note) => ({ set: { dur: formatDuration(lengthOf(note, current.dd)) } }), [], reselect).catch(report('Set Note Lengths'));
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
    const rendered = count(note.oid);
    if (rendered !== 1) return propRefusal(index, note.oid, 'vel', rendered);
    const authored = index.get(note.oid)?.authoredProps?.find((candidate) => candidate.name === 'vel');
    return authored && !authored.literal ? propRefusal(index, note.oid, 'vel', rendered) : null;
  };
  const onVelDown = (note: PieceNote, event: ReactPointerEvent): void => {
    const refusal = velRefusal(note);
    if (refusal) {
      props.onMessage(refusal);
      return;
    }
    (event.target as Element).setPointerCapture(event.pointerId);
    props.onMessage(null);
    setSelection(new Set([note.id]));
    velRef.current = { note, startY: event.clientY, vel: note.vel };
    setVelDragState({ id: note.id, vel: note.vel });
  };
  const onVelMove = (event: ReactPointerEvent): void => {
    const current = velRef.current;
    if (!current) return;
    const vel = Math.max(0, Math.min(1, Math.round((current.note.vel - (event.clientY - current.startY) / VEL_H) * 100) / 100));
    if (vel === current.vel) return;
    velRef.current = { ...current, vel };
    setVelDragState({ id: current.note.id, vel });
  };
  const onVelUp = (): void => {
    const current = velRef.current;
    velRef.current = null;
    setVelDragState(null);
    if (!current || !current.note.oid || current.vel === current.note.vel) return;
    const { note, vel } = current;
    const oid = current.note.oid;
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
        props.onMessage(messageOf(error));
      },
    );
  };

  // FREEZE: the clip's generated notes and lanes written out as literal elements, so a person
  // can shape them by hand; the rule that generated them is left in the file, unused.
  const generated =
    clip.notes.some((note) => note.oid !== null && count(note.oid) > 1) || clip.lanes.some((lane) => lane.oid !== null && count(lane.oid) > 1);
  const freeze = async (): Promise<void> => {
    if (!props.graph) return;
    const prevSource = await readSource(props.file);
    const newSource = freezeClip(prevSource, props.graph, props.trackName, props.clipNumber);
    if (!(await applySource(props.file, newSource, prevSource))) throw new Error(`${props.file} changed while freezing; try again.`);
    recordStructWrite('Freeze Clip', { file: props.file, prevSource, newSource }, where, props.onMessage);
  };

  // THE KEYS, only while this document is the workbench's active editor and no field has them.
  const keyRef = useRef<(event: KeyboardEvent) => boolean>(() => false);
  keyRef.current = (event) => {
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (mod && !event.altKey && !event.shiftKey) {
      if (key === 'a') selectAll();
      else if (key === 'c') return copy();
      else if (key === 'x') return cut();
      else if (key === 'v') paste();
      else if (key === 'd') {
        if (selRef.current.size === 0) return false;
        duplicate();
      } else return false;
      return true;
    }
    if (mod || event.altKey) return false;
    if (key === 'q') quantize();
    else if (event.key === 'Delete' || event.key === 'Backspace') removeNotes(selectedNotes(), 'Delete');
    else if (event.key === 'Escape' && selRef.current.size > 0) setSelection(new Set());
    else return false;
    return true;
  };
  useEffect(() => {
    if (!props.active) return;
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      if (!keyRef.current(event)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.active]);

  const selectedArtics = new Set(clip.notes.filter((note) => selection.has(note.id)).map((note) => note.artic ?? 'none'));
  const articValue = selectedArtics.size === 1 ? [...selectedArtics][0]! : selectedArtics.size === 0 ? 'none' : '';
  const control: CSSProperties = { ...button, padding: '0 6px', fontSize: 11 };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 10px', ...small, borderBottom: `1px solid ${themeVars.boundary.default}` }}>
        <span>
          <span style={{ color }}>{props.trackName}</span> · {clip.name ?? 'clip'} · bar {Math.floor(clip.time / beatsPerBar) + 1} · {clip.notes.length} notes
          {selection.size > 0 ? ` · ${selection.size} selected` : ''}
        </span>
        {generated ? (
          <button
            type="button"
            data-control="freeze"
            title="Write this clip's generated notes and lanes out as notes you can edit"
            style={{ ...control, padding: '0 8px' }}
            onClick={() => {
              // This button goes away once the clip has nothing generated left. Focus goes to the
              // clip editor first, or it would fall to the page and the workbench's Undo would
              // no longer know which document it is in.
              scroller.current?.focus({ preventScroll: true });
              props.onMessage(null);
              freeze().catch((error: unknown) => props.onMessage(messageOf(error)));
            }}
          >
            Freeze
          </button>
        ) : null}
        <span style={{ flex: 1 }} />
        <span>Grid</span>
        <select data-control="grid" title="The grid every gesture snaps to" value={gridId} onChange={(event) => setGridId(event.target.value)} style={control}>
          {GRIDS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.id === 'off' ? 'Off' : option.id}
            </option>
          ))}
        </select>
        <button
          type="button"
          data-control="quantize"
          title="Move the selection's starts to the grid; the whole clip's when nothing is selected (Q)"
          style={control}
          onClick={() => {
            scroller.current?.focus({ preventScroll: true });
            quantize();
          }}
        >
          Quantize
        </button>
        <span>Artic.</span>
        <select
          data-control="artic"
          title="How the selected notes are played"
          disabled={selection.size === 0}
          value={articValue}
          onChange={(event) => {
            scroller.current?.focus({ preventScroll: true });
            setArtic(event.target.value === 'none' ? null : event.target.value);
          }}
          style={control}
        >
          {articValue === '' ? (
            <option value="" disabled>
              mixed
            </option>
          ) : null}
          <option value="none">none</option>
          {ARTICS.map((artic) => (
            <option key={artic} value={artic}>
              {artic}
            </option>
          ))}
        </select>
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
          data-grid="notes"
          style={{ position: 'relative', width, height: rows * ROW_H, flex: 'none' }}
          onPointerDown={onGridDown}
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
          {step !== null && step < 1
            ? Array.from({ length: Math.ceil(Math.max(clip.duration, 4) / step) }, (_, line) =>
                Math.abs(line * step - Math.round(line * step)) < 1e-9 ? null : (
                  <span key={`g${line}`} style={{ position: 'absolute', left: line * step * pxPerBeat, top: 0, bottom: 0, width: 1, pointerEvents: 'none', background: themeVars.boundary.default, opacity: 0.12 }} />
                ),
              )
            : null}
          {Array.from({ length: Math.ceil(Math.max(clip.duration, 4)) + 1 }, (_, beat) => (
            <span key={beat} style={{ position: 'absolute', left: beat * pxPerBeat, top: 0, bottom: 0, width: 1, pointerEvents: 'none', background: themeVars.boundary.default, opacity: beat % beatsPerBar === 0 ? 0.9 : 0.3 }} />
          ))}
          {clip.notes.map((note) => {
            const shown = shownOf(note);
            const refusal = noteRefusal(note);
            const isSelected = selection.has(note.id);
            const mark = note.artic ? (ARTIC_MARK[note.artic] ?? note.artic) : null;
            return (
              <div
                key={note.id}
                data-note={note.id}
                data-selected={isSelected ? 'true' : undefined}
                onPointerDown={(event) => onNoteDown(note, event, 'move')}
                onDoubleClick={() => deleteNote(note)}
                title={refusal ?? `${note.written.pitch} · ${note.written.at} · ${note.written.dur} · vel ${note.vel}${note.artic ? ` · ${note.artic}` : ''}`}
                style={{
                  position: 'absolute',
                  left: shown.time * pxPerBeat,
                  width: Math.max(3, shown.duration * pxPerBeat - 1),
                  top: (high - shown.pitch) * ROW_H + 1,
                  height: ROW_H - 2,
                  background: refusal ? 'transparent' : color,
                  opacity: refusal ? 0.75 : isSelected ? 1 : 0.35 + 0.65 * note.vel,
                  border: refusal ? `1px ${isSelected ? 'solid' : 'dashed'} ${isSelected ? themeVars.content.primary : color}` : `1px solid ${isSelected ? themeVars.content.primary : themeVars.surface.panel}`,
                  boxShadow: isSelected ? `0 0 0 1px ${themeVars.content.primary}` : undefined,
                  borderRadius: 2,
                  cursor: refusal ? 'not-allowed' : 'grab',
                  boxSizing: 'border-box',
                  zIndex: isSelected ? 1 : undefined,
                }}
              >
                {mark ? (
                  <span data-artic={note.artic} style={{ position: 'absolute', left: 2, top: 0, fontSize: 9, lineHeight: `${ROW_H - 4}px`, fontWeight: 700, color: themeVars.surface.panel, pointerEvents: 'none' }}>
                    {mark}
                  </span>
                ) : null}
                <div
                  data-edge={note.id}
                  onPointerDown={(event) => onNoteDown(note, event, 'resize')}
                  style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 5, cursor: refusal ? 'not-allowed' : 'ew-resize' }}
                />
              </div>
            );
          })}
          {marquee ? (
            <span
              data-marquee="true"
              style={{
                position: 'absolute',
                left: Math.min(marquee.x0, marquee.x1),
                top: Math.min(marquee.y0, marquee.y1),
                width: Math.abs(marquee.x1 - marquee.x0),
                height: Math.abs(marquee.y1 - marquee.y0),
                border: `1px dashed ${themeVars.content.primary}`,
                background: `${color}22`,
                pointerEvents: 'none',
                zIndex: 2,
              }}
            />
          ) : null}
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
              snap={step ?? 1e-6}
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
              const shown = shownOf(note);
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
                      border: `1px ${refusal ? 'dashed' : 'solid'} ${selection.has(note.id) ? themeVars.content.primary : color}`,
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
