import { type ButtonHTMLAttributes, forwardRef } from 'react';

export interface EditorListButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  accent?: 'bar' | 'none';
}

/** Selectable list row with canonical hover, focus, disabled, and selection paint. */
export const EditorListButton = forwardRef<HTMLButtonElement, EditorListButtonProps>(
  function EditorListButton(
    { selected = false, accent = 'bar', className, type = 'button', ...props },
    ref,
  ) {
    return (
      <button
        {...props}
        ref={ref}
        type={type}
        data-selected={selected || undefined}
        data-accent={accent}
        className={className ? `vgai-list-button ${className}` : 'vgai-list-button'}
      />
    );
  },
);
