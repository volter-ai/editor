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
import { type Band, Biquad, Compressor, compressorParams, dbToGain, gain, Limiter, pan, type Stereo } from './dsp';

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
      for (const band of (Array.isArray(params['bands']) ? params['bands'] : []) as Band[]) new Biquad(band, inputs.sampleRate).process(current);
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

export function mix(piece: Piece, inputs: MixInputs): Stereo {
  const length = inputs.channels[0]?.[0].length ?? 0;
  const silence = (): Stereo => [new Float32Array(length), new Float32Array(length)];
  const master = silence();
  const busInput = new Map<string, Stereo>();
  const soloed = piece.tracks.some((track) => track.channel?.solo);
  const sendTo = (track: PieceTrack, signal: Stereo, pre: boolean): void => {
    for (const send of track.channel?.sends ?? []) {
      if (send.pre !== pre) continue;
      const bus = busInput.get(send.to) ?? silence();
      busInput.set(send.to, bus);
      addInto(bus, signal, dbToGain(send.level));
    }
  };
  // Instrument tracks.
  for (const track of piece.tracks) {
    const channel = inputs.channelOf.get(track.id);
    if (channel === undefined || (track.channel?.role ?? 'regular') !== 'regular') continue;
    if (track.channel?.mute || (soloed && !track.channel?.solo)) continue;
    if (inputs.only && !inputs.only.has(track.id)) continue;
    const source = inputs.channels[channel];
    if (!source) continue;
    const signal = runDevices(track, copy(source), inputs);
    sendTo(track, signal, true);
    gain(signal, dbToGain(track.channel?.volume ?? 0));
    pan(signal, track.channel?.pan ?? 0);
    sendTo(track, signal, false);
    addInto(master, signal);
  }
  // Effect buses: what was sent to them, through their own strips.
  for (const track of piece.tracks) {
    if (track.channel?.role !== 'effect' || track.channel.mute) continue;
    const input = busInput.get(track.name);
    if (!input) continue;
    const signal = runDevices(track, input, inputs);
    gain(signal, dbToGain(track.channel.volume));
    pan(signal, track.channel.pan);
    addInto(master, signal);
  }
  // The master strip.
  const masterTrack = piece.tracks.find((track) => track.channel?.role === 'master');
  if (!masterTrack) return master;
  const out = runDevices(masterTrack, master, inputs);
  gain(out, dbToGain(masterTrack.channel?.volume ?? 0));
  return out;
}
