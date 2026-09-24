/**
 * "Which surface is the inspector looking at right now?" — the ONE answer,
 * shared by every consumer of per-surface inspection (W3):
 *
 *  - `inspection/active-subject.ts` stamps it onto the composed subject
 *    (whose affinity it decides) and matches the no-selection providers
 *    against it — the ONE compose call site every projection reads through;
 *  - `inspector-presentation.ts` keys the user's override by it, because the
 *    right default differs per surface and so does the preference.
 *
 * It is a FUNCTION over the same stores the panels already subscribe to, not
 * a store of its own — the surface is derived, never held.
 */

import { getActiveAssetEditorContext } from '../asset-editor-context';
import { CompositeAuthoringAdapter } from '../authoring/composite-authoring-adapter';
import { resolvePanelAuthoring } from '../authoring/panel-authoring';
import type { ShellStore } from '../shell-store';
import { liveSurface } from '@volter/editor-sdk/kit/live-session-registry';
import { activeWorkspaceDocumentId } from '@volter/editor-sdk/kit/workspace-document-registry';
import type { InspectionSurfaceKind } from '@volter/editor-sdk/kit/inspection-model';

function surfaceKindOf(kind: string): InspectionSurfaceKind | null {
  return kind === 'three' || kind === 'canvas' || kind === 'dom' ? kind : null;
}

/**
 * The surface of the composite child that owns the CURRENT selection.
 *
 * A multi-root composite has no single surface, so the answer has to come from
 * what is selected — and until this existed there was no such question asked:
 * a two-child composite fell straight through to the `isReactAuthoringAdapter`
 * test at the bottom, which a *composite* never satisfies (it merely CONTAINS
 * react children), so every selection in one reported `three`. Measured on an
 * ingested game whose composite is `{canvas, dom-ui}`: selecting a HUD element
 * stamped `surface: "three"`, so the no-selection providers matched against
 * the wrong surface and `inspector-presentation.ts` keyed the user's override
 * to a surface they were not looking at.
 *
 * Both id shapes a selection can hold are resolved, because both are things a
 * user clicks in the hierarchy: an ENTITY id (routed by the composite's own
 * public `ownerOf`) and the synthetic GROUP-node row for a child root (which
 * `ownerOf` refuses by construction — a group node has no live object — so it
 * is matched against `groupNodeId` instead).
 *
 * `null` when nothing is selected, or when the selection's owner has a kind
 * this inspection vocabulary does not name — the caller falls back, rather
 * than this guessing.
 */
function selectedChildSurface(
  adapter: CompositeAuthoringAdapter,
  store: ShellStore,
): InspectionSurfaceKind | null {
  const selected = store.selectedEntityId;
  if (selected === null) return null;
  const children = adapter.childAdapters();
  const owner =
    children.find((child) => child.worldId === adapter.ownerOf(selected)) ??
    children.find((child) => adapter.groupNodeId(child.worldId) === selected);
  return owner ? surfaceKindOf(owner.kind) : null;
}

/**
 * The active inspection surface.
 *
 * The ACTIVE document being an Asset Lab document is `asset-lab`: its subject
 * belongs INSIDE the document, so nothing floats over it. Otherwise the
 * answer is the panel binding's surface; when that binding does not focus one
 * root (the Game document's composite), a single-root composite still names
 * its surface honestly, and anything else is the running lane's own
 * declaration.
 *
 * The Asset Lab test is POSITIVE — "the active document is the one that
 * published the asset-editor context" — and that is load-bearing. It used to
 * be the negative proxy "no document owns an authoring selection", which made
 * scoping the hierarchy and owning your own inspection mutually exclusive: an
 * Object3D asset document does BOTH (it publishes a document selection so the
 * hierarchy scopes to it), so the proxy answered `three` and the compact card
 * floated over a document that is itself a preview, showing the main scene's
 * environment (measured live, 2026-08-06). Asking the real question also
 * rules out a stale context from a document that is no longer active, which
 * the proxy could not.
 */
export function activeInspectionSurface(store: ShellStore): InspectionSurfaceKind {
  const assetDocument = getActiveAssetEditorContext();
  if (assetDocument !== null && assetDocument.documentId === activeWorkspaceDocumentId()) {
    return 'asset-lab';
  }
  const { adapter, surface } = resolvePanelAuthoring(store);
  if (surface) return surface;
  if (adapter instanceof CompositeAuthoringAdapter) {
    const children = adapter.childAdapters();
    const only = children.length === 1 ? surfaceKindOf(children[0]?.kind ?? '') : null;
    if (only) return only;
    const selected = selectedChildSurface(adapter, store);
    if (selected) return selected;
  }
  /**
   * A REACT WORLD'S SURFACE IS ALSO A DECLARATION, and the rung that used to
   * read `adapter instanceof ReactRootAuthoringAdapter` is gone for the same
   * reason its `DomAuthoringAdapter` sibling below is (measured 2026-09-18,
   * phase 1 of the open-source launch): that one `instanceof` was the host's
   * core inspection reaching the React/DOM design-time surface by CLASS, and
   * it carried the 3,848-line React root adapter — with the surgical JSX
   * writer, `ts-ast`, the five R3F bindings and the DOM projection behind it
   * — into every editor boot, including a `models` build that authors no DOM
   * at all.
   *
   * It had no reachable case either. Every construction site of that adapter
   * hands it to a COMPOSITE, which the rungs above already answer for:
   * `design-time-layers.ts` replaces the world's boundary child with it,
   * Play's react branch pushes it as a composite child (`play-mode.ts`), an
   * ingested game's detected DOM surface nests it under the primary adapter
   * (`ingest-dom-surface-authoring.ts`), and an ingest SIBLING's react layer
   * is promoted to a composite child by `mount-ingest-root.ts`. No
   * `setActiveAuthoring` call anywhere passes a bare one — the ingest routes
   * that DO set a bare adapter set a `DomAuthoringAdapter`, and that lane
   * declares `surface: activeIngestKind` on its live session, which is the
   * line below.
   */
  /**
   * AN INGESTED GAME'S SURFACE IS ITS LANE'S DECLARATION, not a class this
   * module recognises. The last rung used to be `adapter instanceof
   * DomAuthoringAdapter`, and that is how the host's inspection reached the
   * INGEST lane's own adapter — pulling `dom-authoring-adapter.ts` (and the
   * ephemeral-persistence provider and the JSON history resource only it
   * reaches) into every shell closure, in a build that may not even ship
   * `@vgai/game` (measured 2026-09-18, phase 1 of the open-source launch:
   * three files).
   *
   * The lane already answers this question through a door the host owns:
   * `LiveSession.surface` — "the native surface the running content draws on,
   * when the lane knows it (an ingested game's declared surface)" — and the
   * ingest lane registers `surface: activeIngestKind` beside its mount. Zero
   * inference (ARCHITECTURE-CORE §The editor protocol): the declaration is
   * read, never the implementation class.
   *
   * `'three'` stays the floor for a bare adapter with nothing running, which
   * is exactly what the `instanceof` chain answered for the same case.
   */
  return surfaceKindOf(liveSurface() ?? '') ?? 'three';
}
