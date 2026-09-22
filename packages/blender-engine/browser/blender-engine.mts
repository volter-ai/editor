/**
 * Headless Blender, running in the editor tab's worker -- THE SEAM, and the
 * choice of which Blender answers it.
 *
 * THE BLENDER IN THE TAB IS BLENDER (ARCHITECTURE-CORE, owner ruling
 * 2026-09-17), and since the 2026-09-18 amendment there are TWO BUILDS of it
 * and neither retires the other:
 *
 *   emscripten -- the STANDALONE skew. Blender in this worker's own module,
 *                 `@volter/editor-blender` with zero in-house dependencies. What the
 *                 package ships under `wasm/`.
 *   wali       -- the SUBSTRATE skew. The same Blender linked for
 *                 `wasm32-wali-linux-musl` and run as an ordinary Linux
 *                 program through `@volter/browser-wali`: argv, stdio, an
 *                 exit code, syscalls, a filesystem.
 *
 * ONE GATE, BOTH SKEWS: the scene battery passes on each at the same counts,
 * from the same `session.py`. A skew may REFUSE a capability by name; it may
 * not answer the same question differently. So this file is where the two
 * meet and everything above it -- `worker.ts`, `session-frame.mts`,
 * `blender-runtime-host.ts`, the presenter, the battery, the document -- is
 * written once.
 *
 * HOW THE SKEW IS CHOSEN: IT IS NOT. It is READ off the artifact this editor
 * serves, through the door that already exists for "is there a Blender here at
 * all" (`/__editor/blender-wasm/status`, `blender-wasm-artifact.ts`). One
 * editor serves one Blender; the served directory holds either a
 * `blender_browser.js` bundle or a `blender.wasm` beside its `runtime/` tree,
 * and that IS the answer. There is no manifest field, no setting and no flag,
 * because nothing a user does should depend on the skew -- if it did, the
 * skews would be answering differently, which the ruling forbids.
 * `VGAI_BLENDER_WASM_DIR` is the existing door for pointing the editor at a
 * different build and is how the substrate skew is reached in development.
 *
 * WHAT DIFFERS, and it is four things, all below this line:
 *   1. how the module is booted (a `--post-js` glue factory / a WALI program);
 *   2. where the session's `in`/`out`/`ask` files live (`Module.FS` / the
 *      program's filesystem);
 *   3. how the export door's arena is read (`HEAPU8` / the file
 *      `export_frame`'s `buffer_path` names -- see `readArena`);
 *   4. cross-origin isolation, which only the Emscripten build asks of the page.
 * Everything else, including the request/ask protocol below, is one
 * implementation over {@link BlenderFiles}.
 */

export const SESSION_ROOT = '/work/.vgai-session';
export const SESSION_SCRIPT = `${SESSION_ROOT}/session.py`;

/**
 * THE TWO CHANNEL DIRECTORIES THIS PAGE OWNS, and the reason they are a
 * constant instead of two literals per engine.
 *
 * ONE WRITER PER DIRECTORY is the channel's ownership rule (see
 * {@link openSessionChannel}), and a directory's owner is also the side that
 * CREATES it: `in/` and `reply/` are made here, before the program starts;
 * `out/` and `ask/` are made by `session.py`, which owns them. An engine that
 * pre-created all four put a guest `mkdir`/`chmod` on a path the page had
 * already touched, which is the same crossing edit at a smaller scale.
 */
export const PAGE_OWNED_DIRECTORIES = [`${SESSION_ROOT}/in`, `${SESSION_ROOT}/reply`] as const;

/** Which build of Blender this editor serves. */
export type BlenderSkew = 'emscripten' | 'wali';

export interface BlenderFileStat {
  size: number;
  /** The raw mode, S_IFDIR and all: `listModuleFiles` reads the type bits. */
  mode: number;
  mtimeMs: number;
}

/**
 * The session's filesystem, as the one shape everything above the seam uses.
 *
 * ASYNCHRONOUS BECAUSE ONE SKEW CANNOT BE OTHERWISE: on WALI the tree lives in
 * a `BrowserFileSystem` whose bytes are a promise by contract. The Emscripten
 * side answers from `Module.FS` and resolves immediately.
 *
 * `stat` ANSWERS NULL FOR AN ABSENT PATH rather than throwing. The poll loop
 * asks "is the answer there yet" thousands of times per call, and the version
 * of this that threw sorted a genuine failure from an expected absence by
 * matching `/ENOENT|no such|FS error|errno/i` against the message -- a filter
 * that swallows any real error whose text happens to say "errno".
 */
export interface BlenderFiles {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: string | Uint8Array): Promise<void>;
  mkdirTree(path: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  /** Null when the path is not there. */
  stat(path: string): Promise<BlenderFileStat | null>;
  unlink(path: string): Promise<void>;
}

export interface BlenderEngineOptions {
  /** The project's absolute path; the engine's filesystem mirrors it there. */
  project: string;
  log(level: 'log' | 'error', text: string): void;
  /** What the session asks the TAB for, mid-call: a frame, and sometimes a
   *  photograph of it. Whatever this resolves to is what Python receives.
   *
   *  `saveDue` rides BESIDE the frame (the frame's own schema is the
   *  presenter's): this present left the session's `.blend` behind the model,
   *  and whoever answers owes it a save once the session goes idle. */
  ask(payload: { frame: unknown; capture?: unknown; saveDue?: boolean }): Promise<unknown>;
}

export interface BlenderEngine {
  /** Which build answered. Reported out of `blender-start`, because a number
   *  that differs between the skews is a defect in one of them and the board
   *  has to be able to say which one it measured. */
  readonly skew: BlenderSkew;
  readonly banner: { blender: string; engines: string[] };
  /** The session's filesystem. */
  readonly files: BlenderFiles;
  /** One request, one answer. Rejects with the session's own error text. */
  request(payload: Record<string, unknown>): Promise<unknown>;
  /**
   * THE LAST FRAME'S EXPORT ARENA, whole, offset zero at the arena's base.
   *
   * The one call whose implementation the skews do not share, and the reason
   * is worth the paragraph. `bpy_web_export.cc` writes every column of a frame
   * into a side arena and the JSON frame names each one `{offset, length,
   * dtype, count, stride}` -- no descriptor of the arena itself, because
   * "natively the path is the caller's own string". On Emscripten the arena is
   * in the module's linear memory and the C exports name it, so this is a view
   * on `HEAPU8` and costs nothing. Under WALI the module's memory is in a
   * worker the host cannot reach, and does not need to: `export_frame`'s
   * `buffer_path` option already writes the same bytes to a file, so this
   * reads that file. `session-frame.mts` is handed the bytes and never learns
   * which it got.
   *
   * VALID UNTIL THE NEXT `export_frame`, on both skews.
   */
  readArena(): Promise<Uint8Array>;
  /** Milliseconds from the first byte of the artifact to the session's ready line. */
  readonly bootMs: number;
  /** The engine's memory in bytes, now. Linear memory on the standalone skew;
   *  null where the skew cannot see the module's memory from the host, which
   *  is the WALI case and is why `vgai status` prints "unreported" rather than
   *  a zero. */
  memoryBytes(): number | null;
  /** Bytes of packed `.data` payload handed back after boot, or null when the
   *  build has no packed payload to release (every WALI boot) or no release
   *  door. Reported out of `blender-start` because an action whose success is
   *  otherwise invisible has to say so somewhere a caller reads. */
  readonly releasedPayloadBytes: number | null;
}

export const ARTIFACT_BASE = '/__editor/blender-wasm';

/**
 * An artifact URL, resolved against THE MODULE — never against `self.location`.
 *
 * A worker's `location` is where its SCRIPT was loaded from, and that is not
 * always an http url of this editor: when the page is a frame this editor does
 * not own (the Code-OSS workbench, docs/CODE-OSS.md §Boot, DESKTOP), a
 * cross-origin worker can only be constructed through a same-origin `blob:`
 * doorway, so `self.location.href` reads `blob:vscode-file://vscode-app/<uuid>`
 * — an opaque base against which `new URL('/__editor/...', base)` THROWS
 * `TypeError: Invalid URL`. Measured 2026-09-19: that is what `blender-start`
 * answered on the desktop shape once its message reached the worker at all.
 *
 * `import.meta.url` is this module's own url and is always the http one the
 * editor served, whatever loaded the worker. Every artifact url is built from
 * it, and nothing here reads `self.location`.
 */
export function artifactUrl(file: string): string {
  return new URL(`${ARTIFACT_BASE}/${file}`, import.meta.url).href;
}

/** What the editor's artifact door answers. `blender-wasm-artifact.ts` owns it. */
export interface BlenderArtifactStatus {
  available: boolean;
  /** Which build the served directory holds; null when nothing is served. */
  skew: BlenderSkew | null;
  dir: string | null;
  sizes: Record<string, number>;
  encoded: Record<string, 'br'>;
  /** Why it is unavailable, named. Empty when it is available. */
  missing: string[];
  /** WALI only: the `sha256-` SRI of `blender.wasm`, which the program loader
   *  requires for any non-blob URL. */
  integrity?: string;
  /** WALI only: how many workers the program's host pool gets, and how many
   *  Blender itself is told to use (`blender -t N`). */
  workers?: { pool: number; blender: number };
}

export async function artifactStatus(): Promise<BlenderArtifactStatus> {
  const answer = await fetch(artifactUrl('status'));
  if (!answer.ok)
    return {
      available: false,
      skew: null,
      dir: null,
      sizes: {},
      encoded: {},
      missing: [`${ARTIFACT_BASE}/status answered ${answer.status}`],
    };
  return (await answer.json()) as BlenderArtifactStatus;
}

/**
 * Boot the Blender this editor serves and hold it as a long-lived session.
 *
 * The two implementations are reached by DYNAMIC IMPORT and that is load
 * bearing, not style: the WALI engine reaches `@volter/browser-wali` and
 * `@volter/browser-runtime`, and the standalone skew must not pay for them.
 * A module never imported is never fetched, and `blender-wali-engine.mts`
 * names no package at all -- it imports the substrate from URLs this same
 * editor serves, exactly as the Emscripten engine fetches its glue. So the
 * standalone skew's dependency on browser-substrate is zero in the package
 * manifest, zero in the module graph, and zero on the wire.
 */
export async function startBlenderEngine(options: BlenderEngineOptions): Promise<BlenderEngine> {
  const status = await artifactStatus();
  if (!status.available)
    throw new Error(
      `The headless Blender WebAssembly build is not served by this editor: ${status.missing.join('; ')}`,
    );
  if (status.skew === 'wali') {
    const { startWaliBlenderEngine } = await import('./blender-wali-engine.mts');
    return startWaliBlenderEngine(options, status);
  }
  const { startEmscriptenBlenderEngine } = await import('./blender-emscripten-engine.mts');
  return startEmscriptenBlenderEngine(options, status);
}

/** The poll cadence: tight while a call is young, then backing off so a
 *  ten-minute bake does not spend ten minutes of main-thread wakeups. */
function pollDelay(elapsedMs: number): number {
  if (elapsedMs < 200) return 1;
  if (elapsedMs < 5_000) return 5;
  return 25;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const decoder = new TextDecoder();

/**
 * THE DIRECTORY CHANNEL, written once for both skews.
 *
 * `session.py`'s header states the other half and says why it is a directory
 * rather than stdin. Nothing here is toolchain-specific: a request is
 * `in/<id>.json` then `in/<id>.done`, an answer is `out/<id>.json` +
 * `out/<id>.done`, and an `ask` the session raises mid-call is served from
 * inside this poll loop -- which is why `saveDocument` cannot be raised from
 * Python's idle loop (`worker.ts` holds that clock).
 *
 * ONE WRITER PER DIRECTORY. This is the channel's single structural rule and
 * it is what keeps the WALI skew alive for a whole session:
 *
 *     in/     the PAGE writes and the PAGE unlinks; the guest only reads.
 *     out/    the GUEST writes and the GUEST unlinks; the page only reads.
 *     ask/    the GUEST writes and the GUEST unlinks; the page only reads.
 *     reply/  the PAGE writes and the PAGE unlinks; the guest only reads.
 *
 * WHY IT IS STRUCTURAL AND NOT A TUNING. Under WALI the two sides are two
 * snapshot-backed views of one tree, reconciled by patches: the guest sends
 * the paths IT changed, and `applyProcessFilesystemPatch` refuses the patch
 * (`assertPatchBase`) when a path in it no longer holds what the guest's base
 * said -- after which the host TERMINATES the program's worker. A path can
 * only disagree if somebody other than the patch's author moved it. So with
 * the sets of paths the two sides mutate DISJOINT, the assertion has nothing
 * left to fire on. MEASURED 2026-09-19 (WS-X): with this page unlinking four
 * files in the guest's own `out/` after every answer, a render loop died at
 * call 37 (`base`: a file, `current`: null) and at call 14 (a different
 * mtime), and narrowing the window moved the death 1 -> 13 -> 37 without
 * closing it.
 *
 * THE ACK IS THE REQUEST FILE'S DISAPPEARANCE, so it costs no file and no
 * extra write. Each side needs to know when the other has taken what it left:
 *
 *   - this page unlinks `in/<id>.json` and then `in/<id>.done` ONLY after it
 *     has read `out/<id>.json`. So `in/<id>.done` being gone IS "the page
 *     took the answer" -- a fact the guest reads out of a directory it never
 *     writes to, from the `listdir` its loop already does. It then removes
 *     its own `out/<id>.*`.
 *   - the session unlinks `ask/<id>.json` and then `ask/<id>.done` only after
 *     it has read `reply/<id>.json`, so `ask/<id>.done` being gone is "the
 *     guest took the reply" -- read here out of the `readdir` `serveAsks`
 *     already does, after which this page removes its own `reply/<id>.*`.
 *
 * `.done` IS ALWAYS UNLINKED LAST, on both sides, because `.done` is the
 * token the other side watches: a `.done` without its `.json` would be a
 * half-visible message.
 *
 * NOTHING HERE CATCHES ITS OWN UNLINK. These are files this page wrote into a
 * directory nothing else writes to; an ENOENT would mean the ownership rule
 * had been broken, and the loud failure of the call that found it is the
 * proof the rule holds.
 */
export function openSessionChannel(
  files: BlenderFiles,
  options: BlenderEngineOptions,
  /**
   * WHY THE POLL LOOP NEEDS A LIVENESS PREDICATE, and it is the difference
   * between a board and a wasted afternoon.
   *
   * The loop below waits for `out/<id>.done` and nothing else. When the
   * program behind the directory DIES, that file is never written, so the
   * call waits forever: `vgai status` reports it IN FLIGHT for as long as
   * anyone looks, `blender-start` keeps answering from the host's cached
   * banner, and the harness has no answer to time out against. MEASURED
   * 2026-09-19 three times on the WALI skew -- 507 s, 621 s and 964 s of a
   * battery model spent waiting on a Blender that had already ended with
   * `[object WebAssembly.Exception]`, each ending in a killed process and no
   * result record at all.
   *
   * This returns null while the program is alive and the reason it ended
   * otherwise. A caller that supplies one turns that infinite wait into a
   * named failure naming the recovery door. The standalone skew supplies
   * none: its module is the worker, so a death there ends the worker rather
   * than stranding a reader, and inventing a predicate for a failure nobody
   * has measured would be a fiction.
   */
  programEnded?: () => string | null,
): {
  request(payload: Record<string, unknown>): Promise<unknown>;
} {
  let sequence = 0;
  let asking = 0;
  /** Asks this page has answered whose `reply/<id>.*` it still owes a cleanup
   *  -- cleared as each `ask/<id>.done` disappears. */
  const replied = new Set<string>();

  /** THE GUEST'S ACK: its own `ask/<id>.done` is gone, so it has read the
   *  reply and this page may retire the two files IT wrote. `.done` last. */
  async function retireReplies(raised: ReadonlySet<string>): Promise<void> {
    for (const id of replied) {
      if (raised.has(`${id}.done`)) continue;
      await files.unlink(`${SESSION_ROOT}/reply/${id}.json`);
      await files.unlink(`${SESSION_ROOT}/reply/${id}.done`);
      replied.delete(id);
    }
  }

  /** Answer any `ask` the session has raised, and retire the replies it has
   *  taken. Called from the poll loop, so a present raised inside a call is
   *  served while that call is outstanding. */
  async function serveAsks(): Promise<void> {
    let names: string[];
    try {
      names = await files.readdir(`${SESSION_ROOT}/ask`);
    } catch {
      return;
    }
    const raised = new Set(names.filter((name) => name.endsWith('.done')));
    await retireReplies(raised);
    for (const name of raised) {
      const id = name.slice(0, -'.done'.length);
      if (Number(id) <= asking) continue;
      asking = Number(id);
      const payload = JSON.parse(
        decoder.decode(await files.readFile(`${SESSION_ROOT}/ask/${id}.json`)),
      ) as { frame: unknown; capture?: unknown; saveDue?: boolean };
      let answer: unknown;
      try {
        answer = await options.ask(payload);
      } catch (error) {
        answer = { error: error instanceof Error ? error.message : String(error) };
      }
      await files.writeFile(`${SESSION_ROOT}/reply/${id}.json`, JSON.stringify(answer ?? null));
      await files.writeFile(`${SESSION_ROOT}/reply/${id}.done`, '1');
      replied.add(id);
    }
  }

  async function request(payload: Record<string, unknown>): Promise<unknown> {
    const id = String(++sequence);
    await files.writeFile(`${SESSION_ROOT}/in/${id}.json`, JSON.stringify(payload));
    await files.writeFile(`${SESSION_ROOT}/in/${id}.done`, '1');
    const began = performance.now();
    for (;;) {
      await serveAsks();
      if (await files.stat(`${SESSION_ROOT}/out/${id}.done`)) {
        const body = JSON.parse(
          decoder.decode(await files.readFile(`${SESSION_ROOT}/out/${id}.json`)),
        ) as { result?: unknown; error?: string };
        // THE PAGE UNLINKS WHAT THE PAGE WROTE, AND ONLY THAT. `out/<id>.*`
        // is the session's to remove; this loop does not touch it. Doing so
        // is what killed a WALI session mid-run (see the ownership rule
        // above): the guest's patch for `out/<id>.done` crossed this page's
        // unlink of it, `assertPatchBase` refused the patch, and the host
        // terminated the program's worker -- no guest exit path ran, which is
        // why every instrument on `SYS_exit` was silent through it.
        //
        // These two unlinks are also the ACK. The session watches for
        // `in/<id>.done` to vanish and takes that as "the page has the
        // answer", so `.done` goes last and neither is attempted before
        // `out/<id>.json` has been read.
        await files.unlink(`${SESSION_ROOT}/in/${id}.json`);
        await files.unlink(`${SESSION_ROOT}/in/${id}.done`);
        if (body.error) throw new Error(body.error);
        return body.result;
      }
      const ended = programEnded?.();
      if (ended)
        throw new Error(
          `Blender is gone, so this call will never be answered: ${ended}. ` +
            'The session keeps its directory and its cached banner, so every later call would ' +
            'wait on the same missing answer; start a new program with `blender-start {fresh: true}` ' +
            '(`VGAI_BLENDER_FRESH_SESSION=1` for the battery harness).',
        );
      await sleep(pollDelay(performance.now() - began));
    }
  }

  return { request };
}
