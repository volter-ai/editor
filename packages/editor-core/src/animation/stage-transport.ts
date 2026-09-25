/**
 * THE STAGE TRANSPORT — one position on a stage's facts, and the one holder
 * of the content-time door (WORK.md §The stage transport and the animation
 * door; owner ruling 2026-09-20).
 *
 * OWNERSHIP, STATED ONCE. The OWNER is the stage: `StageHost` constructs one
 * transport beside the stage store it already owns, registers it under the
 * document id, and disposes it when that document unmounts. The SHARERS are
 * subjects (a world attaches what it can show at a time) and looks (the
 * transport strip, Blender's Timeline) — both hold a handle and neither may
 * end it. The ONE TEARDOWN PATH is the owning document's unmount; a subject
 * detaching or a look unmounting never disposes the transport, because a
 * stage outlives every look drawn over it. This is the rule the game-scoped
 * clock destroyed by per-root teardown was missing.
 *
 * THE CONTENT-TIME POLICY IT INHERITS, quoted from `StageHost.tsx` where it
 * was already written: on every stage PRESENTATION time (orbit, dressing,
 * helpers) always advances, and CONTENT time advances ONLY through the one
 * `advanceContent` door, and only while a human holds an explicit transport.
 * This class IS that human's hand: `tick` returns the seconds it advanced and
 * the host passes exactly that to `advanceContent`, so a stage with no
 * transport demand still publishes a content clock that stood still
 * (`coverage/design-time-surfaces.ts`).
 *
 * IT IS NOT THE SIM CLOCK. `core/sim-clock.ts` is the game's own time and
 * this transport is INERT whenever it runs — `driver` reads the stage store's
 * `playState`, and every write verb refuses by name while a world is driving.
 *
 * NO SECOND CLOCK, AND NO PRIVATE ONE. The time arithmetic is the engine's
 * `AnimationClock` (ranges, loop laps, exact frame seeking); this class adds
 * the subject registry, the driver gate and the settle debounce, and nothing
 * else. `scripts/validate-import-bans.mjs`'s `private-clocks` row is the
 * tripwire against a `requestAnimationFrame`/`performance.now` growing back
 * in here or in a look.
 */

import type {
  StageTransportSnapshot,
  TransportPlaybackState,
  TransportSubject,
} from '@volter/editor-sdk/host';
import { AnimationClock } from './animation-clock';
import type { ShellStore } from '@volter/editor-sdk/kit/shell-store';

/** The range a transport reports with nothing attached — a real, inert
 *  domain, so a look never has to special-case `null` arithmetic. */
const EMPTY_RANGE = { start: 0, end: 0, fps: 30, loop: false } as const;

/** Scrub-end: the first quiet interval after a `seek` while not playing.
 *  Long enough that a slider drag's frames coalesce into ONE settle, short
 *  enough that releasing the mouse writes the bookmark without a visible wait. */
const SETTLE_QUIET_MS = 150;

export class StageTransport {
  private readonly clock = new AnimationClock();
  private readonly subjects: TransportSubject[] = [];
  private activeId: string | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly settleListeners = new Set<(seconds: number) => void>();
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  /**
   * The last snapshot handed out, held until something changes.
   * `useSyncExternalStore` compares snapshots by IDENTITY and re-renders
   * forever if `getSnapshot` mints a fresh object each call, so the cache is
   * not an optimization — it is what makes this class usable from React at
   * all. `notify()` is the one invalidator, which is also the one place a
   * change is announced, so the two cannot drift apart.
   */
  private cachedSnapshot: StageTransportSnapshot | null = null;

  private readonly stopStoreWatch: () => void;

  constructor(private readonly store: ShellStore) {
    // `driver` reads the store, and the store changes WITHOUT any call on this
    // class (entering Play is a store event). A snapshot cached across that
    // would report `driver: 'editor'` while the world is already driving, so
    // the strip would draw live controls over a running game. Invalidate here.
    this.stopStoreWatch = store.subscribe(() => this.notify());
  }

  // ---------------------------------------------------------------- subjects

  /**
   * Attach a subject. The FIRST attach becomes active — a stage that just
   * mounted one thing is immediately scrubbable with no further call. Returns
   * the detach; detaching the active subject promotes whatever remains.
   */
  attach(subject: TransportSubject): () => void {
    this.subjects.push(subject);
    if (this.activeId === null) this.setActiveSubject(subject.id);
    else {
      // A later subject shows the transport's time from its first frame too;
      // unsampled, a skinned character stands in its bind pose until the
      // playhead next moves.
      subject.seek(this.clock.time);
      this.notify();
    }
    return () => {
      const at = this.subjects.indexOf(subject);
      if (at < 0) return;
      this.subjects.splice(at, 1);
      if (this.activeId !== subject.id) {
        this.notify();
        return;
      }
      this.activeId = null;
      const next = this.subjects[0];
      if (next) this.setActiveSubject(next.id);
      else {
        this.clock.setRange({ start: EMPTY_RANGE.start, end: EMPTY_RANGE.end, loop: false });
        this.notify();
      }
    };
  }

  /** Make `id` active: take ITS range, and clamp the current time into it —
   *  switching subjects moves the playhead as little as the new domain allows. */
  setActiveSubject(id: string): void {
    const subject = this.subjects.find((s) => s.id === id);
    if (!subject) return;
    this.activeId = id;
    const range = subject.range();
    this.clock.setRange({ start: range.start, end: range.end });
    // `setRange` only emits when it had to clamp, so re-assert the position
    // unconditionally: every subject must be showing the transport's time,
    // including the one that just became active inside an unchanged range.
    this.applyTime(this.clock.time);
    this.notify();
  }

  private get active(): TransportSubject | null {
    return this.subjects.find((s) => s.id === this.activeId) ?? null;
  }

  private fps(): number {
    return this.active?.range().fps ?? EMPTY_RANGE.fps;
  }

  // ------------------------------------------------------------------ driver

  /**
   * Who is advancing time. Reads the stage store this transport was built
   * with and nothing else: for a Model document that store is always
   * `'stopped'`, and for the Scene/Game document Play sets it.
   */
  private get driver(): 'editor' | 'world' {
    return this.store.playState === 'stopped' ? 'editor' : 'world';
  }

  /** Refuse BY NAME, so a caller reads what to do rather than that it failed. */
  private assertEditorDrives(): void {
    if (this.driver === 'world') {
      throw new Error('transport: the world is driving time (Play); pause the game to scrub');
    }
  }

  // --------------------------------------------------------------- transport

  play(direction: 'forward' | 'reverse' = 'forward'): void {
    this.assertEditorDrives();
    if (!this.active) return;
    this.cancelSettle();
    this.clock.play(direction);
    this.notify();
  }

  pause(): void {
    this.assertEditorDrives();
    this.clock.pause();
    this.cancelSettle();
    this.settle();
    this.notify();
  }

  /** `stop()` = `pause()` then home to the range's start. */
  stop(): void {
    this.assertEditorDrives();
    this.clock.pause();
    this.cancelSettle();
    this.applyTime(this.clock.seek(this.clock.range.start).currentTime);
    this.clock.stop();
    this.settle();
    this.notify();
  }

  seek(seconds: number): void {
    this.assertEditorDrives();
    this.applyTime(this.clock.seek(seconds).currentTime);
    // A seek WHILE PLAYING never settles — only a scrub does, and a scrub is
    // by definition not playback.
    if (this.clock.playbackState !== 'playing') this.scheduleSettle();
    this.notify();
  }

  /** Frames are the LOOK's unit, never the seam's: one conversion, here. */
  seekFrame(frame: number): void {
    this.seek(frame / this.fps());
  }

  setLoop(loop: boolean): void {
    this.clock.setRange({ loop });
    this.notify();
  }

  setTimeScale(scale: number): void {
    this.clock.timeScale = scale;
    this.notify();
  }

  /**
   * Called by the stage host's frame callback with that frame's dt. Inert
   * unless PLAYING and the editor drives. Returns the seconds advanced — the
   * host adds exactly this to `host.contentSeconds` through `advanceContent`,
   * which is what keeps the Edit-static vitals row honest.
   */
  tick(dt: number): number {
    if (this.disposed || this.driver === 'world') return 0;
    if (this.clock.playbackState !== 'playing') return 0;
    const before = this.clock.time;
    const crossing = this.clock.advance(dt);
    if (!crossing) return 0;
    this.applyTime(crossing.currentTime);
    this.notify();
    // Across a loop wrap `currentTime - before` is negative (and meaningless
    // as an elapsed duration), so report the magnitude the clock was asked
    // to move: that is what actually elapsed on this stage's content clock.
    return crossing.looped ? Math.abs(dt) * this.clock.timeScale : crossing.currentTime - before;
  }

  /**
   * Hand the crossing's time to EVERY attached subject, the active one first.
   * Every subject, not just the active one: a stage showing two things at one
   * position must not leave the inactive one frozen at whenever it was last
   * looked at. The active one leads so the thing a person is watching is the
   * first to update within a frame.
   */
  private applyTime(seconds: number): void {
    const active = this.active;
    if (active) active.seek(seconds);
    for (const subject of this.subjects) {
      if (subject !== active) subject.seek(seconds);
    }
  }

  // ----------------------------------------------------------------- settled

  onSettled(listener: (seconds: number) => void): () => void {
    this.settleListeners.add(listener);
    return () => {
      this.settleListeners.delete(listener);
    };
  }

  private scheduleSettle(): void {
    this.cancelSettle();
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      this.settle();
    }, SETTLE_QUIET_MS);
  }

  private cancelSettle(): void {
    if (this.settleTimer === null) return;
    clearTimeout(this.settleTimer);
    this.settleTimer = null;
  }

  private settle(): void {
    if (this.disposed) return;
    const at = this.clock.time;
    for (const listener of [...this.settleListeners]) listener(at);
  }

  // ---------------------------------------------------------------- readback

  snapshot(): StageTransportSnapshot {
    const cached = this.cachedSnapshot;
    if (cached) return cached;
    const range = this.active?.range() ?? EMPTY_RANGE;
    const next: StageTransportSnapshot = {
      time: this.clock.time,
      range: {
        start: this.clock.range.start,
        end: this.clock.range.end,
        fps: range.fps,
        loop: this.clock.range.loop,
      },
      playbackState: this.clock.playbackState as TransportPlaybackState,
      timeScale: this.clock.timeScale,
      activeSubject: this.activeId,
      subjects: this.subjects.map((s) => ({ id: s.id, label: s.label })),
      driver: this.driver,
    };
    this.cachedSnapshot = next;
    return next;
  }

  /**
   * The ACTIVE subject's clips, or `null` when it has none.
   *
   * Deliberately not on the snapshot: `StageTransportSnapshot` is the shape a
   * CONTRIBUTION sees through the SDK, and a clip list is a three-world
   * detail (Blender omits `clips` entirely — an action IS the subject there).
   * The editor's own strip reaches it through the class it already imports.
   */
  activeClips(): readonly { id: string; label: string }[] | null {
    const active = this.active;
    const clips = active?.clips?.();
    return clips && clips.length > 1 ? clips : null;
  }

  setActiveClip(id: string): void {
    this.assertEditorDrives();
    this.active?.setClip?.(id);
    // The new clip's duration is a new range, and the playhead clamps into it.
    const range = this.active?.range();
    if (range) this.clock.setRange({ start: range.start, end: range.end });
    this.applyTime(this.clock.time);
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    this.cachedSnapshot = null;
    for (const listener of [...this.listeners]) listener();
  }

  dispose(): void {
    this.disposed = true;
    this.stopStoreWatch();
    this.cancelSettle();
    this.clock.stop();
    this.subjects.length = 0;
    this.activeId = null;
    this.listeners.clear();
    this.settleListeners.clear();
  }
}

/**
 * WHICH TRANSPORT A STAGE RUNS ON — deliberately the same shape as
 * `stage-store-registry.ts`, for the same objects and the same reason: a
 * panel or contribution holding only a document id must be able to reach the
 * stage's transport without the stage handing it down through props.
 */
const transports = new Map<string, StageTransport>();
const registryListeners = new Set<() => void>();

function notifyRegistry(): void {
  for (const listener of [...registryListeners]) listener();
}

/** A mounted stage declares its transport. Re-registering the same document
 *  replaces it; the returned unregister drops it. */
export function registerStageTransport(documentId: string, transport: StageTransport): () => void {
  transports.set(documentId, transport);
  notifyRegistry();
  return () => {
    if (transports.get(documentId) !== transport) return;
    transports.delete(documentId);
    notifyRegistry();
  };
}

/** That document's transport, or `null` for a document with no stage of its
 *  own (a tool tab, a text document). */
export function stageTransport(documentId: string | null): StageTransport | null {
  return documentId === null ? null : (transports.get(documentId) ?? null);
}

/** `useSyncExternalStore` shape — a stage mounting or unmounting changes what
 *  `stageTransport()` answers. */
export function subscribeStageTransports(listener: () => void): () => void {
  registryListeners.add(listener);
  return () => {
    registryListeners.delete(listener);
  };
}
