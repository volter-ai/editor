/**
 * THE HOST DOOR, installed: what `@volter/editor-sdk/host` hands a package's
 * contribution is this editor's own session state — the inspected system
 * adapters (`authoring/active-systems.ts`), the shared availability tick and
 * the dock's utility reveal. The SDK owns the door's SHAPE; this module is
 * the one place the editor fills it (ARCHITECTURE-CORE §The workbench,
 * "direction": the host imports no package; a package imports the SDK).
 */
import { type EditorHostOutput, registerEditorHost } from '@volter/editor-sdk/host';
import type * as THREE from 'three';
import { onProjectChange } from './active-project';
import { stageTransport, subscribeStageTransports } from './animation/stage-transport';
import {
  activeAudioVersion,
  getInspectedAudio,
  getInspectedNetworking,
  getInspectedSystems,
  subscribeActiveAudio,
  subscribeActiveNavigation,
  subscribeActiveNetworking,
} from './authoring/active-systems';
import { activeDocumentSourcePath, activeSaveDestination } from './authoring/shell-document-ops';
import { availabilityTickVersion, subscribeAvailabilityTick } from '@volter/editor-sdk/kit/availability-tick';
import { setBlenderCallMeter } from './blender-tab-metrics';
import { beginPageWork } from './play-boot-phase';
import { onCommandDispatched } from './command-dispatch';
import { openToolDocument } from './components/tool-documents';
import { onSessionSample } from './coverage/session-vitals';
import {
  documentContextFor,
  notifyDocumentContextChanged,
  waitForDocumentContext,
} from './document-context-registry';
import { openRegisteredDocumentAsync } from './document-open-registry';
import { editorConsole } from './editor-console';
import { resolvedProjectDocumentTable } from './project-adapter';
import { notify } from './editor-notifications';
import { registerEditorStateFacet } from '@volter/editor-sdk/kit/editor-state-facets';
import { setFilesProvider } from './files/file-provider';
import { projectFiles } from './files/project-files';
import {
  onHistoryElement,
  invalidateHistoryResources,
  onHistoryInvalidated,
  notifyHistoryDelegateChanged,
  emitHistoryElement,
  recordedHistoryElements,
  setHistoryDelegate,
  setHistoryDocumentResolver,
  subscribeHistoryDelegate,
} from './history/history-delegate';
import {
  invokeKeyAction,
  keyActionsVersion,
  registeredKeyActions,
  subscribeKeyActions,
} from './key-actions';
import {
  activeEditorKeymap,
  editorKeymaps,
  keymapTable,
  subscribeEditorKeymap,
} from './keymap-presets';
import {
  acquireLiveDocument,
  liveDocumentContainer,
  liveDocumentOpen,
  registerLiveDocumentContent,
  releaseLiveDocument,
  releaseLiveDocumentContainer,
  setLiveDocumentContainer,
} from './live-document';
import {
  anyLiveSessionMounted,
  anyLiveSessionPlaying,
  dispatchLiveCommand,
  liveAuthoringRefusal,
  liveCoverage,
  liveFrameCanvas,
  liveRestartRequired,
  liveRunWindow,
  liveScenes,
  liveSessionsVersion,
  liveSurface,
  notifyLiveSessionsChanged,
  registerLiveSession,
  restartLiveSession,
  snapshotLiveFrame,
  subscribeLiveSessions,
} from '@volter/editor-sdk/kit/live-session-registry';
import {
  beginLiveTransition,
  endPlayTransition,
  notifyPlayTransitionGameReady,
  onPlayTransitionSettled,
  playTransitionPhase,
} from './live-transition';
import {
  projectLocalSection,
  projectLocalStateReady,
  writeProjectLocalSection,
} from './project-local-state';
import { getCurrentProject } from './project-manager';
import { onProjectReady } from './project-ready';
import { projectMounts } from './project-shape';
import { onSessionEndedChange } from './session-tombstone';
import { onBeforeSessionClose } from './session-close';
import { setSettingsProvider, subscribeSettingsProvider } from './settings/settings-provider';
import { getSetting, inspectSetting, setSetting, subscribeSettings } from './settings-store';
import { onShellStoreChange, shellStoreForHost } from './shell-store-door';
import { focusedStageContext } from './stage-context';
import {
  onViewportFrame,
  onViewportStages,
  presentViewportRoots,
  setViewportHelper,
  viewportRig,
  viewportStages,
} from './viewport-door';
import { GAME_DOCUMENT_ID } from '@volter/editor-sdk/kit/workspace-document-ids';
import {
  activeWorkspaceDocument,
  activeWorkspaceDocumentId,
  subscribeWorkspaceDocuments,
  workspaceDocumentRegistryVersion,
} from '@volter/editor-sdk/kit/workspace-document-registry';
import { showWorkspaceUtility } from './workspace-host-commands';

/**
 * THE ACTIVE DOCUMENT'S OWN INTERACTION MODE, if it has one.
 *
 * A mode is a fact about a DOCUMENT — Blender's object/edit/pose/sculpt belongs
 * to the thing being edited, not to the shell — so the document answers it, on
 * the context it already publishes rather than through a registration of its
 * own. Structural, never `instanceof`: a contributed document's context is an
 * adapter-native object the host must not name (`documents.context` hands it
 * back as `unknown`), so the shape it needs is checked here.
 */
function activeStageMode(): string | null {
  const documentId = activeWorkspaceDocumentId();
  if (documentId === null) return null;
  const context = documentContextFor(documentId);
  if (typeof context !== 'object' || context === null) return null;
  const read = (context as { stageMode?: unknown }).stageMode;
  if (typeof read !== 'function') return null;
  const mode: unknown = read.call(context);
  return typeof mode === 'string' ? mode : null;
}
const EMPTY_OBJECTS: ReadonlyMap<string, THREE.Object3D> = new Map();

let outputProvider: EditorHostOutput | null = null;

/** Installed by the Code-OSS frame; packages never implement a second Output panel. */
export function setOutputProvider(provider: EditorHostOutput | null): void {
  outputProvider = provider;
}

function nativeOutput(): EditorHostOutput {
  if (!outputProvider) throw new Error('The workbench Output service is not connected.');
  return outputProvider;
}

export function installEditorHostDoor(): void {
  // WHICH DOCUMENT an edit was made in, for the frame's per-document undo
  // ordering (`history/history-delegate.ts`). Installed here because this is
  // the module that already reads the workspace registry; the history service
  // must not.
  setHistoryDocumentResolver(activeWorkspaceDocumentId);

  // The door is installed at boot, before any store exists
  // (`shell-store-door.ts`); the session members read the store lazily —
  // before one, the session is `stopped` and subscriptions fire on arrival.
  registerEditorHost({
    output: {
      write: (...args) => nativeOutput().write(...args),
      show: (id) => nativeOutput().show(id),
    },
    console: {
      log: (message, source) => editorConsole.log(message, source),
      warn: (message, source) => editorConsole.warn(message, source),
      error: (message, source) => editorConsole.error(message, source),
    },
    live: {
      register: registerLiveSession,
      mounted: anyLiveSessionMounted,
      playing: anyLiveSessionPlaying,
      runWindow: liveRunWindow,
      restartRequired: liveRestartRequired,
      restart: restartLiveSession,
      subscribe: subscribeLiveSessions,
      version: liveSessionsVersion,
      notifyChanged: notifyLiveSessionsChanged,
      snapshotFrame: snapshotLiveFrame,
      frameCanvas: liveFrameCanvas,
      authoringRefusal: liveAuthoringRefusal,
      dispatch: dispatchLiveCommand,
      scenes: liveScenes,
      surface: liveSurface,
      coverage: liveCoverage,
    },
    viewport: {
      rig: viewportRig,
      presentRoots: presentViewportRoots,
      onFrame: onViewportFrame,
      setHelper: setViewportHelper,
      stages: viewportStages,
      onStages: onViewportStages,
      transition: {
        begin: beginLiveTransition,
        ready: notifyPlayTransitionGameReady,
        end: endPlayTransition,
        onSettled: onPlayTransitionSettled,
        phase: playTransitionPhase,
      },
    },
    hierarchy: {
      object: (id) => shellStoreForHost()?.objectMap.get(id) ?? null,
      objects: () => shellStoreForHost()?.objectMap ?? EMPTY_OBJECTS,
      subscribe: (listener) => {
        const stopArrival = onShellStoreChange(listener);
        const stop = shellStoreForHost()?.subscribe(listener);
        return () => {
          stopArrival();
          stop?.();
        };
      },
      version: () => {
        const store = shellStoreForHost();
        return store?.getShellSnapshot?.() ?? store?.getSnapshot() ?? 0;
      },
    },
    session: {
      beginWork: beginPageWork,
      reportFacet: registerEditorStateFacet,
      onSample: onSessionSample,
      onCommandDispatched,
      playState: () => shellStoreForHost()?.playState ?? 'stopped',
      playEditRegime: () => shellStoreForHost()?.playEditRegime ?? null,
      subscribe: (listener) => {
        const stopArrival = onShellStoreChange(listener);
        const stop = shellStoreForHost()?.subscribe(listener);
        return () => {
          stopArrival();
          stop?.();
        };
      },
      version: () => {
        const store = shellStoreForHost();
        return store?.getShellSnapshot?.() ?? store?.getSnapshot() ?? 0;
      },
      // A project session is open exactly when the shell that edits it has
      // registered its store (`shell-store-door.ts`, `EditorContext.tsx`).
      open: () => shellStoreForHost() !== null,
      // The tombstone publishes the state; a lane releasing a resource only
      // needs the EDGE, and a `null` here is the `server-gone` recovery
      // (`session-tombstone.ts`), which is not an end.
      onEnded: (fn) =>
        onSessionEndedChange((state) => {
          if (state !== null) fn();
        }),
      onBeforeClose: onBeforeSessionClose,
      reportWorkerCallMeter: setBlenderCallMeter,
    },
    project: {
      documentTable: resolvedProjectDocumentTable,
      mounts: projectMounts,
      // The ONE reading of the pinned engine version — `ProjectHeader.tsx`'s
      // `v{engineVersion}` and a package's status item are the same number
      // because they are the same field.
      engineVersion: () => getCurrentProject()?.config.engine.version ?? null,
      subscribe: onProjectChange,
      onReady: onProjectReady,
    },
    notify: (notification) => notify(notification),
    systems: {
      inspected: getInspectedSystems,
      subscribe: subscribeActiveNavigation,
      inspectedNetworking: getInspectedNetworking,
      subscribeNetworking: subscribeActiveNetworking,
      // `SystemAdapters['audio']` is optional; the door answers null, never undefined.
      inspectedAudio: () => getInspectedAudio() ?? null,
      subscribeAudio: subscribeActiveAudio,
      audioVersion: activeAudioVersion,
    },
    availability: { subscribe: subscribeAvailabilityTick, version: availabilityTickVersion },
    workspace: {
      showUtility: showWorkspaceUtility,
      // A null store: the opened document simply does not switch the
      // viewport tab, which is the host's own `onActivate` nicety.
      openContributedDocument: (id) => openToolDocument(null, id),
      // Without a store (no project session) the document still opens; the
      // tab hand-off is the store's nicety. The kind's own `settle` is what
      // the removed `openStory` did by hand before it addressed anything
      // (re-reading the story registry): the async form tries, settles, and
      // tries once more.
      open: async (address) =>
        (await openRegisteredDocumentAsync(
          address.kind,
          shellStoreForHost() ?? { setActiveViewportTab: () => {} },
          address,
        )) !== null,
      liveDocument: {
        id: GAME_DOCUMENT_ID,
        register: registerLiveDocumentContent,
        acquire: acquireLiveDocument,
        release: releaseLiveDocument,
        open: liveDocumentOpen,
        container: liveDocumentContainer,
        setContainer: setLiveDocumentContainer,
        releaseContainer: releaseLiveDocumentContainer,
      },
    },
    documents: {
      activeId: activeWorkspaceDocumentId,
      active: () => {
        const document = activeWorkspaceDocument();
        return document
          ? { id: document.descriptor.id, kind: document.descriptor.kind, title: document.title }
          : null;
      },
      subscribe: subscribeWorkspaceDocuments,
      version: workspaceDocumentRegistryVersion,
      context: documentContextFor,
      waitForContext: waitForDocumentContext,
      contextChanged: notifyDocumentContextChanged,
    },
    // THE STAGE TRANSPORT. A lookup plus a subscription, exactly like
    // `documents` above: the registry IS the identity map, so the door adds
    // nothing but the narrowing to the published handle.
    transport: {
      for: (documentId) => stageTransport(documentId),
      subscribe: subscribeStageTransports,
    },
    projectLocalState: {
      ready: projectLocalStateReady,
      read: projectLocalSection,
      write: writeProjectLocalSection,
      projectRootPath: () => getCurrentProject()?.rootPath ?? null,
    },
    // UNDO (ARCHITECTURE-CORE §The core is Code-OSS: "there is one Cmd+Z").
    // Every recorded element is pushed into VS Code's `IUndoRedoService`,
    // keyed by the document's own file; `history-service.ts` stays the
    // RECORDER and stops deciding which entry is next.
    history: {
      record: emitHistoryElement,
      setDelegate: setHistoryDelegate,
      onElement: onHistoryElement,
      invalidate: invalidateHistoryResources,
      onInvalidated: onHistoryInvalidated,
      changed: notifyHistoryDelegateChanged,
      elements: recordedHistoryElements,
      focusedResource: () => {
        const document = activeWorkspaceDocument();
        if (!document) return null;
        // A document that IS a file says so in its own provenance
        // (`WorkspaceDocumentProvenance.sourcePath`, project-relative) - scene
        // and world documents, and every component/isolation view, which is
        // precisely why scoping undo here fixes "Component-view Ctrl+Z acts on
        // the MAIN scene's history": a component view's resource is its own
        // file, and always was.
        // A contributed document is covered by the same field: a Model
        // document opens through `kind-documents.tsx`, which carries its
        // finder entry's own `source.path` (the project-relative `.blend`)
        // into provenance - so nobody has to re-parse a `model:<path>` id to
        // learn what file a document is.
        const provenance = document.descriptor.provenance?.sourcePath;
        if (provenance) return provenance;
        // THE SHELL'S OWN SCENE TAB HAS NO PROVENANCE, measured in the frame
        // on the game template: its descriptor is built once, before any
        // adapter is active, so `CenterDocuments`' `sourcePath ?? savePath`
        // was null then and the frozen descriptor still says so. The live
        // answer is the ACTIVE ADAPTER's own source path - `src/world.tsx`
        // for a three root - which is where a save would land and therefore
        // the honest first guess at what that stage is editing.
        const store = shellStoreForHost();
        return store ? (activeDocumentSourcePath(store) ?? activeSaveDestination(store)) : null;
      },
      undo: () => shellStoreForHost()?.projectHistory?.undo() ?? Promise.resolve(false),
      redo: () => shellStoreForHost()?.projectHistory?.redo() ?? Promise.resolve(false),
      canUndo: () => shellStoreForHost()?.projectHistory?.getSnapshot().canUndo ?? false,
      canRedo: () => shellStoreForHost()?.projectHistory?.getSnapshot().canRedo ?? false,
      undoLabel: () => shellStoreForHost()?.projectHistory?.getSnapshot().undoLabel ?? null,
      redoLabel: () => shellStoreForHost()?.projectHistory?.getSnapshot().redoLabel ?? null,
      subscribe: (listener) => {
        const stopOwner = subscribeHistoryDelegate(listener);
        const stopArrival = onShellStoreChange(listener);
        const stopHistory = shellStoreForHost()?.projectHistory?.subscribe(listener);
        const stopDocuments = subscribeWorkspaceDocuments(listener);
        return () => {
          stopOwner();
          stopArrival();
          stopHistory?.();
          stopDocuments();
        };
      },
    },
    // THE PROJECT'S FILES, for the Code-OSS frame (ARCHITECTURE-CORE §The
    // core is Code-OSS, "the storage backends → file system providers"). The
    // door's paths are PROJECT-RELATIVE, the same spelling `history` hands
    // over, so the frame resolves both against one workspace folder — which is
    // what lets a vgai write land on the URI Monaco already holds and stop
    // being an EXTERNAL change (U4's redo open, closed in U5).
    files: {
      setProvider: setFilesProvider,
      read: (path) => projectFiles.read(path),
      readBytes: (path) => projectFiles.readBytes(path),
      write: (path, data) => projectFiles.write(path, data),
      exists: (path) => projectFiles.exists(path),
      list: (dir) => projectFiles.list(dir),
      watch: (listener) => projectFiles.watch(listener),
    },
    // THE SETTINGS, for the Code-OSS frame (ARCHITECTURE-CORE §The core is
    // Code-OSS: "the settings layers and settings UI → the configuration
    // service"). Keys are the flat `vgai.*` names the settings schema derives
    // (`@volter/editor-project/settings/keys`), the same spelling `.vscode/settings.json`
    // and the Settings editor use — never a second one the frame translates.
    // `inspect` is the member that carries the ADAPTER layer, which is the
    // service's own MEMORY target under the frame and this project's `vgai
    // .adapter.ts` standalone.
    settings: {
      setProvider: setSettingsProvider,
      get: getSetting,
      set: setSetting,
      inspect: inspectSetting,
      subscribe: (listener) => {
        const stopOwner = subscribeSettingsProvider(listener);
        const stopSettings = subscribeSettings(listener);
        return () => {
          stopOwner();
          stopSettings();
        };
      },
    },
    // THE KEYBOARD, for the Code-OSS frame (ARCHITECTURE-CORE §The core is
    // Code-OSS rule 3). The frame reads the ACTION table and the keymap
    // TABLES — never a chord the frame spells itself — so `keymap-presets.ts`
    // stays the one place a chord is written, `vgai` and `blender` alike.
    keyboard: {
      actions: () => registeredKeyActions().map(({ id, scope }) => ({ id, scope })),
      keymaps: () =>
        editorKeymaps().map(({ id, title }) => ({ id, title, chords: keymapTable(id) })),
      activeKeymap: activeEditorKeymap,
      invoke: (id) => invokeKeyAction(id as Parameters<typeof invokeKeyAction>[0]),
      subscribe: (listener) => {
        const stopActions = subscribeKeyActions(listener);
        const stopKeymap = subscribeEditorKeymap(listener);
        const stopStore = onShellStoreChange(listener);
        const stopShell = shellStoreForHost()?.subscribe(listener);
        const stopDocuments = subscribeWorkspaceDocuments(listener);
        return () => {
          stopActions();
          stopKeymap();
          stopStore();
          stopShell?.();
          stopDocuments();
        };
      },
      version: () => keyActionsVersion() + workspaceDocumentRegistryVersion(),
      stage: () => {
        const store = shellStoreForHost();
        // No shell yet: nothing is focused and nothing is showing, which is
        // the honest answer rather than a guessed surface.
        if (!store) return { surface: null, mode: null };
        // `mode` is the document's own interaction mode (Blender's
        // object/edit/pose/sculpt), and THE DOCUMENT REPORTS IT — on the
        // context it already publishes, rather than through a door of its own.
        // A document whose context answers `stageMode()` owns the key; every
        // other document answers `null`, which is what this was for all of
        // them until `@volter/editor-blender`'s Model document started reporting
        // `bpy.context.mode` off the tree door (WORK.md §Blender in the tab is
        // Blender, "Inspection parity", I3, item 4).
        return { surface: focusedStageContext(store).surface, mode: activeStageMode() };
      },
    },
  });
}
