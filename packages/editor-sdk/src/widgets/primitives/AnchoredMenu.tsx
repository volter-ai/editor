import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { clampRectToViewport } from './clamp-to-viewport';
import { focusFirstMenuItem, Menu, type MenuDismissReason, MenuItem, type MenuProps } from './Menu';
import { ThemeRootPortal } from './ThemeRootPortal';

export interface AnchoredMenuProps extends Omit<MenuProps, 'children' | 'onDismiss' | 'style'> {
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  /** Horizontal edge shared with the trigger. Game-toolbar menus are trailing-aligned. */
  align?: 'start' | 'end';
  /** Which side of the trigger the menu opens toward. A trigger at the bottom
   * of the viewport (a composer control) opens 'top' — upward — so the menu
   * stays on screen. `right` and `left` open BESIDE it with their top edge on
   * the trigger's, which is what a SUBMENU does: its trigger is one row of the
   * menu above it, so opening downward would cover the rows below. `align` is
   * not read for those two — a side placement's cross-axis is the trigger's
   * own top. */
  side?: 'bottom' | 'top' | 'right' | 'left';
  gap?: number;
  /** Slide the placed rect back inside the window when the trigger sits near
   * an edge (`clampRectToViewport`). Opt-in: a trigger that cannot reach an
   * edge keeps the exact shared-edge alignment, which is why this is not the
   * default. */
  clamp?: boolean;
  onDismiss: () => void;
  style?: CSSProperties;
}

/**
 * A menu positioned against a trigger while portaled to the owning theme root.
 *
 * Glass surfaces create containing/stacking contexts through backdrop-filter.
 * A dropdown left inside one cannot out-stack a neighbouring glass card no
 * matter how large its local z-index is. This primitive measures the existing
 * trigger/menu geometry, expresses the same placement in viewport coordinates,
 * and portals the menu to the filter-free theme root. It deliberately does not
 * clamp: callers that can reach a viewport edge own that policy separately via
 * `clampRectToViewport`.
 */
export function AnchoredMenu({
  anchorRef,
  align = 'end',
  side = 'bottom',
  autoFocusFirst = true,
  gap = 4,
  clamp = false,
  onDismiss,
  style,
  children,
  ...props
}: AnchoredMenuProps) {
  const [menuElement, setMenuElement] = useState<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const positionRef = useRef<{ left: number; top: number } | null>(null);
  const restoreFocusOnUnmount = useRef(true);
  const didAutoFocus = useRef(false);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor || !menuElement) return;
    const anchorRect = anchor.getBoundingClientRect();
    const menuRect = menuElement.getBoundingClientRect();
    const beside = side === 'right' || side === 'left';
    const placed = beside
      ? {
          left: side === 'right' ? anchorRect.right + gap : anchorRect.left - gap - menuRect.width,
          top: anchorRect.top,
        }
      : {
          left: align === 'end' ? anchorRect.right - menuRect.width : anchorRect.left,
          top: side === 'top' ? anchorRect.top - gap - menuRect.height : anchorRect.bottom + gap,
        };
    const next = clamp
      ? clampRectToViewport({ ...placed, width: menuRect.width, height: menuRect.height })
      : placed;
    const current = positionRef.current;
    if (current?.left === next.left && current.top === next.top) return;
    positionRef.current = next;
    setPosition(next);
  }, [align, anchorRef, clamp, gap, menuElement, side]);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor || !menuElement) return;
    updatePosition();

    // Portaling changes the menu from anchor-relative CSS geometry to fixed
    // viewport coordinates. Preserve the old continuous attachment contract.
    // ResizeObserver covers size changes but intentionally does not report a
    // position-only reflow, and transforms/layout can move an anchor without
    // emitting window resize or scroll. While this transient menu is open,
    // one animation-frame geometry read is the only complete signal. The
    // ref equality guard above keeps settled frames free of React updates.
    let frame = 0;
    const trackPosition = () => {
      updatePosition();
      frame = requestAnimationFrame(trackPosition);
    };
    frame = requestAnimationFrame(trackPosition);
    window.addEventListener('resize', updatePosition);
    document.addEventListener('scroll', updatePosition, true);
    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePosition);
    resizeObserver?.observe(anchor);
    resizeObserver?.observe(menuElement);
    return () => {
      const restoreFocus =
        restoreFocusOnUnmount.current && menuElement.contains(document.activeElement);
      window.removeEventListener('resize', updatePosition);
      document.removeEventListener('scroll', updatePosition, true);
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      // A selected item unmounts its menu through the caller rather than the
      // Menu dismissal callback. Restore after that commit, while leaving an
      // outside-pointer target in control of focus.
      if (restoreFocus) queueMicrotask(() => anchorRef.current?.focus());
    };
  }, [anchorRef, menuElement, updatePosition]);

  // Drive autofocus HERE, not through Menu's mount-time effect. The menu is
  // `visibility:hidden` until the measure pass sets `position`; a `focus()`
  // into a hidden subtree is refused by the browser and not restored on
  // unhide, so Menu's passive focus fires uselessly on the first commit. Focus
  // once, right after we unhide, guarding against the rAF reposition loop
  // stealing focus back to the first item mid-navigation.
  useLayoutEffect(() => {
    if (!autoFocusFirst || didAutoFocus.current) return;
    if (!menuElement || !position) return;
    didAutoFocus.current = true;
    focusFirstMenuItem(menuElement);
  }, [autoFocusFirst, menuElement, position]);

  const handleDismiss = (reason: MenuDismissReason) => {
    restoreFocusOnUnmount.current = reason !== 'outside';
    onDismiss();
    if (reason === 'escape') anchorRef.current?.focus();
  };

  return (
    <ThemeRootPortal>
      <Menu
        {...props}
        ref={setMenuElement}
        dismissBoundaryRef={anchorRef}
        onDismiss={handleDismiss}
        style={{
          ...style,
          position: 'fixed',
          left: position?.left ?? 0,
          top: position?.top ?? 0,
          visibility: position ? style?.visibility : 'hidden',
        }}
      >
        {children}
      </Menu>
    </ThemeRootPortal>
  );
}

/**
 * A MENU ROW THAT OPENS A MENU OF ITS OWN — the nested half of `Menu`, and the
 * shape every DCC menu bar has (Blender draws `Mesh ▸`, `Light ▸`, `Apply ▸`,
 * `Clear ▸` and `Set Origin ▸` this way; so does every desktop application
 * menu). It lives HERE rather than beside `MenuItem` because it opens an
 * {@link AnchoredMenu}, and `AnchoredMenu` is what imports `Menu` — the other
 * direction would be a cycle.
 *
 * IT OWNS ITS OWN OPEN STATE, which is what makes it a primitive rather than a
 * pattern every caller re-coordinates. Opening is a hover or a click, both of
 * which a person reaches for. CLOSING is the part that is easy to get wrong:
 * the child menu is PORTALED (menus escape glass stacking contexts), so moving
 * the pointer from this row into the menu it just opened fires `pointerleave`
 * on the row. `relatedTarget` is the element being ENTERED, so a leave into
 * this submenu's own subtree is not a leave at all — and a sibling row's hover
 * closes this one by being somewhere else. The subtree is found by a `data`
 * attribute rather than by a ref, because `AnchoredMenu` portals its menu and
 * forwards no handle to it.
 *
 * Choosing a row in the child unmounts the whole tree through the caller's own
 * close, which is why there is no `onSelect` here: this row has no action.
 */
export function MenuSubmenu({
  label,
  children,
  gap = 0,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'onSelect'> & {
  label: ReactNode;
  children: ReactNode;
  /** Passed through to the child menu's placement. */
  gap?: number;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const staysOpen = (node: EventTarget | null): boolean =>
    node instanceof Element &&
    (triggerRef.current?.contains(node) === true ||
      node.closest(`[data-vgai-submenu="${id}"]`) !== null);
  const leave = (event: { relatedTarget: EventTarget | null }): void => {
    if (!staysOpen(event.relatedTarget)) setOpen(false);
  };
  return (
    <>
      <MenuItem
        {...props}
        ref={triggerRef}
        aria-haspopup="menu"
        aria-expanded={open}
        onPointerEnter={() => setOpen(true)}
        onPointerLeave={leave}
        onClick={(event) => {
          // A click on this row OPENS and never selects or closes: the row has
          // no action of its own, so letting the click through would close the
          // whole menu having done nothing, and toggling would close a submenu
          // a person had just pointed at. Blender's submenus behave the same —
          // they close by leaving them or by Escape.
          event.preventDefault();
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setOpen(true);
          }
          if (event.key === 'ArrowLeft') setOpen(false);
        }}
      >
        <span style={{ flex: 1 }}>{label}</span>
        <span aria-hidden="true" style={{ paddingInlineStart: 'var(--vgai-space-4)' }}>
          ▸
        </span>
      </MenuItem>
      {open && (
        <AnchoredMenu
          anchorRef={triggerRef}
          data-vgai-submenu={id}
          side="right"
          gap={gap}
          clamp
          autoFocusFirst={false}
          onDismiss={() => setOpen(false)}
          onPointerLeave={leave}
        >
          {children}
        </AnchoredMenu>
      )}
    </>
  );
}
