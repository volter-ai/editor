/**
 * ONE resolver for "which authoring adapter do the shared panels drive?" —
 * the Hierarchy and the Inspector must never disagree, and before this module
 * they each open-coded the same expression.
 *
 * ## The defect this exists for (audit A1/A3, 2026-08-01) — and its MEASURED cause
 *
 * Symptom: every pixi ingest (the in-tree canvas fixtures, and
 * the synthetic `ingest-pixi` manifest fixtures) mounted, captured and drew,
 * `getAuthoringOverride()` held a healthy `PixiAuthoringAdapter` with
 * `{transform, inspectorFields, persist}` all true — and the Hierarchy still
 * rendered "No authoring adapter" while the Inspector took its
 * nothing-to-show branch. The three route (the `games-fps` fixture) bound fine in the same session
 * shape.
 *
 * The audit's hypothesis was adapter RESOLUTION: that the active workspace
 * document's adapter shadowed the ingest override at `Inspector.tsx`'s
 * `documentSelection?.adapter ?? getActiveAuthoring(store)`. Reproduced live on
 * a single-`ingest-pixi`-root project and measured: `activeWorkspaceDocument
 * Selection()` is `null`, the only open document is `workspace:game`, and the
 * override is already correct at the moment the panels are showing the wrong
 * thing. Resolution was never wrong. **It was a stale render**: the override
 * slot is module state with no change notification, and the panels only
 * re-rendered because ingest entry ALSO moves workspace focus, which in
 * a Three-rooted project activates a different center document and the
 * workspace registry's `notifyChanged()` re-rendered them incidentally. With no
 * Three root there is one center document, that activation is a no-op, and the
 * incidental notification never happens.
 *
 * The fix is therefore in `active-adapter.ts` (the slot notifies) plus the
 * subscription the panels take out beside this resolver. This module exists so
 * the two panels share ONE expression and one subscription set instead of two
 * copies that can drift apart again.
 *
 * ## Why the resolution ORDER is unchanged
 *
 * An earlier revision of this fix also made an ingest override outrank a
 * document-published adapter — the audit's hypothesis, kept "just in case". It
 * is deliberately NOT here: it was never observed (measured null document
 * selection in the reproduction above), and reaching `isIngestActive` from a
 * module both shared panels import drags `ingest/mount-ingest-root.ts`'s whole transitive
 * graph — the pixi stack and the engine renderer setup — into the
 * Hierarchy's module graph, which broke six unit suites outright on a
 * `URL.createObjectURL` that does not exist in the node test environment. A
 * behavior change nobody could demonstrate is not worth a dependency edge that
 * heavy. If document shadowing is ever actually observed, it should be fixed
 * where the document's provider is registered (`world-documents.tsx`), which
 * is the layer that knows a foreign session is live.
 */

import type { AdapterSurface, AuthoringAdapter } from '@volter/editor-project/adapter';
import type { ShellDocumentState } from '../shell-document-state';
import {
  activeWorkspaceDocument,
  activeWorkspaceDocumentSelection,
  type WorkspaceDocumentSelection,
} from '@volter/editor-sdk/kit/workspace-document-registry';
import { getActiveAuthoring } from './active-adapter';
import { CompositeAuthoringAdapter } from './composite-authoring-adapter';

export interface PanelAuthoringBinding {
  /** The adapter the Hierarchy/Inspector must drive. */
  readonly adapter: AuthoringAdapter;
  /** Render substrate owned by the active authored document. `null` for
   * composition/reference documents that do not focus one root surface. */
  readonly surface: AdapterSurface | null;
  /** The active document's selection context, when it publishes one. */
  readonly documentSelection: WorkspaceDocumentSelection | null;
}

/**
 * An authored root document projects only the root it is showing. The Game
 * document intentionally falls through to the full composite: composition is
 * its subject, while a Scene/world document's subject is one root.
 *
 * `world` documents carry their manifest root id as provenance. The pinned
 * Three Scene document predates per-root document ids, so its focused child is
 * the one live Three adapter that honestly reports transform authoring.
 */
function adapterSurface(kind: string): AdapterSurface | null {
  return kind === 'three' || kind === 'canvas' || kind === 'dom' ? kind : null;
}

function rootDocumentBinding(
  active: AuthoringAdapter,
): { adapter: AuthoringAdapter; surface: AdapterSurface } | null {
  if (!(active instanceof CompositeAuthoringAdapter)) return null;
  const document = activeWorkspaceDocument()?.descriptor;
  if (!document) return null;

  const children = active.childAdapters();
  if (document.kind === 'world') {
    const rootId = document.provenance?.rootId;
    const child = rootId ? children.find((candidate) => candidate.worldId === rootId) : undefined;
    const surface = child ? adapterSurface(child.kind) : null;
    return child && surface ? { adapter: child.adapter, surface } : null;
  }
  if (document.kind === 'scene') {
    const child = children.find(
      (candidate) => candidate.kind === 'three' && candidate.adapter.capabilities.transform,
    );
    if (!child) return null;
    return {
      adapter: active.projectedDocumentAdapter(child.worldId) ?? child.adapter,
      surface: 'three',
    };
  }
  return null;
}

export function resolvePanelAuthoring(store: ShellDocumentState): PanelAuthoringBinding {
  const documentSelection = activeWorkspaceDocumentSelection();
  const active = getActiveAuthoring(store);
  const rootBinding = rootDocumentBinding(active);
  const documentKind = activeWorkspaceDocument()?.descriptor.kind;
  return {
    adapter: documentSelection?.adapter ?? rootBinding?.adapter ?? active,
    surface: documentKind === 'story' ? 'dom' : (rootBinding?.surface ?? null),
    documentSelection,
  };
}
