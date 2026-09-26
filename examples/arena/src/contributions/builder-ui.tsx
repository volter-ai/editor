import type { CSSProperties } from 'react';

export const hintStyle: CSSProperties = { color: 'var(--vgai-content-muted)', fontSize: 11 };
export const fieldLabelStyle: CSSProperties = { fontSize: 12, fontWeight: 600 };
export const inputStyle: CSSProperties = { width: '100%', minWidth: 0, boxSizing: 'border-box' };

export function BuilderSliderRow({
  label,
  hint,
  min,
  max,
  step = 0.01,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  min: number;
  max: number;
  /** Slider/spinner increment (default 0.01 — the proportion-param grain;
   *  metre-scale offsets pass 0.001). */
  step?: number;
  value: number;
  onChange(value: number): void;
}) {
  return (
    <label style={sliderRowStyle}>
      <span style={{ minWidth: 0 }}>
        <strong style={{ display: 'block', fontSize: 12 }}>{label}</strong>
        <span style={hintStyle}>{hint}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ width: '100%', minWidth: 0, accentColor: 'var(--vgai-accent)' }}
      />
      <input
        className="vgai-input"
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ width: 64, boxSizing: 'border-box' }}
      />
    </label>
  );
}

const sliderRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(90px, 0.85fr) minmax(70px, 1.15fr) 64px',
  alignItems: 'center',
  gap: 10,
  minWidth: 0,
};
