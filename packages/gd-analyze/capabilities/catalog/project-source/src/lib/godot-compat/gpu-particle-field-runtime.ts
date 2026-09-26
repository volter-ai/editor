import { godotRidGetId, type GodotRid } from './gdscript-builtins';
import { registerGodotObjectIdentity } from './object';

export type GodotGpuParticleFieldKind = 'sphere-collider' | 'box-collider' | 'heightfield-collider' | 'vector-field' | 'sphere-attractor' | 'box-attractor';
export interface GodotGpuParticleFieldDescriptor {
  readonly rid: GodotRid;
  readonly kind: GodotGpuParticleFieldKind;
  readonly transform?: unknown;
  readonly extents?: { readonly x: number; readonly y: number; readonly z: number };
  readonly radius?: number;
  readonly strength?: number;
  readonly attenuation?: number;
  readonly directionality?: number;
  readonly texture?: GodotRid | null;
  readonly layerMask?: number;
  readonly enabled?: boolean;
  readonly priority?: number;
  readonly userData?: unknown;
}
export interface GodotGpuParticleFieldState extends Required<Omit<GodotGpuParticleFieldDescriptor, 'userData'>> {
  readonly dirty: boolean;
  readonly lastUploadedFrame: number;
  readonly generation: number;
  readonly userData: unknown;
}
export interface GodotGpuParticleFieldSystemDescriptor { readonly particles: GodotRid; readonly collisionMask?: number; readonly attractorMask?: number; readonly enabled?: boolean; readonly userData?: unknown }
export interface GodotGpuParticleFieldSystemState extends Required<Omit<GodotGpuParticleFieldSystemDescriptor, 'userData'>> { readonly fields: readonly GodotRid[]; readonly lastAppliedFrame: number; readonly generation: number; readonly userData: unknown }
export interface GodotGpuParticleFieldBatch { readonly frame: number; readonly system: GodotGpuParticleFieldSystemState; readonly fields: readonly GodotGpuParticleFieldState[] }
export interface GodotGpuParticleFieldBackend { uploadField(frame: number, field: GodotGpuParticleFieldState): void | Promise<void>; removeField?(rid: GodotRid): void; apply(batch: GodotGpuParticleFieldBatch): void | Promise<void> }
export interface GodotGpuParticleFieldFrameResult { readonly frame: number; readonly uploadedFields: readonly GodotRid[]; readonly systems: readonly GodotRid[]; readonly influences: number; readonly failed: readonly { rid: GodotRid; error: unknown }[] }
export interface GodotGpuParticleFieldSnapshot { readonly frame: number; readonly fields: readonly GodotGpuParticleFieldState[]; readonly systems: readonly GodotGpuParticleFieldSystemState[]; readonly dirtyFields: number; readonly uploads: number; readonly applications: number; readonly generation: number; readonly lastFrame: GodotGpuParticleFieldFrameResult | null }
interface FieldEntry { rid: GodotRid; kind: GodotGpuParticleFieldKind; transform: unknown; extents: { x: number; y: number; z: number }; radius: number; strength: number; attenuation: number; directionality: number; texture: GodotRid | null; layerMask: number; enabled: boolean; priority: number; dirty: boolean; lastUploadedFrame: number; generation: number; userData: unknown; order: number }
interface SystemEntry { particles: GodotRid; collisionMask: number; attractorMask: number; enabled: boolean; fields: GodotRid[]; lastAppliedFrame: number; generation: number; userData: unknown; order: number }
const KINDS = new Set<GodotGpuParticleFieldKind>(['sphere-collider', 'box-collider', 'heightfield-collider', 'vector-field', 'sphere-attractor', 'box-attractor']);
function integer(value: unknown, member: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number { const result = Number(value); if (!Number.isSafeInteger(result) || result < minimum || result > maximum) throw new RangeError(`godot-compat: GpuParticleFieldRuntime.${member} requires integer in [${minimum}, ${maximum}].`); return result; }
function finite(value: unknown, member: string, minimum = -Infinity, maximum = Infinity): number { const result = Number(value); if (!Number.isFinite(result) || result < minimum || result > maximum) throw new RangeError(`godot-compat: GpuParticleFieldRuntime.${member} requires finite value in [${minimum}, ${maximum}].`); return result; }
function bool(value: unknown, member: string): boolean { if (typeof value !== 'boolean') throw new TypeError(`godot-compat: GpuParticleFieldRuntime.${member} requires bool.`); return value; }
function rid(value: unknown): GodotRid { if (value === null || typeof value !== 'object') throw new TypeError('godot-compat: GpuParticleFieldRuntime requires RID.'); godotRidGetId(value); return value as GodotRid; }
function optionalRid(value: unknown): GodotRid | null { return value === null || value === undefined ? null : rid(value); }
function kind(value: unknown): GodotGpuParticleFieldKind { if (!KINDS.has(value as GodotGpuParticleFieldKind)) throw new TypeError(`godot-compat: unknown particle field kind ${String(value)}.`); return value as GodotGpuParticleFieldKind; }
function vector(value: unknown): { x: number; y: number; z: number } { if (typeof value !== 'object' || value === null || !('x' in value) || !('y' in value) || !('z' in value)) throw new TypeError('godot-compat: particle field extents require Vector3.'); return Object.freeze({ x: finite(value.x, 'extents.x', 0), y: finite(value.y, 'extents.y', 0), z: finite(value.z, 'extents.z', 0) }); }
function fieldState(entry: FieldEntry): GodotGpuParticleFieldState { return Object.freeze({ ...entry }); }
function systemState(entry: SystemEntry): GodotGpuParticleFieldSystemState { return Object.freeze({ particles: entry.particles, collisionMask: entry.collisionMask, attractorMask: entry.attractorMask, enabled: entry.enabled, fields: Object.freeze([...entry.fields]), lastAppliedFrame: entry.lastAppliedFrame, generation: entry.generation, userData: entry.userData }); }
function isAttractor(value: GodotGpuParticleFieldKind): boolean { return value === 'sphere-attractor' || value === 'box-attractor' || value === 'vector-field'; }

export class GodotGpuParticleFieldRuntime {
  public readonly __godotClass = 'GpuParticleFieldRuntime'; private readonly backend: GodotGpuParticleFieldBackend;
  private readonly fields = new Map<bigint, FieldEntry>(); private readonly systems = new Map<bigint, SystemEntry>();
  private readonly watchers = new Set<(snapshot: GodotGpuParticleFieldSnapshot) => void>(); private frameValue = 0;
  private fieldLimitValue = 64; private nextOrder = 0; private generationValue = 0; private uploads = 0; private applications = 0; private processing = false;
  private lastFrame: GodotGpuParticleFieldFrameResult | null = null;
  public constructor(backend: GodotGpuParticleFieldBackend) { if (typeof backend?.uploadField !== 'function' || typeof backend?.apply !== 'function') throw new TypeError('godot-compat: GpuParticleFieldRuntime requires upload and apply backend.'); this.backend = backend; registerGodotObjectIdentity(this, 'GpuParticleFieldRuntime'); }
  public addField(value: GodotGpuParticleFieldDescriptor): void {
    const fieldRid = rid(value.rid), id = godotRidGetId(fieldRid); if (this.fields.has(id)) throw new Error('godot-compat: particle field already exists.');
    this.fields.set(id, { rid: fieldRid, kind: kind(value.kind), transform: value.transform ?? null, extents: vector(value.extents ?? { x: 1, y: 1, z: 1 }), radius: finite(value.radius ?? 1, 'radius', 0), strength: finite(value.strength ?? 1, 'strength'), attenuation: finite(value.attenuation ?? 1, 'attenuation', 0), directionality: finite(value.directionality ?? 0, 'directionality', 0, 1), texture: optionalRid(value.texture), layerMask: integer(value.layerMask ?? 1, 'layer_mask', 0, 0xffff_ffff), enabled: bool(value.enabled ?? true, 'enabled'), priority: finite(value.priority ?? 0, 'priority'), dirty: true, lastUploadedFrame: -1, generation: 1, userData: value.userData ?? null, order: this.nextOrder++ }); this.generationValue += 1; this.publish();
  }
  public removeField(value: unknown): boolean { const fieldRid = rid(value), removed = this.fields.delete(godotRidGetId(fieldRid)); if (removed) { this.backend.removeField?.(fieldRid); this.generationValue += 1; this.publish(); } return removed; }
  private requireField(value: unknown): FieldEntry { const fieldRid = rid(value), entry = this.fields.get(godotRidGetId(fieldRid)); if (entry === undefined) throw new Error('godot-compat: particle field does not exist.'); return entry; }
  public updateField(value: unknown, patch: Partial<Omit<GodotGpuParticleFieldDescriptor, 'rid' | 'kind'>>): void { const entry = this.requireField(value); if (patch.transform !== undefined) entry.transform = patch.transform; if (patch.extents !== undefined) entry.extents = vector(patch.extents); if (patch.radius !== undefined) entry.radius = finite(patch.radius, 'radius', 0); if (patch.strength !== undefined) entry.strength = finite(patch.strength, 'strength'); if (patch.attenuation !== undefined) entry.attenuation = finite(patch.attenuation, 'attenuation', 0); if (patch.directionality !== undefined) entry.directionality = finite(patch.directionality, 'directionality', 0, 1); if (patch.texture !== undefined) entry.texture = optionalRid(patch.texture); if (patch.layerMask !== undefined) entry.layerMask = integer(patch.layerMask, 'layer_mask', 0, 0xffff_ffff); if (patch.enabled !== undefined) entry.enabled = bool(patch.enabled, 'enabled'); if (patch.priority !== undefined) entry.priority = finite(patch.priority, 'priority'); if (patch.userData !== undefined) entry.userData = patch.userData; entry.dirty = true; entry.generation += 1; this.publish(); }
  public addSystem(value: GodotGpuParticleFieldSystemDescriptor): void { const particles = rid(value.particles), id = godotRidGetId(particles); if (this.systems.has(id)) throw new Error('godot-compat: particle field system already exists.'); this.systems.set(id, { particles, collisionMask: integer(value.collisionMask ?? 1, 'collision_mask', 0, 0xffff_ffff), attractorMask: integer(value.attractorMask ?? 1, 'attractor_mask', 0, 0xffff_ffff), enabled: bool(value.enabled ?? true, 'enabled'), fields: [], lastAppliedFrame: -1, generation: 1, userData: value.userData ?? null, order: this.nextOrder++ }); this.generationValue += 1; this.publish(); }
  public removeSystem(value: unknown): boolean { const particles = rid(value), removed = this.systems.delete(godotRidGetId(particles)); if (removed) { this.generationValue += 1; this.publish(); } return removed; }
  private selectFields(system: SystemEntry): FieldEntry[] { return [...this.fields.values()].filter((field) => field.enabled && (field.layerMask & (isAttractor(field.kind) ? system.attractorMask : system.collisionMask)) !== 0).sort((left, right) => right.priority - left.priority || left.order - right.order).slice(0, this.fieldLimitValue); }
  public async processFrame(frameValue: unknown): Promise<GodotGpuParticleFieldFrameResult> { const frame = integer(frameValue, 'frame'); if (frame < this.frameValue) throw new RangeError('godot-compat: particle field frame cannot move backwards.'); if (this.processing) throw new Error('godot-compat: particle field frame already processing.'); this.frameValue = frame; this.processing = true; const uploadedFields: GodotRid[] = [], systems: GodotRid[] = [], failed: Array<{ rid: GodotRid; error: unknown }> = []; let influences = 0; try { for (const field of [...this.fields.values()].filter((entry) => entry.dirty)) { try { await this.backend.uploadField(frame, fieldState(field)); field.dirty = false; field.lastUploadedFrame = frame; uploadedFields.push(field.rid); this.uploads += 1; } catch (error) { failed.push(Object.freeze({ rid: field.rid, error })); } } for (const system of [...this.systems.values()].filter((entry) => entry.enabled).sort((left, right) => left.order - right.order)) { const fields = this.selectFields(system); system.fields = fields.map((field) => field.rid); try { await this.backend.apply(Object.freeze({ frame, system: systemState(system), fields: Object.freeze(fields.map(fieldState)) })); system.lastAppliedFrame = frame; system.generation += 1; systems.push(system.particles); influences += fields.length; this.applications += 1; } catch (error) { failed.push(Object.freeze({ rid: system.particles, error })); } } this.lastFrame = Object.freeze({ frame, uploadedFields: Object.freeze(uploadedFields), systems: Object.freeze(systems), influences, failed: Object.freeze(failed) }); this.publish(); return this.lastFrame; } finally { this.processing = false; } }
  public setFieldLimit(value: unknown): void { this.fieldLimitValue = integer(value, 'field_limit', 1); }
  public getSnapshot(): GodotGpuParticleFieldSnapshot { const fields = [...this.fields.values()].map(fieldState), systems = [...this.systems.values()].map(systemState); return Object.freeze({ frame: this.frameValue, fields: Object.freeze(fields), systems: Object.freeze(systems), dirtyFields: fields.filter((entry) => entry.dirty).length, uploads: this.uploads, applications: this.applications, generation: this.generationValue, lastFrame: this.lastFrame }); }
  public watch(watcher: (snapshot: GodotGpuParticleFieldSnapshot) => void): () => void { this.watchers.add(watcher); watcher(this.getSnapshot()); return () => this.watchers.delete(watcher); }
  private publish(): void { const value = this.getSnapshot(); for (const watcher of this.watchers) watcher(value); }
  public clear(): void { if (this.processing) throw new Error('godot-compat: cannot clear particle fields during frame.'); for (const field of this.fields.values()) this.backend.removeField?.(field.rid); this.fields.clear(); this.systems.clear(); this.lastFrame = null; this.generationValue += 1; this.publish(); }
  public dispose(): void { this.clear(); this.watchers.clear(); }
}

export function createGodotGpuParticleFieldRuntime(backend: GodotGpuParticleFieldBackend): GodotGpuParticleFieldRuntime { return new GodotGpuParticleFieldRuntime(backend); }
