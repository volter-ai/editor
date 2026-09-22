/**
 * THE OTHER PARTICIPANTS, ON A STAGE — the spatial half of collaboration
 * presence: what THIS stage publishes about the reader's own camera and
 * gestures, and the camera frusta, selection boxes and pointer rays it paints
 * for everyone else (WORK.md §Presence and the substrate, presence unit 4).
 *
 * It was the scene panel's, so only the world root had it. Under
 * ARCHITECTURE-CORE §One stage it is a CAPABILITY with a condition — a stage
 * painting a three surface — so every 3D document mounts it and a prefab
 * story shows the same markers the Scene does.
 *
 * WHICH STAGE A PARTICIPANT IS ON. Presence is ONE record per participant
 * (`collaboration-presence.ts`), and its `document` field is written by the
 * shell for the ACTIVE workspace document (`DefaultEditorLayout.tsx`). So a
 * stage publishes its camera only while its own document is the active one —
 * otherwise several stages would overwrite each other's pose in the single
 * record — and paints a participant only on the stage whose id matches that
 * participant's `presence.document`. Measured against the spec's "publish it
 * from the host with the stage's documentId": the presence record has ONE
 * `document` field and the shell already owns it, so the stage owns the
 * CONDITION on writing, not a second writer of that field.
 */

import type { CollaborationParticipant } from '@volter/editor-sdk/session/collaboration-types';
import { EDITOR_THEME_CLASS, graphiteDarkEditorTheme } from '@volter/editor-sdk/widgets';
import { contentWorldBounds } from '@volter/editor-threejs/viewport/content-bounds';
import * as THREE from 'three';
import { collaborationSnapshot } from '../collaboration-client';
import { reportCollaborationPresence } from '../collaboration-presence';
import { EDITOR_PARTICIPANT_ID } from '../editor-presence';
import type { EditorShellStore } from '../editor-shell-store';
import type { EditorViewport } from '../editor-viewport';
import { activeWorkspaceDocumentId } from '../workspace-document-registry';

interface RemoteCameraMarker {
  camera: THREE.PerspectiveCamera;
  helper: THREE.CameraHelper;
  label: THREE.Sprite;
  texture: THREE.CanvasTexture;
  signature: string;
  targetPosition: THREE.Vector3;
  targetQuaternion: THREE.Quaternion;
  targetFov: number;
  initialized: boolean;
}

interface RemoteSelectionMarker {
  object: THREE.Object3D;
  box: THREE.Box3;
  helper: THREE.Box3Helper;
}

interface RemoteRayMarker {
  line: THREE.Line;
  positions: THREE.BufferAttribute;
}

/**
 * Remote-camera labels paint into a DETACHED canvas, and a 2D context cannot
 * resolve `var(--vgai-…)` — so the theme's value has to be read off the live
 * theme root before it reaches `fillStyle`. Before a theme is installed (unit
 * environments), fall back to the default theme's own value rather than a raw
 * literal, so the label never depends on a color the theme contract doesn't own.
 */
function contentOnAccentColor(): string {
  const root = document.querySelector(`.${EDITOR_THEME_CLASS}`);
  const resolved = root
    ? getComputedStyle(root).getPropertyValue('--vgai-content-on-accent').trim()
    : '';
  return resolved || graphiteDarkEditorTheme.color.content.onAccent;
}

function drawRemoteCameraLabel(
  texture: THREE.CanvasTexture,
  participant: CollaborationParticipant,
): void {
  const canvas = texture.image as HTMLCanvasElement;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = participant.color;
  context.beginPath();
  context.roundRect(2, 2, canvas.width - 4, canvas.height - 4, 16);
  context.fill();
  context.fillStyle = contentOnAccentColor();
  context.font = '600 22px system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  const suffix = participant.kind === 'agent' ? ' · AI' : '';
  context.fillText(`${participant.displayName}${suffix}`, canvas.width / 2, canvas.height / 2, 238);
  texture.needsUpdate = true;
}

function createRemoteCameraMarker(participant: CollaborationParticipant): RemoteCameraMarker {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.2, 1.4);
  const helper = new THREE.CameraHelper(camera);
  const color = new THREE.Color(participant.color);
  helper.setColors(color, color, color, color, color);
  helper.name = `Collaboration camera: ${participant.displayName}`;
  helper.userData['editorOnly'] = true;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }),
  );
  label.name = `Collaboration label: ${participant.displayName}`;
  label.userData['editorOnly'] = true;
  label.scale.set(1.8, 0.45, 1);
  label.renderOrder = 10_000;
  drawRemoteCameraLabel(texture, participant);
  return {
    camera,
    helper,
    label,
    texture,
    signature: '',
    targetPosition: new THREE.Vector3(),
    targetQuaternion: new THREE.Quaternion(),
    targetFov: 50,
    initialized: false,
  };
}

function updateRemoteCameraMarker(
  marker: RemoteCameraMarker,
  participant: CollaborationParticipant,
): void {
  const pose = participant.presence.camera;
  if (!pose) return;
  marker.targetPosition.set(pose.x, pose.y, pose.z);
  const targetCamera = new THREE.Object3D();
  targetCamera.position.copy(marker.targetPosition);
  targetCamera.lookAt(pose.targetX, pose.targetY, pose.targetZ);
  marker.targetQuaternion.copy(targetCamera.quaternion);
  marker.targetFov = pose.fov;
  if (!marker.initialized) {
    marker.initialized = true;
    marker.camera.position.copy(marker.targetPosition);
    marker.camera.quaternion.copy(marker.targetQuaternion);
    marker.camera.fov = marker.targetFov;
  }
  const signature = `${participant.displayName}|${participant.kind}|${participant.color}|${participant.status}`;
  if (signature !== marker.signature) {
    marker.signature = signature;
    drawRemoteCameraLabel(marker.texture, participant);
  }
}

function animateRemoteCameraMarker(marker: RemoteCameraMarker, dt: number): void {
  const blend = 1 - Math.exp(-12 * Math.max(0, dt));
  marker.camera.position.lerp(marker.targetPosition, blend);
  marker.camera.quaternion.slerp(marker.targetQuaternion, blend);
  marker.camera.fov += (marker.targetFov - marker.camera.fov) * blend;
  marker.camera.updateProjectionMatrix();
  marker.camera.updateMatrixWorld(true);
  marker.helper.update();
  marker.label.position.copy(marker.camera.position);
  marker.label.position.y += 0.55;
}

function disposeRemoteCameraMarker(marker: RemoteCameraMarker): void {
  marker.helper.removeFromParent();
  marker.label.removeFromParent();
  marker.helper.dispose();
  marker.texture.dispose();
  (marker.label.material as THREE.SpriteMaterial).dispose();
}

function createRemoteSelectionMarker(object: THREE.Object3D, color: string): RemoteSelectionMarker {
  const box = contentWorldBounds(object);
  const helper = new THREE.Box3Helper(box, new THREE.Color(color));
  helper.name = `Collaboration selection: ${object.name || object.uuid}`;
  helper.userData['editorOnly'] = true;
  helper.renderOrder = 9_999;
  (helper.material as THREE.LineBasicMaterial).depthTest = false;
  return { object, box, helper };
}

function disposeRemoteSelectionMarker(marker: RemoteSelectionMarker): void {
  marker.helper.removeFromParent();
  marker.helper.geometry.dispose();
  (marker.helper.material as THREE.Material).dispose();
}

function pointerRayGesture(value: Readonly<Record<string, unknown>> | null): {
  origin: THREE.Vector3;
  end: THREE.Vector3;
} | null {
  if (!value || value['type'] !== 'pointer-ray') return null;
  const keys = [
    'originX',
    'originY',
    'originZ',
    'directionX',
    'directionY',
    'directionZ',
    'length',
  ] as const;
  if (!keys.every((key) => typeof value[key] === 'number' && Number.isFinite(value[key]))) {
    return null;
  }
  const origin = new THREE.Vector3(
    value['originX'] as number,
    value['originY'] as number,
    value['originZ'] as number,
  );
  const direction = new THREE.Vector3(
    value['directionX'] as number,
    value['directionY'] as number,
    value['directionZ'] as number,
  );
  const length = Math.min(1_000, Math.max(0.1, value['length'] as number));
  if (direction.lengthSq() < 0.000_001) return null;
  return { origin, end: origin.clone().add(direction.normalize().multiplyScalar(length)) };
}

export interface StagePresenceOptions {
  /** The scene the markers are added to — the stage's own drawn scene. */
  readonly scene: THREE.Scene;
  readonly store: EditorShellStore;
  /** The stage's document id: the presence records painted here are the ones
   *  whose own `document` is this. */
  readonly documentId: string;
  readonly container: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly viewport: EditorViewport;
  /** The pose the reader is actually looking through, in world space. */
  readonly readVisibleCameraPose: () => {
    readonly position: THREE.Vector3;
    readonly target: THREE.Vector3;
    readonly fov: number;
  };
}

export interface StagePresenceBinding {
  /** Publish the reader's camera now (after a view change the frame loop's
   *  pose comparison would otherwise notice a frame late). */
  reportCamera(): void;
  /** Per frame: project new presence sequences and animate the markers. */
  syncMarkers(dtSeconds: number): void;
  dispose(): void;
}

export function bindStagePresenceMarkers(options: StagePresenceOptions): StagePresenceBinding {
  const { scene, store, documentId, container, canvas, viewport, readVisibleCameraPose } = options;
  /** THE WRITE CONDITION: one presence record, one `document` field — a stage
   *  that is not the active document does not speak for the reader. */
  const publishes = (): boolean => activeWorkspaceDocumentId() === documentId;

  const reportCamera = (): void => {
    if (!publishes()) return;
    const pose = readVisibleCameraPose();
    reportCollaborationPresence({
      camera: {
        x: pose.position.x,
        y: pose.position.y,
        z: pose.position.z,
        targetX: pose.target.x,
        targetY: pose.target.y,
        targetZ: pose.target.z,
        fov: pose.fov,
      },
    });
  };
  viewport.orbitControls.addEventListener('change', reportCamera);

  let transformDragging = false;
  const reportTransformGesture = (event: THREE.Event): void => {
    const dragging = (event as unknown as { value?: unknown }).value === true;
    transformDragging = dragging;
    if (!publishes()) return;
    reportCollaborationPresence({
      gesture: dragging ? { type: 'transform', selection: [...store.selectedEntityIds] } : null,
    });
  };
  viewport.transformControls.addEventListener('dragging-changed', reportTransformGesture);

  const pointerRaycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const reportPointerRay = (event: PointerEvent): void => {
    if (transformDragging || event.buttons !== 0 || !publishes()) return;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    pointerNdc.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    pointerRaycaster.setFromCamera(pointerNdc, viewport.renderCamera);
    const ray = pointerRaycaster.ray;
    const pose = readVisibleCameraPose();
    reportCollaborationPresence({
      gesture: {
        type: 'pointer-ray',
        originX: ray.origin.x,
        originY: ray.origin.y,
        originZ: ray.origin.z,
        directionX: ray.direction.x,
        directionY: ray.direction.y,
        directionZ: ray.direction.z,
        length: Math.max(2, pose.position.distanceTo(pose.target)),
      },
    });
  };
  const clearPointerRay = (): void => {
    if (!transformDragging && publishes()) reportCollaborationPresence({ gesture: null });
  };
  container.addEventListener('pointermove', reportPointerRay);
  container.addEventListener('pointerleave', clearPointerRay);
  reportCamera();

  // Remote editors are represented in the scene with their real reported
  // camera frustum and a billboard label. This is spatial presence, not a
  // guessed avatar location: participants without a live camera publish no
  // marker. The collaboration snapshot is already refreshed by the page's
  // presence surface, so the render loop only projects new sequences.
  const remoteCameraMarkers = new Map<string, RemoteCameraMarker>();
  const remoteSelectionMarkers = new Map<string, RemoteSelectionMarker>();
  const remoteRayMarkers = new Map<string, RemoteRayMarker>();
  let remotePresenceSequence = -1;
  const syncRemoteSpatialMarkers = (): void => {
    const snapshot = collaborationSnapshot();
    if (!snapshot || snapshot.sequence === remotePresenceSequence) return;
    remotePresenceSequence = snapshot.sequence;
    /** THE PAINT CONDITION: a participant is on the stage its own presence
     *  names, so the same person's marker follows them from the Scene to a
     *  model document instead of being drawn on both. */
    const here = snapshot.participants.filter(
      (participant) =>
        participant.participantId !== EDITOR_PARTICIPANT_ID &&
        participant.presence.document === documentId,
    );
    const visible = here.filter((participant) => participant.presence.camera);
    const liveIds = new Set(visible.map((participant) => participant.participantId));
    for (const [participantId, marker] of remoteCameraMarkers) {
      if (liveIds.has(participantId)) continue;
      disposeRemoteCameraMarker(marker);
      remoteCameraMarkers.delete(participantId);
    }
    for (const participant of visible) {
      let marker = remoteCameraMarkers.get(participant.participantId);
      if (!marker) {
        marker = createRemoteCameraMarker(participant);
        remoteCameraMarkers.set(participant.participantId, marker);
        scene.add(marker.helper, marker.label);
      }
      updateRemoteCameraMarker(marker, participant);
    }
    const selected = here.flatMap((participant) =>
      participant.presence.selection.slice(0, 20).map((objectId) => ({
        key: `${participant.participantId}:${objectId}`,
        objectId,
        color: participant.color,
      })),
    );
    const selectedKeys = new Set(selected.map((entry) => entry.key));
    for (const [key, marker] of remoteSelectionMarkers) {
      if (selectedKeys.has(key)) continue;
      disposeRemoteSelectionMarker(marker);
      remoteSelectionMarkers.delete(key);
    }
    for (const entry of selected) {
      const object = store.objectMap.get(entry.objectId);
      const previous = remoteSelectionMarkers.get(entry.key);
      if (!object) {
        if (previous) {
          disposeRemoteSelectionMarker(previous);
          remoteSelectionMarkers.delete(entry.key);
        }
        continue;
      }
      if (previous?.object === object) continue;
      if (previous) disposeRemoteSelectionMarker(previous);
      const marker = createRemoteSelectionMarker(object, entry.color);
      remoteSelectionMarkers.set(entry.key, marker);
      scene.add(marker.helper);
    }
    const rays = here.flatMap((participant) => {
      const ray = pointerRayGesture(participant.presence.gesture);
      return ray
        ? [{ participantId: participant.participantId, color: participant.color, ray }]
        : [];
    });
    const rayIds = new Set(rays.map((entry) => entry.participantId));
    for (const [participantId, marker] of remoteRayMarkers) {
      if (rayIds.has(participantId)) continue;
      disposeRemoteRayMarker(marker);
      remoteRayMarkers.delete(participantId);
    }
    for (const entry of rays) {
      let marker = remoteRayMarkers.get(entry.participantId);
      if (!marker) {
        marker = createRemoteRayMarker(entry.color);
        remoteRayMarkers.set(entry.participantId, marker);
        scene.add(marker.line);
      }
      updateRemoteRayMarker(marker, entry.ray);
    }
  };

  // "Join" in the header's people control lands the viewport on that
  // participant's real reported camera.
  const joinRequested = (event: Event): void => {
    if (!publishes()) return;
    const participantId = (event as CustomEvent<{ participantId?: unknown }>).detail?.participantId;
    if (typeof participantId !== 'string') return;
    const camera = collaborationSnapshot()?.participants.find(
      (participant) => participant.participantId === participantId,
    )?.presence.camera;
    if (!camera) return;
    store.setCameraPose(
      { x: camera.x, y: camera.y, z: camera.z },
      { x: camera.targetX, y: camera.targetY, z: camera.targetZ },
      camera.fov,
    );
  };
  window.addEventListener('editor:collaboration-join', joinRequested);

  return {
    reportCamera,
    syncMarkers: (dtSeconds) => {
      syncRemoteSpatialMarkers();
      for (const marker of remoteCameraMarkers.values())
        animateRemoteCameraMarker(marker, dtSeconds);
      for (const marker of remoteSelectionMarkers.values()) {
        contentWorldBounds(marker.object, marker.box);
      }
    },
    dispose: () => {
      viewport.orbitControls.removeEventListener('change', reportCamera);
      viewport.transformControls.removeEventListener('dragging-changed', reportTransformGesture);
      container.removeEventListener('pointermove', reportPointerRay);
      container.removeEventListener('pointerleave', clearPointerRay);
      window.removeEventListener('editor:collaboration-join', joinRequested);
      for (const marker of remoteCameraMarkers.values()) disposeRemoteCameraMarker(marker);
      remoteCameraMarkers.clear();
      for (const marker of remoteSelectionMarkers.values()) disposeRemoteSelectionMarker(marker);
      remoteSelectionMarkers.clear();
      for (const marker of remoteRayMarkers.values()) disposeRemoteRayMarker(marker);
      remoteRayMarkers.clear();
    },
  };
}

function createRemoteRayMarker(color: string): RemoteRayMarker {
  const positions = new THREE.Float32BufferAttribute(new Float32Array(6), 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', positions);
  const material = new THREE.LineBasicMaterial({
    color: new THREE.Color(color),
    depthTest: false,
    transparent: true,
    opacity: 0.9,
  });
  const line = new THREE.Line(geometry, material);
  line.name = 'Collaboration pointer ray';
  line.userData['editorOnly'] = true;
  line.renderOrder = 10_001;
  return { line, positions };
}

function updateRemoteRayMarker(
  marker: RemoteRayMarker,
  ray: { origin: THREE.Vector3; end: THREE.Vector3 },
): void {
  marker.positions.setXYZ(0, ray.origin.x, ray.origin.y, ray.origin.z);
  marker.positions.setXYZ(1, ray.end.x, ray.end.y, ray.end.z);
  marker.positions.needsUpdate = true;
  marker.line.geometry.computeBoundingSphere();
}

function disposeRemoteRayMarker(marker: RemoteRayMarker): void {
  marker.line.removeFromParent();
  marker.line.geometry.dispose();
  (marker.line.material as THREE.Material).dispose();
}
