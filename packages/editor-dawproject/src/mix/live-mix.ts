/**
 * THE MIX, LIVE: the graph `offline-mix.ts` computes, built from Web Audio nodes for the editor.
 *
 *   synth channel n ─▶ strip head ─▶ [devices] ─▶ fader ─▶ panner ─▶ master sum
 *                                   └▶ pre sends     └▶ post sends ─▶ bus head ─▶ [devices] ─▶ fader ─▶ panner ─▶ master sum
 *   master sum ─▶ [master devices] ─▶ master fader ─▶ master panner ─▶ destination
 *
 * Linear devices are native nodes configured by `dsp.ts`'s specification-exact mapping; the
 * compressor and limiter are `dynamics.worklet.ts`, the same code the export runs; a convolution
 * device is a ConvolverNode with `normalize = false` holding the IR `prepareIr` made. Every level
 * (fader, pan, send, mute, solo) is `offline-mix.ts`'s `stripLevels`, so both mixes silence and
 * weigh the same strips.
 *
 * A build is STAGED: the new graph is made beside the one sounding and swapped in only when it is
 * complete and still wanted, so a build that fails or is superseded leaves the old graph playing
 * and disconnects only its own nodes. A change that is only a level is applied to the sounding
 * graph in place (`apply`): rebuilding would cut the reverb's tail and reset the dynamics.
 */
import { projectModuleUrl } from '@volter/editor-sdk/contributions';
import { readWav } from '../wav';
import type { Piece, PieceTrack } from '@volter/dawproject/piece';
import { prepareIr } from './convolve';
import { AUTOMATION_GRID, automationCurve, laneFor, mixTarget } from './automation';
import { biquadNode, validBands } from './dsp';
import { soloActive, stripLevels } from './offline-mix';
import workletUrl from './dynamics.worklet.ts?worker&url';

export type IrLoader = (path: string) => Promise<AudioBuffer>;

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

/**
 * The part of a piece the graph's SHAPE depends on: when it changes the graph must be rebuilt.
 * Levels (volume, pan, mute, solo, send level) are left out; `LiveMix.apply` sets them in place.
 */
export function mixSignature(piece: Piece): string {
  return JSON.stringify(
    piece.tracks.map((track) => [
      track.id,
      track.name,
      track.channel && [track.channel.role, track.channel.devices, track.channel.sends.map((send) => [send.to, send.pre])],
    ]),
  );
}

/** What feeds the mix: the synth's sixteen individual channel outputs. */
export interface MixSource {
  connectIndividualOutputs(inputs: AudioNode[]): void;
  disconnectIndividualOutputs(inputs: AudioNode[]): void;
}

/** One strip's level nodes, kept so a level change is set in place. */
interface StripNodes {
  readonly fader: GainNode;
  readonly panner: StereoPannerNode;
  /** By index in `channel.sends`; `null` where the send names no bus. */
  readonly sends: readonly (GainNode | null)[];
}

/** A built graph: its nodes, the sixteen channel inputs, each strip's level nodes, and its output. */
interface Graph {
  readonly nodes: AudioNode[];
  readonly heads: AudioNode[];
  readonly strips: Map<string, StripNodes>;
  output: AudioNode | null;
}

/** How quickly an in-place level change settles: a ~10 ms glide, so a fader move does not click. */
const LEVEL_TIME_CONSTANT = 0.01;

export class LiveMix {
  private graph: Graph | null = null;
  private source: MixSource | null = null;
  /** The inputs the source is connected to NOW: exactly these are disconnected, never a guess. */
  private connectedTo: AudioNode[] = [];
  private workletReady: Promise<void> | null = null;
  private readonly irCache = new Map<string, AudioBuffer>();
  /** The automated parameters of the sounding graph, for the piece they were read from. */
  private curves: { piece: Piece; beatAt: (second: number) => number; params: { param: AudioParam; curve: ReturnType<typeof automationCurve> }[] } | null = null;

  constructor(
    private readonly context: BaseAudioContext,
    private readonly loadIr: IrLoader,
  ) {}

  /** The 16 inputs a synth's individual outputs connect to (silent sinks for unused channels). */
  get channelInputs(): AudioNode[] {
    return this.graph?.heads ?? [];
  }

  /** Whether the source is connected to the graph now built (what the engine's state reports). */
  get connected(): boolean {
    return this.connectedTo.length > 0 && this.connectedTo === this.graph?.heads;
  }

  /** Feed the mix from `source`: connected to the graph now, and to each graph swapped in later. */
  attach(source: MixSource): void {
    this.detach();
    this.source = source;
    if (this.graph) this.connectSource(this.graph.heads);
  }

  private connectSource(heads: AudioNode[]): void {
    if (!this.source) return;
    this.source.connectIndividualOutputs(heads);
    this.connectedTo = heads;
  }

  private detach(): void {
    if (this.source && this.connectedTo.length > 0) this.source.disconnectIndividualOutputs(this.connectedTo);
    this.connectedTo = [];
  }

  private async ensureWorklet(): Promise<void> {
    this.workletReady ??= this.context.audioWorklet.addModule(workletUrl);
    try {
      await this.workletReady;
    } catch (error) {
      this.workletReady = null;
      throw error;
    }
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

  /** The device chain of a strip as connected nodes, recorded in `nodes`: returns its [input, output]. */
  private async chain(track: PieceTrack, nodes: AudioNode[]): Promise<[AudioNode, AudioNode]> {
    const input = this.context.createGain();
    nodes.push(input);
    let tail: AudioNode = input;
    for (const device of track.channel?.devices ?? []) {
      const params = device.params as Readonly<Record<string, unknown>>;
      if (device.plugin === 'equalizer') {
        for (const band of validBands(params['bands'])) {
          const node = this.context.createBiquadFilter();
          const config = biquadNode(band);
          node.type = config.type;
          node.frequency.value = config.frequency;
          node.gain.value = config.gain;
          node.Q.value = config.Q;
          nodes.push(node);
          tail.connect(node);
          tail = node;
        }
      } else if (device.plugin === 'compressor' || device.plugin === 'limiter') {
        await this.ensureWorklet();
        const node = new AudioWorkletNode(this.context, 'volter-dynamics', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          processorOptions: { kind: device.plugin, params },
        });
        nodes.push(node);
        tail.connect(node);
        tail = node;
      } else if (device.plugin === 'convolution') {
        const path = typeof params['ir'] === 'string' ? params['ir'] : '';
        const node = this.context.createConvolver();
        nodes.push(node);
        node.normalize = false;
        node.buffer = await this.ir(path, typeof params['predelay'] === 'number' ? params['predelay'] : 0);
        const wet = typeof params['wet'] === 'number' ? params['wet'] : 1;
        if (wet >= 1) {
          tail.connect(node);
          tail = node;
        } else {
          const sum = this.context.createGain();
          const dry = this.context.createGain();
          const wetGain = this.context.createGain();
          nodes.push(sum, dry, wetGain);
          dry.gain.value = 1 - wet;
          wetGain.gain.value = wet;
          tail.connect(dry).connect(sum);
          tail.connect(node).connect(wetGain).connect(sum);
          tail = sum;
        }
      }
    }
    return [input, tail];
  }

  /** A strip's fader and panner after `output`, set to the strip's levels, recorded in `graph`. */
  private strip(graph: Graph, piece: Piece, track: PieceTrack, soloed: boolean, output: AudioNode, sends: (GainNode | null)[] = []): StereoPannerNode {
    const levels = stripLevels(piece, track, soloed);
    const fader = this.context.createGain();
    fader.gain.value = levels.fader;
    const panner = this.context.createStereoPanner();
    panner.pan.value = levels.pan;
    graph.nodes.push(fader, panner);
    output.connect(fader).connect(panner);
    graph.strips.set(track.id, { fader, panner, sends });
    return panner;
  }

  /**
   * Build the graph for this piece; `channelOf` maps soundfont tracks to their MIDI channel. The
   * new graph replaces the sounding one only when complete and `current()` still says it is
   * wanted; otherwise its own nodes are disconnected and it answers `false`. A build that throws
   * also disconnects only its own nodes: the graph that was sounding keeps sounding.
   */
  async build(piece: Piece, channelOf: ReadonlyMap<string, number>, current: () => boolean = () => true): Promise<boolean> {
    const context = this.context;
    const graph: Graph = { nodes: [], heads: [], strips: new Map(), output: null };
    const discard = (): void => {
      for (const node of graph.nodes) node.disconnect();
    };
    try {
      const masterSum = context.createGain();
      graph.nodes.push(masterSum);
      const busHeads = new Map<string, AudioNode>();
      const soloed = soloActive(piece);
      for (let i = 0; i < 16; i++) {
        const sink = context.createGain();
        graph.nodes.push(sink);
        graph.heads.push(sink);
      }
      // Buses first, so sends have somewhere to go.
      for (const track of piece.tracks) {
        if (track.channel?.role !== 'effect') continue;
        const [input, output] = await this.chain(track, graph.nodes);
        this.strip(graph, piece, track, soloed, output).connect(masterSum);
        busHeads.set(track.name, input);
      }
      for (const track of piece.tracks) {
        const channel = channelOf.get(track.id);
        if (channel === undefined || (track.channel?.role ?? 'regular') !== 'regular') continue;
        const levels = stripLevels(piece, track, soloed);
        const [input, output] = await this.chain(track, graph.nodes);
        graph.heads[channel]?.connect(input);
        const sends: (GainNode | null)[] = [];
        const panner = this.strip(graph, piece, track, soloed, output, sends);
        panner.connect(masterSum);
        (track.channel?.sends ?? []).forEach((send, index) => {
          const bus = busHeads.get(send.to);
          if (!bus) {
            sends.push(null);
            return;
          }
          const level = context.createGain();
          level.gain.value = levels.sends[index] ?? 0;
          graph.nodes.push(level);
          (send.pre ? output : panner).connect(level).connect(bus);
          sends.push(level);
        });
      }
      const masterTrack = piece.tracks.find((track) => track.channel?.role === 'master');
      if (masterTrack) {
        const [input, output] = await this.chain(masterTrack, graph.nodes);
        masterSum.connect(input);
        graph.output = this.strip(graph, piece, masterTrack, soloed, output);
      } else {
        graph.output = masterSum;
      }
    } catch (error) {
      discard();
      throw error;
    }
    if (!current()) {
      discard();
      return false;
    }
    // Swap: the source leaves the old graph's inputs (exactly those it was connected to), the old
    // graph is taken down, the new one reaches the destination and the source feeds it.
    this.detach();
    this.takeDown();
    this.curves = null;
    this.graph = graph;
    graph.output?.connect(context.destination);
    this.connectSource(graph.heads);
    return true;
  }

  /**
   * Set every strip's levels from `piece` on the sounding graph, gliding over ~10 ms: what a fader,
   * pan, mute, solo or send-level change needs, without a rebuild. A strip the graph does not have
   * (the shape changed; a rebuild is coming) is left alone.
   */
  apply(piece: Piece): void {
    const graph = this.graph;
    if (!graph) return;
    const now = this.context.currentTime;
    const set = (param: AudioParam, value: number): void => {
      param.cancelScheduledValues(now);
      param.setTargetAtTime(value, now, LEVEL_TIME_CONSTANT);
    };
    const soloed = soloActive(piece);
    for (const track of piece.tracks) {
      const nodes = graph.strips.get(track.id);
      if (!nodes || !track.channel) continue;
      const levels = stripLevels(piece, track, soloed);
      // An automated parameter follows its lane (`automate`); a silenced strip is silenced anyway.
      const automated = (target: string, level: number): boolean => level !== 0 && levels.sounding && laneFor(track, target) !== undefined && mixTarget(target) !== null;
      if (!automated('volume', levels.fader)) set(nodes.fader.gain, levels.fader);
      if (!automated('pan', 1)) set(nodes.panner.pan, levels.pan);
      nodes.sends.forEach((send, index) => {
        const to = track.channel?.sends[index]?.to ?? '';
        if (send && !automated(`send:${to}`, levels.sends[index] ?? 0)) set(send.gain, levels.sends[index] ?? 0);
      });
    }
  }

  /** The automated strip parameters of the sounding graph for `piece`, each with its lane's curve. */
  private automatedParams(piece: Piece, beatAt: (second: number) => number): { param: AudioParam; curve: ReturnType<typeof automationCurve> }[] {
    const graph = this.graph;
    if (!graph) return [];
    if (this.curves?.piece === piece && this.curves.beatAt === beatAt) return this.curves.params;
    const soloed = soloActive(piece);
    const params: { param: AudioParam; curve: ReturnType<typeof automationCurve> }[] = [];
    for (const track of piece.tracks) {
      const nodes = graph.strips.get(track.id);
      if (!nodes || !track.channel || track.lanes.length === 0) continue;
      const levels = stripLevels(piece, track, soloed);
      if (!levels.sounding) continue;
      const add = (param: AudioParam | undefined, target: string): void => {
        const lane = laneFor(track, target);
        const parsed = mixTarget(target);
        if (param && lane && parsed) params.push({ param, curve: automationCurve(lane, parsed, beatAt) });
      };
      add(levels.fader !== 0 ? nodes.fader.gain : undefined, 'volume');
      add(nodes.panner.pan, 'pan');
      track.channel.sends.forEach((send, index) => {
        if ((levels.sends[index] ?? 0) !== 0) add(nodes.sends[index]?.gain, `send:${send.to}`);
      });
    }
    this.curves = { piece, beatAt, params };
    return params;
  }

  /**
   * Schedule the tracks' mixer automation for one pass of playing time (`preview-engine`'s
   * `passes`): each automated parameter set to its value where the pass begins, then a straight
   * line to every grid value in it, exactly the lines the offline mix applies per sample.
   */
  automate(piece: Piece, beatAt: (second: number) => number, pass: { readonly offset: number; readonly from: number; readonly to: number }, at: (second: number) => number): void {
    for (const { param, curve } of this.automatedParams(piece, beatAt)) {
      param.setValueAtTime(curve.at(pass.from), at(pass.offset + pass.from));
      for (let k = Math.floor(pass.from / AUTOMATION_GRID) + 1; k * AUTOMATION_GRID <= pass.to; k++) {
        param.linearRampToValueAtTime(curve.grid(k), at(pass.offset + k * AUTOMATION_GRID));
      }
    }
  }

  /** Drop every scheduled automation value (the transport stopped or starts somewhere else). */
  cancelAutomation(): void {
    for (const { param } of this.curves?.params ?? []) param.cancelScheduledValues(0);
    this.curves = null;
  }

  private takeDown(): void {
    for (const node of this.graph?.nodes ?? []) node.disconnect();
    this.graph = null;
  }

  /** Disconnect the source and every node of the sounding graph. */
  dispose(): void {
    this.detach();
    this.takeDown();
    this.source = null;
  }
}
