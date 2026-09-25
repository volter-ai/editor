/**
 * Runtime Camera Inspector contribution.
 *
 * Camera/lens/transform authoring is already the ordinary native-camera
 * Inspector. This additional section appears only in Play when the game has
 * explicitly registered `SystemAdapters.camera`, and projects the controller's
 * own active-camera / priority / ownership / blend facts. It is deliberately
 * read-only: follow, aim, collision and arbitration remain project TS/TSX, and
 * the editor creates no camera graph or sidecar.
 */

import { getActiveCamera } from '@volter/editor-sdk/kit/authoring/active-systems';
import type { InspectorSectionProps } from '@volter/editor-sdk/kit/inspector-section-registry';
import type {
  AuthoringAdapter,
  CameraAdapter,
  CameraRuntimeCamera,
  CameraRuntimeSnapshot,
  EditorNode,
} from '@volter/editor-project/adapter';
import { EditorBanner, FieldGroup, FieldRow, Text } from '@volter/editor-sdk/widgets';
import { useEffect, useReducer } from 'react';
import type * as THREE from 'three';

function selectedNativeCamera(
  adapter: AuthoringAdapter,
  nodeId: string | null,
): THREE.Camera | null {
  const object = nodeId ? adapter.hierarchy.object3D?.(nodeId) : null;
  if (!object) return null;
  if ((object as THREE.Camera).isCamera) return object as THREE.Camera;
  const owned = object.userData['_camera'] as THREE.Camera | undefined;
  return owned?.isCamera ? owned : null;
}

export function matches(node: EditorNode | null, adapter: AuthoringAdapter): boolean {
  return !!getActiveCamera() && !!selectedNativeCamera(adapter, node?.id ?? null);
}

function matchingRuntimeCamera(
  selected: NonNullable<ReturnType<typeof selectedNativeCamera>>,
  snapshot: CameraRuntimeSnapshot,
): CameraRuntimeCamera | null {
  return (
    snapshot.cameras.find((camera) => camera.nativeId === selected.uuid) ??
    snapshot.cameras.find(
      (camera) => camera.id === selected.name || camera.label === selected.name,
    ) ??
    null
  );
}

function useCameraSnapshot(camera: CameraAdapter | null): CameraRuntimeSnapshot | null {
  const [, invalidate] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    if (!camera) return;
    return camera.subscribe(invalidate);
  }, [camera]);
  return camera?.snapshot() ?? null;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one compact projection conditionally renders only facts the adapter actually supplied.
export function CameraRuntimeSection({ adapter, nodeId }: InspectorSectionProps) {
  const camera = getActiveCamera();
  const snapshot = useCameraSnapshot(camera);
  // The contribution matched a registered adapter. A late unregistration can
  // happen between composition and projection on Stop; render nothing for that
  // one reconciliation instead of retaining stale runtime facts.
  if (!snapshot) return null;
  const selected = selectedNativeCamera(adapter, nodeId);
  if (!selected) return null;
  const runtimeCamera = matchingRuntimeCamera(selected, snapshot);
  const isActive = runtimeCamera?.id === snapshot.activeCameraId;
  const transition = snapshot.transition;
  const remaining = transition
    ? Math.max(0, transition.durationSeconds - transition.elapsedSeconds)
    : null;

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {!runtimeCamera ? (
        <EditorBanner tone="info">
          This native camera is not registered with the active runtime controller.
        </EditorBanner>
      ) : null}
      <FieldGroup>
        <FieldRow label="Role">
          <Text tone={isActive ? 'success' : 'muted'}>
            {isActive ? 'Active camera' : runtimeCamera ? 'Registered camera' : 'Scene camera'}
          </Text>
        </FieldRow>
        {runtimeCamera ? (
          <FieldRow label="Runtime ID">
            <Text tone="muted">{runtimeCamera.id}</Text>
          </FieldRow>
        ) : null}
        {runtimeCamera?.priority !== undefined ? (
          <FieldRow label="Priority">
            <Text tone="muted">{runtimeCamera.priority}</Text>
          </FieldRow>
        ) : null}
        {runtimeCamera?.enabled !== undefined ? (
          <FieldRow label="Enabled">
            <Text tone={runtimeCamera.enabled ? 'success' : 'muted'}>
              {runtimeCamera.enabled ? 'Yes' : 'No'}
            </Text>
          </FieldRow>
        ) : null}
        <FieldRow label="Active camera">
          <Text tone="muted">{snapshot.activeCameraId ?? 'None'}</Text>
        </FieldRow>
        <FieldRow label="Controller">
          <Text tone="muted">{snapshot.activeControllerId ?? 'Gameplay / unowned'}</Text>
        </FieldRow>
        <FieldRow label="Ownership depth">
          <Text tone="muted">{snapshot.ownershipDepth}</Text>
        </FieldRow>
        {transition ? (
          <>
            <FieldRow label="Blend">
              <Text tone="muted">
                {`${transition.fromCameraId ?? 'current pose'} → ${transition.toCameraId}`}
              </Text>
            </FieldRow>
            <FieldRow label="Progress">
              <Text tone="muted">
                {`${Math.round(transition.progress * 100)}% · ${remaining?.toFixed(2)}s left`}
              </Text>
            </FieldRow>
          </>
        ) : null}
      </FieldGroup>
    </div>
  );
}
