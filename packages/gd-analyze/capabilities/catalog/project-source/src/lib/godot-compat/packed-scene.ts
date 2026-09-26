/**
 * `PackedScene.instance()` — the canonical Godot spawn idiom, as a caller-fed
 * factory registry.
 *
 * ## This is a demand the member table could not requisition
 *
 * `Main.gd:3` is `export(PackedScene) var mob_scene`, and `Main.gd:31` is
 * `var mob = mob_scene.instance()`. `gd-analyze` reports BOTH as unresolved:
 * its walker deliberately discards an export hint's arguments (they name TYPES,
 * not values), so `mob_scene` is untyped, and the `mob` that comes back carries
 * that through to `.position`, `.rotation` and `.linear_velocity`. All four of
 * the pilot's unresolved rows are this one root cause.
 *
 * The measurement recorded that gap rather than closing it, so `PackedScene.
 * instance` and `RigidBody2D.linear_velocity` are real demands of this game
 * that its member table cannot cite. They are implemented here and in
 * `physics-2d.ts` on the strength of the source. Executable compat dispatch is
 * now the only shipped runtime declaration; reports derive from it directly.
 *
 * ## Why a registry rather than a scene loader
 *
 * Godot's `PackedScene` is a serialized node tree the engine can stamp out.
 * There is no such artifact after translation: a `.tscn` becomes emitted
 * TypeScript that builds its own Pixi subtree. So "instancing a scene" is
 * calling that constructor — and the only thing compat can usefully own is the
 * NAME→constructor mapping, because GDScript addresses the scene through a
 * variable whose value is a resource path.
 *
 * ```ts
 * const scenes = createSceneRegistry();
 * registerScene(scenes, 'res://Mob.tscn', () => new Mob(tree));
 * const mob = instanceScene(scenes, 'res://Mob.tscn');
 * ```
 *
 * Nothing is loaded, nothing is parsed, nothing is cached: `instance()` is one
 * `Map` read and one call. A registry that also fetched would be a resource
 * system, which is the machinery this capability exists without.
 *
 * ## Resource ownership
 *
 * **Owns:** one `Map` of factories. **Shares:** nothing — a factory is the
 * caller's function and the `Container` it returns is the caller's from the
 * moment it exists. **Teardown:** dropping the registry drops the map; the
 * nodes it minted are the scene tree's, freed through `queue_free`.
 */

import { Container } from 'pixi.js';
import {
  bindGodotResourceProtocol,
  getGodotResourcePath,
  registerGodotResourceFactory,
} from './resource-io';
import type { SceneTree } from './scene-tree';
import {
  godotObjectBindingOf,
  godotObjectIsClass,
  registerGodotObjectIdentity,
} from './object';
import { duplicateNode2D } from './node';

/** Builds one instance of a translated scene. The emitted class's constructor.
 *  `TNode` is the port's node type — a Pixi `Container` by default, a
 *  `THREE.Object3D` for a 3D port, exactly as `SceneTree`'s is. */
export type SceneFactory<TNode extends object = Container> = () => TNode;

/** The `res://…` path -> factory map `instance()` reads. */
export interface SceneRegistry<TNode extends object = Container> {
  readonly factories: Map<string, SceneFactory<TNode>>;
}

export interface GodotPackedSceneResource<TNode extends object = object> {
  pack(node: TNode): number;
  can_instantiate(): boolean;
  can_instance(): boolean;
  instantiate(): TNode;
  instance(): TNode;
}

/**
 * A translated `.tscn` as the Resource value returned by `ResourceLoader`.
 *
 * The renderer-owned `scenes` table remains the sole constructor/mount registry. This object only
 * retains the PackedScene's exact document identity, just as Godot's Resource retains
 * `resource_path`; it never guesses a path from a caller or rebuilds the scene graph itself.
 */
const TRANSLATED_PACKED_SCENE_PATHS = new WeakMap<object, string>();
type TranslatedPackedSceneFactory = (context: unknown) => object;
const TRANSLATED_PACKED_SCENE_FACTORIES = new Map<string, TranslatedPackedSceneFactory[]>();

function translatedPackedSceneResource(path: string): object {
  const resource = {};
  TRANSLATED_PACKED_SCENE_PATHS.set(resource, path);
  registerGodotObjectIdentity(resource, 'PackedScene');
  bindGodotResourceProtocol(resource, {
    createDuplicate: () => translatedPackedSceneResource(path),
  });
  return resource;
}

/**
 * Expose one translated scene document through the ordinary ResourceLoader registry.
 *
 * Generated worlds call this from their existing `res://…` -> component table. Consequently a
 * threaded or direct ResourceLoader request returns a retained PackedScene identity, while the
 * actual scene replacement still goes through that world's existing mount registry.
 */
export function registerGodotTranslatedPackedScene(
  path: string,
  instantiate?: TranslatedPackedSceneFactory,
): () => void {
  if (!path.startsWith('res://') || !path.endsWith('.tscn')) {
    throw new TypeError(
      `godot-compat: translated PackedScene registration requires a res://*.tscn path; received ${JSON.stringify(path)}.`,
    );
  }
  const releaseResource = registerGodotResourceFactory(path, () => translatedPackedSceneResource(path));
  if (instantiate !== undefined) {
    const factories = TRANSLATED_PACKED_SCENE_FACTORIES.get(path) ?? [];
    factories.push(instantiate);
    TRANSLATED_PACKED_SCENE_FACTORIES.set(path, factories);
  }
  return () => {
    if (instantiate !== undefined) {
      const factories = TRANSLATED_PACKED_SCENE_FACTORIES.get(path);
      const index = factories?.lastIndexOf(instantiate) ?? -1;
      if (index >= 0) factories?.splice(index, 1);
      if (factories?.length === 0) TRANSLATED_PACKED_SCENE_FACTORIES.delete(path);
    }
    releaseResource();
  };
}

/**
 * Godot 4 `SceneTree.change_scene_to_packed(packed_scene)` for a runtime Resource value.
 *
 * `ResourceLoader.load[_threaded_get]` can erase the document from static analysis, but it does
 * not erase it at runtime: the registered PackedScene retains both ClassDB identity and its exact
 * resource path. The SceneTree then delegates to the generated world's translated-scene mount
 * table through `changeScene`; no scene is parsed, cloned, or guessed here.
 */
export function godotSceneTreeChangeSceneToPacked<TNode extends object>(
  tree: SceneTree<TNode>,
  packedScene: unknown,
  major: 3 | 4,
): number {
  if (!godotObjectIsClass(packedScene, 'PackedScene', major)) {
    throw new TypeError(
      'godot-compat: SceneTree.change_scene_to_packed requires retained PackedScene identity.',
    );
  }
  const object = godotObjectBindingOf(packedScene).value;
  const translatedPath = TRANSLATED_PACKED_SCENE_PATHS.get(object);
  const resourcePath = getGodotResourcePath(object);
  const path = translatedPath ?? resourcePath;
  if (path === '' || !path.startsWith('res://') || !path.endsWith('.tscn')) {
    throw new Error(
      'godot-compat: SceneTree.change_scene_to_packed received a PackedScene without a retained translated res://*.tscn identity.',
    );
  }
  return tree.changeScene(path);
}

function clonePackedNode<TNode extends object>(node: TNode): TNode {
  if (node instanceof Container) return duplicateNode2D(node) as TNode;
  const clone = Reflect.get(node, 'clone');
  if (typeof clone !== 'function') {
    throw new Error(
      'godot-compat: PackedScene.pack requires a retained native node with clone(true) semantics.',
    );
  }
  return clone.call(node, true) as TNode;
}

/** Runtime-created PackedScene Resource retaining an immutable native node-tree snapshot. */
export function createGodotPackedScene<TNode extends object = object>(): GodotPackedSceneResource<TNode> {
  let snapshot: TNode | null = null;
  const scene: GodotPackedSceneResource<TNode> = {
    pack(node): number {
      if (typeof node !== 'object' || node === null) {
        throw new TypeError('godot-compat: PackedScene.pack requires a retained Node root.');
      }
      snapshot = clonePackedNode(node);
      return 0;
    },
    can_instantiate(): boolean {
      return snapshot !== null;
    },
    can_instance(): boolean {
      return snapshot !== null;
    },
    instantiate(): TNode {
      if (snapshot === null) {
        throw new Error('godot-compat: PackedScene.instantiate called before pack().');
      }
      return clonePackedNode(snapshot);
    },
    instance(): TNode {
      return scene.instantiate();
    },
  };
  registerGodotObjectIdentity(scene, 'PackedScene');
  return bindGodotResourceProtocol(scene, {
    createDuplicate(source) {
      const duplicate = createGodotPackedScene<TNode>();
      if (snapshot !== null) duplicate.pack(snapshot);
      return duplicate as typeof source;
    },
  });
}

/** Build an empty registry. One per mounted game. */
export function createSceneRegistry<TNode extends object = Container>(): SceneRegistry<TNode> {
  return { factories: new Map<string, SceneFactory<TNode>>() };
}

/**
 * Declare how one scene is instanced.
 *
 * `path` is the `res://…` the `.tscn`'s `ext_resource` uses, kept verbatim so
 * the emitted `export(PackedScene)` assignment and this registration are
 * obviously the same string.
 *
 * @throws on a duplicate registration. Two factories for one scene means one of
 * them is dead code, and silently keeping the last is how a port ends up
 * spawning the wrong node an hour later.
 */
export function registerScene<TNode extends object>(
  registry: SceneRegistry<TNode>,
  path: string,
  factory: SceneFactory<TNode>,
): void {
  if (registry.factories.has(path)) {
    throw new Error(
      `godot-compat: "${path}" is already registered in this SceneRegistry. A scene has one ` +
        'constructor; registering a second silently retires the first.',
    );
  }
  registry.factories.set(path, factory);
}

/**
 * `packed_scene.instance()` — `Main.gd:31`.
 *
 * @throws naming the path and every registered scene. Godot returns `null` for
 * a failed instance and the next line fails somewhere else entirely.
 */
export function instanceScene<TNode extends object>(
  registry: SceneRegistry<TNode>,
  path: string,
): TNode {
  const factory = registry.factories.get(path);
  if (factory === undefined) {
    const known = [...registry.factories.keys()].sort();
    throw new Error(
      `godot-compat: PackedScene.instance() has no factory for "${path}". Registered: ` +
        `${known.length === 0 ? '(none)' : known.join(', ')}. A translated .tscn registers its ` +
        'own constructor with registerScene(); compat never loads a scene file.',
    );
  }
  return factory();
}

/** Instantiate one translated scene selected from a source-proven finite PackedScene set. */
export function instanceTranslatedPackedScene<TNode extends object>(
  packedScene: unknown,
  factories: Readonly<Record<string, SceneFactory<TNode>>>,
): TNode {
  const retained = typeof packedScene === 'object' && packedScene !== null
    ? TRANSLATED_PACKED_SCENE_PATHS.get(godotObjectBindingOf(packedScene).value)
    : undefined;
  const path = typeof packedScene === 'string' ? packedScene : retained;
  if (path === undefined) {
    throw new TypeError(
      'godot-compat: translated PackedScene dispatch requires a retained resource or res:// path token.',
    );
  }
  const factory = Object.hasOwn(factories, path) ? factories[path] : undefined;
  if (factory === undefined) {
    throw new Error(
      `godot-compat: translated PackedScene ${JSON.stringify(path)} is outside the source-proven factory set.`,
    );
  }
  return factory();
}

/**
 * Runtime dispatch for a statically open Resource/Variant receiver.
 *
 * The ClassDB binding is the authority: a plain object which happens to expose an
 * `instance`/`instantiate` function is never accepted. Known-document PackedScenes keep their
 * compile-time scene-class lowering; this path is for retained runtime PackedScene Resources.
 */
export function godotOpenPackedSceneInstantiate(
  major: 3 | 4,
  method: 'instance' | 'instantiate',
  receiver: unknown,
  args: readonly unknown[],
  context?: unknown,
): object {
  const expected = major === 3 ? 'instance' : 'instantiate';
  if (method !== expected) {
    throw new TypeError(`godot-compat: PackedScene.${method} is not declared in Godot ${major}.`);
  }
  if (args.length > 1) {
    throw new TypeError(`godot-compat: PackedScene.${method} accepts zero or one argument.`);
  }
  const editState = args[0] ?? 0;
  const maximumEditState = major === 3 ? 2 : 3;
  if (
    typeof editState !== 'number' || !Number.isSafeInteger(editState) ||
    editState < 0 || editState > maximumEditState
  ) {
    throw new TypeError(
      `godot-compat: PackedScene.${method} edit_state requires Godot ${major} ` +
        `GenEditState 0..${maximumEditState}.`,
    );
  }
  if (editState !== 0) {
    throw new Error(
      `godot-compat: PackedScene.${method} editor-owned GenEditState ${editState} is unavailable in an exported runtime.`,
    );
  }
  const retainedBinding = typeof receiver === 'object' && receiver !== null
    ? godotObjectBindingOf(receiver)
    : undefined;
  const translatedPath = typeof receiver === 'string'
    ? receiver
    : retainedBinding === undefined
      ? undefined
      : TRANSLATED_PACKED_SCENE_PATHS.get(retainedBinding.value);
  if (translatedPath !== undefined) {
    const factories = TRANSLATED_PACKED_SCENE_FACTORIES.get(translatedPath);
    const instantiate = factories?.[factories.length - 1];
    if (instantiate === undefined) {
      throw new Error(
        `godot-compat: translated PackedScene ${JSON.stringify(translatedPath)} has no active constructor.`,
      );
    }
    return instantiate(context);
  }
  const binding = retainedBinding ?? godotObjectBindingOf(receiver);
  if (!godotObjectIsClass(receiver, 'PackedScene', major)) {
    throw new TypeError(
      `godot-compat: PackedScene.${method} requires retained PackedScene identity; received ${binding.godotClass}.`,
    );
  }
  const resource = binding.value as Partial<GodotPackedSceneResource<object>>;
  const instantiate = major === 3 ? resource.instance : resource.instantiate;
  if (typeof instantiate !== 'function') {
    throw new Error(
      `godot-compat: retained PackedScene has no native ${method} owner; arbitrary Resource carriers are refused.`,
    );
  }
  return instantiate.call(resource);
}
