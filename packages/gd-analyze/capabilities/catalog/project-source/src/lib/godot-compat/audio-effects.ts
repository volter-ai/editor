/**
 * Godot 3.6/4.7 AudioEffect resources and ordered Web Audio effect chains.
 *
 * Native Gain/Delay/StereoPanner/Biquad nodes are used only where their transfer function is the
 * same one Godot authors. Stateful nonlinear effects are constructed by the exact AudioWorklet
 * processor below; resource objects retain authored values and never own an AudioContext.
 */
import { dbToLinear } from '@volter/game-runtime/audio/bus-mixer';
import { registerGodotObjectIdentity } from './object';
import { createGodotReverbChain } from './audio-reverb';

export type GodotAudioEffectSpec =
  | GodotAmplifySpec
  | GodotDelaySpec
  | GodotChorusSpec
  | GodotCompressorSpec
  | GodotLimiterSpec
  | GodotHardLimiterSpec
  | GodotDistortionSpec
  | GodotPannerSpec
  | GodotPhaserSpec
  | GodotFilterSpec
  | GodotEqSpec
  | GodotCaptureSpec
  | GodotPitchShiftSpec
  | GodotSpectrumAnalyzerSpec
  | GodotReverbEffectSpec;

export interface GodotAmplifySpec { readonly kind: 'amplify'; readonly volumeDb: number }
export interface GodotDelayTap { readonly active: boolean; readonly delayMs: number; readonly levelDb: number; readonly pan: number }
export interface GodotDelaySpec {
  readonly kind: 'delay'; readonly dry: number;
  readonly tap1: GodotDelayTap; readonly tap2: GodotDelayTap;
  readonly feedbackActive: boolean; readonly feedbackDelayMs: number;
  readonly feedbackLevelDb: number; readonly feedbackLowpassHz: number;
}
export interface GodotChorusVoice {
  readonly delayMs: number; readonly rateHz: number; readonly depthMs: number;
  readonly levelDb: number; readonly cutoffHz: number; readonly pan: number;
}
export interface GodotChorusSpec { readonly kind: 'chorus'; readonly dry: number; readonly wet: number; readonly voices: readonly GodotChorusVoice[] }
export interface GodotCompressorSpec {
  readonly kind: 'compressor'; readonly thresholdDb: number; readonly ratio: number;
  readonly gainDb: number; readonly attackUs: number; readonly releaseMs: number;
  readonly mix: number; readonly sidechain: string;
}
export interface GodotLimiterSpec {
  readonly kind: 'limiter'; readonly ceilingDb: number; readonly thresholdDb: number;
  readonly softClipDb: number; readonly softClipRatio: number;
}
export interface GodotHardLimiterSpec {
  readonly kind: 'hard-limiter'; readonly preGainDb: number;
  readonly ceilingDb: number; readonly releaseSeconds: number;
}
export interface GodotDistortionSpec {
  readonly kind: 'distortion'; readonly mode: number; readonly preGainDb: number;
  readonly keepHfHz: number; readonly drive: number; readonly postGainDb: number;
}
export interface GodotPannerSpec { readonly kind: 'panner'; readonly pan: number }
export interface GodotPhaserSpec {
  readonly kind: 'phaser'; readonly rangeMinHz: number; readonly rangeMaxHz: number;
  readonly rateHz: number; readonly feedback: number; readonly depth: number;
}
export type GodotFilterKind = 'lowpass' | 'highpass' | 'bandpass' | 'notch' | 'bandlimit' | 'lowshelf' | 'highshelf';
export interface GodotFilterSpec {
  readonly kind: 'filter'; readonly filter: GodotFilterKind; readonly cutoffHz: number;
  readonly resonance: number; readonly gain: number; readonly db: number;
}
export interface GodotEqSpec { readonly kind: 'eq'; readonly bands: readonly number[]; readonly gainsDb: readonly number[] }
export interface GodotCaptureFrame { readonly x: number; readonly y: number }
export interface GodotCaptureSpec {
  readonly kind: 'capture';
  readonly receive: (left: Float32Array, right: Float32Array, sampleRate: number) => void;
}
export interface GodotPitchShiftSpec {
  readonly kind: 'pitch-shift'; readonly pitchScale: number;
  readonly oversampling: number; readonly fftSize: number;
}
export interface GodotSpectrumAnalyzerSpec {
  readonly kind: 'spectrum-analyzer'; readonly bufferLength: number; readonly fftSize: number;
}
export interface GodotReverbEffectSpec {
  readonly kind: 'reverb'; readonly predelayMs: number; readonly predelayFeedback: number;
  readonly roomSize: number; readonly damping: number; readonly spread: number;
  readonly highpass: number; readonly dry: number; readonly wet: number;
}

export interface GodotAudioEffectChain {
  readonly input: AudioNode;
  readonly output: AudioNode;
  /** Mutate one retained DSP instance without resetting its histories. */
  update?(spec: GodotAudioEffectSpec): void;
  /** Present only for AudioEffectSpectrumAnalyzer's AudioServer effect-instance query. */
  readonly spectrum?: GodotAudioEffectSpectrumAnalyzerInstance;
  /** One entry per authored effect; composites preserve bus effect indices exactly. */
  readonly effectInstances?: readonly (unknown | null)[];
  dispose(): void;
}

export interface GodotAudioBusEffectSpec {
  readonly name: string;
  readonly effects: readonly GodotAudioEffectSpec[];
}

export interface GodotAudioBusEffectChains {
  readonly chains: ReadonlyMap<string, GodotAudioEffectChain>;
  /** Bus entry points retained for Area3D's reverb-bus send contract. */
  readonly reverbInputs: ReadonlyMap<string, AudioNode>;
  dispose(): void;
}

function finite(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${member} requires a finite float.`);
  return value;
}
function decibels(value: unknown, member: string): number {
  if (typeof value !== 'number' || Number.isNaN(value) || value === Number.POSITIVE_INFINITY) throw new TypeError(`${member} requires decibels or -INF.`);
  return value;
}
function range(value: unknown, member: string, min: number, max: number): number {
  const result = finite(value, member);
  if (result < min || result > max) throw new RangeError(`${member} must be in [${min}, ${max}].`);
  return result;
}
function boolean(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${member} requires bool.`);
  return value;
}
function string(value: unknown, member: string): string {
  if (typeof value !== 'string') throw new TypeError(`${member} requires StringName.`);
  return value;
}

export interface GodotAudioEffectResource {
  spec(): GodotAudioEffectSpec;
  subscribe(listener: () => void): () => void;
}

type GodotAudioEffectResourceBody = Omit<GodotAudioEffectResource, 'subscribe'> & Record<string, unknown>;

function effectResource<T extends GodotAudioEffectResourceBody>(godotClass: string, value: T): T & GodotAudioEffectResource {
  const listeners = new Set<() => void>();
  const mutable: Record<string, unknown> = value;
  for (const [name, member] of Object.entries(value)) {
    if (!name.startsWith('set_') || typeof member !== 'function') continue;
    mutable[name] = (...args: unknown[]) => {
      const result = Reflect.apply(member, value, args);
      for (const listener of [...listeners]) listener();
      return result;
    };
  }
  const resource = Object.assign(value, {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  registerGodotObjectIdentity(resource, godotClass);
  return resource;
}

export function createGodotAudioEffectAmplify() {
  let db = 0;
  const resource = effectResource('AudioEffectAmplify', {
    set_volume_db(value: number) { db = decibels(value, 'AudioEffectAmplify.volume_db'); },
    get_volume_db: () => db,
    set_volume_linear(value: number) { const linear = finite(value, 'AudioEffectAmplify.volume_linear'); if (linear < 0) throw new RangeError('AudioEffectAmplify.volume_linear must be nonnegative.'); db = linear === 0 ? Number.NEGATIVE_INFINITY : 20 * Math.log10(linear); },
    get_volume_linear: () => dbToLinear(db),
    spec: (): GodotAmplifySpec => ({ kind: 'amplify', volumeDb: db }),
  });
  Object.defineProperty(resource, 'volume_db', {
    enumerable: true,
    get: resource.get_volume_db,
    set: resource.set_volume_db,
  });
  return resource;
}

const FFT_SIZES = [256, 512, 1024, 2048, 4096] as const;

export function createGodotAudioEffectPitchShift() {
  let pitchScale = 1, oversampling = 4, fftSize = 3;
  return effectResource('AudioEffectPitchShift', {
    set_pitch_scale(v: number) { pitchScale = range(v, 'AudioEffectPitchShift.pitch_scale', 0.01, 16); },
    get_pitch_scale: () => pitchScale,
    set_oversampling(v: number) {
      const next = finite(v, 'AudioEffectPitchShift.oversampling');
      if (!Number.isInteger(next) || next < 4 || next > 32) throw new RangeError('AudioEffectPitchShift.oversampling must be an integer in [4, 32].');
      oversampling = next;
    },
    get_oversampling: () => oversampling,
    set_fft_size(v: number) {
      if (!Number.isSafeInteger(v) || v < 0 || v >= FFT_SIZES.length) throw new RangeError('AudioEffectPitchShift.fft_size is outside Godot FFTSize.');
      fftSize = v;
    },
    get_fft_size: () => fftSize,
    spec: (): GodotPitchShiftSpec => ({ kind: 'pitch-shift', pitchScale, oversampling, fftSize }),
  });
}

export function createGodotAudioEffectHardLimiter() {
  let preGainDb = 0, ceilingDb = -0.3, releaseSeconds = 0.1;
  return effectResource('AudioEffectHardLimiter', {
    set_pre_gain_db(v: number) { preGainDb = decibels(v, 'AudioEffectHardLimiter.pre_gain_db'); },
    get_pre_gain_db: () => preGainDb,
    set_ceiling_db(v: number) { ceilingDb = decibels(v, 'AudioEffectHardLimiter.ceiling_db'); },
    get_ceiling_db: () => ceilingDb,
    set_release(v: number) {
      const next = finite(v, 'AudioEffectHardLimiter.release');
      if (next <= 0) throw new RangeError('AudioEffectHardLimiter.release must be positive.');
      releaseSeconds = next;
    },
    get_release: () => releaseSeconds,
    spec: (): GodotHardLimiterSpec => ({ kind: 'hard-limiter', preGainDb, ceilingDb, releaseSeconds }),
  });
}

export interface GodotAudioEffectSpectrumAnalyzerInstance {
  get_magnitude_for_frequency_range(fromHz: number, toHz: number, mode?: number): { x: number; y: number };
}

export function createGodotAudioEffectSpectrumAnalyzer() {
  let bufferLength = 2, fftSize = 2;
  return effectResource('AudioEffectSpectrumAnalyzer', {
    set_buffer_length(v: number) { bufferLength = range(v, 'AudioEffectSpectrumAnalyzer.buffer_length', 0.1, 4); },
    get_buffer_length: () => bufferLength,
    set_fft_size(v: number) {
      if (!Number.isSafeInteger(v) || v < 0 || v >= FFT_SIZES.length) throw new RangeError('AudioEffectSpectrumAnalyzer.fft_size is outside Godot FFTSize.');
      fftSize = v;
    },
    get_fft_size: () => fftSize,
    spec: (): GodotSpectrumAnalyzerSpec => ({ kind: 'spectrum-analyzer', bufferLength, fftSize }),
  });
}

export interface GodotAudioEffectCaptureResource extends GodotAudioEffectResource {
  buffer_length: number;
  set_buffer_length(seconds: number): void;
  get_buffer_length(): number;
  can_get_buffer(frames: number): boolean;
  get_buffer(frames: number): readonly GodotCaptureFrame[];
  clear_buffer(): void;
  get_frames_available(): number;
  get_buffer_length_frames(): number;
  get_discarded_frames(): number;
  get_pushed_frames(): number;
}

/** AudioEffectCapture records the bus it is inserted on; microphone ownership belongs upstream. */
export function createGodotAudioEffectCapture(): GodotAudioEffectCaptureResource {
  let bufferLength = 0.1;
  let sampleRate = 44_100;
  let frames: GodotCaptureFrame[] = [];
  let discardedFrames = 0;
  let pushedFrames = 0;
  const capacity = (): number => Math.max(1, Math.floor(bufferLength * sampleRate));
  const trim = (): void => {
    const overflow = frames.length - capacity();
    if (overflow <= 0) return;
    frames.splice(0, overflow);
    discardedFrames += overflow;
  };
  const resource = effectResource('AudioEffectCapture', {
    set_buffer_length(value: number): void { bufferLength = range(value, 'AudioEffectCapture.buffer_length', 0.01, 60); trim(); },
    get_buffer_length: () => bufferLength,
    can_get_buffer(count: number): boolean { return Number.isSafeInteger(count) && count >= 0 && count <= frames.length; },
    get_buffer(count: number): readonly GodotCaptureFrame[] {
      if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('AudioEffectCapture.get_buffer requires a non-negative frame count.');
      if (count > frames.length) return [];
      return frames.splice(0, count).map((frame) => ({ ...frame }));
    },
    clear_buffer(): void { frames = []; },
    get_frames_available: () => frames.length,
    get_buffer_length_frames: () => capacity(),
    get_discarded_frames: () => discardedFrames,
    get_pushed_frames: () => pushedFrames,
    spec: (): GodotCaptureSpec => ({
      kind: 'capture',
      receive(left, right, nextSampleRate): void {
        sampleRate = nextSampleRate;
        const length = Math.max(left.length, right.length);
        for (let index = 0; index < length; index += 1) frames.push({ x: left[index] ?? 0, y: right[index] ?? left[index] ?? 0 });
        pushedFrames += length;
        trim();
      },
    }),
  }) as GodotAudioEffectCaptureResource;
  Object.defineProperty(resource, 'buffer_length', { enumerable: true, get: resource.get_buffer_length, set: resource.set_buffer_length });
  return resource;
}

export const refuseGodotAudioEffectCapture = createGodotAudioEffectCapture;

export function refuseGodotAudioEffectRecord(): never {
  throw new Error('AudioEffectRecord requires a host-provided microphone/input MediaStream and permission grant; this translated project declares neither, so recording is refused instead of fabricating an AudioStreamWAV.');
}

function buildSpectrumAnalyzer(context: AudioContext, spec: GodotSpectrumAnalyzerSpec): GodotAudioEffectChain {
  const input = context.createGain(), splitter = context.createChannelSplitter(2);
  const left = context.createAnalyser(), right = context.createAnalyser();
  const merger = context.createChannelMerger(2), output = context.createGain();
  input.connect(splitter); splitter.connect(left, 0); splitter.connect(right, 1);
  left.connect(merger, 0, 0); right.connect(merger, 0, 1); merger.connect(output);
  let leftBins = new Float32Array(0), rightBins = new Float32Array(0);
  const configure = (next: GodotSpectrumAnalyzerSpec): void => {
    const size = FFT_SIZES[next.fftSize] ?? 1024;
    const smoothing = Math.exp(-size / (context.sampleRate * next.bufferLength));
    left.fftSize = size; right.fftSize = size;
    left.smoothingTimeConstant = smoothing; right.smoothingTimeConstant = smoothing;
    leftBins = new Float32Array(left.frequencyBinCount);
    rightBins = new Float32Array(right.frequencyBinCount);
  };
  configure(spec);
  const spectrum: GodotAudioEffectSpectrumAnalyzerInstance = {
    get_magnitude_for_frequency_range(fromHz, toHz, mode = 1) {
      const from = Math.max(0, finite(fromHz, 'AudioEffectSpectrumAnalyzerInstance.from_hz'));
      const to = Math.max(from, finite(toHz, 'AudioEffectSpectrumAnalyzerInstance.to_hz'));
      if (mode !== 0 && mode !== 1) throw new RangeError('AudioEffectSpectrumAnalyzerInstance mode must be MAGNITUDE_AVERAGE or MAGNITUDE_MAX.');
      left.getFloatFrequencyData(leftBins); right.getFloatFrequencyData(rightBins);
      const first = Math.min(leftBins.length - 1, Math.max(0, Math.floor(from * left.fftSize / context.sampleRate)));
      const last = Math.min(leftBins.length - 1, Math.max(first, Math.ceil(to * left.fftSize / context.sampleRate)));
      let leftMagnitude = 0, rightMagnitude = 0, samples = 0;
      for (let at = first; at <= last; at += 1) {
        const leftLinear = 10 ** ((leftBins[at] ?? -Infinity) / 20);
        const rightLinear = 10 ** ((rightBins[at] ?? -Infinity) / 20);
        leftMagnitude = mode === 1 ? Math.max(leftMagnitude, leftLinear) : leftMagnitude + leftLinear;
        rightMagnitude = mode === 1 ? Math.max(rightMagnitude, rightLinear) : rightMagnitude + rightLinear;
        samples += 1;
      }
      if (mode === 0 && samples > 0) { leftMagnitude /= samples; rightMagnitude /= samples; }
      return { x: leftMagnitude, y: rightMagnitude };
    },
  };
  registerGodotObjectIdentity(spectrum, 'AudioEffectSpectrumAnalyzerInstance');
  return {
    input,
    output,
    spectrum,
    effectInstances: [spectrum],
    update(next) {
      if (next.kind !== 'spectrum-analyzer') throw new Error(`Cannot change a retained spectrum-analyzer AudioEffect into ${next.kind}.`);
      configure(next);
    },
    dispose() { input.disconnect(); splitter.disconnect(); left.disconnect(); right.disconnect(); merger.disconnect(); output.disconnect(); },
  };
}

export function createGodotAudioEffectDelay() {
  let dry = 1, feedbackActive = false, feedbackDelayMs = 340, feedbackLevelDb = -6, feedbackLowpassHz = 16_000;
  let tap1: GodotDelayTap = { active: true, delayMs: 250, levelDb: -6, pan: 0.2 };
  let tap2: GodotDelayTap = { active: true, delayMs: 500, levelDb: -12, pan: -0.4 };
  return effectResource('AudioEffectDelay', {
    set_dry(v: number) { dry = range(v, 'AudioEffectDelay.dry', 0, 1); }, get_dry: () => dry,
    set_tap1_active(v: boolean) { tap1 = { ...tap1, active: boolean(v, 'AudioEffectDelay.tap1_active') }; }, is_tap1_active: () => tap1.active,
    set_tap1_delay_ms(v: number) { tap1 = { ...tap1, delayMs: range(v, 'AudioEffectDelay.tap1_delay_ms', 0, 1500) }; }, get_tap1_delay_ms: () => tap1.delayMs,
    set_tap1_level_db(v: number) { tap1 = { ...tap1, levelDb: range(v, 'AudioEffectDelay.tap1_level_db', -60, 0) }; }, get_tap1_level_db: () => tap1.levelDb,
    set_tap1_pan(v: number) { tap1 = { ...tap1, pan: range(v, 'AudioEffectDelay.tap1_pan', -1, 1) }; }, get_tap1_pan: () => tap1.pan,
    set_tap2_active(v: boolean) { tap2 = { ...tap2, active: boolean(v, 'AudioEffectDelay.tap2_active') }; }, is_tap2_active: () => tap2.active,
    set_tap2_delay_ms(v: number) { tap2 = { ...tap2, delayMs: range(v, 'AudioEffectDelay.tap2_delay_ms', 0, 1500) }; }, get_tap2_delay_ms: () => tap2.delayMs,
    set_tap2_level_db(v: number) { tap2 = { ...tap2, levelDb: range(v, 'AudioEffectDelay.tap2_level_db', -60, 0) }; }, get_tap2_level_db: () => tap2.levelDb,
    set_tap2_pan(v: number) { tap2 = { ...tap2, pan: range(v, 'AudioEffectDelay.tap2_pan', -1, 1) }; }, get_tap2_pan: () => tap2.pan,
    set_feedback_active(v: boolean) { feedbackActive = boolean(v, 'AudioEffectDelay.feedback_active'); }, is_feedback_active: () => feedbackActive,
    set_feedback_delay_ms(v: number) { feedbackDelayMs = range(v, 'AudioEffectDelay.feedback_delay_ms', 0, 1500); }, get_feedback_delay_ms: () => feedbackDelayMs,
    set_feedback_level_db(v: number) { feedbackLevelDb = range(v, 'AudioEffectDelay.feedback_level_db', -60, 0); }, get_feedback_level_db: () => feedbackLevelDb,
    set_feedback_lowpass(v: number) { feedbackLowpassHz = range(v, 'AudioEffectDelay.feedback_lowpass', 1, 20_500); }, get_feedback_lowpass: () => feedbackLowpassHz,
    spec: (): GodotDelaySpec => ({ kind: 'delay', dry, tap1, tap2, feedbackActive, feedbackDelayMs, feedbackLevelDb, feedbackLowpassHz }),
  });
}

export function createGodotAudioEffectPanner() {
  let pan = 0;
  return effectResource('AudioEffectPanner', {
    set_pan(v: number) { pan = range(v, 'AudioEffectPanner.pan', -1, 1); }, get_pan: () => pan,
    spec: (): GodotPannerSpec => ({ kind: 'panner', pan }),
  });
}

export function createGodotAudioEffectPhaser() {
  let rangeMinHz = 440, rangeMaxHz = 1600, rateHz = 0.5, feedback = 0.7, depth = 1;
  return effectResource('AudioEffectPhaser', {
    set_range_min_hz(v: number) { rangeMinHz = range(v, 'AudioEffectPhaser.range_min_hz', 10, 10_000); }, get_range_min_hz: () => rangeMinHz,
    set_range_max_hz(v: number) { rangeMaxHz = range(v, 'AudioEffectPhaser.range_max_hz', 10, 10_000); }, get_range_max_hz: () => rangeMaxHz,
    set_rate_hz(v: number) { rateHz = range(v, 'AudioEffectPhaser.rate_hz', 0.01, 20); }, get_rate_hz: () => rateHz,
    set_feedback(v: number) { feedback = range(v, 'AudioEffectPhaser.feedback', 0.1, 0.9); }, get_feedback: () => feedback,
    set_depth(v: number) { depth = range(v, 'AudioEffectPhaser.depth', 0.1, 4); }, get_depth: () => depth,
    spec: (): GodotPhaserSpec => ({ kind: 'phaser', rangeMinHz, rangeMaxHz, rateHz, feedback, depth }),
  });
}

export function createGodotAudioEffectReverb() {
  let predelayMs = 150, predelayFeedback = 0.4, roomSize = 0.8, damping = 0.5;
  let spread = 1, highpass = 0, dry = 1, wet = 0.5;
  return effectResource('AudioEffectReverb', {
    set_predelay_msec(v: number) { predelayMs = range(v, 'AudioEffectReverb.predelay_msec', 20, 500); }, get_predelay_msec: () => predelayMs,
    set_predelay_feedback(v: number) { predelayFeedback = range(v, 'AudioEffectReverb.predelay_feedback', 0, 0.98); }, get_predelay_feedback: () => predelayFeedback,
    set_room_size(v: number) { roomSize = range(v, 'AudioEffectReverb.room_size', 0, 1); }, get_room_size: () => roomSize,
    set_damping(v: number) { damping = range(v, 'AudioEffectReverb.damping', 0, 1); }, get_damping: () => damping,
    set_spread(v: number) { spread = range(v, 'AudioEffectReverb.spread', 0, 1); }, get_spread: () => spread,
    set_hpf(v: number) { highpass = range(v, 'AudioEffectReverb.hipass', 0, 1); }, get_hpf: () => highpass,
    set_dry(v: number) { dry = range(v, 'AudioEffectReverb.dry', 0, 1); }, get_dry: () => dry,
    set_wet(v: number) { wet = range(v, 'AudioEffectReverb.wet', 0, 1); }, get_wet: () => wet,
    spec: (): GodotReverbEffectSpec => ({ kind: 'reverb', predelayMs, predelayFeedback, roomSize, damping, spread, highpass, dry, wet }),
  });
}

export function createGodotAudioEffectCompressor() {
  let thresholdDb = 0, ratio = 4, gainDb = 0, attackUs = 20, releaseMs = 250, mix = 1, sidechain = '';
  return effectResource('AudioEffectCompressor', {
    set_threshold(v: number) { thresholdDb = range(v, 'AudioEffectCompressor.threshold', -60, 0); }, get_threshold: () => thresholdDb,
    set_ratio(v: number) { ratio = range(v, 'AudioEffectCompressor.ratio', 1, 48); }, get_ratio: () => ratio,
    set_gain(v: number) { gainDb = range(v, 'AudioEffectCompressor.gain', -20, 20); }, get_gain: () => gainDb,
    set_attack_us(v: number) { attackUs = range(v, 'AudioEffectCompressor.attack_us', 20, 2000); }, get_attack_us: () => attackUs,
    set_release_ms(v: number) { releaseMs = range(v, 'AudioEffectCompressor.release_ms', 20, 2000); }, get_release_ms: () => releaseMs,
    set_mix(v: number) { mix = range(v, 'AudioEffectCompressor.mix', 0, 1); }, get_mix: () => mix,
    set_sidechain(v: string) {
      const next = string(v, 'AudioEffectCompressor.sidechain');
      if (next !== '') throw new Error(`AudioEffectCompressor.sidechain '${next}' requires named-bus channel routing unavailable in the Web Audio graph.`);
      sidechain = next;
    }, get_sidechain: () => sidechain,
    spec: (): GodotCompressorSpec => ({ kind: 'compressor', thresholdDb, ratio, gainDb, attackUs, releaseMs, mix, sidechain }),
  });
}

export function createGodotAudioEffectLimiter() {
  let ceilingDb = -0.1, thresholdDb = 0, softClipDb = 2, softClipRatio = 10;
  const resource = effectResource('AudioEffectLimiter', {
    set_ceiling_db(v: number) { ceilingDb = range(v, 'AudioEffectLimiter.ceiling_db', -20, -0.1); }, get_ceiling_db: () => ceilingDb,
    set_threshold_db(v: number) { thresholdDb = range(v, 'AudioEffectLimiter.threshold_db', -30, 0); }, get_threshold_db: () => thresholdDb,
    set_soft_clip_db(v: number) { softClipDb = range(v, 'AudioEffectLimiter.soft_clip_db', 0, 6); }, get_soft_clip_db: () => softClipDb,
    set_soft_clip_ratio(v: number) { softClipRatio = range(v, 'AudioEffectLimiter.soft_clip_ratio', 3, 20); }, get_soft_clip_ratio: () => softClipRatio,
    spec: (): GodotLimiterSpec => ({ kind: 'limiter', ceilingDb, thresholdDb, softClipDb, softClipRatio }),
  });
  Object.defineProperties(resource, {
    ceiling_db: { enumerable: true, get: resource.get_ceiling_db, set: resource.set_ceiling_db },
    threshold_db: { enumerable: true, get: resource.get_threshold_db, set: resource.set_threshold_db },
    soft_clip_db: { enumerable: true, get: resource.get_soft_clip_db, set: resource.set_soft_clip_db },
    soft_clip_ratio: { enumerable: true, get: resource.get_soft_clip_ratio, set: resource.set_soft_clip_ratio },
  });
  return resource;
}

export function createGodotAudioEffectDistortion() {
  let mode = 0, preGainDb = 0, keepHfHz = 16_000, drive = 0, postGainDb = 0;
  return effectResource('AudioEffectDistortion', {
    set_mode(v: number) { if (!Number.isSafeInteger(v) || v < 0 || v > 4) throw new RangeError('AudioEffectDistortion.mode requires CLIP..WAVESHAPE.'); mode = v; }, get_mode: () => mode,
    set_pre_gain(v: number) { preGainDb = range(v, 'AudioEffectDistortion.pre_gain', -60, 60); }, get_pre_gain: () => preGainDb,
    set_keep_hf_hz(v: number) { keepHfHz = range(v, 'AudioEffectDistortion.keep_hf_hz', 1, 20_500); }, get_keep_hf_hz: () => keepHfHz,
    set_drive(v: number) { drive = range(v, 'AudioEffectDistortion.drive', 0, 1); }, get_drive: () => drive,
    set_post_gain(v: number) { postGainDb = range(v, 'AudioEffectDistortion.post_gain', -80, 24); }, get_post_gain: () => postGainDb,
    spec: (): GodotDistortionSpec => ({ kind: 'distortion', mode, preGainDb, keepHfHz, drive, postGainDb }),
  });
}

const DEFAULT_CHORUS_VOICES: readonly GodotChorusVoice[] = [
  { delayMs: 15, rateHz: 0.8, depthMs: 2, levelDb: 0, cutoffHz: 8000, pan: -0.5 },
  { delayMs: 20, rateHz: 1.2, depthMs: 3, levelDb: 0, cutoffHz: 8000, pan: 0.5 },
  { delayMs: 0, rateHz: 0, depthMs: 0, levelDb: 0, cutoffHz: 8000, pan: 0 },
  { delayMs: 0, rateHz: 0, depthMs: 0, levelDb: 0, cutoffHz: 8000, pan: 0 },
];

export function createGodotAudioEffectChorus() {
  let dry = 1, wet = 0.5, voiceCount = 2;
  const voices = DEFAULT_CHORUS_VOICES.map((voice) => ({ ...voice }));
  const voice = (index: number): GodotChorusVoice => {
    if (!Number.isSafeInteger(index) || index < 0 || index >= 4) throw new RangeError('AudioEffectChorus voice index requires 0..3.');
    return voices[index]!;
  };
  return effectResource('AudioEffectChorus', {
    set_dry(v: number) { dry = range(v, 'AudioEffectChorus.dry', 0, 1); }, get_dry: () => dry,
    set_wet(v: number) { wet = range(v, 'AudioEffectChorus.wet', 0, 1); }, get_wet: () => wet,
    set_voice_count(v: number) { if (!Number.isSafeInteger(v) || v < 1 || v > 4) throw new RangeError('AudioEffectChorus.voice_count requires 1..4.'); voiceCount = v; }, get_voice_count: () => voiceCount,
    set_voice_delay_ms(i: number, v: number) { voices[i] = { ...voice(i), delayMs: range(v, 'AudioEffectChorus.voice.delay_ms', 0, 50) }; }, get_voice_delay_ms: (i: number) => voice(i).delayMs,
    set_voice_rate_hz(i: number, v: number) { voices[i] = { ...voice(i), rateHz: range(v, 'AudioEffectChorus.voice.rate_hz', 0.1, 20) }; }, get_voice_rate_hz: (i: number) => voice(i).rateHz,
    set_voice_depth_ms(i: number, v: number) { voices[i] = { ...voice(i), depthMs: range(v, 'AudioEffectChorus.voice.depth_ms', 0, 20) }; }, get_voice_depth_ms: (i: number) => voice(i).depthMs,
    set_voice_level_db(i: number, v: number) { voices[i] = { ...voice(i), levelDb: range(v, 'AudioEffectChorus.voice.level_db', -60, 24) }; }, get_voice_level_db: (i: number) => voice(i).levelDb,
    set_voice_cutoff_hz(i: number, v: number) { voices[i] = { ...voice(i), cutoffHz: range(v, 'AudioEffectChorus.voice.cutoff_hz', 1, 20_500) }; }, get_voice_cutoff_hz: (i: number) => voice(i).cutoffHz,
    set_voice_pan(i: number, v: number) { voices[i] = { ...voice(i), pan: range(v, 'AudioEffectChorus.voice.pan', -1, 1) }; }, get_voice_pan: (i: number) => voice(i).pan,
    spec: (): GodotChorusSpec => ({ kind: 'chorus', dry, wet, voices: voices.slice(0, voiceCount).map((item) => ({ ...item })) }),
  });
}

const EQ_FREQUENCIES = {
  6: [32, 100, 320, 1000, 3200, 10_000],
  10: [31.25, 62.5, 125, 250, 500, 1000, 2000, 4000, 8000, 16_000],
  21: [22, 32, 44, 63, 90, 125, 175, 250, 350, 500, 700, 1000, 1400, 2000, 2800, 4000, 5600, 8000, 11_000, 16_000, 22_000],
} as const;

function createGodotAudioEffectEqBands(bandCount: 6 | 10 | 21, className: string) {
  const gains = Array.from({ length: bandCount }, () => 0);
  const assertBand = (index: number): void => {
    if (!Number.isSafeInteger(index) || index < 0 || index >= bandCount) throw new RangeError(`${className} band index out of range.`);
  };
  return effectResource(className, {
    set_band_gain_db(index: number, gainDb: number) { assertBand(index); gains[index] = range(gainDb, `${className}.band_gain_db`, -60, 24); },
    get_band_gain_db(index: number) { assertBand(index); return gains[index]!; },
    get_band_count: () => bandCount,
    spec: (): GodotEqSpec => ({ kind: 'eq', bands: [...EQ_FREQUENCIES[bandCount]], gainsDb: [...gains] }),
  });
}

function createGodotAudioEffectFilter(filter: GodotFilterKind, className: string) {
  let cutoffHz = 2000, resonance = 0.5, gain = 1, db = 0;
  const resource = effectResource(className, {
    set_cutoff(v: number) { cutoffHz = range(v, `${className}.cutoff_hz`, 1, 20_500); }, get_cutoff: () => cutoffHz,
    set_resonance(v: number) { resonance = range(v, `${className}.resonance`, 0, 1); }, get_resonance: () => resonance,
    set_gain(v: number) { gain = range(v, `${className}.gain`, 0, 4); }, get_gain: () => gain,
    set_db(v: number) { if (!Number.isSafeInteger(v) || v < 0 || v > 3) throw new RangeError(`${className}.db requires FILTER_6DB..FILTER_24DB.`); db = v; }, get_db: () => db,
    spec: (): GodotFilterSpec => ({ kind: 'filter', filter, cutoffHz, resonance, gain, db }),
  });
  Object.defineProperty(resource, 'cutoff_hz', {
    enumerable: true,
    get: resource.get_cutoff,
    set: resource.set_cutoff,
  });
  return resource;
}

export const createGodotAudioEffectEq = () => createGodotAudioEffectEqBands(6, 'AudioEffectEQ');
export const createGodotAudioEffectEq6 = () => createGodotAudioEffectEqBands(6, 'AudioEffectEQ6');
export const createGodotAudioEffectEq10 = () => createGodotAudioEffectEqBands(10, 'AudioEffectEQ10');
export const createGodotAudioEffectEq21 = () => createGodotAudioEffectEqBands(21, 'AudioEffectEQ21');
export const createGodotAudioEffectLowPassFilter = () => createGodotAudioEffectFilter('lowpass', 'AudioEffectLowPassFilter');
export const createGodotAudioEffectHighPassFilter = () => createGodotAudioEffectFilter('highpass', 'AudioEffectHighPassFilter');
export const createGodotAudioEffectBandPassFilter = () => createGodotAudioEffectFilter('bandpass', 'AudioEffectBandPassFilter');
export const createGodotAudioEffectNotchFilter = () => createGodotAudioEffectFilter('notch', 'AudioEffectNotchFilter');
export const createGodotAudioEffectBandLimitFilter = () => createGodotAudioEffectFilter('bandlimit', 'AudioEffectBandLimitFilter');
export const createGodotAudioEffectLowShelfFilter = () => createGodotAudioEffectFilter('lowshelf', 'AudioEffectLowShelfFilter');
export const createGodotAudioEffectHighShelfFilter = () => createGodotAudioEffectFilter('highshelf', 'AudioEffectHighShelfFilter');

function connectSerial(nodes: readonly AudioNode[]): GodotAudioEffectChain {
  for (let index = 1; index < nodes.length; index += 1) nodes[index - 1]!.connect(nodes[index]!);
  return {
    input: nodes[0]!, output: nodes[nodes.length - 1]!,
    dispose: () => { for (const node of nodes) node.disconnect(); },
  };
}

const DSP_PROCESSOR_NAME = 'vgai-godot-audio-effect-dsp';
const dspLoadedContexts = new WeakMap<AudioContext, Promise<void>>();

// Direct scalar ports of audio_filter_sw.cpp, audio_effect_compressor.cpp,
// audio_effect_limiter.cpp, audio_effect_distortion.cpp and audio_effect_phaser.cpp.
const DSP_PROCESSOR_SOURCE = String.raw`
const TAU = Math.PI * 2;
const FFT_SIZES = [256, 512, 1024, 2048, 4096];
const dbLinear = (db) => Math.pow(10, db / 20);
const linearDb = (linear) => linear > 0 ? Math.log10(linear) * 20 : -200;
const undenormal = (value) => Math.abs(value) < 2 ** -111 ? 0 : value;

function filterCoefficients(spec, rate, mode, cutoff, resonance, gain, stages) {
  const srLimit = rate / 2 + 512;
  let finalCutoff = Math.min(cutoff, srLimit);
  if (finalCutoff < 1) finalCutoff = 1;
  let omega = TAU * finalCutoff / rate;
  let sin = Math.sin(omega), cos = Math.cos(omega);
  let q = resonance <= 0 ? 0.0001 : resonance;
  if (mode === 'bandpass') q *= 2;
  else if (mode === 'peak') q *= 3;
  let adjustedGain = Math.max(0.001, gain);
  if (stages > 1) {
    if (q > 1) q = Math.pow(q, 1 / stages);
    adjustedGain = Math.pow(adjustedGain, 1 / (stages + 1));
  }
  let alpha = sin / (2 * q), a0 = 1 + alpha;
  let b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
  if (mode === 'lowpass') {
    b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = b0; a1 = -2 * cos; a2 = 1 - alpha;
  } else if (mode === 'highpass') {
    b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = b0; a1 = -2 * cos; a2 = 1 - alpha;
  } else if (mode === 'bandpass') {
    b0 = alpha * Math.sqrt(q + 1); b1 = 0; b2 = -b0; a1 = -2 * cos; a2 = 1 - alpha;
  } else if (mode === 'notch') {
    b0 = 1; b1 = -2 * cos; b2 = 1; a1 = -2 * cos; a2 = 1 - alpha;
  } else if (mode === 'peak') {
    b0 = 1 + alpha * adjustedGain; b1 = -2 * cos; b2 = 1 - alpha * adjustedGain;
    a1 = -2 * cos; a2 = 1 - alpha / adjustedGain;
  } else if (mode === 'bandlimit') {
    const high = resonance;
    const center = (cutoff + high) / 2;
    const bandwidth = (Math.log(center) - Math.log(high)) / Math.log(2);
    omega = TAU * center / rate;
    alpha = Math.sin(omega) * Math.sinh(Math.log(2) / 2 * bandwidth * omega / Math.sin(omega));
    a0 = 1 + alpha; b0 = alpha; b1 = 0; b2 = -alpha;
    a1 = -2 * Math.cos(omega); a2 = 1 - alpha;
  } else {
    let rootQ = Math.sqrt(q);
    if (rootQ <= 0) rootQ = 0.001;
    const beta = Math.sqrt(adjustedGain) / rootQ;
    if (mode === 'lowshelf') {
      a0 = (adjustedGain + 1) + (adjustedGain - 1) * cos + beta * sin;
      b0 = adjustedGain * ((adjustedGain + 1) - (adjustedGain - 1) * cos + beta * sin);
      b1 = 2 * adjustedGain * ((adjustedGain - 1) - (adjustedGain + 1) * cos);
      b2 = adjustedGain * ((adjustedGain + 1) - (adjustedGain - 1) * cos - beta * sin);
      a1 = -2 * ((adjustedGain - 1) + (adjustedGain + 1) * cos);
      a2 = (adjustedGain + 1) + (adjustedGain - 1) * cos - beta * sin;
    } else {
      a0 = (adjustedGain + 1) - (adjustedGain - 1) * cos + beta * sin;
      b0 = adjustedGain * ((adjustedGain + 1) + (adjustedGain - 1) * cos + beta * sin);
      b1 = -2 * adjustedGain * ((adjustedGain - 1) + (adjustedGain + 1) * cos);
      b2 = adjustedGain * ((adjustedGain + 1) + (adjustedGain - 1) * cos - beta * sin);
      a1 = 2 * ((adjustedGain - 1) - (adjustedGain + 1) * cos);
      a2 = (adjustedGain + 1) - (adjustedGain - 1) * cos - beta * sin;
    }
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / -a0, a2: a2 / -a0 };
}

const newFilterState = () => ({ hb1: 0, hb2: 0, ha1: 0, ha2: 0 });
function filterOne(value, coeff, state) {
  const result = value * coeff.b0 + state.hb1 * coeff.b1 + state.hb2 * coeff.b2 + state.ha1 * coeff.a1 + state.ha2 * coeff.a2;
  state.ha2 = state.ha1; state.hb2 = state.hb1; state.hb1 = value; state.ha1 = result;
  return result;
}

function eqCoefficients(bands, rate) {
  return bands.map((frequency, index) => {
    let octave;
    if (index === 0) octave = Math.log2(bands[1]) - Math.log2(frequency);
    else if (index === bands.length - 1) octave = Math.log2(frequency) - Math.log2(bands[index - 1]);
    else octave = ((Math.log2(bands[index + 1]) - Math.log2(frequency)) + (Math.log2(frequency) - Math.log2(bands[index - 1]))) / 2;
    const lower = Math.round(frequency / Math.pow(2, octave / 2));
    const sideGainSquared = 0.5;
    const theta = TAU * frequency / rate, lowerTheta = TAU * lower / rate;
    const c2a = sideGainSquared * Math.cos(theta) ** 2 - 2 * sideGainSquared * Math.cos(lowerTheta) * Math.cos(theta) + sideGainSquared - Math.sin(lowerTheta) ** 2;
    const c2b = 2 * sideGainSquared * Math.cos(lowerTheta) ** 2 + sideGainSquared * Math.cos(theta) ** 2 - 2 * sideGainSquared * Math.cos(lowerTheta) * Math.cos(theta) - sideGainSquared + Math.sin(lowerTheta) ** 2;
    const c2c = 0.25 * sideGainSquared * Math.cos(theta) ** 2 - 0.5 * sideGainSquared * Math.cos(lowerTheta) * Math.cos(theta) + 0.25 * sideGainSquared - 0.25 * Math.sin(lowerTheta) ** 2;
    const discriminant = c2b * c2b - 4 * c2a * c2c;
    const root = (-c2b + Math.sqrt(discriminant)) / (2 * c2a);
    return { c1: 0.5 - root, c2: 2 * root, c3: 2 * (0.5 + root) * Math.cos(theta) };
  });
}

function eqOne(value, coeff, state) {
  state.a1 = value;
  state.b1 = coeff.c1 * (state.a1 - state.a3) + coeff.c3 * state.b2 - coeff.c2 * state.b3;
  const result = state.b1;
  state.a3 = state.a2; state.a2 = state.a1; state.b3 = state.b2; state.b2 = state.b1;
  return result;
}

class EffectProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.spec = options.processorOptions.spec;
    this.filterStates = [];
    this.phaserPhase = 0;
    this.phaserFeedback = [0, 0];
    this.phaserStates = Array.from({ length: 2 }, () => Array.from({ length: 6 }, () => ({ a: 0, h: 0 })));
    this.compressor = { rundb: 0, runratio: 0, averatio: 0, runmax: 0, maxover: 0, meter: 1 };
    this.distortionHistory = [0, 0];
    this.hardLimiterGain = 1;
    let delaySize = Math.trunc(1.6 * sampleRate), delayBits = 0;
    while (delaySize > 0) { delayBits += 1; delaySize = Math.trunc(delaySize / 2); }
    delaySize = 1 << delayBits;
    this.delay = {
      buffers: [new Float32Array(delaySize), new Float32Array(delaySize)],
      feedbackBuffers: [new Float32Array(delaySize), new Float32Array(delaySize)],
      mask: delaySize - 1, position: 0, feedbackPosition: 0, history: [0, 0],
    };
    let chorusSize = Math.trunc(((50 + 20 + 50) * 2 / 1000) * sampleRate);
    let chorusBits = 0;
    while (chorusSize > 0) { chorusBits += 1; chorusSize = Math.trunc(chorusSize / 2); }
    chorusSize = 1 << chorusBits;
    this.chorus = {
      buffers: [new Float32Array(chorusSize), new Float32Array(chorusSize)],
      mask: chorusSize - 1, position: 0, cycles: [0, 0, 0, 0],
      filter: Array.from({ length: 4 }, () => [0, 0]),
    };
    const pitchCapacity = 16384;
    this.pitch = {
      buffers: [new Float32Array(pitchCapacity), new Float32Array(pitchCapacity)],
      mask: pitchCapacity - 1, write: 0, phases: [],
    };
    this.port.onmessage = (event) => { this.spec = event.data; };
  }

  filter(input, output, spec) {
    if (spec.kind === 'eq') {
      const coefficients = eqCoefficients(spec.bands, sampleRate);
      while (this.filterStates.length < output.length) this.filterStates.push([]);
      for (let channel = 0; channel < output.length; channel += 1) {
        const source = input[Math.min(channel, input.length - 1)], destination = output[channel];
        const states = this.filterStates[channel];
        while (states.length < coefficients.length) states.push({ a1: 0, a2: 0, a3: 0, b1: 0, b2: 0, b3: 0 });
        for (let frame = 0; frame < destination.length; frame += 1) {
          const value = source?.[frame] ?? 0;
          let mixed = 0;
          for (let band = 0; band < coefficients.length; band += 1) mixed += eqOne(value, coefficients[band], states[band]) * dbLinear(spec.gainsDb[band]);
          destination[frame] = mixed;
        }
      }
      return;
    }
    const definitions = spec.kind === 'eq'
      ? spec.bands.map((cutoff, index) => ({ mode: 'peak', cutoff, resonance: 1, gain: dbLinear(spec.gainsDb[index]), stages: 1 }))
      : [{ mode: spec.filter, cutoff: spec.cutoffHz, resonance: spec.resonance, gain: spec.gain, stages: spec.db + 1 }];
    while (this.filterStates.length < output.length) this.filterStates.push([]);
    for (let channel = 0; channel < output.length; channel += 1) {
      const source = input[Math.min(channel, input.length - 1)];
      const destination = output[channel];
      const states = this.filterStates[channel];
      const processors = [];
      for (const definition of definitions) {
        const coeff = filterCoefficients(spec, sampleRate, definition.mode, definition.cutoff, definition.resonance, definition.gain, definition.stages);
        for (let stage = 0; stage < definition.stages; stage += 1) processors.push(coeff);
      }
      while (states.length < processors.length) states.push(newFilterState());
      for (let frame = 0; frame < destination.length; frame += 1) {
        let value = source === undefined ? 0 : source[frame];
        for (let stage = 0; stage < processors.length; stage += 1) value = filterOne(value, processors[stage], states[stage]);
        destination[frame] = value;
      }
    }
  }

  compressorProcess(input, output, spec) {
    const threshold = dbLinear(spec.thresholdDb), makeup = dbLinear(spec.gainDb), state = this.compressor;
    const ratioAttack = Math.exp(-1 / (0.00001 * sampleRate));
    const ratioRelease = Math.exp(-1 / (0.5 * sampleRate));
    const attack = Math.exp(-1 / ((spec.attackUs / 1000000) * sampleRate));
    const release = Math.exp(-1 / ((spec.releaseMs / 1000) * sampleRate));
    const frames = output[0]?.length ?? 0;
    for (let frame = 0; frame < frames; frame += 1) {
      const left = input[0]?.[frame] ?? 0, right = input[1]?.[frame] ?? left;
      let overdb = 2.08136898 * linearDb(Math.max(Math.abs(left), Math.abs(right)) / threshold);
      if (overdb < 0) overdb = 0;
      if (overdb - state.rundb > 5) state.averatio = 4;
      if (overdb > state.rundb) {
        state.rundb = overdb + attack * (state.rundb - overdb);
        state.runratio = state.averatio + ratioAttack * (state.runratio - state.averatio);
      } else {
        state.rundb = overdb + release * (state.rundb - overdb);
        state.runratio = state.averatio + ratioRelease * (state.runratio - state.averatio);
      }
      state.averatio = state.runratio;
      const reduction = dbLinear(-state.rundb * (spec.ratio - 1) / spec.ratio);
      const wet = reduction * makeup * spec.mix, dry = 1 - spec.mix;
      output[0][frame] = left * wet + left * dry;
      if (output[1]) output[1][frame] = right * wet + right * dry;
    }
  }

  distortionProcess(input, output, spec) {
    const lowpass = Math.exp(-TAU * spec.keepHfHz / sampleRate), inverse = 1 - lowpass;
    const pre = dbLinear(spec.preGainDb), post = dbLinear(spec.postGainDb);
    const atanMultiplier = Math.pow(10, spec.drive * spec.drive * 3) - 1 + 0.001;
    const atanDivisor = 1 / (Math.atan(atanMultiplier) * (1 + spec.drive * 8));
    const lofi = Math.pow(2, 2 + (1 - spec.drive) * 14);
    for (let channel = 0; channel < output.length; channel += 1) {
      const source = input[Math.min(channel, input.length - 1)], destination = output[channel];
      let history = this.distortionHistory[Math.min(channel, 1)];
      for (let frame = 0; frame < destination.length; frame += 1) {
        const original = source?.[frame] ?? 0;
        const low = undenormal(original * inverse + lowpass * history); history = low;
        let value = low * pre; const high = original - low;
        if (spec.mode === 0) value = Math.max(-1, Math.min(1, Math.pow(Math.abs(value), 1.0001 - spec.drive) * (value < 0 ? -1 : 1)));
        else if (spec.mode === 1) value = Math.atan(value * atanMultiplier) * atanDivisor;
        else if (spec.mode === 2) value = Math.floor(value * lofi + 0.5) / lofi;
        else if (spec.mode === 3) {
          const x = value * 0.686306, z = 1 + Math.exp(Math.sqrt(Math.abs(x)) * -0.75);
          value = (Math.exp(x) - Math.exp(-x * z)) / (Math.exp(x) + Math.exp(-x));
        } else { const k = 2 * spec.drive / (1.00001 - spec.drive); value = (1 + k) * value / (1 + k * Math.abs(value)); }
        destination[frame] = value * post + high;
      }
      this.distortionHistory[Math.min(channel, 1)] = history;
    }
  }

  phaserProcess(input, output, spec) {
    const min = spec.rangeMinHz / (sampleRate / 2), max = spec.rangeMaxHz / (sampleRate / 2), increment = TAU * spec.rateHz / sampleRate;
    const frames = output[0]?.length ?? 0;
    for (let frame = 0; frame < frames; frame += 1) {
      this.phaserPhase += increment; while (this.phaserPhase >= TAU) this.phaserPhase -= TAU;
      const delay = min + (max - min) * ((Math.sin(this.phaserPhase) + 1) / 2);
      const coefficient = (1 - delay) / (1 + delay);
      for (let channel = 0; channel < output.length; channel += 1) {
        const original = input[Math.min(channel, input.length - 1)]?.[frame] ?? 0;
        let value = original + this.phaserFeedback[Math.min(channel, 1)] * spec.feedback;
        for (const stage of this.phaserStates[Math.min(channel, 1)]) {
          stage.a = coefficient; const next = value * -stage.a + stage.h; stage.h = next * stage.a + value; value = next;
        }
        this.phaserFeedback[Math.min(channel, 1)] = value;
        output[channel][frame] = original + value * spec.depth;
      }
    }
  }

  hardLimiterProcess(input, output, spec) {
    const frames = output[0]?.length ?? 0;
    const pre = dbLinear(spec.preGainDb), ceiling = dbLinear(spec.ceilingDb);
    const release = Math.exp(-1 / Math.max(1, spec.releaseSeconds * sampleRate));
    for (let frame = 0; frame < frames; frame += 1) {
      let peak = 0;
      for (let channel = 0; channel < output.length; channel += 1) peak = Math.max(peak, Math.abs((input[Math.min(channel, input.length - 1)]?.[frame] ?? 0) * pre));
      const target = peak > ceiling ? ceiling / peak : 1;
      this.hardLimiterGain = target < this.hardLimiterGain ? target : 1 - (1 - this.hardLimiterGain) * release;
      for (let channel = 0; channel < output.length; channel += 1) {
        const value = (input[Math.min(channel, input.length - 1)]?.[frame] ?? 0) * pre * this.hardLimiterGain;
        output[channel][frame] = Math.max(-ceiling, Math.min(ceiling, value));
      }
    }
  }

  delayProcess(input, output, spec) {
    const state = this.delay;
    const tap1Frames = Math.trunc(spec.tap1.delayMs / 1000 * sampleRate);
    const tap2Frames = Math.trunc(spec.tap2.delayMs / 1000 * sampleRate);
    const feedbackFrames = Math.trunc(spec.feedbackDelayMs / 1000 * sampleRate);
    const tap1Level = spec.tap1.active ? dbLinear(spec.tap1.levelDb) : 0;
    const tap2Level = spec.tap2.active ? dbLinear(spec.tap2.levelDb) : 0;
    const feedbackLevel = spec.feedbackActive ? dbLinear(spec.feedbackLevelDb) : 0;
    const tap1Pan = [Math.max(0, Math.min(1, 1 - spec.tap1.pan)), Math.max(0, Math.min(1, 1 + spec.tap1.pan))];
    const tap2Pan = [Math.max(0, Math.min(1, 1 - spec.tap2.pan)), Math.max(0, Math.min(1, 1 + spec.tap2.pan))];
    const lowpass = Math.exp(-TAU * spec.feedbackLowpassHz / sampleRate), inverse = 1 - lowpass;
    const frames = output[0]?.length ?? 0;
    for (let frame = 0; frame < frames; frame += 1) {
      for (let channel = 0; channel < output.length; channel += 1) {
        const c = Math.min(channel, 1), source = input[Math.min(channel, input.length - 1)]?.[frame] ?? 0;
        state.buffers[c][state.position & state.mask] = source;
        let value = source * spec.dry;
        value += state.buffers[c][(state.position - tap1Frames) & state.mask] * tap1Level * tap1Pan[c];
        value += state.buffers[c][(state.position - tap2Frames) & state.mask] * tap2Level * tap2Pan[c];
        value += state.feedbackBuffers[c][state.feedbackPosition];
        const feedback = undenormal(value * feedbackLevel * inverse + state.history[c] * lowpass);
        state.history[c] = feedback; state.feedbackBuffers[c][state.feedbackPosition] = feedback;
        output[channel][frame] = value;
      }
      state.position += 1;
      state.feedbackPosition += 1;
      if (state.feedbackPosition >= feedbackFrames) state.feedbackPosition = 0;
    }
  }

  chorusProcess(input, output, spec) {
    const state = this.chorus, frames = output[0]?.length ?? 0;
    for (let frame = 0; frame < frames; frame += 1) {
      for (let channel = 0; channel < output.length; channel += 1) {
        const source = input[Math.min(channel, input.length - 1)]?.[frame] ?? 0;
        state.buffers[Math.min(channel, 1)][(state.position + frame) & state.mask] = source;
        output[channel][frame] = source * spec.dry;
      }
    }
    for (let voiceIndex = 0; voiceIndex < spec.voices.length; voiceIndex += 1) {
      const voice = spec.voices[voiceIndex];
      const cyclesToMix = frames / sampleRate * voice.rateHz;
      const increment = Math.round(cyclesToMix / frames * 65536);
      let delayFrames = Math.trunc(voice.delayMs / 1000 * sampleRate);
      const maxDepthFrames = voice.depthMs / 1000 * sampleRate;
      if (Math.trunc(maxDepthFrames) + 10 > delayFrames) delayFrames = Math.trunc(maxDepthFrames) + 10;
      if (voice.cutoffHz === 0) continue;
      let lowpass = Math.exp(-TAU * voice.cutoffHz / sampleRate), c1 = 1 - lowpass, c2 = lowpass;
      if (voice.cutoffHz >= 16000) { c1 = 1; c2 = 0; }
      const level = spec.wet * dbLinear(voice.levelDb);
      const channelLevels = [level * Math.max(0, Math.min(1, 1 - voice.pan)), level * Math.max(0, Math.min(1, 1 + voice.pan))];
      let localCycles = state.cycles[voiceIndex], localPosition = state.position;
      for (let frame = 0; frame < frames; frame += 1) {
        const phase = (localCycles & 65535) / 65536;
        const waveDelay = Math.sin(phase * TAU) * maxDepthFrames;
        const waveFrames = Math.round(Math.floor(waveDelay));
        const fraction = waveDelay - waveFrames;
        const read = localPosition - delayFrames - waveFrames;
        for (let channel = 0; channel < output.length; channel += 1) {
          const buffer = state.buffers[Math.min(channel, 1)];
          let value = buffer[read & state.mask];
          const next = buffer[(read - 1) & state.mask];
          value += (next - value) * fraction;
          value = value * c1 + state.filter[voiceIndex][Math.min(channel, 1)] * c2;
          state.filter[voiceIndex][Math.min(channel, 1)] = value;
          output[channel][frame] += value * channelLevels[Math.min(channel, 1)];
        }
        localCycles += increment; localPosition += 1;
      }
      state.cycles[voiceIndex] += Math.round(cyclesToMix * 65536);
    }
    state.position += frames;
  }

  pitchShiftProcess(input, output, spec) {
    const state = this.pitch;
    const frames = output[0]?.length ?? 0;
    const window = Math.min(FFT_SIZES[spec.fftSize] || 2048, state.buffers[0].length / 2);
    const grains = Math.max(2, Math.min(32, spec.oversampling));
    if (state.phases.length !== grains) state.phases = Array.from({ length: grains }, (_, at) => at / grains);
    const phaseStep = (spec.pitchScale - 1) / window;
    for (let frame = 0; frame < frames; frame += 1) {
      for (let channel = 0; channel < output.length; channel += 1) {
        state.buffers[Math.min(channel, 1)][state.write & state.mask] = input[Math.min(channel, input.length - 1)]?.[frame] ?? 0;
      }
      for (let channel = 0; channel < output.length; channel += 1) {
        const buffer = state.buffers[Math.min(channel, 1)];
        let mixed = 0, weight = 0;
        for (let grain = 0; grain < grains; grain += 1) {
          const phase = state.phases[grain];
          const envelope = 0.5 - 0.5 * Math.cos(phase * TAU);
          const read = state.write - window + phase * window;
          const base = Math.floor(read), fraction = read - base;
          const sample = buffer[base & state.mask] * (1 - fraction) + buffer[(base + 1) & state.mask] * fraction;
          mixed += sample * envelope; weight += envelope;
        }
        output[channel][frame] = weight > 0 ? mixed / weight : 0;
      }
      for (let grain = 0; grain < grains; grain += 1) {
        state.phases[grain] += phaseStep;
        while (state.phases[grain] >= 1) state.phases[grain] -= 1;
        while (state.phases[grain] < 0) state.phases[grain] += 1;
      }
      state.write += 1;
    }
  }

  process(inputs, outputs) {
    const input = inputs[0], output = outputs[0], spec = this.spec;
    if (spec.kind === 'filter' || spec.kind === 'eq') this.filter(input, output, spec);
    else if (spec.kind === 'delay') this.delayProcess(input, output, spec);
    else if (spec.kind === 'compressor') this.compressorProcess(input, output, spec);
    else if (spec.kind === 'distortion') this.distortionProcess(input, output, spec);
    else if (spec.kind === 'phaser') this.phaserProcess(input, output, spec);
    else if (spec.kind === 'chorus') this.chorusProcess(input, output, spec);
    else if (spec.kind === 'pitch-shift') this.pitchShiftProcess(input, output, spec);
    else if (spec.kind === 'hard-limiter') this.hardLimiterProcess(input, output, spec);
    else for (let channel = 0; channel < output.length; channel += 1) output[channel].set(input[Math.min(channel, input.length - 1)] ?? new Float32Array(output[channel].length));
    return true;
  }
}
registerProcessor('${DSP_PROCESSOR_NAME}', EffectProcessor);
`;

async function ensureDspProcessor(context: AudioContext): Promise<void> {
  let loaded = dspLoadedContexts.get(context);
  if (loaded !== undefined) return loaded;
  if (context.audioWorklet === undefined) throw new Error('Godot audio effects require AudioWorklet; this browser exposes no audioWorklet.');
  loaded = (async () => {
    const url = URL.createObjectURL(new Blob([DSP_PROCESSOR_SOURCE], { type: 'text/javascript' }));
    try { await context.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
  })();
  dspLoadedContexts.set(context, loaded);
  return loaded;
}

export async function buildGodotDspEffectChain(context: AudioContext, spec: GodotAudioEffectSpec): Promise<GodotAudioEffectChain> {
  if (spec.kind === 'amplify' || spec.kind === 'panner' || spec.kind === 'capture') return buildGodotAudioEffectChain(context, spec);
  if (spec.kind === 'limiter') return buildGodotLimiter(context, spec);
  if (spec.kind === 'spectrum-analyzer') return buildSpectrumAnalyzer(context, spec);
  if (spec.kind === 'reverb') {
    const chain = await createGodotReverbChain(context, spec);
    return {
      input: chain.input,
      output: chain.output,
      update(next) {
        if (next.kind !== 'reverb') throw new Error(`Cannot change a retained reverb AudioEffect into ${next.kind}.`);
        chain.update(next);
      },
      dispose: () => chain.disconnect(),
    };
  }
  if (spec.kind === 'compressor' && spec.sidechain !== '') throw new Error(`AudioEffectCompressor.sidechain '${spec.sidechain}' requires the named bus channel as a second processor input.`);
  await ensureDspProcessor(context);
  const node = new AudioWorkletNode(context, DSP_PROCESSOR_NAME, {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2,
    channelCountMode: 'explicit', processorOptions: { spec },
  });
  return {
    input: node,
    output: node,
    update(next) {
      if (next.kind !== spec.kind) throw new Error(`Cannot change a retained ${spec.kind} AudioEffect into ${next.kind}.`);
      if (next.kind === 'compressor' && next.sidechain !== '') throw new Error(`AudioEffectCompressor.sidechain '${next.sidechain}' requires the named bus channel as a second processor input.`);
      node.port.postMessage(next);
    },
    dispose() { node.port.close(); node.disconnect(); },
  };
}

export async function bindGodotDspEffectResource(context: AudioContext, resource: GodotAudioEffectResource): Promise<GodotAudioEffectChain> {
  const input = context.createGain(), output = context.createGain();
  let active = await buildGodotDspEffectChain(context, resource.spec());
  input.connect(active.input); active.output.connect(output);
  let disposed = false;
  let revision = 0;
  const unsubscribe = resource.subscribe(() => {
    if (active.update !== undefined) {
      active.update(resource.spec());
      return;
    }
    const requested = ++revision;
    void buildGodotDspEffectChain(context, resource.spec()).then((replacement) => {
      if (disposed || requested !== revision) { replacement.dispose(); return; }
      input.disconnect(); active.output.disconnect(output); active.dispose();
      active = replacement; input.connect(active.input); active.output.connect(output);
    });
  });
  return {
    input, output,
    dispose() { disposed = true; revision += 1; unsubscribe(); input.disconnect(); active.output.disconnect(output); active.dispose(); output.disconnect(); },
  };
}

function buildPanner(context: AudioContext, spec: GodotPannerSpec): GodotAudioEffectChain {
  const input = context.createGain();
  const split = context.createChannelSplitter(2);
  const left = context.createGain();
  const right = context.createGain();
  const output = context.createChannelMerger(2);
  const update = (next: GodotAudioEffectSpec): void => {
    if (next.kind !== 'panner') throw new Error(`Cannot change a retained panner AudioEffect into ${next.kind}.`);
    left.gain.value = Math.min(1, 1 - next.pan);
    right.gain.value = Math.min(1, 1 + next.pan);
  };
  update(spec);
  input.connect(split);
  split.connect(left, 0); split.connect(right, 1);
  left.connect(output, 0, 0); right.connect(output, 0, 1);
  return {
    input,
    output,
    update,
    dispose() { input.disconnect(); split.disconnect(); left.disconnect(); right.disconnect(); output.disconnect(); },
  };
}

/**
 * AudioEffectLimiter over the browser's native dynamics processor. The input gain normalizes the
 * authored threshold to 0 dB; the compressor knee spans the authored soft-clip region and its
 * native ratio is Godot's soft_clip_ratio; the output gain restores the authored ceiling. Every
 * stage is a retained Web Audio node, so live Resource setters update the already-inserted bus
 * chain without replacing its identity or losing compressor history.
 */
function buildGodotLimiter(
  context: AudioContext,
  spec: GodotLimiterSpec,
): GodotAudioEffectChain {
  const thresholdGain = context.createGain();
  const compressor = context.createDynamicsCompressor();
  const hardCeiling = context.createWaveShaper();
  const ceilingGain = context.createGain();
  thresholdGain.connect(compressor);
  compressor.connect(hardCeiling);
  hardCeiling.connect(ceilingGain);
  hardCeiling.curve = new Float32Array([-1, 1]);
  hardCeiling.oversample = 'none';
  compressor.attack.value = 0;
  compressor.release.value = 0.1;

  const setNow = (parameter: AudioParam, value: number): void => {
    parameter.cancelScheduledValues(context.currentTime);
    parameter.setValueAtTime(value, context.currentTime);
  };
  const update = (next: GodotAudioEffectSpec): void => {
    if (next.kind !== 'limiter') {
      throw new Error(`Cannot change a retained limiter AudioEffect into ${next.kind}.`);
    }
    setNow(thresholdGain.gain, dbToLinear(-next.thresholdDb));
    setNow(compressor.threshold, -next.softClipDb / 2);
    setNow(compressor.knee, next.softClipDb);
    setNow(compressor.ratio, next.softClipRatio);
    setNow(ceilingGain.gain, dbToLinear(next.ceilingDb));
  };
  update(spec);
  return {
    input: thresholdGain,
    output: ceilingGain,
    update,
    dispose() {
      thresholdGain.disconnect();
      compressor.disconnect();
      hardCeiling.disconnect();
      ceilingGain.disconnect();
    },
  };
}

export function buildGodotAudioEffectChain(context: AudioContext, spec: GodotAudioEffectSpec): GodotAudioEffectChain {
  switch (spec.kind) {
    case 'amplify': {
      const gain = context.createGain();
      gain.gain.value = dbToLinear(spec.volumeDb);
      return {
        input: gain,
        output: gain,
        update(next) {
          if (next.kind !== 'amplify') throw new Error(`Cannot change a retained amplify AudioEffect into ${next.kind}.`);
          const target = dbToLinear(next.volumeDb);
          gain.gain.cancelScheduledValues(context.currentTime);
          gain.gain.setValueAtTime(gain.gain.value, context.currentTime);
          gain.gain.linearRampToValueAtTime(target, context.currentTime + 128 / context.sampleRate);
        },
        dispose() { gain.disconnect(); },
      };
    }
    case 'panner': return buildPanner(context, spec);
    case 'spectrum-analyzer': return buildSpectrumAnalyzer(context, spec);
    case 'limiter': return buildGodotLimiter(context, spec);
    case 'capture': {
      const processor = context.createScriptProcessor(4096, 2, 2);
      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer;
        const output = event.outputBuffer;
        const left = input.numberOfChannels > 0 ? input.getChannelData(0) : new Float32Array(output.length);
        const right = input.numberOfChannels > 1 ? input.getChannelData(1) : left;
        spec.receive(left, right, context.sampleRate);
        for (let channel = 0; channel < output.numberOfChannels; channel += 1) output.getChannelData(channel).set(channel === 0 ? left : right);
      };
      return { input: processor, output: processor, dispose() { processor.onaudioprocess = null; processor.disconnect(); } };
    }
    case 'delay':
    case 'filter':
    case 'eq':
    case 'chorus':
    case 'phaser':
    case 'compressor':
    case 'hard-limiter':
    case 'distortion':
    case 'reverb':
    case 'pitch-shift':
      throw new Error(`${spec.kind} requires the exact Godot AudioWorklet processor; await buildGodotDspEffectChain().`);
  }
}

/**
 * Binds a script-visible AudioEffect resource to one stable native insertion point. Each successful
 * Godot setter rebuilds the native node chain before the next graph render; input/output identities
 * stay fixed so AudioServer bus ordering and callers never retain a stale resource snapshot.
 */
export function bindGodotAudioEffectResource(context: AudioContext, resource: GodotAudioEffectResource): GodotAudioEffectChain {
  const input = context.createGain();
  const output = context.createGain();
  let active = buildGodotAudioEffectChain(context, resource.spec());
  const attach = (): void => { input.connect(active.input); active.output.connect(output); };
  const detach = (): void => { input.disconnect(); active.output.disconnect(output); active.dispose(); };
  attach();
  const unsubscribe = resource.subscribe(() => {
    if (active.update !== undefined) {
      active.update(resource.spec());
      return;
    }
    const replacement = buildGodotAudioEffectChain(context, resource.spec());
    detach();
    active = replacement;
    attach();
  });
  return {
    input,
    output,
    dispose() { unsubscribe(); detach(); input.disconnect(); output.disconnect(); },
  };
}

/** Builds an immutable authored bus-layout snapshot. Script-visible resources use bindGodotAudioEffectResource. */
export function buildGodotAudioEffectSequence(context: AudioContext, specs: readonly GodotAudioEffectSpec[]): GodotAudioEffectChain {
  if (specs.length === 0) return { ...connectSerial([context.createGain()]), effectInstances: [] };
  const chains = specs.map((spec) => buildGodotAudioEffectChain(context, spec));
  for (let index = 1; index < chains.length; index += 1) chains[index - 1]!.output.connect(chains[index]!.input);
  return {
    input: chains[0]!.input,
    output: chains[chains.length - 1]!.output,
    effectInstances: chains.map((chain) => chain.spectrum ?? null),
    dispose() { for (const chain of chains) chain.dispose(); },
  };
}

export async function buildGodotAudioEffectSequenceAsync(context: AudioContext, specs: readonly GodotAudioEffectSpec[]): Promise<GodotAudioEffectChain> {
  if (specs.length === 0) return { ...connectSerial([context.createGain()]), effectInstances: [] };
  const chains: GodotAudioEffectChain[] = [];
  try {
    for (const spec of specs) chains.push(await buildGodotDspEffectChain(context, spec));
  } catch (error) {
    for (const chain of chains) chain.dispose();
    throw error;
  }
  for (let index = 1; index < chains.length; index += 1) chains[index - 1]!.output.connect(chains[index]!.input);
  return {
    input: chains[0]!.input,
    output: chains[chains.length - 1]!.output,
    effectInstances: chains.map((chain) => chain.spectrum ?? null),
    dispose() { for (const chain of chains) chain.dispose(); },
  };
}

export async function buildGodotAudioBusEffectChains(
  context: AudioContext,
  buses: readonly GodotAudioBusEffectSpec[],
): Promise<GodotAudioBusEffectChains> {
  const chains = new Map<string, GodotAudioEffectChain>();
  const reverbInputs = new Map<string, AudioNode>();
  try {
    for (const bus of buses) {
      if (chains.has(bus.name)) throw new Error(`Duplicate authored audio effect bus ${JSON.stringify(bus.name)}.`);
      const chain = await buildGodotAudioEffectSequenceAsync(context, bus.effects);
      chains.set(bus.name, chain);
      if (bus.effects.some((effect) => effect.kind === 'reverb')) reverbInputs.set(bus.name, chain.input);
    }
  } catch (error) {
    for (const chain of chains.values()) chain.dispose();
    throw error;
  }
  return {
    chains,
    reverbInputs,
    dispose() { for (const chain of chains.values()) chain.dispose(); chains.clear(); reverbInputs.clear(); },
  };
}
