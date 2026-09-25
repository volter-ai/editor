/**
 * Workspace STYLE BUNDLES (Glass-UI spike, Unit 3, "New named style using
 * existing axes" row).
 *
 * Named one-shot presets over PALETTE + MATERIAL + ICONS: how things are DRAWN, and nothing
 * else (ARCHITECTURE.md rule 7). The axes stay independently selectable; choosing a named style
 * intentionally restores its canonical complete appearance. In particular, Classic must restore
 * the original Graphite contract rather than inheriting a Glass palette. Which chrome regions
 * exist is function — a workspace's (`workspace-regions.ts`), never a style's.
 *
 * Bundles are ONE-SHOT PRESETS, not a fifth stored axis: applying a bundle
 * just calls the four existing axis setters, and this module keeps no store
 * or persistence of its own. "Which bundle is active" is always DERIVED
 * from their current values (`activeWorkspaceStyleId`) and can never
 * disagree with them — e.g. after a user independently changes just the
 * material, the derived id correctly falls back to `null` (a "custom" mix)
 * rather than going stale.
 */

import type { StyleContribution } from '@volter/editor-sdk/looks';
import type { EditorMaterialId, EditorPalette } from '@volter/editor-sdk/widgets';
import {
  DEFAULT_ICON_SET_ID,
  registerContributedIconSet,
  registerContributedMaterial,
} from '@volter/editor-sdk/widgets';
import { activeProduct, subscribeActiveProduct } from './active-product';
import { registerContributedPalette } from './theme-library';
import {
  editorIconSetSnapshot,
  editorMaterialSnapshot,
  editorPaletteSnapshot,
  setDefaultEditorAppearance,
  setEditorIconSetPreference,
  setEditorMaterialPreference,
  setEditorPalettePreference,
} from './theme-preference';

export interface WorkspaceStyleBundle {
  readonly id: string;
  readonly title: string;
  readonly paletteId: EditorPalette['id'];
  readonly materialId: EditorMaterialId;
  /** `icon-set-registry.ts`; `default` is the editor's own glyphs. */
  readonly iconSetId: string;
}

/** Frozen built-in list — the switch surface (command palette / View menu)
 *  enumerates this directly. */
const BUILT_IN_STYLES: readonly WorkspaceStyleBundle[] = Object.freeze([
  {
    id: 'classic',
    title: 'Classic',
    paletteId: 'graphite-dark',
    materialId: 'classic',
    iconSetId: DEFAULT_ICON_SET_ID,
  },
  {
    id: 'glass',
    title: 'Glass',
    paletteId: 'graphite-neutral',
    materialId: 'glass',
    iconSetId: DEFAULT_ICON_SET_ID,
  },
  {
    id: 'maya',
    title: 'Maya',
    paletteId: 'maya',
    materialId: 'classic',
    iconSetId: DEFAULT_ICON_SET_ID,
  },
  {
    id: 'substance',
    title: 'Substance',
    paletteId: 'substance',
    materialId: 'classic',
    iconSetId: DEFAULT_ICON_SET_ID,
  },
]);

interface ContributedStyle {
  readonly bundle: WorkspaceStyleBundle;
  readonly unregisterPalette: (() => void) | null;
  readonly unregisterMaterial: (() => void) | null;
  readonly unregisterIconSet: (() => void) | null;
}
const contributedStyles = new Map<string, ContributedStyle>();
let registryVersion = 0;
const registryListeners = new Set<() => void>();

/** Built-ins first, then contributions in registration order — the switch
 *  surfaces (View menu, palette) enumerate this. */
export function workspaceStyles(): readonly WorkspaceStyleBundle[] {
  return [...BUILT_IN_STYLES, ...[...contributedStyles.values()].map((entry) => entry.bundle)];
}

export function workspaceStylesVersion(): number {
  return registryVersion;
}

export function subscribeWorkspaceStyles(listener: () => void): () => void {
  registryListeners.add(listener);
  return () => registryListeners.delete(listener);
}

/**
 * Register a package's style bundle (`workspace.style` contribution), with
 * the palette document and the material it carries registered first — the
 * bundle names their ids, and an id must exist before the bundle can be
 * applied. Returns the unregister. A duplicate id throws.
 */
export function registerContributedStyle(contribution: StyleContribution): () => void {
  if (
    BUILT_IN_STYLES.some((entry) => entry.id === contribution.id) ||
    contributedStyles.has(contribution.id)
  )
    throw new Error(`registerContributedStyle: style "${contribution.id}" is already registered.`);
  const unregisterPalette =
    contribution.palette === undefined ? null : registerContributedPalette(contribution.palette);
  const unregisterMaterial =
    contribution.material === undefined ? null : registerContributedMaterial(contribution.material);
  const unregisterIconSet =
    contribution.icons === undefined ? null : registerContributedIconSet(contribution.icons);
  const entry: ContributedStyle = {
    bundle: {
      id: contribution.id,
      title: contribution.title,
      paletteId: contribution.paletteId,
      materialId: contribution.materialId,
      iconSetId: contribution.iconSetId ?? contribution.icons?.id ?? DEFAULT_ICON_SET_ID,
    },
    unregisterPalette,
    unregisterMaterial,
    unregisterIconSet,
  };
  contributedStyles.set(contribution.id, entry);
  registryVersion++;
  for (const listener of registryListeners) listener();
  // The product's look is usually one of these (the Blender look ships inside
  // `@volter/editor-blender`), so the id it named only becomes resolvable here.
  publishProductLook();
  return () => {
    if (contributedStyles.get(contribution.id) !== entry) return;
    contributedStyles.delete(contribution.id);
    entry.unregisterPalette?.();
    entry.unregisterMaterial?.();
    entry.unregisterIconSet?.();
    registryVersion++;
    for (const listener of registryListeners) listener();
    publishProductLook();
  };
}

/**
 * THE PRODUCT'S LOOK, RESOLVED TO ITS AXES — the one thing this module does for
 * a composition rather than for a gesture.
 *
 * A product names a style bundle id (`frame/product.ts`'s `look`); this is the
 * module that knows what a bundle IS, so it resolves the id and pushes the
 * palette/material/icons behind `theme-preference.ts`'s defaults. It runs on
 * every registry change because a product's own look usually arrives as one of
 * its packages' `workspace.style` contributions, which register a moment into
 * the session — the Blender look is the worked case.
 *
 * It applies nothing and persists nothing: a bundle a person CHOOSES goes
 * through {@link applyWorkspaceStyle}, which writes the preference. This is the
 * floor under that.
 */
function publishProductLook(): void {
  const declared = activeProduct()?.look;
  if (declared === undefined) {
    setDefaultEditorAppearance(null);
    return;
  }
  const bundle = workspaceStyles().find((entry) => entry.id === declared);
  if (!bundle) return;
  setDefaultEditorAppearance({
    palette: bundle.paletteId,
    material: bundle.materialId,
    icons: bundle.iconSetId,
  });
}

subscribeActiveProduct(publishProductLook);
publishProductLook();

/** Apply the three axes of the named bundle. Unknown ids are a silent no-op —
 *  callers (menu/command palette) only ever offer ids from {@link workspaceStyles}. */
export function applyWorkspaceStyle(id: string): void {
  const bundle = workspaceStyles().find((entry) => entry.id === id);
  if (!bundle) return;
  setEditorPalettePreference(bundle.paletteId);
  setEditorMaterialPreference(bundle.materialId);
  setEditorIconSetPreference(bundle.iconSetId);
}

/** Each axis on which the chrome's current value differs from the bundle `id`'s, as
 *  `axis: wearing <value>, bundle <value>` — what a caller told "custom mix" needs to act on. */
export function workspaceStyleDifferences(id: string): string[] {
  const bundle = workspaceStyles().find((entry) => entry.id === id);
  if (!bundle) return [`no style bundle "${id}"`];
  const rows: Array<[string, string, string]> = [
    ['palette', editorPaletteSnapshot(), bundle.paletteId],
    ['material', editorMaterialSnapshot(), bundle.materialId],
    ['icons', editorIconSetSnapshot(), bundle.iconSetId],
  ];
  return rows
    .filter(([, wearing, wanted]) => wearing !== wanted)
    .map(([axis, wearing, wanted]) => `${axis}: wearing ${wearing}, bundle ${wanted}`);
}

/** The bundle id whose palette, material and icon set all match the
 *  current axis values, or `null` if the current combination isn't any
 *  registered bundle (a "custom" mix — always derived, never a separate
 *  stored state). */
export function activeWorkspaceStyleId(): string | null {
  const paletteId = editorPaletteSnapshot();
  const materialId = editorMaterialSnapshot();
  const bundle = workspaceStyles().find(
    (entry) =>
      entry.paletteId === paletteId &&
      entry.materialId === materialId &&
      entry.iconSetId === editorIconSetSnapshot()
  );
  return bundle?.id ?? null;
}
