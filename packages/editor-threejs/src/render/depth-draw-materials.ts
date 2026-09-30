import * as THREE from 'three';

type Variant = {material: THREE.MeshDepthMaterial; frame: number; version: number};

/** Keep ordinary, instanced and batched depth draws from invalidating one
 * another's current program. Only the material argument of an already selected
 * draw changes: Three still owns visibility, groups, order and override rules.
 * Custom hooks and deforming/textured depth materials take the original path. */
export class DepthDrawMaterials {
  private readonly sources = new Map<THREE.MeshDepthMaterial, Map<number, Variant>>();
  private frame = 0;
  private count = 0;

  bind(renderer: THREE.WebGLRenderer): () => void {
    this.frame++;
    const original = renderer.renderBufferDirect;
    const cache = this;
    renderer.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
      const selected = scene?.overrideMaterial === material
        ? cache.get(material, geometry, object) : material;
      return original.call(this, camera, scene, geometry, selected, object, group);
    };
    return () => { renderer.renderBufferDirect = original; };
  }

  private get(source: THREE.Material, geometry: THREE.BufferGeometry, object: THREE.Object3D): THREE.Material {
    if (!(source instanceof THREE.MeshDepthMaterial) || source.transparent ||
        source.map || source.alphaMap || source.displacementMap || source.clippingPlanes ||
        source.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile ||
        source.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey ||
        source.onBeforeRender !== THREE.Material.prototype.onBeforeRender ||
        !(object instanceof THREE.Mesh) || object instanceof THREE.SkinnedMesh ||
        Object.keys(geometry.morphAttributes).length ||
        object.onAfterRender !== THREE.Object3D.prototype.onAfterRender) return source;
    const batched = object instanceof THREE.BatchedMesh;
    const instanced = object instanceof THREE.InstancedMesh;
    if (object.onBeforeRender !== (batched ? THREE.BatchedMesh.prototype.onBeforeRender : THREE.Object3D.prototype.onBeforeRender) ||
        (instanced && (object.instanceColor || object.morphTexture))) return source;
    // A batch's color-texture presence must be explicit. Unknown/custom batches
    // keep their original material rather than relying on Three's internals.
    if (batched && Reflect.get(object, 'colorTexture') !== null) return source;
    const key = (batched ? 1 : instanced ? 2 : 0) +
      (source.vertexColors && geometry.getAttribute('color')?.itemSize === 4 ? 4 : 0);
    let variants = this.sources.get(source);
    if (!variants) {
      if (this.count >= 32) return source;
      variants = new Map();
      this.sources.set(source, variants);
    }
    let variant = variants.get(key);
    if (!variant) {
      if (this.count >= 32) return source;
      variant = {material: source.clone(), frame: this.frame, version: source.version};
      variants.set(key, variant);
      this.count++;
    } else if (variant.frame !== this.frame) {
      variant.material.copy(source);
      if (variant.version !== source.version) variant.material.needsUpdate = true;
      variant.version = source.version;
      variant.frame = this.frame;
    }
    return variant.material;
  }

  dispose(): void {
    for (const variants of this.sources.values()) for (const {material} of variants.values()) material.dispose();
    this.sources.clear();
    this.count = 0;
  }
}
