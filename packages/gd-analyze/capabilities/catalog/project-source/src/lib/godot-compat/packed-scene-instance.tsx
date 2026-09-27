/**
 * @godot-class PackedScene
 * @role BINDING
 *
 * Godot 4.7's `PackedScene` as a script instantiates it (`scene/resources/packed_scene.cpp`,
 * revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a project scene's resource is the scene
 * component the translation writes for it (`ShotScene`), one resource per path, as the resource
 * cache keeps one (`ResourceCache`, `core/io/resource.cpp`). `instantiate()` mounts that same
 * component, through one spawn host inside `<GodotMain>`, as a portal into a group outside the tree
 * (so R3F's store, the `<Physics>` world and the autoloads reach it), synchronously with R3F's
 * `flushSync`: its nodes exist, its scripts are constructed and seated, and it is not in the tree,
 * as `SceneState::instantiate` returns it. A script's `add_child` enters it; freeing its root exits
 * it (compat's Node protocol) and then unmounts the component.
 */

import { createPortal, flushSync } from '@react-three/fiber';
import { type ComponentType, createElement, Fragment, type ReactElement, useLayoutEffect, useState } from 'react';
import { Group, type Object3D } from 'three';
import { godot_node_adopt, godot_node_object, seatGodotScriptForest } from './node';
import { godot_world_3d_declare_detached } from './world-3d';

/** A project scene as a resource: its path and the scene component written for it. */
export interface PackedScene {
  readonly resource_path: string;
  readonly component: ComponentType<Record<string, never>>;
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
export function godot_packed_scene_preload(path: string, component: ComponentType<Record<string, never>>): PackedScene {
  let scene = PRELOADED.get(path);
  if (scene === undefined) {
    scene = Object.freeze({ resource_path: path, component });
    PRELOADED.set(path, scene);
  }
  return scene;
}

interface SpawnEntry {
  readonly id: number;
  readonly scene: PackedScene;
  readonly container: Group;
}

let serial = 0;
let host: { readonly add: (entry: SpawnEntry) => void; readonly remove: (entry: SpawnEntry) => void } | undefined;

/**
 * The one place instantiated scenes mount: each as a portal into its own group, which no node of
 * the tree holds until a script adds the scene's root.
 *
 * @godot PackedScene (protocol)
 * @source scene/resources/packed_scene.cpp:318
 */
export function GodotSpawnHost(): ReactElement {
  const [entries, setEntries] = useState<readonly SpawnEntry[]>([]);
  useLayoutEffect(() => {
    host = {
      add: (entry) => setEntries((list) => [...list, entry]),
      remove: (entry) => setEntries((list) => list.filter((candidate) => candidate !== entry)),
    };
    return () => {
      host = undefined;
    };
  }, []);
  return createElement(
    Fragment,
    null,
    entries.map((entry) => createElement(Fragment, { key: entry.id }, createPortal(createElement(entry.scene.component), entry.container))),
  );
}

/**
 * Mounts the scene's component outside the tree and returns its root (its script instance when
 * scripted). `edit_state` only matters in the editor. React cannot mount synchronously while it is
 * committing, which is where a scene script's `_init` runs (its component constructs it): an
 * instantiate from there fails by name.
 *
 * @godot PackedScene.instantiate
 * @source scene/resources/packed_scene.cpp:2507
 */
export function instantiate(self: PackedScene, edit_state = 0): unknown {
  void edit_state;
  if (host === undefined) throw new Error('godot-compat: PackedScene.instantiate needs <GodotMain> mounted.');
  const entry: SpawnEntry = { id: (serial += 1), scene: self, container: new Group() };
  const spawn = host;
  flushSync(() => spawn.add(entry));
  const root = entry.container.children[0] as Object3D | undefined;
  if (root === undefined) {
    spawn.remove(entry);
    throw new Error(
      `godot-compat: PackedScene.instantiate(${self.resource_path}) ran while React was committing (a scene script's _init); it cannot mount there.`,
    );
  }
  // The scene's bodies are declared, and held out of the space until the root enters the tree.
  godot_world_3d_declare_detached();
  seatGodotScriptForest([root], []);
  // The root belongs to the spawn host: added and removed by compat, and freed by dropping it.
  godot_node_adopt(root, {
    authority: {
      create: () => {
        throw new Error('godot-compat: an instantiated scene root makes no nodes.');
      },
      attach: (parent, child) => (parent as Object3D).add(child as Object3D),
      detach: (parent, child) => (parent as Object3D).remove(child as Object3D),
      destroy: () => flushSync(() => spawn.remove(entry)),
    },
  });
  return godot_node_object(root);
}
