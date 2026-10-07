import { PullJob, checkpointStream } from './pull-job.mts';
import { sendFrameValue } from './frame-stream.mts';
import { describeThrown } from './describe-thrown.mts';
export { describeThrown } from './describe-thrown.mts';
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
 * THE DOCUMENT'S SAVE BARRIER LIVES HERE. Python's loop cannot ask the tab for anything
 * while it is idle — `serveAsks` only runs inside a request's poll loop, so an
 * `ask` raised between calls is never answered and wedges the Blender pthread.
 * So the session marks a present `saveDue`, this file finishes the command,
 * calls `save-document` as an ordinary request (which Python's loop
 * picks up BETWEEN calls, never mid-call), and carries the bytes to the
 * project through `/__editor/blender-document` BEFORE acknowledging the edit —
 * as a delta: the chunks the server does not hold (`document-chunks.mts`).
 *
 * WHY THE CARRY IS NOT THE MIRROR'S JOB (`volter blender-mcp`, class Mirror):
 * the Mirror is pull-based and runs only after an `execute_blender_code`, so
 * a document saved after the LAST call of a modeling session
 * would never leave the worker — which is exactly the state this closes
 * ("closing the tab loses the model"). The Mirror still lists and mirrors the
 * same file in the MCP lane; it just is not what persistence depends on.
 */
/// <reference types="vite/client" />

import { startupOperation, type BlenderEngine, type BlenderFiles, startBlenderEngine } from './blender-engine.mts';
import type { CaptureRequest, FileEntry, WorkerReply, WorkerRequest } from './protocol';
import { documentChunks } from './document-chunks.mts';
import { columnsToTypedArrays, describeFrame, isColumnDescriptor } from './session-frame.mts';

const post = (reply: WorkerReply) => (self as unknown as Worker).postMessage(reply);
const log = (level: 'log' | 'warn' | 'error', text: string) => post({ op: 'log', level, text });

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

async function streamToTab(value: unknown): Promise<PresentAnswer> {
  return await sendFrameValue(value, async chunk => {
    const kind = value as { op?: string; mesh?: unknown; image?: unknown };
    await loadCheckpoint?.(`frame-transfer/${kind.op ?? "unknown"}/${kind.mesh !== undefined ? "mesh" : kind.image !== undefined ? "image" : "manifest"}/${chunk.kind}`);
    const id = ++presentId;
    return new Promise<PresentAnswer>((resolve, reject) => {
      pendingPresents.set(id, { resolve, reject });
      try {
        (self as unknown as Worker).postMessage({ op: 'frame-stream', id, chunk } satisfies WorkerReply,
          chunk.kind === 'bytes' ? [chunk.bytes.buffer as ArrayBuffer] : []);
      } catch (error) { pendingPresents.delete(id); reject(error); }
    });
  }) as PresentAnswer;
}
function presentToTab(frame: unknown, description: unknown, capture?: CaptureRequest): Promise<PresentAnswer> {
  return streamToTab({ op: 'present', frame, description, ...(capture ? { capture } : {}) });
}

let engine: BlenderEngine | null = null;
let loadJob: PullJob<unknown> | null = null;
let loadCheckpoint: ((phase: string) => Promise<void>) | null = null;

// ---- The session's document.
//
// One session, one `.blend`. `documentPath` is the PROJECT-RELATIVE spelling —
// the only one that crosses to the server, which joins it to its own root so
// no host path is ever on the wire.
let documentPath: string | null = null;
let documentDirty = false;
// Commands and saves share one lane. In particular a flush cannot overtake
// an accepted edit, and a later edit cannot race an upload of older bytes.
let workTail: Promise<unknown> = Promise.resolve();
function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const result = workTail.then(work);
  workTail = result.catch(() => undefined);
  return result;
}

/** A frame arriving in pieces (`session.py::_pull`), held until its `present`: the frame's own
 *  columns by their arena offset, and each deferred datablock copied as it came. */
interface Copied {
  typed: unknown;
  description: unknown;
}
interface PendingFrame {
  session: string;
  revision: number;
  columns: Map<number, Copied>;
  meshes: Map<string, Copied>;
  images: Map<string, Copied>;
}
let pending: PendingFrame | null = null;

/** Every column the held frame names, copied now and keyed by its offset (unique in its arena). */
async function copyColumns(arena: Uint8Array, frame: unknown): Promise<Map<number, Copied>> {
  const columns = new Map<number, Copied>();
  const walk = async (value: unknown, key: string): Promise<void> => {
    if (isColumnDescriptor(value)) {
      columns.set(value.offset, {
        typed: (columnsToTypedArrays(arena, { [key]: value }) as Record<string, unknown>)[key],
        description: (await describeFrame(arena, value)) as unknown,
      });
      return;
    }
    if (Array.isArray(value)) for (const entry of value) await walk(entry, key);
    else if (typeof value === 'object' && value !== null)
      for (const [name, held] of Object.entries(value)) await walk(held, name);
  };
  await walk(frame, '');
  return columns;
}

/** The presented frame with its pieces put back: each column from the held copies, each deferred
 *  mesh and picture from its pulled piece. Both the typed frame and its record. */
function assemblePending(held: PendingFrame, frame: unknown): { typed: unknown; description: unknown } {
  const build = (side: keyof Copied) => {
    const walk = (value: unknown, path: readonly string[]): unknown => {
      if (isColumnDescriptor(value)) {
        const copied = held.columns.get(value.offset);
        if (!copied) throw new Error(`Blender frame column ${path.join('.')}: not in the held frame`);
        return copied[side];
      }
      if (Array.isArray(value)) return value.map((entry) => walk(entry, path));
      if (typeof value !== 'object' || value === null) return value;
      if ((value as { deferred?: unknown }).deferred === true) {
        const [group, name] = path.slice(-2);
        const piece = (group === 'meshes' ? held.meshes : held.images).get(name as string);
        if (!piece) throw new Error(`Blender frame ${group} ${name}: deferred and never pulled`);
        return piece[side];
      }
      const out: Record<string, unknown> = {};
      for (const [name, entry] of Object.entries(value)) {
        const item = walk(entry, [...path, name]);
        if (item !== undefined) out[name] = item;
      }
      return out;
    };
    return walk(frame, []);
  };
  return { typed: build('typed'), description: build('description') };
}

function setDocumentDirty(dirty: boolean): void {
  documentDirty = dirty;
  post({ op: 'document-dirty', dirty });
}

/**
 * Save the document and land it in the project.
 *
 * Only called inside the command lane, after previous calls have finished.
 * Failure is a rejection: explicit shutdown must retain the live model.
 */
async function saveDocument(): Promise<void> {
  if (!engine || documentPath === null) return;
  const relative = documentPath;
  // Each phase's milliseconds, reported with the save: on a large document the save is the
  // edit's cost, and where it goes differs by host (a tab-served project runs the server here).
  const ms: Record<string, number> = {};
  let mark = performance.now();
  const lap = (phase: string) => {
    const now = performance.now();
    ms[phase] = Math.round(now - mark);
    mark = now;
  };
  let answer: { saved?: boolean; path?: string; size?: number };
  try {
    answer = (await engine.request({ op: 'save-document' })) as typeof answer;
    lap('save');
  } catch (error) {
    // A document that cannot be written is the session's work at risk, so it
    // is a named condition in the editor's console, not a debug line.
    throw new Error(`The Blender document ${relative} could not be saved: ${describeThrown(error)}`);
  }
  if (!answer?.saved || typeof answer.path !== 'string')
    throw new Error(`Blender did not save the document ${relative}`);
  let bytes: Uint8Array;
  try {
    bytes = await engine.files.readFile(answer.path);
    lap('read');
  } catch (error) {
    throw new Error(`The Blender document ${relative} could not be read back out of the engine: ${describeThrown(error)}`);
  }
  // The engine's copy is now the newer one, so the stager must stop treating
  // this path as the host's: an entry left in `staged` would make the next
  // call re-fetch the whole document over the session's own save, and would
  // hide it from `list-files` (which lists only what the SESSION owns).
  staged.delete(answer.path);
  let sent = 0;
  try {
    const chunks = await documentChunks(bytes);
    lap('chunk');
    const query = `path=${encodeURIComponent(relative)}`;
    const manifest = JSON.stringify({ chunks: chunks.map(({ hash, start, end }) => [hash, end - start]) });
    // The manifest asks for what the server lacks; after those are sent it commits. A second
    // refusal can only be a file changed underneath between the two, so a third ask is the bound.
    for (let round = 0; ; round += 1) {
      const posted = await fetch(`/__editor/blender-document?${query}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: manifest,
      });
      const said = (await posted.json().catch(() => null)) as
        | { ok?: boolean; missing?: string[]; error?: string; ms?: Record<string, number> }
        | null;
      lap(`manifest${round}`);
      if (!posted.ok) throw new Error(`HTTP ${posted.status} ${said?.error ?? ''}`);
      if (said?.ok) {
        for (const [phase, value] of Object.entries(said.ms ?? {})) ms[`server.${phase}`] = value;
        break;
      }
      if (round === 2 || !Array.isArray(said?.missing)) throw new Error(`the server still lacks ${said?.missing?.length ?? '?'} chunks`);
      const wanted = new Set(said.missing);
      for (const chunk of chunks) {
        if (!wanted.delete(chunk.hash)) continue;
        const part = await fetch(`/__editor/blender-document-chunk?${query}&hash=${chunk.hash}`, {
          method: 'POST',
          headers: { 'content-type': 'application/octet-stream' },
          body: new Blob([bytes.subarray(chunk.start, chunk.end) as BlobPart]),
        });
        if (!part.ok) throw new Error(`HTTP ${part.status} ${await part.text().catch(() => '')}`);
        sent += chunk.end - chunk.start;
      }
      lap(`send${round}`);
    }
  } catch (error) {
    throw new Error(`The Blender document ${relative} was not written to the project: ${describeThrown(error)}`);
  }
  setDocumentDirty(false);
  log('log', `@@VOLTER-DOCUMENT ${JSON.stringify({ path: relative, bytes: bytes.length, sent, ms })}`);
}

async function startBlender(project: string, document?: string): Promise<unknown> {
  // The engine is named through a holder rather than the module-level
  // `engine`, because `ask` is handed to the engine before the engine exists.
  const holder: { engine: BlenderEngine | null } = { engine: null };
  const started = await startBlenderEngine({
    project,
    log,
    ask: async ({ frame, hold, mesh, image, piece, present, capture, saveDue, checkpoint }) => {
      if (typeof checkpoint === 'string') { await loadCheckpoint?.(checkpoint); return {}; }
      if (!holder.engine) throw new Error('The Blender session presented before it started');
      // Save once after the whole command, never during a partial frame.
      if (saveDue && documentPath !== null) setDocumentDirty(true);
      // THE ARENA IS READ ONCE PER ASK, and both readers share those bytes: the
      // typed arrays the tab draws from, and the record of what was sent
      // (`describeFrame`). After the post the buffers are detached and the
      // next export call overwrites the arena -- on either skew -- so there
      // is no later moment at which either could be taken.
      const arena = await holder.engine.readArena();
      // A FRAME IN PIECES (`session.py::_pull`): its own columns and each deferred datablock are
      // copied out of the heap as they come, because the next export call frees them; the tab
      // gets the whole frame at `present`.
      if (hold !== undefined) {
        const identity = hold as { session: string; revision: number };
        pending = { session: identity.session, revision: identity.revision, columns: await copyColumns(arena, hold), meshes: new Map(), images: new Map() };
        await streamToTab({ op: 'stage', session: identity.session, revision: identity.revision });
        return {};
      }
      if (mesh !== undefined || image !== undefined) {
        if (!pending) throw new Error(`The Blender session sent ${mesh ?? image} before its frame`);
        // A PICTURE AS ITS FILE'S OWN BYTES (`session.py::_encoded_image`): the session wrote
        // them to `encodedPath` rather than decoding them into the arena, and they cross as they
        // are; the record keeps their digest, as it does a column's.
        const encodedPath = (piece as { encodedPath?: unknown } | undefined)?.encodedPath;
        let copied: Copied;
        if (image !== undefined && typeof encodedPath === 'string') {
          const { encodedPath: _path, ...rest } = piece as Record<string, unknown>;
          const bytes = (await holder.engine.files.readFile(encodedPath)).slice();
          const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
          const sha256 = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
          copied = {
            typed: { ...rest, encoded: bytes },
            description: { ...rest, encoded: { dtype: 'u8', length: bytes.length, sha256 } },
          };
        } else {
          copied = {
            typed: columnsToTypedArrays(arena, piece),
            description: await describeFrame(arena, piece),
          };
        }
        await streamToTab({ op: 'stage', session: pending.session, revision: pending.revision,
          ...(mesh !== undefined ? { mesh } : { image }), piece: copied.typed });
        // Keep only the manifest and digest; the presenter already built this
        // resource, and the next pull may overwrite the engine arena.
        if (mesh !== undefined) {
          const data = copied.typed as { revision: number };
          pending.meshes.set(mesh, { typed: { revision: data.revision, unchanged: true }, description: copied.description });
        } else pending.images.set(image as string, { typed: undefined, description: copied.description });
        return {};
      }
      let typed: unknown;
      let description: unknown;
      if (present) {
        if (!pending) throw new Error('The Blender session presented a frame it never sent');
        ({ typed, description } = assemblePending(pending, frame));
        pending = null;
      } else {
        typed = columnsToTypedArrays(arena, frame);
        description = await describeFrame(arena, frame);
      }
      const answered = await presentToTab(typed, description, capture as CaptureRequest | undefined);
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
  await loadCheckpoint?.("engine-ready");
  engine = started;
  // THE PROJECT'S FILES BEFORE THE SESSION'S FIRST ACT, because that act may
  // be `open_mainfile` on the document — which lives on the host's disk and is
  // not in the engine's filesystem until it is staged. Every other call stages
  // on its way in (`execute`); start had nothing to open before it did.
  if (document) {
    // The document itself not reaching the engine is a refusal, not a footnote: the open below
    // would fail on a missing file (or open a stale copy) without saying why.
    const failed = await stageProjectFiles(started.files, project);
    const mine = failed.find((line) => line.startsWith("The project's files are not readable") || line.startsWith(`${document} `));
    if (mine) throw new Error(`${document} could not be copied into Blender, so it cannot be opened: ${mine}`);
  }
  await loadCheckpoint?.("project-imported");
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
  const url = '/__editor/blender-wasm/status';
  try {
    const answer = await startupOperation(url, 'fetch initial status', () => fetch(url));
    if (!answer.ok) return { available: false, missing: [`${url}: HTTP ${answer.status}`] };
    return await startupOperation(url, 'decode initial status JSON', () => answer.json()) as { available: boolean; missing: string[] };
  } catch (error) {
    return { available: false, missing: [String(error)] };
  }
}

/** The engine's filesystem is POSIX, so a Windows project root (`C:\Users\me\p`) is
 *  mounted at its URI path (`/C:/Users/me/p`); a POSIX root is its own mount. */
export function projectMount(project: string): string {
  return /^[A-Za-z]:[\\/]/.test(project) ? `/${project.replaceAll('\\', '/')}` : project;
}

async function start(hostProject: string, document?: string): Promise<unknown> {
  if (session) throw new Error('The Blender session is already started');
  const project = projectMount(hostProject);
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
        '(packages/blender-engine/wasm, or the directory VOLTER_BLENDER_WASM_DIR names); nothing stands in for it.',
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

async function projectIndex(project: string): Promise<ProjectFile[] | string> {
  const unreadable = (reason: string): string => {
    const line = `The project's files are not readable from Python: ${reason}`;
    say(line);
    return line;
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
  if (projectMount(root) !== project)
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

/**
 * Copy the project's changed files into the engine, and answer what could NOT be copied.
 *
 * THE ANSWER IS THE POINT (2026-10-06 audit: files that failed to copy were "reported to the
 * console only"). `say` writes the page console once per line, which nobody running a script
 * reads; a script that then opens or loads the missing file fails, or worse succeeds on a
 * stale copy, with no word of why. So every call returns its failures, and the callers put
 * them where the caller of THAT is looking: `execute` appends them to the script's answer, and
 * `start` refuses when the document itself is among them.
 */
async function stageProjectFiles(files_: BlenderFiles, project: string): Promise<string[]> {
  const files = await projectIndex(project);
  if (typeof files === 'string') return [files];
  const failed: string[] = [];
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
      failed.push(`${file.path} (the session answered HTTP ${answer.status})`);
      continue;
    }
    // The index can precede an append or rewrite. Stream the response's own size,
    // not an earlier index entry's size; keep the old stamp so the next sync rechecks.
    const declaredSize = Number(answer.headers.get('content-length'));
    const responseSize = answer.headers.has('content-length') && Number.isSafeInteger(declaredSize) && declaredSize >= 0
      ? declaredSize : file.size;
    const dir = path.slice(0, path.lastIndexOf('/'));
    if (dir) await files_.mkdirTree(dir);
    if (files_.writeFileStream && answer.body) {
      await files_.writeFileStream(path, loadCheckpoint ? checkpointStream(answer.body, () => loadCheckpoint!("file-import")) : answer.body, responseSize);
    } else {
      await files_.writeFile(path, new Uint8Array(await answer.arrayBuffer()));
    }
    staged.set(path, { host: stamp, engine: await stampOf(files_, path) });
  }
  return failed;
}

/** What `session.py::follow_open_file` says after a script changed the file Blender holds. */
type FollowedDocument =
  | { moved: true; from: string; document: string }
  | { moved: false; from: string; outside: string };

/**
 * THE DOCUMENT FOLLOWS BLENDER'S SAVE AS, and the script's caller is told in its own answer.
 *
 * A move retargets the session's saves here (the save this call ends with lands the new file
 * in the project, which is where the editor's Model tab for it opens from) and tells the tab,
 * whose runtime handle holds the same path. A file outside the project is refused: the editor
 * has no document there, so the session keeps its own and keeps saving to it, and says so
 * naming both files, since the script believes it is now working in the other one.
 */
function followDocument(followed: FollowedDocument | undefined): string {
  if (!followed) return '';
  if (!followed.moved) {
    const line = `Blender now has ${followed.outside} open, which is outside the project, so the editor cannot ` +
      `follow it there: this session's document stays ${followed.from}, and the model keeps saving to ` +
      `${followed.from}. To move the model to another file, save it inside the project (src/models/<name>.blend).`;
    log('warn', line);
    return `\n\n${line}`;
  }
  if (!isDocumentPath(followed.document)) {
    // The session checks the same shape, so this is a broken promise, not a refusal to explain.
    throw new Error(`Blender moved its document to ${JSON.stringify(followed.document)}, which is not a project .blend path`);
  }
  documentPath = followed.document;
  // Even a present that failed must not leave the new file only in the engine's filesystem.
  setDocumentDirty(true);
  post({ op: 'document-moved', from: followed.from, document: followed.document });
  const line = `Blender now has ${followed.document} open (this code saved or opened it), so the editor follows it: ` +
    `the model saves to ${followed.document} from now on, and ${followed.from} keeps what it last saved.`;
  log('log', `@@VOLTER-DOCUMENT-MOVED ${JSON.stringify({ from: followed.from, document: followed.document })}`);
  return `\n\n${line}`;
}

/** The failures `stageProjectFiles` answered, as one paragraph a script's caller can read. */
function stagingNote(failed: readonly string[]): string {
  return failed.length === 0 ? '' :
    `\n\nThese project files could not be copied into Blender, so this code did not see their current contents: ${failed.join('; ')}`;
}

/** Everything under `root` this SESSION owns -- what the transport mirrors out.
 *  A host file staged in and NEVER WRITTEN is the host's and is not output;
 *  one Python has written over since it was staged is this session's output,
 *  the same as a path it created (see {@link staged}). */
async function listSessionFiles(files: BlenderFiles, hostRoot: string): Promise<FileEntry[]> {
  // A host root reaches the engine in the engine's spelling, as the project itself does.
  const root = projectMount(hostRoot);
  const out: FileEntry[] = [];
  // A root the engine has no directory at holds no output yet, and that is an honest empty
  // listing. A directory that exists and cannot be read is NOT: until 2026-10-06 every readdir
  // failure was answered as "no files", which is how a Windows root the engine never had (the
  // host's `C:\…` instead of `/C:/…`) reported success while nothing reached disk.
  if ((await files.stat(root)) === null) return out;
  const walk = async (dir: string): Promise<void> => {
    let names: string[];
    try {
      names = await files.readdir(dir);
    } catch (error) {
      throw new Error(`Blender's files under ${dir} could not be listed, so its outputs there cannot be written back: ${String(error)}`);
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

function pullWork(label: string, work: () => Promise<unknown>): Promise<unknown> {
  if (loadCheckpoint) throw new Error('The current Blender operation must finish first');
  loadJob = new PullJob(async checkpoint => {
    loadCheckpoint = checkpoint;
    const began = performance.now();
    try { return await work(); }
    finally { loadCheckpoint = null; log('log', `@@VOLTER-WORK op=${label} totalMs=${Math.round(performance.now() - began)}`); }
  });
  return loadJob.step();
}

async function handle(request: WorkerRequest): Promise<unknown> {
  switch (request.op) {
    case 'start': {
      if (loadJob) throw new Error('The Blender load has already started');
      return pullWork('start', () => start(request.project, request.document));
    }
    case 'load-next':
      if (!loadJob) throw new Error('No Blender load to continue');
      return loadJob.step(request.token);
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
  if (loadCheckpoint) throw new Error('The Blender load must finish before another command');
  if (!session || !projectRoot || !engine) throw new Error('The Blender session has not started');
  const files = engine.files;
  /** The session channel itself, for the requests whose answer is already the
   *  shape the caller wants (the RNA door). */
  const ask = engine.request.bind(engine);
  switch (request.op) {
    case 'flush-document':
      // A flush lands what is pending; a document nothing changed stays the
      // file it was opened from.
      if (!documentDirty) return { saved: false };
      await saveDocument();
      return { saved: true };
    case 'history-begin':
    case 'history-end':
      return ask({ op: request.op });
    case 'history-step':
      return ask({ op: 'history-step', token: request.token, direction: request.direction });
    case 'execute':
      // Code about to run may open a file the host wrote since the last call.
      {
        const note = stagingNote(await stageProjectFiles(files, projectRoot));
        const answer = await ask({ op: 'execute', code: request.code, history: request.history ?? true,
          label: request.label ?? 'Blender Python' }) as {
          error?: string; result: string; document?: FollowedDocument;
        };
        return (answer.error ? `Error executing code: ${answer.error}` : `Code executed successfully: ${answer.result}`) +
          note + followDocument(answer.document);
      }
    case 'present':
      // Straight through to `session.py`'s own `present` op — the worker adds
      // nothing, and a capture-less present answers `{ presented, revision }`.
      return pullWork('present', () => ask({ op: 'present' }));
    case 'native-preview':
      return ask({ op: 'native-preview', width: request.width, height: request.height,
        samples: request.samples, ...(request.camera === undefined ? {} : { camera: request.camera }) });
    case 'list-files-snapshot': {
      const document = await ask({ op: 'document-info' });
      return { entries: await listSessionFiles(files, request.path), document };
    }
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
    case 'view-shading':
      return ask({ op: 'view-shading', shading: request.shading });
    case 'rna-set':
      return ask({
        op: 'rna-set',
        history: request.history !== false,
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
      return pullWork('rig', () => ask({
        op: 'rig',
        ...(request.object === undefined ? {} : { object: request.object }),
      }));
    case 'action-clip':
      return ask({
        op: 'action-clip',
        ...(request.object === undefined ? {} : { object: request.object }),
        ...(request.bake === undefined ? {} : { bake: request.bake }),
        ...(request.action === undefined ? {} : { action: request.action }),
      });
    case 'armature-actions':
      return ask({ op: 'armature-actions' });
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

// A BLENDER THREAD THAT DIES IS WEIGHED FIRST: its error reaches this scope before the page's
// `onerror`, so the heap it died at is posted ahead of the failure, and the page can say whether
// the engine ran out of memory (`runtime.ts`) instead of "Uncaught [object Object]".
self.addEventListener('error', reportMemory);

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.op === 'present-result') {
    void handle(request);
    return;
  }
  void enqueue(() => answerRequest(request));
};

async function answerRequest(request: WorkerRequest): Promise<void> {
  try {
    const result = await handle(request);
    if (!loadCheckpoint && documentDirty) await saveDocument();
    await reportHistory();
    post({ id: request.id, result });
  } catch (error) {
    // A failed history drain must never strand the request's promise. Preserve
    // both failures: the edit may have changed Blender before either failed.
    let message = describeThrown(error);
    try {
      await reportHistory();
    } catch (historyError) {
      message += `\nUnable to deliver Blender history: ${describeThrown(historyError)}`;
    }
    post({ id: request.id, error: message });
  }
  // AFTER the answer, never before it: the reading is a passenger and must not
  // sit between a finished call and the reply the caller is waiting on.
  reportMemory();
}

async function reportHistory(): Promise<void> {
  if (loadCheckpoint || !engine || !session) return;
  const entries = await engine.request({ op: 'history-events' }) as import('./protocol').NativeHistoryEntry[];
  if (entries.length) post({ op: 'history', entries });
}
