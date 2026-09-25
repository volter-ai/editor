/**
 * WHICH ROOTS THE ACTIVE AUTHORING SURFACE PRESENTS LIVE — the host's own
 * answer to "what is mounted, and through which adapter".
 *
 * It lived in `coverage/root-coverage.ts` because the per-root coverage report
 * was its first reader, and it stayed there long after a second one appeared.
 * It is not a grade: the vitals' `presented three roots` invariant ("a scene
 * has one root", `coverage/ontology-invariants.ts`) asks it, the Hierarchy and
 * the gizmo work over exactly these subjects, and a host with no game skew
 * loaded still has every one of them. So it is the authoring seam's, beside
 * `active-adapter.ts` whose override it reads — and the coverage report that
 * grades these subjects can leave the host without taking the question with
 * it.
 */

import type { AuthoringAdapter } from '@volter/editor-project/adapter';
import type { AdapterSurface } from '@volter/editor-project/adapter/adapter-surface';
import { liveSurface } from '@volter/editor-sdk/kit/live-session-registry';
import { projectAdapterFacet } from '../project-adapter';
import {
  activeWorkspaceDocument,
  activeWorkspaceDocumentSelection,
} from '@volter/editor-sdk/kit/workspace-document-registry';
import { getAuthoringOverride } from '@volter/editor-sdk/kit/authoring/active-adapter';
import { CompositeAuthoringAdapter } from '@volter/editor-sdk/kit/authoring/composite-authoring-adapter';

/** One mounted root, as this module needs to see it. Structural on purpose: the
 *  composite hands these over, and a test can build one by hand. */
export interface MountedRootSubject {
  readonly worldId: string;
  readonly surface: AdapterSurface | null;
  readonly adapter: AuthoringAdapter;
}

const SURFACE_KINDS: readonly string[] = ['three', 'canvas', 'dom'];

/**
 * A root that DECLARES it has no live editing surface here — the disclosure
 * adapter (`AuthoringProvenance.source === 'boundary'`) a manifest-declared
 * world wears while its real mount is still assembling, or after that mount was
 * suspended or failed.
 *
 * It is NOT a coverage subject. Grading a disclosure against the provider
 * contract prints "this root exposes no <provider> provider" fourteen times
 * about a surface that does not exist yet — a snapshot that is false the moment
 * it is taken and, because the console sync forwards warnings to the server's
 * unresolved ledger, then stands there forever beside the real post-mount
 * report.
 *
 * MEASURED on a canvas ingest: opening the project installs the edit-mode
 * composite with a Boundary child for the ingest root
 * (`authoring/edit-mode-authoring.ts`), and the mount then spends SECONDS
 * awaiting the Game document, the capture window — a budget of VISIBLE time,
 * 8s by default, which PARKS while the tab is hidden
 * (`ingest/capture-wait-report.ts`) — and the stage settle, before
 * `setActiveAuthoring` swaps the live adapter in
 * (`ingest/mount-canvas-ingest-root.ts`). The vitals sampler runs every 5s
 * (`coverage/session-vitals.ts`), so an ordinary reload lands inside that
 * window and files "16 of 30 seams are MISSING" against a session that reports
 * zero editor gaps seconds later.
 *
 * The stand-down is principled rather than timed: no debounce, no delay, no
 * game id. Provenance is the adapter's OWN statement of what its rows project
 * (rule zero — the shell reads the field, it never infers truth from adapter
 * identity), and "declared world with no live editing surface here" is the
 * adapter saying the mount has not attached. Coverage over an unattached mount
 * is not a measurement.
 *
 * A root that mounted and honestly publishes nothing is the OPPOSITE case and
 * stays a subject: `authoring/no-authoring-adapter.ts` declares no provenance
 * at all, because "this root has no authoring surface" is a real, standing
 * capability gap that the report exists to keep loud.
 */
function isBoundaryDisclosure(adapter: AuthoringAdapter): boolean {
  return adapter.provenance?.source === 'boundary';
}

/** The composite's `kind` string as a surface, or `null` when it is not one of
 *  the three the host hands out — in which case NOTHING is excused (see
 *  `CapabilityCoverageFacts.surface`). */
function asSurface(kind: string): AdapterSurface | null {
  return SURFACE_KINDS.includes(kind) ? (kind as AdapterSurface) : null;
}

/**
 * Every root the active authoring surface presents LIVE, or `[]` when nothing is
 * mounted.
 *
 * A composite lists its children; a bare adapter IS the one root. `role:
 * 'surface'` children are skipped: they are adapter-owned content INSIDE a
 * root (a nested board, a scene-UI seam), not roots the manifest declared, and
 * grading them against the full contract would invent gaps for things that were
 * never meant to be roots. {@link isBoundaryDisclosure} children are skipped for
 * the sibling reason: they are worlds the editor has DISCLOSED, not mounted.
 */
export function mountedRootSubjects(): readonly MountedRootSubject[] {
  // An isolation document is a real Edit mount owned by one declared region,
  // even though it deliberately does not replace the composition-wide active
  // adapter. Its workspace binding is the same adapter Hierarchy, Inspector,
  // and writes use; its descriptor carries the owning root. Measure that pair
  // first so coverage describes the surface the author is actually editing.
  const documentSelection = activeWorkspaceDocumentSelection();
  const documentRootId = activeWorkspaceDocument()?.descriptor.provenance?.rootId;
  const documentRegion = documentRootId
    ? projectAdapterFacet()?.regions.find((region) => region.id === documentRootId)
    : undefined;
  const documentSubject =
    documentSelection?.adapter && documentRootId && documentRegion
      ? {
          worldId: documentRootId,
          surface: documentRegion.surface,
          adapter: documentSelection.adapter,
        }
      : null;
  const active = getAuthoringOverride();
  if (!active) return documentSubject ? [documentSubject] : [];
  if (active instanceof CompositeAuthoringAdapter) {
    const subjects = active
      .childAdapters()
      .filter((child) => child.role === 'world' && !isBoundaryDisclosure(child.adapter))
      .map((child) => ({
        worldId: child.worldId,
        surface: asSurface(child.kind),
        adapter: child.adapter,
      }));
    if (!documentSubject) return subjects;
    return [documentSubject, ...subjects.filter((subject) => subject.worldId !== documentRootId)];
  }
  if (isBoundaryDisclosure(active)) return documentSubject ? [documentSubject] : [];
  // A bare (non-composite) active adapter still HAS a surface — a live ingest
  // session states its render substrate outright, and `IngestKind` and
  // `AdapterSurface` are the same three words by construction. Leaving this
  // `null` reported the canvas N-A trio (assetSubject/text/colorSample) as
  // gaps on every bare canvas mount, while the surface-aware ingest door
  // called the same three rows `na` — two doors disagreeing about one mount.
  // No live ingest ⇒ `null` stays, and nothing is excused (the deliberate
  // cheap-direction-to-be-wrong).
  const activeSubject = {
    worldId: 'root',
    surface: liveSurface(),
    adapter: active,
  };
  return documentSubject ? [documentSubject, activeSubject] : [activeSubject];
}
