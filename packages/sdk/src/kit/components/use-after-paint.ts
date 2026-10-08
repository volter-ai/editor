/**
 * "Mount this AFTER the browser has painted the commit that asked for it."
 *
 * The inspector's live preview is the case this exists for: its mount effect
 * builds a scene snapshot and draws the first frame, and React runs that effect
 * in the SAME task as the selection commit — so the card, the name and the
 * preview all appeared together, whenever the preview was finally done. Gating
 * the heavy child on this hook lets the commit paint first; the picture arrives
 * in a later frame and nothing is waiting on it.
 *
 * Two frames, not one: the first `requestAnimationFrame` callback runs BEFORE
 * the paint of the commit that scheduled it, so only the second is past it.
 * `startTransition` is the wrong tool here — the work is not React rendering,
 * it is a `useEffect` doing GL work, which a transition does not defer.
 *
 * `key` identifies what is being waited for (a subject id, a preview key). It
 * matters because these hosts are RE-RENDERED rather than remounted as the
 * selection changes: comparing against the key that became ready is what makes
 * the next subject wait again instead of inheriting the last one's readiness.
 *
 * Callers put the gate where their PLACEHOLDER is — the mini card's preview
 * shows its quiet kind glyph, the section body shows its empty box — which is
 * why this is a hook and not a wrapper component with one built-in fallback.
 */

import { useEffect, useState } from 'react';

export function useAfterPaint(key: string): boolean {
  const [readyKey, setReadyKey] = useState<string | null>(null);
  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setReadyKey(key));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [key]);
  return readyKey === key;
}
