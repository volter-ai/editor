/**
 * GridMap: a `GridMap` node (`<GodotGridMap>`, its cells a data file, drawn as InstancedMeshes, its
 * cells' shapes one fixed body standing for the GridMap) and its `MeshLibrary` (a data file of
 * items and shapes, the items' meshes the scene's own).
 */
import { GODOT_4_7_CODE_SEED_SOURCE_REVISION } from '../../code/authority/godot-4.7-seed';
import type { GodotSceneNodeRule, GodotSceneResourceRule } from '../scene-node-authority';

const REVISION = GODOT_4_7_CODE_SEED_SOURCE_REVISION;

type Source = Readonly<{ file: string; symbol: string; line: number }>;

const identityOf = (className: string) => `${REVISION}\0ClassDB\0${className}`;

export const GODOT_4_7_GRIDMAP_NODE_RULES: readonly (GodotSceneNodeRule & { readonly source: Source })[] = [
  {
    sourceRevision: REVISION,
    nativeCanonicalIdentity: identityOf('GridMap'),
    targetKind: 'three-group',
    source: { file: 'modules/gridmap/grid_map.cpp', symbol: 'GridMap::_set (data)', line: 64 },
  },
];

export const GODOT_4_7_GRIDMAP_RESOURCE_RULES: readonly (GodotSceneResourceRule & { readonly source: Source })[] = [
  {
    sourceRevision: REVISION,
    className: 'MeshLibrary',
    construct: { module: 'lib/godot-compat/mesh-library', exportName: 'godot_mesh_library_new' },
    source: { file: 'scene/resources/3d/mesh_library.cpp', symbol: 'MeshLibrary::_set', line: 41 },
  },
];
