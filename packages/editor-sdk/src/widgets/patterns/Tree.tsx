import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';

function classes(base: string, className?: string): string {
  return className ? `${base} ${className}` : base;
}

export interface EditorTreeProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
}

export const EditorTree = forwardRef<HTMLDivElement, EditorTreeProps>(function EditorTree(
  { label, className, ...props },
  ref,
) {
  return (
    <div
      {...props}
      ref={ref}
      role="tree"
      aria-label={label}
      className={classes('vgai-tree', className)}
    />
  );
});

export interface EditorTreeRowProps extends HTMLAttributes<HTMLDivElement> {
  level?: number;
  selected?: boolean;
  expanded?: boolean | undefined;
  muted?: boolean;
  dragging?: boolean;
  leading?: ReactNode;
  actions?: ReactNode;
}

export const EditorTreeRow = forwardRef<HTMLDivElement, EditorTreeRowProps>(function EditorTreeRow(
  {
    level = 1,
    selected = false,
    expanded,
    muted = false,
    dragging = false,
    leading,
    actions,
    className,
    children,
    style,
    ...props
  },
  ref,
) {
  return (
    <div
      {...props}
      ref={ref}
      role="treeitem"
      tabIndex={props.tabIndex ?? -1}
      aria-level={level}
      aria-selected={selected}
      {...(expanded === undefined ? {} : { 'aria-expanded': expanded })}
      data-selected={selected || undefined}
      data-muted={muted || undefined}
      data-dragging={dragging || undefined}
      className={classes('vgai-tree-row', className)}
      style={{ paddingLeft: 6 + Math.max(0, level - 1) * 14, ...style }}
    >
      {leading && <span className="vgai-tree-row-leading">{leading}</span>}
      <span className="vgai-tree-row-label">{children}</span>
      {actions && <span className="vgai-tree-row-actions">{actions}</span>}
    </div>
  );
});
