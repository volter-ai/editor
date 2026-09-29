import * as THREE from 'three';
import { graphDrawAttributes } from './blender-graph-material';

// Small spatial batches retain frustum rejection without duplicating geometry.
const BATCH_SIZE = 64;
type Member = { mesh: THREE.Mesh; layers: number };
type Batch = { draw: THREE.InstancedMesh; members: Member[] };

function sameMaterials(a: THREE.Material | THREE.Material[], b: THREE.Material | THREE.Material[]): boolean {
  return Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((material, i) => material === b[i])
    : a === b;
}

export function instanceObjectShown(object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent)
    if (!node.visible) return false;
  return true;
}

/** Three's instance normal transform supports positive, orthogonal scale axes.
 * Mirrored, singular and sheared placements keep the ordinary Mesh draw. */
export function instanceMatrixSupported(matrix: THREE.Matrix4): boolean {
  if (matrix.determinant() <= 0) return false;
  const e = matrix.elements;
  const x = Math.hypot(e[0]!, e[1]!, e[2]!);
  const y = Math.hypot(e[4]!, e[5]!, e[6]!);
  const z = Math.hypot(e[8]!, e[9]!, e[10]!);
  const dot = (a: number, b: number) => e[a]! * e[b]! + e[a + 1]! * e[b + 1]! + e[a + 2]! * e[b + 2]!;
  return Number.isFinite(x + y + z) && Math.min(x, y, z) > 0 &&
    Math.abs(dot(0, 4)) <= 1e-7 * x * y &&
    Math.abs(dot(0, 8)) <= 1e-7 * x * z &&
    Math.abs(dot(4, 8)) <= 1e-7 * y * z;
}

/** Disposable draws only. The original objects, geometry, material slots and
 * parent graph remain the authority for hierarchy, bounds, editing and picking.
 * Layer zero-mask suppresses their ordinary draw; batch raycasts return those
 * same original objects. Selection passes can still temporarily add their mask
 * layer to an original. No vertices or authored data are reduced or replaced. */
export class BlenderRuntimeInstances {
  private readonly batches: Batch[] = [];
  private readonly inverse = new THREE.Matrix4();
  private readonly matrix = new THREE.Matrix4();
  private readonly box = new THREE.Box3();
  private readonly projection = new THREE.Matrix4();
  private readonly frustum = new THREE.Frustum();
  private camera: THREE.Camera | null = null;
  private eligible = 0;
  private excluded: Record<string, number> = {};

  constructor(private readonly root: THREE.Group) {}

  rebuild(objects: Iterable<THREE.Object3D>, enabled: boolean): void {
    this.clear();
    if (!enabled) return;
    const groups = new Map<string, THREE.Mesh[]>();
    const exclude = (reason: string) => { this.excluded[reason] = (this.excluded[reason] ?? 0) + 1; };
    this.inverse.copy(this.root.matrixWorld).invert();
    for (const object of objects) {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) continue;
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh ||
          (mesh as THREE.InstancedMesh).isInstancedMesh || mesh.morphTargetInfluences ||
          mesh.layers.mask !== 1) { exclude('deformationOrLayers'); continue; }
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (materials.some(m => m.transparent || (m as THREE.MeshPhysicalMaterial).transmission > 0 ||
          (m as THREE.ShaderMaterial).isShaderMaterial)) { exclude('material'); continue; }
      // Four slots for instanceMatrix, at most twelve for each actual program.
      // Count active inputs, NOT every stored authored layer: retaining unused
      // UVs/colours must not disable batching. No channel is deleted to fit.
      if (materials.some(m => graphDrawAttributes(m, mesh.geometry).size > 12)) { exclude('attributeBudget'); continue; }
      this.matrix.multiplyMatrices(this.inverse, mesh.matrixWorld);
      if (!instanceMatrixSupported(this.matrix)) { exclude('transform'); continue; }
      this.eligible++;
      const key = `${mesh.geometry.id}:${Array.isArray(mesh.material) ? 'slots' : 'single'}:` +
        materials.map(m => m.uuid).join(',') + `:${mesh.renderOrder}`;
      const group = groups.get(key);
      if (group) group.push(mesh);
      else groups.set(key, [mesh]);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      // Partition along the widest centre axis, recursively. Adjacent authored
      // names need not be adjacent in space (linked trees span the whole Bridge).
      const partition = (members: THREE.Mesh[]): void => {
        if (members.length > BATCH_SIZE) {
          this.box.makeEmpty();
          for (const mesh of members) this.box.expandByPoint(new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld));
          const size = this.box.getSize(new THREE.Vector3());
          const axis = size.x >= size.y && size.x >= size.z ? 12 : size.y >= size.z ? 13 : 14;
          members.sort((a, b) => a.matrixWorld.elements[axis]! - b.matrixWorld.elements[axis]!);
          const middle = Math.floor(members.length / 2);
          partition(members.slice(0, middle));
          partition(members.slice(middle));
          return;
        }
        if (members.length < 2) return;
        const first = members[0]!;
        const draw = new THREE.InstancedMesh(first.geometry, first.material, members.length);
        draw.name = 'Blender repeated geometry';
        draw.userData['engineInternal'] = true;
        draw.matrixAutoUpdate = false;
        draw.renderOrder = first.renderOrder;
        draw.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        const batch: Batch = {draw, members: members.map(mesh => ({mesh, layers: mesh.layers.mask}))};
        // Return the canonical mesh, not the internal batch or an unstable slot.
        draw.raycast = (raycaster, hits) => {
          for (const {mesh} of batch.members)
            if (mesh.layers.mask === 0 && instanceObjectShown(mesh)) mesh.raycast(raycaster, hits);
        };
        this.root.add(draw);
        draw.updateMatrixWorld(true);
        this.batches.push(batch);
      };
      partition(group);
    }
    this.sync();
  }

  /** Called after the root updates its descendants, before Three builds its
   * render list/uploads attributes. Live gizmo transforms therefore appear on
   * the very next draw, including parent transforms and visibility changes. */
  sync(): void {
    if (!this.batches.length) return;
    this.inverse.copy(this.root.matrixWorld).invert();
    for (const {draw, members} of this.batches) {
      let count = 0;
      let changed = false;
      for (const member of members) {
        const {mesh} = member;
        this.matrix.multiplyMatrices(this.inverse, mesh.matrixWorld);
        // A drag can introduce negative scale/shear, or a skin can replace a
        // mesh between frames. Fall back immediately without touching its data.
        const compatible = mesh.parent !== null && mesh.geometry === draw.geometry &&
          sameMaterials(mesh.material, draw.material) && instanceMatrixSupported(this.matrix);
        if (!compatible) {
          mesh.layers.mask |= member.layers;
          continue;
        }
        mesh.layers.mask &= ~member.layers;
        if (!instanceObjectShown(mesh)) continue;
        // Aggregate batch bounds alone admit off-screen members. Retain the
        // same per-object rejection as ordinary draws before compacting slots.
        if (this.camera && (!this.camera.layers.isEnabled(0) ||
            (mesh.frustumCulled && !this.frustum.intersectsObject(mesh)))) continue;
        const offset = count * 16;
        if (this.matrix.elements.some((value, i) => Math.fround(value) !== draw.instanceMatrix.array[offset + i])) {
          draw.setMatrixAt(count, this.matrix);
          changed = true;
        }
        count++;
      }
      changed ||= draw.count !== count || draw.boundingSphere === null;
      draw.count = count;
      if (changed) {
        draw.instanceMatrix.needsUpdate = true;
        draw.computeBoundingBox();
        draw.computeBoundingSphere();
      }
    }
  }

  prepareDraw(camera: THREE.Camera): void {
    camera.updateMatrixWorld();
    this.camera = camera;
    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projection);
  }

  finishDraw(): void { this.camera = null; }

  clear(): void {
    this.camera = null;
    for (const {draw, members} of this.batches) {
      for (const {mesh, layers} of members) mesh.layers.mask |= layers;
      draw.removeFromParent();
      draw.dispose(); // releases instance attributes, never shared geometry/material
    }
    this.batches.length = 0;
    this.eligible = 0;
    this.excluded = {};
  }

  inspect() {
    return {batches: this.batches.length, instances: this.batches.reduce((count, {draw}) => count + draw.count, 0),
      eligible: this.eligible, excluded: {...this.excluded}};
  }
}
