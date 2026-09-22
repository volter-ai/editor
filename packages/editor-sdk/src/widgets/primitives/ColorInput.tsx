import { useEffect, useState } from 'react';
import { useInteractiveEditScope } from '../interactive-edit-scope';
import { ColorSwatchInput, TextInput } from './FormControls';

interface ColorInputProps {
  value: string | null;
  onChange: (value: string) => void;
  /** Read-only: swatch and hex field both refuse input. Optional — existing callers unchanged. */
  disabled?: boolean;
}

export function ColorInput({ value, onChange, disabled = false }: ColorInputProps) {
  // Local draft state for the text input — only commits on blur or Enter.
  const [draft, setDraft] = useState(value ?? '');
  const editScope = useInteractiveEditScope();

  // Sync draft when the external value changes (e.g. undo, selection change).
  useEffect(() => {
    setDraft(value ?? '');
  }, [value]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) {
      onChange(trimmed);
    }
  };

  if (value === null) {
    return (
      <div className="vgai-color-input">
        <div className="vgai-color-input-mixed" />
        <TextInput
          // Mixed-value language unified on the em-dash (I-15), matching
          // NumberInput's mixed display.
          placeholder="—"
          disabled={disabled}
          onChange={(e) => {
            if (e.target.value) onChange(e.target.value);
          }}
          data-mixed="true"
        />
      </div>
    );
  }

  return (
    <div className="vgai-color-input">
      <ColorSwatchInput
        value={value}
        disabled={disabled}
        // The native picker fires onChange continuously while dragging. Coalesce
        // the whole drag into one undo step (beginInteractiveEdit is idempotent);
        // the gesture closes on blur when the picker is dismissed.
        onChange={(e) => {
          editScope?.begin();
          onChange(e.target.value);
        }}
        onBlur={() => editScope?.end()}
      />
      <TextInput
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setDraft(value);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
    </div>
  );
}
