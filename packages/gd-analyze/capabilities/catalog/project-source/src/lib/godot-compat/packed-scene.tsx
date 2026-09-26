/**
 * @godot-class PackedScene
 * @role BINDING
 *
 * Godot 4.7's imported scene (`editor/import/3d/resource_importer_scene.cpp` over
 * `modules/gltf/gltf_document.cpp`, revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto
 * three's glTF loader. Godot's importer builds its own node tree from the file: it synthesizes a
 * root, a `Skeleton3D` per skin (the joints become its bones, not nodes) and an `AnimationPlayer`,
 * reparents skinned meshes under their skeleton, and names every node with its own uniquifier.
 * three's loader keeps the file's tree. The translated scene hands this component Godot's tree (the
 * importer model in `read/gltf-godot-scene.ts`: each node's Godot name, class chain, local
 * transform and, for a node the file backs, its glTF `nodes[]` index); the component loads the
 * file, and makes each Godot node the three object the loader made for that glTF node (a
 * synthesized node a new group), under Godot's parent, with Godot's name and transform, adopted
 * by the Node protocol. Objects Godot has no node for (a skeleton's bones, a multi-surface mesh's
 * per-surface meshes) stay where the loader put them, unadopted, so `get_node` never sees them.
 */

import { createPortal, type ThreeElements, useLoader } from '@react-three/fiber';
import { createElement, type ReactNode, useLayoutEffect, useMemo, useRef } from 'react';
import { Group, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { godot_node_adopt } from './node';

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
}

/** A node the instancing scene places under a node of the imported tree. */
export interface GodotImportedScenePlacement {
  readonly at: string;
  readonly element: ReactNode;
}

type GroupProps = Omit<ThreeElements['group'], 'ref'>;

interface BuiltTree {
  readonly byPath: ReadonlyMap<string, Object3D>;
  readonly depthOne: readonly Object3D[];
}

/** The loaded file's objects as Godot's imported tree, on a private clone of the loaded scene. */
function buildTree(scene: Object3D, associations: ReadonlyMap<Object3D, { readonly nodes?: number }>, nodes: readonly GodotImportedSceneNode[]): BuiltTree {
  const copy = cloneSkinned(scene);
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
  return { byPath, depthOne };
}

/**
 * An instanced imported model: its root (this group, the instancing scene's node) and Godot's
 * imported tree under it, with the instancing scene's placements portalled into its nodes.
 *
 * @godot PackedScene (protocol)
 * @source editor/import/3d/resource_importer_scene.cpp:3174
 */
export function GodotImportedScene({
  url,
  rootClasses,
  nodes,
  placements = [],
  overrides = [],
  children,
  ...props
}: GroupProps & {
  readonly url: string;
  readonly rootClasses: readonly string[];
  readonly nodes: readonly GodotImportedSceneNode[];
  readonly placements?: readonly GodotImportedScenePlacement[];
  /** The instancing scene's authored properties on the model's nodes, by their setters. */
  readonly overrides?: readonly { readonly at: string; readonly apply: (entity: Object3D) => void }[];
  readonly children?: ReactNode;
}) {
  const gltf = useLoader(GLTFLoader, url);
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
    for (const node of nodes) {
      const member = tree.byPath.get(node.path) as Object3D;
      godot_node_adopt(member, {
        classes: node.classes,
        owner: entity,
        ...(node.nonSpatial === true ? { kind: 'node' as const } : {}),
      });
    }
    // Godot sets the instancing scene's values on the instantiated nodes (`SceneState::instantiate`,
    // packed_scene.cpp:400).
    for (const override of overrides) {
      const target = tree.byPath.get(override.at);
      if (target === undefined) throw new Error(`godot-compat: the imported tree has no node ${override.at}`);
      override.apply(target);
    }
    return () => {
      for (const child of tree.depthOne) entity.remove(child);
    };
  }, [tree, nodes, rootClasses, overrides]);
  return createElement(
    'group',
    { ...props, ref: root },
    children,
    placements.map((placement) => {
      const target = tree.byPath.get(placement.at);
      if (target === undefined) throw new Error(`godot-compat: the imported tree has no node ${placement.at}`);
      return createPortal(placement.element, target);
    }),
  );
}
