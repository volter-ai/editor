/**
 * The play-state control surface over whatever `{ ingest }` root is live —
 * the one seam `components/PlayBar.tsx` and the CLI relay
 * (`ingest/ingest-play-commands.ts`) drive ▶/⏸/Step through.
 *
 * Reads the single session slot (`active-ingest.ts`) and nothing else; the
 * mount paths call {@link setIngestPlaying} and the teardown path calls
 * {@link resetIngestPlaySurface}.
 */

import { gameContractEpoch } from '@editor/coverage/game-contract-seam-evidence';
import { recordLiveSeamEvidence } from '@editor/coverage/live-seam-evidence';
import { editorConsole } from '@editor/editor-console';
import { activateLiveDocument } from '@editor/live-document';
import type { VgaiGameContract } from '@vgai/project/adapter/ingest/game-contract';
import { activeIngest, type IngestLifecycleControl } from './active-ingest';
import { readIngestGameContract } from './game-contract-realm';

/**
 * The play-state control surface for the CURRENT ingest session (F17/F21):
 * mounts are COLD by doctrine — the adapter sets `window.__vgaiMountCold`
 * before the game's entry executes, and a session-driven game may defer its
 * side-effects (backend connection, narrative, audio) until the first
 * `play()`. Everything is contract-first (game-contract.ts): `lifecycle.start`
 * is called AT MOST ONCE per mount — later ▶ presses resume rather than
 * re-start, so games never need an idempotent start;
 * Mounting normalizes `lifecycle.pause`/`resume` or the substrate's real
 * `setPaused` fallback into ONE {@link IngestLifecycleControl}. This module's
 * runtime consumers never choose between raw mechanisms, and a malformed
 * half-pair never borrows its missing half from the fallback. Games that
 * declare no `start` still get the pre-contract wire event.
 */
export interface IngestPlayControl {
  readonly playing: boolean;
  play(): void;
  pause(): void;
  resume(): void;
  /**
   * True only when the loop gate actually holds this game's
   * frames (`ingest/same-realm-loop-gate.ts`), which is the only condition
   * under which a single-frame step is a real thing rather than a button that
   * lies.
   */
  readonly canStep: boolean;
  /** Advance exactly one frame batch and hold again. No-op when `canStep` is false. */
  step(): void;
}

let _ingestPlaying = false;

/** Whether the live session's loop was last told to run (the status facet's
 *  `playing`). */
export function ingestPlaying(): boolean {
  return _ingestPlaying;
}

/**
 * THE one write to the ingest play state.
 *
 * An ingested game's input is gated by the same mechanisms a first-party play
 * session's is (the engine's `InputManager.setEnabled` and `gated-globals.ts`'s
 * lexical window/document shadow), driven by the input gate the mount installs.
 */
export function setIngestPlaying(playing: boolean): void {
  _ingestPlaying = playing;
}

/**
 * F26: the play surface's state is session-global (one active session,
 * whatever its kind), so EVERY per-kind exit path resets it — the playing
 * flag plus the cold-mount/played window globals the entry paths set.
 */
export function resetIngestPlaySurface(): void {
  setIngestPlaying(false);
  const w = window as unknown as { __vgaiMountCold?: boolean; __vgaiIngestPlayed?: boolean };
  delete w.__vgaiMountCold;
  delete w.__vgaiIngestPlayed;
}

/**
 * F26 helper: the active session's kind + its own honest pause capability
 * (D-V1: dispatches on the single slot, never a per-kind global).
 * `null` when nothing is ingested.
 */
export interface IngestLifecycleFallback {
  readonly setPaused?: ((paused: boolean) => void) | undefined;
  readonly pauseGap?: string | undefined;
  readonly step?: (() => void) | undefined;
  readonly canStep?: (() => boolean) | undefined;
}

function runContractLifecycleEffect(
  contract: VgaiGameContract,
  member: 'start' | 'pause' | 'resume',
  run: () => void,
): void {
  const receipt = (outcome: 'pass' | 'fail', detail: string): void =>
    recordLiveSeamEvidence({
      seam: `contract.lifecycle.${member}`,
      subject: 'game',
      epoch: gameContractEpoch(contract),
      stage: 'effect',
      outcome,
      source: 'consumer',
      detail,
    });
  try {
    run();
    receipt('pass', `the mounted ingest lifecycle consumed lifecycle.${member}`);
  } catch (error) {
    receipt(
      'fail',
      `lifecycle.${member} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  }
}

/**
 * Normalize raw lifecycle declarations and a substrate fallback ONCE, at
 * mount. The declared pause/resume pair wins as one indivisible capability;
 * a half-pair is malformed and may never silently mix with the fallback.
 * Step belongs only to the fallback that actually took the hold.
 */
export function bindIngestLifecycle(
  fallback: IngestLifecycleFallback = {},
): IngestLifecycleControl {
  const contract = readIngestGameContract();
  const declared = contract?.lifecycle;
  const start = () => {
    if (contract && declared?.start) {
      runContractLifecycleEffect(contract, 'start', () => declared.start?.());
      return;
    }
    window.dispatchEvent(new CustomEvent('vgai:ingest-play'));
  };

  const hasPause = typeof declared?.pause === 'function';
  const hasResume = typeof declared?.resume === 'function';
  if (contract && hasPause !== hasResume) {
    return {
      start,
      pauseGap: hasPause
        ? 'the game contract declares lifecycle.pause without lifecycle.resume'
        : 'the game contract declares lifecycle.resume without lifecycle.pause',
    };
  }
  if (contract && hasPause && hasResume) {
    return {
      start,
      setPaused: (paused) =>
        runContractLifecycleEffect(contract, paused ? 'pause' : 'resume', () => {
          if (paused) declared?.pause?.();
          else declared?.resume?.();
        }),
    };
  }
  if (fallback.setPaused) {
    return {
      start,
      setPaused: fallback.setPaused,
      ...(fallback.step ? { step: fallback.step } : {}),
      ...(fallback.canStep ? { canStep: fallback.canStep } : {}),
    };
  }
  return {
    start,
    pauseGap:
      fallback.pauseGap ??
      'the game declares no lifecycle.pause/resume pair and its mounted adapter exposes no setPaused capability',
  };
}

export function activeIngestPauseGap(): string | null {
  const active = activeIngest();
  if (!active) return null;
  return active.session.lifecycle.pauseGap ?? null;
}

/**
 * D-B2 (Slice B): fan a pause/resume state out to
 * every mounted composite sibling's OPTIONAL `SiblingMount.setPaused`
 * (`ingest-siblings.ts`), AFTER the primary surface's own pause/resume
 * already ran — mirrors `exitActiveIngest`'s reverse-order dispose
 * fan-out (the same "one bad sibling never breaks the rest"
 * isolation: per-sibling try/catch, loud log on failure, never swallowed
 * silently). A sibling with no `setPaused` at all (the bare `default-react`
 * sibling, D-B1 — it has no loop to gate) is silently skipped via the
 * optional call — never an error, never a fabricated pause. A no-op (empty
 * `siblings`, or no live session at all) for every non-composite entry
 * path, unchanged.
 */
function fanOutSiblingPause(paused: boolean): void {
  const active = activeIngest();
  if (!active) return;
  for (const sibling of active.siblings) {
    try {
      sibling.setPaused?.(paused);
    } catch (err) {
      editorConsole.error(`Composite sibling setPaused(${paused}) failed: ${err}`, 'ingest');
    }
  }
}

/**
 * The DECLARED contract for whatever is ingested right now.
 *
 * The game runs in the editor's own realm and declares on the host window —
 * either from its own entry, or from the host-added module the manifest names
 * in `ingest.contractShim`, which the mount imports first.
 */
export function activeIngestContract(): VgaiGameContract | null {
  return readIngestGameContract();
}

export function getIngestPlayControl(): IngestPlayControl | null {
  const lifecycle = activeIngest()?.session.lifecycle;
  if (!lifecycle?.setPaused) return null;
  /** HOLD content time through the mount-normalized lifecycle capability. */
  const hold = () => {
    lifecycle.setPaused?.(true);
    fanOutSiblingPause(true);
    setIngestPlaying(false);
  };
  /** RELEASE through the exact same normalized capability that took the hold. */
  const release = () => {
    lifecycle.setPaused?.(false);
    fanOutSiblingPause(false);
    setIngestPlaying(true);
  };
  return {
    get playing() {
      return _ingestPlaying;
    },
    play() {
      // ▶ BRINGS THE GAME DOCUMENT TO THE FRONT. A boot-mounted ingest lands
      // in Edit on purpose (`ingest-boot-viewport.ts`), so without this the
      // one gesture that starts the game left the person on the authoring
      // Scene — for a root whose content exists only under its own loop, the
      // "No renderable content" card, with the game running unseen behind it
      // (walk 3, beat 19: `playState: "playing"`, `activeViewportTab: "edit"`,
      // one canvas in the page). `live-document.ts` owns that activation, and
      // going through it is also what writes the play tab the input gate
      // reads — so the game is drivable and not merely visible. A play-time
      // mount already did this for itself (`deferred-ingest-play.ts`).
      activateLiveDocument();
      // Late-constructed game clients must not re-defer: the flag records
      // that play already happened this session — and makes ▶-after-⏸ a
      // RESUME, so `lifecycle.start` fires at most once per mount.
      const w = window as unknown as { __vgaiIngestPlayed?: boolean };
      if (w.__vgaiIngestPlayed) return release();
      w.__vgaiIngestPlayed = true;
      lifecycle.start();
      // A mount ends HELD (see `ingestContentTimeForMode`), so the first ▶ is
      // ALSO the release of that hold — same path every later ▶ takes.
      release();
    },
    pause: hold,
    resume: release,
    canStep: !!lifecycle.step && (lifecycle.canStep?.() ?? true),
    step() {
      if (lifecycle.canStep?.() === false) return;
      lifecycle.step?.();
      setIngestPlaying(false);
    },
  };
}

/**
 * THE hold/release decision for an ingested game's content time — pure, so the
 * rule is checkable without a browser, a mount or a clock.
 *
 * The rule is the ontology's, not this lane's: LOADING CONSTRUCTS, PLAY RUNS
 * (ARCHITECTURE-CORE). Content time follows the editor's MODE and nothing else
 * — not whether a mount just finished, not how far a game got into its own
 * boot. A mount is simply the first moment this decision is evaluated, which is
 * why "mount in Edit" needs no case of its own.
 */
export function ingestContentTimeForMode(mode: 'edit' | 'play'): 'held' | 'released' {
  return mode === 'edit' ? 'held' : 'released';
}

/**
 * Apply {@link ingestContentTimeForMode} to the live session, through the play
 * control's OWN pause path — so a game that declares `lifecycle.pause` is held
 * by its own hand rather than by an outside-in loop gate that may not reach it.
 *
 * Only the HOLD half acts here, because only the hold half has a caller: ▶
 * (`play`/`resume` above) is the one thing that releases, and it is a user
 * action, never something a mode read may fabricate. Returns whether it held,
 * so a caller can log honestly rather than assume.
 */
export function holdIngestContentTimeForMode(mode: 'edit' | 'play'): boolean {
  if (ingestContentTimeForMode(mode) !== 'held') return false;
  const control = getIngestPlayControl();
  if (!control) return false;
  control.pause();
  return true;
}
