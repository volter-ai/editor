/**
 * The STANDALONE skew: Blender in this worker's own WebAssembly module.
 *
 * `blender-engine.mts` is the seam and says how the skew is chosen; this is
 * one of its two implementations, and the one `@volter/editor-blender` ships. It has no
 * in-house dependency of any kind and reaches nothing but the editor's own
 * routes.
 *
 * THREE THINGS THE BUILD REQUIRES, each measured rather than assumed:
 *
 * 1. CROSS-ORIGIN ISOLATION. The build is `-sPROXY_TO_PTHREAD` with pthreads,
 *    so it needs `SharedArrayBuffer`. The editor's dev server already sets
 *    `Cross-Origin-Opener-Policy: same-origin` and
 *    `Cross-Origin-Embedder-Policy: credentialless` ahead of every route
 *    (`packages/editor/server/dev.ts`) — `credentialless` rather than
 *    `require-corp` precisely so cross-origin images and iframes keep loading.
 *    A worker without `crossOriginIsolated` is refused BY NAME here rather
 *    than left to fail inside the runtime.
 *
 * 2. THE GLUE IS PATCHED SERVER-SIDE, not here, because the runtime spawns its
 *    pthreads by loading that same URL as a classic worker
 *    (`Module.mainScriptUrlOrBlob`). See `blender-wasm-artifact.ts`.
 *
 * 3. FILES ARE STAGED WITH `FS_createDataFile`, before the runtime starts.
 *    This is a WasmFS build: `Module.FS` exists and works from this thread,
 *    but its preload directories come out non-writable, which is why
 *    `session.py` chmods its own root as its first act.
 */

import { checkpointStream } from './pull-job.mts';
import { writeStreamedFile, type StreamFileSystem } from './stream-file.mts';
import {
  artifactUrl,
  startupOperation,
  type BlenderArtifactStatus,
  type BlenderEngine,
  type BlenderEngineOptions,
  type BlenderFiles,
  openSessionChannel,
  PAGE_OWNED_DIRECTORIES,
  SESSION_ROOT,
  SESSION_SCRIPT,
  sessionLevel,
  sleep,
} from './blender-engine.mts';
import sessionPython from './session.py?raw';

/** What the module factory is, in the only shape this file uses. */
interface BlenderModule {
  FS: StreamFileSystem & {
    readFile(path: string): Uint8Array;
    writeFile(path: string, data: string | Uint8Array): void;
    mkdirTree(path: string): void;
    readdir(path: string): string[];
    unlink(path: string): void;
    stat(path: string): { size: number; mode?: number; mtime?: Date | number };
    chmod(path: string, mode: number): void;
  };
  ENV: Record<string, string>;
  /** The export door's arena, read by `readArena`. */
  HEAPU8: Uint8Array;
  /**
   * Hand back the packed `.data` payload, once. Linked in by the bundle's
   * `--post-js` (the spike's `recipe/release-preloaded-file-data.js`, whose
   * header carries the measurement); absent means the module predates it,
   * which is why the call below is guarded and says so.
   */
  releasePreloadedFileData?(): { files: number; bytes: number };
  _blender_web_export_buffer(): number;
  _blender_web_export_buffer_size(): number;
  FS_createPath(parent: string, name: string, canRead: boolean, canWrite: boolean): void;
  FS_createDataFile(
    parent: string,
    name: string,
    data: Uint8Array,
    canRead: boolean,
    canWrite: boolean,
    canOwn: boolean,
  ): void;
}

type BlenderModuleFactory = (options: Record<string, unknown>) => Promise<BlenderModule>;

/** The glue, evaluated in this worker. It is a UMD bundle, so it is given the
 *  `module`/`exports` pair it looks for and hands back the factory. */
async function loadFactory(glueUrl: string): Promise<BlenderModuleFactory> {
  const source = await startupOperation(glueUrl, 'fetch glue', () => fetch(glueUrl));
  if (!source.ok) throw new Error(`${glueUrl}: HTTP ${source.status}`);
  const text = await startupOperation(glueUrl, 'read glue body', () => source.text());
  const container = { exports: {} as { default?: BlenderModuleFactory } };
  const evaluate = await startupOperation(glueUrl, 'compile glue', () => new Function(
    'module',
    'exports',
    'define',
    `${text}\nreturn typeof createBlenderModule === 'function' ? createBlenderModule : module.exports;`,
  ) as (module: unknown, exports: unknown, define: unknown) => BlenderModuleFactory);
  const factory = await startupOperation(glueUrl, 'evaluate glue', () => evaluate(container, container.exports, undefined));
  if (typeof factory !== 'function')
    throw new Error(`${glueUrl}: blender_browser.js did not produce a module factory`);
  return factory;
}

const utf8 = new TextEncoder();

function mkdirp(module: BlenderModule, directory: string): void {
  let current = '';
  for (const part of directory.split('/').filter(Boolean)) {
    module.FS_createPath(current || '/', part, true, true);
    current += `/${part}`;
  }
}

/** `Module.FS`, as {@link BlenderFiles}. Every call is synchronous underneath;
 *  the promises are the seam's, for the skew that cannot be synchronous. */
function moduleFiles(module: BlenderModule): BlenderFiles {
  const FS = module.FS;
  return {
    readFile: async (path) => FS.readFile(path),
    // Not `async`: a write that throws throws here, so `request` never starts `.done` after a failed `.json`.
    writeFile: (path, data) => { FS.writeFile(path, data); return Promise.resolve(); },
    writeFileStream: (path, body, size) => writeStreamedFile(FS, path, body, size),
    mkdirTree: async (path) => FS.mkdirTree(path),
    readdir: async (path) => FS.readdir(path),
    stat: async (path) => {
      let info: { size: number; mode?: number; mtime?: Date | number };
      try {
        info = FS.stat(path);
      } catch {
        return null;
      }
      const mtime = info.mtime;
      return {
        size: info.size,
        mode: info.mode ?? 0,
        mtimeMs: typeof mtime === 'number' ? mtime : (mtime?.getTime() ?? 0),
      };
    },
    unlink: async (path) => FS.unlink(path),
  };
}

/**
 * BLENDER'S ARTIFACTS ARE FETCHED ONCE PER BUILD. The wasm (86 MB decoded), the
 * `.data` package (53 MB) and the Essentials payload are immutable for a build,
 * and the page keeps them in Cache Storage under the digest the artifact door
 * reports, so a later open reads them at the browser's own speed instead of
 * from the editor's server. Measured in the browser substrate, where that
 * server runs in the tab: the three took 7.2 s per open (4.2 s for the wasm
 * alone), about half of it decoding their brotli. A file the door gives no
 * digest for is fetched as it always was.
 */
const ARTIFACT_CACHE = 'volter-blender-artifacts';

/**
 * THE CACHE SPEEDS AN OPEN UP; IT NEVER DECIDES WHETHER BLENDER OPENS. A Cache Storage that cannot
 * open or answer (measured 2026-10-07, headless Chrome on Windows: `caches.open` threw "Unexpected
 * internal error", and the model failed to open on it) means the artifact is fetched from the editor
 * as it would be with no digest; bytes that cannot be kept are used anyway. `note` says which, per artifact, as page output (not an unresolved console entry).
 */
async function cachedArtifact(file: string, digest: string | undefined, checkpoint: () => Promise<void>, note: (text: string) => void): Promise<Response> {
  const bounded = (response: Response): Response => response.ok && response.body
    ? new Response(checkpointStream(response.body, checkpoint), { status: response.status, headers: response.headers })
    : response;
  const url = artifactUrl(file);
  const fetchArtifact = () => startupOperation(url, 'fetch artifact', () => fetch(url));
  if (!digest || typeof caches === 'undefined') return bounded(await fetchArtifact());
  const key = `${url}?sha256=${digest}`;
  const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));
  const opened = await startupOperation(url, 'open artifact cache', () => caches.open(ARTIFACT_CACHE))
    .then(async (cache) => ({ cache, hit: await startupOperation(url, 'read artifact cache', () => cache.match(key)) }))
    .catch((error: unknown) => {
      note(`Blender's artifact cache is unavailable (${reason(error)}); ${file} is fetched from the editor instead.`);
      return null;
    });
  if (!opened) return bounded(await fetchArtifact());
  if (opened.hit) return bounded(opened.hit);
  const { cache } = opened;
  const response = bounded(await fetchArtifact());
  if (!response.ok) return response;
  const body = await startupOperation(url, 'read artifact body for cache', () => response.blob());
  const kept = new Response(body, { headers: { 'content-type': response.headers.get('content-type') ?? 'application/octet-stream' } });
  try {
    // One build's bytes per file: an older build's are dropped as this one lands.
    await startupOperation(url, 'prune previous artifact cache entries', async () => {
      for (const old of await cache.keys()) if (old.url.startsWith(`${url}?sha256=`) && old.url !== key) await cache.delete(old);
    });
    await startupOperation(url, 'write artifact cache', () => cache.put(key, kept.clone()));
  } catch (error) {
    note(`Blender's artifact cache could not keep ${file} (${reason(error)}); the next open fetches it again.`);
  }
  return kept;
}

export async function startEmscriptenBlenderEngine(
  options: BlenderEngineOptions,
  status: BlenderArtifactStatus,
): Promise<BlenderEngine> {
  if (!self.crossOriginIsolated)
    throw new Error(
      'Headless Blender needs SharedArrayBuffer, so the editor page has to be cross-origin ' +
        'isolated (Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy on ' +
        'every response). This worker reports crossOriginIsolated=false.',
    );
  const glueUrl = artifactUrl('blender_browser.js');
  const digests = status.digests ?? {};
  const checkpoint = async (phase: string): Promise<void> => { await options.ask({ checkpoint: phase }); };
  // Page output, not an editor-console condition: nothing in the project can resolve the browser's cache.
  const noteCache = (text: string) => options.log('log', text);
  const artifact = (file: string) => cachedArtifact(file, digests[file], () => checkpoint(`artifact/${file}`), noteCache);
  // The `.data` package is handed to the glue whole (`getPreloadedPackage`),
  // so it is read before the module starts; the wasm streams in beside it.
  const [factory, preloaded] = await Promise.all([
    loadFactory(glueUrl),
    artifact('blender_browser.data').then(async (response) => {
      const url = artifactUrl('blender_browser.data');
      if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
      return startupOperation(url, 'read data package body', () => response.arrayBuffer());
    }),
  ]);
  await checkpoint('runtime-package-ready');
  let bootError: unknown = null;
  const started = performance.now();
  let readyLine: string | null = null;
  // BLENDER'S OWN STREAMS ARE PAGE OUTPUT, NOT EDITOR-CONSOLE CONDITIONS.
  // Measured on the first live run: routing `printErr` at `error` put every
  // ordinary startup line -- the WebGPU preinit notice, a Python
  // DeprecationWarning, the ready banner itself -- into the session's
  // unresolved console set, which is the set an agent must drive to zero. The
  // editor's console door is for conditions somebody must resolve, so only the
  // session's OWN named conditions go there.
  const say = (_level: 'log' | 'error', text: string) => {
    if (text.startsWith('@@VOLTER-READY ')) readyLine = text.slice('@@VOLTER-READY '.length);
    options.log(sessionLevel(text), text);
  };
  // THE HEAP ITSELF, not a view of it. Blender runs on a pthread, so when its heap grows there
  // this worker's `module.HEAPU8` keeps the length it had until the glue next refreshes it -- and
  // no export the door calls does. MEASURED 2026-09-29 on the Stoneguard scene from
  // game-benchmarks main: a mesh's columns at 1.14 GB were read through a 433 MB view, and the
  // pull failed "outside the export arena". The glue builds its memory with `new
  // WebAssembly.Memory` and exports no handle to it, so that constructor is observed while the
  // factory runs; every read below takes a fresh view of `memory.buffer`.
  const Memory = WebAssembly.Memory;
  let memory: WebAssembly.Memory | null = null;
  (WebAssembly as { Memory: unknown }).Memory = function (descriptor: WebAssembly.MemoryDescriptor) {
    const made = new Memory(descriptor);
    memory ??= made;
    return made;
  } as unknown as typeof WebAssembly.Memory;
  const heap = (): Uint8Array => (memory ? new Uint8Array(memory.buffer) : module.HEAPU8);
  const module = await startupOperation(glueUrl, 'initialize glue runtime', () => factory({
    arguments: ['--background', '--factory-startup', '--python', SESSION_SCRIPT],
    locateFile: (file: string) => artifactUrl(file),
    getPreloadedPackage: () => preloaded,
    instantiateWasm: (imports: WebAssembly.Imports, receive: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void) => {
      void (async () => {
        const response = await artifact('blender_browser.wasm');
        const url = artifactUrl('blender_browser.wasm');
        if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
        const { instance, module: compiled } = await startupOperation(url, 'read and instantiate Wasm stream', () => WebAssembly.instantiateStreaming(response, imports));
        await checkpoint('wasm-instantiated');
        receive(instance, compiled);
      })().catch((error: unknown) => { bootError = error; });
      return {};
    },
    // The pthreads load the SAME patched glue this worker just evaluated.
    mainScriptUrlOrBlob: glueUrl,
    print: (text: string) => say('log', text),
    printErr: (text: string) => say('error', text),
    preRun: [
      (mod: BlenderModule) => {
        mod.ENV ??= {};
        Object.assign(mod.ENV, {
          BLENDER_SYSTEM_RESOURCES: '/bw',
          BLENDER_SYSTEM_PYTHON: '/bw/python',
          BLENDER_SYSTEM_SCRIPTS: '/bw/scripts',
          BLENDER_SYSTEM_DATAFILES: '/bw/datafiles',
          VOLTER_SESSION_ROOT: SESSION_ROOT,
          HOME: '/root',
          TMPDIR: '/tmp',
        });
        // VOLTER_EXPORT_BUFFER_PATH IS DELIBERATELY UNSET. This engine reads the
        // arena off `HEAPU8`; asking the door to also write it to a file would
        // cost this skew a megabyte-scale write per present for bytes it
        // already has (`session.py`, EXPORT_BUFFER_PATH).
        // `in` and `reply` are this page's under the channel's ownership rule
        // (`blender-engine.mts`); `session.py` makes `out` and `ask`, which
        // are its own.
        for (const directory of [
          '/tmp',
          '/root',
          '/work',
          SESSION_ROOT,
          ...PAGE_OWNED_DIRECTORIES,
          options.project,
        ])
          mkdirp(mod, directory);
        mod.FS_createDataFile(
          SESSION_ROOT,
          'session.py',
          utf8.encode(sessionPython),
          true,
          true,
          true,
        );
      },
    ],
  }).finally(() => {
    (WebAssembly as { Memory: unknown }).Memory = Memory;
  }));
  await checkpoint('runtime-initialized');
  // `main()` runs on a pthread (`-sPROXY_TO_PTHREAD`), so the factory resolves
  // long before the session exists. The ready line is what says it does.
  while (readyLine === null) {
    if (bootError) throw bootError instanceof Error ? bootError : new Error(String(bootError));
    await sleep(5);
  }
  const bootMs = performance.now() - started;
  const banner = JSON.parse(readyLine) as { blender: string; engines: string[] };

  // THE PAYLOAD EXISTS TWICE UNTIL THIS CALL. `--preload-file` reads the whole
  // `.data` package into one ArrayBuffer, WasmFS copies every file out of it
  // into the wasm heap during its own init, and then emscripten keeps the
  // subarrays forever in `wasmFSPreloadedFiles` -- so a booted session holds
  // ~55 MB of JS-side bytes that are already in linear memory and will never
  // be read again. Measured 2026-09-18: Node's `arrayBuffers` sat at 55 MB
  // from `factory resolved` through every later call, and two forced GCs did
  // not move it. Here is the one moment it is safe to drop: WasmFS flushed
  // long before the ready line, and anything staged after this takes
  // `FS_createDataFile`'s post-flush branch, which never consults the array.
  let releasedPayloadBytes: number | null = null;
  if (typeof module.releasePreloadedFileData === 'function') {
    const released = module.releasePreloadedFileData();
    releasedPayloadBytes = released.bytes;
    options.log(
      'log',
      `blender: released the preloaded ${(released.bytes / 1048576).toFixed(0)} MB ` +
        `payload (${released.files} files); WasmFS already holds it`,
    );
  } else {
    options.log(
      'error',
      'blender: this bundle has no releasePreloadedFileData, so the ~55 MB packed ' +
        '.data payload stays resident beside the copy WasmFS made of it — relink with ' +
        "the recipe's --post-js (recipe/release-preloaded-file-data.js).",
    );
  }

  const FS = module.FS;

  // A DIRECTORY MADE BY THE PRELOAD DOOR IS NOT WRITABLE. `FS_createPath`
  // ignores its `canWrite` argument in this build, so the project root and
  // everything above it come out read-only and the first `mkdirTree` under
  // them raises `ErrnoError` -- measured on the first live round trip
  // (2026-09-17: `stageProjectFiles` threw before any project file was
  // staged). The session chmods its own root from Python for the same reason;
  // this is the other half, for the paths Python never touches.
  let climb = '';
  for (const part of `${options.project}`.split('/').filter(Boolean)) {
    climb += `/${part}`;
    try {
      FS.chmod(climb, 0o777);
    } catch {
      /* a path the module does not hold is not this loop's business */
    }
  }
  for (const directory of ['/work', '/tmp', '/root', SESSION_ROOT, ...PAGE_OWNED_DIRECTORIES])
    try {
      FS.chmod(directory, 0o777);
    } catch {
      /* the session has already taken the ones it owns */
    }

  const files = moduleFiles(module);
  FS.chmod('/bw/datafiles', 0o755);
  await checkpoint('python-ready');
  await mountEssentials(files, digests['essentials.bin'], checkpoint, noteCache);
  const { request } = openSessionChannel(files, options);

  return {
    skew: 'emscripten',
    banner,
    files,
    request,
    // A VIEW, NOT A COPY. The arena is wasm linear memory and under
    // `-sPROXY_TO_PTHREAD` that memory is SHARED, so `session-frame.mts`
    // slices every column it reads out of here; this call itself is free.
    // A DIRECT ARENA (address 0) IS THE WHOLE HEAP, at its length now: the size the door reports
    // is `emscripten_get_heap_size()`, which is Blender's pthread's own view of the heap and is as
    // stale as this worker's was (measured: 431 MB while a column lay at 2.0 GB).
    readArena: async () => {
      const base = module._blender_web_export_buffer();
      return base === 0 ? heap() : heap().subarray(base, base + module._blender_web_export_buffer_size());
    },
    bootMs,
    memoryBytes: () => heap().length,
    releasedPayloadBytes,
  };
}

/** Assets are data, not a second engine. Ship them separately so a data update
 * does not relink the 86 MB Wasm binary. Both payload and per-file bounds are
 * checked before anything enters Blender's filesystem. */
async function mountEssentials(files: BlenderFiles, digest: string | undefined, checkpoint: (phase: string) => Promise<void>, noteCache: (text: string) => void): Promise<void> {
  const indexUrl = artifactUrl('essentials.json');
  const payloadUrl = artifactUrl('essentials.bin');
  const [indexResponse, payloadResponse] = await Promise.all([
    startupOperation(indexUrl, 'fetch Essentials index', () => fetch(indexUrl)), cachedArtifact('essentials.bin', digest, () => checkpoint('artifact/essentials.bin'), noteCache),
  ]);
  if (!indexResponse.ok || !payloadResponse.ok)
    throw new Error(`Blender Essentials assets are missing (${indexUrl}: HTTP ${indexResponse.status}; ${payloadUrl}: HTTP ${payloadResponse.status})`);
  const index = await startupOperation(indexUrl, 'decode Essentials index JSON', () => indexResponse.json()) as {
    bytes: number; sha256: string;
    files: { path: string; offset: number; bytes: number; sha256: string }[];
  };
  const payload = await startupOperation(payloadUrl, 'read Essentials payload body', () => payloadResponse.arrayBuffer());
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', payload)),
    (byte) => byte.toString(16).padStart(2, '0')).join('');
  if (payload.byteLength !== index.bytes || hash !== index.sha256)
    throw new Error('Blender Essentials payload does not match its source manifest');
  for (const file of index.files) {
    await checkpoint('essentials-file');
    if (!file.path || file.path.includes('\\') || file.path.split('/').some(p => !p || p === '.' || p === '..') ||
        !Number.isInteger(file.offset) || !Number.isInteger(file.bytes) ||
        file.offset < 0 || file.bytes < 0 || file.offset + file.bytes > payload.byteLength)
      throw new Error(`Invalid Blender Essentials file: ${file.path}`);
    const path = `/bw/datafiles/assets/${file.path}`;
    await files.mkdirTree(path.slice(0, path.lastIndexOf('/')));
    await files.writeFile(path, new Uint8Array(payload, file.offset, file.bytes));
  }
}
