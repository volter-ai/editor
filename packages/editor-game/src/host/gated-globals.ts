/**
 * Gated game globals — pipe browser globals into the game's mount context.
 *
 * Arbitrary game code can reach for the real, shared `window`
 * (`window.addEventListener('keydown', …)`), which fires regardless of whether
 * the game viewport is focused — so keystrokes leak into the editor while you
 * work in it. There is no cooperative way to stop that in a shared JS context.
 *
 * Instead of patching the real global (blunt, collateral damage to the editor),
 * every project module lexically shadows `globalThis`, `window`, and `document`.
 * This module supplies the mount-owned view: input and scheduling gates,
 * listener lifecycle, isolated game-global properties, pane-shaped page reads,
 * and attributed facades over ordinary shared-origin storage. Editor globals
 * remain untouched.
 *
 * Shared-context best-effort: handler properties on OTHER targets
 * (`el.onkeydown = …`) and listeners on other targets are out of scope — but
 * `window.onkeydown = …` is not: it is a second registration path onto the very
 * target we proxy, so the `set` trap gates it exactly like `addEventListener`
 * (see {@link makeGatedProxy}). True cooperation-free isolation would need a
 * separate browsing context (iframe) — rejected (breaks the shared heap the
 * engine/editor singletons rely on; see T6.3 task notes).
 */

/** The one-line prelude the transpile layer prepends to every project module.
 *  Defined in a DOM-free module so the Node-side Vite plugin can import the same
 *  constant — see `game-globals-prelude.ts`. Re-exported here for the browser
 *  callers that already reach for it alongside the proxies. */
export { GAME_GLOBALS_PRELUDE } from '@volter/editor-core/game-globals-prelude';

import { installCreationSiteRecorder } from '@volter/editor-core/creation-site-registry';
import { setConsoleRealmAttribution } from '@volter/editor-core/editor-console';
import { guardedGameLocation, refusedNavigationMessage } from './game-location-guard';
import { GameRealmPage } from './game-realm-page';
import {
  createGameRealmStorage,
  type GameRealmStorageStats,
  type GameRealmStorageView,
} from './game-realm-storage';
import {
  createSameRealmLoopGate,
  type GatedSchedulers,
  type SameRealmLoopDisposal,
  type SameRealmLoopGate,
  type SameRealmLoopGateStats,
} from './same-realm-loop-gate';
import { surfaceHoldsKeyboard } from '@volter/editor-core/surface-keyboard';

/**
 * The SAME-REALM LOOP GATE (S-5) — the scheduling half of the same idea.
 *
 * `gated-globals` pipes input listeners through an editor-owned gate; this
 * pipes SCHEDULING through one, so a same-realm ingested game's `setInterval`
 * simulation tick can actually be paused. It is built once here and shadowed
 * into game modules by {@link GAME_GLOBALS_PRELUDE}; the editor's own timers
 * never touch it. Open (pure pass-through) until an ingest pause holds it —
 * see `authoring/ingest-root-adapter.ts`'s `createIngestLoopGate`.
 */
let loopGate: SameRealmLoopGate | null = null;

/** The installed same-realm loop gate, or `null` outside a browser / before
 *  {@link installGatedGameGlobals} ran. Callers treat `null` as "no gate",
 *  which is what makes the probe report `self-driven` rather than fabricating
 *  control it does not have. */
export function gameLoopGate(): SameRealmLoopGate | null {
  return loopGate;
}

/** Event types that constitute "game input" and are focus-gated. */
const INPUT_EVENT_TYPES = new Set<string>([
  'keydown',
  'keyup',
  'keypress',
  'mousedown',
  'mouseup',
  'mousemove',
  'click',
  'dblclick',
  'contextmenu',
  'wheel',
  'pointerdown',
  'pointerup',
  'pointermove',
  'pointercancel',
  'touchstart',
  'touchmove',
  'touchend',
  'touchcancel',
]);

/**
 * A RELEASE IS NEVER DROPPED. The gate stops game input while the editor owns
 * the keyboard and pointer, and it stopped keyup/mouseup/pointerup the same
 * way — so a key pressed while the gate was open and released after it closed
 * (Stop with W still held) left the game's OWN input manager holding KeyW for
 * good: the editor flushes only the session's InputManager, never a
 * project-owned one. With both vertical keys stuck the hero
 * could not move up or down while A/D worked (runhuman pass 129; Opus
 * reproduction 2026-09-03 — forcing KeyW+KeyS into `keysDown` reproduced the
 * report verbatim, a single stuck key does not). Each proxy remembers the
 * presses it let through and passes THEIR releases whatever the gate says; a
 * release for a press the game never saw stays blocked, so a closed gate still
 * fabricates no input.
 */
interface GatedInputBlocker {
  /** True when `event` must not reach the game's listener. */
  (type: string, event: Event): boolean;
  /**
   * A synthetic release for every press this proxy passed and never saw
   * released — what a realm owes its listeners when it is torn down with a
   * key still under the hand (Stop while W is held: the old instance kept
   * `KeyW` because its listeners were removed before any keyup could reach
   * them — measured on preview-b56). Touch presses are not synthesized: a
   * `TouchEvent` cannot be built without its `Touch` list, and no input
   * manager here keys state on touch identity.
   */
  outstandingReleases(): Event[];
}

function gatedInputBlocker(gate: () => boolean): GatedInputBlocker {
  const passed = new Set<string>();
  // ONE EVENT, EVERY LISTENER. Each listener's wrapper asks this blocker
  // separately for the same event, and the press token is consumed by the
  // first ask — so the second listener of the same type would have been
  // blocked and left holding the key (read in review, 2026-09-03). A release
  // admitted once is admitted for every wrapper that sees that event object.
  const admitted = new WeakSet<Event>();
  const blocked = ((type: string, event: Event): boolean => {
    const presses = pressKeys(type, event);
    const releases = releaseKeys(type, event);
    if (gate()) {
      for (const key of presses) passed.add(key);
      for (const key of releases) passed.delete(key);
      return false;
    }
    if (admitted.has(event)) return false;
    let seen = false;
    for (const key of releases) if (passed.delete(key)) seen = true;
    if (seen) admitted.add(event);
    return !seen;
  }) as GatedInputBlocker;
  blocked.outstandingReleases = () => {
    const out: Event[] = [];
    for (const key of passed) {
      const at = key.indexOf(':');
      const kind = key.slice(0, at);
      const value = key.slice(at + 1);
      if (kind === 'key') {
        out.push(
          new KeyboardEvent('keyup', { code: value, key: keyNameForCode(value), bubbles: true }),
        );
      } else if (kind === 'mouse') {
        out.push(new MouseEvent('mouseup', { button: Number(value), bubbles: true }));
      } else if (kind === 'pointer' && typeof PointerEvent === 'function') {
        out.push(new PointerEvent('pointerup', { pointerId: Number(value), bubbles: true }));
      }
    }
    return out;
  };
  return blocked;
}

/** `KeyW` → `w`, `Digit1` → `1`, `Space` → ` `; anything else keeps its code
 *  as the key — a release listener reads `code` first and `key` as a label. */
function keyNameForCode(code: string): string {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1]!.toLowerCase();
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return digit[1]!;
  if (code === 'Space') return ' ';
  return code;
}

function touchKeys(event: Event): string[] {
  const touches = (event as TouchEvent).changedTouches;
  if (!touches) return ['touch'];
  return Array.from(touches, (touch) => `touch:${touch.identifier}`);
}

function pressKeys(type: string, event: Event): string[] {
  switch (type) {
    case 'keydown':
      return [`key:${(event as KeyboardEvent).code}`];
    case 'mousedown':
      return [`mouse:${(event as MouseEvent).button}`];
    case 'pointerdown':
      return [`pointer:${(event as PointerEvent).pointerId}`];
    case 'touchstart':
      return touchKeys(event);
    default:
      return [];
  }
}

function releaseKeys(type: string, event: Event): string[] {
  switch (type) {
    case 'keyup':
      return [`key:${(event as KeyboardEvent).code}`];
    case 'mouseup':
      return [`mouse:${(event as MouseEvent).button}`];
    case 'pointerup':
    case 'pointercancel':
      return [`pointer:${(event as PointerEvent).pointerId}`];
    case 'touchend':
    case 'touchcancel':
      return touchKeys(event);
    default:
      return [];
  }
}

/** Scheduling entry points the loop gate owns — the SAME set the prelude
 *  shadows lexically (`game-globals-prelude.ts`), so `window.setInterval(…)`
 *  and a bare `setInterval(…)` can never resolve to different functions. */
const GATED_SCHEDULER_NAMES = new Set<string>([
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'requestAnimationFrame',
  'cancelAnimationFrame',
]);

/**
 * Browser methods need their real Window/Document receiver, but constructors are realm values.
 * Binding `Object`, `Array`, `Promise`, etc. creates a new bound function that loses the original
 * constructor's static members (`Object.assign`, `Object.create`, ...). A function's own
 * `prototype` is the stable language-level distinction needed here: ordinary receiver-dependent
 * methods do not own one, while constructable globals do.
 */
function realmFunction(value: unknown, receiver: object): unknown {
  if (typeof value !== 'function') return value;
  if (Object.hasOwn(value, 'prototype')) return value;
  return value.bind(receiver);
}

/**
 * ONE GAME REALM PER MOUNT.
 *
 * A realm is the set of globals a mounted game's code sees: its gated
 * `window`/`document` proxies, its scheduling gate, and the input gate both
 * consult. There is one per mount id, plus a DEFAULT realm for code served
 * without one (an in-page transpile, an ingest fixture).
 *
 * Why a registry rather than the three module-level globals this replaced:
 * with one shared set, N instances of a game share one input gate and one loop
 * gate — input aimed at the focused instance reaches all of them, and pausing
 * one pauses its siblings. Neither is fixable in the presentation layer.
 *
 * The lookup key comes from the MODULE'S OWN URL: every project module served
 * under a mount carries `?vgai-mount=<id>` (the isolation transform), and the
 * prelude passes `import.meta.url` to {@link gameRealmForModuleUrl}. So a
 * module resolves its own realm with no plugin involvement and no threading.
 */
export interface GameRealm {
  recordModuleUrl(url: string): void;
  console: Console;
  document: Document;
  globalThis: Window;
  timers: SameRealmLoopGate['schedulers'];
  window: Window;
}

export interface GameRealmDiagnostics {
  readonly globals: number;
  readonly mountId: string;
  readonly loop: SameRealmLoopGateStats;
  readonly listeners: { readonly document: number; readonly window: number };
  readonly storage: {
    readonly local: GameRealmStorageStats;
    readonly session: GameRealmStorageStats;
  };
}

export interface GameRealmDisposal {
  readonly mountId: string;
  readonly listeners: number;
  readonly timers: SameRealmLoopDisposal;
}

/** The realm for code with no mount id. Keeps single-instance behaviour
 *  byte-identical: one game, one realm, exactly as before. */
const DEFAULT_REALM_ID = '';

interface OwnedProxy<T extends EventTarget> {
  readonly proxy: T;
  readonly count: () => number;
  readonly expandoCount: () => number;
  dispose(): number;
}

/**
 * A realm GENERATION's liveness cell.
 *
 * Mount ids are reused in exactly one place — the DEFAULT realm, which every
 * ingest mount and every module-served fallback resolves through. So "is this
 * realm disposed?" cannot be answered by an id-keyed set: the next mount under
 * the same id must start clean. It is answered by this object, which one
 * generation of the realm closes over and the NEXT generation replaces.
 */
interface RealmLiveness {
  alive: boolean;
}

interface RealmRecord {
  readonly moduleUrls: Map<string, string>;
  readonly public: GameRealm;
  readonly loop: SameRealmLoopGate;
  readonly document: OwnedProxy<Document>;
  readonly live: RealmLiveness;
  readonly localStorage: () => GameRealmStorageView | null;
  readonly sessionStorage: () => GameRealmStorageView | null;
  readonly window: OwnedProxy<Window>;
}

const realms = new Map<string, RealmRecord>();

/**
 * Input gates live SEPARATELY from realms, keyed the same way.
 *
 * A gate is plain data and setting one must stay DOM-free — the editor host
 * calls `setGameInputGate` from contexts with no `window`/`document` (and a
 * Node-side test does too). Building a realm constructs Proxies over the real
 * globals, so folding the two together made a gate assignment throw
 * `document is not defined` outside a browser. Keeping them apart also means a
 * gate can be set BEFORE the instance it belongs to has mounted, which is the
 * ordinary case: the host knows the policy before the game's first module
 * loads.
 */
const gates = new Map<string, () => boolean>();

/**
 * PAGES live alongside gates, keyed the same way and for the same reason: a
 * mount knows its surface before the game's first module loads, and the value
 * must be settable from DOM-free contexts. See `game-realm-page.ts` for what a
 * page is and why an in-realm game needs one.
 */
const pages = new Map<string, GameRealmPage>();
const pageLocations = new WeakMap<
  GameRealmPage,
  { readonly source: Location; readonly view: Location }
>();

/** The page for one realm, created on first use (surface still unset). */
function pageFor(id: string): GameRealmPage {
  let page = pages.get(id);
  if (!page) {
    page = new GameRealmPage();
    pages.set(id, page);
  }
  return page;
}

/**
 * Hand a realm the element its game should see as the whole page: the mount's
 * adopted surface. Called by the ingest mount BEFORE the game's entry module
 * runs, so the game's very first `document.body.appendChild` already lands in
 * the pane.
 */
export function setGameSurface(el: HTMLElement, mountId = DEFAULT_REALM_ID): GameRealmPage {
  const page = pageFor(mountId);
  page.surface = el;
  return page;
}

/**
 * Drop a realm's PAGE when its mount disposes — the realm reverts to the real
 * page, which is what "no game is running" has always meant.
 *
 * The entry is RESET, never deleted: `buildRealm` closes over the page object,
 * so a replacement in the map would be invisible to the proxies the game's
 * modules already hold. Resetting in place is what makes a second ingest mount
 * in one tab lifetime a clean slate — see `GameRealmPage.reset`.
 */
export function clearGameSurface(mountId = DEFAULT_REALM_ID): void {
  pages.get(mountId)?.reset();
}

/** The page a realm sees, for hosts that need to drive it (dispatch a resize,
 *  read the game's own size policy). */
export function gameRealmPage(mountId = DEFAULT_REALM_ID): GameRealmPage {
  return pageFor(mountId);
}

/** Every registered game surface, newest last — the lookup
 *  `ingest/game-pointer-lock.ts` uses to decide whether an element belongs to
 *  a game rather than to the editor's own viewport. */
export function gameSurfaces(): { surface: HTMLElement; gate: () => boolean }[] {
  const out: { surface: HTMLElement; gate: () => boolean }[] = [];
  for (const [id, page] of pages) {
    if (page.surface) out.push({ surface: page.surface, gate: gateFor(id) });
  }
  return out;
}

/**
 * A live gate reader for one realm — resolves per event, so setting a gate
 * later (or replacing it) takes effect without rebuilding the proxies.
 *
 * Exported as {@link gameInputGateFor} for callers that build their own proxy
 * over a stand-in target and still want the REAL gate semantics.
 */
function gateFor(id: string): () => boolean {
  // AND THE SURFACE TERM (U2). `surfaceHoldsKeyboard()` is true standalone and
  // under the frame is the workbench's own "is the vgai pane the active
  // editor?", so a keystroke aimed at Monaco in the group beside a running
  // game never reaches the game's listeners. It is read HERE, once, rather
  // than folded into each lane's own predicate, because this is the one place
  // every project module's raw `window`/`document` listener passes through —
  // Play, ingest and the module lane alike. See `surface-keyboard.ts`.
  return () => surfaceHoldsKeyboard() && (gates.get(id) ?? (() => true))();
}

/**
 * The gate ONE REALM GENERATION's own proxies read.
 *
 * Identical to {@link gateFor} while that generation is live. Once
 * `disposeGameRealm` has reclaimed it, the gate is permanently CLOSED — because
 * the id-keyed fallback above is always-TRUE and `disposeGameRealm` deletes the
 * gate entry, so a listener that survived teardown (a late continuation, a
 * promise that resolved after stop) would otherwise fire UNGATED for the rest
 * of the tab's life, into a realm nothing will ever reclaim again.
 *
 * A later mount under the same id builds a NEW generation with its own
 * {@link RealmLiveness}, so a closed generation never leaks into the next game.
 */
function realmGenerationGate(id: string, live: RealmLiveness): () => boolean {
  const byId = gateFor(id);
  return () => live.alive && byId();
}

/** Read a mount id off a module url. Kept in step with the server-side
 *  `project-module-instance.ts` by `project-module-instance.test.ts`. */
function mountIdOfUrl(moduleUrl: string): string {
  const query = moduleUrl.split('?')[1];
  if (query === undefined) return DEFAULT_REALM_ID;
  return new URLSearchParams(query).get('vgai-mount') ?? DEFAULT_REALM_ID;
}

/** The realm whose code is synchronously executing right now. Console capture
 * reads this to label a row with the mount that produced it. */
const executingRealms: string[] = [];

export function currentGameRealmMountId(): string | null {
  return executingRealms[executingRealms.length - 1] ?? null;
}

/**
 * The console asks; the realm answers. `editor-console.ts` used to IMPORT the
 * reader above, which put this whole shim inside that pinned surface's closure
 * (see `setConsoleRealmAttribution`'s own block for the measurement). The
 * registration is at module scope because the reader can only ever be needed
 * once a realm exists, and a realm existing means this module has loaded.
 */
setConsoleRealmAttribution(currentGameRealmMountId);

function inRealm<T>(mountId: string, run: () => T): T {
  executingRealms.push(mountId);
  try {
    return run();
  } finally {
    executingRealms.pop();
  }
}

function contextualSchedulers(id: string, schedulers: GatedSchedulers): GatedSchedulers {
  return {
    setTimeout(callback, ms, ...args) {
      return schedulers.setTimeout(
        (...received) => inRealm(id, () => callback(...received)),
        ms,
        ...args,
      );
    },
    clearTimeout: (timerId) => schedulers.clearTimeout(timerId),
    setInterval(callback, ms, ...args) {
      return schedulers.setInterval(
        (...received) => inRealm(id, () => callback(...received)),
        ms,
        ...args,
      );
    },
    clearInterval: (timerId) => schedulers.clearInterval(timerId),
    requestAnimationFrame(callback) {
      return schedulers.requestAnimationFrame((time) => inRealm(id, () => callback(time)));
    },
    cancelAnimationFrame: (frameId) => schedulers.cancelAnimationFrame(frameId),
  };
}

function contextualConsole(id: string): Console {
  const methods = new Map<PropertyKey, unknown>();
  return new Proxy(console, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      let wrapped = methods.get(prop);
      if (!wrapped) {
        wrapped = (...args: unknown[]) => inRealm(id, () => value.apply(target, args));
        methods.set(prop, wrapped);
      }
      return wrapped;
    },
  }) as Console;
}

function lazyRealmStorage(
  name: 'localStorage' | 'sessionStorage',
): () => GameRealmStorageView | null {
  let resolved = false;
  let view: GameRealmStorageView | null = null;
  return () => {
    if (resolved) return view;
    resolved = true;
    try {
      view = createGameRealmStorage(window[name]);
    } catch {
      // Browsers may deny storage for an opaque/blocked origin. Preserve that
      // absence instead of making realm construction itself fail eagerly.
      view = null;
    }
    return view;
  };
}

/**
 * The host action `location.reload()` translates to while a game that can be
 * RESTARTED is mounted — registered by the ingest session that owns the run,
 * cleared with it. Null means the guard's loud refusal stands (first-party
 * roots, module roots: nothing registered, nothing silently changes).
 */
let _gameRealmReloadHandler: (() => void) | null = null;

export function setGameRealmReloadHandler(handler: (() => void) | null): void {
  _gameRealmReloadHandler = handler;
}

/** The DEFAULT realm's loop gate, surfaced by {@link gameLoopGate} for the
 *  single-instance ingest callers that hold it. */
let defaultLoopGate: SameRealmLoopGate | null = null;

function buildRealm(id: string): RealmRecord {
  const live: RealmLiveness = { alive: true };
  const moduleUrls = new Map<string, string>();
  const gate = realmGenerationGate(id, live);
  const loop = createSameRealmLoopGate({
    setTimeout: (cb, ms) => window.setTimeout(cb, ms),
    clearTimeout: (id) => window.clearTimeout(id),
    setInterval: (cb, ms) => window.setInterval(cb, ms),
    clearInterval: (id) => window.clearInterval(id),
    requestAnimationFrame: (cb) => window.requestAnimationFrame(cb),
    cancelAnimationFrame: (id) => window.cancelAnimationFrame(id),
    now: () => performance.now(),
  });
  const observedInputEvents = new WeakSet<Event>();
  const recordInput = (event: Event, blocked: boolean): void => {
    if (observedInputEvents.has(event)) return;
    observedInputEvents.add(event);
    loop.recordInput?.(blocked);
  };
  if (id === DEFAULT_REALM_ID) defaultLoopGate = loop;
  const page = pageFor(id);
  const timers = contextualSchedulers(id, loop.schedulers);
  const localStorage = lazyRealmStorage('localStorage');
  const sessionStorage = lazyRealmStorage('sessionStorage');
  let windowProxy: Window;
  let documentProxy: Document;
  const ownedWindow = createOwnedRealmProxy(
    makeGatedProxy(window, () => true, { page, role: 'window' }),
    gate,
    {
      execute: (run) => inRealm(id, run),
      realmId: id,
      recordInput,
      role: 'window',
      schedulers: timers,
      self: () => windowProxy,
      document: () => documentProxy,
      localStorage,
      sessionStorage,
      isolateExpandos: true,
    },
  );
  windowProxy = ownedWindow.proxy;
  const ownedDocument = createOwnedRealmProxy(
    makeGatedProxy(document, () => true, { page, role: 'document' }),
    gate,
    {
      execute: (run) => inRealm(id, run),
      realmId: id,
      recordInput,
      role: 'document',
      self: () => windowProxy,
    },
  );
  documentProxy = ownedDocument.proxy;
  return {
    moduleUrls,
    live,
    loop,
    document: ownedDocument,
    localStorage,
    sessionStorage,
    window: ownedWindow,
    public: {
      recordModuleUrl(url) {
        if (live.alive) moduleUrls.set(new URL(url).pathname, url);
      },
      console: contextualConsole(id),
      document: documentProxy,
      globalThis: windowProxy,
      timers,
      window: windowProxy,
    },
  };
}

/** The live input-gate reader for one instance (default realm when omitted).
 *  Pair with {@link makeGatedProxy} to gate a target the registry does not own. */
export function gameInputGateFor(mountId = DEFAULT_REALM_ID): () => boolean {
  return gateFor(mountId);
}

/** The realm a module belongs to, created on first use. */
export function gameRealmForModuleUrl(moduleUrl: string): GameRealm {
  return gameRealmForMountId(mountIdOfUrl(moduleUrl));
}

/** Resolve the transform-baked mount id directly. */
export function gameRealmForMountId(mountId = DEFAULT_REALM_ID): GameRealm {
  let realm = realms.get(mountId);
  if (!realm) {
    realm = buildRealm(mountId);
    realms.set(mountId, realm);
  }
  return realm.public;
}

/** Exact URLs evaluated by this mount, retained only until its realm is disposed. */
export function loadedGameRealmModuleUrls(mountId: string): readonly string[] {
  return [...(realms.get(mountId)?.moduleUrls.values() ?? [])];
}

export function gameRealmDiagnostics(mountId: string): GameRealmDiagnostics | null {
  const realm = realms.get(mountId);
  if (!realm) return null;
  const emptyStorage = { reads: 0, writes: 0 };
  return {
    globals: realm.window.expandoCount(),
    mountId,
    loop: realm.loop.stats(),
    listeners: { document: realm.document.count(), window: realm.window.count() },
    storage: {
      local: realm.localStorage()?.stats() ?? emptyStorage,
      session: realm.sessionStorage()?.stats() ?? emptyStorage,
    },
  };
}

/** End one mount's browser-resource ownership. `mountId` omitted means the
 *  DEFAULT realm — what ingest and every module served without a mount id
 *  resolve through, matching every other door in this file. Callers go through
 *  `game-realm-reclaim.ts`'s `reclaimGameRealm`, which also reports what the
 *  game left behind. */
export function disposeGameRealm(mountId = DEFAULT_REALM_ID): GameRealmDisposal {
  gates.delete(mountId);
  const page = pages.get(mountId);
  page?.reset();
  if (mountId !== DEFAULT_REALM_ID) pages.delete(mountId);
  const realm = realms.get(mountId);
  if (!realm) {
    return {
      mountId,
      listeners: 0,
      timers: { timeouts: 0, intervals: 0, animationFrames: 0, parkedCallbacks: 0 },
    };
  }
  realms.delete(mountId);
  realm.moduleUrls.clear();
  // Close THIS generation before reclaiming it: from here on its proxies refuse
  // new registrations and its gate reads false, so a late continuation from the
  // dead mount cannot re-register into a realm nothing will ever reclaim again.
  realm.live.alive = false;
  const listeners = realm.document.dispose() + realm.window.dispose();
  const timers = realm.loop.dispose?.() ?? {
    timeouts: 0,
    intervals: 0,
    animationFrames: 0,
    parkedCallbacks: 0,
  };
  if (mountId === DEFAULT_REALM_ID) {
    // The DEFAULT realm is the one id that is REUSED — every ingest mount and
    // every module served without a mount id resolves through it. Rebuild it
    // immediately so "the default realm exists and is live" (the invariant
    // `installGatedGameGlobals` established) survives its own teardown, and
    // re-publish the host globals, which are captured VALUES: leaving them
    // pointed at the generation just closed is how the next game would find a
    // dead window/document/timer set.
    publishDefaultRealmGlobals();
  }
  return { mountId, listeners, timers };
}

/**
 * Set the gate that decides whether game input listeners fire right now, for
 * ONE instance. The editor host sets this so a game only receives input while
 * its surface is active; reset it to always-true when no game is running.
 *
 * `mountId` omitted means the default realm — the single-instance case, which
 * is every caller today.
 */
export function setGameInputGate(fn: () => boolean, mountId = DEFAULT_REALM_ID): void {
  gates.set(mountId, fn);
}

/**
 * Drop one instance's gate when its mount ends.
 *
 * Mount ids are monotonic — an id is never reused — so a gate left behind is a
 * closure retained for a game that no longer exists, one per play run. That
 * cost nothing while every caller used the default realm and overwrote the
 * single entry; it starts accruing the moment mounts register under their own
 * id. Unsetting reverts the realm to the always-true default, which is the
 * same thing "no game is running" has always meant.
 */
export function clearGameInputGate(mountId: string): void {
  gates.delete(mountId);
}

/** How a proxy answers the page-shaped questions: which realm page it belongs
 *  to, and whether it is standing in for `window` or for `document` (they
 *  answer different ones). Omitted entirely by the unit tests that only care
 *  about input gating, which is why it is optional. */
export interface GatedProxyPageOptions {
  page: GameRealmPage;
  role: 'window' | 'document';
}

/** Build a Proxy over `real` that gates input-listener registration.
 *
 *  The gate is a PARAMETER rather than this module's `inputGate` global,
 *  because multi-instance authoring needs one gate per instance: input aimed
 *  at instance 2 must not reach instance 1, and a paused instance must not
 *  pause its siblings. Reading an ambient gate made that inexpressible.
 *  Exported for unit tests (build a proxy over a stub EventTarget).
 *
 *  `pageOpts` adds the PAGE half (game-realm-page.ts): `document.body`, the
 *  realm's viewport size, its `resize` bus, and the navigation refusal. All of
 *  it is inert until a mount registers a surface, so a realm with no game is
 *  byte-identical to the pre-page behaviour. */
export function makeGatedProxy<T extends EventTarget>(
  real: T,
  gate: () => boolean,
  pageOpts?: GatedProxyPageOptions,
): T {
  // original listener → gated wrapper, keyed by type, so removeEventListener
  // detaches the wrapper actually registered.
  const wrappedByType = new Map<string, Map<EventListenerOrEventListenerObject, EventListener>>();
  const inputBlocked = gatedInputBlocker(gate);

  /** The realm's surface, or null when no mount registered one. */
  const surfaceEl = (): HTMLElement | null => pageOpts?.page.surface ?? null;

  /** True when this proxy stands in for `window` AND a surface is registered —
   *  the condition under which the realm answers page-shaped questions with the
   *  PANE's answers instead of the browser window's. */
  const windowOfSurface = (): GameRealmPage | null =>
    pageOpts?.role === 'window' && pageOpts.page.surface ? pageOpts.page : null;

  const gatedAdd = (
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void => {
    // The game's window IS its pane, so its `resize` listener belongs to the
    // realm's own bus — the host dispatches when the PANE changes, and a
    // browser-window resize that never touched the pane no longer lies to a
    // game computing its letterbox (game-realm-page.ts, reason 3).
    const page = windowOfSurface();
    if (page && type === 'resize' && listener !== null) {
      page.addResizeListener(listener, options);
      return;
    }
    // PAGE LIFECYCLE, delivered to the realm. `load`/`DOMContentLoaded`
    // fired on the HOST page long before a transplanted game evaluated, so a
    // registration here can never fire from the real target — and a vanilla
    // game that boots in `window.onload` (simcity's `window.onload = () =>
    // new Game()`) or `DOMContentLoaded` (tanks) simply never constructed:
    // zero errors, zero renders, measured 2026-08-28. The realm's page IS
    // loaded by the time game code runs (the DOM transplant precedes entry
    // evaluation), so the page-accurate answer is one immediate async
    // dispatch — the same catch-up a real page gives `readyState` checkers.
    if (
      (type === 'load' || type === 'DOMContentLoaded' || type === 'pageshow') &&
      listener !== null &&
      document.readyState === 'complete'
    ) {
      window.setTimeout(() => {
        const event = new Event(type);
        if (typeof listener === 'function') {
          (listener as (this: unknown, e: Event) => unknown).call(proxy, event);
        } else {
          listener.handleEvent(event);
        }
      }, 0);
      return;
    }
    if (INPUT_EVENT_TYPES.has(type) && listener !== null) {
      let m = wrappedByType.get(type);
      if (!m) {
        m = new Map();
        wrappedByType.set(type, m);
      }
      const inner = listener;
      let wrapped = m.get(inner);
      if (!wrapped) {
        wrapped = function (this: unknown, e: Event) {
          if (inputBlocked(type, e)) return undefined;
          if (typeof inner === 'function') {
            return (inner as (this: unknown, e: Event) => unknown).call(this, e);
          }
          return inner.handleEvent(e);
        };
        m.set(inner, wrapped);
      }
      real.addEventListener(type, wrapped, options);
      return;
    }
    real.addEventListener(type, listener, options);
  };

  const gatedRemove = (
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void => {
    const page = windowOfSurface();
    if (page && type === 'resize' && listener !== null) {
      page.removeResizeListener(listener, options);
      return;
    }
    if (INPUT_EVENT_TYPES.has(type) && listener !== null) {
      const m = wrappedByType.get(type);
      const wrapped = m?.get(listener);
      if (wrapped) {
        m?.delete(listener);
        real.removeEventListener(type, wrapped, options);
        return;
      }
    }
    real.removeEventListener(type, listener, options);
  };

  // Gated `on<type>` wrapper → the handler the game actually assigned, so a read
  // of `window.onkeydown` hands back what was written rather than our wrapper.
  // Keyed by the wrapper (not the property name) so a value written to the REAL
  // target behind our back is never mistaken for ours.
  const handlerByWrapper = new WeakMap<object, EventListener>();

  /** `'onkeydown'` → `'keydown'` for the gated event types only; else null. */
  const gatedHandlerType = (prop: string | symbol): string | null => {
    if (typeof prop !== 'string' || !prop.startsWith('on')) return null;
    const type = prop.slice(2);
    return INPUT_EVENT_TYPES.has(type) ? type : null;
  };

  /** Report a refused navigation on the page's own console — which is a real
   *  product door: `vgai status` reports page console errors. */
  const refuseNavigation = (attempt: string): void => {
    // A NEW native console.error site, suppressed to keep this task's diff at
    // zero new lint warnings — and it is deliberately native rather than
    // `editorConsole`: game code runs in the page, and the page console is the
    // surface `vgai status` already reads (same reasoning as
    // `ingest-root-adapter.ts`'s loop-gate warning).
    // biome-ignore lint/suspicious/noConsole: see comment above
    console.error(refusedNavigationMessage(attempt));
  };

  // Assigned below so the `get` trap can hand the PROXY back for `window`,
  // `self`, `top` and `parent`: an in-realm game's window is its own, and
  // returning the real one there would be a hole straight around every trap in
  // this proxy (`window.top.location.href = …`).
  let proxy: T;

  /**
   * The PAGE-shaped reads (game-realm-page.ts), answered with the pane's
   * answers instead of the tab's. Returns a one-element box so "answered with
   * `undefined`" stays distinguishable from "not a page question" — and keeps
   * the `get` trap itself one thing.
   */
  /** `location` — reads pass through, navigating writes are refused out loud
   *  (game-location-guard.ts). Both roles: `document.location` is the same
   *  object by another name. */
  const locationAnswer = (): { value: unknown } | null => {
    const realLocation = Reflect.get(real, 'location', real) as Location | undefined;
    if (!realLocation || !pageOpts) return null;
    const found = pageLocations.get(pageOpts.page);
    if (found?.source === realLocation) return { value: found.view };
    const view = guardedGameLocation(realLocation, refuseNavigation, {
      reloadGame: () => {
        const handler = _gameRealmReloadHandler;
        if (!handler) return false;
        handler();
        return true;
      },
    });
    pageLocations.set(pageOpts.page, { source: realLocation, view });
    return { value: view };
  };

  /** The window role's page reads: the realm's own window identity, and the
   *  pane reported as the viewport. */
  const windowPageAnswer = (prop: string | symbol): { value: unknown } | null => {
    const page = windowOfSurface();
    if (!page) return null;
    if (prop === 'window' || prop === 'self' || prop === 'top' || prop === 'parent') {
      return { value: proxy };
    }
    if (
      prop !== 'innerWidth' &&
      prop !== 'outerWidth' &&
      prop !== 'innerHeight' &&
      prop !== 'outerHeight'
    ) {
      return null;
    }
    const viewport = page.viewport();
    if (!viewport) return null;
    if (prop === 'innerWidth' || prop === 'outerWidth') return { value: viewport.width };
    if (prop === 'innerHeight' || prop === 'outerHeight') return { value: viewport.height };
    return null;
  };

  const pageAnswer = (prop: string | symbol): { value: unknown } | null => {
    if (!pageOpts) return null;
    if (prop === 'location') return locationAnswer();
    // `document.body` IS the game's surface while a mount owns one — the single
    // redirect that contains a page-owning game's canvas AND every overlay it
    // will ever append (game-realm-page.ts, reason 1).
    if (pageOpts.role === 'document') {
      const el = surfaceEl();
      if (el && (prop === 'body' || prop === 'documentElement')) return { value: el };
      if (el && prop === 'head') return { value: pageOpts.page.head() };
      if (el && prop === 'title') return { value: pageOpts.page.title };
      if (el && prop === 'currentScript') return { value: pageOpts.page.currentScript };
      if (el && prop === 'activeElement') {
        const active = Reflect.get(real, 'activeElement', real) as Element | null;
        return { value: active && el.contains(active) ? active : el };
      }
    }
    return windowPageAnswer(prop);
  };

  const pageDocumentMethod = (prop: string | symbol): unknown => {
    if (pageOpts?.role !== 'document' || typeof prop !== 'string') return undefined;
    const surface = surfaceEl();
    if (!surface) return undefined;
    const realDocument = real as unknown as Document;
    if (prop === 'querySelector') {
      return (selector: string) => {
        if (selector.trim().toLowerCase() === 'head') return pageOpts.page.head();
        return surface.matches(selector) ? surface : surface.querySelector(selector);
      };
    }
    if (prop === 'querySelectorAll') return surface.querySelectorAll.bind(surface);
    if (prop === 'getElementById') {
      return (id: string) => {
        const found = realDocument.getElementById(id);
        return found && surface.contains(found) ? found : null;
      };
    }
    if (prop === 'getElementsByClassName') return surface.getElementsByClassName.bind(surface);
    if (prop === 'getElementsByTagName') {
      return (name: string) => {
        if (name.toLowerCase() !== 'head') return surface.getElementsByTagName(name);
        const head = pageOpts.page.head();
        if (!head) return [];
        return Object.assign([head], {
          item: (index: number) => (index === 0 ? head : null),
          namedItem: (id: string) => (head.id === id ? head : null),
        });
      };
    }
    if (prop === 'elementFromPoint' || prop === 'elementsFromPoint') {
      return (x: number, y: number) => {
        const rect = surface.getBoundingClientRect();
        const method = realDocument[prop].bind(realDocument) as (
          x: number,
          y: number,
        ) => Element | Element[] | null;
        const result = method(x + rect.left, y + rect.top);
        if (Array.isArray(result)) return result.filter((element) => surface.contains(element));
        return result && surface.contains(result) ? result : null;
      };
    }
    return undefined;
  };

  proxy = new Proxy(real, {
    get(target, prop) {
      if (prop === 'addEventListener') return gatedAdd;
      if (prop === 'removeEventListener') return gatedRemove;
      const answered = pageAnswer(prop);
      if (answered) return answered.value;
      const pageMethod = pageDocumentMethod(prop);
      if (pageMethod) return pageMethod;
      // S-5: `window.setInterval(…)` is the same loop registration as a bare
      // `setInterval(…)` by another name — route both to the ONE gate, exactly
      // as the `set` trap already does for `window.onkeydown` vs
      // `addEventListener`. Only reachable on the window proxy (the document
      // proxy has no such properties), and a no-op before the gate is built.
      if (typeof prop === 'string' && GATED_SCHEDULER_NAMES.has(prop)) {
        const gate = loopGate;
        if (gate) return (gate.schedulers as unknown as Record<string, unknown>)[prop];
      }
      // Resolve against the real target (this === target), so window/document
      // getters (innerWidth, body, …) and methods (rAF, setTimeout) work.
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      return handlerByWrapper.get(value) ?? realmFunction(value, target);
    },
    set(target, prop, value) {
      // `window.location = '…'` is `location.href = '…'` by another name.
      if (prop === 'location' && pageOpts) {
        refuseNavigation(`${pageOpts.role}.location = ${String(value)}`);
        return true;
      }
      if (pageOpts?.role === 'document' && prop === 'title' && pageOpts.page.surface) {
        pageOpts.page.title = String(value);
        return true;
      }
      // `window.onkeydown = fn` is an input-listener registration by another
      // name — gate it the same way, reading the gate live per event.
      const type = gatedHandlerType(prop);
      if (type !== null && typeof value === 'function') {
        const inner = value as EventListener;
        const wrapped = function (this: unknown, e: Event) {
          if (gate()) return (inner as (this: unknown, e: Event) => unknown).call(this, e);
          return undefined;
        };
        handlerByWrapper.set(wrapped, inner);
        return Reflect.set(target, prop, wrapped, target);
      }
      // `window.onload = fn` is a lifecycle registration by another name — and
      // writing it through to the REAL window both clobbers any host handler
      // and never fires (the host's load is long past). Deliver it the same
      // way the addEventListener door above does.
      if (prop === 'onload' && typeof value === 'function' && document.readyState === 'complete') {
        const handler = value as (this: unknown, e: Event) => unknown;
        window.setTimeout(() => handler.call(proxy, new Event('load')), 0);
        return true;
      }
      // Everything else (including `onresize`) writes straight through.
      // The receiver MUST be the real target: a native accessor's setter brand-
      // checks its `this`, and the default trap would hand it the Proxy —
      // which is why a plain `window.onload = …` used to throw "Illegal
      // invocation" and no vanilla game could evaluate a single line.
      return Reflect.set(target, prop, value, target);
    },
  }) as T;
  return proxy;
}

interface RealmProxyOptions {
  readonly document?: () => Document;
  readonly schedulers?: GatedSchedulers;
  readonly execute?: <T>(run: () => T) => T;
  readonly isolateExpandos?: boolean;
  readonly localStorage?: () => GameRealmStorageView | null;
  readonly self?: () => Window;
  readonly sessionStorage?: () => GameRealmStorageView | null;
  readonly recordInput?: (event: Event, blocked: boolean) => void;
  readonly role: 'window' | 'document';
  /** The realm this proxy belongs to — used ONLY to name the dead generation
   *  in the refusal warning below. Omitted by the unit fixtures that build a
   *  proxy over a stand-in target. */
  readonly realmId?: string;
}

interface OwnedListener {
  readonly type: string;
  readonly original: EventListenerOrEventListenerObject;
  readonly actual: EventListener;
  readonly capture: boolean;
  readonly abort?: { signal: AbortSignal; handler: EventListener };
}

function listenerCapture(options?: boolean | EventListenerOptions): boolean {
  return typeof options === 'boolean' ? options : (options?.capture ?? false);
}

/** Add mount ownership, contextual execution, and local schedulers around the
 * page-aware proxy above. The inner proxy keeps its pane/location semantics;
 * this outer layer owns everything the mounted game registers through it. */
function createOwnedRealmProxy<T extends EventTarget>(
  real: T,
  gate: () => boolean,
  options: RealmProxyOptions,
): OwnedProxy<T> {
  const execute = options.execute ?? ((run) => run());
  const listeners: OwnedListener[] = [];
  const inputBlocked = gatedInputBlocker(gate);
  /**
   * TERMINAL. `dispose()` used to reclaim what the proxy held and hand it
   * straight back, fully functional — so a continuation that resolved after
   * teardown (a pending `import()`, a settled fetch, a React effect landing
   * late) re-registered a listener into a realm the registry had already
   * dropped: unreachable by any future `disposeGameRealm`, and UNGATED,
   * because disposal deletes the id's gate entry and the id-keyed fallback is
   * always-true. Registration after disposal is refused instead.
   */
  let disposed = false;
  let refusalReported = false;
  const refuseAfterDispose = (what: string): void => {
    if (refusalReported) return;
    refusalReported = true;
    const realm = options.realmId ? `"${options.realmId}"` : 'the default realm';
    // biome-ignore lint/suspicious/noConsole: game code runs in the page, and the page console is the surface `vgai status` reads (same reasoning as `refuseNavigation` above)
    console.warn(
      `vgai: a stopped game tried to register ${what} on its ${options.role} after its realm ` +
        `(${realm}) was reclaimed; refused. Later refusals in this generation are silent.`,
    );
  };
  const expandos = new Map<PropertyKey, PropertyDescriptor>();
  const properties = new Map<
    PropertyKey,
    { type: string; original: EventListener; actual: EventListener }
  >();
  const eventViews = new WeakMap<Event, Event>();
  let proxy: T;

  const realmValue = (value: unknown): unknown => {
    if (
      options.role === 'window' &&
      options.self &&
      (value === real || (typeof window !== 'undefined' && value === window))
    ) {
      return options.self();
    }
    if (
      options.document &&
      (value === options.document() || (typeof document !== 'undefined' && value === document))
    ) {
      return options.document();
    }
    return value;
  };

  const eventForRealm = (event: Event): Event => {
    const found = eventViews.get(event);
    if (found) return found;
    const view = new Proxy(event, {
      get(target, property) {
        if (property === 'currentTarget') return proxy;
        if (property === 'target' || property === 'srcElement') {
          const value = Reflect.get(target, property, target);
          return value === target.currentTarget ? proxy : realmValue(value);
        }
        if (property === 'view') return realmValue(Reflect.get(target, property, target));
        if (property === 'composedPath') {
          return () => target.composedPath().map(realmValue);
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    eventViews.set(event, view);
    return view;
  };

  const removeOwned = (owned: OwnedListener): void => {
    const index = listeners.indexOf(owned);
    if (index !== -1) listeners.splice(index, 1);
    real.removeEventListener(owned.type, owned.actual, owned.capture);
    owned.abort?.signal.removeEventListener('abort', owned.abort.handler);
  };

  const realmAdd = (
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    listenerOptions?: boolean | AddEventListenerOptions,
  ): void => {
    if (listener === null) return;
    if (disposed) {
      refuseAfterDispose(`a "${type}" listener`);
      return;
    }
    const capture = listenerCapture(listenerOptions);
    const signal =
      listenerOptions && typeof listenerOptions !== 'boolean' ? listenerOptions.signal : undefined;
    if (signal?.aborted) return;
    if (
      listeners.some(
        (owned) => owned.type === type && owned.original === listener && owned.capture === capture,
      )
    )
      return;

    let owned: OwnedListener;
    const actual: EventListener = function (this: unknown, event: Event) {
      if (listenerOptions && typeof listenerOptions !== 'boolean' && listenerOptions.once) {
        const index = listeners.indexOf(owned);
        if (index !== -1) listeners.splice(index, 1);
        owned.abort?.signal.removeEventListener('abort', owned.abort.handler);
      }
      if (INPUT_EVENT_TYPES.has(type)) {
        const blocked = inputBlocked(type, event);
        options.recordInput?.(event, blocked);
        if (blocked) return undefined;
      }
      const realmEvent = eventForRealm(event);
      return execute(() => {
        if (typeof listener === 'function') {
          return (listener as (this: unknown, event: Event) => unknown).call(proxy, realmEvent);
        }
        return listener.handleEvent(realmEvent);
      });
    };
    const abortHandler: EventListener = () => removeOwned(owned);
    owned = {
      type,
      original: listener,
      actual,
      capture,
      ...(signal ? { abort: { signal, handler: abortHandler } } : {}),
    };
    listeners.push(owned);
    real.addEventListener(type, actual, listenerOptions);
    signal?.addEventListener('abort', abortHandler, { once: true });
    // PAGE LIFECYCLE CATCH-UP. `load`/`DOMContentLoaded` fired on the HOST
    // page long before a transplanted game evaluated, so this registration
    // can never fire from the real target — and a vanilla game that boots in
    // one of them never constructs (simcity's `window.onload = () => new
    // Game()`, tanks' DOMContentLoaded: zero errors, zero renders, measured
    // 2026-08-28). The realm's page IS loaded once game code runs (the DOM
    // transplant precedes entry evaluation), so deliver ONE async dispatch
    // through the same owned pipeline every real event takes.
    if (
      (type === 'load' || type === 'DOMContentLoaded' || type === 'pageshow') &&
      document.readyState === 'complete'
    ) {
      window.setTimeout(() => {
        if (!disposed && listeners.includes(owned)) actual.call(real, new Event(type));
      }, 0);
    }
  };

  const realmRemove = (
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    listenerOptions?: boolean | EventListenerOptions,
  ): void => {
    if (listener === null) return;
    const capture = listenerCapture(listenerOptions);
    const owned = listeners.find(
      (candidate) =>
        candidate.type === type && candidate.original === listener && candidate.capture === capture,
    );
    if (owned) removeOwned(owned);
    else real.removeEventListener(type, listener, listenerOptions);
  };

  const handlerType = (prop: PropertyKey): string | null =>
    typeof prop === 'string' && prop.startsWith('on') && prop.length > 2 ? prop.slice(2) : null;

  proxy = new Proxy(real, {
    get(target, prop) {
      if (prop === 'addEventListener') return realmAdd;
      if (prop === 'removeEventListener') return realmRemove;
      const property = properties.get(prop);
      if (property) return property.original;
      if (options.self) {
        if (
          options.role === 'window' &&
          (prop === 'window' ||
            prop === 'self' ||
            prop === 'frames' ||
            prop === 'top' ||
            prop === 'parent')
        ) {
          return options.self();
        }
        if (options.role === 'document' && prop === 'defaultView') return options.self();
      }
      if (options.role === 'window' && prop === 'document' && options.document) {
        return options.document();
      }
      if (options.role === 'window' && prop === 'globalThis' && options.self) {
        return options.self();
      }
      if (options.role === 'window' && prop === 'localStorage' && options.localStorage) {
        return options.localStorage()?.storage;
      }
      if (options.role === 'window' && prop === 'sessionStorage' && options.sessionStorage) {
        return options.sessionStorage()?.storage;
      }
      if (typeof prop === 'string' && GATED_SCHEDULER_NAMES.has(prop) && options.schedulers) {
        return (options.schedulers as unknown as Record<string, unknown>)[prop];
      }
      const expando = expandos.get(prop);
      if (expando) return expando.get ? expando.get.call(proxy) : expando.value;
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      return realmFunction(value, target);
    },
    set(target, prop, value) {
      // The page-aware inner proxy owns navigation refusal.
      if (prop === 'location') return Reflect.set(target, prop, value, target);
      if (
        options.role === 'window' &&
        (prop === 'document' ||
          prop === 'globalThis' ||
          prop === 'localStorage' ||
          prop === 'sessionStorage')
      ) {
        return true;
      }
      const type = handlerType(prop);
      if (type) {
        if (disposed) {
          // The other registration door (`window.onkeydown = …`), refused for
          // the same reason `realmAdd` refuses — see `refuseAfterDispose`.
          refuseAfterDispose(`an "${String(prop)}" handler`);
          return true;
        }
        const previous = properties.get(prop);
        if (previous) {
          real.removeEventListener(previous.type, previous.actual);
          properties.delete(prop);
        }
        if (typeof value !== 'function') return true;
        const original = value as EventListener;
        // Same lifecycle catch-up as realmAdd above — `window.onload = fn` is
        // the registration door simcity actually uses.
        const lifecycleCatchUp =
          (type === 'load' || type === 'DOMContentLoaded' || type === 'pageshow') &&
          document.readyState === 'complete';
        const actual: EventListener = function (this: unknown, event: Event) {
          if (INPUT_EVENT_TYPES.has(type)) {
            const blocked = inputBlocked(type, event);
            options.recordInput?.(event, blocked);
            if (blocked) return undefined;
          }
          const result = execute(() =>
            (original as (this: unknown, event: Event) => unknown).call(
              proxy,
              eventForRealm(event),
            ),
          );
          if (result === false) event.preventDefault();
          return result;
        };
        properties.set(prop, { type, original, actual });
        real.addEventListener(type, actual);
        if (lifecycleCatchUp) {
          window.setTimeout(() => {
            if (!disposed && properties.get(prop)?.actual === actual) {
              actual.call(real, new Event(type));
            }
          }, 0);
        }
        return true;
      }
      if (options.isolateExpandos) {
        expandos.set(prop, {
          configurable: true,
          enumerable: true,
          value,
          writable: true,
        });
        return true;
      }
      return Reflect.set(target, prop, value, target);
    },
    defineProperty(target, prop, descriptor) {
      if (!options.isolateExpandos) return Reflect.defineProperty(target, prop, descriptor);
      if (Reflect.getOwnPropertyDescriptor(target, prop)?.configurable === false) return false;
      // A proxy may not report a non-configurable property that does not also
      // exist on its target. Realm expandos deliberately live off-target, so
      // their reflection descriptor must remain configurable.
      expandos.set(prop, {
        ...descriptor,
        configurable: true,
        enumerable: descriptor.enumerable ?? true,
      });
      return true;
    },
    deleteProperty(target, prop) {
      if (expandos.delete(prop)) return true;
      if (options.isolateExpandos) {
        return Reflect.getOwnPropertyDescriptor(target, prop)?.configurable !== false;
      }
      return Reflect.deleteProperty(target, prop);
    },
    has(target, prop) {
      return expandos.has(prop) || Reflect.has(target, prop);
    },
    ownKeys(target) {
      const keys = new Set<string | symbol>(Reflect.ownKeys(target));
      for (const key of expandos.keys()) {
        if (typeof key !== 'number') keys.add(key);
      }
      return [...keys];
    },
    getOwnPropertyDescriptor(target, prop) {
      const native = Reflect.getOwnPropertyDescriptor(target, prop);
      if (native?.configurable === false) return native;
      return expandos.get(prop) ?? native;
    },
  }) as T;

  return {
    proxy,
    count: () => listeners.length + properties.size,
    expandoCount: () => expandos.size,
    dispose() {
      // RELEASE WHAT IS STILL HELD before the listeners go: a press this
      // realm passed whose release never came (Stop with W down) would
      // otherwise stay held in the game's own input state for good.
      for (const release of inputBlocked.outstandingReleases()) {
        for (const owned of [...listeners]) {
          if (owned.type === release.type) owned.actual.call(proxy, release);
        }
        for (const property of properties.values()) {
          if (property.type === release.type) property.actual.call(proxy, release);
        }
      }
      disposed = true;
      const count = listeners.length + properties.size;
      for (const owned of [...listeners]) removeOwned(owned);
      for (const property of properties.values()) {
        real.removeEventListener(property.type, property.actual);
      }
      properties.clear();
      expandos.clear();
      return count;
    },
  };
}

let installed = false;

/**
 * Publish (or RE-publish) the DEFAULT realm's proxies under the names the
 * module prelude falls back to, and re-point `gameLoopGate()` at that realm's
 * loop gate.
 *
 * Called twice: once at install, and again whenever `disposeGameRealm`
 * reclaims the default realm. These are captured VALUES, not lookups, so a
 * default realm that is reclaimed and rebuilt must refresh them — otherwise the
 * names, and every ingest caller holding `gameLoopGate()`, keep addressing the
 * generation that was just closed.
 *
 * No-op outside a browser (`gameRealmForMountId` would build proxies over
 * globals that do not exist), which is also why {@link disposeGameRealm} can
 * call it unconditionally from Node-side unit fixtures.
 */
function publishDefaultRealmGlobals(): void {
  if (!installed) return;
  const g = globalThis as unknown as Record<string, unknown>;
  const base = gameRealmForMountId();
  loopGate = defaultLoopGate;
  g['__vgaiGameTimers'] = base.timers;
  g['__vgaiGameWindow'] = base.window;
  g['__vgaiGameDocument'] = base.document;
  g['__vgaiGameConsole'] = base.console;
}

/**
 * Install the game-realm resolver on the host `globalThis` so the prelude
 * prepended to project modules resolves to them. Idempotent; no-op outside a
 * browser (the dev server never calls this).
 */
export function installGatedGameGlobals(): void {
  if (installed || typeof window === 'undefined' || typeof document === 'undefined') return;
  installed = true;
  const g = globalThis as unknown as Record<string, unknown>;
  // The creation-site recorder is a game-realm global of exactly the
  // same kind as the ones below — published for a serve-time prelude to call,
  // installed once, browser-only. One owner, one lifecycle; see
  // `creation-site-registry.ts`'s header for why the WeakMap behind it is never
  // torn down.
  installCreationSiteRecorder();
  // The transform bakes the mount id into the prelude. Resolve that identity
  // directly; parsing it as a URL silently selected the default realm.
  //
  // Resolving is ALSO the evaluation marker. The prelude runs this at the top
  // of every project module body, so the synchronous run that follows —
  // including calls INTO shared bare deps, whose own module text carries no
  // prelude and reaches the NATIVE console — is this realm's code executing.
  // Without the marker, a library warn fired during graph evaluation (racing's
  // module-scope Supabase client is the measured case) reached the console
  // capture with no realm on the stack and was ledgered as editor-owned.
  // The microtask pop bounds the window: it runs when the current synchronous
  // evaluation chunk yields, before the mount's own import().then
  // continuation (queued later) can run editor code.
  g['__vgaiGameModuleUrls'] = loadedGameRealmModuleUrls;
  g['__vgaiGameRealm'] = (mountId: string): GameRealm => {
    executingRealms.push(mountId);
    queueMicrotask(() => {
      const at = executingRealms.lastIndexOf(mountId);
      if (at >= 0) executingRealms.splice(at, 1);
    });
    return gameRealmForMountId(mountId);
  };
  // The DEFAULT realm's globals stay published under their original names, and
  // the prelude still falls back to them. That is what keeps every non-isolated
  // surface — an in-page transpile, an ingest fixture, and any module served
  // without a mount id — on exactly today's behaviour.
  publishDefaultRealmGlobals();
}
