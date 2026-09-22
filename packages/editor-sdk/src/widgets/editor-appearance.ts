import { CLASSIC_MATERIAL, GLASS_MATERIAL } from './editor-material';
import type { EditorTheme } from './theme';

/**
 * Editor appearance is deliberately composed from independent axes:
 *
 *   palette (a theme-library document) × material
 *
 * Palette documents own chroma and typography. Materials own surface physics,
 * boundaries, neutral interaction overlays, shape, elevation, and treatment.
 * Components only receive the resolved EditorTheme token set and therefore
 * remain blind to both axes.
 */
export const EDITOR_MATERIAL_IDS = ['classic', 'glass'] as const;
/** One of the editor's own materials, or one a package's style bundle
 *  carries ({@link registerContributedMaterial}). */
export type EditorMaterialId = string;

export interface EditorMaterialChoice {
  readonly id: EditorMaterialId;
  readonly title: string;
  readonly description: string;
}

/**
 * An OPAQUE material a package's style bundle carries (`@volter/editor-sdk/looks`
 * `MaterialContribution`): Classic's physics under its own shape and
 * elevation. Glass is the editor's own and is not contributable.
 */
export interface ContributedMaterialDefinition extends EditorMaterialChoice {
  readonly shape: EditorTheme['shape'];
  readonly elevation: EditorTheme['elevation'];
  readonly density?: EditorTheme['density'];
}

/** The only fields a color-theme document may contribute to composition. */
export type EditorPalette = Pick<EditorTheme, 'id' | 'color' | 'typography'>;

export const EDITOR_MATERIALS: readonly EditorMaterialChoice[] = Object.freeze([
  {
    id: 'classic',
    title: 'Classic',
    description: 'Opaque editor surfaces with conventional bars and panels.',
  },
  {
    id: 'glass',
    title: 'Glass',
    description: 'Adaptive clear material with refraction, frost, and floating chrome.',
  },
]);

const contributedMaterials = new Map<string, ContributedMaterialDefinition>();
let cachedMaterials: readonly EditorMaterialChoice[] | null = null;
const materialListeners = new Set<() => void>();

/** Every material the switch surfaces offer — the editor's own, then the
 *  contributed in registration order. Stable between registrations. */
export function editorMaterials(): readonly EditorMaterialChoice[] {
  cachedMaterials ??= [
    ...EDITOR_MATERIALS,
    ...[...contributedMaterials.values()].map(({ id, title, description }) => ({
      id,
      title,
      description,
    })),
  ];
  return cachedMaterials;
}

export function subscribeEditorMaterials(listener: () => void): () => void {
  materialListeners.add(listener);
  return () => materialListeners.delete(listener);
}

/** Register the material a style bundle carries. Returns the unregister. A
 *  duplicate id throws — ids key the persisted appearance setting. */
export function registerContributedMaterial(definition: ContributedMaterialDefinition): () => void {
  if (isEditorMaterialId(definition.id))
    throw new Error(
      `registerContributedMaterial: material "${definition.id}" is already registered.`,
    );
  contributedMaterials.set(definition.id, definition);
  cachedMaterials = null;
  for (const listener of materialListeners) listener();
  return () => {
    if (contributedMaterials.get(definition.id) !== definition) return;
    contributedMaterials.delete(definition.id);
    cachedMaterials = null;
    for (const listener of materialListeners) listener();
  };
}

export function isEditorMaterialId(value: unknown): value is EditorMaterialId {
  return (
    typeof value === 'string' &&
    (EDITOR_MATERIAL_IDS.includes(value as (typeof EDITOR_MATERIAL_IDS)[number]) ||
      contributedMaterials.has(value))
  );
}

/** Compose one palette source with the selected material. */
export function composeEditorAppearance(
  palette: EditorPalette,
  materialId: EditorMaterialId,
  reducedTransparency = false,
): EditorTheme {
  if (materialId !== 'glass') {
    // Classic, or a contributed opaque material: Classic's physics under the
    // material's own shape and elevation.
    const material = contributedMaterials.get(materialId);
    return {
      id: material ? `${palette.id}--${material.id}` : palette.id,
      color: palette.color,
      typography: palette.typography,
      shape: material?.shape ?? CLASSIC_MATERIAL.shape,
      elevation: material?.elevation ?? CLASSIC_MATERIAL.elevation,
      ...(material?.density ? { density: material.density } : {}),
      appearance: { material: 'classic', transparency: 'standard' },
    };
  }

  const resolvedId = `${palette.id}--${reducedTransparency ? 'glass-reduced' : 'glass'}`;

  return {
    id: resolvedId,
    color: {
      // Material owns the physical surface; palette owns every semantic hue.
      surface: reducedTransparency
        ? GLASS_MATERIAL.reducedTransparency.surface
        : GLASS_MATERIAL.color.surface,
      boundary: GLASS_MATERIAL.color.boundary,
      content: palette.color.content,
      accent: palette.color.accent,
      semantic: palette.color.semantic,
      neutralOverlay: GLASS_MATERIAL.color.neutralOverlay,
      scrim: reducedTransparency
        ? GLASS_MATERIAL.reducedTransparency.scrim
        : GLASS_MATERIAL.color.scrim,
    },
    typography: palette.typography,
    shape: GLASS_MATERIAL.shape,
    elevation: GLASS_MATERIAL.elevation,
    appearance: {
      material: 'glass',
      transparency: reducedTransparency ? 'reduced' : 'standard',
    },
    ...(reducedTransparency ? {} : { treatment: GLASS_MATERIAL.treatment }),
  };
}
