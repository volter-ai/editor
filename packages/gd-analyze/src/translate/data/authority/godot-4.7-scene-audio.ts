/**
 * Audio: `AudioStreamPlayer` and `AudioStreamPlayer3D` nodes, `.wav` streams the `wav` importer
 * imports (loaded by `AudioStreamWAV` from their copies), and `AudioStreamRandomizer` resources.
 *
 */
import { GODOT_4_7_CODE_SEED_SOURCE_REVISION } from '../../code/authority/godot-4.7-seed';
import type { GodotSceneResourceRule } from '../scene-node-authority';

const REVISION = GODOT_4_7_CODE_SEED_SOURCE_REVISION;

type Source = Readonly<{ file: string; symbol: string; line: number }>;

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
