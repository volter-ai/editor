/**
 * THE EDITOR WATCHES ITS OWN VITALS — the live half of
 * `coverage/ontology-invariants.ts`.
 *
 * It reads the session's own singletons, hands the facts to the pure
 * derivation, and pushes every violation into `editorConsole` as a warning
 * sourced `invariant`. That is the whole integration: the console sync already
 * forwards every warning to the server's unresolved-console ledger, so an
 * ontology violation becomes a STANDING condition that rides the loudness
 * banner on every `vgai` command until it stops recurring or somebody acks it
 * by name. No new transport, no new door.
 *
 * ## What is measured, and what is honestly not
 *
 * Every fact here is read off something that already exists:
 *
 *  - **loops** — the three runtimes the editor can enumerate (play, module,
 *    ingest). The row names them, so the scope of "Edit is static" is visible
 *    rather than implied.
 *  - **presented three roots** — the active authoring surface's own children
 *    (`authoring/mounted-root-subjects.ts`), which is what the hierarchy and
 *    the gizmo actually work over.
 *  - **frame cadence** — a rAF sampler owned by this module. Deliberately not
 *    the profiler's fps: the profiler measures the REGISTERED loop's callback,
 *    only exists while something registered one (play), and reads ~1ms while
 *    the tab crawls at 1.6fps because the budget went somewhere it cannot see.
 *    The question "is this visible tab still a direct-manipulation tool" is a
 *    question about the browser's frame cadence, and rAF is the instrument that
 *    answers it. One callback per frame, no allocation.
 *  - **play frames** — `PerformanceFrame.id`, a monotonic counter, off whatever
 *    render loop registered itself. Where no loop registered or its profiler is
 *    recording nothing, the fact is `null` and the row says UNMEASURED with
 *    that reason — never `ok`.
 */

import { getAuthoringOverride } from '../authoring/active-adapter';
import { mountedRootSubjects } from '../authoring/mounted-root-subjects';
import { editorConsole } from '../editor-console';
import { editorIsPlaying } from '../editor-session-mode';
import { liveSessions } from '@volter/editor-sdk/kit/live-session-registry';
import { allPerformanceSources } from '../performance-sources';
import {
  anyCanvasHidesItself,
  type CanvasVisibilityFact,
  decideRevealFailsafe,
  hiddenCanvasBreakdown,
  presentingCanvasHiddenBy,
} from './canvas-reveal';
import { allDesignTimeSurfaces } from './design-time-surfaces';
import {
  type DesignTimeSurfaceFact,
  deriveOntologyInvariants,
  formatInvariantWarning,
  type OntologyFacts,
  type OntologyInvariantRow,
} from './ontology-invariants';

/**
 * THE SESSION'S PERIODIC SAMPLE, for anyone else who needs one.
 *
 * Published as `host.session.onSample` (`@volter/editor-sdk/host`). A lane with
 * a periodic derivation of its own — the capability-coverage union is the
 * first, and used to be a direct call in the tick below — subscribes here
 * instead of starting a second interval, so the session is looked at once per
 * cadence and every answer describes the same instant. Listeners run FIRST in
 * the pass, which is where the coverage union sat when it was the host's.
 *
 * A listener that throws is not allowed to end the host's own vitals: the
 * whole point of this watcher is that it cannot be turned off.
 */
const _sampleListeners = new Set<() => void>();

export function onSessionSample(fn: () => void): () => void {
  _sampleListeners.add(fn);
  return () => {
    _sampleListeners.delete(fn);
  };
}

function fireSessionSample(): void {
  for (const fn of [..._sampleListeners]) {
    try {
      fn();
    } catch (error) {
      editorConsole.error(`a session-sample subscriber threw: ${String(error)}`, 'invariant');
    }
  }
}

/** How often the vitals are derived and reported. Long enough that the check
 *  itself is free, short enough that a violation reaches the next `vgai`
 *  command a human would run. */
const SAMPLE_INTERVAL_MS = 5_000;

/** The rAF cadence sampler's window. One sample per frame, reset each interval. */
interface FrameSample {
  frames: number;
  since: number;
}

let _sample: FrameSample = { frames: 0, since: 0 };
let _rafHandle: number | null = null;
let _timer: ReturnType<typeof setInterval> | null = null;
let _playStartedAt: number | null = null;
let _lastRows: readonly OntologyInvariantRow[] = [];
const _pendingInvariantViolations = new Map<string, number>();

/** Why the canvas is not visible, in the measurement's own words, or `null`
 *  when it is. Reads the same three ways a canvas actually disappears in this
 *  editor: taken out of layout, styled invisible, or collapsed to nothing. */
function canvasHiddenReason(canvas: HTMLCanvasElement): string | null {
  const style = window.getComputedStyle(canvas);
  if (style.display === 'none') return 'display: none';
  if (style.visibility === 'hidden') return 'visibility: hidden';
  if (Number.parseFloat(style.opacity || '1') === 0) return 'opacity: 0';
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return 'zero-size box';
  return null;
}

/**
 * The editor's OWN viewport canvas — the one whose visibility has a declared
 * owner (`the world root's stage`'s `opacity: threejsSurface ? 1 : 0`, decided by
 * `isThreejsSurfaceVisible`). Named here so the reveal failsafe can leave it
 * alone; see `canvas-reveal.ts`'s header.
 */
const EDITOR_VIEWPORT_CANVAS_TESTID = 'editor-canvas';

/** Which of the canvas' OWN inline style properties is what hides it, if any.
 *  Read off the inline `style` attribute rather than the computed value: a
 *  computed `visibility: hidden` inherited from an ancestor is somebody
 *  else's decision and must never be cleared here. */
function inlineHidingOf(canvas: HTMLCanvasElement): 'opacity' | 'visibility' | 'display' | null {
  const inline = canvas.style;
  if (inline.display === 'none') return 'display';
  if (inline.visibility === 'hidden') return 'visibility';
  if (inline.opacity !== '' && Number.parseFloat(inline.opacity) === 0) return 'opacity';
  return null;
}

/** Every canvas on the page as `canvas-reveal.ts` reads them. */
function canvasFacts(): readonly CanvasVisibilityFact[] {
  const canvases = [...document.querySelectorAll('canvas')];
  return canvases.map((canvas, index): CanvasVisibilityFact => {
    const testId = canvas.getAttribute('data-testid');
    const rect = canvas.getBoundingClientRect();
    return {
      label: testId ?? (canvas.className || `canvas #${index}`),
      area: Math.max(0, rect.width) * Math.max(0, rect.height),
      hiddenBy: canvasHiddenReason(canvas),
      inlineHiding: inlineHidingOf(canvas),
      // Monaco owns the visibility of its minimap and overview ruler. A hidden
      // ruler is not a stalled modeling viewport and must never be revealed by us.
      failsafeEligible: testId !== EDITOR_VIEWPORT_CANVAS_TESTID && !canvas.closest('.monaco-editor'),
    };
  });
}

/** The monotonic frame id of whichever render loop is registered, or a reason
 *  nothing can be said. */
function playFrameFacts(): { framesDrawn: number | null; framesUnavailable: string | null } {
  const sources = allPerformanceSources();
  if (sources.length === 0) {
    return {
      framesDrawn: null,
      framesUnavailable:
        'no render loop registered a performance source, so nothing counts this session’s frames',
    };
  }
  let best: number | null = null;
  for (const source of sources) {
    const snapshot = source.profiler.getSnapshot();
    const latest = snapshot.frames.at(-1);
    if (latest) best = Math.max(best ?? 0, latest.id);
  }
  if (best === null) {
    return {
      framesDrawn: null,
      framesUnavailable:
        'the registered render loop records no frames (its profiler has neither profiling nor telemetry enabled)',
    };
  }
  return { framesDrawn: best, framesUnavailable: null };
}

/**
 * The last content-clock reading per design-time surface, so the next sample can
 * say whether it MOVED. A clock's absolute value means nothing on its own — the
 * question is only ever "did it advance since we last looked", and comparing two
 * readings is what makes camera orbit (which never touches this) irrelevant.
 */
const _lastContentClock = new Map<string, number>();

/**
 * The last TRANSPORT-ADVANCE reading per surface, sampled at the same instants
 * as the clock above so the two answer for the same window: "content time
 * moved" and "an engaged transport is what moved it"
 * (`design-time-surfaces.ts` §THE TRANSPORT IS THE SANCTION).
 */
const _lastTransportAdvances = new Map<string, number>();

/**
 * PER SURFACE, not per Scene. Every live design-time surface — Asset Lab
 * documents, story turntables, board exhibits, preview cards
 * (`coverage/design-time-surfaces.ts`) — is asked for its own content clock, and
 * a surface that publishes none is reported by name with that reason rather than
 * assumed still.
 */
function designTimeSurfaceFacts(): readonly DesignTimeSurfaceFact[] {
  const live = allDesignTimeSurfaces();
  const seen = new Set<string>();
  const facts = live.map((surface): DesignTimeSurfaceFact => {
    const { id, label } = surface;
    seen.add(id);
    // Sampled BEFORE the clock and carried through every return, so the
    // transport reading and the clock reading always describe the same window.
    let transportNow: number | null = null;
    try {
      transportNow = surface.transportAdvances?.() ?? null;
    } catch {
      transportNow = null;
    }
    const transportPrevious = _lastTransportAdvances.get(id);
    if (transportNow === null) _lastTransportAdvances.delete(id);
    else _lastTransportAdvances.set(id, transportNow);
    const transportAdvanced =
      transportNow === null || transportPrevious === undefined
        ? {}
        : { transportAdvanced: transportNow !== transportPrevious };
    let reading: number | null;
    try {
      reading = surface.contentClock();
    } catch (error) {
      _lastContentClock.delete(id);
      return {
        id,
        label,
        advanced: null,
        unavailable: `its content clock threw: ${String(error)}`,
        ...transportAdvanced,
      };
    }
    if (reading === null) {
      _lastContentClock.delete(id);
      return {
        id,
        label,
        advanced: null,
        unavailable: 'its content clock is temporarily unavailable',
        ...transportAdvanced,
      };
    }
    const now = reading;
    const previous = _lastContentClock.get(id);
    _lastContentClock.set(id, now);
    if (previous === undefined) {
      return {
        id,
        label,
        advanced: null,
        unavailable: 'first reading — nothing to compare it against yet',
        ...transportAdvanced,
      };
    }
    return { id, label, advanced: now !== previous, ...transportAdvanced };
  });
  for (const id of [..._lastContentClock.keys()]) if (!seen.has(id)) _lastContentClock.delete(id);
  for (const id of [..._lastTransportAdvances.keys()]) {
    if (!seen.has(id)) _lastTransportAdvances.delete(id);
  }
  return facts;
}

/** Assemble everything the checks read, from the live session. */
export function collectOntologyFacts(now: number = Date.now()): OntologyFacts {
  const playing = editorIsPlaying();
  const elapsed = _sample.since === 0 ? 0 : now - _sample.since;
  const frames = _sample.frames;
  const fps = elapsed > 0 && frames > 0 ? (frames * 1000) / elapsed : null;
  const play = playing
    ? {
        startedMsAgo: _playStartedAt === null ? 0 : now - _playStartedAt,
        ...playFrameFacts(),
      }
    : null;
  return {
    mode: playing ? 'play' : 'edit',
    loops: [
      ...liveSessions().map((session) => ({
        name: `${session.id} session`,
        running: session.mounted(),
      })),
      ...liveSessions().map((session) => ({
        name: `${session.id} playing`,
        running: session.playing(),
      })),
    ],
    designTimeSurfaces: designTimeSurfaceFacts(),
    presentedThreeRoots: getAuthoringOverride()
      ? mountedRootSubjects()
          .filter((root) => root.surface === 'three')
          .map((root) => root.worldId)
      : null,
    ...(() => {
      const canvases = canvasFacts();
      return {
        canvasHiddenBy: presentingCanvasHiddenBy(canvases),
        canvasHidesItself: anyCanvasHidesItself(canvases),
        hiddenCanvases: hiddenCanvasBreakdown(canvases),
      };
    })(),
    framesProduced: _sample.since === 0 ? null : frames,
    sampleWindowMs: _sample.since === 0 ? null : elapsed,
    tabVisible: !document.hidden,
    directManipulationExpected: navigator.webdriver !== true,
    fps,
    fpsUnavailable:
      fps === null
        ? _sample.since === 0
          ? 'the frame sampler has not opened a window yet'
          : 'no frame was produced in the sample window'
        : null,
    play,
  };
}

/** The rows as the status facet serves them — always the full set, re-derived
 *  on read so a reader never gets a verdict older than the question. */
export function ontologyInvariantFacet(): readonly OntologyInvariantRow[] {
  return deriveOntologyInvariants(collectOntologyFacts());
}

/** The rows from the last reporting pass — what the console has already said,
 *  for a caller that wants the reported set rather than a fresh derivation. */
export function lastReportedInvariants(): readonly OntologyInvariantRow[] {
  return _lastRows;
}

/** When the all-hidden-while-drawing condition was FIRST seen, or `null` while
 *  the session has a presenting canvas. The failsafe's bounded window is
 *  measured from here, so a mount that is hidden for a moment never trips it. */
let _allHiddenSince: number | null = null;
/** Canvases this page-load already force-revealed. A failsafe is an emergency,
 *  never a policy: once each, then it stops (see `canvas-reveal.ts`). */
const _forceRevealed = new WeakSet<HTMLCanvasElement>();

/**
 * Fire the reveal when nothing is presenting and frames are arriving anyway.
 *
 * The write is the narrowest one that can work: clear the ONE inline property
 * on the canvas itself that the decision named. Everything else about how the
 * canvas got hidden is left exactly as it was.
 */
function runRevealFailsafe(facts: readonly CanvasVisibilityFact[], now: number): void {
  const presenting = presentingCanvasHiddenBy(facts);
  if (presenting === null || presenting === undefined) {
    _allHiddenSince = null;
    return;
  }
  if (_allHiddenSince === null) {
    _allHiddenSince = now;
    return;
  }
  const decision = decideRevealFailsafe({
    canvases: facts,
    framesProduced: _sample.frames,
    hiddenForMs: now - _allHiddenSince,
  });
  if (!decision.fire) return;
  const canvas = [...document.querySelectorAll('canvas')].find(
    (element) =>
      (element.getAttribute('data-testid') ?? element.className) === decision.target.label,
  );
  if (!canvas || _forceRevealed.has(canvas)) return;
  _forceRevealed.add(canvas);
  if (decision.target.inlineHiding === 'display') canvas.style.removeProperty('display');
  if (decision.target.inlineHiding === 'visibility') canvas.style.removeProperty('visibility');
  if (decision.target.inlineHiding === 'opacity') canvas.style.removeProperty('opacity');
  editorConsole.error(decision.ledger, 'invariant');
}

/**
 * Derive once and say every violation out loud.
 *
 * `editorConsole` collapses consecutive identical messages onto one entry and
 * the server ledger SUMS the repeats, so a condition that keeps holding stays
 * one loud, counted row rather than a flood — which is exactly why this can be
 * a plain periodic check with no dedupe of its own.
 */
export function reportOntologyInvariants(): readonly OntologyInvariantRow[] {
  const rows = ontologyInvariantFacet();
  _lastRows = rows;
  for (const row of rows) {
    const warning = formatInvariantWarning(row);
    if (!warning) {
      _pendingInvariantViolations.delete(row.id);
      continue;
    }
    // A build, source remount, or Doctor capture can legitimately occupy two
    // five-second main-thread windows while the visible editor is otherwise
    // responsive. The FPS floor describes a stopped direct-manipulation tool,
    // so require the condition to survive a third consecutive sample before
    // filing a permanent ledger warning. The status facet remains immediate;
    // only the irreversible console filing is stabilized.
    if (row.id === 'visible-tab-fps-floor') {
      const samples = (_pendingInvariantViolations.get(row.id) ?? 0) + 1;
      _pendingInvariantViolations.set(row.id, samples);
      if (samples < 3) continue;
    }
    editorConsole.warn(warning, 'invariant');
  }
  return rows;
}

/**
 * Start watching. Idempotent, and it runs on EVERY realm.
 *
 * This used to bail on a host with no server ledger "to be loud into". That
 * names a mechanism this watcher does not use. Nothing on this timer talks to
 * a server:
 *
 *  - {@link runRevealFailsafe} is a REPAIR, not a report — it clears the one
 *    inline property hiding a canvas. Gating it meant a blank hosted viewport
 *    was the one viewport that could never self-heal, which is precisely the
 *    realm where no `vgai` command can be run to diagnose it.
 *  - {@link reportOntologyInvariants} and every {@link onSessionSample}
 *    subscriber derive from in-memory registries and speak through
 *    `editorConsole`, an in-page store read by `useSyncExternalStore`. It
 *    renders in the editor's own Console on every realm, hosted included.
 *
 * The half that genuinely needs a Node host is the server-ledger PUSH, and it
 * is gated where it lives (`console-sync.ts`'s `installConsoleSync`). One
 * mechanism, one gate — not a second, wider gate on the watcher that merely
 * shares a sentence with it.
 *
 * Returns the teardown so a test or a shutdown path can end it; the editor
 * itself never stops watching, because a vitals check that can be turned off is
 * a vitals check that will be off when it matters.
 */
export function installSessionVitals(): () => void {
  if (_timer !== null) return stopSessionVitals;
  _sample = { frames: 0, since: Date.now() };
  const tick = (): void => {
    _sample.frames++;
    _rafHandle = requestAnimationFrame(tick);
  };
  _rafHandle = requestAnimationFrame(tick);
  _timer = setInterval(() => {
    const playing = editorIsPlaying();
    if (playing && _playStartedAt === null) _playStartedAt = Date.now();
    if (!playing) _playStartedAt = null;
    // EVERY periodic derivation about this session runs on THIS pass, the
    // host's and a lane's alike. The capability-coverage union used to be a
    // direct call here; it is `@vgai/game`'s now and subscribes through
    // {@link onSessionSample}, which is why the door exists at all: one
    // session, one cadence, one instant — a package timer beside this one
    // would sample the same session a fraction of a second later and publish
    // a second answer for one moment.
    fireSessionSample();
    // FIRE before reporting: the failsafe's whole point is that the row it
    // would otherwise print describes a blank viewport the editor could have
    // fixed. It runs on the same sample the row is derived from, so a fired
    // reveal shows up as `ok` in the very next pass and as a loud ledger error
    // in this one.
    runRevealFailsafe(canvasFacts(), Date.now());
    reportOntologyInvariants();
    _sample = { frames: 0, since: Date.now() };
  }, SAMPLE_INTERVAL_MS);
  return stopSessionVitals;
}

/**
 * Drop everything the vitals accumulated FOR THE PROJECT THAT JUST CLOSED,
 * without stopping the watcher (the editor never stops watching — see
 * {@link installSessionVitals}). Registered with `onProjectSessionEnd`.
 *
 * Every one of these is a claim about a specific project's session: the last
 * invariant rows, the consecutive-violation counters that decide when a row is
 * reported, the per-surface content-clock readings that decide whether a
 * surface MOVED, and the play start time. Carried into the next project they
 * become measurements attributed to a session that never made them — a
 * violation counter two samples deep would fire on the new project's first
 * sample.
 */
export function resetSessionVitalsForNewProject(): void {
  _sample = { frames: 0, since: _timer === null ? 0 : Date.now() };
  _playStartedAt = null;
  _allHiddenSince = null;
  _lastRows = [];
  _pendingInvariantViolations.clear();
  _lastContentClock.clear();
}

export function stopSessionVitals(): void {
  if (_rafHandle !== null) cancelAnimationFrame(_rafHandle);
  if (_timer !== null) clearInterval(_timer);
  _rafHandle = null;
  _timer = null;
  _sample = { frames: 0, since: 0 };
  _playStartedAt = null;
  _allHiddenSince = null;
  _pendingInvariantViolations.clear();
}
