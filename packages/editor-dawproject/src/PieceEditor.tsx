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

import type { Piece, PieceClip, PieceNote, PieceTrack } from '@volter/dawproject/piece';
import type { ToolNotice } from '@volter/editor-sdk/contributions';
import { themeVars } from '@volter/editor-sdk/widgets';
import { type CSSProperties, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLivePiece } from './live-piece';
import { type EngineState, PreviewEngine, trackVoices } from './preview-engine';
import { propRefusal, readSourceIndex, type SourceIndex, writeProps } from './source-index';

const HEADER_W = 190;
const LANE_H = 44;
const RULER_H = 22;
const MARKER_H = 18;
const KEY_W = 44;
const ROW_H = 12;
const SNAP = 0.25;
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
}: {
  readonly file: string;
  readonly active: boolean;
  readonly notify?: (notice: ToolNotice) => () => void;
  readonly publishContext?: (context: unknown) => () => void;
}) {
  const live = useLivePiece(file);
  const piece = live.piece;
  const [index, setIndex] = useState<SourceIndex>(new Map());
  const [selectedClip, setSelectedClip] = useState<string | null>(null);
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

  const beatsPerBar = piece.transport.numerator;
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
      <div style={{ flex: '1 1 50%', minHeight: 160, overflow: 'auto' }}>
        {clip ? (
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
      <span style={{ ...mono, minWidth: 48 }}>{playhead === null ? '1.1' : barBeat(playhead, piece.transport.numerator)}</span>
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
  const beatsPerBar = piece.transport.numerator;
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
  const scroller = useRef<HTMLDivElement | null>(null);
  const pitches = clip.notes.map((note) => note.pitch);
  const high = Math.min(127, Math.max(...pitches, 72) + 5);
  const low = Math.max(0, Math.min(...pitches, 48) - 5);
  const rows = high - low + 1;
  const width = Math.max(clip.duration, 4) * pxPerBeat;
  const beatsPerBar = piece.transport.numerator;

  // A source write lands as a re-mount; drop optimistic positions once the piece moves on.
  useEffect(() => setPending(new Map()), [clip]);

  const refusalFor = (note: PieceNote, prop: string): string | null =>
    propRefusal(index, note.oid, prop, note.oid ? (piece.oidCounts.get(note.oid) ?? 0) : 0);

  const onPointerDown = (note: PieceNote, event: ReactPointerEvent): void => {
    const refusal = refusalFor(note, 'time') ?? refusalFor(note, 'pitch');
    if (refusal) {
      props.onMessage(refusal);
      return;
    }
    (event.target as Element).setPointerCapture(event.pointerId);
    props.onMessage(null);
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
    if (time === note.time && pitch === note.pitch || !note.oid) return;
    const props_: Record<string, number> = {};
    if (time !== note.time) props_['time'] = time;
    if (pitch !== note.pitch) props_['pitch'] = pitch;
    setPending((prev) => new Map(prev).set(note.id, { time, pitch }));
    writeProps(note.oid, props_).then(
      () => undefined,
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '3px 10px', ...small, borderBottom: `1px solid ${themeVars.boundary.default}` }}>
        <span style={{ color }}>{props.trackName}</span> · {clip.name ?? 'clip'} · bar {Math.floor(clip.time / beatsPerBar) + 1} · {clip.notes.length} notes
      </div>
      <div ref={scroller} style={{ display: 'flex', flex: 1, overflow: 'auto' }}>
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
          style={{ position: 'relative', width, height: rows * ROW_H, flex: 'none' }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {Array.from({ length: rows }, (_, row) => {
            const pitch = high - row;
            const black = [1, 3, 6, 8, 10].includes(pitch % 12);
            return <div key={pitch} style={{ position: 'absolute', left: 0, right: 0, top: row * ROW_H, height: ROW_H, background: black ? themeVars.surface.inset : 'transparent', opacity: 0.6 }} />;
          })}
          {Array.from({ length: Math.ceil(Math.max(clip.duration, 4)) + 1 }, (_, beat) => (
            <span key={beat} style={{ position: 'absolute', left: beat * pxPerBeat, top: 0, bottom: 0, width: 1, background: themeVars.boundary.default, opacity: beat % beatsPerBar === 0 ? 0.9 : 0.3 }} />
          ))}
          {clip.notes.map((note) => {
            const moving = drag?.note.id === note.id ? drag : null;
            const shown = moving ?? pending.get(note.id) ?? note;
            const refusal = refusalFor(note, 'time') ?? refusalFor(note, 'pitch');
            return (
              <div
                key={note.id}
                onPointerDown={(event) => onPointerDown(note, event)}
                title={refusal ?? `${noteName(note.pitch)} · beat ${note.time} · ${note.duration} beats · vel ${note.vel}`}
                style={{
                  position: 'absolute',
                  left: shown.time * pxPerBeat,
                  width: Math.max(3, note.duration * pxPerBeat - 1),
                  top: (high - shown.pitch) * ROW_H + 1,
                  height: ROW_H - 2,
                  background: refusal ? 'transparent' : color,
                  opacity: refusal ? 0.75 : 0.35 + 0.65 * note.vel,
                  border: refusal ? `1px dashed ${color}` : `1px solid ${themeVars.surface.panel}`,
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
    </div>
  );
}
