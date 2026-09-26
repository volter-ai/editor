/**
 * Mesh resources: an `ArrayMesh` saved as a `.res`/`.tres`, its surfaces decoded at translation and
 * constructed by `godot_array_mesh_new`. Its own proof (`src/evidence/proofs/scene-meshes.ts`) loads
 * the platformer's meshes in official Godot and compares every surface's arrays byte for byte and
 * the surface materials.
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
  godotSceneNodeRuleKey,
  type GodotSceneResourceRule,
  godotSceneResourceRuleKey,
} from '../scene-node-authority';

const MESH_IDENTITIES = godotProofIdentities('scene-meshes');
const REVISION = GODOT_4_7_CODE_SEED_SOURCE_REVISION;

type Source = Readonly<{ file: string; symbol: string; line: number }>;

const identityOf = (className: string) => `${REVISION}\0ClassDB\0${className}`;

/** Label3D: a three mesh the compat binding draws its text on. */
export const GODOT_4_7_MESH_NODE_RULES: readonly (GodotSceneNodeRule & { readonly source: Source })[] = [
  {
    sourceRevision: REVISION,
    nativeCanonicalIdentity: identityOf('Label3D'),
    targetKind: 'three-mesh',
    evidenceClaimId: 'godot-4.7-scene-node-label-3d',
    source: { file: 'scene/3d/label_3d.cpp', symbol: 'Label3D::Label3D', line: 1082 },
  },
];

export const GODOT_4_7_MESH_RESOURCE_RULES: readonly (GodotSceneResourceRule & { readonly source: Source })[] = [
  {
    sourceRevision: REVISION,
    className: 'ArrayMesh',
    construct: { module: 'lib/godot-compat/array-mesh', exportName: 'godot_array_mesh_new' },
    evidenceClaimId: 'godot-4.7-scene-resource-array-mesh',
    source: { file: 'scene/resources/mesh.cpp', symbol: 'ArrayMesh::_set_surfaces', line: 1587 },
  },
];

function meshClaim(canonicalIdentity: string, claimId: string, source: Source): SemanticClaimRecord {
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
      inputSha256: MESH_IDENTITIES.input,
      callsite: 'res://observe.gd _process()',
      observedOutputSha256: MESH_IDENTITIES.observed,
    },
    target: {
      implementationSha256: MESH_IDENTITIES.implementation,
      callsite: 'emitted scene components mounted by @react-three/fiber, read through compat getters',
      observedOutputSha256: MESH_IDENTITIES.observed,
    },
    comparison: {
      comparator: 'surface count, primitive, sha256 of each surface_get_arrays array, surface material and Label3D text, flags and AABB exact equality',
      tolerance: 'exact',
      resultSha256: MESH_IDENTITIES.comparison,
    },
    reproductionCommand: GODOT_4_7_PROOF_REPRODUCTION_COMMAND,
  };
}

export const GODOT_4_7_MESH_CLAIMS: readonly SemanticClaimRecord[] = [
  ...GODOT_4_7_MESH_RESOURCE_RULES.map((rule) =>
    meshClaim(godotSceneResourceRuleKey(rule.sourceRevision, rule.className), rule.evidenceClaimId, rule.source),
  ),
  ...GODOT_4_7_MESH_NODE_RULES.map((rule) =>
    meshClaim(godotSceneNodeRuleKey(rule.sourceRevision, rule.nativeCanonicalIdentity), rule.evidenceClaimId, rule.source),
  ),
];

export const GODOT_4_7_MESH_LIVENESS: readonly GodotSceneNodeClaimLiveness[] = GODOT_4_7_MESH_CLAIMS.map((entry) => ({
  claimId: entry.claimId,
  sourceRevision: REVISION,
  apiDumpSha256: GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
  executableSha256: GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
  inputSha256: MESH_IDENTITIES.input,
  implementationSha256: MESH_IDENTITIES.implementation,
}));
