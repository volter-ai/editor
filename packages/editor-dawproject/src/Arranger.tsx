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
 *
 * A gesture that rewrites several elements (a clip and its notes) is ONE whole-file edit and ONE
 * undo entry, built from the source's own tree (`source-notes.ts`); when any element it must
 * rewrite is generated, the whole gesture refuses with the reason and nothing is written.
 */

import { beatAt, formatAt } from '@volter/dawproject/notation';
import type { Piece, PieceClip, PieceTrack } from '@volter/dawproject/piece';
import { themeVars } from '@volter/editor-sdk/widgets';
import { type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import type { EngineState } from './preview-engine';
import { applySource, readSource, recordStructWrite, setProps, setRefusal, type SourceIndex, writeStruct } from './source-index';
import { applyEdits, elementAt, indentOf, literalProp, parseSource, shiftClipEdits, SourceRefusal, type SourceElement } from './source-notes';

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
    (after ? writeStruct(after, 'create-sibling', snippet) : writeStruct(track.oid, 'create', snippet)).then(
      (write) => {
        if (write) recordStructWrite('Add Clip', write, { index: writes.index, pieceFile: writes.file, documentId: writes.documentId }, writes.onMessage);
      },
      say,
    );
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
      deleteClip();
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
      <div style={{ position: 'relative', width }} onPointerMove={moveClip} onPointerUp={endClip}>
        <div style={{ height: RULER_H, position: 'relative', borderBottom: `1px solid ${themeVars.boundary.default}` }}>
          {Array.from({ length: bars }, (_, bar) => (
            <span key={bar} style={{ position: 'absolute', left: bar * barPx + 3, top: 4, ...small, ...mono }}>
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
          <div
            key={track.id}
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
