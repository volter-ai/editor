/**
 * The DISPLAY resolution — "is there an inspector right now, and which
 * projection is showing it?" — derived from the composed subject itself.
 *
 * ## The defect this exists for (measured live, 2026-08-06)
 *
 * With the UI document active and nothing selected, the inspector rendered
 * the dom surface's own no-selection subject INSIDE the floating compact
 * card, and `dock-panel:workspace:inspector` did not exist — while the dom
 * surface's affinity is `column`. Two components had each open-coded the
 * same "resolve the active surface, then resolve its presentation"
 * expression over their own hand-rolled subscription sets: `components/Inspector.tsx` re-rendered when
 * the active adapter notified, the workspace host did not, so the
 * dock kept gating on the surface it had resolved before the document swap.
 * "Both call the same function" is discipline, not structure, and it
 * desynchronized within hours.
 *
 * ## The shape that makes disagreement unrepresentable
 *
 * There is ONE resolution — this type — and it is computed in ONE place
 * (`inspection/active-subject.ts`, subscribed through
 * `inspection/use-active-inspection.ts`). The presentation is read OFF THE
 * COMPOSED SUBJECT (`InspectionSubject.presentation.preferred`, stamped by
 * the composer from the surface it composed for), never re-derived from a
 * surface the caller resolved for itself, and the dock's physical gating
 * is nothing but that one value projected onto two booleans. A consumer
 * cannot choose a projection the subject did not carry,
 * because there is no second expression to choose it with.
 *
 * Pure: no React, no store, no subscription — `resolveInspectionDisplay` is a
 * function of (subject, surface, override), which is what makes the invariant
 * testable headlessly (`packages/editor/test/inspection-display.test.ts`).
 */

import {
  type InspectorPresentationOverride,
  resolveInspectorPresentation,
} from '../inspector-presentation';
import type {
  WorkspaceDocumentKind,
  WorkspaceDocumentSelection,
} from '@volter/editor-sdk/kit/workspace-document-registry';
import {
  type InspectionPresentation,
  type InspectionSubject,
  type InspectionSurfaceKind,
  inspectionAffinityFor,
} from '@volter/editor-sdk/kit/inspection-model';

/** The two document kinds a project TOOL opens as: the generic runner
 *  (`project-tool`) and a capability's own React surface (`tool-contribution`).
 *  Both own their whole viewport — a tool document IS its own UI. */
const PROJECT_TOOL_DOCUMENT_KINDS: readonly WorkspaceDocumentKind[] = [
  'project-tool',
  'tool-contribution',
];

/**
 * Would the inspector be describing a document OTHER than the one on screen?
 *
 * Only a project-tool document can reach this state: `authoring/panel-authoring.ts`
 * has no branch for one, so it falls through to the scene's composite adapter
 * and the inspector composes the SCENE's lingering selection — which the
 * compact card then renders on top of the tool's own surface (owner-reported,
 * 2026-08-14; measured with the Data sheet active and `world:world` still
 * selected in the 3D scene).
 *
 * The test is POSITIVE, like `inspection/active-surface.ts`'s Asset Lab test:
 * a tool document that publishes its OWN selection context (the humanoid
 * builder's Object3D preview does) is showing its own inspector and keeps it.
 * One that publishes none is not the subject's document, and gets nothing —
 * the same answer the doctrine already gives an empty selection.
 */
export function inspectorBelongsToAnotherDocument(input: {
  readonly activeDocumentKind: WorkspaceDocumentKind | null;
  readonly documentSelection: WorkspaceDocumentSelection | null;
}): boolean {
  const { activeDocumentKind, documentSelection } = input;
  if (activeDocumentKind === null) return false;
  if (!PROJECT_TOOL_DOCUMENT_KINDS.includes(activeDocumentKind)) return false;
  return documentSelection === null;
}

export interface InspectionDisplay {
  /** The composed subject. Always present — a surface with nothing to inspect
   *  composes an empty subject rather than a null one — so read
   *  {@link available} for "is there an inspector at all". */
  readonly subject: InspectionSubject;
  /** The surface the subject was composed for. */
  readonly surface: InspectionSurfaceKind;
  /** The resolved projection for this subject: the subject's own affinity,
   *  overridden by whatever the user asked for on this surface. */
  readonly presentation: InspectionPresentation;
  /** Whether an inspector SUBJECT exists at all — a selection, or a surface
   *  whose adapter answered `describeSubject(null)`, or a contribution that
   *  matched the empty selection. `false` empties the inspector's CONTENT
   *  (`components/Inspector.tsx` renders nothing) and withholds the floating
   *  card; it does not remove the dock column — see {@link column}. */
  readonly available: boolean;
  /** The viewport-local compact box is the projection showing. Floats over
   *  the viewport, so its coming and going moves no other pixel — it stays
   *  gated on {@link available}. */
  readonly card: boolean;
  /**
   * The `workspace:inspector` dock panel exists — true for BOTH docked
   * layouts (`column` and `properties`). WORKSPACE GEOMETRY, not subject
   * state — deliberately NOT gated on {@link available}.
   *
   * It used to be (`available && presentation === 'column'`), which made
   * every select/deselect mount/unmount the dock panel and RESIZE THE
   * VIEWPORT — measured live on the hosted editor: 587px wide with nothing
   * selected, 309px with a selection, the camera reframing with it. Aim
   * taken in one layout landed in the other, so clicking a second object
   * "did nothing" or grabbed the arena behind it, and objects near the edge
   * (the citadel's west tower) left the frame entirely on select. Four
   * independent testers reported it as an unselectable-instances bug
   * (runhuman passes 100/109/110/111) and every identity-layer suspect —
   * occurrence ids, stamps, locks, resolve — measured correct; the world was
   * simply MOVING between their clicks. One tester said "the shapes are
   * changing on their own", which was exactly true.
   *
   * The content doctrine is unchanged: with nothing selected the inspector
   * SHOWS nothing. The panel it shows nothing IN no longer comes and goes
   * with the selection.
   */
  readonly column: boolean;
}

/**
 * Resolve the display for a composed subject. The two booleans are mutually
 * exclusive derivations of the ONE `presentation` value, so "the dock says
 * card while the inspector renders a column" is not a state this type can
 * hold.
 *
 * `subject === null` means the active surface has nothing to inspect; the
 * caller still gets a display (with `available: false` and every projection
 * off) so both consumers read the same object shape either way.
 */
export function resolveInspectionDisplay(input: {
  readonly subject: InspectionSubject;
  readonly surface: InspectionSurfaceKind;
  readonly available: boolean;
  readonly override: InspectorPresentationOverride | null;
  /** The active workspace's docked-layout choice (`workspace-regions.ts`),
   *  beneath the user's override and above the affinity. */
  readonly workspaceDefault?: 'column' | 'properties' | 'card' | null;
}): InspectionDisplay {
  const { subject, surface, available, override, workspaceDefault = null } = input;
  // The subject carries the affinity the composer stamped on it. A surface
  // whose subject somehow did not compose still resolves the same way its
  // subject would have, so the two can never name different affinities.
  const affinity = subject.presentation.preferred ?? inspectionAffinityFor(surface);
  // ONE resolver, shared with every other caller of the preference
  // (`inspector-presentation.ts`).
  const presentation: InspectionPresentation = resolveInspectorPresentation(
    affinity,
    override,
    workspaceDefault,
  );
  return {
    subject,
    surface,
    presentation,
    available,
    card: available && presentation === 'card',
    // Geometry, not subject state — see the field's doc for the measured
    // defect behind dropping the `available &&` guard here.
    column: presentation !== 'card',
  };
}
