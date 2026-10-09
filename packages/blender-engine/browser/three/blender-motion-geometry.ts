import * as THREE from 'three';
import {instanceObjectShown} from './blender-runtime-instances';
import type {MotionMeshRequest, MotionMeshResponse} from './blender-motion-worker';
import { reversedDepthOf } from './reversed-depth';

const CACHE_BYTES = 64 * 1024 * 1024;
const QUIET_MS = 150;
// At most 16,384 triangles are copied/simplified in a single worker request.
const CHUNK_INDICES = 49_152;
const COPY_ITEMS = 8_192;
const cancelled = Symbol('navigation geometry replaced');
type Range = {start: number; count: number; materialIndex?: number | undefined};
type Entry = {geometry: THREE.BufferGeometry; error: number; bytes: number; sharedAttributes: boolean};
type Job = {geometry: THREE.BufferGeometry; fine: boolean};

/** A disposable navigation drawing, never Blender's evaluated geometry.
 * Copies are derived off-thread, in importance order, one bounded mesh at a
 * time. Full meshes remain resident and are restored after EVERY draw. */
export class BlenderMotionGeometry {
  private groups = new Map<THREE.BufferGeometry, THREE.Mesh[]>();
  private readonly cache = new Map<THREE.BufferGeometry, Entry[]>();
  private readonly swapped: {mesh: THREE.Mesh; geometry: THREE.BufferGeometry}[] = [];
  private queue: Job[] = [];
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
  private reductions: {vertices: number; fullTriangles: number; reducedTriangles: number; error: number; fine: boolean; accepted: boolean; bytes?: number}[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly cameraWorld = new THREE.Matrix4();
  private readonly cameraProjection = new THREE.Matrix4();
  private cameraKnown = false;
  private movedAt = -Infinity;
  private readonly projection = new THREE.Matrix4();
  private readonly frustum = new THREE.Frustum();
  private readonly centre = new THREE.Vector3();
  private readonly boxCentre = new THREE.Vector3();
  private readonly halfExtent = new THREE.Vector3();
  private readonly viewWorld = new THREE.Matrix4();
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
    this.queue = candidates.map(([geometry]) => ({geometry, fine: false}));
    this.next();
  }

  private async next(): Promise<void> {
    if (this.building || this.unavailable || this.bytes >= CACHE_BYTES) return;
    const job = this.queue.shift();
    if (!job) { this.worker?.terminate(); this.worker = null; return; }
    const {geometry, fine} = job;
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
      const chunks = ranges.flatMap(range => {
        const chunks: Range[] = [];
        for (let start = range.start; start < range.start + range.count; start += CHUNK_INDICES)
          chunks.push({start, count: Math.min(CHUNK_INDICES, range.start + range.count - start), materialIndex: range.materialIndex});
        return chunks;
      });
      // Lock only the boundaries introduced by partitioning. LockBorder would
      // also pin every vertex on a real leaf's silhouette, defeating LOD even
      // when its edge could simplify within the allowed appearance error.
      // Blender's source-point map joins UV/normal splits at the same point.
      const sourcePoints = geometry.getAttribute('blenderVertex') as THREE.BufferAttribute | undefined;
      const partition = new Uint32Array(position.count);
      const boundary = new Uint8Array(position.count);
      const pointIndex = (vertex: number) => sourcePoints ? sourcePoints.getX(vertex) : vertex;
      for (let chunk = 0; chunk < chunks.length; chunk++) {
        const range = chunks[chunk]!;
        for (let first = range.start; first < range.start + range.count; first += COPY_ITEMS) {
          await yieldCopy();
          for (let i = first; i < Math.min(first + COPY_ITEMS, range.start + range.count); i++) {
            const point = pointIndex(geometry.index!.getX(i));
            if (!Number.isInteger(point) || point < 0 || point >= partition.length) return;
            if (!partition[point]) partition[point] = chunk + 1;
            else if (partition[point] !== chunk + 1) boundary[point] = 1;
          }
        }
      }
      const appearance = Object.entries(geometry.attributes).filter(([name]) => name !== 'position' && name !== 'blenderVertex');
      const stride = appearance.reduce((n, [, a]) => n + a.itemSize, 0);
      if (stride > 32) return; // meshoptimizer's attribute component limit
      const protectedComponents: number[] = [];
      let component = 0;
      for (const [name, attribute] of appearance) {
        for (let c = 0; c < attribute.itemSize; c++, component++) if (name !== 'normal') protectedComponents.push(component);
      }
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
        bounds.max.z - bounds.min.z) * (fine ? 0.0005 : 0.002);
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
          const locks = new Uint8Array(originals.length);
          const positions = new Float32Array(originals.length * 3);
          const values = new Float32Array(originals.length * stride);
          for (let first = 0; first < originals.length; first += COPY_ITEMS) {
            await yieldCopy();
            for (let i = first; i < Math.min(first + COPY_ITEMS, originals.length); i++) {
              const original = originals[i]!;
              locks[i] = boundary[pointIndex(original)]!;
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
            const request: MotionMeshRequest = {id, positions, indices, attributes: values, stride, weights, absoluteError, protectedComponents, locks};
            this.worker!.postMessage(request, [positions.buffer, indices.buffer, values.buffer, locks.buffer]);
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
      const reduction: (typeof this.reductions)[number] = {vertices: position.count, fullTriangles: geometry.index!.count / 3,
        reducedTriangles: count / 3, error, fine, accepted: false};
      if (this.reductions.length < 32) this.reductions.push(reduction);
      if (!count || count >= geometry.index!.count * 0.75) return;
      // A finer level borrows the resident vertex columns and owns only its
      // indices. This avoids another large attribute allocation beside the
      // coarse copy; source versions still invalidate both levels together.
      // Coarse copies remain compact for bounded packed draw families.
      const remap = fine ? null : new Int32Array(position.count).fill(-1);
      const originals: number[] = [];
      const indices = new Uint32Array(count);
      let offset = 0;
      for (const part of parts) {
        for (let first = 0; first < part.length; first += COPY_ITEMS) {
          await yieldCopy();
          for (let i = first; i < Math.min(first + COPY_ITEMS, part.length); i++) {
            const original = part[i]!;
            let local = remap ? remap[original]! : original;
            if (local < 0) { local = originals.length; originals.push(original); remap![original] = local; }
            indices[offset + i] = local;
          }
        }
        offset += part.length;
      }
      const bytes = indices.byteLength + (fine ? 0 : Object.values(geometry.attributes).reduce((n, a) =>
        n + originals.length * a.itemSize * a.array.BYTES_PER_ELEMENT, 0));
      reduction.bytes = bytes;
      if (this.bytes + bytes > CACHE_BYTES) return;
      const copy = new THREE.BufferGeometry();
      copy.setIndex(new THREE.BufferAttribute(indices, 1));
      for (const [name, source] of Object.entries(geometry.attributes)) {
        if (fine) { copy.setAttribute(name, source); continue; }
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
      const levels = this.cache.get(geometry) ?? [];
      levels.push({geometry: copy, error, bytes, sharedAttributes: fine});
      this.cache.set(geometry, levels);
      this.bytes += bytes;
      // Large repeated shapes can be cheap at distance yet still cost millions
      // of triangles just beyond the coarse copy's pixel gate. Build one finer
      // level after the initial queue; every placement keeps the same gate.
      if (!fine && geometry.index!.count >= 300_000 && count < geometry.index!.count * 0.25)
        this.queue.push({geometry, fine: true});
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
    this.frustum.setFromProjectionMatrix(this.projection, THREE.WebGLCoordinateSystem, reversedDepthOf(camera));
    let tooClose = 0;
    for (const [source, levels] of this.cache) {
      // The copy carries the ORIGINAL bounds derived during its yielding
      // build. Do not scan vertices or use the smaller simplified bounds.
      const bounds = levels[0]!.geometry.boundingBox!;
      bounds.getSize(this.halfExtent).multiplyScalar(0.5);
      for (const mesh of this.groups.get(source) ?? []) {
        if (!instanceObjectShown(mesh) || (mesh.frustumCulled && !this.frustum.intersectsObject(mesh))) continue;
        // Bound the largest singular value by the maximum absolute row sum
        // of AᵀA. Unlike Frobenius this is tight for orthogonal TRS columns,
        // while still bounding shear. A uniform rotation must not inflate
        // both error and radius by sqrt(3) and veto nearby placements.
        // Bound in view space, also accounting for an explicitly scaled camera.
        this.viewWorld.multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld);
        const e = this.viewWorld.elements;
        const x2 = e[0]! ** 2 + e[1]! ** 2 + e[2]! ** 2;
        const y2 = e[4]! ** 2 + e[5]! ** 2 + e[6]! ** 2;
        const z2 = e[8]! ** 2 + e[9]! ** 2 + e[10]! ** 2;
        const xy = Math.abs(e[0]! * e[4]! + e[1]! * e[5]! + e[2]! * e[6]!);
        const xz = Math.abs(e[0]! * e[8]! + e[1]! * e[9]! + e[2]! * e[10]!);
        const yz = Math.abs(e[4]! * e[8]! + e[5]! * e[9]! + e[6]! * e[10]!);
        const scale = Math.sqrt(Math.max(x2 + xy + xz, y2 + xy + yz, z2 + xz + yz));
        const sphere = source.boundingSphere!;
        this.centre.copy(sphere.center).applyMatrix4(this.viewWorld);
        let depth = 1;
        if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
          const sphereDepth = -this.centre.z - sphere.radius * scale;
          bounds.getCenter(this.boxCentre).applyMatrix4(this.viewWorld);
          const v = this.viewWorld.elements;
          const radiusZ = Math.abs(v[2]!) * this.halfExtent.x +
            Math.abs(v[6]!) * this.halfExtent.y + Math.abs(v[10]!) * this.halfExtent.z;
          // Both enclosures contain every original vertex. Their nearest
          // depths are lower bounds, so the larger remains a lower bound.
          // A tall shape's height need not inflate its radius toward a level
          // camera. This tightens the bound without relaxing the pixel gate.
          depth = Math.max(sphereDepth, -this.boxCentre.z - radiusZ);
        }
        const pixelsPerUnit = scale * Math.abs(camera.projectionMatrix.elements[5]!) * height / (2 * depth);
        let entry: Entry | undefined;
        if (depth > 0) for (const level of levels) {
          if (level.error * pixelsPerUnit <= 1) { entry = level; break; }
        }
        if (!entry) { tooClose++; continue; }
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
    return {copies: this.cache.size, levels: [...this.cache.values()].reduce((n, levels) => n + levels.length, 0),
      bytes: this.bytes, queued: this.queue.length, pending: this.building,
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
    for (const levels of this.cache.values()) for (const entry of levels) {
      // Geometry.dispose releases its attributes' GPU buffers. A borrowed
      // column remains owned by the original geometry and must stay resident.
      if (entry.sharedAttributes)
        for (const name of Object.keys(entry.geometry.attributes)) entry.geometry.deleteAttribute(name);
      entry.geometry.dispose();
    }
    this.cache.clear(); this.bytes = 0; this.reductions = [];
  }
  clear(): void {
    this.releaseCopies();
    if (this.quietTimer) clearTimeout(this.quietTimer);
    this.quietTimer = null;
    this.groups.clear(); this.signature = ''; this.cameraKnown = false; this.movedAt = -Infinity;
  }
}
