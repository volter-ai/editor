/**
 * Imported textures: an image the `texture` importer imports losslessly, loaded by
 * `CompressedTexture2D` from its copy beside the app. Their own proof
 * (`src/evidence/proofs/scene-textures.ts`) imports the same images in official Godot and compares
 * each texture's image (size, format, mipmaps, every byte) and the materials' sampler settings.
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
  type GodotSceneResourceRule,
  godotSceneResourceRuleKey,
} from '../scene-node-authority';

const TEXTURE_IDENTITIES = godotProofIdentities('scene-textures');
const REVISION = GODOT_4_7_CODE_SEED_SOURCE_REVISION;

type Source = Readonly<{ file: string; symbol: string; line: number }>;

export const GODOT_4_7_TEXTURE_RESOURCE_RULES: readonly (GodotSceneResourceRule & { readonly source: Source })[] = [
  {
    sourceRevision: REVISION,
    className: 'CompressedTexture2D',
    construct: { module: 'lib/godot-compat/compressed-texture-2d', exportName: 'godot_compressed_texture_2d_load' },
    evidenceClaimId: 'godot-4.7-scene-resource-compressed-texture-2d',
    source: { file: 'scene/resources/compressed_texture.cpp', symbol: 'CompressedTexture2D::load', line: 132 },
  },
];

function textureClaim(canonicalIdentity: string, claimId: string, source: Source): SemanticClaimRecord {
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
      inputSha256: TEXTURE_IDENTITIES.input,
      callsite: 'res://observe.gd _process()',
      observedOutputSha256: TEXTURE_IDENTITIES.observed,
    },
    target: {
      implementationSha256: TEXTURE_IDENTITIES.implementation,
      callsite: 'emitted scene components mounted by @react-three/fiber, read through compat getters',
      observedOutputSha256: TEXTURE_IDENTITIES.observed,
    },
    comparison: {
      comparator: 'imported image (size, format, mipmap count, sha256 of every level) and sampler state exact equality',
      tolerance: 'exact',
      resultSha256: TEXTURE_IDENTITIES.comparison,
    },
    reproductionCommand: GODOT_4_7_PROOF_REPRODUCTION_COMMAND,
  };
}

export const GODOT_4_7_TEXTURE_CLAIMS: readonly SemanticClaimRecord[] = GODOT_4_7_TEXTURE_RESOURCE_RULES.map((rule) =>
  textureClaim(godotSceneResourceRuleKey(rule.sourceRevision, rule.className), rule.evidenceClaimId, rule.source),
);

export const GODOT_4_7_TEXTURE_LIVENESS: readonly GodotSceneNodeClaimLiveness[] = GODOT_4_7_TEXTURE_CLAIMS.map((entry) => ({
  claimId: entry.claimId,
  sourceRevision: REVISION,
  apiDumpSha256: GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
  executableSha256: GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
  inputSha256: TEXTURE_IDENTITIES.input,
  implementationSha256: TEXTURE_IDENTITIES.implementation,
}));
