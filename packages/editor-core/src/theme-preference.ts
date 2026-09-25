import {
  applyEditorTheme,
  composeEditorAppearance,
  DEFAULT_ICON_SET_ID,
  EDITOR_REGION_NAMES,
  type EditorMaterialId,
  type EditorPalette,
  type EditorRegionName,
  type EditorTheme,
  isEditorIconSetId,
  isEditorMaterialId,
  setActiveIconSet,
  subscribeEditorMaterials,
  subscribeIconSets,
} from '@volter/editor-sdk/widgets';
import { effectiveSettings, subscribeSettings, updatePreferenceSettings } from './settings-store';
import { resolveEditorTheme, subscribeEditorThemeLibrary } from './theme-library';

// The palette and material are `appearance.palette` / `appearance.material`
// in the settings layers (`settings-store.ts`: `~/.vgai/settings.json`, a
// project's `.vgai/settings.json` overriding it). A stored preference carries
// no authored content, so an unreadable/absent one simply falls back to the
// default appearance — no migration, no alias. The ONE thing still in browser
// storage here is the PREPAINT record: the shell colour `index.html` paints
// before any module loads, a cache of the last paint and never a setting.
export const PREPAINT_EDITOR_THEME_STORAGE_KEY = 'vgai.editor.prepaint.v1';

/**
 * THE HOST'S OWN DEFAULT APPEARANCE — what the editor wears when no product
 * composed it, and the floor every other answer falls back to. Classic's
 * reference frame is the host with no look declared (ARCHITECTURE-CORE §The
 * core is the workbench, "Host default versus skew").
 */
export const DEFAULT_EDITOR_PALETTE_ID = 'graphite-dark';
export const DEFAULT_EDITOR_MATERIAL_ID: EditorMaterialId = 'classic';

/**
 * THE PRODUCT'S DEFAULT APPEARANCE, pushed in rather than read out.
 *
 * The look is the PRODUCT's (ARCHITECTURE-CORE §The target shape, rule 3;
 * WORK.md PART B beat 7 — under the frame there is no look switcher). A
 * product's entry names a style bundle id (`frame/product.ts`'s `look`), and
 * `workspace-style.ts` — which is the module that knows what a bundle IS —
 * resolves it and calls this. It is a DEFAULT and nothing more: the person's
 * `~/.vgai/settings.json`, the project's own, and the adapter's declaration all
 * outrank it, because each of those is something somebody said about THIS
 * machine or THIS project.
 *
 * Pushed instead of pulled because the dependency runs the other way:
 * `workspace-style.ts` imports this module, so this module cannot import it.
 */
let productAppearance: {
  readonly palette: string;
  readonly material: EditorMaterialId;
  readonly icons: string;
} | null = null;

export function setDefaultEditorAppearance(
  next: { palette: string; material: EditorMaterialId; icons: string } | null,
): void {
  productAppearance = next;
  // A default that arrives after the first read (the product's style bundle is
  // a package's contribution, so it registers a moment into the session) has to
  // dislodge the cached fallback, or the page wears the host's Graphite for the
  // rest of its life with nothing saying why.
  // A value a setter holds in flight is not a fallback, whatever the settings say yet.
  const stored = effectiveSettings().appearance;
  if (stored?.palette === undefined && !pendingWrites.has('palette')) cachedPaletteId = null;
  if (stored?.material === undefined && !pendingWrites.has('material')) cachedMaterialId = null;
  if (stored?.icons === undefined && !pendingWrites.has('icons')) cachedIconSetId = null;
  fallBackFromMissingTheme();
  applyCurrentTheme();
  emit();
}

/** The product's declared palette when it resolves, the host's otherwise. */
function defaultPaletteId(): string {
  const declared = productAppearance?.palette;
  return declared !== undefined && resolveEditorTheme(declared)
    ? declared
    : DEFAULT_EDITOR_PALETTE_ID;
}

function defaultMaterialId(): EditorMaterialId {
  return productAppearance?.material ?? DEFAULT_EDITOR_MATERIAL_ID;
}

function defaultIconSetId(): string {
  const declared = productAppearance?.icons;
  return declared !== undefined && isEditorIconSetId(declared) ? declared : DEFAULT_ICON_SET_ID;
}

/**
 * `prefers-reduced-transparency` changes only the painted Glass tier. The
 * stored palette and requested material remain untouched.
 */
const REDUCED_TRANSPARENCY_QUERY = '(prefers-reduced-transparency: reduce)';

let cachedPaletteId: string | null = null;
let cachedMaterialId: EditorMaterialId | null = null;
let cachedIconSetId: string | null = null;

/**
 * A SETTER'S WRITE IS IN FLIGHT until it settles. Under the Code-OSS frame a write is the
 * configuration service's asynchronous `updateValue`, and other settings changes arrive
 * meanwhile, each still reporting the previous value: re-read then, a style bundle's palette,
 * material and icon set fell back to the previous bundle's and the chrome wore a mix of the two
 * until the writes landed (measured through `set-style`, which answered "custom mix" for every
 * switch between two bundles). So an axis keeps its setter's value until that write settles,
 * landed or failed, and then takes the stored value again — which is also how a project's own
 * override of the axis still wins.
 */
const pendingWrites = new Map<'palette' | 'material' | 'icons', symbol>();

function writeAxis(axis: 'palette' | 'material' | 'icons', value: string): void {
  const write = Symbol(`${axis} write`);
  pendingWrites.set(axis, write);
  const appearance =
    axis === 'palette'
      ? { palette: value }
      : axis === 'material'
        ? { material: value as EditorMaterialId }
        : { icons: value };
  void updatePreferenceSettings({ appearance }).then(() => {
    if (pendingWrites.get(axis) !== write) return; // a later setter owns the axis now
    pendingWrites.delete(axis);
    syncFromSettings();
  });
}

/** Re-read every axis no write holds, and repaint when one moved. */
function syncFromSettings(): void {
  if (!pendingWrites.has('icons')) cachedIconSetId = readStoredIconSetId();
  setActiveIconSet(editorIconSetSnapshot());
  const palette = pendingWrites.has('palette') ? editorPaletteSnapshot() : readStoredPaletteId();
  const material = pendingWrites.has('material') ? editorMaterialSnapshot() : readStoredMaterialId();
  if (palette === cachedPaletteId && material === cachedMaterialId) return;
  cachedPaletteId = palette;
  cachedMaterialId = material;
  previewTheme = null;
  applyCurrentTheme();
  emit();
}
let installedRoot: HTMLElement | null = null;
let previewTheme: EditorPalette | null = null;
let removeSettingsListener: (() => void) | null = null;
let removeMaterialsListener: (() => void) | null = null;
let removeIconSetsListener: (() => void) | null = null;
let removeReducedTransparencyListener: (() => void) | null = null;
const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function resolvePaletteId(value: string | null | undefined): string {
  return value && resolveEditorTheme(value) ? value : defaultPaletteId();
}

function readStoredPaletteId(): string {
  return resolvePaletteId(effectiveSettings().appearance?.palette);
}

function readStoredMaterialId(): EditorMaterialId {
  const stored = effectiveSettings().appearance?.material;
  return isEditorMaterialId(stored) ? stored : defaultMaterialId();
}

function readStoredIconSetId(): string {
  const stored = effectiveSettings().appearance?.icons;
  return isEditorIconSetId(stored) ? stored : defaultIconSetId();
}

/** The stored icon set when a registered set answers it; the editor's own otherwise. Cached
 *  like the palette and the material: under a settings PROVIDER (the Code-OSS frame's) a write
 *  reaches the effective settings only after the provider's round trip, so a read straight after
 *  a setter would see the previous set and a style bundle would read as a custom mix. */
export function editorIconSetSnapshot(): string {
  cachedIconSetId ??= readStoredIconSetId();
  return cachedIconSetId;
}

export function setEditorIconSetPreference(id: string): void {
  if (!isEditorIconSetId(id)) throw new Error(`Unknown editor icon set “${id}”.`);
  cachedIconSetId = id;
  writeAxis('icons', id);
  setActiveIconSet(id);
  emit();
}

function fallBackFromMissingTheme(): void {
  if (resolveEditorTheme(editorPaletteSnapshot())) return;
  // A stored palette that does not resolve is WORN as the default and never repaired on disk. A
  // contributed palette is absent until its package registers (the Blender look's, the brand's
  // Plotter), and absent altogether in a build or project without that package; writing the
  // default would erase the choice in every other product and project that shares the settings
  // file. The stored choice wins again the moment it resolves (`subscribeEditorThemeLibrary`).
  cachedPaletteId = defaultPaletteId();
}

export function editorPaletteSnapshot(): string {
  cachedPaletteId ??= readStoredPaletteId();
  return cachedPaletteId;
}

export function editorMaterialSnapshot(): EditorMaterialId {
  cachedMaterialId ??= readStoredMaterialId();
  return cachedMaterialId;
}

/**
 * THE EDITOR AREAS THE ACTIVE PALETTE PAINTS SEPARATELY — its own
 * `color.region` claims ({@link EditorRegionName}), as a space-joined key so a
 * component can subscribe to the whole SET with one primitive snapshot.
 *
 * It answers a different question from a panel's claim. A panel says WHICH
 * area it is (`workspace-static-panels.ts`); this says whether the installed
 * palette has anything to say about that area at all. A palette naming none
 * paints every group alike and must also not get the chrome that only reads as
 * chrome INSIDE a painted area — Classic's reference frame is the host with no
 * look declared (ARCHITECTURE-CORE §The core is the workbench, "Host default
 * versus skew"), so a frame-justified shape belongs to the skew that measured
 * it.
 */
export function editorPaintedRegions(): string {
  const palette = previewTheme ?? resolveEditorTheme(editorPaletteSnapshot())?.theme;
  const region = palette?.color.region;
  if (!region) return '';
  return EDITOR_REGION_NAMES.filter((name: EditorRegionName) => region[name] !== undefined).join(
    ' ',
  );
}

export function subscribeEditorTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(): void {
  for (const listener of listeners) listener();
}

function reducedTransparencyRequested(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia(REDUCED_TRANSPARENCY_QUERY).matches;
  } catch {
    return false;
  }
}

/**
 * Resolve the token set actually painted from the independent palette and
 * material axes. The material composer owns the reduced-transparency tier;
 * custom palette documents cannot inject or replace surface treatment.
 */
function resolvePaintTheme(palette: EditorPalette): EditorTheme {
  const materialId = editorMaterialSnapshot();
  return composeEditorAppearance(
    palette,
    materialId,
    materialId === 'glass' && reducedTransparencyRequested(),
  );
}

function applyCurrentTheme(): void {
  if (!installedRoot) return;
  const persisted = resolveEditorTheme(editorPaletteSnapshot())?.theme;
  const palette = previewTheme ?? persisted;
  if (palette) {
    applyEditorTheme(installedRoot, resolvePaintTheme(palette));
    installedRoot.dataset['vgaiPalette'] = palette.id;
    installedRoot.dataset['vgaiMaterial'] = editorMaterialSnapshot();
  }
  if (!previewTheme && persisted) {
    const painted = resolvePaintTheme(persisted);
    storage()?.setItem(
      PREPAINT_EDITOR_THEME_STORAGE_KEY,
      JSON.stringify({
        paletteId: persisted.id,
        materialId: editorMaterialSnapshot(),
        id: painted.id,
        shell: painted.color.surface.shell,
      }),
    );
  }
}

export function setEditorPalettePreference(paletteId: string): void {
  if (!resolveEditorTheme(paletteId)) throw new Error(`Unknown editor palette “${paletteId}”.`);
  previewTheme = null;
  if (editorPaletteSnapshot() === paletteId) {
    applyCurrentTheme();
    // The same palette re-applied can still paint differently (its document changed), and the
    // frame derives the workbench's colours from what is painted (`frame/look-colors.ts`).
    emit();
    return;
  }
  cachedPaletteId = paletteId;
  writeAxis('palette', paletteId);
  applyCurrentTheme();
  emit();
}

export function setEditorMaterialPreference(materialId: EditorMaterialId): void {
  if (!isEditorMaterialId(materialId)) throw new Error(`Unknown editor material “${materialId}”.`);
  if (editorMaterialSnapshot() === materialId) {
    applyCurrentTheme();
    return;
  }
  cachedMaterialId = materialId;
  writeAxis('material', materialId);
  applyCurrentTheme();
  emit();
}

/** Temporarily paint an unsaved draft without changing the persisted choice. */
export function previewEditorTheme(theme: EditorPalette): void {
  previewTheme = theme;
  applyCurrentTheme();
  // A draft is painted like a choice, so the workbench's colours follow it too: the stage
  // reads those first (`native-selection-style.ts`), and a preview they never reached left
  // the 3D viewport on the saved look.
  emit();
}

/** Return from a draft preview to the currently persisted library theme. */
export function clearEditorThemePreview(): void {
  previewTheme = null;
  applyCurrentTheme();
  emit();
}

/** Install persisted theming and settings-layer synchronization on one editor root. */
export function installEditorTheme(root: HTMLElement): () => void {
  installedRoot = root;
  applyCurrentTheme();

  // Re-read: a snapshot taken before the settings loaded cached the default.
  if (!pendingWrites.has('icons')) cachedIconSetId = readStoredIconSetId();
  setActiveIconSet(editorIconSetSnapshot());
  removeIconSetsListener?.();
  // A stored set a package carries is unknown until that package's style registers.
  removeIconSetsListener = subscribeIconSets(() => {
    if (!pendingWrites.has('icons')) cachedIconSetId = readStoredIconSetId();
    setActiveIconSet(editorIconSetSnapshot());
  });

  // The settings layers changed (a load finished, a project with its own
  // appearance override became active, a setter's write settled): re-read the axes.
  removeSettingsListener?.();
  removeSettingsListener = subscribeSettings(syncFromSettings);

  // A stored material a package carries is unknown until that package's style
  // registers; Classic paints meanwhile and the stored choice wins on arrival.
  removeMaterialsListener?.();
  removeMaterialsListener = subscribeEditorMaterials(() => {
    if (pendingWrites.has('material')) return;
    const material = readStoredMaterialId();
    if (material === cachedMaterialId) return;
    cachedMaterialId = material;
    applyCurrentTheme();
    emit();
  });

  removeReducedTransparencyListener?.();
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    try {
      const query = window.matchMedia(REDUCED_TRANSPARENCY_QUERY);
      const onChange = () => {
        applyCurrentTheme();
        emit();
      };
      query.addEventListener('change', onChange);
      removeReducedTransparencyListener = () => query.removeEventListener('change', onChange);
    } catch {
      removeReducedTransparencyListener = null;
    }
  }

  return () => {
    if (installedRoot === root) installedRoot = null;
    removeSettingsListener?.();
    removeSettingsListener = null;
    removeMaterialsListener?.();
    removeMaterialsListener = null;
    removeIconSetsListener?.();
    removeIconSetsListener = null;
    removeReducedTransparencyListener?.();
    removeReducedTransparencyListener = null;
  };
}

/** Test-only process reset; production callers should never clear the preference implicitly. */
export function resetEditorThemePreferenceForTests(): void {
  cachedPaletteId = null;
  cachedMaterialId = null;
  cachedIconSetId = null;
  pendingWrites.clear();
  installedRoot = null;
  previewTheme = null;
  removeReducedTransparencyListener?.();
  removeReducedTransparencyListener = null;
  listeners.clear();
}

// Library changes made in this tab immediately repaint a selected custom
// theme and update every menu/dialog subscriber.
subscribeEditorThemeLibrary(() => {
  // A palette a PACKAGE carries (`@volter/editor-blender`'s Blender palette, registered
  // by its `workspace.style` contribution) does not exist yet when settings
  // are first read, so `readStoredPaletteId` resolved the stored id to the
  // default and cached it. Re-read it now that the library has grown — the
  // stored choice wins on arrival, exactly as a late-registering MATERIAL
  // already does in `installEditorTheme`. Without this, a project whose
  // `.vgai/settings.json` names a contributed palette painted Graphite
  // forever and nothing said why.
  if (!pendingWrites.has('palette')) {
    const stored = readStoredPaletteId();
    if (stored !== cachedPaletteId) cachedPaletteId = stored;
  }
  fallBackFromMissingTheme();
  applyCurrentTheme();
  emit();
});
