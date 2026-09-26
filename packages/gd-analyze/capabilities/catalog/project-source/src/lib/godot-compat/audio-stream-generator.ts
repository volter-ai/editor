/** Godot 4 AudioStreamGenerator over a stereo SharedArrayBuffer consumed by AudioWorklet. */
import { registerGodotObjectIdentity } from './object';

export type GodotStereoFrame = { readonly x: number; readonly y: number };

export interface GodotAudioStreamGenerator {
  readonly kind: 'AudioStreamGenerator';
  set_mix_rate(hz: number): void;
  get_mix_rate(): number;
  set_mix_rate_mode(mode: number): void;
  get_mix_rate_mode(): number;
  set_buffer_length(seconds: number): void;
  get_buffer_length(): number;
  get_length(): number; get_bpm(): number; get_beat_count(): number; get_bar_beats(): number; has_loop(): boolean;
}

export interface GodotAudioStreamGeneratorPlayback {
  readonly node: AudioWorkletNode | undefined;
  connect(destination: AudioNode): void;
  ready(): Promise<void>;
  push_frame(frame: GodotStereoFrame): boolean;
  can_push_buffer(amount: number): boolean;
  push_buffer(frames: readonly GodotStereoFrame[]): boolean;
  get_frames_available(): number;
  get_skips(): number;
  start(fromPosition?: number): void;
  stop(): void;
  is_playing(): boolean;
  pause(): void;
  resume(): void;
  set_pitch_scale(scale: number): void;
  get_loop_count(): number;
  get_playback_position(): number;
  seek(position: number): void;
  clear_buffer(): void;
  dispose(): void;
}

const PROCESSOR_NAME = 'vgai-godot-audio-stream-generator';
const loadedContexts = new WeakMap<AudioContext, Promise<void>>();
const PROCESSOR_SOURCE = `
class GodotAudioStreamGeneratorProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const state = options.processorOptions.state;
    this.control = state.control ? new Int32Array(state.control) : null;
    this.samples = state.samples ? new Float32Array(state.samples) : null;
    this.capacity = state.capacity;
    this.ratio = state.sourceRate / sampleRate;
    this.baseRatio = this.ratio;
    this.phase = 0;
    this.current = null;
    this.next = null;
    this.active = false;
    this.port.onmessage = (event) => {
      if (typeof event.data.active === 'boolean') { this.active = event.data.active; return; }
      if (typeof event.data.pitchScale === 'number') {
        this.ratio = this.baseRatio * event.data.pitchScale;
        return;
      }
      if (event.data.reset) {
        Atomics.store(this.control, 3, 0);
        this.publishMixed(0);
        this.mixedFrames = 0;
        return;
      }
      if (event.data.clear) {
        this.current = null;
        this.next = null;
        this.phase = 0;
        this.mixedFrames = 0;
      }
    };
  }
  publishMixed(mixed) {
    let version;
    for (;;) {
      version = Atomics.load(this.control, 6);
      if ((version & 1) === 0 && Atomics.compareExchange(this.control, 6, version, version + 1) === version) break;
    }
    Atomics.store(this.control, 4, mixed >>> 0);
    Atomics.store(this.control, 5, Math.floor(mixed / 0x100000000));
    Atomics.store(this.control, 6, version + 2);
  }
  pull() {
    if (Atomics.load(this.control, 2) <= 0) return null;
    const read = Atomics.load(this.control, 0);
    const offset = read * 2;
    const value = [this.samples[offset], this.samples[offset + 1]];
    Atomics.store(this.control, 0, (read + 1) % this.capacity);
    Atomics.sub(this.control, 2, 1);
    return value;
  }
  process(_inputs, outputs) {
    const output = outputs[0];
    const frames = output[0]?.length ?? 0;
    let underflow = false;
    if (!this.active) {
      for (const channel of output) channel.fill(0);
      return true;
    }
    for (let frame = 0; frame < frames; frame += 1) {
      this.current ??= this.pull();
      this.next ??= this.pull();
      this.mixedFrames = (this.mixedFrames ?? 0) + this.ratio;
      if (this.current === null) {
        for (let channel = 0; channel < output.length; channel += 1) output[channel][frame] = 0;
        underflow = true;
        this.phase += this.ratio;
        while (this.phase >= 1) {
          this.phase -= 1;
          this.current = this.next;
          this.next = this.pull();
        }
        continue;
      }
      const following = this.next ?? this.current;
      output[0][frame] = this.current[0] + (following[0] - this.current[0]) * this.phase;
      if (output.length > 1) output[1][frame] = this.current[1] + (following[1] - this.current[1]) * this.phase;
      this.phase += this.ratio;
      while (this.phase >= 1) {
        this.phase -= 1;
        this.current = this.next;
        this.next = this.pull();
        if (this.current === null) { underflow = true; break; }
      }
    }
    if (underflow) {
      Atomics.add(this.control, 3, 1);
    }
    const mixed = Math.floor(this.mixedFrames ?? 0);
    this.publishMixed(mixed);
    return true;
  }
}
registerProcessor('${PROCESSOR_NAME}', GodotAudioStreamGeneratorProcessor);
`;

function numeric(value: number, member: string): number {
  if (typeof value !== 'number') throw new TypeError(`${member} requires a number.`);
  return value;
}

function integer(value: number, member: string): number {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${member} requires an integer.`);
  return value;
}

async function ensureProcessor(context: AudioContext): Promise<void> {
  let loaded = loadedContexts.get(context);
  if (loaded !== undefined) return loaded;
  if (context.audioWorklet === undefined) {
    throw new Error('AudioStreamGenerator requires AudioWorklet; this host exposes no audioWorklet.');
  }
  loaded = (async () => {
    const url = URL.createObjectURL(new Blob([PROCESSOR_SOURCE], { type: 'text/javascript' }));
    try { await context.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
  })();
  loadedContexts.set(context, loaded);
  return loaded;
}

export function createGodotAudioStreamGenerator(): GodotAudioStreamGenerator {
  let mixRate = 44_100;
  let mixRateMode = 2;
  let bufferLength = 0.5;
  const resource: GodotAudioStreamGenerator = {
    kind: 'AudioStreamGenerator',
    set_mix_rate(hz: number): void {
      // Godot's setter assigns directly. The 20..192000 inspector range is an editor hint, not a
      // runtime clamp; playback creation below is the point that must reject an unusable rate.
      mixRate = numeric(hz, 'AudioStreamGenerator.mix_rate');
    },
    get_mix_rate: () => mixRate,
    set_mix_rate_mode(mode: number): void {
      const next = integer(mode, 'AudioStreamGenerator.mix_rate_mode');
      if (next < 0 || next > 2) throw new RangeError('AudioStreamGenerator.mix_rate_mode must be MIX_RATE_OUTPUT, MIX_RATE_INPUT, or MIX_RATE_CUSTOM.');
      mixRateMode = next;
    },
    get_mix_rate_mode: () => mixRateMode,
    set_buffer_length(seconds: number): void {
      // Same source rule as mix_rate: the 0.01..10 range is an editor hint only.
      bufferLength = numeric(seconds, 'AudioStreamGenerator.buffer_length');
    },
    get_buffer_length: () => bufferLength,
    get_length: () => 0, get_bpm: () => 0, get_beat_count: () => 0, get_bar_beats: () => 0, has_loop: () => false,
  };
  registerGodotObjectIdentity(resource, 'AudioStreamGenerator');
  return resource;
}

function frameComponents(frame: GodotStereoFrame): readonly [number, number] {
  if (frame === null || typeof frame !== 'object') {
    throw new TypeError('AudioStreamGeneratorPlayback.push_frame requires a Vector2 frame.');
  }
  // Variant conversion has already produced a Vector2. Godot writes its floats directly,
  // including IEEE non-finite values, so compat must not silently add a finite-value policy.
  const left = numeric(frame.x, 'AudioStreamGeneratorPlayback frame.x');
  const right = numeric(frame.y, 'AudioStreamGeneratorPlayback frame.y');
  return [left, right];
}

function nextPowerOfTwo(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 0x2000_0000) {
    throw new RangeError(`AudioStreamGenerator requested an unsupported ${String(value)}-frame buffer.`);
  }
  return 2 ** Math.ceil(Math.log2(value));
}

export function createGodotAudioStreamGeneratorPlayback(
  context: AudioContext,
  generator: GodotAudioStreamGenerator,
): GodotAudioStreamGeneratorPlayback {
  const rateMode = generator.get_mix_rate_mode();
  if (rateMode === 1) {
    throw new Error('AudioStreamGenerator MIX_RATE_INPUT requires the input device mix rate, which the browser AudioContext does not expose.');
  }
  const requestedRate = rateMode === 2 ? generator.get_mix_rate() : context.sampleRate;
  const requestedFrames = Math.trunc(generator.get_buffer_length() * requestedRate);
  if (!Number.isFinite(requestedRate) || requestedRate <= 0 || !Number.isFinite(requestedFrames) || requestedFrames <= 0) {
    throw new RangeError('AudioStreamGenerator playback requires a positive finite target rate and buffer length.');
  }
  // Godot passes `nearest_shift(rate * seconds)` to RingBuffer::resize, so allocation is the next
  // power of two. RingBuffer reserves one sentinel slot: an 8192 allocation reports 8191 writable.
  const capacity = nextPowerOfTwo(Math.max(1, requestedFrames));
  const writableCapacity = capacity - 1;
  if (typeof SharedArrayBuffer === 'undefined') {
    throw new Error('AudioStreamGeneratorPlayback requires SharedArrayBuffer so get_frames_available and push_buffer stay synchronous with the audio render thread.');
  }
  // read, write, buffered frames, underrun blocks, mixed source frames low/high, seqlock version.
  const controlBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 7);
  const samplesBuffer = new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * capacity * 2);
  const control = new Int32Array(controlBuffer);
  const samples = new Float32Array(samplesBuffer);
  let node: AudioWorkletNode | undefined;
  let disposed = false;
  let active = false;
  let paused = false;
  let pitchScale = 1;
  const destinations = new Set<AudioNode>();
  const post = (message: object): void => { node?.port.postMessage(message); };
  const ready = ensureProcessor(context).then(() => {
    if (disposed) return;
    node = new AudioWorkletNode(context, PROCESSOR_NAME, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { state: { control: controlBuffer, samples: samplesBuffer, capacity, sourceRate: requestedRate } },
    });
    for (const destination of destinations) node.connect(destination);
    post({ pitchScale });
    if (active) { post({ reset: true }); post({ active: !paused }); }
  });
  const available = (): number => {
    if (disposed) return 0;
    return writableCapacity - Atomics.load(control, 2);
  };
  const storeMixedFrames = (mixed: number): void => {
    let version: number;
    for (;;) {
      version = Atomics.load(control, 6);
      if ((version & 1) === 0 && Atomics.compareExchange(control, 6, version, version + 1) === version) break;
    }
    Atomics.store(control, 4, mixed >>> 0);
    Atomics.store(control, 5, Math.floor(mixed / 0x1_0000_0000));
    Atomics.store(control, 6, version + 2);
  };
  const mixedFrames = (): number => {
    // One producer publishes the two words under a seqlock. Readers retry across both ordinary
    // concurrent writes and the low-word rollover instead of combining different generations.
    for (;;) {
      const before = Atomics.load(control, 6) >>> 0;
      if ((before & 1) !== 0) continue;
      const low = Atomics.load(control, 4) >>> 0;
      const high = Atomics.load(control, 5) >>> 0;
      const after = Atomics.load(control, 6) >>> 0;
      if (before === after && (after & 1) === 0) return high * 0x1_0000_0000 + low;
    }
  };
  const playback: GodotAudioStreamGeneratorPlayback = {
    get node() { return node; },
    connect(destination): void {
      destinations.add(destination);
      node?.connect(destination);
    },
    ready: () => ready,
    push_frame(frame): boolean {
      if (available() < 1) return false;
      const [left, right] = frameComponents(frame);
      const write = Atomics.load(control, 1);
      samples[write * 2] = left;
      samples[write * 2 + 1] = right;
      Atomics.store(control, 1, (write + 1) % capacity);
      Atomics.add(control, 2, 1);
      return true;
    },
    can_push_buffer(amount): boolean {
      const count = integer(amount, 'AudioStreamGeneratorPlayback.can_push_buffer');
      return count >= 0 && available() >= count;
    },
    push_buffer(frames): boolean {
      if (!playback.can_push_buffer(frames.length)) return false;
      // Validate the complete Variant array before publishing any frame: Godot's bulk write is
      // all-or-nothing when there is room, never a partially visible prefix.
      const packed = frames.map(frameComponents);
      for (const [left, right] of packed) {
        const write = Atomics.load(control, 1);
        samples[write * 2] = left;
        samples[write * 2 + 1] = right;
        Atomics.store(control, 1, (write + 1) % capacity);
        Atomics.add(control, 2, 1);
      }
      return true;
    },
    get_frames_available: available,
    get_skips: () => Atomics.load(control, 3),
    start(): void {
      if (disposed) return;
      // Godot resets skips and its mixed-time accumulator on every start call, including a
      // restart of an already-active playback. It deliberately leaves queued samples intact.
      active = true;
      paused = false;
      Atomics.store(control, 3, 0);
      storeMixedFrames(0);
      if (context.state === 'suspended') void context.resume();
      post({ reset: true });
      post({ active: true });
    },
    stop(): void {
      if (!active) return;
      active = false;
      paused = false;
      post({ active: false });
    },
    is_playing: () => active,
    pause(): void {
      if (!active || paused) return;
      paused = true;
      post({ active: false });
    },
    resume(): void {
      if (!active || !paused) return;
      paused = false;
      if (context.state === 'suspended') void context.resume();
      post({ active: true });
    },
    set_pitch_scale(scale: number): void {
      if (!Number.isFinite(scale) || scale <= 0) {
        throw new RangeError('AudioStreamGeneratorPlayback pitch scale must be finite and positive.');
      }
      pitchScale = scale;
      post({ pitchScale });
    },
    get_loop_count: () => 0,
    get_playback_position: () => mixedFrames() / requestedRate,
    seek(): void { /* Generator playback is a live feed; Godot's seek is intentionally a no-op. */ },
    clear_buffer(): void {
      if (active) throw new Error('AudioStreamGeneratorPlayback.clear_buffer cannot run while playback is active; stop the playback first.');
      post({ clear: true });
      Atomics.store(control, 0, 0);
      Atomics.store(control, 1, 0);
      Atomics.store(control, 2, 0);
      storeMixedFrames(0);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      active = false;
      node?.port.close();
      node?.disconnect();
      destinations.clear();
    },
  };
  registerGodotObjectIdentity(playback, 'AudioStreamGeneratorPlayback');
  return playback;
}
