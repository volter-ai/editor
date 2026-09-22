import type React from 'react';
import { fontWeight, space, themeVars } from '../theme';

/**
 * Shared typography and metrics for panel titles and disclosure sections.
 *
 * The heights are the VARS, not `chromeSize`'s constants: a material may
 * retune the chrome's density, and the constant is only the editor's own
 * default. Read at module load it cannot learn the active material — the
 * Blender material declares a 26px panel header and every Panel still drew
 * the default 30, because `--vgai-panel-header-height` (which does carry the
 * material's value) was not what this style read.
 */
export const panelHeaderLabelStyle: React.CSSProperties = {
  minHeight: 'var(--vgai-panel-header-height)',
  padding: `0 ${space[4]}px`,
  color: themeVars.content.muted,
  fontSize: 'var(--vgai-font-base)',
  fontWeight: fontWeight.semibold,
  textTransform: 'uppercase',
  display: 'flex',
  alignItems: 'center',
  gap: space[2],
  userSelect: 'none',
};

/** Disclosure rows are one density step below full panel headers. */
export const sectionHeaderLabelStyle: React.CSSProperties = {
  ...panelHeaderLabelStyle,
  minHeight: 'var(--vgai-local-toolbar-height)',
};

/** Complete header rail treatment for a standalone panel. Glass treatments
 *  emit a transparent structural surface; opaque/reduced-transparency themes
 *  retain their occluding stack through the same variable. Headers never
 *  own the content-frost filter. */
export const panelHeaderStyle: React.CSSProperties = {
  ...panelHeaderLabelStyle,
  background: 'var(--vgai-surface-sticky)',
  borderBottom: '1px solid var(--vgai-structural-divider)',
  flexShrink: 0,
};
