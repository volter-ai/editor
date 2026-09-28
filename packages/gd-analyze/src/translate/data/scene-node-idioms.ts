/**
 * The mapping from Godot node classes to the library idioms the scene writes them as
 * (docs/GODOT.md §The lane's law, row 3): the one plan-time table, which the planner reads to give
 * each node its idiom and to know which classes it writes at all. Emit writes the idiom and never
 * looks at the class.
 */

/** How a node is written. */
export type GodotSceneNodeIdiomForm =
  /** A compat element (`<GodotLabel text="…" />`): its authored properties as props, in order. */
  | { readonly kind: 'element'; readonly module: string; readonly exportName: string }
  /** A compat component taking the node's transform and its setters as props (`<GodotMarker3D />`). */
  | { readonly kind: 'component'; readonly module: string; readonly exportName: string }
  /** A plain Node: compat's non-spatial group, with no transform. */
  | { readonly kind: 'plain-node'; readonly module: string; readonly exportName: string }
  /** A Node3D: three's `<group>`. */
  | { readonly kind: 'group' }
  /** A MeshInstance3D: three's `<mesh>` with its surfaces' geometry and materials. */
  | { readonly kind: 'mesh' }
  /** A Light3D: three's `<directionalLight>` or `<pointLight>`. */
  | { readonly kind: 'light'; readonly directional: boolean }
  /** A Camera3D: drei's `<PerspectiveCamera>` with Godot's lens. */
  | { readonly kind: 'camera' }
  /** A ReflectionProbe: the game editor's reflections capability. */
  | { readonly kind: 'reflection-probe' }
  /** A physics body: `@react-three/rapier`'s `<RigidBody>` of a type, its colliders sensors or not. */
  | { readonly kind: 'body'; readonly type: 'fixed' | 'dynamic' | 'kinematicPosition'; readonly sensor: boolean }
  /** A CollisionShape3D: the Rapier collider its shape resource is. */
  | { readonly kind: 'collider' };

/** Where the pinned Godot source defines what the idiom reproduces. */
export interface GodotSceneNodeIdiomSource {
  readonly file: string;
  readonly symbol: string;
  readonly line: number;
}

export interface GodotSceneNodeIdiom {
  readonly form: GodotSceneNodeIdiomForm;
  /** The three object (or Rapier body) the element mounts, which a script's ref holds. */
  readonly three: string;
  /**
   * It draws with its scale removed (`disable_scale`, node_3d.cpp:655; set by Camera3D, Light3D and
   * ReflectionProbe): a leaf with no script states no scale.
   */
  readonly scaleless?: true;
  /** three's object starts off the origin (a DirectionalLight at `Object3D.DEFAULT_UP`); Godot's does not. */
  readonly origin?: true;
  /** The pinned Godot 4.7 source the idiom answers to: documentation, which nothing reads. */
  readonly source?: GodotSceneNodeIdiomSource;
}

/** A class's constructor in the pinned Godot source. */
const ctor = (className: string, file: string, line: number): GodotSceneNodeIdiomSource => ({
  file,
  symbol: `${className}::${className}`,
  line,
});

const element = (
  module: string,
  className: string,
  source: GodotSceneNodeIdiomSource,
  three = 'Group',
): GodotSceneNodeIdiom => ({
  form: { kind: 'element', module, exportName: `Godot${className}` },
  three,
  source,
});

/** Each node class the lane writes; a node of a class absent here is refused at plan time. */
const IDIOMS: Readonly<Record<string, GodotSceneNodeIdiom>> = {
  Node: {
    form: { kind: 'plain-node', module: 'react-lifecycle', exportName: 'GodotNode' },
    three: 'Group',
    source: ctor('Node', 'scene/main/node.cpp', 4092),
  },
  Node3D: { form: { kind: 'group' }, three: 'Group' },
  RayCast3D: {
    form: { kind: 'component', module: 'ray-cast-3d', exportName: 'GodotRayCast3D' },
    three: 'Group',
    source: ctor('RayCast3D', 'scene/3d/physics/ray_cast_3d.cpp', 564),
  },
  Marker3D: {
    form: { kind: 'component', module: 'marker-3d', exportName: 'GodotMarker3D' },
    three: 'Group',
    source: ctor('Marker3D', 'scene/3d/marker_3d.cpp', 54),
  },
  MeshInstance3D: {
    form: { kind: 'mesh' },
    three: 'Mesh',
    source: ctor('MeshInstance3D', 'scene/3d/mesh_instance_3d.cpp', 951),
  },
  DirectionalLight3D: {
    form: { kind: 'light', directional: true },
    three: 'DirectionalLight',
    scaleless: true,
    origin: true,
    source: ctor('DirectionalLight3D', 'scene/3d/light_3d.cpp', 612),
  },
  OmniLight3D: {
    form: { kind: 'light', directional: false },
    three: 'PointLight',
    scaleless: true,
    source: ctor('OmniLight3D', 'scene/3d/light_3d.cpp', 661),
  },
  Camera3D: {
    form: { kind: 'camera' },
    three: 'PerspectiveCamera',
    scaleless: true,
    source: ctor('Camera3D', 'scene/3d/camera_3d.cpp', 871),
  },
  ReflectionProbe: {
    form: { kind: 'reflection-probe' },
    three: 'Group',
    scaleless: true,
    source: ctor('ReflectionProbe', 'scene/3d/reflection_probe.cpp', 308),
  },
  StaticBody3D: {
    form: { kind: 'body', type: 'fixed', sensor: false },
    three: 'RapierRigidBody',
    source: ctor('StaticBody3D', 'scene/3d/physics/static_body_3d.cpp', 251),
  },
  Area3D: {
    form: { kind: 'body', type: 'fixed', sensor: true },
    three: 'RapierRigidBody',
    source: ctor('Area3D', 'scene/3d/physics/area_3d.cpp', 818),
  },
  RigidBody3D: {
    form: { kind: 'body', type: 'dynamic', sensor: false },
    three: 'RapierRigidBody',
    source: ctor('RigidBody3D', 'scene/3d/physics/rigid_body_3d.cpp', 829),
  },
  CharacterBody3D: {
    form: { kind: 'body', type: 'kinematicPosition', sensor: false },
    three: 'RapierRigidBody',
    source: ctor('CharacterBody3D', 'scene/3d/physics/character_body_3d.cpp', 966),
  },
  CollisionShape3D: {
    form: { kind: 'collider' },
    three: 'Group',
    source: ctor('CollisionShape3D', 'scene/3d/physics/collision_shape_3d.cpp', 325),
  },
  CanvasLayer: element('canvas-layer', 'CanvasLayer', ctor('CanvasLayer', 'scene/main/canvas_layer.cpp', 359)),
  Control: element('control', 'Control', ctor('Control', 'scene/gui/control.cpp', 5161)),
  HBoxContainer: element('h-box-container', 'HBoxContainer', ctor('HBoxContainer', 'scene/gui/box_container.h', 85)),
  Label: element('label', 'Label', ctor('Label', 'scene/gui/label.cpp', 1526)),
  TextureRect: element('texture-rect', 'TextureRect', ctor('TextureRect', 'scene/gui/texture_rect.cpp', 299)),
  Node2D: element('node-2d', 'Node2D', ctor('Node2D', 'scene/2d/node_2d.cpp', 519)),
  Sprite2D: element('sprite-2d', 'Sprite2D', ctor('Sprite2D', 'scene/2d/sprite_2d.cpp', 555)),
  TouchScreenButton: element(
    'touch-screen-button',
    'TouchScreenButton',
    ctor('TouchScreenButton', 'scene/2d/physics/touch_screen_button.cpp', 458),
  ),
  Label3D: element('label-3d', 'Label3D', ctor('Label3D', 'scene/3d/label_3d.cpp', 1082), 'Mesh'),
  AudioStreamPlayer: element(
    'audio-stream-player',
    'AudioStreamPlayer',
    ctor('AudioStreamPlayer', 'scene/audio/audio_stream_player.cpp', 302),
  ),
  AudioStreamPlayer3D: element(
    'audio-stream-player-3d',
    'AudioStreamPlayer3D',
    ctor('AudioStreamPlayer3D', 'scene/3d/audio_stream_player_3d.cpp', 974),
  ),
  GridMap: element('grid-map', 'GridMap', { file: 'modules/gridmap/grid_map.cpp', symbol: 'GridMap::_set (data)', line: 64 }),
  // Both particle nodes are a three.js particle system: an `InstancedMesh` of their mesh whose
  // instances their own emitter moves each frame; a GPUParticles3D's emitter reads its process material.
  CPUParticles3D: element('cpu-particles-3d', 'CPUParticles3D', ctor('CPUParticles3D', 'scene/3d/cpu_particles_3d.cpp', 1812)),
  GPUParticles3D: element('gpu-particles-3d', 'GPUParticles3D', ctor('GPUParticles3D', 'scene/3d/gpu_particles_3d.cpp', 933)),
  Decal: element('decal', 'Decal', ctor('Decal', 'scene/3d/decal.cpp', 294)),
  CSGBox3D: element('csg-box-3d', 'CSGBox3D', { file: 'modules/csg/csg_shape.cpp', symbol: 'CSGBox3D::_bind_methods', line: 1820 }, 'Mesh'),
  WorldEnvironment: element(
    'world-environment',
    'WorldEnvironment',
    ctor('WorldEnvironment', 'scene/3d/world_environment.cpp', 226),
  ),
  AnimationPlayer: element('animation-player', 'AnimationPlayer', {
    file: 'scene/animation/animation_mixer.cpp',
    symbol: 'AnimationMixer::_update_caches',
    line: 651,
  }),
  AnimationTree: element('animation-tree', 'AnimationTree', {
    file: 'scene/animation/animation_tree.cpp',
    symbol: 'AnimationTree::_blend_pre_process',
    line: 660,
  }),
};

/** The idiom a node of `className` is written as, or undefined when the lane writes none. */
export function godotSceneNodeIdiom(className: string): GodotSceneNodeIdiom | undefined {
  return Object.hasOwn(IDIOMS, className) ? IDIOMS[className] : undefined;
}
