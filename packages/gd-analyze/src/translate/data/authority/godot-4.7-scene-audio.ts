/**
 * Audio: `AudioStreamPlayer` and `AudioStreamPlayer3D` nodes, `.wav` streams the `wav` importer
 * imports (loaded by `AudioStreamWAV` from their copies), and `AudioStreamRandomizer` resources.
 *
 */
import { GODOT_4_7_CODE_SEED_SOURCE_REVISION } from '../../code/authority/godot-4.7-seed';
import type { GodotSceneNodeRule, GodotSceneResourceRule } from '../scene-node-authority';

const REVISION = GODOT_4_7_CODE_SEED_SOURCE_REVISION;

type Source = Readonly<{ file: string; symbol: string; line: number }>;

const identityOf = (className: string) => `${REVISION}\0ClassDB\0${className}`;

/** The players: a plain node, and a 3D group whose global position the panner follows. */
export const GODOT_4_7_AUDIO_NODE_RULES: readonly (GodotSceneNodeRule & { readonly source: Source })[] = [
  {
    sourceRevision: REVISION,
    nativeCanonicalIdentity: identityOf('AudioStreamPlayer'),
    targetKind: 'three-node',
    source: { file: 'scene/audio/audio_stream_player.cpp', symbol: 'AudioStreamPlayer::AudioStreamPlayer', line: 302 },
  },
  {
    sourceRevision: REVISION,
    nativeCanonicalIdentity: identityOf('AudioStreamPlayer3D'),
    targetKind: 'three-group',
    source: { file: 'scene/3d/audio_stream_player_3d.cpp', symbol: 'AudioStreamPlayer3D::AudioStreamPlayer3D', line: 974 },
  },
];

export const GODOT_4_7_AUDIO_RESOURCE_RULES: readonly (GodotSceneResourceRule & { readonly source: Source })[] = [
  {
    sourceRevision: REVISION,
    className: 'AudioStreamWAV',
    construct: { module: 'lib/godot-compat/audio-stream-wav', exportName: 'godot_audio_stream_wav_load' },
    source: { file: 'scene/resources/audio_stream_wav.cpp', symbol: 'AudioStreamWAV::load_from_buffer', line: 659 },
  },
  {
    sourceRevision: REVISION,
    className: 'AudioStreamRandomizer',
    construct: { module: 'lib/godot-compat/audio-stream-randomizer', exportName: 'godot_audio_stream_randomizer_new' },
    source: { file: 'servers/audio/audio_stream.cpp', symbol: 'AudioStreamRandomizer::AudioStreamRandomizer', line: 788 },
  },
];
