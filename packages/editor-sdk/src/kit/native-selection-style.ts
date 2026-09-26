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
  /** The ACTIVE object's outline (`color.viewport.active`, Blender's lighter orange), or the
   *  selection's own when the palette names none. */
  readonly active?: { readonly visible: number; readonly hidden: number };
  /** THE OUTLINE'S FORM (`stage.outlineStyle`, `outlineWidth`, `outlineHidden`):
   *  `soft`, the editor's own blurred halo, or `crisp` at a width in device pixels; and whether
   *  the parts other objects hide are drawn too. Absent is the editor's own. */
  readonly outline?: { readonly style: 'soft' | 'crisp'; readonly width: number | null; readonly hidden: boolean };
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

/**
 * THE STAGE'S COLOURS ARE THE WORKBENCH'S FIRST. Under the Code-OSS frame each is a theme
 * colour (`vgai.viewport.*`, `vgai.gizmo.*`, the frame's `vgaiColors.ts`) the look sets and a
 * person's `workbench.colorCustomizations` override, emitted as `--vscode-<id>` with dots as
 * dashes; the page's own token is what the look said, read where there is no workbench.
 */
const WORKBENCH_COLOR: Readonly<Record<string, string>> = {
  '--vgai-viewport-background': '--vscode-vgai-viewport-background',
  '--vgai-viewport-grid': '--vscode-vgai-viewport-grid',
  '--vgai-viewport-axis-x': '--vscode-vgai-viewport-axisX',
  '--vgai-viewport-axis-y': '--vscode-vgai-viewport-axisY',
  '--vgai-viewport-axis-z': '--vscode-vgai-viewport-axisZ',
  '--vgai-viewport-selection': '--vscode-vgai-viewport-selection',
  '--vgai-viewport-active': '--vscode-vgai-viewport-active',
  '--vgai-viewport-wire': '--vscode-vgai-viewport-wire',
  '--vgai-gizmo-x': '--vscode-vgai-gizmo-x',
  '--vgai-gizmo-y': '--vscode-vgai-gizmo-y',
  '--vgai-gizmo-z': '--vscode-vgai-gizmo-z',
  '--vgai-gizmo-navigation-x': '--vscode-vgai-gizmo-navigationX',
  '--vgai-gizmo-navigation-y': '--vscode-vgai-gizmo-navigationY',
  '--vgai-gizmo-navigation-z': '--vscode-vgai-gizmo-navigationZ',
  '--vgai-gizmo-hover': '--vscode-vgai-gizmo-hover',
  '--vgai-gizmo-drag': '--vscode-vgai-gizmo-drag',
};

function stageColorToken(root: Element | null, name: string): string {
  const workbench = WORKBENCH_COLOR[name];
  return (workbench ? themeToken(root, workbench) : '') || themeToken(root, name);
}

/** The palette's selection colour: its viewport group's when it carries one
 *  (Blender's orange), the accent otherwise. */
export function nativeSelectionColors(element?: Element | null): NativeSelectionColors {
  const root = themeRoot(element);
  const raw = stageColorToken(root, '--vgai-viewport-selection') || themeToken(root, '--vgai-accent');
  const visible =
    parseCssColor(raw || graphiteDarkEditorTheme.color.accent.default) ??
    DEFAULT_NATIVE_SELECTION_COLOR;
  const active = parseCssColor(stageColorToken(root, '--vgai-viewport-active'));
  const style = themeToken(root, '--vgai-viewport-outline-style');
  const width = Number.parseFloat(themeToken(root, '--vgai-viewport-outline-width'));
  const hidden = themeToken(root, '--vgai-viewport-outline-hidden');
  return {
    visible,
    hidden: dimColor(visible),
    ...(active === null ? {} : { active: { visible: active, hidden: dimColor(active) } }),
    ...(style === '' && hidden === '' && !Number.isFinite(width)
      ? {}
      : {
          outline: {
            style: style === 'crisp' ? 'crisp' : 'soft',
            width: Number.isFinite(width) && width > 0 ? width : null,
            hidden: hidden !== 'false',
          },
        }),
  };
}

/** The palette's VIEWPORT GROUP (`EditorTheme.color.viewport`), each member
 *  `null` when the palette carries none — the viewport keeps its own then. */
export interface NativeViewportLook {
  readonly background: number | null;
  readonly grid: number | null;
  readonly axisX: number | null;
  readonly axisY: number | null;
  readonly axisZ: number | null;
  /** `stage.axisLineWidth`, device px, or `null` for the editor's own. */
  readonly axisLineWidth: number | null;
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
    const raw = stageColorToken(root, name);
    return raw ? parseCssColor(raw) : null;
  };
  return {
    background: read('--vgai-viewport-background'),
    grid: read('--vgai-viewport-grid'),
    axisX: read('--vgai-viewport-axis-x'),
    axisY: read('--vgai-viewport-axis-y'),
    axisZ: read('--vgai-viewport-axis-z'),
    axisLineWidth: (() => {
      const raw = themeToken(root, '--vgai-viewport-axis-line-width');
      const value = raw ? Number.parseFloat(raw) : Number.NaN;
      return Number.isFinite(value) ? value : null;
    })(),
    active: read('--vgai-viewport-active'),
  };
}

/** THE LOOK'S GIZMO COLOURS AND HIGHLIGHT (`EditorTheme.color.gizmo`, and
 *  `stage.gizmoOpacity`/`gizmoHighlightSaturation`/`gizmoHighlightValue`), each
 *  `null` when the look names none — the viewport keeps its own then. `axes` are X, Y, Z. */
export interface NativeGizmoLook {
  readonly axes: readonly [number, number, number] | null;
  /** The navigation gizmo's own X, Y, Z, or `null` to draw it in {@link axes}. */
  readonly navigation: readonly [number, number, number] | null;
  readonly hover: number | null;
  readonly drag: number | null;
  readonly opacity: number | null;
  readonly arrowLength: number | null;
  readonly arrowHead: number | null;
  readonly ringWidth: number | null;
  readonly navigationForm: 'balls' | 'cones' | 'triad';
  /** The viewport's background, which the ball form mixes its colours toward by depth. */
  readonly background: number | null;
  readonly navigationSize: number | null;
  readonly navigationCorner: 'top-right' | 'bottom-left';
  readonly highlightSaturation: number | null;
  readonly highlightValue: number | null;
}

export function nativeGizmoLook(element?: Element | null): NativeGizmoLook {
  const root = themeRoot(element);
  const color = (name: string): number | null => {
    const raw = stageColorToken(root, name);
    return raw ? parseCssColor(raw) : null;
  };
  const number = (name: string): number | null => {
    const raw = themeToken(root, name);
    if (!raw) return null;
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) ? value : null;
  };
  const trio = (prefix: string): readonly [number, number, number] | null => {
    const x = color(`${prefix}-x`);
    const y = color(`${prefix}-y`);
    const z = color(`${prefix}-z`);
    return x !== null && y !== null && z !== null ? [x, y, z] : null;
  };
  return {
    axes: trio('--vgai-gizmo'),
    navigation: trio('--vgai-gizmo-navigation'),
    hover: color('--vgai-gizmo-hover'),
    drag: color('--vgai-gizmo-drag'),
    opacity: number('--vgai-viewport-gizmo-opacity'),
    arrowLength: number('--vgai-viewport-gizmo-arrow-length'),
    arrowHead: number('--vgai-viewport-gizmo-arrow-head'),
    ringWidth: number('--vgai-viewport-gizmo-ring-width'),
    navigationSize: number('--vgai-viewport-navigation-size'),
    background: color('--vgai-viewport-background'),
    navigationForm: ((form) => (form === 'cones' || form === 'triad' ? form : 'balls'))(
      themeToken(root, '--vgai-viewport-navigation-gizmo'),
    ),
    navigationCorner:
      themeToken(root, '--vgai-viewport-navigation-corner') === 'bottom-left' ? 'bottom-left' : 'top-right',
    highlightSaturation: number('--vgai-viewport-gizmo-highlight-saturation'),
    highlightValue: number('--vgai-viewport-gizmo-highlight-value'),
  };
}

/**
 * THE LOOK'S TRANSFORM-GIZMO SIZE, in px per gizmo unit
 * (`EditorTheme.stage.gizmoSize`), or `null` when the look names
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

/** THE FLOOR GRID'S LINES the look states (`EditorTheme.stage.gridLineWidth` and
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

/** HOW THE LOOK DRAWS THE SELECTION BOX MARK (`stage.selectionBox` and its width),
 *  with the editor's own corner brackets at 3 CSS px for what it leaves out. */
/** The selection wire's look: the palette's `viewport.wire` and `stage.wireOpacity`,
 *  each `null` for the editor's own (the selection colour at half opacity). */
export function nativeViewportWire(element?: Element | null): {
  readonly color: number | null;
  readonly opacity: number | null;
} {
  const root = themeRoot(element);
  const raw = stageColorToken(root, '--vgai-viewport-wire');
  const opacity = Number.parseFloat(themeToken(root, '--vgai-viewport-wire-opacity'));
  return {
    color: raw ? parseCssColor(raw) : null,
    opacity: Number.isFinite(opacity) ? opacity : null,
  };
}

export function nativeViewportSelectionBox(element?: Element | null): {
  readonly edges: boolean;
  readonly lineWidth: number | null;
  readonly frame: 'world' | 'object';
} {
  const root = themeRoot(element);
  const width = Number.parseFloat(themeToken(root, '--vgai-viewport-selection-box-width'));
  return {
    edges: themeToken(root, '--vgai-viewport-selection-box') === 'edges',
    frame: themeToken(root, '--vgai-viewport-selection-box-frame') === 'object' ? 'object' : 'world',
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
  // AND THE WORKBENCH'S COLOURS, which the frame applies after the look's own tokens land and a
  // person's customizations change without touching this root (`subscribeWorkbenchStageColors`).
  const stopWorkbench = subscribeWorkbenchStageColors(root, listener);
  return () => {
    observer.disconnect();
    stopWorkbench();
  };
}

/**
 * THE WORKBENCH'S STAGE COLOURS, watched once for every subscriber: Code-OSS writes them into a
 * stylesheet in the document head, which changes for many other reasons (every stylesheet a
 * module loads), so one observer reads the stage's colours once per change and wakes the
 * subscribers only when they moved.
 */
const workbenchListeners = new Set<() => void>();
let workbenchObserver: MutationObserver | null = null;
let workbenchSeen = '';

function subscribeWorkbenchStageColors(root: Element, listener: () => void): () => void {
  const signature = () =>
    Object.values(WORKBENCH_COLOR)
      .map((name) => themeToken(root, name))
      .join('|');
  workbenchListeners.add(listener);
  if (!workbenchObserver && typeof document !== 'undefined' && document.head) {
    workbenchSeen = signature();
    workbenchObserver = new MutationObserver(() => {
      const next = signature();
      if (next === workbenchSeen) return;
      workbenchSeen = next;
      for (const each of [...workbenchListeners]) each();
    });
    workbenchObserver.observe(document.head, { childList: true, subtree: true, characterData: true });
  }
  return () => {
    workbenchListeners.delete(listener);
    if (workbenchListeners.size === 0 && workbenchObserver) {
      workbenchObserver.disconnect();
      workbenchObserver = null;
    }
  };
}
