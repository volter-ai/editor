/**
 * Physics node families: collision shapes over shape resources, static, rigid and character
 * bodies, areas, ray casts and markers. They are written only in the idiomatic shape: a body is a
 * `@react-three/rapier` `<RigidBody>` (fixed, dynamic, position-kinematic, or fixed with sensor
 * colliders for an area) with its colliders, a ray cast and a marker compat's `<GodotRayCast3D>`
 * and `<GodotMarker3D>`; compat's physics protocol meets the declared bodies in the world the
 * composition site provides and drives them through their API.
 */
import { GODOT_4_7_CODE_SEED_SOURCE_REVISION } from '../../code/authority/godot-4.7-seed';
import type {
  GodotSceneResourceRule,
  GodotSceneSignalRule,
} from '../scene-node-authority';

const REVISION = GODOT_4_7_CODE_SEED_SOURCE_REVISION;

type Source = Readonly<{ file: string; symbol: string; line: number }>;

export const GODOT_4_7_PHYSICS_RESOURCE_RULES: readonly (GodotSceneResourceRule & { readonly source: Source })[] = (
  [
    ['BoxShape3D', 'box-shape-3d', 'scene/resources/3d/box_shape_3d.cpp', 118],
    ['SphereShape3D', 'sphere-shape-3d', 'scene/resources/3d/sphere_shape_3d.cpp', 104],
    ['CapsuleShape3D', 'capsule-shape-3d', 'scene/resources/3d/capsule_shape_3d.cpp', 156],
    ['ConvexPolygonShape3D', 'convex-polygon-shape-3d', 'scene/resources/3d/convex_polygon_shape_3d.cpp', 129],
    ['ConcavePolygonShape3D', 'concave-polygon-shape-3d', 'scene/resources/3d/concave_polygon_shape_3d.cpp', 134],
    // A GridMap's `physics_material` is an element prop: the material made from what the scene states.
    ['PhysicsMaterial', 'physics-material', 'scene/resources/physics_material.h', 36, 'godot_physics_material_of'],
    // A 2D shape a CollisionShape2D picks by (`collision-object-2d.ts`), made from what the scene states.
    ['RectangleShape2D', 'rectangle-shape-2d', 'scene/resources/2d/rectangle_shape_2d.cpp', 131, 'godot_rectangle_shape_2d_new'],
    ['CircleShape2D', 'circle-shape-2d', 'scene/resources/2d/circle_shape_2d.cpp', 99, 'godot_circle_shape_2d_new'],
  ] as const
).map(([className, module, file, line, exportName = 'construct']) => ({
  sourceRevision: REVISION,
  className,
  construct: { module: `lib/godot-compat/${module}`, exportName },
  source: { file, symbol: `${className}::${className}`, line },
}));

/** An area's body signals, connected by a scene (a coin connects `body_entered`). */
export const GODOT_4_7_PHYSICS_SIGNAL_RULES: readonly (GodotSceneSignalRule & { readonly source: Source })[] = (
  [
    ['Area3D', 'lib/godot-compat/area-3d', 'godot_area_3d_signal'],
    ['RigidBody3D', 'lib/godot-compat/rigid-body-3d', 'godot_rigid_body_3d_signal'],
  ] as const
).flatMap(([ownerClass, module, exportName]) =>
  (['body_entered', 'body_exited'] as const).map((signal) => ({
    sourceRevision: REVISION,
    ownerClass,
    signal,
    accessor: { module, exportName, named: true },
    arguments: 1,
    source: { file: 'scene/resources/packed_scene.cpp', symbol: 'SceneState::instantiate (connections)', line: 682 },
  })),
);
