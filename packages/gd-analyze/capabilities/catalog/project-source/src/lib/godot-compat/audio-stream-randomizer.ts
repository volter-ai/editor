/**
 * @godot-class AudioStreamRandomizer
 * @role PROTOCOL
 *
 * Godot 4.7's `AudioStreamRandomizer` (`servers/audio/audio_stream.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a pool of weighted streams, one chosen for each
 * playback by the playback mode on the global random generator (`Math::random`, `Math::randf`),
 * played at a random pitch (log-uniform within the `random_pitch` factor) and volume offset
 * (`AudioStreamPlaybackRandomizer::start`, `audio_stream.cpp:792`). Sequential mode is not bound.
 */

import { type GodotAudioStart, godot_audio_stream_register, godot_audio_stream_start, get_length as streamLength } from './audio-stream';
import { randf_range } from './global-scope';

const f32 = Math.fround;

/** `PlaybackMode` (`audio_stream.h:276`). */
const PLAYBACK_RANDOM_NO_REPEATS = 0;
const PLAYBACK_RANDOM = 1;

interface PoolEntry {
  stream: object | null;
  weight: number;
}

export interface AudioStreamRandomizer {
  readonly pool: PoolEntry[];
  randomPitch: number;
  randomVolumeOffsetDb: number;
  playbackMode: number;
  lastPlayback: object | null;
}

/** `Math::randf()`: single precision of the global generator's next draw. */
const randf = (): number => f32(randf_range(0, 1));

/** `instance_playback_random`/`_no_repeats` (`audio_stream.cpp:594`, `:629`): the chosen stream. */
function choose(self: AudioStreamRandomizer): object | null {
  const pick = (pool: readonly PoolEntry[]): object | null => {
    let total = 0;
    for (const entry of pool) total += entry.weight;
    const chosen = randf_range(0, total);
    let cumulative = 0;
    for (const entry of pool) {
      cumulative += entry.weight;
      if (cumulative > chosen) return entry.stream;
    }
    return (pool[pool.length - 1] as PoolEntry).stream;
  };
  const valid = self.pool.filter((entry) => entry.stream !== null && entry.weight > 0);
  if (self.playbackMode === PLAYBACK_RANDOM_NO_REPEATS) {
    const others = valid.filter((entry) => entry.stream !== self.lastPlayback);
    if (others.length > 0) return pick(others);
  } else if (self.playbackMode !== PLAYBACK_RANDOM) {
    throw new Error('godot-compat: AudioStreamRandomizer sequential playback is not bound');
  }
  return valid.length === 0 ? null : pick(valid);
}

/**
 * A new randomizer (`AudioStreamRandomizer.new()`): no streams, pitch and volume unrandomized,
 * random without repeats.
 *
 * A scene states its properties (`audio_stream.cpp:768`), each pool entry as `stream<N>Stream` and
 * `stream<N>Weight` (`stream_N/stream`, `stream_N/weight`), set in the order given.
 *
 * @godot AudioStreamRandomizer (protocol)
 * @source servers/audio/audio_stream.cpp:788
 */
export function godot_audio_stream_randomizer_new(properties: Readonly<Record<string, unknown>> = {}): AudioStreamRandomizer {
  const self = made();
  for (const [property, value] of Object.entries(properties)) {
    const entry = /^stream(\d+)(Stream|Weight)$/u.exec(property);
    if (entry !== null) {
      if (entry[2] === 'Stream') set_stream(self, Number(entry[1]), value as object | null);
      else set_stream_probability_weight(self, Number(entry[1]), value as number);
      continue;
    }
    const set = PROPS.get(property);
    if (set === undefined) throw new Error(`godot-compat: AudioStreamRandomizer has no ${property} property`);
    set(self, value as never);
  }
  return self;
}

const PROPS = new Map<string, (self: AudioStreamRandomizer, value: never) => void>([
  ['playbackMode', (self, value: number) => set_playback_mode(self, value)],
  ['randomPitch', (self, value: number) => set_random_pitch(self, value)],
  ['randomVolumeOffsetDb', (self, value: number) => set_random_volume_offset_db(self, value)],
  ['streamsCount', (self, value: number) => set_streams_count(self, value)],
]);

function made(): AudioStreamRandomizer {
  const self: AudioStreamRandomizer = { pool: [], randomPitch: 1, randomVolumeOffsetDb: 0, playbackMode: PLAYBACK_RANDOM_NO_REPEATS, lastPlayback: null };
  godot_audio_stream_register(self, {
    // `get_length` (`audio_stream.cpp:727`): the last chosen stream's.
    length: () => (self.lastPlayback === null ? 0 : streamLength(self.lastPlayback)),
    start: (audio): GodotAudioStart => {
      const stream = choose(self);
      if (stream !== null) self.lastPlayback = stream;
      const from = f32(Math.log(f32(1 / self.randomPitch)));
      const to = f32(Math.log(self.randomPitch));
      const pitch = f32(Math.exp(f32(from + f32(randf() * f32(to - from)))));
      const volumeOffset = f32(-self.randomVolumeOffsetDb + f32(randf() * f32(self.randomVolumeOffsetDb * 2)));
      const inner = stream === null ? null : godot_audio_stream_start(stream, audio);
      return {
        buffer: inner?.buffer ?? null,
        loop: inner?.loop ?? null,
        pitchScale: f32(pitch * (inner?.pitchScale ?? 1)),
        volumeScale: f32(f32(Math.exp(f32(volumeOffset * f32(0.11512925464970228)))) * (inner?.volumeScale ?? 1)),
      };
    },
  });
  return self;
}

/**
 * @godot AudioStreamRandomizer.set_streams_count
 * @source servers/audio/audio_stream.cpp:548
 */
export function set_streams_count(self: AudioStreamRandomizer, count: number): void {
  while (self.pool.length < count) self.pool.push({ stream: null, weight: 1 });
  self.pool.length = count;
}

/**
 * @godot AudioStreamRandomizer.get_streams_count
 * @source servers/audio/audio_stream.cpp:552
 */
export function get_streams_count(self: AudioStreamRandomizer): number {
  return self.pool.length;
}

/**
 * An index outside the pool fails.
 *
 * @godot AudioStreamRandomizer.set_stream
 * @source servers/audio/audio_stream.cpp:526
 */
export function set_stream(self: AudioStreamRandomizer, index: number, stream: object | null): void {
  const entry = self.pool[index];
  if (entry !== undefined) entry.stream = stream;
}

/**
 * @godot AudioStreamRandomizer.get_stream
 * @source servers/audio/audio_stream.cpp:532
 */
export function get_stream(self: AudioStreamRandomizer, index: number): object | null {
  return self.pool[index]?.stream ?? null;
}

/**
 * @godot AudioStreamRandomizer.set_stream_probability_weight
 * @source servers/audio/audio_stream.cpp:537
 */
export function set_stream_probability_weight(self: AudioStreamRandomizer, index: number, weight: number): void {
  const entry = self.pool[index];
  if (entry !== undefined) entry.weight = f32(weight);
}

/**
 * @godot AudioStreamRandomizer.get_stream_probability_weight
 * @source servers/audio/audio_stream.cpp:543
 */
export function get_stream_probability_weight(self: AudioStreamRandomizer, index: number): number {
  return self.pool[index]?.weight ?? 0;
}

/**
 * A factor under 1 becomes 1.
 *
 * @godot AudioStreamRandomizer.set_random_pitch
 * @source servers/audio/audio_stream.cpp:556
 */
export function set_random_pitch(self: AudioStreamRandomizer, pitch: number): void {
  self.randomPitch = f32(pitch < 1 ? 1 : pitch);
}

/**
 * @godot AudioStreamRandomizer.get_random_pitch
 * @source servers/audio/audio_stream.cpp:563
 */
export function get_random_pitch(self: AudioStreamRandomizer): number {
  return self.randomPitch;
}

/**
 * A negative offset becomes 0.
 *
 * @godot AudioStreamRandomizer.set_random_volume_offset_db
 * @source servers/audio/audio_stream.cpp:575
 */
export function set_random_volume_offset_db(self: AudioStreamRandomizer, offset: number): void {
  self.randomVolumeOffsetDb = f32(offset < 0 ? 0 : offset);
}

/**
 * @godot AudioStreamRandomizer.get_random_volume_offset_db
 * @source servers/audio/audio_stream.cpp:582
 */
export function get_random_volume_offset_db(self: AudioStreamRandomizer): number {
  return self.randomVolumeOffsetDb;
}

/**
 * @godot AudioStreamRandomizer.set_playback_mode
 * @source servers/audio/audio_stream.cpp:586
 */
export function set_playback_mode(self: AudioStreamRandomizer, mode: number): void {
  self.playbackMode = mode;
}

/**
 * @godot AudioStreamRandomizer.get_playback_mode
 * @source servers/audio/audio_stream.cpp:590
 */
export function get_playback_mode(self: AudioStreamRandomizer): number {
  return self.playbackMode;
}
