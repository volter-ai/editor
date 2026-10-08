/**
 * THE CHANNEL'S MODULATORS, beside its device chain as Bitwig shows them: a card per `<Lfo>`,
 * with its target (the strip's volume, pan or one of its sends), shape, period, depth and phase.
 * Each field writes the `<Lfo>`'s own literal, one undo entry; "+ LFO" adds one on the volume.
 */

import type { Piece, PieceLfo, PieceTrack } from '@volter/dawproject/piece';
import { themeVars } from '@volter/sdk/widgets';
import { type CSSProperties, type ReactNode, useEffect, useState } from 'react';
import { createElement, type Literal, setProps, setRefusal, type SourceIndex } from './source-index';

const small: CSSProperties = { fontSize: 10, color: themeVars.content.muted };
const field: CSSProperties = {
  fontSize: 11,
  width: 56,
  background: themeVars.surface.inset,
  color: themeVars.content.primary,
  border: `1px solid ${themeVars.boundary.default}`,
  borderRadius: 2,
};

interface Context {
  readonly piece: Piece;
  readonly index: SourceIndex;
  readonly resource: { readonly file: string; readonly documentId: string | null };
  readonly onMessage: (message: string | null) => void;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The modulator cards of a track's channel, and the button that adds one. */
export function Modulators(props: Context & { readonly track: PieceTrack }) {
  const channel = props.track.channel;
  if (!channel || channel.role === 'master') return null;
  const own = (oid: string | null | undefined): oid is string => !!oid && (props.piece.oidCounts.get(oid) ?? 0) === 1;
  const addLfo = (event: { readonly currentTarget: Element }): void => {
    (event.currentTarget.closest('[tabindex]') as HTMLElement | null)?.focus({ preventScroll: true });
    // After the channel's last modulator, else its last send or device, else inside it.
    const after = channel.lfos.at(-1)?.oid ?? channel.sends.at(-1)?.oid ?? channel.devices.at(-1)?.oid ?? null;
    if (!own(channel.oid) || (after !== null && !own(after))) {
      props.onMessage(`${props.track.name}'s channel is generated, so a modulator has no single place to go.`);
      return;
    }
    const snippet = '<Lfo target="volume" shape="sine" period="w" depth={3} />';
    props.onMessage(null);
    const where = { index: props.index, pieceFile: props.resource.file, documentId: props.resource.documentId };
    (after ? createElement('Add LFO', after, 'after', snippet, where, props.onMessage) : createElement('Add LFO', channel.oid, 'child', snippet, where, props.onMessage)).catch(
      (error: unknown) => props.onMessage(messageOf(error)),
    );
  };
  return (
    <>
      {channel.lfos.map((lfo, index) => (
        <LfoCard key={lfo.oid ?? index} {...props} lfo={lfo} />
      ))}
      <button
        type="button"
        data-control="add-lfo"
        onClick={addLfo}
        title="Add an LFO on this channel's volume"
        style={{ ...small, background: themeVars.surface.raised, color: themeVars.content.primary, border: `1px solid ${themeVars.boundary.default}`, borderRadius: 3, cursor: 'pointer' }}
      >
        + LFO
      </button>
    </>
  );
}

function LfoCard(props: Context & { readonly lfo: PieceLfo; readonly track: PieceTrack }) {
  const { lfo, piece, index } = props;
  const count = lfo.oid ? (piece.oidCounts.get(lfo.oid) ?? 0) : 0;
  const write = (label: string, prop: string, value: Literal): void => {
    const why = setRefusal(index, lfo.oid, prop, count);
    if (why || !lfo.oid) {
      props.onMessage(why);
      return;
    }
    props.onMessage(null);
    setProps(label, index, lfo.oid, { [prop]: value }, props.resource).catch((error: unknown) => props.onMessage(messageOf(error)));
  };
  const targets = ['volume', 'pan', ...(props.track.channel?.sends ?? []).map((send) => `send:${send.to}`)];
  const unit = lfo.target === 'pan' ? '' : 'dB';
  return (
    <div
      data-lfo={lfo.target}
      style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 6, minWidth: 130, border: `1px solid ${themeVars.boundary.default}`, borderRadius: 4, background: themeVars.surface.raised }}
    >
      <div style={{ fontSize: 11, color: themeVars.content.primary }}>LFO</div>
      <Row label="target">
        <select data-lfo-field="target" value={lfo.target} onChange={(event) => write('Set LFO target', 'target', event.currentTarget.value)} style={field}>
          {(targets.includes(lfo.target) ? targets : [lfo.target, ...targets]).map((target) => (
            <option key={target} value={target}>
              {target}
            </option>
          ))}
        </select>
      </Row>
      <Row label="shape">
        <select data-lfo-field="shape" value={lfo.shape} onChange={(event) => write('Set LFO shape', 'shape', event.currentTarget.value)} style={field}>
          {['sine', 'triangle', 'square', 'saw'].map((shape) => (
            <option key={shape} value={shape}>
              {shape}
            </option>
          ))}
        </select>
      </Row>
      <Row label="period">
        <TextField
          name="period"
          value={lfo.writtenPeriod}
          onCommit={(text) => {
            const number = Number(text);
            write('Set LFO period', 'period', text.trim() !== '' && Number.isFinite(number) ? number : text.trim());
          }}
        />
      </Row>
      <Row label={`depth ${unit}`}>
        <TextField name="depth" value={String(lfo.depth)} onCommit={(text) => numberOr(text, props.onMessage, (value) => write('Set LFO depth', 'depth', value))} />
      </Row>
      <Row label="phase">
        <TextField name="phase" value={String(lfo.phase)} onCommit={(text) => numberOr(text, props.onMessage, (value) => write('Set LFO phase', 'phase', value))} />
      </Row>
    </div>
  );
}

function numberOr(text: string, onMessage: (message: string | null) => void, then: (value: number) => void): void {
  const value = Number(text);
  if (text.trim() === '' || !Number.isFinite(value)) onMessage(`"${text}" is not a number.`);
  else then(value);
}

function Row(props: { readonly label: string; readonly children: ReactNode }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
      <span style={small}>{props.label}</span>
      {props.children}
    </label>
  );
}

/** A field that writes on Enter (focus back to the panel, so Undo reaches the edit) or on blur. */
function TextField(props: { readonly name: string; readonly value: string; readonly onCommit: (text: string) => void }) {
  const [text, setText] = useState(props.value);
  useEffect(() => setText(props.value), [props.value]);
  return (
    <input
      data-lfo-field={props.name}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setText(props.value);
        if (event.key !== 'Enter') return;
        (event.currentTarget.closest('[tabindex]') as HTMLElement | null)?.focus({ preventScroll: true });
      }}
      onBlur={() => {
        if (text !== props.value) props.onCommit(text);
      }}
      style={field}
    />
  );
}
