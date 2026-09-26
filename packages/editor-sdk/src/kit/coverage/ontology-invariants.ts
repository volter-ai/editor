/**
 * THE ONTOLOGY'S LIVE INVARIANTS, checked against the running session.
 *
 * ARCHITECTURE-CORE §Rules: "an invariant about what a running session shows or
 * does (Edit is static; a scene has one root; the viewport canvas is revealed; a
 * visible tab renders) is enforced by a STANDING SESSION WARNING through the
 * console-loudness pipeline — loud on every vgai command until the condition is
 * dead — never by prose alone." This module is the derivation half of that rule:
 * facts in, rows out, no globals and no I/O, so every transition is testable
 * with no browser.
 *
 * ## Three statuses, and why `unmeasured` is one of them
 *
 * A verdict is a measurement. Where the editor genuinely cannot see a fact
 * today, the row says `unmeasured` AND NAMES WHAT IS MISSING — it never
 * disappears and it never reports `ok`. That is the same rule the coverage rows
 * follow, and it is what keeps this from becoming a list that looks green
 * because half of it is blind. A row that goes quiet is how "ingested games
 * autoplay in Edit" sat recorded for months while every instrument read green.
 *
 * ## The vocabulary is pinned, like the coverage vocabulary
 *
 * {@link ONTOLOGY_INVARIANTS} is derived from a `Record` over
 * {@link OntologyInvariantId}, so an invariant added to the union without a
 * check does not compile. There is no way to have an id nothing checks, and no
 * way to check something the report does not list.
 */

/** The live invariants this session knows how to ask about. */
export type OntologyInvariantId =
  | 'edit-mode-static'
  | 'single-root-scene'
  | 'canvas-revealed'
  | 'visible-tab-fps-floor'
  | 'play-drew-a-frame';

export interface OntologyInvariantRow {
  readonly id: OntologyInvariantId;
  readonly status: 'ok' | 'violation' | 'unmeasured';
  /** What was measured, in the measurement's own terms. Always present. */
  readonly detail: string;
  /**
   * The condition in STABLE words — no measured numbers, no timestamps.
   *
   * `detail` carries the measurement and therefore CHANGES every sample
   * ("113.4fps", "119.8fps"), and the console ledger keys an entry on its
   * message: a warning built from `detail` mints a brand-new unresolved
   * condition every tick and buries the banner it was meant to serve (measured:
   * five distinct entries for one violation in twenty seconds). So the warning
   * is built from THIS, which is identical for as long as the condition holds —
   * repeats then sum into one counted row, which is the whole contract of the
   * ledger. The live number stays in `detail`, where `vgai status` re-derives it
   * on every read. Present only on a violation.
   */
  readonly cause?: string;
  /** What the violation costs the user. Present only on a violation. */
  readonly missing?: string;
  /** The named mechanism that closes it, or — on `unmeasured` — the fact that
   *  is missing and where it would come from. */
  readonly fix?: string;
}

/** One game loop the editor can enumerate, and whether it is advancing. */
export interface LoopFact {
  readonly name: string;
  readonly running: boolean;
}

/**
 * One DESIGN-TIME SURFACE and whether its CONTENT time moved.
 *
 * Edit-static is not a fact about the Scene view. Every surface riding the
 * shared `Object3DDocumentViewport`/`EditorViewport` stack — Asset Lab
 * documents, story turntables, 3D board exhibits, preview cards — is a place
 * content time can advance while the editor is in Edit, and one of them was
 * measured doing it (a GLB train animating in the Asset Lab). So the check
 * enumerates surfaces.
 *
 * CONTENT vs PRESENTATION is the whole distinction: a camera orbit, a turntable
 * and the editor's dressing are presentation and are legitimate; an animation
 * mixer, a `useFrame` clock or a simulation step is content and is not. Only the
 * surface can tell them apart, so it publishes its own content clock — and a
 * surface that publishes none reports `advanced: null` with the reason, which
 * the row renders as UNMEASURED naming that surface. Never silently Scene-only.
 *
 * AN ENGAGED TRANSPORT IS THE SANCTIONED ADVANCE (orchestrator ruling,
 * 2026-08-30). "Edit is static" was always about content running with NOTHING
 * HAVING PRESSED ▶ — the sentence the row's own origin note uses. A document's
 * animation/simulation transport is that press, so the invariant fires only
 * when content time advances with NO transport engaged. The code missed this
 * and stood violated for every frame of a rigged module document's playback:
 * the ▶ a human pressed reddened every `vgai` verb. The surface therefore
 * publishes `transportAdvances` beside its clock, and the row reads BOTH.
 * The negative case is untouched: an ingested game whose ticker runs with no
 * transport still violates, because it publishes no transport advance to point
 * at (`ingest/ingest-play-control.ts` holds it in Edit for exactly that reason).
 */
export interface DesignTimeSurfaceFact {
  readonly id: string;
  readonly label: string;
  /** `true`/`false` when the surface's content clock could be compared across a
   *  sample window; `null` when it publishes none. */
  readonly advanced: boolean | null;
  /** Why nothing could be compared, when `advanced` is `null`. */
  readonly unavailable?: string;
  /**
   * Whether an ENGAGED transport advanced this surface over the SAME window
   * `advanced` speaks for — the sanction. `false` when the surface publishes a
   * transport counter that did not move; absent when it publishes none at all
   * (a surface with no ▶ to press), which is the same verdict for this row:
   * unsanctioned. See `design-time-surfaces.ts` §THE TRANSPORT IS THE SANCTION.
   */
  readonly transportAdvanced?: boolean;
}

/**
 * Everything the checks read. Assembled by the caller from the live session
 * (`session-vitals.ts`), so this module imports no session state.
 *
 * A `null` field means the caller could not measure it — never "it is fine".
 */
export interface OntologyFacts {
  /** What the editor believes it is doing right now. */
  readonly mode: 'edit' | 'play';
  /**
   * Every game loop the editor can enumerate, with whether it is advancing.
   * The row NAMES the loops it checked, so a reader can see the scope of the
   * claim rather than take "static" on faith.
   */
  readonly loops: readonly LoopFact[] | null;
  /** Every live design-time surface, with whether its CONTENT time moved. `null`
   *  ⇒ nothing enumerated the surfaces at all. */
  readonly designTimeSurfaces: readonly DesignTimeSurfaceFact[] | null;
  /** The world ids of the `three`-surface roots this session presents at once. */
  readonly presentedThreeRoots: readonly string[] | null;
  /**
   * Why NO canvas in this session is presenting, in the measurement's own
   * words (`display: none`, a zero-size box), or `null` when at least one IS
   * revealed. `undefined` means no canvas was found to measure.
   *
   * "At least one" is the whole rule, and it is what stopped this row from
   * standing on healthy sessions: the derivation used to speak for a single
   * area-ranked canvas that could easily be one somebody hid on purpose while
   * the game rendered beside it. See `canvas-reveal.ts`.
   */
  readonly canvasHiddenBy: string | null | undefined;
  /**
   * Whether any hidden canvas is hidden by its OWN box or inline style, rather
   * than by an ancestor (the editor showing a different document) or a
   * stylesheet. `null` when nothing is hidden.
   *
   * This is what separates the defect from the ordinary case: with the
   * workspace on a non-canvas document every canvas is hidden and the user is
   * looking at exactly what they opened. See `canvas-reveal.ts`.
   */
  readonly canvasHidesItself: boolean | null;
  /** One line per hidden canvas — which, why, whose doing. Empty when none is
   *  hidden; `null` when nothing enumerated them. */
  readonly hiddenCanvases: readonly string[] | null;
  /** Frames the page produced in the sample window. */
  readonly framesProduced: number | null;
  readonly sampleWindowMs: number | null;
  readonly tabVisible: boolean;
  /** Whether a person can currently be waiting on direct manipulation. Browser
   *  automation renders for evidence, but its software-rendered frame cadence
   *  is not human interaction latency. Omitted defaults to true for callers
   *  constructing facts outside the live collector. */
  readonly directManipulationExpected?: boolean;
  /** Frames per second over the sample window, or `null` with a reason. */
  readonly fps: number | null;
  readonly fpsUnavailable: string | null;
  /** The live play session, or `null` when nothing is playing. */
  readonly play: {
    readonly startedMsAgo: number;
    readonly framesDrawn: number | null;
    readonly framesUnavailable: string | null;
  } | null;
}

/**
 * The floor a VISIBLE tab must render above. Not a performance target — a
 * liveness one: below this the editor is not a direct-manipulation tool any
 * more, which is the state the owner has profiled by hand more than once
 * (~1.6fps on a saturated main thread).
 */
export const VISIBLE_TAB_FPS_FLOOR = 10;

/** How long play may run without drawing before it is a violation rather than a
 *  slow start. Generous: a cold R3F world with assets to fetch is legitimately
 *  slow, and a false positive here trains readers to ignore the banner. */
export const PLAY_FIRST_FRAME_DEADLINE_MS = 5_000;

type Check = (facts: OntologyFacts) => Omit<OntologyInvariantRow, 'id'>;

function editModeStatic(facts: OntologyFacts): Omit<OntologyInvariantRow, 'id'> {
  if (facts.mode !== 'edit') {
    return {
      status: 'ok',
      detail: 'not in Edit mode — the invariant does not apply while playing',
    };
  }
  if (facts.loops === null) {
    return {
      status: 'unmeasured',
      detail: 'nothing enumerated this session’s game loops',
      fix: 'the session vitals collector must report a loop fact per live runtime (play, ingest, module)',
    };
  }
  const surfaces = facts.designTimeSurfaces;
  // AN ENGAGED TRANSPORT IS THE SANCTIONED ADVANCE (orchestrator ruling,
  // 2026-08-30). The row's own origin note is "nothing having pressed ▶": a
  // document's animation/simulation transport IS that press, so a surface
  // whose transport counter moved over the same window is doing exactly what
  // the transport exists to do. The code did not know that and fired on every
  // frame of a rigged module document's playback, which reddened every `vgai`
  // verb while a human watched the clip they had asked for. The violation is
  // content time advancing with NO transport engaged — and a surface that
  // publishes no transport counter (a preview card, a turntable) has no ▶ to
  // press, so any advance of its clock is still a violation.
  const advancing = [
    ...facts.loops.filter((loop) => loop.running).map((loop) => loop.name),
    ...(surfaces ?? [])
      .filter((surface) => surface.advanced === true && surface.transportAdvanced !== true)
      .map((surface) => `${surface.label} (design-time surface)`),
  ];
  const transported = (surfaces ?? []).filter(
    (surface) => surface.advanced === true && surface.transportAdvanced === true,
  );
  if (advancing.length > 0) {
    return {
      status: 'violation',
      detail: `Edit mode, but content time is advancing in ${advancing.length} place(s): ${advancing.join(', ')}`,
      cause: `content time is advancing while the editor is in Edit: ${[...advancing].sort().join(', ')}`,
      missing:
        'authoring is happening on top of moving content: the thing under the gizmo moves while ' +
        'you edit it, a pose you are reading is a frame of an animation rather than what the ' +
        'source says, and every other instrument reports a still editor',
      fix:
        'one time policy at the shared viewport stack — presentation (orbit, turntable, dressing) ' +
        'keeps running while CONTENT time (mixers, useFrame, simulation) is held at design time',
    };
  }
  // No violation. Say honestly how much of the session that claim covers: a
  // surface with no published content clock is UNMEASURED and named, never
  // folded into a green "Edit is static".
  const blind = (surfaces ?? []).filter((surface) => surface.advanced === null);
  const loopNames = facts.loops.map((loop) => loop.name).join(', ');
  if (surfaces === null) {
    return {
      status: 'unmeasured',
      detail: `${facts.loops.length} enumerated loop(s) stopped (${loopNames}), but nothing enumerated this session's design-time surfaces`,
      fix: 'the session vitals collector must enumerate the Object3DDocumentViewport stack’s live sessions',
    };
  }
  if (blind.length > 0) {
    return {
      status: 'unmeasured',
      detail:
        `${facts.loops.length} enumerated loop(s) stopped (${loopNames}), and ${
          surfaces.length - blind.length
        } design-time surface(s) still — but ${blind.length} publish no content clock: ` +
        blind
          .map((surface) => `${surface.label} (${surface.unavailable ?? 'no reason given'})`)
          .join(', '),
      fix: 'each design-time surface host must publish its own content clock (`Object3DDocumentSession.contentClock`) so this row can speak for it',
    };
  }
  // Say WHICH surfaces are running under a transport rather than reporting a
  // flat "all still": the claim this row makes is about unpressed content, and
  // a reader must be able to see that a document IS playing on purpose.
  const playing =
    transported.length === 0
      ? ''
      : `; ${transported.length} advancing under an engaged transport (${transported
          .map((surface) => surface.label)
          .join(', ')})`;
  return {
    status: 'ok',
    detail: `Edit is static — ${facts.loops.length} enumerated loop(s) stopped (${loopNames}), and ${surfaces.length} design-time surface(s) hold their content time${playing}`,
  };
}

function singleRootScene(facts: OntologyFacts): Omit<OntologyInvariantRow, 'id'> {
  if (facts.presentedThreeRoots === null) {
    return {
      status: 'unmeasured',
      detail: 'nothing enumerated which three roots this session presents',
      fix: 'the session vitals collector must read the mounted roots off the active authoring surface',
    };
  }
  if (facts.presentedThreeRoots.length <= 1) {
    return {
      status: 'ok',
      detail: `the scene presents ${facts.presentedThreeRoots.length} three root(s)`,
    };
  }
  return {
    status: 'violation',
    detail: `the scene presents ${facts.presentedThreeRoots.length} three roots at once: ${facts.presentedThreeRoots.join(', ')}`,
    cause: `the scene presents more than one three root: ${[...facts.presentedThreeRoots].sort().join(', ')}`,
    missing:
      'a scene has ONE root by the authoring ontology — scenes swap inside it. Two presented at ' +
      'once means selection, framing and the gizmo are working over a tree no single document owns',
    fix: 'declare one three root and swap SCENES inside it (ARCHITECTURE-CORE §Roots); a second world belongs behind its own document',
  };
}

function canvasRevealed(facts: OntologyFacts): Omit<OntologyInvariantRow, 'id'> {
  if (facts.canvasHiddenBy === undefined) {
    return {
      status: 'unmeasured',
      detail: 'no canvas was found to measure',
      fix: 'the session vitals collector must enumerate this session’s canvases before this can be checked',
    };
  }
  if (facts.framesProduced === null) {
    return {
      status: 'unmeasured',
      detail: 'nothing sampled whether frames are being produced',
      fix: 'the session vitals collector must run its frame sampler before this can be checked',
    };
  }
  if (facts.canvasHiddenBy === null) {
    return { status: 'ok', detail: 'this session presents a revealed canvas' };
  }
  if (facts.framesProduced === 0) {
    return {
      status: 'ok',
      detail: `every canvas is hidden (largest: ${facts.canvasHiddenBy}) and nothing is drawing — not the failsafe's case`,
    };
  }
  if (facts.canvasHidesItself === false) {
    return {
      status: 'ok',
      detail:
        `every canvas is hidden but none is hiding ITSELF — the workspace is showing a ` +
        `non-canvas document, which is what the user opened: ${(facts.hiddenCanvases ?? []).join('; ')}`,
    };
  }
  return {
    status: 'violation',
    detail:
      `${facts.framesProduced} frame(s) produced in ${facts.sampleWindowMs ?? 0}ms while every ` +
      `canvas is hidden and one hides ITSELF: ${(facts.hiddenCanvases ?? []).join('; ')}`,
    cause: `frames are being produced while every canvas is hidden and one hides itself (${facts.canvasHiddenBy})`,
    missing:
      'the session is burning frames onto a surface nobody can see — the user is looking at an ' +
      'empty viewport while every instrument reports a healthy, rendering session',
    fix: 'reveal the canvas as soon as it produces frames — the bounded failsafe in `coverage/canvas-reveal.ts` does it for inline hiding on the canvas itself and says so loudly; hiding from an ancestor or a stylesheet is its owner’s to undo',
  };
}

function visibleTabFpsFloor(facts: OntologyFacts): Omit<OntologyInvariantRow, 'id'> {
  if (facts.directManipulationExpected === false) {
    return {
      status: 'ok',
      detail:
        'browser automation is rendering evidence — no person is waiting on direct manipulation',
    };
  }
  if (!facts.tabVisible) {
    return { status: 'ok', detail: 'the tab is hidden — a hidden tab is not owed a frame rate' };
  }
  if (facts.fps === null) {
    return {
      status: 'unmeasured',
      detail: facts.fpsUnavailable ?? 'no frame-rate sample exists',
      fix: 'the session vitals collector must sample frame cadence while the tab is visible',
    };
  }
  if (facts.fps >= VISIBLE_TAB_FPS_FLOOR) {
    return { status: 'ok', detail: `visible tab rendering at ${facts.fps.toFixed(1)}fps` };
  }
  return {
    status: 'violation',
    detail: `visible tab rendering at ${facts.fps.toFixed(1)}fps, below the ${VISIBLE_TAB_FPS_FLOOR}fps floor`,
    cause: `the visible tab is rendering below the ${VISIBLE_TAB_FPS_FLOOR}fps floor`,
    missing:
      'the editor has stopped being a direct-manipulation tool: a drag, a click and a keystroke ' +
      'all land seconds after the user made them',
    fix: 'find the cost with the Profiler’s Overview (long-animation-frame attribution) — main-thread saturation and GPU/compositor cost are separate hunts',
  };
}

function playDrewAFrame(facts: OntologyFacts): Omit<OntologyInvariantRow, 'id'> {
  if (facts.play === null) {
    return { status: 'ok', detail: 'nothing is playing — the invariant does not apply' };
  }
  // A HIDDEN TAB DRAWS NOTHING BY DESIGN (the engine's idle throttle hidden-
  // pauses the loop the moment play starts), so "play drew no frame" is the
  // expected, deliberate state there — not a defect. Firing here would put a
  // permanent false warning on every backgrounded agent session, and a banner
  // that cries wolf is a banner nobody reads.
  if (!facts.tabVisible) {
    return {
      status: 'ok',
      detail: 'the tab is hidden — the engine hidden-pauses the loop, so no frame is owed',
    };
  }
  if (facts.play.framesDrawn === null) {
    return {
      status: 'unmeasured',
      detail:
        facts.play.framesUnavailable ??
        'the play session reports no frame count, so nothing can say whether it drew',
      fix: 'the play session’s render loop must expose a frame count (its profiler source carries one only while telemetry is enabled)',
    };
  }
  if (facts.play.framesDrawn > 0) {
    return { status: 'ok', detail: `play has drawn ${facts.play.framesDrawn} frame(s)` };
  }
  if (facts.play.startedMsAgo < PLAY_FIRST_FRAME_DEADLINE_MS) {
    return {
      status: 'ok',
      detail: `play started ${facts.play.startedMsAgo}ms ago and has not drawn yet — inside the ${PLAY_FIRST_FRAME_DEADLINE_MS}ms deadline`,
    };
  }
  return {
    status: 'violation',
    detail: `play started ${facts.play.startedMsAgo}ms ago and has drawn no frame (deadline ${PLAY_FIRST_FRAME_DEADLINE_MS}ms)`,
    cause: `play started and no frame has drawn within the ${PLAY_FIRST_FRAME_DEADLINE_MS}ms deadline`,
    missing:
      'the user pressed ▶ and the game is not running: the viewport shows whatever was there ' +
      'before, and every other instrument reports a live play session',
    fix: 'find why the run loop never rendered — the console’s own errors from the play session are the first read',
  };
}

/** The pin: an id with no check does not compile, and a check with no id cannot
 *  be added. */
const CHECKS: Readonly<Record<OntologyInvariantId, Check>> = {
  'edit-mode-static': editModeStatic,
  'single-root-scene': singleRootScene,
  'canvas-revealed': canvasRevealed,
  'visible-tab-fps-floor': visibleTabFpsFloor,
  'play-drew-a-frame': playDrewAFrame,
};

/** Report order — fixed, so two reports of the same session are diffable. */
export const ONTOLOGY_INVARIANTS: readonly OntologyInvariantId[] = Object.keys(
  CHECKS,
) as OntologyInvariantId[];

/** THE derivation. One row per invariant, always — including the ones this
 *  session cannot measure. */
export function deriveOntologyInvariants(facts: OntologyFacts): readonly OntologyInvariantRow[] {
  return ONTOLOGY_INVARIANTS.map((id) => ({ id, ...CHECKS[id](facts) }));
}

/**
 * The warning text for one violated invariant, in the same shape the coverage
 * blocks use — a headline naming the invariant, then what it costs and what
 * closes it. `null` for anything that is not a violation: `ok` is silence and
 * `unmeasured` is a status the status facet carries, not a warning (warning
 * about a fact we chose not to collect would train readers to ignore the
 * banner, and the row is already visible where it matters).
 */
export function formatInvariantWarning(row: OntologyInvariantRow): string | null {
  if (row.status !== 'violation') return null;
  // `cause`, never `detail` — see `OntologyInvariantRow.cause` for why a
  // warning built from a live measurement destroys the ledger it feeds.
  const lines = [`invariant "${row.id}" VIOLATED — ${row.cause ?? row.id}`];
  if (row.missing) lines.push(`      cost: ${row.missing}`);
  if (row.fix) lines.push(`      fix: ${row.fix}`);
  return lines.join('\n');
}
