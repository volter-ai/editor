/**
 * Inspector section-contribution registry (C2) — the PERMANENT, sanctioned
 * adapter-module seam for contributing rich React sections to the ONE
 * inspector shell. A matched registration becomes a custom-bodied
 * `InspectionSection` in the composed subject (`inspection/compose.ts`), which
 * both inspector presentations then project. Mirrors `hierarchy-menu-registry.ts`'s
 * `register(match, …)` / `get(ctx)` / `__resetForTest` pattern one-for-one —
 * same "test the pure logic headlessly" convention (no jsdom in this repo's
 * default `vitest.config.ts` `environment: 'node'`).
 *
 * A contribution CLAIMS the section it provides, by id. Claiming a built-in
 * id (`transform`, `properties`, `stories`) replaces that built-in for a
 * matched selection — a rich typed section stands in for the thin generic
 * grid, and the shell never double-renders the same affordance. Replacement
 * is positive space: the contribution says what it IS, never what it hides.
 * The composer (`inspection/compose.ts`) is the one place that resolves it.
 *
 * The generic property grid (`PropertyDescriptor.group` →
 * `inspector-property-grouping.ts`'s `groupProperties()` →
 * `ingest-group-<id>` sub-sections) is one such claimable block: it and its
 * groups are `PROPERTIES_SECTION_ID`'s channel (see that constant), so a
 * contribution claiming `properties` presents the node's groups too.
 *
 * Engine stays React-free (D6): this module, every contribution, and every
 * `Section` component live in the editor package only.
 */

import type { IconDefinition } from '@fortawesome/free-solid-svg-icons';
import type { AuthoringAdapter, EditorNode } from '@volter/editor-project/adapter';
import type { ComponentType } from 'react';
import type { InspectionSection } from '@volter/editor-sdk/kit/inspection-model';

export interface InspectorSectionProps {
  readonly adapter: AuthoringAdapter;
  /** Selected node id; `null` in the no-selection (environment) state. */
  readonly nodeId: string | null;
}

/**
 * The composition a contribution is being matched INSIDE — the one fact
 * `(node, adapter)` cannot carry.
 *
 * With nothing selected, `node` is `null` on every surface alike: an open
 * Asset Lab document's empty state and the play surface's Game subject hand a
 * matcher the identical two arguments, so a contribution matching `node ===
 * null` matched both and leaked its sections into whichever empty state
 * happened to be showing. `nullSubjectId` names the empty-state subject
 * actually being composed (`inspection/null-subject.ts`), so a contribution
 * scopes itself POSITIVELY to the subject it belongs to. `null` whenever a
 * node IS selected — there is no empty-state subject in that composition.
 */
export interface InspectorSectionMatchContext {
  readonly nullSubjectId: string | null;
}

/** The context handed to a match that asks for none — a selected-node
 *  composition, and the honest default for a caller outside the shell. */
const NO_NULL_SUBJECT: InspectorSectionMatchContext = { nullSubjectId: null };

interface InspectorContributionBase {
  /** `node` is `null` when nothing is selected (environment state); `context`
   *  says WHICH empty state that is. */
  readonly match: (
    node: EditorNode | null,
    adapter: AuthoringAdapter,
    context: InspectorSectionMatchContext,
  ) => boolean;
  /**
   * WHO SHIPPED THIS — the package (or project folder) whose module registered
   * it (`tool-loader.ts`'s `LoadedToolContributionBase.owner`). It is what
   * makes a document's OWNED Properties rail answerable: with
   * `inspectorRail = 'owned'` the composer keeps the sections whose owner is
   * the active document's own package and stands every other one down
   * (`inspection/compose.ts`). Absent on a first-party registration made by
   * the host itself, which is exactly the set an owned rail excludes.
   */
  readonly owner?: string;
}

/**
 * A SECTION'S GLYPH, static or resolved from the subject. Blender's Object
 * Data tab is the case that needs the second shape: `buttons_context_compute`
 * (`space_buttons/buttons_context.cc:795-810`) sets the tab's icon from
 * `RNA_struct_ui_icon(ptr->type)`, so a mesh's mark and an armature's differ.
 * `inspection/compose.ts` resolves it once, at composition.
 */
export type InspectorSectionIcon =
  | IconDefinition
  | ((node: EditorNode | null, adapter: AuthoringAdapter) => IconDefinition);

/**
 * An adapter-side PRODUCER of subject data: it answers "what identified
 * sections does this node have?" with a list, computed from the node itself.
 *
 * This is the shape an adapter with a rich, node-dependent inspector uses —
 * the react/DOM adapter's Layout / Style / Position / Spacing / component-prop
 * blocks are its descriptor GROUPS, so their identities (and how many there
 * are) can only come from the node. Before it existed, that adapter
 * contributed ONE section titled "React" whose body privately rendered all of
 * them: one opaque tab on the card, one opaque block in the column, and
 * nothing the model could name (owner, 2026-08-06 — "every section its own
 * identified tab, no lumps").
 *
 * A produced section is an ordinary {@link InspectionSection}: it claims its
 * id exactly like a static contribution does, so a produced `properties` or
 * `group:<id>` section REPLACES the generic built-in of the same id.
 */
export interface InspectorSectionsProducer extends InspectorContributionBase {
  readonly sections: (
    node: EditorNode | null,
    adapter: AuthoringAdapter,
  ) => readonly InspectionSection[];
  /** Section ids this contribution claims even when it produces no section
   *  for them — e.g. an adapter that renders the descriptor channel itself
   *  and must stand the generic grid down even for a node with no loose
   *  fields. */
  readonly claims?: readonly string[];
}

export interface InspectorSectionRegistration extends InspectorContributionBase {
  /**
   * The `InspectionSection` identity this contribution PROVIDES. A built-in
   * id (`inspection/model.ts`'s `TRANSFORM_SECTION_ID`,
   * `PROPERTIES_SECTION_ID`, `STORIES_SECTION_ID`) claims — and so replaces —
   * that block; any other id is a section of its own. Ids are a contract: the
   * compact card persists the active tab by id.
   */
  readonly id: string;
  /** Section title — the stacked header, and the compact card's tab tooltip. */
  readonly title: string;
  /** Section icon — the compact card's tab glyph, or a resolver of one
   *  ({@link InspectorSectionIcon}). */
  readonly icon: InspectorSectionIcon;
  /** The rail GROUP this section belongs to, where the Properties
   *  presentation draws separators between groups — Blender's
   *  `BCONTEXT_SEPARATOR` (`space_buttons.cc:201-255`). See
   *  `InspectionSection.railGroup`. */
  readonly railGroup?: string | undefined;
  /** This is the tab the Properties rail OPENS ON before a person has chosen
   *  one for the subject. See `InspectionSection.railDefault`. */
  readonly railDefault?: boolean | undefined;
  /** Display order on `InspectionSection.order`'s scale
   *  (`CONTRIBUTED_SECTION_ORDER` unless this section belongs elsewhere). */
  readonly order: number;
  /** The section's body: an opaque React block the model does not model. */
  readonly Section: ComponentType<InspectorSectionProps>;
}

/** One registration: a single identified section, or a producer of them. */
export type InspectorSectionContribution = InspectorSectionRegistration | InspectorSectionsProducer;

/** Whether this registration produces its sections from the node. */
export function isSectionsProducer(
  contribution: InspectorSectionContribution,
): contribution is InspectorSectionsProducer {
  return 'sections' in contribution;
}

const registrations: InspectorSectionContribution[] = [];

// --- Change notification (W3) --------------- First-party registrations all
// happen at import time (main.tsx side effects), before React ever renders —
// nothing needed to observe them. W3's project inspector TOOLS register
// asynchronously (folder scan) and re-register on HMR, while a selection may
// already be showing — so the one inspector shell subscribes here
// (`useSyncExternalStore`-shaped, mirroring `tool-loader.ts`'s registry
// store) and re-renders on any (un)registration.
let _version = 0;
const _listeners = new Set<() => void>();

function notifyRegistryChanged(): void {
  _version++;
  for (const fn of _listeners) fn();
}

/** Subscribe to (un)registrations. Returns an unsubscribe function. */
export function subscribeInspectorSectionRegistry(fn: () => void): () => void {
  _listeners.add(fn);
  return () => {
    _listeners.delete(fn);
  };
}

/** Monotonic change counter — the `getSnapshot` for `useSyncExternalStore`. */
export function inspectorSectionRegistryVersion(): number {
  return _version;
}

/**
 * Register a section contribution. `match` decides whether this contribution
 * applies to a given selection (or the no-selection state); `Section` renders
 * when it does. Returns an unregister function.
 */
export function registerInspectorSections(reg: InspectorSectionContribution): () => void {
  registrations.push(reg);
  notifyRegistryChanged();
  return () => {
    const idx = registrations.indexOf(reg);
    if (idx >= 0) {
      registrations.splice(idx, 1);
      notifyRegistryChanged();
    }
  };
}

/** Every contribution whose `match` applies to `node`/`adapter`, in registration
 *  order. `context` names the empty-state subject being composed; omitting it
 *  means there is none (a selected-node composition). */
export function matchedInspectorSections(
  node: EditorNode | null,
  adapter: AuthoringAdapter,
  context: InspectorSectionMatchContext = NO_NULL_SUBJECT,
): InspectorSectionContribution[] {
  return registrations.filter((r) => r.match(node, adapter, context));
}

/** Test-only reset (mirrors `__resetHierarchyMenuRegistryForTest`). */
export function __resetInspectorSectionRegistryForTest(): void {
  registrations.length = 0;
  notifyRegistryChanged();
}
