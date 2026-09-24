/**
 * Canvas implementation of an adapter-declared isolation scene document.
 * Loaded only when a Canvas scene document is actually rendered; the generic
 * scene table registry must not make a Three project evaluate Pixi authoring.
 */

import { isolationImportUrl } from '@volter/editor-sdk/session/project-module-url';
import { themeVars } from '@volter/editor-sdk/widgets';
import { createPhysics2DRegistry } from '@volter/game-runtime/pixi/physics-registry';
import { createPhysicsAdapter2D } from '@volter/game-runtime/pixi/system-adapters';
import { useEffect, useRef, useState } from 'react';
import {
  type IsolatedPixiScreenCtor,
  type MountedIsolatedPixiScreen,
  mountIsolatedPixiScreen,
} from '../authoring/mount-isolated-pixi-screen';
import { PixiAuthoringAdapter } from '../authoring/pixi-authoring-adapter';
import { createCreationSiteCanvasWriteTarget } from '../authoring/pixi-creation-site-write-target';
import { installCanvasSceneNavigation } from '@volter/editor-core/authoring/react-canvas-navigation';
import { createRootViewController } from '@volter/editor-sdk/kit/world-pan-state';
import { capturePixiDisplayObjectThumbnail } from '@volter/editor-core/canvas-preview-frames';
import type { DocumentPreviewCaptureRequest } from '@volter/editor-sdk/kit/document-preview-source';
import { useThreeEditorStore } from '@volter/editor-core/editor-runtime';
import { authoringJournal } from '../history/json-history-resource';
import { setActiveScope } from '@volter/editor-sdk/kit/hotkeys';
import { getCurrentProject } from '@volter/editor-core/project-manager';
import { takeNamedExport } from '../take-named-export';
import { registerWorkspaceDocumentSelection } from '@volter/editor-sdk/kit/workspace-document-registry';
import {
  CANVAS_SCENE_BACKGROUND,
  CanvasSceneBackdrop,
  CanvasSceneControls,
} from '@volter/editor-core/components/CanvasSceneViewport';
import { RootSelectionOverlay } from '@volter/editor-core/components/RootSelectionOverlay';

export interface PixiIsolationSceneContentProps {
  readonly active: boolean;
  readonly documentId: string;
  readonly path: string;
  readonly exportName: string | undefined;
  readonly isolationSetup?: { readonly path: string; readonly export?: string };
}

async function loadSiblingAssetInitializer(
  path: string,
): Promise<{ initAssets?: () => Promise<void>; assetSourcePath?: string }> {
  const assetsPath = path.replace(/\/screens\/[^/]+$/, '/assets.ts');
  if (assetsPath === path) return {};
  try {
    const project = getCurrentProject();
    if (!project) return {};
    const assets = (await import(
      /* @vite-ignore */ isolationImportUrl(project.rootPath, assetsPath)
    )) as { initAssets?: () => Promise<void> };
    return typeof assets.initAssets === 'function'
      ? { initAssets: assets.initAssets, assetSourcePath: assetsPath }
      : {};
  } catch {
    // A screen with no sibling assets.ts still mounts; missing textures surface
    // as the constructor's own error.
    return {};
  }
}

export function PixiIsolationSceneContent({
  active,
  documentId,
  path,
  exportName,
  isolationSetup: isolationSetupSpec,
}: PixiIsolationSceneContentProps) {
  const store = useThreeEditorStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef(createRootViewController());
  const view = viewRef.current;
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [adapter, setAdapter] = useState<PixiAuthoringAdapter | null>(null);
  const adapterRef = useRef<PixiAuthoringAdapter | null>(null);
  const mountedRef = useRef<MountedIsolatedPixiScreen | null>(null);
  const [visited, setVisited] = useState(active);
  useEffect(() => {
    if (active) setVisited(true);
  }, [active]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    return installCanvasSceneNavigation(container, view);
  }, [view]);

  useEffect(() => {
    if (!adapter) return;
    return registerWorkspaceDocumentSelection(documentId, () => ({
      adapter,
      nodeId: [...store.selectedEntityIds].find((id) => adapter.hierarchy.node(id)) ?? null,
    }));
  }, [adapter, documentId, store]);

  useEffect(() => {
    if (!visited) return;
    const layer = containerRef.current;
    if (!layer) return;
    let cancelled = false;
    setError(null);
    setReady(false);
    setAdapter(null);
    void loadIsolatedSceneComponent(path, exportName)
      .then(async (Ctor) => {
        const assets = await loadSiblingAssetInitializer(path);
        const isolationSetup = isolationSetupSpec
          ? await loadIsolationSetup(isolationSetupSpec.path, isolationSetupSpec.export)
          : undefined;
        return mountIsolatedPixiScreen(Ctor, {
          ...assets,
          ...(isolationSetup ? { isolationSetup } : {}),
          view,
          layer,
        });
      })
      .then((mounted) => {
        if (cancelled) {
          mounted.dispose();
          return;
        }
        mountedRef.current = mounted;
        const next = new PixiAuthoringAdapter(mounted.screen, store, {
          // The mount already chose the namespace the game's own class was
          // constructed in; taking it back is what keeps ONE per surface.
          pixi: mounted.pixi,
          // Journal ids are project-relative paths — `scene:TitleScreen` is
          // read as a URI scheme and refused (`resource-registry.ts`).
          journal: authoringJournal(`isolation/${documentId.slice('scene:'.length)}`),
          target: createCreationSiteCanvasWriteTarget({
            physics: createPhysicsAdapter2D(createPhysics2DRegistry()),
            history: store.projectHistory,
          }),
          surface: () => mounted.canvas,
          capturePreview: (object, size) =>
            capturePixiDisplayObjectThumbnail(object, { ...size, pixi: mounted.pixi }),
          pointFromClient: (clientX, clientY, surfaceRect) => {
            const pose = view.get();
            return {
              x: (clientX - surfaceRect.left - pose.x) / pose.zoom,
              y: (clientY - surfaceRect.top - pose.y) / pose.zoom,
            };
          },
        });
        adapterRef.current = next;
        setAdapter(next);
        setReady(true);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
      mountedRef.current?.dispose();
      mountedRef.current = null;
      adapterRef.current?.dispose();
      adapterRef.current = null;
    };
  }, [documentId, store, view, visited, path, exportName, isolationSetupSpec]);

  if (error) {
    return (
      <div
        role="alert"
        data-testid="scene-document-error"
        style={{ padding: 12, fontSize: 12, color: themeVars.semantic.danger, maxWidth: 640 }}
      >
        <div style={{ fontWeight: 600, marginBottom: 4 }}>
          {path}
          {exportName ? ` — ${exportName}` : ''}
        </div>
        <div style={{ color: themeVars.content.muted, whiteSpace: 'pre-wrap' }}>{error}</div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-testid="scene-document-pixi-isolation"
      data-document-id={documentId}
      data-vgai-backdrop-color={active ? CANVAS_SCENE_BACKGROUND : undefined}
      data-vgai-backdrop-policy={active ? 'dark-frost' : undefined}
      onPointerDown={() => setActiveScope('viewport')}
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'auto',
        backgroundColor: CANVAS_SCENE_BACKGROUND,
        touchAction: 'none',
      }}
    >
      <CanvasSceneBackdrop view={view} />
      {adapter ? <RootSelectionOverlay adapter={adapter} view={view} transformModeAware /> : null}
      <CanvasSceneControls
        active={active}
        {...(adapter ? { adapter } : {})}
        containerRef={containerRef}
        view={view}
      />
      {!ready ? (
        <div
          data-testid="scene-document-loading"
          style={{ padding: 12, fontSize: 12, color: themeVars.content.muted, fontStyle: 'italic' }}
        >
          mounting…
        </div>
      ) : null}
    </div>
  );
}

async function loadIsolatedSceneComponent(
  path: string,
  exportName: string | undefined,
): Promise<IsolatedPixiScreenCtor> {
  const project = getCurrentProject();
  if (!project) throw new Error('No project is open, so its scene modules cannot be loaded.');
  return takeNamedExport<IsolatedPixiScreenCtor>(
    isolationImportUrl(project.rootPath, path),
    path,
    exportName,
  );
}

/** Load the adapter-declared zero-argument prerequisite for one Edit piece. */
async function loadIsolationSetup(
  path: string,
  exportName: string | undefined,
): Promise<() => void | Promise<void>> {
  const project = getCurrentProject();
  if (!project) throw new Error('No project is open, so its isolation setup cannot be loaded.');
  return takeNamedExport<() => void | Promise<void>>(
    isolationImportUrl(project.rootPath, path),
    path,
    exportName,
  );
}

/** Headless full-composition capture for a Canvas scene Content tile. */
export async function capturePixiIsolationScenePreview(
  props: Pick<PixiIsolationSceneContentProps, 'path' | 'exportName' | 'isolationSetup'>,
  request: DocumentPreviewCaptureRequest,
): Promise<string> {
  const layer = document.createElement('div');
  layer.style.cssText = `position:fixed;left:-20000px;top:0;width:${request.width}px;height:${request.height}px;overflow:hidden;`;
  document.body.appendChild(layer);
  const view = createRootViewController();
  let mounted: MountedIsolatedPixiScreen | null = null;
  try {
    const Ctor = await loadIsolatedSceneComponent(props.path, props.exportName);
    const assets = await loadSiblingAssetInitializer(props.path);
    const isolationSetup = props.isolationSetup
      ? await loadIsolationSetup(props.isolationSetup.path, props.isolationSetup.export)
      : undefined;
    mounted = await mountIsolatedPixiScreen(Ctor, {
      ...assets,
      ...(isolationSetup ? { isolationSetup } : {}),
      view,
      layer,
    });
    const image = await capturePixiDisplayObjectThumbnail(mounted.screen, {
      width: request.width,
      height: request.height,
      budget: Number.POSITIVE_INFINITY,
      pixi: mounted.pixi,
    });
    if (!image) throw new Error('The Canvas scene has no capturable composition.');
    return image;
  } finally {
    mounted?.dispose();
    layer.remove();
  }
}
