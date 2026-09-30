import * as THREE from 'three';
import {syncPhysicalDrawMaterial} from './blender-physical-material';

type Variant = {material: THREE.MeshPhysicalMaterial; sourceVersion: number; frame: number; ready: boolean};
const MAX_VARIANTS = 128;

/** Three caches one current shader form per Material. Alternating ordinary,
 * instanced and batched objects under that material repeatedly rebuilds its
 * program parameters/uniform list, even when all programs are already linked.
 * These small, disposable material identities isolate those caches without
 * changing canonical material slots, geometry, transparency order or values. */
export class BlenderDrawMaterials {
  private readonly sources = new Map<THREE.Material, Map<string, Variant>>();
  private readonly geometryKeys = new Map<THREE.BufferGeometry, string>();
  private frame = 0;
  private count = 0;

  begin(): void { this.frame++; this.geometryKeys.clear(); }

  get(source: THREE.Material, mesh: THREE.InstancedMesh | THREE.BatchedMesh): THREE.Material {
    let geometryKey = this.geometryKeys.get(mesh.geometry);
    if (geometryKey === undefined) {
      geometryKey = JSON.stringify([mesh.geometry.userData['blenderUvChannels'] ?? null,
        Object.keys(mesh.geometry.attributes).sort().map(name => [name, mesh.geometry.getAttribute(name).itemSize])]);
      this.geometryKeys.set(mesh.geometry, geometryKey);
    }
    const key = `${mesh instanceof THREE.BatchedMesh ? 'batch' : 'instance'}:${geometryKey}`;
    let variants = this.sources.get(source);
    if (!variants) { variants = new Map(); this.sources.set(source, variants); }
    let variant = variants.get(key);
    if (!variant) {
      if (this.count >= MAX_VARIANTS) return source;
      const material = syncPhysicalDrawMaterial(source);
      if (!material) return source;
      variant = {material, sourceVersion: source.version, frame: this.frame, ready: true};
      variants.set(key, variant);
      this.count++;
    } else if (variant.frame !== this.frame) {
      variant.ready = syncPhysicalDrawMaterial(source, variant.material) !== null;
      if (variant.sourceVersion !== source.version) variant.material.needsUpdate = true;
      variant.sourceVersion = source.version;
      variant.frame = this.frame;
    }
    return variant.ready ? variant.material : source;
  }

  clear(): void {
    for (const variants of this.sources.values()) for (const {material} of variants.values()) material.dispose();
    this.sources.clear();
    this.geometryKeys.clear();
    this.count = 0;
  }

  inspect() { return {variants: this.count, limit: MAX_VARIANTS}; }
}
