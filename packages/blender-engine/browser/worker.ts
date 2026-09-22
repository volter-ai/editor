/**
 * THE BLENDER IN THE TAB IS BLENDER (ARCHITECTURE-CORE, owner ruling
 * 2026-09-17): the editor's modeling engine is Blender 5.2 LTS compiled to
 * WebAssembly, running headless in this worker (`blender-engine.mts`), with
 * `session.py` as its one door and three.js as its renderer. The artifact is
 * served by the editor (`/__editor/blender-wasm/*`, `blender-wasm-artifact.ts`);
 * when it is not served, `start` refuses BY NAME. There is no other engine.
 *
 * NOTHING HERE KNOWS WHICH SKEW ANSWERED. Since the 2026-09-18 amendment there
 * are two builds -- the standalone Emscripten module and Blender as a WALI
 * program on browser-substrate -- and `blender-engine.mts` is where they meet.
 * Above that seam this file uses `engine.files`, `engine.readArena()` and
 * `engine.memoryBytes()` and could not tell them apart; ONE GATE, BOTH SKEWS
 * is what that buys.
 *
 * Nothing here touches a server beyond the editor's own routes. A frame
 * leaves through `present` to the Model document; a photograph comes back the
 * same way. The project's own files are staged into the engine's filesystem
 * before every call, and what the session writes is mirrored back out by the
 * transport (`list-files`/`read-file`).
 *
 * THE DOCUMENT'S DEBOUNCE LIVES HERE, because this is the only side of the
 * session that has a clock. Python's loop cannot ask the tab for anything
 * while it is idle — `serveAsks` only runs inside a request's poll loop, so an
 * `ask` raised between calls is never answered and wedges the Blender pthread.
 * So the session marks a present `saveDue`, this file waits out one idle
 * second, calls `save-document` as an ordinary request (which Python's loop
 * picks up BETWEEN calls, never mid-call), and carries the bytes to the
 * project through `/__editor/blender-document`.
 *
 * WHY THE CARRY IS NOT THE MIRROR'S JOB (`vgai blender-mcp`, class Mirror):
 * the Mirror is pull-based and runs only after an `execute_blender_code`, so
 * a document saved one idle second after the LAST call of a modeling session
 * would never leave the worker — which is exactly the state this closes
 * ("closing the tab loses the model"). The Mirror still lists and mirrors the
 * same file in the MCP lane; it just is not what persistence depends on.
 */
/// <reference types="vite/client" />

import { type BlenderEngine, type BlenderFiles, startBlenderEngine } from './blender-engine.mts';
import type { CaptureRequest, FileEntry, WorkerReply, WorkerRequest } from './protocol';
import { columnsToTypedArrays, describeFrame } from './session-frame.mts';

const post = (reply: WorkerReply) => (self as unknown as Worker).postMessage(reply);
const log = (level: 'log' | 'error', text: string) => post({ op: 'log', level, text });

interface Session {
  start(project: string): Promise<unknown>;
  execute(code: string): Promise<unknown>;
  sceneInfo(): Promise<unknown>;
  objectInfo(name: string): Promise<unknown>;
  screenshotView(maxSize: number): Promise<unknown>;
}
let session: Session | null = null;
/** The project this session is rooted at, for the per-call project sync. */
let projectRoot: string | null = null;
let presentId = 0;
/** What the tab answered a present with: the capture it produced, and the
 *  presenter's own report of what it HELD before the frame (`protocol.ts`). */
interface PresentAnswer {
  capture?: unknown;
  held?: { session: string; revision: number } | null;
}
const pendingPresents = new Map<
  number,
  { resolve: (value: PresentAnswer) => void; reject: (error: Error) => void }
>();

function presentToTab(
  frame: unknown,
  description: unknown,
  capture?: CaptureRequest,
): Promise<PresentAnswer> {
  const id = ++presentId;
  // A drawn mesh's buffers move to the tab rather than being copied: the
  // frame is the tab's from here on.
  const transfer: ArrayBuffer[] = [];
  // A picture travels the same way and for the same reason: an entry in the
  // frame's `images` carries a raw RGBA raster the tab uploads into a
  // `DataTexture` (`blender-runtime-view.ts`), once per image per revision.
  const parts = frame as {
    meshes?: Record<string, unknown>;
    images?: Record<string, unknown>;
  } | null;
  for (const carrier of [parts?.meshes ?? {}, parts?.images ?? {}])
    for (const held of Object.values(carrier))
      for (const value of Object.values(held as Record<string, unknown>))
        if (
          ArrayBuffer.isView(value) &&
          value.buffer instanceof ArrayBuffer &&
          !transfer.includes(value.buffer)
        )
          transfer.push(value.buffer);
  return new Promise((resolve, reject) => {
    pendingPresents.set(id, { resolve, reject });
    (self as unknown as Worker).postMessage(
      {
        op: 'present',
        id,
        frame,
        description,
        ...(capture ? { capture } : {}),
      } satisfies WorkerReply,
      transfer,
    );
  });
}

let engine: BlenderEngine | null = null;

// ---- The session's document.
//
// One session, one `.blend`. `documentPath` is the PROJECT-RELATIVE spelling —
// the only one that crosses to the server, which joins it to its own root so
// no host path is ever on the wire.
let documentPath: string | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** Calls the tab is waiting on. A save waits for zero. */
let callsInFlight = 0;

/** The idle second. One save per second of quiet, however many presents
 *  arrived during it: the timer is RESET by each, so a script presenting in a
 *  tight loop writes the document once, when it stops. */
const DOCUMENT_SAVE_IDLE_MS = 1_000;

function armDocumentSave(): void {
  if (documentPath === null) return;
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void saveDocument();
  }, DOCUMENT_SAVE_IDLE_MS);
}

/**
 * Save the document and land it in the project.
 *
 * NEVER MID-CALL: a call still outstanding means a script is running, and its
 * half-built model is not the document. The timer re-arms instead of writing.
 */
async function saveDocument(): Promise<void> {
  if (!engine || documentPath === null) return;
  if (callsInFlight > 0) {
    armDocumentSave();
    return;
  }
  const relative = documentPath;
  let answer: { saved?: boolean; path?: string; size?: number };
  try {
    answer = (await engine.request({ op: 'save-document' })) as typeof answer;
  } catch (error) {
    // A document that cannot be written is the session's work at risk, so it
    // is a named condition in the editor's console, not a debug line.
    log(
      'error',
      `@@VGAI-ERROR the Blender document ${relative} could not be saved: ${describeThrown(error)}`,
    );
    return;
  }
  if (!answer?.saved || typeof answer.path !== 'string') return;
  let bytes: Uint8Array;
  try {
    bytes = await engine.files.readFile(answer.path);
  } catch (error) {
    log(
      'error',
      `@@VGAI-ERROR the Blender document ${relative} was saved but could not be read back out of the engine: ${describeThrown(error)}`,
    );
    return;
  }
  // The engine's copy is now the newer one, so the stager must stop treating
  // this path as the host's: an entry left in `staged` would make the next
  // call re-fetch the whole document over the session's own save, and would
  // hide it from `list-files` (which lists only what the SESSION owns).
  staged.delete(answer.path);
  try {
    const posted = await fetch(`/__editor/blender-document?path=${encodeURIComponent(relative)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: new Blob([bytes as BlobPart]),
    });
    if (!posted.ok) {
      const said = await posted.text().catch(() => '');
      log(
        'error',
        `@@VGAI-ERROR the Blender document ${relative} was not written to the project: HTTP ${posted.status} ${said}`,
      );
      return;
    }
  } catch (error) {
    log(
      'error',
      `@@VGAI-ERROR the Blender document ${relative} was not written to the project: ${describeThrown(error)}`,
    );
    return;
  }
  log('log', `@@VGAI-DOCUMENT ${JSON.stringify({ path: relative, bytes: bytes.length })}`);
}

async function startBlender(project: string, document?: string): Promise<unknown> {
  // The engine is named through a holder rather than the module-level
  // `engine`, because `ask` is handed to the engine before the engine exists.
  const holder: { engine: BlenderEngine | null } = { engine: null };
  const started = await startBlenderEngine({
    project,
    log,
    ask: async ({ frame, capture, saveDue }) => {
      if (!holder.engine) throw new Error('The Blender session presented before it started');
      // The session says this present left the document behind the model. The
      // clock is here; the write is one idle second away.
      if (saveDue) armDocumentSave();
      // THE ARENA IS READ ONCE, HERE, and both readers share those bytes: the
      // typed arrays the tab draws from, and the record of what was sent
      // (`describeFrame`). After the post the buffers are detached and the
      // next `export_frame` overwrites the arena -- on either skew -- so there
      // is no later moment at which either could be taken.
      const arena = await holder.engine.readArena();
      const description = await describeFrame(arena, frame);
      const answered = await presentToTab(
        columnsToTypedArrays(arena, frame),
        description,
        capture as CaptureRequest | undefined,
      );
      // THE CAPTURE IS THE ANSWER'S BODY, and `held` rides beside it: the
      // session reads a photograph's own fields off this object
      // (`session.py::_photograph`), and reads `held` to judge whether its
      // record of what the presenter holds is still that presenter's.
      const body =
        typeof answered.capture === 'object' && answered.capture !== null
          ? (answered.capture as Record<string, unknown>)
          : {};
      return { ...body, ...('held' in answered ? { held: answered.held } : {}) };
    },
  });
  holder.engine = started;
  engine = started;
  // THE PROJECT'S FILES BEFORE THE SESSION'S FIRST ACT, because that act may
  // be `open_mainfile` on the document — which lives on the host's disk and is
  // not in the engine's filesystem until it is staged. Every other call stages
  // on its way in (`execute`); start had nothing to open before it did.
  if (document) await stageProjectFiles(started.files, project);
  const banner = (await started.request({
    op: 'start',
    project,
    ...(document ? { document } : {}),
  })) as Record<string, unknown>;
  if (document) documentPath = document;
  session = {
    start: async () => banner,
    execute: async (code: string) => {
      const answer = (await started.request({ op: 'execute', code })) as {
        executed: boolean;
        result: string;
        error?: string;
      };
      // The MCP door's own shape: a script's failure is TEXT, not a rejection.
      return answer.error
        ? `Error executing code: ${answer.error}`
        : `Code executed successfully: ${answer.result}`;
    },
    sceneInfo: async () => JSON.stringify(await started.request({ op: 'scene-info' }), null, 2),
    objectInfo: async (name: string) =>
      JSON.stringify(await started.request({ op: 'object-info', name }), null, 2),
    screenshotView: async (maxSize: number) => {
      await started.request({ op: 'present', capture: { size: maxSize } });
      return JSON.stringify({ view: { size: maxSize } });
    },
  };
  return {
    ...banner,
    engine: 'blender-wasm',
    // WHICH BUILD ANSWERED. One gate, both skews: a board that cannot say
    // which one it measured cannot call a difference a defect in either.
    skew: started.skew,
    bootMs: Math.round(started.bootMs),
    // What the boot handed back (`blender-engine.mts`). Null says this bundle
    // has no release door and is carrying the payload twice.
    releasedPayloadMB:
      started.releasedPayloadBytes === null
        ? null
        : Math.round(started.releasedPayloadBytes / 1048576),
  };
}

async function blenderIsServed(): Promise<{ available: boolean; missing: string[] }> {
  try {
    const answer = await fetch('/__editor/blender-wasm/status');
    if (!answer.ok) return { available: false, missing: [`status answered ${answer.status}`] };
    return (await answer.json()) as { available: boolean; missing: string[] };
  } catch (error) {
    return { available: false, missing: [String(error)] };
  }
}

async function start(project: string, document?: string): Promise<unknown> {
  if (session) throw new Error('The Blender session is already started');
  if (!project.startsWith('/'))
    throw new Error("The Blender session needs the project's absolute path");
  // The document is the project's own file and is named the project's own way.
  // An absolute path here would be a host path on the wire and a destination
  // the page chose, which is the one thing this transport does not carry.
  if (document !== undefined && !isDocumentPath(document))
    throw new Error(
      `The Blender document must be a project-relative .blend path with no traversal ` +
        `(models/model.blend); got ${JSON.stringify(document)}`,
    );
  const served = await blenderIsServed();
  if (!served.available)
    throw new Error(
      'Headless Blender is not served by this editor, so there is no modeling engine: ' +
        `${served.missing.join('; ')}. The engine is Blender compiled to WebAssembly ` +
        '(packages/blender-engine/wasm, or the directory VGAI_BLENDER_WASM_DIR names); nothing stands in for it.',
    );
  projectRoot = project;
  return startBlender(project, document);
}

/** A project-relative `.blend`, with no traversal and no absolute root. The
 *  server checks the same shape again; this is the half that keeps a bad path
 *  from ever reaching the session. */
export function isDocumentPath(path: string): boolean {
  if (!path.endsWith('.blend') || path.startsWith('/') || path.includes('\\')) return false;
  const segments = path.split('/');
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

interface ProjectFile {
  path: string;
  size: number;
  mtime: number;
}

const saidOnce = new Set<string>();
function say(line: string): void {
  if (saidOnce.has(line)) return;
  saidOnce.add(line);
  log('error', line);
}

async function projectIndex(project: string): Promise<ProjectFile[] | null> {
  const unreadable = (reason: string): null => {
    say(`The project's files are not readable from Python: ${reason}`);
    return null;
  };
  let answer: Response;
  try {
    answer = await fetch('/__editor/blender-project-index');
  } catch (error) {
    return unreadable(String(error));
  }
  if (!answer.ok) return unreadable(`/__editor/blender-project-index answered ${answer.status}`);
  let payload: { root: string; files: ProjectFile[] };
  try {
    payload = await answer.json();
    if (typeof payload?.root !== 'string' || !Array.isArray(payload.files))
      return unreadable('invalid project index');
  } catch (error) {
    return unreadable(String(error));
  }
  const { root, files } = payload;
  if (root !== project)
    say(
      `The editor serving this tab has ${root} open, not ${project}; its files ` +
        `are mounted at ${project}, which is where Python is looking.`,
    );
  return files;
}

/**
 * The project files this session has staged IN, and the two stamps that say
 * so: `host`, what the host's index reported (so a re-stage can skip a file
 * that has not moved on disk), and `engine`, what the file looked like in the
 * engine's own filesystem the instant after it was written there.
 *
 * THE SECOND ONE IS WHY THIS IS A PAIR. Ownership is not a property of the
 * PATH, it is a property of the BYTES: a staged file Python never touched is
 * the host's, and the same path after `export_scene.gltf` has written over it
 * is the session's output and has to reach the project. Keyed on the path
 * alone, a re-bake of an artifact that already exists — which is what every
 * bake after the first one is — was listed by nobody and silently went
 * nowhere, while a first bake of a NEW path worked, so nothing about the door
 * looked broken (measured 2026-09-19 re-baking cinematic-story's sky city).
 *
 * `engine` is `size:mtimeMs`, which is what both skews' `stat` answers. A
 * rewrite that lands in the same millisecond at exactly the same length would
 * read as untouched; a bake is seconds long and this is the strongest signal
 * the filesystem offers.
 */
const staged = new Map<string, { host: string; engine: string }>();

async function stampOf(files_: BlenderFiles, path: string): Promise<string> {
  const info = await files_.stat(path);
  return info ? `${info.size}:${info.mtimeMs}` : '';
}

async function stageProjectFiles(files_: BlenderFiles, project: string): Promise<void> {
  const files = await projectIndex(project);
  if (!files) return;
  const present = new Set(files.map((file) => `${project}/${file.path}`));
  for (const path of [...staged.keys()]) {
    if (present.has(path)) continue;
    try {
      await files_.unlink(path);
    } catch {
      /* already gone */
    }
    staged.delete(path);
  }
  for (const file of files) {
    const path = `${project}/${file.path}`;
    const stamp = `${file.size}:${file.mtime}`;
    if (staged.get(path)?.host === stamp) continue;
    // A path the session already owns keeps its own version.
    if (!staged.has(path) && (await files_.stat(path)) !== null) continue;
    const answer = await fetch(
      `/__editor/blender-project-file?path=${encodeURIComponent(file.path)}`,
    );
    if (!answer.ok) {
      say(`${file.path}: HTTP ${answer.status}`);
      continue;
    }
    const dir = path.slice(0, path.lastIndexOf('/'));
    if (dir) await files_.mkdirTree(dir);
    await files_.writeFile(path, new Uint8Array(await answer.arrayBuffer()));
    staged.set(path, { host: stamp, engine: await stampOf(files_, path) });
  }
}

/** Everything under `root` this SESSION owns -- what the transport mirrors out.
 *  A host file staged in and NEVER WRITTEN is the host's and is not output;
 *  one Python has written over since it was staged is this session's output,
 *  the same as a path it created (see {@link staged}). */
async function listSessionFiles(files: BlenderFiles, root: string): Promise<FileEntry[]> {
  const out: FileEntry[] = [];
  const walk = async (dir: string): Promise<void> => {
    let names: string[];
    try {
      names = await files.readdir(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (name === '.' || name === '..') continue;
      const path = `${dir.replace(/\/$/, '')}/${name}`;
      const info = await files.stat(path);
      if (!info) continue;
      // 0o040000 is S_IFDIR; both skews answer the raw mode.
      if ((info.mode & 0o170000) === 0o040000) {
        await walk(path);
        continue;
      }
      if (staged.get(path)?.engine === `${info.size}:${info.mtimeMs}`) continue;
      out.push({ path, size: info.size, mtime: info.mtimeMs });
    }
  };
  await walk(root);
  return out;
}

async function handle(request: WorkerRequest): Promise<unknown> {
  switch (request.op) {
    case 'start':
      return start(request.project, request.document);
    case 'present-result': {
      const pending = pendingPresents.get(request.id);
      pendingPresents.delete(request.id);
      if (pending)
        request.error
          ? pending.reject(new Error(request.error))
          : pending.resolve({
              ...(request.capture === undefined ? {} : { capture: request.capture }),
              ...('held' in request ? { held: request.held } : {}),
            });
      return undefined;
    }
  }
  if (!session || !projectRoot || !engine) throw new Error('The Blender session has not started');
  const files = engine.files;
  /** The session channel itself, for the requests whose answer is already the
   *  shape the caller wants (the RNA door). */
  const ask = engine.request.bind(engine);
  switch (request.op) {
    case 'execute':
      // Code about to run may open a file the host wrote since the last call.
      await stageProjectFiles(files, projectRoot);
      return session.execute(request.code);
    case 'present':
      // Straight through to `session.py`'s own `present` op — the worker adds
      // nothing, and a capture-less present answers `{ presented, revision }`.
      return ask({ op: 'present' });
    case 'scene-info':
      return session.sceneInfo();
    case 'object-info':
      return session.objectInfo(request.name);
    // THE RNA DOOR, straight through: the session answers JSON and there is
    // nothing in the middle to shape it. Unlike `scene-info`/`object-info`,
    // which the MCP door's own contract renders as a TEXT blob, these three
    // answer a panel — so the object crosses as an object.
    case 'rna':
      return ask({
        op: 'rna',
        path: request.path,
        ...(request.names === undefined ? {} : { names: request.names }),
      });
    case 'rna-context':
      // EVERY FIELD IS NAMED HERE, and the omission is silent: this switch
      // REBUILDS the request rather than forwarding it, so a field added at
      // `runtime.ts` and read in `session.py` still arrives as `None` and the
      // door answers about something else entirely. Measured 2026-09-19 (I4
      // follow-up (a)): `collection` crossed both ends and never the middle,
      // and the Collection tab simply did not stand.
      return ask({
        op: 'rna-context',
        ...(request.object === undefined ? {} : { object: request.object }),
        ...(request.collection === undefined ? {} : { collection: request.collection }),
      });
    case 'rna-set':
      return ask({
        op: 'rna-set',
        path: request.path,
        property: request.property,
        value: request.value,
        ...(request.index === undefined ? {} : { index: request.index }),
      });
    // THE TREE DOOR, the same way through: `rna_outliner` answers JSON and
    // the worker adds nothing to it.
    case 'outliner':
      return ask({
        op: 'outliner',
        ...(request.selected === undefined ? {} : { selected: [...request.selected] }),
      });
    // THE NODE-TREE DOOR, the same way through — and EVERY FIELD IS NAMED,
    // for the reason `rna-context` above records: this switch REBUILDS the
    // request, so a field added at both ends and not here arrives as `None`.
    case 'node-tree':
      return ask({
        op: 'node-tree',
        ...(request.path === undefined ? {} : { path: request.path }),
        ...(request.material === undefined ? {} : { material: request.material }),
      });
    // THE UV DOOR, every field named for the same reason.
    case 'uv-layout':
      return ask({
        op: 'uv-layout',
        ...(request.object === undefined ? {} : { object: request.object }),
        ...(request.uvLayer === undefined ? {} : { uvLayer: request.uvLayer }),
      });
    // THE RIG AND CLIP DOORS, every field named for the same reason — and the
    // reason is a measured defect: I4's Collection tab simply did not stand
    // because `collection` crossed `runtime.ts` and `session.py` and never
    // this switch, with no error anywhere.
    case 'rig':
      return ask({
        op: 'rig',
        ...(request.object === undefined ? {} : { object: request.object }),
      });
    case 'action-clip':
      return ask({
        op: 'action-clip',
        ...(request.object === undefined ? {} : { object: request.object }),
        ...(request.bake === undefined ? {} : { bake: request.bake }),
      });
    case 'outliner-set':
      return ask({
        op: 'outliner-set',
        path: request.path,
        column: request.column,
        value: request.value,
      });
    case 'screenshot-view':
      return JSON.parse((await session.screenshotView(request.maxSize)) as string);
    case 'read-file':
      return files.readFile(request.path);
    case 'write-file': {
      const dir = request.path.slice(0, request.path.lastIndexOf('/'));
      if (dir) await files.mkdirTree(dir);
      await files.writeFile(request.path, request.bytes);
      staged.delete(request.path);
      return undefined;
    }
    case 'list-files':
      return listSessionFiles(files, request.path);
  }
  throw new Error(`Unknown Blender worker request ${(request as { op: string }).op}`);
}

/** Anything thrown, rendered so the message SURVIVES the boundary.
 *
 * `error instanceof Error ? ... : String(error)` renders a thrown plain object
 * as `[object Object]`, and that is the whole error a script sees: the worker
 * answered `17-workshop-interior` seq 7 with exactly that, which named neither
 * the operation nor the cause and left the next step with nothing to go on.
 * A DOMException carries its name, and a plain object carries its own fields,
 * so both are spelled out rather than coerced. */
export function describeThrown(error: unknown): string {
  if (error instanceof Error) return error.stack ?? `${error.name}: ${error.message}`;
  if (typeof error === 'object' && error !== null) {
    const named = error as { name?: unknown; message?: unknown };
    if (typeof named.message === 'string') {
      return typeof named.name === 'string' ? `${named.name}: ${named.message}` : named.message;
    }
    try {
      return JSON.stringify(error) ?? Object.prototype.toString.call(error);
    } catch {
      return Object.prototype.toString.call(error);
    }
  }
  return String(error);
}

/**
 * Tell the tab how big the engine's memory is now.
 *
 * O(1) on the standalone skew — a read of the `HEAPU8` view's length — and
 * posted after every call because that is when it can have changed. It is the
 * engine's memory as opposed to the page's: the census already carries
 * `heapUsedMB` (the PAGE's JS heap) and had no field at all for the wasm,
 * which is the larger half. Before the session exists there is nothing to read
 * and nothing is posted, and the substrate skew answers null — its module's
 * memory lives in a worker with no memory door, and a zero there would be a
 * measurement nobody took.
 */
function reportMemory(): void {
  if (!engine) return;
  const bytes = engine.memoryBytes();
  if (bytes !== null) post({ op: 'memory', bytes });
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.op === 'present-result') {
    await handle(request);
    return;
  }
  // Held across the WHOLE call, so the document's save timer can tell "the
  // session is quiet" from "a script is still running".
  callsInFlight += 1;
  try {
    post({ id: request.id, result: await handle(request) });
  } catch (error) {
    post({ id: request.id, error: describeThrown(error) });
  } finally {
    callsInFlight -= 1;
  }
  // AFTER the answer, never before it: the reading is a passenger and must not
  // sit between a finished call and the reply the caller is waiting on.
  reportMemory();
};
