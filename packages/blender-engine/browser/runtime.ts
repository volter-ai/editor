/**
 * The tab-side handle on a Blender session: spawns the worker, forwards the
 * four tool calls, and hands every presented frame to whoever displays it.
 * One instance per editor tab; the session and its model die with the worker.
 */
import type {
  CaptureRequest,
  FileEntry,
  RuntimeStart,
  WorkerReply,
  WorkerRequest,
} from './protocol';
import type {
  BlenderActionClip,
  BlenderNodeTree,
  BlenderOutlinerTree,
  BlenderOutlinerWrite,
  BlenderRig,
  BlenderRnaContext,
  BlenderRnaView,
  BlenderRnaWrite,
  BlenderUvLayout,
} from './rna';

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
type Request = DistributiveOmit<WorkerRequest, 'id'>;

export interface BlenderRuntimeOptions {
  /** Display a frame. A screenshot `capture` has its view REMEMBERED so the
   *  next document capture photographs what the agent asked for; a render
   *  capture (`capture.render`) is photographed here and now, and its answer
   *  is what this returns to the operator waiting on it.
   *
   *  `description` is the same frame with its columns replaced by digests
   *  (`protocol.ts`), for whoever displays it to keep as the record of what was
   *  submitted. */
  present(
    frame: unknown,
    description: unknown,
    capture?: CaptureRequest,
  ): Promise<PresentAnswer> | PresentAnswer;
  log?(level: 'log' | 'error', text: string): void;
}

/**
 * What the tab answers a present with.
 *
 * `held` is WHAT THE PRESENTER HELD BEFORE THIS FRAME — the presenter's own
 * report of its state, which the session compares against its record of what
 * it sent (`session.py::_present`). `null` says it held nothing; an ABSENT
 * field says this presenter does not report one (an older editor integration), and
 * the session then judges nothing rather than resetting on every frame.
 */
export interface PresentAnswer {
  capture?: unknown;
  held?: { session: string; revision: number } | null;
}

/**
 * WHO MODELLED THIS, AND AT WHAT STATE — the two fields every presented frame
 * carries about the session that produced it (`browser/session.py`'s `Session`:
 * a per-session id, and a `revision` that advances once per present).
 *
 * Read by anything that has to say WHERE a byte came from rather than merely
 * display it — `blender-list-files` answers with it, so the CLI's write-back
 * door can record which session's model a mirrored file was exported from
 * (`packages/vgai-cli/src/blender-mcp.ts`, class Mirror). Null until the
 * session's first present.
 */
export interface PresentedState {
  readonly session: string;
  readonly revision: number;
}

export interface ScreenshotView {
  size: number;
  position?: number[];
  target?: number[];
}

/**
 * HOW LONG THE WORKER TOOK, measured by the PAGE.
 *
 * WHY THE PAGE MEASURES (2026-09-16): a single `blender-execute` held the
 * worker for over 1,800s and wedged the tab, and the only report anyone got
 * was a replay harness timing out. A blocked worker cannot report on itself —
 * the loop that would send the number is the loop that is stuck — so the one
 * vantage point that still works is the side that POSTED the message. Every
 * call goes through {@link BlenderRuntime.metrics}'s meter, which stamps the
 * `postMessage` and the reply.
 *
 * MEASUREMENT ONLY. Nothing here cancels, kills or budgets a call: a budget is
 * a policy decision, and this is the number a policy would have to be made
 * from.
 *
 * Times are milliseconds on `performance.now()`. Counters are monotonic since
 * this runtime was constructed (one per page load).
 */
export interface BlenderCallMetrics {
  /** Age of the OLDEST outstanding call, or null when the worker is idle.
   *  This is the field that has a number during the wedge — the counters
   *  below only learn about a call when it comes back. */
  readonly inFlightMs: number | null;
  /** Duration of the newest COMPLETED call; null before the first one. */
  readonly lastCallMs: number | null;
  /** The longest call yet, counting an outstanding one at its current age —
   *  otherwise the worst call this session has ever seen is invisible for
   *  exactly as long as it keeps running. */
  readonly maxCallMs: number | null;
  /** Calls whose duration passed 5s, counting outstanding ones already past it. */
  readonly callsOver5s: number;
  /** The same at 30s — a call this side of it is slow, past it is a wedge. */
  readonly callsOver30s: number;
  /** The newest call's window on the `performance.now()` clock (`end` null
   *  while it is outstanding). The editor's long-task observer intersects its
   *  own entries with this to say what the MAIN thread was doing during the
   *  call; nothing else reads it. */
  readonly lastCallWindow: { readonly start: number; readonly end: number | null } | null;
  /**
   * The module's LINEAR MEMORY in MB, as the worker last reported it
   * (`protocol.ts`'s `memory` reply); null before the session's first call.
   *
   * The engine's memory, which is a different question from every other number
   * on this tab: the census's `heapUsedMB` is the PAGE's JS heap and the
   * renderer's RSS is everything at once. wasm32 memory never shrinks, so this
   * is also the high-water mark and no separate peak is kept.
   */
  readonly wasmMemoryMB: number | null;
}

export class BlenderRuntime {
  readonly #worker: Worker;
  readonly #options: BlenderRuntimeOptions;
  readonly #pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  #nextId = 0;
  #started: Promise<RuntimeStart> | null = null;
  /** `performance.now()` at the `postMessage` of every outstanding call. */
  readonly #callStarts = new Map<number, number>();
  #lastCallMs: number | null = null;
  #maxCompletedMs = 0;
  #completedOver5s = 0;
  #completedOver30s = 0;
  #lastCallWindow: { start: number; end: number | null } | null = null;
  #presented: PresentedState | null = null;
  /** Bytes of module linear memory at the worker's last report; see
   *  {@link BlenderCallMetrics.wasmMemoryMB}. */
  #wasmBytes: number | null = null;

  constructor(options: BlenderRuntimeOptions) {
    this.#options = options;
    this.#worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
      name: 'blender',
    });
    this.#worker.onmessage = (event: MessageEvent<WorkerReply>) => void this.#receive(event.data);
    this.#worker.onerror = (event) => {
      // A module worker that fails to LOAD reports an ErrorEvent with an empty
      // message, so `${event.message}` alone said "undefined" and named
      // nothing. Every field the event carries goes in: the thrown error's own
      // message and stack when there is one, and the file and line otherwise,
      // which is what a failed nested import leaves behind.
      const thrown = event.error as Error | undefined;
      const where = event.filename ? ` at ${event.filename}:${event.lineno}:${event.colno}` : '';
      const said = thrown?.stack ?? thrown?.message ?? event.message;
      const error = new Error(
        `Blender worker failed: ${said || 'the worker script did not load'}${where}`,
      );
      // The page console is the editor's ledger (`installEditorConsoleReporting`
      // captures it, source-blind), and this package may import nothing of the
      // editor to say it any other way. Without this line the failure reached
      // a toast and `vgai console` read 0/0 while no Model document could open
      // (measured 2026-09-20 from a registry install).
      console.error(error.message);
      for (const id of [...this.#pending.keys()]) this.#settled(id);
      for (const pending of this.#pending.values()) pending.reject(error);
      this.#pending.clear();
    };
  }

  #project: string | null = null;
  #document: string | null = null;

  get project(): string | null {
    return this.#project;
  }

  /** Idempotent: the first call boots Blender at `project`'s
   *  absolute path; later calls await it (a different path is refused).
   *
   *  `document` is the session's `.blend`, project-relative. An explicit
   *  different file is a resource conflict, including while boot is pending.
   *  Omitting it on an already-started handle means await that same session. */
  start(project: string, document?: string): Promise<RuntimeStart> {
    if (this.#project !== null && this.#project !== project)
      return Promise.reject(
        new Error(`The Blender session is bound to ${this.#project}, not ${project}`),
      );
    if (document !== undefined && this.#document !== null && this.#document !== document)
      return Promise.reject(
        new Error(
          `Blender resource conflict: the session holds ${this.#document}; cannot open ${document}`,
        ),
      );
    this.#project = project;
    this.#document ??= document ?? 'models/model.blend';
    this.#started ??= this.#request({
      op: 'start',
      project,
      ...(document === undefined ? {} : { document }),
    }) as Promise<RuntimeStart>;
    return this.#started;
  }

  #ready(): Promise<RuntimeStart> {
    if (this.#project === null)
      return Promise.reject(
        new Error('The Blender session has not been started with a project (blender-start)'),
      );
    return this.start(this.#project);
  }

  async execute(code: string): Promise<string> {
    await this.#ready();
    return (await this.#request({ op: 'execute', code })) as string;
  }

  async sceneInfo(): Promise<string> {
    await this.#ready();
    return (await this.#request({ op: 'scene-info' })) as string;
  }

  async objectInfo(name: string): Promise<string> {
    await this.#ready();
    return (await this.#request({ op: 'object-info', name })) as string;
  }

  /** One datablock's whole RNA surface (`./rna.ts`). A path that names a
   *  COLLECTION answers with its members instead of its properties. */
  async rna(path: string, names?: number): Promise<BlenderRnaView> {
    await this.#ready();
    return (await this.#request({
      op: 'rna',
      path,
      ...(names === undefined ? {} : { names }),
    })) as BlenderRnaView;
  }

  /** The Properties context: the active object (or the one the caller NAMES),
   *  its active bone / material slot / modifier / vertex group, and the tabs
   *  Blender would show for it. */
  async rnaContext(object?: string, collection?: string): Promise<BlenderRnaContext> {
    await this.#ready();
    return (await this.#request({
      op: 'rna-context',
      ...(object === undefined ? {} : { object }),
      ...(collection === undefined ? {} : { collection }),
    })) as BlenderRnaContext;
  }

  /** Write ONE property through bpy. Rejects by name when Blender's own RNA
   *  says the property is read-only. */
  async rnaSet(
    path: string,
    property: string,
    value: unknown,
    index?: number,
  ): Promise<BlenderRnaWrite> {
    await this.#ready();
    return (await this.#request({
      op: 'rna-set',
      path,
      property,
      value,
      ...(index === undefined ? {} : { index }),
    })) as BlenderRnaWrite;
  }

  /** BLENDER'S VIEW LAYER TREE for the scene — what its Outliner shows, as
   *  rows (`./rna.ts`, `BlenderOutlinerTree`). `selected` is our viewport's
   *  selection by object name; reading it never writes the engine's. */
  async outliner(selected?: readonly string[]): Promise<BlenderOutlinerTree> {
    await this.#ready();
    return (await this.#request({
      op: 'outliner',
      ...(selected === undefined ? {} : { selected }),
    })) as BlenderOutlinerTree;
  }

  /** ONE MATERIAL'S SHADER NODE TREE, whole (`./rna.ts`, `BlenderNodeTree`) —
   *  what the node editor draws. Given neither `path` nor `material`, the
   *  active object's active material answers, which is what Blender's own
   *  Shading header resolves. */
  async nodeTree(options?: { path?: string; material?: string }): Promise<BlenderNodeTree> {
    await this.#ready();
    return (await this.#request({
      op: 'node-tree',
      ...(options?.path === undefined ? {} : { path: options.path }),
      ...(options?.material === undefined ? {} : { material: options.material }),
    })) as BlenderNodeTree;
  }

  /** ONE MESH'S UV LAYOUT (`./rna.ts`, `BlenderUvLayout`) — what the UV
   *  editor draws. Given no `object`, the view layer's ACTIVE object answers,
   *  which is the only subject there is outside edit mode. */
  async uvLayout(options?: { object?: string; uvLayer?: string }): Promise<BlenderUvLayout> {
    await this.#ready();
    return (await this.#request({
      op: 'uv-layout',
      ...(options?.object === undefined ? {} : { object: options.object }),
      ...(options?.uvLayer === undefined ? {} : { uvLayer: options.uvLayer }),
    })) as BlenderUvLayout;
  }

  /** ONE MESH'S SKIN BINDING (`./rna.ts`, `BlenderRig`) — the armature's
   *  bones and the per-vertex influences a `THREE.SkinnedMesh` needs. Given no
   *  `object`, the view layer's ACTIVE mesh answers. */
  async rig(options?: { object?: string }): Promise<BlenderRig> {
    await this.#ready();
    return (await this.#request({
      op: 'rig',
      ...(options?.object === undefined ? {} : { object: options.object }),
    })) as BlenderRig;
  }

  /** ONE ACTION AS A THREE.JS CLIP (`./rna.ts`, `BlenderActionClip`). `bake:
   *  false` answers the header and the summary row's key columns without the
   *  sampled tracks, which is what a Timeline that only needs to DRAW asks
   *  for. */
  async actionClip(options?: { object?: string; bake?: boolean }): Promise<BlenderActionClip> {
    await this.#ready();
    return (await this.#request({
      op: 'action-clip',
      ...(options?.object === undefined ? {} : { object: options.object }),
      ...(options?.bake === undefined ? {} : { bake: options.bake }),
    })) as BlenderActionClip;
  }

  /** Write ONE restriction column (the eye, the render camera, a collection's
   *  Exclude). A column Blender draws on no row of that type is refused by
   *  name rather than written somewhere near it. */
  async outlinerSet(path: string, column: string, value: boolean): Promise<BlenderOutlinerWrite> {
    await this.#ready();
    return (await this.#request({
      op: 'outliner-set',
      path,
      column,
      value,
    })) as BlenderOutlinerWrite;
  }

  /**
   * PRESENT WHAT THE ENGINE HOLDS, with no capture.
   *
   * Every mutation presents (`session.py::dispatch`), so in the ordinary
   * course of a session nothing needs to ask. The exception is the first
   * frame: opening a `.blend` is not a mutation, so a freshly opened Model
   * document had nothing to display until something RAN — measured by I1 and
   * fixed here (WORK.md §Blender in the tab is Blender, "Inspection parity",
   * I2 decision 6). The document asks on mount.
   */
  async present(): Promise<void> {
    await this.#ready();
    await this.#request({ op: 'present' });
  }

  /** Presents the model with the viewport's camera and returns that view. */
  async screenshotView(maxSize: number): Promise<{ view: ScreenshotView } | { error: string }> {
    await this.#ready();
    return (await this.#request({ op: 'screenshot-view', maxSize })) as
      | { view: ScreenshotView }
      | { error: string };
  }

  async readFile(path: string): Promise<Uint8Array> {
    await this.#ready();
    return (await this.#request({ op: 'read-file', path })) as Uint8Array;
  }

  async writeFile(path: string, bytes: Uint8Array): Promise<void> {
    await this.#ready();
    await this.#request({ op: 'write-file', path, bytes });
  }

  async listFiles(path: string): Promise<FileEntry[]> {
    await this.#ready();
    return (await this.#request({ op: 'list-files', path })) as FileEntry[];
  }

  /** The session and revision of the last frame this runtime forwarded; null
   *  before the first present. See {@link PresentedState}. */
  get presented(): PresentedState | null {
    return this.#presented;
  }

  terminate(): void {
    this.#worker.terminate();
    const error = new Error('The Blender session was terminated');
    for (const id of [...this.#pending.keys()]) this.#settled(id);
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }

  /**
   * What this tab knows about the worker's responsiveness, right now.
   *
   * Computed at READ time rather than accumulated, because the interesting
   * call is the one that has not come back: an outstanding call contributes to
   * `maxCallMs` and to the two bucket counts at its CURRENT age, so a wedge
   * shows up while it is happening instead of only in its post-mortem.
   *
   * A `present` is not counted separately — the worker only presents from
   * inside a call this meter is already holding open, and the page-side cost of
   * displaying the frame is main-thread time, which is the long-task observer's
   * subject (`packages/editor/src/blender-tab-metrics.ts`).
   */
  metrics(now: number = performance.now()): BlenderCallMetrics {
    let oldest: number | null = null;
    let max = this.#maxCompletedMs;
    let over5 = this.#completedOver5s;
    let over30 = this.#completedOver30s;
    for (const started of this.#callStarts.values()) {
      const elapsed = now - started;
      if (oldest === null || elapsed > oldest) oldest = elapsed;
      if (elapsed > max) max = elapsed;
      if (elapsed >= 5_000) over5 += 1;
      if (elapsed >= 30_000) over30 += 1;
    }
    return {
      inFlightMs: oldest === null ? null : Math.round(oldest),
      lastCallMs: this.#lastCallMs === null ? null : Math.round(this.#lastCallMs),
      // Zero here would mean "no call has ever taken any time", which is a
      // different claim from "no call has happened yet".
      maxCallMs: this.#lastCallMs === null && oldest === null ? null : Math.round(max),
      callsOver5s: over5,
      callsOver30s: over30,
      lastCallWindow: this.#lastCallWindow,
      wasmMemoryMB: this.#wasmBytes === null ? null : Math.round(this.#wasmBytes / 1048576),
    };
  }

  /** Close a call's window, whether it answered, threw, or was terminated. */
  #settled(id: number): void {
    const started = this.#callStarts.get(id);
    if (started === undefined) return;
    this.#callStarts.delete(id);
    const elapsed = performance.now() - started;
    this.#lastCallMs = elapsed;
    if (elapsed > this.#maxCompletedMs) this.#maxCompletedMs = elapsed;
    if (elapsed >= 5_000) this.#completedOver5s += 1;
    if (elapsed >= 30_000) this.#completedOver30s += 1;
    if (this.#lastCallWindow !== null && this.#lastCallWindow.start === started)
      this.#lastCallWindow = { start: started, end: started + elapsed };
  }

  #request(request: Request): Promise<unknown> {
    const id = ++this.#nextId;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      const started = performance.now();
      this.#callStarts.set(id, started);
      this.#lastCallWindow = { start: started, end: null };
      this.#worker.postMessage({ ...request, id });
    });
  }

  async #receive(reply: WorkerReply): Promise<void> {
    if ('op' in reply) {
      if (reply.op === 'log') {
        this.#options.log?.(reply.level, reply.text);
        return;
      }
      if (reply.op === 'memory') {
        this.#wasmBytes = reply.bytes;
        return;
      }
      // Recorded BEFORE the display, and whether or not the display throws:
      // the fact being kept is that the session reached this revision, which is
      // true the moment the frame arrives. A presenter that refuses the frame
      // has not un-modelled it.
      const frame = reply.frame as { session?: unknown; revision?: unknown } | null;
      if (typeof frame?.session === 'string' && typeof frame.revision === 'number')
        this.#presented = { session: frame.session, revision: frame.revision };
      try {
        const answer = await this.#options.present(reply.frame, reply.description, reply.capture);
        this.#worker.postMessage({
          op: 'present-result',
          id: reply.id,
          ...(answer?.capture === undefined ? {} : { capture: answer.capture }),
          ...(answer !== null && answer !== undefined && 'held' in answer
            ? { held: answer.held }
            : {}),
        } satisfies WorkerRequest);
      } catch (error) {
        this.#worker.postMessage({
          op: 'present-result',
          id: reply.id,
          error: error instanceof Error ? error.message : String(error),
        } satisfies WorkerRequest);
      }
      return;
    }
    const pending = this.#pending.get(reply.id);
    if (!pending) return;
    this.#pending.delete(reply.id);
    this.#settled(reply.id);
    'error' in reply ? pending.reject(new Error(reply.error)) : pending.resolve(reply.result);
  }
}
