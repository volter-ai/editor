/** A cooperative job advances only when its owner asks for its next unit.
 * Checkpoints park the producer; they do not renew a timer while work runs. */
export type PullResult<T> = { load: 'continue'; token: string; phase: string } | { load: 'done'; value: T };
export class PullJob<T> {
  private started = false;
  private finished = false;
  private sequence = 0;
  private expected: string | null = null;
  private resume: (() => void) | null = null;
  private waiter: { resolve: (value: PullResult<T>) => void; reject: (error: unknown) => void } | null = null;
  constructor(private readonly work: (checkpoint: (phase: string) => Promise<void>) => Promise<T>) {}
  step(token?: string): Promise<PullResult<T>> {
    if (this.finished || this.waiter || (this.started ? token !== this.expected || !this.resume : token !== undefined))
      return Promise.reject(new Error('Invalid or replayed load continuation'));
    const answer = new Promise<PullResult<T>>((resolve, reject) => { this.waiter = { resolve, reject }; });
    if (!this.started) {
      this.started = true;
      void Promise.resolve().then(() => this.work(phase => new Promise<void>(resolve => {
        this.resume = resolve;
        this.expected = `load:${++this.sequence}`;
        const waiter = this.waiter!; this.waiter = null;
        waiter.resolve({ load: 'continue', token: this.expected, phase });
      }))).then(value => {
        this.finished = true;
        const waiter = this.waiter!; this.waiter = null;
        waiter.resolve({ load: 'done', value });
      }, error => {
        this.finished = true;
        const waiter = this.waiter!; this.waiter = null;
        waiter.reject(error);
      });
    } else {
      const resume = this.resume!; this.resume = null; this.expected = null; resume();
    }
    return answer;
  }
}

/** A streamed import consumes at most one MiB before yielding its producer. */
export function checkpointStream(body: ReadableStream<Uint8Array>, checkpoint: () => Promise<void>): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let held: Uint8Array | undefined, offset = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!held || offset === held.length) {
          const next = await reader.read();
          if (next.done) { reader.releaseLock(); controller.close(); return; }
          held = next.value; offset = 0;
        }
        await checkpoint();
        const end = Math.min(held.length, offset + 1024 * 1024);
        controller.enqueue(held.subarray(offset, end)); offset = end;
      } catch (error) { await reader.cancel(error).catch(() => {}); controller.error(error); }
    },
    async cancel(reason) { await reader.cancel(reason); reader.releaseLock(); },
  }, { highWaterMark: 0 });
}
