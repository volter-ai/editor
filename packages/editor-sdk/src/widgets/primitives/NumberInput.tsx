import { useEffect, useRef, useState } from 'react';
import { useInteractiveEditScope } from '../interactive-edit-scope';
import { TextInput } from './FormControls';

interface NumberInputProps {
  value: number | null; // null = mixed (multi-edit)
  onChange: (value: number) => void;
  /**
   * Fires once per discrete edit gesture — a drag's pointerup (with the
   * drag's FINAL value) or a typed edit's blur/Enter — instead of on every
   * intermediate `onChange` call (which still fires on every pointermove
   * during a drag, for callers that want live feedback as the value moves).
   * Optional: existing callers that only wired `onChange` are unaffected. A
   * caller whose `onChange` triggers something expensive per call (a file
   * write, a network POST — see DataPanel's DATA-tab number cells, #3)
   * should commit through THIS instead, so a 2-second scrub fires exactly
   * one commit, not dozens.
   */
  onChangeEnd?: (value: number) => void;
  step?: number;
  /**
   * Decimal places in the resting display. Defaults to 3 — the right read for
   * a transform axis, and a nonsense one for a whole-number tuning field
   * (`ROUNDS 3.000`). A caller that knows its field's granularity passes it;
   * `TuningPanel` derives it from the schema's step.
   */
  precision?: number;
  /** Read-only: no scrub, no typed edit. Optional — existing callers unchanged. */
  disabled?: boolean;
  label?: string;
  labelColor?: string | undefined;
  style?: React.CSSProperties;
  /** Stable test hook (set on the wrapper; the edit <input> is its descendant). */
  testId?: string | undefined;
  /** Hover text for the whole field (a channel's read-only reason, say). */
  title?: string | undefined;
}

export function NumberInput({
  value,
  onChange,
  onChangeEnd,
  step = 0.1,
  precision = 3,
  disabled = false,
  label,
  labelColor,
  style,
  testId,
  title,
}: NumberInputProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const dragRef = useRef({ startX: 0, startVal: 0, dragging: false, gesture: false, lastVal: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const editScope = useInteractiveEditScope();

  useEffect(() => {
    if (!editing) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    // THE WHOLE VALUE IS SELECTED WHEN THE EDITOR OPENS, so typing REPLACES
    // it — every number field in every DCC tool. Focused without a
    // selection, a typed number was spliced into the old text and committed
    // as garbage: click the field showing -5, type -7, Enter → -47;
    // double-click, type -9 → -459 (measured on the GPU instrument,
    // 2026-09-03). That is the "everything's there, just not where I wanted
    // it" and "it jumped" of runhuman passes 122 and 127 — the author typed
    // one number and the field committed another.
    input.select();
  }, [editing]);

  const isMixed = value === null;
  const numValue = value ?? 0;
  const display = isMixed
    ? '—'
    : Number.isFinite(numValue)
      ? numValue.toFixed(precision)
      : (0).toFixed(precision);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    dragRef.current = {
      startX: e.clientX,
      startVal: numValue,
      dragging: false,
      gesture: false,
      lastVal: numValue,
    };
    const onMove = (me: PointerEvent) => {
      const dx = me.clientX - dragRef.current.startX;
      if (Math.abs(dx) > 3) dragRef.current.dragging = true;
      if (dragRef.current.dragging) {
        // Coalesce the whole scrub into a single undo step: open the gesture
        // just before the first value change (so the snapshot is pre-drag).
        if (!dragRef.current.gesture) {
          dragRef.current.gesture = true;
          editScope?.begin();
        }
        const newVal = dragRef.current.startVal + dx * step;
        const rounded = Math.round(newVal / step) * step;
        dragRef.current.lastVal = rounded;
        onChange(rounded);
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (dragRef.current.gesture) editScope?.end();
      if (dragRef.current.dragging) {
        // One commit for the whole gesture (#3) — `onChange` above already
        // fired per pointermove for callers that want live feedback; this is
        // the single "the user is done" signal, with the drag's final value.
        onChangeEnd?.(dragRef.current.lastVal);
      } else {
        setEditing(true);
        setText(isMixed ? '' : display);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const commitEdit = () => {
    setEditing(false);
    const n = Number.parseFloat(text);
    if (Number.isFinite(n)) {
      onChange(n);
      onChangeEnd?.(n);
    }
  };

  return (
    <div className="vgai-number-input" data-testid={testId} title={title} style={style}>
      {label && (
        <span
          className="vgai-number-input-label"
          style={labelColor ? { color: labelColor } : undefined}
        >
          {label}
        </span>
      )}
      {editing ? (
        <TextInput
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitEdit();
            if (e.key === 'Escape') setEditing(false);
          }}
          placeholder={isMixed ? '—' : undefined}
          className="vgai-number-input-editor"
        />
      ) : (
        <div
          onPointerDown={handlePointerDown}
          className="vgai-number-input-scrub"
          data-mixed={isMixed || undefined}
          data-disabled={disabled || undefined}
        >
          {display}
        </div>
      )}
    </div>
  );
}
