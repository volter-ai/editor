import type React from 'react';
import { space } from '../theme';
import { panelHeaderStyle } from './panel-header-styles';

interface PanelOwnProps {
  name: React.ReactNode;
  actions?: React.ReactNode;
  onHeaderClick?: () => void;
  /** The dock host already names permanent panels in its tab strip. Hide the
   * legacy embedded header there to avoid two consecutive titles for one
   * surface while retaining Panel's content/layout behavior. */
  hideHeader?: boolean;
}

type PanelProps = PanelOwnProps &
  Omit<React.HTMLAttributes<HTMLDivElement>, keyof PanelOwnProps> & {
    /** React 19 ref-as-prop, forwarded onto the panel's own scroll/root div. */
    ref?: React.Ref<HTMLDivElement>;
  };

export function Panel({
  name,
  actions,
  onHeaderClick,
  hideHeader = false,
  style,
  children,
  ...rest
}: PanelProps) {
  return (
    <div
      {...rest}
      style={{
        // No surface fill of its own (§2.31 transparent-interiors wave): the
        // hosting dock group / floating card layer carries the themed panel
        // surface. A Panel that floats free of any painted surface opts into
        // one locally via `style` (see the design-system stories).
        display: 'flex',
        flexDirection: 'column',
        pointerEvents: 'auto',
        ...style,
      }}
    >
      {!hideHeader && (
        <div
          role={onHeaderClick ? 'button' : undefined}
          tabIndex={onHeaderClick ? 0 : undefined}
          onClick={onHeaderClick}
          onKeyDown={
            onHeaderClick
              ? (e) => {
                  if (e.key === 'Enter') onHeaderClick();
                }
              : undefined
          }
          style={{
            ...panelHeaderStyle,
            cursor: onHeaderClick ? 'pointer' : undefined,
            pointerEvents: 'auto',
          }}
        >
          <span style={{ flexShrink: 0 }}>{name}</span>
          {actions && (
            <div
              style={{
                marginLeft: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: space[3],
              }}
            >
              {actions}
            </div>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
