import type * as THREE from 'three';

/**
 * Transient camera-authoring presentation for the Scene viewport.
 *
 * Cameras remain ordinary native Three.js objects owned by the active
 * AuthoringAdapter. This module carries only viewport presentation (pin,
 * view-through, pilot) and delegates every authored mutation to the host's
 * canonical transform gesture path. There is no camera document or sidecar.
 */

export type CameraViewMode = 'view' | 'pilot';

export interface CameraAuthoringSubject {
  readonly id: string;
  readonly name: string;
  readonly camera: THREE.Camera;
  readonly lens: string;
  /** Position and rotation can both enter the adapter's normal edit gesture. */
  readonly canAuthorPose: boolean;
  readonly poseRefusal?: string;
}

export interface CameraAuthoringPresentation {
  readonly preview: CameraAuthoringSubject | null;
  readonly previewPinned: boolean;
  readonly view: {
    readonly mode: CameraViewMode;
    readonly subject: CameraAuthoringSubject;
  } | null;
  readonly guidesVisible: boolean;
}

export interface CameraAuthoringHost {
  /** Camera authoring is an Edit/Scene affordance, never a Play overlay. */
  readonly active: () => boolean;
  readonly selected: () => CameraAuthoringSubject | null;
  readonly resolve: (id: string) => CameraAuthoringSubject | null;
  readonly showView: (subject: CameraAuthoringSubject, mode: CameraViewMode) => void;
  readonly leaveView: () => void;
  readonly alignToViewport: (subject: CameraAuthoringSubject) => void;
  readonly subscribe: (listener: () => void) => () => void;
}

let host: CameraAuthoringHost | null = null;
let disposeHostSubscription: (() => void) | null = null;
let pinnedId: string | null = null;
let viewState: { id: string; mode: CameraViewMode; camera: THREE.Camera } | null = null;
let guidesVisible = true;
let version = 0;
const listeners = new Set<() => void>();

function notify(): void {
  version++;
  for (const listener of listeners) listener();
}

function syncHostState(): void {
  if (!host) return;
  if (!host.active()) {
    if (viewState) host.leaveView();
    viewState = null;
    notify();
    return;
  }
  if (pinnedId && !host.resolve(pinnedId)) pinnedId = null;
  if (viewState) {
    const subject = host.resolve(viewState.id);
    if (!subject) {
      viewState = null;
      host.leaveView();
    } else if (subject.camera !== viewState.camera) {
      // HMR may replace the native camera while preserving its semantic id.
      // Rebind the transient view to the fresh object rather than retaining a
      // dead Three.js reference.
      viewState = { ...viewState, camera: subject.camera };
      host.showView(subject, viewState.mode);
    }
  }
  notify();
}

/** Install the one live Scene viewport host. The returned disposer is
 * identity-guarded so a stale unmount cannot clear a newer viewport. */
export function installCameraAuthoringHost(next: CameraAuthoringHost): () => void {
  disposeHostSubscription?.();
  host?.leaveView();
  host = next;
  pinnedId = null;
  viewState = null;
  guidesVisible = true;
  disposeHostSubscription = next.subscribe(syncHostState);
  notify();
  return () => {
    if (host !== next) return;
    disposeHostSubscription?.();
    disposeHostSubscription = null;
    next.leaveView();
    host = null;
    pinnedId = null;
    viewState = null;
    guidesVisible = true;
    notify();
  };
}

export function subscribeCameraAuthoring(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function cameraAuthoringVersion(): number {
  return version;
}

export function cameraAuthoringPresentation(): CameraAuthoringPresentation {
  if (!host?.active()) {
    return { preview: null, previewPinned: false, view: null, guidesVisible };
  }
  const selected = host?.selected() ?? null;
  const pinned = pinnedId ? (host?.resolve(pinnedId) ?? null) : null;
  const viewSubject = viewState ? (host?.resolve(viewState.id) ?? null) : null;
  return {
    preview: viewSubject ? null : (pinned ?? selected),
    previewPinned: Boolean(pinned),
    view: viewState && viewSubject ? { mode: viewState.mode, subject: viewSubject } : null,
    guidesVisible,
  };
}

export function currentCameraAuthoringSubject(): CameraAuthoringSubject | null {
  const presentation = cameraAuthoringPresentation();
  return presentation.view?.subject ?? presentation.preview;
}

export function toggleCameraPreviewPin(): void {
  const presentation = cameraAuthoringPresentation();
  const subject = presentation.preview;
  if (!subject) return;
  pinnedId = presentation.previewPinned ? null : subject.id;
  notify();
}

export function viewThroughCamera(subject = currentCameraAuthoringSubject()): void {
  if (!host || !subject) return;
  if (viewState) host.leaveView();
  viewState = { id: subject.id, mode: 'view', camera: subject.camera };
  host.showView(subject, 'view');
  notify();
}

export function pilotCamera(subject = currentCameraAuthoringSubject()): void {
  if (!host || !subject || !subject.canAuthorPose) return;
  if (viewState) host.leaveView();
  viewState = { id: subject.id, mode: 'pilot', camera: subject.camera };
  host.showView(subject, 'pilot');
  notify();
}

export function alignCameraToViewport(subject = currentCameraAuthoringSubject()): void {
  if (!host || !subject || !subject.canAuthorPose) return;
  host.alignToViewport(subject);
}

export function leaveCameraView(): void {
  if (!host || !viewState) return;
  viewState = null;
  host.leaveView();
  notify();
}

export function toggleCameraCompositionGuides(): void {
  guidesVisible = !guidesVisible;
  notify();
}
