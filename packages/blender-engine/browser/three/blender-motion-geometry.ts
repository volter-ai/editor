import * as THREE from 'three';
import {instanceObjectShown} from './blender-runtime-instances';
import type {MotionMeshRequest, MotionMeshResponse} from './blender-motion-worker';

const CACHE_BYTES = 64 * 1024 * 1024;
const QUIET_MS = 150;
type Entry = {geometry: THREE.BufferGeometry; error: number; bytes: number};

/** A disposable navigation drawing, never Blender's evaluated geometry.
 * Copies are derived off-thread, in importance order, one bounded mesh at a
 * time. Full meshes remain resident and are restored after EVERY draw. */
export class BlenderMotionGeometry {
  private groups = new Map<THREE.BufferGeometry, THREE.Mesh[]>();
  private readonly cache = new Map<THREE.BufferGeometry, Entry>();
  private readonly swapped: {mesh: THREE.Mesh; geometry: THREE.BufferGeometry}[] = [];
  private queue: THREE.BufferGeometry[] = [];
  private worker: Worker | null = null;
  private pending: {id: number; geometry: THREE.BufferGeometry} | null = null;
  private nextId = 0;
  private signature = '';
  private readonly identities = new WeakMap<object, number>();
  private nextIdentity = 0;
  private bytes = 0;
  private unavailable: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly cameraWorld = new THREE.Matrix4();
  private readonly cameraProjection = new THREE.Matrix4();
  private cameraKnown = false;
  private movedAt = -Infinity;
  private readonly projection = new THREE.Matrix4();
  private readonly frustum = new THREE.Frustum();
  private readonly centre = new THREE.Vector3();
  private drawnMeshes = 0;
  private fullTriangles = 0;
  private motionTriangles = 0;
  private lastNavigation = {meshes: 0, fullTriangles: 0, motionTriangles: 0, tooClose: 0};

  constructor(private readonly invalidate: () => void) {}

  setObjects(objects: Iterable<THREE.Object3D>): void {
    const groups = new Map<THREE.BufferGeometry, THREE.Mesh[]>();
    for (const object of objects) {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh ||
          (mesh as THREE.InstancedMesh).isInstancedMesh || mesh.morphTargetInfluences) continue;
      const g = mesh.geometry;
      const position = g.getAttribute('position');
      if (!g.index || g.index.count < 6144 || !position || position.count > 200_000 ||
          Object.values(g.attributes).some(a => !(a instanceof THREE.BufferAttribute) ||
            (a as THREE.BufferAttribute & {isFloat16BufferAttribute?: boolean}).isFloat16BufferAttribute ||
            (a as THREE.InstancedBufferAttribute).isInstancedBufferAttribute) ||
          Object.keys(g.morphAttributes).length || g.drawRange.start !== 0 || g.drawRange.count < g.index.count) continue;
      // Only a whole, single material surface. Material boundaries are never
      // crossed by the simplifier, nor are authored group ranges shortened.
      if (Array.isArray(mesh.material) && (mesh.material.length !== 1 || g.groups.length !== 1 ||
          g.groups[0]!.start !== 0 || g.groups[0]!.count !== g.index.count || g.groups[0]!.materialIndex !== 0)) continue;
      const held = groups.get(g);
      if (held) held.push(mesh); else groups.set(g, [mesh]);
    }
    this.groups = groups;
    const identity = (object: object): number => {
      let id = this.identities.get(object);
      if (id === undefined) { id = ++this.nextIdentity; this.identities.set(object, id); }
      return id;
    };
    const signature = [...groups].map(([g]) => `${g.id}:${identity(g.index!)}:${g.index!.version}:` +
      Object.entries(g.attributes).map(([name, a]) => `${name}:${identity(a)}:${(a as THREE.BufferAttribute).version}`).join(',')).join(';');
    if (signature === this.signature) return;
    this.releaseCopies();
    this.signature = signature;
    this.unavailable = null;
    const candidates = [...groups].filter(([, meshes]) => meshes.length >= 3);
    // Small scenes use their originals throughout. Prioritize the geometry
    // that costs most draws, not its name or its order in the .blend.
    if (candidates.reduce((n, [g, meshes]) => n + g.index!.count * meshes.length, 0) < 6_000_000) return;
    candidates.sort(([a, am], [b, bm]) => b.index!.count * bm.length - a.index!.count * am.length);
    this.queue = candidates.map(([g]) => g);
    this.next();
  }

  private next(): void {
    if (this.pending || this.unavailable || this.bytes >= CACHE_BYTES) return;
    const geometry = this.queue.shift();
    if (!geometry) { this.worker?.terminate(); this.worker = null; return; }
    if (!this.worker) {
      try {
        this.worker = new Worker(new URL('./blender-motion-worker.ts', import.meta.url), {type: 'module'});
        this.worker.onmessage = (event: MessageEvent<MotionMeshResponse>) => this.receive(event.data);
        this.worker.onerror = event => {
          this.unavailable = event.message || 'Navigation geometry worker unavailable';
          this.worker?.terminate(); this.worker = null; this.pending = null;
          this.queue.length = 0;
        };
      } catch (error) {
        // This is an optional presentation. Refusal retains full geometry,
        // with a visible diagnostic; never fall back to blocking the UI.
        this.unavailable = String(error); return;
      }
    }
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const positions = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      positions[i * 3] = position.getX(i); positions[i * 3 + 1] = position.getY(i); positions[i * 3 + 2] = position.getZ(i);
    }
    // Normals and UVs contribute appearance error. All attributes, including
    // those not used to rank collapses, are retained in the resulting copy.
    const attributes = Object.entries(geometry.attributes).filter(([name]) => name === 'normal' || /^uv\d*$/.test(name));
    const stride = attributes.reduce((n, [, a]) => n + a.itemSize, 0);
    const values = new Float32Array(position.count * stride);
    const weights: number[] = [];
    let offset = 0;
    for (const [name, a] of attributes) {
      for (let c = 0; c < a.itemSize; c++) weights.push(name === 'normal' ? 0.5 : 1);
      for (let i = 0; i < position.count; i++) for (let c = 0; c < a.itemSize; c++)
        values[i * stride + offset + c] = (a as THREE.BufferAttribute).getComponent(i, c);
      offset += a.itemSize;
    }
    const indices = new Uint32Array(geometry.index!.array);
    const id = ++this.nextId;
    this.pending = {id, geometry};
    const request: MotionMeshRequest = {id, positions, indices, attributes: values, stride, weights};
    this.worker.postMessage(request, [positions.buffer, indices.buffer, values.buffer]);
  }

  private receive(response: MotionMeshResponse): void {
    const pending = this.pending;
    if (!pending || pending.id !== response.id) return;
    this.pending = null;
    const {geometry} = pending;
    const indices = response.indices;
    if (response.refusal) {
      this.unavailable = response.refusal;
      this.worker?.terminate(); this.worker = null; this.queue.length = 0;
    }
    if (indices && response.error !== undefined && Number.isFinite(response.error) &&
        indices.length > 0 && indices.length < geometry.index!.count * 0.75) {
      const originals: number[] = [];
      const remap = new Map<number, number>();
      for (let i = 0; i < indices.length; i++) {
        const original = indices[i]!;
        let index = remap.get(original);
        if (index === undefined) { index = originals.length; originals.push(original); remap.set(original, index); }
        indices[i] = index;
      }
      const bytes = indices.byteLength + Object.values(geometry.attributes).reduce((n, a) =>
        n + originals.length * a.itemSize * a.array.BYTES_PER_ELEMENT, 0);
      if (this.bytes + bytes <= CACHE_BYTES) {
        const copy = new THREE.BufferGeometry();
        copy.setIndex(new THREE.BufferAttribute(indices, 1));
        for (const [name, source] of Object.entries(geometry.attributes)) {
          const attribute = source as THREE.BufferAttribute;
          const ArrayType = attribute.array.constructor as {new(length: number): THREE.TypedArray};
          const data = new ArrayType(originals.length * attribute.itemSize);
          for (let i = 0; i < originals.length; i++) for (let c = 0; c < attribute.itemSize; c++)
            data[i * attribute.itemSize + c] = attribute.array[originals[i]! * attribute.itemSize + c]!;
          copy.setAttribute(name, new THREE.BufferAttribute(data, attribute.itemSize, attribute.normalized));
        }
        // Retain the exact culling/sorting bounds and material assignment.
        if (!geometry.boundingSphere) geometry.computeBoundingSphere();
        copy.boundingSphere = geometry.boundingSphere!.clone();
        copy.boundingBox = geometry.boundingBox?.clone() ?? null;
        if (geometry.groups.length === 1) copy.addGroup(0, indices.length, geometry.groups[0]!.materialIndex);
        copy.userData = {...geometry.userData};
        this.cache.set(geometry, {geometry: copy, error: response.error, bytes});
        this.bytes += bytes;
      }
    }
    // Yield between meshes, including copying their attributes for the worker.
    this.timer = setTimeout(() => { this.timer = null; this.next(); }, 0);
  }

  prepare(camera: THREE.Camera, interactive: boolean, height: number): boolean {
    this.finish();
    this.drawnMeshes = this.fullTriangles = this.motionTriangles = 0;
    if (!interactive || !(height > 0)) return false;
    const now = performance.now();
    const moved = this.cameraKnown && (!camera.matrixWorld.equals(this.cameraWorld) ||
      !camera.projectionMatrix.equals(this.cameraProjection));
    this.cameraKnown = true;
    this.cameraWorld.copy(camera.matrixWorld); this.cameraProjection.copy(camera.projectionMatrix);
    if (moved) {
      this.movedAt = now;
      // The host draws on change. Ensure a full-detail frame after damping
      // stops even when no more input or scene-change notification arrives.
      if (this.quietTimer) clearTimeout(this.quietTimer);
      this.quietTimer = setTimeout(() => { this.quietTimer = null; this.invalidate(); }, QUIET_MS + 1);
    }
    if (now - this.movedAt > QUIET_MS) return false;
    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projection);
    let tooClose = 0;
    for (const [source, entry] of this.cache) {
      for (const mesh of this.groups.get(source) ?? []) {
        if (!instanceObjectShown(mesh) || (mesh.frustumCulled && !this.frustum.intersectsObject(mesh))) continue;
        // Frobenius norm bounds the linear transform even under shear; the
        // longest axis alone can understate the projected simplifier error.
        const e = mesh.matrixWorld.elements;
        const scale = Math.hypot(e[0]!, e[1]!, e[2]!, e[4]!, e[5]!, e[6]!, e[8]!, e[9]!, e[10]!);
        const sphere = source.boundingSphere!;
        this.centre.copy(sphere.center).applyMatrix4(mesh.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
        const depth = (camera as THREE.PerspectiveCamera).isPerspectiveCamera
          ? -this.centre.z - sphere.radius * scale : 1;
        const pixels = entry.error * scale * Math.abs(camera.projectionMatrix.elements[5]!) * height / (2 * depth);
        if (!(depth > 0) || pixels > 1) { tooClose++; continue; }
        // Decide per placement: one near-camera blade must not veto thousands
        // of distant placements of its shared geometry. The following draw
        // planner sees these geometry identities, so transparency still batches
        // only consecutive compatible surfaces in the original camera order.
        this.swapped.push({mesh, geometry: source});
        mesh.geometry = entry.geometry;
        this.drawnMeshes++;
        this.fullTriangles += source.index!.count / 3;
        this.motionTriangles += entry.geometry.index!.count / 3;
      }
    }
    this.lastNavigation = {meshes: this.drawnMeshes, fullTriangles: this.fullTriangles,
      motionTriangles: this.motionTriangles, tooClose};
    return this.swapped.length > 0;
  }

  private quietTimer: ReturnType<typeof setTimeout> | null = null;
  finish(): void {
    for (const {mesh, geometry} of this.swapped) mesh.geometry = geometry;
    this.swapped.length = 0;
  }
  inspect() {
    return {copies: this.cache.size, bytes: this.bytes, queued: this.queue.length, pending: this.pending !== null,
      unavailable: this.unavailable, lastNavigation: {...this.lastNavigation}};
  }
  private releaseCopies(): void {
    this.finish();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.worker?.terminate(); this.worker = null; this.pending = null; this.queue = [];
    for (const entry of this.cache.values()) entry.geometry.dispose();
    this.cache.clear(); this.bytes = 0;
  }
  clear(): void {
    this.releaseCopies();
    if (this.quietTimer) clearTimeout(this.quietTimer);
    this.quietTimer = null;
    this.groups.clear(); this.signature = ''; this.cameraKnown = false; this.movedAt = -Infinity;
  }
}
