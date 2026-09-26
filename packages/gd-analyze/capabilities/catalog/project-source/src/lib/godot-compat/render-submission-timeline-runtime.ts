export type GodotSubmissionRid = string | number;
export type GodotSubmissionQueue = 'graphics' | 'compute' | 'transfer' | 'present';

export interface GodotSubmissionWait {
  readonly queue: GodotSubmissionQueue;
  readonly value: number;
  readonly stages?: number;
}

export interface GodotSubmissionDescriptor<TCommand = unknown> {
  readonly name: string;
  readonly queue: GodotSubmissionQueue;
  readonly commands: readonly TCommand[];
  readonly waits?: readonly GodotSubmissionWait[];
  readonly reads?: readonly GodotSubmissionRid[];
  readonly writes?: readonly GodotSubmissionRid[];
  readonly priority?: number;
  readonly userData?: unknown;
}

export interface GodotSubmissionBatch<TCommand = unknown> {
  readonly id: number;
  readonly frame: number;
  readonly name: string;
  readonly queue: GodotSubmissionQueue;
  readonly commands: readonly TCommand[];
  readonly waits: readonly GodotSubmissionWait[];
  readonly signalValue: number;
  readonly reads: readonly GodotSubmissionRid[];
  readonly writes: readonly GodotSubmissionRid[];
  readonly priority: number;
  readonly userData: unknown;
  readonly generation: number;
}

export interface GodotSubmissionFrameResult {
  readonly frame: number;
  readonly submitted: readonly number[];
  readonly completed: readonly number[];
  readonly pending: readonly number[];
  readonly failed: readonly { id: number; error: unknown }[];
  readonly queueValues: Readonly<Record<GodotSubmissionQueue, number>>;
  readonly generation: number;
}

export interface GodotSubmissionTimelineSnapshot {
  readonly frame: number;
  readonly queued: number;
  readonly inFlight: number;
  readonly completed: number;
  readonly failed: number;
  readonly queueValues: Readonly<Record<GodotSubmissionQueue, number>>;
  readonly completedValues: Readonly<Record<GodotSubmissionQueue, number>>;
  readonly trackedResources: number;
  readonly generation: number;
}

export interface GodotSubmissionBackend<TCommand = unknown, TFence = unknown> {
  submit(batch: GodotSubmissionBatch<TCommand>): TFence | Promise<TFence>;
  isComplete(fence: TFence): boolean;
  destroyFence?(fence: TFence): void;
}

interface SubmissionState<TCommand, TFence> {
  batch: GodotSubmissionBatch<TCommand>;
  state: 'queued' | 'submitting' | 'in-flight' | 'completed' | 'failed';
  fence: TFence | null;
  error: unknown;
  callbacks: Set<(batch: GodotSubmissionBatch<TCommand>) => void>;
}

interface ResourceUse {
  queue: GodotSubmissionQueue;
  value: number;
  write: boolean;
}

const QUEUES: readonly GodotSubmissionQueue[] = ['graphics', 'compute', 'transfer', 'present'];

function integer(value: unknown, member: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new RangeError(`godot-compat: ${member} requires an integer in [${minimum}, ${maximum}].`);
  }
  return result;
}

function queue(value: unknown): GodotSubmissionQueue {
  if (value !== 'graphics' && value !== 'compute' && value !== 'transfer' && value !== 'present') {
    throw new TypeError(`godot-compat: unknown submission queue ${String(value)}.`);
  }
  return value;
}

function values(): Record<GodotSubmissionQueue, number> {
  return { graphics: 0, compute: 0, transfer: 0, present: 0 };
}

function unique<T>(source: readonly T[] | undefined): readonly T[] {
  return Object.freeze([...new Set(source ?? [])]);
}

export class GodotRenderSubmissionTimelineRuntime<TCommand = unknown, TFence = unknown> {
  private readonly submissions = new Map<number, SubmissionState<TCommand, TFence>>();
  private readonly resourceUses = new Map<GodotSubmissionRid, ResourceUse>();
  private readonly watchers = new Set<(snapshot: GodotSubmissionTimelineSnapshot) => void>();
  private readonly queueValues = values();
  private readonly completedValues = values();
  private frame = 0;
  private nextId = 1;
  private generation = 1;
  private completed = 0;
  private failed = 0;
  private submitting = false;

  constructor(private backend: GodotSubmissionBackend<TCommand, TFence>) {}

  enqueue(value: GodotSubmissionDescriptor<TCommand>): GodotSubmissionBatch<TCommand> {
    if (typeof value.name !== 'string' || value.name.length === 0) {
      throw new TypeError('godot-compat: submission name requires a non-empty string.');
    }
    if (!Array.isArray(value.commands) || value.commands.length === 0) {
      throw new TypeError('godot-compat: submission requires commands.');
    }
    const batchQueue = queue(value.queue);
    const reads = unique(value.reads);
    const writes = unique(value.writes);
    if (writes.some((resource) => reads.includes(resource))) {
      throw new Error('godot-compat: submission cannot read and write the same resource.');
    }
    const waits = new Map<GodotSubmissionQueue, GodotSubmissionWait>();
    for (const wait of value.waits ?? []) {
      const waitQueue = queue(wait.queue);
      const normalized = Object.freeze({
        queue: waitQueue,
        value: integer(wait.value, 'submission wait value', 0),
        stages: integer(wait.stages ?? 0xffff_ffff, 'submission wait stages', 0, 0xffff_ffff),
      });
      const retained = waits.get(waitQueue);
      if (retained === undefined || normalized.value > retained.value) waits.set(waitQueue, normalized);
    }
    for (const resource of [...reads, ...writes]) {
      const lastUse = this.resourceUses.get(resource);
      if (lastUse === undefined || lastUse.queue === batchQueue) continue;
      const current = waits.get(lastUse.queue);
      if (current === undefined || current.value < lastUse.value) {
        waits.set(lastUse.queue, Object.freeze({ queue: lastUse.queue, value: lastUse.value, stages: 0xffff_ffff }));
      }
    }
    const signalValue = ++this.queueValues[batchQueue];
    const batch: GodotSubmissionBatch<TCommand> = Object.freeze({
      id: this.nextId++,
      frame: this.frame,
      name: value.name,
      queue: batchQueue,
      commands: Object.freeze([...value.commands]),
      waits: Object.freeze([...waits.values()]),
      signalValue,
      reads,
      writes,
      priority: integer(value.priority ?? 0, 'submission priority', -128, 127),
      userData: value.userData ?? null,
      generation: ++this.generation,
    });
    this.submissions.set(batch.id, {
      batch,
      state: 'queued',
      fence: null,
      error: null,
      callbacks: new Set(),
    });
    for (const resource of reads) this.resourceUses.set(resource, { queue: batchQueue, value: signalValue, write: false });
    for (const resource of writes) this.resourceUses.set(resource, { queue: batchQueue, value: signalValue, write: true });
    this.publish();
    return batch;
  }

  onComplete(batch: GodotSubmissionBatch<TCommand>, callback: (batch: GodotSubmissionBatch<TCommand>) => void): () => void {
    const state = this.require(batch);
    if (state.state === 'completed') {
      callback(batch);
      return () => undefined;
    }
    state.callbacks.add(callback);
    return () => state.callbacks.delete(callback);
  }

  async submitFrame(frameValue: number): Promise<GodotSubmissionFrameResult> {
    const frame = integer(frameValue, 'submission frame', 0);
    if (frame < this.frame) throw new RangeError('godot-compat: submission frame cannot move backwards.');
    if (this.submitting) throw new Error('godot-compat: submission timeline is already submitting.');
    this.frame = frame;
    this.submitting = true;
    const submitted: number[] = [];
    const failed: Array<{ id: number; error: unknown }> = [];
    try {
      const queued = [...this.submissions.values()]
        .filter((state) => state.state === 'queued')
        .sort((left, right) => right.batch.priority - left.batch.priority || left.batch.id - right.batch.id);
      let progress = true;
      while (progress) {
        progress = false;
        for (const state of queued) {
          if (state.state !== 'queued' || !this.waitsSubmitted(state.batch)) continue;
          state.state = 'submitting';
          try {
            state.fence = await this.backend.submit(state.batch);
            state.state = 'in-flight';
            submitted.push(state.batch.id);
            progress = true;
          } catch (error) {
            state.state = 'failed';
            state.error = error;
            failed.push(Object.freeze({ id: state.batch.id, error }));
            this.failed++;
          }
        }
      }
      const completed = this.poll();
      const pending = [...this.submissions.values()]
        .filter((state) => state.state === 'queued' || state.state === 'in-flight')
        .map((state) => state.batch.id);
      this.publish();
      return Object.freeze({
        frame,
        submitted: Object.freeze(submitted),
        completed: Object.freeze(completed),
        pending: Object.freeze(pending),
        failed: Object.freeze(failed),
        queueValues: Object.freeze({ ...this.queueValues }),
        generation: ++this.generation,
      });
    } finally {
      this.submitting = false;
    }
  }

  poll(): readonly number[] {
    const completed: number[] = [];
    for (const state of this.submissions.values()) {
      if (state.state !== 'in-flight' || state.fence === null || !this.backend.isComplete(state.fence)) continue;
      this.backend.destroyFence?.(state.fence);
      state.fence = null;
      state.state = 'completed';
      this.completedValues[state.batch.queue] = Math.max(this.completedValues[state.batch.queue], state.batch.signalValue);
      this.completed++;
      completed.push(state.batch.id);
      for (const callback of state.callbacks) callback(state.batch);
      state.callbacks.clear();
      this.generation++;
    }
    if (completed.length > 0) this.publish();
    return Object.freeze(completed);
  }

  beginFrame(frameValue: number): void {
    const frame = integer(frameValue, 'submission frame', 0);
    if (frame < this.frame) throw new RangeError('godot-compat: submission frame cannot move backwards.');
    this.frame = frame;
    this.poll();
    this.trim(frame - 3);
  }

  getState(batch: GodotSubmissionBatch<TCommand>): SubmissionState<TCommand, TFence>['state'] {
    return this.require(batch).state;
  }

  getCompletedValue(queueValue: GodotSubmissionQueue): number {
    return this.completedValues[queue(queueValue)];
  }

  isValueComplete(queueValue: GodotSubmissionQueue, value: number): boolean {
    return this.completedValues[queue(queueValue)] >= integer(value, 'submission timeline value', 0);
  }

  waitForResources(resources: readonly GodotSubmissionRid[]): readonly GodotSubmissionWait[] {
    const waits = new Map<GodotSubmissionQueue, number>();
    for (const resource of resources) {
      const use = this.resourceUses.get(resource);
      if (use === undefined) continue;
      waits.set(use.queue, Math.max(waits.get(use.queue) ?? 0, use.value));
    }
    return Object.freeze([...waits].map(([waitQueue, value]) => Object.freeze({
      queue: waitQueue,
      value,
      stages: 0xffff_ffff,
    })));
  }

  getSnapshot(): GodotSubmissionTimelineSnapshot {
    const states = [...this.submissions.values()];
    return Object.freeze({
      frame: this.frame,
      queued: states.filter((state) => state.state === 'queued').length,
      inFlight: states.filter((state) => state.state === 'submitting' || state.state === 'in-flight').length,
      completed: this.completed,
      failed: this.failed,
      queueValues: Object.freeze({ ...this.queueValues }),
      completedValues: Object.freeze({ ...this.completedValues }),
      trackedResources: this.resourceUses.size,
      generation: this.generation,
    });
  }

  watch(listener: (snapshot: GodotSubmissionTimelineSnapshot) => void): () => void {
    this.watchers.add(listener);
    listener(this.getSnapshot());
    return () => this.watchers.delete(listener);
  }

  replaceBackend(backend: GodotSubmissionBackend<TCommand, TFence>): void {
    if ([...this.submissions.values()].some((state) => state.state === 'submitting' || state.state === 'in-flight')) {
      throw new Error('godot-compat: cannot replace submission backend with work in flight.');
    }
    this.backend = backend;
    this.generation++;
  }

  dispose(): void {
    for (const state of this.submissions.values()) {
      if (state.fence !== null) this.backend.destroyFence?.(state.fence);
    }
    this.submissions.clear();
    this.resourceUses.clear();
    this.watchers.clear();
    this.generation++;
  }

  private waitsSubmitted(batch: GodotSubmissionBatch<TCommand>): boolean {
    return batch.waits.every((wait) => {
      if (this.completedValues[wait.queue] >= wait.value) return true;
      return [...this.submissions.values()].some((state) =>
        state.batch.queue === wait.queue
        && state.batch.signalValue >= wait.value
        && (state.state === 'in-flight' || state.state === 'completed'));
    });
  }

  private trim(beforeFrame: number): void {
    for (const [id, state] of this.submissions) {
      if (state.batch.frame > beforeFrame || (state.state !== 'completed' && state.state !== 'failed')) continue;
      this.submissions.delete(id);
    }
    for (const [resource, use] of this.resourceUses) {
      if (this.completedValues[use.queue] >= use.value) this.resourceUses.delete(resource);
    }
  }

  private require(batch: GodotSubmissionBatch<TCommand>): SubmissionState<TCommand, TFence> {
    const value = this.submissions.get(batch.id);
    if (value === undefined || value.batch !== batch) throw new Error('godot-compat: submission batch is stale or unknown.');
    return value;
  }

  private publish(): void {
    if (this.watchers.size === 0) return;
    const snapshot = this.getSnapshot();
    for (const watcher of this.watchers) watcher(snapshot);
  }
}

export function createGodotRenderSubmissionTimelineRuntime<TCommand = unknown, TFence = unknown>(
  backend: GodotSubmissionBackend<TCommand, TFence>,
): GodotRenderSubmissionTimelineRuntime<TCommand, TFence> {
  return new GodotRenderSubmissionTimelineRuntime(backend);
}
