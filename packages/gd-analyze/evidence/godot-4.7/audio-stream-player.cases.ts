/** AudioStreamPlayer: playback state and settings (`audio-players.ts`). */
import * as P from '../../capabilities/catalog/project-source/src/lib/godot-compat/audio-stream-player';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { playerCases } from './audio-players';

const EVIDENCE: GodotEvidenceCaseFile = {
  kind: 'node',
  godotClass: 'AudioStreamPlayer',
  compatModule: 'lib/godot-compat/audio-stream-player',
  cases: playerCases('AudioStreamPlayer', P as never, (entity) => P.godot_audio_stream_player_mount(entity)),
};
export default EVIDENCE;
