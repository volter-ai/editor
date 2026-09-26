export interface RenderShaderCompileRequest {
  key: string;
  shaderId: string;
  revision: number;
  priority?: number;
  payload: unknown;
}

export interface RenderShaderCompileResult {
  handle: unknown;
  diagnostics?: readonly string[];
}

export interface RenderShaderCompileBackend {
  compile(request: RenderShaderCompileRequest): RenderShaderCompileResult | Promise<RenderShaderCompileResult>;
}

export type RenderShaderCompileState = "queued" | "compiling" | "completed" | "failed" | "cancelled";

export interface RenderShaderCompileJob {
  key: string;
  shaderId: string;
  revision: number;
  state: RenderShaderCompileState;
  result: RenderShaderCompileResult | null;
  error: string | null;
}

interface InternalJob extends RenderShaderCompileJob {
  request: RenderShaderCompileRequest;
  generation: number;
}

export class RenderShaderCompileQueueRuntime {
  private readonly jobs = new Map<string, InternalJob>();
  private readonly queue: string[] = [];
  private running = 0;

  constructor(private readonly backend: RenderShaderCompileBackend, private readonly maximumConcurrency = 2) {
    if (!Number.isInteger(maximumConcurrency) || maximumConcurrency < 1) throw new Error("maximumConcurrency must be positive");
  }

  enqueue(request: RenderShaderCompileRequest): RenderShaderCompileJob {
    if (!request.key || !request.shaderId || !Number.isInteger(request.revision) || request.revision < 0) throw new Error("Shader compile request is invalid");
    let job = this.jobs.get(request.key);
    if (job && job.revision === request.revision && job.state !== "failed" && job.state !== "cancelled") return this.clone(job);
    if (job) {
      job.generation += 1;
      job.request = { ...request };
      job.shaderId = request.shaderId;
      job.revision = request.revision;
      job.state = "queued";
      job.result = null;
      job.error = null;
    } else {
      job = { key: request.key, shaderId: request.shaderId, revision: request.revision, state: "queued", result: null, error: null, request: { ...request }, generation: 1 };
      this.jobs.set(request.key, job);
    }
    if (!this.queue.includes(request.key)) this.queue.push(request.key);
    this.queue.sort((a, b) => (this.jobs.get(b)?.request.priority ?? 0) - (this.jobs.get(a)?.request.priority ?? 0));
    void this.pump();
    return this.clone(job);
  }

  cancel(key: string): boolean {
    const job = this.jobs.get(key);
    if (!job || job.state === "completed" || job.state === "cancelled") return false;
    job.generation += 1;
    job.state = "cancelled";
    const index = this.queue.indexOf(key);
    if (index >= 0) this.queue.splice(index, 1);
    return true;
  }

  get(key: string): RenderShaderCompileJob | undefined {
    const job = this.jobs.get(key);
    return job ? this.clone(job) : undefined;
  }

  list(state?: RenderShaderCompileState): RenderShaderCompileJob[] {
    return [...this.jobs.values()].filter((job) => !state || job.state === state).map((job) => this.clone(job));
  }

  remove(key: string): boolean {
    const job = this.jobs.get(key);
    if (!job || job.state === "compiling") return false;
    const index = this.queue.indexOf(key);
    if (index >= 0) this.queue.splice(index, 1);
    return this.jobs.delete(key);
  }

  private async pump(): Promise<void> {
    while (this.running < this.maximumConcurrency && this.queue.length > 0) {
      const key = this.queue.shift()!;
      const job = this.jobs.get(key);
      if (!job || job.state !== "queued") continue;
      const generation = job.generation;
      job.state = "compiling";
      this.running += 1;
      void this.run(job, generation).finally(() => {
        this.running -= 1;
        void this.pump();
      });
    }
  }

  private async run(job: InternalJob, generation: number): Promise<void> {
    try {
      const result = await this.backend.compile({ ...job.request });
      if (job.generation !== generation) return;
      job.result = {
        ...result,
        ...(result.diagnostics === undefined ? {} : { diagnostics: [...result.diagnostics] }),
      };
      job.state = "completed";
    } catch (error) {
      if (job.generation !== generation) return;
      job.error = error instanceof Error ? error.message : String(error);
      job.state = "failed";
    }
  }

  private clone(job: RenderShaderCompileJob): RenderShaderCompileJob {
    return {
      ...job,
      result: job.result === null ? null : {
        ...job.result,
        ...(job.result.diagnostics === undefined ? {} : { diagnostics: [...job.result.diagnostics] }),
      },
    };
  }
}
