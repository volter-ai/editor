/** AudioStreamPlayer: playback state and settings (`audio-players.ts`), and `AudioStreamPlayer.new()`. */
import { Group, Scene } from 'three';
import * as P from '../../capabilities/catalog/project-source/src/lib/godot-compat/audio-stream-player';
import * as N from '../../capabilities/catalog/project-source/src/lib/godot-compat/node';
import * as ST from '../../capabilities/catalog/project-source/src/lib/godot-compat/scene-tree';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { playerCases } from './audio-players';
import { signalCase } from './native-signal-case';

// A player a script makes (`AudioStreamPlayer.new()`, as the kits' audio autoloads do), added to
// the tree: its defaults and that it entered.
const constructed = {
  id: 'new-in-tree',
  symbol: { kind: 'native-constructor' as const, owner: 'AudioStreamPlayer', member: 'AudioStreamPlayer' },
  gdscript: ['var p := AudioStreamPlayer.new()', 'holder.add_child(p)', 'return [p.volume_db, p.pitch_scale, p.is_playing(), p.max_polyphony, p.bus, p.is_inside_tree()]'].join('\n'),
  target: () => {
    const root = new Scene();
    ST.godot_tree_set_root(root);
    const holder = new Group();
    N.godot_node_adopt(holder, { kind: 'node' });
    N.add_child(root, holder);
    const p = P.construct();
    N.add_child(holder, p);
    return [P.get_volume_db(p), P.get_pitch_scale(p), P.is_playing(p), P.get_max_polyphony(p), P.get_bus(p), N.is_inside_tree(p)];
  },
  comparator: 'exact' as const,
};

const EVIDENCE: GodotEvidenceCaseFile = {
  kind: 'node',
  godotClass: 'AudioStreamPlayer',
  compatModule: 'lib/godot-compat/audio-stream-player',
  cases: [
    ...playerCases('AudioStreamPlayer', P as never, (entity) => P.godot_audio_stream_player_mount(entity)),
    constructed,
    signalCase({ owner: 'AudioStreamPlayer', member: 'finished', make: 'AudioStreamPlayer.new()', free: 'o.free()', args: '', signal: () => ({ signal: P.finished(P.construct()) as never, args: [] }) }),
  ],
};
export default EVIDENCE;
