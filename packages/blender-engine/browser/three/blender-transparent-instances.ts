import * as THREE from 'three';
import {graphDrawAttributes} from './blender-graph-material';
import {instanceMatrixSupported, instanceObjectShown} from './blender-runtime-instances';

const CAPACITY = 64;
type Entry = {mesh: THREE.Mesh; material: THREE.Material | null; key: string | null; groupOrder: number; z: number; centre: THREE.Vector3};
type Draw = {mesh: THREE.InstancedMesh; members: THREE.Mesh[]};

function groupOrder(mesh: THREE.Object3D): number {
  for (let parent = mesh.parent; parent; parent = parent.parent)
    if ((parent as THREE.Group).isGroup) return parent.renderOrder;
  return 0;
}

/** Preserve Three's transparent object order. An instance run may contain only
 * consecutive, compatible, single-pass surfaces in that order. Incompatible
 * surfaces remain barriers; ties at a run boundary stay ordinary draws because
 * Three breaks equal-depth ties by object id, and an internal batch has a new id.
 * This does not turn blended foliage into cutouts or change its opacity. */
export class BlenderTransparentInstances {
  private objects: THREE.Mesh[] = [];
  private readonly pools = new Map<string, Draw[]>();
  private readonly hidden: THREE.Mesh[] = [];
  private readonly inverse = new THREE.Matrix4();
  private readonly matrix = new THREE.Matrix4();
  private readonly projection = new THREE.Matrix4();
  private readonly frustum = new THREE.Frustum();
  private readonly centre = new THREE.Vector3();
  private readonly depth = new THREE.Vector4();
  private batches = 0;
  private instances = 0;
  private excluded: Record<string, number> = {};
  private readonly planState: (number | string)[] = [];
  private readonly planned: Draw[] = [];
  private stateIndex = 0;
  private stateChanged = false;

  constructor(private readonly root: THREE.Group) {}

  setObjects(objects: Iterable<THREE.Object3D>): void {
    this.clear();
    this.objects = [...objects].filter((object): object is THREE.Mesh => (object as THREE.Mesh).isMesh === true);
  }

  prepare(camera: THREE.Camera): void {
    this.finishDraw();
    if (!this.objects.length) return;
    camera.updateMatrixWorld();
    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    if (!this.planChanged(camera)) {
      // The draw plan is a disposable presentation, not evaluated scene data.
      // Reuse only after exact comparison of every input to culling/ordering;
      // a camera move, drag, visibility or material change rebuilds it below.
      for (const draw of this.planned) {
        draw.mesh.visible = true;
        for (const member of draw.members) {
          member.layers.disable(0);
          this.hidden.push(member);
        }
      }
      return;
    }
    this.planned.length = 0;
    for (const pool of this.pools.values()) for (const draw of pool) {
      draw.mesh.visible = false;
      draw.members.length = 0;
    }
    this.batches = this.instances = 0;
    this.excluded = {};
    this.frustum.setFromProjectionMatrix(this.projection);
    this.inverse.copy(this.root.matrixWorld).invert();
    const entries: Entry[] = [];
    const eligibility = new Map<string, boolean>();
    for (const mesh of this.objects) {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (!materials.some(m => m.visible && m.transparent)) continue;
      if (!instanceObjectShown(mesh) || !mesh.layers.test(camera.layers)) continue;
      if (mesh.frustumCulled && !this.frustum.intersectsObject(mesh)) continue;
      // Match WebGLRenderer.projectObject's sorting centre, including a skin's
      // own sphere. Positions alone are not the centre of off-origin geometry.
      const bounded = mesh as THREE.Mesh & {boundingSphere?: THREE.Sphere | null; computeBoundingSphere?: () => void};
      if (bounded.boundingSphere !== undefined) {
        if (bounded.boundingSphere === null) bounded.computeBoundingSphere?.();
        this.centre.copy(bounded.boundingSphere!.center);
      } else {
        if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
        this.centre.copy(mesh.geometry.boundingSphere!.center);
      }
      this.centre.applyMatrix4(mesh.matrixWorld);
      const centre = this.centre.clone();
      // WebGLRenderer sorts homogeneous clip z, before the perspective divide.
      const z = this.depth.set(centre.x, centre.y, centre.z, 1).applyMatrix4(this.projection).z;
      let material: THREE.Material | null = null;
      let key: string | null = null;
      const candidate = materials.length === 1 ? materials[0]! : null;
      const order = groupOrder(mesh);
      if (candidate && candidate.visible && candidate.transparent &&
          !(candidate as THREE.ShaderMaterial).isShaderMaterial &&
          !((candidate as THREE.MeshPhysicalMaterial).transmission > 0) &&
          (candidate.side !== THREE.DoubleSide || candidate.forceSinglePass) &&
          !(mesh as THREE.SkinnedMesh).isSkinnedMesh && !mesh.morphTargetInfluences &&
          !(mesh as THREE.InstancedMesh).isInstancedMesh && mesh.layers.mask === 1 &&
          order === this.root.renderOrder) {
        const geometry = mesh.geometry;
        // A single material draws the whole geometry. An array does so only
        // when its sole group covers the same range; preserve all other cases.
        const count = geometry.index?.count ?? geometry.getAttribute('position').count;
        const whole = !Array.isArray(mesh.material) || (geometry.groups.length === 1 &&
          geometry.groups[0]!.start === 0 && geometry.groups[0]!.count === count &&
          geometry.groups[0]!.materialIndex === 0);
        const groupKey = `${geometry.id}:${candidate.uuid}:${mesh.renderOrder}`;
        let fits = eligibility.get(groupKey);
        if (fits === undefined) {
          fits = graphDrawAttributes(candidate, geometry).size <= 12;
          eligibility.set(groupKey, fits);
        }
        this.matrix.multiplyMatrices(this.inverse, mesh.matrixWorld);
        if (whole && fits && instanceMatrixSupported(this.matrix)) {
          material = candidate;
          key = groupKey;
        }
      }
      if (key === null) {
        const reason = !candidate ? 'multipleMaterials'
          : (candidate as THREE.ShaderMaterial).isShaderMaterial ? 'customShader'
          : (candidate as THREE.MeshPhysicalMaterial).transmission > 0 ? 'transmission'
          : candidate.side === THREE.DoubleSide && !candidate.forceSinglePass ? 'twoPass'
          : 'geometryLayersOrTransform';
        this.excluded[reason] = (this.excluded[reason] ?? 0) + 1;
      }
      entries.push({mesh, material, key, groupOrder: order, z, centre});
    }
    entries.sort((a, b) => a.groupOrder - b.groupOrder || a.mesh.renderOrder - b.mesh.renderOrder || b.z - a.z || a.mesh.id - b.mesh.id);
    const used = new Map<string, number>();
    for (let begin = 0; begin < entries.length;) {
      const first = entries[begin]!;
      let end = begin + 1;
      if (first.key !== null) while (end < entries.length && entries[end]!.key === first.key) end++;
      const previous = entries[begin - 1];
      const following = entries[end];
      const tied = (previous?.z === first.z && previous.mesh.renderOrder === first.mesh.renderOrder) ||
        (following?.z === entries[end - 1]!.z && following.mesh.renderOrder === first.mesh.renderOrder);
      if (first.key !== null && end - begin >= 2 && !tied) {
        // Equal-depth members may not straddle separate batches: their new
        // object ids must never become the tie breaker. Keep such a run whole
        // on the ordinary path if a capacity boundary would split a tie.
        let safe = true;
        for (let i = begin + CAPACITY; i < end; i += CAPACITY)
          if (entries[i - 1]!.z === entries[i]!.z) safe = false;
        if (safe) for (let offset = begin; offset < end; offset += CAPACITY) {
          const length = Math.min(CAPACITY, end - offset);
          if (length < 2) continue;
          const head = entries[offset]!;
          const index = used.get(first.key) ?? 0;
          used.set(first.key, index + 1);
          let pool = this.pools.get(first.key);
          if (!pool) { pool = []; this.pools.set(first.key, pool); }
          let draw = pool[index];
          if (!draw) {
            const mesh = new THREE.InstancedMesh(first.mesh.geometry, first.material!, CAPACITY);
            mesh.name = 'Blender ordered transparency';
            mesh.userData['engineInternal'] = true;
            mesh.matrixAutoUpdate = false;
            // Each member was culled above. The sphere is a sorting anchor,
            // deliberately not an aggregate sphere that changes draw order.
            mesh.frustumCulled = false;
            mesh.boundingSphere = new THREE.Sphere();
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            draw = {mesh, members: []};
            const held = draw;
            mesh.raycast = (raycaster, hits) => {
              if (!mesh.visible) return;
              for (const member of held.members)
                if (instanceObjectShown(member)) member.raycast(raycaster, hits);
            };
            pool.push(draw);
            this.root.add(mesh);
          }
          draw.mesh.visible = true;
          draw.mesh.renderOrder = head.mesh.renderOrder;
          draw.mesh.boundingSphere!.center.copy(head.centre).applyMatrix4(this.inverse);
          draw.mesh.updateMatrixWorld(true);
          for (let i = 0; i < length; i++) {
            const member = entries[offset + i]!.mesh;
            this.matrix.multiplyMatrices(this.inverse, member.matrixWorld);
            draw.mesh.setMatrixAt(i, this.matrix);
            draw.members.push(member);
            member.layers.disable(0);
            this.hidden.push(member);
          }
          draw.mesh.count = length;
          draw.mesh.instanceMatrix.needsUpdate = true;
          this.planned.push(draw);
          this.batches++;
          this.instances += length;
        }
      }
      begin = end;
    }
  }

  inspect() { return {batches: this.batches, instances: this.instances, excluded: {...this.excluded}}; }

  private observe(value: number | string): void {
    if (this.planState[this.stateIndex] !== value) {
      this.planState[this.stateIndex] = value;
      this.stateChanged = true;
    }
    this.stateIndex++;
  }

  /** Compare inputs without cloning 10,000 centres, allocating entries or
   * sorting/uploading matrices again on an unchanged frame. No lossy hash. */
  private planChanged(camera: THREE.Camera): boolean {
    this.stateIndex = 0;
    this.stateChanged = this.planState.length === 0;
    this.observe(camera.layers.mask);
    for (const n of this.projection.elements) this.observe(n);
    for (const n of this.root.matrixWorld.elements) this.observe(n);
    for (const mesh of this.objects) {
      this.observe(mesh.parent?.id ?? -1);
      this.observe(instanceObjectShown(mesh) ? 1 : 0);
      this.observe(mesh.layers.mask);
      this.observe(mesh.renderOrder);
      this.observe(groupOrder(mesh));
      this.observe(mesh.frustumCulled ? 1 : 0);
      this.observe(mesh.morphTargetInfluences ? 1 : 0);
      for (const n of mesh.matrixWorld.elements) this.observe(n);
      const geometry = mesh.geometry;
      this.observe(geometry.id);
      this.observe(geometry.drawRange.start);
      this.observe(geometry.drawRange.count);
      this.observe(geometry.index?.count ?? geometry.getAttribute('position').count);
      this.observe(geometry.groups.length);
      for (const group of geometry.groups) {
        this.observe(group.start); this.observe(group.count); this.observe(group.materialIndex ?? 0);
      }
      const sphere = (mesh as THREE.Mesh & {boundingSphere?: THREE.Sphere | null}).boundingSphere ?? geometry.boundingSphere;
      this.observe(sphere?.center.x ?? 0); this.observe(sphere?.center.y ?? 0);
      this.observe(sphere?.center.z ?? 0); this.observe(sphere?.radius ?? -1);
      const materials = Array.isArray(mesh.material) ? mesh.material : null;
      this.observe(materials?.length ?? -1);
      if (materials) for (const material of materials) this.observeMaterial(material);
      else this.observeMaterial(mesh.material as THREE.Material);
    }
    this.stateChanged ||= this.planState.length !== this.stateIndex;
    this.planState.length = this.stateIndex;
    return this.stateChanged;
  }

  private observeMaterial(material: THREE.Material): void {
    this.observe(material.uuid); this.observe(material.version);
    this.observe(material.visible ? 1 : 0); this.observe(material.transparent ? 1 : 0);
    this.observe(material.side); this.observe(material.forceSinglePass ? 1 : 0);
    this.observe((material as THREE.MeshPhysicalMaterial).transmission ?? 0);
  }

  finishDraw(): void {
    for (const mesh of this.hidden) mesh.layers.enable(0);
    this.hidden.length = 0;
    for (const pool of this.pools.values()) for (const {mesh} of pool) mesh.visible = false;
  }

  clear(): void {
    this.finishDraw();
    for (const pool of this.pools.values()) for (const {mesh} of pool) {
      mesh.removeFromParent();
      mesh.dispose();
    }
    this.pools.clear();
    this.planned.length = 0;
    this.planState.length = 0;
    this.objects = [];
    this.batches = this.instances = 0;
  }
}
