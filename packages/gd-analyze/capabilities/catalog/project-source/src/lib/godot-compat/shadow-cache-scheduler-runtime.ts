export type GodotShadowCacheRid = string | number;
export type GodotShadowCacheLightType = 'directional' | 'omni' | 'spot';
export type GodotShadowCacheUpdateMode = 'always' | 'once' | 'on-change';
export type GodotShadowCacheInvalidationReason =
  | 'new-light'
  | 'light-changed'
  | 'caster-changed'
  | 'camera-changed'
  | 'atlas-changed'
  | 'manual'
  | 'evicted';

export interface GodotShadowCacheLightDescriptor {
  readonly rid: GodotShadowCacheRid;
  readonly type: GodotShadowCacheLightType;
  readonly priority?: number;
  readonly updateMode?: GodotShadowCacheUpdateMode;
  readonly cascadeCount?: number;
  readonly enabled?: boolean;
  readonly visible?: boolean;
  readonly maxDistance?: number;
  readonly layerMask?: number;
}

export interface GodotShadowCacheCasterDescriptor {
  readonly rid: GodotShadowCacheRid;
  readonly layerMask?: number;
  readonly visible?: boolean;
  readonly castsShadow?: boolean;
  readonly staticCaster?: boolean;
}

export interface GodotShadowCacheView {
  readonly light: GodotShadowCacheRid;
  readonly viewIndex: number;
  readonly type: GodotShadowCacheLightType;
  readonly atlasSlot: number;
  readonly atlasGeneration: number;
  readonly lightRevision: number;
  readonly casterRevision: number;
  readonly cameraRevision: number;
  readonly reasons: readonly GodotShadowCacheInvalidationReason[];
  readonly priority: number;
  readonly estimatedCost: number;
  readonly generation: number;
}

export interface GodotShadowCacheFrame {
  readonly frame: number;
  readonly scheduled: readonly GodotShadowCacheView[];
  readonly deferred: readonly GodotShadowCacheView[];
  readonly cachedLights: number;
  readonly dirtyLights: number;
  readonly budgetUsed: number;
  readonly budget: number;
  readonly generation: number;
}

export interface GodotShadowCacheSnapshot {
  readonly frame: number;
  readonly lights: number;
  readonly casters: number;
  readonly cachedViews: number;
  readonly dirtyLights: number;
  readonly renderBudget: number;
  readonly atlasGeneration: number;
  readonly invalidations: number;
  readonly renderedViews: number;
  readonly deferredViews: number;
  readonly generation: number;
}

interface LightState {
  descriptor: Required<GodotShadowCacheLightDescriptor>;
  casterIds: Set<GodotShadowCacheRid>;
  lightRevision: number;
  renderedLightRevision: number;
  renderedCasterRevision: number;
  renderedCameraRevision: number;
  renderedAtlasGeneration: number;
  reasons: Set<GodotShadowCacheInvalidationReason>;
  views: Map<number, ViewState>;
  revision: number;
}

interface CasterState {
  descriptor: Required<GodotShadowCacheCasterDescriptor>;
  revision: number;
}

interface ViewState {
  index: number;
  atlasSlot: number;
  valid: boolean;
  lastRenderedFrame: number;
  generation: number;
}

function finite(value: unknown, member: string, minimum = -Infinity, maximum = Infinity): number {
  const result = Number(value);
  if (!Number.isFinite(result) || result < minimum || result > maximum) {
    throw new RangeError(`godot-compat: ${member} requires a finite number in [${minimum}, ${maximum}].`);
  }
  return result;
}

function integer(value: unknown, member: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const result = finite(value, member, minimum, maximum);
  if (!Number.isSafeInteger(result)) throw new TypeError(`godot-compat: ${member} requires an integer.`);
  return result;
}

function mask(value: unknown, member: string): number {
  return integer(value, member, 0, 0xffff_ffff) >>> 0;
}

function lightType(value: unknown): GodotShadowCacheLightType {
  if (value !== 'directional' && value !== 'omni' && value !== 'spot') {
    throw new TypeError(`godot-compat: unknown shadow cache light type ${String(value)}.`);
  }
  return value;
}

function updateMode(value: unknown): GodotShadowCacheUpdateMode {
  if (value !== 'always' && value !== 'once' && value !== 'on-change') {
    throw new TypeError(`godot-compat: unknown shadow cache update mode ${String(value)}.`);
  }
  return value;
}

function lightDescriptor(value: GodotShadowCacheLightDescriptor): Required<GodotShadowCacheLightDescriptor> {
  const type = lightType(value.type);
  return Object.freeze({
    rid: value.rid,
    type,
    priority: integer(value.priority ?? 0, 'shadow cache priority', -128, 127),
    updateMode: updateMode(value.updateMode ?? 'on-change'),
    cascadeCount: integer(value.cascadeCount ?? 4, 'shadow cache cascades', 1, 4),
    enabled: value.enabled ?? true,
    visible: value.visible ?? true,
    maxDistance: finite(value.maxDistance ?? 100, 'shadow cache max distance', 0),
    layerMask: mask(value.layerMask ?? 0xffff_ffff, 'shadow cache light layer mask'),
  });
}

function casterDescriptor(value: GodotShadowCacheCasterDescriptor): Required<GodotShadowCacheCasterDescriptor> {
  return Object.freeze({
    rid: value.rid,
    layerMask: mask(value.layerMask ?? 1, 'shadow caster layer mask'),
    visible: value.visible ?? true,
    castsShadow: value.castsShadow ?? true,
    staticCaster: value.staticCaster ?? false,
  });
}

export class GodotShadowCacheSchedulerRuntime {
  private readonly lights = new Map<GodotShadowCacheRid, LightState>();
  private readonly casters = new Map<GodotShadowCacheRid, CasterState>();
  private readonly watchers = new Set<(frame: GodotShadowCacheFrame) => void>();
  private frame = 0;
  private renderBudget = 16;
  private atlasGeneration = 1;
  private cameraRevision = 1;
  private generation = 1;
  private nextAtlasSlot = 0;
  private invalidations = 0;
  private renderedViews = 0;
  private deferredViews = 0;
  private lastFrame: GodotShadowCacheFrame | null = null;

  addLight(value: GodotShadowCacheLightDescriptor): void {
    if (this.lights.has(value.rid)) throw new Error('godot-compat: shadow cache light already exists.');
    const descriptor = lightDescriptor(value);
    const light: LightState = {
      descriptor,
      casterIds: new Set(),
      lightRevision: 1,
      renderedLightRevision: -1,
      renderedCasterRevision: -1,
      renderedCameraRevision: -1,
      renderedAtlasGeneration: -1,
      reasons: new Set(['new-light']),
      views: new Map(),
      revision: ++this.generation,
    };
    this.rebuildViews(light);
    this.lights.set(value.rid, light);
    this.invalidations++;
  }

  updateLight(rid: GodotShadowCacheRid, patch: Partial<Omit<GodotShadowCacheLightDescriptor, 'rid'>>): void {
    const light = this.requireLight(rid);
    const previousType = light.descriptor.type;
    const previousCascades = light.descriptor.cascadeCount;
    light.descriptor = lightDescriptor({ ...light.descriptor, ...patch, rid });
    light.lightRevision++;
    light.revision = ++this.generation;
    light.reasons.add('light-changed');
    if (previousType !== light.descriptor.type || previousCascades !== light.descriptor.cascadeCount) this.rebuildViews(light);
    this.rebuildCasterLinks(light);
    this.invalidations++;
  }

  removeLight(rid: GodotShadowCacheRid): boolean {
    const removed = this.lights.delete(rid);
    if (removed) this.generation++;
    return removed;
  }

  addCaster(value: GodotShadowCacheCasterDescriptor): void {
    if (this.casters.has(value.rid)) throw new Error('godot-compat: shadow caster already exists.');
    this.casters.set(value.rid, { descriptor: casterDescriptor(value), revision: ++this.generation });
    for (const light of this.lights.values()) {
      if (this.matches(light, this.casters.get(value.rid)!)) {
        light.casterIds.add(value.rid);
        light.reasons.add('caster-changed');
      }
    }
    this.invalidations++;
  }

  updateCaster(rid: GodotShadowCacheRid, patch: Partial<Omit<GodotShadowCacheCasterDescriptor, 'rid'>>): void {
    const caster = this.requireCaster(rid);
    caster.descriptor = casterDescriptor({ ...caster.descriptor, ...patch, rid });
    caster.revision = ++this.generation;
    for (const light of this.lights.values()) {
      const wasLinked = light.casterIds.has(rid);
      const linked = this.matches(light, caster);
      if (linked) light.casterIds.add(rid);
      else light.casterIds.delete(rid);
      if (wasLinked || linked) {
        light.reasons.add('caster-changed');
        light.revision = ++this.generation;
      }
    }
    this.invalidations++;
  }

  removeCaster(rid: GodotShadowCacheRid): boolean {
    if (!this.casters.delete(rid)) return false;
    for (const light of this.lights.values()) {
      if (light.casterIds.delete(rid)) light.reasons.add('caster-changed');
    }
    this.generation++;
    this.invalidations++;
    return true;
  }

  invalidateLight(rid: GodotShadowCacheRid, reason: GodotShadowCacheInvalidationReason = 'manual'): void {
    const light = this.requireLight(rid);
    light.reasons.add(reason);
    light.revision = ++this.generation;
    this.invalidations++;
  }

  invalidateCaster(rid: GodotShadowCacheRid): number {
    this.requireCaster(rid).revision = ++this.generation;
    let affected = 0;
    for (const light of this.lights.values()) {
      if (!light.casterIds.has(rid)) continue;
      light.reasons.add('caster-changed');
      affected++;
    }
    this.invalidations += affected;
    return affected;
  }

  invalidateCamera(): void {
    this.cameraRevision++;
    for (const light of this.lights.values()) {
      if (light.descriptor.type === 'directional') light.reasons.add('camera-changed');
    }
    this.generation++;
    this.invalidations++;
  }

  invalidateAtlas(): void {
    this.atlasGeneration++;
    this.nextAtlasSlot = 0;
    for (const light of this.lights.values()) {
      light.reasons.add('atlas-changed');
      this.rebuildViews(light);
    }
    this.generation++;
    this.invalidations += this.lights.size;
  }

  schedule(frameValue: number): GodotShadowCacheFrame {
    const frame = integer(frameValue, 'shadow cache frame', 0);
    if (frame < this.frame) throw new RangeError('godot-compat: shadow cache frame cannot move backwards.');
    this.frame = frame;
    const candidates: GodotShadowCacheView[] = [];
    let cachedLights = 0;
    for (const light of this.lights.values()) {
      if (!light.descriptor.enabled || !light.descriptor.visible) continue;
      const casterRevision = this.casterRevision(light);
      const dirty = light.descriptor.updateMode === 'always'
        || light.renderedLightRevision !== light.lightRevision
        || light.renderedCasterRevision !== casterRevision
        || (light.descriptor.type === 'directional' && light.renderedCameraRevision !== this.cameraRevision)
        || light.renderedAtlasGeneration !== this.atlasGeneration
        || light.reasons.size > 0;
      if (!dirty) {
        cachedLights++;
        continue;
      }
      if (light.descriptor.updateMode === 'always') light.reasons.add('light-changed');
      for (const view of light.views.values()) candidates.push(this.viewSnapshot(light, view, casterRevision));
    }
    candidates.sort((left, right) =>
      right.priority - left.priority
      || left.estimatedCost - right.estimatedCost
      || left.viewIndex - right.viewIndex);
    const scheduled: GodotShadowCacheView[] = [];
    const deferred: GodotShadowCacheView[] = [];
    let budgetUsed = 0;
    for (const view of candidates) {
      if (budgetUsed + view.estimatedCost <= this.renderBudget) {
        scheduled.push(view);
        budgetUsed += view.estimatedCost;
      } else deferred.push(view);
    }
    this.deferredViews += deferred.length;
    this.lastFrame = Object.freeze({
      frame,
      scheduled: Object.freeze(scheduled),
      deferred: Object.freeze(deferred),
      cachedLights,
      dirtyLights: new Set(candidates.map((view) => view.light)).size,
      budgetUsed,
      budget: this.renderBudget,
      generation: this.generation,
    });
    for (const watcher of this.watchers) watcher(this.lastFrame);
    return this.lastFrame;
  }

  markRendered(viewValue: GodotShadowCacheView): void {
    const light = this.requireLight(viewValue.light);
    const view = light.views.get(viewValue.viewIndex);
    if (view === undefined || view.atlasSlot !== viewValue.atlasSlot) {
      throw new Error('godot-compat: shadow cache view is stale.');
    }
    view.valid = true;
    view.lastRenderedFrame = this.frame;
    view.generation = ++this.generation;
    this.renderedViews++;
    const frameViews = this.lastFrame?.scheduled.filter((candidate) => candidate.light === light.descriptor.rid) ?? [];
    if (frameViews.every((candidate) => light.views.get(candidate.viewIndex)?.valid)) {
      light.renderedLightRevision = light.lightRevision;
      light.renderedCasterRevision = this.casterRevision(light);
      light.renderedCameraRevision = this.cameraRevision;
      light.renderedAtlasGeneration = this.atlasGeneration;
      light.reasons.clear();
      if (light.descriptor.updateMode === 'once') light.descriptor = Object.freeze({ ...light.descriptor, enabled: false });
    }
  }

  markFailed(viewValue: GodotShadowCacheView): void {
    const light = this.requireLight(viewValue.light);
    const view = light.views.get(viewValue.viewIndex);
    if (view !== undefined) view.valid = false;
    light.reasons.add('manual');
    light.revision = ++this.generation;
  }

  evictLight(rid: GodotShadowCacheRid): void {
    const light = this.requireLight(rid);
    for (const view of light.views.values()) view.valid = false;
    light.reasons.add('evicted');
    light.renderedAtlasGeneration = -1;
    light.revision = ++this.generation;
  }

  setRenderBudget(value: number): void {
    this.renderBudget = integer(value, 'shadow cache render budget', 1, 4096);
  }

  getLastFrame(): GodotShadowCacheFrame | null {
    return this.lastFrame;
  }

  getSnapshot(): GodotShadowCacheSnapshot {
    return Object.freeze({
      frame: this.frame,
      lights: this.lights.size,
      casters: this.casters.size,
      cachedViews: [...this.lights.values()].reduce((sum, light) => sum + [...light.views.values()].filter((view) => view.valid).length, 0),
      dirtyLights: [...this.lights.values()].filter((light) => light.reasons.size > 0).length,
      renderBudget: this.renderBudget,
      atlasGeneration: this.atlasGeneration,
      invalidations: this.invalidations,
      renderedViews: this.renderedViews,
      deferredViews: this.deferredViews,
      generation: this.generation,
    });
  }

  watch(listener: (frame: GodotShadowCacheFrame) => void): () => void {
    this.watchers.add(listener);
    if (this.lastFrame !== null) listener(this.lastFrame);
    return () => this.watchers.delete(listener);
  }

  clear(): void {
    this.lights.clear();
    this.casters.clear();
    this.lastFrame = null;
    this.nextAtlasSlot = 0;
    this.generation++;
  }

  dispose(): void {
    this.clear();
    this.watchers.clear();
  }

  private rebuildViews(light: LightState): void {
    const count = light.descriptor.type === 'directional'
      ? light.descriptor.cascadeCount
      : light.descriptor.type === 'omni' ? 6 : 1;
    light.views.clear();
    for (let index = 0; index < count; index++) {
      light.views.set(index, {
        index,
        atlasSlot: this.nextAtlasSlot++,
        valid: false,
        lastRenderedFrame: -1,
        generation: ++this.generation,
      });
    }
  }

  private rebuildCasterLinks(light: LightState): void {
    light.casterIds.clear();
    for (const caster of this.casters.values()) if (this.matches(light, caster)) light.casterIds.add(caster.descriptor.rid);
  }

  private matches(light: LightState, caster: CasterState): boolean {
    return caster.descriptor.visible
      && caster.descriptor.castsShadow
      && (light.descriptor.layerMask & caster.descriptor.layerMask) !== 0;
  }

  private casterRevision(light: LightState): number {
    let revision = 0;
    for (const rid of light.casterIds) revision = Math.max(revision, this.casters.get(rid)?.revision ?? 0);
    return revision;
  }

  private viewSnapshot(light: LightState, view: ViewState, casterRevision: number): GodotShadowCacheView {
    const cost = light.descriptor.type === 'directional' ? 2 : 1;
    return Object.freeze({
      light: light.descriptor.rid,
      viewIndex: view.index,
      type: light.descriptor.type,
      atlasSlot: view.atlasSlot,
      atlasGeneration: this.atlasGeneration,
      lightRevision: light.lightRevision,
      casterRevision,
      cameraRevision: this.cameraRevision,
      reasons: Object.freeze([...light.reasons]),
      priority: light.descriptor.priority,
      estimatedCost: cost,
      generation: view.generation,
    });
  }

  private requireLight(rid: GodotShadowCacheRid): LightState {
    const light = this.lights.get(rid);
    if (light === undefined) throw new Error('godot-compat: unknown shadow cache light.');
    return light;
  }

  private requireCaster(rid: GodotShadowCacheRid): CasterState {
    const caster = this.casters.get(rid);
    if (caster === undefined) throw new Error('godot-compat: unknown shadow caster.');
    return caster;
  }
}

export function createGodotShadowCacheSchedulerRuntime(): GodotShadowCacheSchedulerRuntime {
  return new GodotShadowCacheSchedulerRuntime();
}
