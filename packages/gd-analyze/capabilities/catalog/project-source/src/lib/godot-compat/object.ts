/**
 * @godot-class Object
 * @role PROTOCOL
 *
 * Godot 4.7's deferred calls: `Object.call_deferred`, `Object.set_deferred` and the main
 * `MessageQueue` they push to, transcribed from `core/object/object.cpp` and
 * `core/object/message_queue.cpp` at revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`. The queue
 * is module state; SceneTree flushes it where Godot does (`scene-tree.ts`).
 *
 * The receiver is a Godot object as compat represents it (a script instance, or a native entity).
 * A method or property named by string is the receiver's own JS member of that name: a script
 * instance's method or field. A native class's property or method named by string needs its
 * setter or member as a callable, which lowering supplies; it is not dispatched here.
 */

import { godot_node_is_freed, godot_node_is_queued } from './node';

interface Message {
  readonly target: object;
  readonly run: () => void;
}

const queue: Message[] = [];
let flushing = false;

/**
 * Queues `self.method(...args)` for the next flush.
 *
 * @godot Object.call_deferred
 * @source core/object/object.cpp:632
 */
export function call_deferred(self: object, method: string, ...args: readonly unknown[]): void {
  queue.push({
    target: self,
    run: () => {
      const fn = (self as Record<string, unknown>)[method];
      if (typeof fn === 'function') (fn as (...values: unknown[]) => unknown).apply(self, [...args]);
    },
  });
}

/**
 * Queues `self.property = value` for the next flush.
 *
 * @godot Object.set_deferred
 * @source core/object/object.cpp:2002
 */
export function set_deferred(self: object, property: string, value: unknown): void {
  queue.push({
    target: self,
    run: () => {
      (self as Record<string, unknown>)[property] = value;
    },
  });
}

/**
 * `CallQueue::flush` (`core/object/message_queue.cpp:224`): runs messages in order, including those
 * queued while flushing; a message whose target was freed is dropped; a nested flush does nothing.
 *
 * @godot Object (protocol)
 * @source core/object/message_queue.cpp:224
 */
export function godot_message_queue_flush(): void {
  if (flushing) return;
  flushing = true;
  try {
    while (queue.length > 0) {
      const message = queue.shift() as Message;
      if (!godot_node_is_freed(message.target)) message.run();
    }
  } finally {
    flushing = false;
  }
}

/**
 * Set by `queue_free` (`SceneTree::queue_delete`, `scene/main/scene_tree.cpp:1640`).
 *
 * @godot Object.is_queued_for_deletion
 * @source core/object/object.h:813
 */
export function is_queued_for_deletion(self: object): boolean {
  return godot_node_is_queued(self);
}
