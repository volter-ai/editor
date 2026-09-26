/** Godot UndoRedo action history over retained Callables, Objects, and property writes. */

import { GodotCallable } from './callable';
import { godotObjectSet, registerGodotObjectIdentity } from './object';

export const GODOT_UNDO_REDO_MERGE_DISABLE = 0;
export const GODOT_UNDO_REDO_MERGE_ENDS = 1;
export const GODOT_UNDO_REDO_MERGE_ALL = 2;

type UndoOperation =
  | { readonly kind: 'call'; readonly callable: GodotCallable }
  | { readonly kind: 'property'; readonly object: object; readonly property: string; readonly value: unknown };

interface PendingAction {
  readonly name: string;
  readonly mergeMode: number;
  readonly backwardUndoOps: boolean;
  readonly doOperations: UndoOperation[];
  readonly undoOperations: UndoOperation[];
  readonly doReferences: object[];
  readonly undoReferences: object[];
}

interface HistoryAction {
  readonly name: string;
  doOperations: UndoOperation[];
  undoOperations: UndoOperation[];
  doReferences: object[];
  undoReferences: object[];
  readonly backwardUndoOps: boolean;
}

function actionName(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('UndoRedo.create_action name requires String.');
  return value;
}

function mergeMode(value: unknown): number {
  if (value !== 0 && value !== 1 && value !== 2) {
    throw new RangeError('UndoRedo.create_action merge_mode requires MERGE_DISABLE, MERGE_ENDS, or MERGE_ALL.');
  }
  return value as number;
}

function boolean(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`UndoRedo.${member} requires bool.`);
  return value;
}

function object(value: unknown, member: string): object {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    throw new TypeError(`UndoRedo.${member} requires Object.`);
  }
  return value;
}

function propertyName(value: unknown, member: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`UndoRedo.${member} property requires a non-empty StringName.`);
  }
  return value;
}

function callable(value: unknown, member: string): GodotCallable {
  if (!(value instanceof GodotCallable) || !value.isValid()) {
    throw new TypeError(`UndoRedo.${member} requires a valid Callable.`);
  }
  return value;
}

export class GodotUndoRedo {
  private history: HistoryAction[] = [];
  private cursor = 0;
  private version = 1;
  private maxSteps = 0;
  private pending: PendingAction | null = null;
  private committing = false;
  private forceKeepMergeEnds = 0;

  constructor() { registerGodotObjectIdentity(this, 'UndoRedo'); }

  create_action(nameValue: unknown, mergeModeValue = 0, backwardUndoOpsValue = false): void {
    if (this.pending !== null) throw new Error('UndoRedo.create_action cannot replace an uncommitted action.');
    this.pending = {
      name: actionName(nameValue),
      mergeMode: mergeMode(mergeModeValue),
      backwardUndoOps: boolean(backwardUndoOpsValue, 'create_action backward_undo_ops'),
      doOperations: [],
      undoOperations: [],
      doReferences: [],
      undoReferences: [],
    };
  }

  commit_action(executeValue = true): void {
    const execute = boolean(executeValue, 'commit_action execute');
    const pending = this.requirePending('commit_action');
    this.pending = null;
    if (pending.doOperations.length === 0 && pending.undoOperations.length === 0 &&
        pending.doReferences.length === 0 && pending.undoReferences.length === 0) return;
    if (this.cursor < this.history.length) this.history.splice(this.cursor);
    const previous = this.history[this.history.length - 1];
    const canMerge = pending.mergeMode !== GODOT_UNDO_REDO_MERGE_DISABLE &&
      previous !== undefined && previous.name === pending.name;
    if (canMerge) {
      this.merge(previous, pending);
      if (execute) this.execute(pending.doOperations, false);
    } else {
      const action: HistoryAction = {
        name: pending.name,
        doOperations: [...pending.doOperations],
        undoOperations: [...pending.undoOperations],
        doReferences: [...pending.doReferences],
        undoReferences: [...pending.undoReferences],
        backwardUndoOps: pending.backwardUndoOps,
      };
      this.history.push(action);
      this.cursor = this.history.length;
      if (execute) this.execute(action.doOperations, false);
    }
    this.trimHistory();
    this.version += 1;
  }

  is_committing_action(): boolean { return this.committing; }

  add_do_method(callableValue: unknown): void {
    this.requirePending('add_do_method').doOperations.push({ kind: 'call', callable: callable(callableValue, 'add_do_method') });
  }

  add_undo_method(callableValue: unknown): void {
    this.requirePending('add_undo_method').undoOperations.push({ kind: 'call', callable: callable(callableValue, 'add_undo_method') });
  }

  add_do_property(objectValue: unknown, propertyValue: unknown, value: unknown): void {
    this.requirePending('add_do_property').doOperations.push({
      kind: 'property', object: object(objectValue, 'add_do_property'),
      property: propertyName(propertyValue, 'add_do_property'), value,
    });
  }

  add_undo_property(objectValue: unknown, propertyValue: unknown, value: unknown): void {
    this.requirePending('add_undo_property').undoOperations.push({
      kind: 'property', object: object(objectValue, 'add_undo_property'),
      property: propertyName(propertyValue, 'add_undo_property'), value,
    });
  }

  add_do_reference(value: unknown): void {
    this.requirePending('add_do_reference').doReferences.push(object(value, 'add_do_reference'));
  }

  add_undo_reference(value: unknown): void {
    this.requirePending('add_undo_reference').undoReferences.push(object(value, 'add_undo_reference'));
  }

  start_force_keep_in_merge_ends(): void { this.forceKeepMergeEnds += 1; }
  end_force_keep_in_merge_ends(): void {
    if (this.forceKeepMergeEnds === 0) throw new Error('UndoRedo.end_force_keep_in_merge_ends has no matching start.');
    this.forceKeepMergeEnds -= 1;
  }

  get_history_count(): number { return this.history.length; }
  get_current_action(): number { return this.cursor - 1; }

  get_action_name(idValue: unknown): string {
    if (!Number.isInteger(idValue)) throw new TypeError('UndoRedo.get_action_name id requires int32.');
    return this.history[idValue as number]?.name ?? '';
  }

  clear_history(increaseVersionValue = true): void {
    const increase = boolean(increaseVersionValue, 'clear_history increase_version');
    this.history = [];
    this.cursor = 0;
    this.pending = null;
    if (increase) this.version += 1;
  }

  get_current_action_name(): string { return this.cursor === 0 ? '' : this.history[this.cursor - 1]?.name ?? ''; }
  has_undo(): boolean { return this.cursor > 0; }
  has_redo(): boolean { return this.cursor < this.history.length; }
  get_version(): number { return this.version; }

  set_max_steps(value: unknown): void {
    if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 0x7fff_ffff) {
      throw new RangeError('UndoRedo.set_max_steps requires a non-negative int32.');
    }
    this.maxSteps = value as number;
    this.trimHistory();
  }
  get_max_steps(): number { return this.maxSteps; }

  redo(): boolean {
    if (!this.has_redo()) return false;
    const action = this.history[this.cursor];
    if (action === undefined) return false;
    this.execute(action.doOperations, false);
    this.cursor += 1;
    this.version += 1;
    return true;
  }

  undo(): boolean {
    if (!this.has_undo()) return false;
    const action = this.history[this.cursor - 1];
    if (action === undefined) return false;
    this.execute(action.undoOperations, action.backwardUndoOps);
    this.cursor -= 1;
    this.version += 1;
    return true;
  }

  private requirePending(member: string): PendingAction {
    if (this.pending === null) throw new Error(`UndoRedo.${member} requires create_action first.`);
    return this.pending;
  }

  private execute(operations: readonly UndoOperation[], reverse: boolean): void {
    if (this.committing) throw new Error('UndoRedo cannot recursively execute an action.');
    this.committing = true;
    try {
      const ordered = reverse ? [...operations].reverse() : operations;
      for (const operation of ordered) {
        if (operation.kind === 'call') operation.callable.call();
        else godotObjectSet(operation.object, operation.property, operation.value);
      }
    } finally {
      this.committing = false;
    }
  }

  private merge(previous: HistoryAction, pending: PendingAction): void {
    if (pending.mergeMode === GODOT_UNDO_REDO_MERGE_ALL) {
      previous.doOperations.push(...pending.doOperations);
      previous.undoOperations.unshift(...pending.undoOperations);
      previous.doReferences.push(...pending.doReferences);
      previous.undoReferences.push(...pending.undoReferences);
    } else {
      previous.doOperations = [...pending.doOperations];
      previous.doReferences = this.forceKeepMergeEnds > 0
        ? [...previous.doReferences, ...pending.doReferences]
        : [...pending.doReferences];
      if (this.forceKeepMergeEnds > 0) {
        previous.undoOperations.push(...pending.undoOperations);
        previous.undoReferences.push(...pending.undoReferences);
      }
    }
    this.cursor = this.history.length;
  }

  private trimHistory(): void {
    if (this.maxSteps === 0 || this.history.length <= this.maxSteps) return;
    const remove = this.history.length - this.maxSteps;
    this.history.splice(0, remove);
    this.cursor = Math.max(0, this.cursor - remove);
  }
}

export function createGodotUndoRedo(): GodotUndoRedo { return new GodotUndoRedo(); }
