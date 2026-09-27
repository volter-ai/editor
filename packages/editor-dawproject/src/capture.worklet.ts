/**
 * The input a take records: every block of the connected input posted to the page as it
 * arrives, with the context time of its first frame, so the take is placed where it was played.
 */

declare const currentTime: number;
declare function registerProcessor(name: string, processor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
}

class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    if (input && input.length > 0) {
      const left = input[0]!.slice();
      const right = (input[1] ?? input[0]!).slice();
      this.port.postMessage({ time: currentTime, left, right }, [left.buffer, right.buffer]);
    }
    return true;
  }
}

registerProcessor('volter-capture', CaptureProcessor);
