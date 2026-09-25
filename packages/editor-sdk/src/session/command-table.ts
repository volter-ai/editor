/**
 * THE RELAY COMMAND VOCABULARY, in one typed table.
 *
 * A relay command's type string used to be answered by two independent
 * switches that had to agree and were never checked against each other:
 * `command-listener.ts`'s dispatch (what the command DOES) and
 * `server/server-utils.ts`'s `relayCommandTimeoutMs` (how long the server
 * waits for it). A command missing from the second one did not fail — it
 * silently took the generic 5s default, which undercut a client's 60s hold, so
 * the uninformative timer won every race and sent a real investigation looking
 * for a dead editor.
 *
 * This table is the single source. Adding a command means adding a ROW here:
 * the dispatch switch keys off `RelayCommandType`, so a case with no row does
 * not compile, and a row with no case fails the exhaustiveness check in that
 * switch's `default`. The server imports the timeout column rather than
 * restating it.
 *
 * `timeoutMs` is the budget for the WORK. Delivery has its own, much shorter
 * budget (`RELAY_DELIVERY_ACK_MS`, clamped by `RELAY_DELIVERY_MAX_WAIT_MS`) —
 * see `server/server-utils.ts`, which explains why the two are separate.
 */

/**
 * The generic budget. Most commands are a synchronous edit against the live
 * editor and answer in milliseconds; the rows that override this are the ones
 * that boot a game, rasterize something, or hand control to a game's own code.
 */
export const DEFAULT_RELAY_COMMAND_TIMEOUT_MS = 5_000;

interface RelayCommandSpec {
  /** How long the relay waits for this command to FINISH. */
  readonly timeoutMs: number;
  /** Whether command completion owes a tree-scale status derivation. */
  readonly derivedRefresh: RelayCommandDerivedRefresh;
}

export type RelayCommandDerivedRefresh = 'none' | 'if-content-changed' | 'always';

const noDerivedRefresh = (timeoutMs = DEFAULT_RELAY_COMMAND_TIMEOUT_MS): RelayCommandSpec => ({
  timeoutMs,
  derivedRefresh: 'none',
});

const refreshIfContentChanged = (
  timeoutMs = DEFAULT_RELAY_COMMAND_TIMEOUT_MS,
): RelayCommandSpec => ({ timeoutMs, derivedRefresh: 'if-content-changed' });

const alwaysRefresh = (timeoutMs = DEFAULT_RELAY_COMMAND_TIMEOUT_MS): RelayCommandSpec => ({
  timeoutMs,
  derivedRefresh: 'always',
});

/**
 * Every command the editor's relay accepts, and how long it waits for each one
 * to answer. Pure and exported so the table is testable without booting a
 * server and standing through a real 5-second expiry.
 *
 * The rule the table encodes: the budget belongs to whoever the ack is
 * actually gated on. An ordinary editor interaction ("select this entity") is
 * gated on the editor and must fail fast — 5s. Everything with its own entry
 * is gated on something slower and outside the editor's control:
 *
 * - `capture-asset-preview` loads a model, renders four views and encodes
 *   five PNGs before acknowledging.
 * - `capture-active-document` can wait for an ingested canvas's next render,
 *   composite its canvas and DOM layers, sample flatness, and encode the PNG.
 *   It is not an ordinary editor read. Measured in Doctor on racing-game under
 *   SwiftShader: the 5s default expired while the page kept rasterizing; the
 *   walk retried, parked more captures behind it, and `stop` then 504ed behind
 *   work the relay had already told its caller was over.
 * - `active-tab` may synchronously mount a component board before its result can
 *   be serialized. The Unity FPS import has 178 stories: the page RECEIVED the
 *   command in 0.9s but its first board activation answered after the generic
 *   5s budget, while heartbeats continued throughout. This is editor work, but
 *   it is not a millisecond chrome toggle when the destination mounts a board.
 * - `select` and `inspect` may synchronously publish the selected subject and
 *   compose its inspector after a cold remount. The translated Unity FPS scene
 *   has 4,458 authored objects: Doctor measured both commands received by a
 *   beating tab yet still working past 5s, which filed seven false `play-stall`
 *   errors and made a source value that had survived the remount look unreadable.
 * - `set-inspection-field`, `remove-inspection-field`, and
 *   `run-inspection-action` are authored WRITES —
 *   the same dialect writer, the same pipe, the same budget; removing an
 *   attribute re-parses and rewrites the module exactly as setting one does.
 *   For a source-backed root
 *   that write is server work the tab waits on: the planner re-parses the
 *   game's own module, the writer rewrites the literal, and a vendored game's
 *   lock is re-hashed and recorded in the same gesture. Measured on the
 *   racing-game ingest, where the tab is also servicing a game that logs every
 *   frame: EVERY transform write came back 504 at the 5s default while the
 *   same tab answered `select`/`inspect`/`hierarchy` in the same second — so
 *   the caller was told "no editor answered" about a write that was merely
 *   slow, which is the failure mode this whole table exists to stop.
 * The PLAY verbs and the whole page-bridge family carry their budgets in
 * `@vgai/game`'s own contributed rows now, for the same reasons and with the
 * same numbers: `play` waits on the project's entire async `setup()`; `stop`
 * waits on a teardown chain; `bridge-recording-export` steps a paused game
 * frame by frame and encodes a video; `bridge-call` runs GAME code;
 * `page-script` and `game-eval` run a step the CALLER wrote; and
 * `bridge-screenshot` rasterizes the whole game stack.
 *
 * That family is the reason this table exists as a named thing. Their
 * client (`@vgai/live`'s `RelayTransport`) already applies its own per-leg
 * `AbortSignal.timeout` — 60s for invoke/page-script, 15s for screenshot —
 * and the server's generic 5s was UNDERCUTTING it, so the server's timer won
 * every race. That mattered for the message, not just the duration: the
 * client's own expiry produces `RELAY_UNREACHABLE` plus a "split the hold into
 * shorter calls" hint, while the server's produces "Command timed out —
 * editor connected but did not respond", which names nothing and sent a real
 * investigation looking for a dead editor. Keep each entry >= its client-side
 * counterpart so the informative timer is always the one that fires.
 *
 * Rows without an explicit budget take {@link DEFAULT_RELAY_COMMAND_TIMEOUT_MS}.
 */
export const RELAY_COMMANDS = {
  'session-prepare-close': noDerivedRefresh(120_000),
  // ---- Selection ---------------------------------------------------------
  select: noDerivedRefresh(30_000),
  'select-multiple': noDerivedRefresh(),
  'select-all': noDerivedRefresh(),

  // ---- Editor chrome ------------------------------------------------------
  'viewport-tab': noDerivedRefresh(),
  // Focusing a panel is dock work, but its ack WAITS for the dock to report
  // the panel focused (`revealStaticPanel`), so keep the relay past that wait.
  'show-panel': noDerivedRefresh(15_000),
  'active-tab': alwaysRefresh(30_000),
  // Opening and presenting can await the inspector and a fresh source build.
  // Keep their relay budget aligned with capture-active-document below.
  'open-asset-tab': alwaysRefresh(30_000),
  // The selection half: it changes what the Inspector shows, so the derived
  // state a caller reads next must be refreshed like the open half's.
  'select-asset': alwaysRefresh(),
  'close-asset-tab': alwaysRefresh(),
  'toggle-command-palette': noDerivedRefresh(),
  'toggle-console': noDerivedRefresh(),
  // RELOAD THE EDITOR PAGE — `@vgai/live`'s `page.reload()`, the one page verb
  // no step can express. It is the HOST's, not a package's: reloading the tab
  // is what the tab is, and until walk 5 it was a `@vgai/game` command
  // contribution, so a project without that package — every model project —
  // answered `unknown command type "page-reload"` for a door `@vgai/live`
  // documents as general (measured on a `model-editor create` scaffold,
  // 2026-09-21). The handler schedules the navigation for the next task so
  // this ack can travel before the channel is torn down; the client waits for
  // the new page load on the server's own tab table.
  'page-reload': alwaysRefresh(),
  // Acks the ARRANGEMENT, not the intent: the dock clears and rebuilds on the
  // next paint, so the handler waits for that rebuild (see
  // `workspace-presets.ts`'s applied signal). Still ordinary editor work.
  'set-workspace': noDerivedRefresh(),
  // A style bundle is chrome appearance; the document is untouched.
  'set-style': noDerivedRefresh(),
  'set-appearance': noDerivedRefresh(),
  'present-view': alwaysRefresh(30_000),
  'current-view': refreshIfContentChanged(),
  // A read of the resolved document table; changes nothing.
  'document-table': noDerivedRefresh(),

  // ---- Inspection and authoring ------------------------------------------
  // The inspection writes go through the project mutation path, which touches
  // the filesystem and may wait on a collaboration revision.
  inspect: refreshIfContentChanged(30_000),
  hierarchy: refreshIfContentChanged(),
  'expand-hierarchy-all': refreshIfContentChanged(),
  'collapse-hierarchy-all': refreshIfContentChanged(),
  'document-probe': refreshIfContentChanged(),
  // A step against the open document's session can edit it (`ctx.ops.mesh.*`).
  // Project-owned document code can rebuild an entire Model, just as a
  // page-script can rebuild a game. Give both the same execution budget.
  'document-script': refreshIfContentChanged(60_000),
  'set-inspection-field': alwaysRefresh(30_000),
  'remove-inspection-field': alwaysRefresh(30_000),
  // `extract-component` and `fork-component` left this table with their menus
  // (`@vgai/game/contributions/component-verbs.command.ts`), which carries
  // both budgets forward row for row.
  // The hierarchy context menu's structure verbs, over the control door. Every
  // one of them rewrites the game's own source, so they refresh like a write.
  'structure-op': alwaysRefresh(30_000),
  'run-inspection-action': alwaysRefresh(30_000),
  // `editor.command(id, args)` — ONE workbench/view command by id. What it
  // does is the command's, so nothing here can know whether the document
  // changed: `alwaysRefresh` is the honest budget, the same one every other
  // "run something the editor does not model" verb takes.
  'run-command': alwaysRefresh(30_000),
  undo: alwaysRefresh(),
  redo: alwaysRefresh(),
  // `open` WAITS FOR THE PROJECT ADAPTER, for the same reason `play` waits on
  // the project's async `setup()`: on a cold session the adapter's scene table
  // is not there yet, and the door's whole job is to put a document on screen
  // once it is. MEASURED on three cold `vgai edit` sessions over a
  // `--template models` probe — 6025 / 6831 / 6474 ms from tab-connected to
  // the entry being listed, every one of them first refusing with
  // `SCENE_TABLE_UNAVAILABLE`. At the 5 s default the relay's timer won that
  // race and the caller was told "the tab did not respond" about a door that
  // was merely waiting, which is the exact failure this table exists to stop.
  // 30 s sits above `openSceneTableEntryWhenListed`'s own 15 s bound so the
  // INFORMATIVE refusal (the scene table's, naming the known ids) is always
  // the one that fires.
  open: alwaysRefresh(30_000),

  // ---- Rasterizing --------------------------------------------------------
  // Everything here renders something and reads pixels back.
  'capture-active-document': refreshIfContentChanged(30_000),
  // The whole editor page through the same compositor; the foreignObject leg
  // over a full dock takes seconds, not milliseconds.
  'capture-editor-chrome': refreshIfContentChanged(30_000),
  'capture-asset-preview': refreshIfContentChanged(30_000),

  // The ONE door onto a view's verbs (`@volter/editor-sdk/views`, U8 ruling 1).
  // A verb either READS the view or moves its own transform; neither touches
  // a document, so nothing derived refreshes.

  // The THREE VIEWPORT'S verbs — framing, the camera, view presets, the open
  // Object3D document's orbit/turntable/frame, the viewport photograph and the
  // display and transform toggles — are its own command contribution
  // (`viewport-commands.ts`), each budget on its contributed row.

  // The BLENDER lane's ten verbs are `@vgai/blender`'s
  // `contributions/blender.command.ts` (WORK.md §The workbench, item D) —
  // each row's budget travelled with it, onto the contributed spec the page
  // reports to the server. `capture-story-variants` made the same move, to the
  // kit's own `stories/story-capture-command.ts`: it
  // mounts each CSF export, waits for the DOM to settle, rasterizes it through
  // the `foreignObject` leg and tiles the sheet, so its budget scales with the
  // file's export count rather than with any single render — 120 s, measured
  // on a real 10-story HUD file that expired the default outright, and stated
  // now on the contributed row instead of here.
} as const satisfies Record<string, RelayCommandSpec>;

/** Every command type the relay accepts. The dispatch switch keys off this. */
export type RelayCommandType = keyof typeof RELAY_COMMANDS;

/** The vocabulary as data — what a guard or a tool enumerates. */
export const RELAY_COMMAND_TYPES = Object.keys(RELAY_COMMANDS) as readonly RelayCommandType[];

export function isRelayCommandType(value: unknown): value is RelayCommandType {
  return typeof value === 'string' && Object.hasOwn(RELAY_COMMANDS, value);
}

/**
 * How long the relay waits for a command to finish. An unrecognized type gets
 * the generic budget rather than an error: the relay's job is to hand the
 * string to the tab and let the TAB say it does not know it.
 */
export function relayCommandTimeoutMs(type: unknown): number {
  return isRelayCommandType(type)
    ? RELAY_COMMANDS[type].timeoutMs
    : DEFAULT_RELAY_COMMAND_TIMEOUT_MS;
}

/** The status-derivation policy owned by the same command row as its timeout. */
export function relayCommandDerivedRefresh(type: unknown): RelayCommandDerivedRefresh {
  return isRelayCommandType(type) ? RELAY_COMMANDS[type].derivedRefresh : 'always';
}

/**
 * The subset an INGEST session answers itself (`ingest/ingest-play-commands.ts`).
 * A captured ingest is not a host-mounted root, so first-party play would tear
 * its mount down; these five are dispatched against the ingest surface instead.
 *
 * Plain strings, not `RelayCommandType`: the five verbs left this table for
 * `@vgai/game`'s `play.command.ts` when Play left the host (WORK.md §The
 * workbench, P3b), and the ingest latch runs in `handleCommand`'s PROLOGUE —
 * before any contributed handler is looked up — so a captured ingest still
 * answers them first. The latch moves with ingest in P4.
 */
export const INGEST_PLAY_COMMAND_TYPES = [
  'play',
  'stop',
  'pause',
  'resume',
  'step',
] as const satisfies readonly string[];

export type IngestPlayCommandType = (typeof INGEST_PLAY_COMMAND_TYPES)[number];

export function isIngestPlayCommandType(value: unknown): value is IngestPlayCommandType {
  return (INGEST_PLAY_COMMAND_TYPES as readonly string[]).includes(value as string);
}

/**
 * THE ANSWER SHAPE, the other column of the same vocabulary — what a tab posts
 * back to `/__editor/command-result` for a command it just ran.
 *
 * Same rule as the timeout column above, for the same reason: the relay has two
 * ends in two compilation units — the browser that PRODUCES this
 * (`command-listener.ts`) and the server that settles and re-serves it
 * (`server/server-utils.ts`, `server/routes/control-plane.ts`) — and each used
 * to declare its own copy. They had already drifted on the field that matters
 * most: the browser's said `ok: boolean` and the server's said `ok?: boolean`,
 * so server code could read a result that never says whether it worked. Both
 * files already import this module (so does `ingest/ingest-play-commands.ts`,
 * which restated the shape a third time), so there is no new dependency here.
 *
 * `ok` is REQUIRED because the producer always writes it: every browser exit
 * (`structuredErrorResult`, `commandThrewResult`, every handler's return) and
 * every server-side settle (`settlePendingCommand`'s callers, all of which pair
 * `timedOut: true` with `ok: false`) sets it. A payload arriving from off the
 * wire is narrowed where it enters — `handleCommandResult` — not by weakening
 * this type.
 *
 * `timedOut` is deliberately NOT here: no tab produces it. It is the SERVER's
 * own verdict for a command no tab answered, so it lives on the server's
 * `RelayedCommandResult` extension beside the code that sets it.
 */
export interface CommandResult {
  ok: boolean;
  error?: string;
  /** Payload for commands that answer with data (`capture-viewport`'s base64
   *  PNG, the debug-seam reads). On the failure path it carries structured
   *  markers (`{ code: 'UNKNOWN_COMMAND_TYPE' }`, registered-name lists) the
   *  SDK matches on — never message prose. */
  data?: Record<string, unknown>;
}
