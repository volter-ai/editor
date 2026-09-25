/**
 * Theme-backed renderer selection ink shared by the native Three and Pixi
 * views. CSS can consume `var(--vgai-accent)` directly; WebGL cannot, so this
 * module resolves the inherited token to the integer both renderers speak.
 */

import { EDITOR_THEME_CLASS, graphiteDarkEditorTheme } from '@volter/editor-sdk/widgets';

/** Import/SSR fallback: Graphite Dark's canonical blue accent. */
export const DEFAULT_NATIVE_SELECTION_COLOR = 0x579eff;

export interface NativeSelectionColors {
  readonly visible: number;
  readonly hidden: number;
}

function rgbHex(red: number, green: number, blue: number): number {
  return (red << 16) | (green << 8) | blue;
}

function parseNormalizedColor(value: string): number | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value.trim())?.[1];
  if (hex) {
    const opaque = hex.length === 3 ? [...hex].map((digit) => `${digit}${digit}`).join('') : hex;
    return Number.parseInt(opaque.slice(0, 6), 16);
  }
  const rgb =
    /^rgba?\(\s*(\d+(?:\.\d+)?)\s*(?:,\s*|\s+)(\d+(?:\.\d+)?)\s*(?:,\s*|\s+)(\d+(?:\.\d+)?)/i.exec(
      value.trim(),
    );
  if (!rgb) return null;
  const channels = rgb.slice(1, 4).map((channel) => Math.round(Number(channel)));
  if (channels.some((channel) => channel < 0 || channel > 255)) return null;
  return rgbHex(channels[0]!, channels[1]!, channels[2]!);
}

/** Normalize any browser-valid CSS color (custom palettes may use HSL/names). */
function parseCssColor(value: string): number | null {
  const direct = parseNormalizedColor(value);
  if (direct !== null || typeof document === 'undefined') return direct;
  if (typeof CSS !== 'undefined' && !CSS.supports('color', value)) return null;
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return null;
  context.fillStyle = '#010203';
  context.fillStyle = value;
  return parseNormalizedColor(String(context.fillStyle));
}

function themeRoot(element?: Element | null): Element | null {
  if (typeof document === 'undefined') return null;
  return (
    element?.closest(`.${EDITOR_THEME_CLASS}`) ?? document.querySelector(`.${EDITOR_THEME_CLASS}`)
  );
}

function dimColor(color: number): number {
  const red = Math.round(((color >> 16) & 0xff) * 0.42);
  const green = Math.round(((color >> 8) & 0xff) * 0.42);
  const blue = Math.round((color & 0xff) * 0.42);
  return rgbHex(red, green, blue);
}

/** Current palette accent, with a same-hue dim variant for occluded 3D edges. */
function themeToken(root: Element | null, name: string): string {
  return root && typeof getComputedStyle !== 'undefined'
    ? getComputedStyle(root).getPropertyValue(name).trim()
    : '';
}

/** The palette's selection colour: its viewport group's when it carries one
 *  (Blender's orange), the accent otherwise. */
export function nativeSelectionColors(element?: Element | null): NativeSelectionColors {
  const root = themeRoot(element);
  const raw = themeToken(root, '--vgai-viewport-selection') || themeToken(root, '--vgai-accent');
  const visible =
    parseCssColor(raw || graphiteDarkEditorTheme.color.accent.default) ??
    DEFAULT_NATIVE_SELECTION_COLOR;
  return { visible, hidden: dimColor(visible) };
}

/** The palette's VIEWPORT GROUP (`EditorTheme.color.viewport`), each member
 *  `null` when the palette carries none — the viewport keeps its own then. */
export interface NativeViewportLook {
  readonly background: number | null;
  readonly grid: number | null;
  readonly axisX: number | null;
  readonly axisY: number | null;
  readonly active: number | null;
}

/**
 * Whether the ACTIVE LOOK declares a `color.viewport` group at all — the
 * question "is the backdrop the look's, or the editor's own?"
 * (ARCHITECTURE-CORE §A model is data: a data subject opens in an isolation
 * scene whose story is the studio, and the studio's backdrop is the editor's;
 * a look that paints the viewport itself — Blender's flat grey — has already
 * answered, and the studio must not paint over it).
 *
 * `background` alone is the whole test because the group is ALL-OR-NOTHING:
 * `EditorTheme.color.viewport` makes every member required, and a palette
 * DOCUMENT that carries a partial group is rejected by name at parse
 * (`theme-library.ts`'s viewport reconstruction). So the group is present
 * exactly when this token paints.
 */
export function lookDeclaresViewportColors(element?: Element | null): boolean {
  return nativeViewportLook(element).background !== null;
}

/** Whether the look paints its viewport LIGHT (relative luminance above one half). The ink that
 *  reads over a declared viewport is the palette's `content.onAccent` on a dark one (Blender's
 *  white over its grey) and its ordinary `content.primary` on a light one (ink over
 *  paper), where the on-accent ink is the same colour as the ground. */
export function lookPaintsLightViewport(element?: Element | null): boolean {
  const background = nativeViewportLook(element).background;
  if (background === null) return false;
  const r = (background >> 16) & 0xff, g = (background >> 8) & 0xff, b = background & 0xff;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.5;
}

export function nativeViewportLook(element?: Element | null): NativeViewportLook {
  const root = themeRoot(element);
  const read = (name: string): number | null => {
    const raw = themeToken(root, name);
    return raw ? parseCssColor(raw) : null;
  };
  return {
    background: read('--vgai-viewport-background'),
    grid: read('--vgai-viewport-grid'),
    axisX: read('--vgai-viewport-axis-x'),
    axisY: read('--vgai-viewport-axis-y'),
    active: read('--vgai-viewport-active'),
  };
}

/**
 * THE LOOK'S TRANSFORM-GIZMO SIZE, in px per gizmo unit
 * (`EditorTheme.density.viewport.gizmoSize`), or `null` when the look names
 * none — which is every look but Blender's, and means "keep three's own
 * viewport-relative handle".
 *
 * Read off the emitted token for the same reason the colours above are: WebGL
 * cannot consume a CSS variable, and the theme object reaching the viewport
 * would be a second source for a value the stylesheet already carries.
 * `editor-viewport.ts` is the one caller and it says what it does with the
 * number; nothing here knows about three's units.
 */
export function nativeViewportGizmoSize(element?: Element | null): number | null {
  const raw = themeToken(themeRoot(element), '--vgai-viewport-gizmo-size');
  if (!raw) return null;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** THE FLOOR GRID'S LINES the look states (`EditorTheme.density.viewport.gridLineWidth` and
 *  its siblings), in device pixels, with the editor's own hairline floor for any it leaves out:
 *  one level, one pixel, the major lines drawn like the minor. */
export function nativeViewportGrid(element?: Element | null): {
  readonly lineWidth: number;
  readonly majorWidth: number;
  readonly majorContrast: number;
} {
  const root = themeRoot(element);
  const read = (name: string, fallback: number): number => {
    const value = Number.parseFloat(themeToken(root, name) ?? '');
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  const lineWidth = read('--vgai-viewport-grid-line-width', 1);
  return {
    lineWidth,
    majorWidth: read('--vgai-viewport-grid-major-width', lineWidth),
    majorContrast: read('--vgai-viewport-grid-major-contrast', 1),
  };
}

/** HOW THE LOOK DRAWS THE SELECTION BOX MARK (`density.viewport.selectionBox` and its width),
 *  with the editor's own corner brackets at 3 CSS px for what it leaves out. */
export function nativeViewportSelectionBox(element?: Element | null): {
  readonly edges: boolean;
  readonly lineWidth: number | null;
} {
  const root = themeRoot(element);
  const width = Number.parseFloat(themeToken(root, '--vgai-viewport-selection-box-width'));
  return {
    edges: themeToken(root, '--vgai-viewport-selection-box') === 'edges',
    lineWidth: Number.isFinite(width) && width > 0 ? width : null,
  };
}

/**
 * Observe the one theme root's inline token update. This includes saved theme
 * changes and unsaved Theme Manager previews; neither renderer has to poll
 * `getComputedStyle` on every frame.
 */
export function subscribeNativeSelectionTheme(
  element: Element | null | undefined,
  listener: () => void,
): () => void {
  listener();
  const root = themeRoot(element);
  if (!root || typeof MutationObserver === 'undefined') return () => {};
  const observer = new MutationObserver(listener);
  observer.observe(root, { attributes: true, attributeFilter: ['style'] });
  return () => observer.disconnect();
}
