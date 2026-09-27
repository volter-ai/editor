/**
 * Render node families: mesh instances over primitive meshes and materials, directional and omni
 * lights, written as three's own elements (`emit/scene-family-elements.ts`).
 */
import { GODOT_4_7_CODE_SEED_SOURCE_REVISION } from '../../code/authority/godot-4.7-seed';
import type {
  GodotSceneNodeRule,
  GodotSceneResourceRule,
  GodotSceneStructureRule,
} from '../scene-node-authority';

const REVISION = GODOT_4_7_CODE_SEED_SOURCE_REVISION;
const identityOf = (className: string) => `${REVISION}\0ClassDB\0${className}`;

type Source = Readonly<{ file: string; symbol: string; line: number }>;

export const GODOT_4_7_RENDER_NODE_RULES: readonly (GodotSceneNodeRule & { readonly source: Source })[] = [
  {
    sourceRevision: REVISION,
    nativeCanonicalIdentity: identityOf('MeshInstance3D'),
    targetKind: 'three-mesh',
    source: { file: 'scene/3d/mesh_instance_3d.cpp', symbol: 'MeshInstance3D::MeshInstance3D', line: 951 },
  },
  {
    sourceRevision: REVISION,
    nativeCanonicalIdentity: identityOf('DirectionalLight3D'),
    targetKind: 'three-directional-light',
    source: { file: 'scene/3d/light_3d.cpp', symbol: 'DirectionalLight3D::DirectionalLight3D', line: 612 },
  },
  {
    sourceRevision: REVISION,
    nativeCanonicalIdentity: identityOf('OmniLight3D'),
    targetKind: 'three-point-light',
    source: { file: 'scene/3d/light_3d.cpp', symbol: 'OmniLight3D::OmniLight3D', line: 661 },
  },
];

export const GODOT_4_7_RENDER_RESOURCE_RULES: readonly (GodotSceneResourceRule & { readonly source: Source })[] = (
  [
    ['PlaneMesh', 'plane-mesh', 'scene/resources/3d/primitive_meshes.h', 253],
    ['QuadMesh', 'quad-mesh', 'scene/resources/3d/primitive_meshes.h', 291],
    ['SphereMesh', 'sphere-mesh', 'scene/resources/3d/primitive_meshes.h', 340],
    ['CylinderMesh', 'cylinder-mesh', 'scene/resources/3d/primitive_meshes.h', 200],
    ['StandardMaterial3D', 'standard-material-3d', 'scene/resources/material.h', 920],
  ] as const
).map(([className, module, file, line]) => ({
  sourceRevision: REVISION,
  className,
  construct: { module: `lib/godot-compat/${module}`, exportName: 'construct' },
  source: { file, symbol: `${className}::${className}`, line },
}));

/** Imported models. */
export const GODOT_4_7_IMPORTED_STRUCTURE_RULES: readonly (GodotSceneStructureRule & { readonly source: Source })[] = [
  {
    sourceRevision: REVISION,
    id: 'imported-scene',
    source: { file: 'editor/import/3d/resource_importer_scene.cpp', symbol: 'ResourceImporterScene::import', line: 3174 },
  },
  {
    sourceRevision: REVISION,
    id: 'imported-scene-edits',
    source: { file: 'scene/resources/packed_scene.cpp', symbol: 'SceneState::instantiate (editable children)', line: 540 },
  },
];

export const GODOT_4_7_RENDER_STRUCTURE_RULES: readonly (GodotSceneStructureRule & { readonly source: Source })[] = [
  {
    sourceRevision: REVISION,
    id: 'property-setter',
    source: { file: 'scene/resources/packed_scene.cpp', symbol: 'SceneState::instantiate (node->set)', line: 400 },
  },
];
