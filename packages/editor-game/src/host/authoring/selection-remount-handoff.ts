/**
 * One-shot selection handoff for UI remounts that rebuild the scene between
 * the outgoing and incoming owners. Keys are weak so closing a store cannot
 * leave editor state retained by the handoff.
 */
export class SelectionRemountHandoff<Key extends object> {
  private readonly pending = new WeakMap<Key, readonly string[]>();

  remember(key: Key, selection: Iterable<string>): void {
    const ids = [...selection];
    if (ids.length === 0) this.pending.delete(key);
    else this.pending.set(key, ids);
  }

  take(key: Key, currentSelection: Iterable<string>): readonly string[] {
    const current = [...currentSelection];
    const previous = this.pending.get(key) ?? [];
    this.pending.delete(key);
    // A selection made while the incoming owner was mounting is newer than
    // the outgoing owner's handoff and must win.
    return current.length > 0 ? current : previous;
  }
}
