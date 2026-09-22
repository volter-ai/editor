/**
 * FilterEditor — `filter`/`backdrop-filter` function sliders (blur/
 * brightness/contrast/saturate/grayscale/hue-rotate), add/remove-by-slider
 * (each function resets to its identity default when dragged back to it —
 * matching the reference's "omit default-valued functions from the composed
 * string" behavior) (spec 27 §5 C1). Ported from `visual-edit/inspector.tsx`'s
 * `FilterEditor`/`FILTER_DEFS` (:1530-1620); the reference's expand/collapse
 * chrome is left to the calling SECTION (Effects) — this widget renders its
 * sliders directly given a value, matching this kit's "widgets are pure,
 * sections own layout/disclosure" split.
 */

import { ScrubbableInput } from './ScrubbableInput';
import { type ChangeHandlers, fireChange, fireEnd, THEME } from './shared';

interface FilterDef {
  name: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

const FILTER_DEFS: FilterDef[] = [
  { name: 'blur', unit: 'px', min: 0, max: 50, step: 0.5, default: 0 },
  { name: 'brightness', unit: '%', min: 0, max: 300, step: 1, default: 100 },
  { name: 'contrast', unit: '%', min: 0, max: 300, step: 1, default: 100 },
  { name: 'saturate', unit: '%', min: 0, max: 300, step: 1, default: 100 },
  { name: 'grayscale', unit: '%', min: 0, max: 100, step: 1, default: 0 },
  { name: 'hue-rotate', unit: 'deg', min: 0, max: 360, step: 1, default: 0 },
];

export interface FilterFunc {
  name: string;
  value: number;
}

export function parseFilterFunctions(filter: string): FilterFunc[] {
  if (!filter || filter === 'none') {
    return FILTER_DEFS.map((d) => ({ name: d.name, value: d.default }));
  }
  return FILTER_DEFS.map((def) => {
    const regex = new RegExp(`${def.name}\\(([\\d.]+)${def.unit}?\\)`);
    const m = filter.match(regex);
    return { name: def.name, value: m?.[1] ? Number.parseFloat(m[1]) : def.default };
  });
}

export function composeFilter(funcs: FilterFunc[]): string {
  const parts: string[] = [];
  for (let i = 0; i < funcs.length; i++) {
    const f = funcs[i];
    const def = FILTER_DEFS[i];
    if (f && def && f.value !== def.default) parts.push(`${f.name}(${f.value}${def.unit})`);
  }
  return parts.length ? parts.join(' ') : 'none';
}

export interface FilterEditorProps extends ChangeHandlers<FilterFunc[]> {
  /** Cosmetic only — "Filter" vs "Backdrop Filter" label for the caller's section. */
  label?: string | undefined;
  /** Root-element test id. Defaults to the stable `filter-editor`; a node with
   *  BOTH a `filter` and a `backdropFilter` row renders two of these, so the
   *  inspector passes a per-row id to keep the roots distinct (spec 27 §5 C2, S1). */
  testId?: string | undefined;
}

export function FilterEditor({
  value,
  onChange,
  onChangeEnd,
  disabled,
  label = 'Filter',
  testId = 'filter-editor',
}: FilterEditorProps): React.ReactElement {
  const apply = (index: number, v: number, commit: boolean): void => {
    const next = value.map((f, i) => (i === index ? { ...f, value: v } : f));
    if (commit) fireEnd({ onChange, onChangeEnd }, next);
    else fireChange({ onChange }, next);
  };

  return (
    <div data-testid={testId}>
      <div style={{ fontSize: 9, color: THEME.textMuted, marginBottom: 4 }}>{label}</div>
      {value.map((f, i) => {
        const def = FILTER_DEFS[i];
        if (!def) return null;
        return (
          <div key={f.name} data-testid={`filter-row-${f.name}`} style={{ marginBottom: 3 }}>
            <ScrubbableInput
              testId={`filter-${f.name}`}
              label={f.name.replace('hue-rotate', 'hue')}
              value={f.value}
              unit={def.unit}
              min={def.min}
              max={def.max}
              step={def.step}
              disabled={disabled}
              onChange={(v) => apply(i, v, false)}
              onChangeEnd={(v) => apply(i, v, true)}
            />
          </div>
        );
      })}
    </div>
  );
}
