/**
 * GridMap: a `GridMap` node (`<GodotGridMap>`, its cells a data file, drawn as InstancedMeshes, its
 * cells' shapes one fixed body standing for the GridMap) and its `MeshLibrary` (a data file of
 * items and shapes, the items' meshes the scene's own). Their own proof
 * (`src/evidence/proofs/scene-gridmap.ts`) loads the platformer's tile library and level in
 * official Godot and compares the cells, their instances and ray queries against the GridMap.
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

const GRIDMAP_IDENTITIES = godotProofIdentities('scene-gridmap');
const REVISION = GODOT_4_7_CODE_SEED_SOURCE_REVISION;

type Source = Readonly<{ file: string; symbol: string; line: number }>;

const identityOf = (className: string) => `${REVISION}\0ClassDB\0${className}`;

export const GODOT_4_7_GRIDMAP_NODE_RULES: readonly (GodotSceneNodeRule & { readonly source: Source })[] = [
  {
    sourceRevision: REVISION,
    nativeCanonicalIdentity: identityOf('GridMap'),
    targetKind: 'three-group',
    evidenceClaimId: 'godot-4.7-scene-node-grid-map',
    source: { file: 'modules/gridmap/grid_map.cpp', symbol: 'GridMap::_set (data)', line: 64 },
  },
];

export const GODOT_4_7_GRIDMAP_RESOURCE_RULES: readonly (GodotSceneResourceRule & { readonly source: Source })[] = [
  {
    sourceRevision: REVISION,
    className: 'MeshLibrary',
    construct: { module: 'lib/godot-compat/mesh-library', exportName: 'godot_mesh_library_new' },
    evidenceClaimId: 'godot-4.7-scene-resource-mesh-library',
    source: { file: 'scene/resources/3d/mesh_library.cpp', symbol: 'MeshLibrary::_set', line: 41 },
  },
];

function gridMapClaim(canonicalIdentity: string, claimId: string, source: Source): SemanticClaimRecord {
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
      inputSha256: GRIDMAP_IDENTITIES.input,
      callsite: 'res://observe.gd _physics_process()',
      observedOutputSha256: GRIDMAP_IDENTITIES.observed,
    },
    target: {
      implementationSha256: GRIDMAP_IDENTITIES.implementation,
      callsite: 'the emitted world mounted by @react-three/fiber on a jsdom canvas, one advance() per frame',
      observedOutputSha256: GRIDMAP_IDENTITIES.observed,
    },
    comparison: {
      comparator: 'cells (order, items, orientations), metadata, layers, their instances\' transforms and which collider each ray query hits exact; hit points and normals as ray-hit',
      tolerance: 'ray-hit 2e-5',
      resultSha256: GRIDMAP_IDENTITIES.comparison,
    },
    reproductionCommand: GODOT_4_7_PROOF_REPRODUCTION_COMMAND,
  };
}

export const GODOT_4_7_GRIDMAP_CLAIMS: readonly SemanticClaimRecord[] = [
  ...GODOT_4_7_GRIDMAP_RESOURCE_RULES.map((rule) =>
    gridMapClaim(godotSceneResourceRuleKey(rule.sourceRevision, rule.className), rule.evidenceClaimId, rule.source),
  ),
  ...GODOT_4_7_GRIDMAP_NODE_RULES.map((rule) =>
    gridMapClaim(godotSceneNodeRuleKey(rule.sourceRevision, rule.nativeCanonicalIdentity), rule.evidenceClaimId, rule.source),
  ),
];

export const GODOT_4_7_GRIDMAP_LIVENESS: readonly GodotSceneNodeClaimLiveness[] = GODOT_4_7_GRIDMAP_CLAIMS.map((entry) => ({
  claimId: entry.claimId,
  sourceRevision: REVISION,
  apiDumpSha256: GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
  executableSha256: GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
  inputSha256: GRIDMAP_IDENTITIES.input,
  implementationSha256: GRIDMAP_IDENTITIES.implementation,
}));
