import { TextInput } from '../design-system';
/**
 * ScrubbableInput — a numeric input whose LABEL is a drag-to-scrub handle
 * (spec 27 §5 C1). Ported from `visual-edit/inspector.tsx`'s `ScrubbableInput`
 * (:107-219): drag the label left/right to change the number, Shift = ×10,
 * Alt = ×0.1, Escape cancels back to the drag-start value. Unlike the
 * reference (which threaded a `prop` string + string value through a
 * shared style-bag callback), this widget's contract is the kit-wide pure
 * `value: number` / `onChange` / `onChangeEnd` (see `shared.tsx`'s doc
 * comment) — `unit` is display-only (appended to the rendered text, stripped
 * on parse), keeping the value itself a plain number for callers to compose
 * into whatever CSS string they write.
 */

import { type ReactNode, useMemo, useRef, useState } from 'react';
import { type ChangeHandlers, fireChange, fireEnd, rowStyle, THEME } from './shared';

export interface ScrubbableInputProps extends ChangeHandlers<number> {
  label: ReactNode;
  unit?: string | undefined;
  step?: number | undefined;
  min?: number | undefined;
  max?: number | undefined;
  precision?: number | undefined;
  testId?: string | undefined;
  style?: React.CSSProperties | undefined;
}

export function ScrubbableInput({
  label,
  value,
  unit = '',
  step = 1,
  min,
  max,
  precision,
  disabled,
  onChange,
  onChangeEnd,
  testId,
  style: extraStyle,
}: ScrubbableInputProps): React.ReactElement {
  const dragRef = useRef<{ startX: number; startValue: number; last: number } | null>(null);

  const effectivePrecision = precision ?? (step < 1 ? 2 : step >= 100 ? -2 : 0);

  const round = useMemo(
    () =>
      (n: number): number => {
        if (effectivePrecision < 0) {
          const factor = 10 ** -effectivePrecision;
          return Math.round(n / factor) * factor;
        }
        const factor = 10 ** effectivePrecision;
        return Math.round(n * factor) / factor;
      },
    [effectivePrecision],
  );

  const clamp = (n: number): number => {
    let v = n;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    return round(v);
  };

  const handleScrubStart = (e: React.MouseEvent): void => {
    if (disabled) return;
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startValue: value, last: value };
    document.body.style.cursor = 'ew-resize';

    const handleMove = (me: MouseEvent): void => {
      if (!dragRef.current) return;
      me.preventDefault();
      const delta = me.clientX - dragRef.current.startX;
      const multiplier = me.shiftKey ? 10 : me.altKey ? 0.1 : 1;
      const next = clamp(dragRef.current.startValue + delta * step * multiplier);
      dragRef.current.last = next;
      fireChange({ onChange }, next);
    };

    const cleanup = (): void => {
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('keydown', handleKeyDuringScrub);
    };

    const handleUp = (): void => {
      if (dragRef.current) {
        const final = dragRef.current.last;
        dragRef.current = null;
        fireEnd({ onChange, onChangeEnd }, final);
      }
      cleanup();
    };

    const handleKeyDuringScrub = (ke: KeyboardEvent): void => {
      if (ke.key === 'Escape' && dragRef.current) {
        const original = clamp(dragRef.current.startValue);
        dragRef.current = null;
        fireChange({ onChange }, original);
        fireEnd({ onChange, onChangeEnd }, original);
        cleanup();
      }
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('keydown', handleKeyDuringScrub);
  };

  // TYPING IS A DRAFT, COMMITTED ONCE. The text field used to be controlled
  // by the live value and fire `onChange` per keystroke, so the first digit
  // was WRITTEN, the write re-projected the board, the field re-rendered
  // from the new value (and lost focus with it) and every later
  // digit went nowhere — typing 257 into a width left it at 2 (measured on
  // production build 59; runhuman pass 135: "it changed to 237.3"). While
  // focused the field shows its own draft, the whole value selected on
  // entry; Enter or blur commits, Escape cancels. Scrubbing the label is
  // unchanged — that path IS live by design.
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  const commitText = (raw: string): void => {
    const n = Number.parseFloat(raw);
    if (Number.isNaN(n)) return;
    const next = clamp(n);
    if (next === value) return;
    fireEnd({ onChange, onChangeEnd }, next);
  };

  return (
    <div style={{ ...rowStyle, ...extraStyle }}>
      <span
        className="vgai-scrub-label"
        data-testid={testId ? `${testId}-label` : undefined}
        onMouseDown={handleScrubStart}
        data-disabled={disabled || undefined}
        style={{
          fontSize: 11,
          // Resting/hover color comes from `.vgai-scrub-label` in theme.css —
          // an inline color here forced the hover rule into `!important`.
          ...(disabled ? { color: THEME.dynamic } : {}),
          flexShrink: 0,
          cursor: disabled ? 'not-allowed' : 'ew-resize',
          userSelect: 'none',
          fontWeight: 500,
        }}
      >
        {label}
      </span>
      <TextInput
        data-testid={testId}
        type="text"
        value={draft ?? `${value}${unit}`}
        readOnly={disabled}
        data-dynamic={disabled || undefined}
        onFocus={(e) => {
          setDraft(`${value}${unit}`);
          e.target.select();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => {
          if (!cancelled.current) commitText(e.target.value);
          cancelled.current = false;
          setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            cancelled.current = true;
            (e.target as HTMLInputElement).blur();
          }
        }}
        style={{ flex: 1, width: 0 }}
      />
    </div>
  );
}
