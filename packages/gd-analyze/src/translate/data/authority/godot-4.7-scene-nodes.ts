import { GODOT_4_7_CODE_SEED_SOURCE_REVISION } from '../../code/authority/godot-4.7-seed';
import type {
  GodotScenePlacementRule,
  GodotScenePropertyRule,
  GodotSceneSignalRule,
  GodotSceneStructureRule,
} from '../scene-node-authority';

const NODE_3D_IDENTITY = `${GODOT_4_7_CODE_SEED_SOURCE_REVISION}\0ClassDB\0Node3D`;

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
  ...(
    [
      ['Timer', 'timeout', 'timer', 'timeout', 0, 'scene/main/timer.cpp', 243],
      ['AnimatedSprite3D', 'animation_finished', 'animated-sprite-3d', 'animation_finished', 0, 'scene/3d/sprite_3d.cpp', 1484],
      ['AnimatedSprite3D', 'animation_looped', 'animated-sprite-3d', 'animation_looped', 0, 'scene/3d/sprite_3d.cpp', 1483],
      ['AnimatedSprite3D', 'frame_changed', 'animated-sprite-3d', 'frame_changed', 0, 'scene/3d/sprite_3d.cpp', 1480],
      ['AnimatedSprite2D', 'animation_finished', 'animated-sprite-2d', 'animation_finished', 0, 'scene/2d/animated_sprite_2d.cpp', 612],
      ['AnimatedSprite2D', 'animation_looped', 'animated-sprite-2d', 'animation_looped', 0, 'scene/2d/animated_sprite_2d.cpp', 611],
      ['AnimatedSprite2D', 'frame_changed', 'animated-sprite-2d', 'frame_changed', 0, 'scene/2d/animated_sprite_2d.cpp', 610],
      ['CollisionObject2D', 'mouse_entered', 'collision-object-2d', 'mouse_entered', 0, 'scene/2d/physics/collision_object_2d.cpp', 631],
      ['CollisionObject2D', 'mouse_exited', 'collision-object-2d', 'mouse_exited', 0, 'scene/2d/physics/collision_object_2d.cpp', 632],
      ['CollisionObject2D', 'input_event', 'collision-object-2d', 'input_event', 3, 'scene/2d/physics/collision_object_2d.cpp', 630],
      ['GPUParticles2D', 'finished', 'gpu-particles-2d', 'finished', 0, 'scene/2d/gpu_particles_2d.cpp', 928],
      ['BaseButton', 'pressed', 'base-button', 'pressed', 0, 'scene/gui/base_button.cpp', 480],
      ['BaseButton', 'button_down', 'base-button', 'button_down', 0, 'scene/gui/base_button.cpp', 482],
      ['BaseButton', 'button_up', 'base-button', 'button_up', 0, 'scene/gui/base_button.cpp', 481],
      ['BaseButton', 'toggled', 'base-button', 'toggled', 1, 'scene/gui/base_button.cpp', 483],
      ['Range', 'value_changed', 'range', 'value_changed', 1, 'scene/gui/range.cpp', 400],
      ['Range', 'changed', 'range', 'changed', 0, 'scene/gui/range.cpp', 401],
      ['Slider', 'drag_started', 'h-slider', 'drag_started', 0, 'scene/gui/slider.cpp', 462],
      ['Slider', 'drag_ended', 'h-slider', 'drag_ended', 1, 'scene/gui/slider.cpp', 463],
      ['Area2D', 'body_entered', 'area-2d', 'body_entered', 1, 'scene/2d/physics/area_2d.cpp', 590],
      ['Area2D', 'body_exited', 'area-2d', 'body_exited', 1, 'scene/2d/physics/area_2d.cpp', 591],
      ['Area2D', 'area_entered', 'area-2d', 'area_entered', 1, 'scene/2d/physics/area_2d.cpp', 594],
      ['Area2D', 'area_exited', 'area-2d', 'area_exited', 1, 'scene/2d/physics/area_2d.cpp', 595],
      ['RigidBody2D', 'body_entered', 'rigid-body-2d', 'body_entered', 1, 'scene/2d/physics/rigid_body_2d.cpp', 844],
      ['VisibleOnScreenNotifier2D', 'screen_entered', 'visible-on-screen-notifier-2d', 'screen_entered', 0, 'scene/2d/visible_on_screen_notifier_2d.cpp', 185],
      ['VisibleOnScreenNotifier2D', 'screen_exited', 'visible-on-screen-notifier-2d', 'screen_exited', 0, 'scene/2d/visible_on_screen_notifier_2d.cpp', 186],
      ['VisibleOnScreenNotifier3D', 'screen_entered', 'visible-on-screen-notifier-3d', 'screen_entered', 0, 'scene/3d/visible_on_screen_notifier_3d.cpp', 101],
      ['VisibleOnScreenNotifier3D', 'screen_exited', 'visible-on-screen-notifier-3d', 'screen_exited', 0, 'scene/3d/visible_on_screen_notifier_3d.cpp', 102],
      ['RigidBody2D', 'body_exited', 'rigid-body-2d', 'body_exited', 1, 'scene/2d/physics/rigid_body_2d.cpp', 845],
    ] as const
  ).map(([ownerClass, signal, module, exportName, argumentCount, file, line]) => ({
    sourceRevision: REVISION,
    ownerClass,
    signal,
    accessor: { module: `lib/godot-compat/${module}`, exportName, named: false },
    arguments: argumentCount,
    source: { file, symbol: `${ownerClass}::_bind_methods (${signal})`, line },
  })),
];

/**
 * A signal the source node's script declares (`signal name(...)`): `Object::connect` finds it
 * through the script instance when the class has none of that name (object.cpp:1536), so an
 * authored `[connection]` from it reaches the script's own Signal field (react-lifecycle.ts).
 */
export const GODOT_4_7_SCRIPT_SIGNAL_RULE: Omit<GodotSceneSignalRule, 'ownerClass' | 'signal' | 'arguments'> & { readonly source: Source } = {
  sourceRevision: REVISION,
  accessor: { module: 'lib/godot-compat/react-lifecycle', exportName: 'godot_node_script_signal', named: true },
  source: { file: 'core/object/object.cpp', symbol: 'Object::connect (script signals)', line: 1536 },
};
