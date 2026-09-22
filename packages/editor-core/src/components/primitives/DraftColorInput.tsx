/**
 * A colour swatch whose picking is LOCAL until the pick is COMMITTED — the
 * discipline {@link DraftTextInput} applies to every Inspector row whose
 * `onChange` is a SOURCE WRITE, for the one control that could not use it.
 *
 * WHY. A native `<input type="color">` fires `input` continuously while the
 * user drags inside the picker, and React's `onChange` maps to that event. The
 * Inspector's colour row wrote SOURCE per event, so one colour pick queued a
 * burst of writes and remounts: the field re-rendered from the old source
 * value under the picker, the last write carried the pre-edit colour, and the
 * refusal that followed marked the path dynamic — which greys the swatch until
 * the next remount. Two human passes reported it the same way ("the colour
 * changes just once, then I can't select colour again"; "change the colour to
 * red — that did not work").
 *
 * The native `change` event is the pick's own commit (fired when the picker
 * closes, and immediately for a programmatic set), so it is what writes. While
 * the picker is open the swatch shows the draft; when it is not being edited
 * the swatch tracks the live value, so an external change still shows.
 */

import { ColorSwatchInput } from '@volter/editor-sdk/widgets';
import { type InputHTMLAttributes, useEffect, useRef, useState } from 'react';

export interface DraftColorInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  /** The live value, shown whenever the swatch is not being picked. */
  readonly value: string;
  /** Fires ONCE per committed pick, with the final colour. Not called when
   *  the colour is unchanged. */
  readonly onCommit: (next: string) => void;
  /** Fires on EVERY value the picker streams while it is open, so the viewport
   *  follows the pointer. Live-only: the commit above is what persists. */
  readonly onPreview?: (next: string) => void;
}

export function DraftColorInput({ value, onCommit, onPreview, ...rest }: DraftColorInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const element = useRef<HTMLInputElement | null>(null);
  // The value this pick STARTED from. A live preview makes `value` follow the
  // draft (the object really is that colour now), so comparing the commit
  // against `value` would find nothing changed and never persist — the commit
  // must be measured against where the pick began.
  const startValue = useRef<string | null>(null);
  // The commit event is NATIVE `change`; React's onChange is the `input`
  // stream, so this listener cannot be expressed as a prop.
  const latest = useRef({ draft, onCommit });
  latest.current = { draft, onCommit };
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    const commit = (): void => {
      const { draft: picked, onCommit: commitTo } = latest.current;
      const next = picked ?? node.value;
      if (next && next !== startValue.current) commitTo(next);
      startValue.current = null;
      setDraft(null);
    };
    node.addEventListener('change', commit);
    return () => node.removeEventListener('change', commit);
  }, []);
  return (
    <ColorSwatchInput
      {...rest}
      ref={element}
      value={draft ?? value}
      onChange={(event) => {
        if (startValue.current === null) startValue.current = value;
        setDraft(event.target.value);
        onPreview?.(event.target.value);
      }}
    />
  );
}
