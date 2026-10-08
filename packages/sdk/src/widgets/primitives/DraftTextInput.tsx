/**
 * A text field whose typing is LOCAL until Enter or blur — the discipline
 * `NumberInput` uses for its typed edits, lifted out for every Inspector row
 * whose `onChange` is a SOURCE WRITE.
 *
 * WHY. A source write remounts the world, and a controlled input that
 * commits per keystroke re-renders from the in-flight value under the
 * typist: the second digit of "50" lands on a field that already reverted to
 * "5" (runhuman pass 49, Grid Size "takes half the value"), a deletion in the
 * name field "would not take" (pass 45). Commit once, on Enter/blur; Escape
 * cancels. While not focused the field tracks the live value, so an external
 * change still shows.
 */

import { type InputHTMLAttributes, useRef, useState } from 'react';
import { TextInput } from './FormControls';

export interface DraftTextInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur'> {
  /** The live value, shown whenever the field is not being edited. */
  readonly value: string;
  /** Fires ONCE per committed edit (Enter or blur) with the final text. Not
   *  called when the text is unchanged. */
  readonly onCommit: (next: string) => void;
}

export function DraftTextInput({
  value,
  onCommit,
  onKeyDown,
  onFocus,
  ...rest
}: DraftTextInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  // Escape blurs, and blur commits — the flag lets the cancel win over the
  // stale draft the blur handler still closes over.
  const cancelled = useRef(false);
  const commit = (): void => {
    if (!cancelled.current && draft !== null && draft !== value) onCommit(draft);
    cancelled.current = false;
    setDraft(null);
  };
  return (
    <TextInput
      {...rest}
      value={draft ?? value}
      onFocus={(event) => {
        setDraft(value);
        onFocus?.(event);
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
        if (event.key === 'Escape') {
          cancelled.current = true;
          (event.target as HTMLInputElement).blur();
        }
        onKeyDown?.(event);
      }}
    />
  );
}
