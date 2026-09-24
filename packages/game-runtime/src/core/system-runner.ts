import {
  PHASE_ORDER,
  type SystemDef,
  type SystemFn,
  type SystemOptions,
  type SystemPhaseName,
  type SystemRunObserver,
} from './types';

/**
 * Ordered system execution by named phase.
 *
 * Systems are registered with a phase name. When `run(dt)` is called, all
 * phases execute in `PHASE_ORDER` via `runPhase(phase, dt)`. Within a phase,
 * `runPhase` executes two ordered buckets (T7.1 slice 2):
 *
 *   1. **engine** — everything `add()`/`register()`ed at or before the last
 *      `markEngineBoundary()` call, or EVERYTHING if no boundary has ever
 *      been marked.
 *   2. **game** — everything `add()`/`register()`ed AFTER the last
 *      `markEngineBoundary()` call.
 *
 * Within each bucket, systems run in registration order.
 */
export function createSystemRunner(observer?: SystemRunObserver, scope = 'world') {
  const systems = new Map<SystemPhaseName, SystemFn[]>();
  const registered: SystemDef[] = [];
  const labels = new Map<SystemFn, string>();
  let anonymousId = 0;

  // Initialize all phases with empty arrays.
  for (const phase of PHASE_ORDER) {
    systems.set(phase, []);
  }

  // Membership bookkeeping for `markEngineBoundary()` (T7.2 review fix —
  // replaces the old length/index-snapshot bookkeeping, which broke if a
  // pre-boundary "engine" entry was ever removed: shrinking the list would
  // shift a later "game" entry underneath the recorded length, misclassifying
  // it as engine). `engineFns`/`engineRegistered` instead record WHICH
  // specific function/system was present at the last `markEngineBoundary()`
  // call — membership survives arbitrary removal of any other entry,
  // regardless of position. `boundaryMarked` is false until the first mark
  // (mirrors the old `boundary === null`: everything is "engine" pre-mark).
  let boundaryMarked = false;
  const engineFns = new Map<SystemPhaseName, Set<SystemFn>>();
  for (const phase of PHASE_ORDER) engineFns.set(phase, new Set());
  const engineRegistered = new Set<SystemDef>();

  /** Run one system function, isolating a throw so it never wedges the frame. */
  function runOne(fn: SystemFn, phase: SystemPhaseName, dt: number): void {
    const label = labels.get(fn) ?? fn.name ?? `anonymous-${++anonymousId}`;
    labels.set(fn, label);
    observer?.beginSystem(scope, phase, label);
    try {
      fn(dt);
    } catch (err) {
      const label = fn.name ? `"${fn.name}"` : '(anonymous)';
      console.error(`[system-runner] system ${label} in phase "${phase}" threw:`, err);
    } finally {
      observer?.endSystem(scope, phase, label);
    }
  }

  return {
    /**
     * Register a bare system function in a specific phase.
     * Systems within the same phase run in the order they were added.
     */
    add(phase: SystemPhaseName, fn: SystemFn, options?: SystemOptions) {
      const list = systems.get(phase);
      if (!list) {
        throw new Error(`Unknown phase: ${phase}. Valid phases: ${PHASE_ORDER.join(', ')}`);
      }
      list.push(fn);
      labels.set(fn, options?.name ?? fn.name ?? `anonymous-${++anonymousId}`);
    },

    /**
     * Remove a bare system function from a phase. Also drops it from the
     * engine-membership set (if present) — the fix for the length-based
     * bookkeeping bug: removing this has no effect on how any OTHER entry
     * (before or after it) is classified, since classification is now
     * per-function membership, not position.
     */
    remove(phase: SystemPhaseName, fn: SystemFn) {
      const list = systems.get(phase);
      if (!list) return;
      const idx = list.indexOf(fn);
      if (idx !== -1) list.splice(idx, 1);
      engineFns.get(phase)?.delete(fn);
    },

    /**
     * Register a lifecycle system. Adds its update to the correct phase.
     * Call runInit() after all systems are registered to invoke init hooks.
     */
    register(system: SystemDef) {
      const list = systems.get(system.phase);
      if (!list) {
        throw new Error(`Unknown phase: ${system.phase}. Valid phases: ${PHASE_ORDER.join(', ')}`);
      }
      list.push(system.update);
      labels.set(system.update, system.name ?? system.update.name ?? `anonymous-${++anonymousId}`);
      registered.push(system);
    },

    /**
     * Unregister a lifecycle system. Removes its update and calls dispose.
     */
    unregister(system: SystemDef) {
      const list = systems.get(system.phase);
      if (list) {
        const idx = list.indexOf(system.update);
        if (idx !== -1) list.splice(idx, 1);
      }
      engineFns.get(system.phase)?.delete(system.update);
      const regIdx = registered.indexOf(system);
      if (regIdx !== -1) registered.splice(regIdx, 1);
      engineRegistered.delete(system);
      system.dispose?.();
    },

    /**
     * Call init() on all registered lifecycle systems, in phase order.
     * Call once after scene load, before the first game loop tick.
     */
    runInit() {
      const sorted = [...registered].sort(
        (a, b) => PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase),
      );
      for (const sys of sorted) {
        sys.init?.();
      }
    },

    /**
     * Call dispose() on all registered lifecycle systems and remove them.
     */
    runDispose() {
      for (const sys of registered) {
        const list = systems.get(sys.phase);
        if (list) {
          const idx = list.indexOf(sys.update);
          if (idx !== -1) list.splice(idx, 1);
        }
        sys.dispose?.();
      }
      registered.length = 0;
    },

    /**
     * Run ONE phase's two ordered buckets — engine, game
     * (see the module doc comment). Each system call is isolated: a
     * throwing system is loudly logged (never swallowed) but does not stop
     * its siblings in the same bucket, a later bucket in this phase, or a
     * later phase, from running this frame.
     *
     * Public — the Game root's frame executor (`runtime/game.ts`) calls this
     * directly per (phase, world); `run(dt)` below is just a loop over it,
     * preserved for any direct caller.
     */
    runPhase(phase: SystemPhaseName, dt: number) {
      const list = systems.get(phase);
      if (!list) {
        throw new Error(`Unknown phase: ${phase}. Valid phases: ${PHASE_ORDER.join(', ')}`);
      }
      // Partition by MEMBERSHIP, not position: everything in this phase's
      // `engineFns` set (or, if no boundary has ever been marked, everything)
      // runs immediately, in list order, as it's
      // encountered; everything else is queued into `gameFns` (also in list
      // order) and run after them. Because classification is
      // per-function rather than "index < some remembered length", removing
      // ANY entry via `remove()` — including a pre-boundary "engine" one —
      // cannot shift a later game system into the engine bucket.
      const engineSet = engineFns.get(phase)!;
      const gameFns: SystemFn[] = [];
      for (const fn of list) {
        if (boundaryMarked && !engineSet.has(fn)) {
          gameFns.push(fn);
        } else {
          runOne(fn, phase, dt);
        }
      }

      for (const fn of gameFns) {
        runOne(fn, phase, dt);
      }
    },

    /**
     * Run all phases in order, via `runPhase`.
     */
    run(dt: number) {
      for (const phase of PHASE_ORDER) {
        this.runPhase(phase, dt);
      }
    },

    /**
     * Mark everything registered so far (via `add()`/`register()`, in every
     * phase) as "engine" — infrastructure that must survive a warm restart.
     * Call once, right after mount finishes wiring engine-level systems and
     * BEFORE any game (`setup()`/scene load) registers its own. `hotReload`
     * calls `removeAllNonEngine()` on every restart, which only ever removes
     * what was added after this mark.
     */
    markEngineBoundary() {
      for (const phase of PHASE_ORDER) {
        const set = engineFns.get(phase)!;
        for (const fn of systems.get(phase)!) set.add(fn);
      }
      for (const sys of registered) engineRegistered.add(sys);
      boundaryMarked = true;
    },

    /**
     * Bulk-remove every system registered after the last `markEngineBoundary()`
     * call — both bare `add()`ed functions and lifecycle `register()`ed systems
     * (the latter get `dispose()`d, mirroring `unregister()`). A no-op if no
     * boundary has been marked. Idempotent: calling it again with nothing new
     * registered since is a safe no-op.
     *
     * This is what makes a warm restart (`hotReload`) safe to call N times
     * without accumulating duplicate systems/listeners — each restart's
     * outgoing game systems are fully removed before the new one registers its
     * own, while the engine systems (input/physics/render/...) registered
     * before the boundary are never touched.
     */
    removeAllNonEngine() {
      if (!boundaryMarked) return;
      // Membership-based, same reasoning as runPhase: partition by whether
      // each entry is in the engine set, not by a remembered length/index.
      const keptRegistered = registered.filter((sys) => engineRegistered.has(sys));
      const removedRegistered = registered.filter((sys) => !engineRegistered.has(sys));
      registered.length = 0;
      registered.push(...keptRegistered);
      for (const sys of removedRegistered) {
        sys.dispose?.();
      }

      for (const phase of PHASE_ORDER) {
        const list = systems.get(phase)!;
        const engineSet = engineFns.get(phase)!;
        const kept = list.filter((fn) => engineSet.has(fn));
        list.length = 0;
        list.push(...kept);
      }
    },

    /**
     * Total system-function count, optionally scoped to one phase.
     * Test/introspection helper — used to assert a warm restart doesn't
     * accumulate systems (see `removeAllNonEngine`).
     */
    count(phase?: SystemPhaseName): number {
      if (phase) {
        return systems.get(phase)?.length ?? 0;
      }
      let total = 0;
      for (const list of systems.values()) {
        total += list.length;
      }
      return total;
    },
  };
}

export type SystemRunner = ReturnType<typeof createSystemRunner>;
