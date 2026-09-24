import type * as THREE from 'three';
import { deleteUserData, getUserData, setUserData } from '../ecs/user-data';

/**
 * Live native animation playback for editor tools, READ-ONLY. A world states
 * what it is playing; nothing here moves it. Time on an editor stage belongs
 * to the stage transport (`@editor/animation/stage-transport`, WORK.md §The
 * stage transport and the animation door), and the transport writes time by
 * seeking a SUBJECT, never through this inspection door.
 * This is instrumentation, not an animation asset or graph format.
 */
export interface AnimationRuntimeInspection {
  readonly mixer: THREE.AnimationMixer;
  readonly clips: ReadonlyMap<string, THREE.AnimationClip>;
}

let version = 0;
const listeners = new Set<() => void>();

function notify(): void {
  version++;
  for (const listener of listeners) listener();
}

export function subscribeAnimationRuntimeInspections(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function animationRuntimeInspectionsVersion(): number {
  return version;
}

export function attachAnimationRuntimeInspection(
  owner: THREE.Object3D,
  inspection: AnimationRuntimeInspection,
): () => void {
  setUserData(owner, '_animationRuntime', inspection);
  notify();
  return () => {
    if (getUserData(owner, '_animationRuntime') !== inspection) return;
    deleteUserData(owner, '_animationRuntime');
    notify();
  };
}
