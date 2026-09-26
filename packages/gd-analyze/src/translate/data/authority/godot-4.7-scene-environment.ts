/**
 * Environments: `WorldEnvironment` nodes (`<GodotWorldEnvironment>`, drawing the background,
 * ambient light, tone mapping and fog on three) and the `Environment`, `Sky`, `ShaderMaterial` and
 * `Shader` resources they take (a shader read by the pinned Godot's own shader frontend and lowered
 * to GLSL), and the `CompressedCubemap` a sky shader samples. Their own proof
 * (`src/evidence/proofs/scene-environment.ts`) loads the platformer's stage environment in
 * official Godot and reads its state and each cubemap face back, against the emitted scene mounted
 * in Node and read through compat.
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

const ENVIRONMENT_IDENTITIES = godotProofIdentities('scene-environment');
/** A shader's lowering has its own proof (`src/evidence/proofs/shader-lowering.ts`). */
const SHADER_IDENTITIES = godotProofIdentities('shader-lowering');
const REVISION = GODOT_4_7_CODE_SEED_SOURCE_REVISION;

type Source = Readonly<{ file: string; symbol: string; line: number }>;

const identityOf = (className: string) => `${REVISION}\0ClassDB\0${className}`;

export const GODOT_4_7_ENVIRONMENT_NODE_RULES: readonly (GodotSceneNodeRule & { readonly source: Source })[] = [
  {
    sourceRevision: REVISION,
    nativeCanonicalIdentity: identityOf('WorldEnvironment'),
    targetKind: 'three-group',
    evidenceClaimId: 'godot-4.7-scene-node-world-environment',
    source: { file: 'scene/3d/world_environment.cpp', symbol: 'WorldEnvironment::WorldEnvironment', line: 226 },
  },
];

export const GODOT_4_7_ENVIRONMENT_RESOURCE_RULES: readonly (GodotSceneResourceRule & { readonly source: Source })[] = (
  [
    ['Environment', 'environment', 'godot_environment_new', 'scene/resources/environment.cpp', 1637],
    ['Sky', 'sky', 'godot_sky_new', 'scene/resources/sky.cpp', 105],
    ['ShaderMaterial', 'shader-material', 'godot_shader_material_new', 'scene/resources/material.cpp', 545],
    ['Shader', 'shader', 'godot_shader_new', 'scene/resources/shader.cpp', 300],
    ['CompressedCubemap', 'compressed-cubemap', 'useGodotCubemap', 'scene/resources/compressed_texture.h', 175],
  ] as const
).map(([className, module, exportName, file, line]) => ({
  sourceRevision: REVISION,
  className,
  construct: { module: `lib/godot-compat/${module}`, exportName },
  evidenceClaimId: `godot-4.7-scene-resource-${module}`,
  source: { file, symbol: `${className}::${className}`, line },
}));

function environmentClaim(canonicalIdentity: string, claimId: string, source: Source, identities = ENVIRONMENT_IDENTITIES): SemanticClaimRecord {
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
      inputSha256: identities.input,
      callsite: 'res://observe.gd _process()',
      observedOutputSha256: identities.observed,
    },
    target: {
      implementationSha256: identities.implementation,
      callsite: 'emitted scene components mounted by @react-three/fiber, read through compat getters',
      observedOutputSha256: identities.observed,
    },
    comparison: {
      comparator: 'environment, sky, shader material and shader state, and each cubemap face\'s bytes, exact equality',
      tolerance: 'exact',
      resultSha256: identities.comparison,
    },
    reproductionCommand: GODOT_4_7_PROOF_REPRODUCTION_COMMAND,
  };
}

export const GODOT_4_7_ENVIRONMENT_CLAIMS: readonly SemanticClaimRecord[] = [
  ...GODOT_4_7_ENVIRONMENT_RESOURCE_RULES.map((rule) =>
    environmentClaim(godotSceneResourceRuleKey(rule.sourceRevision, rule.className), rule.evidenceClaimId, rule.source, rule.className === 'Shader' ? SHADER_IDENTITIES : ENVIRONMENT_IDENTITIES),
  ),
  ...GODOT_4_7_ENVIRONMENT_NODE_RULES.map((rule) =>
    environmentClaim(godotSceneNodeRuleKey(rule.sourceRevision, rule.nativeCanonicalIdentity), rule.evidenceClaimId, rule.source),
  ),
];

const liveness = (identities: typeof ENVIRONMENT_IDENTITIES, shader: boolean): readonly GodotSceneNodeClaimLiveness[] =>
  GODOT_4_7_ENVIRONMENT_CLAIMS.filter((entry) => (entry.claimId === 'godot-4.7-scene-resource-shader') === shader).map((entry) => ({
    claimId: entry.claimId,
    sourceRevision: REVISION,
    apiDumpSha256: GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
    executableSha256: GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
    inputSha256: identities.input,
    implementationSha256: identities.implementation,
  }));

export const GODOT_4_7_ENVIRONMENT_LIVENESS = liveness(ENVIRONMENT_IDENTITIES, false);
/** The shader resource's claim, live while its lowering proof is. */
export const GODOT_4_7_SHADER_LIVENESS = liveness(SHADER_IDENTITIES, true);
