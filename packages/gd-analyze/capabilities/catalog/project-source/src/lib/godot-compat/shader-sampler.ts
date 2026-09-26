import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  NearestFilter,
  RGBAFormat,
  type Texture,
  UnsignedByteType,
} from 'three';
import type { GodotNativeShaderSource } from './shader';

export interface PreparedGodotThreeSampler {
  readonly value: Texture | null;
  /** Present only when this material owns a sampler-state view or authored default texture. */
  readonly owned?: Texture;
}

function defaultWhiteTexture(): DataTexture {
  // RenderingServer::get_white_texture() is a 4x4 all-white texture. Keep this material-owned:
  // sampler hints belong to the uniform binding and must never mutate a shared texture resource.
  const pixels = new Uint8Array(4 * 4 * 4);
  pixels.fill(255);
  const texture = new DataTexture(pixels, 4, 4, RGBAFormat, UnsignedByteType);
  texture.needsUpdate = true;
  return texture;
}

/** Apply Godot's sampler object state to a material-local Three texture view. */
export function prepareGodotThreeSampler(
  source: GodotNativeShaderSource | undefined,
  name: string,
  value: Texture | null,
): PreparedGodotThreeSampler {
  const sampler = source?.samplers?.find((entry) => entry.name === name);
  if (sampler === undefined) return { value };

  let texture = value;
  let owned: Texture | undefined;
  if (texture === null && sampler.default === 'white') {
    texture = defaultWhiteTexture();
    owned = texture;
  }
  if (texture === null) return { value: null };

  if (owned === undefined && (sampler.filter !== undefined || sampler.repeat !== undefined)) {
    texture = texture.clone();
    owned = texture;
  }
  if (sampler.filter !== undefined) {
    texture.magFilter = sampler.filter === 'linear' ? LinearFilter : NearestFilter;
    texture.minFilter = sampler.filter === 'linear' ? LinearFilter : NearestFilter;
    texture.generateMipmaps = false;
  }
  if (sampler.repeat === 'disabled') {
    texture.wrapS = ClampToEdgeWrapping;
    texture.wrapT = ClampToEdgeWrapping;
  }
  if (owned !== undefined) texture.needsUpdate = true;
  return { value: texture, ...(owned === undefined ? {} : { owned }) };
}

export function releaseGodotThreeSamplers(textures: Iterable<Texture>): void {
  for (const texture of textures) texture.dispose();
}
