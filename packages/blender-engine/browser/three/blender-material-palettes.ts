import * as THREE from 'three';
import {materialGraph, paletteGraphReady, paletteGraphs} from './blender-graph-material';
import {physicalPaletteState, samePhysicalPaletteState} from './blender-physical-material';
import type {OrderedPalette} from './blender-ordered-batches';

type Snapshot = {source: THREE.MeshPhysicalMaterial; state: NonNullable<ReturnType<typeof physicalPaletteState>>;
  compatible: NonNullable<ReturnType<typeof physicalPaletteState>>};

/** Pair only complete, equal shader/render states. Each frame observes shared
 * sources once; member meshes keep their authored materials. Any change drops
 * the disposable packed families before their old identities are released. */
export class BlenderMaterialPalettes {
  private snapshots: Snapshot[] = [];
  private readonly palettes = new Map<THREE.Material, OrderedPalette>();
  private readonly owned: OrderedPalette[] = [];

  prepare(materials: Iterable<THREE.Material>, releaseDraws: () => void): boolean {
    const snapshots: Snapshot[] = [];
    for (const source of new Set(materials)) {
      if (!(source instanceof THREE.MeshPhysicalMaterial) || !source.visible || !source.transparent ||
          source.transmission > 0 || (source.side === THREE.DoubleSide && !source.forceSinglePass) ||
          !paletteGraphReady(source)) continue;
      const state = physicalPaletteState(source, true);
      const compatible = physicalPaletteState(source);
      const graph = materialGraph(source);
      if (!state || !compatible || !graph) continue;
      state.push(graph.key, graph.declarations);
      snapshots.push({source, state, compatible});
    }
    snapshots.sort((a, b) => a.source.uuid.localeCompare(b.source.uuid));
    if (snapshots.length === this.snapshots.length && snapshots.every((snapshot, index) =>
      snapshot.source === this.snapshots[index]!.source && samePhysicalPaletteState(snapshot.state, this.snapshots[index]!.state))) return false;
    releaseDraws();
    this.clear();
    this.snapshots = snapshots;
    const paired = new Set<THREE.Material>();
    for (let first = 0; first < snapshots.length && this.owned.length < 16; first++) {
      const a = snapshots[first]!;
      if (paired.has(a.source)) continue;
      for (let second = first + 1; second < snapshots.length; second++) {
        const b = snapshots[second]!;
        if (paired.has(b.source) || !samePhysicalPaletteState(a.compatible, b.compatible)) continue;
        const sources = [a.source, b.source];
        const compiled = paletteGraphs(sources);
        if (!compiled) continue;
        const palette: OrderedPalette = {identity: new THREE.Material(), sources, compiled};
        this.owned.push(palette);
        for (const source of sources) { paired.add(source); this.palettes.set(source, palette); }
        break;
      }
    }
    return true;
  }

  get(source: THREE.Material): OrderedPalette | undefined { return this.palettes.get(source); }

  clear(): void {
    for (const palette of this.owned) palette.identity.dispose();
    this.owned.length = 0;
    this.palettes.clear();
    this.snapshots = [];
  }

  inspect() { return {pairs: this.owned.length, limit: 16}; }
}
