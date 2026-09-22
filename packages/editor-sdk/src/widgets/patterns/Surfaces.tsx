import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';

function classes(base: string, className?: string): string {
  return className ? `${base} ${className}` : base;
}

export type EditorTone = 'info' | 'warning' | 'error' | 'success';
export type EditorSurfaceVariant = 'shell' | 'panel' | 'chrome' | 'raised' | 'inset' | 'overlay';

export interface EditorSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  variant?: EditorSurfaceVariant;
  border?: boolean;
  scroll?: boolean;
}

export function EditorSurface({
  variant = 'panel',
  border = false,
  scroll = false,
  className,
  ...props
}: EditorSurfaceProps) {
  return (
    <div
      {...props}
      data-variant={variant}
      data-border={border || undefined}
      data-scroll={scroll || undefined}
      className={classes('vgai-surface', className)}
    />
  );
}

export interface EditorBannerProps extends HTMLAttributes<HTMLDivElement> {
  tone?: EditorTone;
  icon?: ReactNode;
  actions?: ReactNode;
}

export function EditorBanner({
  tone = 'info',
  icon,
  actions,
  className,
  children,
  ...props
}: EditorBannerProps) {
  return (
    <div
      {...props}
      role={tone === 'error' ? 'alert' : 'status'}
      data-tone={tone}
      className={classes('vgai-banner', className)}
    >
      {icon && <span className="vgai-banner-icon">{icon}</span>}
      <div className="vgai-banner-content">{children}</div>
      {actions && <div className="vgai-banner-actions">{actions}</div>}
    </div>
  );
}

export const EditorPopover = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function EditorPopover({ className, ...props }, ref) {
    return <div ref={ref} {...props} className={classes('vgai-popover', className)} />;
  },
);

export interface EditorBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** Labels are the safe default. Use count only for compact numeric counters. */
  shape?: 'label' | 'count';
}

export function EditorBadge({ shape = 'label', className, ...props }: EditorBadgeProps) {
  return <span {...props} data-shape={shape} className={classes('vgai-badge', className)} />;
}

export interface DropIndicatorProps extends HTMLAttributes<HTMLDivElement> {
  position?: 'before' | 'inside' | 'after';
}

export function DropIndicator({ position = 'inside', className, ...props }: DropIndicatorProps) {
  return (
    <div
      {...props}
      aria-hidden="true"
      data-position={position}
      className={classes('vgai-drop-indicator', className)}
    />
  );
}

export interface ResizeHandleProps extends HTMLAttributes<HTMLDivElement> {
  orientation: 'horizontal' | 'vertical';
  label: string;
  valueNow?: number;
  valueMin?: number;
  valueMax?: number;
}

export function ResizeHandle({
  orientation,
  label,
  valueNow,
  valueMin = 0,
  valueMax = 100,
  className,
  ...props
}: ResizeHandleProps) {
  return (
    <div
      {...props}
      role="separator"
      aria-label={label}
      aria-orientation={orientation}
      aria-valuenow={valueNow}
      aria-valuemin={valueNow === undefined ? undefined : valueMin}
      aria-valuemax={valueNow === undefined ? undefined : valueMax}
      data-orientation={orientation}
      className={classes('vgai-resize-handle', className)}
    />
  );
}
