/**
 * Three implementation of an adapter-declared isolation scene document.
 *
 * The exact counterpart of `PixiIsolationSceneContent.tsx`, and extracted for
 * the reason that module's own header already gives: "Loaded only when a
 * Canvas scene document is actually rendered; the generic scene table registry
 * must not make a Three project evaluate Pixi authoring." The three half sat
 * INLINE in `scene-documents.tsx` instead, so the generic scene-table registry
 * — which every project's tab row subscribes to at boot — carried the portable
 * CSF mount with it: `stories/story-three-preview.ts`,
 * `stories/mounted-story-viewport-source.ts`, `stories/story-mount-turn.ts`,
 * `story-three-preview-runtime.ts`, `authoring/design-time-settle.ts` and
 * `crash-null-boundary.ts` (measured 2026-09-18, phase 1 unit 9 of the
 * open-source launch: six files, in a `models` build that declares no story).
 *
 * ## The mount, and who owns it
 *
 * Identical to the per-story 3D document's, deliberately and by reuse: the
 * composition is mounted off-screen through `stories/story-three-preview.ts`
 * and wrapped by `stories/mounted-story-viewport-source.ts`, whose
 * per-activation disposer is EMPTY because a remount of this document (source
 * identity change, not a tab flip) still calls `build()` again. This
 * component's own effect cleanup is the ONE teardown path. See that module's
 * header for the measured black-panel defect a second owner produces.
 */

import { fsImportPath } from '@volter/editor-sdk/session/project-module-url';
import { themeVars } from '@volter/editor-sdk/widgets';
import { useEffect, useRef, useState } from 'react';
import type { DocumentPreviewCaptureRequest } from '@volter/editor-sdk/kit/document-preview-source';
import { captureAuthoredThreeScenePreview } from '../document-preview-three';
import { getCurrentProject } from '@volter/editor-core/project-manager';
import {
  type MountedStoryViewportSource,
  mountedStoryViewportSource,
} from '../stories/mounted-story-viewport-source';
import {
  disposeStoryObject3D,
  mountStoryObject3D,
  type StoryPreviewComponent,
} from '@volter/editor-core/stories/story-three-preview';
import { takeNamedExport } from '../take-named-export';
import type { WorkspaceDocumentContentProps } from '@volter/editor-sdk/kit/workspace-document-registry';
import { Object3DDocumentViewport } from '@volter/editor-core/components/Object3DDocumentViewport';

export interface ThreeIsolationSceneState {
  /** Project-relative module the composition lives in. */
  readonly path: string;
  readonly exportName: string | undefined;
  readonly label: string;
}

export function ThreeIsolationSceneContent({
  active,
  documentId,
  state,
}: WorkspaceDocumentContentProps & { state: ThreeIsolationSceneState | undefined }) {
  const [source, setSource] = useState<MountedStoryViewportSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sourceRef = useRef<MountedStoryViewportSource | null>(null);
  // EVERY OPEN DOCUMENT IS MOUNTED, and this row is opened for EVERY
  // scene a project declares — so mounting at open time would build every
  // scene's fiber root at boot. Mount on first activation and retain it
  // afterwards; a mount freed on deactivation is the black-panel defect
  // `mountedStoryViewportSource` documents.
  const [visited, setVisited] = useState(active);
  useEffect(() => {
    if (active) setVisited(true);
  }, [active]);

  const path = state?.path;
  const exportName = state?.exportName;
  useEffect(() => {
    if (!visited || !path) return;
    let cancelled = false;
    setError(null);
    setSource(null);
    void loadSceneComponent(path, exportName)
      .then((Component) => mountStoryObject3D(Component, {}))
      .then((mounted) => {
        if (cancelled) {
          void disposeStoryObject3D(mounted);
          return;
        }
        const next = mountedStoryViewportSource(mounted);
        sourceRef.current = next;
        setSource(next);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
      // THIS is the mount's one owner — see the module header.
      sourceRef.current?.dispose();
      sourceRef.current = null;
      setSource(null);
    };
  }, [visited, path, exportName]);

  if (!state) {
    return (
      <div style={{ padding: 12, fontSize: 12, color: themeVars.content.muted }}>
        This scene document is no longer declared by the project's adapter.
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        data-testid="scene-document-error"
        style={{ padding: 12, fontSize: 12, color: themeVars.semantic.danger, maxWidth: 640 }}
      >
        <div style={{ fontWeight: 600, marginBottom: 4 }}>
          {state.path}
          {state.exportName ? ` — ${state.exportName}` : ''}
        </div>
        <div style={{ color: themeVars.content.muted, whiteSpace: 'pre-wrap' }}>{error}</div>
      </div>
    );
  }

  if (!source) {
    return (
      <div
        data-testid="scene-document-loading"
        style={{ padding: 12, fontSize: 12, color: themeVars.content.muted, fontStyle: 'italic' }}
      >
        mounting…
      </div>
    );
  }

  return (
    <Object3DDocumentViewport
      documentId={documentId}
      sourcePath={state.path}
      build={source.build}
      displayName={state.label}
      active={active}
    />
  );
}

/**
 * Import the scene's own module through the project-module door and take the
 * export the table named.
 *
 * Cache-busted per mount, the same always-fresh discipline design-time CSF
 * loads use (`stories/story-discovery.ts`): a scene edited in the editor must
 * be re-openable without a reload. The url is built by `fsImportPath`, the ONE
 * owner of `/@fs/` urls for project code (PD-3).
 */
async function loadSceneComponent(
  path: string,
  exportName: string | undefined,
): Promise<StoryPreviewComponent> {
  const project = getCurrentProject();
  if (!project) throw new Error('No project is open, so its scene modules cannot be loaded.');
  const url = `${fsImportPath(project.rootPath, path)}?t=${Date.now()}`;
  return takeNamedExport<StoryPreviewComponent>(url, path, exportName);
}

/** Headless capture door for Content. It mounts the authored source without
 * opening or activating its workspace document. */
export async function captureThreeIsolationScenePreview(
  state: ThreeIsolationSceneState,
  request: DocumentPreviewCaptureRequest,
): Promise<string> {
  const Component = await loadSceneComponent(state.path, state.exportName);
  const mounted = await mountStoryObject3D(Component, {});
  try {
    return captureAuthoredThreeScenePreview(mounted.root, mounted.scene, request);
  } finally {
    await disposeStoryObject3D(mounted);
  }
}
