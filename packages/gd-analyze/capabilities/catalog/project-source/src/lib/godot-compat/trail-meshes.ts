import { BufferAttribute, BufferGeometry } from 'three';
import { retainGodotMeshResource } from './mesh-instance';
import { registerGodotObjectIdentity } from './object';
import { godotResourceEmitChanged } from './resource-io';

export const GODOT_RIBBON_TRAIL_SHAPE_FLAT = 0;
export const GODOT_RIBBON_TRAIL_SHAPE_CROSS = 1;

export interface GodotTrailCurve {
  sample_baked(offset: number): number;
}

interface RibbonState {
  size: number;
  sections: number;
  sectionLength: number;
  sectionSegments: number;
  shape: number;
  curve: GodotTrailCurve | null;
}

interface TubeState {
  radius: number;
  radialSteps: number;
  sections: number;
  sectionLength: number;
  sectionRings: number;
  capTop: boolean;
  capBottom: boolean;
  curve: GodotTrailCurve | null;
}

const RIBBONS = new WeakMap<BufferGeometry, RibbonState>();
const TUBES = new WeakMap<BufferGeometry, TubeState>();

function positive(value: number, member: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${member} requires a positive finite value.`);
  return value;
}

function count(value: number, minimum: number, member: string): number {
  return Math.max(minimum, Math.trunc(positive(value, member)));
}

function curveScale(curve: GodotTrailCurve | null, t: number): number {
  if (!curve) return 1;
  const sampled = curve.sample_baked(t);
  return Number.isFinite(sampled) ? sampled : 1;
}

function assign(geometry: BufferGeometry, positions: number[], normals: number[], uvs: number[], indices: number[]): void {
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  godotResourceEmitChanged(geometry);
}

function ribbonStrip(
  state: RibbonState,
  positions: number[],
  normals: number[],
  uvs: number[],
  indices: number[],
  cross: boolean,
): void {
  const rows = state.sections * state.sectionSegments;
  const base = positions.length / 3;
  for (let row = 0; row <= rows; row += 1) {
    const t = rows === 0 ? 0 : row / rows;
    const half = state.size * curveScale(state.curve, t) * 0.5;
    const y = -t * state.sections * state.sectionLength;
    if (cross) {
      positions.push(0, y, -half, 0, y, half);
      normals.push(1, 0, 0, 1, 0, 0);
    } else {
      positions.push(-half, y, 0, half, y, 0);
      normals.push(0, 0, 1, 0, 0, 1);
    }
    uvs.push(0, t, 1, t);
    if (row < rows) {
      const first = base + row * 2;
      indices.push(first, first + 2, first + 1, first + 1, first + 2, first + 3);
    }
  }
}

function rebuildRibbon(geometry: BufferGeometry, state: RibbonState): void {
  const positions: number[] = []; const normals: number[] = []; const uvs: number[] = []; const indices: number[] = [];
  ribbonStrip(state, positions, normals, uvs, indices, false);
  if (state.shape === GODOT_RIBBON_TRAIL_SHAPE_CROSS) ribbonStrip(state, positions, normals, uvs, indices, true);
  assign(geometry, positions, normals, uvs, indices);
}

export function createGodotRibbonTrailMesh(): BufferGeometry {
  const geometry = new BufferGeometry();
  const state: RibbonState = { size: 1, sections: 5, sectionLength: 0.2, sectionSegments: 3, shape: GODOT_RIBBON_TRAIL_SHAPE_FLAT, curve: null };
  registerGodotObjectIdentity(geometry, 'RibbonTrailMesh'); RIBBONS.set(geometry, state); rebuildRibbon(geometry, state);
  return retainGodotMeshResource(geometry);
}

function ribbon(value: unknown): { geometry: BufferGeometry; state: RibbonState } {
  if (!(value instanceof BufferGeometry)) throw new TypeError('RibbonTrailMesh requires native THREE.BufferGeometry.');
  const state = RIBBONS.get(value); if (!state) throw new TypeError('RibbonTrailMesh member requires a retained RibbonTrailMesh Resource.');
  return { geometry: value, state };
}

export function getGodotRibbonTrailMeshSize(value: unknown): number { return ribbon(value).state.size; }
export function setGodotRibbonTrailMeshSize(value: unknown, size: number): void { const { geometry, state } = ribbon(value); state.size = positive(size, 'RibbonTrailMesh.size'); rebuildRibbon(geometry, state); }
export function getGodotRibbonTrailMeshSections(value: unknown): number { return ribbon(value).state.sections; }
export function setGodotRibbonTrailMeshSections(value: unknown, sections: number): void { const { geometry, state } = ribbon(value); state.sections = count(sections, 1, 'RibbonTrailMesh.sections'); rebuildRibbon(geometry, state); }
export function getGodotRibbonTrailMeshSectionLength(value: unknown): number { return ribbon(value).state.sectionLength; }
export function setGodotRibbonTrailMeshSectionLength(value: unknown, length: number): void { const { geometry, state } = ribbon(value); state.sectionLength = positive(length, 'RibbonTrailMesh.section_length'); rebuildRibbon(geometry, state); }
export function getGodotRibbonTrailMeshSectionSegments(value: unknown): number { return ribbon(value).state.sectionSegments; }
export function setGodotRibbonTrailMeshSectionSegments(value: unknown, segments: number): void { const { geometry, state } = ribbon(value); state.sectionSegments = count(segments, 1, 'RibbonTrailMesh.section_segments'); rebuildRibbon(geometry, state); }
export function getGodotRibbonTrailMeshShape(value: unknown): number { return ribbon(value).state.shape; }
export function setGodotRibbonTrailMeshShape(value: unknown, shape: number): void { const { geometry, state } = ribbon(value); state.shape = shape; rebuildRibbon(geometry, state); }
export function getGodotRibbonTrailMeshCurve(value: unknown): GodotTrailCurve | null { return ribbon(value).state.curve; }
export function setGodotRibbonTrailMeshCurve(value: unknown, curve: GodotTrailCurve | null): void { const { geometry, state } = ribbon(value); state.curve = curve; rebuildRibbon(geometry, state); }

function rebuildTube(geometry: BufferGeometry, state: TubeState): void {
  const positions: number[] = []; const normals: number[] = []; const uvs: number[] = []; const indices: number[] = [];
  const rows = state.sections * state.sectionRings;
  for (let row = 0; row <= rows; row += 1) {
    const t = rows === 0 ? 0 : row / rows;
    const radius = state.radius * curveScale(state.curve, t);
    const y = -t * state.sections * state.sectionLength;
    for (let side = 0; side <= state.radialSteps; side += 1) {
      const u = side / state.radialSteps; const angle = u * Math.PI * 2; const x = Math.cos(angle); const z = Math.sin(angle);
      positions.push(x * radius, y, z * radius); normals.push(x, 0, z); uvs.push(u, t);
      if (row < rows && side < state.radialSteps) {
        const first = row * (state.radialSteps + 1) + side; const next = first + state.radialSteps + 1;
        indices.push(first, next, first + 1, first + 1, next, next + 1);
      }
    }
  }
  const cap = (top: boolean): void => {
    const center = positions.length / 3; const y = top ? 0 : -state.sections * state.sectionLength;
    positions.push(0, y, 0); normals.push(0, top ? 1 : -1, 0); uvs.push(0.5, 0.5);
    const ring = top ? 0 : rows * (state.radialSteps + 1);
    for (let side = 0; side < state.radialSteps; side += 1) {
      if (top) indices.push(center, ring + side + 1, ring + side);
      else indices.push(center, ring + side, ring + side + 1);
    }
  };
  if (state.capTop) cap(true);
  if (state.capBottom) cap(false);
  assign(geometry, positions, normals, uvs, indices);
}

export function createGodotTubeTrailMesh(): BufferGeometry {
  const geometry = new BufferGeometry();
  const state: TubeState = { radius: 0.5, radialSteps: 8, sections: 5, sectionLength: 0.2, sectionRings: 3, capTop: true, capBottom: true, curve: null };
  registerGodotObjectIdentity(geometry, 'TubeTrailMesh'); TUBES.set(geometry, state); rebuildTube(geometry, state);
  return retainGodotMeshResource(geometry);
}

function tube(value: unknown): { geometry: BufferGeometry; state: TubeState } {
  if (!(value instanceof BufferGeometry)) throw new TypeError('TubeTrailMesh requires native THREE.BufferGeometry.');
  const state = TUBES.get(value); if (!state) throw new TypeError('TubeTrailMesh member requires a retained TubeTrailMesh Resource.');
  return { geometry: value, state };
}

export function getGodotTubeTrailMeshRadius(value: unknown): number { return tube(value).state.radius; }
export function setGodotTubeTrailMeshRadius(value: unknown, radius: number): void { const { geometry, state } = tube(value); state.radius = positive(radius, 'TubeTrailMesh.radius'); rebuildTube(geometry, state); }
export function getGodotTubeTrailMeshRadialSteps(value: unknown): number { return tube(value).state.radialSteps; }
export function setGodotTubeTrailMeshRadialSteps(value: unknown, steps: number): void { const { geometry, state } = tube(value); state.radialSteps = count(steps, 3, 'TubeTrailMesh.radial_steps'); rebuildTube(geometry, state); }
export function getGodotTubeTrailMeshSections(value: unknown): number { return tube(value).state.sections; }
export function setGodotTubeTrailMeshSections(value: unknown, sections: number): void { const { geometry, state } = tube(value); state.sections = count(sections, 1, 'TubeTrailMesh.sections'); rebuildTube(geometry, state); }
export function getGodotTubeTrailMeshSectionLength(value: unknown): number { return tube(value).state.sectionLength; }
export function setGodotTubeTrailMeshSectionLength(value: unknown, length: number): void { const { geometry, state } = tube(value); state.sectionLength = positive(length, 'TubeTrailMesh.section_length'); rebuildTube(geometry, state); }
export function getGodotTubeTrailMeshSectionRings(value: unknown): number { return tube(value).state.sectionRings; }
export function setGodotTubeTrailMeshSectionRings(value: unknown, rings: number): void { const { geometry, state } = tube(value); state.sectionRings = count(rings, 1, 'TubeTrailMesh.section_rings'); rebuildTube(geometry, state); }
export function getGodotTubeTrailMeshCapTop(value: unknown): boolean { return tube(value).state.capTop; }
export function setGodotTubeTrailMeshCapTop(value: unknown, enabled: boolean): void { const { geometry, state } = tube(value); state.capTop = enabled; rebuildTube(geometry, state); }
export function getGodotTubeTrailMeshCapBottom(value: unknown): boolean { return tube(value).state.capBottom; }
export function setGodotTubeTrailMeshCapBottom(value: unknown, enabled: boolean): void { const { geometry, state } = tube(value); state.capBottom = enabled; rebuildTube(geometry, state); }
export function getGodotTubeTrailMeshCurve(value: unknown): GodotTrailCurve | null { return tube(value).state.curve; }
export function setGodotTubeTrailMeshCurve(value: unknown, curve: GodotTrailCurve | null): void { const { geometry, state } = tube(value); state.curve = curve; rebuildTube(geometry, state); }
