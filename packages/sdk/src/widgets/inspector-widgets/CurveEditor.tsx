/**
 * CurveEditor (W1b) — SVG piecewise-bezier curve editor over the
 * `CurveSegment[]` shape (`curve-utils.ts`), which is structurally the
 * engine schema's `PiecewiseBezier.functions` AND three.quarks' native JSON.
 *
 * Deliberately generic (value curve in, curve out — zero particle coupling):
 * the particle inspector's over-lifetime modules use it today; future
 * consumers reuse it as-is.
 *
 * Interactions: drag keys (endpoints value-only, interior keys time+value),
 * drag tangent handles of the selected key, double-click the plot to insert
 * a key (exact de Casteljau split), Delete/Backspace or the footer × to
 * remove an interior key. Y-range auto-fits to the curve with axis labels.
 * Contract: `ChangeHandlers<CurveSegment[]>` — `onChange` fires live during
 * a drag, `onChangeEnd` once per gesture (the caller's single undo step).
 */

import { useMemo, useRef, useState } from 'react';
import { Button, NumberInput } from '../design-system';
import {
  type CurveSegment,
  curveKeys,
  curveValueRange,
  deleteKey,
  moveKey,
  moveTangent,
  segmentEnd,
  splitAt,
} from './curve-utils';
import { type ChangeHandlers, fireChange, fireEnd, THEME } from './shared';

export type { CurveBezier, CurveKey, CurveSegment } from './curve-utils';

export interface CurveEditorProps extends ChangeHandlers<CurveSegment[]> {
  /** Plot height in px (default 90). */
  height?: number | undefined;
  /** Curve stroke color (default the theme accent). */
  color?: string | undefined;
  /** Root-element test id (default `curve-editor`). */
  testId?: string | undefined;
}

const PAD_L = 34; // room for y-axis labels
const PAD_R = 6;
const PAD_T = 6;
const PAD_B = 14; // room for x-axis labels
const WIDTH = 260; // viewBox width — the element itself is 100% wide

function formatAxis(v: number): string {
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 1) return String(Math.round(v * 100) / 100);
  return String(Math.round(v * 1000) / 1000);
}

export function CurveEditor({
  value,
  onChange,
  onChangeEnd,
  disabled,
  height = 90,
  color,
  testId = 'curve-editor',
}: CurveEditorProps): React.ReactElement {
  const [selectedKey, setSelectedKey] = useState(0);
  const svgRef = useRef<SVGSVGElement | null>(null);
  // The in-flight gesture's latest curve — window-level listeners see stale
  // React props, so drags accumulate against this ref, not `value`.
  const dragCurve = useRef<CurveSegment[] | null>(null);

  const keys = useMemo(() => curveKeys(value), [value]);

  // --- plot coordinate mapping (y auto-fit with padding) ---
  const range = useMemo(() => {
    const { min, max } = curveValueRange(value);
    if (max - min < 1e-6) return { min: min - 1, max: max + 1 };
    const pad = (max - min) * 0.1;
    return { min: min - pad, max: max + pad };
  }, [value]);

  const plotW = WIDTH - PAD_L - PAD_R;
  const plotH = height - PAD_T - PAD_B;
  const xOf = (t: number): number => PAD_L + t * plotW;
  const yOf = (v: number): number =>
    PAD_T + (1 - (v - range.min) / (range.max - range.min)) * plotH;
  const tOf = (x: number): number => Math.max(0, Math.min(1, (x - PAD_L) / plotW));
  const vOf = (y: number): number =>
    range.min + (1 - (y - PAD_T) / plotH) * (range.max - range.min);

  /** Pointer event → plot-space (t, v) using the rendered element's box. */
  const plotPoint = (e: { clientX: number; clientY: number }): { t: number; v: number } => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { t: 0, v: 0 };
    const x = ((e.clientX - rect.left) / rect.width) * WIDTH;
    const y = ((e.clientY - rect.top) / rect.height) * height;
    return { t: tOf(x), v: vOf(y) };
  };

  // The curve path: x is linear in each segment's normalized time, so the
  // plotted curve is an EXACT svg cubic with x-controls at 1/3 and 2/3.
  const path = useMemo(() => {
    if (value.length === 0) return '';
    let d = `M ${xOf(value[0]!.start)} ${yOf(value[0]!.function.p0)}`;
    for (let i = 0; i < value.length; i++) {
      const s = value[i]!;
      const end = segmentEnd(value, i);
      const w = end - s.start;
      d += ` C ${xOf(s.start + w / 3)} ${yOf(s.function.p1)}, ${xOf(s.start + (2 * w) / 3)} ${yOf(s.function.p2)}, ${xOf(end)} ${yOf(s.function.p3)}`;
    }
    return d;
  }, [value, range, height]);

  const commit = (next: CurveSegment[]): void => fireEnd({ onChange, onChangeEnd }, next);
  const live = (next: CurveSegment[]): void => fireChange({ onChange }, next);

  /** Shared drag loop: apply(t, v) produces the next curve from a pointer position. */
  const beginDrag = (
    e: React.PointerEvent,
    apply: (base: CurveSegment[], t: number, v: number) => CurveSegment[],
  ): void => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    dragCurve.current = value;
    const onMove = (me: PointerEvent): void => {
      const { t, v } = plotPoint(me);
      const next = apply(dragCurve.current ?? value, t, v);
      dragCurve.current = next;
      live(next);
    };
    const onUp = (me: PointerEvent): void => {
      const { t, v } = plotPoint(me);
      const next = apply(dragCurve.current ?? value, t, v);
      dragCurve.current = null;
      commit(next);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const stroke = color ?? THEME.accent;
  const n = value.length;
  const selected = keys[selectedKey];
  const canDelete = selectedKey > 0 && selectedKey < n;

  // Tangent handle geometry for the selected key.
  const outSeg = selectedKey < n ? value[selectedKey] : undefined;
  const inSeg = selectedKey > 0 ? value[selectedKey - 1] : undefined;
  const outHandle = outSeg
    ? {
        x: xOf(outSeg.start + (segmentEnd(value, selectedKey) - outSeg.start) / 3),
        y: yOf(outSeg.function.p1),
      }
    : null;
  const inHandle = inSeg
    ? {
        x: xOf(inSeg.start + ((segmentEnd(value, selectedKey - 1) - inSeg.start) * 2) / 3),
        y: yOf(inSeg.function.p2),
      }
    : null;

  const yTicks = [range.min, (range.min + range.max) / 2, range.max];

  return (
    <div data-testid={testId}>
      <svg
        ref={svgRef}
        data-testid={`${testId}-plot`}
        viewBox={`0 0 ${WIDTH} ${height}`}
        style={{
          width: '100%',
          height,
          display: 'block',
          background: THEME.inputBg,
          border: `1px solid ${THEME.border}`,
          borderRadius: THEME.radiusSmall,
          touchAction: 'none',
          outline: 'none',
        }}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the plot IS the interactive surface (role=application); focus enables the Delete-key path
        tabIndex={0}
        role="application"
        aria-label="Curve editor"
        onKeyDown={(e) => {
          if ((e.key === 'Delete' || e.key === 'Backspace') && canDelete && !disabled) {
            e.preventDefault();
            commit(deleteKey(value, selectedKey));
            setSelectedKey(Math.max(0, selectedKey - 1));
          }
        }}
        onDoubleClick={(e) => {
          if (disabled) return;
          const { t } = plotPoint(e);
          const next = splitAt(value, t);
          if (next !== value) {
            commit(next);
            setSelectedKey(next.findIndex((s) => Math.abs(s.start - t) < 1e-6));
          }
        }}
      >
        {/* axes + grid */}
        {yTicks.map((v) => (
          <g key={v}>
            <line
              x1={PAD_L}
              x2={WIDTH - PAD_R}
              y1={yOf(v)}
              y2={yOf(v)}
              stroke={THEME.border}
              strokeWidth={0.5}
            />
            <text
              x={PAD_L - 3}
              y={yOf(v) + 2.5}
              fontSize={7}
              fill={THEME.textMuted}
              textAnchor="end"
            >
              {formatAxis(v)}
            </text>
          </g>
        ))}
        {[0, 0.5, 1].map((t) => (
          <text
            key={t}
            x={xOf(t)}
            y={height - 3}
            fontSize={7}
            fill={THEME.textMuted}
            textAnchor="middle"
          >
            {t}
          </text>
        ))}

        {/* the curve */}
        <path d={path} fill="none" stroke={stroke} strokeWidth={1.5} />

        {/* tangent handles for the selected key */}
        {selected && outHandle && (
          <g>
            <line
              x1={xOf(selected.time)}
              y1={yOf(selected.value)}
              x2={outHandle.x}
              y2={outHandle.y}
              stroke={THEME.textMuted}
              strokeDasharray="2 2"
              strokeWidth={0.75}
            />
            <circle
              data-testid={`${testId}-tangent-out`}
              cx={outHandle.x}
              cy={outHandle.y}
              r={3}
              fill={THEME.surface}
              stroke={THEME.textMuted}
              style={{ cursor: disabled ? 'not-allowed' : 'ns-resize' }}
              onPointerDown={(e) =>
                beginDrag(e, (base, _t, v) => moveTangent(base, selectedKey, 'out', v))
              }
            />
          </g>
        )}
        {selected && inHandle && (
          <g>
            <line
              x1={xOf(selected.time)}
              y1={yOf(selected.value)}
              x2={inHandle.x}
              y2={inHandle.y}
              stroke={THEME.textMuted}
              strokeDasharray="2 2"
              strokeWidth={0.75}
            />
            <circle
              data-testid={`${testId}-tangent-in`}
              cx={inHandle.x}
              cy={inHandle.y}
              r={3}
              fill={THEME.surface}
              stroke={THEME.textMuted}
              style={{ cursor: disabled ? 'not-allowed' : 'ns-resize' }}
              onPointerDown={(e) =>
                beginDrag(e, (base, _t, v) => moveTangent(base, selectedKey, 'in', v))
              }
            />
          </g>
        )}

        {/* keys */}
        {keys.map((k, i) => (
          <circle
            key={i}
            data-testid={`${testId}-key-${i}`}
            cx={xOf(k.time)}
            cy={yOf(k.value)}
            r={4}
            fill={i === selectedKey ? THEME.accent : THEME.surface}
            stroke={i === selectedKey ? THEME.onAccent : stroke}
            strokeWidth={1.25}
            style={{ cursor: disabled ? 'not-allowed' : 'move' }}
            onPointerDown={(e) => {
              setSelectedKey(i);
              beginDrag(e, (base, t, v) => moveKey(base, i, t, v));
            }}
          />
        ))}
      </svg>

      {/* selected-key detail row */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 3 }}>
        <span style={{ fontSize: 9, color: THEME.textMuted, flex: '0 0 auto' }}>
          Key {selectedKey + 1}/{keys.length}
        </span>
        <NumberInput
          label="t"
          value={selected ? Math.round(selected.time * 1000) / 1000 : null}
          step={0.05}
          testId={`${testId}-key-time`}
          onChange={(t) => {
            if (selected) live(moveKey(value, selectedKey, t, selected.value));
          }}
          onChangeEnd={(t) => {
            if (selected) commit(moveKey(value, selectedKey, t, selected.value));
          }}
        />
        <NumberInput
          label="v"
          value={selected ? Math.round(selected.value * 1000) / 1000 : null}
          step={0.05}
          testId={`${testId}-key-value`}
          onChange={(v) => {
            if (selected) live(moveKey(value, selectedKey, selected.time, v));
          }}
          onChangeEnd={(v) => {
            if (selected) commit(moveKey(value, selectedKey, selected.time, v));
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="compact"
          data-testid={`${testId}-delete-key`}
          disabled={!canDelete || disabled === true}
          aria-label="Delete curve key"
          title={canDelete ? 'Delete key' : 'Endpoint keys cannot be deleted'}
          onClick={() => {
            commit(deleteKey(value, selectedKey));
            setSelectedKey(Math.max(0, selectedKey - 1));
          }}
        >
          ×
        </Button>
      </div>
    </div>
  );
}
