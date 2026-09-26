/**
 * Audio: `AudioStreamPlayer` and `AudioStreamPlayer3D` nodes, `.wav` streams the `wav` importer
 * imports (loaded by `AudioStreamWAV` from their copies), and `AudioStreamRandomizer` resources.
 * Their own proof (`src/evidence/proofs/scene-audio.ts`) loads the platformer's sounds and players
 * in official Godot and compares the streams' imported facts and the players' state.
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

const AUDIO_IDENTITIES = godotProofIdentities('scene-audio');
const REVISION = GODOT_4_7_CODE_SEED_SOURCE_REVISION;

type Source = Readonly<{ file: string; symbol: string; line: number }>;

const identityOf = (className: string) => `${REVISION}\0ClassDB\0${className}`;

/** The players: a plain node, and a 3D group whose global position the panner follows. */
export const GODOT_4_7_AUDIO_NODE_RULES: readonly (GodotSceneNodeRule & { readonly source: Source })[] = [
  {
    sourceRevision: REVISION,
    nativeCanonicalIdentity: identityOf('AudioStreamPlayer'),
    targetKind: 'three-node',
    mount: { module: 'lib/godot-compat/audio-stream-player', exportName: 'godot_audio_stream_player_mount' },
    evidenceClaimId: 'godot-4.7-scene-node-audio-stream-player',
    source: { file: 'scene/audio/audio_stream_player.cpp', symbol: 'AudioStreamPlayer::AudioStreamPlayer', line: 302 },
  },
  {
    sourceRevision: REVISION,
    nativeCanonicalIdentity: identityOf('AudioStreamPlayer3D'),
    targetKind: 'three-group',
    mount: { module: 'lib/godot-compat/audio-stream-player-3d', exportName: 'godot_audio_stream_player_3d_mount' },
    evidenceClaimId: 'godot-4.7-scene-node-audio-stream-player-3d',
    source: { file: 'scene/3d/audio_stream_player_3d.cpp', symbol: 'AudioStreamPlayer3D::AudioStreamPlayer3D', line: 974 },
  },
];

export const GODOT_4_7_AUDIO_RESOURCE_RULES: readonly (GodotSceneResourceRule & { readonly source: Source })[] = [
  {
    sourceRevision: REVISION,
    className: 'AudioStreamWAV',
    construct: { module: 'lib/godot-compat/audio-stream-wav', exportName: 'godot_audio_stream_wav_load' },
    evidenceClaimId: 'godot-4.7-scene-resource-audio-stream-wav',
    source: { file: 'scene/resources/audio_stream_wav.cpp', symbol: 'AudioStreamWAV::load_from_buffer', line: 659 },
  },
  {
    sourceRevision: REVISION,
    className: 'AudioStreamRandomizer',
    construct: { module: 'lib/godot-compat/audio-stream-randomizer', exportName: 'godot_audio_stream_randomizer_new' },
    evidenceClaimId: 'godot-4.7-scene-resource-audio-stream-randomizer',
    source: { file: 'servers/audio/audio_stream.cpp', symbol: 'AudioStreamRandomizer::AudioStreamRandomizer', line: 788 },
  },
];

function audioClaim(canonicalIdentity: string, claimId: string, source: Source): SemanticClaimRecord {
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
      inputSha256: AUDIO_IDENTITIES.input,
      callsite: 'res://observe.gd _process()',
      observedOutputSha256: AUDIO_IDENTITIES.observed,
    },
    target: {
      implementationSha256: AUDIO_IDENTITIES.implementation,
      callsite: 'emitted scene components mounted by @react-three/fiber, read through compat getters',
      observedOutputSha256: AUDIO_IDENTITIES.observed,
    },
    comparison: {
      comparator: 'imported stream facts (length, rate, channels, format, loop) and player state exact equality',
      tolerance: 'exact',
      resultSha256: AUDIO_IDENTITIES.comparison,
    },
    reproductionCommand: GODOT_4_7_PROOF_REPRODUCTION_COMMAND,
  };
}

export const GODOT_4_7_AUDIO_CLAIMS: readonly SemanticClaimRecord[] = [
  ...GODOT_4_7_AUDIO_RESOURCE_RULES.map((rule) =>
    audioClaim(godotSceneResourceRuleKey(rule.sourceRevision, rule.className), rule.evidenceClaimId, rule.source),
  ),
  ...GODOT_4_7_AUDIO_NODE_RULES.map((rule) =>
    audioClaim(godotSceneNodeRuleKey(rule.sourceRevision, rule.nativeCanonicalIdentity), rule.evidenceClaimId, rule.source),
  ),
];

export const GODOT_4_7_AUDIO_LIVENESS: readonly GodotSceneNodeClaimLiveness[] = GODOT_4_7_AUDIO_CLAIMS.map((entry) => ({
  claimId: entry.claimId,
  sourceRevision: REVISION,
  apiDumpSha256: GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
  executableSha256: GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
  inputSha256: AUDIO_IDENTITIES.input,
  implementationSha256: AUDIO_IDENTITIES.implementation,
}));
