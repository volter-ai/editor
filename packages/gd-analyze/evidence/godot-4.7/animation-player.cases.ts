import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import * as SK from '../../capabilities/catalog/project-source/src/lib/godot-compat/skeleton-3d';
import * as V from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector3';
import { type AnimSpec, call, frames, log, type Op, read, type Step, timelineCase, type World } from './animation-timeline';

const SK_set_pose = (w: World): void => SK.set_bone_pose_position(w.s, 0, V.construct(9, 9, 9));

/** A RESET giving the tracks MOVE animates their initial values. */
export const RESET: AnimSpec = {
  name: 'RESET',
  length: 0.001,
  tracks: [
    { type: 'value', path: 'A:position', keys: [[0, [1, 2, 3]]] },
    { type: 'value', path: 'L:omni_range', keys: [[0, 5]] },
    { type: 'value', path: 'L:shadow_enabled', update: 1, keys: [[0, true]] },
  ],
};
/** Continuous (linear and eased), discrete and method tracks over half a second. */
export const MOVE: AnimSpec = {
  name: 'move',
  length: 0.5,
  tracks: [
    { type: 'value', path: 'A:position', keys: [[0, [0, 0, 0]], [0.5, [2, 0, -1]]] },
    { type: 'value', path: 'L:omni_range', keys: [[0, 5, -2], [0.5, 0, -2]] },
    { type: 'value', path: 'L:shadow_enabled', update: 1, keys: [[0, false], [0.25, true]] },
    { type: 'method', path: 'L', keys: [[0.1, { method: 'set_param', args: [{ int: 0 }, 3.5] }]] },
    { type: 'method', path: 'A', keys: [[0.3, { method: 'rotate_y', args: [0.5] }]] },
  ],
};
export const FADE: AnimSpec = {
  name: 'fade',
  length: 0.4,
  tracks: [{ type: 'value', path: 'A:position', keys: [[0, [0, 5, 0]], [0.4, [0, 0, 0]]] }],
};
export const SPIN: AnimSpec = {
  name: 'spin',
  length: 1,
  loop: 1,
  tracks: [
    { type: 'value', path: 'A:rotation', keys: [[0, [1.5708, 6.28319, 0]], [1, [1.5708, 0, 0]]] },
    { type: 'value', path: 'L:shadow_enabled', update: 1, keys: [[0, true], [0.5, false]] },
  ],
};
export const XFORM: AnimSpec = {
  name: 'xform',
  length: 1,
  tracks: [
    { type: 'position_3d', path: 'A', keys: [[0, [0, 0, 0]], [1, [1, 2, 3]]] },
    { type: 'rotation_3d', path: 'A', keys: [[0, [0, 0, 0, 1]], [1, [0, 0.7071068, 0, 0.7071068]]] },
    { type: 'scale_3d', path: 'A', keys: [[0, [1, 1, 1]], [1, [2, 2, 2]]] },
  ],
};
export const TURN: AnimSpec = {
  name: 'turn',
  length: 0.5,
  tracks: [{ type: 'rotation_3d', path: 'A', keys: [[0, [0, 0, 0, 1]], [0.5, [0, 0.3826834, 0, 0.9238795]]] }],
};
/** Bone tracks on the skeleton `S`: position and rotation of `b0`, scale of `b0`, rotation of `b1`, a missing bone. */
export const BONES: AnimSpec = {
  name: 'bones',
  length: 0.5,
  tracks: [
    { type: 'position_3d', path: 'S:b0', keys: [[0, [0, 1, 0]], [0.5, [1, 1, -2]]] },
    { type: 'rotation_3d', path: 'S:b0', keys: [[0, [0, 0, 0, 1]], [0.5, [0, 0, 0.3826834, 0.9238795]]] },
    { type: 'scale_3d', path: 'S:b0', keys: [[0, [1, 1, 1]], [0.5, [0.5, 2, 1]]] },
    { type: 'rotation_3d', path: 'S:b1', keys: [[0.25, [0.3826834, 0, 0, 0.9238795]]] },
    { type: 'position_3d', path: 'S:nope', keys: [[0, [5, 5, 5]]] },
  ],
};
export const HOP: AnimSpec = {
  name: 'hop',
  library: 'extra',
  length: 0.2,
  tracks: [{ type: 'value', path: 'A:scale', keys: [[0, [1, 1, 1]], [0.2, [1, 3, 1]]] }],
};

const now = (...ops: Op[]): Step => ({ ops });
const all = (): Op[] => [read.a(), read.l(), read.p()];

export const PLAYER_CASES = [
  timelineCase('play-reset-move', { kind: 'native-member', owner: 'AnimationPlayer', member: 'play' }, {
    animations: [RESET, MOVE],
    steps: [now(read.a(), read.l(), call('play', 'move'), ...all()), ...frames(36, ...all())],
  }),
  timelineCase('play-without-reset', { kind: 'native-member', owner: 'AnimationPlayer', member: 'play' }, {
    animations: [MOVE],
    steps: [now(call('play', 'move'), ...all()), ...frames(34, read.a(), read.l())],
  }),
  timelineCase('set_autoplay-loop', { kind: 'native-member', owner: 'AnimationPlayer', member: 'set_autoplay' }, {
    animations: [SPIN],
    setup: [call('set_autoplay', 'spin')],
    steps: [now(read.a(), read.l(), read.p()), ...frames(66, read.a(), read.l(), read.p())],
  }),
  timelineCase('get_autoplay', { kind: 'native-member', owner: 'AnimationPlayer', member: 'get_autoplay' }, {
    animations: [SPIN],
    setup: [log('get_autoplay'), call('set_autoplay', 'spin'), log('get_autoplay')],
    steps: [now(log('get_autoplay'))],
  }),
  timelineCase('queue-then-finish', { kind: 'native-member', owner: 'AnimationPlayer', member: 'queue' }, {
    animations: [RESET, MOVE, FADE],
    steps: [now(call('play', 'move'), call('queue', 'fade'), log('get_queue')), ...frames(60, read.a(), read.p())],
  }),
  timelineCase('queue-when-stopped', { kind: 'native-member', owner: 'AnimationPlayer', member: 'queue' }, {
    animations: [MOVE, FADE],
    steps: [now(call('queue', 'fade'), log('get_queue'), read.p()), ...frames(3, read.a(), read.p())],
  }),
  timelineCase('get_queue', { kind: 'native-member', owner: 'AnimationPlayer', member: 'get_queue' }, {
    animations: [MOVE, FADE],
    steps: [now(call('play', 'move'), call('queue', 'fade'), call('queue', 'move'), log('get_queue')), ...frames(2, log('get_queue'))],
  }),
  timelineCase('clear_queue', { kind: 'native-member', owner: 'AnimationPlayer', member: 'clear_queue' }, {
    animations: [MOVE, FADE],
    steps: [now(call('play', 'move'), call('queue', 'fade'), call('clear_queue'), log('get_queue')), ...frames(34, read.p())],
  }),
  timelineCase('stop', { kind: 'native-member', owner: 'AnimationPlayer', member: 'stop' }, {
    animations: [RESET, MOVE],
    steps: [now(call('play', 'move')), ...frames(10, read.a()), now(call('stop'), ...all()), ...frames(3, ...all()), now(call('play', 'move'), ...all()), ...frames(4, ...all())],
  }),
  timelineCase('stop-keep_state', { kind: 'native-member', owner: 'AnimationPlayer', member: 'stop' }, {
    animations: [RESET, MOVE],
    steps: [now(call('play', 'move')), ...frames(10, read.a()), now(call('stop', true), ...all()), ...frames(2, ...all()), now(call('play', 'move')), ...frames(3, ...all())],
  }),
  timelineCase('pause-resume', { kind: 'native-member', owner: 'AnimationPlayer', member: 'pause' }, {
    animations: [RESET, MOVE],
    steps: [now(call('play', 'move')), ...frames(10, read.a()), now(call('pause'), ...all()), ...frames(3, ...all()), now(call('play'), ...all()), ...frames(25, ...all())],
  }),
  timelineCase('is_playing', { kind: 'native-member', owner: 'AnimationPlayer', member: 'is_playing' }, {
    animations: [MOVE],
    steps: [now(log('is_playing'), call('play', 'move'), log('is_playing')), ...frames(32, log('is_playing'))],
  }),
  timelineCase('seek-while-playing', { kind: 'native-member', owner: 'AnimationPlayer', member: 'seek' }, {
    animations: [RESET, MOVE],
    steps: [now(call('play', 'move'), call('seek', 0.3, true), ...all()), now(call('seek', 0.05, true), ...all()), ...frames(5, ...all()), now(call('seek', 0.45)), ...frames(6, ...all())],
  }),
  timelineCase('seek-assigned', { kind: 'native-member', owner: 'AnimationPlayer', member: 'seek' }, {
    animations: [RESET, MOVE],
    steps: [now(call('set_assigned_animation', 'move'), call('seek', 0.26, true), ...all()), now(call('seek', 0.1, true, true), ...all()), ...frames(2, ...all())],
  }),
  timelineCase('set_assigned_animation', { kind: 'native-member', owner: 'AnimationPlayer', member: 'set_assigned_animation' }, {
    animations: [MOVE, FADE],
    steps: [now(call('set_assigned_animation', 'fade'), read.p(), call('play'), read.p()), ...frames(3, read.a(), read.p()), now(call('set_assigned_animation', 'move'), read.p()), ...frames(3, read.a(), read.p())],
  }),
  timelineCase('get_assigned_animation', { kind: 'native-member', owner: 'AnimationPlayer', member: 'get_assigned_animation' }, {
    animations: [MOVE],
    steps: [now(log('get_assigned_animation'), call('play', 'move'), log('get_assigned_animation')), ...frames(32, log('get_assigned_animation'))],
  }),
  timelineCase('set_current_animation', { kind: 'native-member', owner: 'AnimationPlayer', member: 'set_current_animation' }, {
    animations: [MOVE, FADE],
    steps: [now(call('set_current_animation', 'move'), read.p()), ...frames(5, read.a()), now(call('set_current_animation', 'fade'), read.p()), ...frames(5, read.a(), read.p()), now(call('set_current_animation', '[stop]'), read.p()), ...frames(3, read.a(), read.p())],
  }),
  timelineCase('get_current_animation', { kind: 'native-member', owner: 'AnimationPlayer', member: 'get_current_animation' }, {
    animations: [MOVE],
    steps: [now(log('get_current_animation'), call('play', 'move'), log('get_current_animation')), ...frames(32, log('get_current_animation'))],
  }),
  timelineCase('set_speed_scale', { kind: 'native-member', owner: 'AnimationPlayer', member: 'set_speed_scale' }, {
    animations: [RESET, MOVE],
    steps: [now(call('set_speed_scale', 2), call('play', 'move'), log('get_speed_scale'), log('get_playing_speed')), ...frames(18, ...all())],
  }),
  timelineCase('get_playing_speed', { kind: 'native-member', owner: 'AnimationPlayer', member: 'get_playing_speed' }, {
    animations: [MOVE],
    steps: [now(log('get_playing_speed'), call('play', 'move', -1, 0.5), log('get_playing_speed'), call('set_speed_scale', 3), log('get_playing_speed'))],
  }),
  timelineCase('play-custom-speed', { kind: 'native-member', owner: 'AnimationPlayer', member: 'play' }, {
    animations: [RESET, MOVE],
    steps: [now(call('play', 'move', -1, 0.75)), ...frames(42, read.a(), read.p())],
  }),
  timelineCase('play_backwards', { kind: 'native-member', owner: 'AnimationPlayer', member: 'play_backwards' }, {
    animations: [RESET, MOVE],
    steps: [now(call('play_backwards', 'move'), ...all()), ...frames(34, ...all())],
  }),
  timelineCase('set_blend_time', { kind: 'native-member', owner: 'AnimationPlayer', member: 'set_blend_time' }, {
    animations: [MOVE, FADE],
    steps: [now(call('set_blend_time', 'move', 'fade', 0.2), log('get_blend_time', 'move', 'fade'), call('play', 'move')), ...frames(10, read.a()), now(call('play', 'fade')), ...frames(30, read.a(), read.p())],
  }),
  timelineCase('get_blend_time', { kind: 'native-member', owner: 'AnimationPlayer', member: 'get_blend_time' }, {
    animations: [MOVE, FADE],
    steps: [now(log('get_blend_time', 'move', 'fade'), call('set_blend_time', 'move', 'fade', 0.25), call('set_blend_time', 'fade', 'nope', 0.5), log('get_blend_time', 'move', 'fade'), log('get_blend_time', 'fade', 'nope'), call('set_blend_time', 'move', 'fade', 0), log('get_blend_time', 'move', 'fade'))],
  }),
  timelineCase('set_default_blend_time', { kind: 'native-member', owner: 'AnimationPlayer', member: 'set_default_blend_time' }, {
    animations: [MOVE, FADE],
    steps: [now(call('set_default_blend_time', 0.1), log('get_default_blend_time'), call('play', 'fade')), ...frames(5, read.a()), now(call('play', 'move')), ...frames(12, read.a())],
  }),
  timelineCase('get_default_blend_time', { kind: 'native-member', owner: 'AnimationPlayer', member: 'get_default_blend_time' }, {
    animations: [MOVE],
    steps: [now(log('get_default_blend_time'))],
  }),
  timelineCase('play-custom-blend', { kind: 'native-member', owner: 'AnimationPlayer', member: 'play' }, {
    animations: [MOVE, FADE],
    steps: [now(call('play', 'fade')), ...frames(6, read.a()), now(call('play', 'move', 0.15)), ...frames(14, read.a())],
  }),
  timelineCase('play-transforms', { kind: 'native-member', owner: 'AnimationPlayer', member: 'play' }, {
    animations: [XFORM],
    steps: [now(call('play', 'xform'), read.a()), ...frames(62, read.a())],
  }, 'float32-ulp'),
  timelineCase('play-rotation-only', { kind: 'native-member', owner: 'AnimationPlayer', member: 'play' }, {
    animations: [TURN],
    steps: [now(call('play', 'turn'), read.a()), ...frames(32, read.a())],
  }, 'float32-ulp'),
  timelineCase('play-bone-tracks', { kind: 'native-member', owner: 'AnimationPlayer', member: 'play' }, {
    animations: [BONES],
    setup: [{ gd: ['s.set_bone_pose_position(0, Vector3(9, 9, 9))'], ts: (w) => SK_set_pose(w) }],
    steps: [now(read.s(), call('play', 'bones'), read.s()), ...frames(34, read.s())],
  }, 'float32-ulp'),
  timelineCase('play-library', { kind: 'native-member', owner: 'AnimationPlayer', member: 'play' }, {
    animations: [MOVE, HOP],
    steps: [now(call('play', 'extra/hop'), read.a(), read.p()), ...frames(14, read.a(), read.p())],
  }),
  timelineCase('animation_set_next', { kind: 'native-member', owner: 'AnimationPlayer', member: 'animation_set_next' }, {
    animations: [MOVE, FADE],
    steps: [now(call('animation_set_next', 'move', 'fade'), log('animation_get_next', 'move'), call('play', 'move'), log('get_queue')), ...frames(58, read.a(), read.p())],
  }),
  timelineCase('animation_get_next', { kind: 'native-member', owner: 'AnimationPlayer', member: 'animation_get_next' }, {
    animations: [MOVE, FADE],
    steps: [now(log('animation_get_next', 'move'), call('animation_set_next', 'move', 'fade'), log('animation_get_next', 'move'), call('animation_set_next', 'nope', 'fade'), log('animation_get_next', 'nope'))],
  }),
  timelineCase('play_section', { kind: 'native-member', owner: 'AnimationPlayer', member: 'play_section' }, {
    animations: [RESET, MOVE],
    steps: [now(call('play_section', 'move', 0.1, 0.3), log('has_section'), log('get_section_start_time'), log('get_section_end_time'), ...all()), ...frames(16, ...all())],
  }),
  timelineCase('play_section_backwards', { kind: 'native-member', owner: 'AnimationPlayer', member: 'play_section_backwards' }, {
    animations: [RESET, MOVE],
    steps: [now(call('play_section_backwards', 'move', 0.1, 0.4), ...all()), ...frames(22, ...all())],
  }),
  timelineCase('set_section', { kind: 'native-member', owner: 'AnimationPlayer', member: 'set_section' }, {
    animations: [MOVE],
    steps: [now(call('play', 'move')), ...frames(3, read.p()), now(call('set_section', 0.2, 0.35), read.p(), log('has_section')), ...frames(12, read.a(), read.p()), now(call('reset_section'), log('has_section'), log('get_section_end_time'))],
  }),
  timelineCase('reset_section', { kind: 'native-member', owner: 'AnimationPlayer', member: 'reset_section' }, {
    animations: [MOVE],
    steps: [now(call('play_section', 'move', 0.1, 0.2), call('reset_section'), log('has_section'), log('get_section_start_time'), log('get_section_end_time')), ...frames(3, read.p())],
  }),
  timelineCase('has_section', { kind: 'native-member', owner: 'AnimationPlayer', member: 'has_section' }, {
    animations: [MOVE],
    steps: [now(log('has_section'), call('play', 'move'), log('has_section'))],
  }),
  timelineCase('get_section_start_time', { kind: 'native-member', owner: 'AnimationPlayer', member: 'get_section_start_time' }, {
    animations: [MOVE],
    steps: [now(call('play_section', 'move', 0.2, -1), log('get_section_start_time'))],
  }),
  timelineCase('get_section_end_time', { kind: 'native-member', owner: 'AnimationPlayer', member: 'get_section_end_time' }, {
    animations: [MOVE],
    steps: [now(call('play_section', 'move', -1, 0.9), log('get_section_end_time'), log('get_section_start_time'))],
  }),
  timelineCase('get_current_animation_position', { kind: 'native-member', owner: 'AnimationPlayer', member: 'get_current_animation_position' }, {
    animations: [SPIN],
    steps: [now(call('play', 'spin'), log('get_current_animation_position')), ...frames(64, log('get_current_animation_position'))],
  }),
  timelineCase('get_current_animation_length', { kind: 'native-member', owner: 'AnimationPlayer', member: 'get_current_animation_length' }, {
    animations: [MOVE, SPIN],
    steps: [now(log('get_current_animation_length'), call('play', 'move'), log('get_current_animation_length'), call('play', 'spin'), log('get_current_animation_length'))],
  }),
  timelineCase('is_animation_active', { kind: 'native-member', owner: 'AnimationPlayer', member: 'is_animation_active' }, {
    animations: [MOVE],
    steps: [now(log('is_animation_active'), call('play', 'move'), log('is_animation_active')), ...frames(31, log('is_animation_active')), now(call('stop'), log('is_animation_active'))],
  }),
  timelineCase('set_movie_quit_on_finish_enabled', { kind: 'native-member', owner: 'AnimationPlayer', member: 'set_movie_quit_on_finish_enabled' }, {
    animations: [MOVE],
    steps: [now(log('is_movie_quit_on_finish_enabled'), call('set_movie_quit_on_finish_enabled', true), log('is_movie_quit_on_finish_enabled'))],
  }),
  timelineCase('is_movie_quit_on_finish_enabled', { kind: 'native-member', owner: 'AnimationPlayer', member: 'is_movie_quit_on_finish_enabled' }, {
    animations: [MOVE],
    steps: [now(log('is_movie_quit_on_finish_enabled'))],
  }),
  timelineCase('set_auto_capture', { kind: 'native-member', owner: 'AnimationPlayer', member: 'set_auto_capture' }, {
    animations: [RESET, MOVE],
    steps: [now(log('is_auto_capture'), call('set_auto_capture', false), log('is_auto_capture'), call('play', 'move')), ...frames(4, read.a())],
  }),
  timelineCase('is_auto_capture', { kind: 'native-member', owner: 'AnimationPlayer', member: 'is_auto_capture' }, {
    animations: [MOVE],
    steps: [now(log('is_auto_capture'))],
  }),
  timelineCase('get_speed_scale', { kind: 'native-member', owner: 'AnimationPlayer', member: 'get_speed_scale' }, {
    animations: [MOVE],
    steps: [now(log('get_speed_scale'), call('set_speed_scale', -0.3), log('get_speed_scale'))],
  }),
];

const EVIDENCE: GodotEvidenceCaseFile = {
  kind: 'node',
  godotClass: 'AnimationPlayer',
  compatModule: 'lib/godot-compat/animation-player',
  cases: PLAYER_CASES,
};
export default EVIDENCE;
