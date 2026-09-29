/**
 * @godot-class WorkerThreadPool
 * @role BINDING
 *
 * Godot 4.7's `WorkerThreadPool` (`core/object/worker_thread_pool.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) on the page's one thread: a task runs once the current
 * work is done (a microtask), or at once when something waits for it first; its id is Godot's, one
 * more than the last. A task's error aborts only that task.
 */

const PENDING = new Map<number, () => void>();
let lastId = 0;

function run(id: number): void {
  const task = PENDING.get(id);
  if (task === undefined) return;
  PENDING.delete(id);
  try {
    task();
  } catch (error) {
    console.error(error);
  }
}

/**
 * @godot WorkerThreadPool.add_task
 * @source core/object/worker_thread_pool.cpp:387
 */
export function add_task(action: () => void, high_priority = false, description = ''): number {
  void high_priority;
  void description;
  lastId += 1;
  const id = lastId;
  PENDING.set(id, action);
  queueMicrotask(() => run(id));
  return id;
}

/**
 * @godot WorkerThreadPool.is_task_completed
 * @source core/object/worker_thread_pool.cpp:391
 */
export function is_task_completed(task_id: number): boolean {
  return task_id > 0 && task_id <= lastId && !PENDING.has(task_id);
}

/**
 * Runs the task now if it has not run; an id never issued is `ERR_INVALID_PARAMETER`.
 *
 * @godot WorkerThreadPool.wait_for_task_completion
 * @source core/object/worker_thread_pool.cpp:401
 */
export function wait_for_task_completion(task_id: number): number {
  if (task_id <= 0 || task_id > lastId) return 31;
  run(task_id);
  return 0;
}
