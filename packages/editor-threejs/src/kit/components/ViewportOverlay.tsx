import { faBorderAll, faLightbulb } from '@fortawesome/free-solid-svg-icons';
import { EditorIcon, FloatingToolbar, IconButton, Tooltip } from '@volter/editor-sdk/widgets';
import type { AuthoringAdapter } from '@volter/editor-project/adapter';
import { memo, useEffect, useId, useMemo, useReducer, useState, useSyncExternalStore } from 'react';
import { activeAuthoringVersion, subscribeActiveAuthoring } from '@volter/editor-sdk/kit/authoring/active-adapter';
import {
  object3DDocumentSession,
  object3DDocumentSessionsVersion,
  subscribeObject3DDocumentSessions,
} from '../authoring/object3d-document-session-registry';
import { resolvePanelAuthoring } from '@volter/editor-sdk/kit/authoring/panel-authoring';
import type { EditorShellStore } from '../editor-shell-store';
import { activeLightCount } from '@volter/editor-sdk/kit/light-explorer-model';
import { CORE_WORKSPACE_UTILITIES } from '@volter/editor-sdk/kit/workspace-core-utilities';
import {
  subscribeWorkspaceDocuments,
  workspaceDocumentRegistryVersion,
} from '@volter/editor-sdk/kit/workspace-document-registry';
import { showWorkspaceUtility } from '@volter/editor-sdk/kit/workspace-host-commands';
import { ViewportOverlaysMenu } from '@volter/editor-sdk/kit/components/ViewportOverlaysMenu';
import {
  setViewGridVisible,
  subscribeViewportPresentation,
  viewGridVisible,
  viewportPresentationVersion,
} from '@volter/editor-sdk/kit/viewport-presentation';
import { ViewportShadingMenu } from './ViewportShadingMenu';
import type { ViewportShadingMode } from '@volter/editor-threejs/render/viewport-shading';
import { ViewportViewMenu } from './ViewportViewMenu';
import { useViewportChrome, useViewportWords } from '@volter/editor-sdk/kit/native-selection-style';
import { createPortal } from 'react-dom';
import { stageViewName } from './stage-view-name';

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
  useSyncExternalStore(store.shell.subscribe, store.shell.getSnapshot);
  useSyncExternalStore(subscribeWorkspaceDocuments, workspaceDocumentRegistryVersion);
  useSyncExternalStore(subscribeActiveAuthoring, activeAuthoringVersion);
  useSyncExternalStore(subscribeObject3DDocumentSessions, object3DDocumentSessionsVersion);
  const { adapter } = resolvePanelAuthoring(store.shell);
  const session = object3DDocumentSession(documentId);
  useSyncExternalStore(session?.subscribe ?? NO_SESSION_SUBSCRIBE, session?.getSnapshot ?? ZERO);
  useSyncExternalStore(subscribeViewportPresentation, viewportPresentationVersion);
  const grid = viewGridVisible(documentId);
  // THE VIEW'S NAME ON THE BAR (the look's `stage.chrome.viewName` `bar`, Unreal's
  // "Perspective" pill) leads these controls and opens the view menu; wherever the name opens
  // that menu itself (`bar`, `menu`) the camera icon is not drawn a second time.
  const chrome = useViewportChrome();
  const words = useViewportWords();
  const namedView = chrome.viewName === 'bar' || chrome.viewName === 'menu';
  // ON THE LOOK'S BAR these controls sit in the bar's display slot, which the document's surface
  // draws beside the tools (`WorkspaceDocumentSurface`); they are portalled there so the row
  // flows as one. Found from this stage's own place in the page.
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);
  const findSlot = (): HTMLElement | null =>
    anchor
      ?.closest('.vgai-dock-document-content')
      ?.querySelector<HTMLElement>(':scope > .vgai-stage-bar [data-stage-bar-slot="display"]') ?? null;
  // ONE OVERLAY PER SLOT: a document hosting two stages has one bar, so the first overlay to
  // claim its slot draws there and any other keeps its own place.
  const owner = useId();
  const found = findSlot();
  const slot = found && (found.dataset['owner'] === undefined || found.dataset['owner'] === owner) ? found : null;
  // The surface's bar can commit after this render (a change of look reaches both at once), so
  // the slot is looked for again once the page has settled.
  const [, reslot] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    const now = findSlot();
    if (now && now.dataset['owner'] === undefined) now.dataset['owner'] = owner;
    const claimable = now && now.dataset['owner'] === owner ? now : null;
    if (claimable !== slot) reslot();
  });
  useEffect(
    () => () => {
      if (slot?.dataset['owner'] === owner) delete slot.dataset['owner'];
    },
    [slot, owner],
  );
  const toolbar = (
    <FloatingToolbar
      label="Viewport display"
      className="vgai-viewport-toolbar vgai-viewport-toolbar-right vgai-stage-display"
    >
      {chrome.viewName === 'bar' && session ? (
        <ViewportViewMenu
          shell={store.shell}
          documentId={documentId}
          label={stageViewName(session.viewport, session.projection(), 'long')}
        />
      ) : null}
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
      <HelpersButton store={store} word={words.helpers} />
      <ViewportShadingMenu
        mode={sessionShading(session) ?? store.shadingMode}
        // A document stage paints the mode its SESSION holds, and the store's is only what this
        // menu shows: the session's `setMode` is what `set-shading-mode` drives, and writing the
        // store alone relabelled the menu over an unchanged picture (measured under Unreal's look:
        // "Wireframe" over the shaded box).
        onChange={(mode) => (session ? session.setMode(mode) : store.setShadingMode(mode))}
        words={words.shading}
      />
      {namedView ? null : <ViewportViewMenu shell={store.shell} documentId={documentId} />}
      <LightExplorerButton adapter={adapter} store={store} />
    </FloatingToolbar>
  );
  return (
    <>
      <span ref={setAnchor} hidden />
      {slot ? createPortal(toolbar, slot) : toolbar}
    </>
  );
}

/** The shading mode a document stage is painting (the menu names one it does not offer). */
function sessionShading(
  session: ReturnType<typeof object3DDocumentSession>,
): ViewportShadingMode | 'uv' | 'vertex-colors' | null {
  return session?.presentation().mode ?? null;
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
  const lightCount = useMemo(() => activeLightCount(adapter), [adapter, store.shell.contentVersion]);
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

function HelpersButton({ store, word }: { store: EditorShellStore; word?: string | undefined }) {
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
    { key: 'cursor' as const, label: '3D Cursor' },
    { key: 'empties' as const, label: 'Empties' },
  ];

  return (
    <ViewportOverlaysMenu
      label="Helpers"
      {...(word !== undefined ? { word } : {})}
      master={{ enabled: store.shell.showHelpers, onToggle: () => store.shell.toggleHelpers() }}
      choices={helperTypes.map((helper) => ({
        id: helper.key,
        label: helper.label,
        enabled: store.shell.helperVisibility[helper.key],
        onToggle: () => store.shell.toggleHelperType(helper.key),
      }))}
    />
  );
}
