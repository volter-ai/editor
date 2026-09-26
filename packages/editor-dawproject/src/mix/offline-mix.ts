/**
 * THE MIX, OFFLINE: each track's own synth channel (SpessaSynth `processSplit`, built-in reverb
 * and chorus off) through its channel strip — devices in order, pre-fader sends, fader, pan,
 * post-fader sends — then every `effect` channel (a bus: its devices, usually a convolution
 * reverb, on the sum of what is sent to it), then the `master` channel's devices on the total.
 *
 * The editor builds the same graph from Web Audio nodes (`live-mix.ts`): linear stages as native
 * nodes on the specification's formulas, compressor and limiter as this package's own DSP in a
 * worklet. What a person hears while editing is what the export renders.
 */
import type { Piece, PieceTrack } from '@volter/dawproject/piece';
import { convolve, prepareIr } from './convolve';
import { automationCurve, laneFor, mixTarget } from './automation';
import { Biquad, Compressor, compressorParams, dbToGain, gain, gainEach, Limiter, pan, panEach, type Stereo, validBands } from './dsp';

export interface ImpulseResponse {
  readonly channels: readonly Float32Array[];
  readonly sampleRate: number;
}

export interface MixInputs {
  /** Each synth channel's dry stereo signal, by MIDI channel. */
  readonly channels: readonly Stereo[];
  /** Each soundfont track's MIDI channel. */
  readonly channelOf: ReadonlyMap<string, number>;
  readonly sampleRate: number;
  /** Impulse responses by project path, loaded by the caller. */
  readonly irs: ReadonlyMap<string, ImpulseResponse>;
  /** Render only these tracks (their buses still sound); all when absent. */
  readonly only?: ReadonlySet<string>;
  /** Told what each compressor and limiter did: its most gain reduction, and a compressor's loudest input. */
  readonly dynamics?: (report: DynamicsReport) => void;
  /**
   * Where each sample falls in the piece, for the tracks' mixer automation: sample `i` is at
   * piece-second `startSecond + (i / sampleRate) mod loopSeconds`, and `beatAt` maps a second to
   * the beat a lane is written in. Without it the static levels apply throughout.
   */
  readonly timeline?: { readonly startSecond: number; readonly loopSeconds: number; readonly beatAt: (second: number) => number };
}

export interface DynamicsReport {
  readonly track: string;
  readonly device: 'compressor' | 'limiter';
  readonly maxReductionDb: number;
  /** The loudest peak the compressor heard, dBFS (a limiter's is its ceiling's business). */
  readonly maxInputDb?: number;
  readonly threshold?: number;
}

function copy(signal: Stereo): Stereo {
  return [signal[0].slice(), signal[1].slice()];
}

function addInto(target: Stereo, source: Stereo, factor = 1): void {
  for (let ch = 0; ch < 2; ch++) {
    const t = target[ch]!;
    const s = source[ch]!;
    for (let i = 0; i < t.length; i++) t[i] = t[i]! + s[i]! * factor;
  }
}

/** The devices of a strip that process audio, in order. Instruments and MIDI devices are skipped. */
function runDevices(track: PieceTrack, signal: Stereo, inputs: MixInputs): Stereo {
  let current = signal;
  for (const device of track.channel?.devices ?? []) {
    const params = device.params as Readonly<Record<string, unknown>>;
    if (device.plugin === 'equalizer') {
      for (const band of validBands(params['bands'])) new Biquad(band, inputs.sampleRate).process(current);
    } else if (device.plugin === 'compressor') {
      const settings = compressorParams(params);
      const compressor = new Compressor(settings, inputs.sampleRate);
      compressor.process(current);
      inputs.dynamics?.({ track: track.name, device: 'compressor', maxReductionDb: compressor.maxReductionDb, maxInputDb: compressor.maxInputDb, threshold: settings.threshold });
    } else if (device.plugin === 'limiter') {
      const limiter = new Limiter(params, inputs.sampleRate);
      limiter.process(current);
      inputs.dynamics?.({ track: track.name, device: 'limiter', maxReductionDb: limiter.maxReductionDb });
    } else if (device.plugin === 'convolution') {
      const path = typeof params['ir'] === 'string' ? params['ir'] : '';
      const ir = inputs.irs.get(path);
      if (!ir) throw new Error(`${track.name}: the impulse response ${path || '(none named)'} was not loaded.`);
      const prepared = prepareIr(ir.channels, ir.sampleRate, inputs.sampleRate, typeof params['predelay'] === 'number' ? params['predelay'] : 0);
      const wet = typeof params['wet'] === 'number' ? params['wet'] : 1;
      const reverb = convolve(current, prepared);
      if (wet >= 1) current = reverb;
      else {
        gain(current, 1 - wet);
        addInto(current, reverb, wet);
      }
    }
  }
  return current;
}

/**
 * Whether any instrument strip is soloed. Only a `regular` channel's solo counts: a bus or the
 * master has nothing to be soloed against, so a `solo` written there is ignored by both mixes.
 */
export function soloActive(piece: Piece): boolean {
  return piece.tracks.some((track) => (track.channel?.role ?? 'regular') === 'regular' && track.channel?.solo === true);
}

/**
 * THE LEVELS OF A STRIP, the one statement of what mute, solo, volume, pan and send level mean,
 * read by this mix and by the editor's graph (`live-mix.ts`) alike: whether it sounds, the fader's
 * linear gain (0 when it does not), its pan, and each send's linear gain in `channel.sends` order. An
 * instrument strip is silenced by its mute or by another strip's solo, and its sends with it; a bus
 * and the master are silenced by their own mute.
 */
export function stripLevels(piece: Piece, track: PieceTrack, soloed = soloActive(piece)): { sounding: boolean; fader: number; pan: number; sends: number[] } {
  const channel = track.channel;
  if (!channel) return { sounding: false, fader: 0, pan: 0, sends: [] };
  const sounding = channel.role === 'regular' ? !channel.mute && (!soloed || channel.solo) : !channel.mute;
  return {
    sounding,
    fader: sounding ? dbToGain(channel.volume) : 0,
    pan: channel.pan,
    sends: channel.sends.map((send) => (sounding ? dbToGain(send.level) : 0)),
  };
}

export function mix(piece: Piece, inputs: MixInputs): Stereo {
  const length = inputs.channels[0]?.[0].length ?? 0;
  const silence = (): Stereo => [new Float32Array(length), new Float32Array(length)];
  // A strip parameter a track automates, per sample (`automation.ts`); null where it is static.
  const envelope = (track: PieceTrack, target: string): Float32Array | null => {
    const timeline = inputs.timeline;
    const lane = timeline ? laneFor(track, target) : undefined;
    const parsed = mixTarget(target);
    if (!timeline || !lane || !parsed) return null;
    const curve = automationCurve(lane, parsed, timeline.beatAt);
    const out = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      const offset = i / inputs.sampleRate;
      out[i] = curve.at(timeline.startSecond + (timeline.loopSeconds > 0 ? offset % timeline.loopSeconds : offset));
    }
    return out;
  };
  const fader = (track: PieceTrack, signal: Stereo, level: number): void => {
    const automated = envelope(track, 'volume');
    if (automated) gainEach(signal, automated);
    else gain(signal, level);
  };
  const panStage = (track: PieceTrack, signal: Stereo, position: number): void => {
    const automated = envelope(track, 'pan');
    if (automated) panEach(signal, automated);
    else pan(signal, position);
  };
  const master = silence();
  const busInput = new Map<string, Stereo>();
  const soloed = soloActive(piece);
  const sendTo = (track: PieceTrack, levels: readonly number[], signal: Stereo, pre: boolean): void => {
    (track.channel?.sends ?? []).forEach((send, index) => {
      if (send.pre !== pre) return;
      const bus = busInput.get(send.to) ?? silence();
      busInput.set(send.to, bus);
      const automated = (levels[index] ?? 0) === 0 ? null : envelope(track, `send:${send.to}`);
      if (automated) {
        for (let ch = 0; ch < 2; ch++) {
          const t = bus[ch]!;
          const s = signal[ch]!;
          for (let i = 0; i < t.length; i++) t[i] = t[i]! + s[i]! * automated[i]!;
        }
      } else addInto(bus, signal, levels[index] ?? 0);
    });
  };
  // Instrument tracks.
  for (const track of piece.tracks) {
    const channel = inputs.channelOf.get(track.id);
    if (channel === undefined || (track.channel?.role ?? 'regular') !== 'regular') continue;
    const levels = stripLevels(piece, track, soloed);
    if (!levels.sounding) continue;
    if (inputs.only && !inputs.only.has(track.id)) continue;
    const source = inputs.channels[channel];
    if (!source) continue;
    const signal = runDevices(track, copy(source), inputs);
    sendTo(track, levels.sends, signal, true);
    fader(track, signal, levels.fader);
    panStage(track, signal, levels.pan);
    sendTo(track, levels.sends, signal, false);
    addInto(master, signal);
  }
  // Effect buses: what was sent to them, through their own strips.
  for (const track of piece.tracks) {
    if (track.channel?.role !== 'effect') continue;
    const levels = stripLevels(piece, track, soloed);
    if (!levels.sounding) continue;
    const input = busInput.get(track.name);
    if (!input) continue;
    const signal = runDevices(track, input, inputs);
    fader(track, signal, levels.fader);
    panStage(track, signal, levels.pan);
    addInto(master, signal);
  }
  // The master strip: its devices, fader (silent when muted) and pan.
  const masterTrack = piece.tracks.find((track) => track.channel?.role === 'master');
  if (!masterTrack) return master;
  const levels = stripLevels(piece, masterTrack, soloed);
  if (!levels.sounding) return silence();
  const out = runDevices(masterTrack, master, inputs);
  fader(masterTrack, out, levels.fader);
  panStage(masterTrack, out, levels.pan);
  return out;
}
