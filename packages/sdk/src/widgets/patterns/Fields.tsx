import type { HTMLAttributes, LabelHTMLAttributes, ReactNode } from 'react';

function classes(base: string, className?: string): string {
  return className ? `${base} ${className}` : base;
}

export function FieldGroup({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={classes('volter-field-group', className)} />;
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
      className={classes('volter-field-row', className)}
    >
      <label htmlFor={htmlFor} className="volter-field-label">
        {label}
      </label>
      <div className="volter-field-control">{children}</div>
      {hint && <div className="volter-field-hint">{hint}</div>}
    </div>
  );
}

export function FieldLabel({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label {...props} className={classes('volter-field-label', className)} />;
}
