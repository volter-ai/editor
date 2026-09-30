import * as THREE from 'three';
import {instanceObjectShown} from './blender-runtime-instances';
import type {MotionMeshRequest, MotionMeshResponse} from './blender-motion-worker';

const CACHE_BYTES = 64 * 1024 * 1024;
const QUIET_MS = 150;
// At most 16,384 triangles are copied/simplified in a single worker request.
const CHUNK_INDICES = 49_152;
const COPY_ITEMS = 8_192;
const cancelled = Symbol('navigation geometry replaced');
type Range = {start: number; count: number; materialIndex?: number | undefined};
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
  private pending: {id: number; resolve: (response: MotionMeshResponse) => void} | null = null;
  private generation = 0;
  private building = false;
  private nextId = 0;
  private signature = '';
  private readonly identities = new WeakMap<object, number>();
  private nextIdentity = 0;
  private bytes = 0;
  private unavailable: string | null = null;
  private reductions: {vertices: number; fullTriangles: number; reducedTriangles: number; error: number; accepted: boolean}[] = [];
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
      if (!g.index || g.index.count < 6144 || !position || position.count > 8_000_000 ||
          Object.values(g.attributes).some(a => !(a instanceof THREE.BufferAttribute) ||
            (a as THREE.BufferAttribute & {isFloat16BufferAttribute?: boolean}).isFloat16BufferAttribute ||
            (a as THREE.InstancedBufferAttribute).isInstancedBufferAttribute) ||
          Object.keys(g.morphAttributes).length || g.drawRange.start !== 0 || g.drawRange.count < g.index.count) continue;
      // Support ordered, disjoint material ranges. Overlaps/gaps or a shared
      // geometry interpreted differently by two objects retain full detail.
      if (Array.isArray(mesh.material)) {
        let end = 0;
        if (!g.groups.length || g.groups.some(range => {
          const valid = range.start === end && range.count > 0 && range.count % 3 === 0 &&
            Number.isInteger(range.materialIndex) && range.materialIndex! >= 0 && range.materialIndex! < (mesh.material as THREE.Material[]).length;
          end = range.start + range.count;
          return !valid;
        }) || end !== g.index.count) continue;
      }
      const held = groups.get(g);
      if (held) held.push(mesh); else groups.set(g, [mesh]);
    }
    this.groups = groups;
    const identity = (object: object): number => {
      let id = this.identities.get(object);
      if (id === undefined) { id = ++this.nextIdentity; this.identities.set(object, id); }
      return id;
    };
    const signature = [...groups].map(([g, meshes]) => `${g.id}:${identity(g.index!)}:${g.index!.version}:${Array.isArray(meshes[0]!.material)}:${JSON.stringify(g.groups)}:` +
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

  private async next(): Promise<void> {
    if (this.building || this.unavailable || this.bytes >= CACHE_BYTES) return;
    const geometry = this.queue.shift();
    if (!geometry) { this.worker?.terminate(); this.worker = null; return; }
    this.building = true;
    const generation = this.generation;
    const current = () => {
      if (generation !== this.generation) throw cancelled;
      if (this.unavailable) throw new Error(this.unavailable);
    };
    const yieldCopy = async () => { await new Promise<void>(resolve => setTimeout(resolve, 0)); current(); };
    try {
      if (!this.worker) {
        this.worker = new Worker(new URL('./blender-motion-worker.ts', import.meta.url), {type: 'module'});
        this.worker.onmessage = (event: MessageEvent<MotionMeshResponse>) => {
          if (this.pending?.id === event.data.id) {
            const pending = this.pending; this.pending = null; pending.resolve(event.data);
          }
        };
        this.worker.onerror = event => {
          this.unavailable = event.message || 'Navigation geometry worker unavailable';
          this.worker?.terminate(); this.worker = null;
          const pending = this.pending; this.pending = null;
          pending?.resolve({id: pending.id, refusal: this.unavailable});
        };
      }
      const position = geometry.getAttribute('position') as THREE.BufferAttribute;
      const meshes = this.groups.get(geometry)!;
      const multi = Array.isArray(meshes[0]!.material);
      if (meshes.some(mesh => Array.isArray(mesh.material) !== multi)) return;
      const ranges: Range[] = multi ? geometry.groups : [{start: 0, count: geometry.index!.count}];
      const appearance = Object.entries(geometry.attributes).filter(([name]) => name === 'normal' || /^uv\d*$/.test(name));
      const stride = appearance.reduce((n, [, a]) => n + a.itemSize, 0);
      const weights = appearance.flatMap(([name, a]) => Array(a.itemSize).fill(name === 'normal' ? 0.5 : 1));
      // Reuse bounds when present, otherwise derive the error scale in
      // yielding slices. Never scan a large mesh in one UI-thread call.
      const bounds = geometry.boundingBox?.clone() ?? new THREE.Box3();
      if (!geometry.boundingBox) {
        const point = new THREE.Vector3();
        for (let first = 0; first < position.count; first += COPY_ITEMS) {
          await yieldCopy();
          for (let i = first; i < Math.min(first + COPY_ITEMS, position.count); i++)
            bounds.expandByPoint(point.fromBufferAttribute(position, i));
        }
      }
      if (!geometry.boundingSphere) return;
      const absoluteError = Math.max(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y,
        bounds.max.z - bounds.min.z) * 0.002;
      const parts: Uint32Array[] = [];
      const outputGroups: Range[] = [];
      let count = 0, error = 0;
      for (const range of ranges) {
        const groupStart = count;
        for (let start = range.start; start < range.start + range.count; start += CHUNK_INDICES) {
          await yieldCopy();
          const end = Math.min(start + CHUNK_INDICES, range.start + range.count);
          const originals: number[] = [], remap = new Map<number, number>();
          const indices = new Uint32Array(end - start);
          for (let i = start; i < end; i++) {
            const original = geometry.index!.getX(i);
            let local = remap.get(original);
            if (local === undefined) { local = originals.length; originals.push(original); remap.set(original, local); }
            indices[i - start] = local;
          }
          const positions = new Float32Array(originals.length * 3);
          const values = new Float32Array(originals.length * stride);
          for (let first = 0; first < originals.length; first += COPY_ITEMS) {
            await yieldCopy();
            for (let i = first; i < Math.min(first + COPY_ITEMS, originals.length); i++) {
              const original = originals[i]!;
              for (let c = 0; c < 3; c++) positions[i * 3 + c] = position.getComponent(original, c);
              let offset = 0;
              for (const [, attribute] of appearance) {
                for (let c = 0; c < attribute.itemSize; c++)
                  values[i * stride + offset + c] = (attribute as THREE.BufferAttribute).getComponent(original, c);
                offset += attribute.itemSize;
              }
            }
          }
          const id = ++this.nextId;
          const response = await new Promise<MotionMeshResponse>(resolve => {
            this.pending = {id, resolve};
            const request: MotionMeshRequest = {id, positions, indices, attributes: values, stride, weights, absoluteError};
            this.worker!.postMessage(request, [positions.buffer, indices.buffer, values.buffer]);
          });
          current();
          if (response.refusal) throw new Error(response.refusal);
          if (!response.indices || !Number.isFinite(response.error)) throw new Error('Invalid navigation geometry response');
          const reduced = response.indices;
          for (let i = 0; i < reduced.length; i++) reduced[i] = originals[reduced[i]!]!;
          count += reduced.length;
          if (count * 4 > CACHE_BYTES - this.bytes) return;
          parts.push(reduced);
          error = Math.max(error, response.error!);
        }
        if (multi) outputGroups.push({start: groupStart, count: count - groupStart, materialIndex: range.materialIndex});
      }
      const reduction = {vertices: position.count, fullTriangles: geometry.index!.count / 3,
        reducedTriangles: count / 3, error, accepted: false};
      if (this.reductions.length < 32) this.reductions.push(reduction);
      if (!count || count >= geometry.index!.count * 0.75) return;
      // Compact only after all material ranges succeed. Yield while remapping
      // and copying; cancellation never publishes a partial surface.
      const remap = new Int32Array(position.count).fill(-1);
      const originals: number[] = [];
      const indices = new Uint32Array(count);
      let offset = 0;
      for (const part of parts) {
        for (let first = 0; first < part.length; first += COPY_ITEMS) {
          await yieldCopy();
          for (let i = first; i < Math.min(first + COPY_ITEMS, part.length); i++) {
            const original = part[i]!;
            let local = remap[original]!;
            if (local < 0) { local = originals.length; originals.push(original); remap[original] = local; }
            indices[offset + i] = local;
          }
        }
        offset += part.length;
      }
      const bytes = indices.byteLength + Object.values(geometry.attributes).reduce((n, a) =>
        n + originals.length * a.itemSize * a.array.BYTES_PER_ELEMENT, 0);
      if (this.bytes + bytes > CACHE_BYTES) return;
      const copy = new THREE.BufferGeometry();
      copy.setIndex(new THREE.BufferAttribute(indices, 1));
      for (const [name, source] of Object.entries(geometry.attributes)) {
        const attribute = source as THREE.BufferAttribute;
        const ArrayType = attribute.array.constructor as {new(length: number): THREE.TypedArray};
        const data = new ArrayType(originals.length * attribute.itemSize);
        for (let first = 0; first < originals.length; first += COPY_ITEMS) {
          await yieldCopy();
          for (let i = first; i < Math.min(first + COPY_ITEMS, originals.length); i++)
            for (let c = 0; c < attribute.itemSize; c++)
              data[i * attribute.itemSize + c] = attribute.array[originals[i]! * attribute.itemSize + c]!;
        }
        copy.setAttribute(name, new THREE.BufferAttribute(data, attribute.itemSize, attribute.normalized));
      }
      copy.boundingSphere = geometry.boundingSphere.clone();
      copy.boundingBox = bounds.clone();
      for (const group of outputGroups) copy.addGroup(group.start, group.count, group.materialIndex);
      copy.userData = {...geometry.userData};
      reduction.accepted = true;
      this.cache.set(geometry, {geometry: copy, error, bytes});
      this.bytes += bytes;
    } catch (error) {
      if (error === cancelled) return;
      this.unavailable = String(error);
      this.worker?.terminate(); this.worker = null; this.pending = null; this.queue.length = 0;
    } finally {
      if (generation === this.generation) {
        this.building = false;
        this.timer = setTimeout(() => { this.timer = null; void this.next(); }, 0);
      }
    }
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
    return {copies: this.cache.size, bytes: this.bytes, queued: this.queue.length, pending: this.building,
      unavailable: this.unavailable, reductions: this.reductions.map(r => ({...r})), lastNavigation: {...this.lastNavigation}};
  }
  private releaseCopies(): void {
    this.finish();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.generation++;
    this.worker?.terminate(); this.worker = null;
    this.pending?.resolve({id: this.pending.id, refusal: 'Navigation geometry replaced'});
    this.pending = null; this.building = false; this.queue = [];
    for (const entry of this.cache.values()) entry.geometry.dispose();
    this.cache.clear(); this.bytes = 0; this.reductions = [];
  }
  clear(): void {
    this.releaseCopies();
    if (this.quietTimer) clearTimeout(this.quietTimer);
    this.quietTimer = null;
    this.groups.clear(); this.signature = ''; this.cameraKnown = false; this.movedAt = -Infinity;
  }
}
