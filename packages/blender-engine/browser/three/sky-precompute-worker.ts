/**
 * The sky precompute, in a Worker.
 *
 * `precomputeSkyTexture` is 512x256 texels at 64 in-scattering steps each and
 * MEASURED 15.4 seconds. On the page's thread that is not "slow", it is a FROZEN
 * EDITOR -- the owner saw exactly that, and a spinner could not have helped
 * because a blocked main thread cannot paint one.
 *
 * This module is the whole worker: parameters in, one Float32Array out,
 * TRANSFERRED rather than copied. It names no DOM and no renderer, which is what
 * lets it be a worker at all; `blender-sky.ts` keeps the arithmetic.
 *
 * WHAT MAKES THIS DIFFERENT FROM THE ATTEMPT THAT WAS REVERTED (#6609): nothing
 * here hands out a half-built texture. The worker answers with NUMBERS, the
 * caller primes `blender-sky`'s texture cache with them, and only then does
 * anything build a texture -- and `pendingWorld`/`worldReady()` hold the capture
 * until it has. See `sky-worker.ts` and `WorldBackground.apply`.
 */
import { precomputeSkyTexture, type SkyParameters } from './blender-sky';

export interface SkyWorkerRequest {
  id: number;
  parameters: SkyParameters;
}

export interface SkyWorkerResponse {
  id: number;
  pixels?: Float32Array;
  error?: string;
}

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SkyWorkerRequest>) => void) | null;
  postMessage: (message: SkyWorkerResponse, transfer?: Transferable[]) => void;
};

scope.onmessage = (event) => {
  const { id, parameters } = event.data;
  try {
    const pixels = precomputeSkyTexture(parameters);
    scope.postMessage({ id, pixels }, [pixels.buffer]);
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
