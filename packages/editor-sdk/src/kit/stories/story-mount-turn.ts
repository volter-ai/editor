/**
 * THE ONE process-wide story-mount turn queue, shared by every medium.
 *
 * Extracted verbatim from `story-three-preview.ts`'s own `storyMountTurn`
 * (which owned it alone until the canvas surface got a preview mount too) for
 * the reason that module already states: portable-story LOADERS are allowed to
 * touch process-global state, so two mounts running at once interleave their
 * setup and collide. That reason is not three-specific — a canvas story's
 * loader initializes Pixi's global `Assets` cache and its component catalogue —
 * and two queues would not serialize a three mount against a canvas mount at
 * all, which is exactly the pair that now runs over the same project.
 *
 * Every caller takes a turn either for ONE mount or for a compound operation
 * (a whole board build). A rejected turn never poisons its successor.
 */

let storyMountTurn: Promise<unknown> = Promise.resolve();

/** Run one story-mount operation with no other mount interleaving it. */
export function runInStoryMountTurn<T>(task: () => Promise<T>): Promise<T> {
  const turn = storyMountTurn.then(task, task);
  storyMountTurn = turn.then(
    () => undefined,
    () => undefined,
  );
  return turn;
}
