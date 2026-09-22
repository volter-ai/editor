/**
 * HoverPreview — a rich, anchored preview that opens on hover or keyboard
 * focus of its single trigger child, through {@link AnchoredMenu} (portaled,
 * no focus trap, dismissed on leave/blur/Escape/outside press).
 *
 * This is the design-system's OWNED home for hover-triggered preview
 * behavior, the same way {@link Tooltip} owns hover-triggered text tips:
 * product surfaces declare WHAT previews (`content`), never wire
 * `onMouseEnter`/`onMouseLeave` themselves — the migration guard forbids
 * exactly those handlers outside `primitives/` because hand-rolled hover
 * wiring is how focus parity (a keyboard user must get the same preview) and
 * Escape semantics quietly fork per surface.
 *
 * Where {@link Tooltip} carries a string and a hotkey, HoverPreview carries
 * an arbitrary body (a thumbnail card, a monospace excerpt). Escape closes
 * the preview and STOPS there — the surface around it never also reads that
 * Escape (the first consumer is the chat composer, where Escape would
 * otherwise close the composer itself).
 */

import {
  cloneElement,
  isValidElement,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useId,
  useRef,
  useState,
} from 'react';
import { AnchoredMenu, type AnchoredMenuProps } from './AnchoredMenu';

export interface HoverPreviewProps
  extends Omit<
    AnchoredMenuProps,
    'anchorRef' | 'children' | 'onDismiss' | 'id' | 'role' | 'content'
  > {
  /** The rich preview body, rendered inside the anchored surface. */
  readonly preview: ReactNode;
  /** The single trigger element the preview anchors to. */
  readonly children: ReactElement<{ 'aria-describedby'?: string }>;
}

export function HoverPreview({ preview, children, ...menuProps }: HoverPreviewProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLElement | null>(null);
  const id = useId();

  const close = () => setOpen(false);
  const openAt = (anchor: HTMLElement) => {
    anchorRef.current = anchor;
    setOpen(true);
  };

  let child = children;
  if (isValidElement<{ 'aria-describedby'?: string }>(children)) {
    const describedBy = [children.props['aria-describedby'], open ? id : null]
      .filter(Boolean)
      .join(' ');
    child = cloneElement(children, describedBy ? { 'aria-describedby': describedBy } : {});
  }

  return (
    <span
      className="vgai-tooltip-anchor"
      onMouseEnter={(event) => openAt(event.currentTarget)}
      onMouseLeave={close}
      onFocusCapture={(event) => openAt(event.currentTarget)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close();
      }}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key !== 'Escape' || !open) return;
        // The preview consumed the key; the surface around it must not also
        // read this Escape (e.g. as "close the composer").
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
    >
      {child}
      {open && anchorRef.current && (
        <AnchoredMenu
          {...menuProps}
          anchorRef={anchorRef}
          id={id}
          role="tooltip"
          autoFocusFirst={false}
          onDismiss={close}
        >
          {preview}
        </AnchoredMenu>
      )}
    </span>
  );
}
