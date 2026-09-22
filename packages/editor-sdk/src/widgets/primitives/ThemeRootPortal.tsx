import { type ReactNode, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Portal children to the nearest `.vgai-editor-theme` root — the same target
 * resolution `Tooltip` uses (`Tooltip.tsx`), extracted for `position: fixed`
 * overlays that open from inside a panel (context menus).
 *
 * Why this exists (Glass-UI spike, W6 — work item 6): `backdrop-filter` (like
 * `filter`/`transform`) makes an element the containing block for ALL
 * positioned descendants, including `position: fixed`. An inline
 * fixed-position menu inside a treated floating card would position relative
 * to the card — at the wrong place — and be clipped by the card's `overflow:
 * hidden`. The theme root carries no filter, so a menu portaled here keeps
 * viewport-correct client coordinates under every workspace layout and
 * theme treatment.
 *
 * THE PORTAL RECORDS WHERE IT CAME FROM, and that is what makes a portaled
 * overlay reachable through the surface that opened it. The anchor span below
 * already sits IN PLACE — it is how the theme root is found — so the two ends
 * carry the same generated id: `data-vgai-portal` where the portal was
 * written, `data-vgai-portal-content` on what it wrote. `editor-document-probe`
 * walks that pair, so `editor.document.click` can drive a menu a DOCUMENT
 * opened without being able to reach one the editor's own chrome opened. Its
 * own header used to say the DOM records no ownership and that any heuristic
 * wide enough would over-reach; this is the ownership, stated rather than
 * guessed. A `display: contents` wrapper generates no box, so nothing about
 * where a `position: fixed` child lands changes.
 */
export function ThemeRootPortal({ children }: { children: ReactNode }) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [portalRoot, setPortalRoot] = useState<Element | null>(null);
  const id = useId();

  useLayoutEffect(() => {
    setPortalRoot(anchorRef.current?.closest('.vgai-editor-theme') ?? null);
  }, []);

  return (
    <>
      <span ref={anchorRef} data-vgai-portal={id} style={{ display: 'none' }} />
      {portalRoot
        ? createPortal(
            <div data-vgai-portal-content={id} style={{ display: 'contents' }}>
              {children}
            </div>,
            portalRoot,
          )
        : null}
    </>
  );
}
