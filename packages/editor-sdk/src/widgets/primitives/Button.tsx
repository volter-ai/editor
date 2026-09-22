import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success';
export type ButtonSize = 'compact' | 'default' | 'comfortable';
export type ButtonShape = 'default' | 'segment';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Segment reserves a stable capsule footprint for mode/tool selections. */
  shape?: ButtonShape;
}

export type IconButtonProps = Omit<ButtonProps, 'aria-label'> & {
  'aria-label': string;
  /** Optional visible caption rendered below the icon for labelled toolbars. */
  visibleLabel?: ReactNode;
};

/** Canonical editor button. Visual variants and dimensions live in theme.css. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'default',
    shape = 'default',
    className,
    type = 'button',
    ...props
  },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      className={className ? `vgai-btn ${className}` : 'vgai-btn'}
      data-variant={variant}
      data-size={size}
      data-shape={shape}
    />
  );
});

/** Icon-only button. The accessible name is required by its public type. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { variant = 'ghost', visibleLabel, children, ...props },
  ref,
) {
  return (
    <Button
      {...props}
      ref={ref}
      variant={variant}
      data-icon="true"
      data-label-placement={visibleLabel === undefined ? undefined : 'below'}
    >
      {children}
      {visibleLabel !== undefined && <span className="vgai-icon-button-label">{visibleLabel}</span>}
    </Button>
  );
});
