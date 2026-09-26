/**
 * THE MIX, LIVE: the graph `offline-mix.ts` computes, built from Web Audio nodes for the editor.
 *
 *   synth channel n ─▶ strip head ─▶ [devices] ─▶ fader ─▶ panner ─▶ master sum
 *                                   └▶ pre sends     └▶ post sends ─▶ bus head ─▶ [devices] ─▶ fader ─▶ panner ─▶ master sum
 *   master sum ─▶ [master devices] ─▶ master fader ─▶ destination
 *
 * Linear devices are native nodes configured by `dsp.ts`'s specification-exact mapping; the
 * compressor and limiter are `dynamics.worklet.ts`, the same code the export runs; a convolution
 * device is a ConvolverNode with `normalize = false` holding the IR `prepareIr` made.
 */
import { projectModuleUrl } from '@volter/editor-sdk/contributions';
import { readWav } from '../wav';
import type { Piece, PieceTrack } from '@volter/dawproject/piece';
import { prepareIr } from './convolve';
import { type Band, biquadNode, dbToGain } from './dsp';
import workletUrl from './dynamics.worklet.ts?worker&url';

export type IrLoader = (path: string) => Promise<AudioBuffer>;

/** The part of a piece the mix graph depends on; the graph is rebuilt only when it changes. */
/**
 * The preview's IR loader: the project file fetched from its served address and read as the
 * export reads it (`readWav`), at the file's own rate, so `prepareIr` resamples it on both sides.
 * Decoded by the browser instead, the IR arrived resampled by a different filter and the reverb
 * bus nulled against the export at only −37 dB; read this way it nulls at −141 dB, like every
 * other stage of the mix.
 */
export function servedIrLoader(context: BaseAudioContext): IrLoader {
  return async (path) => {
    const url = projectModuleUrl(path);
    if (!url) throw new Error(`No served address for ${path}.`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${path}: ${response.status} ${response.statusText}`);
    const wav = readWav(new Uint8Array(await response.arrayBuffer()));
    const buffer = context.createBuffer(wav.channels.length, wav.channels[0]?.length ?? 1, wav.sampleRate);
    wav.channels.forEach((channel, index) => buffer.copyToChannel(new Float32Array(channel), index));
    return buffer;
  };
}

export function mixSignature(piece: Piece): string {
  return JSON.stringify(piece.tracks.map((track) => [track.id, track.name, track.channel]));
}

export class LiveMix {
  private nodes: AudioNode[] = [];
  /** The node each synth channel's output feeds (index = MIDI channel). */
  private heads: AudioNode[] = [];
  private workletReady: Promise<void> | null = null;
  private readonly irCache = new Map<string, AudioBuffer>();

  constructor(
    private readonly context: AudioContext,
    private readonly loadIr: IrLoader,
  ) {}

  /** The 16 inputs a synth's individual outputs connect to (silent sinks for unused channels). */
  get channelInputs(): AudioNode[] {
    return this.heads;
  }

  private async ensureWorklet(): Promise<void> {
    this.workletReady ??= this.context.audioWorklet.addModule(workletUrl);
    await this.workletReady;
  }

  private async ir(path: string, predelay: number): Promise<AudioBuffer> {
    const key = `${path}@${predelay}`;
    const cached = this.irCache.get(key);
    if (cached) return cached;
    const decoded = await this.loadIr(path);
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
    const [left, right] = prepareIr(channels, decoded.sampleRate, this.context.sampleRate, predelay);
    const buffer = this.context.createBuffer(2, left.length, this.context.sampleRate);
    buffer.copyToChannel(new Float32Array(left), 0);
    buffer.copyToChannel(new Float32Array(right), 1);
    this.irCache.set(key, buffer);
    return buffer;
  }

  /** The device chain of a strip as connected nodes: returns its [input, output]. */
  private async chain(track: PieceTrack): Promise<[AudioNode, AudioNode]> {
    const input = this.context.createGain();
    this.nodes.push(input);
    let tail: AudioNode = input;
    for (const device of track.channel?.devices ?? []) {
      const params = device.params as Readonly<Record<string, unknown>>;
      if (device.plugin === 'equalizer') {
        for (const band of (Array.isArray(params['bands']) ? params['bands'] : []) as Band[]) {
          const node = this.context.createBiquadFilter();
          const config = biquadNode(band);
          node.type = config.type;
          node.frequency.value = config.frequency;
          node.gain.value = config.gain;
          node.Q.value = config.Q;
          tail.connect(node);
          tail = node;
          this.nodes.push(node);
        }
      } else if (device.plugin === 'compressor' || device.plugin === 'limiter') {
        await this.ensureWorklet();
        const node = new AudioWorkletNode(this.context, 'volter-dynamics', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          processorOptions: { kind: device.plugin, params },
        });
        tail.connect(node);
        tail = node;
        this.nodes.push(node);
      } else if (device.plugin === 'convolution') {
        const path = typeof params['ir'] === 'string' ? params['ir'] : '';
        const node = this.context.createConvolver();
        node.normalize = false;
        node.buffer = await this.ir(path, typeof params['predelay'] === 'number' ? params['predelay'] : 0);
        const wet = typeof params['wet'] === 'number' ? params['wet'] : 1;
        if (wet >= 1) {
          tail.connect(node);
          tail = node;
          this.nodes.push(node);
        } else {
          const sum = this.context.createGain();
          const dry = this.context.createGain();
          const wetGain = this.context.createGain();
          dry.gain.value = 1 - wet;
          wetGain.gain.value = wet;
          tail.connect(dry).connect(sum);
          tail.connect(node).connect(wetGain).connect(sum);
          tail = sum;
          this.nodes.push(node, sum, dry, wetGain);
        }
      }
    }
    return [input, tail];
  }

  /** Build the graph for this piece; `channelOf` maps soundfont tracks to their MIDI channel. */
  async build(piece: Piece, channelOf: ReadonlyMap<string, number>): Promise<void> {
    this.dispose();
    const context = this.context;
    const masterSum = context.createGain();
    this.nodes.push(masterSum);
    const busHeads = new Map<string, AudioNode>();
    const soloed = piece.tracks.some((track) => track.channel?.solo);
    this.heads = Array.from({ length: 16 }, () => {
      const sink = context.createGain();
      this.nodes.push(sink);
      return sink;
    });
    // Buses first, so sends have somewhere to go.
    for (const track of piece.tracks) {
      if (track.channel?.role !== 'effect') continue;
      const [input, output] = await this.chain(track);
      const fader = context.createGain();
      fader.gain.value = track.channel.mute ? 0 : dbToGain(track.channel.volume);
      const panner = context.createStereoPanner();
      panner.pan.value = track.channel.pan;
      output.connect(fader).connect(panner).connect(masterSum);
      this.nodes.push(fader, panner);
      busHeads.set(track.name, input);
    }
    for (const track of piece.tracks) {
      const channel = channelOf.get(track.id);
      if (channel === undefined || (track.channel?.role ?? 'regular') !== 'regular') continue;
      const audible = !track.channel?.mute && (!soloed || track.channel?.solo === true);
      const [input, output] = await this.chain(track);
      this.heads[channel]?.connect(input);
      const fader = context.createGain();
      fader.gain.value = audible ? dbToGain(track.channel?.volume ?? 0) : 0;
      const panner = context.createStereoPanner();
      panner.pan.value = track.channel?.pan ?? 0;
      output.connect(fader).connect(panner).connect(masterSum);
      this.nodes.push(fader, panner);
      for (const send of track.channel?.sends ?? []) {
        const bus = busHeads.get(send.to);
        if (!bus) continue;
        const level = context.createGain();
        level.gain.value = audible ? dbToGain(send.level) : 0;
        (send.pre ? output : panner).connect(level).connect(bus);
        this.nodes.push(level);
      }
    }
    const masterTrack = piece.tracks.find((track) => track.channel?.role === 'master');
    if (masterTrack) {
      const [input, output] = await this.chain(masterTrack);
      const fader = context.createGain();
      fader.gain.value = dbToGain(masterTrack.channel?.volume ?? 0);
      masterSum.connect(input);
      output.connect(fader).connect(context.destination);
      this.nodes.push(fader);
    } else {
      masterSum.connect(context.destination);
    }
  }

  dispose(): void {
    for (const node of this.nodes) node.disconnect();
    this.nodes = [];
    this.heads = [];
  }
}
