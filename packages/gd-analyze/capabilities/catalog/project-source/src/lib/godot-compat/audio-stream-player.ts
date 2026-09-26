/**
 * @godot-class AudioStreamPlayer
 * @role BINDING
 *
 * Godot 4.7's `AudioStreamPlayer` (`scene/audio/audio_stream_player.cpp` over
 * `AudioStreamPlayerInternal`, `scene/audio/audio_stream_player_internal.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto Web Audio, as the web export plays a
 * sample: each playback is an `AudioBufferSourceNode` of the stream's buffer (`audio-stream.ts`)
 * through a `GainNode` (`volume_db` as `db_to_linear`, times the stream's own volume) at the
 * `pitch_scale` times the stream's pitch, into the page's output. The player's state is Godot's:
 * playbacks start inside the tree, `max_polyphony` stops the oldest, `stop` stops all,
 * `is_playing` is whether a playback is active, `autoplay` plays on entering the tree, and
 * `finished` is emitted in the process step after a playback ends (`process`, `:66`). Audio
 * buses are not bound (every player plays into the page's output); where the page has no Web
 * Audio, playbacks stay active until stopped.
 */

import type { Object3D } from 'three';
import { get_length as streamLength, godot_audio_context, godot_audio_stream_start } from './audio-stream';
import { godot_node_entity, godot_node_tree_signal, is_inside_tree } from './node';
import { godot_tree } from './scene-tree';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';
import type { ReactElement } from 'react';
import { Group } from 'three';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';

const f32 = Math.fround;

interface Playback {
  readonly startedAt: number;
  readonly from: number;
  readonly rate: number;
  readonly source: AudioBufferSourceNode | null;
  readonly gain: GainNode | null;
  active: boolean;
}

/** The player state `AudioStreamPlayerInternal` keeps, for both player classes. */
export interface GodotAudioPlayerState {
  stream: object | null;
  volumeDb: number;
  pitchScale: number;
  bus: string;
  autoplay: boolean;
  maxPolyphony: number;
  readonly playbacks: Playback[];
  readonly finished: SignalHandle<[]>;
  /** Where a playback's gain connects: the page's output, or a 3D player's panner. */
  output: (audio: AudioContext) => AudioNode;
  processing: boolean;
}

const PLAYERS = new WeakMap<object, GodotAudioPlayerState>();

/** `Math::db_to_linear(float)` (`core/math/math_funcs.h:620`). */
const dbToLinear = (db: number): number => f32(Math.exp(f32(db * f32(0.11512925464970228))));

function stateOf(self: object, member: string): GodotAudioPlayerState {
  const state = PLAYERS.get(godot_node_entity(self));
  if (state === undefined) throw new Error(`godot-compat: ${member} on an object that is not an audio player`);
  return state;
}

/** `process` (`audio_stream_player_internal.cpp:66`): drop ended playbacks, then `finished`. */
function process(state: GodotAudioPlayerState): void {
  const ended = state.playbacks.filter((playback) => !playback.active);
  for (const playback of ended) state.playbacks.splice(state.playbacks.indexOf(playback), 1);
  if (ended.length > 0) state.finished.emit();
}

/**
 * Makes `entity` an audio player of `classes`; `output` is where its playbacks sound. Autoplay
 * plays as it enters the tree (`NOTIFICATION_ENTER_TREE`, `:94`).
 *
 * @godot AudioStreamPlayer (protocol)
 * @source scene/audio/audio_stream_player_internal.cpp:94
 */
export function godot_audio_player_mount(entity: Object3D, output: GodotAudioPlayerState['output']): GodotAudioPlayerState {
  const state: GodotAudioPlayerState = {
    stream: null,
    volumeDb: 0,
    pitchScale: 1,
    bus: 'Master',
    autoplay: false,
    maxPolyphony: 1,
    playbacks: [],
    finished: createSignal<[]>(),
    output,
    processing: false,
  };
  PLAYERS.set(entity, state);
  godot_node_tree_signal(entity, 'tree_entered').connect(() => {
    if (state.autoplay) play(entity, 0);
  });
  godot_tree().process_frame.connect(() => process(state));
  return state;
}

/**
 * Makes `entity` an AudioStreamPlayer, its playbacks sounding in the page's output.
 *
 * @godot AudioStreamPlayer (protocol)
 * @source scene/audio/audio_stream_player.cpp:302
 */
export function godot_audio_stream_player_mount(entity: Object3D): void {
  godot_audio_player_mount(entity, (audio) => audio.destination);
}

/**
 * The player's `finished` signal.
 *
 * @godot AudioStreamPlayer (protocol)
 * @source scene/audio/audio_stream_player_internal.cpp:82
 */
export function godot_audio_player_finished(self: object): GodotSignal<[]> {
  return stateOf(self, 'finished').finished.signal;
}

function stopAll(state: GodotAudioPlayerState): void {
  for (const playback of state.playbacks) {
    playback.active = false;
    playback.source?.stop();
  }
  state.playbacks.length = 0;
}

/**
 * Starts a playback at `from_position` seconds (`play_basic`, `:143`); outside the tree it fails.
 *
 * @godot AudioStreamPlayer.play
 * @source scene/audio/audio_stream_player.cpp:109
 */
export function play(self: object, from_position = 0.0): void {
  const state = stateOf(self, 'play');
  if (state.stream === null || !is_inside_tree(self)) return;
  const audio = godot_audio_context();
  let source: AudioBufferSourceNode | null = null;
  let gain: GainNode | null = null;
  let rate = state.pitchScale;
  if (audio !== null) {
    const start = godot_audio_stream_start(state.stream, audio);
    if (start !== null && start.buffer !== null) {
      source = audio.createBufferSource();
      source.buffer = start.buffer;
      if (start.loop !== null) {
        source.loop = true;
        source.loopStart = start.loop.begin;
        source.loopEnd = start.loop.end;
      }
      rate = f32(state.pitchScale * start.pitchScale);
      source.playbackRate.value = rate;
      gain = audio.createGain();
      gain.gain.value = f32(dbToLinear(state.volumeDb) * start.volumeScale);
      source.connect(gain).connect(state.output(audio));
    }
  }
  // `AudioStreamPlaybackWAV::seek` (`audio_stream_wav.cpp:79`): the start clamped into the stream.
  const length = streamLength(state.stream);
  const from = from_position < 0 ? 0 : from_position >= length ? length - 0.001 : from_position;
  const playback: Playback = { startedAt: audio?.currentTime ?? 0, from, rate, source, gain, active: true };
  if (source !== null) {
    source.onended = () => {
      playback.active = false;
    };
    source.start(0, from);
  }
  state.playbacks.push(playback);
  // `ensure_playback_limit` (`:87`).
  while (state.playbacks.length > state.maxPolyphony) {
    const oldest = state.playbacks.shift() as Playback;
    oldest.active = false;
    oldest.source?.stop();
  }
}

/**
 * @godot AudioStreamPlayer.stop
 * @source scene/audio/audio_stream_player.cpp:132
 */
export function stop(self: object): void {
  stopAll(stateOf(self, 'stop'));
}

/**
 * @godot AudioStreamPlayer.is_playing
 * @source scene/audio/audio_stream_player.cpp:136
 */
export function is_playing(self: object): boolean {
  return stateOf(self, 'is_playing').playbacks.some((playback) => playback.active);
}

/**
 * The most recent playback's position: its start plus the page's audio time since, at its rate.
 *
 * @godot AudioStreamPlayer.get_playback_position
 * @source scene/audio/audio_stream_player.cpp:140
 */
export function get_playback_position(self: object): number {
  const state = stateOf(self, 'get_playback_position');
  const last = state.playbacks[state.playbacks.length - 1];
  if (last === undefined) return 0;
  const audio = godot_audio_context();
  return f32(last.from + (audio === null || last.source === null ? 0 : (audio.currentTime - last.startedAt) * last.rate));
}

/**
 * Stops the playbacks and takes the stream (`set_stream`, `:257`).
 *
 * @godot AudioStreamPlayer.set_stream
 * @source scene/audio/audio_stream_player.cpp:51
 */
export function set_stream(self: object, stream: object | null): void {
  const state = stateOf(self, 'set_stream');
  stopAll(state);
  state.stream = stream;
}

/**
 * @godot AudioStreamPlayer.get_stream
 * @source scene/audio/audio_stream_player.cpp:67
 */
export function get_stream(self: object): object | null {
  return stateOf(self, 'get_stream').stream;
}

/**
 * @godot AudioStreamPlayer.set_volume_db
 * @source scene/audio/audio_stream_player.cpp:71
 */
export function set_volume_db(self: object, volume_db: number): void {
  const state = stateOf(self, 'set_volume_db');
  state.volumeDb = f32(volume_db);
  for (const playback of state.playbacks) if (playback.gain !== null) playback.gain.gain.value = dbToLinear(state.volumeDb);
}

/**
 * @godot AudioStreamPlayer.get_volume_db
 * @source scene/audio/audio_stream_player.cpp:81
 */
export function get_volume_db(self: object): number {
  return stateOf(self, 'get_volume_db').volumeDb;
}

/**
 * A scale of 0 or less fails.
 *
 * @godot AudioStreamPlayer.set_pitch_scale
 * @source scene/audio/audio_stream_player.cpp:93
 */
export function set_pitch_scale(self: object, pitch_scale: number): void {
  if (pitch_scale <= 0) return;
  const state = stateOf(self, 'set_pitch_scale');
  state.pitchScale = f32(pitch_scale);
  for (const playback of state.playbacks) if (playback.source !== null) playback.source.playbackRate.value = state.pitchScale;
}

/**
 * @godot AudioStreamPlayer.get_pitch_scale
 * @source scene/audio/audio_stream_player.cpp:97
 */
export function get_pitch_scale(self: object): number {
  return stateOf(self, 'get_pitch_scale').pitchScale;
}

/**
 * The bus is stored; buses are not bound.
 *
 * @godot AudioStreamPlayer.set_bus
 * @source scene/audio/audio_stream_player.cpp:144
 */
export function set_bus(self: object, bus: string): void {
  stateOf(self, 'set_bus').bus = bus;
}

/**
 * The bus when the layout has it, else `Master` (`AudioStreamPlayerInternal::get_bus`,
 * `audio_stream_player_internal.cpp:348`); the layout is the default one, `Master` alone.
 *
 * @godot AudioStreamPlayer.get_bus
 * @source scene/audio/audio_stream_player.cpp:151
 */
export function get_bus(self: object): string {
  const bus = stateOf(self, 'get_bus').bus;
  return bus === 'Master' ? bus : 'Master';
}

/**
 * @godot AudioStreamPlayer.set_autoplay
 * @source scene/audio/audio_stream_player.cpp:155
 */
export function set_autoplay(self: object, enable: boolean): void {
  stateOf(self, 'set_autoplay').autoplay = enable;
}

/**
 * @godot AudioStreamPlayer.is_autoplay_enabled
 * @source scene/audio/audio_stream_player.cpp:159
 */
export function is_autoplay_enabled(self: object): boolean {
  return stateOf(self, 'is_autoplay_enabled').autoplay;
}

/**
 * @godot AudioStreamPlayer.set_playing
 * @source scene/audio/audio_stream_player.cpp:171
 */
export function set_playing(self: object, enable: boolean): void {
  if (enable) play(self, 0);
  else stop(self);
}

/**
 * A count under 1 is ignored.
 *
 * @godot AudioStreamPlayer.set_max_polyphony
 * @source scene/audio/audio_stream_player.cpp:101
 */
export function set_max_polyphony(self: object, max_polyphony: number): void {
  if (max_polyphony > 0) stateOf(self, 'set_max_polyphony').maxPolyphony = Math.trunc(max_polyphony);
}

/**
 * @godot AudioStreamPlayer.get_max_polyphony
 * @source scene/audio/audio_stream_player.cpp:105
 */
export function get_max_polyphony(self: object): number {
  return stateOf(self, 'get_max_polyphony').maxPolyphony;
}

/**
 * The properties both audio players state (`audio_stream_player.cpp:283`), by their setters.
 *
 * @godot AudioStreamPlayer (protocol)
 * @source scene/audio/audio_stream_player.cpp:283
 */
export function godot_audio_player_props(
  setters: Readonly<Record<'stream' | 'volumeDb' | 'pitchScale' | 'autoplay' | 'maxPolyphony' | 'bus', (entity: Object3D, value: never) => void>>,
): (readonly [string, GodotElementProp<Object3D>])[] {
  return Object.entries(setters);
}

const AUDIO_STREAM_PLAYER = {
  create: () => new Group(),
  classes: ['AudioStreamPlayer', 'Node', 'Object'],
  spatial: false,
  mount: godot_audio_stream_player_mount,
  props: new Map<string, GodotElementProp<Object3D>>(
    godot_audio_player_props({
      stream: (entity, value: object | null) => set_stream(entity, value),
      volumeDb: (entity, value: number) => set_volume_db(entity, value),
      pitchScale: (entity, value: number) => set_pitch_scale(entity, value),
      autoplay: (entity, value: boolean) => set_autoplay(entity, value),
      maxPolyphony: (entity, value: number) => set_max_polyphony(entity, value),
      bus: (entity, value: string) => set_bus(entity, value),
    }),
  ),
};

/**
 * An AudioStreamPlayer as a scene writes it: `<GodotAudioStreamPlayer stream={music} volumeDb={-6} />`.
 *
 * @godot AudioStreamPlayer (protocol)
 * @source scene/audio/audio_stream_player.cpp:283
 */
export function GodotAudioStreamPlayer(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(AUDIO_STREAM_PLAYER, props);
}
