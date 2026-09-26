/** Godot audio stream resources, represented by decoded Web Audio buffers. */

import { registerGodotObjectIdentity } from './object';
import { packedByteArray, type PackedByteArray } from './packed-array';

export interface GodotAudioStream {
  readonly kind: 'AudioStream';
  readonly buffer: AudioBuffer;
  loop: boolean;
  loopOffset: number;
  readonly length: number;
  readonly bpm: number;
  readonly beatCount: number;
  readonly barBeats: number;
  get_length(): number;
  get_bpm(): number;
  get_beat_count(): number;
  get_bar_beats(): number;
  has_loop(): boolean;
}

export interface GodotAudioStreamWav extends GodotAudioStream {
  readonly format: 'wav';
}

export interface GodotAudioStreamOggVorbis extends GodotAudioStream {
  readonly format: 'ogg-vorbis';
}

export interface GodotAudioStreamMp3 extends GodotAudioStream {
  readonly format: 'mp3';
}

interface EncodedAudioState {
  buffer: AudioBuffer;
  data: PackedByteArray;
  decodeFailure: unknown;
  generation: number;
  pending: boolean;
  readonly waiting: Set<() => void>;
}

const ENCODED_AUDIO = new WeakMap<GodotAudioStream, EncodedAudioState>();

function encodedState(stream: GodotAudioStream): EncodedAudioState {
  const state = ENCODED_AUDIO.get(stream);
  if (state === undefined) throw new TypeError('encoded AudioStream data requires AudioStreamMP3 or AudioStreamOGGVorbis');
  return state;
}

function createEncodedAudioStream(
  context: BaseAudioContext,
  format: 'mp3' | 'ogg-vorbis',
  className: 'AudioStreamMP3' | 'AudioStreamOGGVorbis',
): GodotAudioStreamMp3 | GodotAudioStreamOggVorbis {
  const state: EncodedAudioState = {
    buffer: context.createBuffer(1, 1, context.sampleRate),
    data: packedByteArray(),
    decodeFailure: undefined,
    generation: 0,
    pending: false,
    waiting: new Set(),
  };
  const stream = Object.assign(createGodotAudioStream({ buffer: state.buffer }), { format });
  Object.defineProperties(stream, {
    buffer: { configurable: true, enumerable: true, get: () => state.buffer },
    length: { configurable: true, enumerable: true, get: () => state.buffer.duration },
    get_length: { configurable: true, enumerable: true, value: () => state.buffer.duration },
  });
  ENCODED_AUDIO.set(stream, state);
  registerGodotObjectIdentity(stream, className);
  return stream as GodotAudioStreamMp3 | GodotAudioStreamOggVorbis;
}

/** Runtime compressed streams decode through the world's retained Web Audio context. */
export function createGodotAudioStreamMP3Runtime(context: BaseAudioContext): GodotAudioStreamMp3 {
  return createEncodedAudioStream(context, 'mp3', 'AudioStreamMP3') as GodotAudioStreamMp3;
}

export function createGodotAudioStreamOGGVorbisRuntime(context: BaseAudioContext): GodotAudioStreamOggVorbis {
  return createEncodedAudioStream(context, 'ogg-vorbis', 'AudioStreamOGGVorbis') as GodotAudioStreamOggVorbis;
}

export function getGodotEncodedAudioData(stream: GodotAudioStream): PackedByteArray {
  return packedByteArray(encodedState(stream).data);
}

export function setGodotEncodedAudioData(
  context: BaseAudioContext,
  stream: GodotAudioStream,
  value: Iterable<number>,
): void {
  const state = encodedState(stream);
  const data = packedByteArray(value);
  state.data = data;
  state.decodeFailure = undefined;
  const generation = ++state.generation;
  if (data.length === 0) {
    state.pending = false;
    state.buffer = context.createBuffer(1, 1, context.sampleRate);
    state.waiting.clear();
    return;
  }
  state.pending = true;
  const bytes = Uint8Array.from(data);
  void context.decodeAudioData(bytes.buffer.slice(0)).then(
    (buffer) => {
      if (generation !== state.generation) return;
      state.buffer = buffer;
      state.pending = false;
      const waiting = [...state.waiting];
      state.waiting.clear();
      for (const resume of waiting) {
        try { resume(); } catch (error: unknown) {
          console.error('godot-compat: deferred encoded AudioStream playback failed.', error);
        }
      }
    },
    (error: unknown) => {
      if (generation !== state.generation) return;
      state.decodeFailure = error;
      state.pending = false;
      const waiting = [...state.waiting];
      state.waiting.clear();
      console.error('godot-compat: encoded AudioStream data could not be decoded by Web Audio.', error);
      for (const resume of waiting) {
        try { resume(); } catch (playError: unknown) {
          console.error('godot-compat: pending playback surfaced the retained encoded AudioStream decode failure.', playError);
        }
      }
    },
  );
}

/** Queue a play request behind the stream's current native decode without leaking a Promise. */
export function deferGodotEncodedAudioPlayback(stream: GodotAudioStream, resume: () => void): boolean {
  const state = ENCODED_AUDIO.get(stream);
  if (state === undefined) return false;
  if (state.decodeFailure !== undefined) {
    throw new Error('encoded AudioStream data failed native Web Audio decoding', { cause: state.decodeFailure });
  }
  if (!state.pending) return false;
  state.waiting.add(resume);
  return true;
}

export function cancelGodotEncodedAudioPlayback(stream: GodotAudioStream, resume: () => void): void {
  ENCODED_AUDIO.get(stream)?.waiting.delete(resume);
}

export interface GodotAudioStreamSample extends GodotAudioStream {
  readonly sampleFormat: number;
  readonly loopEnd: number;
  readonly loopMode: number;
  readonly mixRate: number;
  readonly stereo: boolean;
}

interface SampleState {
  buffer: AudioBuffer;
  data: PackedByteArray;
  format: number;
  loopEnd: number;
  loopMode: number;
  mixRate: number;
  stereo: boolean;
}

const SAMPLES = new WeakMap<GodotAudioStream, SampleState>();

function sampleState(stream: GodotAudioStream): SampleState {
  const state = SAMPLES.get(stream);
  if (state === undefined) throw new TypeError('AudioStreamSample member requires a retained AudioStreamSample');
  return state;
}

function rebuildSample(context: BaseAudioContext, state: SampleState): void {
  if (state.format === 2) throw new Error('AudioStreamSample FORMAT_IMA_ADPCM has no exact native Web Audio PCM projection');
  const channels = state.stereo ? 2 : 1;
  const bytesPerSample = state.format === 1 ? 2 : 1;
  const frames = Math.floor(state.data.length / (channels * bytesPerSample));
  const buffer = context.createBuffer(channels, Math.max(1, frames), state.mixRate);
  for (let channel = 0; channel < channels; channel += 1) {
    const output = buffer.getChannelData(channel);
    for (let frame = 0; frame < frames; frame += 1) {
      const sample = frame * channels + channel;
      if (state.format === 0) {
        output[frame] = ((state.data[sample] ?? 128) - 128) / 128;
      } else {
        const offset = sample * 2;
        const raw = (state.data[offset] ?? 0) | ((state.data[offset + 1] ?? 0) << 8);
        output[frame] = (raw >= 0x8000 ? raw - 0x1_0000 : raw) / 32_768;
      }
    }
  }
  state.buffer = buffer;
}

export function createGodotAudioStreamSample(context: BaseAudioContext): GodotAudioStreamSample {
  const state: SampleState = {
    buffer: context.createBuffer(1, 1, 44_100), data: packedByteArray(), format: 0,
    loopEnd: 0, loopMode: 0, mixRate: 44_100, stereo: false,
  };
  const stream = {
    kind: 'AudioStream' as const,
    get buffer(): AudioBuffer { return state.buffer; },
    get loop(): boolean { return state.loopMode !== 0; },
    set loop(value: boolean) { state.loopMode = value ? 1 : 0; },
    loopOffset: 0,
    get length(): number { return state.buffer.duration; },
    bpm: 0, beatCount: 0, barBeats: 0,
    get_length: () => state.buffer.duration,
    get_bpm: () => 0,
    get_beat_count: () => 0,
    get_bar_beats: () => 0,
    has_loop: () => state.loopMode !== 0,
    get sampleFormat(): number { return state.format; },
    get loopEnd(): number { return state.loopEnd; },
    get loopMode(): number { return state.loopMode; },
    get mixRate(): number { return state.mixRate; },
    get stereo(): boolean { return state.stereo; },
  } satisfies GodotAudioStreamSample;
  SAMPLES.set(stream, state);
  registerGodotObjectIdentity(stream, 'AudioStreamSample');
  return stream;
}

export const getGodotAudioStreamSampleData = (stream: GodotAudioStream): PackedByteArray =>
  packedByteArray(sampleState(stream).data);
export function setGodotAudioStreamSampleData(context: BaseAudioContext, stream: GodotAudioStream, value: Iterable<number>): void {
  const state = sampleState(stream); state.data = packedByteArray(value); rebuildSample(context, state);
}
export const getGodotAudioStreamSampleFormat = (stream: GodotAudioStream): number => sampleState(stream).format;
export function setGodotAudioStreamSampleFormat(context: BaseAudioContext, stream: GodotAudioStream, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2) throw new RangeError('AudioStreamSample.format must be 0, 1, or 2');
  const state = sampleState(stream); if (state.format === value) return; state.format = value; rebuildSample(context, state);
}
export const getGodotAudioStreamSampleLoopEnd = (stream: GodotAudioStream): number => sampleState(stream).loopEnd;
export function setGodotAudioStreamSampleLoopEnd(stream: GodotAudioStream, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('AudioStreamSample.loop_end must be a nonnegative sample frame');
  sampleState(stream).loopEnd = value;
}
export const getGodotAudioStreamSampleLoopMode = (stream: GodotAudioStream): number => sampleState(stream).loopMode;
export function setGodotAudioStreamSampleLoopMode(stream: GodotAudioStream, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 3) {
    throw new RangeError('AudioStreamSample.loop_mode must be LOOP_DISABLED through LOOP_BACKWARD (0..3)');
  }
  sampleState(stream).loopMode = value;
}
export const getGodotAudioStreamSampleMixRate = (stream: GodotAudioStream): number => sampleState(stream).mixRate;
export function setGodotAudioStreamSampleMixRate(context: BaseAudioContext, stream: GodotAudioStream, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError('AudioStreamSample.mix_rate must be a positive integer');
  const state = sampleState(stream); if (state.mixRate === value) return; state.mixRate = value; rebuildSample(context, state);
}
export const isGodotAudioStreamSampleStereo = (stream: GodotAudioStream): boolean => sampleState(stream).stereo;
export function setGodotAudioStreamSampleStereo(context: BaseAudioContext, stream: GodotAudioStream, value: boolean): void {
  if (typeof value !== 'boolean') throw new TypeError('AudioStreamSample.stereo must be bool');
  const state = sampleState(stream); if (state.stereo === value) return; state.stereo = value; rebuildSample(context, state);
}

export type DecodedGodotAudioStream =
  | GodotAudioStream
  | GodotAudioStreamWav
  | GodotAudioStreamOggVorbis
  | GodotAudioStreamMp3;

export interface CreateGodotAudioStreamOptions {
  readonly buffer: AudioBuffer;
  readonly loop?: boolean;
  readonly loopOffset?: number;
  readonly bpm?: number;
  readonly beatCount?: number;
  readonly barBeats?: number;
}

function clampStreamOffset(stream: GodotAudioStream, seconds: number): number {
  if (!Number.isFinite(seconds)) return 0;
  return Math.min(stream.length, Math.max(0, seconds));
}

export function createGodotAudioStream(
  options: CreateGodotAudioStreamOptions,
): GodotAudioStream {
  const length = options.buffer.duration;
  const bpm = Math.max(0, options.bpm ?? 0);
  const beatCount = Math.max(0, Math.trunc(options.beatCount ?? 0));
  const barBeats = Math.max(0, Math.trunc(options.barBeats ?? 0));
  let loop = options.loop ?? false;
  if (typeof loop !== 'boolean') throw new TypeError('AudioStream loop must be bool.');
  const stream = {
    kind: 'AudioStream',
    buffer: options.buffer,
    get loop(): boolean { return loop; },
    set loop(value: boolean) {
      if (typeof value !== 'boolean') throw new TypeError('AudioStream loop must be bool.');
      loop = value;
    },
    loopOffset: Math.max(0, options.loopOffset ?? 0),
    length, bpm, beatCount, barBeats,
    get_length: () => length,
    get_bpm: () => bpm,
    get_beat_count: () => beatCount,
    get_bar_beats: () => barBeats,
    has_loop() { return this.loop; },
  } satisfies GodotAudioStream;
  return stream;
}

/** Build a retained AudioStream from a decoded asset without materializing absent import metadata. */
export function createGodotAudioStreamFromDecoded(source: {
  readonly buffer: AudioBuffer;
  readonly loop?: boolean;
  readonly loopOffset?: number;
}): GodotAudioStream {
  return createGodotAudioStream({
    buffer: source.buffer,
    ...(source.loop === undefined ? {} : { loop: source.loop }),
    ...(source.loopOffset === undefined ? {} : { loopOffset: source.loopOffset }),
  });
}

export function createGodotAudioStreamWav(
  options: CreateGodotAudioStreamOptions,
): GodotAudioStreamWav {
  // Preserve the base stream's accessors and loop-mode closure on the same retained resource;
  // spreading would snapshot `loop` and disconnect subsequent set_loop_mode writes from playback.
  const stream = Object.assign(createGodotAudioStream(options), { format: 'wav' as const });
  registerGodotObjectIdentity(stream, 'AudioStreamWAV');
  return stream;
}

export function createGodotAudioStreamOggVorbis(
  options: CreateGodotAudioStreamOptions,
): GodotAudioStreamOggVorbis {
  const stream = Object.assign(createGodotAudioStream(options), { format: 'ogg-vorbis' as const });
  registerGodotObjectIdentity(stream, 'AudioStreamOGGVorbis');
  return stream;
}

export function createGodotAudioStreamMp3(
  options: CreateGodotAudioStreamOptions,
): GodotAudioStreamMp3 {
  const stream = Object.assign(createGodotAudioStream(options), { format: 'mp3' as const });
  registerGodotObjectIdentity(stream, 'AudioStreamMP3');
  return stream;
}

export function isGodotAudioStream(value: unknown): value is GodotAudioStream {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Partial<GodotAudioStream>).kind === 'AudioStream'
  );
}

export function audioStreamBuffer(stream: AudioBuffer | GodotAudioStream): AudioBuffer {
  return isGodotAudioStream(stream) ? stream.buffer : stream;
}

export function audioStreamLoops(
  stream: AudioBuffer | GodotAudioStream,
  playerLoop = false,
): boolean {
  return isGodotAudioStream(stream) ? stream.loop : playerLoop;
}

export function audioStreamLoopOffset(stream: AudioBuffer | GodotAudioStream): number {
  return isGodotAudioStream(stream) ? clampStreamOffset(stream, stream.loopOffset) : 0;
}

export function audioStreamLoopEnd(stream: AudioBuffer | GodotAudioStream): number {
  if (!isGodotAudioStream(stream)) return stream.duration;
  const sample = SAMPLES.get(stream);
  if (sample === undefined || sample.loopEnd === 0) return stream.buffer.duration;
  return Math.min(stream.buffer.duration, sample.loopEnd / sample.mixRate);
}

export function audioStreamLength(stream: AudioBuffer | GodotAudioStream | undefined): number {
  if (stream === undefined) return 0;
  return audioStreamBuffer(stream).duration;
}

export async function decodeGodotAudioStream(
  context: BaseAudioContext,
  bytes: ArrayBuffer,
  options: Omit<CreateGodotAudioStreamOptions, 'buffer'> = {},
): Promise<GodotAudioStream> {
  const buffer = await context.decodeAudioData(bytes.slice(0));
  return createGodotAudioStream({ buffer, ...options });
}

export interface GodotAudioStreamMicrophone extends GodotAudioStream {
  readonly microphone: true;
  is_monophonic(): true;
}

/** The browser input request is injectable only at the permission boundary. The returned
 *  MediaStream remains owned by the playback and every track is stopped by {@link stop}. */
export type GodotMicrophoneInputRequest = () => Promise<MediaStream>;

export interface GodotAudioStreamMicrophonePlayback {
  /** True while the permission request is pending or the retained native input is connected. */
  readonly playing: boolean;
  /** A rejected permission/device request is retained and reported, never replaced by silence. */
  readonly failure: Error | undefined;
  setPaused(paused: boolean): void;
  stop(): void;
}

export function isGodotAudioStreamMicrophone(
  stream: GodotAudioStream | undefined,
): stream is GodotAudioStreamMicrophone {
  return stream !== undefined && (stream as Partial<GodotAudioStreamMicrophone>).microphone === true;
}

function browserMicrophoneInput(): Promise<MediaStream> {
  const devices = globalThis.navigator?.mediaDevices;
  if (devices?.getUserMedia === undefined) {
    return Promise.reject(new Error(
      'AudioStreamMicrophone requires navigator.mediaDevices.getUserMedia({ audio: true }); ' +
        'microphone capture is unavailable in this host.',
    ));
  }
  return devices.getUserMedia({ audio: true });
}

/**
 * One Godot `AudioStreamPlaybackMicrophone` over the browser's real capture device.
 *
 * Godot's Web driver requests `{ audio: true }`, creates one MediaStreamAudioSourceNode, connects
 * it to the ordinary driver graph, and stops every MediaStreamTrack when input stops. This is the
 * same ownership at the compat boundary: the caller supplies its existing player/bus input, and
 * this playback owns only the permission request, source node, track-ended listeners and tracks.
 */
export function createGodotAudioStreamMicrophonePlayback(
  context: AudioContext,
  destination: AudioNode,
  options: {
    readonly requestInput?: GodotMicrophoneInputRequest;
    readonly onFailure?: (error: Error) => void;
    readonly onEnded?: () => void;
  } = {},
): GodotAudioStreamMicrophonePlayback {
  let pending = true;
  let active = true;
  let paused = false;
  let source: MediaStreamAudioSourceNode | undefined;
  const playbackDelay = context.createDelay(0.05);
  playbackDelay.delayTime.value = 0.05;
  playbackDelay.connect(destination);
  let graphReleased = false;
  let mediaStream: MediaStream | undefined;
  let failure: Error | undefined;
  const endedListeners = new Map<MediaStreamTrack, () => void>();

  const disconnect = (): void => {
    source?.disconnect();
    source = undefined;
  };
  const releaseGraph = (): void => {
    if (graphReleased) return;
    graphReleased = true;
    disconnect();
    playbackDelay.disconnect();
  };
  const stopTracks = (stream: MediaStream): void => {
    for (const track of stream.getTracks()) {
      const listener = endedListeners.get(track);
      if (listener !== undefined) track.removeEventListener('ended', listener);
      track.stop();
    }
    endedListeners.clear();
  };
  const inputEnded = (): void => {
    if (!active) return;
    active = false;
    pending = false;
    releaseGraph();
    if (mediaStream !== undefined) stopTracks(mediaStream);
    mediaStream = undefined;
    options.onEnded?.();
  };

  const request = options.requestInput ?? browserMicrophoneInput;
  void request().then(
    (stream) => {
      pending = false;
      if (!active) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        for (const track of stream.getTracks()) track.stop();
        throw new Error('AudioStreamMicrophone permission returned a MediaStream with no audio track.');
      }
      mediaStream = stream;
      for (const track of audioTracks) {
        const listener = (): void => inputEnded();
        endedListeners.set(track, listener);
        track.addEventListener('ended', listener, { once: true });
      }
      source = context.createMediaStreamSource(stream);
      if (!paused) source.connect(playbackDelay);
      if (context.state === 'suspended') void context.resume();
    },
    (cause: unknown) => {
      if (!active) return;
      pending = false;
      active = false;
      releaseGraph();
      failure = new Error(
        'AudioStreamMicrophone could not acquire browser microphone permission/input.',
        { cause },
      );
      if (options.onFailure !== undefined) options.onFailure(failure);
      else console.error(failure);
    },
  ).catch((cause: unknown) => {
    if (!active) return;
    pending = false;
    active = false;
    failure = cause instanceof Error ? cause : new Error(String(cause));
    releaseGraph();
    if (mediaStream !== undefined) stopTracks(mediaStream);
    mediaStream = undefined;
    if (options.onFailure !== undefined) options.onFailure(failure);
    else console.error(failure);
  });

  return {
    get playing(): boolean { return active && (pending || mediaStream !== undefined); },
    get failure(): Error | undefined { return failure; },
    setPaused(value: boolean): void {
      if (value === paused || !active) return;
      paused = value;
      if (source === undefined) return;
      source.disconnect();
      if (!paused) source.connect(playbackDelay);
    },
    stop(): void {
      if (!active && mediaStream === undefined) return;
      active = false;
      pending = false;
      releaseGraph();
      if (mediaStream !== undefined) stopTracks(mediaStream);
      mediaStream = undefined;
    },
  };
}

/** The Resource exists independently of the host permission needed when playback begins. */
export function createGodotAudioStreamMicrophone(): GodotAudioStreamMicrophone {
  const unavailable = (): never => {
    throw new Error('AudioStreamMicrophone is a live browser MediaStream resource and has no decoded AudioBuffer; play it through an AudioStreamPlayer so the browser permission/input lifecycle can be retained.');
  };
  const stream = {
    kind: 'AudioStream' as const,
    microphone: true as const,
    get buffer(): AudioBuffer { return unavailable(); },
    loop: false,
    loopOffset: 0,
    length: 0,
    bpm: 0,
    beatCount: 0,
    barBeats: 4,
    get_length: () => 0,
    get_bpm: () => 0,
    get_beat_count: () => 0,
    get_bar_beats: () => 4,
    has_loop: () => false,
    is_monophonic: () => true as const,
  } satisfies GodotAudioStreamMicrophone;
  registerGodotObjectIdentity(stream, 'AudioStreamMicrophone');
  return stream;
}

export interface AudioStreamPlaybackState {
  readonly stream: GodotAudioStream;
  playing: boolean;
  paused: boolean;
  position: number;
  pitchScale: number;
}

export function createAudioStreamPlaybackState(
  stream: GodotAudioStream,
): AudioStreamPlaybackState {
  return {
    stream,
    playing: false,
    paused: false,
    position: 0,
    pitchScale: 1,
  };
}

export function playAudioStreamPlayback(
  playback: AudioStreamPlaybackState,
  fromPosition = 0,
): void {
  playback.position = clampStreamOffset(playback.stream, fromPosition);
  playback.playing = true;
  playback.paused = false;
}

export function stopAudioStreamPlayback(playback: AudioStreamPlaybackState): void {
  playback.playing = false;
  playback.paused = false;
  playback.position = 0;
}

export function seekAudioStreamPlayback(
  playback: AudioStreamPlaybackState,
  position: number,
): void {
  playback.position = clampStreamOffset(playback.stream, position);
}

export function advanceAudioStreamPlayback(
  playback: AudioStreamPlaybackState,
  delta: number,
): boolean {
  if (!playback.playing || playback.paused || delta <= 0) return false;
  playback.position += delta * Math.max(0.01, playback.pitchScale);
  if (playback.position < playback.stream.length) return false;
  if (playback.stream.loop && playback.stream.length > 0) {
    const loopStart = clampStreamOffset(playback.stream, playback.stream.loopOffset);
    const loopLength = Math.max(Number.EPSILON, playback.stream.length - loopStart);
    playback.position = loopStart + ((playback.position - loopStart) % loopLength);
    return false;
  }
  playback.position = playback.stream.length;
  playback.playing = false;
  playback.paused = false;
  return true;
}
