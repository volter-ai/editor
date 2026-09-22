/**
 * The SUBSTRATE skew: Blender as an ordinary Linux program.
 *
 * `blender-engine.mts` is the seam and says how the skew is chosen; this is
 * its other implementation. The artifact is one `blender.wasm` linked for
 * `wasm32-wali-linux-musl` (browser-substrate `programs/blender/5.2.0`) and it
 * runs through `@volter/browser-wali`'s `BrowserWaliWorkerProgram`: argv,
 * stdio, an exit code, syscalls, a filesystem. There is no glue file, no
 * `Module`, and nothing for this page to be cross-origin isolated FOR beyond
 * what the substrate's own pthreads need.
 *
 * NOTHING HERE NAMES A PACKAGE, and that is the standalone skew's guarantee
 * made structural rather than promised. `@volter/editor-blender` declares no
 * dependency on browser-substrate, and a bundler walking this file finds no
 * specifier to resolve: the substrate arrives as MODULES THIS EDITOR SERVES,
 * from the same directory it serves `blender.wasm` out of, exactly as the
 * standalone engine fetches and evaluates its glue from
 * `/__editor/blender-wasm/blender_browser.js`. A mode-A consumer installs
 * nothing extra, downloads nothing extra, and never reaches this module --
 * `startBlenderEngine` imports it only when the served artifact IS the WALI
 * one.
 *
 * THE FOUR EMSCRIPTEN SURFACES, AND THIS SKEW'S ANSWER TO EACH
 * (browser-substrate `programs/blender/5.2.0/README.md`, "The four
 * Emscripten-specific surfaces"):
 *   cross-origin isolation -> the substrate's own requirement, answered by the
 *       page that already carries the headers for the other skew;
 *   a server-patched glue   -> there is none; the artifact is one `.wasm`,
 *       loaded by URL under a pinned `sha256-` integrity;
 *   `Module.FS`             -> the program's `BrowserFileSystem`, held here in
 *       the page's own realm, whose writes reach a RUNNING program as ordered
 *       filesystem patches (which is why the directory channel works at all);
 *   `HEAPU8` for the arena  -> the module's linear memory is in a worker this
 *       host cannot reach and DOES NOT NEED TO. `export_frame`'s `buffer_path`
 *       already writes the arena to a file; see `readArena` below.
 *
 * WHAT IT REFUSES, by name, and none of it is this file's to soften: no GPU of
 * any kind (headless, Cycles on the CPU), and no `_ssl`, `_ctypes`,
 * `_multiprocessing` or subprocesses in the embedded interpreter. The editor
 * renders three.js photographs through the export door, so it asks Cycles for
 * nothing.
 */

import {
  ARTIFACT_BASE,
  artifactUrl,
  type BlenderArtifactStatus,
  type BlenderEngine,
  type BlenderEngineOptions,
  type BlenderFiles,
  openSessionChannel,
  PAGE_OWNED_DIRECTORIES,
  SESSION_ROOT,
  SESSION_SCRIPT,
  sleep,
} from './blender-engine.mts';
import sessionPython from './session.py?raw';

/** Blender's own resource root inside the program, spelled the same way the
 *  standalone skew spells it so `BLENDER_SYSTEM_*` reads identically. */
const RESOURCES = '/bw';
/** Where this engine asks the export door to leave the arena. Inside the
 *  session's own root, because it belongs to the session's lifetime. */
const ARENA_PATH = `${SESSION_ROOT}/frame.bin`;

/** The host filesystem seam, in the only shape this file uses. */
interface BrowserFileSystemLike {
  existsSync(path: string): boolean;
  statSync(path: string): { isDirectory(): boolean; size: number; mode: number; mtimeMs: number };
  readFile(path: string): Promise<Uint8Array>;
  writeFileSync(path: string, data: string | Uint8Array): void;
  mkdirSync(path: string, options?: { recursive?: boolean }): void;
  readdirSync(path: string): string[];
  unlinkSync(path: string): void;
}

interface WaliProgram {
  run(
    argv: readonly string[],
    options: {
      onStdout?(chunk: string): void;
      onStderr?(chunk: string): void;
      /** The WALI RUNTIME's own word to its host, not the program's stream --
       *  today the one-shot notice that an unimplemented syscall was answered
       *  `-ENOSYS` instead of trapping. Declared here because the call site
       *  passes it (`run(...)` below) and this local shape is the only thing
       *  that types that call. */
      onDiagnostic?(message: string): void;
    },
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  terminate(): void;
}

interface RuntimeIndex {
  files: { path: string; size: number; mode: number }[];
}

/** The substrate, as modules this editor serves. `@vite-ignore` because the
 *  specifier is a URL computed here: there is deliberately no specifier for a
 *  bundler to resolve, so the standalone build's graph cannot contain it. */
async function substrate(module: string): Promise<Record<string, unknown>> {
  const url = artifactUrl(`wali/${module}`);
  try {
    return (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `The substrate skew needs ${module}, which this editor serves from the WALI pack ` +
        `directory beside blender.wasm (${url}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Blender's runtime tree — its scripts, datafiles and Python — into the
 * program's filesystem.
 *
 * ONE INDEX AND ONE BLOB, not 2,276 requests. The tree is 78 MB in ~2,300
 * files and every one of them has to exist before Blender's first act, so the
 * editor serves a JSON index and the bytes concatenated in its order
 * (`blender-wasm-artifact.ts`); this walks the index and slices. The
 * standalone skew's equivalent is the packed `.data` payload, and this is the
 * same shape for a filesystem that is not a module's.
 */
async function stageRuntime(
  filesystem: BrowserFileSystemLike,
  log: BlenderEngineOptions['log'],
): Promise<{ files: number; bytes: number; ms: number }> {
  const began = performance.now();
  const indexAnswer = await fetch(artifactUrl('runtime.idx'));
  if (!indexAnswer.ok)
    throw new Error(`${ARTIFACT_BASE}/runtime.idx answered ${indexAnswer.status}`);
  const index = (await indexAnswer.json()) as RuntimeIndex;
  const blobAnswer = await fetch(artifactUrl('runtime.bin'));
  if (!blobAnswer.ok) throw new Error(`${ARTIFACT_BASE}/runtime.bin answered ${blobAnswer.status}`);
  const blob = new Uint8Array(await blobAnswer.arrayBuffer());
  let offset = 0;
  for (const entry of index.files) {
    // ONE PAST THE BLOB IS AN ERROR NAMING THE FILE. An index and a blob that
    // disagree would otherwise write silently truncated Python.
    if (offset + entry.size > blob.byteLength)
      throw new Error(
        `Blender runtime ${entry.path}: bytes ${offset}..${offset + entry.size} lie outside ` +
          `the ${blob.byteLength}-byte runtime blob`,
      );
    const path = `${RESOURCES}/${entry.path}`;
    filesystem.mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
    filesystem.writeFileSync(path, blob.subarray(offset, offset + entry.size));
    offset += entry.size;
  }
  if (offset !== blob.byteLength)
    throw new Error(
      `Blender runtime index accounts for ${offset} of the ${blob.byteLength} bytes served`,
    );
  const ms = Math.round(performance.now() - began);
  log('log', `blender: staged Blender's ${index.files.length}-file runtime tree in ${ms} ms`);
  return { files: index.files.length, bytes: blob.byteLength, ms };
}

/** The program's filesystem, as {@link BlenderFiles}. */
function programFiles(filesystem: BrowserFileSystemLike): BlenderFiles {
  return {
    readFile: (path) => filesystem.readFile(path),
    writeFile: async (path, data) => filesystem.writeFileSync(path, data),
    mkdirTree: async (path) => filesystem.mkdirSync(path, { recursive: true }),
    readdir: async (path) => filesystem.readdirSync(path),
    stat: async (path) => {
      if (!filesystem.existsSync(path)) return null;
      const info = filesystem.statSync(path);
      // `listModuleFiles` reads S_IFDIR out of the mode; the seam's stat
      // carries the raw mode and this filesystem's is permissions only.
      return {
        size: info.size,
        mode: (info.mode & 0o7777) | (info.isDirectory() ? 0o040000 : 0o100000),
        mtimeMs: info.mtimeMs,
      };
    },
    unlink: async (path) => filesystem.unlinkSync(path),
  };
}

export async function startWaliBlenderEngine(
  options: BlenderEngineOptions,
  status: BlenderArtifactStatus,
): Promise<BlenderEngine> {
  const started = performance.now();
  const [wali, runtime] = await Promise.all([
    substrate('browser-wali/worker-program.js'),
    substrate('browser-runtime/browser-memory-filesystem.js'),
  ]);
  const WaliWorkerProgram = wali['BrowserWaliWorkerProgram'] as
    | (new (
        filesystem: unknown,
        program: Record<string, unknown>,
      ) => WaliProgram)
    | undefined;
  const MemoryFileSystem = runtime['BrowserMemoryFileSystem'] as
    | (new () => BrowserFileSystemLike)
    | undefined;
  if (!WaliWorkerProgram || !MemoryFileSystem)
    throw new Error(
      'The substrate modules this editor served do not export BrowserWaliWorkerProgram and ' +
        'BrowserMemoryFileSystem; the WALI pack directory holds a browser-substrate this engine ' +
        'does not know.',
    );

  const filesystem = new MemoryFileSystem();
  // `out` and `ask` are deliberately absent: `session.py` owns those two and
  // makes them itself (the channel's ownership rule in `blender-engine.mts`).
  // Everything here is written before the program starts, so all of it is in
  // the base the guest's own patches are checked against.
  for (const directory of [
    '/tmp',
    '/root',
    '/work',
    SESSION_ROOT,
    ...PAGE_OWNED_DIRECTORIES,
    options.project,
  ])
    filesystem.mkdirSync(directory, { recursive: true });
  await stageRuntime(filesystem, options.log);
  filesystem.writeFileSync(SESSION_SCRIPT, sessionPython);

  const workers = status.workers ?? { pool: 16, blender: 4 };
  const program = new WaliWorkerProgram(filesystem, {
    url: artifactUrl('blender.wasm'),
    // The program loader refuses any non-blob URL without a pinned digest, so
    // the session names the exact bytes it ran. `blender-wasm-artifact.ts`
    // computes it from the file it is about to serve.
    ...(status.integrity ? { integrity: status.integrity } : {}),
    cwd: '/work',
    env: {
      HOME: '/root',
      TMPDIR: '/tmp',
      PATH: '/usr/bin:/bin',
      BLENDER_SYSTEM_RESOURCES: RESOURCES,
      BLENDER_SYSTEM_SCRIPTS: `${RESOURCES}/scripts`,
      BLENDER_SYSTEM_DATAFILES: `${RESOURCES}/datafiles`,
      BLENDER_SYSTEM_PYTHON: `${RESOURCES}/python`,
      // PYTHONHOME IS DELIBERATELY UNSET, following the pack's own gate:
      // Blender points `PyConfig` at its bundled python directory itself, and
      // a PYTHONHOME here would be a second answer to the same question.
      // PYTHONPATH is the other half of statement (b): `<prefix>/lib/
      // python313.zip` is the only zip CPython's getpath composes, so numpy
      // and the wheels sit beside it unreachable until they are named -- and
      // `--python-use-system-env` below is what makes Blender read the
      // variable at all.
      PYTHONPATH: `${RESOURCES}/python/lib/numpy313.zip:${RESOURCES}/python/lib/wheels313.zip`,
      VGAI_SESSION_ROOT: SESSION_ROOT,
      // THE ARENA'S DOOR ON THIS SKEW. See `readArena`.
      VGAI_EXPORT_BUFFER_PATH: ARENA_PATH,
    },
    threadPoolSize: workers.pool,
    // Blender talks to nothing. The editor's own routes are this worker's, not
    // the program's.
    network: { allowedHosts: [], maxConnections: 0, maxBytes: 0 },
  });

  let readyLine: string | null = null;
  let ended: string | null = null;
  const say = (text: string) => {
    for (const line of text.split('\n')) {
      if (line === '') continue;
      if (line.startsWith('@@VGAI-READY ')) readyLine = line.slice('@@VGAI-READY '.length);
      // BLENDER'S OWN STREAMS ARE PAGE OUTPUT, NOT EDITOR-CONSOLE CONDITIONS
      // -- the same rule as the standalone engine, and for the same measured
      // reason: only the session's own named conditions belong in the set an
      // agent must drive to zero.
      options.log(
        line.startsWith('@@VGAI-WARN') || line.startsWith('@@VGAI-ERROR') ? 'error' : 'log',
        line,
      );
    }
  };
  // THE PROGRAM DOES NOT RETURN. `session.py` loops forever, so `run` settles
  // only when Blender dies or the session is torn down -- which makes it the
  // one place a crash is visible. It is a NAMED CONDITION, because a session
  // whose Blender has exited answers every later call with a timeout and
  // nothing else says why.
  void program
    .run(
      [
        '/blender',
        '-b',
        '--factory-startup',
        '-noaudio',
        // Statement (b): without this Blender's pre-config is isolated and
        // ignores the PYTHONPATH above, so `import numpy` fails inside a
        // Blender whose numpy is built in. The flag reads no stranger's
        // environment here; every variable in this program is the one above.
        '--python-use-system-env',
        '-t',
        String(workers.blender),
        '--python',
        SESSION_SCRIPT,
      ],
      {
        onStdout: say,
        onStderr: say,
        // NOT Blender's stream, and that is exactly why this one IS a named
        // condition where `say` is page output. `onDiagnostic` is the WALI
        // runtime's own word to its host -- today, the one-shot notice that an
        // unimplemented syscall was answered `-ENOSYS` instead of trapping
        // (`@volter/browser-wali`'s `runtime.ts`). Answering like a kernel is
        // only defensible because the CALLER can degrade VISIBLY; without this
        // the degrade is silent, and before it existed the notice reached a
        // nested worker's devtools console and nothing else.
        onDiagnostic: (message: string) => options.log('error', `@@VGAI-ERROR ${message}`),
      },
    )
    .then(
      (result) => {
        ended = `Blender exited ${result.exitCode}`;
      },
      (error) => {
        ended = error instanceof Error ? error.message : String(error);
      },
    )
    .finally(() => {
      if (ended !== null) options.log('error', `@@VGAI-ERROR the Blender program ended: ${ended}`);
    });

  while (readyLine === null) {
    if (ended !== null) throw new Error(`Blender never reached its session: ${ended}`);
    await sleep(5);
  }
  const bootMs = performance.now() - started;
  const banner = JSON.parse(readyLine) as { blender: string; engines: string[] };
  options.log(
    'log',
    `blender: the substrate skew is up (${workers.blender} Blender threads in a pool of ` +
      `${workers.pool}; Blender is SERIAL without -t N and says so)`,
  );

  const files = programFiles(filesystem);
  // `ended` is set by the `run` promise above -- the one place a crash is
  // visible on this skew. Handing it to the channel is what stops a dead
  // program from turning every later call into an unbounded wait.
  const { request } = openSessionChannel(files, options, () => ended);

  return {
    skew: 'wali',
    banner,
    files,
    request,
    // THE ARENA THROUGH ITS FILE, which is this skew's native door and not a
    // fallback: the module's linear memory lives in a worker with no memory
    // door, and `export_frame` wrote the same bytes to `buffer_path` before
    // the ask that brought us here. Ordering is the correctness argument and
    // `session.py` states it beside the write: the program's mutations reach
    // this host as one ORDERED stream of filesystem patches, so anything that
    // carried `ask/<id>.done` out carried the arena with it or before it.
    readArena: () => filesystem.readFile(ARENA_PATH),
    bootMs,
    // The module's memory is the program worker's and no door reports it.
    // Null rather than zero: `vgai status` prints "unreported", which is true,
    // where a zero would be a measurement that was never taken.
    memoryBytes: () => null,
    // There is no packed payload on this skew: Blender's runtime tree is
    // ordinary files in the program's filesystem, staged above.
    releasedPayloadBytes: null,
  };
}
