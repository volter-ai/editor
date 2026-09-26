/** Godot 4 randomizer and polyphonic AudioStream resources over native Web Audio voices. */
import { dbToLinear } from '@volter/game-runtime/audio/bus-mixer';
import { audioStreamBuffer, audioStreamLoopOffset, audioStreamLoops, type GodotAudioStream } from './audio-stream';
import { registerGodotObjectIdentity } from './object';

export const AUDIO_STREAM_RANDOM_NO_REPEATS = 0;
export const AUDIO_STREAM_RANDOM = 1;
export const AUDIO_STREAM_SEQUENTIAL = 2;

export type GodotPlayableAudioStream = AudioBuffer | GodotAudioStream | GodotAudioStreamRandomizer;

interface WeightedStream {
  stream: GodotPlayableAudioStream | null;
  weight: number;
}

export interface GodotRandomizedStreamSelection {
  readonly stream: AudioBuffer | GodotAudioStream;
  readonly pitchScale: number;
  readonly volumeDb: number;
}

export interface GodotAudioStreamRandomizer {
  readonly kind: 'AudioStreamRandomizer';
  add_stream(index: number, stream: GodotPlayableAudioStream, weight?: number): void;
  move_stream(indexFrom: number, indexTo: number): void;
  remove_stream(index: number): void;
  set_stream(index: number, stream: GodotPlayableAudioStream): void;
  get_stream(index: number): GodotPlayableAudioStream | null;
  set_stream_probability_weight(index: number, weight: number): void;
  get_stream_probability_weight(index: number): number;
  set_streams_count(count: number): void;
  get_streams_count(): number;
  set_random_pitch(scale: number): void;
  get_random_pitch(): number;
  set_random_pitch_semitones(semitones: number): void;
  get_random_pitch_semitones(): number;
  set_random_volume_offset_db(dbOffset: number): void;
  get_random_volume_offset_db(): number;
  set_playback_mode(mode: number): void;
  get_playback_mode(): number;
  get_length(): number;
  get_bpm(): number;
  get_beat_count(): number;
  get_bar_beats(): number;
  has_loop(): boolean;
  select_stream(random: () => number): GodotRandomizedStreamSelection | undefined;
}

export function selectGodotPlayableAudioStream(
  stream: GodotPlayableAudioStream,
  random: () => number,
): GodotRandomizedStreamSelection | undefined {
  if (stream instanceof AudioBuffer || stream.kind !== 'AudioStreamRandomizer') {
    return { stream, pitchScale: 1, volumeDb: 0 };
  }
  return stream.select_stream(random);
}

function finite(value: number, member: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`${member} requires a finite number.`);
  return value;
}

function index(value: number, member: string, upper: number, allowEnd = false): number {
  if (!Number.isSafeInteger(value) || value < 0 || value >= upper + (allowEnd ? 1 : 0)) {
    throw new RangeError(`${member} index ${value} is outside the stream array.`);
  }
  return value;
}

function randomUnit(random: () => number): number {
  const value = random();
  if (!Number.isFinite(value)) throw new Error('AudioStreamRandomizer random source returned a non-finite value.');
  return Math.min(1 - Number.EPSILON, Math.max(0, value));
}

export function createGodotAudioStreamRandomizer(): GodotAudioStreamRandomizer {
  const streams: WeightedStream[] = [];
  let playbackMode = AUDIO_STREAM_RANDOM_NO_REPEATS;
  // Godot exposes ratio and semitone spellings over one range; setting either updates the other.
  let randomPitch = 1;
  let randomVolumeOffsetDb = 0;
  let lastStream: GodotPlayableAudioStream | null = null;

  const resource: GodotAudioStreamRandomizer = {
    kind: 'AudioStreamRandomizer',
    add_stream(at, stream, weight = 1): void {
      if (at === -1) at = streams.length;
      index(at, 'AudioStreamRandomizer.add_stream', streams.length, true);
      const probability = finite(weight, 'AudioStreamRandomizer stream probability weight');
      if (probability < 0) throw new RangeError('AudioStreamRandomizer stream probability weight must be nonnegative.');
      streams.splice(at, 0, { stream, weight: probability });
    },
    move_stream(from, to): void {
      index(from, 'AudioStreamRandomizer.move_stream', streams.length);
      index(to, 'AudioStreamRandomizer.move_stream', streams.length, true);
      if (from === to) return;
      // Godot inserts against the pre-removal array, then removes the original. Inserting before
      // the original shifts its removal index by one; inserting after it leaves the index intact.
      const entry = streams[from]!;
      streams.splice(to, 0, entry);
      streams.splice(from > to ? from + 1 : from, 1);
    },
    remove_stream(at): void {
      index(at, 'AudioStreamRandomizer.remove_stream', streams.length);
      streams.splice(at, 1);
    },
    set_stream(at, stream): void {
      index(at, 'AudioStreamRandomizer.set_stream', streams.length);
      streams[at]!.stream = stream;
    },
    get_stream(at): GodotPlayableAudioStream | null {
      index(at, 'AudioStreamRandomizer.get_stream', streams.length);
      return streams[at]!.stream;
    },
    set_stream_probability_weight(at, weight): void {
      index(at, 'AudioStreamRandomizer.set_stream_probability_weight', streams.length);
      const probability = finite(weight, 'AudioStreamRandomizer stream probability weight');
      if (probability < 0) throw new RangeError('AudioStreamRandomizer stream probability weight must be nonnegative.');
      streams[at]!.weight = probability;
    },
    get_stream_probability_weight(at): number {
      index(at, 'AudioStreamRandomizer.get_stream_probability_weight', streams.length);
      return streams[at]!.weight;
    },
    set_streams_count(count): void {
      if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('AudioStreamRandomizer.streams_count must be a nonnegative integer.');
      streams.length = count;
      for (let at = 0; at < count; at += 1) {
        streams[at] ??= { stream: null, weight: 1 };
      }
    },
    get_streams_count: () => streams.length,
    set_random_pitch(scale): void {
      const next = finite(scale, 'AudioStreamRandomizer.random_pitch');
      randomPitch = Math.max(1, next);
    },
    get_random_pitch: () => randomPitch,
    set_random_pitch_semitones(semitones): void {
      const next = finite(semitones, 'AudioStreamRandomizer.random_pitch_semitones');
      randomPitch = 2 ** (Math.max(0, next) / 12);
    },
    get_random_pitch_semitones: () => 12 * Math.log2(randomPitch),
    set_random_volume_offset_db(dbOffset): void {
      const next = finite(dbOffset, 'AudioStreamRandomizer.random_volume_offset_db');
      randomVolumeOffsetDb = Math.max(0, next);
    },
    get_random_volume_offset_db: () => randomVolumeOffsetDb,
    set_playback_mode(mode): void {
      if (!Number.isSafeInteger(mode) || mode < 0 || mode > 2) throw new RangeError('AudioStreamRandomizer.playback_mode is outside Godot PlaybackMode.');
      playbackMode = mode;
    },
    get_playback_mode: () => playbackMode,
    get_length(): number {
      return streams.reduce((maximum, entry) => entry.stream === null ? maximum : Math.max(maximum, entry.stream instanceof AudioBuffer ? entry.stream.duration : entry.stream.kind === 'AudioStreamRandomizer' ? entry.stream.get_length() : entry.stream.length), 0);
    },
    get_bpm(): number {
      for (const entry of streams) { const child = entry.stream; if (child === null || child instanceof AudioBuffer) continue; const bpm = child.kind === 'AudioStreamRandomizer' ? child.get_bpm() : child.bpm; if (bpm !== 0) return bpm; } return 0;
    },
    get_beat_count(): number {
      return streams.reduce((maximum, entry) => { const child = entry.stream; if (child === null || child instanceof AudioBuffer) return maximum; return Math.max(maximum, child.kind === 'AudioStreamRandomizer' ? child.get_beat_count() : child.beatCount); }, 0);
    },
    get_bar_beats(): number {
      for (const entry of streams) { const child = entry.stream; if (child === null || child instanceof AudioBuffer) continue; const beats = child.kind === 'AudioStreamRandomizer' ? child.get_bar_beats() : child.barBeats; if (beats !== 0) return beats; } return 0;
    },
    has_loop(): boolean {
      return streams.some((entry) => { const child = entry.stream; return child !== null && !(child instanceof AudioBuffer) && (child.kind === 'AudioStreamRandomizer' ? child.has_loop() : child.loop); });
    },
    select_stream(random): GodotRandomizedStreamSelection | undefined {
      const candidates = streams.flatMap((entry, at) => entry.stream === null ? [] : [{ ...entry, stream: entry.stream, at }]);
      if (candidates.length === 0) return undefined;
      let selected: (typeof candidates)[number];
      if (playbackMode === AUDIO_STREAM_SEQUENTIAL) {
        const unique = candidates.filter((entry, at, all) => all.findIndex((candidate) => candidate.stream === entry.stream) === at);
        const previous = unique.findIndex((entry) => entry.stream === lastStream);
        selected = unique[previous >= 0 && previous + 1 < unique.length ? previous + 1 : 0]!;
      } else {
        const weighted = candidates.filter((entry) => entry.weight > 0);
        if (weighted.length === 0) return undefined;
        let eligible = weighted;
        if (playbackMode === AUDIO_STREAM_RANDOM_NO_REPEATS) {
          const withoutLast = weighted.filter((entry) => entry.stream !== lastStream);
          // A one-resource pool cannot avoid repeating. Godot falls back to ordinary weighted
          // random rather than allowing a zero-weight entry or reporting an empty selection.
          if (withoutLast.length > 0) eligible = withoutLast;
        }
        const total = eligible.reduce((sum, entry) => sum + entry.weight, 0);
        if (total <= 0) return undefined;
        let draw = randomUnit(random) * total;
        selected = eligible[eligible.length - 1]!;
        for (const entry of eligible) {
          draw -= entry.weight;
          if (draw < 0) { selected = entry; break; }
        }
      }
      lastStream = selected.stream;
      const lowerLogPitch = Math.log(1 / randomPitch);
      const ratioPitch = Math.exp(lowerLogPitch + randomUnit(random) * (Math.log(randomPitch) - lowerLogPitch));
      const inner = selectGodotPlayableAudioStream(selected.stream, random);
      return inner === undefined ? undefined : {
        stream: inner.stream,
        pitchScale: inner.pitchScale * ratioPitch,
        volumeDb: inner.volumeDb + (randomUnit(random) * 2 - 1) * randomVolumeOffsetDb,
      };
    },
  };
  registerGodotObjectIdentity(resource, 'AudioStreamRandomizer');
  return resource;
}

export interface GodotAudioStreamPolyphonic {
  readonly kind: 'AudioStreamPolyphonic';
  set_polyphony(voices: number): void;
  get_polyphony(): number;
  get_length(): number; get_bpm(): number; get_beat_count(): number; get_bar_beats(): number; has_loop(): boolean;
}

export interface GodotAudioStreamPlaybackPolyphonic {
  play_stream(stream: GodotPlayableAudioStream, fromOffset?: number, volumeDb?: number, pitchScale?: number, playbackType?: number, bus?: string): number;
  set_stream_volume(streamId: number, volumeDb: number): void;
  set_stream_pitch_scale(streamId: number, pitchScale: number): void;
  is_stream_playing(streamId: number): boolean;
  stop_stream(streamId: number): void;
  dispose(): void;
}

export function createGodotAudioStreamPolyphonic(): GodotAudioStreamPolyphonic {
  let polyphony = 32;
  const resource: GodotAudioStreamPolyphonic = {
    kind: 'AudioStreamPolyphonic',
    set_polyphony(voices): void {
      if (!Number.isSafeInteger(voices) || voices < 1 || voices > 128) throw new RangeError('AudioStreamPolyphonic.polyphony must be an integer in [1, 128].');
      polyphony = voices;
    },
    get_polyphony: () => polyphony,
    get_length: () => 0, get_bpm: () => 0, get_beat_count: () => 0, get_bar_beats: () => 0, has_loop: () => false,
  };
  registerGodotObjectIdentity(resource, 'AudioStreamPolyphonic');
  return resource;
}

interface PolyphonicVoice {
  readonly source: AudioBufferSourceNode; readonly gain: GainNode;
  readonly randomPitchScale: number; readonly randomVolumeDb: number;
}

export function createGodotAudioStreamPlaybackPolyphonic(
  context: AudioContext,
  destination: AudioNode,
  stream: GodotAudioStreamPolyphonic,
  random: () => number,
): GodotAudioStreamPlaybackPolyphonic {
  const voices = new Map<number, PolyphonicVoice>();
  let nextId = 1;
  const release = (id: number): void => {
    const voice = voices.get(id);
    if (voice === undefined) return;
    voices.delete(id);
    voice.source.disconnect();
    voice.gain.disconnect();
  };
  const playback: GodotAudioStreamPlaybackPolyphonic = {
    play_stream(playable, fromOffset = 0, volumeDb = 0, pitchScale = 1, playbackType = 0, bus = 'Master'): number {
      if (playbackType !== 0) throw new Error(`AudioStreamPlaybackPolyphonic playback_type ${playbackType} cannot be represented by this Web Audio voice.`);
      if (bus !== 'Master') throw new Error(`AudioStreamPlaybackPolyphonic bus ${JSON.stringify(bus)} needs the owning GodotAudioGraph rather than a fixed destination.`);
      if (voices.size >= stream.get_polyphony()) return -1;
      const selected = selectGodotPlayableAudioStream(playable, random);
      if (selected === undefined) return -1;
      const buffer = audioStreamBuffer(selected.stream);
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      source.loop = audioStreamLoops(selected.stream);
      source.loopStart = audioStreamLoopOffset(selected.stream);
      source.playbackRate.value = Math.max(0.01, finite(pitchScale, 'AudioStreamPlaybackPolyphonic pitch_scale') * selected.pitchScale);
      gain.gain.value = dbToLinear(finite(volumeDb, 'AudioStreamPlaybackPolyphonic volume_db') + selected.volumeDb);
      source.connect(gain); gain.connect(destination);
      const id = nextId++;
      voices.set(id, { source, gain, randomPitchScale: selected.pitchScale, randomVolumeDb: selected.volumeDb });
      source.addEventListener('ended', () => release(id), { once: true });
      const requestedOffset = Math.max(0, finite(fromOffset, 'AudioStreamPlaybackPolyphonic from_offset'));
      source.start(0, source.loop
        ? requestedOffset % Math.max(buffer.duration, Number.EPSILON)
        : Math.min(requestedOffset, buffer.duration));
      return id;
    },
    set_stream_volume(streamId, volumeDb): void {
      const voice = voices.get(streamId);
      if (voice !== undefined) voice.gain.gain.setValueAtTime(dbToLinear(finite(volumeDb, 'AudioStreamPlaybackPolyphonic volume_db') + voice.randomVolumeDb), context.currentTime);
    },
    set_stream_pitch_scale(streamId, pitchScale): void {
      const voice = voices.get(streamId);
      if (voice !== undefined) voice.source.playbackRate.setValueAtTime(Math.max(0.01, finite(pitchScale, 'AudioStreamPlaybackPolyphonic pitch_scale') * voice.randomPitchScale), context.currentTime);
    },
    is_stream_playing: (streamId) => voices.has(streamId),
    stop_stream(streamId): void {
      const voice = voices.get(streamId);
      if (voice === undefined) return;
      voices.delete(streamId);
      voice.source.stop();
      voice.source.disconnect();
      voice.gain.disconnect();
    },
    dispose(): void {
      for (const id of [...voices.keys()]) playback.stop_stream(id);
    },
  };
  registerGodotObjectIdentity(playback, 'AudioStreamPlaybackPolyphonic');
  return playback;
}
