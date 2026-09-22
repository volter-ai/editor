import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';

export type LayoutGap = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12;
export type LayoutAlignment = 'start' | 'center' | 'end' | 'stretch' | 'baseline';
export type LayoutJustification = 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly';

interface LayoutProps extends HTMLAttributes<HTMLDivElement> {
  gap?: LayoutGap;
  align?: LayoutAlignment;
  justify?: LayoutJustification;
  padding?: LayoutGap;
  paddingX?: LayoutGap;
  paddingY?: LayoutGap;
}

const alignValue: Record<LayoutAlignment, CSSProperties['alignItems']> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
  baseline: 'baseline',
};

const justifyValue: Record<LayoutJustification, CSSProperties['justifyContent']> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
  around: 'space-around',
  evenly: 'space-evenly',
};

function token(value: LayoutGap | undefined): string | undefined {
  return value === 0 ? '0px' : value === undefined ? undefined : `var(--vgai-space-${value})`;
}

function layoutStyle({
  gap,
  align,
  justify,
  padding,
  paddingX,
  paddingY,
  style,
}: LayoutProps): CSSProperties {
  return {
    gap: token(gap),
    alignItems: align ? alignValue[align] : undefined,
    justifyContent: justify ? justifyValue[justify] : undefined,
    padding: token(padding),
    paddingInline: token(paddingX),
    paddingBlock: token(paddingY),
    ...style,
  };
}

function classes(base: string, className?: string): string {
  return className ? `${base} ${className}` : base;
}

export function Stack({ className, ...props }: LayoutProps) {
  return <div {...props} className={classes('vgai-stack', className)} style={layoutStyle(props)} />;
}

export function Inline({ className, ...props }: LayoutProps) {
  return (
    <div {...props} className={classes('vgai-inline', className)} style={layoutStyle(props)} />
  );
}

export function Spacer({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span {...props} aria-hidden="true" className={classes('vgai-spacer', className)} />;
}

export function Divider({
  orientation = 'horizontal',
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { orientation?: 'horizontal' | 'vertical' }) {
  return (
    <div
      {...props}
      aria-hidden="true"
      data-orientation={orientation}
      className={classes('vgai-divider', className)}
    />
  );
}

export function Actions({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <Inline {...props} className={classes('vgai-actions', className)} gap={2} align="center">
      {children}
    </Inline>
  );
}
