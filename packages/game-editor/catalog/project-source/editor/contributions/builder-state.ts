export interface BuilderState<T extends object> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
  update(patch: Partial<T> | ((current: T) => T)): void;
  reset(): void;
}

/** Tiny project-owned state shared by one document contribution and its Inspector contribution. */
export function createBuilderState<T extends object>(initial: T): BuilderState<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => value,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update(patch) {
      value = typeof patch === 'function' ? patch(value) : { ...value, ...patch };
      for (const listener of listeners) listener();
    },
    reset() {
      value = initial;
      for (const listener of listeners) listener();
    },
  };
}
