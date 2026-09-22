import {
  type ButtonHTMLAttributes,
  forwardRef,
  type HTMLAttributes,
  type RefObject,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';

function classes(base: string, className?: string): string {
  return className ? `${base} ${className}` : base;
}

export interface MenuProps extends HTMLAttributes<HTMLDivElement> {
  autoFocusFirst?: boolean;
  /** Optional trigger/anchor that counts as part of the menu's dismissal boundary.
   * Portaled menus need this so pressing their trigger closes them once instead
   * of the document-level outside handler closing on pointerdown and the
   * trigger's click immediately reopening them. */
  dismissBoundaryRef?: RefObject<HTMLElement | null>;
  onDismiss?: (reason: MenuDismissReason) => void;
}

export type MenuDismissReason = 'escape' | 'outside';

function enabledItems(menu: HTMLDivElement): HTMLElement[] {
  return Array.from(
    menu.querySelectorAll<HTMLElement>(
      '[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled), [role="menuitemcheckbox"]:not(:disabled)',
    ),
  );
}

/** Focus a menu's first enabled item. Exported so a portaled owner (AnchoredMenu)
 * can drive autofocus AFTER it unhides: browsers refuse `focus()` inside a
 * `visibility:hidden` subtree and never restore it on unhide, so the passive
 * mount-time effect below fires too early for a measure-then-show menu. */
export function focusFirstMenuItem(menu: HTMLDivElement): void {
  enabledItems(menu)[0]?.focus();
}

export const Menu = forwardRef<HTMLDivElement, MenuProps>(function Menu(
  {
    className,
    role = 'menu',
    autoFocusFirst = false,
    dismissBoundaryRef,
    onDismiss,
    onKeyDown,
    ...props
  },
  ref,
) {
  const localRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => localRef.current as HTMLDivElement);
  useEffect(() => {
    if (autoFocusFirst) enabledItems(localRef.current as HTMLDivElement)[0]?.focus();
  }, [autoFocusFirst]);
  useEffect(() => {
    if (!onDismiss) return;
    const dismissOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!localRef.current?.contains(target) && !dismissBoundaryRef?.current?.contains(target)) {
        onDismiss('outside');
      }
    };
    document.addEventListener('pointerdown', dismissOutside);
    return () => document.removeEventListener('pointerdown', dismissOutside);
  }, [dismissBoundaryRef, onDismiss]);

  return (
    <div
      {...props}
      ref={localRef}
      role={role}
      className={classes('vgai-menu', className)}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          onDismiss?.('escape');
          return;
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const items = enabledItems(event.currentTarget);
        if (items.length === 0) return;
        const current = items.indexOf(document.activeElement as HTMLElement);
        if (event.key === 'Home') items[0]?.focus();
        else if (event.key === 'End') items.at(-1)?.focus();
        else if (event.key === 'ArrowDown')
          items[(current + 1 + items.length) % items.length]?.focus();
        else items[(current - 1 + items.length) % items.length]?.focus();
      }}
    />
  );
});

export type MenuItemProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  onSelect?: (() => void) | undefined;
};

export const MenuItem = forwardRef<HTMLButtonElement, MenuItemProps>(function MenuItem(
  { className, type = 'button', role = 'menuitem', onClick, onSelect, ...props },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      role={role}
      className={classes('vgai-menu-item', className)}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onSelect?.();
      }}
    />
  );
});

export function MenuSeparator(props: HTMLAttributes<HTMLHRElement>) {
  return <hr {...props} className={classes('vgai-menu-separator', props.className)} />;
}

export const MenuTrigger = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  function MenuTrigger({ className, type = 'button', ...props }, ref) {
    return (
      <button
        {...props}
        ref={ref}
        type={type}
        aria-haspopup={props['aria-haspopup'] ?? 'menu'}
        className={classes('vgai-menu-trigger', className)}
      />
    );
  },
);
