/**
 * THE EDITOR CONSOLE - and the one thing to know before wiring it into a host.
 *
 * THE BOTTOM BAR'S ERROR COUNT AND THE SET `vgai console` PRINTS ARE ONE SET.
 * The status bar, the Console panel and the Console utility's badge all read
 * this store; `vgai console` reads the SERVER's ledger; and `console-sync.ts`
 * is the only thing that makes them the same set, by forwarding every error and
 * warning captured here to that ledger. An error the bottom bar counts MUST be
 * an error `vgai console` prints and exits non-zero on - that equality IS the
 * loudness convention, not an implementation detail of it.
 *
 * So `installEditorConsoleCapture()` is HALF of an act and never a whole one. A
 * host boots the editor through `console-sync.ts`'s
 * `installEditorConsoleReporting()`, which does both and cannot be half-called.
 * Calling the capture alone (measured 2026-09-19, on a boot path that did)
 * gives a page whose red errors are visible only to somebody
 * LOOKING at the editor and a CLI that calls the session clean. This function
 * stays exported for tests and for `console-sync.ts` itself; it is not a boot
 * step.
 */
import { captureOwnerStack } from 'react';
import { isCancellationReason } from './cancellation-reason';

export type ConsoleLevel = 'info' | 'warn' | 'error';

export interface ConsoleEntry {
  id: number;
  timestamp: number;
  level: ConsoleLevel;
  message: string;
  source?: string;
  subsystem?: string;
  metadata?: Record<string, unknown>;
  count: number;
}

const MAX_ENTRIES = 1000;

class EditorConsole {
  private _entries: ConsoleEntry[] = [];
  private _listeners = new Set<() => void>();
  private _nextId = 0;
  private _version = 0;
  private _notifyScheduled = false;
  private _sink: ((entry: ConsoleEntry) => void) | null = null;

  /** Register (or clear) a callback invoked for every console entry. */
  setSink(fn: ((entry: ConsoleEntry) => void) | null): void {
    this._sink = fn;
  }

  counts = { info: 0, warn: 0, error: 0 };

  log(message: string, source?: string): void {
    this._push('info', message, source);
  }

  warn(message: string, source?: string): void {
    this._push('warn', message, source);
  }

  error(message: string, source?: string): void {
    this._push('error', message, source);
  }

  /** Log with structured metadata (used by the engine logger). */
  logStructured(
    level: ConsoleLevel,
    message: string,
    source: string,
    subsystem?: string,
    metadata?: Record<string, unknown>,
  ): void {
    this._push(level, message, source, subsystem, metadata);
  }

  clear(): void {
    this._entries = [];
    this.counts = { info: 0, warn: 0, error: 0 };
    this._notify();
  }

  getEntries(): readonly ConsoleEntry[] {
    return this._entries;
  }

  // useSyncExternalStore compatible
  subscribe = (cb: () => void): (() => void) => {
    this._listeners.add(cb);
    return () => this._listeners.delete(cb);
  };

  getSnapshot = (): number => this._version;

  private _push(
    level: ConsoleLevel,
    message: string,
    source?: string,
    subsystem?: string,
    metadata?: Record<string, unknown>,
  ): void {
    // Collapse identical consecutive messages
    const last = this._entries[this._entries.length - 1];
    if (
      last &&
      last.level === level &&
      last.message === message &&
      last.source === source &&
      last.metadata?.['instanceId'] === metadata?.['instanceId']
    ) {
      last.count++;
      last.timestamp = Date.now();
      this._sink?.(last);
      this._notify();
      return;
    }

    const entry: ConsoleEntry = {
      id: this._nextId++,
      timestamp: Date.now(),
      level,
      message,
      count: 1,
    };
    if (source) entry.source = source;
    if (subsystem) entry.subsystem = subsystem;
    if (metadata) entry.metadata = metadata;
    this._entries.push(entry);
    this.counts[level]++;
    this._sink?.(entry);

    // Cap at MAX_ENTRIES, drop oldest
    if (this._entries.length > MAX_ENTRIES) {
      const removed = this._entries.shift()!;
      this.counts[removed.level] = Math.max(0, this.counts[removed.level] - 1);
    }

    this._notify();
  }

  /**
   * Bump the snapshot NOW; wake subscribers on a microtask.
   *
   * Every subscriber of this store is a React `useSyncExternalStore`
   * (`ConsolePanel`, `HarnessConversationTray`, `HarnessChatPanel`, the status
   * bar's error count, the Console utility's badge), and this store's writers
   * are unbounded: `installEditorConsoleCapture` routes the session's WHOLE
   * `console.error`/`console.warn` into it — including React's own DEV
   * warnings, which React logs FROM INSIDE THE RENDER PHASE. A synchronous
   * fan-out therefore schedules a subscriber's setState while some other
   * component is rendering, which React reports as
   * `Cannot update a component (HarnessConversationTray) while rendering a
   * different component` — measured on the owner's session
   * 2026-08-16, where a single dev warning logged during the workspace host's
   * render produced that error in the editor's own console at boot.
   *
   * A microtask cannot run inside a render pass (React restores its execution
   * context before the stack unwinds), so deferring the wake-up is what makes
   * the write legal from anywhere. `_version` is bumped synchronously, so
   * `getSnapshot()` is never stale for a render already in flight; only the
   * notification waits. Coalescing is the bonus: a burst of game logs now
   * costs one re-render instead of one per line.
   *
   * Do not "simplify" this back to a synchronous loop.
   */
  private _notify(): void {
    this._version++;
    if (this._notifyScheduled) return;
    this._notifyScheduled = true;
    queueMicrotask(() => {
      this._notifyScheduled = false;
      for (const fn of this._listeners) fn();
    });
  }
}

export const editorConsole = new EditorConsole();

// Test-only hook (e2e) — the window mirror A4(f) anticipates: direct read access to console entries without DOM-scraping
// `ConsolePanel` (which has no per-entry testids). Same ad-hoc `window.__vgai*`
// convention as every other dev-only hook in `test-window.ts`.
//
// Guarded on `window`: this module is now imported by `three-authoring-adapter.ts`
// (to report a failed history journal loudly), which is exercised by node-env
// vitest suites where `window` does not exist. A bare module-scope reference
// throws `ReferenceError: window is not defined` at COLLECTION time — before any
// test body runs — so the guard belongs here at the source rather than as a
// `vi.mock` repeated in every importing test file.
if (typeof window !== 'undefined') {
  (window as unknown as { __vgaiEditorConsole?: EditorConsole })['__vgaiEditorConsole'] =
    editorConsole;
}

// --- Console argument formatting ---

/** Ceiling on one `%o`/`%O`/`%j` rendering. Game code logs whole scene graphs;
 *  a JSON dump of one is megabytes, and this store keeps up to `MAX_ENTRIES` of
 *  them for the session's life. */
const INSPECT_CAP = 1000;
const ERROR_ATTRIBUTION_CAP = 4000;

/** `String(value)`, but a value whose `toString` throws (a null-prototype
 *  object, a revoked proxy) must not take the console down with it. */
function safeString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

/** Object rendering for the directives that ask for one (`%o`, `%O`, `%j`).
 *  Circular-safe and bounded — see `INSPECT_CAP`. */
function inspectArg(value: unknown): string {
  if (typeof value !== 'object' || value === null) return safeString(value);
  const seen = new WeakSet<object>();
  let json: string | undefined;
  try {
    json = JSON.stringify(value, (_key, val) => {
      if (typeof val !== 'object' || val === null) return val;
      if (seen.has(val)) return '[Circular]';
      seen.add(val);
      return val;
    });
  } catch {
    json = undefined;
  }
  if (json === undefined) return safeString(value);
  return json.length > INSPECT_CAP ? `${json.slice(0, INSPECT_CAP)}…` : json;
}

/**
 * Render `console.error(...)`-style arguments the way the console itself does:
 * interpolate the format directives in a leading format string against the
 * following arguments, then append whatever arguments are left over,
 * space-separated.
 *
 * Why this exists rather than `args.map(String).join(' ')`: React logs with
 * printf-style format strings, so the naive join stored
 * "React does not recognize the `%s` prop on a DOM element…" with `%s`
 * UNINTERPOLATED and the prop name riding in a later argument — which the
 * summary's per-message truncation (`command-listener.ts`) then cut off
 * entirely. `vgai status` is the one channel agents are told to trust, and it
 * was delivering evidence with the identifying detail amputated.
 *
 * Behaviour follows the WHATWG console Formatter: directives are consumed
 * left-to-right; a directive with no argument left is emitted literally; `%%`
 * is an escaped percent and consumes nothing; `%c` consumes its argument and
 * renders nothing (this store has no styling). A first argument that is not a
 * string means no format string, so every argument is simply stringified.
 */
export function formatConsoleArgs(args: readonly unknown[]): string {
  if (args.length === 0) return '';
  const [first, ...rest] = args;
  if (typeof first !== 'string' || rest.length === 0) {
    return args.map(safeString).join(' ');
  }

  let consumed = 0;
  const head = first.replace(/%([sdifoOjc%])/g, (match, kind: string) => {
    if (kind === '%') return '%';
    if (consumed >= rest.length) return match;
    const arg = rest[consumed++];
    switch (kind) {
      case 's':
        return typeof arg === 'string' ? arg : safeString(arg);
      case 'd':
      case 'i': {
        if (typeof arg === 'symbol') return 'NaN';
        if (typeof arg === 'bigint') return String(arg);
        const n = Number(arg);
        return Number.isFinite(n) ? String(Math.trunc(n)) : String(n);
      }
      case 'f': {
        if (typeof arg === 'symbol') return 'NaN';
        return String(Number(arg));
      }
      case 'c':
        return '';
      default:
        return inspectArg(arg);
    }
  });

  const leftovers = rest.slice(consumed);
  return leftovers.length === 0 ? head : `${head} ${leftovers.map(safeString).join(' ')}`;
}

/**
 * React 19 prints a DEV warning's component tree through the browser's own
 * console task stack, never as an argument — so a duplicate-key or
 * setState-in-effect warning reached `vgai console` as one sentence with no
 * hint of WHICH list. `captureOwnerStack()` is React's door to that tree and
 * is only populated while React itself is calling `console.error`, which is
 * exactly when this wrapper runs. Appended for React's warning shapes only;
 * everything else keeps its exact message.
 */
function withReactOwnerStack(args: readonly unknown[], message: string): string {
  const first = args[0];
  if (typeof first !== 'string') return message;
  if (
    !/^(Encountered two children with the same key|Each child in a list should have a unique|Maximum update depth exceeded|Cannot update a component)/.test(
      first,
    )
  ) {
    return message;
  }
  try {
    const stack = captureOwnerStack?.();
    return stack ? `${message}\nOwner stack:${stack}` : message;
  } catch {
    return message;
  }
}

/** Preserve the component and source evidence a render error already owns. */
export function formatAttributedError(
  error: unknown,
  options: { readonly source?: string; readonly componentStack?: string | null } = {},
): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : safeString(error);
  const parts = [options.source ? `[${options.source}] ${message}` : message];
  const componentStack = options.componentStack?.trim();
  if (componentStack) parts.push(`Component stack:\n${componentStack}`);
  if (error instanceof Error && error.stack && error.stack !== message) {
    parts.push(`JavaScript stack:\n${error.stack}`);
  }
  const formatted = parts.join('\n');
  return formatted.length > ERROR_ATTRIBUTION_CAP
    ? `${formatted.slice(0, ERROR_ATTRIBUTION_CAP)}…`
    : formatted;
}

// --- Session-lifetime console capture ---

/**
 * THE LAYERING (read this together with `play-mode.ts`'s
 * `patchConsole()`/`unpatchConsole()` — the two patches are one design):
 *
 * 1. `installEditorConsoleCapture()` runs ONCE at editor boot (`main.tsx`) and
 *    wraps `console.error`/`console.warn` for the WHOLE session, tagging what
 *    it captures `'editor'`. Before it existed, play-mode's patch was the ONLY
 *    funnel from a raw `console.error` into this store — and it is installed at
 *    play START and removed at play STOP. So an editor-frame error outside play
 *    (measured: Content-tab story previews throwing `useRapier must be used
 *    within <Physics>`) reached this store never, and `vgai status` answered
 *    `consoleErrors: {count: 0}` to a console full of red.
 * 2. Play-mode's patch is installed LATER, so it sits OUTSIDE this one: it
 *    captures whatever `console.error` currently is (this wrapper) as its
 *    "original" and calls through to it. While a run is live play's patch OWNS
 *    the funnel — it tags `'game'`, which is the more specific and more useful
 *    answer — so this wrapper suspends its own store push for the duration and
 *    only forwards to the native console. One error, ONE entry, source
 *    `'game'`. `unpatchConsole()` resumes it, and session-lifetime capture
 *    picks straight back up.
 *
 * Uncaught page errors (`window.onerror`/`unhandledrejection`) are the other
 * half of the same job and are captured here too, tagged `'runtime'` — the
 * source `command-listener.ts`'s `collectPageErrors` reads. They live at boot
 * rather than on the viewport panel so an error thrown BEFORE the viewport
 * mounts is still recorded, and so there is exactly one owner of the listeners
 * for the session's whole life.
 */
/**
 * WHO IS SPEAKING, when a raw `console.error`/`warn` fires — asked, never
 * named.
 *
 * The console is a SINK the shell feeds; the closure ratchet's own rule is
 * that a surface below the shell never imports the shell's world adapters
 * (`scripts/validate-editor-closure.mjs`'s header). It was importing one:
 * `currentGameRealmMountId` from `gated-globals.ts` pulled the whole game
 * REALM SHIM — the page-in-a-box, its storage facade, its navigation guard and
 * its loop gate — into this surface's pinned closure, so 7 of the console's 8
 * files were the game realm and a Blender-only build's console carried a
 * game's page shim (measured 2026-09-18, phase 1 of the open-source launch).
 *
 * The realm is the thing that knows a realm is running, so the realm
 * REGISTERS its reader here (`gated-globals.ts`, at module scope: any realm
 * existing implies that module loaded, so the registration cannot be late for
 * a message the realm itself produced). One named slot rather than a list,
 * because there is exactly one realm shim and a second claimant would be a
 * design decision, not a registration.
 */
let _realmAttribution: (() => string | null) | null = null;

/** Publish the "which realm is synchronously executing?" reader. */
export function setConsoleRealmAttribution(read: () => string | null): void {
  _realmAttribution = read;
}

let _nativeConsoleError: typeof console.error | null = null;
let _nativeConsoleWarn: typeof console.warn | null = null;
let _captureSuspensions = 0;

/** Play-mode's patch takes precedence while a run is live — see the layering
 *  note above. Paired with `resumeEditorConsoleCapture`; counted rather than
 *  boolean so a nested/retried patch cannot leave capture off forever. */
export function suspendEditorConsoleCapture(): void {
  _captureSuspensions++;
}

export function resumeEditorConsoleCapture(): void {
  if (_captureSuspensions > 0) _captureSuspensions--;
}

/** Test-only: whether the session-lifetime capture is currently pushing to the
 *  store. Exists so the layering above is assertable without reaching into
 *  module privates. */
export function isEditorConsoleCaptureActive(): boolean {
  return _nativeConsoleError !== null && _captureSuspensions === 0;
}

/**
 * Install the session-lifetime capture. Idempotent; returns a teardown that
 * restores the native console and removes the page-error listeners.
 */
export function installEditorConsoleCapture(): () => void {
  if (_nativeConsoleError) return () => {};
  const nativeError = console.error;
  const nativeWarn = console.warn;
  _nativeConsoleError = nativeError;
  _nativeConsoleWarn = nativeWarn;

  /**
   * A raw console call is the GAME's statement when game-realm code is
   * synchronously executing. The registered realm attribution above is the
   * door built for exactly this label (`gated-globals.ts`'s
   * `currentGameRealmMountId` — the realm's contextual console runs every
   * method `inRealm`), and play-mode's patch already reads it — but
   * a game's module-scope warns fire at graph EVALUATION (racing's Supabase
   * client is the measured case), which happens at mount, before any play run
   * installs that patch. Without this read, every such row landed in the
   * ledger as editor-owned noise, telling an agent to fix editor code for a
   * warning the game's own library printed. The label changes; the loudness
   * does not — a game-sourced warning still gates `vgai` exit-0 exactly like
   * an editor one (severity decides, never source), because exempting a
   * source would teach the gate to find less.
   */
  const captured = (level: 'error' | 'warn', args: unknown[]): void => {
    if (_captureSuspensions !== 0) return;
    const realmMountId = _realmAttribution?.() ?? null;
    if (realmMountId !== null) {
      // `''` is the DEFAULT game realm (every ingest mount) — still the game's
      // statement, just not a named multi-instance mount.
      editorConsole.logStructured(
        level,
        formatConsoleArgs(args),
        'game',
        undefined,
        realmMountId ? { instanceId: realmMountId } : undefined,
      );
      return;
    }
    editorConsole.logStructured(
      level,
      withReactOwnerStack(args, formatConsoleArgs(args)),
      'editor',
    );
  };

  console.error = (...args: unknown[]) => {
    nativeError.apply(console, args);
    captured('error', args);
  };
  console.warn = (...args: unknown[]) => {
    nativeWarn.apply(console, args);
    captured('warn', args);
  };

  const onError = (e: ErrorEvent) => {
    const source = e.filename
      ? `${e.filename}${e.lineno ? `:${e.lineno}${e.colno ? `:${e.colno}` : ''}` : ''}`
      : undefined;
    editorConsole.error(
      formatAttributedError(e.error ?? e.message, source ? { source } : undefined),
      'runtime',
    );
  };
  const onUnhandledRejection = (e: PromiseRejectionEvent) => {
    // A CANCELLATION IS NOT AN ERROR, and this is the one exception the
    // severity-decides-never-source doctrine above admits — because it is not
    // about source. `cancellation-reason.ts` carries the whole reasoning and
    // the measurement (the Code-OSS frame's `Canceled: Canceled`); the short
    // version is that an operation which was asked to stop and did is what
    // `AbortError` and `CancellationError` MEAN, for our code and anyone
    // else's, and a page-level listener cannot ask whose it was.
    if (isCancellationReason(e.reason)) return;
    editorConsole.error(
      `Unhandled promise rejection: ${formatAttributedError(e.reason)}`,
      'runtime',
    );
  };
  const hasWindow = typeof window !== 'undefined';
  if (hasWindow) {
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
  }

  return () => {
    if (_nativeConsoleError) console.error = _nativeConsoleError;
    if (_nativeConsoleWarn) console.warn = _nativeConsoleWarn;
    _nativeConsoleError = null;
    _nativeConsoleWarn = null;
    _captureSuspensions = 0;
    if (hasWindow) {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    }
  };
}

/**
 * Listen for `console-bridge` postMessage events from a game's own console
 * bridge and pipe them into the editor console.
 */
const BRIDGE_LEVEL_MAP: Record<string, ConsoleLevel> = {
  log: 'info',
  warn: 'warn',
  error: 'error',
};

/** LogLevel string → ConsoleLevel for engine-log messages. */
const ENGINE_LEVEL_MAP: Record<string, ConsoleLevel> = {
  trace: 'info',
  debug: 'info',
  info: 'info',
  warn: 'warn',
  error: 'error',
  fatal: 'error',
};

// Same `window` guard as the test hook above — see the comment there.
if (typeof window !== 'undefined') {
  window.addEventListener('message', (e: MessageEvent) => {
    // Structured engine-log messages (from engine logger)
    if (e.data?.type === 'engine-log') {
      const level = ENGINE_LEVEL_MAP[e.data.level];
      if (!level) return;
      editorConsole.logStructured(
        level,
        e.data.message,
        'engine',
        e.data.subsystem,
        e.data.metadata,
      );
      return;
    }

    // Plain console-bridge messages (from game code)
    if (e.data?.type === 'console-bridge') {
      const level = BRIDGE_LEVEL_MAP[e.data.level];
      if (!level) return;
      editorConsole[level === 'info' ? 'log' : level](e.data.message, 'engine');
    }
  });
}

/** Render one `server-log` payload — live or replayed — into the console. */
export function emitServerLogEntry(entry: { level: string; message: string }): void {
  const level = BRIDGE_LEVEL_MAP[entry.level];
  if (!level) return;
  editorConsole[level === 'info' ? 'log' : level](entry.message, 'server');
}
