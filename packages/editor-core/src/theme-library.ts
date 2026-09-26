import type { EditorCategoryName, EditorPalette } from '@volter/editor-sdk/widgets';
import { EDITOR_CATEGORY_NAMES } from '@volter/editor-sdk/widgets';
import {
  type EditorThemeId,
  editorThemes,
  graphiteDarkEditorTheme,
  isEditorThemeId,
} from '@volter/editor-sdk/widgets';
import { activeProjectKey, getCurrentProject, onProjectChange } from '@volter/editor-sdk/kit/active-project';
import type { SettingsLayer } from '@volter/editor-sdk/kit/api-settings';
import {
  deleteThemeDocument,
  listThemeDocuments,
  saveThemeDocument,
  type ThemeLayerRead,
} from './api/themes';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import mayaPalette from './palettes/maya.palette.json';
import substancePalette from './palettes/substance.palette.json';

// Custom themes are PALETTE DOCUMENTS, one file per theme, named by id:
// `~/.vgai/themes/<id>.json` (the user layer, where the Theme Manager
// writes) and `<project>/.vgai/themes/<id>.json` (the project layer, a
// theme a project ships to everyone who opens it; on an id collision the
// project's wins). `api/themes.ts` is the wire; a file that fails the
// contract below is reported by path and skipped, never silently dropped.
// v3 makes the file's real role explicit: it is a PALETTE document. Material
// treatment, shape, and elevation are resolved from the independent material
// axis and can no longer leak through an imported color theme. v3 is the ONLY
// accepted version: the v2 read path (which projected a Glass-era theme's
// `treatment.contentOnBright` onto `color.content.onBright.*` and swapped
// translucent surfaces for the opaque Classic ramp) was REMOVED — a v2 file
// is now rejected loudly, naming the removal.
export const CUSTOM_EDITOR_THEME_SCHEMA_VERSION = 3 as const;

export interface CustomEditorThemeDocument {
  readonly schemaVersion: typeof CUSTOM_EDITOR_THEME_SCHEMA_VERSION;
  readonly name: string;
  readonly theme: EditorPalette;
}

export interface EditorThemeChoice {
  readonly id: string;
  readonly name: string;
  readonly kind: 'built-in' | 'custom';
  readonly theme: EditorPalette;
}

/** Built-in PALETTES. Glass/Classic is a separate material axis. */
export const BUILT_IN_EDITOR_PALETTE_IDS = [
  'graphite-dark',
  'graphite-neutral',
  'midnight-high-contrast',
] as const satisfies readonly EditorThemeId[];

const BUILT_IN_NAMES: Record<(typeof BUILT_IN_EDITOR_PALETTE_IDS)[number], string> = {
  'graphite-dark': 'Classic Graphite',
  'graphite-neutral': 'Graphite Neutral',
  'midnight-high-contrast': 'Midnight Blue',
};

/**
 * SHIPPED PALETTE DOCUMENTS — the v3 files under `palettes/`, byte-for-byte
 * what a user's own import is, read through the same parser. Data, no code:
 * a palette that names another tool's look (Blender's greys and widget blue,
 * Maya's mid-grey ground, Substance's charcoal) is a document, and the style
 * bundles (`workspace-style.ts`) are what pair each with a material,
 * composition and region set. They list as built-in: not editable in place,
 * duplicable like any other.
 */
const SHIPPED_PALETTE_DOCUMENTS: readonly unknown[] = [mayaPalette, substancePalette];
let cachedShipped: readonly CustomEditorThemeDocument[] | null = null;
/** Palettes a package's `workspace.style` contribution carries (Blender's
 *  ships with `@volter/editor-blender`): parsed through the same v3 reader as a person's
 *  import, listed beside the shipped documents for as long as the
 *  contribution is registered. */
const contributedPaletteDocuments: CustomEditorThemeDocument[] = [];
function shippedPalettes(): readonly CustomEditorThemeDocument[] {
  cachedShipped ??= [
    ...SHIPPED_PALETTE_DOCUMENTS.map((document) => parseCustomEditorThemeDocument(document)),
    ...contributedPaletteDocuments,
  ];
  return cachedShipped;
}

/**
 * Register a palette document a contribution carries. Parsed strictly (a bad
 * document throws here, at registration, with the reader's own message).
 * Returns the unregister.
 */
export function registerContributedPalette(document: unknown): () => void {
  const parsed = parseCustomEditorThemeDocument(document);
  if (shippedPalettes().some((entry) => entry.theme.id === parsed.theme.id))
    throw new Error(
      `registerContributedPalette: palette "${parsed.theme.id}" is already registered.`,
    );
  contributedPaletteDocuments.push(parsed);
  cachedShipped = null;
  emit();
  return () => {
    const index = contributedPaletteDocuments.indexOf(parsed);
    if (index === -1) return;
    contributedPaletteDocuments.splice(index, 1);
    cachedShipped = null;
    emit();
  };
}

/** A palette the editor ships as a document — see {@link SHIPPED_PALETTE_DOCUMENTS}. */
export function isShippedPaletteId(id: string): boolean {
  return shippedPalettes().some((document) => document.theme.id === id);
}

const THEME_STRING_PATHS = [
  'id',
  'color.surface.shell',
  'color.surface.panel',
  'color.surface.chrome',
  'color.surface.raised',
  'color.surface.inset',
  'color.surface.overlay',
  'color.boundary.default',
  'color.boundary.strong',
  'color.boundary.area',
  'color.boundary.indent',
  'color.boundary.divider',
  'color.content.primary',
  'color.content.muted',
  'color.content.dim',
  'color.content.onAccent',
  'color.content.menu',
  'color.content.status',
  'color.content.placeholder',
  'color.content.active',
  'color.content.selected',
  'color.content.onBright.primary',
  'color.content.onBright.muted',
  'color.content.onBright.dim',
  'color.accent.default',
  'color.accent.muted',
  'color.semantic.danger',
  'color.semantic.dangerMuted',
  'color.semantic.dangerFaint',
  'color.semantic.warning',
  'color.semantic.warningMuted',
  'color.semantic.success',
  'color.semantic.successMuted',
  'color.semantic.dynamic',
  'color.semantic.dynamicMuted',
  'color.semantic.instance',
  'color.neutralOverlay.hover',
  'color.neutralOverlay.active',
  'color.scrim',
  'color.viewport.background',
  'color.viewport.grid',
  'color.viewport.axisX',
  'color.viewport.axisY',
  'color.viewport.axisZ',
  'color.viewport.wire',
  'color.viewport.selection',
  'color.viewport.active',
  'color.gizmo.x',
  'color.gizmo.y',
  'color.gizmo.z',
  'color.gizmo.navigationX',
  'color.gizmo.navigationY',
  'color.gizmo.navigationZ',
  'color.gizmo.hover',
  'color.gizmo.drag',
  'color.widget.regular',
  'color.widget.menu',
  'color.widget.field',
  'color.widget.emboss',
  ...EDITOR_CATEGORY_NAMES.map((name) => `color.category.${name}`),
  'color.region.outliner',
  'color.region.properties',
  'typography.sans',
  'typography.mono',
] as const;

/**
 * Palette fields introduced AFTER schema v3 shipped. A document written
 * before the field existed stays valid and projects onto the graphite
 * default; rejecting it would silently drop a user's saved palette from the
 * library (`recordsFrom` names and skips a file whose parse throws). This is
 * FORWARD compatibility for fields added after v3 — not a second schema
 * version. A value that IS present is still validated as a CSS color.
 */
const POST_V3_OPTIONAL_STRING_PATHS: ReadonlySet<string> = new Set([
  'color.semantic.instance',
  'color.content.menu',
  'color.content.status',
  'color.content.placeholder',
  'color.content.active',
  'color.content.selected',
  'color.boundary.area',
  'color.boundary.indent',
  'color.boundary.divider',
  'color.viewport.background',
  'color.viewport.grid',
  'color.viewport.axisX',
  'color.viewport.axisY',
  'color.viewport.axisZ',
  'color.viewport.wire',
  'color.viewport.selection',
  'color.viewport.active',
  'color.gizmo.x',
  'color.gizmo.y',
  'color.gizmo.z',
  'color.gizmo.navigationX',
  'color.gizmo.navigationY',
  'color.gizmo.navigationZ',
  'color.gizmo.hover',
  'color.gizmo.drag',
  'color.widget.regular',
  'color.widget.menu',
  'color.widget.field',
  'color.widget.emboss',
  ...EDITOR_CATEGORY_NAMES.map((name) => `color.category.${name}`),
  'color.region.outliner',
  'color.region.properties',
]);

function cssPropertyForThemePath(path: string): string | null {
  if (path.startsWith('color.')) return 'color';
  if (path.startsWith('typography.')) return 'font-family';
  return null;
}

function validCssValue(property: string, value: string): boolean {
  if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') {
    return CSS.supports(property, value);
  }
  if (typeof document !== 'undefined') {
    const element = document.createElement('div');
    element.style.setProperty(property, value);
    return element.style.getPropertyValue(property) !== '';
  }
  // Import-safe server fallback: the browser performs the authoritative CSS
  // validation before a user can save or apply the theme.
  return true;
}

let cachedChoices: readonly EditorThemeChoice[] | null = null;
const listeners = new Set<() => void>();

interface ThemeRecord {
  readonly layer: SettingsLayer;
  readonly document: CustomEditorThemeDocument;
}
let userRecords: readonly ThemeRecord[] = [];
let projectRecords: readonly ThemeRecord[] = [];
let userLoaded = false;
let projectLoadedFor: string | null = null;
let userLoading: Promise<void> | null = null;
let projectLoading: Promise<void> | null = null;

function valueAtPath(value: unknown, path: string): unknown {
  let current = value;
  for (const key of path.split('.')) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function validateStringPaths(theme: unknown, paths: readonly string[]): void {
  for (const path of paths) {
    const field = valueAtPath(theme, path);
    if (field === undefined && POST_V3_OPTIONAL_STRING_PATHS.has(path)) continue;
    if (typeof field !== 'string' || !field.trim()) {
      throw new Error(`Theme field “${path}” must be a non-empty string.`);
    }
    const property = cssPropertyForThemePath(path);
    if (property && !validCssValue(property, field)) {
      throw new Error(`Theme field “${path}” is not a valid CSS ${property} value.`);
    }
  }
}

export function parseCustomEditorThemeDocument(value: unknown): CustomEditorThemeDocument {
  if (!value || typeof value !== 'object') throw new Error('Theme file must contain an object.');
  const record = value as Record<string, unknown>;
  const schemaVersion = record['schemaVersion'];
  if (schemaVersion !== CUSTOM_EDITOR_THEME_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported theme schema version ${JSON.stringify(schemaVersion)}. Expected ` +
        `${CUSTOM_EDITOR_THEME_SCHEMA_VERSION}. Schema v2 (the Glass-era theme document, with ` +
        '`treatment`/`shape`/`elevation` and no `color.content.onBright.*`) was REMOVED along ' +
        'with the read-time projection that accepted it — re-export the palette from the ' +
        'editor to get a v3 file.',
    );
  }
  if (typeof record['name'] !== 'string' || !record['name'].trim()) {
    throw new Error('Theme name must be a non-empty string.');
  }
  if (record['name'].trim().length > 120) {
    throw new Error('Theme name must be 120 characters or fewer.');
  }
  validateStringPaths(record['theme'], THEME_STRING_PATHS);
  validateOpaqueClassicSurfaces(record['theme']);
  return {
    schemaVersion: CUSTOM_EDITOR_THEME_SCHEMA_VERSION,
    name: record['name'].trim(),
    theme: reconstructEditorPalette(record['theme']),
  };
}

const CLASSIC_OPAQUE_SURFACE_PATHS = [
  'color.surface.shell',
  'color.surface.panel',
  'color.surface.chrome',
  'color.surface.raised',
  'color.surface.inset',
] as const;

function isDefinitelyOpaqueColor(value: string): boolean {
  const trimmed = value.trim();
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) return true;
  const shortHexWithAlpha = /^#[0-9a-f]{3}([0-9a-f])$/i.exec(trimmed);
  if (shortHexWithAlpha) return shortHexWithAlpha[1]?.toLowerCase() === 'f';
  const hexWithAlpha = /^#[0-9a-f]{6}([0-9a-f]{2})$/i.exec(trimmed);
  if (hexWithAlpha) return hexWithAlpha[1]?.toLowerCase() === 'ff';
  const rgb = parseRgb(trimmed);
  if (rgb) return rgb.a === 1;
  if (/^hsl\(/i.test(trimmed) && !trimmed.includes('/')) return true;
  return /^[a-z]+$/i.test(trimmed) && trimmed.toLowerCase() !== 'transparent';
}

function validateOpaqueClassicSurfaces(value: unknown): void {
  for (const path of CLASSIC_OPAQUE_SURFACE_PATHS) {
    const field = valueAtPath(value, path) as string;
    if (!isDefinitelyOpaqueColor(field)) {
      throw new Error(
        `Palette field “${path}” must be an opaque color because it paints the Classic material.`,
      );
    }
  }
}

/**
 * Reconstruct exactly the palette contract — every field is read from a known
 * path, so no material treatment, shape or elevation an input object happens
 * to carry is ever retained.
 */
function reconstructEditorPalette(value: unknown): EditorPalette {
  const get = (path: string): string => valueAtPath(value, path) as string;
  const onBright = {
    primary: get('color.content.onBright.primary'),
    muted: get('color.content.onBright.muted'),
    dim: get('color.content.onBright.dim'),
  };
  // The post-v3 VIEWPORT group. It is reconstructed here or it does not
  // survive at all: this function rebuilds the palette field by field, so a
  // group missing from it is dropped from every palette that arrives as a
  // DOCUMENT — which is every contributed palette. Measured live: the Blender
  // palette's `color.viewport` reached the library and vanished here, so
  // `--vgai-viewport-*` emitted empty, `nativeViewportLook` read all-null, and
  // the 3D viewport kept its dressing gradient, its 0x999999 grid and no axis
  // lines under a palette that names all three.
  const viewportKeys = ['background', 'grid', 'axisX', 'axisY', 'selection', 'active'] as const;
  const viewportValues = viewportKeys.map(
    (key) => valueAtPath(value, `color.viewport.${key}`) as string | undefined,
  );
  const viewportPresent = viewportValues.filter((entry) => entry !== undefined).length;
  if (viewportPresent !== 0 && viewportPresent !== viewportKeys.length) {
    throw new Error(
      `A palette's color.viewport group is all-or-nothing: ${viewportKeys
        .filter((_, index) => viewportValues[index] === undefined)
        .join(', ')} missing. Omit the group to keep the editor's own viewport colours.`,
    );
  }
  // `axisZ` is optional beside the all-or-nothing group: a Z-up world's floor pair is X and Y.
  const viewportAxisZ = valueAtPath(value, 'color.viewport.axisZ') as string | undefined;
  const viewportWire = valueAtPath(value, 'color.viewport.wire') as string | undefined;
  const viewport =
    viewportPresent === viewportKeys.length
      ? (Object.fromEntries(
          [
            ...viewportKeys.map((key, index) => [key, viewportValues[index] as string] as const),
            ...(viewportAxisZ === undefined ? [] : [['axisZ', viewportAxisZ] as const]),
            ...(viewportWire === undefined ? [] : [['wire', viewportWire] as const]),
          ],
        ) as unknown as NonNullable<EditorPalette['color']['viewport']>)
      : undefined;
  // The GIZMO group (`EditorTheme.color.gizmo`), rebuilt for the same reason. Each axis trio
  // (x/y/z, navigationX/Y/Z) comes together or not at all; every other member is optional.
  const gizmoKeys = ['x', 'y', 'z', 'navigationX', 'navigationY', 'navigationZ', 'hover', 'drag'] as const;
  const gizmoEntries = gizmoKeys
    .map((key) => [key, valueAtPath(value, `color.gizmo.${key}`) as string | undefined] as const)
    .filter((entry): entry is readonly [(typeof gizmoKeys)[number], string] => entry[1] !== undefined);
  const gizmoNamed = new Set(gizmoEntries.map(([key]) => key));
  for (const trio of [
    ['x', 'y', 'z'],
    ['navigationX', 'navigationY', 'navigationZ'],
  ] as const) {
    const named = trio.filter((key) => gizmoNamed.has(key)).length;
    if (named !== 0 && named !== 3) {
      throw new Error(
        `A palette's color.gizmo names ${trio.join(', ')} together. Omit them to keep the editor's own.`,
      );
    }
  }
  const gizmo =
    gizmoEntries.length === 0
      ? undefined
      : (Object.fromEntries(gizmoEntries) as NonNullable<EditorPalette['color']['gizmo']>);
  // The post-v3 WIDGET group (`EditorTheme.color.widget`). Same reason as
  // `viewport` above: a group this function does not rebuild is dropped from
  // every palette that arrives as a document. Unlike `viewport` it is NOT
  // all-or-nothing — each class falls back to the surface its call sites read
  // before the group existed, so naming one (Blender names the menu well
  // without needing to restate the pushbutton) is a complete, valid palette.
  // `emboss` is the line UNDER a widget rather than a fill, and it is in this
  // list for exactly the same reason as the three fills: a member the rebuild
  // does not name is dropped.
  const widgetKeys = ['regular', 'menu', 'field', 'emboss'] as const;
  const widgetEntries = widgetKeys
    .map((key) => [key, valueAtPath(value, `color.widget.${key}`) as string | undefined] as const)
    .filter(
      (entry): entry is readonly [(typeof widgetKeys)[number], string] => entry[1] !== undefined,
    );
  const widget =
    widgetEntries.length === 0
      ? undefined
      : (Object.fromEntries(widgetEntries) as NonNullable<EditorPalette['color']['widget']>);
  // The post-v3 CATEGORY group (`EditorTheme.color.category`) — the glyph
  // inks. Rebuilt here for the same reason as the two groups above: this
  // function reconstructs field by field, so a group it does not name is
  // dropped from every palette that arrives as a document, and the Blender
  // style's whole colour channel is contributed as a document. Per-member
  // optional like `widget`, never all-or-nothing: each token falls back to
  // `currentColor`, so a palette naming one category and no other is
  // complete and paints the rest exactly as a monochrome set does.
  const categoryEntries = EDITOR_CATEGORY_NAMES
    .map((key) => [key, valueAtPath(value, `color.category.${key}`) as string | undefined] as const)
    .filter(
      (entry): entry is readonly [EditorCategoryName, string] => entry[1] !== undefined,
    );
  const category =
    categoryEntries.length === 0
      ? undefined
      : (Object.fromEntries(categoryEntries) as NonNullable<EditorPalette['color']['category']>);
  // The post-v3 REGION group (`EditorTheme.color.region`) — the per-EDITOR-AREA
  // fills. Rebuilt here for the same reason as the three groups above, and
  // per-member optional the same way: each region falls back to the surfaces
  // its call sites already read, so a palette naming one area and no other is
  // complete and paints every other group exactly as before.
  const regionKeys = ['outliner', 'properties'] as const;
  const regionEntries = regionKeys
    .map((key) => [key, valueAtPath(value, `color.region.${key}`) as string | undefined] as const)
    .filter(
      (entry): entry is readonly [(typeof regionKeys)[number], string] => entry[1] !== undefined,
    );
  const region =
    regionEntries.length === 0
      ? undefined
      : (Object.fromEntries(regionEntries) as NonNullable<EditorPalette['color']['region']>);
  const surface = Object.fromEntries(
    ['shell', 'panel', 'chrome', 'raised', 'inset', 'overlay'].map((key) => [
      key,
      get(`color.surface.${key}`),
    ]),
  ) as unknown as EditorPalette['color']['surface'];

  return {
    id: get('id'),
    color: {
      surface,
      boundary: {
        default: get('color.boundary.default'),
        strong: get('color.boundary.strong'),
        // The post-v3 AREA seam. Rebuilt here for the same reason as the
        // three optional GROUPS below: this function reconstructs field by
        // field, so a member it does not name is dropped from every palette
        // that arrives as a document — which is every contributed palette,
        // the Blender style's included. Spread rather than assigned so a
        // palette without it carries no `area` key at all, and the emitter's
        // `?? boundary.default` fallback is what every other skin reads.
        ...(typeof valueAtPath(value, 'color.boundary.area') === 'string'
          ? { area: valueAtPath(value, 'color.boundary.area') as string }
          : {}),
        // The tree's INDENT GUIDE, spread for the identical reason: a member
        // this rebuild does not name is dropped from every palette that
        // arrives as a document, and the Blender style's palette is one.
        // Absent here means the emitted token is `transparent` and no tree in
        // the editor draws a guide — see `theme.ts`'s `boundary.indent`.
        ...(typeof valueAtPath(value, 'color.boundary.indent') === 'string'
          ? { indent: valueAtPath(value, 'color.boundary.indent') as string }
          : {}),
        // The DIVIDER rule, spread for the identical reason: a member this
        // rebuild does not name is dropped from every palette that arrives as
        // a document, the Blender style's included. Absent here means the
        // emitted token is `boundary.default` and the rule paints what it
        // always painted — see `theme.ts`'s `boundary.divider`.
        ...(typeof valueAtPath(value, 'color.boundary.divider') === 'string'
          ? { divider: valueAtPath(value, 'color.boundary.divider') as string }
          : {}),
      },
      content: {
        primary: get('color.content.primary'),
        muted: get('color.content.muted'),
        dim: get('color.content.dim'),
        onAccent: get('color.content.onAccent'),
        // The post-v3 MENU-WORD ink, spread for the reason every optional
        // member below is: this function rebuilds field by field, so a member
        // it does not name is silently dropped from every palette that arrives
        // as a DOCUMENT — which is every contributed palette, the Blender
        // style's included. Absent here means the emitter's
        // `?? content.primary` fallback is what the menu words read.
        ...(typeof valueAtPath(value, 'color.content.menu') === 'string'
          ? { menu: valueAtPath(value, 'color.content.menu') as string }
          : {}),
        // The STATUS band's ink and the PLACEHOLDER's, spread for the same
        // reason — a member this rebuild does not name is dropped from every
        // contributed palette, and the Blender style's is one.
        ...(typeof valueAtPath(value, 'color.content.status') === 'string'
          ? { status: valueAtPath(value, 'color.content.status') as string }
          : {}),
        ...(typeof valueAtPath(value, 'color.content.placeholder') === 'string'
          ? { placeholder: valueAtPath(value, 'color.content.placeholder') as string }
          : {}),
        // The post-v3 ACTIVE ink, spread rather than assigned for the same
        // reason `boundary.area` is: this function rebuilds field by field, so
        // an unnamed member is dropped from every palette that arrives as a
        // DOCUMENT — which is every contributed palette, the Blender style's
        // included. Absent here means absent in the emitted token, and the
        // hierarchy row's own fallback is what every other skin reads.
        ...(typeof valueAtPath(value, 'color.content.active') === 'string'
          ? { active: valueAtPath(value, 'color.content.active') as string }
          : {}),
        // Its other half — the SELECTED-but-not-active ink — spread the same
        // way and for the same reason. Absent here means absent in the emitted
        // token, and the emitter falls it back to `active`.
        ...(typeof valueAtPath(value, 'color.content.selected') === 'string'
          ? { selected: valueAtPath(value, 'color.content.selected') as string }
          : {}),
        onBright,
      },
      accent: {
        default: get('color.accent.default'),
        muted: get('color.accent.muted'),
      },
      semantic: {
        danger: get('color.semantic.danger'),
        dangerMuted: get('color.semantic.dangerMuted'),
        dangerFaint: get('color.semantic.dangerFaint'),
        warning: get('color.semantic.warning'),
        warningMuted: get('color.semantic.warningMuted'),
        success: get('color.semantic.success'),
        successMuted: get('color.semantic.successMuted'),
        dynamic: get('color.semantic.dynamic'),
        dynamicMuted: get('color.semantic.dynamicMuted'),
        // Post-v3 field: absent in documents saved before instance identity
        // existed, so it projects onto the graphite default rather than
        // producing `undefined` in a palette typed as all-strings.
        instance:
          (valueAtPath(value, 'color.semantic.instance') as string | undefined) ??
          graphiteDarkEditorTheme.color.semantic.instance,
      },
      neutralOverlay: {
        hover: get('color.neutralOverlay.hover'),
        active: get('color.neutralOverlay.active'),
      },
      scrim: get('color.scrim'),
      ...(viewport ? { viewport } : {}),
      ...(gizmo ? { gizmo } : {}),
      ...(widget ? { widget } : {}),
      ...(category ? { category } : {}),
      ...(region ? { region } : {}),
    },
    typography: { sans: get('typography.sans'), mono: get('typography.mono') },
  };
}

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

function parseRgb(value: string): Rgb | null {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim())?.[1];
  if (hex) {
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
      a: 1,
    };
  }
  const rgb =
    /^rgba?\(\s*(\d+(?:\.\d+)?)\s*(?:,\s*|\s+)(\d+(?:\.\d+)?)\s*(?:,\s*|\s+)(\d+(?:\.\d+)?)(?:\s*(?:,|\/)\s*(\d+(?:\.\d+)?%?))?\s*\)$/i.exec(
      value.trim(),
    );
  if (!rgb) return null;
  const [r, g, b] = rgb.slice(1, 4).map(Number);
  const alphaToken = rgb[4];
  const a = alphaToken?.endsWith('%')
    ? Number(alphaToken.slice(0, -1)) / 100
    : Number(alphaToken ?? 1);
  return r! <= 255 && g! <= 255 && b! <= 255 && a >= 0 && a <= 1
    ? { r: r!, g: g!, b: b!, a }
    : null;
}

function relativeLuminance(color: Rgb): number {
  const channels = [color.r, color.g, color.b].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

function contrastRatio(foreground: string, background: string): number | null {
  const fg = parseRgb(foreground);
  const bg = parseRgb(background);
  // A translucent pair has no single WCAG ratio until the live scene behind
  // it is known. Treat it as backdrop-dependent instead of silently dropping
  // alpha and reporting a precise-but-false opaque ratio in Theme Manager.
  if (!fg || !bg || fg.a < 1 || bg.a < 1) return null;
  const lighter = Math.max(relativeLuminance(fg), relativeLuminance(bg));
  const darker = Math.min(relativeLuminance(fg), relativeLuminance(bg));
  return (lighter + 0.05) / (darker + 0.05);
}

/** Human-readable warnings for essential editor-chrome WCAG AA pairs. */
export function editorThemeContrastWarnings(theme: EditorPalette): readonly string[] {
  const pairs = [
    ['Primary text', theme.color.content.primary, theme.color.surface.panel],
    ['Muted text', theme.color.content.muted, theme.color.surface.panel],
    ['Dim text', theme.color.content.dim, theme.color.surface.panel],
    ['Text on accent', theme.color.content.onAccent, theme.color.accent.default],
    ['Danger text', theme.color.semantic.danger, theme.color.surface.panel],
  ] as const;
  return pairs.flatMap(([label, foreground, background]) => {
    const ratio = contrastRatio(foreground, background);
    return ratio !== null && ratio < 4.5 ? [`${label} contrast is ${ratio.toFixed(2)}:1`] : [];
  });
}

function recordsFrom(layer: SettingsLayer, read: ThemeLayerRead): ThemeRecord[] {
  const records: ThemeRecord[] = [];
  for (const issue of read.issues) {
    editorConsole.warn(`${layer} theme ${issue} — skipped`, 'settings');
  }
  for (const entry of read.documents) {
    try {
      const document = parseCustomEditorThemeDocument(entry.document);
      if (document.theme.id !== entry.id) {
        throw new Error(`the file is named ${entry.id} but its palette id is ${document.theme.id}`);
      }
      if (isEditorThemeId(document.theme.id) || isShippedPaletteId(document.theme.id)) {
        throw new Error('a built-in palette id cannot be redefined');
      }
      records.push({ layer, document });
    } catch (cause) {
      // One malformed file must not make every saved theme unavailable —
      // and it is named, so the person who wrote it can fix it.
      editorConsole.warn(
        `${layer} theme ${entry.path}: ${(cause as Error).message} — skipped`,
        'settings',
      );
    }
  }
  return records;
}

function projectKey(): string {
  return activeProjectKey();
}

function loadUser(): Promise<void> {
  if (userLoaded) return Promise.resolve();
  userLoading ??= listThemeDocuments('user')
    .then((read) => {
      userRecords = recordsFrom('user', read);
    })
    .catch(() => {
      userRecords = [];
    })
    .finally(() => {
      userLoaded = true;
      userLoading = null;
    });
  return userLoading;
}

function loadProject(): Promise<void> {
  const key = projectKey();
  if (projectLoadedFor === key) return Promise.resolve();
  // In flight for another project: this one loads after it, never joins it.
  if (projectLoading) return projectLoading.then(() => loadProject());
  if (!getCurrentProject()) {
    projectRecords = [];
    projectLoadedFor = key;
    return Promise.resolve();
  }
  projectLoading = listThemeDocuments('project')
    .then((read) => {
      projectRecords = recordsFrom('project', read);
    })
    .catch(() => {
      projectRecords = [];
    })
    .finally(() => {
      projectLoadedFor = key;
      projectLoading = null;
    });
  return projectLoading;
}

/** Load both layers' documents (memoized per layer; the project layer per
 *  project) and publish. The boot awaits this before the first paint so a
 *  chosen custom palette resolves on the first frame. */
export function preloadEditorThemeLibrary(): Promise<void> {
  return Promise.all([loadUser(), loadProject()]).then(emit);
}

/** Custom documents, project over user on an id collision. */
function customThemes(): readonly CustomEditorThemeDocument[] {
  const byId = new Map<string, CustomEditorThemeDocument>();
  for (const record of userRecords) byId.set(record.document.theme.id, record.document);
  for (const record of projectRecords) byId.set(record.document.theme.id, record.document);
  return [...byId.values()];
}

function emit(): void {
  cachedChoices = null;
  for (const listener of listeners) listener();
}

function layerHolding(id: string): SettingsLayer | null {
  if (projectRecords.some((record) => record.document.theme.id === id)) return 'project';
  if (userRecords.some((record) => record.document.theme.id === id)) return 'user';
  return null;
}

/** Write one document to the layer that holds it (a new theme goes to the
 *  USER layer — a project theme is placed by hand, the way a `.vscode` file
 *  is) and publish. */
function persistTheme(document: CustomEditorThemeDocument): void {
  const id = document.theme.id;
  const layer = layerHolding(id) ?? 'user';
  const record = { layer, document };
  if (layer === 'project') {
    projectRecords = [...projectRecords.filter((r) => r.document.theme.id !== id), record];
  } else {
    userRecords = [...userRecords.filter((r) => r.document.theme.id !== id), record];
  }
  emit();
  void saveThemeDocument(layer, id, document).catch((cause: unknown) => {
    editorConsole.error(
      `Could not save the ${layer} theme ${id}: ${(cause as Error).message}`,
      'settings',
    );
  });
}

function removeTheme(id: string): boolean {
  const layer = layerHolding(id);
  if (!layer) return false;
  if (layer === 'project') {
    projectRecords = projectRecords.filter((r) => r.document.theme.id !== id);
  } else {
    userRecords = userRecords.filter((r) => r.document.theme.id !== id);
  }
  emit();
  void deleteThemeDocument(layer, id).catch((cause: unknown) => {
    editorConsole.error(
      `Could not delete the ${layer} theme ${id}: ${(cause as Error).message}`,
      'settings',
    );
  });
  return true;
}

function uniqueThemeId(seed = 'custom-theme'): string {
  const slug =
    seed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'custom-theme';
  const occupied = new Set(editorThemeLibrarySnapshot().map((choice) => choice.id));
  if (!occupied.has(slug)) return slug;
  let suffix = 2;
  while (occupied.has(`${slug}-${suffix}`)) suffix += 1;
  return `${slug}-${suffix}`;
}

function paletteFromBuiltIn(id: (typeof BUILT_IN_EDITOR_PALETTE_IDS)[number]): EditorPalette {
  const theme = editorThemes[id];
  return { id: theme.id, color: theme.color, typography: theme.typography };
}

export function editorThemeLibrarySnapshot(): readonly EditorThemeChoice[] {
  cachedChoices ??= [
    ...BUILT_IN_EDITOR_PALETTE_IDS.map((id) => ({
      id,
      name: BUILT_IN_NAMES[id],
      kind: 'built-in' as const,
      theme: paletteFromBuiltIn(id),
    })),
    ...shippedPalettes().map((document) => ({
      id: document.theme.id,
      name: document.name,
      kind: 'built-in' as const,
      theme: document.theme,
    })),
    ...customThemes().map((document) => ({
      id: document.theme.id,
      name: document.name,
      kind: 'custom' as const,
      theme: document.theme,
    })),
  ];
  return cachedChoices;
}

export function subscribeEditorThemeLibrary(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resolveEditorTheme(id: string): EditorThemeChoice | undefined {
  return editorThemeLibrarySnapshot().find((choice) => choice.id === id);
}

export function duplicateEditorTheme(sourceId: string, requestedName?: string): EditorThemeChoice {
  const source = resolveEditorTheme(sourceId);
  if (!source) throw new Error(`Unknown editor theme “${sourceId}”.`);
  const name = requestedName?.trim() || `${source.name} Copy`;
  const id = uniqueThemeId(name);
  const document = parseCustomEditorThemeDocument({
    schemaVersion: CUSTOM_EDITOR_THEME_SCHEMA_VERSION,
    name,
    theme: { ...structuredClone(source.theme), id },
  });
  persistTheme(document);
  return resolveEditorTheme(id)!;
}

export function saveCustomEditorTheme(document: CustomEditorThemeDocument): EditorThemeChoice {
  const parsed = parseCustomEditorThemeDocument(document);
  if (isEditorThemeId(parsed.theme.id) || isShippedPaletteId(parsed.theme.id)) {
    throw new Error('Built-in themes cannot be overwritten.');
  }
  persistTheme(parsed);
  return resolveEditorTheme(parsed.theme.id)!;
}

export function importCustomEditorTheme(value: unknown): EditorThemeChoice {
  let serializedLength: number;
  try {
    serializedLength = JSON.stringify(value).length;
  } catch {
    throw new Error('Theme file must be plain JSON data.');
  }
  if (serializedLength > 262_144) {
    throw new Error('Theme file too large (256 KB limit).');
  }
  const parsed = parseCustomEditorThemeDocument(value);
  const id = uniqueThemeId(parsed.name);
  return saveCustomEditorTheme({ ...parsed, theme: { ...parsed.theme, id } });
}

export function deleteCustomEditorTheme(id: string): boolean {
  return removeTheme(id);
}

export function resetEditorThemeLibraryForTests(): void {
  userRecords = [];
  projectRecords = [];
  userLoaded = false;
  projectLoadedFor = null;
  userLoading = null;
  projectLoading = null;
  cachedChoices = null;
}

onProjectChange(() => {
  void loadProject().then(emit);
});
