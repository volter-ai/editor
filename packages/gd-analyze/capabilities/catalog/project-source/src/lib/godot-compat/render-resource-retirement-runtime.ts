export type RenderRetirementQueue = "graphics" | "compute" | "transfer" | "present";

export interface RenderRetiredResource {
  id: string;
  kind: string;
  queue: RenderRetirementQueue;
  submission: number;
  byteSize?: number;
  dependencies?: readonly string[];
  label?: string;
}

export interface RenderRetirementBackend {
  completedSubmission(queue: RenderRetirementQueue): number | Promise<number>;
  destroy(resource: RenderRetiredResource): void | Promise<void>;
}

export interface RenderRetirementSnapshot {
  pendingResources: number;
  pendingBytes: number;
  destroyedResources: number;
  destroyedBytes: number;
  failedResources: number;
  oldestSubmissions: Partial<Record<RenderRetirementQueue, number>>;
}

export interface RenderRetirementFailure {
  resource: RenderRetiredResource;
  error: string;
  attempts: number;
}

type RetirementWatcher = (snapshot: RenderRetirementSnapshot) => void;

interface InternalResource extends RenderRetiredResource {
  dependencies: string[];
  attempts: number;
}

function cloneResource(resource: RenderRetiredResource): RenderRetiredResource {
  return {
    ...resource,
    ...(resource.dependencies === undefined ? {} : { dependencies: [...resource.dependencies] }),
  };
}

export class RenderResourceRetirementRuntime {
  private readonly pending = new Map<string, InternalResource>();
  private readonly failures = new Map<string, RenderRetirementFailure>();
  private readonly watchers = new Set<RetirementWatcher>();
  private destroyedResources = 0;
  private destroyedBytes = 0;

  constructor(private readonly backend: RenderRetirementBackend) {}

  retire(resource: RenderRetiredResource): void {
    if (!resource.id) throw new Error("Retired resource id cannot be empty");
    if (!Number.isInteger(resource.submission) || resource.submission < 0) throw new Error("Retirement submission must be non-negative");
    if (!Number.isFinite(resource.byteSize ?? 0) || (resource.byteSize ?? 0) < 0) throw new Error("Retired resource byteSize must be non-negative");
    if (this.pending.has(resource.id)) throw new Error(`Resource ${resource.id} is already pending retirement`);
    this.pending.set(resource.id, { ...resource, dependencies: [...(resource.dependencies ?? [])], attempts: 0 });
    this.failures.delete(resource.id);
    this.notify();
  }

  cancel(id: string): RenderRetiredResource | null {
    const resource = this.pending.get(id);
    if (!resource) return null;
    this.pending.delete(id);
    this.failures.delete(id);
    this.notify();
    return cloneResource(resource);
  }

  get(id: string): RenderRetiredResource | undefined {
    const resource = this.pending.get(id);
    return resource ? cloneResource(resource) : undefined;
  }

  list(queue?: RenderRetirementQueue): RenderRetiredResource[] {
    return [...this.pending.values()]
      .filter((resource) => !queue || resource.queue === queue)
      .sort((a, b) => a.submission - b.submission)
      .map(cloneResource);
  }

  listFailures(): RenderRetirementFailure[] {
    return [...this.failures.values()].map((failure) => ({
      resource: cloneResource(failure.resource),
      error: failure.error,
      attempts: failure.attempts,
    }));
  }

  async collect(queue?: RenderRetirementQueue): Promise<string[]> {
    const queues: RenderRetirementQueue[] = queue ? [queue] : ["graphics", "compute", "transfer", "present"];
    const completed = new Map<RenderRetirementQueue, number>();
    for (const name of queues) completed.set(name, await this.backend.completedSubmission(name));
    const destroyed: string[] = [];
    let progressed = true;
    while (progressed) {
      progressed = false;
      const candidates = [...this.pending.values()]
        .filter((resource) => completed.has(resource.queue) && resource.submission <= completed.get(resource.queue)!)
        .filter((resource) => resource.dependencies.every((dependency) => !this.pending.has(dependency)))
        .sort((a, b) => a.submission - b.submission || a.id.localeCompare(b.id));
      for (const resource of candidates) {
        resource.attempts += 1;
        try {
          await this.backend.destroy(cloneResource(resource));
          this.pending.delete(resource.id);
          this.failures.delete(resource.id);
          this.destroyedResources += 1;
          this.destroyedBytes += resource.byteSize ?? 0;
          destroyed.push(resource.id);
          progressed = true;
        } catch (error) {
          this.failures.set(resource.id, {
            resource: cloneResource(resource),
            error: error instanceof Error ? error.message : String(error),
            attempts: resource.attempts,
          });
        }
      }
    }
    this.notify();
    return destroyed;
  }

  async retryFailures(): Promise<string[]> {
    return this.collect();
  }

  snapshot(): RenderRetirementSnapshot {
    const resources = [...this.pending.values()];
    const oldestSubmissions: Partial<Record<RenderRetirementQueue, number>> = {};
    for (const resource of resources) {
      oldestSubmissions[resource.queue] = Math.min(oldestSubmissions[resource.queue] ?? resource.submission, resource.submission);
    }
    return {
      pendingResources: resources.length,
      pendingBytes: resources.reduce((total, resource) => total + (resource.byteSize ?? 0), 0),
      destroyedResources: this.destroyedResources,
      destroyedBytes: this.destroyedBytes,
      failedResources: this.failures.size,
      oldestSubmissions,
    };
  }

  watch(watcher: RetirementWatcher): () => void {
    this.watchers.add(watcher);
    watcher(this.snapshot());
    return () => this.watchers.delete(watcher);
  }

  private notify(): void {
    const snapshot = this.snapshot();
    for (const watcher of this.watchers) watcher(snapshot);
  }
}
