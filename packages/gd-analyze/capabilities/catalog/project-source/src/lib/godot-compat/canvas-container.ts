/** Godot Container sort lifecycle over the retained Pixi Control/layout owner. */

import { Container } from 'pixi.js';

import { reflowCanvasContainer, setCanvasContainerSortLifecycle } from './canvas-control-state';
import { optionalControlBinding } from './control-state';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';
import { bindControlThemeConsumer } from './theme';

interface ContainerSortState {
  readonly preSortChildren: SignalHandle<readonly []>;
  readonly sortChildren: SignalHandle<readonly []>;
  queued: boolean;
  releaseTheme(): void;
}

const CONTAINER_SORT_STATE = new WeakMap<Container, ContainerSortState>();

export interface GodotCanvasContainerApi {
  queue_sort(): void;
  get_pre_sort_children_signal(): GodotSignal<readonly []>;
  get_sort_children_signal(): GodotSignal<readonly []>;
}

function retainedContainer(value: unknown, member: string): Container {
  if (!(value instanceof Container) || optionalControlBinding(value) === undefined) {
    throw new TypeError(`Container.${member} requires the retained Pixi Control/layout owner.`);
  }
  return value;
}

function stateOf(value: unknown, member: string): ContainerSortState {
  const node = retainedContainer(value, member);
  const existing = CONTAINER_SORT_STATE.get(node);
  if (existing !== undefined) return existing;
  const state: ContainerSortState = {
    preSortChildren: createSignal<readonly []>(),
    sortChildren: createSignal<readonly []>(),
    queued: false,
    releaseTheme: () => {},
  };
  CONTAINER_SORT_STATE.set(node, state);
  state.releaseTheme = bindControlThemeConsumer(node, () => reflowCanvasContainer(node));
  setCanvasContainerSortLifecycle(
    node,
    () => state.preSortChildren.emit(),
    () => state.sortChildren.emit(),
  );
  return state;
}

export function releaseGodotCanvasContainerApi(value: unknown): void {
  if (!(value instanceof Container)) return;
  const state = CONTAINER_SORT_STATE.get(value);
  if (state === undefined) return;
  state.releaseTheme();
  CONTAINER_SORT_STATE.delete(value);
}

/**
 * Container.queue_sort coalesces invalidations until the SceneTree's end-of-frame queue. The
 * actual retained layout pass runs between Godot's two public signals, matching Container's
 * `_sort_children` ordering rather than turning queue_sort into an immediate layout mutation.
 */
export function queueGodotCanvasContainerSort(
  value: unknown,
  defer: (sort: () => void) => void,
): void {
  const node = retainedContainer(value, 'queue_sort');
  const state = stateOf(node, 'queue_sort');
  if (state.queued) return;
  state.queued = true;
  defer(() => {
    state.queued = false;
    reflowCanvasContainer(node);
  });
}

export function getGodotCanvasContainerPreSortChildrenSignal(
  value: unknown,
): GodotSignal<readonly []> {
  return stateOf(value, 'pre_sort_children').preSortChildren.signal;
}

export function getGodotCanvasContainerSortChildrenSignal(
  value: unknown,
): GodotSignal<readonly []> {
  return stateOf(value, 'sort_children').sortChildren.signal;
}

/** Seat Container's source-visible sort vocabulary directly on its retained Pixi layout owner. */
export function bindGodotCanvasContainerApi<T extends Container>(
  node: T,
  defer: (sort: () => void) => void = (sort) => queueMicrotask(sort),
): T & GodotCanvasContainerApi {
  stateOf(node, 'bind');
  const container = node as T & GodotCanvasContainerApi;
  Object.defineProperties(container, {
    queue_sort: {
      configurable: true,
      enumerable: false,
      writable: true,
      value: (): void => queueGodotCanvasContainerSort(container, defer),
    },
    get_pre_sort_children_signal: {
      configurable: true,
      enumerable: false,
      writable: true,
      value: (): GodotSignal<readonly []> =>
        getGodotCanvasContainerPreSortChildrenSignal(container),
    },
    get_sort_children_signal: {
      configurable: true,
      enumerable: false,
      writable: true,
      value: (): GodotSignal<readonly []> =>
        getGodotCanvasContainerSortChildrenSignal(container),
    },
  });
  return container;
}
