/**
 * The mapping from Godot node classes to the library idioms the scene writes them as
 * (docs/GODOT.md §The lane's law, row 3): the one plan-time table, which the planner reads to give
 * each node its idiom and to know which classes it writes at all. Emit writes the idiom and never
 * looks at the class.
 */

/** How a node is written. */
export type GodotSceneNodeIdiomForm =
  /**
   * A compat element (`<GodotLabel text="…" />`): its authored properties as props, in order; with
   * `statesClasses`, the scene states the node's classes in its `userData` for the element.
   */
  | { readonly kind: 'element'; readonly module: string; readonly exportName: string; readonly statesClasses?: true }
  /** A compat component taking the node's transform and its setters as props (`<GodotMarker3D />`). */
  | { readonly kind: 'component'; readonly module: string; readonly exportName: string }
  /** A plain Node: compat's non-spatial group, with no transform. */
  | { readonly kind: 'plain-node'; readonly module: string; readonly exportName: string }
  /** A Node3D: three's `<group>`. */
  | { readonly kind: 'group' }
  /** A MeshInstance3D: three's `<mesh>` with its surfaces' geometry and materials. */
  | { readonly kind: 'mesh' }
  /** A Light3D: three's `<directionalLight>` or `<pointLight>`. */
  | { readonly kind: 'light'; readonly directional: boolean; readonly spot?: true }
  /** A Camera3D: drei's `<PerspectiveCamera>` with Godot's lens. */
  | { readonly kind: 'camera' }
  /** A ReflectionProbe: the game editor's reflections capability. */
  | { readonly kind: 'reflection-probe' }
  /** A physics body: `@react-three/rapier`'s `<RigidBody>` of a type, its colliders sensors or not. */
  | {
      readonly kind: 'body';
      readonly type: 'fixed' | 'dynamic' | 'kinematicPosition';
      readonly sensor: boolean;
      /** A dynamic body's mass when its scene sets none (its constructor's; RigidBody3D's is 1). */
      readonly mass?: number;
      /** A compat component the body renders inside itself, which drives it (a vehicle's controller). */
      readonly driver?: { readonly module: string; readonly exportName: string };
    }
  /** A CollisionShape3D: the Rapier collider its shape resource is. */
  | { readonly kind: 'collider' }
  /**
   * A Control (or a Node2D among Controls) as the React DOM element its scene renders
   * (`scene-control-idioms.ts`): its tag, how it lays out its children (a row, a column, a stack of
   * them in one cell, or centred), what it draws inside itself, its `mouse_filter` unless stated,
   * whether it draws its panel stylebox, whether it is placed as a Node2D, and the compat module
   * whose bindings its scripts call on the element.
   */
  | {
      readonly kind: 'dom';
      readonly module: string;
      readonly tag: 'div' | 'button' | 'label' | 'input';
      readonly layout: 'none' | 'row' | 'column' | 'stack' | 'center';
      readonly content: 'none' | 'text' | 'button' | 'check' | 'range' | 'image' | 'texture-button' | 'progress' | 'separator' | 'touch' | 'color';
      readonly mouseFilter: 0 | 1 | 2;
      readonly panel?: true;
      readonly node2d?: true;
    };

/**
 * The props an instancing scene hands a scene rooted in the node (its name, transform, children,
 * …), which the scene's component spreads onto its root element.
 */
export type GodotSceneRootPropsForm =
  /** A compat type of props, with its children placed under the root (`GodotSceneRootProps`). */
  | { readonly kind: 'compat'; readonly module: string; readonly name: string }
  /** The root component's own props (`Parameters<typeof GodotMarker3D>[0]`), children included. */
  | { readonly kind: 'component' }
  /** A library's props type, less its ref where it takes one; children placed under it or not. */
  | { readonly kind: 'library'; readonly module: string; readonly name: string; readonly omitRef: boolean; readonly children: boolean }
  /** R3F's props of the root's intrinsic element (`ThreeElements['group']`), less its ref. */
  | { readonly kind: 'three-element' };

/** Where the pinned Godot source defines what the idiom reproduces. */
export interface GodotSceneNodeIdiomSource {
  readonly file: string;
  readonly symbol: string;
  readonly line: number;
}

export interface GodotSceneNodeIdiom {
  readonly form: GodotSceneNodeIdiomForm;
  /** The props an instancing scene hands a scene rooted in the node (`ROOT_PROPS`, by its form). */
  readonly rootProps: GodotSceneRootPropsForm;
  /** The three object (or Rapier body) the element mounts, which a script's ref holds. */
  readonly three: string;
  /**
   * It draws with its scale removed (`disable_scale`, node_3d.cpp:655; set by Camera3D, Light3D and
   * ReflectionProbe): a leaf with no script states no scale.
   */
  readonly scaleless?: true;
  /** three's object starts off the origin (a DirectionalLight at `Object3D.DEFAULT_UP`); Godot's does not. */
  readonly origin?: true;
  /** A sky pass may read it (`_setup_sky`): a WorldEnvironment of its scene takes it (`scene-sky-lights.ts`). */
  readonly skyLight?: true;
  /** Its element takes its scene's sky lights as refs, the `skyLights` prop (`scene-sky-lights.ts`). */
  readonly skyLights?: true;
  /** A canvas layer's own `layer` unless stated (`canvas_layer.h:45`): the Controls under it stack by it. */
  readonly canvasLayer?: number;
  /**
   * Its Control layout (anchors, offsets, grow directions) is stated and draws nothing: its element
   * takes the props and drops them, so no setter binds them (a SubViewportContainer over the whole
   * viewport, `scene-families.ts`).
   */
  readonly inertLayout?: true;
  /** The pinned Godot 4.7 source the idiom answers to: documentation, which nothing reads. */
  readonly source?: GodotSceneNodeIdiomSource;
}

/** A class's constructor in the pinned Godot source. */
const ctor = (className: string, file: string, line: number): GodotSceneNodeIdiomSource => ({
  file,
  symbol: `${className}::${className}`,
  line,
});

/** A compat element's or plain Node's own props, less its ref (`react-lifecycle.tsx`). */
const COMPAT_ROOT_PROPS: GodotSceneRootPropsForm = { kind: 'compat', module: 'react-lifecycle', name: 'GodotSceneRootProps' };

/** How each form of node takes its instancers' props when it roots a scene. */
const ROOT_PROPS: { readonly [Kind in GodotSceneNodeIdiomForm['kind']]: GodotSceneRootPropsForm } = {
  element: COMPAT_ROOT_PROPS,
  'plain-node': COMPAT_ROOT_PROPS,
  component: { kind: 'component' },
  group: { kind: 'three-element' },
  mesh: { kind: 'three-element' },
  light: { kind: 'three-element' },
  camera: { kind: 'library', module: '@react-three/drei', name: 'PerspectiveCameraProps', omitRef: false, children: false },
  'reflection-probe': { kind: 'component' },
  body: { kind: 'library', module: '@react-three/rapier', name: 'RigidBodyProps', omitRef: true, children: true },
  collider: { kind: 'component' },
  dom: { kind: 'compat', module: 'godot-controls', name: 'GodotControlRootProps' },
};

type GodotSceneNodeIdiomEntry = Omit<GodotSceneNodeIdiom, 'rootProps'>;

const element = (
  module: string,
  className: string,
  source: GodotSceneNodeIdiomSource,
  three = 'Group',
): GodotSceneNodeIdiomEntry => ({
  form: { kind: 'element', module, exportName: `Godot${className}` },
  three,
  source,
});

/** A Control as its DOM element (`scene-control-idioms.ts`). */
const dom = (
  module: string,
  tag: Extract<GodotSceneNodeIdiomForm, { readonly kind: 'dom' }>['tag'],
  layout: Extract<GodotSceneNodeIdiomForm, { readonly kind: 'dom' }>['layout'],
  content: Extract<GodotSceneNodeIdiomForm, { readonly kind: 'dom' }>['content'],
  mouseFilter: 0 | 1 | 2,
  source: GodotSceneNodeIdiomSource,
  extra: { readonly panel?: true; readonly node2d?: true } = {},
): GodotSceneNodeIdiomEntry => ({
  form: { kind: 'dom', module, tag, layout, content, mouseFilter, ...extra },
  three: tag === 'button' ? 'HTMLButtonElement' : tag === 'label' ? 'HTMLLabelElement' : tag === 'input' ? 'HTMLInputElement' : 'HTMLDivElement',
  source,
});

/** A compat element whose node's classes its scene states (`userData.classes`). */
const statedElement = (module: string, className: string, source: GodotSceneNodeIdiomSource): GodotSceneNodeIdiomEntry => ({
  form: { kind: 'element', module, exportName: `Godot${className}`, statesClasses: true },
  three: 'Group',
  source,
});

/** Each node class the lane writes; a node of a class absent here is refused at plan time. */
const ENTRIES: Readonly<Record<string, GodotSceneNodeIdiomEntry>> = {
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
    skyLight: true,
    source: ctor('DirectionalLight3D', 'scene/3d/light_3d.cpp', 612),
  },
  OmniLight3D: {
    form: { kind: 'light', directional: false },
    three: 'PointLight',
    scaleless: true,
    source: ctor('OmniLight3D', 'scene/3d/light_3d.cpp', 661),
  },
  SpotLight3D: {
    form: { kind: 'light', directional: false, spot: true },
    three: 'SpotLight',
    scaleless: true,
    source: ctor('SpotLight3D', 'scene/3d/light_3d.cpp', 679),
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
  // A RigidBody3D of 40 kg (`VehicleBody3D::VehicleBody3D`) whose driver, Rapier's ray-cast vehicle
  // controller over the body, moves it on its VehicleWheel3D children (`vehicle-body-3d.tsx`).
  VehicleBody3D: {
    form: { kind: 'body', type: 'dynamic', sensor: false, mass: 40, driver: { module: 'vehicle-body-3d', exportName: 'GodotVehicleBody3D' } },
    three: 'RapierRigidBody',
    source: ctor('VehicleBody3D', 'scene/3d/physics/vehicle_body_3d.cpp', 1062),
  },
  AudioListener3D: statedElement('audio-listener-3d', 'AudioListener3D', ctor('AudioListener3D', 'scene/3d/audio_listener_3d.cpp', 187)),
  VehicleWheel3D: statedElement('vehicle-wheel-3d', 'VehicleWheel3D', ctor('VehicleWheel3D', 'scene/3d/physics/vehicle_body_3d.cpp', 391)),
  // Joints: `@react-three/rapier`'s impulse joints over the two bodies their paths name (`joint-3d.tsx`).
  PinJoint3D: statedElement('pin-joint-3d', 'PinJoint3D', ctor('PinJoint3D', 'scene/3d/physics/joints/pin_joint_3d.cpp', 76)),
  Generic6DOFJoint3D: statedElement('generic-6dof-joint-3d', 'Generic6DOFJoint3D', ctor('Generic6DOFJoint3D', 'scene/3d/physics/joints/generic_6dof_joint_3d.cpp', 315)),
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
  CanvasLayer: { ...element('canvas-layer', 'CanvasLayer', ctor('CanvasLayer', 'scene/main/canvas_layer.cpp', 359)), canvasLayer: 1 },
  // Controls (`scene-control-idioms.ts`): each class's element, layout, drawing and default
  // `mouse_filter` (a Container's PASS, `container.cpp:216`; a Label's IGNORE, `label.cpp:1526`).
  Control: dom('control', 'div', 'none', 'none', 0, ctor('Control', 'scene/gui/control.cpp', 5161)),
  HBoxContainer: dom('control', 'div', 'row', 'none', 1, ctor('HBoxContainer', 'scene/gui/box_container.h', 85)),
  VBoxContainer: dom('control', 'div', 'column', 'none', 1, ctor('VBoxContainer', 'scene/gui/box_container.h', 94)),
  MarginContainer: dom('control', 'div', 'stack', 'none', 1, ctor('MarginContainer', 'scene/gui/margin_container.cpp', 124)),
  TextureProgressBar: dom('range', 'div', 'none', 'progress', 1, ctor('TextureProgressBar', 'scene/gui/texture_progress_bar.cpp', 727)),
  PanelContainer: dom('control', 'div', 'stack', 'none', 0, ctor('PanelContainer', 'scene/gui/panel_container.cpp', 102), { panel: true }),
  HSeparator: dom('control', 'div', 'none', 'separator', 0, ctor('HSeparator', 'scene/gui/separator.cpp', 71)),
  CenterContainer: dom('control', 'div', 'center', 'none', 1, ctor('CenterContainer', 'scene/gui/center_container.h', 35)),
  Label: dom('label', 'div', 'none', 'text', 2, ctor('Label', 'scene/gui/label.cpp', 1526)),
  TextureRect: dom('texture-rect', 'div', 'none', 'image', 1, ctor('TextureRect', 'scene/gui/texture_rect.cpp', 299)),
  Node2D: element('node-2d', 'Node2D', ctor('Node2D', 'scene/2d/node_2d.cpp', 519)),
  Sprite2D: element('sprite-2d', 'Sprite2D', ctor('Sprite2D', 'scene/2d/sprite_2d.cpp', 555)),
  TouchScreenButton: dom('canvas-item', 'div', 'none', 'touch', 0, ctor('TouchScreenButton', 'scene/2d/physics/touch_screen_button.cpp', 458), { node2d: true }),
  Label3D: element('label-3d', 'Label3D', ctor('Label3D', 'scene/3d/label_3d.cpp', 1082), 'Mesh'),
  Timer: element('timer', 'Timer', ctor('Timer', 'scene/main/timer.cpp', 250)),
  Button: dom('button', 'button', 'none', 'button', 0, ctor('Button', 'scene/gui/button.cpp', 780)),
  CheckBox: dom('base-button', 'label', 'none', 'check', 0, ctor('CheckBox', 'scene/gui/check_box.cpp', 170)),
  HSlider: dom('range', 'input', 'none', 'range', 0, ctor('HSlider', 'scene/gui/slider.h', 120)),
  TextureButton: dom('base-button', 'button', 'none', 'texture-button', 0, ctor('TextureButton', 'scene/gui/texture_button.h', 35)),
  Path3D: element('path-3d', 'Path3D', ctor('Path3D', 'scene/3d/path_3d.cpp', 219)),
  PathFollow3D: element('path-follow-3d', 'PathFollow3D', ctor('PathFollow3D', 'scene/3d/path_3d.cpp', 520)),
  VisibleOnScreenNotifier3D: element('visible-on-screen-notifier-3d', 'VisibleOnScreenNotifier3D', ctor('VisibleOnScreenNotifier3D', 'scene/3d/visible_on_screen_notifier_3d.cpp', 107), 'Mesh'),
  TileMapLayer: element('tile-map-layer', 'TileMapLayer', ctor('TileMapLayer', 'scene/2d/tile_map_layer.cpp', 3380)),
  Camera2D: element('camera-2d', 'Camera2D', ctor('Camera2D', 'scene/2d/camera_2d.cpp', 1030)),
  ColorRect: dom('color-rect', 'div', 'none', 'color', 0, ctor('ColorRect', 'scene/gui/color_rect.cpp', 62)),
  Marker2D: element('marker-2d', 'Marker2D', ctor('Marker2D', 'scene/2d/marker_2d.cpp', 117)),
  VisibleOnScreenNotifier2D: element('visible-on-screen-notifier-2d', 'VisibleOnScreenNotifier2D', ctor('VisibleOnScreenNotifier2D', 'scene/2d/visible_on_screen_notifier_2d.cpp', 190)),
  Path2D: element('path-2d', 'Path2D', ctor('Path2D', 'scene/2d/path_2d.cpp', 190)),
  PathFollow2D: element('path-follow-2d', 'PathFollow2D', ctor('PathFollow2D', 'scene/2d/path_2d.cpp', 470)),
  StaticBody2D: element('static-body-2d', 'StaticBody2D', ctor('StaticBody2D', 'scene/2d/physics/static_body_2d.cpp', 95)),
  RigidBody2D: element('rigid-body-2d', 'RigidBody2D', ctor('RigidBody2D', 'scene/2d/physics/rigid_body_2d.cpp', 872)),
  CharacterBody2D: element('character-body-2d', 'CharacterBody2D', ctor('CharacterBody2D', 'scene/2d/physics/character_body_2d.cpp', 700)),
  AnimatedSprite2D: element('animated-sprite-2d', 'AnimatedSprite2D', ctor('AnimatedSprite2D', 'scene/2d/animated_sprite_2d.cpp', 620)),
  Area2D: element('area-2d', 'Area2D', ctor('Area2D', 'scene/2d/physics/area_2d.cpp', 640)),
  CollisionShape2D: element('collision-shape-2d', 'CollisionShape2D', ctor('CollisionShape2D', 'scene/2d/physics/collision_shape_2d.cpp', 245)),
  GPUParticles2D: element('gpu-particles-2d', 'GPUParticles2D', ctor('GPUParticles2D', 'scene/2d/gpu_particles_2d.cpp', 950)),
  SubViewportContainer: { ...element('sub-viewport-container', 'SubViewportContainer', ctor('SubViewportContainer', 'scene/gui/subviewport_container.cpp', 280)), inertLayout: true },
  SubViewport: element('sub-viewport', 'SubViewport', ctor('SubViewport', 'scene/main/viewport.cpp', 5712)),
  Sprite3D: element('sprite-3d', 'Sprite3D', ctor('Sprite3D', 'scene/3d/sprite_3d.cpp', 760), 'Mesh'),
  AnimatedSprite3D: element('animated-sprite-3d', 'AnimatedSprite3D', ctor('AnimatedSprite3D', 'scene/3d/sprite_3d.cpp', 1590), 'Mesh'),
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
  WorldEnvironment: {
    ...element('world-environment', 'WorldEnvironment', ctor('WorldEnvironment', 'scene/3d/world_environment.cpp', 226)),
    skyLights: true,
  },
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

const IDIOMS: Readonly<Record<string, GodotSceneNodeIdiom>> = Object.fromEntries(
  Object.entries(ENTRIES).map(([className, entry]) => [className, { ...entry, rootProps: ROOT_PROPS[entry.form.kind] }]),
);

/** The idiom a node of `className` is written as, or undefined when the lane writes none. */
export function godotSceneNodeIdiom(className: string): GodotSceneNodeIdiom | undefined {
  return Object.hasOwn(IDIOMS, className) ? IDIOMS[className] : undefined;
}
