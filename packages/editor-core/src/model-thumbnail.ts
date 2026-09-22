/**
 * Offscreen Three.js renderer that generates thumbnail images for supported 3D source formats.
 *
 * Usage:
 *   const renderer = getModelThumbnailRenderer();
 *   const dataUrl = await renderer.render('/assets/models/Robot.glb');
 *   // dataUrl is a PNG data-URL string suitable for <img src="...">
 *
 * - Singleton: one renderer is shared across all callers.
 * - Deduplicating: concurrent requests for the same URL share one render pass.
 * - Cached: once rendered, the data URL is returned immediately.
 * - Self-cleaning: each loaded object is disposed after the thumbnail is captured.
 */

import type { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import { markHostRenderer } from '@volter/editor-threejs/viewport/renderer-ownership';
import { loadSplat } from '@volter/editor-threejs/asset-loaders';
import { hasUserData } from '@volter/editor-threejs/ecs/user-data';
import { gltfLoader } from '@volter/editor-threejs/loader';
import { disposeSparkRendererWhenIdle } from '@volter/editor-threejs/render/spark-renderer-lifecycle';
import * as THREE from 'three';
import {
  applyStudioEnvironment,
  STUDIO_AMBIENT_WITH_ENVIRONMENT,
} from './three-viewport/studio-environment';

const SIZE = 128;

let instance: ModelThumbnailRenderer | null = null;

export type ModelThumbnailFormat =
  | 'glb'
  | 'gltf'
  | 'fbx'
  | 'obj'
  | 'dae'
  | 'stl'
  | 'ply'
  | 'spz'
  | 'bvh'
  | '3ds';

export interface ModelThumbnailSpec {
  url: string;
  format?: ModelThumbnailFormat;
  materialUrl?: string;
  background?: 'transparent' | 'neutral';
  output?: 'png' | 'webp';
}

const MODEL_THUMBNAIL_FORMATS = new Set<ModelThumbnailFormat>([
  'glb',
  'gltf',
  'fbx',
  'obj',
  'dae',
  'stl',
  'ply',
  'spz',
  'bvh',
  '3ds',
]);

export function modelThumbnailFormat(url: string): ModelThumbnailFormat | undefined {
  const pathname = url.split(/[?#]/, 1)[0]!.toLowerCase();
  const extension = pathname.slice(pathname.lastIndexOf('.') + 1) as ModelThumbnailFormat;
  return MODEL_THUMBNAIL_FORMATS.has(extension) ? extension : undefined;
}

export class ModelThumbnailRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private cache = new Map<string, string>();
  private pending = new Map<string, Promise<string>>();
  private sparkRenderer: SparkRenderer | null = null;
  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;

    this.renderer = markHostRenderer(
      new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        preserveDrawingBuffer: true,
      }),
    );
    this.renderer.setSize(SIZE, SIZE);
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.scene = new THREE.Scene();

    // The neutral studio IBL, so a PBR metal has something to reflect — a
    // `metalness: 1` material has no diffuse term and thumbnails it black
    // otherwise. `scene.background` is untouched: the thumbnail canvas stays
    // alpha, as every caller composites it. The bake lives as long as this
    // renderer does (there is no teardown path for either — one instance,
    // held for the editor's lifetime by `getModelThumbnailRenderer`).
    applyStudioEnvironment(this.scene, this.renderer);

    // Soft ambient fill, scaled back now that the environment carries the
    // ambient term properly.
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.8 * STUDIO_AMBIENT_WITH_ENVIRONMENT));

    // Key light (upper-right-front)
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(3, 5, 4);
    this.scene.add(key);

    // Fill light (lower-left, dimmer, warm)
    const fill = new THREE.DirectionalLight(0xffeedd, 0.4);
    fill.position.set(-3, -1, 2);
    this.scene.add(fill);

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
  }

  /** Render a thumbnail for the given model URL. Returns a PNG data-URL. */
  async render(input: string | ModelThumbnailSpec): Promise<string> {
    const spec: ModelThumbnailSpec = typeof input === 'string' ? { url: input } : input;
    const format = spec.format ?? modelThumbnailFormat(spec.url);
    if (!format) throw new Error(`No thumbnail loader for ${spec.url}`);
    const resolved: ModelThumbnailSpec & { format: ModelThumbnailFormat } = { ...spec, format };
    const key = JSON.stringify(resolved);
    const cached = this.cache.get(key);
    if (cached) return cached;

    // Deduplicate concurrent requests for the same URL
    const inflight = this.pending.get(key);
    if (inflight) return inflight;

    const promise = this._render(resolved);
    this.pending.set(key, promise);
    try {
      const dataUrl = await promise;
      this.cache.set(key, dataUrl);
      return dataUrl;
    } finally {
      this.pending.delete(key);
    }
  }

  private async _render(
    spec: ModelThumbnailSpec & { format: ModelThumbnailFormat },
  ): Promise<string> {
    const group = createModelPreviewSource(await loadModelThumbnailObject(spec));

    this.scene.add(group);
    if (spec.format === 'spz' && !this.sparkRenderer) {
      const { SparkRenderer } = await import('@sparkjsdev/spark');
      this.sparkRenderer = new SparkRenderer({ renderer: this.renderer, enableLod: false });
      this.scene.add(this.sparkRenderer);
    }

    // Auto-frame the camera around the model
    const box = modelPreviewBounds(group);
    if (box.isEmpty()) {
      this.scene.remove(group);
      throw new Error('Model contains no previewable geometry.');
    }
    const center = box.getCenter(new THREE.Vector3());
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const fovRad = (this.camera.fov * Math.PI) / 180;
    const dist = (Math.max(sphere.radius, 0.0001) / Math.sin(fovRad / 2)) * 1.18;
    const direction = new THREE.Vector3(0.65, 0.45, 0.65).normalize();

    // Position camera at a 3/4 angle (slightly above, rotated 30° from front)
    this.camera.position.set(
      center.x + dist * direction.x,
      center.y + dist * direction.y,
      center.z + dist * direction.z,
    );
    this.camera.lookAt(center);
    this.camera.near = dist * 0.01;
    this.camera.far = dist * 20;
    this.camera.updateProjectionMatrix();

    // Render
    if (spec.background === 'neutral') this.renderer.setClearColor(0x20242a, 1);
    else this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    const outputCanvas = strengthenThinThumbnailSilhouette(
      this.renderer.domElement,
      spec.background === 'neutral',
    );
    const dataUrl =
      spec.output === 'webp'
        ? outputCanvas.toDataURL('image/webp', 0.86)
        : outputCanvas.toDataURL('image/png');

    // Clean up the loaded GLTF to free GPU memory
    this.scene.remove(group);
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Disposal enumerates the texture slots used by the supported Three.js materials.
    group.traverse((obj) => {
      if (hasUserData(obj, 'gaussianSplat')) (obj as SplatMesh).dispose();
      const renderable = obj as THREE.Mesh | THREE.Line | THREE.Points;
      if (renderable.geometry) renderable.geometry.dispose();
      if (renderable.material) {
        const materials = Array.isArray(renderable.material)
          ? renderable.material
          : [renderable.material];
        for (const mat of materials) {
          // Dispose any textures attached to the material
          if ('map' in mat && mat.map instanceof THREE.Texture) mat.map.dispose();
          if ('normalMap' in mat && mat.normalMap instanceof THREE.Texture) mat.normalMap.dispose();
          if ('emissiveMap' in mat && mat.emissiveMap instanceof THREE.Texture)
            mat.emissiveMap.dispose();
          if ('aoMap' in mat && mat.aoMap instanceof THREE.Texture) mat.aoMap.dispose();
          if ('roughnessMap' in mat && mat.roughnessMap instanceof THREE.Texture)
            mat.roughnessMap.dispose();
          if ('metalnessMap' in mat && mat.metalnessMap instanceof THREE.Texture)
            mat.metalnessMap.dispose();
          mat.dispose();
        }
      }
    });

    return dataUrl;
  }

  dispose() {
    if (this.sparkRenderer) {
      this.scene.remove(this.sparkRenderer);
      disposeSparkRendererWhenIdle(this.sparkRenderer);
      this.sparkRenderer = null;
    }
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.cache.clear();
    instance = null;
  }
}

function strengthenThinThumbnailSilhouette(
  source: HTMLCanvasElement,
  neutralBackground: boolean,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return source;
  context.drawImage(source, 0, 0);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const visible = new Uint8Array(canvas.width * canvas.height);
  let visibleCount = 0;
  for (let pixel = 0; pixel < visible.length; pixel++) {
    const offset = pixel * 4;
    const isVisible = neutralBackground
      ? Math.abs(image.data[offset]! - 32) > 3 ||
        Math.abs(image.data[offset + 1]! - 36) > 3 ||
        Math.abs(image.data[offset + 2]! - 42) > 3
      : image.data[offset + 3]! > 8;
    if (isVisible) {
      visible[pixel] = 1;
      visibleCount++;
    }
  }
  const ratio = visibleCount / visible.length;
  if (ratio < 0.0001) return canvas;
  const original = new Uint8ClampedArray(image.data);
  if (neutralBackground) {
    for (let pixel = 0; pixel < visible.length; pixel++) {
      if (!visible[pixel]) continue;
      const offset = pixel * 4;
      const luminance =
        original[offset]! * 0.2126 +
        original[offset + 1]! * 0.7152 +
        original[offset + 2]! * 0.0722;
      if (luminance >= 88) continue;
      const lift = 88 - luminance;
      image.data[offset] = Math.min(255, original[offset]! + lift);
      image.data[offset + 1] = Math.min(255, original[offset + 1]! + lift);
      image.data[offset + 2] = Math.min(255, original[offset + 2]! + lift);
    }
  }
  const dilationPasses = ratio < 0.004 ? 2 : ratio < 0.02 ? 1 : 0;
  let currentVisible = visible;
  for (let pass = 0; pass < dilationPasses; pass++) {
    const nextVisible = currentVisible.slice();
    const passPixels = new Uint8ClampedArray(image.data);
    for (let y = 1; y < canvas.height - 1; y++) {
      for (let x = 1; x < canvas.width - 1; x++) {
        const pixel = y * canvas.width + x;
        if (currentVisible[pixel]) continue;
        const neighbor = [pixel - 1, pixel + 1, pixel - canvas.width, pixel + canvas.width].find(
          (candidate) => currentVisible[candidate],
        );
        if (neighbor === undefined) continue;
        const targetOffset = pixel * 4;
        const sourceOffset = neighbor * 4;
        image.data.set(passPixels.subarray(sourceOffset, sourceOffset + 4), targetOffset);
        nextVisible[pixel] = 1;
      }
    }
    currentVisible = nextVisible;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

/** Bind-pose geometry bounds avoid malformed/outlier skin transforms shrinking a preview to a dot. */
export function modelPreviewBounds(model: THREE.Object3D): THREE.Box3 {
  model.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3();
  const candidate = new THREE.Box3();
  model.traverseVisible((object) => {
    if (hasUserData(object, 'gaussianSplat')) {
      candidate.copy((object as SplatMesh).getBoundingBox()).applyMatrix4(object.matrixWorld);
      bounds.union(candidate);
      return;
    }
    const renderable = object as THREE.Mesh | THREE.Line | THREE.Points;
    if (!renderable.geometry) return;
    if (!renderable.geometry.boundingBox) renderable.geometry.computeBoundingBox();
    if (!renderable.geometry.boundingBox) return;
    candidate.copy(renderable.geometry.boundingBox).applyMatrix4(object.matrixWorld);
    bounds.union(candidate);
  });
  return bounds;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This format dispatcher keeps each Three.js loader path visible in one place.
export async function loadModelThumbnailObject(
  spec: ModelThumbnailSpec & { format: ModelThumbnailFormat },
): Promise<THREE.Object3D> {
  switch (spec.format) {
    case 'glb':
    case 'gltf': {
      const gltf = await gltfLoader.loadAsync(spec.url);
      gltf.scene.animations = [...gltf.animations];
      return gltf.scene;
    }
    case 'fbx': {
      const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
      return new FBXLoader().loadAsync(spec.url);
    }
    case 'obj': {
      const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
      const materialUrl = spec.materialUrl ?? (await discoverObjMaterial(spec.url));
      const loader = new OBJLoader();
      if (materialUrl) {
        const { MTLLoader } = await import('three/addons/loaders/MTLLoader.js');
        const materials = await new MTLLoader().loadAsync(materialUrl);
        materials.preload();
        loader.setMaterials(materials);
      }
      return loader.loadAsync(spec.url);
    }
    case 'dae': {
      const { ColladaLoader } = await import('three/addons/loaders/ColladaLoader.js');
      const collada = await new ColladaLoader().loadAsync(spec.url);
      const animations = (collada as unknown as { animations?: THREE.AnimationClip[] }).animations;
      if (animations) collada.scene.animations = [...animations];
      return collada.scene;
    }
    case 'stl': {
      const { STLLoader } = await import('three/addons/loaders/STLLoader.js');
      const geometry = await new STLLoader().loadAsync(spec.url);
      return new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({ color: 0x75a7d8, roughness: 0.75 }),
      );
    }
    case 'ply': {
      const { PLYLoader } = await import('three/addons/loaders/PLYLoader.js');
      const geometry = await new PLYLoader().loadAsync(spec.url);
      if (geometry.index || geometry.hasAttribute('normal')) {
        if (!geometry.hasAttribute('normal')) geometry.computeVertexNormals();
        return new THREE.Mesh(
          geometry,
          new THREE.MeshStandardMaterial({
            color: geometry.hasAttribute('color') ? 0xffffff : 0xb8d09b,
            vertexColors: geometry.hasAttribute('color'),
            roughness: 0.8,
            side: THREE.DoubleSide,
          }),
        );
      }
      geometry.computeBoundingBox();
      const diagonal = geometry.boundingBox?.getSize(new THREE.Vector3()).length() ?? 1;
      return new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
          color: geometry.hasAttribute('color') ? 0xffffff : 0xb8d09b,
          vertexColors: geometry.hasAttribute('color'),
          size: Math.max(diagonal / 220, 0.0001),
          sizeAttenuation: true,
        }),
      );
    }
    case 'spz':
      return loadSplat(spec.url);
    case 'bvh': {
      const { BVHLoader } = await import('three/addons/loaders/BVHLoader.js');
      const result = await new BVHLoader().loadAsync(spec.url);
      const root = result.skeleton.bones[0];
      if (!root) throw new Error('BVH contains no skeleton root.');
      const group = new THREE.Group();
      group.animations = [result.clip];
      group.add(root);
      return group;
    }
    case '3ds': {
      const { TDSLoader } = await import('three/addons/loaders/TDSLoader.js');
      return new TDSLoader().loadAsync(spec.url);
    }
  }
}

/**
 * Give animation-only model files an honest renderable representation.
 * FBX/glTF animation exports commonly contain a complete bone hierarchy and
 * clips but no mesh. They are valid assets, so Asset Editor visualizes their
 * current skeleton instead of misreporting them as an empty source.
 */
export function createModelPreviewSource(model: THREE.Object3D): THREE.Object3D {
  if (hasRenderableModelContent(model)) return model;

  model.updateWorldMatrix(true, true);
  const helper = new THREE.SkeletonHelper(model);
  const positions = helper.geometry.getAttribute('position');
  if (!positions || positions.count === 0) {
    helper.dispose();
    return model;
  }

  helper.name = 'Asset Editor skeleton preview';
  helper.frustumCulled = false;
  const previewRoot = new THREE.Group();
  previewRoot.name = model.name;
  previewRoot.animations = [...model.animations];
  previewRoot.add(model, helper);
  previewRoot.updateWorldMatrix(true, true);
  // SkeletonHelper updates its dynamic line vertices from updateMatrixWorld,
  // while the read-only preview measurer intentionally calls updateWorldMatrix.
  // Materialize the current pose once so framing sees the real skeleton span.
  helper.updateMatrixWorld(true);
  return previewRoot;
}

function hasRenderableModelContent(model: THREE.Object3D): boolean {
  let renderable = false;
  model.traverseVisible((object) => {
    if (!renderable && objectHasRenderableModelContent(object)) renderable = true;
  });
  return renderable;
}

function objectHasRenderableModelContent(object: THREE.Object3D): boolean {
  const sprite = object as THREE.Sprite;
  if (sprite.isSprite) return sprite.material.visible;
  const mesh = object as THREE.Mesh;
  const line = object as THREE.Line;
  const points = object as THREE.Points;
  if (!mesh.isMesh && !line.isLine && !points.isPoints) return false;
  const drawable = object as THREE.Mesh;
  const instanced = object as THREE.InstancedMesh;
  if (instanced.isInstancedMesh && instanced.count === 0) return false;
  const materials = Array.isArray(drawable.material) ? drawable.material : [drawable.material];
  if (materials.length === 0 || materials.every((material) => !material?.visible)) return false;
  const positions = drawable.geometry?.getAttribute('position');
  return Boolean(positions && positions.count > 0 && drawable.geometry.drawRange.count !== 0);
}

async function discoverObjMaterial(url: string): Promise<string | undefined> {
  const pathname = url.split(/[?#]/, 1)[0]!;
  const materialUrl = `${pathname.slice(0, pathname.lastIndexOf('.'))}.mtl`;
  try {
    const response = await fetch(materialUrl, { method: 'HEAD' });
    return response.ok ? materialUrl : undefined;
  } catch {
    return undefined;
  }
}

/** Normalize an upstream/source preview image through the same thumbnail canvas. */
export async function renderImageThumbnail(
  url: string,
  options: { output?: 'png' | 'webp'; background?: 'transparent' | 'neutral' } = {},
): Promise<string> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error(`Failed to load preview image: ${url}`));
    element.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D thumbnail canvas is unavailable.');
  if (options.background === 'neutral') {
    context.fillStyle = '#20242a';
    context.fillRect(0, 0, SIZE, SIZE);
  }
  const scale = Math.min(SIZE / image.naturalWidth, SIZE / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  context.drawImage(image, (SIZE - width) / 2, (SIZE - height) / 2, width, height);
  return options.output === 'webp'
    ? canvas.toDataURL('image/webp', 0.86)
    : canvas.toDataURL('image/png');
}

/** Get (or create) the shared thumbnail renderer. */
export function getModelThumbnailRenderer(): ModelThumbnailRenderer {
  if (!instance) instance = new ModelThumbnailRenderer();
  return instance;
}

// A Fast Refresh invalidation creates a fresh module singleton. Release the
// previous module's offscreen WebGL context first instead of silently leaking
// one context per AssetBrowser edit.
if (import.meta.hot) {
  import.meta.hot.dispose(() => instance?.dispose());
}
