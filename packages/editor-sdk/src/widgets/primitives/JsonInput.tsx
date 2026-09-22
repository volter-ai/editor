import { useEffect, useRef, useState } from 'react';
import { themeVars } from '../theme';
import { TextInput } from './FormControls';

/**
 * Type-preserving JSON input for the component inspector's raw path.
 *
 * Same invariant as DataPanel's `JsonCell` (W2 hardening, fd9f450c), kept as
 * a separate primitive on purpose — the inspector writes the in-memory scene
 * store, DataPanel writes files; the two systems stay uncoupled:
 * **a commit must never widen a typed value into a JSON string.**
 * `commit()` parses the draft and hands `onCommit` the PARSED value; on parse
 * failure it REFUSES — draft kept, error shown, no write. Unlike the sibling
 * keystroke-live inputs, this commits on blur/Enter only (mid-edit JSON is
 * almost always invalid).
 */
export function JsonInput({
  value,
  onCommit,
  style,
  disabled = false,
}: {
  value: unknown;
  onCommit: (value: unknown) => void;
  style?: React.CSSProperties;
  /** Read-only: the field refuses input. Optional — existing callers unchanged. */
  disabled?: boolean;
}) {
  const display = value === undefined ? '' : JSON.stringify(value);
  const [draft, setDraft] = useState(display);
  const [invalid, setInvalid] = useState(false);
  // Escape below calls `.blur()` imperatively to drop focus, which fires the
  // native blur/focusout event SYNCHRONOUSLY, inside the same handler/render —
  // so the resulting `onBlur={commit}` call closes over the PRE-revert
  // `draft`/`display` (React hasn't re-rendered yet) and would re-derive
  // `invalid: true` right after Escape just cleared it. This ref lets Escape
  // tell the nested commit to no-op instead of racing it.
  const revertingRef = useRef(false);

  // Re-sync when the underlying value changes (undo, another widget, reload).
  useEffect(() => {
    setDraft(display);
    setInvalid(false);
  }, [display]);

  const commit = () => {
    if (revertingRef.current) {
      revertingRef.current = false;
      return;
    }
    if (draft === display) {
      setInvalid(false);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft);
    } catch {
      setInvalid(true); // refuse: keep the draft, no onCommit, no write
      return;
    }
    setInvalid(false);
    onCommit(parsed);
  };

  return (
    <div>
      <TextInput
        data-testid="json-input"
        // Self-styled baseline (I-28): the shared field class means this
        // primitive is never silently unstyled when a caller passes no
        // `style` — callers now only supply layout (width/flex).
        aria-invalid={invalid || undefined}
        data-tone={invalid ? 'danger' : undefined}
        disabled={disabled}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          if (invalid) setInvalid(false);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
          } else if (e.key === 'Escape') {
            revertingRef.current = true;
            setDraft(display);
            setInvalid(false);
            (e.target as HTMLInputElement).blur();
          }
        }}
        style={style}
        title={
          invalid
            ? 'Not valid JSON — nothing written. Fix the JSON or press Escape to revert.'
            : undefined
        }
      />
      {invalid && (
        <div
          data-testid="json-input-error"
          style={{
            fontSize: 'var(--vgai-font-sm)',
            color: themeVars.semantic.danger,
            marginTop: 2,
          }}
        >
          Not valid JSON — nothing written. Fix the JSON or press Escape to revert.
        </div>
      )}
    </div>
  );
}
