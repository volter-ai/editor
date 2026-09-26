/** Deterministic browser implementation of Godot's WorkerThreadPool singleton. */

import { GodotCallable } from './callable';

interface TaskRecord {
  readonly id: number;
  readonly action: GodotCallable;
  readonly highPriority: boolean;
  readonly description: string;
  completed: boolean;
  error: unknown;
}

interface GroupTaskRecord {
  readonly id: number;
  readonly action: GodotCallable;
  readonly elements: number;
  readonly tasksNeeded: number;
  readonly highPriority: boolean;
  readonly description: string;
  processed: number;
  completed: boolean;
  error: unknown;
}

function callable(value: unknown, member: string): GodotCallable {
  if (!(value instanceof GodotCallable) || !value.isValid()) {
    throw new TypeError(`WorkerThreadPool.${member} requires a valid Callable.`);
  }
  return value;
}

function flag(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`WorkerThreadPool.${member} high_priority requires bool.`);
  return value;
}

function description(value: unknown, member: string): string {
  if (typeof value !== 'string') throw new TypeError(`WorkerThreadPool.${member} description requires String.`);
  return value;
}

function taskId(value: unknown, member: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new RangeError(`WorkerThreadPool.${member} requires a positive task ID.`);
  }
  return value as number;
}

function elementCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 0x7fff_ffff) {
    throw new RangeError('WorkerThreadPool.add_group_task elements requires a non-negative int32.');
  }
  return value as number;
}

function workerCount(value: unknown, elements: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < -1 || (value as number) > 0x7fff_ffff) {
    throw new RangeError('WorkerThreadPool.add_group_task tasks_needed requires -1 or a non-negative int32.');
  }
  return value === -1 ? Math.max(1, Math.min(elements, globalThis.navigator?.hardwareConcurrency ?? 1)) : value as number;
}

class GodotWorkerThreadPoolRuntime {
  private nextTaskId = 1;
  private nextGroupId = 1;
  private callerTaskId = -1;
  private callerGroupId = -1;
  private readonly tasks = new Map<number, TaskRecord>();
  private readonly groups = new Map<number, GroupTaskRecord>();

  add_task(actionValue: unknown, highPriorityValue = false, descriptionValue = ''): number {
    const record: TaskRecord = {
      id: this.nextTaskId++,
      action: callable(actionValue, 'add_task'),
      highPriority: flag(highPriorityValue, 'add_task'),
      description: description(descriptionValue, 'add_task'),
      completed: false,
      error: undefined,
    };
    this.tasks.set(record.id, record);
    const previousTask = this.callerTaskId;
    const previousGroup = this.callerGroupId;
    this.callerTaskId = record.id;
    this.callerGroupId = -1;
    try {
      record.action.call();
    } catch (error) {
      record.error = error;
    } finally {
      record.completed = true;
      this.callerTaskId = previousTask;
      this.callerGroupId = previousGroup;
    }
    return record.id;
  }

  is_task_completed(taskIdValue: unknown): boolean {
    const record = this.requireTask(taskIdValue, 'is_task_completed');
    return record.completed;
  }

  wait_for_task_completion(taskIdValue: unknown): number {
    const record = this.requireTask(taskIdValue, 'wait_for_task_completion');
    if (!record.completed) {
      throw new Error('WorkerThreadPool.wait_for_task_completion cannot block the browser main thread.');
    }
    this.tasks.delete(record.id);
    if (record.error !== undefined) throw record.error;
    return 0;
  }

  get_caller_task_id(): number { return this.callerTaskId; }

  add_group_task(
    actionValue: unknown,
    elementsValue: unknown,
    tasksNeededValue = -1,
    highPriorityValue = false,
    descriptionValue = '',
  ): number {
    const elements = elementCount(elementsValue);
    const record: GroupTaskRecord = {
      id: this.nextGroupId++,
      action: callable(actionValue, 'add_group_task'),
      elements,
      tasksNeeded: workerCount(tasksNeededValue, elements),
      highPriority: flag(highPriorityValue, 'add_group_task'),
      description: description(descriptionValue, 'add_group_task'),
      processed: 0,
      completed: false,
      error: undefined,
    };
    this.groups.set(record.id, record);
    const previousTask = this.callerTaskId;
    const previousGroup = this.callerGroupId;
    this.callerTaskId = -1;
    this.callerGroupId = record.id;
    try {
      for (let index = 0; index < record.elements; index += 1) {
        record.action.call(index);
        record.processed = index + 1;
      }
    } catch (error) {
      record.error = error;
    } finally {
      record.completed = true;
      this.callerTaskId = previousTask;
      this.callerGroupId = previousGroup;
    }
    return record.id;
  }

  is_group_task_completed(groupIdValue: unknown): boolean {
    return this.requireGroup(groupIdValue, 'is_group_task_completed').completed;
  }

  get_group_processed_element_count(groupIdValue: unknown): number {
    return this.requireGroup(groupIdValue, 'get_group_processed_element_count').processed;
  }

  wait_for_group_task_completion(groupIdValue: unknown): void {
    const record = this.requireGroup(groupIdValue, 'wait_for_group_task_completion');
    if (!record.completed) {
      throw new Error('WorkerThreadPool.wait_for_group_task_completion cannot block the browser main thread.');
    }
    this.groups.delete(record.id);
    if (record.error !== undefined) throw record.error;
  }

  get_caller_group_id(): number { return this.callerGroupId; }

  private requireTask(value: unknown, member: string): TaskRecord {
    const id = taskId(value, member);
    const record = this.tasks.get(id);
    if (record === undefined) throw new Error(`WorkerThreadPool.${member} received unknown task ID ${id}.`);
    return record;
  }

  private requireGroup(value: unknown, member: string): GroupTaskRecord {
    const id = taskId(value, member);
    const record = this.groups.get(id);
    if (record === undefined) throw new Error(`WorkerThreadPool.${member} received unknown group ID ${id}.`);
    return record;
  }
}

export const GodotWorkerThreadPool = new GodotWorkerThreadPoolRuntime();
