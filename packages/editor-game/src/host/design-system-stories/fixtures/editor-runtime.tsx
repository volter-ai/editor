import { type ReactNode, useEffect, useLayoutEffect, useState } from 'react';
import { resetProjectThumbnailManifestCache } from '@volter/editor-core/asset-workflow/thumbnail-system';
import { type EditorRuntime, EditorRuntimeProvider, type EditorStats } from '@volter/editor-core/editor-runtime';
import { EditorShellStore, threeStateOf } from '@volter/editor-core/editor-shell-store';
import { EditorSession } from '@volter/editor-core/history/editor-session';
import { getStorageBackend, MemStorage, setStorageBackend } from '@volter/editor-core/storage/index';
import {
  activeWorkspaceUtility,
  installWorkspaceHostCommands,
  setActiveWorkspaceUtility,
  setWorkspaceUtilityTabs,
  workspaceUtilityTabs,
} from '@volter/editor-core/workspace-host-commands';
import { availableWorkspaceUtilities } from '@volter/editor-sdk/kit/workspace-utility-registry';

const ZERO_STATS: EditorStats = {
  fps: 60,
  frameTime: 16.7,
  drawCalls: 42,
  triangles: 12_480,
  cameraPosition: { x: 4, y: 3, z: 8 },
  cameraTarget: { x: 0, y: 1, z: 0 },
};

/** A story runtime's Three half, for a production component that reads the scene. */
export function storyThreeStore(runtime: EditorRuntime): EditorShellStore {
  return threeStateOf(runtime.store);
}

/** A real, bounded editor runtime for production component stories. */
export function createStoryEditorRuntime(): EditorRuntime {
  const store = new EditorShellStore();
  const session = new EditorSession('storybook-fixture');
  store.attachHistory(session.history);
  return {
    store,
    session,
    stats: ZERO_STATS,
    initPromise: Promise.resolve(),
  };
}

/**
 * Installs the smallest honest workspace controller needed by shell stories.
 * The production toolbar still talks through its normal semantic command
 * boundary; the fixture only supplies the host state that Storybook does not
 * mount. This keeps toolbar behavior testable without cloning its UI.
 */
export function installStoryWorkspaceUtilityController(): () => void {
  const previousTabs = workspaceUtilityTabs();
  const previousActive = activeWorkspaceUtility();
  let tabs = availableWorkspaceUtilities()
    .filter((utility) => utility.visibleByDefault !== false)
    .map((utility) => utility.id);

  const publishTabs = () => setWorkspaceUtilityTabs(tabs);
  const showUtility = (id: string) => {
    if (!tabs.includes(id)) {
      tabs = [...tabs, id];
      publishTabs();
    }
    setActiveWorkspaceUtility(id);
  };
  const uninstall = installWorkspaceHostCommands({
    showStaticPanel: () => undefined,
    showUtility,
    toggleUtility: (id) => {
      if (activeWorkspaceUtility() === id) setActiveWorkspaceUtility(null);
      else showUtility(id);
    },
    closeUtility: (id) => {
      tabs = tabs.filter((tabId) => tabId !== id);
      publishTabs();
      if (activeWorkspaceUtility() === id) setActiveWorkspaceUtility(null);
    },
    showAuxiliary: () => undefined,
    toggleFocus: () => undefined,
  });

  publishTabs();
  setActiveWorkspaceUtility(null);
  return () => {
    uninstall();
    setWorkspaceUtilityTabs(previousTabs);
    setActiveWorkspaceUtility(previousActive);
  };
}

/**
 * Shared Storybook host for components that normally consume EditorContext.
 * It deliberately provides runtime state only: project discovery, network
 * listeners, and filesystem initialization remain application lifecycles.
 */
export function StoryEditorRuntime({
  children,
  onRuntime,
}: {
  readonly children: ReactNode | ((runtime: EditorRuntime) => ReactNode);
  readonly onRuntime?: (runtime: EditorRuntime) => void;
}) {
  const [runtime] = useState(createStoryEditorRuntime);
  useLayoutEffect(() => {
    const previousStorage = getStorageBackend();
    setStorageBackend(new MemStorage());
    resetProjectThumbnailManifestCache();
    return () => {
      setStorageBackend(previousStorage);
      resetProjectThumbnailManifestCache();
    };
  }, []);
  useEffect(() => {
    onRuntime?.(runtime);
    return () => runtime.session.dispose();
  }, [onRuntime, runtime]);
  return (
    <EditorRuntimeProvider runtime={runtime}>
      {typeof children === 'function' ? children(runtime) : children}
    </EditorRuntimeProvider>
  );
}
