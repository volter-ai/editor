/**
 * React composition boundary for Godot's Node lifecycle: generated scene components seat their
 * script attachments on the native hierarchy they mounted, and `node.ts` applies Godot's
 * enter/ready/exit ordering in the host's own layout-effect phase.
 *
 * @godot-class Node
 * @role PROTOCOL
 * @source main/main.cpp:4495-4560 (autoloads added to root before the main scene)
 * @source scene/main/node.cpp:323-455 (enter/ready/exit propagation order)
 * Pinned revision 5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88 (Godot 4.7).
 */

import {
  createContext,
  createElement,
  type PropsWithChildren,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefObject,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Group, type Object3D } from 'three';
import type { InputEventRecord } from './input-event';
import {
  type GodotScriptLifecycleBinding,
  godot_element_callsite,
  godot_node_adopt,
  godot_node_defer_node_path,
  godot_node_object,
  godot_node_enter,
  godot_node_exit,
  godot_node_listen_input,
  godot_node_scene_root,
  godot_node_seat,
  set_physics_interpolation_mode,
} from './node';
import {
  type GodotSpawn,
  GodotPendingSceneContext,
  godot_packed_scene_claim,
  godot_packed_scene_portals,
  godot_packed_scene_spawner,
} from './packed-scene-instance';
import { useGodotAdvance } from './advance';
import { set_visible } from './node-3d';
import { set_meta } from './object';
import { godot_collision_object_node } from './collision-object-3d';
import { type GodotSignal, isRetainedGodotSignal } from './signal';
import { godot_owned_release } from './scene-tree';

/**
 * The node an element's ref holds: its object, or for a `@react-three/rapier` body (whose ref is
 * the Rapier body) the body's object.
 */
function nodeOf(held: object | null): object | null {
  if (held === null || (held as { readonly isObject3D?: boolean }).isObject3D === true) return held;
  return godot_collision_object_node(held) ?? null;
}

/**
 * The scene a component writes, as the tree has it: its root marked a scene root (the nodes the
 * component mounts below it are its own, which `%Name` and `get_owner` read), the scene seated and
 * entered into the tree once React's commit is done (`godot_node_enter`; a scene a script added is
 * entered by that `add_child`), exited as React unmounts it, and exited and entered again as a
 * Suspense boundary hides and reveals it. It exits in the layout cleanup,
 * while its objects still hang under one another: R3F takes a removed subtree apart before passive
 * cleanups run, and a node the exit cannot reach would stay in the tree (a camera still current).
 * Returns the scenes scripts added under its nodes, which the component renders.
 *
 * @godot Node (protocol)
 * @source scene/resources/packed_scene.cpp:318
 */
export function useGodotScene(root: RefObject<object | null>): ReactNode {
  const pending = useContext(GodotPendingSceneContext);
  const seated = useRef<object | null>(null);
  useEffect(() => {
    const entity = nodeOf(root.current);
    if (entity === null) throw new Error('godot-compat: the root of a scene was not mounted.');
    godot_node_scene_root(entity);
    godot_node_seat(entity);
    seated.current = entity;
    const added = godot_packed_scene_claim(pending, entity);
    let mounted = true;
    if (!added) queueMicrotask(() => mounted && godot_node_enter(entity));
    return () => {
      mounted = false;
    };
  }, []);
  // A Suspense boundary that hides mounted content runs only layout cleanups, and on reveal only
  // layout setups: the scene it exited is entered again here, where the passive effect above does
  // not run twice.
  const hidden = useRef<object | null>(null);
  useLayoutEffect(() => {
    const again = hidden.current;
    if (again !== null) {
      hidden.current = null;
      seated.current = again;
      godot_node_enter(again);
    }
    return () => {
      if (seated.current !== null) godot_node_exit(seated.current);
      hidden.current = seated.current;
      seated.current = null;
    };
  }, []);
  return createElement(GodotAddedScenes, { root });
}

/**
 * The scenes scripts added under a scene's nodes, as this component's own state: adding one
 * renders only it, not the scene.
 */
function GodotAddedScenes({ root }: { readonly root: RefObject<object | null> }): ReactNode {
  const [spawns, setSpawns] = useState<readonly GodotSpawn[]>([]);
  useEffect(() => {
    const entity = nodeOf(root.current);
    if (entity === null) throw new Error('godot-compat: the root of a scene was not mounted.');
    return godot_packed_scene_spawner(entity, setSpawns);
  }, [root]);
  return godot_packed_scene_portals(spawns);
}

/** Each node's script instance, as `useGodotScript` makes it. */
const SCRIPT_OF = new WeakMap<object, object>();

/**
 * A connection the scene authors (`[connection]`, made as the scene instantiates,
 * `packed_scene.cpp:682`): the source node's signal, through its class's accessor, calls the
 * method of the target node's script. It is made before the tree is entered (the target's script
 * attached by a `useGodotScript` earlier in the same component, or in a child's), and released
 * when the scene unmounts. Like the script attachments, it runs among the effects, once the
 * `@react-three/rapier` bodies exist.
 *
 * @godot Node (protocol)
 * @source scene/resources/packed_scene.cpp:682
 */
export function useGodotConnection<Name extends string, Args extends unknown[]>(
  source: RefObject<object | null>,
  signal: (self: object, name: Name) => { connect(callable: (...args: Args) => void): { disconnect(): void } },
  name: Name,
  target: RefObject<object | null>,
  method: string,
): void {
  useEffect(() => {
    const from = nodeOf(source.current);
    const to = nodeOf(target.current);
    if (from === null || to === null) throw new Error(`godot-compat: the nodes connected by ${name} were not mounted.`);
    const instance = SCRIPT_OF.get(to) as Readonly<Record<string, unknown>> | undefined;
    const callee = instance?.[method];
    if (typeof callee !== 'function') throw new Error(`godot-compat: the target of ${name} has no script method ${method}.`);
    const connection = signal(from, name).connect((...args: Args) => (callee as (...values: Args) => unknown).apply(instance, args));
    return () => connection.disconnect();
  }, []);
}

/**
 * A signal the node's script declares (`signal name(...)`), which an authored connection reaches
 * when the node's class has no signal of that name: the script instance's Signal field.
 *
 * @godot Object.connect
 * @source core/object/object.cpp:1536
 */
export function godot_node_script_signal(self: object, name: string): GodotSignal<unknown[]> {
  const signal = (SCRIPT_OF.get(self) as Readonly<Record<string, unknown>> | undefined)?.[name];
  if (!isRetainedGodotSignal(signal)) throw new Error(`godot-compat: the node's script declares no signal ${name}.`);
  return signal as GodotSignal<unknown[]>;
}

/**
 * Attaches a script to the node its ref holds, in the component's own effect: the script instance
 * over the mounted Object3D and its authored exported values (`SceneState::instantiate` sets them
 * after the instance exists, packed_scene.cpp:494). `autoloads` are the autoload singletons the
 * script reads, each by its field, as the refs the world mounts them into. The script's virtual
 * methods are not registered anywhere: the component calls them from its own hooks
 * (`useEffect`, `useFrame`, `useBeforePhysicsStep`, `useGodotInput`).
 *
 * @godot Node (protocol)
 * @source scene/resources/packed_scene.cpp:494
 */
export function useGodotScript<Instance extends object>(
  ref: RefObject<object | null>,
  ScriptClass: new (native: object) => Instance,
  exported?: { readonly [Field in keyof Instance]?: Instance[Field] },
  autoloads?: Readonly<Record<string, RefObject<object | null> | undefined>>,
): RefObject<Instance | null> {
  const script = useRef<Instance | null>(null);
  const pending = useContext(GodotPendingSceneContext);
  useEffect(() => {
    const native = nodeOf(ref.current);
    if (native === null) throw new Error('godot-compat: the node a script attaches to was not mounted.');
    // An instantiated scene's root keeps the instance its instancer holds, now over the mounted node.
    const made = pending?.instance;
    const adopted = made instanceof ScriptClass && pending !== undefined && pending.mounted === undefined && (native as Object3D).parent === pending.container;
    const instance = adopted ? (made as Instance) : new ScriptClass(native);
    if (adopted && '$native' in instance) (instance as { $native: object }).$native = native;
    SCRIPT_OF.set(native, instance);
    // Its authored values (a node reference is handed by `useGodotNodeReferences`).
    for (const [field, value] of Object.entries(exported ?? {})) (instance as Record<string, unknown>)[field] = value;
    for (const [field, singleton] of Object.entries(autoloads ?? {})) {
      const value = singleton?.current;
      if (value === null || value === undefined) throw new Error(`godot-compat: the autoload ${field} reads was not mounted.`);
      (instance as Record<string, unknown>)[field] = value;
    }
    // The node's Godot object is its script instance (`get_node`, signals, `is`).
    godot_node_adopt(native, { binding: { owner: instance } });
    script.current = instance;
    return () => {
      script.current = null;
      // What the script made (its timers and tweens) goes with it.
      godot_owned_release(instance);
    };
  }, []);
  return script;
}

/**
 * A script's input callback for one stage, from its component: `_input`, `_shortcut_input`,
 * `_unhandled_key_input` or `_unhandled_input`, called as the viewport delivers each event.
 *
 * @godot Node (protocol)
 * @source scene/main/node.cpp:3474
 */
export function useGodotInput(
  ref: RefObject<object | null>,
  kind: 'input' | 'shortcutInput' | 'unhandledKeyInput' | 'unhandledInput',
  listener: (event: InputEventRecord) => void,
): void {
  const current = useRef(listener);
  current.current = listener;
  useEffect(() => {
    const node = nodeOf(ref.current);
    if (node === null) throw new Error('godot-compat: the node an input callback attaches to was not mounted.');
    return godot_node_listen_input(node, kind, (event) => {
      // A script error aborts only this callback; the event carries on (GODOT.md §Order of work).
      try {
        current.current(event as InputEventRecord);
      } catch (error) {
        console.error(error);
      }
    });
  }, []);
}

/**
 * A script's fields that hold nodes of its scene: an authored node reference (`@export var target:
 * Node`, `node_paths`) and a static path the plan handed over (`$Path`, `script-node-paths.ts`),
 * each set to the node, or its script instance, as `get_node` finds it; and an instancing scene's
 * overrides of those on an instance's root script. The scene calls it on the node running the
 * script, after every `useGodotScript`, so its effect runs once the scene's scripts, and its
 * instanced scenes' (its children), are all attached, an instancer's after the instance's own
 * (`SceneState::instantiate` sets node paths once the scene's nodes all exist, packed_scene.cpp:597).
 * A field whose path leaves the scene is null.
 *
 * @godot Node (protocol)
 * @source scene/resources/packed_scene.cpp:597
 */
export function useGodotNodeReferences(node: RefObject<object | null>, references: Readonly<Record<string, RefObject<object | null> | null>>): void {
  useEffect(() => {
    const held = nodeOf(node.current);
    const instance = held === null ? undefined : SCRIPT_OF.get(held);
    if (instance === undefined) throw new Error('godot-compat: the node whose script takes node references has no script attached.');
    for (const [field, ref] of Object.entries(references) as [string, RefObject<object | null> | null][]) {
      const set = () => {
        const node = ref === null ? null : nodeOf(ref.current);
        (instance as Record<string, unknown>)[field] = node === null ? null : godot_node_object(node);
      };
      if (ref === null || ref.current !== null) set();
      else queueMicrotask(set);
    }
  }, []);
}

/**
 * A Godot element's props: the node's name, a ref (to the `Entity` it mounts, typed as the Object3D
 * a script's ref holds), its children, and its Godot properties.
 */
export interface GodotElementProps<Entity extends Object3D> {
  readonly name?: string;
  readonly ref?: Ref<Entity> | Ref<Object3D>;
  readonly children?: ReactNode;
  readonly [property: string]: unknown;
}

/**
 * The props an instancing scene hands a scene whose root is a Godot element: its name, children
 * placed under it, and its Godot properties (no ref: the scene's own root keeps its ref).
 */
export interface GodotSceneRootProps {
  readonly name?: string;
  readonly children?: ReactNode;
  readonly [property: string]: unknown;
}

/** A Godot property's prop: the setter it calls with the literal value the JSX states. */
export type GodotElementProp<Entity> = (entity: Entity, value: never) => void;

/** How a node class is written as a JSX element (`useGodotElement`). */
export interface GodotElementClass<Entity extends Object3D> {
  readonly create: () => Entity;
  /** The class and its native ancestors, nearest first; a canvas or plain node is not spatial. */
  readonly classes: readonly string[];
  readonly spatial: boolean;
  /** Makes the entity the node its class creates, before its properties. */
  readonly mount: (entity: Entity) => void;
  /** The class's properties, by the camel-case prop that states each. */
  readonly props: ReadonlyMap<string, GodotElementProp<Entity>>;
  /** The class advances itself each frame or physics step (an animation, a particle system). */
  readonly advances?: boolean;
}


/** Three's own transform props, which a spatial element hands its object. */
const THREE_TRANSFORM = new Set(['position', 'rotation', 'scale', 'quaternion', 'matrix', 'matrixAutoUpdate']);

/** `userData` or one of its fields (`userData-NAME`, which R3F sets as `userData.NAME`). */
function isUserData(property: string): boolean {
  return property === 'userData' || property.startsWith('userData-');
}

/**
 * A node of a Godot class the scene's JSX writes as an element (`<GodotLabel text="…" />`): its
 * entity made as `SceneState::instantiate` makes the node (created, its class recorded, its
 * authored properties set by their setters in the order the JSX states them, before it enters the
 * tree), once, as the element first renders (a parent before its children); then mounted by R3F as
 * that object. A prop the class does not declare is an error.
 *
 * @godot Node (protocol)
 * @source scene/resources/packed_scene.cpp:400
 */
export function useGodotElement<Entity extends Object3D>(element: GodotElementClass<Entity>, props: GodotElementProps<Entity>): ReactElement {
  const { name, ref, children, __volterOid: callsite, __volterLabel: _label, ...properties } = props;
  const [entity] = useState(() => {
    const made = element.create();
    if (name !== undefined) made.name = name;
    godot_element_callsite(made, callsite);
    godot_node_adopt(made, { kind: element.spatial ? 'spatial' : 'node', classes: element.classes });
    element.mount(made);
    for (const [property, value] of Object.entries(properties)) {
      // `userData` (or one of its fields, `userData-NAME`) is the node's Godot-only state (its groups,
      // `%Name`, its authored transform), which the Node protocol reads.
      if ((element.spatial && THREE_TRANSFORM.has(property)) || isUserData(property)) continue;
      // The node's metadata, by name (`Object::_set`, `metadata/NAME`, `object.cpp:279`).
      if (property === 'meta') {
        for (const [name, entry] of Object.entries(value as Readonly<Record<string, unknown>>)) set_meta(made, name, entry);
        continue;
      }
      // A Node3D's `visible`, which every spatial class inherits (`node_3d.cpp:1120`), and a Node's
      // `physics_interpolation_mode`, which every class inherits (`node.cpp:4056`).
      const set =
        element.props.get(property) ??
        (property === 'visible' && element.classes.includes('Node3D') ? set_visible : property === 'physicsInterpolationMode' ? set_physics_interpolation_mode : undefined);
      if (set === undefined) throw new Error(`godot-compat: ${element.classes[0] ?? 'a node'} has no ${property} prop`);
      (set as (entity: Entity, value: unknown) => void)(made, value);
    }
    return made;
  });
  // A class's `advances` is fixed, so each element calls the same hooks every render.
  if (element.advances === true) useGodotAdvance(entity);
  const transform = Object.fromEntries(
    Object.entries(properties).filter(([property]) => isUserData(property) || (element.spatial && THREE_TRANSFORM.has(property))),
  );
  return createElement('primitive', { object: entity, ref, ...transform }, children);
}

const NODE_ELEMENT: GodotElementClass<Object3D> = {
  create: () => new Group(),
  classes: ['Node', 'Object'],
  spatial: false,
  mount: () => undefined,
  props: new Map(),
};

/**
 * A plain Node as a scene writes it: `<GodotNode />`, a group the Node protocol marks non-spatial
 * (its matrix stays identity; a Node3D under it takes global = local).
 *
 * @godot Node (protocol)
 * @source scene/main/node.cpp:4092
 */
export function GodotNode(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(NODE_ELEMENT, props);
}
