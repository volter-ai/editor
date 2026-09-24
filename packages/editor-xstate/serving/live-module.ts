/**
 * The module the stamp imports into a project's machine modules (`xstate-plugin.ts`), served
 * as source into the GAME's own module graph. It holds no XState import: it wraps the machine
 * object the game's own `xstate` built, so the game keeps exactly the library it installed.
 *
 * `getInitialSnapshot` runs once per actor that starts from the machine, and `transition` once
 * per event that actor takes, whoever created it (`createActor`, `useMachine`, `spawn`), so the
 * wrapper sees every running actor without the game naming one. `provide()` makes a new machine;
 * it is wrapped under the same key. The registry lives on `globalThis` under a `Symbol.for` key,
 * the one place the editor's bundle and the game's graph both reach (`src/live-actors.ts`).
 */

export const LIVE_MODULE_ID = 'virtual:vgai-xstate-live';

export const LIVE_REGISTRY_KEY = 'volter.xstate.live';

export const liveModuleSource = `
const live = (globalThis[Symbol.for(${JSON.stringify(LIVE_REGISTRY_KEY)})] ??= {
  actors: new Map(),
  listeners: new Set(),
  version: 0,
});
const EVENT_LOG = 200;
function notify() {
  live.version++;
  for (const listener of live.listeners) {
    try { listener(); } catch (error) { console.error(error); }
  }
}
function forget(self) {
  if (live.actors.delete(self)) notify();
}
function track(self, key) {
  if (!self || live.actors.has(self)) return;
  live.actors.set(self, { key, ref: self, events: [], startedAt: Date.now() });
  notify();
  // The actor is still being constructed here; observe it once it exists.
  queueMicrotask(() => {
    try {
      self.subscribe({ complete: () => forget(self), error: () => forget(self) });
    } catch {
      // An actor that cannot be observed is still listed; its status says when it stopped.
    }
  });
}
export function __vgaiMachine(machine, key) {
  if (!machine || typeof machine !== 'object' || typeof machine.transition !== 'function') return machine;
  if (machine.__vgaiMachineKey) return machine;
  Object.defineProperty(machine, '__vgaiMachineKey', { value: key });
  const getInitialSnapshot = machine.getInitialSnapshot;
  machine.getInitialSnapshot = function (scope, input) {
    const snapshot = getInitialSnapshot.call(this, scope, input);
    track(scope && scope.self, key);
    return snapshot;
  };
  const transition = machine.transition;
  machine.transition = function (snapshot, event, scope) {
    const next = transition.call(this, snapshot, event, scope);
    const entry = scope && scope.self ? live.actors.get(scope.self) : undefined;
    if (entry) {
      entry.events.push({ type: event && event.type, at: Date.now(), from: snapshot && snapshot.value, to: next && next.value });
      if (entry.events.length > EVENT_LOG) entry.events.shift();
      notify();
    }
    return next;
  };
  const provide = machine.provide;
  if (typeof provide === 'function') {
    machine.provide = function (implementations) {
      return __vgaiMachine(provide.call(this, implementations), key);
    };
  }
  return machine;
}
`;
