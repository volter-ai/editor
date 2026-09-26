/** Canvas-surface WorldEnvironment node identity and retained Environment resource. */

import { registerGodotObjectIdentity } from './object';

export interface GodotCanvasWorldEnvironment<T extends object = object> {
  environment: unknown | null;
  get_environment(): unknown | null;
  set_environment(environment: unknown | null): void;
}

interface WorldEnvironmentState {
  environment: unknown | null;
}

const STATES = new WeakMap<object, WorldEnvironmentState>();

/**
 * Bind WorldEnvironment to the canvas scene node that owns its SceneTree position.
 * Environment remains the authored Resource identity; the canvas renderer consumes the same
 * project-level environment declaration for its clear/background plane rather than inventing a
 * second node or replacing this source-owned receiver.
 */
export function bindCanvasWorldEnvironment<T extends object>(
  node: T,
  environment: unknown | null = null,
): T & GodotCanvasWorldEnvironment<T> {
  const state = STATES.get(node) ?? { environment };
  state.environment = environment;
  STATES.set(node, state);
  Object.defineProperties(node, {
    environment: {
      configurable: true,
      enumerable: true,
      get: () => state.environment,
      set: (value: unknown | null) => { state.environment = value; },
    },
  });
  Object.assign(node, {
    get_environment: (): unknown | null => state.environment,
    set_environment: (value: unknown | null): void => { state.environment = value; },
  });
  registerGodotObjectIdentity(node, 'WorldEnvironment');
  return node as T & GodotCanvasWorldEnvironment<T>;
}
