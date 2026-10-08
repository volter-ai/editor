/**
 * THE RUNNING GAME'S ANIMATION, for the animation editors. A game poses its copy of the model
 * (`../contributions/blender-play-skin.ts`); while it runs, the Action Editor and the NLA editor
 * show what it is playing, read-only, the way a game engine's animator view highlights the live
 * state. The run sets the slot when its animation starts and clears it when it ends.
 */
import type { PlayAnimation } from '../contributions/blender-play-skin';

let current: PlayAnimation | null = null;
const listeners = new Set<() => void>();

export function setLiveAnimation(animation: PlayAnimation | null): void {
  if (current === animation) return;
  current = animation;
  for (const listener of [...listeners]) listener();
}

/** The running game's animation, or null when no game runs. */
export function liveAnimation(): PlayAnimation | null {
  return current;
}

/** Fires when a game's animation starts or ends (not on each frame: readers poll while it runs). */
export function subscribeLiveAnimation(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
