/**
 * Godot 3.6 `AudioStreamPlayer3D` over the browser's native Web Audio graph.
 *
 * Godot's authored distance curve and stereo SPCAP panning are carried directly. A Web Audio
 * `PannerNode` is deliberately not used: its distance models and HRTF/equal-power pan are different,
 * and `THREE.PositionalAudio` is that `PannerNode` — so it is out for the same reason, not for the
 * surface reason `audio.ts`'s header gives about `THREE.Audio`.
 *
 * The three pieces of transport math Godot spells identically for both player classes —
 * `db_to_linear`, the `pitch_scale` range, and the `AudioStreamRandomPitch` draw — are imported
 * from `audio.ts` rather than restated, because a Godot bound written twice is a bound that drifts
 * once. Everything else here is positional and lives nowhere else.
 */
import { type Camera, type Object3D, Vector3 } from 'three';
import { activeGodotAudioListener3D } from './audio-listener-3d';
import {
  type AudioStreamPlayback,
  type CreateAudioStreamPlayerOptions,
  type GodotRuntimeAudioStream,
  clampPitchScale,
  dbToLinear,
  drawRandomRate,
  godotAudioStreamIsMonophonic,
  registerLiveAudioStreamPlayer,
  requireAudioStreamPlayerMaxPolyphony,
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
import { selectGodotPlayableAudioStream } from './audio-stream-composition';
import {
  audioStreamBuffer,
  audioStreamLoopEnd,
  audioStreamLoopOffset,
  audioStreamLoops,
  cancelGodotEncodedAudioPlayback,
  createGodotAudioStreamMicrophonePlayback,
  deferGodotEncodedAudioPlayback,
  isGodotAudioStreamMicrophone,
  type GodotAudioStream,
  type GodotAudioStreamMicrophonePlayback,
} from './audio-stream';
import { createSignal, type GodotSignal } from './signal';
import { createGodotAudioVoicePool } from './audio-player-polyphony';

export type AudioStreamPlayer3DAttenuation =
  | 'inverse'
  | 'inverse-square'
  | 'logarithmic'
  | 'disabled';

export interface CreateAudioStreamPlayer3DOptions extends CreateAudioStreamPlayerOptions {
  /**
   * REQUIRED here, where the non-positional player's is optional. That player's is optional
   * because a measured fixture builds one with `AudioStreamPlayer.new()` and fills its `stream`
   * later (`audio.ts`'s header); nothing has ever constructed an `AudioStreamPlayer3D` at runtime,
   * so a stream-less one here would be surface written on spec. Every positional player in this
   * lane comes from a `.tscn` node whose `stream` ext-resource the port already resolved.
   */
  readonly buffer?: AudioBuffer;
  /** The authored node in the THREE tree. Its live world position is sampled by `update()`. */
  readonly node: Object3D;
  readonly attenuation?: AudioStreamPlayer3DAttenuation;
  readonly unitDb?: number;
  readonly unitSize?: number;
  readonly maxDb?: number;
  readonly maxDistance?: number;
  readonly panningStrength?: number;
  readonly attenuationFilterCutoffHz?: number;
  readonly attenuationFilterDb?: number;
  readonly autoplay?: boolean;
  /** Godot's `area_mask` (default layer 1), used when choosing an authored audio Area. */
  readonly areaMask?: number;
  /** The world-owned live Area registry. Scenes add/remove their authored regions on mount. */
  readonly reverbRegions?: readonly GodotAudioReverbRegion[];
}

/** The small Rapier collider surface Area routing needs, without hiding Rapier behind a wrapper. */
export interface GodotAudioAreaCollider {
  containsPoint(point: { readonly x: number; readonly y: number; readonly z: number }): boolean;
  projectPoint(
    point: { readonly x: number; readonly y: number; readonly z: number },
    solid: boolean,
  ): { readonly point: { readonly x: number; readonly y: number; readonly z: number } } | null;
}

/** One authored Godot `Area` whose reverb bus is enabled. */
export interface GodotAudioReverbRegion {
  readonly colliders: readonly GodotAudioAreaCollider[];
  readonly bus: AudioNode;
  readonly collisionLayer: number;
  readonly priority: number;
  readonly amount: number;
  readonly uniformity: number;
}

/**
 * Godot's POSITIONAL player. It extends the TRANSPORT ({@link AudioStreamPlayback}) and not
 * `AudioStreamPlayer`: the two are siblings in Godot (a `Node3D` and a `Node`), and the mixer
 * surface `audio.ts` grew for `starter-kit-3d-platformer` is measured on the non-positional one
 * only — inheriting it here would claim a `volume_db`/`stream_paused` this file does not answer.
 */
export interface AudioStreamPlayer3D extends AudioStreamPlayback {
  readonly __godotClass: 'AudioStreamPlayer3D';
  readonly finished: GodotSignal<[]>;
  volumeDb: number;
  pitchScale: number;
  maxPolyphony: number;
  bus: string;
  streamPaused: boolean;
  attenuationModel: number;
  maxDistance: number;
  unitDb: number;
  unitSize: number;
  maxDb: number;
  panningStrength: number;
  attenuationFilterCutoffHz: number;
  attenuationFilterDb: number;
  areaMask: number;
  autoplay: boolean;
  stream: GodotRuntimeAudioStream | undefined;
  hasStreamPlayback(): boolean;
  getStreamPlayback(): GodotAudioStreamGeneratorPlayback | GodotMusicPlayback | undefined;
  seek(position: number): void;
  getPlaybackPosition(): number;
  /** Recompute Godot's gains from this node and the active listener. */
  update(listener: Camera): void;
}

const CMP_EPSILON = 0.00001;
const FRONT_LEFT = new Vector3(-1, 0, -1).normalize();
const FRONT_RIGHT = new Vector3(1, 0, -1).normalize();
const STEREO_EFFECTIVE_SPEAKERS = 1.5;

/** Godot 3.6's `_get_attenuation_db`, followed by its `max_distance` fade. */
export function godotAudio3DMultiplier(
  distance: number,
  options: Pick<
    CreateAudioStreamPlayer3DOptions,
    'attenuation' | 'unitDb' | 'unitSize' | 'maxDb' | 'maxDistance'
  >,
): number {
  let multiplier = godotAudio3DAttenuationMultiplier(distance, options);
  const maxDistance = options.maxDistance ?? 0;
  if (maxDistance > 0) multiplier *= Math.max(0, 1 - distance / maxDistance);
  return multiplier;
}

function godotAudio3DAttenuationMultiplier(
  distance: number,
  options: Pick<CreateAudioStreamPlayer3DOptions, 'attenuation' | 'unitDb' | 'unitSize' | 'maxDb'>,
): number {
  const unitSize = options.unitSize ?? 1;
  let attenuationDb = 0;
  switch (options.attenuation ?? 'inverse') {
    case 'inverse':
      attenuationDb = 20 * Math.log10(1 / (distance / unitSize + CMP_EPSILON));
      break;
    case 'inverse-square': {
      const d = distance / unitSize;
      attenuationDb = 20 * Math.log10(1 / (d * d + CMP_EPSILON));
      break;
    }
    case 'logarithmic':
      attenuationDb = -20 * Math.log(distance / unitSize + CMP_EPSILON);
      break;
    case 'disabled':
      break;
  }
  attenuationDb = Math.min(attenuationDb + (options.unitDb ?? 0), options.maxDb ?? 3);
  return 10 ** (attenuationDb / 20);
}

/** Godot 3.6's stereo SPCAP pair (`audio/3d_panning_strength` defaults to 1). */
export function godotAudio3DStereoGains(
  listenerLocalDirection: { readonly x: number; readonly y: number; readonly z: number },
  panningStrength = 1,
): readonly [left: number, right: number] {
  const source = new Vector3(
    listenerLocalDirection.x,
    listenerLocalDirection.y,
    listenerLocalDirection.z,
  ).normalize();
  const tightness = 2 * panningStrength;
  const leftInitial = (0.5 * (1 + FRONT_LEFT.dot(source)) ** tightness) / STEREO_EFFECTIVE_SPEAKERS;
  const rightInitial =
    (0.5 * (1 + FRONT_RIGHT.dot(source)) ** tightness) / STEREO_EFFECTIVE_SPEAKERS;
  const magnitude = Math.hypot(leftInitial, rightInitial);
  return magnitude === 0 ? [0, 0] : [leftInitial / magnitude, rightInitial / magnitude];
}

/** Build one positional player. The destination and its context remain world-owned. */
function createAudioStreamPlayer3DVoice(
  options: CreateAudioStreamPlayer3DOptions,
): AudioStreamPlayer3D {
  const { destination, node } = options;
  let runtimeStream: GodotRuntimeAudioStream | undefined = options.stream ?? options.buffer;
  // Positional panning is built locally below, but its final merger still enters the ONE
  // world-owned Godot bus graph. Resolve the authored bus once, just as Godot binds a player's
  // mix target; AudioServer volume/mute changes then operate on the live GainNodes downstream.
  let busName = options.bus ?? 'Master';
  let directDestination = options.graph?.busInput(busName) ?? destination;
  const localPosition = new Vector3();
  const sourceWorld = new Vector3();
  const listenerWorld = new Vector3();
  const closestWorld = new Vector3();
  let source: AudioBufferSourceNode | undefined;
  let microphonePlayback: GodotAudioStreamMicrophonePlayback | undefined;
  let generatorPlayback: GodotAudioStreamGeneratorPlayback | undefined;
  let musicPlayback: GodotMusicPlayback | undefined;
  let musicInput: GainNode | undefined;
  let splitter: ChannelSplitterNode | undefined;
  let attenuationFilter: BiquadFilterNode | undefined;
  let merger: ChannelMergerNode | undefined;
  let left: GainNode | undefined;
  let right: GainNode | undefined;
  let reverbLeft: GainNode | undefined;
  let reverbRight: GainNode | undefined;
  let reverbMerger: ChannelMergerNode | undefined;
  let reverbDestination: AudioNode | undefined;
  let volumeDb = 0;
  let volumeMultiplier = 1;
  let pitchScale = 1;
  let maxPolyphony = requireAudioStreamPlayerMaxPolyphony(options.maxPolyphony ?? 1);
  let randomRate = 1;
  let leftGain = 1;
  let rightGain = 1;
  let reverbLeftGain = 0;
  let reverbRightGain = 0;
  // The SIM-CLOCK half of the lifecycle — the same rule `audio.ts`'s plain player carries (its
  // sim block has the measurement): `playing` must answer from the game's clock, because Web
  // Audio ends a stream on the HARDWARE clock and a driven run's census would race it. Legacy
  // wall behavior stands until the world's first `tickAudioStreamPlayers` call.
  let simDriven = false;
  let simStarted = false;
  let simPlayhead = 0;
  let playbackDuration = 0;
  let playbackLoops = false;
  let streamPaused = false;
  let maxDistance = options.maxDistance ?? 0;
  let unitDb = options.unitDb ?? 0;
  let unitSize = options.unitSize ?? 1;
  let maxDb = options.maxDb ?? 3;
  let panningStrength = options.panningStrength ?? 1;
  let attenuationFilterCutoffHz = options.attenuationFilterCutoffHz ?? 5_000;
  let attenuationFilterDb = options.attenuationFilterDb ?? -24;
  let areaMask = options.areaMask ?? 1;
  let autoplay = options.autoplay ?? false;
  let activeListener: Camera | undefined;
  let pendingEncodedStream: GodotAudioStream | undefined;
  const resumeEncodedPlayback = (): void => {
    if (pendingEncodedStream === undefined) return;
    pendingEncodedStream = undefined;
    player.play(simPlayhead);
  };
  const cancelEncodedPlayback = (): void => {
    if (pendingEncodedStream === undefined) return;
    cancelGodotEncodedAudioPlayback(pendingEncodedStream, resumeEncodedPlayback);
    pendingEncodedStream = undefined;
  };
  let attenuationModel = options.attenuation === 'inverse-square' ? 1 : options.attenuation === 'logarithmic' ? 2 : options.attenuation === 'disabled' ? 3 : 0;
  const finished = createSignal<[]>();

  const release = (released: AudioBufferSourceNode): void => {
    if (source === released) source = undefined;
    released.disconnect();
    attenuationFilter?.disconnect();
    splitter?.disconnect();
    left?.disconnect();
    right?.disconnect();
    merger?.disconnect();
    reverbLeft?.disconnect();
    reverbRight?.disconnect();
    reverbMerger?.disconnect();
    splitter = undefined;
    attenuationFilter = undefined;
    left = undefined;
    right = undefined;
    merger = undefined;
    reverbLeft = undefined;
    reverbRight = undefined;
    reverbMerger = undefined;
    reverbDestination = undefined;
  };

  const setupMusicInput = (monoInput = false): GainNode => {
    const context = directDestination.context as AudioContext;
    const input = context.createGain(), nextFilter = context.createBiquadFilter(), nextSplitter = context.createChannelSplitter(2);
    const nextLeft = context.createGain(), nextRight = context.createGain(), nextMerger = context.createChannelMerger(2);
    const nextReverbLeft = context.createGain(), nextReverbRight = context.createGain();
    const nextReverbMerger = context.createChannelMerger(2);
    nextFilter.type = 'lowpass'; nextFilter.frequency.value = context.sampleRate / 2;
    input.connect(nextFilter);
    if (monoInput) {
      // Godot's microphone playback always supplies stereo AudioFrames. A browser microphone is
      // commonly one channel, so reproduce those two equal frame channels before SPCAP panning.
      nextFilter.connect(nextLeft); nextFilter.connect(nextRight);
      nextFilter.connect(nextReverbLeft); nextFilter.connect(nextReverbRight);
    } else {
      nextFilter.connect(nextSplitter); nextSplitter.connect(nextLeft, 0); nextSplitter.connect(nextRight, 1);
      nextSplitter.connect(nextReverbLeft, 0); nextSplitter.connect(nextReverbRight, 1);
    }
    nextLeft.connect(nextMerger, 0, 0); nextRight.connect(nextMerger, 0, 1); nextMerger.connect(directDestination);
    nextReverbLeft.connect(nextReverbMerger, 0, 0); nextReverbRight.connect(nextReverbMerger, 0, 1);
    if (reverbDestination !== undefined) nextReverbMerger.connect(reverbDestination);
    nextLeft.gain.value = leftGain; nextRight.gain.value = rightGain;
    nextReverbLeft.gain.value = reverbLeftGain; nextReverbRight.gain.value = reverbRightGain;
    musicInput = input; attenuationFilter = nextFilter; splitter = monoInput ? undefined : nextSplitter; left = nextLeft; right = nextRight; merger = nextMerger;
    reverbLeft = nextReverbLeft; reverbRight = nextReverbRight; reverbMerger = nextReverbMerger;
    return input;
  };

  const disconnectSpatialGraph = (): void => {
    musicInput?.disconnect(); musicInput = undefined;
    attenuationFilter?.disconnect(); splitter?.disconnect(); left?.disconnect(); right?.disconnect(); merger?.disconnect();
    reverbLeft?.disconnect(); reverbRight?.disconnect(); reverbMerger?.disconnect();
    attenuationFilter = undefined; splitter = undefined; left = undefined; right = undefined; merger = undefined;
    reverbLeft = undefined; reverbRight = undefined; reverbMerger = undefined;
    reverbDestination = undefined;
  };

  const player: AudioStreamPlayer3D = {
    __godotClass: 'AudioStreamPlayer3D',
    finished: finished.signal,
    get playing(): boolean {
      if (simDriven) return simStarted;
      return pendingEncodedStream !== undefined || microphonePlayback?.playing === true || source !== undefined || generatorPlayback?.is_playing() === true || musicPlayback?.is_playing() === true;
    },
    tickSim(dt: number): void {
      simDriven = true;
      if (!simStarted || streamPaused) return;
      if (microphonePlayback !== undefined) {
        if (!microphonePlayback.playing) simStarted = false;
        simPlayhead = 0;
        return;
      }
      if (pendingEncodedStream !== undefined) {
        simPlayhead += dt * randomRate * pitchScale;
        return;
      }
      if (generatorPlayback !== undefined) {
        simPlayhead = generatorPlayback.get_playback_position();
        return;
      }
      if (musicPlayback !== undefined) {
        const wasPlaying = musicPlayback.is_playing(); musicPlayback.tick(dt); simPlayhead = musicPlayback.get_playback_position();
        if (wasPlaying && !musicPlayback.is_playing()) { simStarted = false; finished.emit(); }
        return;
      }
      simPlayhead += dt * randomRate * pitchScale;
      const duration = Math.max(playbackDuration, Number.EPSILON);
      if (playbackLoops) {
        simPlayhead %= duration;
        return;
      }
      if (simPlayhead < duration) return;
      // The stream's natural end, on the sim clock — under a fast-forward the sim deliberately
      // leads the hardware, so the audible source is cut with it rather than left to trail.
      simStarted = false;
      simPlayhead = 0;
      const current = source;
      if (current !== undefined) {
        source = undefined;
        current.stop();
        release(current);
      }
      finished.emit();
    },
    play(fromPosition = 0): void {
      this.stop();
      if (runtimeStream === undefined) return;
      const requestedStream = runtimeStream;
      if (
        !(requestedStream instanceof AudioBuffer) &&
        requestedStream.kind === 'AudioStream' &&
        deferGodotEncodedAudioPlayback(requestedStream, resumeEncodedPlayback)
      ) {
        pendingEncodedStream = requestedStream;
        simStarted = true;
        simPlayhead = Math.max(0, fromPosition);
        return;
      }
      if (!(runtimeStream instanceof AudioBuffer) && runtimeStream.kind === 'AudioStreamGenerator') {
        if (generatorPlayback === undefined) {
          const context = directDestination.context as AudioContext;
          const input = musicInput ?? setupMusicInput();
          generatorPlayback = createGodotAudioStreamGeneratorPlayback(context, runtimeStream);
          generatorPlayback.connect(input);
        }
        randomRate = 1;
        generatorPlayback.set_pitch_scale(pitchScale);
        simStarted = true;
        simPlayhead = 0;
        generatorPlayback.start();
        return;
      }
      if (
        !(runtimeStream instanceof AudioBuffer) &&
        runtimeStream.kind === 'AudioStream' &&
        isGodotAudioStreamMicrophone(runtimeStream)
      ) {
        if (pitchScale !== 1) {
          throw new Error(
            'AudioStreamMicrophone pitch_scale other than 1 requires Godot input-buffer resampling, which native MediaStreamAudioSourceNode cannot reproduce.',
          );
        }
        const context = directDestination.context as AudioContext;
        const input = musicInput ?? setupMusicInput(true);
        randomRate = 1;
        simStarted = true;
        simPlayhead = 0;
        microphonePlayback = createGodotAudioStreamMicrophonePlayback(context, input, {
          ...(options.microphoneInput === undefined ? {} : { requestInput: options.microphoneInput }),
          onFailure: (error) => {
            if (microphonePlayback?.failure !== error) return;
            simStarted = false;
            console.error(error);
          },
          onEnded: () => {
            simStarted = false;
          },
        });
        return;
      }
      if (!(runtimeStream instanceof AudioBuffer) && (runtimeStream.kind === 'AudioStreamPlaylist' || runtimeStream.kind === 'AudioStreamSynchronized' || runtimeStream.kind === 'AudioStreamInteractive')) {
        if (options.random === undefined) throw new Error(`${runtimeStream.kind} requires the translated project seeded random callback.`);
        const context = directDestination.context as AudioContext, input = setupMusicInput();
        musicPlayback = runtimeStream.kind === 'AudioStreamPlaylist' ? createGodotAudioStreamPlaybackPlaylist(context, input, runtimeStream, options.random)
          : runtimeStream.kind === 'AudioStreamSynchronized' ? createGodotAudioStreamPlaybackSynchronized(context, input, runtimeStream, options.random)
            : createGodotAudioStreamPlaybackInteractive(context, input, runtimeStream, options.random);
        randomRate = drawRandomRate(options); musicPlayback.set_pitch_scale(randomRate * pitchScale);
        simStarted = true; simPlayhead = Math.max(0, fromPosition); musicPlayback.start(simPlayhead); return;
      }
      let ordinaryStream: AudioBuffer | GodotAudioStream | undefined = runtimeStream instanceof AudioBuffer || runtimeStream.kind === 'AudioStream' ? runtimeStream : undefined;
      let selectedPitch = 1;
      if (!(runtimeStream instanceof AudioBuffer) && runtimeStream.kind === 'AudioStreamRandomizer') {
        if (options.random === undefined) throw new Error('AudioStreamRandomizer requires the translated project seeded random callback.');
        const selected = selectGodotPlayableAudioStream(runtimeStream, options.random); ordinaryStream = selected?.stream; selectedPitch = selected?.pitchScale ?? 1;
      }
      if (ordinaryStream === undefined) {
        const kind = runtimeStream instanceof AudioBuffer ? 'AudioBuffer' : runtimeStream.kind;
        throw new Error(`${kind} is not supported by AudioStreamPlayer3D.`);
      }
      const buffer = audioStreamBuffer(ordinaryStream);
      playbackDuration = audioStreamLoops(ordinaryStream, options.loop ?? false)
        ? audioStreamLoopEnd(ordinaryStream)
        : buffer.duration;
      simStarted = true;
      simPlayhead = Math.min(buffer.duration, Math.max(0, fromPosition));
      const context = directDestination.context as AudioContext;
      if (context.state === 'suspended') void context.resume();
      const next = context.createBufferSource();
      next.buffer = buffer;
      next.loop = audioStreamLoops(ordinaryStream, options.loop ?? false);
      if (next.loop) {
        next.loopStart = audioStreamLoopOffset(ordinaryStream);
        next.loopEnd = audioStreamLoopEnd(ordinaryStream);
      }
      playbackLoops = next.loop;
      randomRate = drawRandomRate(options) * selectedPitch;
      next.playbackRate.value = randomRate * pitchScale;

      const nextLeft = context.createGain();
      const nextFilter = context.createBiquadFilter();
      nextFilter.type = 'lowpass';
      nextFilter.frequency.value = context.sampleRate / 2;
      const nextRight = context.createGain();
      const nextMerger = context.createChannelMerger(2);
      const nextReverbLeft = context.createGain();
      const nextReverbRight = context.createGain();
      const nextReverbMerger = context.createChannelMerger(2);
      nextLeft.gain.value = leftGain;
      nextRight.gain.value = rightGain;
      nextReverbLeft.gain.value = reverbLeftGain;
      nextReverbRight.gain.value = reverbRightGain;
      if (buffer.numberOfChannels > 1) {
        const nextSplitter = context.createChannelSplitter(2);
        next.connect(nextFilter);
        nextFilter.connect(nextSplitter);
        nextSplitter.connect(nextLeft, 0);
        nextSplitter.connect(nextRight, 1);
        nextSplitter.connect(nextReverbLeft, 0);
        nextSplitter.connect(nextReverbRight, 1);
        splitter = nextSplitter;
      } else {
        next.connect(nextFilter);
        nextFilter.connect(nextLeft);
        nextFilter.connect(nextRight);
        nextFilter.connect(nextReverbLeft);
        nextFilter.connect(nextReverbRight);
      }
      nextLeft.connect(nextMerger, 0, 0);
      nextRight.connect(nextMerger, 0, 1);
      nextReverbLeft.connect(nextReverbMerger, 0, 0);
      nextReverbRight.connect(nextReverbMerger, 0, 1);
      nextMerger.connect(directDestination);
      if (reverbDestination !== undefined) nextReverbMerger.connect(reverbDestination);
      next.addEventListener(
        'ended',
        () => {
          const natural = source === next && simStarted;
          release(next);
          if (natural && !next.loop) {
            simStarted = false;
            simPlayhead = 0;
            finished.emit();
          }
        },
        { once: true },
      );
      source = next;
      attenuationFilter = nextFilter;
      left = nextLeft;
      right = nextRight;
      merger = nextMerger;
      reverbLeft = nextReverbLeft;
      reverbRight = nextReverbRight;
      reverbMerger = nextReverbMerger;
      next.start(0, simPlayhead % Math.max(buffer.duration, Number.EPSILON));
    },
    stop(): void {
      cancelEncodedPlayback();
      simStarted = false;
      streamPaused = false;
      simPlayhead = 0;
      microphonePlayback?.stop(); microphonePlayback = undefined;
      generatorPlayback?.stop();
      musicPlayback?.dispose(); musicPlayback = undefined;
      // A generator playback is the retained object returned by get_stream_playback(). Stopping
      // the player leaves both that identity and its routing graph alive for a later play().
      if (generatorPlayback === undefined) disconnectSpatialGraph();
      const current = source;
      if (current === undefined) return;
      source = undefined;
      current.stop();
      release(current);
    },
    disposeVoice(): void {
      player.stop();
      generatorPlayback?.dispose(); generatorPlayback = undefined;
      musicPlayback?.dispose(); musicPlayback = undefined;
      disconnectSpatialGraph();
    },
    seek(position: number): void {
      if (
        microphonePlayback !== undefined ||
        (!(runtimeStream instanceof AudioBuffer) &&
          runtimeStream?.kind === 'AudioStream' &&
          isGodotAudioStreamMicrophone(runtimeStream))
      ) {
        // AudioStreamPlaybackMicrophone::seek is intentionally a no-op.
        return;
      }
      if (generatorPlayback !== undefined) {
        generatorPlayback.seek(position);
        simPlayhead = generatorPlayback.get_playback_position();
        return;
      }
      if (musicPlayback !== undefined) { simPlayhead = Math.max(0, Number.isFinite(position) ? position : 0); musicPlayback.seek(simPlayhead); return; }
      const buffer = runtimeStream instanceof AudioBuffer ? runtimeStream : runtimeStream?.kind === 'AudioStream' ? runtimeStream.buffer : undefined;
      if (buffer === undefined) return;
      const nextPosition = Math.min(
        buffer.duration,
        Math.max(0, Number.isFinite(position) ? position : 0),
      );
      const restart = simStarted;
      this.stop();
      simPlayhead = nextPosition;
      if (restart) this.play(nextPosition);
    },
    getPlaybackPosition(): number {
      if (
        microphonePlayback !== undefined ||
        (!(runtimeStream instanceof AudioBuffer) &&
          runtimeStream?.kind === 'AudioStream' &&
          isGodotAudioStreamMicrophone(runtimeStream))
      ) return 0;
      if (generatorPlayback !== undefined) return generatorPlayback.get_playback_position();
      return simPlayhead;
    },
    get volumeDb(): number {
      return volumeDb;
    },
    set volumeDb(value: number) {
      if (typeof value !== 'number' || Number.isNaN(value) || value === Number.POSITIVE_INFINITY) {
        throw new TypeError('AudioStreamPlayer3D.volume_db requires decibels or -Infinity.');
      }
      const previous = volumeMultiplier;
      volumeDb = value;
      volumeMultiplier = dbToLinear(value);
      if (activeListener !== undefined) {
        player.update(activeListener);
      } else {
        const ratio = previous === 0 ? 0 : volumeMultiplier / previous;
        leftGain *= ratio;
        rightGain *= ratio;
        reverbLeftGain *= ratio;
        reverbRightGain *= ratio;
        if (left !== undefined) left.gain.value = leftGain;
        if (right !== undefined) right.gain.value = rightGain;
        if (reverbLeft !== undefined) reverbLeft.gain.value = reverbLeftGain;
        if (reverbRight !== undefined) reverbRight.gain.value = reverbRightGain;
      }
    },
    get pitchScale(): number {
      return pitchScale;
    },
    set pitchScale(value: number) {
      const next = clampPitchScale(value);
      const microphoneStream =
        !(runtimeStream instanceof AudioBuffer) &&
        runtimeStream?.kind === 'AudioStream' &&
        isGodotAudioStreamMicrophone(runtimeStream);
      if (next !== 1 && (microphonePlayback !== undefined || microphoneStream)) {
        throw new Error(
          'AudioStreamMicrophone pitch_scale other than 1 requires Godot input-buffer resampling, which native MediaStreamAudioSourceNode cannot reproduce.',
        );
      }
      pitchScale = next;
      if (source !== undefined) source.playbackRate.value = randomRate * pitchScale;
      generatorPlayback?.set_pitch_scale(pitchScale);
      musicPlayback?.set_pitch_scale(randomRate * pitchScale);
    },
    get maxPolyphony(): number { return maxPolyphony; },
    set maxPolyphony(value: number) {
      maxPolyphony = requireAudioStreamPlayerMaxPolyphony(value);
    },
    get bus(): string {
      return options.graph !== undefined && options.graph.busIndex(busName) < 0 ? 'Master' : busName;
    },
    set bus(value: string) {
      if (typeof value !== 'string') throw new TypeError('AudioStreamPlayer3D.bus must be a StringName.');
      if (value === busName) return;
      busName = value;
      directDestination = options.graph?.busInput(value) ?? destination;
      if (merger !== undefined) { merger.disconnect(); merger.connect(directDestination); }
    },
    get streamPaused(): boolean { return streamPaused; },
    set streamPaused(value: boolean) {
      if (typeof value !== 'boolean') throw new TypeError('AudioStreamPlayer3D.stream_paused must be bool.');
      if (value === streamPaused || (!simStarted && value)) return;
      if (value) {
        streamPaused = true;
        if (microphonePlayback !== undefined) {
          microphonePlayback.setPaused(true);
          return;
        }
        generatorPlayback?.pause();
        musicPlayback?.pause();
        const current = source;
        if (current !== undefined) { source = undefined; current.stop(); release(current); }
        return;
      }
      streamPaused = false;
      if (microphonePlayback !== undefined) {
        microphonePlayback.setPaused(false);
        return;
      }
      if (generatorPlayback !== undefined) { generatorPlayback.resume(); return; }
      if (musicPlayback !== undefined) { musicPlayback.resume(); return; }
      this.play(simPlayhead);
    },
    get attenuationModel(): number { return attenuationModel; },
    set attenuationModel(value: number) {
      if (!Number.isSafeInteger(value) || value < 0 || value > 3) throw new RangeError('AudioStreamPlayer3D.attenuation_model must be in [0, 3].');
      attenuationModel = value;
      if (activeListener !== undefined) player.update(activeListener);
    },
    get maxDistance(): number { return maxDistance; },
    set maxDistance(value: number) {
      if (!Number.isFinite(value) || value < 0) {
        throw new RangeError('AudioStreamPlayer3D.max_distance must be a finite non-negative number.');
      }
      maxDistance = value;
      if (activeListener !== undefined) player.update(activeListener);
    },
    get unitDb(): number { return unitDb; },
    set unitDb(value: number) {
      if (!Number.isFinite(value)) throw new RangeError('AudioStreamPlayer3D.unit_db must be a finite decibel value.');
      unitDb = value;
      if (activeListener !== undefined) player.update(activeListener);
    },
    get unitSize(): number { return unitSize; },
    set unitSize(value: number) {
      if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError('AudioStreamPlayer3D.unit_size must be a finite positive distance.');
      }
      unitSize = value;
      if (activeListener !== undefined) player.update(activeListener);
    },
    get maxDb(): number { return maxDb; },
    set maxDb(value: number) {
      if (!Number.isFinite(value)) throw new RangeError('AudioStreamPlayer3D.max_db must be a finite decibel value.');
      maxDb = value;
      if (activeListener !== undefined) player.update(activeListener);
    },
    get panningStrength(): number { return panningStrength; },
    set panningStrength(value: number) {
      if (!Number.isFinite(value) || value < 0) {
        throw new RangeError('AudioStreamPlayer3D.panning_strength must be a finite non-negative value.');
      }
      panningStrength = value;
      if (activeListener !== undefined) player.update(activeListener);
    },
    get attenuationFilterCutoffHz(): number { return attenuationFilterCutoffHz; },
    set attenuationFilterCutoffHz(value: number) {
      if (!Number.isFinite(value) || value < 1) throw new RangeError('AudioStreamPlayer3D.attenuation_filter_cutoff_hz must be >= 1 Hz.');
      attenuationFilterCutoffHz = value;
      if (activeListener !== undefined) player.update(activeListener);
    },
    get attenuationFilterDb(): number { return attenuationFilterDb; },
    set attenuationFilterDb(value: number) {
      if (!Number.isFinite(value) || value > 0) throw new RangeError('AudioStreamPlayer3D.attenuation_filter_db must be a finite non-positive decibel value.');
      attenuationFilterDb = value;
      if (activeListener !== undefined) player.update(activeListener);
    },
    get areaMask(): number { return areaMask; },
    set areaMask(value: number) {
      if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
        throw new RangeError('AudioStreamPlayer3D.area_mask must be an unsigned 32-bit layer mask.');
      }
      areaMask = value >>> 0;
      if (activeListener !== undefined) player.update(activeListener);
    },
    get autoplay(): boolean { return autoplay; },
    set autoplay(value: boolean) {
      if (typeof value !== 'boolean') throw new TypeError('AudioStreamPlayer3D.autoplay must be bool.');
      autoplay = value;
    },
    get stream(): GodotRuntimeAudioStream | undefined { return runtimeStream; },
    set stream(value: GodotRuntimeAudioStream | undefined) {
      if (value === runtimeStream) return;
      this.stop();
      generatorPlayback?.dispose(); generatorPlayback = undefined;
      disconnectSpatialGraph();
      runtimeStream = value;
    },
    hasStreamPlayback: () => generatorPlayback !== undefined || musicPlayback !== undefined,
    getStreamPlayback: () => generatorPlayback ?? musicPlayback,
    update(listener: Camera): void {
      activeListener = listener;
      const spatialListener = activeGodotAudioListener3D(listener);
      node.updateWorldMatrix(true, false);
      spatialListener.updateWorldMatrix(true, false);
      node.getWorldPosition(sourceWorld);
      localPosition.copy(sourceWorld);
      spatialListener.worldToLocal(localPosition);
      const attenuation = (['inverse', 'inverse-square', 'logarithmic', 'disabled'] as const)[attenuationModel]!;
      const multiplier = godotAudio3DMultiplier(localPosition.length(), {
        attenuation,
        unitDb,
        unitSize,
        maxDb,
        maxDistance,
      });
      if (attenuationFilter !== undefined) {
        const attenuationDb = multiplier <= 0 ? attenuationFilterDb : 20 * Math.log10(multiplier);
        const amount = attenuationFilterDb === 0
          ? 1
          : Math.min(1, Math.max(0, attenuationDb / attenuationFilterDb));
        const nyquist = attenuationFilter.context.sampleRate / 2;
        const cutoff = Math.min(nyquist, Math.max(1, attenuationFilterCutoffHz));
        attenuationFilter.frequency.value = nyquist * (cutoff / nyquist) ** amount;
      }
      const [panLeft, panRight] = godotAudio3DStereoGains(localPosition, panningStrength);
      leftGain = panLeft * multiplier * volumeMultiplier;
      rightGain = panRight * multiplier * volumeMultiplier;

      const region = [...(options.reverbRegions ?? [])]
        .filter(
          (candidate) =>
            (candidate.collisionLayer & areaMask) !== 0 &&
            candidate.colliders.some((collider) => collider.containsPoint(sourceWorld)),
        )
        .sort((a, b) => b.priority - a.priority)[0];
      reverbLeftGain = 0;
      reverbRightGain = 0;
      const nextDestination = region?.bus;
      if (region !== undefined) {
        if (region.uniformity <= 0) {
          reverbLeftGain = leftGain * region.amount;
          reverbRightGain = rightGain * region.amount;
        } else {
          listener.getWorldPosition(listenerWorld);
          let closestDistance = Number.POSITIVE_INFINITY;
          for (const collider of region.colliders) {
            const projection = collider.projectPoint(listenerWorld, true);
            if (projection === null) continue;
            closestWorld.set(projection.point.x, projection.point.y, projection.point.z);
            const distance = closestWorld.distanceTo(listenerWorld);
            if (distance < closestDistance) {
              closestDistance = distance;
              localPosition.copy(closestWorld);
            }
          }
          if (Number.isFinite(closestDistance)) {
            // Godot extends max-distance audibility only as far as the Area volume reaches the
            // listener; beyond that closest point it skips this listener's whole output.
            if (maxDistance > 0 && closestDistance > maxDistance) {
              leftGain = 0;
              rightGain = 0;
            } else {
              listener.worldToLocal(localPosition);
              const attenuation = godotAudio3DAttenuationMultiplier(closestDistance, {
                attenuation: (['inverse', 'inverse-square', 'logarithmic', 'disabled'] as const)[attenuationModel]!,
                unitDb,
                unitSize,
                maxDb,
              });
              let uniformLeft = 0.5;
              let uniformRight = 0.5;
              if (attenuation < 1) {
                localPosition.y = 0;
                localPosition.normalize();
                const c = localPosition.x * 0.5 + 0.5;
                uniformLeft = 1 - c + (0.5 - (1 - c)) * attenuation;
                uniformRight = c + (0.5 - c) * attenuation;
              }
              reverbLeftGain =
                (leftGain + (uniformLeft * attenuation - leftGain) * region.uniformity) *
                region.amount;
              reverbRightGain =
                (rightGain + (uniformRight * attenuation - rightGain) * region.uniformity) *
                region.amount;
            }
          }
        }
      }
      if (left !== undefined) left.gain.value = leftGain;
      if (right !== undefined) right.gain.value = rightGain;
      if (reverbLeft !== undefined) reverbLeft.gain.value = reverbLeftGain;
      if (reverbRight !== undefined) reverbRight.gain.value = reverbRightGain;
      if (reverbMerger !== undefined && nextDestination !== reverbDestination) {
        reverbMerger.disconnect();
        if (nextDestination !== undefined) reverbMerger.connect(nextDestination);
      }
      reverbDestination = nextDestination;
    },
  };
  return player;
}

/** Godot 4 AudioStreamPlayer3D node with an ordered, bounded set of positional voices. */
export function createAudioStreamPlayer3D(
  options: CreateAudioStreamPlayer3DOptions,
): AudioStreamPlayer3D {
  let runtimeStream: GodotRuntimeAudioStream | undefined = options.stream ?? options.buffer;
  let volumeDb = 0;
  let pitchScale = 1;
  let maxPolyphony = requireAudioStreamPlayerMaxPolyphony(options.maxPolyphony ?? 1);
  let busName = options.bus ?? 'Master';
  let attenuationModel = options.attenuation === 'inverse-square' ? 1
    : options.attenuation === 'logarithmic' ? 2
      : options.attenuation === 'disabled' ? 3 : 0;
  let maxDistance = options.maxDistance ?? 0;
  let unitDb = options.unitDb ?? 0;
  let unitSize = options.unitSize ?? 1;
  let maxDb = options.maxDb ?? 3;
  let panningStrength = options.panningStrength ?? 1;
  let attenuationFilterCutoffHz = options.attenuationFilterCutoffHz ?? 5_000;
  let attenuationFilterDb = options.attenuationFilterDb ?? -24;
  let areaMask = options.areaMask ?? 1;
  let autoplay = options.autoplay ?? false;
  let activeListener: Camera | undefined;
  const attenuationNames = ['inverse', 'inverse-square', 'logarithmic', 'disabled'] as const;

  const createVoice = (): AudioStreamPlayer3D => {
    const voice = createAudioStreamPlayer3DVoice({
      destination: options.destination,
      node: options.node,
      ...(options.graph === undefined ? {} : { graph: options.graph }),
      ...(options.buses === undefined ? {} : { buses: options.buses }),
      ...(options.loop === undefined ? {} : { loop: options.loop }),
      ...(options.randomPitch === undefined ? {} : { randomPitch: options.randomPitch }),
      ...(options.random === undefined ? {} : { random: options.random }),
      ...(options.microphoneInput === undefined ? {} : { microphoneInput: options.microphoneInput }),
      ...(options.reverbRegions === undefined ? {} : { reverbRegions: options.reverbRegions }),
      ...(runtimeStream === undefined ? {} : { stream: runtimeStream }),
      attenuation: attenuationNames[attenuationModel]!,
      maxDistance,
      unitDb,
      unitSize,
      maxDb,
      panningStrength,
      attenuationFilterCutoffHz,
      attenuationFilterDb,
      areaMask,
      bus: busName,
      maxPolyphony: 1,
      autoplay: false,
    });
    voice.volumeDb = volumeDb;
    voice.pitchScale = pitchScale;
    if (activeListener !== undefined) voice.update(activeListener);
    return voice;
  };
  const pool = createGodotAudioVoicePool(createVoice, maxPolyphony);
  const player: AudioStreamPlayer3D = {
    __godotClass: 'AudioStreamPlayer3D',
    finished: pool.finished,
    get playing(): boolean { return pool.playing; },
    tickSim(dt: number): void { pool.tickSim(dt); },
    play(fromPosition = 0): void {
      pool.play(fromPosition, godotAudioStreamIsMonophonic(runtimeStream));
    },
    stop(): void {
      pool.stop();
    },
    seek(position: number): void { pool.seek(position); },
    getPlaybackPosition(): number { return pool.latest?.getPlaybackPosition() ?? 0; },
    get volumeDb(): number { return volumeDb; },
    set volumeDb(value: number) {
      if (typeof value !== 'number' || Number.isNaN(value) || value === Number.POSITIVE_INFINITY) {
        throw new TypeError('AudioStreamPlayer3D.volume_db requires decibels or -Infinity.');
      }
      volumeDb = value;
      pool.forEach((voice) => { voice.volumeDb = value; });
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
    get bus(): string {
      return options.graph !== undefined && options.graph.busIndex(busName) < 0 ? 'Master' : busName;
    },
    set bus(value: string) {
      if (typeof value !== 'string') throw new TypeError('AudioStreamPlayer3D.bus must be a StringName.');
      busName = value;
      pool.forEach((voice) => { voice.bus = value; });
    },
    get streamPaused(): boolean { return pool.streamPaused; },
    set streamPaused(value: boolean) {
      if (typeof value !== 'boolean') throw new TypeError('AudioStreamPlayer3D.stream_paused must be bool.');
      if (!pool.hasVoices && value) return;
      pool.setStreamPaused(value);
    },
    get attenuationModel(): number { return attenuationModel; },
    set attenuationModel(value: number) {
      if (!Number.isSafeInteger(value) || value < 0 || value > 3) throw new RangeError('AudioStreamPlayer3D.attenuation_model must be in [0, 3].');
      attenuationModel = value;
      pool.forEach((voice) => { voice.attenuationModel = value; });
    },
    get maxDistance(): number { return maxDistance; },
    set maxDistance(value: number) {
      if (!Number.isFinite(value) || value < 0) throw new RangeError('AudioStreamPlayer3D.max_distance must be a finite non-negative number.');
      maxDistance = value;
      pool.forEach((voice) => { voice.maxDistance = value; });
    },
    get unitDb(): number { return unitDb; },
    set unitDb(value: number) {
      if (!Number.isFinite(value)) throw new RangeError('AudioStreamPlayer3D.unit_db must be a finite decibel value.');
      unitDb = value;
      pool.forEach((voice) => { voice.unitDb = value; });
    },
    get unitSize(): number { return unitSize; },
    set unitSize(value: number) {
      if (!Number.isFinite(value) || value <= 0) throw new RangeError('AudioStreamPlayer3D.unit_size must be a finite positive distance.');
      unitSize = value;
      pool.forEach((voice) => { voice.unitSize = value; });
    },
    get maxDb(): number { return maxDb; },
    set maxDb(value: number) {
      if (!Number.isFinite(value)) throw new RangeError('AudioStreamPlayer3D.max_db must be a finite decibel value.');
      maxDb = value;
      pool.forEach((voice) => { voice.maxDb = value; });
    },
    get panningStrength(): number { return panningStrength; },
    set panningStrength(value: number) {
      if (!Number.isFinite(value) || value < 0) throw new RangeError('AudioStreamPlayer3D.panning_strength must be a finite non-negative value.');
      panningStrength = value;
      pool.forEach((voice) => { voice.panningStrength = value; });
    },
    get attenuationFilterCutoffHz(): number { return attenuationFilterCutoffHz; },
    set attenuationFilterCutoffHz(value: number) {
      if (!Number.isFinite(value) || value < 1) throw new RangeError('AudioStreamPlayer3D.attenuation_filter_cutoff_hz must be >= 1 Hz.');
      attenuationFilterCutoffHz = value;
      pool.forEach((voice) => { voice.attenuationFilterCutoffHz = value; });
    },
    get attenuationFilterDb(): number { return attenuationFilterDb; },
    set attenuationFilterDb(value: number) {
      if (!Number.isFinite(value) || value > 0) throw new RangeError('AudioStreamPlayer3D.attenuation_filter_db must be a finite non-positive decibel value.');
      attenuationFilterDb = value;
      pool.forEach((voice) => { voice.attenuationFilterDb = value; });
    },
    get areaMask(): number { return areaMask; },
    set areaMask(value: number) {
      if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) throw new RangeError('AudioStreamPlayer3D.area_mask must be an unsigned 32-bit layer mask.');
      areaMask = value >>> 0;
      pool.forEach((voice) => { voice.areaMask = areaMask; });
    },
    get autoplay(): boolean { return autoplay; },
    set autoplay(value: boolean) {
      if (typeof value !== 'boolean') throw new TypeError('AudioStreamPlayer3D.autoplay must be bool.');
      autoplay = value;
    },
    get stream(): GodotRuntimeAudioStream | undefined { return runtimeStream; },
    set stream(value: GodotRuntimeAudioStream | undefined) {
      if (value === runtimeStream) return;
      pool.stop();
      runtimeStream = value;
    },
    hasStreamPlayback(): boolean { return pool.hasVoices; },
    getStreamPlayback(): GodotAudioStreamGeneratorPlayback | GodotMusicPlayback | undefined {
      return pool.latest?.getStreamPlayback();
    },
    update(listener: Camera): void {
      activeListener = listener;
      pool.forEach((voice) => voice.update(listener));
    },
  };
  registerLiveAudioStreamPlayer(player);
  if (autoplay) player.play();
  return player;
}
