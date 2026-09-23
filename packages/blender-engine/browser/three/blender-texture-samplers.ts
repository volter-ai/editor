import * as THREE from 'three';

export type TextureExtension = 'REPEAT' | 'EXTEND' | 'MIRROR' | 'CLIP';

/** A shared material may draw meshes whose named layers have different
 * channel positions. Resolve at Three's per-draw hook, before program choice. */
export function bindNamedUvChannels(material: THREE.MeshPhysicalMaterial, geometry: THREE.BufferGeometry): void {
  const channels = geometry.userData['blenderUvChannels'] as Record<string, number> | undefined;
  for (const texture of [material.map, material.roughnessMap, material.normalMap]) {
    if (!texture) continue;
    const name = texture.userData['blenderUvName'] as string | undefined;
    const channel = name ? channels?.[name] : 0;
    if (channel === undefined) throw new Error(`Material ${material.name} requests missing UV map ${name}`);
    if (texture.channel !== channel) {
      texture.channel = channel;
      material.needsUpdate = true;
    }
  }
}

/** Image pixels are shared; sampler state belongs to each material input.
 * Clones share Three's Source, including asynchronous PNG decoding, but their
 * upload versions are independent and must follow repaints explicitly. */
export class BlenderTextureSamplers {
  private readonly bindings = new Map<string, {
    source: THREE.Texture; texture: THREE.Texture; version: number; disposed: boolean;
  }>();

  get(key: string, source: THREE.Texture, extension: TextureExtension, ready?: Promise<void>, uv = ''): THREE.Texture {
    let binding = this.bindings.get(key);
    if (!binding || binding.source !== source) {
      this.delete(key);
      binding = {source, texture: source.clone(), version: -1, disposed: false};
      this.bindings.set(key, binding);
      const held = binding;
      // The owner awaits and reports decode failures. Avoid an unhandled
      // rejection here, and never upload a clone removed during the decode.
      if (ready) void ready.then(() => {
        if (!held.disposed) {
          held.texture.needsUpdate = true;
          held.version = source.version;
        }
      }, () => {});
    }
    const wrap = extension === 'REPEAT' ? THREE.RepeatWrapping :
      extension === 'MIRROR' ? THREE.MirroredRepeatWrapping : THREE.ClampToEdgeWrapping;
    const changed = binding.texture.wrapS !== wrap || binding.texture.wrapT !== wrap;
    binding.texture.wrapS = binding.texture.wrapT = wrap;
    binding.texture.userData['blenderUvName'] = uv;
    if (source.image && (changed || binding.version !== source.version)) {
      binding.texture.needsUpdate = true;
      binding.version = source.version;
    }
    return binding.texture;
  }

  delete(key: string): void {
    const binding = this.bindings.get(key);
    if (!binding) return;
    binding.disposed = true;
    binding.texture.dispose();
    this.bindings.delete(key);
  }

  clear(): void {
    for (const key of this.bindings.keys()) this.delete(key);
  }
}
