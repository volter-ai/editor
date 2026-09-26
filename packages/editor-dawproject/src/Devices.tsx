/**
 * THE DEVICE CHAIN of the selected track, as Bitwig's device panel: its channel's `<Device>`s
 * left to right in signal order, each a card of its parameters.
 *
 * A parameter is a member of the device's `params={{ … }}` (`params.threshold`), written as that
 * member's literal (`@volter/editor-react`'s member writer), one undoable edit. A parameter the
 * device does not write yet shows the value the DSP uses in its absence and is added by the
 * first drag; double-click takes it out again. A member bound to an expression (`bank: BANK`)
 * is shown and refuses. Numbers are dragged sideways; switches toggle. "+ Device" appends an
 * effect to the chain, written with the values its DSP falls back to.
 */

import type { Piece, PieceDevice, PieceTrack } from '@volter/dawproject/piece';
import { themeVars } from '@volter/editor-sdk/widgets';
import { type CSSProperties, type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import { createElement, type Literal, setProps, setRefusal, type SourceIndex } from './source-index';

interface NumberSpec {
  readonly key: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  /** The value the device uses when the source does not write one. */
  readonly fallback: number;
  readonly unit?: string;
  /** Dragged on a logarithmic scale (frequencies, times). */
  readonly log?: boolean;
  readonly integer?: boolean;
}

/**
 * The parameters each device reads, with the fallbacks their readers apply: `mix/dsp.ts`
 * (`compressorParams`, `Limiter`, `biquadNode`), `mix/offline-mix.ts` (convolution),
 * `@volter/dawproject/perform` (humanize), `preview-engine.ts` (soundfont).
 */
const PARAMS: Readonly<Record<string, readonly NumberSpec[]>> = {
  soundfont: [{ key: 'program', label: 'program', min: 0, max: 127, fallback: 0, integer: true }],
  compressor: [
    { key: 'threshold', label: 'threshold', min: -60, max: 0, fallback: -18, unit: 'dB' },
    { key: 'ratio', label: 'ratio', min: 1, max: 20, fallback: 2, log: true },
    { key: 'attack', label: 'attack', min: 0.1, max: 200, fallback: 20, unit: 'ms', log: true },
    { key: 'release', label: 'release', min: 1, max: 2000, fallback: 200, unit: 'ms', log: true },
    { key: 'knee', label: 'knee', min: 0, max: 24, fallback: 6, unit: 'dB' },
    { key: 'makeup', label: 'makeup', min: 0, max: 24, fallback: 0, unit: 'dB' },
  ],
  limiter: [
    { key: 'ceiling', label: 'ceiling', min: -12, max: 0, fallback: -1, unit: 'dB' },
    { key: 'release', label: 'release', min: 1, max: 1000, fallback: 80, unit: 'ms', log: true },
  ],
  convolution: [
    { key: 'predelay', label: 'predelay', min: 0, max: 200, fallback: 0, unit: 'ms' },
    { key: 'wet', label: 'wet', min: 0, max: 1, fallback: 1 },
  ],
  humanize: [
    { key: 'timingMs', label: 'timing', min: 0, max: 50, fallback: 0, unit: 'ms' },
    { key: 'velocity', label: 'velocity', min: 0, max: 0.5, fallback: 0 },
    { key: 'seed', label: 'seed', min: 1, max: 9999, fallback: 1, integer: true },
  ],
};
/** A patch number an articulation plays on (`articulations.staccato`, …). */
const PATCH = (key: string): NumberSpec => ({ key, label: key, min: 0, max: 127, fallback: 0, integer: true });
const BAND: readonly NumberSpec[] = [
  { key: 'freq', label: 'freq', min: 20, max: 20000, fallback: 1000, unit: 'Hz', log: true },
  { key: 'gain', label: 'gain', min: -24, max: 24, fallback: 0, unit: 'dB' },
  { key: 'q', label: 'q', min: 0.1, max: 18, fallback: 0.707, log: true },
];
/** The effects "+ Device" offers, in the order a chain usually runs. */
const ADDABLE = ['equalizer', 'compressor', 'limiter', 'convolution', 'humanize'] as const;

/** A new device's `params={{ … }}`: every parameter it reads, at its fallback (an equalizer: one flat bell). */
function newDeviceParams(plugin: (typeof ADDABLE)[number]): string {
  if (plugin === 'equalizer') {
    const bell = BAND.map((spec) => `${spec.key}: ${spec.fallback}`).join(', ');
    return `{{ bands: [{ type: 'bell', ${bell} }] }}`;
  }
  return `{{ ${(PARAMS[plugin] ?? []).map((spec) => `${spec.key}: ${spec.fallback}`).join(', ')} }}`;
}

/** Pixels of drag across a parameter's whole range. */
const SWEEP = 200;

const small: CSSProperties = { fontSize: 10, color: themeVars.content.muted };
const mono: CSSProperties = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };

function toUnit(spec: NumberSpec, value: number): number {
  if (spec.log) return Math.log(Math.max(spec.min, value) / spec.min) / Math.log(spec.max / spec.min);
  return (value - spec.min) / (spec.max - spec.min);
}
function fromUnit(spec: NumberSpec, unit: number): number {
  const t = Math.max(0, Math.min(1, unit));
  const raw = spec.log ? spec.min * (spec.max / spec.min) ** t : spec.min + t * (spec.max - spec.min);
  if (spec.integer) return Math.round(raw);
  // Three significant figures: what a person can set by dragging.
  const magnitude = 10 ** (Math.floor(Math.log10(Math.max(Math.abs(raw), 1e-6))) - 2);
  return Math.round(raw / magnitude) * magnitude;
}
function show(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

interface Context {
  readonly piece: Piece;
  readonly index: SourceIndex;
  readonly resource: { readonly file: string; readonly documentId: string | null };
  readonly onMessage: (message: string | null) => void;
}

export function Devices(props: Context & { readonly track: PieceTrack | null }) {
  const devices = props.track?.channel?.devices ?? [];
  if (!props.track) return <div style={{ padding: 16, ...small }}>Select a clip to see its track's devices.</div>;
  return (
    <div tabIndex={-1} style={{ outline: 'none', display: 'flex', gap: 6, padding: 6, height: '100%', overflowX: 'auto', alignItems: 'flex-start', background: themeVars.surface.panel }}>
      <div style={{ ...small, writingMode: 'vertical-rl', transform: 'rotate(180deg)', color: themeVars.content.primary }}>{props.track.name}</div>
      {devices.length === 0 ? <div style={small}>No devices on this channel.</div> : null}
      {devices.map((device) => (
        <DeviceCard key={device.id} device={device} {...props} />
      ))}
      <select
        data-control="add-device"
        value=""
        title="Add a device at the end of the chain"
        onChange={(event) => addDevice(props, event.currentTarget.value as (typeof ADDABLE)[number])}
        style={{ ...small, background: themeVars.surface.raised, color: themeVars.content.primary, border: `1px solid ${themeVars.boundary.default}`, borderRadius: 3 }}
      >
        <option value="">+ Device</option>
        {ADDABLE.map((plugin) => (
          <option key={plugin} value={plugin}>
            {plugin}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Append `plugin` after the channel's last device (so before its sends), or into an empty channel. */
function addDevice(props: Context & { readonly track: PieceTrack | null }, plugin: (typeof ADDABLE)[number]): void {
  if (!ADDABLE.includes(plugin)) return;
  const channel = props.track?.channel;
  const own = (oid: string | null | undefined): oid is string => !!oid && (props.piece.oidCounts.get(oid) ?? 0) === 1;
  const last = channel?.devices.at(-1);
  if (!channel || !own(channel.oid) || (last && !own(last.oid))) {
    props.onMessage(`${props.track?.name ?? 'This track'}'s channel is generated or missing, so a device has no single place to go.`);
    return;
  }
  const snippet = `<Device plugin="${plugin}" params=${newDeviceParams(plugin)} />`;
  props.onMessage(null);
  const where = { index: props.index, pieceFile: props.resource.file, documentId: props.resource.documentId };
  (last?.oid ? createElement(`Add ${plugin}`, last.oid, 'after', snippet, where, props.onMessage) : createElement(`Add ${plugin}`, channel.oid, 'child', snippet, where, props.onMessage)).catch(
    (error: unknown) => props.onMessage(error instanceof Error ? error.message : String(error)),
  );
}

function DeviceCard(props: Context & { readonly device: PieceDevice }) {
  const { device } = props;
  const specs = PARAMS[device.plugin] ?? [];
  const known = new Set([...specs.map((spec) => spec.key), 'bands', 'articulations']);
  const articulations = device.params['articulations'];
  const patches = articulations && typeof articulations === 'object' && !Array.isArray(articulations) ? Object.entries(articulations) : [];
  const bands = Array.isArray(device.params['bands']) ? (device.params['bands'] as readonly Record<string, unknown>[]) : null;
  const others = Object.entries(device.params).filter(([key]) => !known.has(key));
  return (
    <div
      data-device={device.name ?? device.plugin}
      style={{ minWidth: 150, border: `1px solid ${themeVars.boundary.default}`, borderRadius: 3, background: themeVars.surface.raised }}
    >
      <div style={{ padding: '3px 6px', fontSize: 11, borderBottom: `1px solid ${themeVars.boundary.default}` }}>
        {device.name ?? device.plugin} <span style={small}>{device.name ? device.plugin : ''}</span>
      </div>
      <div style={{ padding: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {specs.map((spec) => (
          <NumberParam key={spec.key} path={`params.${spec.key}`} spec={spec} value={device.params[spec.key]} {...props} />
        ))}
        {bands?.map((band, i) => (
          // A band's shape is its `type`; the numbers below it are the band's own members.
          <div key={i} style={{ borderTop: `1px solid ${themeVars.boundary.default}`, paddingTop: 3 }}>
            <div style={small}>{String(band['type'] ?? 'band')}</div>
            {BAND.filter((spec) => spec.key !== 'gain' || ['lowShelf', 'highShelf', 'bell'].includes(String(band['type']))).map((spec) => (
              <NumberParam key={spec.key} path={`params.bands.${i}.${spec.key}`} spec={spec} value={band[spec.key]} {...props} />
            ))}
          </div>
        ))}
        {patches.length > 0 ? <div style={{ ...small, borderTop: `1px solid ${themeVars.boundary.default}`, paddingTop: 3 }}>articulation patches</div> : null}
        {patches.map(([artic, program]) => (
          <NumberParam key={artic} path={`params.articulations.${artic}`} spec={PATCH(artic)} value={program} {...props} />
        ))}
        {others.map(([key, value]) =>
          typeof value === 'boolean' ? (
            <BooleanParam key={key} path={`params.${key}`} label={key} value={value} {...props} />
          ) : (
            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, ...small }} title={`params.${key}`}>
              <span>{key}</span>
              <span style={{ ...mono, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 110 }}>{typeof value === 'string' ? value : JSON.stringify(value)}</span>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function refusalFor(props: Context & { readonly device: PieceDevice }, path: string): string | null {
  const count = props.device.oid ? (props.piece.oidCounts.get(props.device.oid) ?? 0) : 0;
  return setRefusal(props.index, props.device.oid, path, count);
}

function write(props: Context & { readonly device: PieceDevice }, label: string, path: string, value: Literal | null): void {
  const why = refusalFor(props, path);
  if (why || !props.device.oid) {
    props.onMessage(why);
    return;
  }
  props.onMessage(null);
  setProps(label, props.index, props.device.oid, { [path]: value }, props.resource).catch((error: unknown) =>
    props.onMessage(error instanceof Error ? error.message : String(error)),
  );
}

function NumberParam(props: Context & { readonly device: PieceDevice; readonly path: string; readonly spec: NumberSpec; readonly value: unknown }) {
  const { spec } = props;
  const written = typeof props.value === 'number';
  const value = written ? (props.value as number) : spec.fallback;
  const drag = useRef<{ x: number; start: number; value: number } | null>(null);
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => setShown(null), [value]);
  const why = refusalFor(props, props.path);
  const label = `Set ${props.device.name ?? props.device.plugin} ${spec.label}`;
  const onDown = (event: ReactPointerEvent): void => {
    if (why) {
      props.onMessage(why);
      return;
    }
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, start: value, value };
  };
  const onMove = (event: ReactPointerEvent): void => {
    const current = drag.current;
    if (!current) return;
    const next = fromUnit(spec, toUnit(spec, current.start) + (event.clientX - current.x) / SWEEP);
    if (next === current.value) return;
    drag.current = { ...current, value: next };
    setShown(next);
  };
  const onUp = (): void => {
    const current = drag.current;
    drag.current = null;
    if (!current || current.value === current.start) {
      setShown(null);
      return;
    }
    write(props, label, props.path, current.value);
  };
  const current = shown ?? value;
  return (
    <div
      data-param={props.path}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onDoubleClick={() => written && write(props, label, props.path, null)}
      title={why ?? `${props.path}${written ? '' : ' (not written: the device uses this value)'}`}
      style={{ position: 'relative', height: 16, borderRadius: 2, background: themeVars.surface.inset, cursor: why ? 'not-allowed' : 'ew-resize', overflow: 'hidden' }}
    >
      <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${toUnit(spec, current) * 100}%`, background: themeVars.content.muted, opacity: why ? 0.15 : 0.3 }} />
      <span style={{ position: 'absolute', left: 4, top: 1, ...small, color: themeVars.content.primary }}>{spec.label}</span>
      <span style={{ position: 'absolute', right: 4, top: 1, ...small, ...mono, color: written ? themeVars.content.primary : themeVars.content.muted }}>
        {show(current)}
        {spec.unit ? ` ${spec.unit}` : ''}
      </span>
    </div>
  );
}

function BooleanParam(props: Context & { readonly device: PieceDevice; readonly path: string; readonly label: string; readonly value: boolean }) {
  const why = refusalFor(props, props.path);
  return (
    <label style={{ display: 'flex', justifyContent: 'space-between', ...small }} title={why ?? props.path}>
      {props.label}
      <input
        type="checkbox"
        data-param={props.path}
        checked={props.value}
        disabled={why !== null}
        onChange={() => write(props, `Set ${props.device.name ?? props.device.plugin} ${props.label}`, props.path, !props.value)}
      />
    </label>
  );
}
