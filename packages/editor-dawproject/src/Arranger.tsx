/**
 * THE ARRANGE VIEW's upper half, as Bitwig Studio lays it out: the transport bar (play / stop,
 * tempo, meter, the playhead's bar.beat, zoom) and the arranger (track headers beside the
 * timeline: bar ruler, markers, one lane of clips per track).
 */

import type { Piece, PieceClip, PieceTrack } from '@volter/dawproject/piece';
import { themeVars } from '@volter/editor-sdk/widgets';
import type { CSSProperties } from 'react';
import type { EngineState } from './preview-engine';

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

export function Arranger(props: {
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
