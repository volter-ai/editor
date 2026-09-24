/**
 * Shared asset loading infrastructure.
 *
 * Provides a single LoadingManager (for Three.js loaders) and resolveUrl()
 * (for raw fetch calls) so that all engine asset requests go through one
 * configurable URL prefix. Call setAssetPrefix() once at runtime startup.
 *
 * Three.js loaders constructed with `loadingManager` automatically rewrite
 * URLs via setURLModifier(). For raw fetch() calls, wrap the URL with
 * resolveUrl() to apply the same prefix.
 */

import * as THREE from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

let _prefix = '/';

function rewriteUrl(url: string): string {
  if (
    url.startsWith('/') ||
    url.startsWith('http') ||
    url.startsWith('data:') ||
    url.startsWith('blob:')
  ) {
    return url;
  }
  return _prefix + url;
}

/** Shared Three.js LoadingManager — all engine loaders should use this. */
export const loadingManager = new THREE.LoadingManager();
loadingManager.setURLModifier(rewriteUrl);

/** Pre-configured TextureLoader using the shared manager. */
export const textureLoader = new THREE.TextureLoader(loadingManager);

/**
 * Shared DRACOLoader for decoding DRACO-compressed GLTF/GLB meshes.
 *
 * The decoder wasm/js is vendored under
 * packages/editor/template/public/jsm/libs/draco/gltf/ and served at the
 * absolute runtime path '/jsm/libs/draco/gltf/' (DRACOLoader appends
 * draco_wasm_wrapper.js / draco_decoder.wasm to this path). This is an
 * absolute path, so it deliberately does NOT go through the asset prefix —
 * the decoder is engine infrastructure, not a scene asset.
 */
export const dracoLoader = new DRACOLoader(loadingManager);
dracoLoader.setDecoderPath('/jsm/libs/draco/gltf/');

/**
 * Shared KTX2Loader for decoding KHR_texture_basisu (KTX2/Basis) textures.
 *
 * Vendored and served EXACTLY like the DRACO decoder above — the Basis
 * transcoder js/wasm live in repo-root `public/jsm/libs/basis/` (the editor)
 * and `packages/editor/template/public/jsm/libs/basis/` (a scaffolded game's
 * own build), pinned in `vendor/upstream-assets.lock.json`, and KTX2Loader
 * appends `basis_transcoder.js` / `.wasm` to this absolute path.
 *
 * Without this wiring, the Asset Budget's "Compress textures · KTX2" output
 * is a GLB nothing in the engine can load — which is why the op and this
 * loader landed together.
 */
export const ktx2Loader = new KTX2Loader(loadingManager);
ktx2Loader.setTranscoderPath('/jsm/libs/basis/');

let ktx2SupportDetected = false;

/**
 * Teach the shared KTX2Loader which compressed formats THIS GPU accepts.
 *
 * KTX2Loader refuses to transcode until it has seen a renderer, and the
 * answer is a property of the page's GPU rather than of any one renderer —
 * so the FIRST renderer to exist supplies it and every later one is a no-op.
 * Called by the engine's own renderer setup (`setup/setup-renderer.ts`) and
 * by the editor's viewport, which between them cover every surface that
 * parses a GLB.
 *
 * This sits on the MOUNT path, so it must never throw for a renderer it
 * cannot question. `detectSupport` reads `renderer.extensions.has/get` (or
 * `renderer.hasFeature` on a WebGPU renderer) — surface a headless stand-in
 * (the test harnesses' fake renderers, any non-WebGL host) does not have.
 * Such a renderer is skipped WITHOUT latching, so the first renderer that
 * can actually answer still configures the loader for the whole page.
 */
export function detectKtx2Support(renderer: THREE.WebGLRenderer): void {
  if (ktx2SupportDetected) return;
  const probe = renderer as unknown as
    | {
        isWebGPURenderer?: boolean;
        hasFeature?: unknown;
        extensions?: { has?: unknown; get?: unknown };
      }
    | null
    | undefined;
  const canAnswer =
    probe != null &&
    (probe.isWebGPURenderer === true
      ? typeof probe.hasFeature === 'function'
      : typeof probe.extensions?.has === 'function' && typeof probe.extensions?.get === 'function');
  if (!canAnswer) return;
  ktx2Loader.detectSupport(renderer);
  ktx2SupportDetected = true;
}

/** Pre-configured GLTFLoader using the shared manager, with DRACO decoding wired in. */
export const gltfLoader = new GLTFLoader(loadingManager);
gltfLoader.setDRACOLoader(dracoLoader);
gltfLoader.setKTX2Loader(ktx2Loader);
// EXT_meshopt_compression decoding (three's own bundled decoder — inline
// wasm, no fetch). Without this, a meshopt-compressed GLB — including the
// output of the editor's Asset Budget "Compress · meshopt" action (W4a M3) —
// throws at load time in every runtime and the editor viewport. Symmetric
// with the DRACO wiring above (CB2): the ONE shared loader owns codec setup.
gltfLoader.setMeshoptDecoder(MeshoptDecoder);

/**
 * Set the URL prefix prepended to relative asset paths.
 * Called once by createGameRuntime(). Defaults to '/'.
 */
export function setAssetPrefix(prefix: string): void {
  _prefix = prefix.endsWith('/') ? prefix : prefix ? `${prefix}/` : '/';
}

/**
 * Resolve a relative asset URL using the current prefix.
 * Use this for raw fetch() calls — Three.js loaders using
 * `loadingManager` handle this automatically.
 */
export function resolveUrl(url: string): string {
  return rewriteUrl(url);
}
