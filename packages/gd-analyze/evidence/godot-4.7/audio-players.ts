/**
 * Audio player cases: a player node in the tree (or not), its stream a two-second WAV, a sequence
 * of calls, then reads; official Godot plays through its (dummy) audio server and compat through
 * its playback state, with no Web Audio. A playback position mid-playback depends on the audio
 * thread's mixing, so only the idle position is read.
 */
import { Group, Mesh, Object3D, Scene } from 'three';
import * as N from '../../capabilities/catalog/project-source/src/lib/godot-compat/node';
import * as ST from '../../capabilities/catalog/project-source/src/lib/godot-compat/scene-tree';
import * as W from '../../capabilities/catalog/project-source/src/lib/godot-compat/audio-stream-wav';
import type { GodotEvidenceCase } from '../../src/evidence/case';
import { gd } from './literals';
import { LONG_WAV, wavBytes } from './wav-samples';

const BYTES = wavBytes(LONG_WAV);
const IMPORT = { trim: false, normalize: false, loopMode: 0, loopBegin: 0, loopEnd: -1, forceMono: false, compressMode: 0, force8Bit: false, forceMaxRate: false, maxRateHz: 44100 };

export type PlayerStep =
  | { readonly add: true }
  | { readonly stream: true }
  | { readonly call: string; readonly args?: readonly (number | boolean | string | { readonly int: number })[] }
  | { readonly set: string; readonly value: number | boolean | string };

const literal = (value: number | boolean | string | { readonly int: number }): string =>
  typeof value === 'object' ? String(value.int) : typeof value === 'number' ? gd(value) : typeof value === 'boolean' ? String(value) : JSON.stringify(value);
const plain = (value: number | boolean | string | { readonly int: number }): unknown => (typeof value === 'object' ? value.int : value);

export function playerCase(
  owner: 'AudioStreamPlayer' | 'AudioStreamPlayer3D',
  module: Readonly<Record<string, (...args: never[]) => unknown>>,
  mount: (entity: Object3D) => void,
  id: string,
  member: string,
  steps: readonly PlayerStep[],
  read: string,
): GodotEvidenceCase {
  const lines = [`var p := ${owner}.new()`];
  for (const step of steps) {
    if ('add' in step) lines.push('holder.add_child(p)');
    else if ('stream' in step) lines.push(`p.stream = AudioStreamWAV.load_from_buffer(PackedByteArray([${[...BYTES].join(', ')}]), {})`);
    else if ('call' in step) lines.push(`p.${step.call}(${(step.args ?? []).map(literal).join(', ')})`);
    else lines.push(`p.${step.set} = ${literal(step.value)}`);
  }
  const isNull = read.endsWith('==null');
  const getter = isNull ? read.slice(0, -'==null'.length) : read;
  lines.push(`var out = p.${getter}()${isNull ? ' == null' : ''}`, 'if not p.is_inside_tree():', '\tp.free()', 'return out');
  const call = (name: string, entity: Object3D, ...args: unknown[]): unknown => {
    const fn = module[name] as ((...values: unknown[]) => unknown) | undefined;
    if (fn === undefined) throw new Error(`no compat export ${name}`);
    return fn(entity, ...args);
  };
  return {
    id,
    symbol: { kind: 'native-member', owner, member },
    gdscript: lines.join('\n'),
    target: () => {
      const root = new Scene();
      ST.godot_tree_set_root(root);
      const holder = new Group();
      N.godot_node_adopt(holder, { kind: 'node' });
      N.add_child(root, holder);
      const entity = owner === 'AudioStreamPlayer' ? new Group() : new Mesh();
      N.godot_node_adopt(entity, { kind: owner === 'AudioStreamPlayer' ? 'node' : 'spatial', classes: [owner, 'Node'] });
      mount(entity);
      for (const step of steps) {
        if ('add' in step) N.add_child(holder, entity);
        else if ('stream' in step) {
          const stream = W.godot_audio_stream_wav_new();
          W.godot_audio_stream_wav_import(stream, BYTES, IMPORT);
          call('set_stream', entity, stream);
        } else if ('call' in step) call(step.call, entity, ...(step.args ?? []).map(plain));
        else call(step.set === 'autoplay' ? 'set_autoplay' : `set_${step.set}`, entity, step.value);
      }
      return isNull ? call(getter, entity) === null : call(getter, entity);
    },
    comparator: 'exact',
  };
}

/** The cases every player class shares. */
export function playerCases(
  owner: 'AudioStreamPlayer' | 'AudioStreamPlayer3D',
  module: Readonly<Record<string, (...args: never[]) => unknown>>,
  mount: (entity: Object3D) => void,
): GodotEvidenceCase[] {
  const add = (id: string, member: string, steps: readonly PlayerStep[], read: string): GodotEvidenceCase => playerCase(owner, module, mount, id, member, steps, read);
  return [
    add('is_playing-fresh', 'is_playing', [{ add: true }], 'is_playing'),
    add('play-in-tree', 'play', [{ add: true }, { stream: true }, { call: 'play' }], 'is_playing'),
    add('play-no-stream', 'play', [{ add: true }, { call: 'play' }], 'is_playing'),
    add('play-outside-tree', 'play', [{ stream: true }, { call: 'play' }], 'is_playing'),
    add('stop', 'stop', [{ add: true }, { stream: true }, { call: 'play' }, { call: 'stop' }], 'is_playing'),
    add('set_stream-while-playing', 'set_stream', [{ add: true }, { stream: true }, { call: 'play' }, { stream: true }], 'is_playing'),
    add('get_playback_position-idle', 'get_playback_position', [{ add: true }, { stream: true }], 'get_playback_position'),
    add('autoplay-enter', 'set_autoplay', [{ stream: true }, { set: 'autoplay', value: true }, { add: true }], 'is_playing'),
    add('set_playing', 'set_playing', [{ add: true }, { stream: true }, { set: 'playing', value: true }], 'is_playing'),
    add('set_volume_db', 'set_volume_db', [{ set: 'volume_db', value: -6.5 }], 'get_volume_db'),
    add('get_volume_db-default', 'get_volume_db', [], 'get_volume_db'),
    add('set_pitch_scale', 'set_pitch_scale', [{ set: 'pitch_scale', value: 1.25 }], 'get_pitch_scale'),
    add('set_pitch_scale-zero', 'set_pitch_scale', [{ call: 'set_pitch_scale', args: [0] }], 'get_pitch_scale'),
    add('get_pitch_scale-default', 'get_pitch_scale', [], 'get_pitch_scale'),
    add('set_bus-unknown', 'set_bus', [{ set: 'bus', value: 'SFX' }], 'get_bus'),
    add('get_bus-default', 'get_bus', [], 'get_bus'),
    add('set_autoplay', 'set_autoplay', [{ set: 'autoplay', value: true }], 'is_autoplay_enabled'),
    add('is_autoplay_enabled-default', 'is_autoplay_enabled', [], 'is_autoplay_enabled'),
    add('set_max_polyphony', 'set_max_polyphony', [{ set: 'max_polyphony', value: 3 }], 'get_max_polyphony'),
    add('set_max_polyphony-zero', 'set_max_polyphony', [{ call: 'set_max_polyphony', args: [0] }], 'get_max_polyphony'),
    add('get_max_polyphony-default', 'get_max_polyphony', [], 'get_max_polyphony'),
    add('get_stream-default', 'get_stream', [], 'get_stream==null'),
    add('get_stream-set', 'get_stream', [{ stream: true }], 'get_stream==null'),
  ];
}
