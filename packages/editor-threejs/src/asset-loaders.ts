/**
 * Canonical GLTF / texture load + cache layer (A2). (Formerly also hosted the
 * `.animgraph.json` loader — removed by E5; see
 * packages/threejs-runtime/src/animation/xstate-animation-binding.ts.)
 *
 * ONE place that owns the URL-keyed caches and the clone-safety contract, shared
 * by BOTH the engine runtime (scene-loader, create-runtime) AND the editor
 * (entity-factory, scene-sync). Previously this logic was duplicated across six
 * sites with three separate GLTF caches and four GLTFLoader instances, so fixes
 * (DRACO wiring, the `__sharedGeometry` clone-safety tag, skybox handling) did
 * not propagate. Everything funnels through the shared loaders in `../loader`
 * (`gltfLoader` is DRACO-wired — CB2 — and `textureLoader` shares the engine
 * LoadingManager / asset-prefix rewrite).
 *
 * Cache lifetime / P1.8: these caches are intentionally module-level and persist
 * ACROSS hot-reloads / scene switches (they are NOT cleared on every scene load).
 * This is deliberate: (1) it makes repeated Play→Stop→Play cheap, and (2) it
 * underpins the `__sharedGeometry` contract from P0.2 — GLTF clones share the
 * cached source geometry, so clearing mid-session would orphan live clones. The
 * caches are keyed by URL, so loading the SAME asset N times is bounded (one
 * entry per distinct URL, not per load). They are released only on full runtime
 * teardown via {@link clearAssetCaches}.
 */

import type { SplatMesh } from '@sparkjsdev/spark';
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { AssetParseError } from './asset-parse-error';
import { setUserData } from './ecs/user-data';
import { gltfLoader, resolveUrl, textureLoader } from './loader';

const textureCache = new Map<string, THREE.Texture>();
const gltfCache = new Map<
  string,
  Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>
>();
const splatBytesCache = new Map<string, Promise<Uint8Array>>();

/** Load (and cache) a texture via the shared, prefix-aware TextureLoader. */
export function loadTexture(url: string): THREE.Texture {
  const cached = textureCache.get(url);
  if (cached) return cached;
  const tex = textureLoader.load(url);
  textureCache.set(url, tex);
  return tex;
}

/**
 * Load a GLTF/GLB and return a fresh, disposal-safe clone (+ the source's
 * animation clips). DRACO decoding is handled by the shared `gltfLoader`.
 *
 * Clone-safety contract (P0.2 — load-bearing, tested):
 * `SkeletonUtils.clone` shares geometry AND materials with the cached source.
 * We give each clone its OWN materials (so scene cleanup can dispose them
 * without corrupting the cache) and tag every mesh `userData.__sharedGeometry`
 * so cleanup (engine create-runtime fullCleanup + editor scene-sync
 * disposeObject3D) skips disposing the shared geometry buffers.
 */
export function loadGLTF(
  url: string,
): Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }> {
  let cached = gltfCache.get(url);
  if (!cached) {
    cached = new Promise((resolve, reject) => {
      gltfLoader.load(
        url,
        (gltf) => resolve({ scene: gltf.scene, animations: gltf.animations }),
        undefined,
        (err) => reject(err),
      );
    });
    gltfCache.set(url, cached);
  }
  return cached.then((entry) => {
    const scene = SkeletonUtils.clone(entry.scene) as THREE.Group;
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.material = Array.isArray(child.material)
          ? child.material.map((m) => m.clone())
          : child.material.clone();
        setUserData(child, '__sharedGeometry', true);
      }
    });
    return { scene, animations: entry.animations };
  });
}

/**
 * Load one native Gaussian-splat asset as Spark's own Object3D.
 *
 * The URL cache stores immutable source bytes, not a live SplatMesh: every scene
 * entity needs its own transformable/disposable Object3D, while repeated uses of
 * the same SPZ must not download the multi-megabyte source more than once.
 * Spark stays a lazy chunk so games without splats do not pay its bundle cost.
 */
export async function loadSplat(url: string, providedBytes?: Uint8Array): Promise<SplatMesh> {
  let bytes = splatBytesCache.get(url);
  if (!bytes && providedBytes) {
    bytes = Promise.resolve(providedBytes);
    splatBytesCache.set(url, bytes);
  }
  if (!bytes) {
    bytes = fetch(resolveUrl(url)).then(async (response) => {
      if (!response.ok) {
        throw new Error(
          `Failed to load Gaussian splat: ${url} (${response.status} ${response.statusText})`,
        );
      }
      return new Uint8Array(await response.arrayBuffer());
    });
    splatBytesCache.set(url, bytes);
  }

  try {
    const [{ SplatMesh }, fileBytes] = await Promise.all([import('@sparkjsdev/spark'), bytes]);
    const mesh = new SplatMesh({ fileBytes, fileName: url, raycastable: true });
    await mesh.initialized;
    setUserData(mesh, 'gaussianSplat', { src: url, numSplats: mesh.numSplats });
    const bounds = mesh.getBoundingBox();
    if (!bounds.isEmpty()) {
      // Three's generic Box3.setFromObject only understands geometry-bearing
      // Object3Ds. Spark intentionally renders without THREE.BufferGeometry,
      // so give editor/runtime framing a hidden, non-pickable bounds proxy.
      // It is infrastructure, never authored hierarchy or rendered content.
      // Include a framing margin. This proxy is consumed by generic editor
      // focus/selection bounds, while inspectors continue to report Spark's
      // exact Gaussian bounds directly.
      const size = bounds.getSize(new THREE.Vector3()).multiplyScalar(1.5);
      const center = bounds.getCenter(new THREE.Vector3());
      const proxy = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z));
      proxy.name = '__vgai_splat_bounds';
      proxy.position.copy(center);
      proxy.visible = false;
      proxy.raycast = () => {};
      setUserData(proxy, 'engineInternal', true);
      mesh.add(proxy);
    }
    return mesh;
  } catch (error) {
    // A failed fetch must be retryable after the source is repaired or the
    // network recovers; successful source bytes remain cached across instances.
    splatBytesCache.delete(url);
    throw error;
  }
}

/**
 * Resolve a single named node inside an already-loaded glTF scene graph (F4,
 * `mesh.node`). Pure and headlessly testable — no fetch, no cache lookups;
 * callers pass the `scene` they already got from {@link loadGLTF}.
 *
 * The returned node is the SAME object (and shares the SAME geometry) as
 * found in `scene` — nothing is cloned or copied out. `scene` is already a
 * fresh `SkeletonUtils.clone()` per {@link loadGLTF}'s clone-safety contract,
 * so mutating/detaching the returned node is safe.
 *
 * Atomic-subtree guard: a `SkinnedMesh` cannot be lifted out of its armature
 * (its skeleton/bind matrices reference sibling bone nodes elsewhere in the
 * hierarchy), so resolving a node that IS a SkinnedMesh, or that CONTAINS one,
 * throws a loud `AssetParseError` instead of silently producing broken skinning.
 */
export function resolveGltfNode(
  scene: THREE.Object3D,
  nodeName: string,
  src: string,
): THREE.Object3D {
  const node = scene.getObjectByName(nodeName);
  if (!node) {
    throw new AssetParseError(
      [
        {
          code: 'custom',
          path: ['mesh', 'node'],
          message: `glTF "${src}" has no node named "${nodeName}" (getObjectByName found nothing)`,
        },
      ],
      src,
    );
  }

  const isSkinned = (o: THREE.Object3D) => (o as THREE.SkinnedMesh).isSkinnedMesh;
  let containsSkinned = isSkinned(node);
  if (!containsSkinned) {
    node.traverse((child) => {
      if (isSkinned(child)) containsSkinned = true;
    });
  }
  if (containsSkinned) {
    throw new AssetParseError(
      [
        {
          code: 'custom',
          path: ['mesh', 'node'],
          message:
            `glTF "${src}" node "${nodeName}" is (or contains) a SkinnedMesh — a skinned mesh ` +
            'cannot be lifted out of its armature (atomic-subtree rule). Reference the whole ' +
            'file instead of a `node`, or bake/export a non-skinned sub-asset.',
        },
      ],
      src,
    );
  }

  return node;
}

/**
 * Clear the module-level GLTF / texture caches. Call on full runtime teardown
 * (create-runtime fullCleanup / hot-reload) to release cached GPU resources
 * and avoid leaking across editor Play sessions. See the lifetime note at the
 * top of this file for why these are NOT cleared per scene load.
 *
 * NOTE: the IBL/skybox env-map cache lives in scene-loader (it needs a
 * WebGLRenderer for PMREM); scene-loader's `clearAssetCaches` wraps this and
 * also clears that env cache.
 */
export function clearAssetCaches(): void {
  textureCache.clear();
  gltfCache.clear();
  splatBytesCache.clear();
}

/**
 * Drop the cached entry for ONE asset URL after its bytes changed on disk
 * (editor asset-optimization write-back — W4a). Existing clones keep their
 * shared geometry alive (the cache entry only owns the lookup, not the
 * buffers), and the next `loadGLTF`/`loadTexture` for this URL re-fetches the
 * rewritten file instead of serving stale bytes.
 */
export function invalidateCachedAsset(url: string): void {
  textureCache.delete(url);
  gltfCache.delete(url);
}

/**
 * Test-only: current sizes of the module-level caches. Used by the P1.8 headless
 * test to assert caches stay bounded (one entry per distinct asset URL) across
 * repeated loads of the same scene, rather than growing per load.
 */
export function assetCacheSizes(): { textures: number; gltf: number; splat: number } {
  return { textures: textureCache.size, gltf: gltfCache.size, splat: splatBytesCache.size };
}
