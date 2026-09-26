import type { BufferGeometry } from 'three';
import { registerGodotObjectIdentity } from './object';
import { bindGodotResourceProtocol, godotResourceEmitChanged } from './resource-io';

export interface GodotMeshConvexDecompositionSnapshot {
  readonly maxConcavity: number;
  readonly symmetryPlanesClippingBias: number;
  readonly revolutionAxesClippingBias: number;
  readonly minVolumePerConvexHull: number;
  readonly resolution: number;
  readonly maxNumVerticesPerConvexHull: number;
  readonly planeDownsampling: number;
  readonly convexHullDownsampling: number;
  readonly normalizeMesh: boolean;
  readonly mode: number;
  readonly convexHullApproximation: boolean;
  readonly maxConvexHulls: number;
  readonly projectHullVertices: boolean;
}

export interface GodotMeshConvexDecomposer {
  decompose(mesh: BufferGeometry, settings: GodotMeshConvexDecompositionSnapshot): readonly BufferGeometry[];
}

let decomposer: GodotMeshConvexDecomposer | null = null;

function finite(value: unknown, member: string, minimum = 0, maximum = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) throw new RangeError(`godot-compat: MeshConvexDecompositionSettings.${member} requires finite value in [${minimum}, ${maximum}].`);
  return value;
}
function integer(value: unknown, member: string, minimum = 0, maximum = 0x7fff_ffff): number { const number = finite(value, member, minimum, maximum); if (!Number.isSafeInteger(number)) throw new TypeError(`godot-compat: MeshConvexDecompositionSettings.${member} requires integer.`); return number; }
function bool(value: unknown, member: string): boolean { if (typeof value !== 'boolean') throw new TypeError(`godot-compat: MeshConvexDecompositionSettings.${member} requires bool.`); return value; }

export class GodotMeshConvexDecompositionSettings {
  public readonly __godotClass = 'MeshConvexDecompositionSettings';
  private values = { maxConcavity: 1, symmetryPlanesClippingBias: 0.05, revolutionAxesClippingBias: 0.05, minVolumePerConvexHull: 0.0001, resolution: 10_000, maxNumVerticesPerConvexHull: 32, planeDownsampling: 4, convexHullDownsampling: 4, normalizeMesh: false, mode: 0, convexHullApproximation: true, maxConvexHulls: 1, projectHullVertices: true };
  public constructor() { registerGodotObjectIdentity(this, 'MeshConvexDecompositionSettings'); bindGodotResourceProtocol<GodotMeshConvexDecompositionSettings>(this, { createDuplicate: (source) => { const copy = new GodotMeshConvexDecompositionSettings(); copy.values = { ...source.values }; return copy; } }); }
  private set<K extends keyof typeof this.values>(key: K, value: (typeof this.values)[K]): void { if (this.values[key] === value) return; this.values[key] = value; godotResourceEmitChanged(this); }
  public get max_concavity(): number { return this.getMaxConcavity(); } public set max_concavity(v: number) { this.setMaxConcavity(v); }
  public get symmetry_planes_clipping_bias(): number { return this.getSymmetryPlanesClippingBias(); } public set symmetry_planes_clipping_bias(v: number) { this.setSymmetryPlanesClippingBias(v); }
  public get revolution_axes_clipping_bias(): number { return this.getRevolutionAxesClippingBias(); } public set revolution_axes_clipping_bias(v: number) { this.setRevolutionAxesClippingBias(v); }
  public get min_volume_per_convex_hull(): number { return this.getMinVolumePerConvexHull(); } public set min_volume_per_convex_hull(v: number) { this.setMinVolumePerConvexHull(v); }
  public get resolution(): number { return this.getResolution(); } public set resolution(v: number) { this.setResolution(v); }
  public get max_num_vertices_per_convex_hull(): number { return this.getMaxNumVerticesPerConvexHull(); } public set max_num_vertices_per_convex_hull(v: number) { this.setMaxNumVerticesPerConvexHull(v); }
  public get plane_downsampling(): number { return this.getPlaneDownsampling(); } public set plane_downsampling(v: number) { this.setPlaneDownsampling(v); }
  public get convex_hull_downsampling(): number { return this.getConvexHullDownsampling(); } public set convex_hull_downsampling(v: number) { this.setConvexHullDownsampling(v); }
  public get normalize_mesh(): boolean { return this.getNormalizeMesh(); } public set normalize_mesh(v: boolean) { this.setNormalizeMesh(v); }
  public get mode(): number { return this.getMode(); } public set mode(v: number) { this.setMode(v); }
  public get convex_hull_approximation(): boolean { return this.getConvexHullApproximation(); } public set convex_hull_approximation(v: boolean) { this.setConvexHullApproximation(v); }
  public get max_convex_hulls(): number { return this.getMaxConvexHulls(); } public set max_convex_hulls(v: number) { this.setMaxConvexHulls(v); }
  public get project_hull_vertices(): boolean { return this.getProjectHullVertices(); } public set project_hull_vertices(v: boolean) { this.setProjectHullVertices(v); }
  public setMaxConcavity(v: unknown): void { this.set('maxConcavity', finite(v, 'max_concavity')); } public getMaxConcavity(): number { return this.values.maxConcavity; }
  public setSymmetryPlanesClippingBias(v: unknown): void { this.set('symmetryPlanesClippingBias', finite(v, 'symmetry_planes_clipping_bias', 0, 1)); } public getSymmetryPlanesClippingBias(): number { return this.values.symmetryPlanesClippingBias; }
  public setRevolutionAxesClippingBias(v: unknown): void { this.set('revolutionAxesClippingBias', finite(v, 'revolution_axes_clipping_bias', 0, 1)); } public getRevolutionAxesClippingBias(): number { return this.values.revolutionAxesClippingBias; }
  public setMinVolumePerConvexHull(v: unknown): void { this.set('minVolumePerConvexHull', finite(v, 'min_volume_per_convex_hull')); } public getMinVolumePerConvexHull(): number { return this.values.minVolumePerConvexHull; }
  public setResolution(v: unknown): void { this.set('resolution', integer(v, 'resolution', 10_000, 64_000_000)); } public getResolution(): number { return this.values.resolution; }
  public setMaxNumVerticesPerConvexHull(v: unknown): void { this.set('maxNumVerticesPerConvexHull', integer(v, 'max_num_vertices_per_convex_hull', 4, 1024)); } public getMaxNumVerticesPerConvexHull(): number { return this.values.maxNumVerticesPerConvexHull; }
  public setPlaneDownsampling(v: unknown): void { this.set('planeDownsampling', integer(v, 'plane_downsampling', 1, 32)); } public getPlaneDownsampling(): number { return this.values.planeDownsampling; }
  public setConvexHullDownsampling(v: unknown): void { this.set('convexHullDownsampling', integer(v, 'convex_hull_downsampling', 1, 32)); } public getConvexHullDownsampling(): number { return this.values.convexHullDownsampling; }
  public setNormalizeMesh(v: unknown): void { this.set('normalizeMesh', bool(v, 'normalize_mesh')); } public getNormalizeMesh(): boolean { return this.values.normalizeMesh; }
  public setMode(v: unknown): void { this.set('mode', integer(v, 'mode', 0, 1)); } public getMode(): number { return this.values.mode; }
  public setConvexHullApproximation(v: unknown): void { this.set('convexHullApproximation', bool(v, 'convex_hull_approximation')); } public getConvexHullApproximation(): boolean { return this.values.convexHullApproximation; }
  public setMaxConvexHulls(v: unknown): void { this.set('maxConvexHulls', integer(v, 'max_convex_hulls', 1, 1024)); } public getMaxConvexHulls(): number { return this.values.maxConvexHulls; }
  public setProjectHullVertices(v: unknown): void { this.set('projectHullVertices', bool(v, 'project_hull_vertices')); } public getProjectHullVertices(): boolean { return this.values.projectHullVertices; }
  public snapshot(): GodotMeshConvexDecompositionSnapshot { return Object.freeze({ ...this.values }); }
}

export function createGodotMeshConvexDecompositionSettings(): GodotMeshConvexDecompositionSettings { return new GodotMeshConvexDecompositionSettings(); }
export function bindGodotMeshConvexDecomposer(next: GodotMeshConvexDecomposer | null): () => void { decomposer = next; return () => { if (decomposer === next) decomposer = null; }; }
export function decomposeGodotMeshConvex(mesh: BufferGeometry, settings: GodotMeshConvexDecompositionSettings): BufferGeometry[] { if (decomposer === null) throw new Error('godot-compat: mesh convex decomposition requires bindGodotMeshConvexDecomposer().'); return [...decomposer.decompose(mesh, settings.snapshot())]; }
