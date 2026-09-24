/**
 * `Inspector` — the connected inspector: it RESOLVES what is being inspected
 * and hands it to a projection. It renders no content of its own.
 *
 * Two halves, and the split is the whole point:
 *  - the MODEL side is `inspection/use-active-inspection.ts` → ONE
 *    {@link InspectionDisplay} (`inspection/display.ts`): the composed
 *    subject, its surface, whether an inspector exists at all, and which
 *    projection shows it. the workspace host gates the dock panel
 *    and the floating card on the SAME hook, so "the dock floats a card while
 *    the inspector renders a column" is not a state the app can reach;
 *  - the VIEW side is `components/InspectionProjection.tsx`, which reads
 *    identity/verbs/sections off the subject and knows nothing else.
 *
 * `inspection/compose.ts` is the one assembler: the active
 * {@link AuthoringAdapter}'s providers (`hierarchy` / `selection` /
 * `transforms` / `inspector`) plus whatever `inspector-section-registry.ts`
 * registrations match become ONE `InspectionSubject`. Which built-ins a
 * contribution replaces (by CLAIMING their section ids) is resolved there and
 * is never visible here.
 */

import { threeStateOf } from '../editor-shell-store';
import { faUpRightAndDownLeftFromCenter } from '@fortawesome/free-solid-svg-icons';
import { EditorIcon, IconButton, Panel, themeVars } from '@volter/editor-sdk/widgets';
import type { AuthoringAdapter } from '@volter/editor-project/adapter';
import { useEffect, useReducer, useSyncExternalStore } from 'react';
import { assetSelectionVersion, subscribeAssetSelection } from '../asset-selection';
import { getActiveCamera } from '../authoring/active-systems';
import { resolvePanelAuthoring } from '../authoring/panel-authoring';
import { useAvailabilitySelector } from '@volter/editor-sdk/kit/availability-tick';
import { useEditorStore } from '../editor-runtime';
import type { EditorShellStore } from '../editor-shell-store';
import { setActiveScope } from '@volter/editor-sdk/kit/hotkeys';
import { composeInspectionForBinding } from '../inspection/active-subject';
import type { InspectionPresentation, InspectionSurfaceKind } from '@volter/editor-sdk/kit/inspection-model';
import { useActiveInspection } from '../inspection/use-active-inspection';
import { setInspectorPresentationOverride } from '../inspector-presentation';
import {
  inspectorSectionRegistryVersion,
  subscribeInspectorSectionRegistry,
} from '@volter/editor-sdk/kit/inspector-section-registry';
import { liveAuthoringRefusal } from '@volter/editor-sdk/kit/live-session-registry';
import { projectMounts } from '../project-shape';
import type { WorkspaceDocumentSelection } from '@volter/editor-sdk/kit/workspace-document-registry';
import { InspectionProjectionView } from './InspectionProjection';

export interface AuthoringInspectorSurfaceProps {
  readonly store: EditorShellStore;
  readonly adapter: AuthoringAdapter;
  readonly documentSelection: WorkspaceDocumentSelection | null;
  /** The RESOLVED presentation for this surface (`inspection/display.ts`):
   *  `'card'` tabs the sections behind icon buttons in the bottom-right card,
   *  `'column'` stacks them in the classic column, `'properties'` tabs them
   *  behind a vertical rail in that same column. Omitted (bounded
   *  design-system hosts) behaves as `'column'` without the mode-switch
   *  affordance — presentation is the live shell's concern. */
  readonly presentation?: InspectionPresentation;
  /** Which surface this is — the key the mode-switch affordances write their
   *  override under, so a preference expressed here changes no other
   *  surface. Omitted alongside `presentation`. */
  readonly surface?: InspectionSurfaceKind;
}

/**
 * The honest copy for an adapter with NO inspector surface at all — a
 * `{ module }` root that publishes none, or an ingested native-React world
 * (no-authoring by design, D-N8). It is deliberately not a projection of a
 * subject — there is no subject, because the adapter cannot describe one.
 */
function NoAuthoringInspector({
  presentation,
  surface,
}: {
  readonly presentation: InspectionPresentation | undefined;
  readonly surface?: InspectionSurfaceKind | undefined;
}) {
  const authoringRefusal = liveAuthoringRefusal();
  const noAuthoringNote = (
    <div
      data-testid="no-authoring-note"
      style={{
        padding: 12,
        color: themeVars.semantic.warning,
        fontSize: 'var(--vgai-font-md)',
        lineHeight: 1.5,
      }}
    >
      {authoringRefusal !== null ? (
        <>
          <strong>Nothing to author.</strong> {authoringRefusal}
        </>
      ) : (
        <>
          <strong>Nothing to author.</strong> This root's adapter publishes no inspector surface, so
          there is nothing here to describe or edit. The root is still hosted, sized, and disposed;
          play it in the Game tab.
        </>
      )}
    </div>
  );
  // The one affordance back to the narrow column: this card has no subject and
  // no icon strip, so without it a collapsed nothing-to-author card has no
  // route back. Shown only in the live shell (a known `surface`).
  const expandRow = surface ? (
    <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '2px 4px' }}>
      <IconButton
        size="compact"
        data-testid="inspector-expand"
        aria-label="Expand inspector to side panel"
        title="Expand inspector to side panel"
        onClick={() => setInspectorPresentationOverride(surface, 'column')}
      >
        <EditorIcon icon={faUpRightAndDownLeftFromCenter} />
      </IconButton>
    </div>
  ) : null;
  if (presentation === 'card') {
    return (
      <div
        className="vgai-mini-inspector"
        data-testid="inspector-panel"
        data-vgai-inspector-presentation="card"
        onPointerDown={() => setActiveScope('inspector')}
      >
        {expandRow}
        {noAuthoringNote}
      </div>
    );
  }
  return (
    <Panel
      name="Inspector (nothing to author)"
      hideHeader
      className="vgai-content-frost"
      data-testid="inspector-panel"
      onPointerDown={() => setActiveScope('inspector')}
    >
      {noAuthoringNote}
    </Panel>
  );
}

/**
 * Production authoring Inspector with explicit application dependencies —
 * the BOUNDED host entry point (design-system stories): it composes a subject
 * from the adapter it is handed and projects it, so a host can exercise this
 * exact surface through an adapter fixture instead of reproducing its fields
 * in a visual facsimile. The live shell does NOT come through here; it goes
 * through {@link Inspector}, which reads the one shared resolution.
 *
 * "Composes" is the SAME call either way — `composeInspectionForBinding`
 * (`inspection/active-subject.ts`). The two paths differ only in where the
 * binding comes from: handed in here, resolved from live state there.
 */
export function AuthoringInspectorSurface({
  store,
  adapter,
  documentSelection,
  presentation,
  surface,
}: AuthoringInspectorSurfaceProps) {
  useSyncExternalStore(store.subscribe, store.getSnapshot);
  // Project inspector TOOLS register asynchronously (folder scan) and
  // re-register on HMR, possibly while a matching selection is showing; the
  // §5.1 asset selection is another context registrations key on.
  useSyncExternalStore(subscribeInspectorSectionRegistry, inspectorSectionRegistryVersion);
  useSyncExternalStore(subscribeAssetSelection, assetSelectionVersion);
  const [, forceAdapterUpdate] = useReducer((value: number) => value + 1, 0);
  useEffect(() => adapter.subscribe?.(forceAdapterUpdate), [adapter]);
  if (!adapter.capabilities.inspectorFields) {
    return <NoAuthoringInspector presentation={presentation} {...(surface ? { surface } : {})} />;
  }
  const { subject } = composeInspectionForBinding({
    store,
    adapter,
    documentSelection,
    surface,
  });
  return (
    <InspectionProjectionView
      subject={subject}
      presentation={presentation ?? 'column'}
      {...(surface ? { surface } : {})}
    />
  );
}

/**
 * The LIVE inspector. Whether it shows at all, which layout it uses, and what
 * is in it are all the ONE resolution
 * (`inspection/use-active-inspection.ts`) the workspace gates on — read here,
 * never re-derived. Every surface goes through it, an open asset document
 * included: that document is the three paradigm scoped to a subtree, so the
 * same box rides over it as rides over the scene.
 */
export function Inspector() {
  const store = threeStateOf(useEditorStore());
  // A camera controller may register after Play's first React commit. Keep the
  // contribution match live without making the inspection model own runtime
  // system state; availability-tick is the existing late-capability seam used
  // by the Profiler and Frame debugger for the same reason.
  useAvailabilitySelector(() => getActiveCamera());
  const display = useActiveInspection(store);
  const { adapter } = resolvePanelAuthoring(store);
  if (!display.available) return null;
  if (!adapter.capabilities.inspectorFields) {
    // A subject the shared resolver composed WITHOUT the adapter's fields —
    // an ingest's coverage row, or the project's own asset selection (a
    // model picked in Content, whose kind's asset inspector takes it from
    // there) — renders through the ordinary projection. The nothing-to-author
    // note is the floor for a MOUNTED root whose adapter describes nothing;
    // a project that mounts nothing has no root to say that about, and with
    // nothing selected the inspector shows nothing.
    if (display.subject.identity !== null || display.subject.sections.length > 0) {
      return (
        <InspectionProjectionView
          subject={display.subject}
          presentation={display.presentation}
          surface={display.surface}
        />
      );
    }
    if (!projectMounts()) return null;
    return <NoAuthoringInspector presentation={display.presentation} surface={display.surface} />;
  }
  return (
    <InspectionProjectionView
      subject={display.subject}
      presentation={display.presentation}
      surface={display.surface}
    />
  );
}
