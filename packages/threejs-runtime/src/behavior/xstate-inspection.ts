import type * as THREE from 'three';
import type { AnyStateMachine } from 'xstate';
import { deleteUserData, getUserData, setUserData } from '../ecs/user-data';

/** Minimal structural actor surface needed by the live behavior debugger. */
export interface InspectableXStateActor {
  readonly getSnapshot: () => {
    readonly value: unknown;
    readonly context: unknown;
    readonly machine?: AnyStateMachine;
  };
  readonly subscribe: (next: (snapshot: { readonly value: unknown }) => void) => {
    unsubscribe: () => void;
  };
  readonly logic?: AnyStateMachine;
}

export interface XStateBehaviorInspection {
  readonly actor: InspectableXStateActor;
  readonly machine: AnyStateMachine;
}

let version = 0;
const listeners = new Set<() => void>();

function notify(): void {
  version++;
  for (const listener of listeners) listener();
}

export function subscribeXStateBehaviorInspections(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function xstateBehaviorInspectionsVersion(): number {
  return version;
}

export function attachXStateBehaviorInspection(
  owner: THREE.Object3D,
  inspection: XStateBehaviorInspection,
): () => void {
  setUserData(owner, '_xstateBehavior', inspection);
  notify();
  return () => {
    if (getUserData(owner, '_xstateBehavior') !== inspection) return;
    deleteUserData(owner, '_xstateBehavior');
    notify();
  };
}
