export type GodotRenderRecoveryRid = string | number;

export type GodotRenderRecoveryKind =
  | 'buffer'
  | 'texture'
  | 'sampler'
  | 'shader'
  | 'pipeline'
  | 'descriptor'
  | 'framebuffer'
  | 'acceleration-structure';

export interface GodotRenderRecoverableDescriptor<TSnapshot = unknown> {
  readonly rid: GodotRenderRecoveryRid;
  readonly kind: GodotRenderRecoveryKind;
  readonly dependencies?: readonly GodotRenderRecoveryRid[];
  readonly priority?: number;
  readonly required?: boolean;
  readonly estimatedCost?: number;
  readonly snapshot: () => TSnapshot;
}

export interface GodotRenderRecoveryRequest<TSnapshot = unknown> {
  readonly rid: GodotRenderRecoveryRid;
  readonly kind: GodotRenderRecoveryKind;
  readonly snapshot: TSnapshot;
  readonly dependencies: ReadonlyMap<GodotRenderRecoveryRid, unknown>;
  readonly deviceGeneration: number;
  readonly resourceGeneration: number;
}

export interface GodotRenderRecoveryFrame {
  readonly frame: number;
  readonly deviceGeneration: number;
  readonly restored: readonly GodotRenderRecoveryRid[];
  readonly deferred: readonly GodotRenderRecoveryRid[];
  readonly failed: readonly { rid: GodotRenderRecoveryRid; error: unknown }[];
  readonly blocked: readonly GodotRenderRecoveryRid[];
  readonly budgetUsed: number;
  readonly budget: number;
  readonly complete: boolean;
  readonly generation: number;
}

export interface GodotRenderRecoverySnapshot {
  readonly state: 'ready' | 'lost' | 'recovering' | 'failed';
  readonly deviceGeneration: number;
  readonly resources: number;
  readonly restoredResources: number;
  readonly pendingResources: number;
  readonly failedResources: number;
  readonly recoveries: number;
  readonly losses: number;
  readonly restoreBudget: number;
  readonly generation: number;
}

export interface GodotRenderRecoveryBackend<TSnapshot = unknown, THandle = unknown> {
  beginRecovery(deviceGeneration: number, reason: unknown): void | Promise<void>;
  restore(request: GodotRenderRecoveryRequest<TSnapshot>): THandle | Promise<THandle>;
  finishRecovery(deviceGeneration: number): void | Promise<void>;
  destroy?(handle: THandle, rid: GodotRenderRecoveryRid): void;
}

interface ResourceState<TSnapshot, THandle> {
  descriptor: Required<Omit<GodotRenderRecoverableDescriptor<TSnapshot>, 'snapshot'>> & { snapshot: () => TSnapshot };
  dependants: Set<GodotRenderRecoveryRid>;
  handle: THandle | null;
  state: 'ready' | 'pending' | 'restoring' | 'failed';
  error: unknown;
  resourceGeneration: number;
  revision: number;
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

function kind(value: unknown): GodotRenderRecoveryKind {
  if (value !== 'buffer'
    && value !== 'texture'
    && value !== 'sampler'
    && value !== 'shader'
    && value !== 'pipeline'
    && value !== 'descriptor'
    && value !== 'framebuffer'
    && value !== 'acceleration-structure') {
    throw new TypeError(`godot-compat: unknown recoverable render kind ${String(value)}.`);
  }
  return value;
}

function descriptor<TSnapshot>(
  value: GodotRenderRecoverableDescriptor<TSnapshot>,
): ResourceState<TSnapshot, unknown>['descriptor'] {
  if (typeof value.snapshot !== 'function') throw new TypeError('godot-compat: recoverable resource requires snapshot provider.');
  const dependencies = [...new Set(value.dependencies ?? [])];
  if (dependencies.includes(value.rid)) throw new Error('godot-compat: recoverable resource cannot depend on itself.');
  return Object.freeze({
    rid: value.rid,
    kind: kind(value.kind),
    dependencies: Object.freeze(dependencies),
    priority: integer(value.priority ?? 0, 'recovery priority', -128, 127),
    required: value.required ?? true,
    estimatedCost: finite(value.estimatedCost ?? 1, 'recovery estimated cost', 0),
    snapshot: value.snapshot,
  });
}

export class GodotRenderDeviceRecoveryRuntime<TSnapshot = unknown, THandle = unknown> {
  private readonly resources = new Map<GodotRenderRecoveryRid, ResourceState<TSnapshot, THandle>>();
  private readonly watchers = new Set<(snapshot: GodotRenderRecoverySnapshot) => void>();
  private readonly frameWatchers = new Set<(frame: GodotRenderRecoveryFrame) => void>();
  private stateValue: GodotRenderRecoverySnapshot['state'] = 'ready';
  private deviceGeneration = 1;
  private generation = 1;
  private restoreBudget: number;
  private losses = 0;
  private recoveries = 0;
  private lossReason: unknown = null;
  private started = false;
  private processing = false;

  constructor(
    private backend: GodotRenderRecoveryBackend<TSnapshot, THandle>,
    restoreBudget = 32,
  ) {
    this.restoreBudget = finite(restoreBudget, 'render recovery budget', Number.EPSILON);
  }

  register(value: GodotRenderRecoverableDescriptor<TSnapshot>, handle: THandle): void {
    if (this.resources.has(value.rid)) throw new Error('godot-compat: recoverable render resource already exists.');
    const normalized = descriptor(value) as ResourceState<TSnapshot, THandle>['descriptor'];
    for (const dependency of normalized.dependencies) this.require(dependency);
    const resource: ResourceState<TSnapshot, THandle> = {
      descriptor: normalized,
      dependants: new Set(),
      handle,
      state: 'ready',
      error: null,
      resourceGeneration: 1,
      revision: ++this.generation,
    };
    this.resources.set(value.rid, resource);
    for (const dependency of normalized.dependencies) this.require(dependency).dependants.add(value.rid);
    this.assertAcyclic();
    this.publish();
  }

  update(value: GodotRenderRecoverableDescriptor<TSnapshot>): void {
    const resource = this.require(value.rid);
    for (const dependency of resource.descriptor.dependencies) this.resources.get(dependency)?.dependants.delete(value.rid);
    const normalized = descriptor(value) as ResourceState<TSnapshot, THandle>['descriptor'];
    for (const dependency of normalized.dependencies) this.require(dependency).dependants.add(value.rid);
    resource.descriptor = normalized;
    resource.resourceGeneration++;
    resource.revision = ++this.generation;
    this.assertAcyclic();
  }

  replaceHandle(rid: GodotRenderRecoveryRid, handle: THandle): void {
    const resource = this.require(rid);
    if (resource.handle !== null && resource.handle !== handle) this.backend.destroy?.(resource.handle, rid);
    resource.handle = handle;
    resource.state = 'ready';
    resource.error = null;
    resource.resourceGeneration++;
    resource.revision = ++this.generation;
  }

  unregister(rid: GodotRenderRecoveryRid, force = false): boolean {
    const resource = this.resources.get(rid);
    if (resource === undefined) return false;
    if (!force && resource.dependants.size > 0) throw new Error('godot-compat: recoverable resource still has dependants.');
    for (const dependantRid of resource.dependants) {
      const dependant = this.resources.get(dependantRid);
      if (dependant !== undefined) {
        dependant.descriptor = Object.freeze({
          ...dependant.descriptor,
          dependencies: Object.freeze(dependant.descriptor.dependencies.filter((dependency) => dependency !== rid)),
        });
      }
    }
    for (const dependency of resource.descriptor.dependencies) this.resources.get(dependency)?.dependants.delete(rid);
    if (resource.handle !== null) this.backend.destroy?.(resource.handle, rid);
    this.resources.delete(rid);
    this.generation++;
    this.publish();
    return true;
  }

  notifyDeviceLost(reason: unknown): void {
    if (this.stateValue === 'lost' || this.stateValue === 'recovering') return;
    this.stateValue = 'lost';
    this.lossReason = reason;
    this.started = false;
    this.losses++;
    this.deviceGeneration++;
    for (const resource of this.resources.values()) {
      resource.handle = null;
      resource.state = 'pending';
      resource.error = null;
      resource.revision = ++this.generation;
    }
    this.publish();
  }

  async recoverFrame(frameValue: number): Promise<GodotRenderRecoveryFrame> {
    const frame = integer(frameValue, 'render recovery frame', 0);
    if (this.stateValue === 'ready') return this.emptyFrame(frame, true);
    if (this.processing) throw new Error('godot-compat: render device recovery is already processing.');
    this.processing = true;
    const restored: GodotRenderRecoveryRid[] = [];
    const failed: Array<{ rid: GodotRenderRecoveryRid; error: unknown }> = [];
    const blocked: GodotRenderRecoveryRid[] = [];
    let budgetUsed = 0;
    try {
      if (!this.started) {
        await this.backend.beginRecovery(this.deviceGeneration, this.lossReason);
        this.started = true;
        this.stateValue = 'recovering';
      }
      const ordered = this.topologicalOrder();
      for (const resource of ordered) {
        if (resource.state !== 'pending') continue;
        const dependencies = resource.descriptor.dependencies.map((rid) => this.require(rid));
        if (dependencies.some((dependency) => dependency.state === 'failed')) {
          blocked.push(resource.descriptor.rid);
          if (resource.descriptor.required) {
            resource.state = 'failed';
            resource.error = new Error('godot-compat: required recovery dependency failed.');
          }
          continue;
        }
        if (!dependencies.every((dependency) => dependency.state === 'ready')) {
          blocked.push(resource.descriptor.rid);
          continue;
        }
        if (budgetUsed + resource.descriptor.estimatedCost > this.restoreBudget && restored.length > 0) continue;
        resource.state = 'restoring';
        try {
          const dependencyHandles = new Map<GodotRenderRecoveryRid, unknown>();
          for (const dependency of dependencies) dependencyHandles.set(dependency.descriptor.rid, dependency.handle);
          const request: GodotRenderRecoveryRequest<TSnapshot> = Object.freeze({
            rid: resource.descriptor.rid,
            kind: resource.descriptor.kind,
            snapshot: resource.descriptor.snapshot(),
            dependencies: dependencyHandles,
            deviceGeneration: this.deviceGeneration,
            resourceGeneration: resource.resourceGeneration,
          });
          resource.handle = await this.backend.restore(request);
          resource.state = 'ready';
          resource.error = null;
          resource.revision = ++this.generation;
          restored.push(resource.descriptor.rid);
          budgetUsed += resource.descriptor.estimatedCost;
        } catch (error) {
          resource.state = 'failed';
          resource.error = error;
          resource.revision = ++this.generation;
          failed.push(Object.freeze({ rid: resource.descriptor.rid, error }));
        }
      }
      const pendingResources = [...this.resources.values()].filter((resource) => resource.state === 'pending' || resource.state === 'restoring');
      const requiredFailure = [...this.resources.values()].some((resource) => resource.descriptor.required && resource.state === 'failed');
      const complete = pendingResources.length === 0 && !requiredFailure;
      if (complete) {
        await this.backend.finishRecovery(this.deviceGeneration);
        this.stateValue = 'ready';
        this.started = false;
        this.lossReason = null;
        this.recoveries++;
      } else if (requiredFailure) this.stateValue = 'failed';
      const deferred = pendingResources.map((resource) => resource.descriptor.rid);
      const result: GodotRenderRecoveryFrame = Object.freeze({
        frame,
        deviceGeneration: this.deviceGeneration,
        restored: Object.freeze(restored),
        deferred: Object.freeze(deferred),
        failed: Object.freeze(failed),
        blocked: Object.freeze(blocked),
        budgetUsed,
        budget: this.restoreBudget,
        complete,
        generation: ++this.generation,
      });
      for (const watcher of this.frameWatchers) watcher(result);
      this.publish();
      return result;
    } finally {
      this.processing = false;
    }
  }

  retryFailed(rid?: GodotRenderRecoveryRid): void {
    const values = rid === undefined ? [...this.resources.values()] : [this.require(rid)];
    for (const resource of values) {
      if (resource.state !== 'failed') continue;
      resource.state = 'pending';
      resource.error = null;
      resource.revision = ++this.generation;
    }
    if (this.stateValue === 'failed') this.stateValue = 'recovering';
    this.publish();
  }

  getHandle(rid: GodotRenderRecoveryRid): THandle | null {
    return this.require(rid).handle;
  }

  setRestoreBudget(value: number): void {
    this.restoreBudget = finite(value, 'render recovery budget', Number.EPSILON);
  }

  getSnapshot(): GodotRenderRecoverySnapshot {
    const values = [...this.resources.values()];
    return Object.freeze({
      state: this.stateValue,
      deviceGeneration: this.deviceGeneration,
      resources: values.length,
      restoredResources: values.filter((resource) => resource.state === 'ready').length,
      pendingResources: values.filter((resource) => resource.state === 'pending' || resource.state === 'restoring').length,
      failedResources: values.filter((resource) => resource.state === 'failed').length,
      recoveries: this.recoveries,
      losses: this.losses,
      restoreBudget: this.restoreBudget,
      generation: this.generation,
    });
  }

  watch(listener: (snapshot: GodotRenderRecoverySnapshot) => void): () => void {
    this.watchers.add(listener);
    listener(this.getSnapshot());
    return () => this.watchers.delete(listener);
  }

  watchFrames(listener: (frame: GodotRenderRecoveryFrame) => void): () => void {
    this.frameWatchers.add(listener);
    return () => this.frameWatchers.delete(listener);
  }

  dispose(): void {
    for (const resource of this.resources.values()) {
      if (resource.handle !== null) this.backend.destroy?.(resource.handle, resource.descriptor.rid);
    }
    this.resources.clear();
    this.watchers.clear();
    this.frameWatchers.clear();
    this.generation++;
  }

  private topologicalOrder(): ResourceState<TSnapshot, THandle>[] {
    const result: ResourceState<TSnapshot, THandle>[] = [];
    const visited = new Set<GodotRenderRecoveryRid>();
    const visit = (resource: ResourceState<TSnapshot, THandle>): void => {
      if (visited.has(resource.descriptor.rid)) return;
      for (const dependency of resource.descriptor.dependencies) visit(this.require(dependency));
      visited.add(resource.descriptor.rid);
      result.push(resource);
    };
    const values = [...this.resources.values()].sort((left, right) => right.descriptor.priority - left.descriptor.priority);
    for (const resource of values) visit(resource);
    return result;
  }

  private assertAcyclic(): void {
    const visiting = new Set<GodotRenderRecoveryRid>();
    const visited = new Set<GodotRenderRecoveryRid>();
    const visit = (rid: GodotRenderRecoveryRid): void => {
      if (visiting.has(rid)) throw new Error('godot-compat: recoverable resource dependency cycle.');
      if (visited.has(rid)) return;
      visiting.add(rid);
      for (const dependency of this.require(rid).descriptor.dependencies) visit(dependency);
      visiting.delete(rid);
      visited.add(rid);
    };
    for (const rid of this.resources.keys()) visit(rid);
  }

  private emptyFrame(frame: number, complete: boolean): GodotRenderRecoveryFrame {
    return Object.freeze({
      frame,
      deviceGeneration: this.deviceGeneration,
      restored: Object.freeze([]),
      deferred: Object.freeze([]),
      failed: Object.freeze([]),
      blocked: Object.freeze([]),
      budgetUsed: 0,
      budget: this.restoreBudget,
      complete,
      generation: this.generation,
    });
  }

  private require(rid: GodotRenderRecoveryRid): ResourceState<TSnapshot, THandle> {
    const value = this.resources.get(rid);
    if (value === undefined) throw new Error('godot-compat: unknown recoverable render resource.');
    return value;
  }

  private publish(): void {
    if (this.watchers.size === 0) return;
    const snapshot = this.getSnapshot();
    for (const watcher of this.watchers) watcher(snapshot);
  }
}

export function createGodotRenderDeviceRecoveryRuntime<TSnapshot = unknown, THandle = unknown>(
  backend: GodotRenderRecoveryBackend<TSnapshot, THandle>,
  restoreBudget?: number,
): GodotRenderDeviceRecoveryRuntime<TSnapshot, THandle> {
  return new GodotRenderDeviceRecoveryRuntime(backend, restoreBudget);
}
