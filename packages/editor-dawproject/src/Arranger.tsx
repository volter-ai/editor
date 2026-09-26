/**
 * THE ARRANGE VIEW's upper half, as Bitwig Studio lays it out: the transport bar (play / stop,
 * tempo, meter, the playhead's bar.beat, zoom) and the arranger (track headers beside the
 * timeline: bar ruler, markers, one lane of clips per track).
 *
 *   drag a clip             moves it by whole bars; its notes and lane points move with it
 *   drag a clip's right end resizes it by whole bars (never before its last note ends)
 *   double-click a lane     a new one-bar `<Clip>` at that bar
 *   Delete / Backspace      the selected clip, with everything in it
 *   Cmd/Ctrl+D              the selected clip duplicated right after itself
 *   double-click markers    a new `<Marker>` at that bar, after the piece's last one
 *   drag a marker           moves it by whole bars
 *   double-click a marker   renames it in place (Enter writes, Escape leaves it)
 *   Delete on a marker      takes it out
 *   + Track                 a new instrument track before the effect and master tracks
 *   the Tempo row           the transport's tempo lane (`<Points target="tempo">`), edited as a
 *                           clip's automation lane is; a piece without one gets a button adding it
 *
 * A gesture that rewrites several elements (a clip and its notes) is ONE whole-file edit and ONE
 * undo entry, built from the source's own tree (`source-notes.ts`); when any element it must
 * rewrite is generated, the whole gesture refuses with the reason and nothing is written.
 */

import { beatAt, beatsPerBarOf, formatAt } from '@volter/dawproject/notation';
import type { Piece, PieceClip, PieceMarker, PieceTrack } from '@volter/dawproject/piece';
import { themeVars } from '@volter/editor-sdk/widgets';
import { type CSSProperties, Fragment, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import ts from 'typescript';
import { AutomationLane, LANE_H as TEMPO_H } from './AutomationLane';
import type { EngineState } from './preview-engine';
import { applySource, createElement, formatNumber, readSource, recordStructWrite, setProps, setRefusal, type SourceIndex, writeStruct } from './source-index';
import { applyEdits, elementAt, indentOf, literalProp, parseSource, shiftClipEdits, SourceRefusal, type SourceElement } from './source-notes';

const HEADER_W = 190;
const LANE_H = 44;
const LOOP_H = 12;
const RULER_H = 22;
const MARKER_H = 18;
const TRACK_COLORS = ['#e8a33d', '#5aa9e6', '#8bc34a', '#e5637a', '#b388eb', '#4dd0c7', '#f2cc5c', '#9e9e9e'];

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

export function trackColor(track: PieceTrack, index: number): string {
  return track.color ?? TRACK_COLORS[index % TRACK_COLORS.length] ?? '#9e9e9e';
}

function barBeat(beat: number, numerator: number): string {
  const bar = Math.floor(beat / numerator) + 1;
  const inBar = Math.floor(beat % numerator) + 1;
  return `${bar}.${inBar}`;
}

export function TransportBar(props: {
  readonly piece: Piece;
  readonly playing: boolean;
  readonly engineState: EngineState;
  readonly playhead: number | null;
  /** Where Play starts, shown while stopped. */
  readonly start: number;
  readonly onToggle: () => void;
  readonly pxPerBeat: number;
  readonly onZoom: (value: number) => void;
  /** Whether the transport repeats the loop region instead of the whole piece. */
  readonly looping: boolean;
  readonly onLoop: () => void;
  /** Whether the preview clicks each beat while playing. */
  readonly metronome: boolean;
  readonly onMetronome: () => void;
  readonly writes: ArrangerWrites;
}) {
  const { piece, playing, engineState, playhead, writes } = props;
  const transport = piece.transport;
  // Tempo and meter are the `<Transport>`'s own props, written as literals, one undoable edit each.
  const writeTransport = (label: string, prop: 'tempo' | 'meter', value: number | string): void => {
    const why = setRefusal(writes.index, transport.oid, prop, transport.oid ? (piece.oidCounts.get(transport.oid) ?? 0) : 0);
    if (why || !transport.oid) {
      writes.onMessage(why ?? 'This piece has no <Transport> to write.');
      return;
    }
    writes.onMessage(null);
    setProps(label, writes.index, transport.oid, { [prop]: value }, { file: writes.file, documentId: writes.documentId }).catch((error: unknown) => writes.onMessage(messageOf(error)));
  };
  return (
    <div tabIndex={-1} data-transport="" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 10px', outline: 'none', borderBottom: `1px solid ${themeVars.boundary.default}`, background: themeVars.surface.raised }}>
      <button type="button" style={button} onClick={props.onToggle} title="Play / Stop (Space)">
        {playing ? '■ Stop' : '▶ Play'}
      </button>
      <span style={{ ...mono, minWidth: 48 }}>{barBeat(playhead ?? props.start, piece.transport.beatsPerBar)}</span>
      <span style={{ ...small, display: 'flex', alignItems: 'center', gap: 4 }}>
        <InlineField
          name="tempo"
          value={String(transport.tempo)}
          title="Tempo (click to edit)"
          onCommit={(text) => {
            const tempo = Number(text);
            if (!Number.isFinite(tempo) || tempo < 20 || tempo > 400) {
              writes.onMessage(`“${text}” is not a tempo: write beats per minute between 20 and 400.`);
              return;
            }
            if (tempo !== transport.tempo) writeTransport('Set Tempo', 'tempo', Math.round(tempo * 1000) / 1000);
          }}
        />
        BPM ·
        <InlineField
          name="meter"
          value={`${transport.numerator}/${transport.denominator}`}
          title="Meter (click to edit)"
          onCommit={(text) => {
            const meter = text.trim();
            try {
              beatsPerBarOf(meter);
            } catch (error) {
              writes.onMessage(messageOf(error));
              return;
            }
            if (meter !== `${transport.numerator}/${transport.denominator}`) writeTransport('Set Meter', 'meter', meter);
          }}
        />
      </span>
      <button
        type="button"
        data-control="loop"
        aria-pressed={props.looping}
        onClick={props.onLoop}
        title="Loop the region drawn above the ruler"
        style={{ ...button, background: props.looping ? themeVars.semantic.warning : themeVars.surface.raised, color: props.looping ? themeVars.surface.panel : themeVars.content.primary }}
      >
        Loop
      </button>
      <button
        type="button"
        data-control="metronome"
        aria-pressed={props.metronome}
        onClick={props.onMetronome}
        title="Metronome: click each beat while playing"
        style={{ ...button, background: props.metronome ? themeVars.semantic.warning : themeVars.surface.raised, color: props.metronome ? themeVars.surface.panel : themeVars.content.primary }}
      >
        Metronome
      </button>
      <span style={{ flex: 1 }} />
      {engineState.kind === 'loading' ? <span style={small}>{engineState.detail}…</span> : null}
      {engineState.kind === 'error' ? <span style={{ color: themeVars.semantic.danger }}>{engineState.message}</span> : null}
      <span style={small}>Zoom</span>
      <input
        type="range"
        min={8}
        max={96}
        value={props.pxPerBeat}
        onChange={(event) => props.onZoom(Number(event.target.value))}
        style={{ width: 90 }}
      />
    </div>
  );
}

/**
 * A value that is text until clicked, then an input: Enter hands the text to `onCommit`, Escape or
 * leaving the field puts the text back.
 */
function InlineField(props: { readonly name: string; readonly value: string; readonly title: string; readonly onCommit: (text: string) => void }) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <span data-field={props.name} title={props.title} onClick={() => setEditing(true)} style={{ ...mono, cursor: 'text', color: themeVars.content.primary, padding: '0 2px', borderBottom: `1px dotted ${themeVars.content.muted}` }}>
        {props.value}
      </span>
    );
  }
  return (
    <input
      data-field-input={props.name}
      defaultValue={props.value}
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key !== 'Enter' && event.key !== 'Escape') return;
        const text = event.currentTarget.value;
        // Focus stays in this document as the field goes, or it falls to the page and the
        // workbench's Undo no longer knows which document it is in.
        (event.currentTarget.closest('[tabindex]') as HTMLElement | null)?.focus({ preventScroll: true });
        setEditing(false);
        if (event.key === 'Enter') props.onCommit(text);
      }}
      onBlur={() => setEditing(false)}
      style={{ ...mono, width: 48, fontSize: 11, background: themeVars.surface.inset, color: themeVars.content.primary, border: `1px solid ${themeVars.boundary.default}`, borderRadius: 2 }}
    />
  );
}

/** Where a gesture writes, and where it says what went wrong. */
export interface ArrangerWrites {
  readonly index: SourceIndex;
  readonly file: string;
  readonly documentId: string | null;
  readonly onMessage: (message: string | null) => void;
}

/** A clip being dragged: moved by whole bars, or its end moved to a whole bar. */
interface ClipGesture {
  readonly kind: 'move' | 'resize';
  readonly clip: PieceClip;
  readonly startX: number;
  /** Bars moved (`move`) or the clip's length in bars (`resize`). */
  readonly bars: number;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Rewrite the piece's file as ONE edit and ONE undo entry: read it fresh, build the new text from
 * its tree, write it only while it is still what was read.
 */
async function rewriteFile(label: string, writes: ArrangerWrites, build: (source: string) => string): Promise<void> {
  const prevSource = await readSource(writes.file);
  const newSource = build(prevSource);
  if (newSource === prevSource) return;
  if (!(await applySource(writes.file, newSource, prevSource))) throw new Error(`${writes.file} changed during “${label}”; try again.`);
  recordStructWrite(label, { file: writes.file, prevSource, newSource }, { index: writes.index, pieceFile: writes.file, documentId: writes.documentId }, writes.onMessage);
}

/** The clip's own `<Clip>` in `source`, or a refusal saying why it has none. */
function clipElement(writes: ArrangerWrites, piece: Piece, clip: PieceClip, source: string): { file: ReturnType<typeof parseSource>; element: SourceElement } {
  if (!clip.oid) throw new SourceRefusal('This clip has no source element (the piece was rendered outside the editor).');
  const entry = writes.index.get(clip.oid);
  if (!entry) throw new SourceRefusal('The source index has not caught up with this clip yet.');
  const count = piece.oidCounts.get(clip.oid) ?? 0;
  if (count !== 1) throw new SourceRefusal(`Generated: one <Clip> at ${entry.file}:${entry.line} renders ${count} clips. Edit the code that generates them.`);
  const file = parseSource(source, writes.file);
  const element = elementAt(file, entry.line, entry.col, 'Clip');
  const at = element ? literalProp(element, 'at') : undefined;
  if (!element || (typeof at !== 'string' && typeof at !== 'number') || Math.abs(beatAt(at, piece.transport.beatsPerBar) - clip.time) > 1e-9) {
    throw new SourceRefusal('The source index has not caught up with this clip yet; try again.');
  }
  return { file, element };
}

export function Arranger(props: {
  readonly piece: Piece;
  readonly totalBeats: number;
  readonly pxPerBeat: number;
  readonly playhead: number | null;
  /** Where Play starts; a click on the ruler moves it (`onSeek`). */
  readonly start: number;
  readonly onSeek: (beat: number) => void;
  /** The loop region in beats, whether it is on, and a new region drawn on the loop strip. */
  readonly loop: { readonly from: number; readonly to: number };
  readonly looping: boolean;
  readonly onLoopRegion: (range: { readonly from: number; readonly to: number }) => void;
  readonly selectedClip: string | null;
  readonly onSelectClip: (id: string) => void;
  readonly selectedTrack: string | null;
  readonly onSelectTrack: (id: string) => void;
  readonly voiceless: ReadonlySet<string>;
  /** Whether this document is the workbench's active editor: only then do its keys act. */
  readonly active: boolean;
  readonly writes: ArrangerWrites;
}) {
  const { piece, totalBeats, pxPerBeat, writes } = props;
  const width = totalBeats * pxPerBeat;
  const beatsPerBar = piece.transport.beatsPerBar;
  const barPx = beatsPerBar * pxPerBeat;
  const bars = Math.ceil(totalBeats / beatsPerBar);
  // The loop strip's drag: the bar pressed and the bar under the pointer, whole bars between.
  const loopDrag = useRef<{ anchor: number; bar: number } | null>(null);
  const [drawnLoop, setDrawnLoop] = useState<{ anchor: number; bar: number } | null>(null);
  const loopBar = (event: ReactPointerEvent<HTMLDivElement>): number =>
    Math.max(0, Math.min(bars - 1, Math.floor((event.clientX - event.currentTarget.getBoundingClientRect().left) / barPx)));
  const shownLoop = drawnLoop
    ? { from: Math.min(drawnLoop.anchor, drawnLoop.bar) * beatsPerBar, to: (Math.max(drawnLoop.anchor, drawnLoop.bar) + 1) * beatsPerBar }
    : props.loop;
  // The gesture lives in a ref, read and written synchronously by every pointer event (the piano
  // roll's reason); the state copy only draws it. A written gesture is drawn where it landed until
  // the piece re-mounts with it.
  const gestureRef = useRef<ClipGesture | null>(null);
  const [gesture, setGestureState] = useState<ClipGesture | null>(null);
  const setGesture = (next: ClipGesture | null): void => {
    gestureRef.current = next;
    setGestureState(next);
  };
  const [pending, setPending] = useState<ClipGesture | null>(null);
  useEffect(() => setPending(null), [piece]);
  const say = (error: unknown): void => writes.onMessage(messageOf(error));
  const resource = { file: writes.file, documentId: writes.documentId };

  const beginClip = (kind: ClipGesture['kind'], clip: PieceClip, event: ReactPointerEvent): void => {
    event.stopPropagation();
    props.onSelectClip(clip.id);
    setSelectedMarker(null);
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    setGesture({ kind, clip, startX: event.clientX, bars: kind === 'move' ? 0 : Math.round(clip.duration / beatsPerBar) });
  };
  const moveClip = (event: ReactPointerEvent): void => {
    const current = gestureRef.current;
    if (!current) return;
    const dx = (event.clientX - current.startX) / barPx;
    const bars =
      current.kind === 'move'
        ? Math.max(-Math.round(current.clip.time / beatsPerBar), Math.round(dx))
        : Math.max(1, Math.round(current.clip.duration / beatsPerBar + dx));
    if (bars !== current.bars) setGesture({ ...current, bars });
  };
  const endClip = (): void => {
    const current = gestureRef.current;
    if (!current) return;
    setGesture(null);
    const { clip } = current;
    if (current.kind === 'move') {
      if (current.bars === 0) return;
      setPending(current);
      rewriteFile('Move Clip', writes, (source) => {
        const { file, element } = clipElement(writes, piece, clip, source);
        return applyEdits(source, shiftClipEdits(file, element, current.bars * beatsPerBar, beatsPerBar));
      }).catch((error: unknown) => {
        setPending(null);
        say(error);
      });
      return;
    }
    const length = Math.round(clip.duration / beatsPerBar);
    if (current.bars === length || !clip.oid) return;
    const lastEnd = Math.max(0, ...clip.notes.map((note) => note.start + note.duration - clip.time));
    const least = Math.max(1, Math.ceil(lastEnd / beatsPerBar - 1e-9));
    if (current.bars < least) {
      writes.onMessage(`${clip.name ? `“${clip.name}”` : 'This clip'} cannot end before its last note, which ends in bar ${Math.floor((clip.time + lastEnd - 1e-9) / beatsPerBar) + 1}: it keeps at least ${least} bar${least === 1 ? '' : 's'}.`);
      return;
    }
    const why = setRefusal(writes.index, clip.oid, 'bars', piece.oidCounts.get(clip.oid) ?? 0);
    if (why) {
      writes.onMessage(why);
      return;
    }
    setPending(current);
    setProps('Resize Clip', writes.index, clip.oid, { bars: current.bars }, resource).catch((error: unknown) => {
      setPending(null);
      say(error);
    });
  };

  // A new one-bar clip where an empty stretch of a lane is double-clicked: after the clip before
  // it in the track's source, else after the channel, so the source stays in playing order.
  const addClip = (track: PieceTrack, event: ReactMouseEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement;
    if (target !== event.currentTarget && target.dataset['grid'] === undefined) return;
    if (!track.oid || (piece.oidCounts.get(track.oid) ?? 0) !== 1) {
      writes.onMessage(`${track.name} is generated: one <Track> in the source renders it more than once, so a clip has no single place to go.`);
      return;
    }
    const box = event.currentTarget.getBoundingClientRect();
    const bar = Math.max(0, Math.floor((event.clientX - box.left) / barPx));
    const snippet = `<Clip at="${formatAt(bar * beatsPerBar, beatsPerBar, { bar: true })}" bars={1} />`;
    const own = (oid: string | null): oid is string => oid !== null && (piece.oidCounts.get(oid) ?? 0) === 1;
    const before = track.clips.filter((clip) => clip.time <= bar * beatsPerBar && own(clip.oid)).at(-1);
    const after = before?.oid ?? (own(track.channel?.oid ?? null) ? track.channel!.oid : null);
    writes.onMessage(null);
    const where = { index: writes.index, pieceFile: writes.file, documentId: writes.documentId };
    (after ? createElement('Add Clip', after, 'after', snippet, where, writes.onMessage) : createElement('Add Clip', track.oid, 'child', snippet, where, writes.onMessage)).catch(say);
  };

  // MARKERS: `<Marker at name>`, children of the `<Project>`. The one selected (clicked last)
  // is what Delete takes out, before any clip.
  const [selectedMarker, setSelectedMarker] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const markerDrag = useRef<{ marker: PieceMarker; startX: number; time: number } | null>(null);
  const [markerShown, setMarkerShown] = useState<{ id: string; time: number } | null>(null);
  useEffect(() => setMarkerShown(null), [piece]);
  const markerRefusal = (marker: PieceMarker, prop: string): string | null =>
    setRefusal(writes.index, marker.oid, prop, marker.oid ? (piece.oidCounts.get(marker.oid) ?? 0) : 0);

  const addMarker = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return;
    const bar = Math.max(0, Math.floor((event.clientX - event.currentTarget.getBoundingClientRect().left) / barPx));
    const names = new Set(piece.markers.map((marker) => marker.name));
    let number = piece.markers.length + 1;
    while (names.has(`Section ${number}`)) number++;
    const snippet = `<Marker at="${formatAt(bar * beatsPerBar, beatsPerBar, { bar: true })}" name="Section ${number}" />`;
    const own = (oid: string | null): oid is string => oid !== null && (piece.oidCounts.get(oid) ?? 0) === 1;
    const last = piece.markers.at(-1);
    const after = last ? (own(last.oid) ? last.oid : null) : own(piece.transport.oid) ? piece.transport.oid : null;
    if (!after) {
      writes.onMessage(last ? 'The last marker is generated, so a new one has no single place to go after it.' : 'This piece has no <Transport> of its own to put a marker after.');
      return;
    }
    writes.onMessage(null);
    createElement('Add Marker', after, 'after', snippet, { index: writes.index, pieceFile: writes.file, documentId: writes.documentId }, writes.onMessage).catch(say);
  };

  const beginMarker = (marker: PieceMarker, event: ReactPointerEvent): void => {
    event.stopPropagation();
    setSelectedMarker(marker.id);
    if (markerRefusal(marker, 'at')) return;
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    markerDrag.current = { marker, startX: event.clientX, time: marker.time };
  };
  const moveMarker = (event: ReactPointerEvent): void => {
    const current = markerDrag.current;
    if (!current) return;
    const time = Math.max(0, Math.round((current.marker.time + (event.clientX - current.startX) / pxPerBeat) / beatsPerBar) * beatsPerBar);
    if (time === current.time) return;
    markerDrag.current = { ...current, time };
    setMarkerShown({ id: current.marker.id, time });
  };
  const endMarker = (): void => {
    const current = markerDrag.current;
    markerDrag.current = null;
    if (!current || current.time === current.marker.time || !current.marker.oid) {
      setMarkerShown(null);
      return;
    }
    setProps('Move Marker', writes.index, current.marker.oid, { at: formatAt(current.time, beatsPerBar, { bar: true }) }, resource).catch((error: unknown) => {
      setMarkerShown(null);
      say(error);
    });
  };
  const startRename = (marker: PieceMarker): void => {
    const why = markerRefusal(marker, 'name');
    if (why) writes.onMessage(why);
    else setRenaming(marker.id);
  };
  const rename = (marker: PieceMarker, name: string): void => {
    setRenaming(null);
    container.current?.focus({ preventScroll: true });
    if (!marker.oid || name === marker.name || name.trim() === '') return;
    setProps('Rename Marker', writes.index, marker.oid, { name }, resource).catch(say);
  };
  const deleteMarker = (marker: PieceMarker): void => {
    if (!marker.oid || (piece.oidCounts.get(marker.oid) ?? 0) !== 1) {
      writes.onMessage('This marker is generated: it has no element of its own to delete.');
      return;
    }
    writes.onMessage(null);
    setSelectedMarker(null);
    writeStruct(marker.oid, 'delete').then((write) => {
      if (write) recordStructWrite('Delete Marker', write, { index: writes.index, pieceFile: writes.file, documentId: writes.documentId }, writes.onMessage);
    }, say);
  };

  // THE TEMPO LANE: a `<Points target="tempo">` in the `<Transport>`, one point at bar 1 holding
  // the transport's tempo, drawn and edited in the Tempo row from then on.
  /** The mixer parameters a track can automate and has no lane for yet, with the level each starts at. */
  const missingLanes = (track: PieceTrack): { target: string; value: number }[] => {
    const channel = track.channel;
    if (!channel) return [];
    const all = [
      { target: 'volume', value: channel.volume },
      { target: 'pan', value: channel.pan },
      ...channel.sends.map((send) => ({ target: `send:${send.to}`, value: send.level })),
    ];
    return all.filter((entry) => !track.lanes.some((lane) => lane.target === entry.target));
  };
  const addTrackLane = (track: PieceTrack, target: string): void => {
    const start = missingLanes(track).find((entry) => entry.target === target);
    if (!start || !track.oid || (piece.oidCounts.get(track.oid) ?? 0) !== 1) {
      writes.onMessage(track.oid ? `${track.name} is generated: its lanes are written in its code.` : `${track.name} has no <Track> of its own.`);
      return;
    }
    writes.onMessage(null);
    container.current?.focus({ preventScroll: true });
    const snippet = `<Points target="${target}"><Point at="1" value={${formatNumber(start.value)}} /></Points>`;
    createElement(`Add ${target} Lane`, track.oid, 'child', snippet, { index: writes.index, pieceFile: writes.file, documentId: writes.documentId }, writes.onMessage).catch(say);
  };
  const addTempoLane = (): void => {
    const transport = piece.transport;
    const entry = transport.oid ? writes.index.get(transport.oid) : undefined;
    if (!transport.oid || !entry || (piece.oidCounts.get(transport.oid) ?? 0) !== 1) {
      writes.onMessage('This piece has no <Transport> of its own to hold a tempo lane.');
      return;
    }
    writes.onMessage(null);
    // The button goes once the lane exists: focus moves to the arranger first, or it would fall
    // to the page and the workbench's Undo would no longer know which document it is in.
    container.current?.focus({ preventScroll: true });
    // Written into the file directly: a self-closing `<Transport />` opens to hold it.
    rewriteFile('Add Tempo Lane', writes, (source) => {
      const file = parseSource(source, writes.file);
      const element = elementAt(file, entry.line, entry.col, 'Transport');
      if (!element) throw new SourceRefusal('The source index has not caught up with the <Transport> yet; try again.');
      const newline = source.includes('\r\n') ? '\r\n' : '\n';
      const indent = indentOf(source, file, element);
      const lane = `<Points target="tempo">${newline}${indent}    <Point at="1" value={${transport.tempo}} />${newline}${indent}  </Points>`;
      if (ts.isJsxSelfClosingElement(element)) {
        const attributes = source.slice(element.tagName.end, element.end - 2).trimEnd();
        return `${source.slice(0, element.getStart(file))}<Transport${attributes}>${newline}${indent}  ${lane}${newline}${indent}</Transport>${source.slice(element.end)}`;
      }
      const close = element.closingElement.getStart(file);
      const before = source.slice(0, close).trimEnd();
      return `${before}${newline}${indent}  ${lane}${newline}${indent}${source.slice(close)}`;
    }).catch(say);
  };

  // + TRACK: an instrument track on the bank the piece already plays, before the first effect or
  // master track (Bitwig adds instrument tracks above the buses).
  const addTrack = (): void => {
    container.current?.focus({ preventScroll: true });
    const own = (oid: string | null): oid is string => oid !== null && (piece.oidCounts.get(oid) ?? 0) === 1;
    const bank = piece.tracks.flatMap((track) => track.channel?.devices ?? []).find((device) => device.plugin === 'soundfont')?.params['bank'];
    const names = new Set(piece.tracks.map((track) => track.name));
    let number = piece.tracks.length + 1;
    while (names.has(`Track ${number}`)) number++;
    const params = typeof bank === 'string' ? `{{ bank: ${JSON.stringify(bank)}, program: 0 }}` : '{{ program: 0 }}';
    const snippet = `<Track name="Track ${number}"><Channel><Device plugin="soundfont" params=${params} /></Channel></Track>`;
    const firstBus = piece.tracks.findIndex((track) => track.channel?.role === 'effect' || track.channel?.role === 'master');
    const previous = firstBus < 0 ? piece.tracks.at(-1) : piece.tracks[firstBus - 1];
    const after = previous ? previous.oid : (piece.markers.at(-1)?.oid ?? piece.transport.oid);
    if (!own(after)) {
      writes.onMessage('The element a new track would follow is generated, so the track has no single place to go.');
      return;
    }
    writes.onMessage(typeof bank === 'string' ? null : 'No soundfont bank in this piece yet: the new track has no instrument until its device names one.');
    createElement('Add Track', after, 'after', snippet, { index: writes.index, pieceFile: writes.file, documentId: writes.documentId }, writes.onMessage).catch(say);
  };

  const selected = piece.tracks.flatMap((track) => track.clips.map((clip) => ({ clip, track }))).find(({ clip }) => clip.id === props.selectedClip) ?? null;

  const deleteClip = (): void => {
    const clip = selected?.clip;
    if (!clip) return;
    if (!clip.oid || (piece.oidCounts.get(clip.oid) ?? 0) !== 1) {
      writes.onMessage('This clip is generated: one <Clip> in the source renders it more than once, so it has no element of its own to delete.');
      return;
    }
    writes.onMessage(null);
    writeStruct(clip.oid, 'delete').then((write) => {
      if (write) recordStructWrite('Delete Clip', write, { index: writes.index, pieceFile: writes.file, documentId: writes.documentId }, writes.onMessage);
    }, say);
  };

  const duplicateClip = (): void => {
    if (!selected) return;
    const { clip, track } = selected;
    writes.onMessage(null);
    rewriteFile('Duplicate Clip', writes, (source) => {
      const { file, element } = clipElement(writes, piece, clip, source);
      const start = element.getStart(file);
      const edits = shiftClipEdits(file, element, clip.duration, beatsPerBar).map((edit) => ({ ...edit, start: edit.start - start, end: edit.end - start }));
      const copy = applyEdits(source.slice(start, element.end), edits);
      const newline = source.includes('\r\n') ? '\r\n' : '\n';
      return source.slice(0, element.end) + newline + indentOf(source, file, element) + copy + source.slice(element.end);
    }).then(() => {
      // The copy is the clip's next sibling in its track: select it as Bitwig does.
      const [trackPart, childIndex] = clip.id.split(':clip:');
      if (trackPart === track.id && childIndex !== undefined) props.onSelectClip(`${track.id}:clip:${Number(childIndex) + 1}`);
    }, say);
  };

  // Keys reach the arranger only while it holds focus (a press inside it focuses it) and this
  // document is the active editor; handled keys stop here, so the clip editor below never sees them.
  const onKeyDown = (event: ReactKeyboardEvent): void => {
    if (!props.active) return;
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      event.stopPropagation();
      const marker = piece.markers.find((candidate) => candidate.id === selectedMarker);
      if (marker) deleteMarker(marker);
      else deleteClip();
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      event.stopPropagation();
      duplicateClip();
    }
  };
  const container = useRef<HTMLDivElement | null>(null);

  return (
    <div
      ref={container}
      tabIndex={-1}
      data-arranger=""
      onKeyDown={onKeyDown}
      onPointerDownCapture={() => container.current?.focus({ preventScroll: true })}
      style={{ display: 'flex', minWidth: HEADER_W + width, outline: 'none' }}
    >
      <div style={{ width: HEADER_W, flex: 'none', position: 'sticky', left: 0, zIndex: 2, background: themeVars.surface.panel, borderRight: `1px solid ${themeVars.boundary.default}` }}>
        <div style={{ height: LOOP_H + RULER_H + MARKER_H, borderBottom: `1px solid ${themeVars.boundary.default}` }} />
        <div style={{ height: TEMPO_H, display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px', borderBottom: `1px solid ${themeVars.boundary.default}`, ...small }}>
          Tempo
          {piece.transport.tempoPoints ? null : (
            <button type="button" data-control="add-tempo-lane" onClick={addTempoLane} title="Add a tempo lane holding the transport's tempo" style={{ ...button, fontSize: 10, padding: '0 6px' }}>
              + Lane
            </button>
          )}
        </div>
        {piece.tracks.map((track, index) => (
          <Fragment key={track.id}>
          <div
            data-track={track.name}
            onClick={() => props.onSelectTrack(track.id)}
            style={{
              height: LANE_H,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 8px',
              cursor: 'pointer',
              borderBottom: `1px solid ${themeVars.boundary.default}`,
              background: track.id === props.selectedTrack ? themeVars.surface.raised : 'transparent',
            }}
          >
            <span style={{ width: 4, alignSelf: 'stretch', margin: '6px 0', background: trackColor(track, index), borderRadius: 2 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.name}</div>
              <div style={small}>
                {props.voiceless.has(track.id)
                  ? 'no instrument'
                  : `${track.channel?.volume ?? 0} dB · ${track.channel?.devices.map((device) => device.name ?? device.plugin).join(', ') ?? ''}`}
              </div>
            </div>
            <span style={{ ...small, color: track.channel?.mute ? themeVars.semantic.warning : themeVars.content.muted }}>M</span>
            <span style={{ ...small, color: track.channel?.solo ? themeVars.semantic.success : themeVars.content.muted }}>S</span>
            {missingLanes(track).length > 0 ? (
              <select
                data-control="add-lane"
                value=""
                title="Automate a mixer parameter of this track across the arrangement"
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => addTrackLane(track, event.target.value)}
                style={{ ...small, width: 18, background: 'transparent', color: themeVars.content.muted, border: 'none' }}
              >
                <option value="">A</option>
                {missingLanes(track).map((entry) => (
                  <option key={entry.target} value={entry.target}>
                    {entry.target}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          {track.lanes.map((lane) => (
            <div key={lane.id} data-lane-label={`${track.name}:${lane.target}`} style={{ height: TEMPO_H, display: 'flex', alignItems: 'center', padding: '0 8px 0 20px', borderBottom: `1px solid ${themeVars.boundary.default}`, ...small }}>
              {lane.target}
            </div>
          ))}
          </Fragment>
        ))}
        <button type="button" data-control="add-track" onClick={addTrack} title="Add an instrument track" style={{ ...button, margin: 6, fontSize: 11 }}>
          + Track
        </button>
      </div>
      <div style={{ position: 'relative', width }} onPointerMove={moveClip} onPointerUp={endClip}>
        <div
          data-loop-strip=""
          title="Drag to set the loop region (whole bars)"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            const bar = loopBar(event);
            loopDrag.current = { anchor: bar, bar };
            setDrawnLoop(loopDrag.current);
          }}
          onPointerMove={(event) => {
            const current = loopDrag.current;
            if (!current) return;
            const bar = loopBar(event);
            if (bar === current.bar) return;
            loopDrag.current = { ...current, bar };
            setDrawnLoop(loopDrag.current);
          }}
          onPointerUp={() => {
            const current = loopDrag.current;
            loopDrag.current = null;
            setDrawnLoop(null);
            if (current) props.onLoopRegion({ from: Math.min(current.anchor, current.bar) * beatsPerBar, to: (Math.max(current.anchor, current.bar) + 1) * beatsPerBar });
          }}
          style={{ height: LOOP_H, position: 'relative', cursor: 'col-resize', background: themeVars.surface.inset, borderBottom: `1px solid ${themeVars.boundary.default}` }}
        >
          <span
            data-loop-region={`${shownLoop.from}-${shownLoop.to}`}
            data-looping={props.looping ? 'on' : 'off'}
            style={{
              position: 'absolute',
              left: shownLoop.from * pxPerBeat,
              width: (shownLoop.to - shownLoop.from) * pxPerBeat,
              top: 2,
              bottom: 2,
              borderRadius: 2,
              pointerEvents: 'none',
              background: props.looping ? themeVars.semantic.warning : themeVars.content.muted,
              opacity: props.looping ? 0.8 : 0.35,
            }}
          />
        </div>
        <div
          data-ruler=""
          title="Click to set where Play starts"
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            props.onSeek(Math.max(0, Math.round((event.clientX - box.left) / pxPerBeat)));
          }}
          style={{ height: RULER_H, position: 'relative', cursor: 'text', borderBottom: `1px solid ${themeVars.boundary.default}` }}
        >
          {Array.from({ length: bars }, (_, bar) => (
            <span key={bar} style={{ position: 'absolute', left: bar * barPx + 3, top: 4, pointerEvents: 'none', ...small, ...mono }}>
              {bar + 1}
            </span>
          ))}
        </div>
        <div
          data-marker-strip=""
          title="Double-click to add a marker"
          onDoubleClick={addMarker}
          onPointerMove={moveMarker}
          onPointerUp={endMarker}
          style={{ height: MARKER_H, position: 'relative', borderBottom: `1px solid ${themeVars.boundary.default}` }}
        >
          {piece.markers.map((marker) => {
            const time = markerShown?.id === marker.id ? markerShown.time : marker.time;
            const style: CSSProperties = {
              position: 'absolute',
              left: time * pxPerBeat,
              top: 1,
              padding: '0 4px',
              fontSize: 10,
              background: themeVars.surface.raised,
              borderLeft: `2px solid ${themeVars.semantic.warning}`,
              outline: marker.id === selectedMarker ? `1px solid ${themeVars.content.primary}` : 'none',
              whiteSpace: 'nowrap',
              cursor: 'grab',
              touchAction: 'none',
            };
            return renaming === marker.id ? (
              <input
                key={marker.id}
                data-marker-name={marker.id}
                defaultValue={marker.name}
                autoFocus
                onFocus={(event) => event.currentTarget.select()}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === 'Enter') rename(marker, event.currentTarget.value);
                  else if (event.key === 'Escape') rename(marker, marker.name);
                }}
                onBlur={() => setRenaming(null)}
                style={{ ...style, width: 110, height: MARKER_H - 4, color: themeVars.content.primary, border: 'none' }}
              />
            ) : (
              <span
                key={marker.id}
                data-marker={marker.name}
                title={markerRefusal(marker, 'at') ?? `${marker.name} · bar ${formatAt(marker.time, beatsPerBar, { bar: true })}`}
                onPointerDown={(event) => beginMarker(marker, event)}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  startRename(marker);
                }}
                style={style}
              >
                {marker.name}
              </span>
            );
          })}
        </div>
        <div data-tempo-row="" style={{ height: TEMPO_H, position: 'relative', borderBottom: `1px solid ${themeVars.boundary.default}` }}>
          {piece.transport.tempoPoints ? (
            <AutomationLane
              lane={piece.transport.tempoPoints}
              piece={piece}
              index={writes.index}
              clipTime={0}
              clipDuration={piece.length}
              pxPerBeat={pxPerBeat}
              snap={1}
              width={width}
              color={themeVars.semantic.warning}
              pieceFile={writes.file}
              documentId={writes.documentId}
              onMessage={writes.onMessage}
            />
          ) : null}
        </div>
        {piece.tracks.map((track, index) => (
          <Fragment key={track.id}>
          <div
            data-lane={track.name}
            onDoubleClick={(event) => addClip(track, event)}
            style={{ height: LANE_H, position: 'relative', borderBottom: `1px solid ${themeVars.boundary.default}` }}
          >
            {Array.from({ length: bars }, (_, bar) => (
              <span key={bar} data-grid="" style={{ position: 'absolute', left: bar * barPx, top: 0, bottom: 0, width: 1, background: themeVars.boundary.default, opacity: 0.35 }} />
            ))}
            {track.clips.map((clip) => {
              const moving = gesture?.clip.id === clip.id ? gesture : pending?.clip.id === clip.id ? pending : null;
              const time = moving?.kind === 'move' ? clip.time + moving.bars * beatsPerBar : clip.time;
              const duration = moving?.kind === 'resize' ? moving.bars * beatsPerBar : clip.duration;
              return (
                <ClipBlock
                  key={clip.id}
                  clip={clip}
                  time={time}
                  duration={duration}
                  color={trackColor(track, index)}
                  pxPerBeat={pxPerBeat}
                  selected={clip.id === props.selectedClip}
                  onMoveStart={(event) => beginClip('move', clip, event)}
                  onResizeStart={(event) => beginClip('resize', clip, event)}
                />
              );
            })}
          </div>
          {track.lanes.map((lane) => (
            <div key={lane.id} data-track-lane={`${track.name}:${lane.target}`} style={{ height: TEMPO_H, position: 'relative', borderBottom: `1px solid ${themeVars.boundary.default}` }}>
              <AutomationLane
                lane={lane}
                piece={piece}
                index={writes.index}
                clipTime={0}
                clipDuration={piece.length}
                pxPerBeat={pxPerBeat}
                snap={1}
                width={width}
                color={trackColor(track, index)}
                pieceFile={writes.file}
                documentId={writes.documentId}
                onMessage={writes.onMessage}
              />
            </div>
          ))}
          </Fragment>
        ))}
        {/* The playhead while playing; while stopped, where Play will start. */}
        <span
          data-playhead={props.playhead ?? props.start}
          style={{
            position: 'absolute',
            left: (props.playhead ?? props.start) * pxPerBeat,
            top: 0,
            bottom: 0,
            width: 1,
            background: props.playhead === null ? themeVars.semantic.warning : themeVars.content.primary,
            pointerEvents: 'none',
          }}
        />
      </div>
    </div>
  );
}

function ClipBlock(props: {
  readonly clip: PieceClip;
  /** Where it is drawn: its own place, or where a gesture is taking it. */
  readonly time: number;
  readonly duration: number;
  readonly color: string;
  readonly pxPerBeat: number;
  readonly selected: boolean;
  readonly onMoveStart: (event: ReactPointerEvent) => void;
  readonly onResizeStart: (event: ReactPointerEvent) => void;
}) {
  const { clip, color, pxPerBeat } = props;
  const pitches = clip.notes.map((note) => note.pitch);
  const low = Math.min(...pitches, 60);
  const high = Math.max(...pitches, low + 11);
  const inner = LANE_H - 16;
  return (
    <div
      data-clip={clip.id}
      onPointerDown={props.onMoveStart}
      style={{
        position: 'absolute',
        left: props.time * pxPerBeat,
        width: Math.max(4, props.duration * pxPerBeat - 1),
        top: 3,
        height: LANE_H - 6,
        background: `${color}33`,
        border: `1px solid ${props.selected ? themeVars.content.primary : color}`,
        borderRadius: 3,
        overflow: 'hidden',
        cursor: 'grab',
        touchAction: 'none',
      }}
      title={clip.name ?? undefined}
    >
      <div style={{ fontSize: 9, padding: '0 3px', color, whiteSpace: 'nowrap' }}>{clip.name ?? ''}</div>
      {clip.notes.map((note) => (
        <span
          key={note.id}
          style={{
            position: 'absolute',
            left: note.time * pxPerBeat,
            width: Math.max(1, note.duration * pxPerBeat - 1),
            top: 12 + inner - ((note.pitch - low) / Math.max(1, high - low)) * inner,
            height: 2,
            background: color,
          }}
        />
      ))}
      <div
        data-clip-end={clip.id}
        onPointerDown={props.onResizeStart}
        title="Drag to resize (whole bars)"
        style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 6, cursor: 'ew-resize' }}
      />
    </div>
  );
}
