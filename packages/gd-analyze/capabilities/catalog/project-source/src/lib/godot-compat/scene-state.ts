/**
 * @godot-class SceneState
 * @role BINDING
 *
 * Godot 4.7's `SceneState` (`scene/resources/packed_scene.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) of an imported model: its nodes in the importer's
 * order (the root first), each with its class and the properties the importer stored on it. A
 * MeshInstance3D stores its `mesh`: the glTF node's surfaces, each its geometry and material, as a
 * mesh resource (`mesh.ts`).
 */

import type { BufferGeometry, Material, Mesh as ThreeMesh, Object3D, Texture } from 'three';
import { godot_base_material_3d_of } from './base-material-3d';
import { godot_mesh_register, type GodotMeshSurface } from './mesh';
import { godot_node_adopt } from './node';
import { godot_imported_scene_load, type GodotImportedSceneTree } from './packed-scene';
import { godot_resource_loader_track } from './resource-loader';

interface StateNode {
  readonly type: string;
  readonly properties: readonly (readonly [string, () => unknown])[];
}

export interface SceneState {
  readonly nodes: readonly StateNode[];
}

const STATES = new WeakMap<object, SceneState>();

/** A glTF node's meshes (one per primitive) as a mesh resource's surfaces. */
function meshOf(object: Object3D): object | null {
  const meshes: ThreeMesh[] = [];
  if ((object as ThreeMesh).isMesh === true) meshes.push(object as ThreeMesh);
  else for (const child of object.children) if ((child as ThreeMesh).isMesh === true && child.name.startsWith(object.name)) meshes.push(child as ThreeMesh);
  if (meshes.length === 0) return null;
  const surfaces: GodotMeshSurface[] = meshes.map((mesh) => {
    const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as Material | undefined;
    return {
      geometry: mesh.geometry as BufferGeometry,
      material: material === undefined ? null : godot_base_material_3d_of(material, true),
      arrays: () => [],
    };
  });
  const resource = {};
  godot_node_adopt(resource, { classes: ['ArrayMesh', 'Mesh', 'Resource', 'RefCounted', 'Object'] });
  godot_mesh_register(resource, () => surfaces);
  return resource;
}

/**
 * Loads a model PackedScene's file and records its state (the importer's tree over the loaded
 * glTF), tracked so the scenes mount once it is there.
 *
 * @godot SceneState (protocol)
 * @source scene/resources/packed_scene.cpp:1407
 */
export function godot_scene_state_model_load(scene: object, model: { readonly src: string; readonly tree: GodotImportedSceneTree; readonly images?: Readonly<Record<number, Texture>> }): void {
  godot_resource_loader_track(
    godot_imported_scene_load(model.src, model.tree, model.images).then((gltf) => {
      const associations = (gltf.parser as { readonly associations: ReadonlyMap<Object3D, { readonly nodes?: number }> }).associations;
      const byIndex = new Map<number, Object3D>();
      gltf.scene.traverse((object) => {
        const index = associations.get(object)?.nodes;
        if (index !== undefined && !byIndex.has(index)) byIndex.set(index, object);
      });
      const nodes: StateNode[] = [{ type: model.tree.rootClasses[0] ?? 'Node3D', properties: [] }];
      for (const node of model.tree.nodes) {
        const object = node.gltfNode === undefined ? undefined : byIndex.get(node.gltfNode);
        const type = node.classes[0] ?? 'Node';
        const properties: (readonly [string, () => unknown])[] = [];
        if (object !== undefined && node.classes.includes('MeshInstance3D')) {
          let mesh: object | null | undefined;
          properties.push(['mesh', () => (mesh === undefined ? (mesh = meshOf(object)) : mesh)]);
        }
        nodes.push({ type, properties });
      }
      STATES.set(scene, { nodes });
    }),
  );
}

/**
 * @godot SceneState (protocol)
 * @source scene/resources/packed_scene.cpp:2120
 */
export function godot_scene_state_of(scene: object): SceneState | undefined {
  return STATES.get(scene);
}

function nodeAt(self: SceneState, index: number): StateNode {
  const node = self.nodes[index];
  if (node === undefined) throw new Error(`godot-compat: SceneState has no node ${String(index)}`);
  return node;
}

/**
 * @godot SceneState.get_node_count
 * @source scene/resources/packed_scene.cpp:1407
 */
export function get_node_count(self: SceneState): number {
  return self.nodes.length;
}

/**
 * @godot SceneState.get_node_type
 * @source scene/resources/packed_scene.cpp:1412
 */
export function get_node_type(self: SceneState, idx: number): string {
  return nodeAt(self, idx).type;
}

/**
 * @godot SceneState.get_node_property_count
 * @source scene/resources/packed_scene.cpp:1510
 */
export function get_node_property_count(self: SceneState, idx: number): number {
  return nodeAt(self, idx).properties.length;
}

/**
 * @godot SceneState.get_node_property_name
 * @source scene/resources/packed_scene.cpp:1516
 */
export function get_node_property_name(self: SceneState, idx: number, prop_idx: number): string {
  return nodeAt(self, idx).properties[prop_idx]?.[0] ?? '';
}

/**
 * @godot SceneState.get_node_property_value
 * @source scene/resources/packed_scene.cpp:1523
 */
export function get_node_property_value(self: SceneState, idx: number, prop_idx: number): unknown {
  return nodeAt(self, idx).properties[prop_idx]?.[1]() ?? null;
}
