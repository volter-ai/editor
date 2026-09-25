/**
 * THE WORLD ROOT'S CONTENT BINDING, as the stage host sees it.
 *
 * A stage shows either one Object3D a caller builds (`build` content) or the
 * project's world (`world-root` content): the manifest's roots mounted by a
 * design session, drawn by the world's own image pipeline, with the presenter
 * Play adopts live roots through. The host owns the surface's place, the frame
 * session, the per-stage door, the furniture and the overlays for both. What
 * mounts a world is the contributing package's — it runs the game runtime,
 * which a modeling host never carries — so the package hands the host this
 * binding and the host loads it only for a stage that shows a world.
 */
import type { ViewportPresentation, ViewportRoot } from '@volter/editor-sdk/host';
import type { ComponentType, RefObject } from 'react';
import type * as THREE from 'three';
import type { EditorShellStore } from '../editor-shell-store';
import type { EditorStats } from '@volter/editor-sdk/kit/editor-runtime';
import type { EditorViewport } from '../editor-viewport';

export interface WorldRootStageOptions {
  /** The session's store: the world is the session's own subject. */
  readonly store: EditorShellStore;
  readonly documentId: string;
  readonly container: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly stats: EditorStats;
  /** The camera-authoring preview pane, read per frame (a React ref). */
  readonly cameraPreview: () => HTMLDivElement | null;
  readonly onMountStatus: (status: 'mounting' | 'ready') => void;
  readonly onRootIds: (rootIds: readonly string[]) => void;
  /** This stage's frame hook on the per-stage viewport door. */
  readonly runFrame: (deltaSeconds: number) => void;
}

export interface WorldRootStage {
  readonly scene: THREE.Scene;
  readonly viewport: EditorViewport;
  frame(timeMs: number, resumed: boolean): void;
  present(roots: readonly ViewportRoot[]): ViewportPresentation | null;
  setHelper(kind: string, object: THREE.Object3D | null): void;
  dispose(): void;
}

export interface WorldRootOverlayProps {
  readonly store: EditorShellStore;
  /** The stage's own document — its stage context is read by this id. */
  readonly documentId: string;
  readonly cameraPreviewRef: RefObject<HTMLDivElement | null>;
  readonly mountStatus: 'mounting' | 'ready';
  readonly rootIds: readonly string[];
}

export interface WorldRootStageBinding {
  /** The world's own drawing surface, built to the world's render settings. */
  mountWorldRootSurface(
    canvasHost: HTMLDivElement,
    container: HTMLDivElement,
    displayName: string,
  ): { canvas: HTMLCanvasElement; renderer: THREE.WebGLRenderer; lease: null };
  installWorldRootStage(options: WorldRootStageOptions): WorldRootStage;
  /** What the stage shows over a world: its mount state and camera authoring. */
  readonly Overlays: ComponentType<WorldRootOverlayProps>;
}
