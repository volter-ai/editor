/**
 * Canonical design-token module for the vgai editor (editor-style-polish U0).
 * Every color/spacing/radius/type/shadow/z-index value the editor's ~98 React
 * components currently hand-roll as inline hex literals gets one home here. This module installs the variables consumed by `theme.css` and
 * supplies plain TS/TSX call sites that still build inline `style`
 * objects (e.g. `inspector-widgets/shared.tsx`, `primitives/Panel.tsx`) — so
 * it must stay import-safe from any context: no DOM access, no side effects,
 * just typed `const` data.
 *
 * The original Classic Graphite palette remains byte-for-byte compatible;
 * the neutral Glass default is a separate palette rather than a mutation of
 * Classic's historical action/focus color.
 * selection material is derived separately so glass never turns every
 * selected row, tab, and segment blue. The mono stack is the
 * `ui-monospace` spelling with
 * 2 independent votes, not `FONT_MONO`'s 1; the sans stack drops `'Inter'`
 * (never loaded — zero `@font-face` hits repo-wide) in favor of the
 * `-apple-system` chain already live in root `index.html`.
 */

import { GLASS_MATERIAL } from './editor-material';
import { zIndex } from './z-index';

const GRAPHITE_BG = {
  0: '#1a1a1a',
  1: '#242424',
  2: '#2c2c2c',
  3: '#333333',
  inset: '#1e1e1e',
} as const;
const GRAPHITE_BORDER = { 1: '#333333', 2: '#444444' } as const;
// Compatibility contract: these are the original Classic values.
const GRAPHITE_TEXT = { 1: '#c5c8ce', 2: '#9aa0a6', 3: '#90959c' } as const;
const GRAPHITE_ACCENT = '#579EFF';
const GRAPHITE_ACCENT_MUTED = 'rgba(87,158,255,0.15)';
// Glass defaults to this separate palette. A material never introduces hue.
const GRAPHITE_NEUTRAL_TEXT = { 1: '#f2f6fb', 2: '#d3d9e0', 3: '#aab0b7' } as const;
const GRAPHITE_NEUTRAL_ACCENT = '#d8dee9';
const GRAPHITE_NEUTRAL_ACCENT_MUTED = 'rgba(216,222,233,0.18)';
const GRAPHITE_DANGER = '#FF6B6B';
const GRAPHITE_WARN = '#e0a030';
const GRAPHITE_SUCCESS = '#4caf50';
const GRAPHITE_SUCCESS_MUTED = 'rgba(76,175,80,0.15)';
const GRAPHITE_DANGER_MUTED = 'rgba(255,107,107,0.15)';
const GRAPHITE_WARN_MUTED = 'rgba(224,160,48,0.12)';
const GRAPHITE_DANGER_FAINT = 'rgba(255,107,107,0.06)';
const GRAPHITE_SCRIM = 'rgba(0,0,0,0.5)';
const GRAPHITE_DYNAMIC = '#ff79c6';
const GRAPHITE_DYNAMIC_BG = 'rgba(255,121,198,0.08)';
// Component-instance identity (H1) — our translation of Unity's blue-prefab
// label. Cyan, NOT the accent role: `accent` means "action/focus" and
// several palettes deliberately keep it neutral (`GRAPHITE_NEUTRAL_ACCENT`
// is near-white), which made an instance row indistinguishable from a plain
// one. Cyan is also the widest free hue gap in this palette — clear of
// danger (red), warning (amber), success (green ~122°), dynamic (pink
// ~326°) and the graphite accent (blue ~215°). Depth is tuned so the tint
// also survives a BRIGHT backdrop under Glass (2.36:1 on white — the same
// band as dynamic/warning) while still reading at 6.65:1 on the opaque
// graphite row.
const GRAPHITE_INSTANCE = '#22b8d6';
const GRAPHITE_FONT_SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
const GRAPHITE_FONT_MONO = 'ui-monospace, "SF Mono", Monaco, "Cascadia Code", monospace';
const GRAPHITE_SHADOW = {
  sm: '0 2px 8px rgba(0,0,0,0.6)',
  md: '0 4px 12px rgba(0,0,0,0.5)',
  lg: '0 8px 32px rgba(0,0,0,0.6)',
} as const;

/**
 * Compatibility references used by existing DOM call sites. They resolve at
 * paint time, so the whole existing editor participates in runtime themes.
 * New code should prefer the semantic {@link themeVars} vocabulary.
 */
export const bg = {
  /** App shell / loading screen (`AppRoot.tsx`, root `index.html` body). */
  0: 'var(--vgai-surface-shell)',
  /** Panel body (`Panel.tsx`'s content area, THEME.bg). */
  1: 'var(--vgai-surface-panel)',
  /** Surface: header / menu / dropdown / popover (THEME.surface). */
  2: 'var(--vgai-surface-chrome)',
  /** Raised / hover surface (THEME.surfaceHover). */
  3: 'var(--vgai-surface-raised)',
  /** Input well / recessed field background (THEME.inputBg). */
  inset: 'var(--vgai-surface-inset)',
} as const;

/** Border ramp — same literal as `bg[3]` for `border[1]` by design (distinguished by CSS property, not value). */
export const border = {
  /** Default border. */
  1: 'var(--vgai-boundary-default)',
  /** Hover / emphasis border. */
  2: 'var(--vgai-boundary-strong)',
} as const;

/** Text ramp — primary → tertiary/dim. */
export const text = {
  /** Primary text (THEME.text). */
  1: 'var(--vgai-content-primary)',
  /** Secondary / muted text (THEME.textMuted). */
  2: 'var(--vgai-content-muted)',
  /** Tertiary / dim text. */
  3: 'var(--vgai-content-dim)',
} as const;

/** Canonical action/focus accent. Selection chrome uses `selection` below. */
export const accent = 'var(--vgai-accent)';
/** Semantic tint behind accent-colored actions, status, and information. */
export const accentMuted = 'var(--vgai-accent-muted)';
/** Material selection roles: accent in Classic, adaptive neutral in Glass. */
export const selection = {
  background: 'var(--vgai-selection-bg)',
  border: 'var(--vgai-selection-border)',
  indicator: 'var(--vgai-selection-indicator)',
} as const;

/** Semantic tones. */
export const danger = 'var(--vgai-danger)';
export const warn = 'var(--vgai-warn)';
export const success = 'var(--vgai-success)';

/**
 * Semantic background tints (U6, punch-list #1) — one family alpha (0.15,
 * matching `accentMuted`) for chip/band/state backgrounds behind
 * semantic-colored content. Converges the drifted hand-rolled alphas
 * (0.12/0.15) that U3-U5 left behind in EnvironmentSection (stale-bake),
 * ConsolePanel (entity chip), AudioSection
 * (stop state), and the unsaved-document treatment.
 */
export const successMuted = 'var(--vgai-success-muted)';
export const dangerMuted = 'var(--vgai-danger-muted)';
/** Resting warning surface used for unsaved/attention states. */
export const warnMuted = 'var(--vgai-warn-muted)';
/**
 * Deliberately fainter danger tint for RESTING full-row backgrounds
 * (ConsolePanel error rows): a run of consecutive error
 * rows must read as a list, not a solid red wall, so rows sit at 0.06 while
 * point-emphasis chips/bands use `dangerMuted`. Two files independently
 * converged on this exact value — tokenized so they can't drift apart.
 */
export const dangerFaint = 'var(--vgai-danger-faint)';

/**
 * The one modal/backdrop dimming scrim. The canonical Dialog pattern and
 * non-dialog modal surfaces share this semantic value.
 */
export const scrim = 'var(--vgai-scrim)';

/** Kit-specific "reactive/bound value" indicator (inspector-widgets only — not otherwise contested). */
export const dynamic = 'var(--vgai-dynamic)';
export const dynamicBg = 'var(--vgai-dynamic-muted)';

/** 4/8-based spacing scale — compose padding/margin/gap from these instead of ad hoc shorthand strings. */
export const space = {
  1: 2,
  2: 4,
  3: 6,
  4: 8,
  5: 10,
  6: 12,
  8: 16,
  10: 20,
  12: 24,
} as const;

/**
 * Semantic editor-chrome dimensions. Different roles intentionally use
 * different heights, but every instance of a role must consume the same
 * token instead of retyping a nearby number.
 */
export const chromeSize = {
  commandBar: 36,
  panelHeader: 30,
  localToolbar: 28,
  treeRow: 24,
  // How far one level of a tree steps right. The editor's own is 14, which is
  // what `GameHierarchy`'s `INDENT` always was. Blender's Outliner steps by
  // its ROW HEIGHT — a square grid, the shape every DCC tree uses: measured on
  // `outliner.png` (2x), the type glyphs of Scene Collection, Collection and
  // Camera centre at x 30.25, 50.25 and 70.25 CSS and their chevrons one cell
  // left of each, so the step is exactly 20.
  treeIndent: 14,
  // 22 was always too cramped for the bottom row (owner design review,
  // 2026-07-19 — "the wrong height even during the regular page"; 28 was
  // still too tight on second look). 36 mirrors the command bar, so the
  // top and bottom chrome rows are symmetric.
  statusBar: 36,
  // The tool rail (Blender's toolbar): a tool's box, its width and the gap
  // between groups — the EDITOR'S OWN, which is what Classic paints. These
  // are not Blender's (a comment here used to claim they were): the Blender
  // style declares its own `chrome.toolSize/toolWidth/toolGap`
  // (`blender.style.ts`), those are the measured ones, and they are what the
  // rail actually renders at under that look. Changing a number here moves
  // Classic and nothing else.
  toolSize: 34,
  toolWidth: 38,
  toolGap: 7,
  // How wide the seam between two docked AREAS is cut. The editor's own is
  // the resting stroke (spelled out rather than read from `strokeWidth`,
  // which is declared below this object), so a skin that declares nothing
  // keeps today's hairline; Blender's groove is 3.5 — see
  // `color.boundary.area` for the frame and coordinates it was read at.
  areaSeam: 1,
  // The EMBOSS beside that groove, in percent of white mixed into the area's
  // own fill. Zero paints nothing at all (`areaEmbossValue` returns
  // `transparent`), which is the editor's own look and every skin but
  // Blender's; Blender's is 8.2. See `areaEmbossValue`.
  areaEmboss: 0,
} as const;

/** What a material may retune of the chrome's density, all in px. */
export interface EditorDensity {
  readonly control?: Partial<Record<keyof typeof controlSize, number>>;
  readonly font?: Partial<Record<keyof typeof fontSize, number>>;
  /** Glyph sizes, independent of the type scale ({@link iconSize}). */
  readonly icon?: Partial<Record<keyof typeof iconSize, number>>;
  readonly chrome?: Partial<Record<keyof typeof chromeSize, number>>;
  /** WHAT THE LOOK STATES ABOUT THE 3D STAGE, as opposed to about the chrome.
   *  Every member is independently optional and there is no default table: an
   *  absent member emits an EMPTY token and its reader keeps the editor's own
   *  behaviour (the `color.viewport` group's convention, for the same reason
   *  — the editor's gizmo is not expressed in px at all, and its shelf's boot
   *  tool is its own). See `DensityContribution.viewport` in `looks.ts` for
   *  both derivations and for why a non-length member sits under `density`. */
  readonly viewport?: {
    readonly gizmoSize?: number;
    readonly gizmoArrowLength?: number;
    readonly gizmoArrowHead?: number;
    readonly gizmoRingWidth?: number;
    readonly navigationGizmo?: 'balls' | 'cones' | 'triad';
    readonly navigationCorner?: 'top-right' | 'bottom-left';
    readonly navigationSize?: number;
    readonly gizmoOpacity?: number;
    readonly gizmoHighlightSaturation?: number;
    readonly gizmoHighlightValue?: number;
    readonly gridLineWidth?: number;
    readonly gridMajorWidth?: number;
    readonly gridMajorContrast?: number;
    readonly axisLineWidth?: number;
    readonly selectionBox?: 'corners' | 'edges';
    readonly selectionBoxFrame?: 'world' | 'object';
    readonly outlineStyle?: 'soft' | 'crisp';
    readonly outlineWidth?: number;
    readonly outlineHidden?: boolean;
    readonly wireOpacity?: number;
    readonly selectionBoxWidth?: number;
  };
}
function numberToken(value: number | undefined): string {
  return value === undefined ? '' : `${value}`;
}
function density(theme: Pick<EditorTheme, 'density'>) {
  return {
    control: { ...controlSize, ...theme.density?.control },
    font: { ...fontSize, ...theme.density?.font },
    icon: { ...iconSize, ...theme.density?.icon },
    chrome: { ...chromeSize, ...theme.density?.chrome },
  };
}

/** Reusable interactive-control heights. */
export const controlSize = {
  compact: 20,
  default: 24,
  comfortable: 28,
} as const;

/** Resting boundaries stay quiet; interaction affordances may strengthen. */
export const strokeWidth = {
  resting: 1,
  active: 2,
} as const;

/** Named type scale (px). Covers the overwhelming majority of real fontSize call sites. */
/**
 * ICON SIZE — its OWN axis, not a rung of the type scale.
 *
 * Every glyph used to take its size from `fontSize`, so a skin that tightened
 * its text tightened its icons with it: under Blender's density the chrome's
 * glyphs rendered at 10–11 px where Blender draws 14 (measured against
 * `properties-data-edit.png` and `outliner.png` at matched scale), which is
 * what "the sizes are totally wrong" names. Blender sizes icons
 * independently of text and so does every application whose icons are a
 * pictorial language rather than a typographic one.
 *
 * The defaults below are the type scale's values, so a skin that declares no
 * `density.icon` looks exactly as it did.
 */
export const iconSize = {
  xs: 9,
  sm: 10,
  md: 12,
  lg: 13,
  xl: 14,
  '2xl': 16,
} as const;

export const fontSize = {
  xs: 9,
  sm: 10,
  base: 11,
  md: 12,
  lg: 13,
  xl: 14,
  '2xl': 16,
  heading: 24,
} as const;

export const fontWeight = {
  regular: 400,
  semibold: 600,
  bold: 700,
} as const;

/**
 * Line-height scale (unitless, so it scales with each element's own size).
 * Minted from the values the estate already used by hand: 1 for single-line
 * chrome, 1.2 for headings and labels, 1.4 for control copy, 1.5 for prose.
 */
export const lineHeight = {
  tight: 1,
  snug: 1.2,
  normal: 1.4,
  relaxed: 1.5,
} as const;

/**
 * Motion scale. Durations in ms; one standard easing. Minted from the values
 * the estate already used by hand (140/180/300ms and one cubic-bezier).
 * `prefers-reduced-motion` handling stays with each animation's own rule.
 */
export const motion = {
  duration: { fast: 140, base: 180, slow: 300 },
  easing: {
    standard: 'cubic-bezier(0.32, 0.72, 0.28, 1)',
    out: 'ease-out',
  },
} as const;

/**
 * Sans stack — the fallback chain already live everywhere else (originally
 * declared in root `index.html`). `'Inter'` is intentionally NOT included:
 * no `@font-face`/`<link>` for it exists anywhere in `packages/editor`, so it
 * only ever silently fell back to this same chain.
 */
export const fontSans = 'var(--vgai-font-sans)';

/**
 * Canonical mono stack — replaces `FONT_MONO`/`MONO`/18 bare `'monospace'`
 * sites. This spelling had 2 independent votes in the codebase vs. 1 each
 * for the others.
 */
export const fontMono = 'var(--vgai-font-mono)';

const DEFAULT_RADIUS = {
  small: '3px',
  medium: '6px',
  large: '8px',
  full: '9999px',
} as const;

/**
 * Runtime border-radius references. Like the color compatibility exports,
 * these resolve at paint time so existing product surfaces participate in a
 * custom theme instead of freezing the Graphite defaults into inline styles.
 */
export const radius = {
  sm: 'var(--vgai-radius-sm)',
  md: 'var(--vgai-radius-md)',
  lg: 'var(--vgai-radius-lg)',
  full: 'var(--vgai-radius-full)',
} as const;

/** Drop-shadow tiers. */
export const shadow = {
  /** Tooltip tier. */
  sm: 'var(--vgai-shadow-sm)',
  /** Dropdown / menu tier — already the dominant value pre-token. */
  md: 'var(--vgai-shadow-md)',
  /** Modal tier. */
  lg: 'var(--vgai-shadow-lg)',
} as const;

/**
 * Typed `var()` handles for the numeric scales, for components that style
 * inline (`style={{ fontSize: fontSizeVar.sm }}`). An inline literal
 * (`fontSize: 11`) sits above every stylesheet in the cascade and is the one
 * place a theme cannot reach; these keep inline styles on the token.
 */
export const fontSizeVar = {
  xs: 'var(--vgai-font-xs)',
  sm: 'var(--vgai-font-sm)',
  base: 'var(--vgai-font-base)',
  md: 'var(--vgai-font-md)',
  lg: 'var(--vgai-font-lg)',
  xl: 'var(--vgai-font-xl)',
  '2xl': 'var(--vgai-font-2xl)',
  heading: 'var(--vgai-font-heading)',
} as const;

export const spaceVar = {
  1: 'var(--vgai-space-1)',
  2: 'var(--vgai-space-2)',
  3: 'var(--vgai-space-3)',
  4: 'var(--vgai-space-4)',
  5: 'var(--vgai-space-5)',
  6: 'var(--vgai-space-6)',
  8: 'var(--vgai-space-8)',
  10: 'var(--vgai-space-10)',
  12: 'var(--vgai-space-12)',
} as const;

export const lineHeightVar = {
  tight: 'var(--vgai-leading-tight)',
  snug: 'var(--vgai-leading-snug)',
  normal: 'var(--vgai-leading-normal)',
  relaxed: 'var(--vgai-leading-relaxed)',
} as const;

export const motionVar = {
  duration: {
    fast: 'var(--vgai-duration-fast)',
    base: 'var(--vgai-duration-base)',
    slow: 'var(--vgai-duration-slow)',
  },
  easing: {
    standard: 'var(--vgai-ease-standard)',
    out: 'var(--vgai-ease-out)',
  },
} as const;

/**
 * `<active stroke>px solid <accent>` — apply via a global `:focus-visible` rule for
 * `className`-based controls (see `theme.css`), and via a shared
 * `onFocus`/`onBlur` handler for inline-`style` components that can't
 * express the pseudo-class directly (out of scope for U0 — later units).
 */
export const focusRing = 'var(--vgai-focus-ring)';

/**
 * The EDITOR AREAS a palette may paint separately (`EditorTheme.color.region`,
 * whose docblock carries the measurement). The vocabulary is deliberately tiny
 * and named after the reference's own editors, not after our panels: a name
 * earns its place when a frame shows that area painted differently from
 * `surface.panel`. `workspace-static-panels.ts` is where a panel claims one.
 */
export const EDITOR_REGION_NAMES = ['outliner', 'properties'] as const;
export type EditorRegionName = (typeof EDITOR_REGION_NAMES)[number];

/**
 * Runtime editor-theme contract. The compatibility exports above are CSS
 * references so existing DOM chrome themes at paint time; concrete defaults
 * live in {@link graphiteDarkEditorTheme}. New DOM code should consume
 * {@link themeVars}' semantic names.
 */
export interface EditorTheme {
  readonly id: string;
  readonly color: {
    readonly surface: {
      readonly shell: string;
      readonly panel: string;
      readonly chrome: string;
      readonly raised: string;
      readonly inset: string;
      /** Translucent editor HUD chrome drawn over a game/scene viewport. */
      readonly overlay: string;
    };
    readonly boundary: {
      readonly default: string;
      readonly strong: string;
      /**
       * THE AREA SEAM — the line between two docked AREAS, which is a
       * different subject from `default`, the outline around a WIDGET.
       * Optional, like `widget` and `category`: a palette that names none
       * paints every seam `boundary.default`, exactly as before this member
       * existed, so no other skin moves by a pixel.
       *
       * Blender 5.2 factory startup, measured on the native 2x frames in
       * `/Volumes/PeakSSD/volter-work/blender-reference` (halved here):
       *
       *  - `modeling.png`, the seam between the Outliner and the Properties
       *    editor, median over x 2900..3400: rows 419..425 are (21,21,21) —
       *    3.5 CSS px of #151515 — with a one-pixel lighter emboss on each
       *    side (417..418 = 59/60, 426..427 = 54/64).
       *  - the same frame's viewport↔Properties seam, median over rows
       *    600..1900: x 2836..2842 is the identical (21,21,21) run, same
       *    3.5 px.
       *
       * So the seam is DARKER than either neighbour, where our
       * `boundary.default` #3c3c3c is lighter than both — that inversion is
       * what made our window read as tiles with bright grout.
       *
       * The two SHELL seams measure narrower (topbar↔header y 48..52 = 2.5
       * px, viewport↔status bar y 2057..2060 = 2 px) for a reason that is
       * not a second width: the top and status bars are #171717 themselves,
       * two levels off the groove, so there is nothing there to see. They
       * take the colour and keep their hairline width; only an interior
       * area↔area seam is cut to `chrome.areaSeam` px.
       */
      readonly area?: string;
      /**
       * THE TREE'S INDENT GUIDE — the vertical rule an OPEN parent draws down
       * its own disclosure column, through the rows of its subtree. Optional,
       * per member, exactly like `area`, `widget` and `category`: a palette
       * that names none paints NO GUIDE AT ALL, which is what every skin but
       * Blender's did before this member existed, so nothing else moves.
       *
       * Measured on `modeling-object-none.png` and
       * `modeling-object-selected.png` (Blender 5.2, native 2x, OBJECT mode;
       * the Outliner is `modeling.png[y 53..419, x 2843..3452]`, which is
       * `outliner.png`'s own box, so the coordinates below are that crop's):
       *
       *  - the rule is ONE device pixel at x 59 — 0.5 CSS px, at CSS 29.5..30.0
       *    against the Collection row's chevron centre of 30.25;
       *  - it runs y 143..242 CONTINUOUSLY, i.e. from 5 CSS px into the first
       *    child's row to 5 CSS px above the last child's row bottom (rows are
       *    40 device px: Camera 133..172, Cube 173..212, Light 213..252);
       *  - every one of those 100 pixels is exactly (101,101,101) — over the
       *    panel's #272727/#2a2a2a stripe, over the #1c304c selected bar AND
       *    over the #324c7f active bar — so the ink is OPAQUE #656565 and is
       *    painted OVER the row's fill, never mixed into it.
       *
       * Where the evidence stops: the frame nests exactly ONE level
       * (Scene Collection → Collection → three objects), and the root row
       * carries no chevron and no guide beneath it — measured, x 0..48 is
       * clear for the whole Collection row. What a row THREE levels deep
       * carries is therefore not photographed; `theme.css`'s
       * `.vgai-tree-indent-guide` records the reading taken and why.
       */
      readonly indent?: string;
      /**
       * A DIVIDER'S RULE — the line a chrome bar draws between two GROUPS of
       * its own controls, as against `default`, which outlines a widget.
       * Blender keeps them apart and we had one value for both.
       *
       * Optional, transcribing {@link indent}'s shape rather than inventing
       * one: a palette naming none is bit-identical to before this member
       * existed. The fallback differs only because the situations do — no
       * skin ever drew an indent guide, so absent there means `transparent`
       * and no guide; every skin draws this rule, so absent here means
       * `boundary.default`, which is what it drew.
       *
       * MEASURED, `topbar.png` at native 2x: the rule closing the menu words
       * before the workspace tabs is at x 488..489, y 6..45 — 2 device px
       * wide, 40 tall, a FLAT #2e2e2e (46) with no AA ramp on either side,
       * between the bar's own 23 and the tab strip's 28. Ours painted
       * `boundary.default` #3c3c3c (60), lighter than the strip it borders.
       *
       * ONE SITE, and the scope is the measurement's: `.vgai-project-menu-rule`
       * is the only divider in either frame I measured. The token is read
       * there and nowhere else; widening it to every `.vgai-divider` is a
       * later unit's, with its own frames.
       */
      readonly divider?: string;
    };
    readonly content: {
      readonly primary: string;
      readonly muted: string;
      readonly dim: string;
      readonly onAccent: string;
      /**
       * A MENU WORD — the ink of an unenclosed clickable word in a menu bar or
       * an area header. Its own role because a bar of words is neither a
       * widget's content nor a tree row's name: it is the loudest thing a
       * chrome band says, and Blender inks it one step under its panel text.
       *
       * Optional, and falls back to {@link primary} in the emitter, which is
       * what the top bar already paints (`ProjectHeader.css`, PR #7317) — a
       * palette naming no menu ink keeps that bar bit-identical.
       *
       * MEASURED, Blender 5.2 at native 2x, and the reason this is ONE member
       * and not two: the same #d8d8d8 (216) inks `File`/`Edit`/`Render` in the
       * top bar over its #171717 (23) band (`topbar.png`, eroded stroke
       * interiors peak at 216) AND `View`/`Select`/`Add`/`Mesh`/`Vertex`/
       * `Edge`/`Face`/`UV` in the 3D View's area header over its #343434 (52)
       * band (`modeling-edit-none.png`, x 420..1100, y 56..104 — the histogram
       * there tops out at exactly 216 with nothing above it). Two backdrops
       * 29 levels apart reading one value is what says the ink is OPAQUE
       * rather than an alpha at the site.
       *
       * IT REMOVES A SPLIT. Ours drew the two sites at two different members —
       * 229 `content.primary` in the top bar and 194 `content.muted` in the
       * area header (measured live before this member existed) — because the
       * area header's words inherit `.vgai-menu-trigger`'s base ink and only
       * the top bar carried an override. One role, one member, one rule.
       *
       * WHERE THE EVIDENCE STOPS: no reference frame photographs a HOVERED or
       * a DISABLED menu word, so the hover state keeps reading `content.primary`
       * as it did.
       */
      readonly menu?: string;
      /**
       * THE STATUS BAND'S OWN INK — the quietest text in the window, and its
       * own role because the band is one voice: every glyph, rule and digit in
       * it reads at one level regardless of what put them there.
       *
       * Optional, falling back to {@link dim} in the emitter, which is what
       * `.vgai-editor-bottom-bar` already inherits — a palette naming none
       * paints exactly what it painted before.
       *
       * MEASURED, Blender 5.2 at native 2x: the whole status band of
       * `modeling-edit-none.png` (the bottom 46 device px, full width)
       * histograms to a ceiling of #878787 (135) — 135 and its AA neighbour
       * 134 and nothing above either, against the 216 its menu words ink and
       * the 229 its panels do. `EditorBottomBar.css` recorded the 15 levels
       * between it and `content.dim` as residue rather than hardcode the hex;
       * this is the member that closes it.
       */
      readonly status?: string;
      /**
       * A FIELD'S PLACEHOLDER. Its own role because nothing else in the editor
       * is text that is not content — and because until this member existed a
       * BROWSER DEFAULT decided an ink in our product: no `::placeholder` rule
       * existed anywhere in the editor's CSS.
       *
       * MEASURED LIVE, and it corrects the reading that named this gap: Chrome
       * resolves its UA `::placeholder` to a FIXED rgb(117,117,117) here — the
       * same value for a field inked 229, 100, rgb(200,0,0) or black, four
       * samples in one page — so it is not composited from the field's own ink
       * at all. A fixed browser constant is exactly the thing a palette cannot
       * re-skin, which is the defect.
       *
       * MEASURED, Blender 5.2 at native 2x: the Outliner's `Search`
       * placeholder in `modeling-object-none.png` (x 3100..3260, y 60..96)
       * peaks at #5e5e5e (94) and stops there — below its own `content.dim`,
       * which is what a placeholder should be.
       *
       * Optional, falling back to {@link dim} — the palette's own quiet ink
       * and the only measured member on the right side of the field's text. A
       * palette naming none therefore moves off Chrome's constant; that is the
       * point, and it is stated rather than hidden, because reproducing a UA
       * constant in our own stylesheet would nail one browser's opinion into
       * the product under a different name.
       */
      readonly placeholder?: string;
      /**
       * THE ACTIVE SUBJECT'S OWN INK — the name of the one thing edits target,
       * where a palette wants that said in COLOUR rather than in fill.
       *
       * Optional, and emitted EMPTY when a palette names none (the `viewport`
       * group's answer, not `category`'s): the one reader is the hierarchy
       * row's label, which falls back to inheriting the row's ink, so a
       * palette without it paints exactly what it painted before.
       *
       * Blender is why it exists. Measured on `outliner.png` (native 2x): the
       * Cube — the active object — inks its NAME at #ffae28, an 82-pixel
       * plateau, while Camera and Light ink at the row's ordinary #c2c2c2.
       *
       * CORRECTED 2026-09-18, and the correction matters because this note was
       * the evidence behind "Blender marks the active row with the name and
       * nothing else": it used to add that the Cube's row FILL is the plain 42
       * stripe. That is true of `outliner.png` and says nothing about the state,
       * because `outliner.png` is cut from `modeling.png`, whose Outliner is
       * BYTE-IDENTICAL to `modeling-edit-none.png` — the Modeling workspace
       * opens in EDIT mode, where no object-mode selection exists to paint. In
       * `modeling-object-selected.png` the same Cube row carries a #324c7f band
       * inside a #5a74a7 hairline. The name is one of three marks, not the only
       * one; the other two are on `--vgai-tree-row-selected-bg` below.
       *
       * It is NOT `viewport.active`, and that is Blender's own distinction
       * rather than ours: its 3D View paints the active object's outline
       * #ffa028 where its Outliner inks the name #ffae28 — two theme entries,
       * fourteen levels of green apart, and this palette already carries the
       * first.
       */
      readonly active?: string;
      /**
       * THE SELECTED-BUT-NOT-ACTIVE SUBJECT'S INK — {@link active}'s other
       * half, for a palette whose reference distinguishes the two.
       *
       * Optional and emitted EMPTY the same way, and its one reader (the
       * hierarchy row's label) falls back to {@link active}, so a palette that
       * names only an active ink paints every selected row exactly what it
       * painted before.
       *
       * Measured on `modeling-object-selected.png` (object mode, every object
       * selected): Camera and Light — selected, not active — ink their names
       * #e86900 as solid plateaus, while the Cube inks #ffae28. It is not any
       * scaling or mix of the active ink (232/255, 105/174 and 0/40 are three
       * different ratios), which is why it is a second entry rather than a
       * derivation.
       */
      readonly selected?: string;
      /** Palette-owned ink ramp used only when Glass measures a bright backdrop. */
      readonly onBright: {
        readonly primary: string;
        readonly muted: string;
        readonly dim: string;
      };
    };
    readonly accent: { readonly default: string; readonly muted: string };
    readonly semantic: {
      readonly danger: string;
      readonly dangerMuted: string;
      readonly dangerFaint: string;
      readonly warning: string;
      readonly warningMuted: string;
      readonly success: string;
      readonly successMuted: string;
      readonly dynamic: string;
      readonly dynamicMuted: string;
      /**
       * Component-instance identity (H1) — since 2026-07-31 the color of the
       * dotted RULE under an instance row's name, not the name's own color
       * (owner: "perhaps underline instead of color"). Still MUST be
       * hue-bearing in every palette: a near-neutral value makes the rule
       * read as an artifact rather than a mark, which is the same defect this
       * role was split out of `accent` to fix. It carries less weight than it
       * did as text color, though — the underline is the signal and the hue
       * is the hint, so contrast here buys legibility, not the whole
       * distinction.
       */
      readonly instance: string;
    };
    readonly neutralOverlay: { readonly hover: string; readonly active: string };
    readonly scrim: string;
    /**
     * The 3D VIEWPORT's own colours — Blender's "3D Viewport" theme section
     * transcribed: window background, grid, the X and Y axis lines, the
     * selected and active object. Optional: a palette without it keeps the
     * editor's own (the accent selects, the dressing paints the background).
     * Read by `native-selection-style.ts` off the emitted tokens.
     */
    readonly viewport?: {
      readonly background: string;
      readonly grid: string;
      readonly axisX: string;
      readonly axisY: string;
      /** The Z axis line, where a view draws one (optional: the group's X and Y are the floor's
       *  pair in a Z-up world; without it the line takes the gizmo's Z). The axis colours are
       *  named by the WORLD's axes, whatever the world's up axis. */
      readonly axisZ?: string;
      /** The selection's WIRE (optional; the selection colour otherwise): Unity draws it blue
       *  under an orange outline. Its opacity is `density.viewport.wireOpacity`. */
      readonly wire?: string;
      readonly selection: string;
      readonly active: string;
    };
    /**
     * THE GIZMOS' COLOURS — the transform gizmo's handles and the navigation gizmo's axes, named
     * by the WORLD's axes (the stage's `world.upAxis` decides which one points up). `hover` and
     * `drag` are a fixed highlight (Unity's preselection and selected-axis colours, Unreal's
     * yellow); without them a handle highlights in its own axis colour, carried by
     * `density.viewport.gizmoHighlightSaturation`/`gizmoHighlightValue` (Blender's own colour;
     * Godot's at a quarter of its saturation, full value). `navigationX`/`Y`/`Z` colour the
     * navigation gizmo where it is drawn differently from the axes (Blender's balls), and
     * default to `x`/`y`/`z`. Each trio comes together or not at all; every member is otherwise
     * optional, and one left out keeps the editor's own. See `docs/VIEWPORT-STAGE.md`.
     */
    readonly gizmo?: {
      readonly x?: string;
      readonly y?: string;
      readonly z?: string;
      readonly navigationX?: string;
      readonly navigationY?: string;
      readonly navigationZ?: string;
      readonly hover?: string;
      readonly drag?: string;
    };
    /**
     * WIDGET COLOUR CLASSES — one fill per KIND of widget, the way Blender's
     * theme carries `wcol_regular`/`wcol_menu`/`wcol_text` rather than one
     * "raised surface". Optional, and every member is independently optional:
     * a palette that names none is byte-identical to before this group
     * existed, because each token falls back to the surface it used to read
     * (`regular`/`menu` → `surface.raised`, `field` → `surface.inset`).
     *
     * MEASURED, Blender 5.2 factory startup, reference frames at 2x (halved
     * here). The three classes really are three colours, which is the whole
     * reason the group exists — our single `surface.raised` painted a
     * dropdown trigger pushbutton-grey where Blender paints a dark well:
     *
     *  - `regular` — a pushbutton. `Add Modifier`, `properties-modifier.png`
     *    (src x=200, y 142–177): inner #535353.
     *  - `menu` — a dropdown/menu BUTTON. `Object Mode v` and `Global v`,
     *    `modeling-object-none.png` (src y=78, x 97–… and x 1172–…), and the
     *    Scene/ViewLayer ID selectors' icon half in `topbar.png` (src y=26,
     *    x 2791–2850): inner #272727. NOT the menu POPUP's background
     *    (Blender's `wcol_pulldown`/`wcol_menu_back`) — the shot runner
     *    cannot photograph an open menu (`scripts/blender-reference/README.md`
     *    records the two measurements that proved it), so no popup value is
     *    declared anywhere and the popup keeps `surface.overlay`.
     *  - `field` — a text field. The Search fields in `properties-modifier.png`
     *    (src x=380, y 7–42) and `outliner.png` (src x=400, y 7–42), and the
     *    Scene name half in `topbar.png` (src y=26, x 2853–…): inner #1c1c1c.
     *
     * NO `edge` member, and that is a measurement, not an omission: all three
     * classes outline in the SAME #3c3c3c, which the palette already carries
     * as `boundary.default` — the colour every one of these call sites
     * already borders with.
     *
     * Blender's `wcol_option` (a checkbox — `Add Rest Position`,
     * `properties-data-edit.png`, src y=758, x 92–115) measures #535353,
     * identical to `regular`, and our own checkbox is a native
     * `<input type="checkbox">` whose unchecked box no colour token can reach
     * without `appearance: none`. There is therefore nothing to declare and
     * nothing to read; it belongs to whichever unit redraws that control.
     *
     * `emboss` is the fourth member and the odd one out: it is not a FILL but
     * the 1 CSS px line Blender lays UNDER every widget, below that widget's
     * own `#3c3c3c` outline (Blender's `ThemeUserInterface.widget_emboss`).
     * Measured on five widget KINDS at native 2x, which is what says it is
     * one rule and not five decorations:
     *
     *  - pushbutton — `Add Modifier`, `properties-modifier.png` x=300:
     *    fill 142–177, outline 178–179, emboss 180–181.
     *  - text field — the datablock name, `properties-object.png` x=470:
     *    fill #1c1c1c 142–177, outline 178–179, emboss 180–181.
     *  - dropdown well — the datablock kind well, `properties-data-edit.png`
     *    x=103: fill #272727, outline 178–179, emboss 180–181.
     *  - checkbox — `Add Rest Position`, same frame x=103: fill #535353
     *    746–769, outline 770–771, emboss 772–773.
     *  - list box — Vertex Groups, same frame x=103: interior #2c2c2c,
     *    outline 424–425, emboss 426–427.
     *
     * THE VALUE IS TRANSLUCENT BLACK, NOT A COLOUR — that is the whole reason
     * it is declared as one token and not per surface. Read off four
     * different backdrops (median over 160–500 px each, single-valued in
     * every band):
     *
     *    backdrop                          emboss
     *    #272727 39  Outliner header       #212121 33
     *    #2f2f2f 47  Properties body       #282828 40
     *    #343434 52  3D View header        #2d2d2d 45
     *    #3c3c3c 60  a panel band          #333333 51
     *
     * No 8-bit alpha reproduces all four, and the browser leaves no finer
     * dial: Chrome QUANTIZES a `box-shadow` alpha to a byte (a declared
     * 0.142 reads back as `rgba(0, 0, 0, 0.14)` and composites as 36/255).
     * 36/255 renders 33/40/45/52 and 37/255 renders 33/40/44/51 — each is
     * three of four, and the one they miss is the OTHER one. 0.142 is
     * declared because the byte it lands on (36) is exact on the two
     * surfaces this look actually paints widgets over, the Properties body
     * (47 → 40, confirmed in our own capture) and the Outliner header
     * (39 → 33); the residue is +1 under a widget sitting on a panel BAND.
     * Only stacked widgets in one group escape the rule entirely: Blender's
     * Location X/Y/Z share outlines and the emboss lands under the GROUP.
     *
     * A palette that names no `emboss` emits `--vgai-widget-emboss-shadow:
     * none` and every widget paints exactly what it painted before this
     * member existed.
     */
    readonly widget?: {
      readonly regular?: string;
      readonly menu?: string;
      readonly field?: string;
      readonly emboss?: string;
    };
    /**
     * CATEGORY INKS — colour as a GLYPH's own channel, the way Blender's
     * Properties-tab rail carries it. That rail groups by HUE, and the hue is
     * the discriminator: at 14 px the tab shapes in `properties-object.png`
     * are near-indistinguishable, so what says "this is the Modifier group"
     * is that it is blue. The outliner says the same thing about a row's type
     * glyph, and an edit-mode operator mark says it about the element it
     * operates on.
     *
     * Optional, and every member is independently optional: each token
     * emits with a `currentColor` fallback, so a palette naming none paints
     * every glyph monochrome exactly as before this group existed. A glyph
     * takes a tone through the icon SET (`IconSetContribution`'s per-glyph
     * `tone`/`tonedPath`); the palette only says what each tone's ink is.
     *
     * EVERY VALUE HERE IS INK — the glyph's own colour at FULL opacity, never
     * the composite a particular chrome produces. The SITE applies Blender's
     * alpha. Corrected 2026-09-18 after the group was found in two colour
     * spaces: `object` had been sampled from the Object tab in
     * `properties-object.png`, which is the ACTIVE tab and paints its ink
     * FULL, while `modifier`/`material`/`tool`/`data` were sampled from
     * INACTIVE tabs in the same frame, which paint at α — so the green
     * rendered 31 levels low wherever the ink was wanted, and `modifier`
     * looked impossible to α-undo (its blue solved to 257).
     *
     * THE ALPHA IS 0.80, EXACTLY, and it is now PROVED rather than fitted,
     * because three inks are photographed at full in one frame each and the
     * same ink is photographed dimmed in another:
     *
     *   site                                          α
     *   Properties rail, ACTIVE tab                   1.00
     *   Properties rail, inactive tab                 0.80
     *   Outliner row glyph (active object or not)     0.80
     *   Edit-mode tool shelf                          1.00
     *
     * Object at 0.80 renders every channel of every sample exactly:
     * #e09557 over #1c1c1c → 28+0.8·(224−28, 149−28, 87−28) = (185,125,75) =
     * #b97d4b, which is the inactive Object tab in `properties-modifier.png`
     * and `properties-data-edit.png` (src x 10-56, y 522-549); over the
     * outliner's #272727 → (187,127,77) = #bb7f4d (`outliner.png`, the Camera
     * and Light rows, src x 126-155 / 129-152); over the selected row's
     * #525252 → (196,136,86) = #c48856 (the Cube row's own glyph plate,
     * src x 121-160). The earlier 0.791 came from the two-background form
     * (196−187)/(82−39), where 195.6 had rounded UP to 196 — one quantisation
     * step in the numerator, 1% in the answer, and enough to put `modifier`
     * out of gamut.
     *
     *  - `object` — #e09557, PHOTOGRAPHED at full: `properties-object.png`,
     *    the ACTIVE Object tab (src x 10-56, y 522-549), over its #2f2f2f
     *    open-tab plate. Unchanged by the correction; it was always ink.
     *  - `modifier` — #73a1ff, PHOTOGRAPHED at full: `properties-modifier.png`,
     *    the ACTIVE Modifier tab (src y 578-605) = (115,161,255). Its dimmed
     *    form #6286d1 (this member's former value) is that ink at 0.80 over
     *    #1c1c1c, and Particles/Physics/Constraints (y 634-774) measure the
     *    identical blue, which is the grouping.
     *  - `data` — #00d3a2, PHOTOGRAPHED at full: `properties-data-edit.png`,
     *    the ACTIVE Object Data tab (src y 802-829) = (0,211,162). Its red is
     *    CLAMPED AT ZERO, which is why α-undoing it from a composite was
     *    unstable: the outliner's three data glyphs paint (7,176,137) on the
     *    row's 39, (15,184,145) on a #4f4f4f icon plate and (5,182,141) on the
     *    Cube's tinted plate (`outliner.png` src x 266-327, y 135-247), and
     *    all three resolve to this one ink at 0.80 only once the red is read
     *    as 0.2·backdrop rather than as ink.
     *  - `material` — #cb646e, DERIVED, not photographed: no reference frame
     *    opens the Material tab, so this is the inactive #a8565e
     *    (`properties-object.png` src y 858-885) α-undone at 0.80. It
     *    re-renders that composite byte-for-byte; if a frame ever shows the
     *    tab open, read it there instead.
     *  - `tool` — #cbcbcb, DERIVED the same way from the inactive #a8a8a8
     *    (`properties-object.png`, the Tool tab, src y 82-109; Render, Output,
     *    View Layer and Scene, y 155-350, measure the identical grey). The
     *    scene-level tabs are deliberately the quiet, hue-less group and read
     *    DIMMER than the row text (#c2c2c2) only because they are dimmed —
     *    the ink itself is lighter than the text.
     *  - `operator` — #95dab2. `modeling-edit-none.png`, the edit-mode tool
     *    column: Add Cube (src x 36-86, y 690-740), Extrude (y 990-1030),
     *    Loop Cut / Knife / Poly Build (y 1080-1280). Already ink and
     *    unchanged: that shelf is a 1.00 site (its neutral bodies measure
     *    #e4e4e4 over #272727, which no α below 1 can produce). Only the
     *    OPERATED element takes the tint; the cube stays #e3e3e3.
     *
     * MEASURED BUT NOT DECLARED. Every ink below was read off a frame; none
     * is declared, because a member no glyph can paint is a name with no
     * caller. The coordinates are here so the unit that earns one
     * transcribes rather than re-measures:
     *
     *  - `world` — #cb646e at ink (the World tab, `properties-object.png`
     *    src x 10-56, y 378-405, measures #a6555d inactive), within a level
     *    of `material` because Blender puts World and Material in one red
     *    group. Nothing in this editor draws a globe to MEAN a World
     *    datablock: `faGlobe`'s sites are the transform-SPACE toggle and a
     *    build profile, where red reads as an error state.
     *  - no `camera`/`light` — in `outliner.png` the camera and light OBJECT
     *    glyphs measure #bb7f4d, byte-identical to the mesh object's, and
     *    their DATA glyphs measure the same green as the mesh's. Blender's
     *    outliner discriminates object-vs-data, not camera-vs-light.
     *  - no `accent` — no glyph in any frame paints in the palette's accent.
     *  - `deform` — #d6c1e4. Blender's edit-mode column carries a SECOND
     *    operator tint, a lilac on the deforming tools (Smooth src x 36-88
     *    y 1330-1380, Shear y 1500-1550, Edge Slide y 1420-1470) against the
     *    creating tools' green. Our glyph set ships none of those operators.
     */
    readonly category?: {
      readonly object?: string;
      readonly modifier?: string;
      readonly material?: string;
      readonly tool?: string;
      readonly operator?: string;
      /** Mesh DATA — Blender's green Object Data tab and its outliner data
       *  glyphs: `.tui.icon_object_data` #00d4a3
       *  (`userdef_default_theme.c:275`), which every `DEF_ICON_OBJECT_DATA`
       *  mark paints in. */
      readonly data?: string;
      /** Blender's SCENE group — the Render, Output, View Layer and Scene
       *  tabs, every one of them a `DEF_ICON_SCENE` in `UI_icons.hh`:
       *  `.tui.icon_scene` #cccccc (`userdef_default_theme.c:272`). Note the
       *  World tab is NOT in it — `UI_icons.hh:193` declares it
       *  `DEF_ICON_SHADING(WORLD)`, so it takes `material` with Material and
       *  Texture. That correction is what reading the source bought over
       *  reading the rail. */
      readonly scene?: string;
      /** Blender's COLLECTION group — one tab, `DEF_ICON_COLLECTION(GROUP)`
       *  (`UI_icons.hh:248`): `.tui.icon_collection` #ffffff
       *  (`userdef_default_theme.c:273`). White rather than the scene grey,
       *  which is why it is its own name. */
      readonly collection?: string;
    };
    /**
     * REGION FILLS — one colour per EDITOR AREA, the way Blender's theme
     * carries `theme.outliner.back` and `theme.properties.back` rather than
     * one "panel". Our dock paints every group from a single
     * `--dv-group-view-background-color`, so before this member a panel could
     * not have its own fill and the Outliner sat eight levels too light.
     *
     * A region names ONE colour and it paints the area's BODY AND ITS HEADER,
     * because that is what the frames measure — see below. Optional, and every
     * member is independently optional: an undeclared region falls back to
     * what its call sites already read (`surface.panel` for the body,
     * `surface.chrome` for the header), so a palette naming none is
     * byte-identical to before this group existed.
     *
     * A panel claims a region by name in `workspace-static-panels.ts`
     * ({@link EditorRegionName}); the workspace host applies the ACTIVE
     * panel's claim to the region it sits in. A panel that claims none is
     * unchanged.
     *
     * MEASURED, Blender 5.2 factory startup, `modeling.png` at 2x (source
     * coordinates in the 2x frame):
     *
     *  - `outliner` — #272727, BODY AND HEADER ALIKE. Body: row y=300 over
     *    x 2845..3448 is #272727 with the row alternation stepping to
     *    #2a2a2a. Header: row y=75 between the search field and the chevron
     *    (x 3260..3345) is the identical #272727. Our `surface.chrome`
     *    #1c1c1c painted that header eleven levels DARKER than its own body,
     *    where Blender's is the same colour — the header does not read as a
     *    slab there at all.
     *  - `properties` — #2f2f2f, body and header alike. Body: column x=3400,
     *    y 608..2054 is #2f2f2f. Header: row y=450 over x 2924..3030 and
     *    x 3261..3395 is #2f2f2f. The body already matched `surface.panel`;
     *    the member exists for the HEADER, which was #1c1c1c.
     *
     * NOT DECLARABLE HERE, and it is the one place Blender's header differs
     * from its body: the 3D viewport's header is #343434 over a #3f3f3f back
     * (`modeling.png` y=108 is 52, y=109 is 63). That area is not a dock
     * panel — it is the document surface, whose fill is `viewport.background`
     * and whose header is `--vgai-surface-header` — so it takes no region
     * claim and the "one colour, header and body" rule above stands for
     * everything this member can reach.
     */
    readonly region?: { readonly [name in EditorRegionName]?: string };
  };
  readonly typography: { readonly sans: string; readonly mono: string };
  readonly shape: {
    readonly small: string;
    readonly medium: string;
    readonly large: string;
    readonly full: string;
  };
  readonly elevation: { readonly small: string; readonly medium: string; readonly large: string };
  /** A material's own chrome density (`editor-appearance.ts`); absent means
   *  the editor's own `controlSize`/`fontSize`/`chromeSize`. */
  readonly density?: EditorDensity;
  /**
   * Surface-treatment vocabulary (Glass-UI spike, W3 — work item 3).
   * Optional: absent means no backdrop treatment, matching every existing
   * theme's opaque panels. Extensible record for future treatment axes;
   * only backdrop blur/ saturation are defined for now. A "glass" look is
   * entirely DATA here — no `[data-vgai-theme=…]` CSS special-casing
   * exists or should be added; `editorThemeVariables` is the only place
   * this is consumed.
   */
  readonly treatment?: {
    /** Backdrop blur radius in px (0–64). */
    readonly backdropBlurPx?: number;
    /** Backdrop saturation multiplier (0–3; 1 = unchanged). */
    readonly backdropSaturation?: number;
    /**
     * Backdrop brightness multiplier (0–2; 1 = unchanged). The luminance
     * clamp that keeps dark-glass text legible over arbitrarily bright scene
     * content (glass-UI W7, report §2.22): a value below 1 darkens whatever
     * the card floats over BEFORE the translucent panel color composites, so
     * a pure-white backdrop can never wash out card chrome.
     */
    readonly backdropBrightness?: number;
    /**
     * Liquid Glass Tier-1 edge-specular intensity (0–1; report §2.24). Drives
     * the alphas of the pure-CSS "light catching the edge" trio — the 1.5px
     * gradient border ring, the 1px inset rim catches, and the diagonal
     * sheen — all emitted as `--vgai-card-specular-*` variables and painted
     * by `workspace-dock.css`'s card-chrome pseudo-elements. 0/absent means
     * none of the three paint. Calibrated so 0.6 reproduces the committed
     * prototype's variant-B alphas exactly
     * (`docs/assets/glass-ui-feasibility/liquid-glass-proto/index.html`).
     */
    readonly edgeSpecular?: number;
    /**
     * Direction the specular "light" arrives from, in degrees (0–360;
     * default 120 — upper-left key light, matching the prototype). Rotates
     * both the ring gradient and the sheen; only meaningful when
     * `edgeSpecular` > 0.
     */
    readonly specularAngleDeg?: number;
    /**
     * Liquid Glass Tier-1 thickness cue (0–1; report §2.24): scales the
     * geometry of the inset-shadow depth pair (upper glass glow + lower
     * inner shadow) and the card's drop shadow. 0/absent keeps the theme's
     * ordinary `elevation.large` card shadow. Calibrated so 0.5 reproduces
     * the prototype's variant-B depths exactly.
     */
    readonly thickness?: number;
    /**
     * Liquid Glass refraction: width of the refracting bezel band in px
     * (4–80; the owner-reopened visual default is 56). Only meaningful when
     * `refractionThickness` > 0. Displacement follows the convex-squircle
     * height profile from full bend at the rim to zero at the bezel's inner
     * boundary; the interior is strictly neutral — the backdrop passes
     * through untouched (`components/glass-refraction.ts`).
     */
    readonly refractionBezelPx?: number;
    /**
     * Liquid Glass refraction: slab-thickness factor (0–2; ×40px of glass;
     * the owner-reopened visual default is 1.25). This is THE refraction knob — the
     * `feDisplacementMap` scale is physically DERIVED from the generated
     * field's max magnitude, never authored directly. 0/absent means no
     * refraction. Capability-gated at the surface host
     * (`components/glass-refraction.ts`): it only ever paints when Chromium
     * supports `backdrop-filter: url(#…)` AND the GPU is not a software
     * rasterizer; everywhere else the plain
     * `--vgai-surface-backdrop-filter` list paints instead, automatically.
     * Distinct from `thickness` (the Tier-1 inset-shadow depth cue), which
     * survives as an independent axis.
     */
    readonly refractionThickness?: number;
    /**
     * Content-legibility text shadow opacity (0–1): emits
     * `--vgai-content-text-shadow: 0 1px 2px rgba(0,0,0,<v>)` inherited by
     * all editor chrome. The §2.32 legibility finding: near-white text +
     * concentrated text-shadow is the correct default over a predominantly dark
     * viewport when the surface itself is a ≤15% white whisper (a full
     * adaptive palette is a later unit). 0/absent emits `none` — every
     * pre-existing theme is byte-identical.
     */
    readonly textShadowOpacity?: number;
    /**
     * Maximum body/content frost blur in px (0–24; §2.31 P2 owner
     * amendment). On the SVG path the lens blends from its clear rim toward
     * this blur with optical depth. `.vgai-content-frost` also applies the
     * same value locally behind text-dense zones, using a colorless/light
     * material lift rather than black paint. 0/absent emits
     * `none`/`transparent`, so treatment-less themes stay byte-identical.
     */
    readonly contentFrostBlurPx?: number;
    /**
     * Faint ambient lift (P6-U6 owner taste decision 2, approved
     * 2026-07-19): peak white alpha (0–1, faint — ≤0.1 territory) of a
     * fixed top-lit luminance wash layered with card/island fills so
     * clear glass still reads as a surface over a pure-black void —
     * physically a glass sheet over black IS invisible, and the owner
     * chose a subtle ambient light response over accepting the physics.
     * Emitted as the `--vgai-ambient-lift` background-image layer
     * (gradient geometry is a design constant here; this axis is only the
     * intensity). 0/absent emits `none` — every pre-existing theme and
     * every lite/reduced-transparency fallback paints byte-identically.
     */
    readonly ambientLiftOpacity?: number;
    /** Enable measured per-surface use of the palette's bright-backdrop ink ramp. */
    readonly adaptiveContent?: boolean;
    /** Bright-side text-shadow opacity; material physics, never palette chroma. */
    readonly brightTextShadowOpacity?: number;
    /** Bright-side content frost tint; material physics, never content ink. */
    readonly brightFrostBg?: string;
  };
  /** Resolved axis identity. Legacy standalone themes are inferred when absent. */
  readonly appearance?: {
    readonly material: 'classic' | 'glass';
    readonly transparency: 'standard' | 'reduced';
  };
}

export const graphiteDarkEditorTheme: EditorTheme = {
  id: 'graphite-dark',
  color: {
    surface: {
      shell: GRAPHITE_BG[0],
      panel: GRAPHITE_BG[1],
      chrome: GRAPHITE_BG[2],
      raised: GRAPHITE_BG[3],
      inset: GRAPHITE_BG.inset,
      overlay: 'rgba(36,36,36,0.94)',
    },
    boundary: { default: GRAPHITE_BORDER[1], strong: GRAPHITE_BORDER[2] },
    content: {
      primary: GRAPHITE_TEXT[1],
      muted: GRAPHITE_TEXT[2],
      dim: GRAPHITE_TEXT[3],
      onAccent: '#101820',
      onBright: {
        primary: '#1a2330',
        muted: 'rgba(26,35,48,0.82)',
        dim: 'rgba(26,35,48,0.74)',
      },
    },
    accent: { default: GRAPHITE_ACCENT, muted: GRAPHITE_ACCENT_MUTED },
    semantic: {
      danger: GRAPHITE_DANGER,
      dangerMuted: GRAPHITE_DANGER_MUTED,
      dangerFaint: GRAPHITE_DANGER_FAINT,
      warning: GRAPHITE_WARN,
      warningMuted: GRAPHITE_WARN_MUTED,
      success: GRAPHITE_SUCCESS,
      successMuted: GRAPHITE_SUCCESS_MUTED,
      dynamic: GRAPHITE_DYNAMIC,
      dynamicMuted: GRAPHITE_DYNAMIC_BG,
      instance: GRAPHITE_INSTANCE,
    },
    neutralOverlay: {
      hover: 'rgba(255,255,255,0.08)',
      active: 'rgba(255,255,255,0.14)',
    },
    scrim: GRAPHITE_SCRIM,
  },
  typography: { sans: GRAPHITE_FONT_SANS, mono: GRAPHITE_FONT_MONO },
  shape: {
    small: DEFAULT_RADIUS.small,
    medium: DEFAULT_RADIUS.medium,
    large: DEFAULT_RADIUS.large,
    full: DEFAULT_RADIUS.full,
  },
  elevation: {
    small: GRAPHITE_SHADOW.sm,
    medium: GRAPHITE_SHADOW.md,
    large: GRAPHITE_SHADOW.lg,
  },
};

/** Neutral palette used by the default Glass style without rewriting Classic. */
export const graphiteNeutralEditorTheme: EditorTheme = {
  ...graphiteDarkEditorTheme,
  id: 'graphite-neutral',
  color: {
    ...graphiteDarkEditorTheme.color,
    content: {
      primary: GRAPHITE_NEUTRAL_TEXT[1],
      muted: GRAPHITE_NEUTRAL_TEXT[2],
      dim: GRAPHITE_NEUTRAL_TEXT[3],
      onAccent: '#101820',
      onBright: {
        primary: '#1a2330',
        muted: 'rgba(26,35,48,0.82)',
        dim: 'rgba(26,35,48,0.74)',
      },
    },
    accent: {
      default: GRAPHITE_NEUTRAL_ACCENT,
      muted: GRAPHITE_NEUTRAL_ACCENT_MUTED,
    },
  },
};

/**
 * Production high-contrast theme. It deliberately preserves the editor's
 * dark, low-glare character while increasing text/boundary separation and
 * shifting the accent away from the default graphite palette.
 */
export const midnightHighContrastEditorTheme: EditorTheme = {
  id: 'midnight-high-contrast',
  color: {
    surface: {
      shell: '#0b0f14',
      panel: '#111821',
      chrome: '#17212c',
      raised: '#223040',
      inset: '#080c11',
      overlay: 'rgba(17,24,33,0.96)',
    },
    boundary: { default: '#34465a', strong: '#71869d' },
    content: {
      primary: '#f2f5f8',
      muted: '#bdc8d5',
      dim: '#8493a5',
      onAccent: '#071019',
      onBright: {
        primary: '#071019',
        muted: 'rgba(7,16,25,0.82)',
        dim: 'rgba(7,16,25,0.72)',
      },
    },
    accent: { default: '#65d1ff', muted: 'rgba(101,209,255,0.18)' },
    semantic: {
      danger: '#ff7b86',
      dangerMuted: 'rgba(255,123,134,0.18)',
      dangerFaint: 'rgba(255,123,134,0.08)',
      warning: '#f3c969',
      warningMuted: 'rgba(243,201,105,0.16)',
      success: '#62d394',
      successMuted: 'rgba(98,211,148,0.18)',
      dynamic: '#e889ff',
      dynamicMuted: 'rgba(232,137,255,0.12)',
      // This is the ONE palette whose accent already owns cyan (#65d1ff), so
      // instance identity takes the next-widest free gap instead — the
      // indigo/periwinkle band between the accent (~198°) and dynamic
      // (~288°), ~45° clear of both.
      instance: '#a49bff',
    },
    neutralOverlay: {
      hover: 'rgba(255,255,255,0.10)',
      active: 'rgba(255,255,255,0.18)',
    },
    scrim: 'rgba(0,0,0,0.68)',
  },
  typography: { sans: GRAPHITE_FONT_SANS, mono: GRAPHITE_FONT_MONO },
  shape: { small: '3px', medium: '6px', large: '8px', full: '9999px' },
  elevation: {
    small: '0 2px 8px rgba(0,0,0,0.72)',
    medium: '0 6px 18px rgba(0,0,0,0.68)',
    large: '0 12px 40px rgba(0,0,0,0.76)',
  },
};

/**
 * Glass-UI spike (W3, work item 3): graphite-derived, translucent built-in
 * theme. Surface alphas target panel alpha >= 0.55
 * COMPOSITED (i.e. after `backdropSaturation`'s perceived contrast boost)
 * to keep text-on-surface contrast workable over arbitrary live 3D content
 * — the spike's proven `color-mix(... 62%, transparent)` card recipe,
 * expressed here as theme data instead of injected CSS. Elevation is
 * strengthened slightly over graphite-dark: a translucent card needs a more
 * assertive shadow to read as "above" the scene it is blurring.
 */
export const glassDarkEditorTheme: EditorTheme = {
  id: 'glass-dark',
  appearance: { material: 'glass', transparency: 'standard' },
  color: {
    surface: {
      shell: 'rgba(26,26,26,0.88)',
      panel: 'rgba(36,36,36,0.62)',
      chrome: 'rgba(44,44,44,0.68)',
      raised: 'rgba(51,51,51,0.74)',
      inset: 'rgba(30,30,30,0.7)',
      overlay: 'rgba(36,36,36,0.55)',
    },
    boundary: { default: 'rgba(255,255,255,0.14)', strong: 'rgba(255,255,255,0.24)' },
    content: {
      primary: GRAPHITE_TEXT[1],
      muted: GRAPHITE_TEXT[2],
      dim: GRAPHITE_TEXT[3],
      onAccent: '#101820',
      onBright: {
        primary: '#1a2330',
        muted: 'rgba(26,35,48,0.82)',
        dim: 'rgba(26,35,48,0.74)',
      },
    },
    accent: {
      default: GRAPHITE_NEUTRAL_ACCENT,
      muted: GRAPHITE_NEUTRAL_ACCENT_MUTED,
    },
    semantic: {
      danger: GRAPHITE_DANGER,
      dangerMuted: GRAPHITE_DANGER_MUTED,
      dangerFaint: GRAPHITE_DANGER_FAINT,
      warning: GRAPHITE_WARN,
      warningMuted: GRAPHITE_WARN_MUTED,
      success: GRAPHITE_SUCCESS,
      successMuted: GRAPHITE_SUCCESS_MUTED,
      dynamic: GRAPHITE_DYNAMIC,
      dynamicMuted: GRAPHITE_DYNAMIC_BG,
      instance: GRAPHITE_INSTANCE,
    },
    neutralOverlay: {
      hover: 'color-mix(in srgb, currentColor 9%, transparent)',
      active: 'color-mix(in srgb, currentColor 14%, transparent)',
    },
    // Lighter dim than the opaque themes — the modal scrim's blur
    // (`--vgai-scrim-backdrop-filter`, emitted for every treatment theme)
    // does the separation work, the macOS read (P6-U6 owner taste
    // decision 3). The lite fallback pins the original heavy dim.
    scrim: 'rgba(0,0,0,0.35)',
  },
  typography: { sans: GRAPHITE_FONT_SANS, mono: GRAPHITE_FONT_MONO },
  shape: {
    small: DEFAULT_RADIUS.small,
    medium: DEFAULT_RADIUS.medium,
    large: DEFAULT_RADIUS.large,
    full: DEFAULT_RADIUS.full,
  },
  elevation: {
    small: '0 4px 16px rgba(0,0,0,0.55)',
    medium: '0 8px 28px rgba(0,0,0,0.5)',
    large: '0 16px 48px rgba(0,0,0,0.55)',
  },
  // brightness 0.5 tuned live over a pure-white scene (W7 contrast session,
  // report §2.22): 0.65 was invisible over white, 0.2 killed the backdrop
  // bleed entirely; 0.5 holds crisp text over white while the scene still
  // reads through every card.
  // Liquid Glass Tier-1 axes (report §2.24) tuned live over the dark
  // template scene AND a forced-white scene (0/0.4/0.55/0.6/0.8 specular ×
  // 0.3/0.5/0.7 thickness close-up matrix): edgeSpecular 0.6 — the exact
  // prototype-B reference the owner reviewed; 0.8 over-brightens the lit
  // corner until it merges into a white backdrop, 0.4 is invisible at
  // editor-card sizes, and the feared ring-plus-1px-boundary "doubled edge"
  // does not materialize at 0.6. Angle 120 (upper-left key light).
  // Thickness 0.5 — the prototype-B depth pair unchanged; 0.7 pushed the
  // lower inner shadow into a visible dark band across the card bottom.
  treatment: {
    backdropBlurPx: 14,
    backdropSaturation: 1.3,
    backdropBrightness: 0.5,
    edgeSpecular: 0.6,
    specularAngleDeg: 120,
    thickness: 0.5,
  },
};

/**
 * Measured-fallback built-in (Glass-UI feasibility report §2.5, "Measured
 * frame-throughput impact"): the report's conclusion is that translucency
 * itself is frame-free but the blur-bearing `backdrop-filter` is not, so a
 * no-filter treatment must ship as a first-class fallback — not just a
 * theoretical escape hatch — for hardware where the backdrop filter is
 * unaffordable. Derived from `glassDarkEditorTheme` with NO `treatment` key
 * (so `editorThemeVariables` emits `--vgai-surface-backdrop-filter: none`)
 * and surface alphas raised to compensate for the legibility that blur would
 * otherwise have provided: panel 0.62->0.78, chrome 0.68->0.82, raised
 * 0.74->0.86, inset 0.70->0.82; shell/overlay are unchanged since they were
 * already high-alpha. Values are decided by the report; do not retune here.
 */
export const glassDarkLiteEditorTheme: EditorTheme = (() => {
  // Destructure `treatment` out rather than setting it to `undefined` —
  // `exactOptionalPropertyTypes` treats those as different, and the whole
  // point of this theme is that the key is ABSENT (matching every other
  // no-blur theme), not present-with-undefined.
  const { treatment: _treatment, ...glassDarkWithoutTreatment } = glassDarkEditorTheme;
  return {
    ...glassDarkWithoutTreatment,
    id: 'glass-dark-lite',
    appearance: { material: 'glass', transparency: 'reduced' },
    color: {
      ...glassDarkEditorTheme.color,
      // U6.5 F8: the reduced-transparency tier is SOLID, not merely
      // higher-alpha — the audit (shot 25) caught the scene reading through
      // the former translucent fills, defeating the accessibility request
      // outright ("the ladder says lite → solid"). Values are the previous
      // translucent tints composited over the shell, so the hue family is
      // unchanged; only the see-through is gone.
      surface: {
        shell: '#1a1a1a',
        panel: '#222222',
        chrome: '#292929',
        raised: '#303030',
        inset: '#1d1d1d',
        overlay: '#202020',
      },
      // No treatment ⇒ no scrim blur; the dim must carry modal separation
      // alone, so this fallback keeps the pre-P6-U6 heavy scrim. (The scrim
      // stays translucent by function — dimming IS its job.)
      scrim: GRAPHITE_SCRIM,
    },
  };
})();

/**
 * REAL liquid glass (owner direction reset, report §2.31; material proven in
 * §2.32's demo — `docs/assets/glass-ui-feasibility/liquid-glass-real/`).
 * The surface has NO background fill of its own: panel is a 6% white
 * "material presence" whisper (never a dark fill — the owner rejected the
 * tinted-frost model outright: "Real glass morphism has no background color
 * and instead morphs the colors behind it"). The material reads as glass
 * because the backdrop's colors BEND at the bezel and keep displacing as
 * optical depth increases through the body (`refractionBezelPx` /
 * `refractionThickness`, painted by `components/glass-refraction.ts`). Frost
 * 1px + saturate 1.15 are carried by `backdropBlurPx` /
 * `backdropSaturation` so the non-Chromium plain-list fallback and the SVG
 * chain cannot drift. Treatment numbers were strengthened after the owner
 * visual review: bezel 56, thickness 1.25, frost 1px, saturation 1.15, tint
 * 6%. Content is near-white with a subtle
 * text shadow (the §2.32 legibility finding for a predominantly dark
 * viewport; adaptive palette is a later unit). No `backdropBrightness`:
 * darkening the backdrop was part of the rejected frost model.
 */
export const liquidGlassEditorTheme: EditorTheme = {
  id: 'liquid-glass',
  appearance: { material: 'glass', transparency: 'standard' },
  color: {
    surface: {
      shell: GLASS_MATERIAL.color.surface.shell,
      // THE glass surface — 6% white, the §2.32 "material presence" whisper.
      panel: GLASS_MATERIAL.color.surface.panel,
      chrome: GLASS_MATERIAL.color.surface.chrome,
      raised: GLASS_MATERIAL.color.surface.raised,
      // Input wells recess by shading, not by an opaque slab: a control
      // fill, not a panel surface (the §2.31 ban is on surface fills).
      inset: GLASS_MATERIAL.color.surface.inset,
      overlay: GLASS_MATERIAL.color.surface.overlay,
    },
    boundary: GLASS_MATERIAL.color.boundary,
    content: {
      primary: '#f2f6fb',
      // Dark-side ramp polish (P3, owner directive #3): muted/dim tuned FOR
      // the clear glass surface rather than inherited from the opaque-panel
      // ramp — over live scene content the old 0.72/0.55 alphas dropped
      // secondary text below comfortable legibility the moment the backdrop
      // carried any detail. Raised presence, same near-white family
      // (measured on the rts mid-green worst case: muted 0.8 read 3.6:1;
      // 0.85 is the highest alpha that still reads as a distinct tier).
      muted: 'rgba(242,246,251,0.85)',
      dim: 'rgba(242,246,251,0.68)',
      onAccent: '#0b1526',
      onBright: {
        primary: '#1a2330',
        muted: 'rgba(26,35,48,0.82)',
        dim: 'rgba(26,35,48,0.74)',
      },
    },
    // Legacy resolved-theme export kept neutral too. The canonical Glass
    // material itself cannot carry an accent; hue comes from a palette.
    accent: {
      default: GRAPHITE_NEUTRAL_ACCENT,
      muted: GRAPHITE_NEUTRAL_ACCENT_MUTED,
    },
    semantic: {
      danger: '#ff7b86',
      dangerMuted: 'rgba(255,123,134,0.22)',
      dangerFaint: 'rgba(255,123,134,0.10)',
      warning: '#ffd35f',
      warningMuted: 'rgba(255,211,95,0.18)',
      success: '#58e078',
      successMuted: 'rgba(88,224,120,0.20)',
      dynamic: '#ff8fd8',
      dynamicMuted: 'rgba(255,143,216,0.14)',
      // Brighter sibling of the graphite cyan, matching this theme's lifted
      // semantic family (its danger/warning/success are all brighter too).
      instance: '#3ad2ea',
    },
    neutralOverlay: GLASS_MATERIAL.color.neutralOverlay,
    // Lighter dim + scrim blur (`--vgai-scrim-backdrop-filter`) — the macOS
    // modal read, P6-U6 owner taste decision 3; lite pins the heavier dim.
    scrim: GLASS_MATERIAL.color.scrim,
  },
  typography: { sans: GRAPHITE_FONT_SANS, mono: GRAPHITE_FONT_MONO },
  // Rounder shapes than graphite: the lens corner IS the material — a
  // larger card radius gives the bezel band a visible curve to bend around
  // (the demo's card is 24px; 14px keeps editor density workable).
  // `full` must be a px value, never 50%: restyle2 U0 killed the 50% oval
  // token (50% renders an ellipse on any non-square element) and pill
  // consumers are specified against true half-circle end caps.
  shape: GLASS_MATERIAL.shape,
  // Soft, deep drop shadows (the demo's `.glass` stack): a clear surface
  // needs shadow — not fill — to read as "above" the scene.
  elevation: GLASS_MATERIAL.elevation,
  treatment: GLASS_MATERIAL.treatment,
};

/**
 * Liquid-glass degrade tier (reduced transparency / no-treatment
 * environments), following the `glass-dark-lite` precedent: the SAME
 * palette family with NO `treatment` key (so
 * `--vgai-surface-backdrop-filter` emits `none` and
 * `--vgai-card-refraction-thickness` emits `0`) and — U6.5 F8 — SOLID
 * fills: the audit (shot 25) caught the scene reading through the former
 * `rgba(255,255,255,0.14)` card fills with no backdrop-filter to earn the
 * translucency, defeating the reduced-transparency request outright ("the
 * ladder says lite → solid"). Each value is the previous light tint
 * composited over the #12161f shell (panel 0.14, chrome 0.18, raised 0.24,
 * overlay 0.16; inset's dark wash over the solid panel), so the lifted
 * blue-gray family reads the same — opaque.
 */
export const liquidGlassLiteEditorTheme: EditorTheme = (() => {
  // Destructure `treatment` out rather than setting it to `undefined` —
  // `exactOptionalPropertyTypes` treats those as different, and the whole
  // point of this theme is that the key is ABSENT (same idiom as
  // `glassDarkLiteEditorTheme`).
  const { treatment: _treatment, ...liquidGlassWithoutTreatment } = liquidGlassEditorTheme;
  return {
    ...liquidGlassWithoutTreatment,
    id: 'liquid-glass-lite',
    appearance: { material: 'glass', transparency: 'reduced' },
    color: {
      ...liquidGlassEditorTheme.color,
      surface: GLASS_MATERIAL.reducedTransparency.surface,
      // No treatment ⇒ no scrim blur; keep the pre-P6-U6 heavier dim so
      // modal separation survives the degrade. (Scrims stay translucent by
      // function — dimming IS their job.)
      scrim: GLASS_MATERIAL.reducedTransparency.scrim,
    },
  };
})();

export const editorThemes = {
  'graphite-dark': graphiteDarkEditorTheme,
  'graphite-neutral': graphiteNeutralEditorTheme,
  'midnight-high-contrast': midnightHighContrastEditorTheme,
  'glass-dark': glassDarkEditorTheme,
  'glass-dark-lite': glassDarkLiteEditorTheme,
  'liquid-glass': liquidGlassEditorTheme,
  'liquid-glass-lite': liquidGlassLiteEditorTheme,
} as const satisfies Record<string, EditorTheme>;

export type EditorThemeId = keyof typeof editorThemes;

export function isEditorThemeId(value: unknown): value is EditorThemeId {
  return typeof value === 'string' && Object.hasOwn(editorThemes, value);
}

/** Semantic CSS-variable references for rendered editor chrome. */
export const themeVars = {
  surface: {
    shell: 'var(--vgai-surface-shell)',
    panel: 'var(--vgai-surface-panel)',
    chrome: 'var(--vgai-surface-chrome)',
    raised: 'var(--vgai-surface-raised)',
    inset: 'var(--vgai-surface-inset)',
    overlay: 'var(--vgai-surface-overlay)',
  },
  boundary: {
    default: 'var(--vgai-boundary-default)',
    strong: 'var(--vgai-boundary-strong)',
  },
  content: {
    primary: 'var(--vgai-content-primary)',
    muted: 'var(--vgai-content-muted)',
    dim: 'var(--vgai-content-dim)',
    onAccent: 'var(--vgai-content-on-accent)',
    /** The ACTIVE subject's own ink; EMPTY under a palette that names none,
     *  so a site reading it must write its own fallback. */
    active: 'var(--vgai-content-active)',
    /** The SELECTED-but-not-active subject's ink; EMPTY the same way, and the
     *  emitter already falls it back to {@link active}, so a palette naming
     *  only an active ink resolves this to that. (The fallback is in the
     *  EMITTER and not in a `var(…, …)` default, because every variable is
     *  always emitted — as `''` when absent — so a CSS fallback would never
     *  fire.) */
    selected: 'var(--vgai-content-selected)',
  },
  accent: {
    default: 'var(--vgai-accent)',
    muted: 'var(--vgai-accent-muted)',
  },
  selection: {
    background: 'var(--vgai-selection-bg)',
    border: 'var(--vgai-selection-border)',
    indicator: 'var(--vgai-selection-indicator)',
  },
  semantic: {
    danger: 'var(--vgai-danger)',
    dangerMuted: 'var(--vgai-danger-muted)',
    dangerFaint: 'var(--vgai-danger-faint)',
    warning: 'var(--vgai-warn)',
    warningMuted: 'var(--vgai-warn-muted)',
    success: 'var(--vgai-success)',
    successMuted: 'var(--vgai-success-muted)',
    dynamic: 'var(--vgai-dynamic)',
    dynamicMuted: 'var(--vgai-dynamic-muted)',
    instance: 'var(--vgai-instance)',
  },
  neutralOverlay: {
    hover: 'var(--vgai-neutral-hover)',
    active: 'var(--vgai-neutral-active)',
  },
  scrim: 'var(--vgai-scrim)',
  typography: {
    sans: 'var(--vgai-font-sans)',
    mono: 'var(--vgai-font-mono)',
  },
  shape: {
    small: 'var(--vgai-radius-sm)',
    medium: 'var(--vgai-radius-md)',
    large: 'var(--vgai-radius-lg)',
    full: 'var(--vgai-radius-full)',
  },
  elevation: {
    small: 'var(--vgai-shadow-sm)',
    medium: 'var(--vgai-shadow-md)',
    large: 'var(--vgai-shadow-lg)',
  },
  focusRing: 'var(--vgai-focus-ring)',
} as const;

export type EditorThemeVariable = `--vgai-${string}`;

/** Theme-derived native-select artwork; data URIs cannot inherit CSS `color`. */
function chevronDataUri(color: string): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'>` +
    `<path d='M1 1L5 5L9 1' stroke='${color}' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/>` +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/**
 * Compose the treatment vocabulary's `backdrop-filter` value: `blur(..px)
 * saturate(..)` when either axis is set, else `'none'`. Treatment-less
 * themes (graphite, classic, and the `-lite` reduced-transparency tiers)
 * emit `'none'` — no `[data-vgai-theme=…]` CSS special-casing anywhere;
 * this function is the single place a theme's treatment becomes a real
 * filter string.
 */
function backdropFilterValue(treatment: EditorTheme['treatment']): string {
  if (!treatment) return 'none';
  const parts: string[] = [];
  if (treatment.backdropBlurPx) parts.push(`blur(${treatment.backdropBlurPx}px)`);
  if (treatment.backdropSaturation !== undefined && treatment.backdropSaturation !== 1) {
    parts.push(`saturate(${treatment.backdropSaturation})`);
  }
  if (treatment.backdropBrightness !== undefined && treatment.backdropBrightness !== 1) {
    parts.push(`brightness(${treatment.backdropBrightness})`);
  }
  return parts.length > 0 ? parts.join(' ') : 'none';
}

/**
 * Structural header surfaces (`--vgai-surface-sticky`/`-panel`). Glass
 * themes leave title/table rails transparent: the owner-reopened acceptance
 * explicitly reserves frost for significant text floors, not headers.
 * Classic themes retain the old occluding layered stack. Reduced Glass keeps
 * Glass morphology even though it intentionally has no optical treatment.
 */
function stickySurfaceValue(
  token: '--vgai-surface-chrome' | '--vgai-surface-panel',
  glassMaterial: boolean,
): string {
  if (glassMaterial) return 'transparent';
  return (
    `linear-gradient(var(${token}), var(${token})), ` +
    `linear-gradient(var(--vgai-surface-shell), var(--vgai-surface-shell))`
  );
}

/**
 * Content-zone frost (`--vgai-content-frost-filter`/`-bg`, §2.31 P2 owner
 * amendment): the local frosted-blur layer behind text-dense interior zones.
 * Filter reuses the theme's own saturation term so the frost and the plain
 * surface treatment cannot drift; bg is a fixed light tint — NEVER a dark
 * fill (the rejected tinted-frost model). `none`/`transparent` when the
 * axis is 0/absent, so non-frost themes paint byte-identically.
 */
function contentFrostFilterValue(treatment: EditorTheme['treatment']): string {
  const blurPx = treatment?.contentFrostBlurPx ?? 0;
  if (blurPx <= 0) return 'none';
  const parts = [`blur(${blurPx}px)`];
  if (treatment?.backdropSaturation !== undefined && treatment.backdropSaturation !== 1) {
    parts.push(`saturate(${treatment.backdropSaturation})`);
  }
  return parts.join(' ');
}

function contentFrostBgValue(treatment: EditorTheme['treatment']): string {
  const blurPx = treatment?.contentFrostBlurPx ?? 0;
  return blurPx > 0 ? 'rgba(255,255,255,0.10)' : 'transparent';
}

/** Text-entry wells are thin overlays within a glass surface, never nested
 * lenses. `currentColor` makes the translucent wash and rim follow the
 * adaptive light/dark ink flip; Classic retains the established opaque inset
 * recipe. Reduced Glass is safe because its parent surfaces are solid. */
function inputSurfaceValue(glassMaterial: boolean): string {
  // A text field is its own WIDGET CLASS (Blender's `wcol_text`, measured
  // #1c1c1c), which is why this reads `--vgai-widget-field` rather than
  // `--vgai-surface-inset` directly — that token resolves to `surface.inset`
  // for every palette that does not name the class, so this is the same value
  // it has always been.
  return glassMaterial
    ? 'color-mix(in srgb, currentColor 7%, transparent)'
    : 'var(--vgai-widget-field)';
}

function inputBorderValue(glassMaterial: boolean): string {
  return glassMaterial
    ? 'color-mix(in srgb, currentColor 26%, transparent)'
    : 'var(--vgai-boundary-default)';
}

function inputShadowValue(glassMaterial: boolean, embossShadow: string): string {
  // A text field is a WIDGET, so it takes the widget emboss
  // (`EditorTheme.color.widget.emboss`) like every other one. It composes
  // here rather than in the four stylesheet rules that read this token
  // because `none` is not a legal member of a `box-shadow` LIST: a rule
  // written `var(--vgai-widget-emboss-shadow), var(--vgai-input-shadow)`
  // would be invalid for every palette that names neither.
  const emboss = embossShadow === 'none' ? '' : embossShadow;
  const glass = glassMaterial
    ? 'inset 0 1px 0 color-mix(in srgb, currentColor 14%, transparent), 0 5px 14px -12px color-mix(in srgb, currentColor 55%, transparent)'
    : '';
  const layers = [emboss, glass].filter(Boolean);
  return layers.length === 0 ? 'none' : layers.join(', ');
}

/**
 * Liquid Glass Tier-1 calibration anchors (report §2.24): the rgba/px
 * constants inside the two functions below ARE the committed prototype's
 * variant-B recipe (`docs/assets/glass-ui-feasibility/liquid-glass-proto/
 * index.html`, `.card.specular`), and the axes are normalized so
 * `edgeSpecular` 0.6 / `thickness` 0.5 reproduce that look exactly — the
 * values the owner reviewed. Everything here is inert data → CSS custom
 * properties; the pixels are painted by `workspace-dock.css`'s card-chrome
 * pseudo-elements, with NO added backdrop-filter and NO runtime JS.
 */
const SPECULAR_REFERENCE = 0.6;
const THICKNESS_REFERENCE = 0.5;

/** White at a prototype-B-anchored alpha: `base` × (edgeSpecular ÷ 0.6), clamped to 1. */
function specularWhite(base: number, edgeSpecular: number): string {
  const alpha = Math.min(1, Number(((base * edgeSpecular) / SPECULAR_REFERENCE).toFixed(3)));
  return `rgba(255,255,255,${alpha})`;
}

/**
 * The 1.5px edge ring's gradient (`--vgai-card-specular-ring`): brightest at
 * the light-facing corner, falling to a faint trace on the far side, so the
 * rim reads as light catching a polished edge rather than a drawn border.
 * `'none'` when the treatment carries no specular — the ring pseudo-element
 * then paints nothing, which is the whole degrade story.
 */
function specularRingValue(treatment: EditorTheme['treatment']): string {
  const intensity = treatment?.edgeSpecular ?? 0;
  if (intensity <= 0) return 'none';
  const angle = treatment?.specularAngleDeg ?? 120;
  const white = (base: number) => specularWhite(base, intensity);
  return (
    `linear-gradient(${angle}deg, ${white(0.95)} 0%, ${white(0.38)} 16%, ` +
    `${white(0.16)} 40%, ${white(0.14)} 60%, ${white(0.45)} 84%, ${white(0.85)} 100%)`
  );
}

/**
 * The interior sheen wash (`--vgai-card-specular-sheen`): a soft diagonal
 * gradient from the lit corner across ~40% of the card, painted BELOW card
 * content (negative-z pseudo) so text never sits on a brightened band edge.
 */
function specularSheenValue(treatment: EditorTheme['treatment']): string {
  const intensity = treatment?.edgeSpecular ?? 0;
  if (intensity <= 0) return 'none';
  const angle = treatment?.specularAngleDeg ?? 120;
  const white = (base: number) => specularWhite(base, intensity);
  return `linear-gradient(${angle}deg, ${white(0.16)} 0%, ${white(0.05)} 24%, transparent 40%)`;
}

/**
 * The card's full box-shadow stack (`--vgai-card-specular-shadow`):
 * `edgeSpecular` contributes the 1px inset rim catches; `thickness` scales
 * the glass-depth pair (upper inner glow + lower inner shadow) plus the
 * matching drop shadow, replacing the theme's stock elevation. Either axis
 * absent → its terms drop out; both absent → exactly the pre-existing
 * `var(--vgai-shadow-lg)` card shadow, so treatment-less themes and the
 * reduced-transparency fallback paint byte-identical cards.
 */
function specularShadowValue(treatment: EditorTheme['treatment']): string {
  const intensity = treatment?.edgeSpecular ?? 0;
  const thickness = treatment?.thickness ?? 0;
  const parts: string[] = [];
  if (intensity > 0) {
    parts.push(`inset 0 1px 1px ${specularWhite(0.28, intensity)}`);
    parts.push(`inset 0 -1px 1px ${specularWhite(0.1, intensity)}`);
  }
  if (thickness > 0) {
    const depth = (px: number) =>
      `${Number(((px * thickness) / THICKNESS_REFERENCE).toFixed(1))}px`;
    parts.push(`inset 0 ${depth(12)} ${depth(24)} ${depth(-14)} rgba(255,255,255,0.35)`);
    parts.push(`inset 0 ${depth(-14)} ${depth(28)} ${depth(-18)} rgba(0,0,0,0.55)`);
    parts.push(`0 ${depth(18)} ${depth(40)} ${depth(-18)} rgba(0,0,0,0.55)`);
  } else {
    parts.push('var(--vgai-shadow-lg)');
  }
  return parts.join(', ');
}

/**
 * Floating glass-island chrome (`--vgai-island-*`, P6 glass-native chrome
 * U1/U2): free-standing chrome that floats over the canvas —
 * `.vgai-floating-toolbar` (the viewport toolstrip and its siblings), and
 * the header/footer clusters in later P6 units. A theme WITH a glass
 * treatment paints islands as REAL glass, the same material as cards: the
 * panel-whisper fill (never an opaque or color-mix slab), the theme's own
 * plain backdrop list (upgraded per-island to the url() refraction chain by
 * `components/glass-refraction.ts` where capable — the var here is the
 * degrade fallback that paints when refraction can't), the P6 demo
 * toolbar's 17px radius, the card border (the specular ring supplies the
 * rim), and the deep drop shadow a clear surface needs to read as "above"
 * the scene. A Classic theme emits EXACTLY the pre-P6
 * floating-toolbar recipe — 90% panel color-mix over transparent, blur(8px),
 * strong boundary, small shadow, the medium radius token — so
 * graphite/classic paint byte-identically to the pre-island editor. Reduced
 * Glass keeps the Glass shape/boundary/shadow while its filter becomes none.
 */
/** Resolve material identity without making treatment presence do two jobs. */
export function usesGlassMaterial(theme: EditorTheme): boolean {
  if (theme.appearance) return theme.appearance.material === 'glass';
  // Compatibility for standalone pre-axis themes, which declare no
  // `appearance` axis at all.
  return theme.treatment !== undefined;
}

function islandSurfaceValue(theme: EditorTheme): string {
  return usesGlassMaterial(theme)
    ? 'var(--vgai-surface-panel)'
    : 'color-mix(in srgb, var(--vgai-surface-panel) 90%, transparent)';
}

function islandBackdropFilterValue(theme: EditorTheme): string {
  // Referencing the surface var (not re-deriving from treatment data) means
  // the island fallback and the card plain list cannot drift — and the
  // refraction manager parses that same var for its in-chain frost/sat.
  if (usesGlassMaterial(theme)) {
    return theme.treatment ? 'var(--vgai-surface-backdrop-filter)' : 'none';
  }
  return 'blur(8px)';
}

function islandRadiusValue(glassMaterial: boolean): string {
  // 17px is the P6 reference demo toolbar's committed radius — a design
  // constant of the glass chrome, not a shape token.
  return glassMaterial ? '17px' : 'var(--vgai-radius-md)';
}

function islandBorderColorValue(glassMaterial: boolean): string {
  return glassMaterial ? 'var(--vgai-boundary-default)' : 'var(--vgai-boundary-strong)';
}

function islandShadowValue(glassMaterial: boolean): string {
  return glassMaterial ? 'var(--vgai-shadow-lg)' : 'var(--vgai-shadow-sm)';
}

function accentAlphaValue(theme: EditorTheme, alpha: number): string | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(theme.color.accent.default);
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((c) => Number.parseInt(c as string, 16));
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Selection is material state, not brand/action state. Glass and its
 * reduced-transparency descendants use neutral currentColor mixes so the
 * selection adapts with Liquid Glass's bright/dark content ramp. Opaque
 * Classic themes retain their established accent selection treatment.
 */
function usesNeutralSelection(theme: EditorTheme): boolean {
  return usesGlassMaterial(theme);
}

function selectionBackgroundValue(theme: EditorTheme): string {
  return usesNeutralSelection(theme) ? 'var(--vgai-neutral-active)' : 'var(--vgai-accent-muted)';
}

/**
 * Whether a palette colour PAINTS ON ITS OWN, or is a wash that lets the
 * surface beneath show through.
 *
 * The pressed ink depends on nothing else: "white on the accent" only reads
 * when the accent is actually there.
 */
function isOpaqueColor(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v.startsWith('#')) {
    // #rgba and #rrggbbaa carry the alpha in the last 1 or 2 digits.
    if (v.length === 5) return v.endsWith('f');
    if (v.length === 9) return v.endsWith('ff');
    return true;
  }
  const fn = /^rgba?\(([^)]*)\)$/.exec(v) ?? /^hsla?\(([^)]*)\)$/.exec(v);
  if (fn) {
    const alpha = (fn[1] ?? '').split(/[,/]/)[3];
    return alpha === undefined || Number.parseFloat(alpha) >= 1;
  }
  // `transparent`, and anything that mixes toward it, is not a paint.
  return v !== 'transparent' && !v.includes('transparent');
}

/**
 * Whether a surface colour is an opaque LIGHT paint (relative luminance above
 * one half) — the fact a derivation that sinks toward black has to know before
 * it can be right. A translucent surface (every Glass material's panel is a
 * low-alpha white over whatever lies beneath) is not a paint and answers
 * `false`, as does any form this does not read: the dark case most palettes
 * are.
 */
function isBrightSurface(value: string): boolean {
  if (!isOpaqueColor(value)) return false;
  const v = value.trim().toLowerCase();
  let rgb: number[] | null = null;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})(?:f|ff)?$/.exec(v);
  if (hex) {
    const h = hex[1]!.length === 3 ? [...hex[1]!].map((c) => c + c).join('') : hex[1]!;
    rgb = [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
  } else {
    const fn = /^rgba?\(([^)]*)\)$/.exec(v);
    if (fn) rgb = (fn[1] ?? '').split(/[,\s/]+/).filter(Boolean).slice(0, 3).map((n) => (n.endsWith('%') ? Number.parseFloat(n) * 2.55 : Number.parseFloat(n)));
  }
  if (!rgb || rgb.some((n) => !Number.isFinite(n))) return false;
  const [r, g, b] = rgb as [number, number, number];
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.5;
}

/**
 * The ink that reads ON `--vgai-selection-bg` — and it is DERIVED, because
 * the fill it has to read on is different per skin.
 *
 * Blender's pressed fill is the solid accent (`accent.muted` = `#4772b3`),
 * so its ink is the palette's on-accent white. Every other skin's pressed
 * fill is a WASH (`rgba(87,158,255,0.15)` and siblings) over the ordinary
 * panel, so the ordinary ink is what reads there — and the on-accent ink,
 * which is near-BLACK in those palettes because their accent is light, is
 * invisible on it. Measured live through `editor.document.query`'s resolved
 * styles: Classic painted `rgb(16,24,32)` on `rgba(87,158,255,0.15)`, which
 * is how a pressed eye toggle became an unreadable black smudge while the
 * same control read white in Blender.
 */

function selectionInkValue(theme: EditorTheme): string {
  if (usesNeutralSelection(theme)) return 'var(--vgai-content-primary)';
  return isOpaqueColor(theme.color.accent.muted)
    ? 'var(--vgai-content-on-accent)'
    : 'var(--vgai-content-primary)';
}

function selectionBorderValue(theme: EditorTheme): string {
  if (usesNeutralSelection(theme)) return 'color-mix(in srgb, currentColor 30%, transparent)';
  // On a LIGHT panel the accent is the ink, and an ink ring round every pressed
  // control is a hard black box; the selection there is the fill alone, so the
  // border is the fill's own colour.
  if (isBrightSurface(theme.color.surface.panel)) return `rgb(from ${theme.color.accent.muted} r g b / 1)`;
  return 'var(--vgai-accent)';
}

function selectionIndicatorValue(theme: EditorTheme): string {
  return usesNeutralSelection(theme)
    ? 'color-mix(in srgb, currentColor 76%, transparent)'
    : 'var(--vgai-accent)';
}

/**
 * Controls INSIDE glass chrome are concentric capsules (the HIG
 * concentricity rule: nested radii follow the container's pill), and the
 * ONE prominent action per toolbar is a TINTED-GLASS capsule — accent as a
 * translucent tint in the material, never an opaque painted slab. Opaque
 * themes keep the flat design's small radius and solid accent.
 */
function islandControlRadiusValue(glassMaterial: boolean): string {
  return glassMaterial ? 'var(--vgai-radius-full)' : 'var(--vgai-radius-sm)';
}

function islandPrimaryBgValue(theme: EditorTheme): string {
  if (!usesGlassMaterial(theme) || !theme.treatment) return 'var(--vgai-accent)';
  return accentAlphaValue(theme, 0.82) ?? 'var(--vgai-accent)';
}

/**
 * Islands wear a DIMMER specular ring than cards (owner design review,
 * spec "Design-review round" item 1): chrome pills sit close to content
 * and at card intensity the rim reads as a drawn border, not caught light.
 * 0.4× the card's edgeSpecular, same gradient profile. 'none' without a
 * specular treatment — the ring pseudo then paints nothing (the degrade).
 */
function islandSpecularRingValue(treatment: EditorTheme['treatment']): string {
  const intensity = treatment?.edgeSpecular ?? 0;
  if (intensity <= 0) return 'none';
  return specularRingValue({
    ...(treatment as NonNullable<EditorTheme['treatment']>),
    edgeSpecular: intensity * 0.4,
  });
}

/**
 * Faint ambient lift (`--vgai-ambient-lift`, P6-U6 taste decision 2): a
 * top-lit white wash — full alpha at the top edge, ~a third at the
 * midline, gone by the bottom — layered over the translucent color fill
 * (an extra background-image layer) on cards and islands, so clear glass
 * reads as a lit surface over a black void. The
 * 165° angle matches the specular key-light family (upper-left-ish);
 * geometry is a design constant, the treatment axis is intensity only.
 * 'none' without the axis — the extra background layer then paints
 * nothing and treatment-less themes stay byte-identical.
 */
function ambientLiftValue(treatment: EditorTheme['treatment']): string {
  const alpha = treatment?.ambientLiftOpacity ?? 0;
  if (alpha <= 0) return 'none';
  const top = Number(alpha.toFixed(3));
  const mid = Number((alpha * 0.35).toFixed(3));
  return `linear-gradient(165deg, rgba(255,255,255,${top}) 0%, rgba(255,255,255,${mid}) 55%, rgba(255,255,255,0) 100%)`;
}

/**
 * Content-legibility text shadow (`--vgai-content-text-shadow`, §2.32):
 * `none` for every theme without the axis, so pre-existing themes paint
 * byte-identically; the liquid-glass value is the demo's proven
 * `0 1px 2px rgba(0,0,0,0.72)`.
 */
function textShadowFromOpacity(opacity: number): string {
  if (opacity <= 0) return 'none';
  return `0 1px 2px rgba(0,0,0,${Number(opacity.toFixed(3))})`;
}

function contentTextShadowValue(treatment: EditorTheme['treatment']): string {
  return textShadowFromOpacity(treatment?.textShadowOpacity ?? 0);
}

/**
 * Adaptive bright-backdrop content ramp (P3): the `--vgai-content-*-on-bright`
 * values `theme.css` flips to under a measured `data-vgai-backdrop="bright"`
 * classification. Themes without adaptive material physics emit their normal
 * content values here — the values must be LITERALS (mirroring, not
 * `var(--vgai-content-…)` references), or the CSS flip
 * `--vgai-content-primary: var(--vgai-content-primary-on-bright)` would be a
 * self-referential cycle; mirroring makes the flip inert instead. The
 * bright-side text shadow defaults to `none` only when the axis exists
 * (dark ink needs no shadow); without the axis it mirrors the normal shadow.
 */
function contentOnBrightValues(theme: EditorTheme): {
  primary: string;
  muted: string;
  dim: string;
  textShadow: string;
  frostBg: string;
} {
  if (!theme.treatment?.adaptiveContent) {
    return {
      primary: theme.color.content.primary,
      muted: theme.color.content.muted,
      dim: theme.color.content.dim,
      textShadow: contentTextShadowValue(theme.treatment),
      frostBg: contentFrostBgValue(theme.treatment),
    };
  }
  return {
    primary: theme.color.content.onBright.primary,
    muted: theme.color.content.onBright.muted,
    dim: theme.color.content.onBright.dim,
    textShadow: textShadowFromOpacity(theme.treatment.brightTextShadowOpacity ?? 0),
    frostBg: theme.treatment.brightFrostBg ?? contentFrostBgValue(theme.treatment),
  };
}

/**
 * REGULAR Liquid Glass (menus / popovers / dialogs / palette / tooltips —
 * `.vgai-menu` / `.vgai-popover` / `.vgai-dialog` in theme.css; P3 overlay
 * chrome formalized as `--vgai-glass-regular-*` in P6-U6 per the owner's
 * taste decision): Apple's REGULAR variant is the "more solid" material —
 * adaptive, self-legible, used for transient chrome that must obscure
 * whatever it covers; Clear is the refractive card/island family, and the
 * two are never mixed within an element class. Transient surfaces are NOT
 * backdrop-classified (sampling them is overkill — they live for a click),
 * so the material is SELF-SUFFICIENT on both luminance sides:
 *  - adaptive themes (liquid-glass): a raised light tint over a
 *    strong frost, statically paired (in theme.css) with the `-on-bright`
 *    dark ink ramp — legible over ANY backdrop, Apple's own light-material
 *    menu answer (the P3 recipe, unchanged).
 *  - treatment themes WITHOUT the axis (glass-dark): the SAME solidity on
 *    the dark side — the theme's own chrome tone raised to high opacity
 *    over the same strong frost, not the previous thin translucency.
 *  - treatment-less themes mirror the plain chrome surface / `none`, so the
 *    theme.css consumption is inert and they paint byte-identically.
 */
function glassRegularBgValue(theme: EditorTheme): string {
  if (!theme.treatment) return theme.color.surface.chrome;
  // Raised LIGHT tint (never a dark fill — §2.31): strong enough that the
  // dark ink ramp holds ≥4.5:1 even over a black backdrop after compositing.
  // U6.5 F7 — floored 0.62 → 0.9 (the dark-side floor, symmetric): Regular
  // menus must OBSCURE what they cover, and the 0.62 tint let underlying
  // chrome read through at near-full contrast (audit shot 03 — hierarchy
  // rows through the View menu; menus opened inside a header island are
  // backdrop-root-captured, so their frost blur cannot reach the page
  // behind and the fill alone must carry the occlusion).
  if (theme.treatment.adaptiveContent) return 'rgba(255,255,255,0.9)';
  // Dark-side Regular: the theme's chrome tone, alpha floored at 0.9 so the
  // material reads solid (colors it covers may glow through the frost, never
  // read through the fill).
  return withMinimumAlpha(theme.color.surface.chrome, 0.9);
}

/**
 * REGULAR Liquid Glass for persistent, text-heavy PANELS. This is the same
 * functional material as transient Regular glass, but it must retain enough
 * scene continuity to work as a permanent inspector/hierarchy surface rather
 * than an opaque menu. The base is the theme's faint panel presence; sampled
 * backdrop luminance then supplies a complementary, low-alpha correction.
 * Dark scenes are lifted and bright scenes are dimmed without replacing
 * either with a white card. Strong body frost removes high-frequency detail.
 *
 * Themes without the adaptive bright-side ramp retain their authored panel
 * surface unchanged. Plain themes also receive no filter, so opting a panel
 * into the class is inert for Classic and reduced-transparency modes.
 */
function glassRegularPanelBgValue(theme: EditorTheme): string {
  return theme.color.surface.panel;
}

/** Raise an `rgba(r,g,b,a)` color's alpha to at least `minAlpha`; any other
 *  color syntax is already effectively solid and passes through unchanged. */
function withMinimumAlpha(color: string, minAlpha: number): string {
  const m = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([0-9.]+)\s*\)$/.exec(color);
  if (!m) return color;
  const alpha = Math.max(Number(m[4]), minAlpha);
  return `rgba(${m[1]},${m[2]},${m[3]},${alpha})`;
}

function glassRegularBackdropFilterValue(treatment: EditorTheme['treatment']): string {
  if (!treatment) return 'none';
  // Double the content frost (floor 16px): a menu floats over UNFROSTED
  // scene regions, so it needs more blur than an in-panel text zone to
  // average high-frequency backdrops into a stable field.
  // Regular overlays are text-heavy surfaces, so they use the same authored
  // frost tier rather than inventing a doubled second tier.
  const blurPx = Math.max(16, treatment.contentFrostBlurPx ?? 0);
  const parts = [`blur(${blurPx}px)`];
  if (treatment.backdropSaturation !== undefined && treatment.backdropSaturation !== 1) {
    parts.push(`saturate(${treatment.backdropSaturation})`);
  }
  return parts.join(' ');
}

/**
 * The AREA seam's colour. A palette that names none paints the boundary its
 * call sites already read, so every skin but Blender is pixel-identical.
 */
function areaBoundaryValue(theme: EditorTheme): string {
  return theme.color.boundary.area ?? theme.color.boundary.default;
}

/**
 * A tree row's ALTERNATE band — a step off whatever AREA FILL the tree sits on,
 * stated once here because two places must produce it and a duplicated
 * percentage drifts. `editorThemeVariables` emits it against `surface.panel`
 * (the fill every unclaimed group has); the workspace host re-emits
 * it on a group whose panel CLAIMS a region, against that region's fill.
 *
 * It cannot simply read an inherited `--vgai-surface-region`: a custom
 * property's `var()` references are substituted at computed-value time ON THE
 * ELEMENT THAT DECLARES IT, so a root-declared expression would have baked in
 * the root's panel fill before any descendant could override it — measured, and
 * it is why the Outliner's rows stepped ELEVEN levels after `color.region`
 * landed instead of Blender's three (#323232 on #272727 where the frame shows
 * #2a2a2a).
 *
 * The solve, against `modeling.png` at 2x: A = the area fill, B = `content.primary`
 * 0xe6=230, target = A + 3. For the Outliner's 0x27=39 that is 42, and
 * p = (230-42)/(230-39) = 188/191 = 98.43% — the same 98.4% the panel-fill solve
 * gives, because the step is three levels either way.
 */
export function regionRowAltValue(areaFill: string, ink: string): string {
  return `color-mix(in srgb, ${areaFill} 98.4%, ${ink})`;
}

/**
 * THE AREA EMBOSS — the one CSS px of light Blender puts on each side of the
 * dark area groove. It is not a colour a palette names: it is the area's OWN
 * FILL lightened, which is why a bright viewport gets a bright line and a dark
 * Outliner a dim one, and why one number (`chrome.areaEmboss`, percent of
 * white) covers every area. `0` returns `transparent` — nothing painted, which
 * is byte-identical to having no rule at all.
 *
 * SOLVED, not chosen, against `modeling.png` at its native 2x. Each pair is
 * the area's flat fill and the light band beside the groove, read as whole
 * pixel runs (the emboss is 2 device px = 1 CSS px):
 *
 *   fill                          emboss   coordinates
 *   Properties  #2f2f2f = 47  →   64       x=3200, y 426..427 (below the
 *                                          Outliner↔Properties groove)
 *   Outliner    #272727 = 39  →   57/56    y=300,  x 2843..2844 (right of the
 *                                          viewport↔right-column groove)
 *   tab rail    #171717 = 23  →   43/42    y=1500, x 2843..2844 (same groove,
 *                                          lower down, where the Properties
 *                                          tab rail is the neighbour)
 *   row-alt     #2a2a2a = 42  →   59/60    x=3200, y 417..418
 *
 * `p = (out - fill) / (255 - fill)` for those four is 0.0817, 0.0810/0.0841,
 * 0.0862/0.0822 — mean 8.14%, and 8.2% is the value that renders all four
 * measured integers (42.0, 56.7, 59.5, 64.1 → 42, 57, 59/60, 64).
 *
 * THE PIXELS CONTRADICTED THE BRIEF ON THE FIFTH PAIR, and this is the
 * correction: the viewport's band measures 63 → 93/94 (y 2055..2056 at the
 * status bar, x 4..5 at the window's left edge, x 2834 at the sash) and the
 * 3D View's own header 52 → 86 (y 53..54 under the top bar) — both nearly
 * DOUBLE the lift the other four share, and a single mix cannot produce that
 * (a fixed colour at a fixed alpha must compress the fills' spread, and these
 * expand it: 34 levels of output across 11 levels of input). Applying the SAME
 * 8.2% TWICE does: 63 → 78.7 → 93.2 (measured 93/94) and 52 → 68.6 → 83.9
 * (measured 86). Both doubled areas are the 3D View's — its main region
 * overlaps its area, so the region's emboss lands on the area's — and the
 * single-pass value shows through where the two passes do not align
 * (x=2835 reads 78 beside x=2834's 94, against a predicted 78.7). So this
 * is ONE number applied once by an ordinary area and twice by the stage,
 * which is Blender's own structure, not a second constant.
 */
export function areaEmbossValue(areaFill: string): string {
  return `color-mix(in srgb, var(--vgai-area-emboss-mix), ${areaFill})`;
}

/**
 * The light and its weight, as the one token every {@link areaEmbossValue}
 * expression mixes in. A skin that declares no `chrome.areaEmboss` gets
 * `transparent 100%`, so every emboss expression — root, group, nested —
 * computes to a fully transparent colour and paints nothing whatsoever.
 * Emitted as a PAIR because the whole point of the indirection is that a
 * group's own expression (the workspace host's) can be written
 * without reading the theme object.
 */
function areaEmbossMixValue(theme: Pick<EditorTheme, 'density'>): string {
  const amount = density(theme).chrome.areaEmboss;
  return amount > 0 ? `#ffffff ${amount}%` : 'transparent 100%';
}

/** Map one typed theme to the semantic variables consumed by editor chrome. */
export function editorThemeVariables(theme: EditorTheme): Record<EditorThemeVariable, string> {
  const onBright = contentOnBrightValues(theme);
  const glassMaterial = usesGlassMaterial(theme);
  // The WIDGET classes, resolved once: a palette that names none reads the
  // surface each call site read before the group existed, so every token below
  // is the same string it used to be and no skin moves. See
  // `EditorTheme.color.widget` for the measurements.
  const widgetRegular = theme.color.widget?.regular ?? theme.color.surface.raised;
  const widgetMenu = theme.color.widget?.menu ?? theme.color.surface.raised;
  const widgetField = theme.color.widget?.field ?? theme.color.surface.inset;
  // The emboss is stated once, as a whole `box-shadow` value rather than as a
  // colour, so the 1 px offset lives in ONE place and a palette that names no
  // emboss resolves to the literal `none` — which is what keeps every other
  // look byte-identical, and what lets a rule COMPOSE it into an existing
  // shadow list (`none` cannot appear inside one).
  const widgetEmbossShadow = theme.color.widget?.emboss
    ? `0 1px 0 ${theme.color.widget.emboss}`
    : 'none';
  // Hover LIFTS a widget by a step from ITS OWN fill, recomputed per class so
  // a palette that moves a class's fill gets a hover that still belongs to
  // it. THIS IS THE ONLY STATEMENT OF THE HOVER RELATIONSHIP — keep it that
  // way: a hover surface stated twice is a number that gets corrected in one
  // place and left wrong in the one that paints.
  //
  // The percentage is SOLVED, not chosen. `color-mix(in srgb, A p%, B)` on
  // opaque colours is `A*p + B*(1-p)`, so `p = (B - target)/(B - A)`; with
  // Blender's `widget.regular` 0x53=83 as A, `content.primary` 0xe6=230 as B
  // and the hover target 0x65=101, p = 129/147 = 87.755%. At the 86% this
  // was, `--vgai-widget-regular-hover` rendered #686868.
  //
  // HONEST LABEL: #656565 is the only number here that is NOT measurable
  // from the reference frames — none of the eighteen captures in
  // /Volumes/PeakSSD/volter-work/blender-reference holds a widget under the
  // pointer, and a search of every frame for a #656565 REGION finds only
  // scattered viewport-gradient pixels. It is the target this file's own
  // docblock has carried; the solve against it is exact, the target is
  // inherited.
  const lift = (fill: string) =>
    `color-mix(in srgb, ${fill} 87.8%, ${theme.color.content.primary})`;
  // The AREA HEADER's fill, stated once here because two variables need it —
  // `--vgai-surface-header` paints it and `--vgai-area-emboss-stage-header`
  // lightens it. The solve is documented with the other derived surfaces below.
  const surfaceHeader = `color-mix(in srgb, ${theme.color.surface.panel} 86.5%, ${theme.color.surface.raised})`;
  return {
    '--vgai-surface-shell': theme.color.surface.shell,
    '--vgai-surface-panel': theme.color.surface.panel,
    '--vgai-surface-chrome': theme.color.surface.chrome,
    '--vgai-surface-raised': theme.color.surface.raised,
    '--vgai-surface-inset': theme.color.surface.inset,
    '--vgai-surface-overlay': theme.color.surface.overlay,
    '--vgai-surface-backdrop-filter': backdropFilterValue(theme.treatment),
    '--vgai-surface-sticky': stickySurfaceValue('--vgai-surface-chrome', glassMaterial),
    '--vgai-surface-sticky-panel': stickySurfaceValue('--vgai-surface-panel', glassMaterial),
    '--vgai-surface-sticky-backdrop-filter': 'none',
    // Optical body frost is independent from nested content-floor paint.
    // The refraction host reads this stable token even when a Regular panel
    // locally disables `--vgai-content-frost-filter` to enforce one filter.
    '--vgai-surface-body-frost-filter': contentFrostFilterValue(theme.treatment),
    '--vgai-content-frost-filter': contentFrostFilterValue(theme.treatment),
    '--vgai-content-frost-bg': contentFrostBgValue(theme.treatment),
    '--vgai-input-surface': inputSurfaceValue(glassMaterial),
    '--vgai-input-border': inputBorderValue(glassMaterial),
    '--vgai-input-shadow': inputShadowValue(glassMaterial, widgetEmbossShadow),
    '--vgai-structural-divider': glassMaterial ? 'transparent' : theme.color.boundary.default,
    '--vgai-card-specular-ring': specularRingValue(theme.treatment),
    '--vgai-card-specular-sheen': specularSheenValue(theme.treatment),
    '--vgai-card-specular-shadow': specularShadowValue(theme.treatment),
    // Liquid Glass refraction (report §2.31/§2.32): unitless numbers,
    // consumed by the surface host's refraction manager
    // (`components/glass-refraction.ts`) via getComputedStyle — never by
    // any CSS rule. Thickness '0' (no refraction) for treatment-less themes
    // keeps the degrade ladder data-driven: the reduced-transparency paint
    // path strips `treatment`, which zeroes this var, which removes every
    // per-surface url() filter automatically.
    '--vgai-card-refraction-thickness': String(theme.treatment?.refractionThickness ?? 0),
    '--vgai-card-refraction-bezel': String(theme.treatment?.refractionBezelPx ?? 28),
    '--vgai-card-refraction-angle': String(theme.treatment?.specularAngleDeg ?? 120),
    // Floating glass-island chrome (P6 U1/U2): real-glass material for
    // treatment themes, the exact pre-P6 floating-toolbar recipe otherwise
    // (see the island*Value functions above for the ladder rationale).
    '--vgai-ambient-lift': ambientLiftValue(theme.treatment),
    '--vgai-island-surface': islandSurfaceValue(theme),
    '--vgai-island-backdrop-filter': islandBackdropFilterValue(theme),
    '--vgai-island-radius': islandRadiusValue(glassMaterial),
    '--vgai-island-border-color': islandBorderColorValue(glassMaterial),
    '--vgai-island-shadow': islandShadowValue(glassMaterial),
    '--vgai-island-specular-ring': islandSpecularRingValue(theme.treatment),
    '--vgai-selection-bg': selectionBackgroundValue(theme),
    '--vgai-content-on-selection': selectionInkValue(theme),
    '--vgai-selection-border': selectionBorderValue(theme),
    '--vgai-selection-indicator': selectionIndicatorValue(theme),
    '--vgai-island-control-radius': islandControlRadiusValue(glassMaterial),
    '--vgai-island-primary-bg': islandPrimaryBgValue(theme),
    '--vgai-content-text-shadow': contentTextShadowValue(theme.treatment),
    // Adaptive bright-backdrop ramp (P3): consumed only by theme.css's
    // `[data-vgai-backdrop="bright"]` / Regular-glass scopes. Themes without
    // adaptive material physics mirror their normal values here, so those
    // scopes are inert for them. `--vgai-content-adaptive` is the unitless
    // classifier gate (components/backdrop-luminance.ts reads it via
    // getComputedStyle, same idiom as `--vgai-card-refraction-thickness`):
    // '0' means no surface is ever classified — today's dark default.
    '--vgai-content-primary-on-bright': onBright.primary,
    '--vgai-content-muted-on-bright': onBright.muted,
    '--vgai-content-dim-on-bright': onBright.dim,
    '--vgai-content-text-shadow-on-bright': onBright.textShadow,
    '--vgai-content-frost-bg-on-bright': onBright.frostBg,
    '--vgai-content-adaptive': theme.treatment?.adaptiveContent ? '1' : '0',
    '--vgai-glass-regular-bg': glassRegularBgValue(theme),
    '--vgai-glass-regular-backdrop-filter': glassRegularBackdropFilterValue(theme.treatment),
    '--vgai-glass-regular-panel-bg': glassRegularPanelBgValue(theme),
    '--vgai-glass-regular-panel-backdrop-filter': glassRegularBackdropFilterValue(theme.treatment),
    '--vgai-glass-dark-frost-panel-bg': 'rgba(5,8,13,0.74)',
    '--vgai-glass-dark-frost-content-bg': 'rgba(5,8,13,0.84)',
    // Modal scrim (P6-U6 owner taste decision 3): glass themes read like
    // macOS — a LIGHTER dim plus a blur doing the separation work; opaque
    // themes keep their heavy dim and `none`, byte-identically.
    '--vgai-scrim-backdrop-filter': theme.treatment ? 'blur(8px)' : 'none',
    '--vgai-boundary-default': theme.color.boundary.default,
    '--vgai-boundary-strong': theme.color.boundary.strong,
    // The AREA seam. Never emitted empty — a seam that stops being painted
    // fuses two areas into one field — so an absent member resolves to the
    // boundary its call sites already read (`EditorTheme.color.boundary.area`).
    '--vgai-boundary-area': areaBoundaryValue(theme),
    // THE TREE'S INDENT GUIDE (`color.boundary.indent`). Emitted EMPTY —
    // `transparent` — when the palette names none, because no skin but
    // Blender's drew one and a fallback to any other boundary would put a rule
    // into every tree in the editor. `.vgai-tree-indent-guide` paints this and
    // nothing else, so absent means the guide's spans are there and invisible.
    '--vgai-tree-indent-guide': theme.color.boundary.indent ?? 'transparent',
    // THE DIVIDER RULE (`color.boundary.divider`). Same optional shape, a
    // different fallback for a stated reason: no skin drew an indent guide, so
    // absent means `transparent` above; every skin draws this rule, so absent
    // means the boundary it already drew.
    '--vgai-boundary-divider': theme.color.boundary.divider ?? theme.color.boundary.default,
    // THE EMBOSS beside that groove (`areaEmbossValue`). Three values because
    // three fills meet a groove: an ordinary docked area (a group with no
    // region claim takes `surface.panel`; one that claims a region re-emits
    // this against its own fill in the workspace host, the same
    // way `--vgai-surface-row-alt` is re-emitted there and for the same
    // substitution reason), and the STAGE area, whose sides are the viewport's
    // fill and whose top edge is its own header band — both of them lifted
    // TWICE, which is what the 3D View's overlapping region does in Blender.
    '--vgai-area-emboss-mix': areaEmbossMixValue(theme),
    '--vgai-area-emboss': areaEmbossValue(theme.color.surface.panel),
    '--vgai-area-emboss-stage': areaEmbossValue(
      areaEmbossValue(theme.color.viewport?.background ?? theme.color.surface.panel),
    ),
    '--vgai-area-emboss-stage-header': areaEmbossValue(areaEmbossValue(surfaceHeader)),
    '--vgai-content-primary': theme.color.content.primary,
    '--vgai-content-muted': theme.color.content.muted,
    '--vgai-content-dim': theme.color.content.dim,
    '--vgai-content-on-accent': theme.color.content.onAccent,
    // THE MENU WORD (`color.content.menu`). Falls back in the EMITTER — not in
    // a `var(…, …)` default, for the reason `content.selected` states: every
    // variable here is always emitted, so a CSS fallback would never fire.
    // The fallback is `content.primary` because that is what the top bar's
    // menu words already paint, so a palette naming no menu ink leaves that
    // bar bit-identical; the area header's words, which read `content.muted`
    // only because nothing had overridden the base rule, converge onto it.
    '--vgai-content-menu': theme.color.content.menu ?? theme.color.content.primary,
    // THE STATUS BAND'S INK and THE PLACEHOLDER'S, both falling back to
    // `content.dim` in the EMITTER for the reason above. The band already
    // inherited dim, so its fallback is bit-identical; the placeholder had no
    // rule at all and inherited CHROME's fixed rgb(117,117,117), so a palette
    // naming none moves onto the palette's own quiet ink — which is the whole
    // point of the member (see its docblock).
    '--vgai-content-status': theme.color.content.status ?? theme.color.content.dim,
    '--vgai-content-placeholder': theme.color.content.placeholder ?? theme.color.content.dim,
    // Emitted EMPTY when the palette names none — the `viewport` group's
    // answer. Its one reader inherits the row's ink through the fallback.
    '--vgai-content-active': theme.color.content.active ?? '',
    '--vgai-content-selected': theme.color.content.selected ?? theme.color.content.active ?? '',
    '--vgai-accent': theme.color.accent.default,
    '--vgai-accent-muted': theme.color.accent.muted,
    '--vgai-danger': theme.color.semantic.danger,
    '--vgai-danger-muted': theme.color.semantic.dangerMuted,
    '--vgai-danger-faint': theme.color.semantic.dangerFaint,
    '--vgai-warn': theme.color.semantic.warning,
    '--vgai-warn-muted': theme.color.semantic.warningMuted,
    '--vgai-success': theme.color.semantic.success,
    '--vgai-success-muted': theme.color.semantic.successMuted,
    '--vgai-dynamic': theme.color.semantic.dynamic,
    '--vgai-dynamic-muted': theme.color.semantic.dynamicMuted,
    '--vgai-instance': theme.color.semantic.instance,
    '--vgai-neutral-hover': theme.color.neutralOverlay.hover,
    '--vgai-neutral-active': theme.color.neutralOverlay.active,
    '--vgai-scrim': theme.color.scrim,
    // DERIVED surfaces — relationships every skin keeps, computed from its own
    // palette (Blender's measured steps: a panel header is a slab #3c3c3c
    // over #2f2f2f, an area header #343434, outliner rows alternate by three
    // levels). The hover step is stated ONCE, by `lift` above, because that
    // is what paints a hovered widget.
    //
    // Each percentage below is SOLVED from that measured target against the
    // two inputs the expression already mixes, never chosen for roundness:
    // `color-mix(in srgb, A p%, B)` on opaque colours is the plain sRGB
    // average `A*p + B*(1-p)`, so `p = (B - target) / (B - A)`. The three
    // solves, with the Blender palette's own channel values (grey, so one
    // channel states all three) and the coordinate the target was read at in
    // `/Volumes/PeakSSD/volter-work/blender-reference` (1728x1052 factory
    // startup captured at 2x):
    //
    //  header  A=panel  0x2f=47, B=raised  0x54=84,  target 0x34=52
    //          p = (84-52)/(84-47)   = 32/37   = 86.49%  → 86.5%
    //          (modeling.png, the 3D viewport's area header, y 60..108 over
    //           x 300..2700, median 52 — it was 78%, which renders 55.)
    //  section A=panel  0x2f=47, B=raised  0x54=84,  target 0x3c=60
    //          p = (84-60)/(84-47)   = 24/37   = 64.86%  → 64.9%
    //          (properties-object.png at 2x, the Transform panel's card:
    //           row y=380 over x 76..277 and x 495..590 is 60, and the card
    //           header at y=230 is the same 60 — one continuous fill, header
    //           and body. It was 62%, which renders 61, one level off the
    //           value THIS BLOCK'S OWN COMMENT already named.)
    //  s-edge  A=panel  0x2f=47, B=raised  0x54=84,  target 0x49=73
    //          p = (84-73)/(84-47)   = 11/37   = 29.73%  → 29.7%
    //          (the same card's 1 CSS px outline: properties-object.png
    //           x 74..75 and x 591..592 over its whole height, y 200..201 and
    //           y 1030 at its ends, all 73. Blender outlines a panel card
    //           LIGHTER than the card; `boundary.default` #3c3c3c is the
    //           card's own fill there and would be invisible.)
    //  rowAlt  A=panel  0x2f=47, B=primary 0xe6=230, target = panel + 3 = 50
    //          p = (230-50)/(230-47) = 180/183 = 98.36%  → 98.4%
    //          (modeling.png, Outliner rows over x 3300..3420: y 186..225 is
    //           39 = #272727 and y 226..265 is 42 = #2a2a2a — a THREE-level
    //           alternation on a 40 px (20 CSS px) pitch. It was 96%, which
    //           steps seven.)
    //
    // Each is carried to one decimal because the integer next to it misses:
    // 98% renders 0x33, and `lift`'s 88% renders 0x66.
    '--vgai-surface-section': `color-mix(in srgb, ${theme.color.surface.panel} 64.9%, ${theme.color.surface.raised})`,
    '--vgai-surface-section-edge': `color-mix(in srgb, ${theme.color.surface.panel} 29.7%, ${theme.color.surface.raised})`,
    '--vgai-surface-header': surfaceHeader,
    '--vgai-surface-row-alt': regionRowAltValue(
      theme.color.surface.panel,
      theme.color.content.primary,
    ),
    // A SELECTED TREE ROW is not an active widget, and there are TWO of them.
    //
    // Measured in Blender 5.2, `modeling-object-selected.png` (object mode,
    // every object selected), Outliner rows at device y 133-252, sampled over a
    // clean x band (crop-local 440-500 against the `outliner.png` origin
    // 2843,53). Three row states, three fills:
    //
    //   unselected             #272727 / #2a2a2a  — the ordinary stripe
    //   selected, not active   #1c304c            — (28,48,76)
    //   selected AND active    #324c7f            — (50,76,127), inside a
    //                                               1 px #5a74a7 border
    //
    // Both bands are the same 18-of-20 px box: device rows 135-170 and 177-208
    // inside a 40 px pitch, so ONE ordinary stripe row shows above and below
    // each. `theme.css`'s `.vgai-tree-row` rules paint that inset.
    //
    // The derivations, and their residual against the measurement. The palette
    // carries the accent (#4772b3, Blender's own widget blue) and both bands
    // are it sunk toward black — the same relation the single band already
    // used, so a palette that declares nothing new gets a coherent pair:
    //   active   0.70 x #4772b3 = #32507d against #324c7f — green +4, blue -2
    //   selected 0.42 x #4772b3 = #1e304b against #1c304c — red  +2, blue -1
    // Neither band is EXACTLY a scaling of the accent (Blender's are their own
    // theme entries), and the residual is under five levels on one channel of
    // each, so no palette token is minted for four levels of green.
    //
    // The BORDER is exact and additive: #5a74a7 is the active fill plus 40 on
    // every channel (50+40, 76+40, 127+40). No `color-mix` expresses a uniform
    // lift — mixing toward white moves the channels by different amounts — so
    // this is the one place the stylesheet uses relative colour syntax, which
    // states the measurement literally and derives for every palette.
    //
    // Both derivations sink the accent toward BLACK, which is a statement about
    // a DARK palette: the band has to sit darker than the stripe it replaces.
    // On a LIGHT panel (a paper palette) the same arithmetic paints a
    // near-black band under dark ink. There the selected band is the palette's
    // own selection wash (`accent.muted`, what a pressed control already wears);
    // the active row is that colour at full strength, with no ink ring. Every dark palette
    // computes exactly what it did before.
    ...(isBrightSurface(theme.color.surface.panel)
      ? {
          '--vgai-tree-row-selected-bg': theme.color.accent.muted,
          // Opaque: the active band is painted OVER its hairline layer, so a
          // wash would let the hairline show through the whole row.
          '--vgai-tree-row-active-bg': `rgb(from ${theme.color.accent.muted} r g b / 1)`,
          '--vgai-tree-row-active-border': `rgb(from ${theme.color.accent.muted} r g b / 1)`,
          '--vgai-tree-datablock-fill': 'color-mix(in srgb, var(--vgai-category-data, currentColor) 14%, transparent)',
          '--vgai-tree-datablock-border': 'color-mix(in srgb, var(--vgai-content-primary) 14%, transparent)',
        }
      : {
          '--vgai-tree-row-selected-bg': `color-mix(in srgb, ${theme.color.accent.default} 42%, #000)`,
          '--vgai-tree-row-active-bg': `color-mix(in srgb, ${theme.color.accent.default} 70%, #000)`,
          '--vgai-tree-row-active-border':
            'rgb(from var(--vgai-tree-row-active-bg) calc(r + 40) calc(g + 40) calc(b + 40))',
          // The datablock plate's transcription (theme.css `.vgai-tree-datablock`), unchanged.
          '--vgai-tree-datablock-fill': 'color-mix(in srgb, color-mix(in srgb, var(--vgai-category-data, currentColor) 60%, black) 26%, transparent)',
          '--vgai-tree-datablock-border': 'color-mix(in srgb, var(--vgai-content-primary) 24%, transparent)',
        }),
    // WHO GETS THE ROW'S ONE TEXT MARK when a palette declares an ACTIVE ink.
    // The instance rule (`semantic.instance`, owner 2026-07-31) and the active
    // object's orange name both want the name, and on the active row only one
    // can be read: a dotted rule in one hue under a name in another is two
    // marks arguing. So the rule YIELDS there, and only there — this is `none`
    // exactly when `content.active` exists and `underline` otherwise, so a
    // palette that names no active ink re-states what the row already drew and
    // its instance rows are untouched. Derived rather than declared: the
    // emitter is the one place that knows what the palette said.
    '--vgai-tree-active-name-underline': theme.color.content.active ? 'none' : 'underline',
    // The viewport group, empty when the palette carries none (readers treat
    // an empty token as "the editor's own").
    '--vgai-viewport-background': theme.color.viewport?.background ?? '',
    '--vgai-viewport-grid': theme.color.viewport?.grid ?? '',
    '--vgai-viewport-axis-x': theme.color.viewport?.axisX ?? '',
    '--vgai-viewport-axis-y': theme.color.viewport?.axisY ?? '',
    '--vgai-viewport-axis-z': theme.color.viewport?.axisZ ?? '',
    '--vgai-viewport-wire': theme.color.viewport?.wire ?? '',
    '--vgai-viewport-wire-opacity': numberToken(theme.density?.viewport?.wireOpacity),
    '--vgai-viewport-axis-line-width': numberToken(theme.density?.viewport?.axisLineWidth),
    '--vgai-viewport-selection': theme.color.viewport?.selection ?? '',
    '--vgai-viewport-active': theme.color.viewport?.active ?? '',
    '--vgai-gizmo-x': theme.color.gizmo?.x ?? '',
    '--vgai-gizmo-y': theme.color.gizmo?.y ?? '',
    '--vgai-gizmo-z': theme.color.gizmo?.z ?? '',
    '--vgai-gizmo-navigation-x': theme.color.gizmo?.navigationX ?? '',
    '--vgai-gizmo-navigation-y': theme.color.gizmo?.navigationY ?? '',
    '--vgai-gizmo-navigation-z': theme.color.gizmo?.navigationZ ?? '',
    '--vgai-gizmo-hover': theme.color.gizmo?.hover ?? '',
    '--vgai-gizmo-drag': theme.color.gizmo?.drag ?? '',
    '--vgai-viewport-gizmo-opacity': numberToken(theme.density?.viewport?.gizmoOpacity),
    '--vgai-viewport-gizmo-arrow-length': numberToken(theme.density?.viewport?.gizmoArrowLength),
    '--vgai-viewport-gizmo-arrow-head': numberToken(theme.density?.viewport?.gizmoArrowHead),
    '--vgai-viewport-gizmo-ring-width': numberToken(theme.density?.viewport?.gizmoRingWidth),
    '--vgai-viewport-navigation-gizmo': theme.density?.viewport?.navigationGizmo ?? '',
    '--vgai-viewport-navigation-corner': theme.density?.viewport?.navigationCorner ?? '',
    '--vgai-viewport-navigation-size': numberToken(theme.density?.viewport?.navigationSize),
    '--vgai-viewport-gizmo-highlight-saturation': numberToken(
      theme.density?.viewport?.gizmoHighlightSaturation,
    ),
    '--vgai-viewport-gizmo-highlight-value': numberToken(theme.density?.viewport?.gizmoHighlightValue),
    // THE TRANSFORM GIZMO'S SCREEN SIZE, in px per gizmo unit, emitted the
    // same way and read the same way (`native-selection-style.ts`): a look
    // that names none emits empty, and the viewport keeps three's own
    // viewport-relative handle. Blender's is `U.gizmo_size` — see
    // `DensityContribution.viewport.gizmoSize` for the derivation.
    '--vgai-viewport-gizmo-size':
      theme.density?.viewport?.gizmoSize === undefined ? '' : `${theme.density.viewport.gizmoSize}`,
    // THE FLOOR GRID'S LINE WIDTHS AND MAJOR CONTRAST, emitted empty when the look states none,
    // so the stage keeps its own hairline floor (`DensityContribution.viewport.gridLineWidth`).
    '--vgai-viewport-grid-line-width': numberToken(theme.density?.viewport?.gridLineWidth),
    '--vgai-viewport-grid-major-width': numberToken(theme.density?.viewport?.gridMajorWidth),
    '--vgai-viewport-grid-major-contrast': numberToken(theme.density?.viewport?.gridMajorContrast),
    '--vgai-viewport-selection-box': theme.density?.viewport?.selectionBox ?? '',
    '--vgai-viewport-selection-box-frame': theme.density?.viewport?.selectionBoxFrame ?? '',
    '--vgai-viewport-outline-style': theme.density?.viewport?.outlineStyle ?? '',
    '--vgai-viewport-outline-width': numberToken(theme.density?.viewport?.outlineWidth),
    '--vgai-viewport-outline-hidden':
      theme.density?.viewport?.outlineHidden === undefined ? '' : `${theme.density.viewport.outlineHidden}`,
    '--vgai-viewport-selection-box-width': numberToken(theme.density?.viewport?.selectionBoxWidth),
    // The widget classes. Unlike `viewport`, these are never emitted empty:
    // every one paints a control that must stay painted, so an absent group
    // resolves to the surface that call site already read.
    '--vgai-widget-regular': widgetRegular,
    '--vgai-widget-regular-hover': lift(widgetRegular),
    '--vgai-widget-menu': widgetMenu,
    '--vgai-widget-menu-hover': lift(widgetMenu),
    '--vgai-widget-field': widgetField,
    '--vgai-widget-emboss-shadow': widgetEmbossShadow,
    // The CATEGORY inks. Emitted as `currentColor` when the palette names
    // none, which is the whole compatibility story: a toned glyph paints
    // `var(--vgai-category-object, currentColor)`, so under a palette
    // without the group it paints exactly what a monochrome glyph paints.
    // The literal is used rather than an empty string (the `viewport` group's
    // answer) because these tokens are read by a `fill`, where empty is not
    // a colour and the fallback must therefore be a real one.
    '--vgai-category-object': theme.color.category?.object ?? 'currentColor',
    '--vgai-category-modifier': theme.color.category?.modifier ?? 'currentColor',
    '--vgai-category-material': theme.color.category?.material ?? 'currentColor',
    '--vgai-category-tool': theme.color.category?.tool ?? 'currentColor',
    '--vgai-category-operator': theme.color.category?.operator ?? 'currentColor',
    '--vgai-category-data': theme.color.category?.data ?? 'currentColor',
    '--vgai-category-scene': theme.color.category?.scene ?? 'currentColor',
    '--vgai-category-collection': theme.color.category?.collection ?? 'currentColor',
    // The REGION fills, a pair per area. Never emitted empty (the `widget`
    // group's answer, not the `viewport` group's): each falls back to the
    // surface its call site already reads, so the dock can point a group at
    // `var(--vgai-region-<name>)` unconditionally and a palette that names no
    // region paints exactly what it painted before.
    '--vgai-region-outliner': theme.color.region?.outliner ?? theme.color.surface.panel,
    '--vgai-region-outliner-header': theme.color.region?.outliner ?? theme.color.surface.chrome,
    '--vgai-region-properties': theme.color.region?.properties ?? theme.color.surface.panel,
    '--vgai-region-properties-header': theme.color.region?.properties ?? theme.color.surface.chrome,
    '--vgai-font-sans': theme.typography.sans,
    '--vgai-font-mono': theme.typography.mono,
    '--vgai-radius-sm': theme.shape.small,
    '--vgai-radius-md': theme.shape.medium,
    '--vgai-radius-lg': theme.shape.large,
    '--vgai-radius-full': theme.shape.full,
    '--vgai-shadow-sm': theme.elevation.small,
    '--vgai-shadow-md': theme.elevation.medium,
    '--vgai-shadow-lg': theme.elevation.large,
    '--vgai-focus-ring': `${strokeWidth.active}px solid ${theme.color.accent.default}`,
    '--vgai-select-chevron': chevronDataUri(theme.color.content.muted),
    '--vgai-space-1': `${space[1]}px`,
    '--vgai-space-2': `${space[2]}px`,
    '--vgai-space-3': `${space[3]}px`,
    '--vgai-space-4': `${space[4]}px`,
    '--vgai-space-5': `${space[5]}px`,
    '--vgai-space-6': `${space[6]}px`,
    '--vgai-space-8': `${space[8]}px`,
    '--vgai-space-10': `${space[10]}px`,
    '--vgai-space-12': `${space[12]}px`,
    '--vgai-command-bar-height': `${density(theme).chrome.commandBar}px`,
    '--vgai-panel-header-height': `${density(theme).chrome.panelHeader}px`,
    '--vgai-local-toolbar-height': `${density(theme).chrome.localToolbar}px`,
    '--vgai-tree-row-height': `${density(theme).chrome.treeRow}px`,
    '--vgai-tree-indent': `${density(theme).chrome.treeIndent}px`,
    '--vgai-status-bar-height': `${density(theme).chrome.statusBar}px`,
    '--vgai-tool-size': `${density(theme).chrome.toolSize}px`,
    '--vgai-tool-width': `${density(theme).chrome.toolWidth}px`,
    '--vgai-tool-gap': `${density(theme).chrome.toolGap}px`,
    '--vgai-area-seam-width': `${density(theme).chrome.areaSeam}px`,
    '--vgai-control-compact-height': `${density(theme).control.compact}px`,
    '--vgai-control-default-height': `${density(theme).control.default}px`,
    '--vgai-control-comfortable-height': `${density(theme).control.comfortable}px`,
    '--vgai-stroke-resting': `${strokeWidth.resting}px`,
    '--vgai-stroke-active': `${strokeWidth.active}px`,
    '--vgai-font-xs': `${density(theme).font.xs}px`,
    '--vgai-font-sm': `${density(theme).font.sm}px`,
    '--vgai-font-base': `${density(theme).font.base}px`,
    '--vgai-font-md': `${density(theme).font.md}px`,
    '--vgai-font-lg': `${density(theme).font.lg}px`,
    '--vgai-font-xl': `${density(theme).font.xl}px`,
    '--vgai-font-2xl': `${density(theme).font['2xl']}px`,
    '--vgai-icon-xs': `${density(theme).icon.xs}px`,
    '--vgai-icon-sm': `${density(theme).icon.sm}px`,
    '--vgai-icon-md': `${density(theme).icon.md}px`,
    '--vgai-icon-lg': `${density(theme).icon.lg}px`,
    '--vgai-icon-xl': `${density(theme).icon.xl}px`,
    '--vgai-icon-2xl': `${density(theme).icon['2xl']}px`,
    '--vgai-font-heading': `${density(theme).font.heading}px`,
    '--vgai-font-weight-regular': String(fontWeight.regular),
    '--vgai-font-weight-semibold': String(fontWeight.semibold),
    '--vgai-font-weight-bold': String(fontWeight.bold),
    '--vgai-leading-tight': String(lineHeight.tight),
    '--vgai-leading-snug': String(lineHeight.snug),
    '--vgai-leading-normal': String(lineHeight.normal),
    '--vgai-leading-relaxed': String(lineHeight.relaxed),
    '--vgai-duration-fast': `${motion.duration.fast}ms`,
    '--vgai-duration-base': `${motion.duration.base}ms`,
    '--vgai-duration-slow': `${motion.duration.slow}ms`,
    '--vgai-ease-standard': motion.easing.standard,
    '--vgai-ease-out': motion.easing.out,
    '--vgai-z-base': String(zIndex.base),
    '--vgai-z-overlay-low': String(zIndex.overlayLow),
    '--vgai-z-sticky': String(zIndex.sticky),
    '--vgai-z-dropdown': String(zIndex.dropdown),
    '--vgai-z-toast': String(zIndex.toast),
    '--vgai-z-modal': String(zIndex.modal),
  };
}

export const EDITOR_THEME_CLASS = 'vgai-editor-theme';

/** Install or switch a theme on one editor-chrome root. */
export function applyEditorTheme(
  root: HTMLElement,
  theme: EditorTheme = graphiteDarkEditorTheme,
): void {
  root.classList.add(EDITOR_THEME_CLASS);
  root.dataset['vgaiTheme'] = theme.id;
  // Chrome mode (P6 glass-native chrome, U3/U4): under the Glass material
  // there are no header/footer BARS — those surfaces dissolve into floating
  // glass clusters ("islands", the macOS liquid-glass model). Classic themes
  // keep bars. Reduced-transparency Glass strips optical treatment but
  // remains islands. Derived from explicit material identity, never from
  // theme identity (the theme-id ban holds: CSS scopes on this attribute,
  // not on [data-vgai-theme]).
  root.dataset['vgaiChrome'] = usesGlassMaterial(theme) ? 'islands' : 'bars';
  for (const [name, value] of Object.entries(editorThemeVariables(theme))) {
    root.style.setProperty(name, value);
  }
}

/**
 * Re-exported from `z-index.ts` so callers can import either module for the
 * full token set. See that file's own doc comment for the scale rationale.
 */
export { zIndex };
