/**
 * THE MIXER, laid out as Bitwig Studio's Mix view: one strip per channel, instrument tracks
 * first, then the effect buses, then the master at the right. A strip is its channel's controls
 * and nothing else: the fader (`volume`, dB), pan, mute and solo, and a level per send.
 *
 * Every control writes the literal on the element that owns it (`<Channel volume={-6}>`,
 * `<Send to="Hall" level={-12}>`), in the piece's own source, as one undoable edit; the
 * re-mounted piece sets the preview's levels in place (`LiveMix.apply`), so the change is heard as
 * it lands, reverb tails and all. A channel or send that the source generates, or whose value is
 * computed, refuses with the reason. "+ Send" on an instrument strip adds a send at −12 dB to an
 * effect bus it does not feed yet.
 */

import type { Piece, PieceChannel, PieceSend, PieceTrack } from '@volter/dawproject/piece';
import { themeVars } from '@volter/editor-sdk/widgets';
import { type CSSProperties, type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import { createElement, type Literal, setProps, setRefusal, type SourceIndex } from './source-index';

const STRIP_W = 84;
const FADER_H = 120;
const MIN_DB = -60;
const MAX_DB = 6;

const small: CSSProperties = { fontSize: 10, color: themeVars.content.muted };
const mono: CSSProperties = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };

/** Fader travel (0…1) ↔ dB on a cubic gain taper: 0 dB sits at about four fifths of the travel. */
function travelOf(db: number): number {
  if (db <= MIN_DB) return 0;
  return Math.min(1, Math.cbrt(10 ** (db / 20) / 2));
}
function dbOf(travel: number): number {
  if (travel <= 0) return MIN_DB;
  const db = 20 * Math.log10(2 * travel ** 3);
  return Math.max(MIN_DB, Math.min(MAX_DB, Math.round(db * 10) / 10));
}
/** The value as written: the fader's bottom writes −60 dB, so it says −60, not −inf. */
function formatDb(db: number): string {
  return `${db > 0 ? '+' : ''}${Number.isInteger(db) ? db : db.toFixed(1)}`;
}

interface Resource {
  readonly file: string;
  readonly documentId: string | null;
}

/**
 * A control that is dragged: the value follows the pointer while it is down and is written once,
 * on release. The gesture lives in a ref so a press, moves and release arriving in one task are
 * all seen (the piano roll's reason). A write that is refused or fails (`onCommit` answers false)
 * returns the control to the source's value; a write that lands is shown by the new piece.
 */
function useDragValue(
  value: number,
  toValue: (start: number, dx: number, dy: number) => number,
  onCommit: (value: number) => Promise<boolean>,
): {
  readonly shown: number;
  readonly handlers: {
    onPointerDown: (event: ReactPointerEvent) => void;
    onPointerMove: (event: ReactPointerEvent) => void;
    onPointerUp: () => void;
  };
} {
  const drag = useRef<{ x: number; y: number; start: number; value: number } | null>(null);
  const [shown, setShown] = useState<number | null>(null);
  // A new piece (the write landed) is the truth again.
  useEffect(() => setShown(null), [value]);
  return {
    shown: shown ?? value,
    handlers: {
      onPointerDown: (event) => {
        (event.currentTarget as Element).setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, y: event.clientY, start: value, value };
        setShown(value);
      },
      onPointerMove: (event) => {
        const current = drag.current;
        if (!current) return;
        const next = toValue(current.start, event.clientX - current.x, event.clientY - current.y);
        if (next === current.value) return;
        drag.current = { ...current, value: next };
        setShown(next);
      },
      onPointerUp: () => {
        const current = drag.current;
        drag.current = null;
        if (!current || current.value === current.start) {
          setShown(null);
          return;
        }
        void onCommit(current.value).then((written) => {
          if (!written) setShown(null);
        });
      },
    },
  };
}

export function Mixer(props: {
  readonly piece: Piece;
  readonly index: SourceIndex;
  readonly colorOf: (track: PieceTrack) => string;
  readonly resource: Resource;
  readonly onMessage: (message: string | null) => void;
}) {
  const { piece } = props;
  const order = (track: PieceTrack): number => ({ regular: 0, effect: 1, master: 2 })[track.channel?.role ?? 'regular'];
  const strips = piece.tracks.filter((track) => track.channel).sort((a, b) => order(a) - order(b));
  return (
    <div tabIndex={-1} style={{ outline: 'none', display: 'flex', height: '100%', overflowX: 'auto', background: themeVars.surface.panel }}>
      {strips.map((track) => (
        <Strip key={track.id} track={track} channel={track.channel!} {...props} />
      ))}
    </div>
  );
}

function Strip(props: {
  readonly piece: Piece;
  readonly track: PieceTrack;
  readonly channel: PieceChannel;
  readonly index: SourceIndex;
  readonly colorOf: (track: PieceTrack) => string;
  readonly resource: Resource;
  readonly onMessage: (message: string | null) => void;
}) {
  const { piece, track, channel, index } = props;
  const count = channel.oid ? (piece.oidCounts.get(channel.oid) ?? 0) : 0;
  const refusal = (prop: string): string | null => setRefusal(index, channel.oid, prop, count);
  /** Write one prop; answers whether the write landed. */
  const set = (label: string, prop: string, value: Literal | null): Promise<boolean> => {
    const why = refusal(prop);
    if (why || !channel.oid) {
      props.onMessage(why);
      return Promise.resolve(false);
    }
    props.onMessage(null);
    return setProps(label, index, channel.oid, { [prop]: value }, props.resource).then(
      () => true,
      (error: unknown) => {
        props.onMessage(error instanceof Error ? error.message : String(error));
        return false;
      },
    );
  };
  const fader = useDragValue(
    channel.volume,
    (start, _dx, dy) => dbOf(travelOf(start) - dy / FADER_H),
    (db) => set('Set Volume', 'volume', db),
  );
  const pan = useDragValue(
    channel.pan,
    (start, dx) => Math.max(-1, Math.min(1, Math.round((start + dx / 60) * 100) / 100)),
    (value) => set('Set Pan', 'pan', value),
  );
  // The first effect bus this strip does not send to yet: where "+ Send" goes.
  const freeBus = piece.tracks.find((candidate) => candidate.channel?.role === 'effect' && !channel.sends.some((send) => send.to === candidate.name));
  const addSend = (event: { readonly currentTarget: Element }): void => {
    if (!freeBus) return;
    // The button goes once the strip feeds every bus: focus moves to the mixer first, or it would
    // fall to the page and the workbench's Undo would no longer know which document it is in.
    (event.currentTarget.closest('[tabindex]') as HTMLElement | null)?.focus({ preventScroll: true });
    const own = (oid: string | null | undefined): oid is string => !!oid && (piece.oidCounts.get(oid) ?? 0) === 1;
    const last = channel.sends.at(-1);
    if (!own(channel.oid) || (last && !own(last.oid))) {
      props.onMessage(`${track.name}'s channel is generated, so a send has no single place to go.`);
      return;
    }
    const snippet = `<Send to=${JSON.stringify(freeBus.name)} level={-12} />`;
    props.onMessage(null);
    const where = { index, pieceFile: props.resource.file, documentId: props.resource.documentId };
    const label = `Add Send to ${freeBus.name}`;
    (last?.oid ? createElement(label, last.oid, 'after', snippet, where, props.onMessage) : createElement(label, channel.oid, 'child', snippet, where, props.onMessage)).catch(
      (error: unknown) => props.onMessage(error instanceof Error ? error.message : String(error)),
    );
  };
  const color = props.colorOf(track);
  const volumeRefusal = refusal('volume');
  const panRefusal = refusal('pan');
  const toggle = (prop: 'mute' | 'solo', on: boolean): Promise<boolean> =>
    // Off is the default: taking the attribute off says it, rather than writing `mute={false}`.
    set(on ? `${prop === 'mute' ? 'Mute' : 'Solo'} ${track.name}` : `Un${prop} ${track.name}`, prop, on ? true : null);
  const button = (on: boolean, tone: string): CSSProperties => ({
    flex: 1,
    fontSize: 10,
    padding: '1px 0',
    borderRadius: 2,
    cursor: 'pointer',
    border: `1px solid ${themeVars.boundary.default}`,
    background: on ? tone : themeVars.surface.raised,
    color: on ? themeVars.surface.panel : themeVars.content.primary,
  });
  return (
    <div
      data-strip={track.name}
      style={{ width: STRIP_W, flex: 'none', display: 'flex', flexDirection: 'column', gap: 4, padding: 6, borderRight: `1px solid ${themeVars.boundary.default}` }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ width: 4, height: 14, background: color, borderRadius: 2 }} />
        <span style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={track.name}>
          {track.name}
        </span>
      </div>
      <div style={small}>{channel.role === 'regular' ? '' : channel.role}</div>
      {channel.sends.map((send) => (
        <SendControl key={`${send.to}:${send.pre}`} send={send} {...props} />
      ))}
      {channel.role === 'regular' && freeBus ? (
        <button type="button" data-control="add-send" onClick={addSend} title={`Send to ${freeBus.name}`} style={{ ...button(false, ''), flex: 'none' }}>
          + Send
        </button>
      ) : null}
      <div
        data-control="pan"
        {...pan.handlers}
        onDoubleClick={() => void set('Set Pan', 'pan', null)}
        title={panRefusal ?? `pan ${pan.shown}`}
        style={{ position: 'relative', height: 10, background: themeVars.surface.inset, borderRadius: 2, cursor: panRefusal ? 'not-allowed' : 'ew-resize' }}
      >
        <span style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: themeVars.boundary.default }} />
        <span
          style={{
            position: 'absolute',
            top: 1,
            bottom: 1,
            left: `${50 + Math.min(0, pan.shown) * 50}%`,
            width: `${Math.abs(pan.shown) * 50}%`,
            background: color,
            opacity: panRefusal ? 0.4 : 1,
          }}
        />
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
        <div
          data-control="volume"
          {...fader.handlers}
          onDoubleClick={() => void set('Set Volume', 'volume', null)}
          title={volumeRefusal ?? `${formatDb(fader.shown)} dB`}
          style={{ position: 'relative', width: 14, height: FADER_H, background: themeVars.surface.inset, borderRadius: 2, cursor: volumeRefusal ? 'not-allowed' : 'ns-resize' }}
        >
          <span style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: travelOf(fader.shown) * FADER_H, background: color, opacity: volumeRefusal ? 0.4 : 0.8, borderRadius: 2 }} />
          <span style={{ position: 'absolute', left: -2, right: -2, bottom: travelOf(0) * FADER_H, height: 1, background: themeVars.content.muted }} />
        </div>
        <div style={{ ...small, ...mono, color: themeVars.content.primary }}>{formatDb(fader.shown)}</div>
      </div>
      <div style={{ display: 'flex', gap: 3 }}>
        <button type="button" data-control="mute" style={button(channel.mute, themeVars.semantic.warning)} onClick={() => void toggle('mute', !channel.mute)}>
          M
        </button>
        {channel.role === 'regular' ? (
          <button type="button" data-control="solo" style={button(channel.solo, themeVars.semantic.success)} onClick={() => void toggle('solo', !channel.solo)}>
            S
          </button>
        ) : null}
      </div>
      <div style={{ ...small, overflow: 'hidden' }} title={channel.devices.map((device) => device.name ?? device.plugin).join(' → ')}>
        {channel.devices.map((device) => device.name ?? device.plugin).join(' → ')}
      </div>
    </div>
  );
}

function SendControl(props: {
  readonly piece: Piece;
  readonly send: PieceSend;
  readonly index: SourceIndex;
  readonly resource: Resource;
  readonly onMessage: (message: string | null) => void;
}) {
  const { piece, send, index } = props;
  const count = send.oid ? (piece.oidCounts.get(send.oid) ?? 0) : 0;
  const refusal = setRefusal(index, send.oid, 'level', count);
  const level = useDragValue(
    send.level,
    (start, dx) => dbOf(travelOf(start) + dx / STRIP_W),
    (db) => {
      if (refusal || !send.oid) {
        props.onMessage(refusal);
        return Promise.resolve(false);
      }
      return setProps(`Set Send to ${send.to}`, index, send.oid, { level: db }, props.resource).then(
        () => true,
        (error: unknown) => {
          props.onMessage(error instanceof Error ? error.message : String(error));
          return false;
        },
      );
    },
  );
  return (
    <div
      data-control={`send:${send.to}`}
      {...level.handlers}
      title={refusal ?? `send to ${send.to}${send.pre ? ' (pre-fader)' : ''}: ${formatDb(level.shown)} dB`}
      style={{ position: 'relative', height: 14, background: themeVars.surface.inset, borderRadius: 2, cursor: refusal ? 'not-allowed' : 'ew-resize' }}
    >
      <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${travelOf(level.shown) * 100}%`, background: themeVars.content.muted, opacity: 0.35 }} />
      <span style={{ position: 'absolute', left: 3, top: 1, ...small, color: themeVars.content.primary }}>
        {send.to} {formatDb(level.shown)}
      </span>
    </div>
  );
}
