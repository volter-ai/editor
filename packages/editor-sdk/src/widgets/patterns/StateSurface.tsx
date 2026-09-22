import type { HTMLAttributes, ReactNode } from 'react';

export type StateSurfaceTone = 'neutral' | 'loading' | 'error' | 'success';

export interface StateSurfaceProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  tone?: StateSurfaceTone;
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}

export function StateSurface({
  tone = 'neutral',
  icon,
  title,
  description,
  action,
  compact = false,
  className,
  ...props
}: StateSurfaceProps) {
  const defaultRole =
    tone === 'error' ? 'alert' : tone === 'loading' || tone === 'success' ? 'status' : undefined;
  return (
    <div
      {...props}
      role={props.role ?? defaultRole}
      data-tone={tone}
      data-compact={compact || undefined}
      className={className ? `vgai-state-surface ${className}` : 'vgai-state-surface'}
    >
      {icon && <div className="vgai-state-surface-icon">{icon}</div>}
      <strong className="vgai-state-surface-title">{title}</strong>
      {description && <div className="vgai-state-surface-description">{description}</div>}
      {action && <div className="vgai-state-surface-action">{action}</div>}
    </div>
  );
}
