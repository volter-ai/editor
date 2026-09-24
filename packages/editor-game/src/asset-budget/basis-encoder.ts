/**
 * Binomial's Basis Universal ENCODER, loaded from the vendored first-party
 * artifact — the encode half of the Asset Budget's KTX2 texture compression.
 *
 * WHY THE ARTIFACT AND NOT A PACKAGE. `docs/ARCHITECTURE-CORE.md` §Surfacing:
 * "Engine builds are exact-pinned deps … never their three-coupled wrapper
 * packages; if a pin breaks, escalate to vendoring the wasm with an
 * `UPSTREAM.lock`-shaped record, never to trusting a wrapper." Binomial
 * publishes no npm package for the encoder at all (the two registry names that
 * look like one — `basisu`, `basis_universal` — are third-party wrappers around
 * the NATIVE `basisu` executable, which would make this op depend on a system
 * binary), so the escalation is the only honest path: `basis_encoder.js` and
 * `basis_encoder.wasm` are vendored byte-identical from the upstream repo at a
 * pinned commit and recorded in `vendor/upstream-assets.lock.json`.
 *
 * WHAT THIS FILE OWNS. The coupling surface only. It resolves the two
 * artifacts, hands the wasm to the emscripten factory as `wasmBinary` (so the
 * module never fetches anything itself — hermetic in a browser and in vitest
 * alike), and returns the encoder module as-is. Everything above it programs
 * against Binomial's own `BasisEncoder` API; nothing here wraps it.
 *
 * WHY `new Function`. The vendored glue is upstream's UMD-flavoured build
 * (`var BASIS = (() => …)()`), and it stays byte-identical — appending an
 * `export` would break the pinned sha256 and the zero-diff guard that pins it.
 * The three parameters are the Node branch's free variables: emscripten
 * evaluates `require("fs")` and `__dirname` eagerly when `globalThis.process`
 * looks like Node (so vitest takes that branch), but only ever USES them from
 * `readBinary`/`readAsync` — the paths that fetch the wasm, which supplying
 * `wasmBinary` retires. Hence {@link deadRequire}: it satisfies the eager
 * call and throws by name if anything actually reaches through it, rather
 * than pretending to be Node's module system. In a browser the parameters are
 * `undefined` and the branch is not taken at all.
 */

/** Where the vendored encoder is served from (repo-root `public/`). Editor
 *  only — a shipped game decodes KTX2 and never encodes it, which is why the
 *  template vendors the transcoder but not this. */
export const BASIS_ENCODER_PATH = '/jsm/libs/basis-encoder/';

/** The two vendored files, when the caller already has their bytes (headless
 *  tests read them straight off disk; the editor fetches them). */
export interface BasisEncoderArtifacts {
  /** `basis_encoder.js` source text. */
  readonly glue: string;
  /** `basis_encoder.wasm` bytes. */
  readonly wasmBinary: Uint8Array;
}

/** The slice of Binomial's module this repo actually calls. Deliberately not a
 *  full re-declaration of the encoder's API — an unused declaration is a
 *  maintenance liability, and everything here has a caller. */
export interface BasisEncoderModule {
  initializeBasis(): void;
  readonly ldr_image_type: {
    readonly cRGBA32: { value: number };
    readonly cPNGImage: { value: number };
    readonly cJPGImage: { value: number };
  };
  readonly BasisEncoder: new () => BasisEncoderInstance;
}

/** The encoder methods this repo drives. Same rule as above: every one is
 *  called by `compressTexturesKtx2`. */
export interface BasisEncoderInstance {
  setCreateKTX2File(value: boolean): void;
  setKTX2UASTCSupercompression(value: boolean): void;
  setKTX2AndBasisSRGBTransferFunc(value: boolean): void;
  setDebug(value: boolean): void;
  setStatusOutput(value: boolean): void;
  setComputeStats(value: boolean): void;
  setPerceptual(value: boolean): void;
  setMipSRGB(value: boolean): void;
  setMipGen(value: boolean): void;
  setUASTC(value: boolean): void;
  setQualityLevel(value: number): void;
  setSliceSourceImage(
    sliceIndex: number,
    image: Uint8Array,
    width: number,
    height: number,
    imageType: number,
  ): boolean;
  encode(output: Uint8Array): number;
  delete(): void;
}

type BasisFactory = (options: { wasmBinary: Uint8Array }) => Promise<BasisEncoderModule>;

let _module: Promise<BasisEncoderModule> | null = null;

async function fetchArtifact(file: string): Promise<Response> {
  const url = `${BASIS_ENCODER_PATH}${file}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `The Basis Universal encoder is not being served at ${url} (HTTP ${response.status}). ` +
        `It is vendored under public${BASIS_ENCODER_PATH} and pinned in vendor/upstream-assets.lock.json.`,
    );
  }
  return response;
}

/**
 * Stands in for Node's `require` inside the glue, where the module system is
 * reached for eagerly but the results are only used by the wasm-FETCHING
 * paths that `wasmBinary` retires. Every property access throws with the
 * module name, so a genuine dependency shows up as itself rather than as a
 * silent `undefined` deep inside emscripten.
 */
function deadRequire(specifier: string): unknown {
  return new Proxy(
    {},
    {
      get(_target, property) {
        throw new Error(
          `The vendored Basis encoder reached for require('${specifier}').${String(property)} — ` +
            `it is loaded with an explicit wasmBinary and must never load anything itself.`,
        );
      },
    },
  );
}

async function instantiate(artifacts: BasisEncoderArtifacts): Promise<BasisEncoderModule> {
  const factory = new Function(
    'require',
    '__dirname',
    '__filename',
    `${artifacts.glue}\n;return BASIS;`,
  )(deadRequire, '', '') as BasisFactory;
  const module = await factory({ wasmBinary: artifacts.wasmBinary });
  module.initializeBasis();
  return module;
}

/**
 * The initialized encoder module, created once per page/process.
 *
 * Pass `artifacts` when the bytes are already in hand (headless tests); with
 * no argument the two vendored files are fetched from {@link
 * BASIS_ENCODER_PATH}. Either way the wasm is handed over as `wasmBinary`, so
 * no network request originates inside the emscripten module itself.
 */
export function getBasisEncoder(artifacts?: BasisEncoderArtifacts): Promise<BasisEncoderModule> {
  if (!_module) {
    _module = artifacts
      ? instantiate(artifacts)
      : (async () => {
          const [glueResponse, wasmResponse] = await Promise.all([
            fetchArtifact('basis_encoder.js'),
            fetchArtifact('basis_encoder.wasm'),
          ]);
          return instantiate({
            glue: await glueResponse.text(),
            wasmBinary: new Uint8Array(await wasmResponse.arrayBuffer()),
          });
        })();
  }
  return _module;
}

/** Test-only reset so a suite can re-instantiate against fresh artifacts. */
export function __resetBasisEncoderForTest(): void {
  _module = null;
}
