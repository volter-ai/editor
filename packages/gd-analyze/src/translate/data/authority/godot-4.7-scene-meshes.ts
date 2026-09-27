/**
 * Mesh resources: an `ArrayMesh` saved as a `.res`/`.tres`, its surfaces decoded at translation and
 * constructed by `godot_array_mesh_new`.
 */
import { GODOT_4_7_CODE_SEED_SOURCE_REVISION } from '../../code/authority/godot-4.7-seed';
import type { GodotSceneResourceRule } from '../scene-node-authority';

const REVISION = GODOT_4_7_CODE_SEED_SOURCE_REVISION;

type Source = Readonly<{ file: string; symbol: string; line: number }>;

export const GODOT_4_7_MESH_RESOURCE_RULES: readonly (GodotSceneResourceRule & { readonly source: Source })[] = [
  {
    sourceRevision: REVISION,
    className: 'ArrayMesh',
    construct: { module: 'lib/godot-compat/array-mesh', exportName: 'godot_array_mesh_new' },
    source: { file: 'scene/resources/mesh.cpp', symbol: 'ArrayMesh::_set_surfaces', line: 1587 },
  },
];
