/**
 * The editor's dynamics processor: this package's own compressor and limiter (`dsp.ts`) running
 * in an AudioWorklet, so the nonlinear stages the editor plays are the same code the export runs.
 * `processorOptions`: `{ kind: 'compressor' | 'limiter', params }`.
 */
import { Compressor, compressorParams, Limiter } from './dsp';

declare const sampleRate: number;
declare function registerProcessor(name: string, processor: unknown): void;
declare class AudioWorkletProcessor {
  constructor(options?: unknown);
}

class DynamicsProcessor extends AudioWorkletProcessor {
  private readonly stage: Compressor | Limiter;
  constructor(options: { processorOptions: { kind: 'compressor' | 'limiter'; params: Record<string, unknown> } }) {
    super(options);
    const { kind, params } = options.processorOptions;
    this.stage = kind === 'compressor' ? new Compressor(compressorParams(params), sampleRate) : new Limiter(params, sampleRate);
  }
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length < 2) return true;
    const left = output[0]!;
    const right = output[1]!;
    left.set(input?.[0] ?? new Float32Array(left.length));
    right.set(input?.[1] ?? input?.[0] ?? new Float32Array(right.length));
    this.stage.process([left, right]);
    return true;
  }
}

registerProcessor('volter-dynamics', DynamicsProcessor);
