/** AudioStreamRandomizer: its pool and randomization settings, set and read back. */
import * as R from '../../capabilities/catalog/project-source/src/lib/godot-compat/audio-stream-randomizer';
import * as W from '../../capabilities/catalog/project-source/src/lib/godot-compat/audio-stream-wav';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { gd } from './literals';
import { resourceCases } from './resource-cases';

const c = resourceCases('AudioStreamRandomizer');
for (const count of [0, 1, 3]) {
  c.add(`set_streams_count-${String(count)}`, 'set_streams_count', ['var r := AudioStreamRandomizer.new()', `r.streams_count = ${String(count)}`, 'return r.get_streams_count()'], () => {
    const r = R.godot_audio_stream_randomizer_new();
    R.set_streams_count(r, count);
    return R.get_streams_count(r);
  });
}
c.add('get_streams_count-default', 'get_streams_count', ['return AudioStreamRandomizer.new().get_streams_count()'], () => R.get_streams_count(R.godot_audio_stream_randomizer_new()));
for (const index of [0, 1, 5]) {
  c.add(`set_stream-${String(index)}`, 'set_stream', ['var r := AudioStreamRandomizer.new()', 'r.streams_count = 2', 'var w := AudioStreamWAV.new()', `r.set_stream(${String(index)}, w)`, `return [r.get_stream(0) == w, r.get_stream(1) == w, r.get_stream(${String(index)}) == null]`], () => {
    const r = R.godot_audio_stream_randomizer_new();
    R.set_streams_count(r, 2);
    const w = W.godot_audio_stream_wav_new();
    R.set_stream(r, index, w);
    return [R.get_stream(r, 0) === w, R.get_stream(r, 1) === w, R.get_stream(r, index) === null];
  });
}
c.add('get_stream-default', 'get_stream', ['var r := AudioStreamRandomizer.new()', 'r.streams_count = 1', 'return r.get_stream(0) == null'], () => {
  const r = R.godot_audio_stream_randomizer_new();
  R.set_streams_count(r, 1);
  return R.get_stream(r, 0) === null;
});
for (const weight of [0.25, 3]) {
  c.add(`set_stream_probability_weight-${gd(weight)}`, 'set_stream_probability_weight', ['var r := AudioStreamRandomizer.new()', 'r.streams_count = 2', `r.set_stream_probability_weight(1, ${gd(weight)})`, 'return [r.get_stream_probability_weight(0), r.get_stream_probability_weight(1), r.get_stream_probability_weight(4)]'], () => {
    const r = R.godot_audio_stream_randomizer_new();
    R.set_streams_count(r, 2);
    R.set_stream_probability_weight(r, 1, weight);
    return [R.get_stream_probability_weight(r, 0), R.get_stream_probability_weight(r, 1), R.get_stream_probability_weight(r, 4)];
  });
}
c.add('get_stream_probability_weight-default', 'get_stream_probability_weight', ['var r := AudioStreamRandomizer.new()', 'r.streams_count = 1', 'return r.get_stream_probability_weight(0)'], () => {
  const r = R.godot_audio_stream_randomizer_new();
  R.set_streams_count(r, 1);
  return R.get_stream_probability_weight(r, 0);
});
for (const [setter, getter, values] of [
  ['set_random_pitch', 'get_random_pitch', [1.03, 0.5, 2]],
  ['set_random_volume_offset_db', 'get_random_volume_offset_db', [3.3, -1, 0]],
  ['set_playback_mode', 'get_playback_mode', [0, 1, 2]],
] as const) {
  for (const value of values) {
    const literal = setter === 'set_playback_mode' ? String(value) : gd(value);
    c.add(`${setter}-${literal}`, setter, ['var r := AudioStreamRandomizer.new()', `r.${setter}(${literal})`, `return r.${getter}()`], () => {
      const r = R.godot_audio_stream_randomizer_new();
      R[setter](r, value);
      return R[getter](r);
    });
  }
  c.add(`${getter}-default`, getter, [`return AudioStreamRandomizer.new().${getter}()`], () => R[getter](R.godot_audio_stream_randomizer_new()));
}

const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'AudioStreamRandomizer', compatModule: 'lib/godot-compat/audio-stream-randomizer', cases: c.cases };
export default EVIDENCE;
