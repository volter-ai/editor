import { faBorderAll, faLightbulb } from '@fortawesome/free-solid-svg-icons';
import { EditorIcon, FloatingToolbar, IconButton, Tooltip } from '@volter/editor-sdk/widgets';
import type { AuthoringAdapter } from '@volter/editor-project/adapter';
import { memo, useEffect, useMemo, useReducer, useSyncExternalStore } from 'react';
import { activeAuthoringVersion, subscribeActiveAuthoring } from '../authoring/active-adapter';
import {
  object3DDocumentSession,
  object3DDocumentSessionsVersion,
  subscribeObject3DDocumentSessions,
} from '../authoring/object3d-document-session-registry';
import { resolvePanelAuthoring } from '../authoring/panel-authoring';
import type { EditorShellStore } from '../editor-shell-store';
import { activeLightCount } from '../light-explorer-model';
import { CORE_WORKSPACE_UTILITIES } from '@volter/editor-sdk/kit/workspace-core-utilities';
import {
  subscribeWorkspaceDocuments,
  workspaceDocumentRegistryVersion,
} from '@volter/editor-sdk/kit/workspace-document-registry';
import { showWorkspaceUtility } from '../workspace-host-commands';
import { ViewportOverlaysMenu } from './ViewportOverlaysMenu';
import {
  setViewGridVisible,
  subscribeViewportPresentation,
  viewGridVisible,
  viewportPresentationVersion,
} from '@volter/editor-sdk/kit/viewport-presentation';
import { ViewportShadingMenu } from './ViewportShadingMenu';
import { ViewportViewMenu } from './ViewportViewMenu';

/**
 * Three-specific viewport display controls, mounted over ONE STAGE and driving
 * THAT stage (ARCHITECTURE-CORE §One stage unit 4): `store` is the stage's own
 * store, so a prefab's grid button toggles the prefab's grid rather than the
 * world's. Performance moved to the global header telemetry so Scene and Play
 * expose one source-following instrument.
 *
 * GRID is the stage's VIEW's switch (`overlays.grid.visible` in
 * `kit/viewport-presentation`, keyed by `documentId`): the one flag this
 * button, the document's header, the `toggle.grid` action, `set-grid` and
 * `vgai status`'s `showGrid` all read and write.
 */
export function ViewportOverlay({
  store,
  documentId,
}: {
  readonly store: EditorShellStore;
  readonly documentId: string;
}) {
  useSyncExternalStore(store.subscribe, store.getSnapshot);
  useSyncExternalStore(subscribeWorkspaceDocuments, workspaceDocumentRegistryVersion);
  useSyncExternalStore(subscribeActiveAuthoring, activeAuthoringVersion);
  useSyncExternalStore(subscribeObject3DDocumentSessions, object3DDocumentSessionsVersion);
  const { adapter } = resolvePanelAuthoring(store);
  const session = object3DDocumentSession(documentId);
  useSyncExternalStore(session?.subscribe ?? NO_SESSION_SUBSCRIBE, session?.getSnapshot ?? ZERO);
  useSyncExternalStore(subscribeViewportPresentation, viewportPresentationVersion);
  const grid = viewGridVisible(documentId);
  return (
    <FloatingToolbar
      label="Viewport display"
      className="vgai-viewport-toolbar vgai-viewport-toolbar-right"
    >
      <Tooltip text={`Grid: ${grid ? 'On' : 'Off'}`}>
        <IconButton
          aria-label="Toggle grid"
          aria-pressed={grid}
          size="comfortable"
          onClick={() => setViewGridVisible(documentId, !grid)}
        >
          <EditorIcon icon={faBorderAll} size="md" />
        </IconButton>
      </Tooltip>
      <HelpersButton store={store} />
      <ViewportShadingMenu
        mode={store.shadingMode}
        onChange={(mode) => store.setShadingMode(mode)}
      />
      <ViewportViewMenu store={store} />
      <LightExplorerButton adapter={adapter} store={store} />
    </FloatingToolbar>
  );
}

const NO_SESSION_SUBSCRIBE = () => () => {};
const ZERO = () => 0;

/** Keep the hierarchy walk off ordinary viewport-store renders. The adapter
 * notifies when its projected tree changes; a stable adapter prop lets React
 * skip this child for unrelated grid/shading/selection updates. */
const LightExplorerButton = memo(function LightExplorerButton({
  adapter,
  store,
}: {
  readonly adapter: AuthoringAdapter;
  readonly store: EditorShellStore;
}) {
  const [, refresh] = useReducer((value: number) => value + 1, 0);
  useEffect(() => adapter.subscribe?.(refresh), [adapter]);
  // `adapter.subscribe` is `store.subscribe` on every shipping adapter, so the
  // `memo` above cannot stop this button re-rendering on a bare selection
  // click — and `activeLightCount` walks the WHOLE tree. Key the walk on
  // `contentVersion`, which a selection-only notify leaves alone.
  const lightCount = useMemo(() => activeLightCount(adapter), [adapter, store.contentVersion]);
  if (lightCount === 0) return null;
  return (
    <Tooltip text={`Open Light Explorer · ${lightCount} ${lightCount === 1 ? 'light' : 'lights'}`}>
      <IconButton
        aria-label="Open Light Explorer"
        size="comfortable"
        onClick={() => showWorkspaceUtility(CORE_WORKSPACE_UTILITIES.lightExplorer.id)}
      >
        <EditorIcon icon={faLightbulb} size="md" />
      </IconButton>
    </Tooltip>
  );
});

function HelpersButton({ store }: { store: EditorShellStore }) {
  const helperTypes = [
    { key: 'bounds' as const, label: 'Bounds' },
    { key: 'lights' as const, label: 'Lights' },
    { key: 'cameras' as const, label: 'Cameras' },
    { key: 'colliders' as const, label: 'Colliders' },
    { key: 'joints' as const, label: 'Joints' },
    { key: 'particles' as const, label: 'Particle Emitters' },
    { key: 'lod' as const, label: 'LOD' },
    { key: 'audio' as const, label: 'Audio' },
    { key: 'splines' as const, label: 'Splines' },
    { key: 'navmesh' as const, label: 'NavMesh' },
    { key: 'constraints' as const, label: 'Constraints' },
    { key: 'reflectionProbes' as const, label: 'Reflection Probes' },
    { key: 'triggerVolumes' as const, label: 'Trigger Volumes' },
    { key: 'skeletons' as const, label: 'Skeletons' },
    { key: 'weights' as const, label: 'Weights' },
  ];

  return (
    <ViewportOverlaysMenu
      label="Helpers"
      master={{ enabled: store.showHelpers, onToggle: () => store.toggleHelpers() }}
      choices={helperTypes.map((helper) => ({
        id: helper.key,
        label: helper.label,
        enabled: store.helperVisibility[helper.key],
        onToggle: () => store.toggleHelperType(helper.key),
      }))}
    />
  );
}
