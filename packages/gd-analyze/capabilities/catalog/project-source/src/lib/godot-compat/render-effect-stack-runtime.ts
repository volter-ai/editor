import { godotRidGetId, type GodotRid } from './gdscript-builtins';
import { registerGodotObjectIdentity } from './object';

export type GodotRenderEffectStage = 'pre-tonemap' | 'tonemap' | 'post-tonemap' | 'overlay';
export interface GodotRenderEffectDescriptor {
  readonly name: string; readonly stage: GodotRenderEffectStage; readonly priority?: number;
  readonly after?: readonly string[]; readonly before?: readonly string[]; readonly enabled?: boolean;
  readonly requiresDepth?: boolean; readonly requiresNormals?: boolean; readonly requiresVelocity?: boolean;
  readonly parameters?: ReadonlyMap<string, unknown> | Record<string, unknown>; readonly userData?: unknown;
}
export interface GodotRenderEffectState {
  readonly name: string; readonly stage: GodotRenderEffectStage; readonly priority: number;
  readonly after: readonly string[]; readonly before: readonly string[]; readonly enabled: boolean;
  readonly requiresDepth: boolean; readonly requiresNormals: boolean; readonly requiresVelocity: boolean;
  readonly parameters: ReadonlyMap<string, unknown>; readonly dirty: boolean; readonly generation: number; readonly userData: unknown;
}
export interface GodotRenderEffectContext {
  readonly frame: number; readonly viewport: GodotRid; readonly effect: GodotRenderEffectState;
  readonly input: GodotRid; readonly output: GodotRid; readonly depth: GodotRid | null;
  readonly normals: GodotRid | null; readonly velocity: GodotRid | null;
}
export interface GodotRenderEffectBinding { render(context: GodotRenderEffectContext): void | Promise<void> }
export interface GodotRenderEffectFrameResult { readonly frame: number; readonly viewport: GodotRid; readonly effects: readonly string[]; readonly skipped: readonly string[]; readonly finalOutput: GodotRid; readonly failed: readonly { name: string; error: unknown }[] }
export interface GodotRenderEffectStackSnapshot { readonly frame: number; readonly effects: readonly GodotRenderEffectState[]; readonly enabled: number; readonly dirty: number; readonly renderedFrames: number; readonly generation: number; readonly lastFrame: GodotRenderEffectFrameResult | null }
interface Entry { descriptor: { name: string; stage: GodotRenderEffectStage; priority: number; after: string[]; before: string[]; enabled: boolean; requiresDepth: boolean; requiresNormals: boolean; requiresVelocity: boolean; parameters: Map<string, unknown>; userData: unknown }; binding: GodotRenderEffectBinding; dirty: boolean; generation: number; order: number }
const STAGES: readonly GodotRenderEffectStage[] = Object.freeze(['pre-tonemap', 'tonemap', 'post-tonemap', 'overlay']);
function integer(value: unknown, member: string, minimum = 0): number { const result = Number(value); if (!Number.isSafeInteger(result) || result < minimum) throw new RangeError(`godot-compat: RenderEffectStack.${member} requires integer >= ${minimum}.`); return result; }
function finite(value: unknown, member: string): number { const result = Number(value); if (!Number.isFinite(result)) throw new RangeError(`godot-compat: RenderEffectStack.${member} requires finite value.`); return result; }
function bool(value: unknown, member: string): boolean { if (typeof value !== 'boolean') throw new TypeError(`godot-compat: RenderEffectStack.${member} requires bool.`); return value; }
function name(value: unknown, member: string): string { const result = String(value); if (result.length === 0) throw new RangeError(`godot-compat: RenderEffectStack.${member} requires nonempty StringName.`); return result; }
function stage(value: unknown): GodotRenderEffectStage { if (!STAGES.includes(value as GodotRenderEffectStage)) throw new TypeError(`godot-compat: unknown render effect stage ${String(value)}.`); return value as GodotRenderEffectStage; }
function rid(value: unknown): GodotRid { if (value === null || typeof value !== 'object') throw new TypeError('godot-compat: RenderEffectStack requires RID.'); godotRidGetId(value); return value as GodotRid; }
function optionalRid(value: unknown): GodotRid | null { return value === null || value === undefined ? null : rid(value); }
function parameters(value: unknown): Map<string, unknown> { if (value === undefined) return new Map(); if (value instanceof Map) return new Map([...value].map(([key, one]) => [String(key), one])); if (typeof value === 'object' && value !== null && !Array.isArray(value)) return new Map(Object.entries(value)); throw new TypeError('godot-compat: render effect parameters require Dictionary.'); }
function state(entry: Entry): GodotRenderEffectState { return Object.freeze({ ...entry.descriptor, after: Object.freeze([...entry.descriptor.after]), before: Object.freeze([...entry.descriptor.before]), parameters: new Map(entry.descriptor.parameters), dirty: entry.dirty, generation: entry.generation }); }

export class GodotRenderEffectStackRuntime {
  public readonly __godotClass = 'RenderEffectStackRuntime'; private readonly effects = new Map<string, Entry>();
  private readonly watchers = new Set<(snapshot: GodotRenderEffectStackSnapshot) => void>(); private frameValue = 0;
  private nextOrder = 0; private generationValue = 0; private renderedFrames = 0; private processing = false;
  private lastFrame: GodotRenderEffectFrameResult | null = null;
  public constructor() { registerGodotObjectIdentity(this, 'RenderEffectStackRuntime'); }
  public addEffect(value: GodotRenderEffectDescriptor, binding: GodotRenderEffectBinding): void {
    const effectName = name(value.name, 'name'); if (this.effects.has(effectName)) throw new Error(`godot-compat: render effect ${effectName} already exists.`); if (typeof binding?.render !== 'function') throw new TypeError('godot-compat: render effect requires render binding.');
    this.effects.set(effectName, { descriptor: { name: effectName, stage: stage(value.stage), priority: finite(value.priority ?? 0, 'priority'), after: (value.after ?? []).map((one) => name(one, 'after')), before: (value.before ?? []).map((one) => name(one, 'before')), enabled: bool(value.enabled ?? true, 'enabled'), requiresDepth: bool(value.requiresDepth ?? false, 'requires_depth'), requiresNormals: bool(value.requiresNormals ?? false, 'requires_normals'), requiresVelocity: bool(value.requiresVelocity ?? false, 'requires_velocity'), parameters: parameters(value.parameters), userData: value.userData ?? null }, binding, dirty: true, generation: 1, order: this.nextOrder++ });
    this.generationValue += 1; this.publish();
  }
  public removeEffect(value: unknown): boolean { const removed = this.effects.delete(name(value, 'name')); if (removed) { this.generationValue += 1; this.publish(); } return removed; }
  private requireEntry(value: unknown): Entry { const effectName = name(value, 'name'), entry = this.effects.get(effectName); if (entry === undefined) throw new Error(`godot-compat: render effect ${effectName} does not exist.`); return entry; }
  public setEnabled(value: unknown, enabledValue: unknown): void { const entry = this.requireEntry(value); entry.descriptor.enabled = bool(enabledValue, 'enabled'); entry.dirty = true; entry.generation += 1; this.publish(); }
  public setParameter(value: unknown, parameterValue: unknown, data: unknown): void { const entry = this.requireEntry(value), parameter = name(parameterValue, 'parameter'); entry.descriptor.parameters.set(parameter, data); entry.dirty = true; entry.generation += 1; this.publish(); }
  public eraseParameter(value: unknown, parameterValue: unknown): boolean { const entry = this.requireEntry(value), removed = entry.descriptor.parameters.delete(name(parameterValue, 'parameter')); if (removed) { entry.dirty = true; entry.generation += 1; this.publish(); } return removed; }
  private ordered(): Entry[] {
    const dependencies = new Map<string, Set<string>>(); for (const entry of this.effects.values()) dependencies.set(entry.descriptor.name, new Set(entry.descriptor.after));
    for (const entry of this.effects.values()) { for (const before of entry.descriptor.before) { const target = dependencies.get(before); if (target === undefined) throw new Error(`godot-compat: render effect ${entry.descriptor.name} references unknown effect ${before}.`); target.add(entry.descriptor.name); } for (const after of entry.descriptor.after) if (!this.effects.has(after)) throw new Error(`godot-compat: render effect ${entry.descriptor.name} references unknown effect ${after}.`); }
    const remaining = new Map(this.effects), output: Entry[] = [], stageOrder = new Map(STAGES.map((one, index) => [one, index]));
    while (remaining.size > 0) { const ready = [...remaining.values()].filter((entry) => [...dependencies.get(entry.descriptor.name)!].every((dependency) => !remaining.has(dependency))).sort((left, right) => stageOrder.get(left.descriptor.stage)! - stageOrder.get(right.descriptor.stage)! || left.descriptor.priority - right.descriptor.priority || left.order - right.order); if (ready.length === 0) throw new Error('godot-compat: render effect dependency cycle.'); for (const entry of ready) { output.push(entry); remaining.delete(entry.descriptor.name); } }
    return output;
  }
  public async processFrame(frameValue: unknown, viewportValue: unknown, inputValue: unknown, outputsValue: readonly GodotRid[], resources: { depth?: GodotRid | null; normals?: GodotRid | null; velocity?: GodotRid | null } = {}): Promise<GodotRenderEffectFrameResult> {
    const frame = integer(frameValue, 'frame'), viewport = rid(viewportValue), input = rid(inputValue); if (!Array.isArray(outputsValue) || outputsValue.length === 0) throw new TypeError('godot-compat: render effect outputs require nonempty RID array.'); if (frame < this.frameValue) throw new RangeError('godot-compat: render effect frame cannot move backwards.'); if (this.processing) throw new Error('godot-compat: render effect stack already processing.');
    this.frameValue = frame; this.processing = true; const rendered: string[] = [], skipped: string[] = [], failed: Array<{ name: string; error: unknown }> = []; let current = input, outputIndex = 0;
    try { for (const entry of this.ordered()) {
      if (!entry.descriptor.enabled) { skipped.push(entry.descriptor.name); continue; }
      const depth = optionalRid(resources.depth), normals = optionalRid(resources.normals), velocity = optionalRid(resources.velocity);
      if ((entry.descriptor.requiresDepth && depth === null) || (entry.descriptor.requiresNormals && normals === null) || (entry.descriptor.requiresVelocity && velocity === null)) { skipped.push(entry.descriptor.name); continue; }
      const output = rid(outputsValue[outputIndex++ % outputsValue.length]);
      try { await entry.binding.render(Object.freeze({ frame, viewport, effect: state(entry), input: current, output, depth, normals, velocity })); current = output; entry.dirty = false; rendered.push(entry.descriptor.name); } catch (error) { failed.push(Object.freeze({ name: entry.descriptor.name, error })); }
    } this.renderedFrames += 1; this.lastFrame = Object.freeze({ frame, viewport, effects: Object.freeze(rendered), skipped: Object.freeze(skipped), finalOutput: current, failed: Object.freeze(failed) }); this.publish(); return this.lastFrame; } finally { this.processing = false; }
  }
  public getEffect(value: unknown): GodotRenderEffectState | null { const entry = this.effects.get(name(value, 'name')); return entry === undefined ? null : state(entry); }
  public getSnapshot(): GodotRenderEffectStackSnapshot { const effects = [...this.effects.values()].map(state); return Object.freeze({ frame: this.frameValue, effects: Object.freeze(effects), enabled: effects.filter((entry) => entry.enabled).length, dirty: effects.filter((entry) => entry.dirty).length, renderedFrames: this.renderedFrames, generation: this.generationValue, lastFrame: this.lastFrame }); }
  public watch(watcher: (snapshot: GodotRenderEffectStackSnapshot) => void): () => void { this.watchers.add(watcher); watcher(this.getSnapshot()); return () => this.watchers.delete(watcher); }
  private publish(): void { const value = this.getSnapshot(); for (const watcher of this.watchers) watcher(value); }
  public clear(): void { if (this.processing) throw new Error('godot-compat: cannot clear render effects during frame.'); this.effects.clear(); this.lastFrame = null; this.generationValue += 1; this.publish(); }
  public dispose(): void { this.clear(); this.watchers.clear(); }
}

export function createGodotRenderEffectStackRuntime(): GodotRenderEffectStackRuntime { return new GodotRenderEffectStackRuntime(); }
