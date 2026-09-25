/**
 * The headless Blender build, served to the editor tab — and the door that
 * says WHICH BUILD it is.
 *
 * THE BLENDER IN THE TAB IS BLENDER (ARCHITECTURE-CORE, owner ruling
 * 2026-09-17), and since the 2026-09-18 amendment there are two builds of it:
 *
 *   emscripten — the STANDALONE skew, and the one `@volter/blender-engine` SHIPS under
 *     `wasm/`: the glue as text plus the two large files pre-compressed
 *     (`blender_browser.wasm.br`, `blender_browser.data.br`, ~38 MB together
 *     against ~156 MB raw). They are served as-is with `Content-Encoding: br`;
 *     the browser decompresses before the runtime sees a byte, so the glue's
 *     own `instantiateStreaming` and `.data` preload run unchanged.
 *
 *   wali — the SUBSTRATE skew: one `blender.wasm` linked for
 *     `wasm32-wali-linux-musl` beside the `runtime/` tree it reads through
 *     `BLENDER_SYSTEM_*` (browser-substrate `programs/blender/5.2.0`, whose
 *     `gate.sh` stages exactly that pair).
 *
 * THE SKEW IS NOT CONFIGURED, IT IS READ. One editor serves one Blender, and
 * the served directory holds either `blender_browser.js` or `blender.wasm`;
 * that IS the answer, and `status` carries it. There is no manifest field, no
 * setting and no flag, because nothing a user does may depend on the skew —
 * the ruling's "a skew may refuse a capability by name, never answer the same
 * question differently" leaves nothing for a chooser to choose.
 * `VGAI_BLENDER_WASM_DIR` is the existing door for pointing the editor at a
 * different build, and pointing it at a WALI pack is how the substrate skew is
 * reached in development.
 *
 * ONE PATCH IS APPLIED TO THE EMSCRIPTEN GLUE, and it is applied HERE rather
 * than in the worker so that the pthread workers — which the runtime spawns by
 * loading this same URL as a classic worker (`Module.mainScriptUrlOrBlob`) —
 * get the identical text. The build is `-sPROXY_TO_PTHREAD`, and its
 * `pthread_create` glue transfers a `#canvas` to the spawned thread by default.
 * There is no canvas in a worker, and the transfer aborts the spawn, so the
 * transfer list is emptied. The upstream release already does exactly this for
 * node (`if(ENVIRONMENT_IS_NODE){transferredCanvasNames=0}`); a worker needs
 * the same, and for the same reason.
 *
 * THE SAME PATCHING IS WHAT CARRIES THE SUBSTRATE, and it is the precedent
 * being transcribed rather than a new mechanism: `@volter/browser-wali` and
 * `@volter/browser-runtime` are served out of this door too
 * (`/__editor/blender-wasm/wali/<package>/<file>.js`), with their bare
 * `@volter/...` specifiers rewritten to those URLs on the way out. That is
 * what keeps `@volter/blender-engine` free of any dependency on browser-substrate: the
 * standalone skew installs nothing, bundles nothing and fetches nothing, and
 * the WALI engine imports the substrate from URLs instead of specifiers. The
 * nested workers `BrowserWaliWorkerProgram` spawns load from these same URLs,
 * so they get the identical rewritten text — exactly the reason the glue patch
 * lives here.
 *
 * A missing directory is a LOUD 404 naming the variable, never a silent
 * fall-through: the engine either is Blender or says why it is not.
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';

export type BlenderSkew = 'emscripten' | 'wali';

/** Engine artifacts plus the separately packaged Essentials asset payload. */
export const BLENDER_WASM_FILES = [
  'blender_browser.js',
  'blender_browser.wasm',
  'blender_browser.data',
  'essentials.json',
  'essentials.bin',
] as const;

export type BlenderWasmFile = (typeof BLENDER_WASM_FILES)[number];

/** What the WALI skew's directory must hold: the artifact, and the runtime
 *  tree Blender reads through `BLENDER_SYSTEM_*`. */
export const BLENDER_WALI_ARTIFACT = 'blender.wasm';
export const BLENDER_WALI_RUNTIME = 'runtime';

/**
 * THE THREAD BUDGET, stated once, here, because it is a property of this RUN
 * SURFACE and not of the program.
 *
 * Blender is SERIAL unless it is told `-t N` and says so on stderr
 * (browser-substrate `programs/blender/5.2.0/README.md` §(a): `-t N` sets
 * oneTBB's global control and blenlib's explicitly sized arena). The POOL is a
 * different number and must be comfortably above it: measured 2026-09-18 in
 * the pack's own emulator, `blender -t 4` TRAPS with a host pool of 4, because
 * the stated count buys four oneTBB workers and Blender starts threads of its
 * own besides. 4 in a pool of 16 is the pair this lane measured end to end
 * (`blender-n-gate`, 2026-09-19: boot 12.0 s, first request 0.9 s, later calls
 * ~1.5 s), and a pool of 8 under `-t 4` trapped during boot on this box.
 */
/**
 * FOUR, MEASURED, NOT THE MACHINE'S CORES. The Emscripten skew runs Blender at 6
 * on this 12-core box; measured 2026-09-20 on the same operations, WALI at 12
 * threads was SLOWER than at 4 everywhere (subsurf level 6: 40 ms against 17;
 * an ico sphere: 30 against 15; the courtyard 31.1 s against 28.6) -- the
 * pool's scheduling costs more than the cores return, so more `-t` is not more
 * speed here. The pool stays four times the count, the ratio that measured
 * clean (16 under 4; 8 under 4 trapped at boot), because Blender starts threads
 * of its own beyond the oneTBB workers `-t` buys.
 */
export const BLENDER_WALI_WORKERS = { pool: 16, blender: 4 } as const;

/** The substrate packages the WALI engine imports, by the URL segment each is
 *  served under and the specifier prefix rewritten to it. */
export const BLENDER_WALI_SUBSTRATE = [
  { segment: 'browser-wali', specifier: '@volter/browser-wali' },
  { segment: 'browser-runtime', specifier: '@volter/browser-runtime' },
] as const;

export const BLENDER_WASM_DIR_VARIABLE = 'VGAI_BLENDER_WASM_DIR';

/**
 * The bundle `@volter/blender-engine` ships — Blender itself, so its own GPL
 * package (ARCHITECTURE-CORE §Licensing, "Blender's licence stops at the
 * wire"). This resolution is a PATH, not an import: the editor serves those
 * bytes and never imports the engine. `import.meta.url` is THIS FILE's esbuild bundle
 * (`<pkg>/dist-node/serving.mjs`, the `vgai.serving` module); from it, two
 * directories up and across is the sibling package -- `packages/blender-engine/wasm`
 * in a checkout, `node_modules/@volter/blender-engine/wasm` installed. Existence is
 * checked once so a realm that lacks it gets a named absence, not a path.
 */
export const SHIPPED_BLENDER_WASM_DIR: string | null = (() => {
  const candidate = fileURLToPath(new URL('../../blender-engine/wasm/', import.meta.url));
  return existsSync(candidate) ? candidate.replace(/\/$/, '') : null;
})();

/** Where the build is: the named directory, else the shipped one, else null. */
export function blenderWasmDir(env: NodeJS.ProcessEnv = process.env): string | null {
  const named = env[BLENDER_WASM_DIR_VARIABLE];
  if (typeof named === 'string' && named.trim() !== '') {
    const dir = named.trim();
    return isAbsolute(dir) ? dir : null;
  }
  return SHIPPED_BLENDER_WASM_DIR;
}

/** A file on disk as the build stores it: raw, or pre-compressed as `.br`. */
export interface BlenderWasmOnDisk {
  path: string;
  size: number;
  encoding: 'br' | null;
}

export async function blenderWasmOnDisk(
  dir: string,
  file: string,
): Promise<BlenderWasmOnDisk | null> {
  for (const [suffix, encoding] of [
    ['.br', 'br'],
    ['', null],
  ] as const) {
    const path = join(dir, `${file}${suffix}`);
    try {
      const info = await stat(path);
      if (info.isFile()) return { path, size: info.size, encoding };
    } catch {
      /* try the other spelling */
    }
  }
  return null;
}

export interface BlenderWasmStatus {
  available: boolean;
  /** Which build the served directory holds; null when nothing is served. */
  skew: BlenderSkew | null;
  /** The directory that was looked in, or null when the variable is unset. */
  dir: string | null;
  /** On-disk byte sizes of the files, for the ones that are there
   *  (the `.br` size when a file is stored pre-compressed). */
  sizes: Record<string, number>;
  /** Which files are stored pre-compressed, by name. */
  encoded: Record<string, 'br'>;
  /** Why it is unavailable, named. Empty when it is available. */
  missing: string[];
  /** Emscripten: each file's SHA-256 as it decodes (`BUNDLE.json#rawFiles`,
   *  `essentials.json`), so a page can keep the bytes it fetched once. */
  digests?: Record<string, string>;
  /** WALI only: the `sha256-` SRI of `blender.wasm`. The program loader
   *  refuses any non-blob URL without one, so the session names the exact
   *  bytes it ran. */
  integrity?: string;
  /** WALI only: {@link BLENDER_WALI_WORKERS}. */
  workers?: { pool: number; blender: number };
}

/** Which skew a directory holds, by what is in it. Null when it holds neither,
 *  which is what `missing` then has to explain. */
async function skewOf(dir: string): Promise<BlenderSkew | null> {
  if (await blenderWasmOnDisk(dir, 'blender_browser.js')) return 'emscripten';
  if (existsSync(join(dir, BLENDER_WALI_ARTIFACT))) return 'wali';
  return null;
}

export async function blenderWasmStatus(
  env: NodeJS.ProcessEnv = process.env,
): Promise<BlenderWasmStatus> {
  const dir = blenderWasmDir(env);
  if (dir === null)
    return {
      available: false,
      skew: null,
      dir: null,
      sizes: {},
      encoded: {},
      missing: [
        `no packages/blender-engine/wasm beside this editor, and ${BLENDER_WASM_DIR_VARIABLE} ` +
          `is not set to an absolute directory holding either ${BLENDER_WASM_FILES.join(', ')} ` +
          `or ${BLENDER_WALI_ARTIFACT} beside its ${BLENDER_WALI_RUNTIME}/ tree`,
      ],
    };
  const skew = await skewOf(dir);
  if (skew === null)
    return {
      available: false,
      skew: null,
      dir,
      sizes: {},
      encoded: {},
      missing: [
        `${dir} holds neither ${BLENDER_WASM_FILES.join(', ')} (the standalone skew) nor ` +
          `${BLENDER_WALI_ARTIFACT} (the substrate skew)`,
      ],
    };
  return skew === 'wali' ? waliStatus(dir) : emscriptenStatus(dir);
}

async function emscriptenStatus(dir: string): Promise<BlenderWasmStatus> {
  const sizes: Record<string, number> = {};
  const encoded: Record<string, 'br'> = {};
  const missing: string[] = [];
  for (const file of BLENDER_WASM_FILES) {
    const found = await blenderWasmOnDisk(dir, file);
    if (!found) {
      missing.push(`${join(dir, file)} (or .br)`);
      continue;
    }
    sizes[file] = found.size;
    if (found.encoding) encoded[file] = found.encoding;
  }
  return { available: missing.length === 0, skew: 'emscripten', dir, sizes, encoded, missing, digests: await emscriptenDigests(dir) };
}

/** The decoded bytes' digests the build records, for the files it records them for. */
async function emscriptenDigests(dir: string): Promise<Record<string, string>> {
  const digests: Record<string, string> = {};
  const read = async (file: string): Promise<unknown> => {
    try { return JSON.parse(await readFile(join(dir, file), 'utf8')); } catch { return undefined; }
  };
  const bundle = await read('BUNDLE.json') as { rawFiles?: Record<string, { sha256?: unknown }> } | undefined;
  for (const [file, record] of Object.entries(bundle?.rawFiles ?? {})) {
    if (typeof record?.sha256 === 'string') digests[file] = record.sha256;
  }
  const essentials = await read('essentials.json') as { sha256?: unknown } | undefined;
  if (typeof essentials?.sha256 === 'string') digests['essentials.bin'] = essentials.sha256;
  return digests;
}

async function waliStatus(dir: string): Promise<BlenderWasmStatus> {
  const sizes: Record<string, number> = {};
  const missing: string[] = [];
  const artifact = join(dir, BLENDER_WALI_ARTIFACT);
  try {
    sizes[BLENDER_WALI_ARTIFACT] = (await stat(artifact)).size;
  } catch {
    missing.push(artifact);
  }
  let index: RuntimeIndex | null = null;
  try {
    index = await runtimeIndex(dir);
    sizes[`${BLENDER_WALI_RUNTIME}/`] = index.files.reduce((total, file) => total + file.size, 0);
  } catch (error) {
    missing.push(
      `${join(dir, BLENDER_WALI_RUNTIME)} (Blender's scripts, datafiles and python; ` +
        `${error instanceof Error ? error.message : String(error)})`,
    );
  }
  for (const { segment, specifier } of BLENDER_WALI_SUBSTRATE)
    if (substrateDir(specifier) === null)
      missing.push(
        `${specifier} (served at wali/${segment}/; the substrate skew runs Blender through it, ` +
          `so a project that opts into this skew declares it)`,
      );
  const integrity =
    missing.length === 0
      ? `sha256-${createHash('sha256')
          .update(await readFile(artifact))
          .digest('base64')}`
      : undefined;
  return {
    available: missing.length === 0,
    skew: 'wali',
    dir,
    sizes,
    encoded: {},
    missing,
    ...(integrity ? { integrity } : {}),
    workers: { ...BLENDER_WALI_WORKERS },
  };
}

/**
 * The glue, patched. Read once and held: it is 700 KB of text and every
 * pthread the runtime spawns asks for it again.
 */
let patchedGlue: { dir: string; text: string } | null = null;

const CANVAS_TRANSFER =
  'var transferredCanvasNames=attr?(growMemViews(),HEAPU32)[attr+40>>2]:0;if(';

export function patchBlenderGlue(source: string): string {
  // A headless build spawns no window and its glue carries no canvas transfer:
  // then there is nothing to patch and the glue is served as-is. Only a build
  // that DOES transfer a `#canvas` (the port's UI-derived release) needs the
  // list emptied, because a worker has no canvas and `#canvas` asks
  // `Module.canvas` for one that is not there.
  if (!source.includes(CANVAS_TRANSFER)) return source;
  return source.replace(
    CANVAS_TRANSFER,
    `${CANVAS_TRANSFER}true){transferredCanvasNames=0}else if(`,
  );
}

export async function blenderGlueText(dir: string): Promise<string> {
  if (patchedGlue?.dir === dir) return patchedGlue.text;
  const found = await blenderWasmOnDisk(dir, 'blender_browser.js');
  if (!found) throw new Error(`${join(dir, 'blender_browser.js')} is not there`);
  const raw = await readFile(found.path);
  // The glue is patched as TEXT, so a pre-compressed glue is inflated here.
  const source =
    found.encoding === 'br' ? brotliDecompressSync(raw).toString('utf8') : raw.toString('utf8');
  const text = patchBlenderGlue(source);
  patchedGlue = { dir, text };
  return text;
}

export function blenderWasmReadStream(found: BlenderWasmOnDisk): NodeJS.ReadableStream {
  return createReadStream(found.path);
}

// ---- The WALI skew: the runtime tree, and the substrate that runs the program.

export interface RuntimeIndex {
  files: { path: string; size: number; mode: number }[];
}

let cachedRuntimeIndex: { dir: string; index: RuntimeIndex } | null = null;

/**
 * Blender's runtime tree, as ONE index plus ONE blob.
 *
 * ~2,300 files and 78 MB, every one of which has to exist before Blender's
 * first act. The tab fetches this index and then `runtime.bin`, whose bytes
 * are the same files concatenated IN THIS ORDER, and slices
 * (`blender-wali-engine.mts`'s `stageRuntime`). A request per file would be
 * 2,300 round trips; a tar would be a dependency and a decoder. The order is
 * the index's and nothing else may assume it.
 */
export async function runtimeIndex(dir: string): Promise<RuntimeIndex> {
  if (cachedRuntimeIndex?.dir === dir) return cachedRuntimeIndex.index;
  const root = join(dir, BLENDER_WALI_RUNTIME);
  const files: RuntimeIndex['files'] = [];
  const walk = async (where: string): Promise<void> => {
    for (const entry of (await readdir(where, { withFileTypes: true })).sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    )) {
      const path = join(where, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }
      if (!entry.isFile()) continue;
      const info = await stat(path);
      files.push({
        path: relative(root, path).split(/[\\/]/).join(posix.sep),
        size: info.size,
        mode: info.mode & 0o7777,
      });
    }
  };
  await walk(root);
  if (files.length === 0) throw new Error(`${root} is empty`);
  const index = { files };
  cachedRuntimeIndex = { dir, index };
  return index;
}

/** Stream the runtime blob: every indexed file's bytes, in index order. */
export async function writeRuntimeBlob(dir: string, write: (chunk: Buffer) => void): Promise<void> {
  const root = join(dir, BLENDER_WALI_RUNTIME);
  for (const file of (await runtimeIndex(dir)).files) write(await readFile(join(root, file.path)));
}

/**
 * Where a substrate package's browser ESM is, or null when it is not
 * installed. Resolved through Node's own resolution from THIS file, so it
 * finds whatever the project that opted into this skew declared.
 *
 * `import.meta.resolve` and not `createRequire().resolve`: these packages
 * export `"."` and `"./*.js"` under the `import` condition ONLY, so a CJS
 * resolve raises ERR_PACKAGE_PATH_NOT_EXPORTED on a package that is plainly
 * installed. The package's OWN ENTRY is resolved rather than its
 * `package.json`, which is not exported at all; the entry's directory IS the
 * published `dist`, which is where every served module comes from.
 */
export function substrateDir(specifier: string): string | null {
  try {
    return dirname(fileURLToPath(import.meta.resolve(specifier)));
  } catch {
    return null;
  }
}

const SUBSTRATE_SEGMENTS = new Map<string, string>(
  BLENDER_WALI_SUBSTRATE.map(({ segment, specifier }) => [segment, specifier] as const),
);

/**
 * One substrate module, with its bare specifiers rewritten to this door's URLs.
 *
 * `@volter/browser-wali/dist/worker-program.js` imports
 * `@volter/browser-runtime/browser-filesystem.js`, which a browser cannot
 * resolve; and `BrowserWaliWorkerProgram` spawns its own workers with
 * `new Worker(new URL("./worker-program-worker.js", import.meta.url))`, so
 * those land back on this same route and must get the identically rewritten
 * text. That is the glue patch's rule applied to a second artifact, for the
 * same reason.
 */
export async function substrateModule(
  segment: string,
  file: string,
): Promise<{ text: string } | null> {
  const specifier = SUBSTRATE_SEGMENTS.get(segment);
  if (!specifier || !/^[\w.-]+\.(?:js|mjs|map)$/.test(file)) return null;
  const root = substrateDir(specifier);
  if (root === null) return null;
  const path = join(root, file);
  if (!existsSync(path)) return null;
  let text = (await readFile(path)).toString('utf8');
  for (const other of BLENDER_WALI_SUBSTRATE)
    text = text.replaceAll(
      `"${other.specifier}/`,
      `"/__editor/blender-wasm/wali/${other.segment}/`,
    );
  return { text };
}
