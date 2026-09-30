import * as THREE from 'three';
import type {CompiledGraph} from './blender-node-graph';
import {physicalPaletteMaterial} from './blender-physical-material';
import {presenterChanged} from './blender-presenter-change';

export const ORDERED_BATCH_CAPACITY = 64;
const FAMILY_BYTES = 4 * 1024 * 1024;
const CACHE_BYTES = 32 * 1024 * 1024;
const MAX_DRAWS = 1024;
type Shape = {geometry: THREE.BufferGeometry; stamp: string; bytes: number; paletteIndex: number};
export type OrderedPalette = {identity: THREE.Material; sources: readonly THREE.MeshPhysicalMaterial[]; compiled: CompiledGraph};
type Compilation = {material: THREE.MeshPhysicalMaterial; ready: boolean; refused: boolean; pending: boolean; properties: unknown};
type Family = {material: THREE.Material; shapes: Map<string, Shape>; template: THREE.BatchedMesh | null;
  ids: Map<string, number>; draws: THREE.BatchedMesh[]; dirty: boolean; bytes: number; reservedBytes: number; refused: boolean;
  palette: OrderedPalette | undefined; compilations: Map<THREE.WebGLRenderer, Compilation>};

const PALETTE_ATTRIBUTE = 'blenderPaletteIndex';
const shapeKey = (geometry: THREE.BufferGeometry, paletteIndex: number): string => `${geometry.id}:${paletteIndex}`;

/** Immutable packed attributes are shared between ordered draw runs. Only the
 * matrix/indirection textures and command lists belong to an individual run.
 * All interaction and authored geometry remain on the canonical meshes. */
export class BlenderOrderedBatches {
  private readonly families = new Map<string, Family>();
  private readonly partitions = new Map<string, string[]>();
  private readonly registrations = new Map<string, string | null>();
  private bytes = 0;
  private drawCount = 0;
  private created = 0;
  private compiling = 0;
  pending = false;
  generation = 0;

  begin(): void { this.created = 0; this.pending = false; this.registrations.clear(); }
  beginPaletteFrame(): void { this.compiling = 0; }

  register(geometry: THREE.BufferGeometry, material: THREE.Material, order: number, palette?: OrderedPalette, source?: THREE.Material): string | null {
    const paletteIndex = palette ? palette.sources.indexOf(source as THREE.MeshPhysicalMaterial) : -1;
    if (palette && (paletteIndex < 0 || geometry.hasAttribute(PALETTE_ATTRIBUTE))) return null;
    // One authored geometry can be used by both materials. Its packed shapes
    // then differ by selector; never reuse the first member's column for both.
    const shape = shapeKey(geometry, paletteIndex);
    const registration = `${shape}:${material.uuid}:${order}`;
    if (this.registrations.has(registration)) return this.registrations.get(registration)!;
    this.registrations.set(registration, null);
    const position = geometry.getAttribute('position');
    const count = geometry.index?.count ?? position?.count ?? 0;
    if (!position || geometry.drawRange.start !== 0 || geometry.drawRange.count < count ||
        Object.keys(geometry.morphAttributes).length) return null;
    const layout: unknown[] = [!!geometry.index, geometry.userData['blenderUvChannels'] ?? null];
    const versions: unknown[] = [geometry.index?.id, geometry.index?.version];
    let bytes = (geometry.index?.count ?? 0) * 4 + (palette ? position.count : 0);
    for (const name of Object.keys(geometry.attributes).sort()) {
      const attribute = geometry.getAttribute(name);
      if (!(attribute instanceof THREE.BufferAttribute) ||
          (attribute as THREE.InstancedBufferAttribute).isInstancedBufferAttribute ||
          attribute instanceof THREE.Float16BufferAttribute ||
          attribute.count !== position.count) return null;
      layout.push([name, attribute.array.constructor.name, attribute.itemSize, attribute.normalized, attribute.gpuType]);
      versions.push(name, attribute.id, attribute.version);
      bytes += attribute.array.byteLength;
    }
    if (bytes > FAMILY_BYTES) return null;
    const layoutKey = `multi:${material.uuid}:${order}:${JSON.stringify(layout)}`;
    let keys = this.partitions.get(layoutKey);
    if (!keys) { keys = []; this.partitions.set(layoutKey, keys); }
    // A new compatible shape must not evict every existing run when their
    // union exceeds one bounded allocation (notably full + navigation copies).
    // Partition deterministically, preserving established geometry membership.
    let key = keys.find(key => this.families.get(key)!.shapes.has(shape));
    key ??= keys.find(key => this.families.get(key)!.reservedBytes + bytes <= FAMILY_BYTES);
    if (!key) { key = `${layoutKey}:${keys.length}`; keys.push(key); }
    let family = this.families.get(key);
    if (!family) {
      family = {material, shapes: new Map(), template: null, ids: new Map(), draws: [], dirty: true,
        bytes: 0, reservedBytes: 0, refused: false, palette, compilations: new Map()};
      this.families.set(key, family);
    }
    const stamp = JSON.stringify(versions);
    const held = family.shapes.get(shape);
    if (!held || held.stamp !== stamp) {
      family.reservedBytes += bytes - (held?.bytes ?? 0);
      family.shapes.set(shape, {geometry, stamp, bytes, paletteIndex});
      family.dirty = true;
    }
    this.registrations.set(registration, key);
    return key;
  }

  pack(): void {
    for (const family of this.families.values()) {
      if (!family.dirty) continue;
      this.release(family);
      family.dirty = false;
      let vertices = 0, indices = 0, bytes = 0;
      for (const {geometry} of family.shapes.values()) {
        vertices += geometry.getAttribute('position').count;
        indices += geometry.index?.count ?? 0;
        for (const attribute of Object.values(geometry.attributes)) bytes += attribute.array.byteLength;
      }
      if (family.palette) bytes += vertices;
      bytes += indices * (vertices > 65535 ? 4 : 2);
      family.refused = bytes > FAMILY_BYTES || this.bytes + bytes > CACHE_BYTES;
      if (family.refused) continue;
      const template = new THREE.BatchedMesh(ORDERED_BATCH_CAPACITY, vertices, indices, family.material);
      template.sortObjects = false;
      template.perObjectFrustumCulled = false;
      template.frustumCulled = false;
      template.matrixAutoUpdate = false;
      template.boundingSphere = new THREE.Sphere();
      template.name = 'Blender ordered multi-draw';
      template.userData['engineInternal'] = true;
      for (const [key, {geometry, paletteIndex}] of family.shapes) {
        if (!family.palette) { family.ids.set(key, template.addGeometry(geometry)); continue; }
        const packedShape = new THREE.BufferGeometry();
        // Borrow canonical columns only during the bounded copy into Three's
        // packed geometry. This proxy alone owns the new selector column.
        for (const [name, attribute] of Object.entries(geometry.attributes)) packedShape.setAttribute(name, attribute);
        packedShape.setIndex(geometry.index);
        packedShape.setAttribute(PALETTE_ATTRIBUTE, new THREE.Uint8BufferAttribute(
          new Uint8Array(geometry.getAttribute('position').count).fill(paletteIndex), 1));
        try { family.ids.set(key, template.addGeometry(packedShape)); }
        finally {
          for (const name of Object.keys(geometry.attributes)) packedShape.deleteAttribute(name);
          packedShape.setIndex(null);
          packedShape.dispose();
        }
      }
      // Named UV selection is a geometry-level material input. The family key
      // requires identical maps; every per-vertex graph attribute is copied.
      const first = family.shapes.values().next().value!.geometry;
      template.geometry.userData['blenderUvChannels'] = first.userData['blenderUvChannels'];
      for (const name of Object.keys(first.attributes))
        (template.geometry.getAttribute(name) as THREE.BufferAttribute).gpuType = (first.getAttribute(name) as THREE.BufferAttribute).gpuType;
      family.template = template;
      family.bytes = bytes;
      this.bytes += bytes;
    }
  }

  /** Compile before replacing a single canonical draw, with this renderer's
   * context and actual scene lighting. Each frame starts at most two programs.
   * The proxy borrows packed geometry and owns only its matrix textures. */
  compilePalettes(renderer: THREE.WebGLRenderer, camera: THREE.Camera, scene: THREE.Scene): void {
    if (renderer.getContext().isContextLost()) return;
    for (const family of this.families.values()) {
      const {template, palette} = family;
      if (!template || !palette) continue;
      let compilation = family.compilations.get(renderer);
      // Rendering passes legitimately select different programs on this shared
      // material. Context restoration replaces the material's properties map;
      // program selection alone must not restart compilation every frame.
      if (compilation?.ready && renderer.properties.get(compilation.material) !== compilation.properties) {
        compilation.ready = false;
        this.generation++;
      }
      if (compilation?.ready || compilation?.pending || compilation?.refused) continue;
      if (this.compiling >= 2) { this.pending = true; continue; }
      if (!compilation) {
        const material = physicalPaletteMaterial(palette.compiled, palette.sources, template.geometry);
        if (!material) continue;
        compilation = {material, ready: false, refused: false, pending: false, properties: null};
        family.compilations.set(renderer, compilation);
      }
      const held = compilation;
      held.pending = true;
      held.material.needsUpdate = true;
      const proxy = new THREE.BatchedMesh(1, 0, 0, held.material);
      proxy.geometry.dispose();
      proxy.geometry = template.geometry;
      Object.defineProperty(proxy, 'colorTexture', {value: null});
      this.compiling++;
      const settle = (resolved: boolean) => {
        proxy.geometry = new THREE.BufferGeometry();
        proxy.dispose();
        if (family.template !== template || family.compilations.get(renderer) !== held) {
          held.material.dispose(); return;
        }
        held.pending = false;
        // compileAsync signals completion, including a refused program. Check
        // the actual link result; never let a failed palette hide originals.
        const properties = renderer.properties.get(held.material);
        const program = (properties as {currentProgram?: {program?: WebGLProgram}}).currentProgram;
        const gl = renderer.getContext();
        held.ready = resolved && !gl.isContextLost() && !!program?.program && gl.getProgramParameter(program.program, gl.LINK_STATUS) === true;
        held.properties = properties;
        held.refused = !held.ready && !gl.isContextLost();
        this.generation++;
        if (held.refused) console.warn('Blender ordered material palette did not link; canonical draws retained.');
        presenterChanged();
      };
      try { renderer.compileAsync(proxy, camera, scene).then(() => settle(true), () => settle(false)); }
      catch { settle(false); }
    }
  }

  available(key: string, renderer?: THREE.WebGLRenderer): boolean {
    const family = this.families.get(key);
    return !!family?.template && (!family.palette || (!!renderer && family.compilations.get(renderer)?.ready === true));
  }

  get(key: string, index: number, renderer?: THREE.WebGLRenderer): THREE.BatchedMesh | null {
    const family = this.families.get(key)!;
    const template = family.template;
    if (!template || !this.available(key, renderer)) return null;
    let draw = family.draws[index];
    if (!draw) {
      if (this.drawCount >= MAX_DRAWS) return null;
      // copy() uses public Three APIs and briefly copies the packed arrays.
      // Bound that transient work per frame; ordinary meshes fill every gap.
      if (this.created >= 4) { this.pending = true; return null; }
      draw = new THREE.BatchedMesh(1, 0, 0, family.material);
      draw.dispose();
      draw.copy(template);
      // Three r180's program invalidation reads colorTexture, whereas its
      // program parameters read _colorsTexture. These owned draws never use
      // per-instance colors: expose that same null state to both checks so
      // every draw does not rebuild the already-correct program parameters.
      Object.defineProperty(draw, 'colorTexture', {value: null});
      for (const name of Object.keys(template.geometry.attributes))
        draw.geometry.setAttribute(name, template.geometry.getAttribute(name));
      draw.geometry.setIndex(template.geometry.index);
      const firstId = family.ids.values().next().value!;
      for (let i = 0; i < ORDERED_BATCH_CAPACITY; i++) {
        draw.addInstance(firstId);
        draw.setVisibleAt(i, false);
      }
      family.draws.push(draw);
      this.created++;
      this.drawCount++;
    }
    if (family.palette) draw.material = family.compilations.get(renderer!)!.material;
    return draw;
  }

  geometryId(key: string, geometry: THREE.BufferGeometry, source: THREE.Material): number {
    const family = this.families.get(key)!;
    const index = family.palette ? family.palette.sources.indexOf(source as THREE.MeshPhysicalMaterial) : -1;
    return family.ids.get(shapeKey(geometry, index))!;
  }

  isPalette(key: string): boolean { return !!this.families.get(key)?.palette; }

  inspect() { return {bytes: this.bytes, draws: this.drawCount, pending: this.pending,
    paletteFamilies: [...this.families.values()].filter(f => !!f.palette).length,
    paletteReady: [...this.families.values()].filter(f => [...f.compilations.values()].some(c => c.ready)).length,
    paletteRefused: [...this.families.values()].filter(f => [...f.compilations.values()].some(c => c.refused)).length,
    refusedFamilies: [...this.families.values()].filter(f => f.refused).length}; }

  private release(family: Family): void {
    this.generation++;
    for (const compilation of family.compilations.values()) if (!compilation.pending) compilation.material.dispose();
    family.compilations.clear();
    for (const draw of family.draws) {
      draw.removeFromParent();
      // BatchedMesh.dispose owns its geometry. Detach shared buffer attributes
      // first, so retiring one run cannot delete another run's GPU buffers.
      for (const name of Object.keys(draw.geometry.attributes)) draw.geometry.deleteAttribute(name);
      draw.geometry.setIndex(null);
      draw.dispose();
      this.drawCount--;
    }
    family.draws.length = 0;
    family.template?.dispose();
    family.template = null;
    family.ids.clear();
    this.bytes -= family.bytes;
    family.bytes = 0;
  }

  clear(): void {
    for (const family of this.families.values()) this.release(family);
    this.families.clear();
    this.partitions.clear();
    this.registrations.clear();
    this.pending = false;
  }
}
