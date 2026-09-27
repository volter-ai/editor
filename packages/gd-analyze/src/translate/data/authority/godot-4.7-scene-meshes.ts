/**
 * Mesh resources: an `ArrayMesh` saved as a `.res`/`.tres`, its surfaces decoded at translation and
 * constructed by `godot_array_mesh_new`.
 */
import { GODOT_4_7_CODE_SEED_SOURCE_REVISION } from '../../code/authority/godot-4.7-seed';
import type { GodotSceneNodeRule, GodotSceneResourceRule } from '../scene-node-authority';

const REVISION = GODOT_4_7_CODE_SEED_SOURCE_REVISION;

type Source = Readonly<{ file: string; symbol: string; line: number }>;

const identityOf = (className: string) => `${REVISION}\0ClassDB\0${className}`;

/** Label3D: a three mesh the compat binding draws its text on. */
export const GODOT_4_7_MESH_NODE_RULES: readonly (GodotSceneNodeRule & { readonly source: Source })[] = [
  {
    sourceRevision: REVISION,
    nativeCanonicalIdentity: identityOf('Label3D'),
    targetKind: 'three-mesh',
    source: { file: 'scene/3d/label_3d.cpp', symbol: 'Label3D::Label3D', line: 1082 },
  },
];

export const GODOT_4_7_MESH_RESOURCE_RULES: readonly (GodotSceneResourceRule & { readonly source: Source })[] = [
  {
    sourceRevision: REVISION,
    className: 'ArrayMesh',
    construct: { module: 'lib/godot-compat/array-mesh', exportName: 'godot_array_mesh_new' },
    source: { file: 'scene/resources/mesh.cpp', symbol: 'ArrayMesh::_set_surfaces', line: 1587 },
  },
];
