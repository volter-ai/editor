import * as THREE from 'three';

const CACHE_BYTES = 8 * 1024 * 1024;
type Copy = {geometry: THREE.BufferGeometry; signature: string; bytes: number; before: number; after: number};

/** Three sorts opaque groups by material id before drawing. Consolidate the
 * ranges that are already consecutive in that render order, preserving index
 * order inside each material. No transparency, vertices or authored slots change. */
export class BlenderMaterialRanges {
  private objects: THREE.Mesh[] = [];
  private readonly copies = new Map<string, Copy>();
  private readonly swapped: {mesh: THREE.Mesh; geometry: THREE.BufferGeometry}[] = [];
  private bytes = 0;
  private savedDraws = 0;

  setObjects(objects: Iterable<THREE.Object3D>): void {
    this.clear();
    this.objects = [...objects].filter((o): o is THREE.Mesh => (o as THREE.Mesh).isMesh === true);
  }

  prepare(): void {
    this.savedDraws = 0;
    for (const mesh of this.objects) {
      const source = mesh.geometry;
      const materials = mesh.material;
      if (mesh.layers.mask === 0 || !Array.isArray(materials) || source.groups.length < 8 || !source.index ||
          (mesh as THREE.SkinnedMesh).isSkinnedMesh || (mesh as THREE.InstancedMesh).isInstancedMesh ||
          mesh.morphTargetInfluences || Object.keys(source.morphAttributes).length ||
          source.drawRange.start !== 0 || source.drawRange.count < source.index.count ||
          materials.some(m => m.transparent || (m as THREE.MeshPhysicalMaterial).transmission > 0 ||
            (m as THREE.ShaderMaterial).isShaderMaterial)) continue;
      const signature = JSON.stringify([source.id, source.index.id, source.index.version,
        materials.map(m => m.uuid), source.groups,
        Object.entries(source.attributes).map(([name, a]) => [name, (a as THREE.BufferAttribute).id])]);
      let copy = this.copies.get(signature);
      if (!copy) {
        // Partial/overlapping/out-of-order ranges have independent semantics;
        // retain them verbatim instead of inferring missing triangles.
        let end = 0, valid = true;
        const grouped = new Map<string, {slot: number; groups: THREE.BufferGeometry['groups']}>();
        for (const group of source.groups) {
          const slot = group.materialIndex ?? 0;
          const material = materials[slot];
          if (!material || group.start !== end || group.count <= 0 || group.count % 3 !== 0) { valid = false; break; }
          end += group.count;
          const entry = grouped.get(material.uuid);
          if (entry) entry.groups.push(group);
          else grouped.set(material.uuid, {slot, groups: [group]});
        }
        if (!valid || end !== source.index.count || grouped.size >= source.groups.length) continue;
        const bytes = source.index.array.byteLength;
        if (this.bytes + bytes > CACHE_BYTES) continue;
        const geometry = new THREE.BufferGeometry();
        for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute);
        const index = source.index.clone();
        let offset = 0;
        for (const entry of grouped.values()) {
          const start = offset;
          for (const group of entry.groups) {
            index.array.set(source.index.array.subarray(group.start, group.start + group.count), offset);
            offset += group.count;
          }
          geometry.addGroup(start, offset - start, entry.slot);
        }
        geometry.setIndex(index);
        geometry.boundingBox = source.boundingBox?.clone() ?? null;
        geometry.boundingSphere = source.boundingSphere?.clone() ?? null;
        geometry.userData = {...source.userData};
        copy = {geometry, signature, bytes, before: source.groups.length, after: grouped.size};
        this.copies.set(signature, copy);
        this.bytes += bytes;
      }
      this.swapped.push({mesh, geometry: source});
      mesh.geometry = copy.geometry;
      this.savedDraws += copy.before - copy.after;
    }
  }

  finish(): void {
    for (const {mesh, geometry} of this.swapped) mesh.geometry = geometry;
    this.swapped.length = 0;
  }

  inspect() { return {copies: this.copies.size, bytes: this.bytes, savedRanges: this.savedDraws}; }

  private release(copy: Copy): void {
    // Only the reordered index is owned; vertex attributes stay canonical.
    for (const name of Object.keys(copy.geometry.attributes)) copy.geometry.deleteAttribute(name);
    copy.geometry.dispose();
    this.bytes -= copy.bytes;
  }

  clear(): void {
    this.finish();
    for (const copy of this.copies.values()) this.release(copy);
    this.copies.clear();
    this.objects = [];
    this.savedDraws = 0;
  }
}
