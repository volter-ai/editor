/**
 * Render node families: mesh instances over primitive meshes and materials, directional and omni
 * lights, written as three's own elements (`emit/scene-family-elements.ts`).
 */
import { GODOT_4_7_CODE_SEED_SOURCE_REVISION } from '../../code/authority/godot-4.7-seed';
import type {
  GodotSceneResourceRule,
  GodotSceneStructureRule,
} from '../scene-node-authority';

const REVISION = GODOT_4_7_CODE_SEED_SOURCE_REVISION;

type Source = Readonly<{ file: string; symbol: string; line: number }>;

export const GODOT_4_7_RENDER_RESOURCE_RULES: readonly (GodotSceneResourceRule & { readonly source: Source })[] = (
  [
    ['PlaneMesh', 'plane-mesh', 'scene/resources/3d/primitive_meshes.h', 253],
    ['QuadMesh', 'quad-mesh', 'scene/resources/3d/primitive_meshes.h', 291],
    ['SphereMesh', 'sphere-mesh', 'scene/resources/3d/primitive_meshes.h', 340],
    ['CylinderMesh', 'cylinder-mesh', 'scene/resources/3d/primitive_meshes.h', 200],
    ['BoxMesh', 'box-mesh', 'scene/resources/3d/primitive_meshes.h', 192],
    ['StandardMaterial3D', 'standard-material-3d', 'scene/resources/material.h', 920],
    ['CameraAttributesPractical', 'camera-attributes-practical', 'scene/resources/camera_attributes.cpp', 306],
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
