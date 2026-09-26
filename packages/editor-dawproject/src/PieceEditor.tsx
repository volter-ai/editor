/**
 * THE PIECE DOCUMENT's surface, laid out the way Bitwig Studio lays out its Arrange view:
 *
 *   transport bar      play / stop, tempo, meter, the playhead's bar.beat
 *   arranger           track headers (name, mute, solo, volume) beside the timeline:
 *                      bar ruler, markers, one lane of clips per track
 *   detail editor      the selected clip's notes on a piano roll
 *
 * Everything drawn is the LIVE piece (`live-piece.ts`): the module mounted and re-mounted on
 * every save, so the agent writing the piece is watched section by section as it lands. Every
 * gesture writes the element it touched in the piece's own source (`source-index.ts`); a note
 * whose prop is computed, or which one source element renders many times, is drawn as a ghost
 * and refuses with the reason and the line that makes it.
 */

import { formatAt, formatDuration, formatPitch, spelledFlat } from '@volter/dawproject/notation';
import type { Piece, PieceClip, PieceNote, PieceTrack } from '@volter/dawproject/piece';
import type { ToolNotice } from '@volter/editor-sdk/contributions';
import { editorHost } from '@volter/editor-sdk/host';
import { themeVars } from '@volter/editor-sdk/widgets';
import { type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLivePiece } from './live-piece';
import { Mixer } from './Mixer';
import { type EngineState, PreviewEngine, trackVoices } from './preview-engine';
import { projectPath, propRefusal, readSourceIndex, type SourceIndex, type StructWrite, writeProps, writeStruct } from './source-index';

const HEADER_W = 190;
const LANE_H = 44;
const RULER_H = 22;
const MARKER_H = 18;
const KEY_W = 44;
const ROW_H = 12;
const SNAP = 0.25;
const VEL_H = 56;
const TRACK_COLORS = ['#e8a33d', '#5aa9e6', '#8bc34a', '#e5637a', '#b388eb', '#4dd0c7', '#f2cc5c', '#9e9e9e'];
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

function trackColor(track: PieceTrack, index: number): string {
  return track.color ?? TRACK_COLORS[index % TRACK_COLORS.length] ?? '#9e9e9e';
}

function barBeat(beat: number, numerator: number): string {
  const bar = Math.floor(beat / numerator) + 1;
  const inBar = Math.floor(beat % numerator) + 1;
  return `${bar}.${inBar}`;
}

function snap(value: number): number {
  return Math.round(value / SNAP) * SNAP;
}

/**
 * What this document publishes for the agent's REPL (`vgai eval` → `editor.document.run`): the
 * piece as it currently renders and the transport. Getters, so a step always reads the live value.
 */
export interface PieceDocumentContext {
  readonly file: string;
  readonly piece: Piece | null;
  readonly error: string | null;
  readonly engine: EngineState;
  readonly playhead: number | null;
  play(fromBeat?: number): Promise<void>;
  stop(): void;
}

export function PieceEditor({
  file,
  active,
  notify,
  publishContext,
  documentId = null,
}: {
  readonly file: string;
  readonly active: boolean;
  readonly documentId?: string | null;
  readonly notify?: (notice: ToolNotice) => () => void;
  readonly publishContext?: (context: unknown) => () => void;
}) {
  const live = useLivePiece(file);
  const piece = live.piece;
  const [index, setIndex] = useState<SourceIndex>(new Map());
  const [selectedClip, setSelectedClip] = useState<string | null>(null);
  // The lower pane, as Bitwig's: the selected clip's editor, or the mixer.
  const [lower, setLower] = useState<'clip' | 'mix'>('clip');
  // Refusals and failed writes are events: they go to the host's notification cards, never into
  // this document's own chrome (ARCHITECTURE-CORE §Editor chrome, "Notices take VS Code's shape").
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const setMessage = useCallback((text: string | null, tone: ToolNotice['tone'] = 'warning') => {
    if (text) notifyRef.current?.({ tone, title: text });
  }, []);
  const [engineState, setEngineState] = useState<EngineState>({ kind: 'idle' });
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [pxPerBeat, setPxPerBeat] = useState(28);
  const engine = useMemo(() => new PreviewEngine(), []);
  const liveRef = useRef({ live });

  useEffect(() => {
    if (!publishContext) return;
    const context: PieceDocumentContext = {
      file,
      get piece() {
        return liveRef.current.live.piece;
      },
      get error() {
        return liveRef.current.live.error;
      },
      get engine() {
        return engine.current;
      },
      get playhead() {
        return engine.playhead();
      },
      play: (fromBeat = 0) => engine.play(fromBeat),
      stop: () => engine.stop(),
    };
    return publishContext(context);
  }, [publishContext, engine, file]);

  liveRef.current = { live };
  useEffect(() => engine.subscribe(setEngineState), [engine]);
  useEffect(() => () => engine.dispose(), [engine]);
  useEffect(() => {
    if (piece) engine.update(piece);
  }, [engine, piece]);
  useEffect(() => {
    if (!active) engine.stop();
  }, [active, engine]);

  // The source index follows the piece: every re-mount is a source change it must reflect.
  useEffect(() => {
    let cancelled = false;
    readSourceIndex().then(
      (next) => !cancelled && setIndex(next),
      (error: unknown) => !cancelled && setMessage(error instanceof Error ? error.message : String(error)),
    );
    return () => {
      cancelled = true;
    };
  }, [live.revision]);

  useEffect(() => {
    if (engineState.kind !== 'playing') {
      setPlayhead(null);
      return;
    }
    let frame = 0;
    const loop = (): void => {
      setPlayhead(engine.playhead());
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [engine, engineState.kind]);

  const togglePlay = useCallback(() => {
    if (engineState.kind === 'playing') engine.stop();
    else void engine.play(0);
  }, [engine, engineState.kind]);

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.isContentEditable)) return;
      if (event.code === 'Space') {
        event.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, togglePlay]);

  const clip = useMemo(() => {
    if (!piece) return null;
    for (const [trackIndex, track] of piece.tracks.entries()) {
      for (const candidate of track.clips) {
        if (candidate.id === selectedClip) return { clip: candidate, track, trackIndex };
      }
    }
    const firstTrack = piece.tracks.findIndex((track) => track.clips.length > 0);
    const track = piece.tracks[firstTrack];
    const first = track?.clips[0];
    return track && first ? { clip: first, track, trackIndex: firstTrack } : null;
  }, [piece, selectedClip]);

  if (!piece) {
    return (
      <div style={{ padding: 16, ...small }}>
        {live.error ? <span style={{ color: themeVars.semantic.danger }}>{live.error}</span> : `Mounting ${file}…`}
      </div>
    );
  }

  const beatsPerBar = piece.transport.beatsPerBar;
  const totalBeats = Math.max(piece.length, beatsPerBar * 8) + beatsPerBar * 2;
  const voices = trackVoices(piece);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: themeVars.surface.panel, color: themeVars.content.primary, fontSize: 12 }}>
      <TransportBar
        piece={piece}
        playing={engineState.kind === 'playing'}
        engineState={engineState}
        playhead={playhead}
        onToggle={togglePlay}
        pxPerBeat={pxPerBeat}
        onZoom={setPxPerBeat}
      />
      {live.error ? (
        <div style={{ padding: '4px 10px', color: themeVars.semantic.danger, borderBottom: `1px solid ${themeVars.boundary.default}` }}>
          {live.error} — showing the last piece that rendered.
        </div>
      ) : null}
      <div style={{ flex: '1 1 50%', minHeight: 120, overflow: 'auto', borderBottom: `1px solid ${themeVars.boundary.default}` }}>
        <Arranger
          piece={piece}
          totalBeats={totalBeats}
          pxPerBeat={pxPerBeat}
          playhead={playhead}
          selectedClip={clip?.clip.id ?? null}
          onSelectClip={setSelectedClip}
          voiceless={new Set([...voices].filter(([, voice]) => voice === null).map(([id]) => id))}
        />
      </div>
      <div style={{ display: 'flex', gap: 2, padding: '2px 6px', borderBottom: `1px solid ${themeVars.boundary.default}` }}>
        {(['clip', 'mix'] as const).map((pane) => (
          <button
            key={pane}
            type="button"
            data-pane={pane}
            onClick={() => setLower(pane)}
            style={{ ...button, padding: '0 10px', fontSize: 11, background: lower === pane ? themeVars.surface.inset : themeVars.surface.raised }}
          >
            {pane === 'clip' ? 'Clip' : 'Mix'}
          </button>
        ))}
      </div>
      <div style={{ flex: '1 1 50%', minHeight: 160, overflow: 'auto' }}>
        {lower === 'mix' ? (
          <Mixer
            piece={piece}
            index={index}
            colorOf={(track) => trackColor(track, piece.tracks.indexOf(track))}
            resource={{ file, documentId }}
            onMessage={setMessage}
          />
        ) : clip ? (
          <PianoRoll
            key={clip.clip.id}
            clip={clip.clip}
            color={trackColor(clip.track, clip.trackIndex)}
            trackName={clip.track.name}
            piece={piece}
            index={index}
            pxPerBeat={pxPerBeat * 2}
            playhead={playhead}
            onMessage={setMessage}
            file={file}
            documentId={documentId}
            active={active}
          />
        ) : (
          <div style={{ padding: 16, ...small }}>No clips yet. Clips appear here as the piece gains them.</div>
        )}
      </div>
      <div style={{ padding: '3px 10px', borderTop: `1px solid ${themeVars.boundary.default}`, ...small, minHeight: 18 }}>
        {`${file} — ${piece.tracks.length} tracks, ${piece.tracks.reduce((n, t) => n + t.clips.reduce((m, c) => m + c.notes.length, 0), 0)} notes`}
      </div>
    </div>
  );
}

function TransportBar(props: {
  readonly piece: Piece;
  readonly playing: boolean;
  readonly engineState: EngineState;
  readonly playhead: number | null;
  readonly onToggle: () => void;
  readonly pxPerBeat: number;
  readonly onZoom: (value: number) => void;
}) {
  const { piece, playing, engineState, playhead } = props;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 10px', borderBottom: `1px solid ${themeVars.boundary.default}`, background: themeVars.surface.raised }}>
      <button type="button" style={button} onClick={props.onToggle} title="Play / Stop (Space)">
        {playing ? '■ Stop' : '▶ Play'}
      </button>
      <span style={{ ...mono, minWidth: 48 }}>{playhead === null ? '1.1' : barBeat(playhead, piece.transport.beatsPerBar)}</span>
      <span style={small}>
        {piece.transport.tempo} BPM · {piece.transport.numerator}/{piece.transport.denominator}
      </span>
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

function Arranger(props: {
  readonly piece: Piece;
  readonly totalBeats: number;
  readonly pxPerBeat: number;
  readonly playhead: number | null;
  readonly selectedClip: string | null;
  readonly onSelectClip: (id: string) => void;
  readonly voiceless: ReadonlySet<string>;
}) {
  const { piece, totalBeats, pxPerBeat } = props;
  const width = totalBeats * pxPerBeat;
  const beatsPerBar = piece.transport.beatsPerBar;
  const bars = Math.ceil(totalBeats / beatsPerBar);
  return (
    <div style={{ display: 'flex', minWidth: HEADER_W + width }}>
      <div style={{ width: HEADER_W, flex: 'none', position: 'sticky', left: 0, zIndex: 2, background: themeVars.surface.panel, borderRight: `1px solid ${themeVars.boundary.default}` }}>
        <div style={{ height: RULER_H + MARKER_H, borderBottom: `1px solid ${themeVars.boundary.default}` }} />
        {piece.tracks.map((track, index) => (
          <div key={track.id} style={{ height: LANE_H, display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px', borderBottom: `1px solid ${themeVars.boundary.default}` }}>
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
          </div>
        ))}
      </div>
      <div style={{ position: 'relative', width }}>
        <div style={{ height: RULER_H, position: 'relative', borderBottom: `1px solid ${themeVars.boundary.default}` }}>
          {Array.from({ length: bars }, (_, bar) => (
            <span key={bar} style={{ position: 'absolute', left: bar * beatsPerBar * pxPerBeat + 3, top: 4, ...small, ...mono }}>
              {bar + 1}
            </span>
          ))}
        </div>
        <div style={{ height: MARKER_H, position: 'relative', borderBottom: `1px solid ${themeVars.boundary.default}` }}>
          {piece.markers.map((marker) => (
            <span
              key={marker.id}
              style={{ position: 'absolute', left: marker.time * pxPerBeat, top: 1, padding: '0 4px', fontSize: 10, background: themeVars.surface.raised, borderLeft: `2px solid ${themeVars.semantic.warning}`, whiteSpace: 'nowrap' }}
            >
              {marker.name}
            </span>
          ))}
        </div>
        {piece.tracks.map((track, index) => (
          <div key={track.id} style={{ height: LANE_H, position: 'relative', borderBottom: `1px solid ${themeVars.boundary.default}` }}>
            {Array.from({ length: bars }, (_, bar) => (
              <span key={bar} style={{ position: 'absolute', left: bar * beatsPerBar * pxPerBeat, top: 0, bottom: 0, width: 1, background: themeVars.boundary.default, opacity: 0.35 }} />
            ))}
            {track.clips.map((clip) => (
              <ClipBlock
                key={clip.id}
                clip={clip}
                color={trackColor(track, index)}
                pxPerBeat={pxPerBeat}
                selected={clip.id === props.selectedClip}
                onSelect={() => props.onSelectClip(clip.id)}
              />
            ))}
          </div>
        ))}
        {props.playhead !== null ? (
          <span style={{ position: 'absolute', left: props.playhead * pxPerBeat, top: 0, bottom: 0, width: 1, background: themeVars.content.primary, pointerEvents: 'none' }} />
        ) : null}
      </div>
    </div>
  );
}

function ClipBlock(props: {
  readonly clip: PieceClip;
  readonly color: string;
  readonly pxPerBeat: number;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const { clip, color, pxPerBeat } = props;
  const pitches = clip.notes.map((note) => note.pitch);
  const low = Math.min(...pitches, 60);
  const high = Math.max(...pitches, low + 11);
  const inner = LANE_H - 16;
  return (
    <div
      onPointerDown={props.onSelect}
      style={{
        position: 'absolute',
        left: clip.time * pxPerBeat,
        width: Math.max(4, clip.duration * pxPerBeat - 1),
        top: 3,
        height: LANE_H - 6,
        background: `${color}33`,
        border: `1px solid ${props.selected ? themeVars.content.primary : color}`,
        borderRadius: 3,
        overflow: 'hidden',
        cursor: 'pointer',
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
    </div>
  );
}

/**
 * One entry on the workbench's undo stack for a structural write: undo puts back the whole file
 * as it was, redo the file as the write left it, each only while the file is still exactly what
 * the other left (a later edit by anyone, the agent included, makes the entry refuse rather than
 * overwrite it).
 */
function recordStructWrite(
  label: string,
  write: StructWrite,
  file: string | null,
  documentId: string | null,
  onMessage: (message: string | null) => void,
): void {
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

interface Drag {
  readonly note: PieceNote;
  readonly startX: number;
  readonly startY: number;
  readonly time: number;
  readonly pitch: number;
}

function PianoRoll(props: {
  readonly clip: PieceClip;
  readonly color: string;
  readonly trackName: string;
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
    writeProps(oid, props_).then(
      () => {
        // One entry on the workbench's one undo stack (Cmd+Z, the Edit menu): undo writes the
        // literals the note had, redo the ones the gesture wrote, through the same source route.
        editorHost().history.record({
          id: globalThis.crypto?.randomUUID?.() ?? `note-${Date.now()}`,
          label: props_['pitch'] && !props_['at'] ? 'Transpose Note' : 'Move Note',
          resources: [props.file],
          document: props.documentId,
          undo: () => writeProps(oid, before).then(() => true, () => false),
          redo: () => writeProps(oid, props_).then(() => true, () => false),
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
    writeProps(oid, { vel }).then(
      () =>
        editorHost().history.record({
          id: globalThis.crypto?.randomUUID?.() ?? `vel-${Date.now()}`,
          label: 'Set Velocity',
          resources: [props.file],
          document: props.documentId,
          undo: () => writeProps(oid, { vel: before }).then(() => true, () => false),
          redo: () => writeProps(oid, { vel }).then(() => true, () => false),
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
        if (write) recordStructWrite('Delete Note', write, projectPath(index, props.file, write.file), props.documentId, props.onMessage);
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
        if (result) recordStructWrite('Add Note', result, projectPath(index, props.file, result.file), props.documentId, props.onMessage);
      },
      (error: unknown) => props.onMessage(error instanceof Error ? error.message : String(error)),
    );
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
      </div>
      <div ref={scroller} style={{ flex: 1, overflow: 'auto' }}>
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
        <div
          style={{ display: 'flex', width: KEY_W + width, height: VEL_H, position: 'sticky', bottom: 0, zIndex: 2, background: themeVars.surface.panel, borderTop: `1px solid ${themeVars.boundary.default}` }}
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
  );
}
