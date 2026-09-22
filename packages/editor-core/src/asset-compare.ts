/**
 * B8.4 — the Asset Lab COMPARE surface (`vgai screenshot <model.glb>
 * --compare <ref.glb>`): renders the project asset AND a caller-supplied reference GLB
 * with matched orthographic front + side framing, then scores their
 * silhouettes (IoU) and composes review overlays, so an agent can
 * numerically converge a procedural character toward a reference.
 *
 * Framing is DELIBERATELY bounding-box based (equal-height normalization,
 * shared ground plane, centered footprint) rather than the humanoid shot
 * set's Mixamo-skeleton anchors: the reference may carry any rig (UE joint
 * names, no rig at all), and the bone-anchored path throws on missing joints
 * by design. Both models are yaw-normalized to FACE the front camera —
 * forward read from GLB `extras`/`userData.forward` when present (our
 * generated rigs persist `[0,0,-1]`), else the glTF +Z convention, with an
 * explicit reference override for models whose extras lie.
 *
 * Pure scoring math lives in `asset-compare-core.ts` (unit-tested in node);
 * this module owns only loading, scene assembly, and WebGL capture. Fixed
 * cameras + fixed resolution + flat unlit override ⇒ identical IoU numbers
 * across runs (a stated acceptance gate).
 */

import { markHostRenderer } from '@volter/editor-threejs/viewport/renderer-ownership';
import * as THREE from 'three';
import {
  ASSET_COMPARE_VIEWS,
  type AssetCompareView,
  COMPARE_FRAME_CENTER_Y,
  COMPARE_FRAME_HALF_HEIGHT,
  forwardYawRadians,
  maskIoU,
  normalizedPlacement,
  overlayRgba,
  silhouetteMaskFromRgba,
} from './asset-compare-core';
import {
  checkedDimension,
  createAssetPreviewSnapshot,
  disposeAssetPreviewSnapshot,
  disposeProjectAssetModel,
  loadProjectAssetModel,
  measureAssetPreview,
  parseGlbBytesModel,
  pngBase64,
  readModelForward,
} from './asset-preview';

export type { AssetCompareView } from './asset-compare-core';
// The forward detection moved to `asset-preview.ts` (the shot sets need it
// too); re-exported here so compare-mode consumers keep their import path.
export { readModelForward } from './asset-preview';

export interface AssetCompareImage {
  base64: string;
  mimeType: 'image/png';
}

export interface AssetCompareViewResult {
  view: AssetCompareView;
  /** Silhouette intersection-over-union in [0, 1]. */
  iou: number;
  /** Both silhouettes in distinct colors (orange asset / cyan ref / white agreement). */
  overlay: AssetCompareImage;
  /** The asset's own silhouette (white on black), as captured for scoring. */
  asset: AssetCompareImage;
  /** The reference's silhouette (white on black), as captured for scoring. */
  ref: AssetCompareImage;
}

export interface AssetCompareCapture {
  width: number;
  height: number;
  views: AssetCompareViewResult[];
}

export interface AssetCompareOptions {
  width?: number;
  height?: number;
  /** Override the reference GLB's forward vector (its facing in the ground
   *  plane). Defaults to the GLB's own `userData.forward` extras, else +Z. */
  refForward?: [number, number, number];
}

const SILHOUETTE_BACKGROUND = 0x000000;
const SILHOUETTE_FOREGROUND = 0xffffff;
const COMPARE_CAMERA_DISTANCE = 10;

/** The base64-GLB decoder moved to `asset-preview.ts` (`parseGlbBytesModel`)
 *  when the module-look lane needed the same wire-carried bytes; this keeps
 *  compare's own error wording. */
function parseRefGlb(base64: string): Promise<THREE.Object3D> {
  return parseGlbBytesModel(base64, 'Compare reference GLB');
}

/** Snapshot + face-the-camera yaw + equal-height ground-aligned placement,
 *  as one disposable wrapper ready to drop into a silhouette scene. */
function buildNormalizedSubject(
  source: THREE.Object3D,
  forward: [number, number, number],
): { wrapper: THREE.Object3D; dispose: () => void } {
  const snapshot = createAssetPreviewSnapshot(source);
  const pivot = new THREE.Group();
  pivot.rotation.y = forwardYawRadians(forward);
  pivot.add(snapshot);
  const wrapper = new THREE.Group();
  wrapper.add(pivot);
  wrapper.updateWorldMatrix(true, true);
  const bounds = measureAssetPreview(wrapper, 'front');
  const min: [number, number, number] = [
    bounds.center.x - bounds.size.x / 2,
    bounds.center.y - bounds.size.y / 2,
    bounds.center.z - bounds.size.z / 2,
  ];
  const max: [number, number, number] = [
    bounds.center.x + bounds.size.x / 2,
    bounds.center.y + bounds.size.y / 2,
    bounds.center.z + bounds.size.z / 2,
  ];
  const placement = normalizedPlacement(min, max);
  wrapper.scale.setScalar(placement.scale);
  wrapper.position.set(...placement.position);
  wrapper.updateWorldMatrix(true, true);
  return { wrapper, dispose: () => disposeAssetPreviewSnapshot(snapshot) };
}

function compareCamera(view: AssetCompareView, aspect: number): THREE.OrthographicCamera {
  const halfHeight = COMPARE_FRAME_HALF_HEIGHT;
  const halfWidth = halfHeight * aspect;
  const camera = new THREE.OrthographicCamera(
    -halfWidth,
    halfWidth,
    halfHeight,
    -halfHeight,
    0.01,
    COMPARE_CAMERA_DISTANCE * 4,
  );
  const direction = view === 'front' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  camera.position
    .set(0, COMPARE_FRAME_CENTER_Y, 0)
    .addScaledVector(direction, COMPARE_CAMERA_DISTANCE);
  camera.up.set(0, 1, 0);
  camera.lookAt(0, COMPARE_FRAME_CENTER_Y, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

interface SilhouetteShot {
  image: AssetCompareImage;
  mask: Uint8Array;
}

/**
 * Compare an already-loaded asset model against an already-loaded reference:
 * the shared capture core behind both the asset-path and entity entry
 * points. Neither input is mutated (both are snapshotted).
 */
export function captureAssetComparePreview(
  assetSource: THREE.Object3D,
  refSource: THREE.Object3D,
  options: AssetCompareOptions = {},
): AssetCompareCapture {
  const width = checkedDimension(options.width);
  const height = checkedDimension(options.height);
  const aspect = width / height;
  const disposers: Array<() => void> = [];
  let renderer: THREE.WebGLRenderer | null = null;
  try {
    const asset = buildNormalizedSubject(assetSource, readModelForward(assetSource));
    disposers.push(asset.dispose);
    const ref = buildNormalizedSubject(
      refSource,
      options.refForward ?? readModelForward(refSource),
    );
    disposers.push(ref.dispose);

    const override = new THREE.MeshBasicMaterial({ color: SILHOUETTE_FOREGROUND });
    disposers.push(() => override.dispose());
    const sceneFor = (subject: THREE.Object3D): THREE.Scene => {
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(SILHOUETTE_BACKGROUND);
      scene.overrideMaterial = override;
      scene.add(subject);
      return scene;
    };
    const assetScene = sceneFor(asset.wrapper);
    const refScene = sceneFor(ref.wrapper);

    // Antialiasing off: silhouette masks want a crisp, deterministic
    // coverage decision per pixel, not blended edge ramps.
    const activeRenderer = markHostRenderer(
      new THREE.WebGLRenderer({
        antialias: false,
        alpha: false,
        preserveDrawingBuffer: true,
      }),
    );
    renderer = activeRenderer;
    activeRenderer.setPixelRatio(1);
    activeRenderer.toneMapping = THREE.NoToneMapping;
    activeRenderer.setClearColor(SILHOUETTE_BACKGROUND, 1);
    activeRenderer.setSize(width, height, false);

    const readCanvas = document.createElement('canvas');
    readCanvas.width = width;
    readCanvas.height = height;
    const readContext = readCanvas.getContext('2d');
    if (!readContext) throw new Error('Unable to create the compare readback canvas.');

    const captureSilhouette = (
      scene: THREE.Scene,
      camera: THREE.Camera,
      label: string,
      view: AssetCompareView,
    ): SilhouetteShot => {
      activeRenderer.render(scene, camera);
      readContext.clearRect(0, 0, width, height);
      readContext.drawImage(activeRenderer.domElement, 0, 0);
      const rgba = readContext.getImageData(0, 0, width, height).data;
      const mask = silhouetteMaskFromRgba(rgba, width * height);
      if (!mask.some((value) => value !== 0)) {
        throw new Error(
          `Compare ${view} view rendered an empty ${label} silhouette — nothing to score.`,
        );
      }
      return {
        image: { base64: pngBase64(readCanvas), mimeType: 'image/png' },
        mask,
      };
    };

    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = width;
    overlayCanvas.height = height;
    const overlayContext = overlayCanvas.getContext('2d');
    if (!overlayContext) throw new Error('Unable to create the compare overlay canvas.');

    const views: AssetCompareViewResult[] = [];
    for (const view of ASSET_COMPARE_VIEWS) {
      const camera = compareCamera(view, aspect);
      const assetShot = captureSilhouette(assetScene, camera, 'asset', view);
      const refShot = captureSilhouette(refScene, camera, 'reference', view);
      const stats = maskIoU(assetShot.mask, refShot.mask);
      overlayContext.putImageData(
        new ImageData(overlayRgba(assetShot.mask, refShot.mask), width, height),
        0,
        0,
      );
      views.push({
        view,
        iou: stats.iou,
        overlay: { base64: pngBase64(overlayCanvas), mimeType: 'image/png' },
        asset: assetShot.image,
        ref: refShot.image,
      });
    }
    return { width, height, views };
  } finally {
    renderer?.dispose();
    renderer?.forceContextLoss();
    for (const dispose of disposers.reverse()) dispose();
  }
}

/** The `--asset <path> --compare` entry point: loads the project GLB the
 *  same bounded/validated way the other asset-path captures do, parses the
 *  relayed reference GLB bytes, and scores them. */
export async function captureModelComparePreview(
  assetPath: string,
  refGlbBase64: string,
  options: AssetCompareOptions = {},
): Promise<AssetCompareCapture> {
  const model = await loadProjectAssetModel(assetPath);
  try {
    return await captureEntityComparePreview(model, refGlbBase64, options);
  } finally {
    disposeProjectAssetModel(model);
  }
}

/** The `--entity <id> --compare` entry point (also the shared tail of the
 *  asset-path leg): parses the reference and runs the capture core. */
export async function captureEntityComparePreview(
  entity: THREE.Object3D,
  refGlbBase64: string,
  options: AssetCompareOptions = {},
): Promise<AssetCompareCapture> {
  const refModel = await parseRefGlb(refGlbBase64);
  try {
    return captureAssetComparePreview(entity, refModel, options);
  } finally {
    disposeProjectAssetModel(refModel);
  }
}
