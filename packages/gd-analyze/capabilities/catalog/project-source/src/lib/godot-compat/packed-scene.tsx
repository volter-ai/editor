/**
 * @godot-class PackedScene
 * @role BINDING
 *
 * Godot 4.7's imported scene (`editor/import/3d/resource_importer_scene.cpp` over
 * `modules/gltf/gltf_document.cpp`, revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto
 * drei's `useGLTF`. Godot's importer builds its own node tree from the file: it synthesizes a
 * root, a `Skeleton3D` per skin (the joints become its bones, not nodes) and an `AnimationPlayer`,
 * reparents skinned meshes under their skeleton, and names every node with its own uniquifier.
 * three's loader keeps the file's tree. The translated scene hands this component Godot's tree (the
 * importer model in `read/gltf-godot-scene.ts`, as the model's data file: each node's Godot name,
 * class chain, local transform and, for a node the file backs, its glTF `nodes[]` index); the
 * scene writes `<GodotImportedScene src tree overrides>`, its own children as JSX children and the
 * nodes it places under a node of the model inside `<GodotPlaced at="Path">`; the component loads the
 * file, and makes each Godot node the three object the loader made for that glTF node (a
 * synthesized node a new group), under Godot's parent, with Godot's name and transform, adopted
 * by the Node protocol; a Skeleton3D's bones are the loader's joint objects in Godot's bone order.
 * Objects Godot has no node for (a skeleton's bones, a multi-surface mesh's
 * per-surface meshes) stay where the loader put them, unadopted, so `get_node` never sees them.
 *
 * Not yet transcribed: the importer applies a model's `RESET` animation before saving the scene
 * (`resource_importer_scene.cpp:3400`), which re-poses its bones; here each bone keeps the pose the
 * importer's skeleton gives it (`skin_tool.cpp:636`), which the RESET keys can differ from.
 */

import { useGLTF } from '@react-three/drei';
import { createPortal, type ThreeElements } from '@react-three/fiber';
import { createContext, createElement, type ReactNode, useContext, useLayoutEffect, useMemo, useRef } from 'react';
import { Group, type Object3D } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { godot_animation_player_mount, godot_animation_player_set_prop } from './animation-player';
import { godot_node_adopt, godot_node_foreign } from './node';
import { construct as quaternion } from './quaternion';
import { godot_skeleton_3d_bind, set_bone_pose_position, set_bone_pose_rotation, set_bone_pose_scale } from './skeleton-3d';
import { construct as vector3 } from './vector3';

/** One node of the imported tree, below its root, in `Node::get_children` depth-first order. */
export interface GodotImportedSceneNode {
  /** Relative to the imported root (`Skeleton/Skeleton3D`). */
  readonly path: string;
  readonly name: string;
  /** The Godot class and its native ancestors, nearest first. */
  readonly classes: readonly string[];
  /** A plain `Node` (not a Node3D): mounted non-spatial. */
  readonly nonSpatial?: true;
  /** The glTF `nodes[]` index the importer made this node from; absent for a synthesized node. */
  readonly gltfNode?: number;
  /** Godot's local transform, column-major (the Object3D matrix). */
  readonly matrix: readonly number[];
  /** A Skeleton3D's bones in Godot's bone order: name, glTF joint node and the imported pose. */
  readonly bones?: readonly {
    readonly name: string;
    readonly gltfNode: number;
    readonly pose: {
      readonly position: readonly [number, number, number];
      readonly rotation: readonly [number, number, number, number];
      readonly scale: readonly [number, number, number];
    };
  }[];
}

/** The importer's tree of a model, as its data file holds it. */
export interface GodotImportedSceneTree {
  readonly rootClasses: readonly string[];
  readonly nodes: readonly GodotImportedSceneNode[];
}

const BONE_POSE = /^bones\/(\d+)\/(position|rotation|scale)$/u;

/**
 * One property the instancing scene sets on a node of the model, by its Godot name, through the
 * node's setter: a Skeleton3D's bone poses (`Skeleton3D::_set`, `skeleton_3d.cpp:118`).
 */
function applyOverride(entity: Object3D, property: string, value: unknown): void {
  // An AnimationPlayer's properties: its track bindings, libraries, autoplay (`animation-player.ts`).
  if (ANIMATION_PLAYERS.has(entity)) {
    godot_animation_player_set_prop(entity, property, value);
    return;
  }
  const bone = BONE_POSE.exec(property);
  if (bone === null) throw new Error(`godot-compat: an imported model's node has no overridable property ${property}.`);
  const index = Number(bone[1]);
  const components = value as readonly number[];
  if (bone[2] === 'rotation') set_bone_pose_rotation(entity, index, quaternion(...(components as [number, number, number, number])));
  else if (bone[2] === 'position') set_bone_pose_position(entity, index, vector3(...(components as [number, number, number])));
  else set_bone_pose_scale(entity, index, vector3(...(components as [number, number, number])));
}

/** The model's AnimationPlayers: made the class's node (`godot_animation_player_mount`). */
const ANIMATION_PLAYERS = new WeakSet<Object3D>();

/** The loaded tree's nodes by path, for the nodes a scene places under them. */
const TreeContext = createContext<ReadonlyMap<string, Object3D> | null>(null);

/**
 * Nodes the instancing scene places under a node of the imported model (`at`, its path in the
 * model): mounted as that node's children.
 *
 * @godot PackedScene (protocol)
 * @source scene/resources/packed_scene.cpp:540
 */
export function GodotPlaced({ at, children }: { readonly at: string; readonly children?: ReactNode }) {
  const byPath = useContext(TreeContext);
  const target = byPath?.get(at);
  if (target === undefined) throw new Error(`godot-compat: the imported tree has no node ${at}`);
  return createPortal(children, target);
}

type GroupProps = Omit<ThreeElements['group'], 'ref'>;

interface BuiltTree {
  /** Every object the loader made (a Godot node or not). */
  readonly loaded: readonly Object3D[];
  readonly byPath: ReadonlyMap<string, Object3D>;
  readonly byIndex: ReadonlyMap<number, Object3D>;
  readonly depthOne: readonly Object3D[];
}

/** The loaded file's objects as Godot's imported tree, on a private clone of the loaded scene. */
function buildTree(scene: Object3D, associations: ReadonlyMap<Object3D, { readonly nodes?: number }>, nodes: readonly GodotImportedSceneNode[]): BuiltTree {
  const copy = cloneSkinned(scene);
  const loaded: Object3D[] = [];
  copy.traverse((object) => loaded.push(object));
  // The clone has the loaded scene's shape: walk both together to find each glTF node's copy.
  const byIndex = new Map<number, Object3D>();
  const pair = (source: Object3D, target: Object3D): void => {
    const index = associations.get(source)?.nodes;
    if (index !== undefined && !byIndex.has(index)) byIndex.set(index, target);
    source.children.forEach((child, i) => pair(child, target.children[i] as Object3D));
  };
  pair(scene, copy);
  const byPath = new Map<string, Object3D>();
  const depthOne: Object3D[] = [];
  for (const node of nodes) {
    const entity = node.gltfNode === undefined ? new Group() : byIndex.get(node.gltfNode);
    if (entity === undefined) throw new Error(`godot-compat: the loaded model has no glTF node ${node.gltfNode}`);
    entity.name = node.name;
    entity.matrixAutoUpdate = false;
    entity.matrix.fromArray(node.matrix as number[]);
    entity.matrix.decompose(entity.position, entity.quaternion, entity.scale);
    const slash = node.path.lastIndexOf('/');
    if (slash < 0) {
      entity.removeFromParent();
      depthOne.push(entity);
    } else {
      const parent = byPath.get(node.path.slice(0, slash));
      if (parent === undefined) throw new Error(`godot-compat: ${node.path} has no parent in the imported tree`);
      parent.add(entity);
    }
    byPath.set(node.path, entity);
  }
  return { loaded, byPath, byIndex, depthOne };
}

/**
 * An instanced imported model: its root (this group, the instancing scene's node) and Godot's
 * imported tree under it, with the instancing scene's placements portalled into its nodes.
 *
 * @godot PackedScene (protocol)
 * @source editor/import/3d/resource_importer_scene.cpp:3174
 */
export function GodotImportedScene({
  src,
  tree: model,
  overrides = {},
  children,
  ...props
}: GroupProps & {
  readonly src: string;
  readonly tree: GodotImportedSceneTree;
  /** The instancing scene's properties on the model's nodes: by node path, by Godot name. */
  readonly overrides?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly children?: ReactNode;
}) {
  const gltf = useGLTF(src);
  const { rootClasses, nodes } = model;
  const tree = useMemo(
    () => buildTree(gltf.scene, gltf.parser.associations as ReadonlyMap<Object3D, { readonly nodes?: number }>, nodes),
    [gltf, nodes],
  );
  const root = useRef<Group | null>(null);
  useLayoutEffect(() => {
    const entity = root.current;
    if (entity === null) return;
    godot_node_adopt(entity, { classes: rootClasses });
    // The imported tree's own children come first, before the instancing scene's (Godot adds
    // those after instantiating the imported scene, packed_scene.cpp:540).
    tree.depthOne.forEach((child, index) => {
      entity.add(child);
      entity.children.splice(entity.children.indexOf(child), 1);
      entity.children.splice(index, 0, child);
    });
    // What the loader made that Godot's importer has no node for is not a node.
    const members = new Set(tree.byPath.values());
    for (const object of tree.loaded) if (!members.has(object)) godot_node_foreign(object);
    for (const node of nodes) {
      const member = tree.byPath.get(node.path) as Object3D;
      godot_node_adopt(member, {
        classes: node.classes,
        owner: entity,
        ...(node.nonSpatial === true ? { kind: 'node' as const } : {}),
      });
      // The importer's AnimationPlayer is the class's node, which the instancing scene may set up.
      if (node.classes[0] === 'AnimationPlayer' && !ANIMATION_PLAYERS.has(member)) {
        godot_animation_player_mount(member);
        ANIMATION_PLAYERS.add(member);
      }
    }
    // A skeleton's bones are the loader's joint objects, in Godot's bone order.
    for (const node of nodes) {
      if (node.bones === undefined) continue;
      godot_skeleton_3d_bind(
        tree.byPath.get(node.path) as Object3D,
        node.bones.map((bone) => {
          const object = tree.byIndex.get(bone.gltfNode);
          if (object === undefined) throw new Error(`godot-compat: the loaded model has no joint node ${bone.gltfNode}`);
          return { object, name: bone.name, pose: bone.pose };
        }),
      );
    }
    // Godot sets the instancing scene's values on the instantiated nodes (`SceneState::instantiate`,
    // packed_scene.cpp:400).
    for (const [at, properties] of Object.entries(overrides)) {
      const target = tree.byPath.get(at);
      if (target === undefined) throw new Error(`godot-compat: the imported tree has no node ${at}`);
      for (const [property, value] of Object.entries(properties)) applyOverride(target, property, value);
    }
    return () => {
      for (const child of tree.depthOne) entity.remove(child);
    };
  }, [tree, nodes, rootClasses, overrides]);
  return createElement(
    'group',
    { ...props, ref: root },
    createElement(TreeContext.Provider, { value: tree.byPath }, children),
  );
}
