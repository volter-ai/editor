/// <reference lib="dom" />

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname } from 'node:path';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { TDSLoader } from 'three/addons/loaders/TDSLoader.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ModelConverter, ModelImportSettings } from '@volter/editor-sdk/session/project-serving';

/** three.js's conversion of the source formats its loaders read, as the asset library's
 *  model converter (`ProjectServingServices.registerModelConverter`). */
export const threeModelConverter: ModelConverter = {
  formats: ['fbx', 'obj', 'dae', 'stl', 'ply', '3ds'],
  convert: (primaryPath, format, settings) => convertStagedModelToGlb(primaryPath, format, settings),
};

/** Convert a staged source model to a runtime GLB without requiring Blender. */
export async function convertStagedModelToGlb(
  primaryPath: string,
  format: string,
  settings: ModelImportSettings,
): Promise<Uint8Array> {
  installNodeDom();
  const bytes = new Uint8Array(await readFile(primaryPath));
  const object = await parseSourceModel(primaryPath, format.toLowerCase(), bytes);
  discardUnloadedTextures(object);
  applyModelImportSettings(object, settings);
  installNodeFileReader();
  try {
    const result = await new Promise<ArrayBuffer>((resolve, reject) => {
      new GLTFExporter().parse(
        object,
        (output) =>
          output instanceof ArrayBuffer
            ? resolve(output)
            : reject(new Error('Model conversion produced JSON instead of binary GLB.')),
        reject,
        { binary: true, animations: object.animations, onlyVisible: false },
      );
    });
    const output = new Uint8Array(result);
    await validateConvertedGlb(output);
    return output;
  } finally {
    disposeObject(object);
  }
}

const materialTextureSlots = [
  'map',
  'alphaMap',
  'aoMap',
  'bumpMap',
  'displacementMap',
  'emissiveMap',
  'envMap',
  'lightMap',
  'metalnessMap',
  'normalMap',
  'roughnessMap',
  'specularMap',
] as const;

/** Apply the persisted conversion settings before the runtime GLB is exported. */
export function applyModelImportSettings(
  object: THREE.Object3D,
  settings: ModelImportSettings,
): void {
  object.scale.multiplyScalar(settings.scale * sourceUnitScale(settings.sourceUnits));
  object.quaternion.premultiply(importAxisRotation(settings.upAxis, settings.forwardAxis));

  const discardedTextures = new Set<THREE.Texture>();
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one traversal deliberately applies the persisted mesh, material, texture, normal, tangent, and optimization settings to each converted renderable.
  object.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.geometry) return;
    let geometry = mesh.geometry;
    if (settings.meshOptimization !== 'none') {
      const optimized = mergeVertices(
        geometry,
        settings.meshOptimization === 'aggressive' ? 1e-3 : 1e-6,
      );
      if (optimized !== geometry) {
        mesh.geometry = optimized;
        geometry.dispose();
        geometry = optimized;
      }
    }
    if (settings.normals !== 'preserve') {
      geometry.deleteAttribute('normal');
      geometry.computeVertexNormals();
    }
    if (settings.tangents === 'discard') geometry.deleteAttribute('tangent');
    if (
      settings.tangents === 'generate' &&
      geometry.index &&
      geometry.hasAttribute('position') &&
      geometry.hasAttribute('normal') &&
      geometry.hasAttribute('uv')
    ) {
      geometry.computeTangents();
    }
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const priorMaterials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    if (settings.materials === 'discard') {
      mesh.material = Array.isArray(mesh.material)
        ? priorMaterials.map(() => new THREE.MeshStandardMaterial())
        : new THREE.MeshStandardMaterial();
      for (const material of priorMaterials) material.dispose();
      return;
    }
    if (settings.textures !== 'discard') return;
    for (const material of priorMaterials) {
      const textured = material as THREE.Material & Record<string, unknown>;
      for (const slot of materialTextureSlots) {
        const texture = textured[slot];
        if (texture instanceof THREE.Texture) discardedTextures.add(texture);
        textured[slot] = null;
      }
      material.needsUpdate = true;
    }
  });
  for (const texture of discardedTextures) texture.dispose();

  if (settings.animations.length > 0) {
    const requested = new Set(settings.animations);
    const selected = object.animations.filter((clip) => requested.has(clip.name));
    const missing = settings.animations.filter(
      (name) => !selected.some((clip) => clip.name === name),
    );
    if (missing.length > 0) throw new Error(`Animation clips not found: ${missing.join(', ')}.`);
    object.animations = selected;
  }
  object.updateWorldMatrix(true, true);
}

function sourceUnitScale(units: ModelImportSettings['sourceUnits']): number {
  return { auto: 1, mm: 0.001, cm: 0.01, m: 1, in: 0.0254, ft: 0.3048 }[units];
}

function importAxisRotation(
  upAxis: ModelImportSettings['upAxis'],
  forwardAxis: ModelImportSettings['forwardAxis'],
): THREE.Quaternion {
  const up = upAxis === 'auto' ? null : axisVector(upAxis);
  const forward = forwardAxis === 'auto' ? null : axisVector(forwardAxis);
  if (up && forward) {
    if (Math.abs(up.dot(forward)) > 0.001)
      throw new Error('Import up and forward axes must be perpendicular.');
    const right = new THREE.Vector3().crossVectors(forward, up).normalize();
    const correctedForward = new THREE.Vector3().crossVectors(up, right).normalize();
    const sourceBasis = new THREE.Matrix4().makeBasis(right, up, correctedForward.clone().negate());
    return new THREE.Quaternion().setFromRotationMatrix(sourceBasis.invert());
  }
  if (up) return new THREE.Quaternion().setFromUnitVectors(up, new THREE.Vector3(0, 1, 0));
  if (forward)
    return new THREE.Quaternion().setFromUnitVectors(forward, new THREE.Vector3(0, 0, -1));
  return new THREE.Quaternion();
}

function axisVector(axis: Exclude<ModelImportSettings['forwardAxis'], 'auto'> | 'x' | 'y' | 'z') {
  const sign = axis.startsWith('-') ? -1 : 1;
  const name = axis.replace('-', '');
  return new THREE.Vector3(
    name === 'x' ? sign : 0,
    name === 'y' ? sign : 0,
    name === 'z' ? sign : 0,
  );
}

async function parseSourceModel(
  primaryPath: string,
  format: string,
  bytes: Uint8Array,
): Promise<THREE.Object3D> {
  const resourcePath = `${dirname(primaryPath)}/`;
  switch (format) {
    case 'fbx':
      return new FBXLoader().parse(bytes.buffer as ArrayBuffer, resourcePath);
    case 'obj': {
      const loader = new OBJLoader();
      const materialPath = primaryPath.replace(/\.obj$/i, '.mtl');
      try {
        const materials = new MTLLoader().parse(await readFile(materialPath, 'utf8'), resourcePath);
        materials.preload();
        loader.setMaterials(materials);
      } catch {
        // Geometry-only OBJ conversion remains valid when no MTL is present.
      }
      return loader.parse(new TextDecoder().decode(bytes));
    }
    case 'dae': {
      return new ColladaLoader().parse(new TextDecoder().decode(bytes), resourcePath).scene;
    }
    case 'stl': {
      const geometry = new STLLoader().parse(bytes.buffer as ArrayBuffer);
      return new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({ color: 0x8fb5da, roughness: 0.75 }),
      );
    }
    case 'ply': {
      const geometry = new PLYLoader().parse(bytes.buffer as ArrayBuffer);
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
    case '3ds':
      return new TDSLoader().parse(bytes.buffer as ArrayBuffer, resourcePath);
    default:
      throw new Error(`Built-in conversion does not support ${format || extname(primaryPath)}.`);
  }
}

/** Three's source loaders construct browser image elements even when the
 * conversion runs in Node. JSDOM supplies that parser boundary; unresolved
 * asynchronous images are removed below rather than passed to GLTFExporter
 * as invalid zero-sized image objects. */
function installNodeDom(): void {
  if (typeof document !== 'undefined' && typeof DOMParser !== 'undefined') return;
  const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
    JSDOM: new () => {
      window: {
        document: Document;
        DOMParser: typeof DOMParser;
        HTMLImageElement: typeof HTMLImageElement;
        HTMLCanvasElement: typeof HTMLCanvasElement;
        Image: typeof Image;
      };
    };
  };
  const window = new JSDOM().window;
  Object.assign(globalThis, {
    document: window.document,
    DOMParser: window.DOMParser,
    HTMLImageElement: window.HTMLImageElement,
    HTMLCanvasElement: window.HTMLCanvasElement,
    Image: window.Image,
  });
}

function discardUnloadedTextures(root: THREE.Object3D): void {
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one bounded traversal removes only unresolved image slots across every supported material shape.
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    for (const material of materials) {
      const textured = material as THREE.Material & Record<string, unknown>;
      for (const slot of materialTextureSlots) {
        const value = textured[slot];
        if (!(value instanceof THREE.Texture)) continue;
        const image = value.image as { width?: number; height?: number } | null;
        if (image && (image.width ?? 0) > 0 && (image.height ?? 0) > 0) continue;
        textured[slot] = null;
        value.dispose();
      }
      material.needsUpdate = true;
    }
  });
}

async function validateConvertedGlb(bytes: Uint8Array): Promise<void> {
  const parsed = await new GLTFLoader().parseAsync(Uint8Array.from(bytes).buffer, '');
  let renderable = false;
  parsed.scene.traverse((object) => {
    renderable ||= Boolean((object as THREE.Mesh).isMesh || (object as THREE.Points).isPoints);
  });
  disposeObject(parsed.scene);
  if (!renderable && parsed.animations.length === 0) {
    throw new Error('Converted GLB contains neither renderable geometry nor animation clips.');
  }
}

function installNodeFileReader(): void {
  if (typeof FileReader !== 'undefined') return;
  class NodeFileReader {
    result: string | ArrayBuffer | null = null;
    error: Error | null = null;
    onloadend: ((event: ProgressEvent<FileReader>) => void) | null = null;
    onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;
    readAsArrayBuffer(blob: Blob): void {
      void blob.arrayBuffer().then(
        (result) => {
          this.result = result;
          this.onloadend?.({ target: this } as unknown as ProgressEvent<FileReader>);
        },
        (error) => {
          this.error = error instanceof Error ? error : new Error(String(error));
          this.onerror?.({ target: this } as unknown as ProgressEvent<FileReader>);
        },
      );
    }
    readAsDataURL(blob: Blob): void {
      void blob.arrayBuffer().then((result) => {
        this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(result).toString('base64')}`;
        this.onloadend?.({ target: this } as unknown as ProgressEvent<FileReader>);
      });
    }
  }
  Object.assign(globalThis, { FileReader: NodeFileReader });
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    const renderable = object as THREE.Mesh;
    renderable.geometry?.dispose();
    const materials = Array.isArray(renderable.material)
      ? renderable.material
      : renderable.material
        ? [renderable.material]
        : [];
    for (const material of materials) {
      for (const value of Object.values(material))
        if (value instanceof THREE.Texture) value.dispose();
      material.dispose();
    }
  });
}
