import * as THREE from 'three';
import {instanceMatrixSupported, instanceObjectShown} from './blender-runtime-instances';

const CAPACITY = 64;
const MAX_DRAWS = 1024; // At most 4 MiB of instance matrices; no vertex copies.

/** Opaque depth overrides discard authored color materials. Geometry-compatible
 * objects can share a draw here even when their color draws cannot be reordered.
 * Only the current pass changes; selection layers and canonical meshes survive. */
export class BlenderDepthInstances {
  private objects: THREE.Mesh[] = [];
  private readonly pools = new Map<THREE.BufferGeometry, THREE.InstancedMesh[]>();
  private readonly hidden: {mesh: THREE.Mesh; mask: number}[] = [];
  private readonly active: THREE.InstancedMesh[] = [];
  private readonly inverse = new THREE.Matrix4();
  private readonly matrix = new THREE.Matrix4();
  private readonly projection = new THREE.Matrix4();
  private readonly frustum = new THREE.Frustum();
  private allocated = 0;
  private statistics = {batches: 0, instances: 0, preparationMs: 0};

  constructor(private readonly root: THREE.Group) {}

  supports(material: THREE.MeshDepthMaterial): boolean {
    return material.isMeshDepthMaterial && material.visible && !material.transparent &&
      !material.map && !material.alphaMap && !material.displacementMap &&
      !material.alphaHash && material.alphaTest === 0 && !material.wireframe &&
      !material.stencilWrite && material.depthWrite && material.depthTest &&
      !material.clippingPlanes?.length && !material.polygonOffset &&
      (material.depthFunc === THREE.LessDepth || material.depthFunc === THREE.LessEqualDepth) &&
      (material.blending === THREE.NormalBlending || material.blending === THREE.NoBlending) &&
      material.onBeforeCompile === THREE.Material.prototype.onBeforeCompile &&
      material.onBeforeRender === THREE.Material.prototype.onBeforeRender;
  }

  setObjects(objects: Iterable<THREE.Object3D>): void {
    this.clear();
    this.objects = [...objects].filter((object): object is THREE.Mesh => (object as THREE.Mesh).isMesh === true);
  }

  prepare(camera: THREE.Camera, material: THREE.MeshDepthMaterial): void {
    this.finish();
    const start = performance.now();
    this.statistics = {batches: 0, instances: 0, preparationMs: 0};
    if (!camera.layers.isEnabled(0)) return;
    this.inverse.copy(this.root.matrixWorld).invert();
    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projection);
    const groups = new Map<THREE.BufferGeometry, THREE.Mesh[]>();
    for (const mesh of this.objects) {
      // A selected object has a separate mask layer, and the outline pass also
      // disables its default layer. Never pull it into the occluder draw.
      if (mesh.layers.mask !== 1 || !instanceObjectShown(mesh) ||
          (mesh as THREE.SkinnedMesh).isSkinnedMesh ||
          (mesh as THREE.InstancedMesh).isInstancedMesh ||
          (mesh as THREE.BatchedMesh).isBatchedMesh || mesh.morphTargetInfluences ||
          mesh.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender ||
          mesh.onAfterRender !== THREE.Object3D.prototype.onAfterRender) continue;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (materials.length !== 1 || !materials[0]?.visible) continue;
      const geometry = mesh.geometry;
      const count = geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0;
      if (!count || (Array.isArray(mesh.material) && !(geometry.groups.length === 1 &&
          geometry.groups[0]!.start === 0 && geometry.groups[0]!.count === count &&
          geometry.groups[0]!.materialIndex === 0))) continue;
      if (mesh.frustumCulled && !this.frustum.intersectsObject(mesh)) continue;
      this.matrix.multiplyMatrices(this.inverse, mesh.matrixWorld);
      if (!instanceMatrixSupported(this.matrix)) continue;
      const group = groups.get(geometry);
      if (group) group.push(mesh); else groups.set(geometry, [mesh]);
    }
    // Do not retain pools for obsolete LOD/canonical geometry indefinitely.
    for (const [geometry, pool] of this.pools) if (!groups.has(geometry)) {
      for (const draw of pool) { draw.removeFromParent(); draw.dispose(); this.allocated--; }
      this.pools.delete(geometry);
    }
    for (const [geometry, members] of groups) {
      if (members.length < 2) continue;
      let pool = this.pools.get(geometry);
      if (!pool) { pool = []; this.pools.set(geometry, pool); }
      for (let offset = 0; offset < members.length; offset += CAPACITY) {
        const count = Math.min(CAPACITY, members.length - offset);
        if (count < 2) continue;
        const slot = offset / CAPACITY;
        let draw = pool[slot];
        if (!draw) {
          if (this.allocated >= MAX_DRAWS) continue;
          draw = new THREE.InstancedMesh(geometry, material, CAPACITY);
          draw.name = 'Blender depth instances';
          draw.userData['engineInternal'] = true;
          draw.matrixAutoUpdate = false;
          draw.frustumCulled = false; // Members were individually culled above.
          draw.boundingSphere = new THREE.Sphere();
          draw.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          draw.raycast = () => {};
          this.root.add(draw);
          pool.push(draw);
          this.allocated++;
        }
        draw.material = material;
        draw.matrixWorld.copy(this.root.matrixWorld);
        draw.count = count;
        draw.visible = true;
        this.active.push(draw);
        for (let i = 0; i < count; i++) {
          const mesh = members[offset + i]!;
          this.matrix.multiplyMatrices(this.inverse, mesh.matrixWorld);
          draw.setMatrixAt(i, this.matrix);
          this.hidden.push({mesh, mask: mesh.layers.mask});
          mesh.layers.disable(0);
        }
        draw.instanceMatrix.needsUpdate = true;
        this.statistics.batches++;
        this.statistics.instances += count;
      }
    }
    this.statistics.preparationMs = performance.now() - start;
  }

  finish(): void {
    for (const {mesh, mask} of this.hidden) mesh.layers.mask = mask;
    this.hidden.length = 0;
    for (const draw of this.active) draw.visible = false;
    this.active.length = 0;
  }

  clear(): void {
    this.finish();
    for (const pool of this.pools.values()) for (const draw of pool) {
      draw.removeFromParent();
      draw.dispose(); // Shared geometry and override material belong to callers.
    }
    this.pools.clear();
    this.objects = [];
    this.allocated = 0;
  }

  inspect() { return {...this.statistics, allocated: this.allocated}; }
}
