import { BufferAttribute, BufferGeometry } from 'three';
import { registerGodotObjectIdentity } from './object';
import { bindGodotResourceProtocol, godotResourceEmitChanged } from './resource-io';

function finite(value: unknown, member: string, minimum = 0): number { if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) throw new RangeError(`godot-compat: ${member} requires finite value >= ${minimum}.`); return value; }
function integer(value: unknown, member: string, minimum = 1, maximum = 1024): number { const number = finite(value, member, minimum); if (!Number.isSafeInteger(number) || number > maximum) throw new RangeError(`godot-compat: ${member} requires integer in [${minimum}, ${maximum}].`); return number; }
function bool(value: unknown, member: string): boolean { if (typeof value !== 'boolean') throw new TypeError(`godot-compat: ${member} requires bool.`); return value; }

abstract class GodotTrailMeshBase extends BufferGeometry {
  protected sectionsValue = 5;
  protected sectionLengthValue = 0.2;
  protected curveValue: unknown | null = null;
  protected constructor(className: string) { super(); registerGodotObjectIdentity(this, className); }
  public get sections(): number { return this.getSections(); } public set sections(v: number) { this.setSections(v); }
  public get section_length(): number { return this.getSectionLength(); } public set section_length(v: number) { this.setSectionLength(v); }
  public get curve(): unknown | null { return this.getCurve(); } public set curve(v: unknown | null) { this.setCurve(v); }
  public setSections(value: unknown): void { this.sectionsValue = integer(value, `${this.type}.sections`, 2, 256); this.rebuildChanged(); }
  public getSections(): number { return this.sectionsValue; }
  public setSectionLength(value: unknown): void { this.sectionLengthValue = finite(value, `${this.type}.section_length`, Number.MIN_VALUE); this.rebuildChanged(); }
  public getSectionLength(): number { return this.sectionLengthValue; }
  public setCurve(value: unknown | null): void { this.curveValue = value; this.rebuildChanged(); }
  public getCurve(): unknown | null { return this.curveValue; }
  protected curveScale(t: number): number {
    const curve = this.curveValue as { sample?: (offset: number) => unknown; interpolate?: (offset: number) => unknown } | null;
    const sampled = curve?.sample?.(t) ?? curve?.interpolate?.(t) ?? 1;
    return typeof sampled === 'number' && Number.isFinite(sampled) ? sampled : 1;
  }
  protected rebuildChanged(): void { this.rebuild(); this.computeBoundingBox(); this.computeBoundingSphere(); godotResourceEmitChanged(this); }
  protected abstract rebuild(): void;
}

export class GodotPointMesh extends BufferGeometry {
  public readonly __godotClass = 'PointMesh';
  public constructor() { super(); this.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0]), 3)); registerGodotObjectIdentity(this, 'PointMesh'); bindGodotResourceProtocol<GodotPointMesh>(this, { createDuplicate: () => new GodotPointMesh() }); }
}

export class GodotRibbonTrailMesh extends GodotTrailMeshBase {
  public readonly __godotClass = 'RibbonTrailMesh';
  private sizeValue = 1;
  private sectionSegmentsValue = 3;
  private shapeValue = 0;
  public constructor() { super('RibbonTrailMesh'); this.rebuild(); bindGodotResourceProtocol<GodotRibbonTrailMesh>(this, { createDuplicate: (source) => { const copy = new GodotRibbonTrailMesh(); copy.sizeValue = source.sizeValue; copy.sectionsValue = source.sectionsValue; copy.sectionLengthValue = source.sectionLengthValue; copy.sectionSegmentsValue = source.sectionSegmentsValue; copy.curveValue = source.curveValue; copy.shapeValue = source.shapeValue; copy.rebuild(); return copy; } }); }
  public get size(): number { return this.getSize(); } public set size(v: number) { this.setSize(v); }
  public get section_segments(): number { return this.getSectionSegments(); } public set section_segments(v: number) { this.setSectionSegments(v); }
  public get shape(): number { return this.getShape(); } public set shape(v: number) { this.setShape(v); }
  public setSize(v: unknown): void { this.sizeValue = finite(v, 'RibbonTrailMesh.size', Number.MIN_VALUE); this.rebuildChanged(); } public getSize(): number { return this.sizeValue; }
  public setSectionSegments(v: unknown): void { this.sectionSegmentsValue = integer(v, 'RibbonTrailMesh.section_segments', 1, 64); this.rebuildChanged(); } public getSectionSegments(): number { return this.sectionSegmentsValue; }
  public setShape(v: unknown): void { this.shapeValue = integer(v, 'RibbonTrailMesh.shape', 0, 1); this.rebuildChanged(); } public getShape(): number { return this.shapeValue; }
  protected rebuild(): void {
    const rows = (this.sectionsValue - 1) * this.sectionSegmentsValue + 1, arms = this.shapeValue === 0 ? 1 : 2;
    const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
    for (let arm = 0; arm < arms; arm += 1) for (let row = 0; row < rows; row += 1) {
      const t = row / (rows - 1), half = this.sizeValue * this.curveScale(t) * 0.5, z = -t * this.sectionLengthValue * (this.sectionsValue - 1);
      if (arm === 0) positions.push(-half, 0, z, half, 0, z); else positions.push(0, -half, z, 0, half, z);
      uvs.push(0, t, 1, t);
    }
    for (let arm = 0; arm < arms; arm += 1) { const base = arm * rows * 2; for (let row = 0; row < rows - 1; row += 1) { const a = base + row * 2, b = a + 2; indices.push(a, b, a + 1, a + 1, b, b + 1); } }
    this.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3)); this.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2)); this.setIndex(new BufferAttribute(new Uint32Array(indices), 1)); this.computeVertexNormals();
  }
}

export class GodotTubeTrailMesh extends GodotTrailMeshBase {
  public readonly __godotClass = 'TubeTrailMesh';
  private radiusValue = 0.5;
  private radialStepsValue = 8;
  private sectionRingsValue = 3;
  private capTopValue = true;
  private capBottomValue = true;
  public constructor() { super('TubeTrailMesh'); this.rebuild(); bindGodotResourceProtocol<GodotTubeTrailMesh>(this, { createDuplicate: (source) => { const copy = new GodotTubeTrailMesh(); copy.radiusValue = source.radiusValue; copy.radialStepsValue = source.radialStepsValue; copy.sectionsValue = source.sectionsValue; copy.sectionLengthValue = source.sectionLengthValue; copy.sectionRingsValue = source.sectionRingsValue; copy.capTopValue = source.capTopValue; copy.capBottomValue = source.capBottomValue; copy.curveValue = source.curveValue; copy.rebuild(); return copy; } }); }
  public get radius(): number { return this.getRadius(); } public set radius(v: number) { this.setRadius(v); }
  public get radial_steps(): number { return this.getRadialSteps(); } public set radial_steps(v: number) { this.setRadialSteps(v); }
  public get section_rings(): number { return this.getSectionRings(); } public set section_rings(v: number) { this.setSectionRings(v); }
  public get cap_top(): boolean { return this.isCapTop(); } public set cap_top(v: boolean) { this.setCapTop(v); }
  public get cap_bottom(): boolean { return this.isCapBottom(); } public set cap_bottom(v: boolean) { this.setCapBottom(v); }
  public setRadius(v: unknown): void { this.radiusValue = finite(v, 'TubeTrailMesh.radius', Number.MIN_VALUE); this.rebuildChanged(); } public getRadius(): number { return this.radiusValue; }
  public setRadialSteps(v: unknown): void { this.radialStepsValue = integer(v, 'TubeTrailMesh.radial_steps', 3, 128); this.rebuildChanged(); } public getRadialSteps(): number { return this.radialStepsValue; }
  public setSectionRings(v: unknown): void { this.sectionRingsValue = integer(v, 'TubeTrailMesh.section_rings', 1, 64); this.rebuildChanged(); } public getSectionRings(): number { return this.sectionRingsValue; }
  public setCapTop(v: unknown): void { this.capTopValue = bool(v, 'TubeTrailMesh.cap_top'); this.rebuildChanged(); } public isCapTop(): boolean { return this.capTopValue; }
  public setCapBottom(v: unknown): void { this.capBottomValue = bool(v, 'TubeTrailMesh.cap_bottom'); this.rebuildChanged(); } public isCapBottom(): boolean { return this.capBottomValue; }
  protected rebuild(): void {
    const rings = (this.sectionsValue - 1) * this.sectionRingsValue + 1, stride = this.radialStepsValue + 1;
    const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
    for (let ring = 0; ring < rings; ring += 1) { const t = ring / (rings - 1), radius = this.radiusValue * this.curveScale(t), z = -t * this.sectionLengthValue * (this.sectionsValue - 1); for (let step = 0; step <= this.radialStepsValue; step += 1) { const angle = Math.PI * 2 * step / this.radialStepsValue, x = Math.cos(angle), y = Math.sin(angle); positions.push(x * radius, y * radius, z); normals.push(x, y, 0); uvs.push(step / this.radialStepsValue, t); } }
    for (let ring = 0; ring < rings - 1; ring += 1) for (let step = 0; step < this.radialStepsValue; step += 1) { const a = ring * stride + step, b = a + stride; indices.push(a, b, a + 1, a + 1, b, b + 1); }
    const cap = (top: boolean): void => { const ring = top ? 0 : rings - 1, center = positions.length / 3, z = top ? 0 : -this.sectionLengthValue * (this.sectionsValue - 1); positions.push(0, 0, z); normals.push(0, 0, top ? 1 : -1); uvs.push(0.5, 0.5); for (let step = 0; step < this.radialStepsValue; step += 1) { const a = ring * stride + step, b = a + 1; if (top) indices.push(center, b, a); else indices.push(center, a, b); } };
    if (this.capTopValue) cap(true); if (this.capBottomValue) cap(false);
    this.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3)); this.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3)); this.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2)); this.setIndex(new BufferAttribute(new Uint32Array(indices), 1));
  }
}

export function createGodotPointMesh(): GodotPointMesh { return new GodotPointMesh(); }
export function createGodotRibbonTrailMesh(): GodotRibbonTrailMesh { return new GodotRibbonTrailMesh(); }
export function createGodotTubeTrailMesh(): GodotTubeTrailMesh { return new GodotTubeTrailMesh(); }
