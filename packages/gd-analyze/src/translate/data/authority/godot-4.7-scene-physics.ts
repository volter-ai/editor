/**
 * Physics node families: collision shapes over shape resources, static, rigid and character
 * bodies, areas, ray casts and markers. They are written only in the idiomatic shape: a body is a
 * `@react-three/rapier` `<RigidBody>` (fixed, dynamic, position-kinematic, or fixed with sensor
 * colliders for an area) with its colliders, a ray cast and a marker compat's `<GodotRayCast3D>`
 * and `<GodotMarker3D>`; compat's physics protocol meets the declared bodies in the world the
 * composition site provides and drives them through their API. Their own proof
 * (`src/evidence/proofs/scene-physics.ts`) builds a scene of them natively and reads each node back
 * (global transforms, layers and masks, shapes and their parameters, body settings, ray cast
 * settings and a first physics frame's ray results), against the emitted component mounted in
 * Node and read through compat's getters.
 */
import {
  GODOT_4_7_PROOF_REPRODUCTION_COMMAND,
  godotProofIdentities,
} from '../../../godot-frontend/proof-identities';
import type { SemanticClaimRecord } from '../../../godot-frontend/semantic-claims';
import {
  GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
  GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
  GODOT_4_7_CODE_SEED_SOURCE_REVISION,
} from '../../code/authority/godot-4.7-seed';
import {
  type GodotSceneNodeClaimLiveness,
  type GodotSceneNodeRule,
  type GodotSceneResourceRule,
  type GodotSceneSignalRule,
  godotSceneNodeRuleKey,
  godotSceneResourceRuleKey,
  godotSceneSignalRuleKey,
} from '../scene-node-authority';

const IDENTITIES = godotProofIdentities('scene-physics');
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
  evidenceClaimId: `godot-4.7-scene-node-${module}`,
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
  evidenceClaimId: `godot-4.7-scene-resource-${module}`,
  source: { file, symbol: `${className}::${className}`, line },
}));

/** An area's body signals, connected by a scene (the proof's coin connects `body_entered`). */
export const GODOT_4_7_PHYSICS_SIGNAL_RULES: readonly (GodotSceneSignalRule & { readonly source: Source })[] = (
  ['body_entered', 'body_exited'] as const
).map((signal) => ({
  sourceRevision: REVISION,
  ownerClass: 'Area3D',
  signal,
  accessor: { module: 'lib/godot-compat/area-3d', exportName: 'godot_area_3d_signal', named: true },
  arguments: 1,
  evidenceClaimId: `godot-4.7-scene-connection-area-3d-${signal.replace('_', '-')}`,
  source: { file: 'scene/resources/packed_scene.cpp', symbol: 'SceneState::instantiate (connections)', line: 682 },
}));

function physicsClaim(canonicalIdentity: string, claimId: string, source: Source): SemanticClaimRecord {
  return {
    registryVersion: 1,
    claimId,
    layer: 'translate-data',
    canonicalIdentity,
    godot: {
      sourceRevision: REVISION,
      apiDumpSha256: GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
      sourceFile: source.file,
      sourceSymbol: source.symbol,
      sourceLine: source.line,
    },
    native: {
      executableSha256: GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
      buildIdentity: 'Godot 4.7-stable official 5b4e0cb0f',
      inputSha256: IDENTITIES.input,
      callsite: 'res://observe.gd _physics_process()',
      observedOutputSha256: IDENTITIES.observed,
    },
    target: {
      implementationSha256: IDENTITIES.implementation,
      callsite: 'emitted idiomatic scene components mounted by @react-three/fiber inside the <Physics> world, read through compat getters',
      observedOutputSha256: IDENTITIES.observed,
    },
    comparison: {
      comparator: 'canonical physics scene state (transforms, layers, shapes, settings, first-frame ray hits) equality',
      tolerance: 'exact; ray hit points and normals (Rapier geometry) to 1e-4; global transforms (transform-decomposition) to 1e-6',
      resultSha256: IDENTITIES.comparison,
    },
    reproductionCommand: GODOT_4_7_PROOF_REPRODUCTION_COMMAND,
  };
}

export const GODOT_4_7_PHYSICS_CLAIMS: readonly SemanticClaimRecord[] = [
  ...GODOT_4_7_PHYSICS_NODE_RULES.map((rule) =>
    physicsClaim(godotSceneNodeRuleKey(rule.sourceRevision, rule.nativeCanonicalIdentity), rule.evidenceClaimId, rule.source),
  ),
  ...GODOT_4_7_PHYSICS_RESOURCE_RULES.map((rule) =>
    physicsClaim(godotSceneResourceRuleKey(rule.sourceRevision, rule.className), rule.evidenceClaimId, rule.source),
  ),
  ...GODOT_4_7_PHYSICS_SIGNAL_RULES.map((rule) =>
    physicsClaim(godotSceneSignalRuleKey(rule.sourceRevision, rule.ownerClass, rule.signal), rule.evidenceClaimId, rule.source),
  ),
];

export const GODOT_4_7_PHYSICS_LIVENESS: readonly GodotSceneNodeClaimLiveness[] = GODOT_4_7_PHYSICS_CLAIMS.map((entry) => ({
  claimId: entry.claimId,
  sourceRevision: REVISION,
  apiDumpSha256: GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
  executableSha256: GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
  inputSha256: IDENTITIES.input,
  implementationSha256: IDENTITIES.implementation,
}));
