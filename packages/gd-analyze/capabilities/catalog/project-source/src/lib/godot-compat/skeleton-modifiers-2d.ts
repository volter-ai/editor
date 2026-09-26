/** SkeletonModification2D protocol and ordered stack execution over the retained Skeleton2D. */

import { registerGodotObjectIdentity } from './object';
import { createSignal, type GodotSignal } from './signal';
import type { GodotSkeleton2D } from './skeleton-2d';

export const GODOT_SKELETON_MODIFICATION_MODE_PROCESS = 0;
export const GODOT_SKELETON_MODIFICATION_MODE_PHYSICS_PROCESS = 1;

export interface GodotSkeletonModification2DHooks {
  readonly setupModification?: (modification: GodotSkeletonModification2D, stack: GodotSkeletonModificationStack2D) => void;
  readonly execute?: (modification: GodotSkeletonModification2D, delta: number, strength: number) => void;
  readonly drawEditorGizmo?: (modification: GodotSkeletonModification2D) => void;
}

function executionMode(value: number, member: string): number {
  if (value !== GODOT_SKELETON_MODIFICATION_MODE_PROCESS && value !== GODOT_SKELETON_MODIFICATION_MODE_PHYSICS_PROCESS) {
    throw new RangeError(`${member} requires process or physics-process execution mode.`);
  }
  return value;
}

function unit(value: number, member: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError(`${member} requires a finite value in [0, 1].`);
  return value;
}

function nonNegativeDelta(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError('SkeletonModificationStack2D delta requires a non-negative finite number.');
  return value;
}

export class GodotSkeletonModification2D {
  private enabledValue = true;
  private executionModeValue = GODOT_SKELETON_MODIFICATION_MODE_PROCESS;
  private stackValue: GodotSkeletonModificationStack2D | null = null;
  private setupValue = false;

  constructor(
    private readonly hooks: GodotSkeletonModification2DHooks = {},
    className = 'SkeletonModification2D',
  ) {
    registerGodotObjectIdentity(this, className);
  }

  set_enabled(value: boolean): void {
    if (typeof value !== 'boolean') throw new TypeError('SkeletonModification2D.enabled requires bool.');
    this.enabledValue = value;
  }

  get_enabled(): boolean { return this.enabledValue; }

  set_execution_mode(value: number): void {
    this.executionModeValue = executionMode(value, 'SkeletonModification2D.execution_mode');
  }

  get_execution_mode(): number { return this.executionModeValue; }

  get_modification_stack(): GodotSkeletonModificationStack2D | null { return this.stackValue; }
  get_is_setup(): boolean { return this.setupValue; }

  _setup_modification(stack: GodotSkeletonModificationStack2D): void {
    if (!(stack instanceof GodotSkeletonModificationStack2D)) {
      throw new TypeError('SkeletonModification2D._setup_modification requires SkeletonModificationStack2D.');
    }
    this.stackValue = stack;
    this.setupValue = true;
    this.hooks.setupModification?.(this, stack);
  }

  _execute(delta: number, strength: number): void {
    if (!this.setupValue || !this.enabledValue) return;
    this.hooks.execute?.(this, nonNegativeDelta(delta), unit(strength, 'SkeletonModification2D strength'));
  }

  _draw_editor_gizmo(): void {
    if (!this.setupValue || !this.enabledValue) return;
    this.hooks.drawEditorGizmo?.(this);
  }

  detach_from_stack(stack: GodotSkeletonModificationStack2D): void {
    if (this.stackValue !== stack) return;
    this.stackValue = null;
    this.setupValue = false;
  }
}

export class GodotSkeletonModificationStack2D {
  private readonly executionStartedHandle = createSignal<readonly [number, number]>();
  private readonly executionFinishedHandle = createSignal<readonly [number, number]>();
  readonly execution_started: GodotSignal<readonly [number, number]> = this.executionStartedHandle.signal;
  readonly execution_finished: GodotSignal<readonly [number, number]> = this.executionFinishedHandle.signal;

  private skeletonValue: GodotSkeleton2D | null = null;
  private setupValue = false;
  private enabledValue = true;
  private strengthValue = 1;
  private readonly modifications: Array<GodotSkeletonModification2D | null> = [];
  private executing = false;
  private executionRevision = 0;

  constructor() {
    registerGodotObjectIdentity(this, 'SkeletonModificationStack2D');
  }

  setup(skeleton: GodotSkeleton2D): void {
    if (skeleton === null || typeof skeleton !== 'object') throw new TypeError('SkeletonModificationStack2D.setup requires Skeleton2D.');
    this.skeletonValue = skeleton;
    this.setupValue = true;
    for (const modification of this.modifications) modification?._setup_modification(this);
  }

  get_skeleton(): GodotSkeleton2D | null { return this.skeletonValue; }
  get_is_setup(): boolean { return this.setupValue; }

  set_enabled(value: boolean): void {
    if (typeof value !== 'boolean') throw new TypeError('SkeletonModificationStack2D.enabled requires bool.');
    this.enabledValue = value;
  }

  get_enabled(): boolean { return this.enabledValue; }

  set_strength(value: number): void {
    this.strengthValue = unit(value, 'SkeletonModificationStack2D.strength');
  }

  get_strength(): number { return this.strengthValue; }

  set_modification_count(count: number): void {
    if (this.executing) throw new Error('SkeletonModificationStack2D cannot resize while executing.');
    if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('SkeletonModificationStack2D modification count requires non-negative integer.');
    while (this.modifications.length > count) this.modifications.pop()?.detach_from_stack(this);
    while (this.modifications.length < count) this.modifications.push(null);
  }

  get_modification_count(): number { return this.modifications.length; }

  set_modification(index: number, modification: GodotSkeletonModification2D | null): void {
    const slot = this.requireIndex(index, 'set_modification');
    if (modification !== null && !(modification instanceof GodotSkeletonModification2D)) {
      throw new TypeError('SkeletonModificationStack2D.set_modification requires SkeletonModification2D.');
    }
    const previous = this.modifications[slot] ?? null;
    if (previous === modification) return;
    previous?.detach_from_stack(this);
    this.modifications[slot] = modification;
    if (this.setupValue) modification?._setup_modification(this);
  }

  get_modification(index: number): GodotSkeletonModification2D | null {
    return this.modifications[this.requireIndex(index, 'get_modification')] ?? null;
  }

  add_modification(modification: GodotSkeletonModification2D): number {
    if (!(modification instanceof GodotSkeletonModification2D)) {
      throw new TypeError('SkeletonModificationStack2D.add_modification requires SkeletonModification2D.');
    }
    this.modifications.push(modification);
    if (this.setupValue) modification._setup_modification(this);
    return this.modifications.length - 1;
  }

  remove_modification(index: number): GodotSkeletonModification2D | null {
    if (this.executing) throw new Error('SkeletonModificationStack2D cannot remove a modification while executing.');
    const slot = this.requireIndex(index, 'remove_modification');
    const removed = this.modifications.splice(slot, 1)[0] ?? null;
    removed?.detach_from_stack(this);
    return removed;
  }

  execute(delta: number, mode = GODOT_SKELETON_MODIFICATION_MODE_PROCESS): void {
    const frameDelta = nonNegativeDelta(delta);
    const execution = executionMode(mode, 'SkeletonModificationStack2D.execute mode');
    if (!this.setupValue || !this.enabledValue || this.strengthValue <= 0) return;
    if (this.executing) throw new Error('SkeletonModificationStack2D recursive execution is not allowed.');
    this.executing = true;
    this.executionRevision++;
    this.executionStartedHandle.emit(execution, this.executionRevision);
    try {
      for (const modification of this.modifications) {
        if (modification !== null && modification.get_execution_mode() === execution) {
          modification._execute(frameDelta, this.strengthValue);
        }
      }
    } finally {
      this.executing = false;
      this.executionFinishedHandle.emit(execution, this.executionRevision);
    }
  }

  execute_process(delta: number): void { this.execute(delta, GODOT_SKELETON_MODIFICATION_MODE_PROCESS); }
  execute_physics_process(delta: number): void { this.execute(delta, GODOT_SKELETON_MODIFICATION_MODE_PHYSICS_PROCESS); }
  get_execution_revision(): number { return this.executionRevision; }

  clear(): void {
    if (this.executing) throw new Error('SkeletonModificationStack2D cannot clear while executing.');
    for (const modification of this.modifications) modification?.detach_from_stack(this);
    this.modifications.length = 0;
  }

  private requireIndex(index: number, member: string): number {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.modifications.length) {
      throw new RangeError(`SkeletonModificationStack2D.${member} index is out of range.`);
    }
    return index;
  }
}

export function createGodotSkeletonModification2D(
  hooks: GodotSkeletonModification2DHooks = {},
): GodotSkeletonModification2D {
  return new GodotSkeletonModification2D(hooks);
}

export function createGodotSkeletonModificationStack2D(): GodotSkeletonModificationStack2D {
  return new GodotSkeletonModificationStack2D();
}
