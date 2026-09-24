/**
 * Shared gltf-transform IO for the Asset Budget window (W4a).
 *
 * One lazily-created `WebIO` with ALL registered extensions plus whatever
 * codec dependencies are actually loadable in this environment. Codec
 * availability is PROBED, never assumed (anti-shim): a codec that fails to
 * import/initialize is recorded with its reason, and callers surface that
 * reason instead of fabricating success. `WebIO.readBinary`/`writeBinary`
 * operate on in-memory GLB bytes, so the same module serves both the browser
 * editor (bytes via the storage seam) and headless vitest (bytes from
 * generated fixtures) — no NodeIO/fs dependency.
 */

import { WebIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import dracoDecoderWasmUrl from 'draco3d/draco_decoder.wasm?url';
import dracoEncoderWasmUrl from 'draco3d/draco_encoder.wasm?url';
import { BASIS_ENCODER_PATH } from './basis-encoder';

export interface GltfCodecAvailability {
  readonly available: boolean;
  /** Human-readable reason when unavailable — shown verbatim in the UI. */
  readonly reason?: string;
}

export interface GltfIOCapabilities {
  readonly meshoptDecoder: GltfCodecAvailability;
  readonly meshoptEncoder: GltfCodecAvailability;
  readonly meshoptSimplifier: GltfCodecAvailability;
  readonly dracoDecoder: GltfCodecAvailability;
  readonly dracoEncoder: GltfCodecAvailability;
  /** KTX2/Basis ENCODING: Binomial's vendored encoder wasm, served from
   *  `BASIS_ENCODER_PATH`. Probed by asking the server for it, because the
   *  question the UI needs answered is whether THIS deployment serves it. */
  readonly ktx2Encoder: GltfCodecAvailability;
}

export interface GltfIOBundle {
  readonly io: WebIO;
  readonly capabilities: GltfIOCapabilities;
}

let _bundle: Promise<GltfIOBundle> | null = null;

function unavailable(error: unknown, what: string): GltfCodecAvailability {
  const message = error instanceof Error ? error.message : String(error);
  return { available: false, reason: `${what} failed to load: ${message}` };
}

/**
 * Create (once) the shared IO. Meshopt decode/encode/simplify come from the
 * `meshoptimizer` package (inline-wasm — loads in both browser and node).
 * Draco decode/encode come from `draco3d`, whose glue is its Node build:
 * without a `locateFile` the emscripten runtime fetched `draco_*.wasm`
 * relative to the page and got the dev server's HTML fallback (measured
 * 2026-09-17, four emscripten warnings per Asset Budget open). The package
 * ships both wasm files beside the glue; Vite serves them by URL and the
 * glue is told where. Still probed — a host that cannot run the glue reports
 * Draco unavailable. KTX2 encoding has no in-repo encoder and is reported
 * unavailable with that exact reason.
 */
export function getGltfIO(): Promise<GltfIOBundle> {
  if (!_bundle) _bundle = createBundle();
  return _bundle;
}

async function createBundle(): Promise<GltfIOBundle> {
  const io = new WebIO().registerExtensions(ALL_EXTENSIONS);
  const dependencies: Record<string, unknown> = {};

  let meshoptDecoder: GltfCodecAvailability = { available: true };
  let meshoptEncoder: GltfCodecAvailability = { available: true };
  let meshoptSimplifier: GltfCodecAvailability = { available: true };
  try {
    const meshopt = await import('meshoptimizer');
    await Promise.all([
      meshopt.MeshoptDecoder.ready,
      meshopt.MeshoptEncoder.ready,
      meshopt.MeshoptSimplifier.ready,
    ]);
    dependencies['meshopt.decoder'] = meshopt.MeshoptDecoder;
    dependencies['meshopt.encoder'] = meshopt.MeshoptEncoder;
  } catch (error) {
    meshoptDecoder = unavailable(error, 'meshoptimizer decoder');
    meshoptEncoder = unavailable(error, 'meshoptimizer encoder');
    meshoptSimplifier = unavailable(error, 'meshoptimizer simplifier');
  }

  let dracoDecoder: GltfCodecAvailability = { available: true };
  let dracoEncoder: GltfCodecAvailability = { available: true };
  try {
    const draco3d = (await import('draco3d')).default;
    dependencies['draco3d.decoder'] = await draco3d.createDecoderModule({
      locateFile: (file: string) => (file.endsWith('.wasm') ? dracoDecoderWasmUrl : file),
    });
  } catch (error) {
    dracoDecoder = unavailable(error, 'draco3d decoder');
  }
  try {
    const draco3d = (await import('draco3d')).default;
    dependencies['draco3d.encoder'] = await draco3d.createEncoderModule({
      locateFile: (file: string) => (file.endsWith('.wasm') ? dracoEncoderWasmUrl : file),
    });
  } catch (error) {
    dracoEncoder = unavailable(error, 'draco3d encoder');
  }

  io.registerDependencies(dependencies);
  return {
    io,
    capabilities: {
      meshoptDecoder,
      meshoptEncoder,
      meshoptSimplifier,
      dracoDecoder,
      dracoEncoder,
      ktx2Encoder: await probeKtx2Encoder(),
    },
  };
}

/**
 * Is the vendored Basis encoder reachable from this page?
 *
 * A HEAD request rather than an import: the encoder is a 3.3 MB wasm served
 * as a static file (`basis-encoder.ts` explains why it is vendored rather
 * than depended on), so probing it by LOADING it would cost the download at
 * every Asset Budget open, for a button the user may never press. HEAD costs
 * one round trip and answers exactly the question — does this deployment
 * serve the artifact — while the op itself still fails loudly with the real
 * reason if the body turns out to be unusable.
 */
async function probeKtx2Encoder(): Promise<GltfCodecAvailability> {
  const url = `${BASIS_ENCODER_PATH}basis_encoder.wasm`;
  try {
    const response = await fetch(url, { method: 'HEAD' });
    if (response.ok) return { available: true };
    return {
      available: false,
      reason: `The Basis Universal encoder is not being served at ${url} (HTTP ${response.status}).`,
    };
  } catch (error) {
    return unavailable(error, `the Basis Universal encoder at ${url}`);
  }
}

/** The meshoptimizer simplifier module, for simplify()/simplifyPrimitive(). */
export async function getMeshoptSimplifier(): Promise<
  typeof import('meshoptimizer').MeshoptSimplifier
> {
  const meshopt = await import('meshoptimizer');
  await meshopt.MeshoptSimplifier.ready;
  return meshopt.MeshoptSimplifier;
}
