export type GodotRayDispatchRid = string | number;

export interface GodotRayDispatchDimensions {
  readonly width: number;
  readonly height: number;
  readonly depth?: number;
}

export interface GodotRayDispatchDescriptor {
  readonly name: string;
  readonly pipeline: GodotRayDispatchRid;
  readonly shaderTable: GodotRayDispatchRid;
  readonly accelerationStructure: GodotRayDispatchRid;
  readonly output: GodotRayDispatchRid;
  readonly dimensions: GodotRayDispatchDimensions;
  readonly raygenRecord?: number;
  readonly missRecordOffset?: number;
  readonly hitRecordOffset?: number;
  readonly callableRecordOffset?: number;
  readonly recursionDepth?: number;
  readonly raysPerPixel?: number;
  readonly layerMask?: number;
  readonly priority?: number;
  readonly after?: readonly number[];
  readonly reads?: readonly GodotRayDispatchRid[];
  readonly writes?: readonly GodotRayDispatchRid[];
  readonly userData?: unknown;
}

export interface GodotRayDispatchCommand {
  readonly id: number;
  readonly frame: number;
  readonly name: string;
  readonly pipeline: GodotRayDispatchRid;
  readonly shaderTable: GodotRayDispatchRid;
  readonly accelerationStructure: GodotRayDispatchRid;
  readonly output: GodotRayDispatchRid;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly raygenRecord: number;
  readonly missRecordOffset: number;
  readonly hitRecordOffset: number;
  readonly callableRecordOffset: number;
  readonly recursionDepth: number;
  readonly raysPerPixel: number;
  readonly layerMask: number;
  readonly estimatedRays: number;
  readonly priority: number;
  readonly reads: readonly GodotRayDispatchRid[];
  readonly writes: readonly GodotRayDispatchRid[];
  readonly userData: unknown;
  readonly generation: number;
}

export interface GodotRayDispatchResult {
  readonly frame: number;
  readonly submitted: readonly number[];
  readonly completed: readonly number[];
  readonly deferred: readonly number[];
  readonly cancelled: readonly number[];
  readonly failed: readonly { id: number; error: unknown }[];
  readonly barriers: number;
  readonly raysSubmitted: number;
  readonly generation: number;
}

export interface GodotRayDispatchSnapshot {
  readonly frame: number;
  readonly queued: number;
  readonly submitting: number;
  readonly completed: number;
  readonly cancelled: number;
  readonly failed: number;
  readonly rayBudget: number;
  readonly dispatchedRays: number;
  readonly barriers: number;
  readonly generation: number;
}

export interface GodotRayDispatchBackend {
  dispatch(command: GodotRayDispatchCommand): void | Promise<void>;
  barrier?(before: GodotRayDispatchCommand, after: GodotRayDispatchCommand): void | Promise<void>;
}

interface CommandState {
  command: GodotRayDispatchCommand;
  after: number[];
  state: 'queued' | 'submitting' | 'completed' | 'cancelled' | 'failed';
  error: unknown;
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

function unique(values: readonly GodotRayDispatchRid[] | undefined): readonly GodotRayDispatchRid[] {
  return Object.freeze([...new Set(values ?? [])]);
}

function conflicts(left: GodotRayDispatchCommand, right: GodotRayDispatchCommand): boolean {
  const leftWrites = new Set(left.writes);
  const rightWrites = new Set(right.writes);
  return right.reads.some((resource) => leftWrites.has(resource))
    || right.writes.some((resource) => leftWrites.has(resource) || left.reads.includes(resource))
    || left.output === right.output
    || rightWrites.has(left.output)
    || leftWrites.has(right.output);
}

export class GodotRayDispatchRuntime {
  private readonly commands = new Map<number, CommandState>();
  private readonly watchers = new Set<(snapshot: GodotRayDispatchSnapshot) => void>();
  private frame = 0;
  private nextId = 1;
  private generation = 1;
  private rayBudget: number;
  private dispatchedRays = 0;
  private barrierCount = 0;
  private completed = 0;
  private cancelled = 0;
  private failed = 0;
  private flushing = false;
  private lastResult: GodotRayDispatchResult | null = null;

  constructor(private backend: GodotRayDispatchBackend, rayBudget = 1920 * 1080 * 4) {
    this.rayBudget = integer(rayBudget, 'ray dispatch budget', 1);
  }

  enqueue(value: GodotRayDispatchDescriptor): GodotRayDispatchCommand {
    if (typeof value.name !== 'string' || value.name.length === 0) {
      throw new TypeError('godot-compat: ray dispatch name requires a non-empty string.');
    }
    const width = integer(value.dimensions.width, 'ray dispatch width', 1, 65535);
    const height = integer(value.dimensions.height, 'ray dispatch height', 1, 65535);
    const depth = integer(value.dimensions.depth ?? 1, 'ray dispatch depth', 1, 65535);
    const raysPerPixel = integer(value.raysPerPixel ?? 1, 'ray dispatch rays per pixel', 1, 65535);
    const after = [...new Set(value.after ?? [])];
    for (const dependency of after) {
      if (!this.commands.has(dependency)) throw new Error(`godot-compat: ray dispatch dependency ${dependency} does not exist.`);
    }
    const reads = unique([value.accelerationStructure, value.shaderTable, ...(value.reads ?? [])]);
    const writes = unique([value.output, ...(value.writes ?? [])]);
    if (writes.some((resource) => reads.includes(resource))) {
      throw new Error('godot-compat: ray dispatch resource cannot be read and written by one command.');
    }
    const command: GodotRayDispatchCommand = Object.freeze({
      id: this.nextId++,
      frame: this.frame,
      name: value.name,
      pipeline: value.pipeline,
      shaderTable: value.shaderTable,
      accelerationStructure: value.accelerationStructure,
      output: value.output,
      width,
      height,
      depth,
      raygenRecord: integer(value.raygenRecord ?? 0, 'raygen record', 0),
      missRecordOffset: integer(value.missRecordOffset ?? 0, 'miss record offset', 0),
      hitRecordOffset: integer(value.hitRecordOffset ?? 0, 'hit record offset', 0),
      callableRecordOffset: integer(value.callableRecordOffset ?? 0, 'callable record offset', 0),
      recursionDepth: integer(value.recursionDepth ?? 1, 'ray recursion depth', 1, 31),
      raysPerPixel,
      layerMask: integer(value.layerMask ?? 0xff, 'ray dispatch layer mask', 0, 0xff),
      estimatedRays: width * height * depth * raysPerPixel,
      priority: integer(value.priority ?? 0, 'ray dispatch priority', -128, 127),
      reads,
      writes,
      userData: value.userData ?? null,
      generation: ++this.generation,
    });
    this.commands.set(command.id, { command, after, state: 'queued', error: null });
    this.assertAcyclic();
    this.publish();
    return command;
  }

  cancel(idValue: number, recursive = true): boolean {
    const id = integer(idValue, 'ray dispatch id', 1);
    const command = this.commands.get(id);
    if (command === undefined || command.state !== 'queued') return false;
    command.state = 'cancelled';
    this.cancelled++;
    this.generation++;
    if (recursive) {
      for (const candidate of this.commands.values()) {
        if (candidate.after.includes(id)) this.cancel(candidate.command.id, true);
      }
    }
    this.publish();
    return true;
  }

  async flush(frameValue: number): Promise<GodotRayDispatchResult> {
    const frame = integer(frameValue, 'ray dispatch frame', 0);
    if (frame < this.frame) throw new RangeError('godot-compat: ray dispatch frame cannot move backwards.');
    if (this.flushing) throw new Error('godot-compat: ray dispatch runtime is already flushing.');
    this.frame = frame;
    this.flushing = true;
    const submitted: number[] = [];
    const completed: number[] = [];
    const deferred: number[] = [];
    const cancelled: number[] = [];
    const failed: Array<{ id: number; error: unknown }> = [];
    let raysSubmitted = 0;
    let barriers = 0;
    let previous: CommandState | null = null;
    try {
      for (const command of this.ordered()) {
        if (command.state !== 'queued') continue;
        if (command.after.some((id) => {
          const state = this.commands.get(id)?.state;
          return state === 'failed' || state === 'cancelled';
        })) {
          command.state = 'cancelled';
          cancelled.push(command.command.id);
          this.cancelled++;
          continue;
        }
        if (!command.after.every((id) => this.commands.get(id)?.state === 'completed')) {
          deferred.push(command.command.id);
          continue;
        }
        if (raysSubmitted + command.command.estimatedRays > this.rayBudget && submitted.length > 0) {
          deferred.push(command.command.id);
          continue;
        }
        try {
          if (previous !== null && conflicts(previous.command, command.command)) {
            await this.backend.barrier?.(previous.command, command.command);
            barriers++;
            this.barrierCount++;
          }
          command.state = 'submitting';
          submitted.push(command.command.id);
          this.publish();
          await this.backend.dispatch(command.command);
          command.state = 'completed';
          completed.push(command.command.id);
          raysSubmitted += command.command.estimatedRays;
          this.dispatchedRays += command.command.estimatedRays;
          this.completed++;
          previous = command;
        } catch (error) {
          command.state = 'failed';
          command.error = error;
          failed.push(Object.freeze({ id: command.command.id, error }));
          this.failed++;
        }
      }
      this.lastResult = Object.freeze({
        frame,
        submitted: Object.freeze(submitted),
        completed: Object.freeze(completed),
        deferred: Object.freeze(deferred),
        cancelled: Object.freeze(cancelled),
        failed: Object.freeze(failed),
        barriers,
        raysSubmitted,
        generation: ++this.generation,
      });
      this.trimCompleted(frame - 2);
      this.publish();
      return this.lastResult;
    } finally {
      this.flushing = false;
    }
  }

  beginFrame(frameValue: number): void {
    const frame = integer(frameValue, 'ray dispatch frame', 0);
    if (frame < this.frame) throw new RangeError('godot-compat: ray dispatch frame cannot move backwards.');
    this.frame = frame;
    this.publish();
  }

  getCommand(idValue: number): GodotRayDispatchCommand | null {
    return this.commands.get(integer(idValue, 'ray dispatch id', 1))?.command ?? null;
  }

  getState(idValue: number): CommandState['state'] | null {
    return this.commands.get(integer(idValue, 'ray dispatch id', 1))?.state ?? null;
  }

  setRayBudget(value: number): void {
    this.rayBudget = integer(value, 'ray dispatch budget', 1);
    this.publish();
  }

  getLastResult(): GodotRayDispatchResult | null {
    return this.lastResult;
  }

  getSnapshot(): GodotRayDispatchSnapshot {
    const values = [...this.commands.values()];
    return Object.freeze({
      frame: this.frame,
      queued: values.filter((command) => command.state === 'queued').length,
      submitting: values.filter((command) => command.state === 'submitting').length,
      completed: this.completed,
      cancelled: this.cancelled,
      failed: this.failed,
      rayBudget: this.rayBudget,
      dispatchedRays: this.dispatchedRays,
      barriers: this.barrierCount,
      generation: this.generation,
    });
  }

  watch(listener: (snapshot: GodotRayDispatchSnapshot) => void): () => void {
    this.watchers.add(listener);
    listener(this.getSnapshot());
    return () => this.watchers.delete(listener);
  }

  clear(): void {
    if (this.flushing) throw new Error('godot-compat: cannot clear ray dispatches while flushing.');
    this.commands.clear();
    this.lastResult = null;
    this.generation++;
    this.publish();
  }

  dispose(): void {
    this.clear();
    this.watchers.clear();
  }

  private ordered(): CommandState[] {
    const values = [...this.commands.values()].filter((command) => command.state === 'queued');
    const result: CommandState[] = [];
    const visited = new Set<number>();
    const visit = (command: CommandState): void => {
      if (visited.has(command.command.id)) return;
      for (const dependency of command.after) {
        const dependencyCommand = this.commands.get(dependency);
        if (dependencyCommand !== undefined && dependencyCommand.state === 'queued') visit(dependencyCommand);
      }
      visited.add(command.command.id);
      result.push(command);
    };
    values.sort((left, right) => right.command.priority - left.command.priority || left.command.id - right.command.id);
    for (const command of values) visit(command);
    return result;
  }

  private assertAcyclic(): void {
    const visiting = new Set<number>();
    const visited = new Set<number>();
    const visit = (id: number): void => {
      if (visiting.has(id)) throw new Error(`godot-compat: ray dispatch dependency cycle at ${id}.`);
      if (visited.has(id)) return;
      visiting.add(id);
      for (const dependency of this.commands.get(id)?.after ?? []) visit(dependency);
      visiting.delete(id);
      visited.add(id);
    };
    for (const id of this.commands.keys()) visit(id);
  }

  private trimCompleted(beforeFrame: number): void {
    for (const [id, command] of this.commands) {
      if (command.command.frame > beforeFrame) continue;
      if (command.state === 'completed' || command.state === 'cancelled' || command.state === 'failed') this.commands.delete(id);
    }
  }

  private publish(): void {
    if (this.watchers.size === 0) return;
    const snapshot = this.getSnapshot();
    for (const watcher of this.watchers) watcher(snapshot);
  }
}

export function createGodotRayDispatchRuntime(
  backend: GodotRayDispatchBackend,
  rayBudget?: number,
): GodotRayDispatchRuntime {
  return new GodotRayDispatchRuntime(backend, rayBudget);
}
