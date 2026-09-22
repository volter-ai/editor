import { type ComponentType, type ElementType, forwardRef, type HTMLAttributes } from 'react';

export type TextVariant = 'caption' | 'body' | 'label' | 'title' | 'heading' | 'display' | 'code';
export type TextTone = 'primary' | 'muted' | 'dim' | 'accent' | 'danger' | 'warning' | 'success';

export interface TextProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  variant?: TextVariant;
  tone?: TextTone;
  truncate?: boolean;
  selectable?: boolean;
}

function classes(base: string, className?: string): string {
  return className ? `${base} ${className}` : base;
}

/** Semantic editor typography. Product surfaces choose a role, never a px size. */
export const Text = forwardRef<HTMLElement, TextProps>(function Text(
  {
    as: Component = 'span',
    variant = 'body',
    tone = 'primary',
    truncate = false,
    selectable = false,
    className,
    ...props
  },
  ref,
) {
  // `as` is polymorphic, so TS intersects props across EVERY member of
  // `ElementType`. That intersection collapses to `never` the moment the JSX
  // namespace grows — which it now does: the R3F design session pulls
  // `@react-three/fiber`'s `IntrinsicElements` augmentation into the editor's
  // program, and `ref`/`className` stopped being assignable here with no
  // change to this file. Narrow the callee to the prop shape this component
  // actually documents in `TextProps`.
  const Element = Component as ComponentType<Record<string, unknown>>;
  return (
    <Element
      {...props}
      ref={ref}
      data-variant={variant}
      data-tone={tone}
      data-truncate={truncate || undefined}
      data-selectable={selectable || undefined}
      className={classes('vgai-text', className)}
    />
  );
});

export function Keycap({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <kbd {...props} className={classes('vgai-keycap', className)} />;
}
