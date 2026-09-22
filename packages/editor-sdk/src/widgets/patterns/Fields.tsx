import type { HTMLAttributes, LabelHTMLAttributes, ReactNode } from 'react';

function classes(base: string, className?: string): string {
  return className ? `${base} ${className}` : base;
}

export function FieldGroup({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={classes('vgai-field-group', className)} />;
}

export interface FieldRowProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  compact?: boolean;
}

export function FieldRow({
  label,
  htmlFor,
  hint,
  compact = false,
  className,
  children,
  ...props
}: FieldRowProps) {
  return (
    <div
      {...props}
      data-compact={compact || undefined}
      className={classes('vgai-field-row', className)}
    >
      <label htmlFor={htmlFor} className="vgai-field-label">
        {label}
      </label>
      <div className="vgai-field-control">{children}</div>
      {hint && <div className="vgai-field-hint">{hint}</div>}
    </div>
  );
}

export function FieldLabel({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label {...props} className={classes('vgai-field-label', className)} />;
}
