/**
 * THE LOOK'S COLOURS AS THE WORKBENCH'S — what the frame applies as colour customizations on the
 * look's own settings layer (`workbench/src/volterSettings.ts`), so a look with no colour theme
 * of its own still colours the whole window, and the 3D viewport's colours are theme colours
 * a person can override (`workbench/src/volterColors.ts`, `volter.viewport.*`, `volter.gizmo.*`).
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
  ['descriptionForeground', '--volter-content-dim'],
  ['disabledForeground', '--volter-content-placeholder'],
  ['errorForeground', '--volter-danger'],
  ['focusBorder', '--volter-accent'],
  ['selection.background', '--volter-accent', '99'],
  ['sash.hoverBorder', '--volter-accent'],
  ['menubar.selectionBackground', '--volter-accent'],
  ['menubar.selectionForeground', '--volter-content-on-accent'],
  ['menu.selectionBackground', '--volter-accent'],
  ['menu.selectionForeground', '--volter-content-on-accent'],
  ['editorGroupHeader.tabsBackground', '--volter-surface-chrome'],
  ['editorGroup.dropBackground', '--volter-accent', '66'],
  ['tab.inactiveBackground', '--volter-surface-chrome'],
  ['tab.inactiveForeground', '--volter-content-dim'],
  ['editor.background', '--volter-surface-chrome'],
  ['editorLineNumber.foreground', '--volter-content-placeholder'],
  ['editor.selectionBackground', '--volter-accent', '99'],
  ['editorGutter.background', '--volter-surface-chrome'],
  ['panelTitle.inactiveForeground', '--volter-content-dim'],
  ['list.activeSelectionBackground', '--volter-accent'],
  ['list.activeSelectionForeground', '--volter-content-on-accent'],
  ['list.focusOutline', '--volter-accent'],
  ['list.dropBackground', '--volter-accent', '66'],
  ['button.background', '--volter-accent'],
  ['button.foreground', '--volter-content-on-accent'],
  ['checkbox.selectBackground', '--volter-accent'],
  ['input.background', '--volter-surface-chrome'],
  ['input.placeholderForeground', '--volter-content-placeholder'],
  ['inputOption.activeBackground', '--volter-accent'],
  ['inputOption.activeForeground', '--volter-content-on-accent'],
  ['inputValidation.errorBorder', '--volter-danger'],
  ['badge.background', '--volter-accent'],
  ['badge.foreground', '--volter-content-on-accent'],
  ['progressBar.background', '--volter-accent'],
  ['quickInputList.focusBackground', '--volter-accent'],
  ['quickInputList.focusForeground', '--volter-content-on-accent'],
  ['notificationsErrorIcon.foreground', '--volter-danger'],
  ['notificationsWarningIcon.foreground', '--volter-warn'],
  ['notificationsInfoIcon.foreground', '--volter-accent'],
  ['terminal.background', '--volter-surface-chrome'],
  ['commandCenter.background', '--volter-surface-chrome'],
  ['volter.view.background', '--volter-surface-panel'],
  // The chrome a look must colour to read as itself, on the role that paints the same surface
  // in our own panels.
  ['foreground', '--volter-content-primary'],
  ['icon.foreground', '--volter-content-muted'],
  ['widget.border', '--volter-boundary-default'],
  ['titleBar.activeBackground', '--volter-surface-shell'],
  ['titleBar.inactiveBackground', '--volter-surface-shell'],
  ['titleBar.activeForeground', '--volter-content-muted'],
  ['titleBar.border', '--volter-surface-shell'],
  ['activityBar.background', '--volter-surface-shell'],
  ['activityBar.foreground', '--volter-content-primary'],
  ['activityBar.inactiveForeground', '--volter-content-dim'],
  ['activityBar.border', '--volter-surface-shell'],
  ['activityBar.activeBorder', '--volter-accent'],
  ['statusBar.background', '--volter-surface-shell'],
  ['statusBar.foreground', '--volter-content-muted'],
  ['statusBar.border', '--volter-surface-shell'],
  ['sideBar.background', '--volter-surface-panel'],
  ['sideBar.foreground', '--volter-content-primary'],
  ['sideBar.border', '--volter-boundary-default'],
  ['sideBarSectionHeader.background', '--volter-surface-chrome'],
  ['panel.background', '--volter-surface-panel'],
  ['panel.border', '--volter-boundary-default'],
  ['editorGroup.border', '--volter-boundary-default'],
  ['editorGroupHeader.tabsBorder', '--volter-boundary-default'],
  ['tab.activeBackground', '--volter-surface-panel'],
  ['tab.activeForeground', '--volter-content-primary'],
  ['tab.border', '--volter-boundary-default'],
  ['menu.background', '--volter-widget-menu'],
  ['menu.foreground', '--volter-content-menu'],
  ['menu.border', '--volter-boundary-default'],
  ['dropdown.background', '--volter-widget-menu'],
  ['dropdown.border', '--volter-boundary-default'],
  ['input.foreground', '--volter-content-primary'],
  ['input.border', '--volter-boundary-default'],
];

/** The stage's colours: `volter.*` ids, one to one with the palette's own names. */
const STAGE: readonly (readonly [string, string])[] = [
  ['volter.viewport.background', '--volter-viewport-background'],
  ['volter.viewport.grid', '--volter-viewport-grid'],
  ['volter.viewport.axisX', '--volter-viewport-axis-x'],
  ['volter.viewport.axisY', '--volter-viewport-axis-y'],
  ['volter.viewport.axisZ', '--volter-viewport-axis-z'],
  ['volter.viewport.selection', '--volter-viewport-selection'],
  ['volter.viewport.active', '--volter-viewport-active'],
  ['volter.viewport.wire', '--volter-viewport-wire'],
  ['volter.gizmo.x', '--volter-gizmo-x'],
  ['volter.gizmo.y', '--volter-gizmo-y'],
  ['volter.gizmo.z', '--volter-gizmo-z'],
  ['volter.gizmo.navigationX', '--volter-gizmo-navigation-x'],
  ['volter.gizmo.navigationY', '--volter-gizmo-navigation-y'],
  ['volter.gizmo.navigationZ', '--volter-gizmo-navigation-z'],
  ['volter.gizmo.hover', '--volter-gizmo-hover'],
  ['volter.gizmo.drag', '--volter-gizmo-drag'],
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
    // A TRANSLUCENT surface stays ours: Glass paints its panels in rgba over a backdrop blur
    // the workbench does not have, so the same value on the editor, terminal or side bar would
    // draw them nearly clear over the window. The workbench keeps its own there.
    if (hex.length === 9 && !alpha) continue;
    out[id] = alpha && hex.length === 7 ? `${hex}${alpha}` : hex;
  }
  for (const [id, token] of STAGE) {
    const hex = hexOf(style.getPropertyValue(token));
    if (hex !== null) out[id] = hex;
  }
  return out;
}
