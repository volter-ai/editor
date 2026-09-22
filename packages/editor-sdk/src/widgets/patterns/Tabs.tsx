import { type ButtonHTMLAttributes, forwardRef, type HTMLAttributes, type ReactNode } from 'react';

function classes(base: string, className?: string): string {
  return className ? `${base} ${className}` : base;
}

export const EditorTabList = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function EditorTabList({ className, onKeyDown, ...props }, ref) {
    return (
      <div
        {...props}
        ref={ref}
        role="tablist"
        className={classes('vgai-tabs', className)}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented) return;
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          const tabs = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'),
          );
          if (tabs.length === 0) return;
          event.preventDefault();
          const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
          const next =
            event.key === 'Home'
              ? tabs[0]
              : event.key === 'End'
                ? tabs.at(-1)
                : event.key === 'ArrowRight'
                  ? tabs[(current + 1 + tabs.length) % tabs.length]
                  : tabs[(current - 1 + tabs.length) % tabs.length];
          next?.focus();
        }}
      />
    );
  },
);

export interface EditorTabProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  dirty?: boolean;
  badge?: ReactNode;
}

export const EditorTab = forwardRef<HTMLButtonElement, EditorTabProps>(function EditorTab(
  {
    selected = false,
    dirty = false,
    badge,
    className,
    type = 'button',
    tabIndex,
    children,
    ...props
  },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      role="tab"
      tabIndex={tabIndex ?? (selected ? 0 : -1)}
      aria-selected={selected}
      data-selected={selected || undefined}
      className={classes('vgai-tab', className)}
    >
      {dirty && (
        <>
          <span className="vgai-tab-dirty" title="Unsaved" aria-hidden="true" />
          <span className="vgai-sr-only">Unsaved</span>
        </>
      )}
      <span className="vgai-tab-label">{children}</span>
      {badge !== undefined && <span className="vgai-tab-badge">{badge}</span>}
    </button>
  );
});
