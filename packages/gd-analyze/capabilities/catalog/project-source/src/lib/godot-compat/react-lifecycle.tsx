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
import type { Object3D } from 'three';
import {
  type GodotScriptLifecycleBinding,
  godot_node_adopt,
  godot_node_pending_children,
  mountGodotScriptForest,
  mountGodotScriptTree,
} from './node';
import { godot_tree_root } from './scene-tree';
import { godot_world_3d_declared_object } from './world-3d';

export interface GodotScriptTreeAttachment {
  readonly root: object;
  readonly bindings: readonly GodotScriptLifecycleBinding[];
  readonly release: () => void;
}

interface GodotStartupRegistration extends GodotScriptTreeAttachment {
  readonly sequence: number;
}

interface GodotStartupBatch {
  register(attachment: GodotScriptTreeAttachment): () => void;
}

const GodotStartupContext = createContext<GodotStartupBatch | null>(null);

function contains(root: object, sought: object): boolean {
  if (root === sought) return true;
  const children = (root as { readonly children?: readonly object[] }).children ?? [];
  return children.some((child) => contains(child, sought));
}

function outermostRoots(registrations: readonly GodotStartupRegistration[]): readonly object[] {
  return registrations
    .filter(
      (candidate) =>
        registrations.some(
          (other) => other !== candidate && contains(other.root, candidate.root),
        ) === false,
    )
    .map((registration) => registration.root);
}

/**
 * React composition boundary for Godot's one project-startup lifecycle transaction.
 *
 * Descendant scene/autoload components retain their own native refs and script instances. This
 * context collects only their mount-time native identities and callbacks. Once every descendant
 * exists, generated project composition may wire its exact typed cross-root fields through
 * `prepare`; compat then applies Godot's cross-root enter/ready/exit ordering. No hierarchy or
 * registration survives unmount.
 *
 * @godot Node (protocol)
 * @source main/main.cpp:4495-4560 (autoloads added to root)
 * @source main/main.cpp:4764 (then the main scene)
 */
export function GodotProjectStartup({
  children,
  prepare,
}: PropsWithChildren<{ readonly prepare?: () => void }>) {
  const registrations = useRef<GodotStartupRegistration[]>([]);
  const nextSequence = useRef(0);
  const prepareOnMount = useRef(prepare);
  const batch = useRef<GodotStartupBatch | null>(null);
  batch.current ??= {
    register(attachment): () => void {
      const registration = { ...attachment, sequence: nextSequence.current++ };
      registrations.current.push(registration);
      return () => {
        const index = registrations.current.indexOf(registration);
        if (index >= 0) registrations.current.splice(index, 1);
      };
    },
  };

  // After every descendant's effects: a `@react-three/rapier` body exists, and its object is known,
  // only once its own effects have run.
  useEffect(() => {
    const mounted = [...registrations.current].sort(
      (left, right) => left.sequence - right.sequence,
    );
    prepareOnMount.current?.();
    // Every scene mounted under the tree root enters, scripted or not (`Main::start` adds the
    // autoloads, then the main scene, to the root); a registered root outside them enters too.
    const treeRoot = godot_tree_root();
    const pending = treeRoot === undefined ? [] : godot_node_pending_children(treeRoot);
    const roots = [
      ...pending,
      ...outermostRoots(mounted).filter((root) => !pending.some((scene) => contains(scene, root))),
    ];
    const releaseLifecycle = mountGodotScriptForest(
      roots,
      mounted.flatMap((registration) => registration.bindings),
    );
    return () => {
      releaseLifecycle();
      for (let index = mounted.length - 1; index >= 0; index -= 1) mounted[index]!.release();
    };
  }, []);

  return createElement(GodotStartupContext.Provider, { value: batch.current }, children);
}

/**
 * Seat one generated scene's retained script attachments on its native hierarchy.
 *
 * At project startup the enclosing batch owns notification ordering. A scene mounted later has no
 * enclosing startup context, so the same hook mounts its real native subtree immediately.
 *
 * @godot Node (protocol)
 * @source scene/main/node.cpp:341-362 (a node added to the tree enters, then readies, at once)
 */
export function useGodotScriptTreeAttachment<Native extends object>(
  root: RefObject<Native | null>,
  attach: () => Omit<GodotScriptTreeAttachment, 'root'>,
): void {
  const startup = useContext(GodotStartupContext);
  useLayoutEffect(() => {
    const nativeRoot = root.current;
    if (nativeRoot === null) return;
    const attachment = { root: nativeRoot, ...attach() };
    if (startup !== null) return startup.register(attachment);
    const releaseLifecycle = mountGodotScriptTree(attachment.root, attachment.bindings);
    return () => {
      releaseLifecycle();
      attachment.release();
    };
  }, []);
}

/**
 * The node an element's ref holds: its object, or for a `@react-three/rapier` body (whose ref is
 * the Rapier body) the body's object.
 */
function nodeOf(held: object | null): object | null {
  if (held === null || (held as { readonly isObject3D?: boolean }).isObject3D === true) return held;
  return godot_world_3d_declared_object(held) ?? null;
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

/** The virtual methods Godot calls on a script, by the binding slot each fills. */
const LIFECYCLE_METHODS = [
  ['enterTree', '_enter_tree'],
  ['ready', '_ready'],
  ['exitTree', '_exit_tree'],
  ['process', '_process'],
  ['physicsProcess', '_physics_process'],
  ['input', '_input'],
  ['shortcutInput', '_shortcut_input'],
  ['unhandledInput', '_unhandled_input'],
  ['unhandledKeyInput', '_unhandled_key_input'],
] as const;

/**
 * Attaches a script to the node its ref holds: the script instance over the mounted Object3D, its
 * authored exported values (`SceneState::instantiate` sets them after the instance exists,
 * packed_scene.cpp:494), and its virtual methods (the ones the script or its base scripts define)
 * registered with the Node protocol, which calls them on the SceneTree's clock. `autoloads` are
 * the autoload singletons the script reads, each by its field, as the refs the world mounts them
 * into. At project startup the enclosing startup transaction enters the tree; a node mounted
 * later enters at once.
 *
 * @godot Node (protocol)
 * @source scene/resources/packed_scene.cpp:494
 */
export function useGodotScript<Instance extends object>(
  ref: RefObject<object | null>,
  Script: new (native: object) => Instance,
  exported?: Partial<Instance>,
  autoloads?: Readonly<Record<string, RefObject<object | null> | undefined>>,
): void {
  const startup = useContext(GodotStartupContext);
  useEffect(() => {
    const native = nodeOf(ref.current);
    if (native === null) throw new Error('godot-compat: the node a script attaches to was not mounted.');
    const instance = new Script(native);
    SCRIPT_OF.set(native, instance);
    if (exported !== undefined) Object.assign(instance, exported);
    for (const [field, singleton] of Object.entries(autoloads ?? {})) {
      const value = singleton?.current;
      if (value === null || value === undefined) throw new Error(`godot-compat: the autoload ${field} reads was not mounted.`);
      (instance as Record<string, unknown>)[field] = value;
    }
    const methods = instance as unknown as Readonly<Record<string, unknown>>;
    const slots: Record<string, unknown> = {};
    for (const [slot, name] of LIFECYCLE_METHODS) {
      const method = methods[name];
      if (typeof method === 'function') slots[slot] = (...args: unknown[]) => (method as (...values: unknown[]) => unknown).apply(instance, args);
    }
    const binding = { native, owner: instance, ...slots } as GodotScriptLifecycleBinding;
    const attachment = { root: native, bindings: [binding], release: () => {} };
    if (startup !== null) return startup.register(attachment);
    return mountGodotScriptTree(native, [binding]);
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
}

/** Three's own transform props, which a spatial element hands its object. */
const THREE_TRANSFORM = new Set(['position', 'rotation', 'scale', 'quaternion', 'matrix', 'matrixAutoUpdate']);

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
  const { name, ref, children, ...properties } = props;
  const [entity] = useState(() => {
    const made = element.create();
    if (name !== undefined) made.name = name;
    godot_node_adopt(made, { kind: element.spatial ? 'spatial' : 'node', classes: element.classes });
    element.mount(made);
    for (const [property, value] of Object.entries(properties)) {
      if (element.spatial && THREE_TRANSFORM.has(property)) continue;
      const set = element.props.get(property);
      if (set === undefined) throw new Error(`godot-compat: ${element.classes[0] ?? 'a node'} has no ${property} prop`);
      (set as (entity: Entity, value: unknown) => void)(made, value);
    }
    return made;
  });
  const transform = element.spatial ? Object.fromEntries(Object.entries(properties).filter(([property]) => THREE_TRANSFORM.has(property))) : {};
  return createElement('primitive', { object: entity, ref, ...transform }, children);
}
