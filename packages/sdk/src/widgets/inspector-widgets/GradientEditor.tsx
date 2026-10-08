import { Button, NumberInput } from '../design-system';
/**
 * GradientEditor — solid/gradient toggle, stop list (add/remove/drag),
 * linear/radial toggle, angle (spec 27 §5 C1). Ported from
 * `visual-edit/inspector.tsx`'s `GradientEditor` (:823-989) — kept as a
 * gradient-only value editor here (the reference's solid-vs-gradient mode
 * switch that also drove `backgroundColor` is a Fill-SECTION concern; C2
 * wires the section's solid/gradient toggle around this + `ColorSwatch`).
 *
 * W1b promotion: the draggable-stop TRACK is factored out as
 * `GradientStopsTrack` and shared by TWO value adapters over the one core —
 * this CSS `GradientValue` editor (unchanged contract + test-ids) and
 * `QuarksGradientEditor`, which edits the particle system's
 * three.quarks-shaped `Gradient` JSON (separate color keys `{value:{r,g,b},
 * pos}` and alpha keys `{value:number, pos}` — the engine schema's
 * `GradientSchema`, typed structurally here so the kit stays decoupled).
 * One component, parameterized — not a fork.
 */

import { useState } from 'react';
import { ColorSwatch } from './ColorPicker';
import { rgbStringToHex } from './color-utils';
import { ScrubbableInput } from './ScrubbableInput';
import { type ChangeHandlers, fireChange, fireEnd, THEME, ToggleButton } from './shared';

export interface GradientStop {
  color: string;
  position: number; // 0..1
}

export interface GradientValue {
  type: 'linear' | 'radial';
  angle: number; // degrees, linear only
  stops: GradientStop[];
}

export function composeGradient(g: GradientValue): string {
  const stopStr = g.stops.map((s) => `${s.color} ${Math.round(s.position * 100)}%`).join(', ');
  return g.type === 'radial'
    ? `radial-gradient(circle, ${stopStr})`
    : `linear-gradient(${g.angle}deg, ${stopStr})`;
}

/** The `linear-gradient(...)`/`radial-gradient(...)` outer match -> `{type, inner}`,
 *  or `null` if `value` isn't either. Split out of `parseGradient` to keep
 *  each step under biome's cognitive-complexity ceiling. */
function matchGradientShell(value: string): { type: GradientValue['type']; inner: string } | null {
  const linearMatch = value.match(/^linear-gradient\((.+)\)$/);
  if (linearMatch?.[1] !== undefined) return { type: 'linear', inner: linearMatch[1] };
  const radialMatch = value.match(/^radial-gradient\((.+)\)$/);
  if (radialMatch?.[1] !== undefined) return { type: 'radial', inner: radialMatch[1] };
  return null;
}

/** Strips a leading `<N>deg,`/`to <dir>,` prefix off a linear gradient's
 *  inner string -> `{angle, colorPart}` (angle stays 180 — CSS's own default
 *  — when neither prefix is present). */
function stripLinearAngle(inner: string): { angle: number; colorPart: string } {
  const angleMatch = inner.match(/^(\d+)deg\s*,\s*/);
  if (angleMatch) {
    return {
      angle: Number.parseInt(angleMatch[1] ?? '180', 10),
      colorPart: inner.slice(angleMatch[0].length),
    };
  }
  if (inner.startsWith('to ')) {
    const dirMatch = inner.match(/^to\s+\w+\s*,\s*/);
    if (dirMatch) return { angle: 180, colorPart: inner.slice(dirMatch[0].length) };
  }
  return { angle: 180, colorPart: inner };
}

/** `"#fff 0%, #000 100%"` -> stops, auto-spreading any stop that omitted its
 *  `%` evenly across the run (matches the CSS spec's own auto-position rule). */
function parseGradientStops(colorPart: string): GradientStop[] {
  const stops: GradientStop[] = colorPart.split(/,\s*(?![^(]*\))/).map((part) => {
    const trimmed = part.trim();
    const pctMatch = trimmed.match(/\s+(\d+)%$/);
    const position = pctMatch ? Number.parseInt(pctMatch[1] ?? '0', 10) / 100 : -1;
    const color = pctMatch ? trimmed.slice(0, -pctMatch[0].length).trim() : trimmed;
    return { color, position };
  });
  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i];
    if (stop && stop.position < 0) stop.position = stops.length > 1 ? i / (stops.length - 1) : 0;
  }
  return stops;
}

export function parseGradient(value: string): GradientValue | null {
  if (!value || value === 'none') return null;
  const shell = matchGradientShell(value);
  if (!shell) return null;
  const { angle, colorPart } =
    shell.type === 'linear'
      ? stripLinearAngle(shell.inner)
      : { angle: 180, colorPart: shell.inner };
  const stops = parseGradientStops(colorPart);
  if (stops.length < 2) return null;
  return { type: shell.type, angle, stops };
}

// ---------------------------------------------------------------------------
// Shared draggable-stops track (W1b) — the one core under both adapters.
// ---------------------------------------------------------------------------

export interface TrackStop {
  /** 0..1 position along the track. */
  position: number;
  /** CSS color painted on the stop dot. */
  css: string;
}

export interface GradientStopsTrackProps {
  stops: TrackStop[];
  selected: number;
  onSelect: (index: number) => void;
  /** Fires with the dragged stop's index + clamped 0..1 position; `commit`
   *  is false on every move, true once on release (the caller's undo step). */
  onMove: (index: number, position: number, commit: boolean) => void;
  disabled?: boolean | undefined;
  /** Per-dot test ids are `${testIdPrefix}-${i}`. */
  testIdPrefix: string;
}

export function GradientStopsTrack({
  stops,
  selected,
  onSelect,
  onMove,
  disabled,
  testIdPrefix,
}: GradientStopsTrackProps): React.ReactElement {
  return (
    <div style={{ position: 'relative', height: 12, marginTop: 2 }}>
      {stops.map((stop, i) => (
        <div
          key={i}
          data-testid={`${testIdPrefix}-${i}`}
          onClick={() => onSelect(i)}
          onMouseDown={(e) => {
            if (disabled) return;
            e.preventDefault();
            onSelect(i);
            const parent = (e.target as HTMLElement).parentElement;
            const rect = parent?.getBoundingClientRect();
            const posAt = (clientX: number): number =>
              rect?.width
                ? Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
                : stop.position;
            const onMoveEv = (me: MouseEvent): void => onMove(i, posAt(me.clientX), false);
            const onUp = (me: MouseEvent): void => {
              onMove(i, posAt(me.clientX), true);
              window.removeEventListener('mousemove', onMoveEv);
              window.removeEventListener('mouseup', onUp);
            };
            window.addEventListener('mousemove', onMoveEv);
            window.addEventListener('mouseup', onUp);
          }}
          style={{
            position: 'absolute',
            left: `${stop.position * 100}%`,
            top: 0,
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: stop.css,
            border: `2px solid ${i === selected ? THEME.accent : '#fff'}`,
            transform: 'translateX(-50%)',
            cursor: disabled ? 'not-allowed' : 'pointer',
          }}
        />
      ))}
    </div>
  );
}

export interface GradientEditorProps extends ChangeHandlers<GradientValue> {
  recentColors?: string[] | undefined;
  onAddRecentColor?: ((color: string) => void) | undefined;
  /** Root-element test id. Defaults to the stable `gradient-editor` (the gallery
   *  / C1 contract); a caller that renders MORE THAN ONE gradient editor on a
   *  node (the inspector's `prop.background` + `style.backgroundImage` rows)
   *  passes a per-row id so the two roots don't collide (spec 27 §5 C2, S1). */
  testId?: string | undefined;
}

export function GradientEditor({
  value,
  onChange,
  onChangeEnd,
  disabled,
  recentColors,
  onAddRecentColor,
  testId = 'gradient-editor',
}: GradientEditorProps): React.ReactElement {
  const [selectedStop, setSelectedStop] = useState(0);

  const apply = (next: GradientValue, commit: boolean): void => {
    if (commit) fireEnd({ onChange, onChangeEnd }, next);
    else fireChange({ onChange }, next);
  };

  const setStop = (index: number, partial: Partial<GradientStop>, commit: boolean): void => {
    const stops = value.stops.map((s, i) => (i === index ? { ...s, ...partial } : s));
    apply({ ...value, stops }, commit);
  };

  const addStop = (): void => {
    const last = value.stops[value.stops.length - 1]?.position ?? 1;
    const first = value.stops[0]?.position ?? 0;
    const pos = (last + first) / 2;
    const stops = [...value.stops, { color: '#888888', position: pos }].sort(
      (a, b) => a.position - b.position,
    );
    setSelectedStop(stops.length - 1);
    apply({ ...value, stops }, true);
  };

  const removeStop = (index: number): void => {
    if (value.stops.length <= 2) return;
    const stops = value.stops.filter((_, i) => i !== index);
    setSelectedStop(Math.min(selectedStop, stops.length - 1));
    apply({ ...value, stops }, true);
  };

  const stopColor = value.stops[selectedStop]?.color ?? '#000000';
  const stopHex = stopColor.startsWith('#') ? stopColor : rgbStringToHex(stopColor);

  return (
    <div data-testid={testId}>
      <div style={{ position: 'relative', marginBottom: 8 }}>
        <div
          data-testid="gradient-preview"
          style={{
            height: 20,
            borderRadius: THEME.radiusSmall,
            border: `1px solid ${THEME.border}`,
            background: composeGradient(value),
          }}
        />
        <GradientStopsTrack
          stops={value.stops.map((s) => ({ position: s.position, css: s.color }))}
          selected={selectedStop}
          onSelect={setSelectedStop}
          onMove={(i, position, commit) => setStop(i, { position }, commit)}
          disabled={disabled}
          testIdPrefix="gradient-stop"
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <ColorSwatch
          testId="gradient-selected-color"
          value={stopHex}
          disabled={disabled}
          onChange={(c) => setStop(selectedStop, { color: c }, false)}
          onChangeEnd={(c) => setStop(selectedStop, { color: c }, true)}
          recentColors={recentColors}
          onAddRecentColor={onAddRecentColor}
        />
        <span style={{ fontSize: 9, color: THEME.textMuted }}>Stop {selectedStop + 1}</span>
        {value.stops.length > 2 && (
          <Button
            type="button"
            variant="ghost"
            size="compact"
            aria-label="Remove gradient stop"
            data-testid="gradient-remove-stop"
            onClick={() => removeStop(selectedStop)}
          >
            ×
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="compact"
          data-testid="gradient-add-stop"
          onClick={addStop}
        >
          + stop
        </Button>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 1, flex: 1 }}>
          <ToggleButton
            testId="gradient-type-linear"
            label="Linear"
            active={value.type === 'linear'}
            disabled={disabled}
            onClick={() => apply({ ...value, type: 'linear' }, true)}
          />
          <ToggleButton
            testId="gradient-type-radial"
            label="Radial"
            active={value.type === 'radial'}
            disabled={disabled}
            onClick={() => apply({ ...value, type: 'radial' }, true)}
          />
        </div>
        {value.type === 'linear' && (
          <ScrubbableInput
            testId="gradient-angle"
            label="°"
            value={value.angle}
            unit="deg"
            disabled={disabled}
            onChange={(v) => apply({ ...value, angle: v }, false)}
            onChangeEnd={(v) => apply({ ...value, angle: v }, true)}
            style={{ width: 70 }}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// QuarksGradientEditor (W1b) — the same stops-track core over the particle
// system's three.quarks `Gradient` JSON (engine `GradientSchema`, typed
// structurally): color keys {value:{r,g,b}, pos} + alpha keys {value, pos}.
// ---------------------------------------------------------------------------

export interface QuarksColorKey {
  value: { r: number; g: number; b: number };
  pos: number;
}

export interface QuarksAlphaKey {
  value: number;
  pos: number;
}

export interface QuarksGradientValue {
  type: 'Gradient';
  color: { type: 'CLinearFunction'; subType: 'Color'; keys: QuarksColorKey[] };
  alpha: { type: 'CLinearFunction'; subType: 'Number'; keys: QuarksAlphaKey[] };
}

export interface QuarksGradientEditorProps extends ChangeHandlers<QuarksGradientValue> {
  testId?: string | undefined;
}

function rgb01ToHex(c: { r: number; g: number; b: number }): string {
  const h = (v: number): string =>
    Math.round(Math.max(0, Math.min(1, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16) / 255,
    g: Number.parseInt(hex.slice(3, 5), 16) / 255,
    b: Number.parseInt(hex.slice(5, 7), 16) / 255,
  };
}

/** Piecewise-linear sample of {value, pos} keys (keys sorted by pos). */
function sampleKeys<V>(
  keys: { value: V; pos: number }[],
  pos: number,
  lerpValue: (a: V, b: V, u: number) => V,
): V | undefined {
  if (keys.length === 0) return undefined;
  if (pos <= keys[0]!.pos) return keys[0]!.value;
  const last = keys[keys.length - 1]!;
  if (pos >= last.pos) return last.value;
  for (let i = 0; i + 1 < keys.length; i++) {
    const a = keys[i]!;
    const b = keys[i + 1]!;
    if (pos >= a.pos && pos <= b.pos) {
      const u = b.pos > a.pos ? (pos - a.pos) / (b.pos - a.pos) : 0;
      return lerpValue(a.value, b.value, u);
    }
  }
  return last.value;
}

const lerpNum = (a: number, b: number, u: number): number => a + (b - a) * u;
const lerpRgb = (
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
  u: number,
): { r: number; g: number; b: number } => ({
  r: lerpNum(a.r, b.r, u),
  g: lerpNum(a.g, b.g, u),
  b: lerpNum(a.b, b.b, u),
});

/** Move key `i` to `pos`, keeping the list sorted; returns the moved key's new index. */
function moveKeyPos<K extends { pos: number }>(
  keys: K[],
  i: number,
  pos: number,
): { keys: K[]; index: number } {
  const moved = { ...keys[i]!, pos };
  const next = [...keys.filter((_, j) => j !== i), moved].sort((a, b) => a.pos - b.pos);
  return { keys: next, index: next.indexOf(moved) };
}

export function QuarksGradientEditor({
  value,
  onChange,
  onChangeEnd,
  disabled,
  testId = 'quarks-gradient',
}: QuarksGradientEditorProps): React.ReactElement {
  const [sel, setSel] = useState<{ track: 'color' | 'alpha'; i: number }>({ track: 'color', i: 0 });

  const apply = (next: QuarksGradientValue, commit: boolean): void => {
    if (commit) fireEnd({ onChange, onChangeEnd }, next);
    else fireChange({ onChange }, next);
  };

  const withColorKeys = (keys: QuarksColorKey[]): QuarksGradientValue => ({
    ...value,
    color: { ...value.color, keys },
  });
  const withAlphaKeys = (keys: QuarksAlphaKey[]): QuarksGradientValue => ({
    ...value,
    alpha: { ...value.alpha, keys },
  });

  // Combined rgba preview: sample color+alpha at the union of key positions.
  const positions = [
    ...new Set([...value.color.keys.map((k) => k.pos), ...value.alpha.keys.map((k) => k.pos)]),
  ].sort((a, b) => a - b);
  const previewStops = positions
    .map((pos) => {
      const c = sampleKeys(value.color.keys, pos, lerpRgb) ?? { r: 1, g: 1, b: 1 };
      const a = sampleKeys(value.alpha.keys, pos, lerpNum) ?? 1;
      return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${Math.round(a * 1000) / 1000}) ${Math.round(pos * 100)}%`;
    })
    .join(', ');

  const selColorKey = value.color.keys[sel.track === 'color' ? sel.i : 0];
  const selAlphaKey = value.alpha.keys[sel.track === 'alpha' ? sel.i : 0];

  return (
    <div data-testid={testId}>
      {/* alpha track (Unity-style: above the bar) */}
      <GradientStopsTrack
        stops={value.alpha.keys.map((k) => {
          const g = Math.round(Math.max(0, Math.min(1, k.value)) * 255);
          return { position: k.pos, css: `rgb(${g},${g},${g})` };
        })}
        selected={sel.track === 'alpha' ? sel.i : -1}
        onSelect={(i) => setSel({ track: 'alpha', i })}
        onMove={(i, pos, commit) => {
          const { keys, index } = moveKeyPos(value.alpha.keys, i, pos);
          setSel({ track: 'alpha', i: index });
          apply(withAlphaKeys(keys), commit);
        }}
        disabled={disabled}
        testIdPrefix={`${testId}-alpha-stop`}
      />

      {/* checkerboard + rgba gradient preview */}
      <div
        data-testid={`${testId}-preview`}
        style={{
          height: 20,
          borderRadius: THEME.radiusSmall,
          border: `1px solid ${THEME.border}`,
          backgroundImage: `linear-gradient(90deg, ${previewStops}), repeating-linear-gradient(45deg, #777 0 5px, #aaa 5px 10px)`,
        }}
      />

      {/* color track */}
      <GradientStopsTrack
        stops={value.color.keys.map((k) => ({ position: k.pos, css: rgb01ToHex(k.value) }))}
        selected={sel.track === 'color' ? sel.i : -1}
        onSelect={(i) => setSel({ track: 'color', i })}
        onMove={(i, pos, commit) => {
          const { keys, index } = moveKeyPos(value.color.keys, i, pos);
          setSel({ track: 'color', i: index });
          apply(withColorKeys(keys), commit);
        }}
        disabled={disabled}
        testIdPrefix={`${testId}-color-stop`}
      />

      {/* selected-stop controls */}
      {sel.track === 'color' && selColorKey && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <ColorSwatch
            testId={`${testId}-color-swatch`}
            value={rgb01ToHex(selColorKey.value)}
            disabled={disabled}
            onChange={(c) =>
              apply(
                withColorKeys(
                  value.color.keys.map((k, j) =>
                    j === sel.i ? { ...k, value: hexToRgb01(c) } : k,
                  ),
                ),
                false,
              )
            }
            onChangeEnd={(c) =>
              apply(
                withColorKeys(
                  value.color.keys.map((k, j) =>
                    j === sel.i ? { ...k, value: hexToRgb01(c) } : k,
                  ),
                ),
                true,
              )
            }
          />
          <span style={{ fontSize: 9, color: THEME.textMuted }}>
            Color {sel.i + 1}/{value.color.keys.length}
          </span>
          {value.color.keys.length > 2 && (
            <Button
              type="button"
              variant="ghost"
              size="compact"
              aria-label="Remove color stop"
              data-testid={`${testId}-remove-color-stop`}
              onClick={() => {
                const keys = value.color.keys.filter((_, j) => j !== sel.i);
                setSel({ track: 'color', i: Math.min(sel.i, keys.length - 1) });
                apply(withColorKeys(keys), true);
              }}
            >
              ×
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="compact"
            data-testid={`${testId}-add-color-stop`}
            onClick={() => {
              const pos = 0.5;
              const color = sampleKeys(value.color.keys, pos, lerpRgb) ?? { r: 1, g: 1, b: 1 };
              const { keys, index } = moveKeyPos(
                [...value.color.keys, { value: color, pos }],
                value.color.keys.length,
                pos,
              );
              setSel({ track: 'color', i: index });
              apply(withColorKeys(keys), true);
            }}
          >
            + stop
          </Button>
        </div>
      )}
      {sel.track === 'alpha' && selAlphaKey && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <NumberInput
            label="a"
            step={0.05}
            testId={`${testId}-alpha-value`}
            value={Math.round(selAlphaKey.value * 1000) / 1000}
            onChange={(v) =>
              apply(
                withAlphaKeys(
                  value.alpha.keys.map((k, j) =>
                    j === sel.i ? { ...k, value: Math.max(0, Math.min(1, v)) } : k,
                  ),
                ),
                false,
              )
            }
            onChangeEnd={(v) =>
              apply(
                withAlphaKeys(
                  value.alpha.keys.map((k, j) =>
                    j === sel.i ? { ...k, value: Math.max(0, Math.min(1, v)) } : k,
                  ),
                ),
                true,
              )
            }
          />
          <span style={{ fontSize: 9, color: THEME.textMuted }}>
            Alpha {sel.i + 1}/{value.alpha.keys.length}
          </span>
          {value.alpha.keys.length > 2 && (
            <Button
              type="button"
              variant="ghost"
              size="compact"
              aria-label="Remove alpha stop"
              data-testid={`${testId}-remove-alpha-stop`}
              onClick={() => {
                const keys = value.alpha.keys.filter((_, j) => j !== sel.i);
                setSel({ track: 'alpha', i: Math.min(sel.i, keys.length - 1) });
                apply(withAlphaKeys(keys), true);
              }}
            >
              ×
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="compact"
            data-testid={`${testId}-add-alpha-stop`}
            onClick={() => {
              const pos = 0.5;
              const alpha = sampleKeys(value.alpha.keys, pos, lerpNum) ?? 1;
              const { keys, index } = moveKeyPos(
                [...value.alpha.keys, { value: alpha, pos }],
                value.alpha.keys.length,
                pos,
              );
              setSel({ track: 'alpha', i: index });
              apply(withAlphaKeys(keys), true);
            }}
          >
            + stop
          </Button>
        </div>
      )}
    </div>
  );
}
