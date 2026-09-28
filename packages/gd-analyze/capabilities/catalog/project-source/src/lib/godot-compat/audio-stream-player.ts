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
import { godot_node_adopt, godot_node_entity, godot_node_tree_signal, is_inside_tree } from './node';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';
import type { ReactElement } from 'react';
import { Group } from 'three';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';

const f32 = Math.fround;

interface Playback {
  /** When the source last started, and the stream position it started from. */
  startedAt: number;
  from: number;
  /** The source's rate: the player's `pitch_scale` times the stream's own pitch. */
  rate: number;
  readonly streamPitch: number;
  /** The sounding source; null while paused, or where there is nothing to sound. */
  source: AudioBufferSourceNode | null;
  readonly gain: GainNode | null;
  /** Starts a source at a stream position, into the playback's gain. */
  readonly restart: ((from: number) => AudioBufferSourceNode) | null;
  readonly loop: { readonly begin: number; readonly end: number } | null;
  active: boolean;
  paused: boolean;
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

/**
 * A playback that ran to its end (`process`, `audio_stream_player_internal.cpp:66`): dropped, then
 * `finished`. The page's own audio says when a source ends (`onended`), so no frame polls for it;
 * `finished` is emitted then, between frames, where Godot emits it in its next process pass. One
 * stopped or evicted first is already inactive and emits nothing, as in Godot.
 */
function ended(state: GodotAudioPlayerState, playback: Playback): void {
  if (!playback.active) return;
  playback.active = false;
  const index = state.playbacks.indexOf(playback);
  if (index < 0) return;
  state.playbacks.splice(index, 1);
  state.finished.emit();
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
 * A new AudioStreamPlayer (`AudioStreamPlayer.new()`): a Node outside the tree, its playbacks
 * sounding in the page's output once it enters.
 *
 * @godot AudioStreamPlayer.AudioStreamPlayer
 * @source scene/audio/audio_stream_player.cpp:302
 */
export function construct(): Group {
  const entity = new Group();
  godot_node_adopt(entity, { kind: 'node', classes: ['AudioStreamPlayer', 'Node', 'Object'] });
  godot_audio_stream_player_mount(entity);
  return entity;
}

/**
 * The player's `finished` signal, emitted when a playback ends.
 *
 * @godot AudioStreamPlayer.finished
 * @source scene/audio/audio_stream_player_internal.cpp:82
 */
export function finished(self: object): GodotSignal<[]> {
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
  let gain: GainNode | null = null;
  let streamPitch = 1;
  let restart: Playback['restart'] = null;
  let loop: Playback['loop'] = null;
  if (audio !== null) {
    const start = godot_audio_stream_start(state.stream, audio);
    if (start !== null && start.buffer !== null) {
      const buffer = start.buffer;
      loop = start.loop;
      streamPitch = start.pitchScale;
      const into = audio.createGain();
      into.gain.value = f32(dbToLinear(state.volumeDb) * start.volumeScale);
      into.connect(state.output(audio));
      gain = into;
      restart = (from) => {
        const source = audio.createBufferSource();
        source.buffer = buffer;
        if (start.loop !== null) {
          source.loop = true;
          source.loopStart = start.loop.begin;
          source.loopEnd = start.loop.end;
        }
        source.playbackRate.value = playback.rate;
        source.connect(into);
        source.onended = () => ended(state, playback);
        source.start(0, from);
        return source;
      };
    }
  }
  // `AudioStreamPlaybackWAV::seek` (`audio_stream_wav.cpp:79`): the start clamped into the stream.
  const length = streamLength(state.stream);
  const from = from_position < 0 ? 0 : from_position >= length ? length - 0.001 : from_position;
  const playback: Playback = { startedAt: audio?.currentTime ?? 0, from, rate: f32(state.pitchScale * streamPitch), streamPitch, source: null, gain, restart, loop, active: true, paused: false };
  playback.source = restart === null ? null : restart(from);
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
  const last = stateOf(self, 'get_playback_position').playbacks.at(-1);
  return last === undefined ? 0 : f32(positionOf(last));
}

/** Where a playback is in its stream: its start plus the audio time since, at its rate, looped. */
function positionOf(playback: Playback): number {
  const audio = godot_audio_context();
  const position = playback.from + (audio === null || playback.source === null ? 0 : (audio.currentTime - playback.startedAt) * playback.rate);
  const loop = playback.loop;
  if (loop === null || position < loop.end || loop.end <= loop.begin) return position;
  return loop.begin + ((position - loop.begin) % (loop.end - loop.begin));
}

/**
 * Pauses or resumes every playback (`AudioStreamPlayerInternal::set_stream_paused`,
 * `audio_stream_player_internal.cpp:181`): a paused one keeps its place and stays playing, as the
 * web export's paused sample does; a Web Audio source cannot pause, so pausing stops it where it is
 * and resuming starts a new one there.
 *
 * @godot AudioStreamPlayer.set_stream_paused
 * @source scene/audio/audio_stream_player.cpp:175
 */
export function set_stream_paused(self: object, pause: boolean): void {
  const audio = godot_audio_context();
  for (const playback of stateOf(self, 'set_stream_paused').playbacks) {
    if (!playback.active || playback.paused === pause) continue;
    playback.paused = pause;
    if (pause) {
      playback.from = positionOf(playback);
      if (playback.source !== null) {
        playback.source.onended = null;
        playback.source.stop();
        playback.source = null;
      }
    } else if (playback.restart !== null) {
      playback.startedAt = audio?.currentTime ?? 0;
      playback.source = playback.restart(playback.from);
    }
  }
}

/**
 * Whether the first playback is paused (`AudioStreamPlayerInternal::get_stream_paused`,
 * `audio_stream_player_internal.cpp:191`); false with none.
 *
 * @godot AudioStreamPlayer.get_stream_paused
 * @source scene/audio/audio_stream_player.cpp:179
 */
export function get_stream_paused(self: object): boolean {
  return stateOf(self, 'get_stream_paused').playbacks[0]?.paused ?? false;
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
  const audio = godot_audio_context();
  for (const playback of state.playbacks) {
    // The position so far at the old rate, then on at the new one.
    playback.from = positionOf(playback);
    playback.startedAt = audio?.currentTime ?? 0;
    playback.rate = f32(state.pitchScale * playback.streamPitch);
    if (playback.source !== null) playback.source.playbackRate.value = playback.rate;
  }
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
