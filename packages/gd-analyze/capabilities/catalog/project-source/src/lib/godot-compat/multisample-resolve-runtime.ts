import { godotRidGetId, type GodotRid } from './gdscript-builtins';
import { registerGodotObjectIdentity } from './object';

export type GodotResolveAttachment = 'color' | 'depth' | 'velocity' | 'normal-roughness';
export type GodotResolveMode = 'average' | 'minimum' | 'maximum' | 'sample-zero';

export interface GodotMultisampleResolveDescriptor {
  readonly viewport: GodotRid;
  readonly view: number;
  readonly attachment: GodotResolveAttachment;
  readonly source: GodotRid;
  readonly destination: GodotRid;
  readonly samples: number;
  readonly mode?: GodotResolveMode;
  readonly enabled?: boolean;
  readonly priority?: number;
  readonly userData?: unknown;
}

export interface GodotMultisampleResolveState extends Required<Omit<GodotMultisampleResolveDescriptor, 'userData'>> {
  readonly dirty: boolean;
  readonly lastResolvedFrame: number;
  readonly generation: number;
  readonly userData: unknown;
}

export interface GodotMultisampleResolveBackend {
  resolve(frame: number, state: GodotMultisampleResolveState): void | Promise<void>;
}

export interface GodotMultisampleResolveFrameResult {
  readonly frame: number;
  readonly resolved: readonly GodotMultisampleResolveState[];
  readonly skipped: readonly GodotMultisampleResolveState[];
  readonly failed: readonly { state: GodotMultisampleResolveState; error: unknown }[];
}

export interface GodotMultisampleResolveSnapshot {
  readonly frame: number;
  readonly entries: readonly GodotMultisampleResolveState[];
  readonly dirty: number;
  readonly enabled: number;
  readonly resolves: number;
  readonly renderedFrames: number;
  readonly generation: number;
  readonly lastFrame: GodotMultisampleResolveFrameResult | null;
}

interface Entry {
  viewport: GodotRid;
  view: number;
  attachment: GodotResolveAttachment;
  source: GodotRid;
  destination: GodotRid;
  samples: number;
  mode: GodotResolveMode;
  enabled: boolean;
  priority: number;
  dirty: boolean;
  lastResolvedFrame: number;
  generation: number;
  userData: unknown;
  order: number;
}

const ATTACHMENTS = new Set<GodotResolveAttachment>(['color', 'depth', 'velocity', 'normal-roughness']);
const MODES = new Set<GodotResolveMode>(['average', 'minimum', 'maximum', 'sample-zero']);

function integer(value: unknown, member: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new RangeError(`godot-compat: MultisampleResolveRuntime.${member} requires integer in [${minimum}, ${maximum}].`);
  }
  return result;
}

function finite(value: unknown, member: string): number {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new RangeError(`godot-compat: MultisampleResolveRuntime.${member} requires finite value.`);
  return result;
}

function bool(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`godot-compat: MultisampleResolveRuntime.${member} requires bool.`);
  return value;
}

function rid(value: unknown): GodotRid {
  if (value === null || typeof value !== 'object') throw new TypeError('godot-compat: MultisampleResolveRuntime requires RID.');
  godotRidGetId(value);
  return value as GodotRid;
}

function attachment(value: unknown): GodotResolveAttachment {
  if (!ATTACHMENTS.has(value as GodotResolveAttachment)) throw new TypeError(`godot-compat: unknown resolve attachment ${String(value)}.`);
  return value as GodotResolveAttachment;
}

function mode(value: unknown): GodotResolveMode {
  if (!MODES.has(value as GodotResolveMode)) throw new TypeError(`godot-compat: unknown resolve mode ${String(value)}.`);
  return value as GodotResolveMode;
}

function state(entry: Entry): GodotMultisampleResolveState {
  return Object.freeze({ ...entry });
}

function key(viewport: GodotRid, view: number, target: GodotResolveAttachment): string {
  return `${godotRidGetId(viewport)}:${view}:${target}`;
}

export class GodotMultisampleResolveRuntime {
  public readonly __godotClass = 'MultisampleResolveRuntime';
  private readonly backend: GodotMultisampleResolveBackend;
  private readonly entries = new Map<string, Entry>();
  private readonly watchers = new Set<(snapshot: GodotMultisampleResolveSnapshot) => void>();
  private frameValue = 0;
  private nextOrder = 0;
  private generationValue = 0;
  private resolves = 0;
  private renderedFrames = 0;
  private processing = false;
  private lastFrame: GodotMultisampleResolveFrameResult | null = null;

  public constructor(backend: GodotMultisampleResolveBackend) {
    if (typeof backend?.resolve !== 'function') throw new TypeError('godot-compat: MultisampleResolveRuntime requires resolve backend.');
    this.backend = backend;
    registerGodotObjectIdentity(this, 'MultisampleResolveRuntime');
  }

  public add(value: GodotMultisampleResolveDescriptor): void {
    const viewport = rid(value.viewport);
    const view = integer(value.view, 'view');
    const target = attachment(value.attachment);
    const entryKey = key(viewport, view, target);
    if (this.entries.has(entryKey)) throw new Error(`godot-compat: resolve entry ${entryKey} already exists.`);
    const source = rid(value.source);
    const destination = rid(value.destination);
    if (godotRidGetId(source) === godotRidGetId(destination)) throw new Error('godot-compat: resolve source and destination must differ.');
    this.entries.set(entryKey, {
      viewport,
      view,
      attachment: target,
      source,
      destination,
      samples: integer(value.samples, 'samples', 2, 64),
      mode: mode(value.mode ?? (target === 'depth' ? 'minimum' : 'average')),
      enabled: bool(value.enabled ?? true, 'enabled'),
      priority: finite(value.priority ?? 0, 'priority'),
      dirty: true,
      lastResolvedFrame: -1,
      generation: 1,
      userData: value.userData ?? null,
      order: this.nextOrder++,
    });
    this.generationValue += 1;
    this.publish();
  }

  public remove(viewportValue: unknown, viewValue: unknown, attachmentValue: unknown): boolean {
    const removed = this.entries.delete(key(rid(viewportValue), integer(viewValue, 'view'), attachment(attachmentValue)));
    if (removed) {
      this.generationValue += 1;
      this.publish();
    }
    return removed;
  }

  private requireEntry(viewportValue: unknown, viewValue: unknown, attachmentValue: unknown): Entry {
    const entryKey = key(rid(viewportValue), integer(viewValue, 'view'), attachment(attachmentValue));
    const entry = this.entries.get(entryKey);
    if (entry === undefined) throw new Error(`godot-compat: resolve entry ${entryKey} does not exist.`);
    return entry;
  }

  public update(
    viewportValue: unknown,
    viewValue: unknown,
    attachmentValue: unknown,
    patch: Partial<Omit<GodotMultisampleResolveDescriptor, 'viewport' | 'view' | 'attachment'>>,
  ): void {
    const entry = this.requireEntry(viewportValue, viewValue, attachmentValue);
    if (patch.source !== undefined) entry.source = rid(patch.source);
    if (patch.destination !== undefined) entry.destination = rid(patch.destination);
    if (godotRidGetId(entry.source) === godotRidGetId(entry.destination)) throw new Error('godot-compat: resolve source and destination must differ.');
    if (patch.samples !== undefined) entry.samples = integer(patch.samples, 'samples', 2, 64);
    if (patch.mode !== undefined) entry.mode = mode(patch.mode);
    if (patch.enabled !== undefined) entry.enabled = bool(patch.enabled, 'enabled');
    if (patch.priority !== undefined) entry.priority = finite(patch.priority, 'priority');
    if (patch.userData !== undefined) entry.userData = patch.userData;
    entry.dirty = true;
    entry.generation += 1;
    this.publish();
  }

  public invalidateViewport(value: unknown): number {
    const viewport = rid(value);
    const id = godotRidGetId(viewport);
    let count = 0;
    for (const entry of this.entries.values()) {
      if (godotRidGetId(entry.viewport) !== id) continue;
      entry.dirty = true;
      entry.generation += 1;
      count += 1;
    }
    this.publish();
    return count;
  }

  public async processFrame(frameValue: unknown, onlyDirty = false): Promise<GodotMultisampleResolveFrameResult> {
    const frame = integer(frameValue, 'frame');
    if (frame < this.frameValue) throw new RangeError('godot-compat: resolve frame cannot move backwards.');
    if (this.processing) throw new Error('godot-compat: resolve frame already processing.');
    this.frameValue = frame;
    this.processing = true;
    const resolved: GodotMultisampleResolveState[] = [];
    const skipped: GodotMultisampleResolveState[] = [];
    const failed: Array<{ state: GodotMultisampleResolveState; error: unknown }> = [];
    try {
      const ordered = [...this.entries.values()].sort((left, right) => left.priority - right.priority || left.order - right.order);
      for (const entry of ordered) {
        const current = state(entry);
        if (!entry.enabled || (onlyDirty && !entry.dirty)) {
          skipped.push(current);
          continue;
        }
        try {
          await this.backend.resolve(frame, current);
          entry.dirty = false;
          entry.lastResolvedFrame = frame;
          entry.generation += 1;
          resolved.push(state(entry));
          this.resolves += 1;
        } catch (error) {
          failed.push(Object.freeze({ state: current, error }));
        }
      }
      this.renderedFrames += 1;
      this.lastFrame = Object.freeze({ frame, resolved: Object.freeze(resolved), skipped: Object.freeze(skipped), failed: Object.freeze(failed) });
      this.publish();
      return this.lastFrame;
    } finally {
      this.processing = false;
    }
  }

  public getSnapshot(): GodotMultisampleResolveSnapshot {
    const entries = [...this.entries.values()].map(state);
    return Object.freeze({
      frame: this.frameValue,
      entries: Object.freeze(entries),
      dirty: entries.filter((entry) => entry.dirty).length,
      enabled: entries.filter((entry) => entry.enabled).length,
      resolves: this.resolves,
      renderedFrames: this.renderedFrames,
      generation: this.generationValue,
      lastFrame: this.lastFrame,
    });
  }

  public watch(watcher: (snapshot: GodotMultisampleResolveSnapshot) => void): () => void {
    this.watchers.add(watcher);
    watcher(this.getSnapshot());
    return () => this.watchers.delete(watcher);
  }

  private publish(): void {
    const value = this.getSnapshot();
    for (const watcher of this.watchers) watcher(value);
  }

  public clear(): void {
    if (this.processing) throw new Error('godot-compat: cannot clear resolves during frame.');
    this.entries.clear();
    this.lastFrame = null;
    this.generationValue += 1;
    this.publish();
  }

  public dispose(): void {
    this.clear();
    this.watchers.clear();
  }
}

export function createGodotMultisampleResolveRuntime(
  backend: GodotMultisampleResolveBackend,
): GodotMultisampleResolveRuntime {
  return new GodotMultisampleResolveRuntime(backend);
}
