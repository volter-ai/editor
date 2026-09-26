/**
 * AudioStreamPlayer3D: playback state and settings (`audio-players.ts`), its spatial settings, and
 * (`render-mapping`) the Web Audio panner each attenuation model maps to, cited to
 * `_get_attenuation_db`.
 */
import type { Object3D } from 'three';
import * as P3 from '../../capabilities/catalog/project-source/src/lib/godot-compat/audio-stream-player-3d';
import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { playerCase, playerCases } from './audio-players';

const mount = (entity: Object3D): void => P3.godot_audio_stream_player_3d_mount(entity);
const cases: GodotEvidenceCase[] = playerCases('AudioStreamPlayer3D', P3 as never, mount);
const add = (id: string, member: string, steps: Parameters<typeof playerCase>[5], read: string): void => {
  cases.push(playerCase('AudioStreamPlayer3D', P3 as never, mount, id, member, steps, read));
};
for (const [setter, getter, prop, values] of [
  ['set_unit_size', 'get_unit_size', 'unit_size', [3.5, 0.1]],
  ['set_max_db', 'get_max_db', 'max_db', [-2, 6]],
  ['set_max_distance', 'get_max_distance', 'max_distance', [30, -1]],
  ['set_attenuation_model', 'get_attenuation_model', 'attenuation_model', [2, 3, 7]],
  ['set_doppler_tracking', 'get_doppler_tracking', 'doppler_tracking', [1, 2]],
  ['set_panning_strength', 'get_panning_strength', 'panning_strength', [0.5, -1]],
] as const) {
  const integer = setter === 'set_attenuation_model' || setter === 'set_doppler_tracking';
  for (const value of values) add(`${setter}-${String(value)}`, setter, [{ call: setter, args: [integer ? { int: value } : value] }], getter);
  add(`${getter}-default`, getter, [], getter);
  void prop;
}

const SOURCE = { file: 'scene/3d/audio_stream_player_3d.cpp', symbol: 'AudioStreamPlayer3D::_get_attenuation_db', line: 233 };
for (const [model, fact] of [
  [0, 'inverse,4,1'],
  [1, 'exponential,4,2'],
  [2, `exponential,4,${String(Math.LN10)}`],
  [3, 'none'],
] as const) {
  cases.push({
    id: `three-panner-${String(model)}`,
    symbol: { kind: 'native-member', owner: 'AudioStreamPlayer3D', member: 'set_attenuation_model' },
    gdscript: '',
    target: () => {
      const params = P3.godot_audio_stream_player_3d_panner(model, 4);
      return params === null ? 'none' : [params.distanceModel, params.refDistance, params.rolloffFactor].join(',');
    },
    comparator: 'render-mapping',
    fact: { value: fact, source: SOURCE },
  });
}

const EVIDENCE: GodotEvidenceCaseFile = { kind: 'node', godotClass: 'AudioStreamPlayer3D', compatModule: 'lib/godot-compat/audio-stream-player-3d', cases };
export default EVIDENCE;
