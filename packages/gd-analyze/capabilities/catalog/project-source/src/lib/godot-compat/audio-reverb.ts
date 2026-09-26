/**
 * Godot 3.6's `AudioEffectReverb`, carried sample-for-sample as an AudioWorklet.
 *
 * This directly ports Godot's MIT-licensed `reverb_filter.cpp` and
 * `audio_effect_reverb.cpp`: eight parallel Freeverb combs, four serial all-passes, the same
 * 500 ms predelay buffer, high-pass, stereo spread, and wet/dry constants. A ConvolverNode is not
 * used because an invented impulse response would not be the authored Godot effect.
 */

export interface GodotReverbSpec {
  readonly name: string;
  readonly predelayMs?: number;
  readonly predelayFeedback?: number;
  readonly roomSize?: number;
  readonly damping?: number;
  readonly spread?: number;
  readonly highpass?: number;
  readonly dry?: number;
  readonly wet?: number;
}

export interface GodotReverbBus {
  readonly name: string;
  readonly input: AudioNode;
  disconnect(): void;
}

export interface GodotReverbChain {
  readonly input: AudioNode;
  readonly output: AudioNode;
  update(spec: Omit<GodotReverbSpec, 'name'>): void;
  disconnect(): void;
}

const PROCESSOR_NAME = 'vgai-godot-3-6-reverb';
const loadedContexts = new WeakMap<AudioContext, Promise<void>>();

// AudioWorkletGlobalScope is not the page global, so the processor is installed as source. The
// math follows Godot 3.6 in statement order; Float32Array preserves its float sample buffers.
const PROCESSOR_SOURCE = String.raw`
const COMB_TUNINGS = [
  0.025306122448979593, 0.026938775510204082, 0.028956916099773241,
  0.03074829931972789, 0.032244897959183672, 0.03380952380952381,
  0.035306122448979592, 0.036666666666666667,
];
const ALLPASS_TUNINGS = [0.0051020408163265302, 0.007732426303854875, 0.01, 0.012607709750566893];
const DENORMAL_LIMIT = 2 ** -111;
const undenormalise = (value) => Math.abs(value) < DENORMAL_LIMIT ? 0 : value;

class Reverb {
  constructor(rate, extraSpreadBase) {
    this.rate = rate;
    this.echo = new Float32Array(Math.trunc(0.5 * rate + 1));
    this.echoPos = 0;
    this.hpfH1 = 0;
    this.hpfH2 = 0;
    const extra = Math.round(extraSpreadBase * rate);
    this.combs = COMB_TUNINGS.map((seconds) => ({
      buffer: new Float32Array(Math.max(5, Math.round(seconds * rate) + extra)),
      pos: 0, extra, dampH: 0,
    }));
    this.allpasses = ALLPASS_TUNINGS.map((seconds) => ({
      buffer: new Float32Array(Math.max(5, Math.round(seconds * rate) + extra)),
      pos: 0, extra,
    }));
  }

  process(source, destination, p) {
    const input = new Float32Array(source.length);
    let predelayFrames = Math.round((p.predelayMs / 1000) * this.rate);
    predelayFrames = Math.max(10, Math.min(this.echo.length - 1, predelayFrames));
    const predelayFeedback = Math.max(0, Math.min(0.98, p.predelayFeedback));
    for (let i = 0; i < source.length; i += 1) {
      if (this.echoPos >= this.echo.length) this.echoPos = 0;
      let readPos = this.echoPos - predelayFrames;
      while (readPos < 0) readPos += this.echo.length;
      const value = undenormalise(this.echo[readPos] * predelayFeedback + source[i]);
      this.echo[this.echoPos] = value;
      input[i] = value;
      destination[i] = 0;
      this.echoPos += 1;
    }

    const highpass = Math.max(0, Math.min(1, p.highpass));
    if (highpass > 0) {
      const aux = Math.exp((-2 * Math.PI * highpass * 6000) / this.rate);
      const a1 = (1 + aux) / 2;
      const a2 = -(1 + aux) / 2;
      for (let i = 0; i < input.length; i += 1) {
        const value = input[i];
        input[i] = value * a1 + this.hpfH1 * a2 + this.hpfH2 * aux;
        this.hpfH2 = input[i];
        this.hpfH1 = value;
      }
    }

    const feedback = Math.max(0.7, Math.min(0.98, 0.7 + p.roomSize * 0.28));
    const dampBase = p.damping / 2 + 0.5;
    const damp = Math.exp((-2 * Math.PI * dampBase * dampBase * 10000) / this.rate);
    for (const comb of this.combs) {
      const limit = comb.buffer.length - Math.round(comb.extra * (1 - p.spread));
      for (let i = 0; i < input.length; i += 1) {
        if (comb.pos >= limit) comb.pos = 0;
        let out = undenormalise(comb.buffer[comb.pos] * feedback);
        out = out * (1 - damp) + comb.dampH * damp;
        comb.dampH = out;
        comb.buffer[comb.pos] = input[i] + out;
        destination[i] += out;
        comb.pos += 1;
      }
    }

    for (const allpass of this.allpasses) {
      const limit = allpass.buffer.length - Math.round(allpass.extra * (1 - p.spread));
      for (let i = 0; i < destination.length; i += 1) {
        if (allpass.pos >= limit) allpass.pos = 0;
        const aux = allpass.buffer[allpass.pos];
        allpass.buffer[allpass.pos] = undenormalise(0.7 * aux + destination[i]);
        destination[i] = aux - 0.7 * allpass.buffer[allpass.pos];
        allpass.pos += 1;
      }
    }

    for (let i = 0; i < destination.length; i += 1) {
      destination[i] = destination[i] * p.wet * 0.6 + source[i] * p.dry;
    }
  }
}

class GodotReverbProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.parameters = options.processorOptions;
    this.channels = [new Reverb(sampleRate, 0), new Reverb(sampleRate, 0.000521)];
    this.port.onmessage = (event) => { this.parameters = event.data; };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    for (let channel = 0; channel < output.length; channel += 1) {
      const source = input[Math.min(channel, input.length - 1)];
      if (source === undefined) output[channel].fill(0);
      else this.channels[Math.min(channel, 1)].process(source, output[channel], this.parameters);
    }
    return true;
  }
}

registerProcessor('${PROCESSOR_NAME}', GodotReverbProcessor);
`;

async function ensureProcessor(context: AudioContext): Promise<void> {
  let loaded = loadedContexts.get(context);
  if (loaded !== undefined) return loaded;
  if (context.audioWorklet === undefined) {
    throw new Error(
      'Godot AudioEffectReverb requires AudioWorklet; this browser exposes no audioWorklet.',
    );
  }
  loaded = (async () => {
    const url = URL.createObjectURL(new Blob([PROCESSOR_SOURCE], { type: 'text/javascript' }));
    try {
      await context.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  })();
  loadedContexts.set(context, loaded);
  return loaded;
}

/** One exact standalone Reverb effect for insertion at its authored index in a bus chain. */
export async function createGodotReverbChain(
  context: AudioContext,
  spec: Omit<GodotReverbSpec, 'name'>,
): Promise<GodotReverbChain> {
  await ensureProcessor(context);
  const node = new AudioWorkletNode(context, PROCESSOR_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
    processorOptions: {
      predelayMs: spec.predelayMs ?? 150,
      predelayFeedback: spec.predelayFeedback ?? 0.4,
      roomSize: spec.roomSize ?? 0.8,
      damping: spec.damping ?? 0.5,
      spread: spec.spread ?? 1,
      highpass: spec.highpass ?? 0,
      dry: spec.dry ?? 1,
      wet: spec.wet ?? 0.5,
    },
  });
  return {
    input: node,
    output: node,
    update: (next) => node.port.postMessage(next),
    disconnect: () => { node.port.close(); node.disconnect(); },
  };
}

/** Build the authored buses. Each bus owns one exact stereo reverb worklet. */
export async function createGodotReverbBuses(
  context: AudioContext,
  destination: AudioNode | ((name: string) => AudioNode | null),
  specs: readonly GodotReverbSpec[],
): Promise<ReadonlyMap<string, GodotReverbBus>> {
  if (specs.length === 0) return new Map();
  await ensureProcessor(context);
  const buses = new Map<string, GodotReverbBus>();
  for (const spec of specs) {
    const chain = await createGodotReverbChain(context, spec);
    const input = chain.input;
    const target = typeof destination === 'function' ? destination(spec.name) : destination;
    if (target !== null) input.connect(target);
    buses.set(spec.name, {
      name: spec.name,
      input,
      disconnect: () => chain.disconnect(),
    });
  }
  return buses;
}
