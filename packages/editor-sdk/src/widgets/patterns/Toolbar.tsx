import { forwardRef, type HTMLAttributes } from 'react';

function classes(base: string, className?: string): string {
  return className ? `${base} ${className}` : base;
}

export interface EditorToolbarProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  compact?: boolean;
  /** Independent controls may be active together; single-selection toolbars emphasize one choice. */
  selectionMode?: 'independent' | 'single';
}

export const EditorToolbar = forwardRef<HTMLDivElement, EditorToolbarProps>(function EditorToolbar(
  { label, compact = false, selectionMode = 'independent', className, ...props },
  ref,
) {
  return (
    <div
      {...props}
      ref={ref}
      role="toolbar"
      aria-label={label}
      data-compact={compact || undefined}
      data-selection-mode={selectionMode}
      className={classes('vgai-toolbar', className)}
    />
  );
});

export function ToolbarGroup({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} role="group" className={classes('vgai-toolbar-group', className)} />;
}

export function ToolbarDivider(props: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      {...props}
      aria-hidden="true"
      className={classes('vgai-toolbar-divider', props.className)}
    />
  );
}

/** Viewport-local tool cluster. Placement remains the viewport's
 * responsibility. `vgai-glass-island` opts the cluster into the refraction
 * engine's opt-in island surface set (P6 — glass-native chrome): under a
 * glass theme on a capable GPU it carries its own url() displacement
 * chain; everywhere else the class is inert and the var-driven
 * `.vgai-floating-toolbar` paint decides (including inside floating cards,
 * where the engine refuses islands — one filter per card). */
export function FloatingToolbar({ className, onPointerDownCapture, ...props }: EditorToolbarProps) {
  return (
    <EditorToolbar
      {...props}
      compact
      className={classes('vgai-floating-toolbar vgai-glass-island', className)}
      onPointerDownCapture={(event) => {
        onPointerDownCapture?.(event);
        // Viewport floating toolbars live inside the element owned by
        // OrbitControls. Without this capture boundary, OrbitControls sees a
        // button pointerdown, captures the pointer to the viewport container,
        // and the button never receives the matching pointerup/click.
        event.stopPropagation();
      }}
    />
  );
}

export function SplitButtonGroup({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} role="group" className={classes('vgai-split-button', className)} />;
}
