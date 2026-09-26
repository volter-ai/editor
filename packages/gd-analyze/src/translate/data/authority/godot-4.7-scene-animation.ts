/**
 * Animation: an `AnimationPlayer` node (`<GodotAnimationPlayer>`, compat's AnimationMixer protocol
 * blending its libraries' tracks onto the scene's nodes through the bindings resolved at import) and
 * its `AnimationLibrary` (a data file of animations). Their own proof
 * (`src/evidence/proofs/scene-animation.ts`) runs a scene with value (continuous, eased, discrete),
 * method (a script's function and a native method) and 3D tracks, a RESET, two libraries, autoplay
 * and a queue in official Godot, and compares every frame's sampled values and signals against the
 * emitted scene.
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

const ANIMATION_IDENTITIES = godotProofIdentities('scene-animation');
const REVISION = GODOT_4_7_CODE_SEED_SOURCE_REVISION;

type Source = Readonly<{ file: string; symbol: string; line: number }>;

const identityOf = (className: string) => `${REVISION}\0ClassDB\0${className}`;

export const GODOT_4_7_ANIMATION_NODE_RULES: readonly (GodotSceneNodeRule & { readonly source: Source })[] = [
  {
    sourceRevision: REVISION,
    nativeCanonicalIdentity: identityOf('AnimationPlayer'),
    targetKind: 'three-group',
    evidenceClaimId: 'godot-4.7-scene-node-animation-player',
    source: { file: 'scene/animation/animation_mixer.cpp', symbol: 'AnimationMixer::_update_caches', line: 651 },
  },
];

export const GODOT_4_7_ANIMATION_RESOURCE_RULES: readonly (GodotSceneResourceRule & { readonly source: Source })[] = [
  {
    sourceRevision: REVISION,
    className: 'AnimationLibrary',
    construct: { module: 'lib/godot-compat/animation-library', exportName: 'godot_animation_library_load' },
    evidenceClaimId: 'godot-4.7-scene-resource-animation-library',
    source: { file: 'scene/resources/animation_library.cpp', symbol: 'AnimationLibrary::_set_data', line: 148 },
  },
];

function animationClaim(canonicalIdentity: string, claimId: string, source: Source): SemanticClaimRecord {
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
      inputSha256: ANIMATION_IDENTITIES.input,
      callsite: 'res://observe.gd _physics_process()',
      observedOutputSha256: ANIMATION_IDENTITIES.observed,
    },
    target: {
      implementationSha256: ANIMATION_IDENTITIES.implementation,
      callsite: 'the emitted world mounted by @react-three/fiber on a jsdom canvas, one advance() per frame',
      observedOutputSha256: ANIMATION_IDENTITIES.observed,
    },
    comparison: {
      comparator: 'every frame\'s animated values (float bits), playback state, method calls and signals equality',
      tolerance: 'exact',
      resultSha256: ANIMATION_IDENTITIES.comparison,
    },
    reproductionCommand: GODOT_4_7_PROOF_REPRODUCTION_COMMAND,
  };
}

export const GODOT_4_7_ANIMATION_CLAIMS: readonly SemanticClaimRecord[] = [
  ...GODOT_4_7_ANIMATION_RESOURCE_RULES.map((rule) =>
    animationClaim(godotSceneResourceRuleKey(rule.sourceRevision, rule.className), rule.evidenceClaimId, rule.source),
  ),
  ...GODOT_4_7_ANIMATION_NODE_RULES.map((rule) =>
    animationClaim(godotSceneNodeRuleKey(rule.sourceRevision, rule.nativeCanonicalIdentity), rule.evidenceClaimId, rule.source),
  ),
];

export const GODOT_4_7_ANIMATION_LIVENESS: readonly GodotSceneNodeClaimLiveness[] = GODOT_4_7_ANIMATION_CLAIMS.map((entry) => ({
  claimId: entry.claimId,
  sourceRevision: REVISION,
  apiDumpSha256: GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
  executableSha256: GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
  inputSha256: ANIMATION_IDENTITIES.input,
  implementationSha256: ANIMATION_IDENTITIES.implementation,
}));
