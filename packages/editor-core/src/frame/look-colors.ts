/**
 * THE LOOK'S COLOURS AS THE WORKBENCH'S — what the frame applies as colour customizations on the
 * look's own settings layer (`workbench/src/vgaiSettings.ts`), so a look with no colour theme
 * of its own still colours the whole window, and the 3D viewport's colours are theme colours
 * a person can override (`workbench/src/vgaiColors.ts`, `vgai.viewport.*`, `vgai.gizmo.*`).
 *
 * ONE SOURCE. Every value is read off the look's own emitted tokens on the chrome root — the
 * palette as the page already resolved it — so this module holds a MAPPING and no colour.
 *
 * THE CHROME ROWS are transcribed from `theme-blender`, the one colour theme this repository
 * ships: each is an id whose traced value there IS a palette member's (62 of its 173 — the
 * rest are traced from Blender separately and stay that theme's). Past those, only the chrome
 * a look must colour to read as itself — foreground, the bars, the side bar, tabs, inputs and
 * menus — each on the palette role that already paints the same surface in our own panels.
 * A token the look leaves empty emits no id, so the workbench keeps its own there.
 */

/** Workbench colour id → the token it reads, with an optional alpha suffix (two hex digits). */
const CHROME: readonly (readonly [string, string, string?])[] = [
  // Transcribed from `theme-blender` (the ids whose value is a palette member there).
  ['descriptionForeground', '--vgai-content-dim'],
  ['disabledForeground', '--vgai-content-placeholder'],
  ['errorForeground', '--vgai-danger'],
  ['focusBorder', '--vgai-accent'],
  ['selection.background', '--vgai-accent', '99'],
  ['sash.hoverBorder', '--vgai-accent'],
  ['menubar.selectionBackground', '--vgai-accent'],
  ['menubar.selectionForeground', '--vgai-content-on-accent'],
  ['menu.selectionBackground', '--vgai-accent'],
  ['menu.selectionForeground', '--vgai-content-on-accent'],
  ['editorGroupHeader.tabsBackground', '--vgai-surface-chrome'],
  ['editorGroup.dropBackground', '--vgai-accent', '66'],
  ['tab.inactiveBackground', '--vgai-surface-chrome'],
  ['tab.inactiveForeground', '--vgai-content-dim'],
  ['editor.background', '--vgai-surface-chrome'],
  ['editorLineNumber.foreground', '--vgai-content-placeholder'],
  ['editor.selectionBackground', '--vgai-accent', '99'],
  ['editorGutter.background', '--vgai-surface-chrome'],
  ['panelTitle.inactiveForeground', '--vgai-content-dim'],
  ['list.activeSelectionBackground', '--vgai-accent'],
  ['list.activeSelectionForeground', '--vgai-content-on-accent'],
  ['list.focusOutline', '--vgai-accent'],
  ['list.dropBackground', '--vgai-accent', '66'],
  ['button.background', '--vgai-accent'],
  ['button.foreground', '--vgai-content-on-accent'],
  ['checkbox.selectBackground', '--vgai-accent'],
  ['input.background', '--vgai-surface-chrome'],
  ['input.placeholderForeground', '--vgai-content-placeholder'],
  ['inputOption.activeBackground', '--vgai-accent'],
  ['inputOption.activeForeground', '--vgai-content-on-accent'],
  ['inputValidation.errorBorder', '--vgai-danger'],
  ['badge.background', '--vgai-accent'],
  ['badge.foreground', '--vgai-content-on-accent'],
  ['progressBar.background', '--vgai-accent'],
  ['quickInputList.focusBackground', '--vgai-accent'],
  ['quickInputList.focusForeground', '--vgai-content-on-accent'],
  ['notificationsErrorIcon.foreground', '--vgai-danger'],
  ['notificationsWarningIcon.foreground', '--vgai-warn'],
  ['notificationsInfoIcon.foreground', '--vgai-accent'],
  ['terminal.background', '--vgai-surface-chrome'],
  ['commandCenter.background', '--vgai-surface-chrome'],
  ['vgai.view.background', '--vgai-surface-panel'],
  // The chrome a look must colour to read as itself, on the role that paints the same surface
  // in our own panels.
  ['foreground', '--vgai-content-primary'],
  ['icon.foreground', '--vgai-content-muted'],
  ['widget.border', '--vgai-boundary-default'],
  ['titleBar.activeBackground', '--vgai-surface-shell'],
  ['titleBar.inactiveBackground', '--vgai-surface-shell'],
  ['titleBar.activeForeground', '--vgai-content-muted'],
  ['titleBar.border', '--vgai-surface-shell'],
  ['activityBar.background', '--vgai-surface-shell'],
  ['activityBar.foreground', '--vgai-content-primary'],
  ['activityBar.inactiveForeground', '--vgai-content-dim'],
  ['activityBar.border', '--vgai-surface-shell'],
  ['activityBar.activeBorder', '--vgai-accent'],
  ['statusBar.background', '--vgai-surface-shell'],
  ['statusBar.foreground', '--vgai-content-muted'],
  ['statusBar.border', '--vgai-surface-shell'],
  ['sideBar.background', '--vgai-surface-panel'],
  ['sideBar.foreground', '--vgai-content-primary'],
  ['sideBar.border', '--vgai-boundary-default'],
  ['sideBarSectionHeader.background', '--vgai-surface-chrome'],
  ['panel.background', '--vgai-surface-panel'],
  ['panel.border', '--vgai-boundary-default'],
  ['editorGroup.border', '--vgai-boundary-default'],
  ['editorGroupHeader.tabsBorder', '--vgai-boundary-default'],
  ['tab.activeBackground', '--vgai-surface-panel'],
  ['tab.activeForeground', '--vgai-content-primary'],
  ['tab.border', '--vgai-boundary-default'],
  ['menu.background', '--vgai-widget-menu'],
  ['menu.foreground', '--vgai-content-menu'],
  ['menu.border', '--vgai-boundary-default'],
  ['dropdown.background', '--vgai-widget-menu'],
  ['dropdown.border', '--vgai-boundary-default'],
  ['input.foreground', '--vgai-content-primary'],
  ['input.border', '--vgai-boundary-default'],
];

/** The stage's colours: `vgai.*` ids, one to one with the palette's own names. */
const STAGE: readonly (readonly [string, string])[] = [
  ['vgai.viewport.background', '--vgai-viewport-background'],
  ['vgai.viewport.grid', '--vgai-viewport-grid'],
  ['vgai.viewport.axisX', '--vgai-viewport-axis-x'],
  ['vgai.viewport.axisY', '--vgai-viewport-axis-y'],
  ['vgai.viewport.axisZ', '--vgai-viewport-axis-z'],
  ['vgai.viewport.selection', '--vgai-viewport-selection'],
  ['vgai.viewport.active', '--vgai-viewport-active'],
  ['vgai.viewport.wire', '--vgai-viewport-wire'],
  ['vgai.gizmo.x', '--vgai-gizmo-x'],
  ['vgai.gizmo.y', '--vgai-gizmo-y'],
  ['vgai.gizmo.z', '--vgai-gizmo-z'],
  ['vgai.gizmo.navigationX', '--vgai-gizmo-navigation-x'],
  ['vgai.gizmo.navigationY', '--vgai-gizmo-navigation-y'],
  ['vgai.gizmo.navigationZ', '--vgai-gizmo-navigation-z'],
  ['vgai.gizmo.hover', '--vgai-gizmo-hover'],
  ['vgai.gizmo.drag', '--vgai-gizmo-drag'],
];

/** `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `rgba()` as `#rrggbb[aa]`; anything else `null`
 *  (a gradient or a `var()` is not a colour a theme can hold). */
function hexOf(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(value)?.[1];
  if (hex) return `#${hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex}`;
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(value);
  if (!rgb) return null;
  const byte = (channel: string) =>
    Math.max(0, Math.min(255, Math.round(Number(channel)))).toString(16).padStart(2, '0');
  const alpha = rgb[4];
  const alphaByte =
    alpha === undefined
      ? ''
      : Math.round(Math.max(0, Math.min(1, alpha.endsWith('%') ? Number.parseFloat(alpha) / 100 : Number(alpha))) * 255)
          .toString(16)
          .padStart(2, '0');
  return `#${byte(rgb[1]!)}${byte(rgb[2]!)}${byte(rgb[3]!)}${alphaByte === 'ff' ? '' : alphaByte}`;
}

/** The active look's colours as workbench colour customizations, read off `root`'s tokens. */
export function lookColorCustomizations(root: Element): Record<string, string> {
  const style = getComputedStyle(root);
  const out: Record<string, string> = {};
  for (const [id, token, alpha] of CHROME) {
    const hex = hexOf(style.getPropertyValue(token));
    if (hex === null) continue;
    out[id] = alpha && hex.length === 7 ? `${hex}${alpha}` : hex;
  }
  for (const [id, token] of STAGE) {
    const hex = hexOf(style.getPropertyValue(token));
    if (hex !== null) out[id] = hex;
  }
  return out;
}
