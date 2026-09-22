/**
 * Inspector PRESENTATION — how the inspector box is physically laid out on the
 * surface you are looking at. Three projections (`inspection/model.ts`'s
 * `InspectionPresentation`):
 *
 *  - `'column'` (the DEFAULT): the subject's full inspector as a slim vertical
 *    column — identity row, a section-icon strip that signposts what the
 *    subject has and jumps to a section, then every section stacked and
 *    collapsible. With agents doing most editing the inspector's daily job is
 *    looking, and an always-present slim column reads details with no
 *    discovery-dependent expand gesture (owner, 2026-08-19).
 *  - `'properties'`: the docked column with its sections TABBED — a vertical
 *    icon rail, one section body at a time. Blender's and Substance's
 *    properties editors are this shape; a workspace asks for it as data
 *    (`workspace-presets.ts`, `EditorWorkspaceRegions.inspector`).
 *  - `'card'`: the space-tight fallback the user opts into — a MINI card
 *    (preview, name, the same icon strip, the labeled open-for-edit) that
 *    collapses at the floor to a single-line PILL. Clicking any collapsed form
 *    restores the column.
 *
 * The resolution is per SURFACE, not global (W3): the affinity is the same
 * narrow column everywhere, but the PREFERENCE is keyed by surface, so
 * collapsing the scene's inspector to a card leaves the asset document's
 * alone. `resolved = user override for THIS surface ?? the active workspace's
 * choice ?? the subject's affinity`, where the affinity is
 * `inspectionAffinityFor(kind)`. The expand/collapse affordances write the
 * override for the surface they are on and no other.
 *
 * The layout host consumes the resolution physically (column present vs
 * overlay card vs neither); `components/Inspector.tsx` consumes it visually
 * (narrow column vs mini card). Overrides are persisted per-user in
 * localStorage (same convenience-not-truth rationale as
 * `workspace-state-persistence.ts`'s storage decision), global across projects
 * like the theme preference — how you like your inspector is not a property of
 * any one game.
 */

import type { IconDefinition } from '@fortawesome/free-solid-svg-icons';
import type {
  InspectionPresentation,
  InspectionSection,
  InspectionSurfaceKind,
} from './inspection/model';

/** What a user can ASK for — both projections, on any surface. */
export type InspectorPresentationOverride = InspectionPresentation;

const STORAGE_KEY = 'vgai-inspector-presentation-v2';

type OverrideMap = Partial<Record<InspectionSurfaceKind, InspectorPresentationOverride>>;

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isOverride(value: unknown): value is InspectorPresentationOverride {
  return value === 'card' || value === 'column' || value === 'properties';
}

function readPersisted(): OverrideMap {
  const raw = storage()?.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const map: OverrideMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isOverride(value)) map[key as InspectionSurfaceKind] = value;
    }
    return map;
  } catch {
    return {};
  }
}

let _overrides: OverrideMap | null = null;
let _version = 0;
const _listeners = new Set<() => void>();

function overrides(): OverrideMap {
  if (_overrides === null) _overrides = readPersisted();
  return _overrides;
}

/** The user's stored preference for one surface, or `null` when they have
 *  never expressed one there. */
export function inspectorPresentationOverride(
  surface: InspectionSurfaceKind,
): InspectorPresentationOverride | null {
  return overrides()[surface] ?? null;
}

export function setInspectorPresentationOverride(
  surface: InspectionSurfaceKind,
  value: InspectorPresentationOverride,
): void {
  if (inspectorPresentationOverride(surface) === value) return;
  _overrides = { ...overrides(), [surface]: value };
  _version++;
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(_overrides));
  } catch {
    // Persistence is convenience; the in-memory preference is already applied.
  }
  for (const listener of _listeners) listener();
}

export function subscribeInspectorPresentation(listener: () => void): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

/** Monotonic change counter — the `getSnapshot` for `useSyncExternalStore`. */
export function inspectorPresentationVersion(): number {
  return _version;
}

// ---- Resolution (pure — headlessly testable) -----------------------------

/**
 * The resolver, whole: a surface's affinity, under the active WORKSPACE's
 * choice (`workspace-regions.ts`; only the docked layouts — a workspace never
 * collapses the inspector to a card), under whatever the user asked for ON
 * THAT SURFACE. Every surface is overridable — an asset document expands to
 * the column and collapses back exactly as a scene does, because an asset
 * document is the same paradigm scoped to a subtree.
 */
export function resolveInspectorPresentation(
  affinity: InspectionPresentation,
  override: InspectorPresentationOverride | null,
  workspaceDefault: 'column' | 'properties' | 'card' | null = null,
): InspectionPresentation {
  return override ?? workspaceDefault ?? affinity;
}

export function __resetInspectorPresentationForTest(): void {
  _overrides = null;
  _version = 0;
  _listeners.clear();
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

// ---- Section-icon-strip derivation (pure — headlessly testable) -----------

/** One glyph on the section-icon strip — one SECTION of the composed
 *  {@link InspectionSubject}, and nothing else: the live preview, Transform,
 *  each property GROUP (Physics, Material, a component block…) and each
 *  matched contribution individually, never one lumped "everything else"
 *  entry. The strip signposts what the subject HAS and jumps to a section; it
 *  is not a tab that opens one section into a floating panel. */
export interface CompactInspectorTab {
  /** The section's own id, which is the strip's jump target
   *  (`'preview'`, `'transform'`, `'properties'`, `` `group:<groupId>` ``,
   *  `'stories'`, a contribution's id). */
  readonly id: string;
  /** Tooltip / accessible name for the icon button. */
  readonly title: string;
  /** The section's own glyph. Required by the model, so every entry has one. */
  readonly icon: IconDefinition;
  /** The rail GROUP this section named (`InspectionSection.railGroup`), if
   *  any. The Properties rail draws a separator wherever it changes, the way
   *  `ED_buttons_tabs_list` inserts `BCONTEXT_SEPARATOR`
   *  (`space_buttons/space_buttons.cc:201-255`). */
  readonly railGroup?: string | undefined;
  /** This section is the tab the rail opens on when nothing has been chosen
   *  for the subject yet (`InspectionSection.railDefault`). */
  readonly railDefault?: boolean | undefined;
}

/**
 * The section-icon strip for a subject: its sections, in their composed order,
 * ONE FOR ONE. This is the whole function, and that is the point — "the row of
 * buttons is what the sections are" (owner, 2026-08-07) is true by construction
 * here, not by two renderers agreeing. A subject with no sections has no strip
 * and shows its headline.
 *
 * The strip knows nothing about what any section CONTAINS; identity, title,
 * icon and order all come off the model (`inspection/compose.ts`). There is
 * no synthesized entry: the live preview is an ordinary section like the rest.
 */
export function compactInspectorTabs(subject: {
  readonly sections: readonly InspectionSection[];
}): CompactInspectorTab[] {
  return subject.sections.map((section) => ({
    id: section.id,
    title: section.title,
    icon: section.icon,
    ...(section.railGroup === undefined ? {} : { railGroup: section.railGroup }),
    ...(section.railDefault === undefined ? {} : { railDefault: section.railDefault }),
  }));
}
