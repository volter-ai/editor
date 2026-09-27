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
  GodotSceneNodeRule,
  GodotSceneResourceRule,
  GodotSceneSignalRule,
} from '../scene-node-authority';

const REVISION = GODOT_4_7_CODE_SEED_SOURCE_REVISION;
const identityOf = (className: string) => `${REVISION}\0ClassDB\0${className}`;

type Source = Readonly<{ file: string; symbol: string; line: number }>;

export const GODOT_4_7_PHYSICS_NODE_RULES: readonly (GodotSceneNodeRule & { readonly source: Source })[] = (
  [
    ['CollisionShape3D', 'collision-shape-3d', 'scene/3d/physics/collision_shape_3d.cpp', 325],
    ['StaticBody3D', 'static-body-3d', 'scene/3d/physics/static_body_3d.cpp', 251],
    ['RigidBody3D', 'rigid-body-3d', 'scene/3d/physics/rigid_body_3d.cpp', 829],
    ['CharacterBody3D', 'character-body-3d', 'scene/3d/physics/character_body_3d.cpp', 966],
    ['Area3D', 'area-3d', 'scene/3d/physics/area_3d.cpp', 818],
    ['RayCast3D', 'ray-cast-3d', 'scene/3d/physics/ray_cast_3d.cpp', 564],
    ['Marker3D', 'marker-3d', 'scene/3d/marker_3d.cpp', 54],
  ] as const
).map(([className, module, file, line]) => ({
  sourceRevision: REVISION,
  nativeCanonicalIdentity: identityOf(className),
  targetKind: 'three-group' as const,
  source: { file, symbol: `${className}::${className}`, line },
}));

export const GODOT_4_7_PHYSICS_RESOURCE_RULES: readonly (GodotSceneResourceRule & { readonly source: Source })[] = (
  [
    ['BoxShape3D', 'box-shape-3d', 'scene/resources/3d/box_shape_3d.cpp', 118],
    ['SphereShape3D', 'sphere-shape-3d', 'scene/resources/3d/sphere_shape_3d.cpp', 104],
    ['CapsuleShape3D', 'capsule-shape-3d', 'scene/resources/3d/capsule_shape_3d.cpp', 156],
    ['ConvexPolygonShape3D', 'convex-polygon-shape-3d', 'scene/resources/3d/convex_polygon_shape_3d.cpp', 129],
    ['ConcavePolygonShape3D', 'concave-polygon-shape-3d', 'scene/resources/3d/concave_polygon_shape_3d.cpp', 134],
    ['PhysicsMaterial', 'physics-material', 'scene/resources/physics_material.h', 36],
  ] as const
).map(([className, module, file, line]) => ({
  sourceRevision: REVISION,
  className,
  construct: { module: `lib/godot-compat/${module}`, exportName: 'construct' },
  source: { file, symbol: `${className}::${className}`, line },
}));

/** An area's body signals, connected by a scene (a coin connects `body_entered`). */
export const GODOT_4_7_PHYSICS_SIGNAL_RULES: readonly (GodotSceneSignalRule & { readonly source: Source })[] = (
  ['body_entered', 'body_exited'] as const
).map((signal) => ({
  sourceRevision: REVISION,
  ownerClass: 'Area3D',
  signal,
  accessor: { module: 'lib/godot-compat/area-3d', exportName: 'godot_area_3d_signal', named: true },
  arguments: 1,
  source: { file: 'scene/resources/packed_scene.cpp', symbol: 'SceneState::instantiate (connections)', line: 682 },
}));
