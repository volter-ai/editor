import type { HistoryService } from './history-service';

export interface HistoryCommandSnapshot {
  readonly version: number;
  readonly busy: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel: string | null;
  readonly redoLabel: string | null;
}

/** Shell command surface for the one project HistoryService timeline. */
export class HistoryCommands {
  private tail: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<() => void>();
  private pending = 0;
  private version = 0;
  private disposed = false;
  private readonly idleWaiters = new Set<{
    unsubscribe: () => void;
    reject: (error: Error) => void;
  }>();
  private readonly unsubscribeHistory: () => void;
  private snapshot: HistoryCommandSnapshot;

  constructor(private readonly history: HistoryService) {
    this.snapshot = this.buildSnapshot();
    this.unsubscribeHistory = history.subscribe(this.notify);
  }

  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): HistoryCommandSnapshot => this.snapshot;

  undo(): Promise<boolean> {
    return this.enqueue(async () => {
      await this.waitForServiceIdle();
      this.assertNotDisposed();
      return this.history.undo();
    });
  }

  redo(): Promise<boolean> {
    return this.enqueue(async () => {
      await this.waitForServiceIdle();
      this.assertNotDisposed();
      return this.history.redo();
    });
  }

  jumpTo(cursor: number): Promise<boolean> {
    return this.enqueue(async () => {
      await this.waitForServiceIdle();
      this.assertNotDisposed();
      return this.history.jumpTo(cursor);
    });
  }

  get canUndo(): boolean {
    return this.snapshot.canUndo;
  }

  get canRedo(): boolean {
    return this.snapshot.canRedo;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeHistory();
    const error = new Error('History commands are disposed.');
    for (const waiter of this.idleWaiters) {
      waiter.unsubscribe();
      waiter.reject(error);
    }
    this.idleWaiters.clear();
    this.listeners.clear();
    this.notify();
  }

  private enqueue(operation: () => Promise<boolean>): Promise<boolean> {
    if (this.disposed) return Promise.reject(new Error('History commands are disposed.'));
    this.pending++;
    this.notify();
    const run = () => {
      if (this.disposed) throw new Error('History commands are disposed.');
      return operation();
    };
    const result = this.tail.then(run, run);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result.finally(() => {
      this.pending--;
      this.notify();
    });
  }

  private assertNotDisposed(): void {
    if (this.disposed) throw new Error('History commands are disposed.');
  }

  private waitForServiceIdle(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('History commands are disposed.'));
    if (!this.history.getSnapshot().busy) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const waiter: {
        unsubscribe: () => void;
        reject: (error: Error) => void;
      } = { unsubscribe: () => undefined, reject };
      const finish = () => {
        waiter.unsubscribe();
        this.idleWaiters.delete(waiter);
      };
      waiter.unsubscribe = this.history.subscribe(() => {
        if (this.history.getSnapshot().busy) return;
        finish();
        resolve();
      });
      this.idleWaiters.add(waiter);
    });
  }

  private notify = (): void => {
    this.version++;
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  };

  private buildSnapshot(): HistoryCommandSnapshot {
    const current = this.history.getSnapshot();
    const busy = this.pending > 0 || current.busy;
    return {
      version: this.version,
      busy,
      canUndo: !this.disposed && !busy && current.canUndo,
      canRedo: !this.disposed && !busy && current.canRedo,
      undoLabel: current.undoLabel,
      redoLabel: current.redoLabel,
    };
  }
}
