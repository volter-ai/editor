/**
 * @godot-class PackedScene
 * @role BINDING
 *
 * Godot 4.7's `PackedScene` as a script instantiates it (`scene/resources/packed_scene.cpp`,
 * revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a project scene's resource is the scene
 * component the translation writes for it (`ShotScene`), one resource per path, as the resource
 * cache keeps one (`ResourceCache`, `core/io/resource.cpp`).
 *
 * Adding a scene is React state: `instantiate()` makes the scene's root script instance over a
 * stand-in node, which the script configures (its transform, its fields) before `add_child`; then
 * `add_child` is a state update of the scene component that owns the parent, which renders the
 * scene component as a portal into the parent's object, flushed at once, as Godot's `add_child`
 * returns with the child in the tree. The mounted root stands for the stand-in from then on, its
 * transform the stand-in's, and the script instance is the one the script already holds. Freeing
 * the root removes it from that state.
 */

import { createPortal, flushSync } from '@react-three/fiber';
import { type ComponentType, createContext, createElement, Fragment, type ReactNode } from 'react';
import { Group, type Object3D } from 'three';
import { type GodotAddedScenes, godot_node_add_unmounted, godot_node_added_scenes, godot_node_adopt, godot_node_object, godot_node_stand_in } from './node';

/** A scene component. */
export type GodotSceneComponent = ComponentType<Record<string, unknown>>;

/** A project scene as a resource: its path, the scene component written for it and its root's script. */
export interface PackedScene {
  readonly resource_path: string;
  readonly component: GodotSceneComponent;
  readonly rootScript: (new (native: object) => object) | undefined;
}

const PRELOADED = new Map<string, PackedScene>();

/**
 * The scene resource at `path`, made once: every `preload` of the path yields the same resource
 * (`GDScriptParser` preloads through `ResourceLoader::load`, which returns the cached one,
 * `core/io/resource_loader.cpp:801`).
 *
 * @godot PackedScene (protocol)
 * @source core/io/resource_loader.cpp:801
 */
export function godot_packed_scene_preload(
  path: string,
  component: GodotSceneComponent,
  rootScript?: new (native: object) => object,
): PackedScene {
  let scene = PRELOADED.get(path);
  if (scene === undefined) {
    scene = Object.freeze({ resource_path: path, component, rootScript });
    PRELOADED.set(path, scene);
  }
  return scene;
}

/** An instantiated scene: its root's stand-in and script instance, and once added, where it mounts. */
export interface GodotPendingScene {
  readonly scene: PackedScene;
  readonly standIn: Object3D;
  readonly instance: object | undefined;
  /** The object the scene is added under: the portal's container. */
  container: Object3D | undefined;
  /** The root React mounted for it. */
  mounted: object | undefined;
}

/** One scene added under a node: the state its owning scene component renders. */
export interface GodotSpawn {
  readonly id: number;
  readonly pending: GodotPendingScene;
}

const PENDING = new WeakMap<object, GodotPendingScene>();

/** The instantiated scene a scene component is mounted for, which its root claims. */
export const GodotPendingSceneContext = createContext<GodotPendingScene | undefined>(undefined);

/**
 * Makes the scene's root script instance over a stand-in node and returns it (the stand-in when the
 * root has no script), outside the tree, as `SceneState::instantiate` returns the scene. The scene
 * mounts when a script adds it. `edit_state` only matters in the editor.
 *
 * @godot PackedScene.instantiate
 * @source scene/resources/packed_scene.cpp:2507
 */
export function instantiate(self: PackedScene, edit_state = 0): unknown {
  void edit_state;
  const standIn = new Group();
  godot_node_adopt(standIn, { kind: 'spatial' });
  const Script = self.rootScript;
  const instance = Script === undefined ? undefined : new Script(standIn);
  if (instance !== undefined) godot_node_adopt(standIn, { binding: { owner: instance } });
  PENDING.set(standIn, { scene: self, standIn, instance, container: undefined, mounted: undefined });
  return godot_node_object(standIn);
}

/**
 * Makes a scene component the one that renders the scenes added under its nodes: its root's
 * added scenes are the component's state (the nearest scene root at or above the parent renders
 * a scene added under it); the returned call ends it, as the component unmounts.
 *
 * @godot PackedScene (protocol)
 * @source scene/main/node.cpp:1711
 */
export function godot_packed_scene_spawner(
  root: object,
  update: (change: (spawns: readonly GodotSpawn[]) => readonly GodotSpawn[]) => void,
): () => void {
  const added: GodotAddedScenes = {
    add: (spawn) => update((spawns) => [...spawns, spawn as GodotSpawn]),
    remove: (spawn) => update((spawns) => spawns.filter((candidate) => candidate !== spawn)),
  };
  godot_node_adopt(root, { addedScenes: added });
  return () => {
    if (godot_node_added_scenes(root) === added) godot_node_adopt(root, { addedScenes: null });
  };
}

/** The added scenes of the scene holding `parent`, or for the tree's root, of a scene below it. */
function spawnerOf(parent: Object3D): GodotAddedScenes | undefined {
  return godot_node_added_scenes(parent) ?? parent.children.map((child) => godot_node_added_scenes(child)).find((found) => found !== undefined);
}

let serial = 0;

// `add_child` of an instantiated scene: the owning scene component's state gains it, flushed at
// once, so the scene is mounted (its scripts attached) when `add_child` goes on to enter it.
godot_node_add_unmounted((parent, child) => {
  const pending = PENDING.get(child);
  if (pending === undefined) return undefined;
  if (pending.container !== undefined) throw new Error('godot-compat: an instantiated scene was added twice.');
  const spawner = spawnerOf(parent as Object3D);
  if (spawner === undefined) throw new Error('godot-compat: no scene holds the node an instantiated scene was added to.');
  pending.container = parent as Object3D;
  const spawn: GodotSpawn = { id: (serial += 1), pending };
  flushSync(() => spawner.add(spawn));
  const mounted = pending.mounted;
  if (mounted === undefined) {
    throw new Error(
      `godot-compat: ${pending.scene.resource_path} was added while React was committing (a _ready or an effect); it cannot mount there.`,
    );
  }
  // Freeing the root removes the scene from its owner's state.
  godot_node_adopt(mounted, {
    authority: {
      create: () => {
        throw new Error('godot-compat: an instantiated scene root makes no nodes.');
      },
      attach: (to, node) => (to as Object3D).add(node as Object3D),
      detach: (from, node) => (from as Object3D).remove(node as Object3D),
      destroy: () => flushSync(() => spawner.remove(spawn)),
    },
  });
  return mounted;
});

/**
 * The scene root a component mounted for an instantiated scene claims it: the mounted root stands
 * for the stand-in from then on. True when `root` is that scene's root (the object mounted directly
 * under the node it was added to).
 *
 * @godot PackedScene (protocol)
 * @source scene/resources/packed_scene.cpp:318
 */
export function godot_packed_scene_claim(pending: GodotPendingScene | undefined, root: object): boolean {
  if (pending === undefined || pending.mounted !== undefined || (root as Object3D).parent !== pending.container) return false;
  pending.mounted = root;
  godot_node_stand_in(pending.standIn, root);
  return true;
}

/**
 * The parts of the stand-in's transform a script set, as the scene root's props: none for a root
 * left at the origin (a Control or plain Node root takes no 3D transform).
 */
function transformOf(standIn: Object3D): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  if (standIn.position.lengthSq() !== 0) props['position'] = standIn.position.toArray();
  if (standIn.quaternion.w !== 1) props['quaternion'] = standIn.quaternion.toArray();
  if (standIn.scale.x !== 1 || standIn.scale.y !== 1 || standIn.scale.z !== 1) props['scale'] = standIn.scale.toArray();
  return props;
}

/**
 * The added scenes a scene component renders: each its scene component as a portal into the node
 * it was added under, with the transform a script gave the stand-in, and the instantiated scene in
 * context for its root to claim.
 *
 * @godot PackedScene (protocol)
 * @source scene/main/node.cpp:1711
 */
export function godot_packed_scene_portals(spawns: readonly GodotSpawn[]): ReactNode {
  return spawns.map(({ id, pending }) =>
    createElement(
      Fragment,
      { key: id },
      createPortal(
        createElement(
          GodotPendingSceneContext.Provider,
          { value: pending },
          createElement(pending.scene.component, transformOf(pending.standIn)),
        ),
        pending.container as Object3D,
      ),
    ),
  );
}
