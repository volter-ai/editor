import { godotMethodCallable } from './callable';
import { createSignal, type GodotSignal } from './signal';
import { GodotUndoRedo } from './undo-redo';

export const GODOT_EDITOR_GLOBAL_HISTORY = 0;
export const GODOT_EDITOR_REMOTE_HISTORY = -9;
export const GODOT_EDITOR_INVALID_HISTORY = -99;

interface GodotEditorHistoryRecord {
  undoRedo: GodotUndoRedo;
  savedVersion: number;
  markedUnsaved: boolean;
}

export class GodotEditorUndoRedoManager {
  private readonly histories = new Map<number, GodotEditorHistoryRecord>();
  private readonly objectHistories = new WeakMap<object, number>();
  private readonly historyChangedSignal = createSignal<readonly []>();
  private readonly versionChangedSignal = createSignal<readonly []>();
  private nextHistoryId = 1;
  private fixedHistory = GODOT_EDITOR_INVALID_HISTORY;
  private currentHistory = GODOT_EDITOR_GLOBAL_HISTORY;
  private currentMarkUnsaved = true;

  readonly history_changed: GodotSignal<readonly []> = this.historyChangedSignal.signal;
  readonly version_changed: GodotSignal<readonly []> = this.versionChangedSignal.signal;

  constructor() {
    this.histories.set(GODOT_EDITOR_GLOBAL_HISTORY, this.createRecord());
    this.histories.set(GODOT_EDITOR_REMOTE_HISTORY, this.createRecord());
  }

  create_action(
    name: string,
    mergeMode = 0,
    customContext: object | null = null,
    backwardUndoOps = false,
    markUnsaved = true,
  ): void {
    this.currentHistory = this.fixedHistory !== GODOT_EDITOR_INVALID_HISTORY
      ? this.fixedHistory
      : customContext === null ? GODOT_EDITOR_GLOBAL_HISTORY : this.get_object_history_id(customContext);
    this.currentMarkUnsaved = markUnsaved;
    this.requireHistory(this.currentHistory).undoRedo.create_action(name, mergeMode, backwardUndoOps);
  }

  commit_action(execute = true): void {
    const record = this.requireHistory(this.currentHistory);
    const previousVersion = record.undoRedo.get_version();
    record.undoRedo.commit_action(execute);
    if (this.currentMarkUnsaved && record.undoRedo.get_version() !== previousVersion) record.markedUnsaved = true;
    this.historyChangedSignal.emit();
    if (record.undoRedo.get_version() !== previousVersion) this.versionChangedSignal.emit();
  }

  is_committing_action(): boolean {
    return this.requireHistory(this.currentHistory).undoRedo.is_committing_action();
  }

  force_fixed_history(): void { this.fixedHistory = this.currentHistory; }
  release_fixed_history(): void { this.fixedHistory = GODOT_EDITOR_INVALID_HISTORY; }

  add_do_method(object: object, method: string, ...args: readonly unknown[]): void {
    this.requireHistory(this.currentHistory).undoRedo.add_do_method(godotMethodCallable(object, method).bindv(args));
  }

  add_undo_method(object: object, method: string, ...args: readonly unknown[]): void {
    this.requireHistory(this.currentHistory).undoRedo.add_undo_method(godotMethodCallable(object, method).bindv(args));
  }

  add_do_property(object: object, property: string, value: unknown): void {
    this.requireHistory(this.currentHistory).undoRedo.add_do_property(object, property, value);
  }

  add_undo_property(object: object, property: string, value: unknown): void {
    this.requireHistory(this.currentHistory).undoRedo.add_undo_property(object, property, value);
  }

  add_do_reference(object: object): void {
    this.requireHistory(this.currentHistory).undoRedo.add_do_reference(object);
  }

  add_undo_reference(object: object): void {
    this.requireHistory(this.currentHistory).undoRedo.add_undo_reference(object);
  }

  get_object_history_id(object: object): number {
    const existing = this.objectHistories.get(object);
    if (existing !== undefined) return existing;
    const id = this.nextHistoryId++;
    this.objectHistories.set(object, id);
    this.histories.set(id, this.createRecord());
    return id;
  }

  get_history_undo_redo(id: number): GodotUndoRedo | null {
    return this.histories.get(id)?.undoRedo ?? null;
  }

  clear_history(id = GODOT_EDITOR_GLOBAL_HISTORY, increaseVersion = true): void {
    const record = this.histories.get(id);
    if (record === undefined) return;
    record.undoRedo.clear_history(increaseVersion);
    record.savedVersion = record.undoRedo.get_version();
    record.markedUnsaved = false;
    this.historyChangedSignal.emit();
    if (increaseVersion) this.versionChangedSignal.emit();
  }

  undo(id = GODOT_EDITOR_GLOBAL_HISTORY): boolean {
    const record = this.histories.get(id);
    if (record === undefined) return false;
    const changed = record.undoRedo.undo();
    if (changed) { this.historyChangedSignal.emit(); this.versionChangedSignal.emit(); }
    return changed;
  }

  redo(id = GODOT_EDITOR_GLOBAL_HISTORY): boolean {
    const record = this.histories.get(id);
    if (record === undefined) return false;
    const changed = record.undoRedo.redo();
    if (changed) { this.historyChangedSignal.emit(); this.versionChangedSignal.emit(); }
    return changed;
  }

  mark_history_as_saved(id = GODOT_EDITOR_GLOBAL_HISTORY): void {
    const record = this.requireHistory(id);
    record.savedVersion = record.undoRedo.get_version();
    record.markedUnsaved = false;
    this.versionChangedSignal.emit();
  }

  is_history_unsaved(id = GODOT_EDITOR_GLOBAL_HISTORY): boolean {
    const record = this.histories.get(id);
    return record !== undefined && (record.markedUnsaved || record.undoRedo.get_version() !== record.savedVersion);
  }

  get_history_ids(): readonly number[] { return [...this.histories.keys()].sort((left, right) => left - right); }

  private createRecord(): GodotEditorHistoryRecord {
    const undoRedo = new GodotUndoRedo();
    return { undoRedo, savedVersion: undoRedo.get_version(), markedUnsaved: false };
  }

  private requireHistory(id: number): GodotEditorHistoryRecord {
    let record = this.histories.get(id);
    if (record === undefined) { record = this.createRecord(); this.histories.set(id, record); }
    return record;
  }
}

export const GodotEditorUndoRedoManagerSingleton = new GodotEditorUndoRedoManager();
export function createGodotEditorUndoRedoManager(): GodotEditorUndoRedoManager { return new GodotEditorUndoRedoManager(); }
