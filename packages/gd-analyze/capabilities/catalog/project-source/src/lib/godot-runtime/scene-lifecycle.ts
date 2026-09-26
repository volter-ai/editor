/**
 * Shared SceneTree lifecycle traversal for translated Godot scenes.
 *
 * A translated scene still owns the callbacks and child bindings derived from its `.tscn` and
 * script. The copied runtime owns the invariant walk: inactive scenes do not tick, fixed binding
 * steps keep their authored order, and runtime-adopted scenes are visited between the local child
 * bindings and the surface's after-children callbacks.
 */

export interface GodotSceneLifecycleChild {
  prePhysicsTree?(delta: number): void;
  physicsTree(delta: number): void;
  processTree(delta: number): void;
  animateTree(delta: number): void;
}

export type GodotReadyStep = () => void;
export type GodotDeltaStep = (delta: number) => void;

export interface GodotSceneLifecycleBindings {
  /** True only after the surface committed this scene and while its root remains in the tree. */
  readonly active: () => boolean;
  /** Live Node.process_priority; lower values receive process notifications first. */
  readonly processPriority?: () => number;
  /** Authored child scene/script lifecycles in scene-tree order. */
  readonly children?: () => readonly GodotSceneLifecycleChild[];
  /** Project-specific `_ready` and node-script bindings, already in Godot's bottom-up order. */
  readonly ready?: readonly GodotReadyStep[];
  /** Native monitors (for example RayCast) that refresh before script `_physics_process`. */
  readonly prePhysicsBeforeChildren?: readonly GodotDeltaStep[];
  readonly prePhysicsChildren?: readonly GodotDeltaStep[];
  readonly prePhysicsAfterChildren?: readonly GodotDeltaStep[];
  /** Authored `_physics_process` callbacks in source tree order. */
  readonly physicsBeforeChildren?: readonly GodotDeltaStep[];
  readonly physicsChildren?: readonly GodotDeltaStep[];
  readonly physicsAfterChildren?: readonly GodotDeltaStep[];
  /** Input, deletion sweep, and any surface-local work that precedes child `_process`. */
  readonly processBeforeChildren?: readonly GodotDeltaStep[];
  /** Authored child-scene/node-script `_process` bindings in source tree order. */
  readonly processChildren?: readonly GodotDeltaStep[];
  /** Runtime-instanced scenes, whose membership can change during play. */
  readonly adopted: () => readonly GodotSceneLifecycleChild[];
  /** Surface-local `_process` or transform work that follows child traversal. */
  readonly processAfterChildren?: readonly GodotDeltaStep[];
  /** Local AnimationPlayer, sprite, particle, or other engine-driven animation steps. */
  readonly animateBeforeChildren?: readonly GodotDeltaStep[];
  /** Authored child-scene animation bindings in source tree order. */
  readonly animateChildren?: readonly GodotDeltaStep[];
  readonly animateAfterChildren?: readonly GodotDeltaStep[];
}

export interface GodotSceneLifecycle {
  /** The retained native world node that owns this lifecycle (when mounted). */
  readonly node?: object;
  readyTree(): void;
  prePhysicsTree(delta: number): void;
  physicsTree(delta: number): void;
  processTree(delta: number): void;
  animateTree(delta: number): void;
}

/**
 * Presentation roots from a mixed Godot project register here instead of installing a second
 * React scheduler. The primary surface owns the clock; its generated world includes this registry
 * in the same fixed/process/animation traversals it already drives. The registry is deliberately
 * surface-neutral and stores only live translated scene objects.
 */
export interface GodotSceneScheduler {
  attach(driver: GodotSurfaceDriver): () => void;
  drivers(): readonly GodotSurfaceDriver[];
  clear(): void;
}

/** A secondary surface's complete native pass, driven by the primary project's one clock. */
export interface GodotSurfaceDriver {
  /** Scene path this driver presents; the primary clock ignores a retiring scene immediately. */
  readonly scenePath: string;
  fixed(delta: number): void;
  process(delta: number): void;
  render(delta: number, interpolationFraction: number): void;
}

/** A project-owned scheduler registry. The runtime library must not retain scenes across games. */
export function createGodotSceneScheduler(): GodotSceneScheduler {
  const drivers = new Set<GodotSurfaceDriver>();
  return {
    attach(driver): () => void {
      drivers.add(driver);
      return () => { drivers.delete(driver); };
    },
    drivers(): readonly GodotSurfaceDriver[] { return [...drivers]; },
    clear(): void { drivers.clear(); },
  };
}

/**
 * Project-owned coordination for a mixed-surface translation.  The generated primary world
 * creates one instance and the sibling presentation imports that instance; keeping the listener
 * set, active-scene slot, and scheduler inside the factory prevents two translated games from
 * sharing lifecycle state through this copied library module.
 */
export interface GodotSharedContext {
  readonly tree: unknown;
  readonly input: unknown;
  readonly random: unknown;
  readonly crossSurfaceAnimation: GodotCrossSurfaceAnimationBindings;
  readonly crossSurfaceNodes: GodotCrossSurfaceNodeBindings;
}

export type GodotCrossSurfaceAnimationSetter = (value: unknown) => void;
export type GodotCrossSurfaceAnimationGetter = () => unknown;
export type GodotCrossSurfaceAnimationMethod = (args: readonly unknown[]) => unknown;

/** Exact property handoff between native projections of one authored mixed-surface scene. */
export interface GodotCrossSurfaceAnimationBindings {
  bind(instanceKey: string, scenePath: string, nodePath: string, property: string, setter: GodotCrossSurfaceAnimationSetter, getter?: GodotCrossSurfaceAnimationGetter): () => void;
  bindMethod(instanceKey: string, scenePath: string, nodePath: string, method: string, minimumArity: number, maximumArity: number, invoke: GodotCrossSurfaceAnimationMethod): () => void;
  write(instanceKey: string, scenePath: string, nodePath: string, property: string, value: unknown): void;
  read(instanceKey: string, scenePath: string, nodePath: string, property: string): unknown;
  invoke(instanceKey: string, scenePath: string, nodePath: string, method: string, args: readonly unknown[]): unknown;
  clear(): void;
}

export function createGodotCrossSurfaceAnimationBindings(): GodotCrossSurfaceAnimationBindings {
  const bindings = new Map<string, {
    readonly setter: GodotCrossSurfaceAnimationSetter;
    readonly getter?: GodotCrossSurfaceAnimationGetter;
  }>();
  const pending = new Map<string, unknown>();
  const methods = new Map<string, {
    readonly minimumArity: number;
    readonly maximumArity: number;
    readonly invoke: GodotCrossSurfaceAnimationMethod;
  }>();
  const keyOf = (instanceKey: string, scenePath: string, nodePath: string, property: string): string =>
    `${instanceKey}\0${scenePath}\0${nodePath}\0${property}`;
  return {
    bind(instanceKey, scenePath, nodePath, property, setter, getter): () => void {
      const key = keyOf(instanceKey, scenePath, nodePath, property);
      if (bindings.has(key)) throw new Error(`Godot mixed-surface animation target is already bound: ${scenePath}#${nodePath}:${property}`);
      const binding = { setter, ...(getter === undefined ? {} : { getter }) };
      bindings.set(key, binding);
      if (pending.has(key)) {
        setter(pending.get(key));
        pending.delete(key);
      }
      return () => { if (bindings.get(key) === binding) bindings.delete(key); };
    },
    bindMethod(instanceKey, scenePath, nodePath, method, minimumArity, maximumArity, invoke): () => void {
      const key = keyOf(instanceKey, scenePath, nodePath, `method:${method}`);
      if (methods.has(key)) {
        throw new Error(`Godot mixed-surface Animation method is already bound: ${scenePath}#${nodePath}.${method}`);
      }
      if (!Number.isSafeInteger(minimumArity) || minimumArity < 0 ||
          !(maximumArity === Number.POSITIVE_INFINITY ||
            (Number.isSafeInteger(maximumArity) && maximumArity >= minimumArity))) {
        throw new RangeError(`Godot mixed-surface Animation method ${scenePath}#${nodePath}.${method} has invalid arity ${minimumArity}..${maximumArity}.`);
      }
      const binding = { minimumArity, maximumArity, invoke };
      methods.set(key, binding);
      return () => { if (methods.get(key) === binding) methods.delete(key); };
    },
    write(instanceKey, scenePath, nodePath, property, value): void {
      const key = keyOf(instanceKey, scenePath, nodePath, property);
      const binding = bindings.get(key);
      if (binding === undefined) pending.set(key, value);
      else binding.setter(value);
    },
    read(instanceKey, scenePath, nodePath, property): unknown {
      const binding = bindings.get(keyOf(instanceKey, scenePath, nodePath, property));
      if (binding === undefined) {
        throw new Error(`Godot mixed-surface animation target is not bound: ${scenePath}#${nodePath}:${property}`);
      }
      if (binding.getter === undefined) {
        throw new Error(`Godot mixed-surface animation target is write-only: ${scenePath}#${nodePath}:${property}`);
      }
      return binding.getter();
    },
    invoke(instanceKey, scenePath, nodePath, method, args): unknown {
      const binding = methods.get(keyOf(instanceKey, scenePath, nodePath, `method:${method}`));
      if (binding === undefined) {
        throw new Error(`Godot mixed-surface Animation method is not bound: ${scenePath}#${nodePath}.${method}/${args.length}`);
      }
      if (args.length < binding.minimumArity || args.length > binding.maximumArity) {
        throw new RangeError(
          `Godot mixed-surface Animation method ${scenePath}#${nodePath}.${method} received ${args.length} argument(s); ` +
            `expected ${binding.minimumArity}..${Number.isFinite(binding.maximumArity) ? binding.maximumArity : 'many'}.`,
        );
      }
      return binding.invoke(args);
    },
    clear(): void { bindings.clear(); pending.clear(); methods.clear(); },
  };
}

/** One exact authored node required from the sibling native projection. */
export interface GodotCrossSurfaceNodeTarget {
  readonly instanceKey: string;
  readonly scenePath: string;
  readonly nodePath: string;
}

/**
 * Exact native-node handoff between the two projections of one authored mixed scene.
 *
 * This registry never creates a handle, proxy, mirror, or queued property write. The surface that
 * owns an authored node binds that node's actual Pixi/Three identity. The sibling scene delays its
 * onready/ready phase until every statically resolved target is present, then `require` returns the
 * native entity itself—the same ordering Godot gets by completing the composed tree before ready.
 */
export interface GodotCrossSurfaceNodeBindings {
  // biome-ignore lint/suspicious/noExplicitAny: a generated script retains the sibling node's exact
  // source type; this project-owned boundary cannot import every native Pixi/Three node type.
  require(instanceKey: string, scenePath: string, nodePath: string): any;
  bind(instanceKey: string, scenePath: string, nodePath: string, node: object): () => void;
  unpairedInstance(scenePath: string): string;
  assertPairable(instanceKey: string, scenePath: string): void;
  hasAll(targets: readonly GodotCrossSurfaceNodeTarget[]): boolean;
  whenBound(targets: readonly GodotCrossSurfaceNodeTarget[], callback: () => void): () => void;
  clear(): void;
}

export function createGodotCrossSurfaceNodeBindings(): GodotCrossSurfaceNodeBindings {
  const targets = new Map<string, object>();
  let nextUnpairedInstance = 1;
  const waiters = new Set<{
    readonly targets: readonly GodotCrossSurfaceNodeTarget[];
    readonly callback: () => void;
  }>();
  const keyOf = (instanceKey: string, scenePath: string, nodePath: string): string =>
    `${instanceKey}\0${scenePath}\0${nodePath}`;
  const hasAll = (required: readonly GodotCrossSurfaceNodeTarget[]): boolean =>
    required.every((target) => targets.has(keyOf(target.instanceKey, target.scenePath, target.nodePath)));
  const flush = (): void => {
    for (const waiter of [...waiters]) {
      if (!hasAll(waiter.targets)) continue;
      waiters.delete(waiter);
      waiter.callback();
    }
  };
  return {
    require(instanceKey, scenePath, nodePath) {
      const key = keyOf(instanceKey, scenePath, nodePath);
      const target = targets.get(key);
      if (target === undefined) {
        throw new Error(`Godot mixed-surface node is not bound: ${scenePath}#${nodePath}`);
      }
      return target;
    },
    bind(instanceKey, scenePath, nodePath, node): () => void {
      const key = keyOf(instanceKey, scenePath, nodePath);
      const existing = targets.get(key);
      if (existing !== undefined && existing !== node) {
        throw new Error(`Godot mixed-surface node is already bound: ${scenePath}#${nodePath}`);
      }
      targets.set(key, node);
      flush();
      return () => { if (targets.get(key) === node) targets.delete(key); };
    },
    unpairedInstance(scenePath): string {
      return `unpaired:${String(nextUnpairedInstance++)}:${scenePath}`;
    },
    assertPairable(instanceKey, scenePath): void {
      if (!instanceKey.startsWith('unpaired:')) return;
      throw new Error(
        `Godot mixed scene ${scenePath} was instantiated dynamically without a sibling-surface ` +
          `pair (${instanceKey}); its authored cross-surface NodePath cannot resolve.`,
      );
    },
    hasAll,
    whenBound(required, callback): () => void {
      if (hasAll(required)) {
        callback();
        return () => {};
      }
      const waiter = { targets: [...required], callback };
      waiters.add(waiter);
      return () => { waiters.delete(waiter); };
    },
    clear(): void {
      targets.clear();
      waiters.clear();
    },
  };
}

export interface GodotSharedResolution {
  readonly width: number;
  readonly height: number;
}

export interface GodotSharedRuntimeCore<TContext extends GodotSharedContext = GodotSharedContext> {
  readonly activeScene: string;
  readonly context: TContext;
  readonly tree: TContext['tree'];
  readonly input: TContext['input'];
  readonly random: TContext['random'];
  readonly resolution: GodotSharedResolution;
  readonly scheduler: GodotSceneScheduler;
}

export interface GodotSharedRuntime<TContext extends GodotSharedContext = GodotSharedContext> {
  core: GodotSharedRuntimeCore<TContext> | null;
  readonly crossSurfaceAnimation: GodotCrossSurfaceAnimationBindings;
  readonly crossSurfaceNodes: GodotCrossSurfaceNodeBindings;
  subscribe(listener: () => void): () => void;
  publish(context: TContext, resolution: GodotSharedResolution): void;
  setScene(activeScene: string): void;
  clear(): void;
}

export function createGodotSharedRuntime<TContext extends GodotSharedContext>(
  initialScene: string,
): GodotSharedRuntime<TContext> {
  const listeners = new Set<() => void>();
  const scheduler = createGodotSceneScheduler();
  const crossSurfaceAnimation = createGodotCrossSurfaceAnimationBindings();
  const crossSurfaceNodes = createGodotCrossSurfaceNodeBindings();
  const runtime: GodotSharedRuntime<TContext> = {
    core: null,
    crossSurfaceAnimation,
    crossSurfaceNodes,
    subscribe(listener): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    publish(context, resolution): void {
      runtime.core = {
        activeScene: initialScene,
        context,
        tree: context.tree,
        input: context.input,
        random: context.random,
        resolution,
        scheduler,
      };
      for (const listener of listeners) listener();
    },
    setScene(activeScene): void {
      if (runtime.core === null || runtime.core.activeScene === activeScene) return;
      runtime.core = { ...runtime.core, activeScene };
      for (const listener of listeners) listener();
    },
    clear(): void {
      scheduler.clear();
      crossSurfaceAnimation.clear();
      crossSurfaceNodes.clear();
      runtime.core = null;
      for (const listener of listeners) listener();
    },
  };
  return runtime;
}

/** Update the one shared SceneTree's current scene without coupling canvas and Three node types. */
export function setGodotSharedCurrentScene<T extends object>(
  tree: { currentScene: T | null },
  scene: GodotSceneLifecycle | null,
): void {
  tree.currentScene = (scene?.node as T | undefined) ?? null;
}

function runReady(steps: readonly GodotReadyStep[] | undefined): void {
  if (steps === undefined) return;
  for (const step of steps) step();
}

function runDelta(steps: readonly GodotDeltaStep[] | undefined, delta: number): void {
  if (steps === undefined) return;
  for (const step of steps) step(delta);
}

/**
 * Lifecycle bindings belong to the emitted scene object itself. This weak association is not a
 * second tree or a source-platform base class: the retained Pixi/Three node remains the entity,
 * while these shared protocol methods walk the scene's own emitted child/adopted callbacks on the
 * caller's clock.
 */
const SCENE_BINDINGS = new WeakMap<object, GodotSceneLifecycleBindings>();

function bindingsOf(scene: object): GodotSceneLifecycleBindings {
  const bindings = SCENE_BINDINGS.get(scene);
  if (bindings === undefined) {
    throw new Error('Godot scene lifecycle was called before bindGodotSceneLifecycle().');
  }
  return bindings;
}

function readyTree(this: object): void {
  runReady(bindingsOf(this).ready);
}

function prePhysicsTree(this: object, delta: number): void {
  const bindings = bindingsOf(this);
  if (!bindings.active()) return;
  runDelta(bindings.prePhysicsBeforeChildren, delta);
  runDelta(bindings.prePhysicsChildren, delta);
  for (const child of bindings.adopted()) child.prePhysicsTree?.(delta);
  runDelta(bindings.prePhysicsAfterChildren, delta);
}

function physicsTree(this: object, delta: number): void {
  physicsGodotSceneRoots([this as GodotSceneLifecycle], delta);
}

function processTree(this: object, delta: number): void {
  processGodotSceneRoots([this as GodotSceneLifecycle], delta);
}

interface ScheduledScene {
  readonly order: number;
  readonly bindings: GodotSceneLifecycleBindings;
}

function collectScheduledScenes(scene: object, scheduled: ScheduledScene[]): void {
  const bindings = bindingsOf(scene);
  if (!bindings.active()) return;
  scheduled.push({ order: scheduled.length, bindings });
  for (const child of bindings.children?.() ?? []) collectScheduledScenes(child, scheduled);
  for (const child of bindings.adopted()) collectScheduledScenes(child, scheduled);
}

function runPrioritizedTree(
  roots: readonly object[],
  delta: number,
  before: 'physicsBeforeChildren' | 'processBeforeChildren',
  legacyChildren: 'physicsChildren' | 'processChildren',
  after: 'physicsAfterChildren' | 'processAfterChildren',
): void {
  const scheduled: ScheduledScene[] = [];
  for (const root of roots) collectScheduledScenes(root, scheduled);
  for (const entry of [...scheduled].sort((a, b) =>
    (a.bindings.processPriority?.() ?? 0) - (b.bindings.processPriority?.() ?? 0) ||
    a.order - b.order
  )) {
    runDelta(entry.bindings[before], delta);
    runDelta(entry.bindings[legacyChildren], delta);
  }
  // After-children native sync remains post-order; process priority governs notifications, not
  // renderer hierarchy repair.
  for (const entry of [...scheduled].reverse()) runDelta(entry.bindings[after], delta);
}

/** Run every mounted root in one global Godot process-priority order. */
export function processGodotSceneRoots(
  roots: readonly object[],
  delta: number,
): void {
  runPrioritizedTree(roots, delta, 'processBeforeChildren', 'processChildren', 'processAfterChildren');
}

/** Fixed-step counterpart of processGodotSceneRoots. */
export function physicsGodotSceneRoots(
  roots: readonly object[],
  delta: number,
): void {
  runPrioritizedTree(roots, delta, 'physicsBeforeChildren', 'physicsChildren', 'physicsAfterChildren');
}

function animateTree(this: object, delta: number): void {
  const bindings = bindingsOf(this);
  if (!bindings.active()) return;
  runDelta(bindings.animateBeforeChildren, delta);
  runDelta(bindings.animateChildren, delta);
  for (const child of bindings.adopted()) child.animateTree(delta);
  runDelta(bindings.animateAfterChildren, delta);
}

/**
 * Installs the one shared SceneTree traversal protocol on an emitted scene. The emitter supplies
 * only its authored callback/child facts; no per-class traversal body is synthesized.
 */
export function bindGodotSceneLifecycle(
  scene: GodotSceneLifecycle,
  bindings: GodotSceneLifecycleBindings,
): void {
  if (SCENE_BINDINGS.has(scene)) {
    throw new Error('bindGodotSceneLifecycle() may be called only once for a scene instance.');
  }
  SCENE_BINDINGS.set(scene, bindings);
  Object.defineProperties(scene, {
    readyTree: { configurable: false, enumerable: false, value: readyTree },
    prePhysicsTree: { configurable: false, enumerable: false, value: prePhysicsTree },
    physicsTree: { configurable: false, enumerable: false, value: physicsTree },
    processTree: { configurable: false, enumerable: false, value: processTree },
    animateTree: { configurable: false, enumerable: false, value: animateTree },
  });
}
