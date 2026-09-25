interface DisposableSource {
  dispose(): void;
}

export interface RetainedDocumentState {
  readonly documentId: string;
  inUse: boolean;
  source: DisposableSource | null;
}

/** CPU state belongs to an open document, not to the lifetime of its last pane. */
export class RetainedDocumentStates<T extends RetainedDocumentState> {
  private readonly states = new Map<string, T[]>();
  private readonly generations = new WeakMap<T, number>();
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly create: (documentId: string) => T,
    private readonly isOpen: (documentId: string) => boolean,
    private readonly subscribe: (changed: () => void) => () => void,
  ) {}

  claim(documentId: string): T {
    const states = this.states.get(documentId) ?? [];
    let state = states.find(candidate => !candidate.inUse);
    if (!state) {
      state = this.create(documentId);
      states.push(state);
      this.states.set(documentId, states);
    }
    state.inUse = true;
    this.generations.set(state, this.generation(state) + 1);
    this.unsubscribe ??= this.subscribe(() => this.discardClosed());
    return state;
  }

  generation(state: T): number {
    return this.generations.get(state) ?? 0;
  }

  release(state: T, generation = this.generation(state)): void {
    if (this.generation(state) !== generation) return;
    state.inUse = false;
    // React cleanup may precede the registry's close notification. The
    // subscription also handles closing a pane that was already unmounted.
    queueMicrotask(() => this.discardClosed());
  }

  /** A gesture may finish releasing its source after its document has closed
   * or its state slot has been claimed by a replacement pane. */
  retain(state: T, source: NonNullable<T['source']>, generation: number): void {
    if (
      !this.isOpen(state.documentId) ||
      !this.states.get(state.documentId)?.includes(state) ||
      this.generation(state) !== generation
    ) {
      source.dispose();
      return;
    }
    const previous = state.source;
    state.source = source;
    if (previous !== source) previous?.dispose();
  }

  private discardClosed(): void {
    const discarded: T[] = [];
    for (const [documentId, states] of this.states) {
      if (this.isOpen(documentId)) continue;
      const remaining = states.filter(state => state.inUse);
      discarded.push(...states.filter(state => !state.inUse));
      if (remaining.length) this.states.set(documentId, remaining);
      else this.states.delete(documentId);
    }
    if (this.states.size === 0) {
      this.unsubscribe?.();
      this.unsubscribe = null;
    }
    // Remove ownership first, even if a disposer throws or publishes a change.
    const failures: unknown[] = [];
    for (const state of discarded) {
      const source = state.source;
      state.source = null;
      try {
        source?.dispose();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, 'Retained document cleanup failed');
  }
}
