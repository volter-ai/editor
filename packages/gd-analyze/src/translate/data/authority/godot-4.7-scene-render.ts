/**
 * Render node families: mesh instances over primitive meshes and materials, directional and omni
 * lights. Their own proof (`src/evidence/proofs/scene-render.ts`) builds a scene of them natively
 * and reads each node back through Godot's getters (mesh arrays, material and light parameters),
 * against the emitted component mounted in Node and read through compat's getters.
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
  type GodotSceneStructureRule,
  godotSceneNodeRuleKey,
  godotSceneResourceRuleKey,
  godotSceneStructureRuleKey,
} from '../scene-node-authority';

const RENDER_IDENTITIES = godotProofIdentities('scene-render');
const REVISION = GODOT_4_7_CODE_SEED_SOURCE_REVISION;
const identityOf = (className: string) => `${REVISION}\0ClassDB\0${className}`;

type Source = Readonly<{ file: string; symbol: string; line: number }>;

export const GODOT_4_7_RENDER_NODE_RULES: readonly (GodotSceneNodeRule & { readonly source: Source })[] = [
  {
    sourceRevision: REVISION,
    nativeCanonicalIdentity: identityOf('MeshInstance3D'),
    targetKind: 'three-mesh',
    mount: { module: 'lib/godot-compat/geometry-instance-3d', exportName: 'godot_geometry_instance_3d_mount' },
    evidenceClaimId: 'godot-4.7-scene-node-mesh-instance-3d',
    source: { file: 'scene/3d/mesh_instance_3d.cpp', symbol: 'MeshInstance3D::MeshInstance3D', line: 951 },
  },
  {
    sourceRevision: REVISION,
    nativeCanonicalIdentity: identityOf('DirectionalLight3D'),
    targetKind: 'three-directional-light',
    mount: { module: 'lib/godot-compat/directional-light-3d', exportName: 'godot_directional_light_3d_mount' },
    evidenceClaimId: 'godot-4.7-scene-node-directional-light-3d',
    source: { file: 'scene/3d/light_3d.cpp', symbol: 'DirectionalLight3D::DirectionalLight3D', line: 612 },
  },
  {
    sourceRevision: REVISION,
    nativeCanonicalIdentity: identityOf('OmniLight3D'),
    targetKind: 'three-point-light',
    mount: { module: 'lib/godot-compat/omni-light-3d', exportName: 'godot_omni_light_3d_mount' },
    evidenceClaimId: 'godot-4.7-scene-node-omni-light-3d',
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
  evidenceClaimId: `godot-4.7-scene-resource-${module}`,
  source: { file, symbol: `${className}::${className}`, line },
}));

export const GODOT_4_7_RENDER_STRUCTURE_RULES: readonly (GodotSceneStructureRule & { readonly source: Source })[] = [
  {
    sourceRevision: REVISION,
    id: 'property-setter',
    evidenceClaimId: 'godot-4.7-scene-structure-property-setter',
    source: { file: 'scene/resources/packed_scene.cpp', symbol: 'SceneState::instantiate (node->set)', line: 400 },
  },
];

function renderClaim(canonicalIdentity: string, claimId: string, source: Source): SemanticClaimRecord {
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
      inputSha256: RENDER_IDENTITIES.input,
      callsite: 'res://observe.gd _process()',
      observedOutputSha256: RENDER_IDENTITIES.observed,
    },
    target: {
      implementationSha256: RENDER_IDENTITIES.implementation,
      callsite: 'emitted scene components mounted by @react-three/fiber, read through compat getters',
      observedOutputSha256: RENDER_IDENTITIES.observed,
    },
    comparison: {
      comparator: 'canonical render state (mesh arrays, material and light parameters) exact equality',
      tolerance: 'exact',
      resultSha256: RENDER_IDENTITIES.comparison,
    },
    reproductionCommand: GODOT_4_7_PROOF_REPRODUCTION_COMMAND,
  };
}

export const GODOT_4_7_RENDER_CLAIMS: readonly SemanticClaimRecord[] = [
  ...GODOT_4_7_RENDER_NODE_RULES.map((rule) =>
    renderClaim(godotSceneNodeRuleKey(rule.sourceRevision, rule.nativeCanonicalIdentity), rule.evidenceClaimId, rule.source),
  ),
  ...GODOT_4_7_RENDER_RESOURCE_RULES.map((rule) =>
    renderClaim(godotSceneResourceRuleKey(rule.sourceRevision, rule.className), rule.evidenceClaimId, rule.source),
  ),
  ...GODOT_4_7_RENDER_STRUCTURE_RULES.map((rule) =>
    renderClaim(godotSceneStructureRuleKey(rule.sourceRevision, rule.id), rule.evidenceClaimId, rule.source),
  ),
];

export const GODOT_4_7_RENDER_LIVENESS: readonly GodotSceneNodeClaimLiveness[] = GODOT_4_7_RENDER_CLAIMS.map(
  (entry) => ({
    claimId: entry.claimId,
    sourceRevision: REVISION,
    apiDumpSha256: GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
    executableSha256: GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
    inputSha256: RENDER_IDENTITIES.input,
    implementationSha256: RENDER_IDENTITIES.implementation,
  }),
);
