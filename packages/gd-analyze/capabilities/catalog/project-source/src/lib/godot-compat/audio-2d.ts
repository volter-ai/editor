/** Godot `AudioStreamPlayer2D` over Web Audio's stereo panner. */

import { createSignal, type GodotSignal } from './signal';
import {
  audioStreamBuffer,
  audioStreamLoopOffset,
  audioStreamLoops,
} from './audio-stream';
import {
  clampPitchScale,
  dbToLinear,
  drawRandomRate,
  godotAudioStreamIsMonophonic,
  registerLiveAudioStreamPlayer,
  requireAudioStreamPlayerMaxPolyphony,
  type AudioStreamPlayback,
  type GodotRuntimeAudioStream,
} from './audio';
import {
  createGodotAudioStreamPlaybackInteractive,
  createGodotAudioStreamPlaybackPlaylist,
  createGodotAudioStreamPlaybackSynchronized,
  type GodotAudioStreamPlayback as GodotMusicPlayback,
} from './audio-stream-music';
import {
  createGodotAudioStreamGeneratorPlayback,
  type GodotAudioStreamGeneratorPlayback,
} from './audio-stream-generator';
import type { GodotAudioGraph } from './audio-graph';
import { createGodotAudioVoicePool } from './audio-player-polyphony';

export interface AudioPoint2D {
  readonly x: number;
  readonly y: number;
  /** Pixi's retained world transform. When present it is the authoritative live position. */
  readonly worldTransform?: { readonly tx: number; readonly ty: number };
}

export interface AudioStreamPlayer2D extends AudioStreamPlayback {
  readonly __godotClass: 'AudioStreamPlayer2D';
  readonly finished: GodotSignal<[]>;
  volumeDb: number;
  pitchScale: number;
  maxPolyphony: number;
  streamPaused: boolean;
  stream: GodotRuntimeAudioStream | undefined;
  bus: string;
  maxDistance: number;
  attenuation: number;
  panningStrength: number;
  areaMask: number;
  autoplay: boolean;
  hasStreamPlayback(): boolean;
  getStreamPlayback(): GodotAudioStreamGeneratorPlayback | GodotMusicPlayback | undefined;
  seek(position: number): void;
  getPlaybackPosition(): number;
  update(listener: AudioPoint2D): void;
}

export interface CreateAudioStreamPlayer2DOptions {
  readonly destination: AudioNode;
  readonly buses?: Readonly<Record<string, AudioNode>>;
  readonly graph?: Pick<GodotAudioGraph, 'busIndex' | 'busInput'>;
  readonly node: AudioPoint2D;
  readonly buffer?: AudioBuffer;
  readonly stream?: GodotRuntimeAudioStream;
  readonly loop?: boolean;
  readonly autoplay?: boolean;
  readonly volumeDb?: number;
  readonly pitchScale?: number;
  readonly maxPolyphony?: number;
  readonly bus?: string;
  readonly maxDistance?: number;
  readonly attenuation?: number;
  readonly panningStrength?: number;
  readonly areaMask?: number;
  readonly randomPitch?: number;
  readonly random?: () => number;
}

const MASTER_BUS = 'Master';

function audio2DDecibels(value: number): number {
  if (typeof value !== 'number' || Number.isNaN(value) || value === Number.POSITIVE_INFINITY) {
    throw new TypeError('AudioStreamPlayer2D.volume_db requires decibels or -Infinity.');
  }
  return value;
}

function audio2DNonNegative(value: number, member: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`AudioStreamPlayer2D.${member} must be a finite non-negative value.`);
  }
  return value;
}

function audio2DLayerMask(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError('AudioStreamPlayer2D.area_mask must be an unsigned 32-bit layer mask.');
  }
  return value >>> 0;
}

function clampPosition(stream: GodotRuntimeAudioStream | undefined, value: number): number {
  if (stream === undefined || !Number.isFinite(value) || (!(stream instanceof AudioBuffer) && stream.kind !== 'AudioStream')) return Math.max(0, Number.isFinite(value) ? value : 0);
  return Math.min(audioStreamBuffer(stream).duration, Math.max(0, value));
}

function createAudioStreamPlayer2DVoice<TNode extends AudioPoint2D>(
  options: Omit<CreateAudioStreamPlayer2DOptions, 'node'> & { readonly node: TNode },
): AudioStreamPlayer2D {
  const context = options.destination.context as AudioContext;
  const buses: Readonly<Record<string, AudioNode>> = {
    ...(options.buses ?? {}),
    [MASTER_BUS]: options.destination,
  };
  const busInput = (name: string): AudioNode =>
    options.graph?.busInput(name) ?? buses[name] ?? options.destination;
  const hasBus = (name: string): boolean =>
    options.graph === undefined ? name in buses : options.graph.busIndex(name) >= 0;
  const gain = context.createGain();
  const panner = context.createStereoPanner();
  gain.connect(panner);
  if (options.bus !== undefined && typeof options.bus !== 'string') {
    throw new TypeError('AudioStreamPlayer2D.bus must be a StringName.');
  }
  let busName = options.bus ?? MASTER_BUS;
  panner.connect(busInput(busName));

  let stream: GodotRuntimeAudioStream | undefined = options.stream ?? options.buffer;
  let source: AudioBufferSourceNode | undefined;
  let generatorPlayback: GodotAudioStreamGeneratorPlayback | undefined;
  let musicPlayback: GodotMusicPlayback | undefined;
  let started = false;
  let paused = false;
  let playhead = 0;
  let contextStart = 0;
  let randomRate = 1;
  let pitchScale = clampPitchScale(options.pitchScale ?? 1);
  let maxPolyphony = requireAudioStreamPlayerMaxPolyphony(options.maxPolyphony ?? 1);
  let volumeDb = audio2DDecibels(options.volumeDb ?? 0);
  let maxDistance = audio2DNonNegative(options.maxDistance ?? 2_000, 'max_distance');
  let attenuation = audio2DNonNegative(options.attenuation ?? 1, 'attenuation');
  let panningStrength = audio2DNonNegative(options.panningStrength ?? 1, 'panning_strength');
  let areaMask = audio2DLayerMask(options.areaMask ?? 1);
  let autoplay = options.autoplay ?? false;
  let lastListener: AudioPoint2D = { x: options.node.x, y: options.node.y };
  const finished = createSignal<[]>();

  const sourcePosition = (): AudioPoint2D => {
    const world = options.node.worldTransform;
    return world === undefined ? options.node : { x: world.tx, y: world.ty };
  };

  gain.gain.value = dbToLinear(volumeDb);

  const rate = (): number => randomRate * pitchScale;

  const foldHardwareTime = (): void => {
    if (source === undefined || paused) return;
    playhead += (context.currentTime - contextStart) * rate();
    contextStart = context.currentTime;
  };

  const disconnectSource = (): void => {
    const current = source;
    source = undefined;
    if (current === undefined) return;
    current.onended = null;
    current.stop();
    current.disconnect();
  };

  const updateSpatialGain = (): void => {
    const position = sourcePosition();
    const dx = position.x - lastListener.x;
    const dy = position.y - lastListener.y;
    const distance = Math.hypot(dx, dy);
    const normalized = maxDistance <= 0 ? 0 : Math.min(1, distance / maxDistance);
    const distanceGain = maxDistance <= 0 ? 1 : (1 - normalized) ** attenuation;
    const pan = maxDistance <= 0
      ? 0
      : Math.max(-1, Math.min(1, (dx / maxDistance) * panningStrength));
    gain.gain.value = dbToLinear(volumeDb) * distanceGain;
    panner.pan.value = pan;
  };

  const startSource = (): void => {
    if (stream === undefined) return;
    if (!(stream instanceof AudioBuffer) && stream.kind === 'AudioStreamGenerator') {
      if (generatorPlayback === undefined) {
        generatorPlayback = createGodotAudioStreamGeneratorPlayback(context, stream);
        generatorPlayback.connect(gain);
      }
      generatorPlayback.set_pitch_scale(rate());
      generatorPlayback.start();
      return;
    }
    if (!(stream instanceof AudioBuffer) && (stream.kind === 'AudioStreamPlaylist' || stream.kind === 'AudioStreamSynchronized' || stream.kind === 'AudioStreamInteractive')) {
      if (options.random === undefined) throw new Error(`${stream.kind} requires the translated project seeded random callback.`);
      musicPlayback?.dispose();
      musicPlayback = stream.kind === 'AudioStreamPlaylist' ? createGodotAudioStreamPlaybackPlaylist(context, gain, stream, options.random)
        : stream.kind === 'AudioStreamSynchronized' ? createGodotAudioStreamPlaybackSynchronized(context, gain, stream, options.random)
          : createGodotAudioStreamPlaybackInteractive(context, gain, stream, options.random);
      musicPlayback.set_pitch_scale(rate());
      musicPlayback.start(playhead); return;
    }
    if (!(stream instanceof AudioBuffer) && stream.kind !== 'AudioStream') throw new Error(`${stream.kind} is not supported by AudioStreamPlayer2D.`);
    if (context.state === 'suspended') void context.resume();
    const buffer = audioStreamBuffer(stream);
    const next = context.createBufferSource();
    next.buffer = buffer;
    next.loop = audioStreamLoops(stream, options.loop ?? false);
    if (next.loop) next.loopStart = audioStreamLoopOffset(stream);
    next.playbackRate.value = rate();
    next.connect(gain);
    contextStart = context.currentTime;
    const offset = clampPosition(stream, playhead);
    next.start(0, offset % Math.max(buffer.duration, Number.EPSILON));
    next.onended = () => {
      if (source !== next) return;
      source = undefined;
      next.disconnect();
      if (!next.loop && started && !paused) {
        started = false;
        playhead = 0;
        finished.emit();
      }
    };
    source = next;
  };

  const player: AudioStreamPlayer2D = {
    __godotClass: 'AudioStreamPlayer2D',
    finished: finished.signal,
    get playing(): boolean {
      return started;
    },
    tickSim(delta: number): void {
      // The retained Pixi node can move, rotate under a translated parent, or be reparented while
      // playback is live. Sampling its world transform per sim tick preserves that identity.
      updateSpatialGain();
      if (generatorPlayback !== undefined) {
        playhead = generatorPlayback.get_playback_position();
        return;
      }
      if (musicPlayback !== undefined) {
        if (!paused) musicPlayback.tick(delta);
        playhead = musicPlayback.get_playback_position();
        if (started && !musicPlayback.is_playing()) { started = false; finished.emit(); }
        return;
      }
      if (!started || paused || stream === undefined || delta <= 0) return;
      if (!(stream instanceof AudioBuffer) && stream.kind !== 'AudioStream') return;
      playhead += delta * rate();
      const duration = audioStreamBuffer(stream).duration;
      if (audioStreamLoops(stream, options.loop ?? false) && duration > 0) {
        const loopStart = audioStreamLoopOffset(stream);
        playhead = loopStart + ((playhead - loopStart) % Math.max(Number.EPSILON, duration - loopStart));
        return;
      }
      if (playhead < duration) return;
      started = false;
      paused = false;
      playhead = 0;
      disconnectSource();
      finished.emit();
    },
    get volumeDb(): number {
      return volumeDb;
    },
    set volumeDb(value: number) {
      volumeDb = audio2DDecibels(value);
      updateSpatialGain();
    },
    get pitchScale(): number {
      return pitchScale;
    },
    set pitchScale(value: number) {
      foldHardwareTime();
      pitchScale = clampPitchScale(value);
      if (source !== undefined) source.playbackRate.value = rate();
      generatorPlayback?.set_pitch_scale(rate());
      musicPlayback?.set_pitch_scale(rate());
    },
    get maxPolyphony(): number {
      return maxPolyphony;
    },
    set maxPolyphony(value: number) {
      maxPolyphony = requireAudioStreamPlayerMaxPolyphony(value);
    },
    get streamPaused(): boolean {
      return paused;
    },
    set streamPaused(value: boolean) {
      if (value === paused || !started) return;
      paused = value;
      if (generatorPlayback !== undefined) {
        if (paused) generatorPlayback.pause(); else generatorPlayback.resume();
        return;
      }
      if (musicPlayback !== undefined) {
        if (paused) musicPlayback.pause(); else musicPlayback.resume();
        return;
      }
      if (paused) {
        foldHardwareTime();
        disconnectSource();
      } else {
        startSource();
      }
    },
    get stream(): GodotRuntimeAudioStream | undefined {
      return stream;
    },
    set stream(value: GodotRuntimeAudioStream | undefined) {
      if (stream === value) return;
      this.stop();
      generatorPlayback?.dispose(); generatorPlayback = undefined;
      stream = value;
    },
    get bus(): string {
      return hasBus(busName) ? busName : MASTER_BUS;
    },
    set bus(value: string) {
      if (typeof value !== 'string') throw new TypeError('AudioStreamPlayer2D.bus must be a StringName.');
      if (value === busName) return;
      busName = value;
      panner.disconnect();
      panner.connect(busInput(value));
    },
    get maxDistance(): number {
      return maxDistance;
    },
    set maxDistance(value: number) {
      maxDistance = audio2DNonNegative(value, 'max_distance');
      updateSpatialGain();
    },
    get attenuation(): number {
      return attenuation;
    },
    set attenuation(value: number) {
      attenuation = audio2DNonNegative(value, 'attenuation');
      updateSpatialGain();
    },
    get panningStrength(): number {
      return panningStrength;
    },
    set panningStrength(value: number) {
      panningStrength = audio2DNonNegative(value, 'panning_strength');
      updateSpatialGain();
    },
    get areaMask(): number {
      return areaMask;
    },
    set areaMask(value: number) {
      areaMask = audio2DLayerMask(value);
    },
    get autoplay(): boolean {
      return autoplay;
    },
    set autoplay(value: boolean) {
      if (typeof value !== 'boolean') throw new TypeError('AudioStreamPlayer2D.autoplay must be bool.');
      autoplay = value;
    },
    play(fromPosition = 0): void {
      disconnectSource();
      generatorPlayback?.stop();
      musicPlayback?.dispose(); musicPlayback = undefined;
      playhead = clampPosition(stream, fromPosition);
      randomRate = drawRandomRate(options);
      started = stream !== undefined;
      paused = false;
      updateSpatialGain();
      startSource();
    },
    stop(): void {
      disconnectSource();
      generatorPlayback?.stop();
      musicPlayback?.stop();
      started = false;
      paused = false;
      playhead = 0;
    },
    disposeVoice(): void {
      player.stop();
      generatorPlayback?.dispose(); generatorPlayback = undefined;
      musicPlayback?.dispose(); musicPlayback = undefined;
      gain.disconnect();
      panner.disconnect();
    },
    seek(position: number): void {
      if (generatorPlayback !== undefined) {
        generatorPlayback.seek(position);
        playhead = generatorPlayback.get_playback_position();
        return;
      }
      if (musicPlayback !== undefined) { playhead = Math.max(0, Number.isFinite(position) ? position : 0); musicPlayback.seek(playhead); return; }
      const wasPlaying = started && !paused;
      disconnectSource();
      playhead = clampPosition(stream, position);
      if (wasPlaying) startSource();
    },
    getPlaybackPosition(): number {
      if (generatorPlayback !== undefined) return generatorPlayback.get_playback_position();
      if (musicPlayback !== undefined) return musicPlayback.get_playback_position();
      if (!paused) foldHardwareTime();
      return clampPosition(stream, playhead);
    },
    update(listener: AudioPoint2D): void {
      lastListener = listener;
      updateSpatialGain();
    },
    updateListener2D(listener: AudioPoint2D): void {
      lastListener = listener;
      updateSpatialGain();
    },
    hasStreamPlayback: () => generatorPlayback !== undefined || musicPlayback !== undefined,
    getStreamPlayback: () => generatorPlayback ?? musicPlayback,
  };

  return player;
}

/** Godot 4 AudioStreamPlayer2D node with an ordered, bounded set of positional voices. */
export function createAudioStreamPlayer2D<TNode extends AudioPoint2D>(
  options: Omit<CreateAudioStreamPlayer2DOptions, 'node'> & { readonly node: TNode },
): AudioStreamPlayer2D & TNode {
  let stream: GodotRuntimeAudioStream | undefined = options.stream ?? options.buffer;
  let volumeDb = audio2DDecibels(options.volumeDb ?? 0);
  let pitchScale = clampPitchScale(options.pitchScale ?? 1);
  let maxPolyphony = requireAudioStreamPlayerMaxPolyphony(options.maxPolyphony ?? 1);
  let busName = options.bus ?? MASTER_BUS;
  let maxDistance = audio2DNonNegative(options.maxDistance ?? 2_000, 'max_distance');
  let attenuation = audio2DNonNegative(options.attenuation ?? 1, 'attenuation');
  let panningStrength = audio2DNonNegative(options.panningStrength ?? 1, 'panning_strength');
  let areaMask = audio2DLayerMask(options.areaMask ?? 1);
  let autoplay = options.autoplay ?? false;
  let listener: AudioPoint2D = { x: options.node.x, y: options.node.y };
  const buses: Readonly<Record<string, AudioNode>> = { ...(options.buses ?? {}), [MASTER_BUS]: options.destination };
  const hasBus = (name: string): boolean => options.graph === undefined
    ? name in buses
    : options.graph.busIndex(name) >= 0;

  const createVoice = (): AudioStreamPlayer2D => {
    const voice = createAudioStreamPlayer2DVoice({
      destination: options.destination,
      node: options.node,
      ...(options.buses === undefined ? {} : { buses: options.buses }),
      ...(options.graph === undefined ? {} : { graph: options.graph }),
      ...(options.loop === undefined ? {} : { loop: options.loop }),
      ...(options.randomPitch === undefined ? {} : { randomPitch: options.randomPitch }),
      ...(options.random === undefined ? {} : { random: options.random }),
      ...(stream === undefined ? {} : { stream }),
      volumeDb,
      pitchScale,
      maxPolyphony: 1,
      bus: busName,
      maxDistance,
      attenuation,
      panningStrength,
      areaMask,
      autoplay: false,
    });
    voice.update(listener);
    return voice;
  };
  const pool = createGodotAudioVoicePool(createVoice, maxPolyphony);
  const player: AudioStreamPlayer2D = {
    __godotClass: 'AudioStreamPlayer2D',
    finished: pool.finished,
    get playing(): boolean { return pool.playing; },
    tickSim(dt: number): void { pool.tickSim(dt); },
    play(fromPosition = 0): void { pool.play(fromPosition, godotAudioStreamIsMonophonic(stream)); },
    stop(): void { pool.stop(); },
    seek(position: number): void { pool.seek(position); },
    getPlaybackPosition(): number { return pool.latest?.getPlaybackPosition() ?? 0; },
    get volumeDb(): number { return volumeDb; },
    set volumeDb(value: number) {
      volumeDb = audio2DDecibels(value);
      pool.forEach((voice) => { voice.volumeDb = volumeDb; });
    },
    get pitchScale(): number { return pitchScale; },
    set pitchScale(value: number) {
      pitchScale = clampPitchScale(value);
      pool.forEach((voice) => { voice.pitchScale = pitchScale; });
    },
    get maxPolyphony(): number { return maxPolyphony; },
    set maxPolyphony(value: number) {
      maxPolyphony = requireAudioStreamPlayerMaxPolyphony(value);
      pool.setMaxPolyphony(maxPolyphony);
    },
    get streamPaused(): boolean { return pool.streamPaused; },
    set streamPaused(value: boolean) {
      if (typeof value !== 'boolean') throw new TypeError('AudioStreamPlayer2D.stream_paused must be bool.');
      pool.setStreamPaused(value);
    },
    get stream(): GodotRuntimeAudioStream | undefined { return stream; },
    set stream(value: GodotRuntimeAudioStream | undefined) {
      if (value === stream) return;
      pool.stop();
      stream = value;
    },
    get bus(): string { return hasBus(busName) ? busName : MASTER_BUS; },
    set bus(value: string) {
      if (typeof value !== 'string') throw new TypeError('AudioStreamPlayer2D.bus must be a StringName.');
      busName = value;
      pool.forEach((voice) => { voice.bus = value; });
    },
    get maxDistance(): number { return maxDistance; },
    set maxDistance(value: number) {
      maxDistance = audio2DNonNegative(value, 'max_distance');
      pool.forEach((voice) => { voice.maxDistance = maxDistance; });
    },
    get attenuation(): number { return attenuation; },
    set attenuation(value: number) {
      attenuation = audio2DNonNegative(value, 'attenuation');
      pool.forEach((voice) => { voice.attenuation = attenuation; });
    },
    get panningStrength(): number { return panningStrength; },
    set panningStrength(value: number) {
      panningStrength = audio2DNonNegative(value, 'panning_strength');
      pool.forEach((voice) => { voice.panningStrength = panningStrength; });
    },
    get areaMask(): number { return areaMask; },
    set areaMask(value: number) {
      areaMask = audio2DLayerMask(value);
      pool.forEach((voice) => { voice.areaMask = areaMask; });
    },
    get autoplay(): boolean { return autoplay; },
    set autoplay(value: boolean) {
      if (typeof value !== 'boolean') throw new TypeError('AudioStreamPlayer2D.autoplay must be bool.');
      autoplay = value;
    },
    hasStreamPlayback(): boolean { return pool.hasVoices; },
    getStreamPlayback(): GodotAudioStreamGeneratorPlayback | GodotMusicPlayback | undefined {
      return pool.latest?.getStreamPlayback();
    },
    update(next: AudioPoint2D): void {
      listener = next;
      pool.forEach((voice) => voice.update(next));
    },
    updateListener2D(next: AudioPoint2D): void {
      listener = next;
      pool.forEach((voice) => voice.updateListener2D?.(next));
    },
  };
  Object.defineProperties(options.node, Object.getOwnPropertyDescriptors(player));
  const bound = options.node as AudioStreamPlayer2D & TNode;
  registerLiveAudioStreamPlayer(bound);
  if (autoplay) bound.play();
  return bound;
}
