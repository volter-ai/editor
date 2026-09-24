/**
 * THE LIVE SESSIONS — what is running in this tab, registered by whoever
 * mounts it (WORK.md §Play leaves the host, P1). The host never names Play,
 * ingest or the module lane; it asks this registry "is anything live?",
 * "is the editor playing?", "which element holds instance X?", and "stop
 * everything" — the questions `editor-session-mode.ts`,
 * `project-session-reset.ts`, `EditorLeaseGuard.tsx`,
 * `RootSelectionOverlay.tsx` and `editor-view-presentation.ts` asked
 * `play-mode.ts` by name until 2026-09-17. A package registers through
 * `@volter/editor-sdk/host`'s `live` member; the host's own lanes register
 * here directly until they move.
 */

import type {
  LiveCommand,
  LiveCommandResult,
  LiveCoverageReport,
  LiveRemountArgs,
  LiveRunWindow,
  LiveSceneTable,
  LiveSession,
} from '@volter/editor-sdk/host';

interface Registered {
  readonly session: LiveSession;
  readonly seq: number;
}
let registered: Registered[] = [];
let seq = 0;
let version = 0;
const listeners = new Set<() => void>();
function notify(): void {
  version++;
  for (const listener of listeners) listener();
}

/** A lane's own state moved (restart-required, its run window). */
export function notifyLiveSessionsChanged(): void {
  notify();
}

/** Every registered lane, in `stop` order. */
export function liveSessions(): readonly LiveSession[] {
  return ordered();
}

/** The newest run across lanes: the greatest `startedAt` any lane reports. */
export function liveRunWindow(): LiveRunWindow | null {
  let newest: LiveRunWindow | null = null;
  for (const { session } of registered) {
    const startedAt = session.startedAt?.() ?? null;
    if (startedAt === null) continue;
    if (!newest || startedAt > newest.startedAt)
      newest = { startedAt, endedAt: session.endedAt?.() ?? null };
  }
  return newest;
}

export function liveRestartRequired(): string | null {
  for (const { session } of registered) {
    const reason = session.restartRequired?.() ?? null;
    if (reason !== null) return reason;
  }
  return null;
}

/** Re-enter the lane that reports a restart is required, else the first
 *  running lane that can restart. */
export function restartLiveSession(): void {
  const stale = ordered().find((session) => (session.restartRequired?.() ?? null) !== null);
  const target = stale ?? ordered().find((session) => session.mounted() && session.restart);
  target?.restart?.();
}

/** The canvas a mounted lane's own render pass draws, or null. */
export function liveFrameCanvas(): HTMLCanvasElement | null {
  for (const session of ordered()) {
    if (!session.mounted()) continue;
    const canvas = session.frameCanvas?.() ?? null;
    if (canvas) return canvas;
  }
  return null;
}

/** The pixels of `canvas` from the lane whose render pass owns it; null when
 *  no mounted lane claims that canvas. */
export function snapshotLiveFrame(
  canvas: HTMLCanvasElement,
): Promise<CanvasImageSource | null> | null {
  for (const session of ordered()) {
    if (!session.mounted() || !session.snapshotFrame) continue;
    if (session.frameCanvas?.() === canvas) return session.snapshotFrame();
  }
  return null;
}

/** The first mounted lane's own answer to `cmd`, or null when none claims it. */
export function dispatchLiveCommand(cmd: LiveCommand): LiveCommandResult | null {
  for (const session of ordered()) {
    if (!session.mounted() || !session.command) continue;
    const answered = session.command(cmd);
    if (answered) return answered;
  }
  return null;
}

/**
 * The running lane's scene entries, or null.
 *
 * The shape check is STRUCTURAL and stays here rather than importing a lane's
 * own type guard (it imported the ingest lane's `isContractScenesStories`,
 * by name, until 2026-09-18, and with it the whole `window.vgaiGame` contract
 * — an INGEST vocabulary inside the registry every lane registers through).
 * `LiveSceneTable` is a declaration, and a lane is foreign code: the
 * host checks that the declaration is honoured before handing the table to the
 * `open` verb, and names no lane doing it.
 */
export function liveScenes(): LiveSceneTable | null {
  for (const session of ordered()) {
    if (!session.mounted()) continue;
    const scenes = session.scenes?.() ?? null;
    if (scenes && typeof scenes.goToScene === 'function') return scenes;
  }
  return null;
}

/** The native surface the mounted lane's content draws on, or null. */
export function liveSurface(): 'three' | 'canvas' | 'dom' | null {
  for (const session of ordered()) {
    if (!session.mounted()) continue;
    const surface = session.surface?.() ?? null;
    if (surface) return surface;
  }
  return null;
}

/** The mounted lane's own coverage report, or null when none grades itself. */
export function liveCoverage(): LiveCoverageReport | null {
  for (const session of ordered()) {
    if (!session.mounted()) continue;
    const report = session.coverage?.() ?? null;
    if (report) return report;
  }
  return null;
}

/** Why authoring is off for the mounted lane's content, or null. */
export function liveAuthoringRefusal(): string | null {
  for (const session of ordered()) {
    if (!session.mounted()) continue;
    const reason = session.authoringRefusal?.() ?? null;
    if (reason !== null) return reason;
  }
  return null;
}

/** Ask the running lane to re-mount with an authored selection; null when
 *  no running lane can. */
export function remountLiveSelection(
  args: LiveRemountArgs,
): Promise<{ ok: true } | { ok: false; error: string }> | null {
  const target = ordered().find((session) => session.mounted() && session.remount);
  return target?.remount?.(args) ?? null;
}

/** Register a lane. `stop` order follows `priority` (low first), then
 *  registration: a normal stop tears down Play before ingest. */
export function registerLiveSession(session: LiveSession): () => void {
  if (registered.some((entry) => entry.session.id === session.id))
    throw new Error(`live session "${session.id}" is already registered.`);
  const entry: Registered = { session, seq: seq++ };
  registered = [...registered, entry];
  notify();
  return () => {
    registered = registered.filter((other) => other !== entry);
    notify();
  };
}

function ordered(): readonly LiveSession[] {
  return [...registered]
    .sort((a, b) => (a.session.priority ?? 0) - (b.session.priority ?? 0) || a.seq - b.seq)
    .map((entry) => entry.session);
}

/** A real game owns a canvas: Play, an ingested game, an auto-mounted module world. */
export function anyLiveSessionMounted(): boolean {
  return ordered().some((session) => session.mounted());
}

/** The editor is in PLAY: somebody asked the host to run content. A held
 *  (paused-at-design-time) mount is not playing. */
export function anyLiveSessionPlaying(): boolean {
  return ordered().some((session) => session.playing());
}

/** Stop every lane, in priority order; each stop is idempotent and a no-op
 *  when its lane runs nothing. */
export function stopAllLiveSessions(): void {
  for (const session of ordered()) session.stop();
}

/** The element holding a live instance — the primary when `id` is omitted —
 *  from whichever lane holds it. */
export function liveInstanceContainer(id?: string): HTMLElement | null {
  for (const session of ordered()) {
    const container = session.instanceContainer(id);
    if (container) return container;
  }
  return null;
}

export function subscribeLiveSessions(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function liveSessionsVersion(): number {
  return version;
}
