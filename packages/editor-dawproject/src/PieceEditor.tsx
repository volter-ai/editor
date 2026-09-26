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

import type { Piece, PieceClip, PieceTrack } from '@volter/dawproject/piece';
import type { ToolNotice } from '@volter/editor-sdk/contributions';
import { themeVars } from '@volter/editor-sdk/widgets';
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLivePiece } from './live-piece';
import { Devices } from './Devices';
import { Mixer } from './Mixer';
import { PianoRoll } from './PianoRoll';
import { type EngineState, PreviewEngine, trackVoices } from './preview-engine';
import { readSourceIndex, type SourceIndex } from './source-index';

const HEADER_W = 190;
const LANE_H = 44;
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

function trackColor(track: PieceTrack, index: number): string {
  return track.color ?? TRACK_COLORS[index % TRACK_COLORS.length] ?? '#9e9e9e';
}

function barBeat(beat: number, numerator: number): string {
  const bar = Math.floor(beat / numerator) + 1;
  const inBar = Math.floor(beat % numerator) + 1;
  return `${bar}.${inBar}`;
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
  // The selected track (a header clicked, or the track of the clip clicked): what Devices shows.
  const [selectedTrack, setSelectedTrack] = useState<string | null>(null);
  // The lower pane, as Bitwig's: the selected clip's editor, its track's devices, or the mixer.
  const [lower, setLower] = useState<'clip' | 'devices' | 'mix'>('clip');
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
          onSelectClip={(id) => {
            setSelectedClip(id);
            setSelectedTrack(piece.tracks.find((track) => track.clips.some((candidate) => candidate.id === id))?.id ?? null);
          }}
          selectedTrack={selectedTrack ?? clip?.track.id ?? null}
          onSelectTrack={setSelectedTrack}
          voiceless={new Set([...voices].filter(([, voice]) => voice === null).map(([id]) => id))}
        />
      </div>
      <div style={{ display: 'flex', gap: 2, padding: '2px 6px', borderBottom: `1px solid ${themeVars.boundary.default}` }}>
        {(['clip', 'devices', 'mix'] as const).map((pane) => (
          <button
            key={pane}
            type="button"
            data-pane={pane}
            onClick={() => setLower(pane)}
            style={{ ...button, padding: '0 10px', fontSize: 11, background: lower === pane ? themeVars.surface.inset : themeVars.surface.raised }}
          >
            {pane === 'clip' ? 'Clip' : pane === 'devices' ? 'Devices' : 'Mix'}
          </button>
        ))}
      </div>
      <div style={{ flex: '1 1 50%', minHeight: 160, overflow: 'auto' }}>
        {lower === 'devices' ? (
          <Devices
            piece={piece}
            index={index}
            track={piece.tracks.find((track) => track.id === selectedTrack) ?? clip?.track ?? null}
            resource={{ file, documentId }}
            onMessage={setMessage}
          />
        ) : lower === 'mix' ? (
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
            clipNumber={clip.track.clips.indexOf(clip.clip) + 1}
            graph={live.graph}
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
  readonly selectedTrack: string | null;
  readonly onSelectTrack: (id: string) => void;
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
          <div
            key={track.id}
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
