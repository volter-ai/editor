import { GODOT_4_7_CODE_SEED_SOURCE_REVISION } from '../../code/authority/godot-4.7-seed';
import type {
  GodotSceneNodeRule,
  GodotScenePlacementRule,
  GodotScenePropertyRule,
  GodotSceneSignalRule,
  GodotSceneStructureRule,
} from '../scene-node-authority';

const NODE_3D_IDENTITY = `${GODOT_4_7_CODE_SEED_SOURCE_REVISION}\0ClassDB\0Node3D`;

export const GODOT_4_7_SCENE_NODE_RULES: readonly GodotSceneNodeRule[] = [
  {
    sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
    nativeCanonicalIdentity: NODE_3D_IDENTITY,
    targetKind: 'three-group',
  },
];

export const GODOT_4_7_SCENE_PLACEMENT_RULES: readonly GodotScenePlacementRule[] = [
  {
    sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
    placement: 'child',
    targetOperation: 'native-child',
  },
];

export const GODOT_4_7_SCENE_PROPERTY_RULES: readonly GodotScenePropertyRule[] = [
  {
    sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
    nativeCanonicalIdentity: NODE_3D_IDENTITY,
    propertyName: 'position',
    serializedValue: 'ctor:Vector3(number,number,number)',
    targetKind: 'three-position',
  },
  {
    sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
    nativeCanonicalIdentity: NODE_3D_IDENTITY,
    propertyName: 'rotation',
    serializedValue: 'ctor:Vector3(number,number,number)',
    targetKind: 'three-rotation-yxz',
  },
  {
    sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
    nativeCanonicalIdentity: NODE_3D_IDENTITY,
    propertyName: 'scale',
    serializedValue: 'ctor:Vector3(number,number,number)',
    targetKind: 'three-scale',
  },
];
const REVISION = GODOT_4_7_CODE_SEED_SOURCE_REVISION;
const identityOf = (className: string) => `${REVISION}\0ClassDB\0${className}`;

type Source = Readonly<{ file: string; symbol: string; line: number }>;

export const GODOT_4_7_STRUCTURE_NODE_RULES: readonly (GodotSceneNodeRule & { readonly source: Source })[] = [
  {
    sourceRevision: REVISION,
    nativeCanonicalIdentity: identityOf('Node'),
    targetKind: 'three-node',
    source: { file: 'scene/main/node.cpp', symbol: 'Node::Node', line: 4092 },
  },
  {
    sourceRevision: REVISION,
    nativeCanonicalIdentity: identityOf('Camera3D'),
    targetKind: 'three-perspective-camera',
    source: { file: 'scene/3d/camera_3d.cpp', symbol: 'Camera3D::Camera3D', line: 871 },
  },
];

export const GODOT_4_7_STRUCTURE_PROPERTY_RULES: readonly (GodotScenePropertyRule & { readonly source: Source })[] = [
  {
    sourceRevision: REVISION,
    nativeCanonicalIdentity: identityOf('Node3D'),
    propertyName: 'transform',
    serializedValue: 'ctor:Transform3D(number*12)',
    targetKind: 'three-matrix',
    source: { file: 'scene/3d/node_3d.cpp', symbol: 'Node3D::set_transform', line: 399 },
  },
  ...(
    [
      ['fov', 'camera-fov', 737],
      ['near', 'camera-near', 749],
      ['far', 'camera-far', 759],
    ] as const
  ).map(([propertyName, targetKind, line]) => ({
    sourceRevision: REVISION,
    nativeCanonicalIdentity: identityOf('Camera3D'),
    propertyName,
    serializedValue: 'number' as const,
    targetKind,
    source: { file: 'scene/3d/camera_3d.cpp', symbol: `Camera3D::set_${propertyName}`, line },
  })),
];

export const GODOT_4_7_STRUCTURE_RULES: readonly (GodotSceneStructureRule & { readonly source: Source })[] = [
  {
    sourceRevision: REVISION,
    id: 'scene-instance',
    source: { file: 'scene/resources/packed_scene.cpp', symbol: 'SceneState::instantiate (instance)', line: 233 },
  },
  {
    sourceRevision: REVISION,
    id: 'instance-root-override',
    source: { file: 'scene/resources/packed_scene.cpp', symbol: 'SceneState::instantiate (properties)', line: 400 },
  },
  {
    sourceRevision: REVISION,
    id: 'instance-children',
    source: { file: 'scene/resources/packed_scene.cpp', symbol: 'SceneState::instantiate (parent)', line: 540 },
  },
  {
    sourceRevision: REVISION,
    id: 'node-groups',
    source: { file: 'scene/resources/packed_scene.cpp', symbol: 'SceneState::instantiate (groups)', line: 511 },
  },
  {
    sourceRevision: REVISION,
    id: 'unique-name',
    source: { file: 'scene/main/node.cpp', symbol: 'Node::set_unique_name_in_owner', line: 2248 },
  },
  {
    sourceRevision: REVISION,
    id: 'authored-order',
    source: { file: 'scene/resources/packed_scene.cpp', symbol: 'SceneState::instantiate (node order)', line: 186 },
  },
];

/** Node signals the composition connects authored `[connection]`s from, through node.ts. */
export const GODOT_4_7_SIGNAL_RULES: readonly (GodotSceneSignalRule & { readonly source: Source })[] = [
  {
    sourceRevision: REVISION,
    ownerClass: 'Node',
    signal: 'ready',
    accessor: { module: 'lib/godot-compat/node', exportName: 'godot_node_ready_signal', named: false },
    arguments: 0,
    source: { file: 'scene/resources/packed_scene.cpp', symbol: 'SceneState::instantiate (connections)', line: 682 },
  },
  {
    sourceRevision: REVISION,
    ownerClass: 'Node',
    signal: 'tree_entered',
    accessor: { module: 'lib/godot-compat/node', exportName: 'godot_node_tree_signal', named: true },
    arguments: 0,
    source: { file: 'scene/resources/packed_scene.cpp', symbol: 'SceneState::instantiate (connections)', line: 682 },
  },
];
