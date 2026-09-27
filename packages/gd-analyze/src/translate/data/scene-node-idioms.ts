/**
 * The mapping from Godot node classes to the library idioms the scene writes them as
 * (docs/GODOT.md §The lane's law, row 3): the one plan-time table, which the planner reads to give
 * each node its idiom. Emit writes the idiom and never looks at the class.
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
}

const element = (module: string, className: string, three = 'Group'): GodotSceneNodeIdiom => ({
  form: { kind: 'element', module, exportName: `Godot${className}` },
  three,
});

const IDIOMS: Readonly<Record<string, GodotSceneNodeIdiom>> = {
  Node: { form: { kind: 'plain-node', module: 'react-lifecycle', exportName: 'GodotNode' }, three: 'Group' },
  Node3D: { form: { kind: 'group' }, three: 'Group' },
  RayCast3D: { form: { kind: 'component', module: 'ray-cast-3d', exportName: 'GodotRayCast3D' }, three: 'Group' },
  Marker3D: { form: { kind: 'component', module: 'marker-3d', exportName: 'GodotMarker3D' }, three: 'Group' },
  MeshInstance3D: { form: { kind: 'mesh' }, three: 'Mesh' },
  DirectionalLight3D: { form: { kind: 'light', directional: true }, three: 'DirectionalLight', scaleless: true, origin: true },
  OmniLight3D: { form: { kind: 'light', directional: false }, three: 'PointLight', scaleless: true },
  Camera3D: { form: { kind: 'camera' }, three: 'PerspectiveCamera', scaleless: true },
  ReflectionProbe: { form: { kind: 'reflection-probe' }, three: 'Group', scaleless: true },
  StaticBody3D: { form: { kind: 'body', type: 'fixed', sensor: false }, three: 'RapierRigidBody' },
  Area3D: { form: { kind: 'body', type: 'fixed', sensor: true }, three: 'RapierRigidBody' },
  RigidBody3D: { form: { kind: 'body', type: 'dynamic', sensor: false }, three: 'RapierRigidBody' },
  CharacterBody3D: { form: { kind: 'body', type: 'kinematicPosition', sensor: false }, three: 'RapierRigidBody' },
  CollisionShape3D: { form: { kind: 'collider' }, three: 'Group' },
  CanvasLayer: element('canvas-layer', 'CanvasLayer'),
  Control: element('control', 'Control'),
  HBoxContainer: element('h-box-container', 'HBoxContainer'),
  Label: element('label', 'Label'),
  TextureRect: element('texture-rect', 'TextureRect'),
  Node2D: element('node-2d', 'Node2D'),
  Sprite2D: element('sprite-2d', 'Sprite2D'),
  TouchScreenButton: element('touch-screen-button', 'TouchScreenButton'),
  Label3D: element('label-3d', 'Label3D', 'Mesh'),
  AudioStreamPlayer: element('audio-stream-player', 'AudioStreamPlayer'),
  AudioStreamPlayer3D: element('audio-stream-player-3d', 'AudioStreamPlayer3D'),
  GridMap: element('grid-map', 'GridMap'),
  CPUParticles3D: element('cpu-particles-3d', 'CPUParticles3D'),
  Decal: element('decal', 'Decal'),
  WorldEnvironment: element('world-environment', 'WorldEnvironment'),
  AnimationPlayer: element('animation-player', 'AnimationPlayer'),
  AnimationTree: element('animation-tree', 'AnimationTree'),
};

/** The idiom a node of `className` is written as, or undefined when the lane writes none. */
export function godotSceneNodeIdiom(className: string): GodotSceneNodeIdiom | undefined {
  return IDIOMS[className];
}
