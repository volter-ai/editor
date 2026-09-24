import { collectContentNodeRecords } from '@volter/editor-threejs/viewport/content-bounds';
import { isEditorOwnedObject } from '@volter/editor-threejs/viewport/editor-layers';
import { markHostRenderer } from '@volter/editor-threejs/viewport/renderer-ownership';
import * as THREE from 'three';
import type { DocumentPreviewCaptureRequest } from '@volter/editor-sdk/kit/document-preview-source';
import { frameableContentBounds } from '@volter/editor-core/scene-framing';

function authoredCameras(root: THREE.Object3D): THREE.Camera[] {
  const cameras: THREE.Camera[] = [];
  root.traverse((object) => {
    if (!isEditorOwnedObject(object) && (object as THREE.Camera).isCamera)
      cameras.push(object as THREE.Camera);
  });
  return cameras;
}

function fallbackCamera(root: THREE.Object3D, aspect: number): THREE.PerspectiveCamera {
  // The shared collector includes furniture for other callers. Capture fits
  // only authored content, so remove isolated helper subtrees for this pass.
  const helpers: { object: THREE.Object3D; parent: THREE.Object3D }[] = [];
  root.traverse((object) => {
    if (object.parent && isEditorOwnedObject(object))
      helpers.push({ object, parent: object.parent });
  });
  for (const { object } of helpers) object.removeFromParent();
  let records: ReturnType<typeof collectContentNodeRecords>;
  try {
    records = collectContentNodeRecords(root);
  } finally {
    for (const { object, parent } of helpers) parent.add(object);
  }
  const meaningful = records.filter((record) => !record.overlay && !record.enclosure);
  const candidates = meaningful;
  const bounds = frameableContentBounds(candidates.map((record) => record.box));
  const camera = new THREE.PerspectiveCamera(42, aspect, 0.01, 100_000);
  const center = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3());
  const radius = bounds.isEmpty()
    ? 1
    : Math.max(0.01, bounds.getBoundingSphere(new THREE.Sphere()).radius);
  const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.position
    .copy(center)
    .addScaledVector(new THREE.Vector3(1, 0.75, 1).normalize(), distance * 1.15);
  camera.lookAt(center);
  camera.near = Math.max(0.001, distance - radius * 2.5);
  camera.far = distance + radius * 3;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

function captureCamera(root: THREE.Object3D, request: DocumentPreviewCaptureRequest): THREE.Camera {
  if (request.camera) {
    const camera = new THREE.PerspectiveCamera(
      request.camera.fov ?? 42,
      request.width / request.height,
      0.01,
      100_000,
    );
    camera.position.set(
      request.camera.position.x,
      request.camera.position.y,
      request.camera.position.z,
    );
    camera.lookAt(request.camera.target.x, request.camera.target.y, request.camera.target.z);
    camera.updateMatrixWorld(true);
    return camera;
  }
  const declared = authoredCameras(root);
  if (declared.length === 1) {
    const camera = declared[0]!.clone();
    camera.matrixWorld.copy(declared[0]!.matrixWorld);
    camera.matrixWorld.decompose(camera.position, camera.quaternion, camera.scale);
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.aspect = request.width / request.height;
      camera.updateProjectionMatrix();
    }
    return camera;
  }
  return fallbackCamera(root, request.width / request.height);
}

/** One chrome-free frame of the authored scene. No studio dressing is added. */
export function captureAuthoredThreeScenePreview(
  root: THREE.Object3D,
  scene: THREE.Scene,
  request: DocumentPreviewCaptureRequest,
  prepare?: (renderer: THREE.WebGLRenderer) => () => void,
): string {
  scene.updateMatrixWorld(true);
  const camera = captureCamera(root, request);
  const renderer = markHostRenderer(
    new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }),
  );
  let cleanup: (() => void) | undefined;
  try {
    cleanup = prepare?.(renderer);
    renderer.setPixelRatio(1);
    renderer.setSize(request.width, request.height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.setClearColor(0x20242b, scene.background === null ? 0 : 1);
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
  } finally {
    cleanup?.();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
