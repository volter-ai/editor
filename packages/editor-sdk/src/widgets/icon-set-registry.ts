/**
 * THE ICON SET AXIS — the fourth appearance axis beside palette, material and
 * composition. Every glyph the editor draws renders through `EditorIcon`
 * (`primitives/EditorIcon.tsx`, the one consumer of Font Awesome),
 * so a style bundle can carry a whole icon set as DATA keyed by the Font
 * Awesome icon name each site names (`plus`, `xmark`, `trash`, …): a glyph
 * present in the active set paints instead of the editor's own; a glyph
 * absent falls through, so a set may be partial while it is drawn.
 *
 * This module is REGISTRY AND ACTIVE STATE ONLY — no settings, because the
 * icon primitive sits in every core closure and must stay a leaf. The stored
 * preference (`appearance.icons`) is read and written by `theme-preference.ts`,
 * which applies it here, exactly as it owns the palette and material choices.
 * Registered by `workspace-style.ts` with the bundle that carries it.
 */
import type { IconCategoryTone, IconSetContribution } from '../looks';

export type { IconCategoryTone };

export interface EditorIconGlyph {
  /** Defaults to a 16-unit square. */
  readonly viewBox?: string;
  /** One `path` `d`, painted with `currentColor`. */
  readonly path: string;
  /** THE COLOUR CHANNEL — the glyph's own category (`IconCategoryTone`),
   *  painted `var(--vgai-category-<tone>, currentColor)`. With `tonedPath`
   *  it tints only that second path; alone it tints the whole glyph. An
   *  explicit `tone` prop at the site wins over both. */
  readonly tone?: IconCategoryTone;
  /** A second `path` `d` drawn OVER `path` and carrying `tone`: the operated
   *  element of an operator mark, where the cube itself stays neutral. */
  readonly tonedPath?: string;
}
export type EditorIconSet = IconSetContribution;
export interface EditorIconSetChoice {
  readonly id: string;
  readonly title: string;
}

export const DEFAULT_ICON_SET_ID = 'default';
const DEFAULT_CHOICE: EditorIconSetChoice = { id: DEFAULT_ICON_SET_ID, title: 'Editor' };

const contributedSets = new Map<string, EditorIconSet>();
let cachedChoices: readonly EditorIconSetChoice[] | null = null;
let activeId: string = DEFAULT_ICON_SET_ID;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Every set the switch surfaces offer — the editor's own, then the contributed. */
export function editorIconSets(): readonly EditorIconSetChoice[] {
  cachedChoices ??= [
    DEFAULT_CHOICE,
    ...[...contributedSets.values()].map(({ id, title }) => ({ id, title })),
  ];
  return cachedChoices;
}

export function isEditorIconSetId(value: unknown): value is string {
  return typeof value === 'string' && (value === DEFAULT_ICON_SET_ID || contributedSets.has(value));
}

/** Register the set a style bundle carries. Returns the unregister. A
 *  duplicate id throws — ids key the persisted appearance setting. */
export function registerContributedIconSet(set: EditorIconSet): () => void {
  if (isEditorIconSetId(set.id))
    throw new Error(`registerContributedIconSet: icon set "${set.id}" is already registered.`);
  contributedSets.set(set.id, set);
  cachedChoices = null;
  emit();
  return () => {
    if (contributedSets.get(set.id) !== set) return;
    contributedSets.delete(set.id);
    cachedChoices = null;
    emit();
  };
}

/** The set painting now. */
export function activeIconSetSnapshot(): string {
  return activeId;
}

/** Applied by `theme-preference.ts` from the stored choice; an unregistered
 *  id paints the editor's own until its package registers. */
export function setActiveIconSet(id: string): void {
  const next = isEditorIconSetId(id) ? id : DEFAULT_ICON_SET_ID;
  if (next === activeId) return;
  activeId = next;
  emit();
}

/** Fires when the registry or the active set changes. */
export function subscribeIconSets(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The active set's glyph for a Font Awesome icon name, or `null` to paint the editor's own. */
export function activeIconGlyph(iconName: string): EditorIconGlyph | null {
  if (activeId === DEFAULT_ICON_SET_ID) return null;
  return contributedSets.get(activeId)?.glyphs[iconName] ?? null;
}
