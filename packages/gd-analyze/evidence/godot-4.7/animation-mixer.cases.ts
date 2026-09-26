import * as AL from '../../capabilities/catalog/project-source/src/lib/godot-compat/animation-library';
import * as AM from '../../capabilities/catalog/project-source/src/lib/godot-compat/animation-mixer';
import type { GodotEvidenceCaseFile, GodotEvidenceSymbol } from '../../src/evidence/case';
import { call, frames, log, logString, type Op, read, type Step, timelineCase } from './animation-timeline';
import { FADE, HOP, MOVE, RESET, SPIN } from './animation-player.cases';

const now = (...ops: Op[]): Step => ({ ops });
const all = (): Op[] => [read.a(), read.l(), read.p()];
const member = (name: string): GodotEvidenceSymbol => ({ kind: 'native-member', owner: 'AnimationMixer', member: name });
/** Whether `p.get_animation(name)` is the animation built `index`-th (`an<index>`). */
const isAnimation = (name: string, index: number, key: string): Op => ({
  gd: [`log.append(p.get_animation(${JSON.stringify(name)}) == an${String(index)})`],
  ts: (w) => w.log.push(AM.get_animation(w.p, name) === w.animations.get(key)),
});
const isLibrary = (name: string, library: string): Op => ({
  gd: [`log.append(p.get_animation_library(${JSON.stringify(name)}) == lib_${library})`],
  ts: (w) => w.log.push(AM.get_animation_library(w.p, name) === w.libraries.get(library)),
});
const findAnimation = (index: number, key: string): Op => ({
  gd: [`log.append([String(p.find_animation(an${String(index)})), String(p.find_animation_library(an${String(index)}))])`],
  ts: (w) => {
    const animation = w.animations.get(key);
    w.log.push(animation === undefined ? ['', ''] : [AM.find_animation(w.p, animation), AM.find_animation_library(w.p, animation)]);
  },
});

const CASES = [
  timelineCase('set_active', member('set_active'), {
    animations: [RESET, MOVE],
    steps: [now(call('play', 'move')), ...frames(5, read.a()), now(call('set_active', false), log('is_active'), ...all()), ...frames(4, ...all()), now(call('set_active', true)), ...frames(6, ...all())],
  }),
  timelineCase('is_active', member('is_active'), { animations: [MOVE], steps: [now(log('is_active'))] }),
  timelineCase('set_deterministic', member('set_deterministic'), {
    animations: [RESET, MOVE, FADE],
    setup: [call('set_deterministic', true)],
    steps: [now(log('is_deterministic'), call('set_blend_time', 'move', 'fade', 0.2), call('play', 'move')), ...frames(8, ...all()), now(call('play', 'fade')), ...frames(26, ...all())],
  }),
  timelineCase('is_deterministic', member('is_deterministic'), { animations: [MOVE], steps: [now(log('is_deterministic'))] }),
  timelineCase('set_callback_mode_process-physics', member('set_callback_mode_process'), {
    animations: [RESET, MOVE],
    setup: [call('set_callback_mode_process', { int: 0 })],
    steps: [now(call('play', 'move'), ...all()), ...Array.from({ length: 34 }, (): Step => ({ await: 'physics', ops: all() }))],
  }),
  timelineCase('set_callback_mode_process-manual', member('set_callback_mode_process'), {
    animations: [RESET, MOVE],
    setup: [call('set_callback_mode_process', { int: 2 })],
    steps: [now(call('play', 'move'), ...all()), ...frames(3, ...all()), now(call('advance', 0.1), ...all(), call('advance', 0.25), ...all(), call('advance', 0.3), ...all()), ...frames(2, ...all())],
  }),
  timelineCase('set_callback_mode_process-while-playing', member('set_callback_mode_process'), {
    animations: [RESET, MOVE],
    steps: [now(call('play', 'move')), ...frames(4, read.a()), now(call('set_callback_mode_process', { int: 0 }), log('get_callback_mode_process')), ...Array.from({ length: 6 }, (): Step => ({ await: 'physics', ops: [read.a()] }))],
  }),
  timelineCase('get_callback_mode_process', member('get_callback_mode_process'), { animations: [MOVE], steps: [now(log('get_callback_mode_process'))] }),
  timelineCase('set_callback_mode_method-immediate', member('set_callback_mode_method'), {
    animations: [RESET, MOVE],
    setup: [call('set_callback_mode_method', { int: 1 })],
    steps: [now(call('play', 'move'), log('get_callback_mode_method')), ...frames(24, read.a(), read.l())],
  }),
  timelineCase('get_callback_mode_method', member('get_callback_mode_method'), { animations: [MOVE], steps: [now(log('get_callback_mode_method'))] }),
  timelineCase('set_callback_mode_discrete-dominant', member('set_callback_mode_discrete'), {
    animations: [RESET, MOVE, SPIN],
    setup: [call('set_callback_mode_discrete', { int: 0 })],
    steps: [now(call('set_blend_time', 'spin', 'move', 0.3), call('play', 'spin')), ...frames(20, read.l()), now(call('play', 'move')), ...frames(24, read.l())],
  }),
  timelineCase('set_callback_mode_discrete-force-continuous', member('set_callback_mode_discrete'), {
    animations: [RESET, MOVE],
    setup: [call('set_callback_mode_discrete', { int: 2 })],
    steps: [now(call('play', 'move'), read.l()), ...frames(32, read.l())],
  }),
  timelineCase('get_callback_mode_discrete', member('get_callback_mode_discrete'), { animations: [MOVE], steps: [now(log('get_callback_mode_discrete'))] }),
  timelineCase('advance', member('advance'), {
    animations: [RESET, MOVE],
    setup: [call('set_callback_mode_process', { int: 2 })],
    steps: [now(call('play', 'move'), call('advance', 0), ...all(), call('advance', 0.2), ...all(), call('advance', 0.2), ...all(), call('advance', 0.2), ...all()), ...frames(1, ...all())],
  }),
  timelineCase('add_animation_library', member('add_animation_library'), {
    animations: [MOVE, HOP],
    steps: [now(log('get_animation_library_list'), log('get_animation_list'), log('has_animation', 'extra/hop'), log('has_animation', 'hop'))],
  }),
  timelineCase('get_animation_list', member('get_animation_list'), {
    animations: [SPIN, MOVE, FADE, HOP, RESET],
    steps: [now(log('get_animation_list'))],
  }),
  timelineCase('get_animation_library_list', member('get_animation_library_list'), { animations: [HOP, MOVE], steps: [now(log('get_animation_library_list'))] }),
  timelineCase('has_animation', member('has_animation'), { animations: [MOVE], steps: [now(log('has_animation', 'move'), log('has_animation', 'fade'), log('has_animation', '/move'))] }),
  timelineCase('has_animation_library', member('has_animation_library'), { animations: [MOVE, HOP], steps: [now(log('has_animation_library', ''), log('has_animation_library', 'extra'), log('has_animation_library', 'nope'))] }),
  timelineCase('get_animation', member('get_animation'), { animations: [MOVE, HOP], steps: [now(isAnimation('move', 0, 'move'), isAnimation('extra/hop', 1, 'extra/hop'), isAnimation('hop', 1, 'extra/hop'))] }),
  timelineCase('get_animation_library', member('get_animation_library'), { animations: [MOVE, HOP], steps: [now(isLibrary('', ''), isLibrary('extra', 'extra'))] }),
  timelineCase('find_animation', member('find_animation'), { animations: [MOVE, HOP], steps: [now(findAnimation(0, 'move'), findAnimation(1, 'extra/hop'))] }),
  timelineCase('find_animation_library', member('find_animation_library'), { animations: [HOP], steps: [now(findAnimation(0, 'extra/hop'))] }),
  timelineCase('remove_animation_library', member('remove_animation_library'), {
    animations: [MOVE, HOP],
    steps: [now(log('get_animation_list'), call('remove_animation_library', 'extra'), log('get_animation_list'), log('get_animation_library_list'), call('play', 'move')), ...frames(3, read.a(), read.p())],
  }),
  timelineCase('rename_animation_library', member('rename_animation_library'), {
    animations: [MOVE, HOP],
    steps: [now(call('rename_animation_library', 'extra', 'aaa'), log('get_animation_library_list'), log('get_animation_list'), call('play', 'aaa/hop')), ...frames(3, read.a(), read.p())],
  }),
  timelineCase('set_root_node', member('set_root_node'), {
    animations: [RESET, MOVE],
    steps: [now(logString('get_root_node'), call('set_root_node', '../A/..'), call('play', 'move')), ...frames(4, read.a()), now(call('set_root_node', 'nowhere')), ...frames(3, read.a(), read.p())],
  }),
  timelineCase('get_root_node', member('get_root_node'), { animations: [MOVE], steps: [now(logString('get_root_node'))] }),
  timelineCase('clear_caches', member('clear_caches'), {
    animations: [RESET, MOVE],
    steps: [now(call('play', 'move')), ...frames(5, read.a(), read.l()), now(call('clear_caches')), ...frames(5, read.a(), read.l())],
  }),
  timelineCase('set_reset_on_save_enabled', member('set_reset_on_save_enabled'), {
    animations: [MOVE],
    steps: [now(log('is_reset_on_save_enabled'), call('set_reset_on_save_enabled', false), log('is_reset_on_save_enabled'))],
  }),
  timelineCase('is_reset_on_save_enabled', member('is_reset_on_save_enabled'), { animations: [MOVE], steps: [now(log('is_reset_on_save_enabled'))] }),
  timelineCase('get_root_motion_track', member('get_root_motion_track'), { animations: [MOVE], steps: [now(logString('get_root_motion_track'))] }),
  timelineCase('set_root_motion_track-none', member('set_root_motion_track'), {
    animations: [RESET, MOVE],
    steps: [now(call('set_root_motion_track', ''), logString('get_root_motion_track'), call('play', 'move')), ...frames(3, read.a())],
  }),
  timelineCase('library-add_animation-while-playing', member('get_animation'), {
    animations: [RESET, MOVE, FADE],
    steps: [
      now(call('play', 'move')),
      ...frames(4, read.a()),
      now({
        gd: ['lib_.add_animation("move", an2)', 'log.append(p.get_animation("move") == an2)'],
        ts: (w) => {
          AL.add_animation(w.libraries.get('') as AL.AnimationLibrary, 'move', w.animations.get('fade') as never);
          w.log.push(AM.get_animation(w.p, 'move') === w.animations.get('fade'));
        },
      }),
      ...frames(4, read.a(), read.p()),
    ],
  }),
];

const EVIDENCE: GodotEvidenceCaseFile = {
  kind: 'node',
  godotClass: 'AnimationMixer',
  compatModule: 'lib/godot-compat/animation-mixer',
  cases: CASES,
};
export default EVIDENCE;
