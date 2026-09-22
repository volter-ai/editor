import { type HTMLAttributes, type LabelHTMLAttributes, type ReactNode, useState } from 'react';
import { createPortal } from 'react-dom';
import { Actions, Inline, Stack } from '../primitives/Layout';
import { Text } from '../primitives/Text';

function classes(base: string, className?: string): string {
  return className ? `${base} ${className}` : base;
}

export interface DialogProps extends HTMLAttributes<HTMLDivElement> {
  labelledBy: string;
  onDismiss?: () => void;
  size?: 'compact' | 'default' | 'wide';
  variant?: 'default' | 'command';
}

/** Modal editor surface. The scrim, sizing, elevation, and spacing are one recipe. */
export function Dialog({
  labelledBy,
  onDismiss,
  size = 'default',
  variant = 'default',
  className,
  ...props
}: DialogProps) {
  // F10/F11 (U6.5): the `position: fixed` scrim must anchor to the window, not
  // to whatever ancestor happens to be its containing block. Rendered inline it
  // sat inside `#editor-root` (z-index 10), so the islands-mode footer/session
  // tray (`#editor-bottom`, z-index 100) painted OVER the scrim (F10); and under
  // a glass theme a card's `backdrop-filter` became the fixed scrim's containing
  // block, collapsing `inset: 0` to a ~40px box and shoving the dialog off the
  // top edge (F11). Portaling to the filter-free theme root — a sibling of
  // `#editor-bottom` — makes `inset: 0` resolve to the viewport (full-cover
  // scrim, correctly centered dialog) and lets the scrim's z-index win. Falls
  // back to inline rendering when no theme root is present (isolated unit tests).
  //
  // R2 / 42:608 (P6-U7): resolve the portal root SYNCHRONOUSLY on the first
  // render (lazy `useState` init) rather than in a post-mount layout effect.
  // The former effect-based null→portal flip re-committed the scrim ONE render
  // after mount, which — because switching an element between inline and a
  // `createPortal` boundary remounts its DOM subtree — destroyed and recreated
  // any child input right after a consumer's mount-time autofocus ran. That is
  // exactly why Ctrl+K opened the Command Palette with its search box unfocused
  // (focus fell to <body>), so typed text and Enter went nowhere and no
  // document opened. The editor mounts a single `.vgai-editor-theme` root at
  // app init, long before any Dialog opens, so a plain `document.querySelector`
  // finds it on render 1 — the scrim portals from the start, the input mounts
  // once, and focus is preserved.
  const [portalRoot] = useState<Element | null>(() =>
    typeof document === 'undefined' ? null : document.querySelector('.vgai-editor-theme'),
  );

  const scrim = (
    <div
      className="vgai-dialog-scrim"
      data-variant={variant}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onDismiss?.();
      }}
    >
      <div
        {...props}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        data-size={size}
        data-variant={variant}
        className={classes('vgai-dialog', className)}
      />
    </div>
  );

  return portalRoot ? createPortal(scrim, portalRoot) : scrim;
}

export function DialogHeader({
  titleId,
  title,
  description,
}: {
  titleId: string;
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <Stack className="vgai-dialog-header" gap={2}>
      <Text id={titleId} as="h2" variant="heading">
        {title}
      </Text>
      {description && (
        <Text as="p" tone="muted">
          {description}
        </Text>
      )}
    </Stack>
  );
}

export function DialogBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <Stack {...props} className={classes('vgai-dialog-body', className)} />;
}

export function DialogFooter({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <Actions {...props} className={classes('vgai-dialog-footer', className)}>
      {children}
    </Actions>
  );
}

export function DialogField({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label {...props} className={classes('vgai-dialog-field', className)} />;
}

export function DialogFieldLabel({ children }: { children: ReactNode }) {
  return (
    <Text variant="label" tone="muted">
      {children}
    </Text>
  );
}

export function JoinedField({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <Inline {...props} className={classes('vgai-joined-field', className)} />;
}

export function JoinedFieldSuffix({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span {...props} className={classes('vgai-joined-field-suffix', className)} />;
}
