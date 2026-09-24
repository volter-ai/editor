import type { ResourceKey } from '@volter/editor-sdk/kit/history-types';

/** Serializes every in-process writer that touches the same authored resource. */
export class PersistenceCoordinator {
  private readonly tails = new Map<ResourceKey, Promise<void>>();

  run<T>(resource: ResourceKey, operation: () => Promise<T>): Promise<T> {
    return this.runMany([resource], operation);
  }

  async runMany<T>(resources: readonly ResourceKey[], operation: () => Promise<T>): Promise<T> {
    const keys = [...new Set(resources)].sort();
    if (keys.length === 0) return operation();

    const previous = keys.map((key) => this.tails.get(key) ?? Promise.resolve());
    const acquired = Promise.all(previous).then(() => undefined);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reservation = acquired.then(() => held);
    for (const key of keys) this.tails.set(key, reservation);

    await acquired;
    try {
      return await operation();
    } finally {
      release();
      for (const key of keys) {
        if (this.tails.get(key) !== reservation) continue;
        this.tails.delete(key);
      }
    }
  }
}
