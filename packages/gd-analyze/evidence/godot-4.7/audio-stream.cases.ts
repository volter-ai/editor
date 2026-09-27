/**
 * AudioStream: the length of WAV streams imported with the `wav` importer's options (trimming and
 * its fade-out, normalizing, loops, mono) in official Godot and on the page.
 */
import * as AS from '../../capabilities/catalog/project-source/src/lib/godot-compat/audio-stream';
import * as R from '../../capabilities/catalog/project-source/src/lib/godot-compat/audio-stream-randomizer';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { nativeLoad, OPTIONS, targetLoad } from './audio-stream-wav.cases';
import { resourceCases } from './resource-cases';
import { WAVS, wavBytes } from './wav-samples';

const c = resourceCases('AudioStream');

for (const spec of WAVS) {
  const bytes = wavBytes(spec);
  for (const [name, options] of OPTIONS) {
    c.add(`get_length-${spec.name}-${name}`, 'get_length', [nativeLoad(bytes, options), 'return s.get_length()'], () => AS.get_length(targetLoad(bytes, options)));
  }
}
c.add('get_length-randomizer-unplayed', 'get_length', ['return AudioStreamRandomizer.new().get_length()'], () => AS.get_length(R.godot_audio_stream_randomizer_new()));

const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'AudioStream', compatModule: 'lib/godot-compat/audio-stream', cases: c.cases };
export default EVIDENCE;
