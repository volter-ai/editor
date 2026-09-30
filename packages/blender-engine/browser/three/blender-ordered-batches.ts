import * as THREE from 'three';

export const ORDERED_BATCH_CAPACITY = 64;
const FAMILY_BYTES = 4 * 1024 * 1024;
const CACHE_BYTES = 32 * 1024 * 1024;
const MAX_DRAWS = 1024;
type Shape = {geometry: THREE.BufferGeometry; stamp: string};
type Family = {material: THREE.Material; shapes: Map<number, Shape>; template: THREE.BatchedMesh | null;
  ids: Map<number, number>; draws: THREE.BatchedMesh[]; dirty: boolean; bytes: number; refused: boolean};

/** Immutable packed attributes are shared between ordered draw runs. Only the
 * matrix/indirection textures and command lists belong to an individual run.
 * All interaction and authored geometry remain on the canonical meshes. */
export class BlenderOrderedBatches {
  private readonly families = new Map<string, Family>();
  private readonly registrations = new Map<string, string | null>();
  private bytes = 0;
  private drawCount = 0;
  private created = 0;
  pending = false;

  begin(): void { this.created = 0; this.pending = false; this.registrations.clear(); }

  register(geometry: THREE.BufferGeometry, material: THREE.Material, order: number): string | null {
    const registration = `${geometry.id}:${material.uuid}:${order}`;
    if (this.registrations.has(registration)) return this.registrations.get(registration)!;
    this.registrations.set(registration, null);
    const position = geometry.getAttribute('position');
    const count = geometry.index?.count ?? position?.count ?? 0;
    if (!position || geometry.drawRange.start !== 0 || geometry.drawRange.count < count ||
        Object.keys(geometry.morphAttributes).length) return null;
    const layout: unknown[] = [!!geometry.index, geometry.userData['blenderUvChannels'] ?? null];
    const versions: unknown[] = [geometry.index?.id, geometry.index?.version];
    let bytes = (geometry.index?.count ?? 0) * 4;
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
    const key = `multi:${material.uuid}:${order}:${JSON.stringify(layout)}`;
    let family = this.families.get(key);
    if (!family) {
      family = {material, shapes: new Map(), template: null, ids: new Map(), draws: [], dirty: true, bytes: 0, refused: false};
      this.families.set(key, family);
    }
    const stamp = JSON.stringify(versions);
    const held = family.shapes.get(geometry.id);
    if (!held || held.stamp !== stamp) {
      family.shapes.set(geometry.id, {geometry, stamp});
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
      for (const {geometry} of family.shapes.values()) family.ids.set(geometry.id, template.addGeometry(geometry));
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

  available(key: string): boolean { return !!this.families.get(key)?.template; }

  get(key: string, index: number): THREE.BatchedMesh | null {
    const family = this.families.get(key)!;
    const template = family.template;
    if (!template) return null;
    let draw = family.draws[index];
    if (!draw) {
      if (this.drawCount >= MAX_DRAWS) return null;
      // copy() uses public Three APIs and briefly copies the packed arrays.
      // Bound that transient work per frame; ordinary meshes fill every gap.
      if (this.created >= 4) { this.pending = true; return null; }
      draw = new THREE.BatchedMesh(1, 0, 0, family.material);
      draw.dispose();
      draw.copy(template);
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
    return draw;
  }

  geometryId(key: string, geometry: THREE.BufferGeometry): number { return this.families.get(key)!.ids.get(geometry.id)!; }

  inspect() { return {bytes: this.bytes, draws: this.drawCount, pending: this.pending,
    refusedFamilies: [...this.families.values()].filter(f => f.refused).length}; }

  private release(family: Family): void {
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
    this.registrations.clear();
    this.pending = false;
  }
}
