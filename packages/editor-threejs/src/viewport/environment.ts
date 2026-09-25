import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

/** A baked IBL environment and the handle that frees its render target. */
export interface StandardEnvironment {
  readonly texture: THREE.Texture;
  dispose(): void;
}

/**
 * Bake Three's RoomEnvironment for an authoring view. The caller owns the
 * returned target; a preview pool may lend its texture without transferring
 * ownership. No palette, document registration or product service is needed.
 */
export function createStandardEnvironment(renderer: THREE.WebGLRenderer): StandardEnvironment {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  try {
    const target = pmrem.fromScene(room, 0.04);
    return { texture: target.texture, dispose: () => target.dispose() };
  } finally {
    // A failed bake must release its temporary scene and generator too.
    room.dispose();
    pmrem.dispose();
  }
}

/**
 * An environment image (`@volter/editor-sdk/kit/environment-images`) as an equirectangular
 * texture in scene-referred light. Read as half float: a sun past white stays bright, and half
 * float filters linearly where full float cannot (phones).
 */
export async function loadEnvironmentImage(url: string, format: 'exr' | 'hdr'): Promise<THREE.DataTexture> {
  const loader = format === 'exr' ? new EXRLoader() : new HDRLoader();
  loader.setDataType(THREE.HalfFloatType);
  const texture = await loader.loadAsync(url);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  return texture;
}
