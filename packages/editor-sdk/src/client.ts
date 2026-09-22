import type { GenerationJobsDocument } from '@volter/editor-sdk/generations';
import type { Dispatcher } from 'undici';
import { createDispatcher, dispatchFetch } from '#http-transport';
import type { DocumentProbeResult, DocumentProbeStep } from './document-probe.js';
import type {
  ActiveDocumentCapture,
  AssetCompareCapture,
  AssetCompareOptions,
  AssetKind,
  AssetPreviewCapture,
  AssetPreviewOptions,
  AssetPreviewShotSetDefinition,
  AssetPreviewSource,
  CaptureDimensions,
  DocumentCameraPose,
  DocumentLookOutcome,
  DocumentTableProjection,
  EditorChromeCapture,
  EditorChromeCaptureOptions,
  EditorState,
  EditorView,
  EditorWorkspaceName,
  GameCapture,
  GameplayRecordingCapture,
  GameplayRecordingOptions,
  GameplayRecordingStarted,
  GameplayRecordingTimeline,
  GameplayReplayCapture,
  HelperVisibility,
  InspectedFieldWrite,
  InspectedHierarchy,
  InspectedInspection,
  LabeledShotSetCapture,
  PlayStarted,
  PresentedEditorView,
  ProjectInfo,
  ProjectTemplate,
  ProjectToolCatalog,
  ProjectToolOutcome,
  RecentProject,
  ShadingMode,
  StoryCaptureOptions,
  StoryVariantCapture,
  StructureOp,
  StructureOpOptions,
  StructureOpResult,
  TransformMode,
  TransformSpace,
  Vec3Value,
  ViewPreset,
  ViewportCapture,
  ViewportTab,
} from './types.js';

// The editor's default origin, spelled out because this package deliberately
// does not depend on `@volter/editor-project`. `DEFAULT_EDITOR_PORT` in
// `packages/project/src/manifest/editor-port.ts` is the owner of the number and
// of the never-`localhost` rule; keep this in step with it.
const DEFAULT_URL = 'http://127.0.0.1:20173';

/**
 * A refused editor command, carrying the relay's own STRUCTURED failure code
 * alongside the prose.
 *
 * `/__editor/command` has always answered `{ ok: false, error, code }` and
 * this client has always dropped the `code` on the floor, so every caller that
 * wanted to react to a specific refusal had to substring-match an English
 * sentence. `vgai screenshot`'s loop-recovery fallback is the first caller that
 * genuinely must branch (`BRIDGE_SCREENSHOT_STALE` has a working recovery;
 * "not in play mode" does not), and a fallback keyed on prose would fire on
 * the wrong failure the first time someone rewords the message.
 */
export class EditorCommandError extends Error {
  readonly code: string | undefined;
  /**
   * True when the RELAY ended the command itself rather than the editor
   * answering it — the HTTP 504 that `server/server-utils.ts`'s
   * `commandResponseFor` gives any `timedOut` result, or this client's own
   * deadline below.
   *
   * Read it as "no answer", not as "the budget expired". `editor-server.ts`
   * raises `timedOut` for five conditions and only one of them takes the full
   * budget: the command's timer expiring, the controlling tab's socket dying,
   * the receipt window closing unanswered, a beating-but-dead tab, and no tab
   * present at all. The last four can fail in milliseconds.
   *
   * A caller that converges by retrying (`vgai restart`) needs the distinction
   * because a refusal the editor ANSWERED may go differently next time, while
   * a command the relay abandoned tells you nothing new on a second identical
   * attempt — and when the abandonment was a 120s budget, re-running it three
   * times is `restart-readiness.ts`'s 361-seconds-of-silence defect.
   */
  readonly timedOut: boolean;
  constructor(message: string, code?: string | undefined, timedOut = false) {
    super(message);
    this.name = 'EditorCommandError';
    this.code = code;
    this.timedOut = timedOut;
  }
}

/**
 * The client's own ceiling on ONE relayed command.
 *
 * A backstop for a LOST server, not a per-command budget: the server already
 * owns per-type budgets (`server/server-utils.ts`'s `relayCommandTimeoutMs`)
 * and its timer must always be the one that fires, because its message names
 * the tab and the remedy while this one can only say "no answer". So this is
 * deliberately ONE number, comfortably above the longest server budget
 * (120s, `play`/`capture-story-variants`) rather than a mirror of that table —
 * a second copy of it would drift silently, and the drift would show up as
 * this timer winning a race it must always lose.
 *
 * Without it a `fetch` with no `AbortSignal` waits on the OS: a dev server
 * that stops answering mid-command holds the CLI open indefinitely, with no
 * output and nothing to read.
 */
const COMMAND_DEADLINE_MS = 150_000;
/** The Blender lane's own ceiling: a chunk is a whole modeling step, not a tick. */
const BLENDER_DEADLINE_MS = 30 * 60_000;
/** undici's default `headersTimeout`; a command deadline beyond it needs its own dispatcher (see `command`). */
const UNDICI_DEFAULT_HEADERS_TIMEOUT_MS = 300_000;

/**
 * Ceiling on {@link EditorClient.getUnresolvedConsole}. The CLI drains this
 * on every verb, including ones that never wait for a command envelope, so
 * a silent hang here would become a silent hang on `vgai sessions`. The
 * server route is a plain in-process GET; 1.5s is already longer than it
 * should ever take.
 */
const CONSOLE_DRAIN_TIMEOUT_MS = 1_500;

/**
 * Node's `fetch` collapses EVERY network-layer failure into one two-word
 * `TypeError: fetch failed`. The real reason — `ECONNREFUSED`, `ECONNRESET`,
 * `EPIPE`, a DNS miss — lives only on `error.cause` (sometimes two links down,
 * or inside an `AggregateError`), and nothing prints it unless something walks
 * the chain. That is the whole reason `project.bake.preview` was observed
 * failing with a bare "fetch failed" and no way to tell a dead editor from a
 * momentary one (WORK.md, cold barrel 2026-08-29): the code below used to
 * rethrow the `TypeError` untouched, on the belief — stated in a comment right
 * where it happened — that "a connection refused / DNS failure still surfaces
 * as itself". It does not. This walks the chain so the message can say which.
 */
function describeFetchFailure(error: unknown): { code: string; detail: string } {
  const messages: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 8; depth++) {
    if (!(current instanceof Error)) break;
    if (current.message) messages.push(current.message);
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && code !== '') {
      return { code, detail: messages.join(' <- ') };
    }
    const aggregate = (current as { errors?: unknown }).errors;
    if (Array.isArray(aggregate) && aggregate.length > 0) {
      const inner = describeFetchFailure(aggregate[0]);
      return { code: inner.code, detail: [...messages, inner.detail].join(' <- ') };
    }
    current = (current as { cause?: unknown }).cause;
  }
  return { code: 'UNKNOWN', detail: messages.join(' <- ') || String(error) };
}

/**
 * Transport failures where a second attempt is worth making: the connection
 * itself failed or died, rather than the editor answering something unwelcome.
 * A dev server that is restarting (any watched source edit restarts it) is
 * unreachable for a fraction of a second and reachable again after — which is
 * exactly the "fails, then succeeds unchanged" shape that was reported.
 */
const RETRYABLE_TRANSPORT_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
]);

/** Gap before the one automatic retry — long enough for a dev-server restart's
 *  listen socket to come back, short enough to stay invisible. */
const TRANSPORT_RETRY_DELAY_MS = 400;

/** Context accompanying one {@link EditorClient} response observation. */
export interface EditorEnvelopeObservation {
  /** True only when this body came from the console-ledger endpoint and its
   *  `entries` field is therefore the complete named console set. Command
   *  payloads may also own an unrelated `entries` field. */
  readonly unresolvedConsoleComplete: boolean;
}

/**
 * The GAME DEBUG PLANE, as a contribution's client sees it.
 *
 * Deliberately the same two words `@vgai/live`'s session binding uses
 * (`game.state(name)` / `game.command(name, ...args)`), because it is the same
 * plane: whatever the running game registered through `ctx.debug` — a provider
 * read by name, a command invoked by name. A tool contribution that wants the
 * game's own vitals in its panel has this door and no other; there is
 * deliberately no per-capability method, because a game names its own
 * providers and commands.
 *
 * Both legs reject LOUDLY (`EditorCommandError`) rather than answer with a
 * placeholder: play not running is `'not in play mode — start play before
 * using the debug seam'`, and an unregistered command carries
 * `code: 'DEBUG_COMMAND_NOT_REGISTERED'`. A panel decides what to show for
 * those; the client never invents one.
 */
/** What one undo/redo step reports back — `moved` is false when there was
 *  nothing left in that direction, which is an answer, not an error. */
export interface HistoryStep {
  readonly moved: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel: string | null;
  readonly redoLabel: string | null;
}

/** What `open()` acknowledges: the workspace document the scene-table entry
 *  resolved to, and the title its tab now carries — the game's own word for
 *  that composition, not a filename. */
export interface OpenedDocument {
  readonly documentId: string;
  readonly title: string;
  /**
   * The GAME's own answer, present only when opening navigated a running game
   * (a scene the adapter declares reachable through the game's scenes
   * contract, or a native swap-slot remount): what was asked for, and which
   * scene the game reports it is in once its own navigation settled. `current`
   * can differ from `requested` — that is the game's reading, not a host claim.
   */
  readonly scene?: { readonly requested: string; readonly current: string | null };
  /**
   * Present when opening restarted play at a native swap-slot key rather than
   * navigating a live contract — the slot is a module-level const.
   */
  readonly restart?: true;
}

export interface GameDebugDoor {
  /**
   * Read ONE registered state provider by name (`'bot.tester'`). `undefined`
   * when the running game registered no such provider — or no debug adapter at
   * all, which is an honest answer rather than a refusal.
   */
  state(name: string): Promise<unknown>;
  /** Invoke ONE registered debug command by name, with its own arguments. */
  command(name: string, ...args: unknown[]): Promise<unknown>;
}

export class EditorClient {
  private readonly baseUrl: string;

  /**
   * The running game's debug plane — see {@link GameDebugDoor}. It rides the
   * SAME `/__editor/command` relay every other method here uses (relay cases
   * `inspect-gameplay-state` / `invoke-debug-command`, `command-listener.ts`),
   * so a tool contribution reaches the game through the client it already has
   * rather than a second channel of its own.
   */
  readonly game: GameDebugDoor;

  /**
   * Called with the raw body of EVERY response this client receives — command
   * envelopes and `/__editor/state` alike, on success AND on refusal.
   *
   * It exists for exactly one contract: the server stamps `unresolvedConsole`
   * onto every envelope (`server-utils.ts`'s `commandResponseFor`), and the CLI
   * has to see those counts to be loud about them. Routing that through a
   * single observer here — rather than teaching each of the CLI's output sites
   * to unpack a response — is what keeps the loudness contract ONE mechanism.
   * The observer must not throw; anything it raises is swallowed, because a
   * reporting hook may never break the command it is reporting on.
   */
  private readonly transport:
    | ((body: Record<string, unknown>) => Promise<Record<string, unknown>>)
    | null;
  private readonly onEnvelope:
    | ((body: unknown, observation: EditorEnvelopeObservation) => void)
    | null;

  constructor(opts?: {
    url?: string;
    onEnvelope?: (body: unknown, observation: EditorEnvelopeObservation) => void;
    /**
     * An IN-PAGE command channel, for a client that lives inside the editor
     * page itself and has no editor server to reach. Given, every command goes through it instead of
     * `POST /__editor/command`, and answers in the route's own body shape
     * (`{ ok: true, ...data }` / `{ ok: false, error, code? }`).
     */
    transport?: (body: Record<string, unknown>) => Promise<Record<string, unknown>>;
  }) {
    if (opts !== undefined && (typeof opts !== 'object' || opts === null || Array.isArray(opts))) {
      throw new TypeError(
        'EditorClient options must be an object. Use new EditorClient({ url: "http://127.0.0.1:20173" }), not new EditorClient("...").',
      );
    }
    const unknownOptions = Object.keys(opts ?? {}).filter(
      (key) => key !== 'url' && key !== 'onEnvelope' && key !== 'transport',
    );
    if (unknownOptions.length > 0) {
      throw new Error(
        `EditorClient: unknown option${unknownOptions.length === 1 ? '' : 's'} ${unknownOptions.map((key) => `"${key}"`).join(', ')}. Use { url: "http://127.0.0.1:<port>" } to target an editor.`,
      );
    }
    this.baseUrl = (opts?.url ?? DEFAULT_URL).replace(/\/$/, '');
    this.onEnvelope = opts?.onEnvelope ?? null;
    this.transport = opts?.transport ?? null;
    this.game = {
      state: async (name: string): Promise<unknown> => {
        // `keys` narrows the relay to the one provider asked for, so a panel
        // polling one vital never drags the whole plane's `stateAll()` across
        // the wire. A game with no debug adapter answers `{ state: null }`.
        const data = await this.command<{ state: Record<string, unknown> | null }>({
          type: 'inspect-gameplay-state',
          keys: [name],
        });
        return data.state?.[name];
      },
      command: async (name: string, ...args: unknown[]): Promise<unknown> =>
        (await this.command<{ result: unknown }>({ type: 'invoke-debug-command', name, args }))
          .result,
    };
  }

  /**
   * `retryTransport` opts a command into ONE automatic retry after a transport
   * failure (see {@link RETRYABLE_TRANSPORT_CODES}). It is deliberately
   * OPT-IN and off by default: a socket that died after the request was written
   * cannot prove the editor did not already run the command, so a blanket retry
   * would risk playing/stopping/writing twice. Read-only relays — the captures —
   * have no such hazard and turn it on.
   */
  private async command<T extends object = Record<string, never>>(
    body: Record<string, unknown>,
    options?: { retryTransport?: boolean; deadlineMs?: number },
  ): Promise<T> {
    const type = String(body['type'] ?? 'command');
    const deadlineMs = options?.deadlineMs ?? COMMAND_DEADLINE_MS;
    if (this.transport) {
      const answered = (await this.transport(body)) as {
        ok: boolean;
        error?: string;
        code?: string;
      } & T;
      if (!answered.ok) {
        throw new EditorCommandError(
          answered.error ?? `Editor command "${type}" failed`,
          answered.code,
        );
      }
      return answered;
    }
    const url = `${this.baseUrl}/__editor/command`;
    const request = JSON.stringify(body);
    let res: Response | undefined;
    let retried = false;
    let commandDispatcher: Dispatcher | undefined;
    for (;;) {
      try {
        const init: RequestInit = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: request,
          signal: AbortSignal.timeout(deadlineMs),
        };
        // The command route answers only when the command completes, and
        // Node's fetch (undici) gives a server 300 s to send response HEADERS
        // regardless of the abort signal: a modeling step measured at eleven
        // minutes in the tab died as UND_ERR_HEADERS_TIMEOUT well inside its
        // half-hour budget. A deadline past that default carries its own
        // dispatcher, through undici's own fetch so the two agree.
        commandDispatcher = deadlineMs > UNDICI_DEFAULT_HEADERS_TIMEOUT_MS
          ? createDispatcher(deadlineMs + 30_000)
          : undefined;
        res = await dispatchFetch(url, init, commandDispatcher);
        break;
      } catch (error) {
        await commandDispatcher?.destroy?.();
        commandDispatcher = undefined;
        // Only the deadline is reshaped into a "no answer" verdict; everything
        // else is a TRANSPORT failure, and Node hides its reason behind a bare
        // `fetch failed` (see `describeFetchFailure`).
        if ((error as { name?: string } | null)?.name === 'TimeoutError') {
          throw new EditorCommandError(
            `The editor at ${this.baseUrl} never answered "${type}" ` +
              `within ${Math.round(deadlineMs / 1000)}s — past every server-side budget, so ` +
              'the server itself is not answering. Check the terminal running `volter-editor edit`.',
            undefined,
            true,
          );
        }
        const { code, detail } = describeFetchFailure(error);
        if (options?.retryTransport === true && !retried && RETRYABLE_TRANSPORT_CODES.has(code)) {
          retried = true;
          await new Promise((resolve) => setTimeout(resolve, TRANSPORT_RETRY_DELAY_MS));
          continue;
        }
        throw new EditorCommandError(
          `POST ${url} ("${type}") never reached the editor: ${code}${detail ? ` (${detail})` : ''}.` +
            (retried
              ? ` Retried once after ${TRANSPORT_RETRY_DELAY_MS}ms; it failed the same way.`
              : '') +
            (options?.retryTransport === true
              ? ''
              : ' Not retried automatically: this command can change editor state, and a socket that' +
                ' died after the request was written cannot prove the editor did not already run it.') +
            ' A transport failure means the port stopped answering, not that the editor refused —' +
            ' the dev server restarts on any watched source edit, and it shuts itself down after an' +
            ' idle window. Check the terminal running `volter-editor edit` and confirm the port' +
            ' this client resolved.',
          code,
          false,
        );
      }
    }
    let data: { ok: boolean; error?: string; code?: string } & T;
    try {
      data = (await this.readJson(res)) as typeof data;
    } finally {
      await commandDispatcher?.destroy?.();
    }
    if (!data.ok) {
      throw new EditorCommandError(
        data.error ?? `Editor command failed: ${res.status}`,
        data.code,
        // 504 is every `timedOut` result (`commandResponseFor`) — the relay
        // gave up, on any of its five grounds. A 200 body with `ok: false` is
        // an ANSWER from the editor, however unwelcome. See `timedOut` above.
        res.status === 504,
      );
    }
    return data;
  }

  // --- Play control ---

  /** `opts.seed` (D15/T-D15.6, objection-4 fix) — `vgai play --seed <n>`'s
   *  explicit config leg, relayed as `cmd['seed']`; `handleCommand`'s
   *  `'play'` case threads it into `enterPlayMode`'s highest-precedence seed
   *  argument (beats manifest.determinism.defaultSeed/?vgai-seed=). Omitted,
   *  boot seeding falls back to that precedence unchanged.
   *
   *  `opts.name` (`vgai play --name <text>`) — an OPTIONAL label for this run,
   *  relayed as `cmd['name']` and slugified server-side into the run's
   *  `logs/play-*.jsonl` filename and its session-journal line. Findability
   *  only: no registry, no uniqueness, no lookup verb — grep and `ls` are the
   *  query engine. Omitted, the filename keeps its exact unnamed shape. */
  /*  `opts.record` (`vgai play --record <name>`) — NAMES this run's recording
   *  file. It does not ENABLE recording: every relayed play records, with no
   *  flag (see `@vgai/game`'s `src/play/play-recording.ts`). Omitted, the clip is named for
   *  the durable Gameplay Session; named, it becomes an explicit keepsake in
   *  `.vgai/recordings/<name>.webm`. */
  async play(opts?: {
    seed?: number;
    name?: string | null;
    record?: string | null;
  }): Promise<PlayStarted> {
    return this.command<PlayStarted>({
      type: 'play',
      ...(opts?.seed !== undefined ? { seed: opts.seed } : {}),
      ...(opts?.name ? { name: opts.name } : {}),
      ...(opts?.record ? { record: opts.record } : {}),
    });
  }

  /** Dispose the current play session and mount it again from fresh project entry source. */
  async restart(): Promise<void> {
    await this.command({ type: 'play' });
  }

  /** Stops play, and finalizes this run's recording before the surface it was
   *  photographing is torn down. The capture is absent when nothing recorded. */
  async stop(): Promise<{ recording?: GameplayRecordingCapture }> {
    return this.command<{ recording?: GameplayRecordingCapture }>({ type: 'stop' });
  }

  async pause(): Promise<void> {
    await this.command({ type: 'pause' });
  }

  async resume(): Promise<void> {
    await this.command({ type: 'resume' });
  }

  async step(): Promise<void> {
    await this.command({ type: 'step' });
  }

  // --- Selection ---

  async select(id: string | null): Promise<void> {
    await this.command({ type: 'select', id });
  }

  async selectMultiple(ids: string[]): Promise<void> {
    await this.command({ type: 'select-multiple', ids });
  }

  async selectAll(): Promise<void> {
    await this.command({ type: 'select-all' });
  }

  // --- Viewport ---

  async focusEntity(id: string): Promise<void> {
    await this.command({ type: 'focus-entity', id });
  }

  async focusSelection(): Promise<void> {
    await this.command({ type: 'focus-selection' });
  }

  /**
   * Frame the EDIT viewport camera on one entity — the strict sibling of
   * {@link focusEntity}. Same framing; an id the scene does not know is a
   * refusal naming the id (`EditorCommandError`, code `ENTITY_NOT_FOUND`)
   * rather than `focusEntity`'s silent no-op, so a caller that frames an
   * entity before capturing it cannot photograph the wrong thing.
   */
  async frameEntity(id: string): Promise<void> {
    await this.command({ type: 'frame-entity', id });
  }

  async viewPreset(preset: ViewPreset): Promise<void> {
    await this.command({ type: 'view-preset', preset });
  }

  /**
   * LOOK AROUND THE OPEN MODEL, visibly. Swings the active Object3D
   * document's camera — the one on the human's screen — by `azimuth`/
   * `elevation` radians, animated over `duration` seconds, and resolves when
   * the move ends. A human drag during the move cancels it where it stands
   * (`cancelledBy: 'human'`); the promise still resolves.
   */
  async orbitDocument(options: {
    azimuth?: number;
    elevation?: number;
    duration?: number;
  }): Promise<DocumentLookOutcome> {
    return this.command<DocumentLookOutcome>({ type: 'document-orbit', ...options });
  }

  /** A slow full revolution around the open document's subject, at a constant rate. */
  async turntableDocument(options?: {
    seconds?: number;
    revolutions?: number;
  }): Promise<DocumentLookOutcome> {
    return this.command<DocumentLookOutcome>({ type: 'document-turntable', ...options });
  }

  /**
   * Frame the open document's subject (its selection if it has one). `fit`
   * scales the fitted distance: 1 is the toolbar Frame button's tight fit.
   */
  async frameDocument(fit?: number): Promise<DocumentCameraPose> {
    return this.command<DocumentCameraPose>({
      type: 'document-frame',
      ...(fit === undefined ? {} : { fit }),
    });
  }

  async setCamera(position: Vec3Value, target: Vec3Value, fov?: number): Promise<void> {
    await this.command({
      type: 'set-camera',
      position,
      target,
      ...(fov === undefined ? {} : { fov }),
    });
  }

  async captureViewport(size?: number): Promise<ViewportCapture> {
    const data = await this.command<ViewportCapture>({
      type: 'capture-viewport',
      ...(size === undefined ? {} : { size }),
    });
    return { base64: data.base64, mimeType: data.mimeType };
  }

  /**
   * Unit 4 (live-front-door wave) — capture the RUNNING GAME (`vgai
   * screenshot`'s wire leg). Sends the SAME `bridge-screenshot` relay op
   * `@vgai/live`'s `RelayTransport.screenshot` (and therefore
   * `game.screenshot()` on the relay path) already sends, so all three
   * surfaces composite the identical full game stack — canvas(es) plus the
   * HUD/react DOM layers — rather than any of them inventing a second,
   * subtly-different capture path. Contrast {@link captureViewport}, which
   * captures the EDITOR viewport's canvas and would silently hand back an
   * editor-only (HUD-less, possibly not-even-playing) image.
   *
   * Rejects — loudly, via `command`'s own `{ok:false}` unwrap — when play
   * mode isn't running ("not in play mode — start play before using the
   * debug seam") or no game canvas is mounted yet. Never returns a blank or
   * editor-only frame as a stand-in.
   *
   * `opts.refreshStarvedFrame` is the loop-starvation leg: without recent rAF
   * progress the canvas holds a provably stale frame and the relay
   * refuses it with `BRIDGE_SCREENSHOT_STALE` rather than pass it off as
   * current. Setting this asks the relay to render exactly ONE deterministic
   * tick (`runTicks(1, {render:'last'})`) first — the same escape
   * `@vgai/live`'s `RelayTransport.screenshot` has always used, which is why
   * `vgai eval` could recover these frames while `vgai screenshot` could not.
   * Off by default: a caller who does not ask must never be handed a frame
   * that only exists because the capture drove the game.
   */
  async captureGame(opts?: { refreshStarvedFrame?: boolean }): Promise<GameCapture> {
    const data = await this.command<GameCapture>({
      type: 'bridge-screenshot',
      ...(opts?.refreshStarvedFrame === true ? { refreshStarvedFrame: true } : {}),
    });
    const layers = data.layers;
    const flatness = data.flatness;
    return {
      base64: data.base64,
      mimeType: data.mimeType,
      composite: data.composite === true,
      ...(layers && Number.isInteger(layers.canvases) && Number.isInteger(layers.domOverlays)
        ? { layers }
        : {}),
      // Pass the pixel-honesty fields through as the page reported them: the
      // warning sentence is written where the pixels are, so nothing here
      // re-derives (or softens) it.
      ...(flatness && typeof flatness.dominantFraction === 'number' ? { flatness } : {}),
      ...(data.loopRecoveryFrame === true ? { loopRecoveryFrame: true } : {}),
      // Same pass-through rule: the recorded-run notice is written where the
      // pixels are, so nothing here re-derives or softens it.
      ...(data.recording && typeof data.recording.notice === 'string'
        ? { recording: data.recording }
        : {}),
    };
  }

  /** Start recording the same clean running-game composite `captureGame`
   * photographs. Recording state lives in the editor page, so another process
   * may stop it later through the same project session. */
  async startGameplayRecording(
    options: GameplayRecordingOptions = {},
  ): Promise<GameplayRecordingStarted> {
    return this.command<GameplayRecordingStarted>({
      type: 'bridge-recording-start',
      ...(options.fps !== undefined ? { fps: options.fps } : {}),
      ...(options.name !== undefined ? { name: options.name } : {}),
      ...(options.format !== undefined ? { format: options.format } : {}),
    });
  }

  /** Export a paused run as fixed-step video. Advances game state; maximum
   * five minutes. `audio` describes the muxed track, or is `false` when the
   * world implements no `AudioAdapter.renderOffline` and the file is
   * genuinely silent — read it, never assume either. */
  async exportGameplayVideo(options: { frames: number; fps?: number; name?: string }): Promise<{
    path: string;
    frames: number;
    fps: number;
    durationMs: number;
    wallMs: number;
    width: number;
    height: number;
    audio:
      | false
      | {
          codec: 'opus';
          sampleRate: number;
          channels: number;
          durationSeconds: number;
          rms: number;
          peak: number;
        };
  }> {
    return this.command(
      { type: 'bridge-recording-export', ...options },
      { deadlineMs: 610_000, retryTransport: false },
    );
  }

  /** Stop the page-owned recorder and return its WebM path and metadata. */
  async stopGameplayRecording(): Promise<GameplayRecordingCapture> {
    return this.command<GameplayRecordingCapture>({ type: 'bridge-recording-stop' });
  }

  /** Read the active capture's monotonic media position. This is the only clock
   * suitable for selecting intervals inside the finalized recording. */
  async getGameplayRecordingTimeline(): Promise<GameplayRecordingTimeline> {
    const timeline = await this.command<GameplayRecordingTimeline>({
      type: 'bridge-recording-timeline',
    });
    return { startedAt: timeline.startedAt, elapsedMs: timeline.elapsedMs };
  }

  /** Encode a recorded canvas/DOM interval into a normal composite WebM. */
  async exportGameplayReplay(options: {
    replayPath: string;
    fps?: number;
    startMs?: number;
    endMs?: number;
    name?: string;
  }): Promise<{
    path: string;
    frames: number;
    fps: number;
    durationMs: number;
    width: number;
    height: number;
    audio: boolean;
  }> {
    return this.command(
      { type: 'bridge-recording-replay-export', ...options },
      { deadlineMs: 610_000, retryTransport: false },
    );
  }

  async captureGameplayReplay(
    replayPath: string,
    positionMs: number,
  ): Promise<GameplayReplayCapture> {
    return this.command<GameplayReplayCapture>({
      type: 'bridge-recording-replay-capture',
      replayPath,
      positionMs,
    });
  }

  /**
   * Capture an isolated, deterministic four-view preview through the editor's
   * native Asset Lab. The SDK delegates rendering to the editor; it never
   * loads, clones, or interprets Three.js assets itself.
   */
  async captureAssetPreview(
    source: AssetPreviewSource,
    options: AssetPreviewOptions = {},
  ): Promise<AssetPreviewCapture> {
    const data = await this.command<AssetPreviewCapture>(
      {
        type: 'capture-asset-preview',
        ...source,
        ...options,
      },
      // Photographing changes nothing, and this is the relay `vgai screenshot
      // <module>` / `project.bake.preview` rides — the lane where a momentary
      // transport failure cost a cold agent three probe modules.
      { retryTransport: true },
    );
    return {
      width: data.width,
      height: data.height,
      // Absent from editors that predate orientation reporting.
      ...(data.orientation ? { orientation: data.orientation } : {}),
      views: data.views,
      contactSheet: data.contactSheet,
    };
  }

  /**
   * A project-defined labeled shot set (`vgai screenshot <target> --shots <set>`):
   * the DEFINITION travels with the command (project data — see
   * `AssetPreviewShotSetDefinition`; the CLI resolves it from the registered
   * `project.<set>.previewShots` tool), and the editor's generic
   * capture engine renders it — see `packages/editor/src/asset-preview.ts`'s
   * `captureShotSetAssetPreview`. Throws (via `command`'s `{ok:false}`
   * unwrap) with a clear message naming the missing joint(s) when the asset
   * lacks a bone the definition requires.
   */
  async captureShotSetPreview(
    source: AssetPreviewSource,
    definition: AssetPreviewShotSetDefinition,
    options: AssetPreviewOptions = {},
  ): Promise<LabeledShotSetCapture> {
    const data = await this.command<LabeledShotSetCapture>(
      {
        type: 'capture-asset-preview',
        ...source,
        ...options,
        shotSet: definition,
      },
      { retryTransport: true },
    );
    return {
      width: data.width,
      height: data.height,
      shots: data.shots,
      // An older editor predates the empty-frame guard and sends none.
      warnings: data.warnings ?? [],
      contactSheet: data.contactSheet,
    };
  }

  /**
   * B8.4 — score the asset against a reference GLB (`vgai screenshot
   * <model.glb> --compare <ref.glb>`): matched orthographic front + side silhouettes
   * (equal-height bounding-box framing, both yaw-normalized to face the
   * camera), per-view IoU numbers, and overlay evidence images. The
   * reference GLB's raw bytes travel base64 in the command; the editor
   * renders and scores — the SDK never interprets Three.js assets itself.
   */
  async captureAssetComparePreview(
    source: AssetPreviewSource,
    refGlbBase64: string,
    options: AssetCompareOptions = {},
  ): Promise<AssetCompareCapture> {
    const { refForward, ...dimensions } = options;
    const data = await this.command<AssetCompareCapture>({
      type: 'capture-asset-preview',
      ...source,
      ...dimensions,
      compare: { glbBase64: refGlbBase64, ...(refForward ? { forward: refForward } : {}) },
    });
    return { width: data.width, height: data.height, views: data.views };
  }

  /**
   * The STORY lane (`vgai screenshot <file>.stories.tsx`): every CSF export of
   * one project story file rendered in the live session's DOM and captured
   * through the same composite leg {@link captureGame} uses, returned as
   * per-export images plus one variant sheet. `options.story` narrows to a
   * single export.
   *
   * Rendering happens in the EDITOR — the SDK never imports, composes or
   * mounts a CSF module itself; the session already owns that machinery for
   * its Stories panel and this drives it.
   */
  async captureStoryVariants(
    modulePath: string,
    options: StoryCaptureOptions = {},
  ): Promise<StoryVariantCapture> {
    const data = await this.command<StoryVariantCapture>({
      type: 'capture-story-variants',
      modulePath,
      ...options,
    });
    return {
      modulePath: data.modulePath,
      width: data.width,
      height: data.height,
      variants: data.variants,
      contactSheet: data.contactSheet,
    };
  }

  // --- Panels ---

  async showViewport(tab: ViewportTab): Promise<void> {
    await this.command({ type: 'viewport-tab', tab });
  }

  /** Focus a static workspace panel by the key the editor's panel registry
   *  holds; an unknown key refuses naming the keys it does hold. */
  async showPanel(panel: string): Promise<void> {
    await this.command({ type: 'show-panel', panel });
  }

  /** Show several instances of the running game split-screen — multiplayer
   *  authoring. Pass a total `count` (default "Player N" labels) or an array of
   *  `names` (its length is the count; index 0 is the primary). Requires a live
   *  play session. */
  async setInstanceCount(countOrNames: number | string[]): Promise<void> {
    await this.command(
      Array.isArray(countOrNames)
        ? { type: 'set-instance-count', names: countOrNames }
        : { type: 'set-instance-count', count: countOrNames },
    );
  }

  async openAsset(path: string, kind: AssetKind): Promise<void> {
    await this.command({ type: 'open-asset-tab', path, kind });
  }

  /** SELECT a project asset — the other half of the browser's
   *  selection-vs-open contract (single click selects and fills the
   *  Inspector; double click opens a document). */
  async selectAsset(path: string): Promise<void> {
    await this.command({ type: 'select-asset', path });
  }

  async closeAsset(key: string): Promise<void> {
    await this.command({ type: 'close-asset-tab', key });
  }

  async toggleCommandPalette(): Promise<void> {
    await this.command({ type: 'toggle-command-palette' });
  }

  async toggleConsole(): Promise<void> {
    await this.command({ type: 'toggle-console' });
  }

  /** Switch the editor's NAMED WORKSPACE — the task-named layout memory
   *  (`game`/`model`/`sculpt`/`texture`/`animate`/`look`). Resolves once the
   *  dock has finished rebuilding, so a following capture photographs the
   *  arrangement that was asked for. */
  async setWorkspace(workspace: EditorWorkspaceName): Promise<void> {
    await this.command({ type: 'set-workspace', workspace });
  }

  /** Apply a STYLE BUNDLE — palette, material, icon set and region defaults
   *  in one gesture (`classic`/`glass`/`maya`/`substance`, or one a package
   *  the project declares carries, `blender`). */
  async setStyle(style: string): Promise<void> {
    await this.command({ type: 'set-style', style });
  }

  /** Set the MATERIAL apart from the bundle that usually carries it.
   *  Answers with what the chrome wears afterwards. */
  async setAppearance(appearance: {
    readonly material?: string;
  }): Promise<{ material: string; style: string | null }> {
    return this.command<{ material: string; style: string | null }>({
      type: 'set-appearance',
      ...appearance,
    });
  }

  async showBuild(): Promise<void> {
    await this.command({ type: 'show-build' });
  }

  /** Atomically present a durable editor view and return its shareable URL. */
  async present(view: EditorView): Promise<PresentedEditorView> {
    const presented = await this.command<PresentedEditorView>({ type: 'present-view', view });
    return { view: presented.view, url: presented.url, warnings: presented.warnings };
  }

  /**
   * The INSPECTION SUBJECT the editor is showing right now, as data — the
   * serialized projection of the inspection model (design:
   * `docs/ARCHITECTURE-CORE.md` §Editor chrome, "The Inspection Model").
   *
   * The same subject a human reads in the inspector: identity, presentation,
   * verbs, and the identified sections in display order — with a `fields`
   * section's CURRENT VALUES read through the same io the field rows edit
   * through. With nothing selected it answers the active surface's own
   * no-selection subject when it has one, exactly as the panel does; it never
   * reports another surface's, and when the panel itself is unmounted it
   * answers `{none: true}` rather than a subject nobody is looking at. A
   * `custom` section body is a named opaque (`{kind, id, title}`) — the editor
   * renders those with React — plus its displayed values under `data` when it
   * has any (the Transform section's position/rotation/scale).
   */
  async inspect(): Promise<InspectedInspection> {
    const data = await this.command<{ subject: InspectedInspection }>({ type: 'inspect' });
    return data.subject;
  }

  /** Run one verb exposed by the active Inspector subject, by its id. */
  async runInspectionAction(actionId: string): Promise<InspectedInspection> {
    const data = await this.command<{ subject: InspectedInspection }>({
      type: 'run-inspection-action',
      actionId,
    });
    return data.subject;
  }

  /**
   * Run ONE command by id — the door to everything the command palette lists.
   *
   * Under the Code-OSS frame this is the workbench's own `ICommandService`, so
   * any command id works: a view's `vgai.<view>.<verb>`, an editor action's
   * `vgai.action.<id>`, or one of VS Code's own. Standalone `vgai edit` has no
   * command service and answers the `vgai.<view>.<verb>` shape directly off
   * the views registry, refusing anything else BY NAME.
   *
   * The result is whatever the command answered — a view verb's state, or
   * `null` for a command that returns nothing.
   */
  async runCommand(commandId: string, args?: unknown): Promise<unknown> {
    const data = await this.command<{ result: unknown }>({
      type: 'run-command',
      commandId,
      ...(args === undefined ? {} : { args }),
    });
    return data.result;
  }

  /**
   * One STRUCTURE op on the authored tree — the hierarchy context menu's own
   * verbs, on the same helpers, for a caller with no pointer to right-click
   * with. `id`/`ids` default to the current selection.
   */
  async structureOp(op: StructureOp, options: StructureOpOptions = {}): Promise<StructureOpResult> {
    return this.command<StructureOpResult>({ type: 'structure-op', op, ...options });
  }

  /** "Extract Component…" — the hierarchy row's action, as a command. Answers
   *  the action's own sentence, which NAMES the files it created. */
  async extractComponent(options: { id?: string; name?: string } = {}): Promise<{ hint: string }> {
    return this.command<{ hint: string }>({ type: 'extract-component', ...options });
  }

  /** "Fork Component…" — extract's twin: one new file, one callsite retargeted. */
  async forkComponent(options: { id?: string } = {}): Promise<{ hint: string }> {
    return this.command<{ hint: string }>({ type: 'fork-component', ...options });
  }

  /**
   * The HIERARCHY PANEL's actual rendered row tree, as data.
   *
   * The same rows a human is looking at: the adapter's tree after the component
   * marks fold implementation subtrees, after the internals reveal, after the
   * document promotion, the child cap, the collapse state, the search filter
   * and the selection scope. Works in play mode and edit mode alike — the
   * answer reports which (`playState`, `activeViewportTab`), because a
   * play-mode tree and an edit-mode tree come from different adapters.
   *
   * Deliberately NOT `status().entities`, which walks the raw adapter tree and
   * therefore answers a different question: a panel defect is invisible in it.
   *
   * Each row carries `childCount` (what its caret opens), `internalChildCount`
   * (what is folded behind "Reveal Internals") and `expandable` (whether the
   * panel draws a caret at all) — so "this subtree exists but the UI offers no
   * way to open it" is a readable fact rather than something only a human
   * squinting at the panel can notice.
   *
   * Rejects, naming the panel, when no hierarchy panel is mounted: an empty
   * tree would be a fabricated answer about a surface nobody is being shown.
   */
  async hierarchy(): Promise<InspectedHierarchy> {
    const data = await this.command<{ hierarchy: InspectedHierarchy }>({ type: 'hierarchy' });
    return data.hierarchy;
  }

  /** Run the Hierarchy panel's own Expand All action. */
  async expandHierarchyAll(): Promise<void> {
    await this.command<Record<string, never>>({ type: 'expand-hierarchy-all' });
  }

  /** Run the Hierarchy panel's own Collapse All action — Expand All's other
   *  half, and the only way back to the tree's rest state through the product
   *  (see `HierarchyPanelSnapshot.collapseAll`). */
  async collapseHierarchyAll(): Promise<void> {
    await this.command<Record<string, never>>({ type: 'collapse-hierarchy-all' });
  }

  /**
   * Write one editable path through the active Inspector's own IO.
   *
   * The answer carries `write` as well as the subject, because an ack alone
   * cannot be believed: a write with no persistence route open succeeds and
   * changes no byte, and `write.persisted` is how the caller tells the two
   * apart without diffing the tree (`InspectedWriteDestination` in `types.ts`).
   */
  async setInspectionField(path: string, value: unknown): Promise<InspectedFieldWrite> {
    const data = await this.command<InspectedFieldWrite>({
      type: 'set-inspection-field',
      path,
      value,
    });
    return { subject: data.subject, write: data.write };
  }

  /**
   * REMOVE one editable path's authored override — the other half of the write
   * door, and the only one that can express byte-ABSENCE.
   *
   * {@link setInspectionField} writes a VALUE, so reverting a property an
   * authoring gesture ADDED puts the default back EXPLICITLY and leaves the
   * source one attribute heavier than it started. This drops the property, so
   * whatever governs it in its absence takes over — the same `io.remove` the
   * Inspector's revert arrow calls, the same persistence pipe, the same awaited
   * `{ destination, persisted }` ack.
   *
   * Rejects with `code: 'REMOVAL_UNAVAILABLE'` when the field does not declare
   * itself removable or the lane implements no removal door. That refusal is a
   * MISSING SEAM, not a failed removal, and it is coded rather than phrased
   * precisely so a caller can grade the two differently.
   */
  async removeInspectionField(path: string): Promise<InspectedFieldWrite> {
    const data = await this.command<InspectedFieldWrite>({
      type: 'remove-inspection-field',
      path,
    });
    return { subject: data.subject, write: data.write };
  }

  /**
   * OPEN one piece of the adapter's SCENE TABLE by id — a scene, a prefab, or
   * a story state, because the table makes them siblings (they differ only in
   * instance site). The ids are exactly what `getState().adapter.scenes.entries`
   * reports, so the table is both the menu and the address space.
   *
   * With a game LIVE in the session, opening a scene the adapter declares
   * reachable through that game's own scenes contract NAVIGATES it — the same
   * switch the editor's own scene picker makes — and the answer carries the
   * game's own reading (`scene`).
   *
   * Rejects with a coded reason rather than prose: `SCENE_NOT_FOUND` (and it
   * names the ids that DO exist), `SCENE_NOT_OPENABLE` carrying the adapter's
   * own declared reason for a scene it says nothing can reach,
   * `SCENE_NAVIGATION_NOT_RUNNING` for a live-only scene with no game running,
   * `SCENE_CONTRACT_UNAVAILABLE` / `SCENE_NOT_IN_CONTRACT` (naming the ids the
   * game itself publishes) / `SCENE_SWITCH_FAILED` when the running game's own
   * navigation cannot take it, `SCENE_NOT_OPENABLE_LIVE` when this session has
   * no remount for a native swap-slot scene,
   * `SCENE_TABLE_UNAVAILABLE` before the adapter has loaded, and
   * `SCENE_DOCUMENT_NOT_MOUNTED` when the host has no document for a piece the
   * table says is openable — a host gap, not a table statement.
   */
  async open(id: string): Promise<OpenedDocument> {
    return this.command<OpenedDocument>({ type: 'open', id });
  }

  /**
   * Undo / redo one project transaction — the same queue the keyboard shortcut
   * drives. `moved` is false when there was nothing left in that direction.
   */
  async undo(): Promise<HistoryStep> {
    return this.command<HistoryStep>({ type: 'undo' });
  }

  async redo(): Promise<HistoryStep> {
    return this.command<HistoryStep>({ type: 'redo' });
  }

  /** Read the editor's actual current durable projection. */
  async currentView(): Promise<EditorView> {
    const data = await this.command<{ view: EditorView }>({ type: 'current-view' });
    return data.view;
  }

  /**
   * Capture the active center document exactly as presented to the user.
   *
   * A number is a SQUARE of that size (the default shape); `{width, height}`
   * asks for a shaped frame — a video-aspect look that needs no crop. Both are
   * bounded by the relay budget; see {@link CaptureDimensions}.
   */
  /** Photograph the editor PAGE itself — every panel as the person sees it, at
   *  `scale` output pixels per CSS pixel (default `devicePixelRatio`), which is
   *  what a 1 px border or a glyph edge is judged through. */
  async captureEditorChrome(options?: EditorChromeCaptureOptions): Promise<EditorChromeCapture> {
    return this.command<EditorChromeCapture>({
      type: 'capture-editor-chrome',
      ...(options?.scale === undefined ? {} : { scale: options.scale }),
    });
  }

  /** With a view, present and capture it in one request so document discovery
   * cannot retarget the capture between two client calls. */
  async captureActiveDocument(
    size?: CaptureDimensions,
    view?: EditorView,
  ): Promise<ActiveDocumentCapture> {
    return this.command<ActiveDocumentCapture>({
      type: 'capture-active-document',
      ...(view ? { view } : {}),
      ...(typeof size === 'number' ? { size } : {}),
      ...(typeof size === 'object' && size !== null
        ? { width: size.width, height: size.height }
        : {}),
    });
  }

  /**
   * Read or drive the ACTIVE center document's own DOM — the scoped
   * editor-chrome door, and the read/gesture half of the same subject
   * {@link captureActiveDocument} photographs. NOT play-mode gated, and NOT
   * page automation: a target outside the active document's container is
   * refused by name. Design and scope contract:
   * `packages/editor/src/editor-document-probe.ts`.
   */
  async documentProbe(step: DocumentProbeStep): Promise<DocumentProbeResult> {
    return this.command<DocumentProbeResult>({ type: 'document-probe', step });
  }

  /**
   * Run a wire-carried step against the ACTIVE document's published context
   * (`packages/editor/src/document-context-registry.ts`) — the REPL door over
   * an open document, in Edit mode. `src` is the step's own `toString()`;
   * same serialization contract as `page-script` (no closures survive).
   */
  /**
   * The Blender lane's doors (`blender-execute`, `blender-scene-info`,
   * `blender-object-info`, `blender-screenshot-view`, `blender-read-file`,
   * `blender-write-file`, `blender-list-files`, `blender-start`,
   * `blender-status`): Blender runs in the editor tab's worker, and
   * `vgai blender-mcp` is transport onto these. `blender-status` is the only
   * one that creates nothing — it answers whether this tab already has a
   * session, which is how a caller survives an editor restart.
   */
  async blender<T extends object = Record<string, unknown>>(
    type: `blender-${string}`,
    fields: Record<string, unknown> = {},
  ): Promise<T> {
    // One modeling chunk can run for minutes in the tab (an exact boolean
    // over a dense mesh measured 80-90 s under Wasm); the relay's server-side
    // budget for blender-execute is the same half hour.
    return this.command<T>({ type, ...fields }, { deadlineMs: BLENDER_DEADLINE_MS });
  }

  async documentScript<T = unknown>(src: string): Promise<T> {
    const outcome = await this.command<{ result: T }>({ type: 'document-script', src });
    return outcome.result;
  }

  // --- Display (set semantics) ---

  async setGrid(enabled: boolean): Promise<void> {
    await this.command({ type: 'set-grid', enabled });
  }

  async setHelpers(enabled: boolean): Promise<void> {
    await this.command({ type: 'set-helpers', enabled });
  }

  async setStats(enabled: boolean): Promise<void> {
    await this.command({ type: 'set-stats', enabled });
  }

  async setShadingMode(mode: ShadingMode): Promise<void> {
    await this.command({ type: 'set-shading-mode', mode });
  }

  async setHelperType(helperType: keyof HelperVisibility, enabled: boolean): Promise<void> {
    await this.command({ type: 'set-helper-type', helperType, enabled });
  }

  // --- Transform tools (set semantics) ---

  async setTransformMode(mode: TransformMode): Promise<void> {
    await this.command({ type: 'set-transform-mode', mode });
  }

  async setTransformSpace(space: TransformSpace): Promise<void> {
    await this.command({ type: 'set-transform-space', space });
  }

  async setSnap(enabled: boolean): Promise<void> {
    await this.command({ type: 'set-snap', enabled });
  }

  // --- Project management ---

  async createProject(
    name: string,
    location: string,
    template: ProjectTemplate = 'default',
    exampleId?: string,
  ): Promise<ProjectInfo> {
    const res = await this.httpFetch(`${this.baseUrl}/__editor/create-project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, location, template, ...(exampleId ? { exampleId } : {}) }),
    });
    const data = (await this.readJson(res)) as {
      ok?: boolean;
      error?: string;
      path?: string;
      config?: ProjectInfo['config'];
    };
    if (!res.ok) {
      throw new Error(data.error ?? `Create project failed: ${res.status}`);
    }
    return { path: data.path as string, config: data.config as ProjectInfo['config'] };
  }

  async openProject(path: string): Promise<void> {
    const res = await this.httpFetch(`${this.baseUrl}/__editor/open-project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    const body = (await this.readJson(res)) as { error?: string };
    if (!res.ok) {
      throw new Error(body.error ?? `Open project failed: ${res.status}`);
    }
  }

  async getProject(): Promise<ProjectInfo | null> {
    const res = await this.httpFetch(`${this.baseUrl}/__editor/project`);
    const data = (await this.readJson(res)) as { project: ProjectInfo | null; error?: string };
    if (!res.ok) throw new Error(data.error ?? `Failed to get project: ${res.status}`);
    return data.project;
  }

  async listRecentProjects(): Promise<RecentProject[]> {
    const res = await this.httpFetch(`${this.baseUrl}/__editor/recent-projects`);
    const data = (await this.readJson(res)) as { projects: RecentProject[]; error?: string };
    if (!res.ok) throw new Error(data.error ?? `Failed to list projects: ${res.status}`);
    return data.projects;
  }

  // --- Registered project tools ---

  /** List tools explicitly registered in `package.json#vgai.tools`.
   * The editor server loads callable metadata in Node; modules never enter the
   * editor browser merely because they were listed. */
  async listProjectTools(): Promise<ProjectToolCatalog> {
    const res = await this.httpFetch(`${this.baseUrl}/__editor/project-tools`);
    const body = await this.readJson(res);
    if (!res.ok) throw new Error(`Failed to list project tools: ${res.status}`);
    return body as ProjectToolCatalog;
  }

  /** Execute one Node-hosted project tool through the shared validated
   * dispatcher. Write/destructive tools require `confirm:true`. */
  async runProjectTool(
    name: string,
    input: unknown = {},
    options: { confirm?: boolean; instance?: string } = {},
  ): Promise<ProjectToolOutcome> {
    // Provider subscriptions can outlive Node fetch's five-minute header limit.
    // Match browser fetch for this operation; dispose its sockets after reading the result.
    const dispatcher = createDispatcher(0);
    try {
      const res = await this.httpFetch(
        `${this.baseUrl}/__editor/project-tools/run`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            input,
            confirm: options.confirm === true,
            // Omitted (not null) when unset — the wire body is JSON and the tool
            // host reads absence as "the sole instance", same convention as the
            // relay's `instance`.
            ...(options.instance !== undefined ? { instance: options.instance } : {}),
          }),
        },
        dispatcher,
      );
      const body = (await this.readJson(res)) as ProjectToolOutcome;
      if (!body || typeof body !== 'object' || typeof body.ok !== 'boolean') {
        throw new Error(`Project tool returned an invalid response (${res.status}).`);
      }
      return body;
    } finally {
      await dispatcher?.destroy?.();
    }
  }

  // --- First-party generation job activity ---

  /** Read the one project-local generation job ledger. Provider-native
   * request/result shapes remain on their registered operations. */
  async listGenerationJobs(): Promise<GenerationJobsDocument> {
    const res = await this.httpFetch(`${this.baseUrl}/__editor/generations`);
    const body = await this.readJson(res);
    if (!res.ok) throw new Error(`Failed to list generation jobs: ${res.status}`);
    return body as GenerationJobsDocument;
  }

  /** Forget operational job state. Accepted provenance and project assets
   * are deliberately unaffected. */
  async forgetGenerationJob(id: string): Promise<boolean> {
    const res = await this.httpFetch(
      `${this.baseUrl}/__editor/generations/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
      },
    );
    const body = (await this.readJson(res)) as { removed?: boolean; error?: string };
    if (!res.ok) throw new Error(body.error ?? `Failed to forget generation job: ${res.status}`);
    return body.removed === true;
  }

  // --- Logs ---

  async getLogEntries(): Promise<
    Array<{ t: number; level: string; msg: string; source?: string }>
  > {
    const res = await this.httpFetch(`${this.baseUrl}/__editor/log-entries`);
    const data = (await this.readJson(res)) as {
      entries: Array<{ t: number; level: string; msg: string; source?: string }>;
    };
    if (!res.ok) return [];
    return data.entries;
  }

  // --- State ---

  /**
   * The document table the host resolved — every scene, prefab, page, model,
   * shot, take … the project's finders produced (`getState().adapter.scenes`
   * is the same projection). A command, so it answers wherever the control
   * channel reaches, not only where `/__editor/state` is served.
   */
  async documentTable(): Promise<DocumentTableProjection> {
    return this.command<DocumentTableProjection>({ type: 'document-table' });
  }

  async getState(): Promise<EditorState> {
    const res = await this.httpFetch(`${this.baseUrl}/__editor/state`);
    const state = (await this.readJson(res)) as EditorState;
    if (!res.ok) throw new Error(`Failed to get editor state: ${res.status} ${res.statusText}`);
    return state;
  }

  /**
   * The complete unresolved console set the session is holding right now.
   *
   * Command envelopes only carry COUNTS (`unresolvedConsole` on
   * `commandResponseFor`). The named conditions live on GET `/__editor/console`.
   * This is the method that turns "a command that exits before an envelope
   * arrives" into a real reading: the CLI calls it at start and at exit
   * through the same {@link onEnvelope} observer every other response uses.
   * A session that does not answer within {@link CONSOLE_DRAIN_TIMEOUT_MS} is
   * a thrown error the caller treats as "nothing learned", never a hang.
   */
  async getUnresolvedConsole(opts?: { all?: boolean }): Promise<unknown> {
    const res = await this.httpFetch(
      `${this.baseUrl}/__editor/console${opts?.all === true ? '?all=1' : ''}`,
      { signal: AbortSignal.timeout(CONSOLE_DRAIN_TIMEOUT_MS) },
    );
    // Status first: a 404's empty body would otherwise die inside readJson
    // with a parse error that hides the one fact the caller classifies on
    // (does this server SERVE the console route at all?).
    if (!res.ok) {
      throw new Error(`Failed to read unresolved console: ${res.status}`);
    }
    return await this.readJson(res, true);
  }

  /** Acknowledge one named console condition. The response is observed and
   *  hydrated through the same path as every other client response. */
  async acknowledgeConsole(input: {
    readonly id: string;
    readonly reason: string;
    readonly by: string;
  }): Promise<unknown> {
    const res = await this.httpFetch(`${this.baseUrl}/__editor/console/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(CONSOLE_DRAIN_TIMEOUT_MS * 4),
    });
    const body = await this.readJson(res);
    return body;
  }

  /**
   * `fetch` for this client's plain routes, with the ONE thing Node's `fetch`
   * will not do: name why it failed.
   *
   * `readJson` below already owns "the server answered the wrong thing"; this
   * owns "nothing answered at all", which used to reach the caller as the bare
   * `TypeError: fetch failed` with the real code buried on `.cause`. No retry
   * here — these routes create projects, run tools and acknowledge console
   * conditions, so repeating one is the caller's decision. The relayed
   * `command` path above has its own opt-in retry for the read-only captures.
   */
  private async httpFetch(
    url: string,
    init?: RequestInit,
    dispatcher?: Dispatcher,
  ): Promise<Response> {
    try {
      return await dispatchFetch(url, init, dispatcher);
    } catch (error) {
      if ((error as { name?: string } | null)?.name === 'TimeoutError') throw error;
      const { code, detail } = describeFetchFailure(error);
      throw new EditorCommandError(
        `${init?.method ?? 'GET'} ${url} never reached the editor: ${code}` +
          `${detail ? ` (${detail})` : ''}. Nothing answered on that port — check the terminal ` +
          'running `volter-editor edit` and confirm the port this client resolved.',
        code,
        false,
      );
    }
  }

  /** Parse one JSON body and hand it to {@link onEnvelope}.
   *
   * A command/state envelope carries current counts but not the named set. If
   * an observer is installed, do the bounded console GET before resolving the
   * original request. That makes a subsequent `process.exit()` safe: the
   * observer has already received every condition and occurrence count. */
  private async readJson(res: Response, consoleComplete = false): Promise<unknown> {
    // Every one of this client's twelve routes funnels through here, so this is
    // where "did the editor server answer?" is asked — the same question, and
    // the same JSON-content-type rule, that
    // `packages/editor/src/editor-server-response.ts` owns on the browser side.
    // It is asked again rather than imported because THIS package is published
    // and depends on neither `@volter/editor-project` nor the editor bundle (see
    // `DEFAULT_URL` above for that policy).
    //
    // Not theoretical here: `baseUrl` is whatever `--url`/`VGAI_EDITOR_URL`
    // says, so the CLI is routinely pointed at a SHARE TUNNEL or a static host
    // — both of which answer `200 text/html` for a route nothing serves, and
    // `res.json()` then died as `Unexpected token '<'`, naming neither the URL
    // nor the cause.
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      throw new Error(
        `The editor at ${this.baseUrl} answered with its page fallback ` +
          `(${contentType || 'no content-type'}) rather than JSON, so no editor server handled ` +
          'the request. Check that this URL is a running `volter-editor edit` session.',
      );
    }
    const body: unknown = await res.json();
    this.observe(body, { unresolvedConsoleComplete: consoleComplete });
    if (
      this.onEnvelope !== null &&
      !consoleComplete &&
      body !== null &&
      typeof body === 'object' &&
      'unresolvedConsole' in body
    ) {
      try {
        const consoleRes = await this.httpFetch(`${this.baseUrl}/__editor/console`, {
          signal: AbortSignal.timeout(CONSOLE_DRAIN_TIMEOUT_MS),
        });
        if (consoleRes.ok) {
          const consoleBody: unknown = await consoleRes.json();
          this.observe(consoleBody, { unresolvedConsoleComplete: true });
        }
      } catch {
        // The original response remains authoritative. A reporting follow-up
        // may degrade to its count-only envelope, never break the command.
      }
    }
    return body;
  }

  /** Hand one response body to {@link onEnvelope}, never letting it throw. */
  private observe(body: unknown, observation: EditorEnvelopeObservation): void {
    if (this.onEnvelope === null) return;
    try {
      this.onEnvelope(body, observation);
    } catch {
      // A reporting hook may never break the command it is reporting on.
    }
  }

  /**
   * Whether an editor browser tab is connected to the server *right now*.
   * Unlike {@link getState}, this reflects live SSE connections, not cached
   * state — use it to check whether commands will actually reach an editor.
   */
  async isConnected(): Promise<boolean> {
    const state = await this.getState();
    return state.connected === true;
  }

  async waitForState(
    predicate: (s: EditorState) => boolean,
    timeoutMs = 10_000,
  ): Promise<EditorState> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const state = await this.getState();
      if (predicate(state)) return state;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`waitForState timed out after ${timeoutMs}ms`);
  }
}
