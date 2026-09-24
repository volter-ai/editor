/**
 * Boot routing — the FTUE design's §5 precedence ladder (unit G5, decision
 * FT-7).
 *
 * Which surface does launching the editor land on? The design fixes the order:
 *
 *   1. An EXPLICIT target always wins, and it is always the SESSION —
 *      `vgai edit <path>` / `VGAI_PROJECT` / the project browser all re-root
 *      the server, and the client asks it (rung 1b below). The hub never
 *      renders. (Already true before G5; preserved here as the first rung so
 *      the whole ladder reads in one place.)
 *   2. REOPEN-LAST, when the user has opted in — the analog of Unreal's
 *      "Always load last project on startup" checkbox in the Project Browser
 *      corner. Default OFF: a launcher that silently swallows its own front
 *      door on first launch is worse than one extra click.
 *   3. Otherwise the HUB — which renders recents-first for a returning user and
 *      gallery-forward when recents are empty (that split is the hub's own,
 *      keyed off the same emptiness this module reports, not a separate flag).
 *
 * The ESCAPE HATCH is part of the contract, not a nicety: `?hub=1` forces the
 * hub even with reopen-last enabled, and a project that fails to open must fall
 * back to the hub rather than trapping the user in a boot loop. Unreal behaves
 * the same way — the browser reappears when the last project cannot load. The
 * failure half lives at the call site (it already routes open errors to the hub
 * via `startupFailure`); this module owns the decision that precedes it.
 *
 * Kept as a PURE function on purpose. Boot order is the kind of thing that is
 * miserable to prove through a real browser and trivial to prove as data in,
 * decision out — which also keeps it off the e2e suite, per the repo's
 * pillars-only policy.
 */

import { commandLine } from './product-command';
import { ProjectCompatibilityError } from '@volter/editor-sdk/session/editor-compatibility';

/** The minimum a recents entry must carry for routing. The real
 *  `RecentProject` (editor-api.ts) carries more; routing needs only the path,
 *  and narrowing the input keeps this module free of transport types. */
export interface BootRoutingRecent {
  path: string;
}

export interface BootRoutingInput {
  /** The project the launch named, already resolved by the caller: the
   *  session's own. Null when the launch named no project. */
  explicitTarget: string | null;
  /** `?hub=1` was present: the user explicitly asked for the front door. */
  hubRequested: boolean;
  /** The persisted, default-off "Reopen last project on launch" preference. */
  reopenLastEnabled: boolean;
  /** Recents, most-recent-first — the same order the launcher renders. */
  recents: readonly BootRoutingRecent[];
}

export type BootTarget =
  | { kind: 'explicit'; path: string }
  | { kind: 'reopen-last'; path: string }
  | { kind: 'hub'; firstRun: boolean };

/**
 * Resolve where a launch lands. See the module docstring for the ladder.
 *
 * `firstRun` on the hub result is the design's new-vs-returning signal (§7):
 * emptiness of the recents list, deliberately NOT an account, a flag, or
 * telemetry — it degrades gracefully across machines and clean checkouts, and
 * it is the same signal all three reference engines effectively key off.
 */
export function resolveBootTarget(input: BootRoutingInput): BootTarget {
  if (input.explicitTarget) {
    return { kind: 'explicit', path: input.explicitTarget };
  }

  const firstRun = input.recents.length === 0;

  // `?hub=1` outranks the preference — that is the whole point of an escape
  // hatch. Checked before reopen-last, never after.
  if (!input.hubRequested && input.reopenLastEnabled) {
    const mostRecent = input.recents[0];
    // Opted in but nothing to reopen (fresh machine, or every remembered
    // project has since been deleted — `loadRecentProjects` drops those) is
    // not an error state: it is simply a first run.
    if (mostRecent) return { kind: 'reopen-last', path: mostRecent.path };
  }

  return { kind: 'hub', firstRun };
}

/**
 * Rung 1b — what the SERVER is serving.
 *
 * A dev server started for a project knows exactly which project that is, so a
 * browser hitting its bare origin must land in THAT project. The launcher is
 * legitimate for one reason only: the server answered that it has no project
 * open. Everything else — an unreachable/failed `/__editor/project`, a
 * malformed answer, a server that IS serving a project whose manifest it could
 * not read — is "could not determine", and reading that as "no project" is what
 * dropped a project-serving session's tab onto the hub while `vgai status` was
 * still naming the project on that very port.
 *
 * Two failure shapes, kept apart because their remedies are:
 * - `'unreadable'` — the server named the project it serves AND why it could
 *   not describe it (a broken `vgai.project.json`, typically). Nothing is
 *   flaky about it; retrying is a waste and the hub is a lie. Fail loudly,
 *   naming the path and the reason.
 * - `'unknown'`    — the ask itself failed (server mid-restart, a request lost
 *   under a cold Vite boot's connection pressure). Genuinely transient, so
 *   retry a bounded number of times before failing loudly.
 */
export type ServerProjectProbeStatus = 'project' | 'none' | 'unreadable' | 'unknown';

export interface ServerProjectBootInput {
  status: ServerProjectProbeStatus;
  /** 1-based attempt number for this boot. */
  attempt: number;
  /** How many probe attempts a boot may spend before giving up. */
  maxAttempts: number;
}

export type ServerProjectBootAction =
  /** The server named a project — open it. */
  | 'open'
  /** The server has no project: fall through to reopen-last, then the hub. */
  | 'continue-ladder'
  /** Transient; ask again. */
  | 'retry'
  /** Report loudly. NEVER the hub — the hub would claim a fact we don't have. */
  | 'fail';

export function decideServerProjectBoot(input: ServerProjectBootInput): ServerProjectBootAction {
  switch (input.status) {
    case 'project':
      return 'open';
    case 'none':
      return 'continue-ladder';
    case 'unreadable':
      return 'fail';
    case 'unknown':
      return input.attempt < input.maxAttempts ? 'retry' : 'fail';
  }
}

/**
 * The failure half of the same rung — what the boot surface must SAY.
 *
 * `decideServerProjectBoot` returns `'fail'`, and the residual measured after
 * that fix was where the failure landed: the editor rendered the LAUNCHER with
 * a banner over it, so a loud unreadable-manifest throw still looked like a
 * fresh "What do you want to do?" to a human — or to an agent screenshotting
 * the tab. Rendering is AppRoot's (`StartupErrorScreen`); this is the pure
 * shaping of the two facts that surface must name: the project the server IS
 * serving, and the server's own error string.
 */
export type ServerProjectFailure =
  | { status: 'unreadable'; path: string; error: string }
  | { status: 'unknown'; error: string };

export interface ServerProjectFailureReport {
  /** Heading for the error surface. Never the launcher's wording. */
  title: string;
  /** The project the server named, or null when it could not be asked. */
  projectPath: string | null;
  /** The server's own error string, verbatim — never paraphrased. */
  detail: string;
  /** One line naming both facts; used as the thrown Error's message. */
  summary: string;
  /** Whether asking again could plausibly help (server mid-restart). */
  retryable: boolean;
}

export function describeServerProjectFailure(
  failure: ServerProjectFailure,
): ServerProjectFailureReport {
  if (failure.status === 'unreadable') {
    return {
      title: 'This project could not be read',
      projectPath: failure.path,
      detail: failure.error,
      summary: `The editor server is serving ${failure.path}, but could not read its project: ${failure.error}`,
      // Nothing is flaky about a broken manifest: the same ask returns the
      // same answer until a file changes. Retry is still OFFERED (the fix is
      // an edit away, and re-asking is how you confirm it) — this flag says
      // the failure is not transient, not that the button is useless.
      retryable: false,
    };
  }
  return {
    title: 'Could not reach the editor server',
    projectPath: null,
    detail: failure.error,
    summary:
      `Could not ask the editor server which project it is serving (${failure.error}). ` +
      'The server may still be starting — retry in a moment.',
    retryable: true,
  };
}

/**
 * A boot failure carrying its report. `message` is the same single line the
 * pre-report code threw, so every caller that only reads the message is
 * unchanged; the surface that can do better reads `report`.
 */
export class ServerProjectDetectionError extends Error {
  constructor(readonly report: ServerProjectFailureReport) {
    super(report.summary);
    this.name = 'ServerProjectDetectionError';
  }
}

/**
 * A detection attempt that ran out of patience rather than getting an answer.
 *
 * Its own class, not a message, because the recovery decision below reads the
 * SHAPE: "we did not get an answer yet" and "the server answered, badly" have
 * opposite remedies, and telling them apart by string is how a deadline
 * silently becomes a verdict.
 */
export class ProjectDetectionTimeoutError extends Error {
  constructor(readonly waitedMs: number) {
    super(
      `Project detection has not answered in ${Math.round(waitedMs / 1000)}s. ` +
        'The editor server may still be starting.',
    );
    this.name = 'ProjectDetectionTimeoutError';
  }
}

/**
 * What to do when project detection FAILED — keep asking, or stop and say so.
 *
 * The measured defect (2026-08-10): the detection deadline was calibrated on
 * the warm case (a pair of local fetches, milliseconds), and on the FIRST boot
 * of a fresh checkout — where Vite transforms the editor graph cold — it
 * legitimately elapsed. The elapsed deadline was then promoted to a VERDICT: a
 * terminal error screen with no listener and no state reports, on a tab whose
 * heartbeat, echo and socket were all perfectly healthy. A deadline decorrelates
 * from the truth exactly on the cold case it was never measured against, so a
 * deadline may pace a retry and must never end one.
 *
 * The split, therefore, is on whether the server gave a DEFINITE answer. Three
 * patient shapes, and they are the WHOLE list — each one named against the door
 * it actually comes through, because the first cut of this function got that
 * wrong (see below):
 * - `ProjectDetectionTimeoutError` — the ask ran out of patience.
 * - `ServerProjectDetectionError` with `report.retryable` — the PROJECT probe
 *   (`GET /__editor/project`) could not be asked.
 * - `ProjectCompatibilityError` with `recovery.kind === 'retry-editor'` — the
 *   COMPATIBILITY handshake could not be asked. `detectServerProject` runs that
 *   handshake BEFORE the probe loop, so on a refused/reset socket or a 5xx this
 *   is the shape that actually reaches this function, in milliseconds, and the
 *   probe's own retryable report never gets a chance to exist. The first cut
 *   dropped it into the default branch and shipped a comment claiming a
 *   mid-restart server was patient — it was terminal, and the unit test missed
 *   it by constructing the retryable report by hand instead of driving a failing
 *   fetch. The recovery kind is the server's own word for "I could not be
 *   reached, try again" (`editorServerUnavailableError`), which is precisely
 *   this branch's question.
 *
 * Everything else is a definite answer and stays terminal: an unreadable
 * manifest, and every OTHER compatibility recovery kind — `restart-editor`,
 * `use-compatible-editor` — each of which names an action
 * only the user can take. The same ask returns the same answer until a file
 * changes or a command is run, so a spinner would be a lie.
 *
 * TERMINAL IS THE DEFAULT: only the shapes named above are patient, so a new
 * error type cannot quietly acquire an infinite spinner.
 */
export type ProjectDetectionRecovery =
  | { kind: 'retry'; delayMs: number }
  | { kind: 'terminal'; reason: 'definite-answer' };

/**
 * Backoff for the patient path. The first retry is immediate (a cold Vite boot
 * that lost one request usually answers the next one), then it settles into a
 * few-second poll and CAPS — the wait is unbounded in total, so the interval
 * must not grow without bound or a server that came back at minute three would
 * sit unnoticed for another minute.
 *
 * `failures` is 1-based: the delay AFTER the nth consecutive failure.
 */
export const PROJECT_DETECTION_RETRY_MAX_DELAY_MS = 15_000;

export function projectDetectionRetryDelayMs(failures: number): number {
  if (failures <= 1) return 0;
  return Math.min((failures - 1) * 5_000, PROJECT_DETECTION_RETRY_MAX_DELAY_MS);
}

export function decideProjectDetectionRecovery(
  error: unknown,
  failures: number,
): ProjectDetectionRecovery {
  if (error instanceof ProjectDetectionTimeoutError) {
    return { kind: 'retry', delayMs: projectDetectionRetryDelayMs(failures) };
  }
  // The probe's own two shapes already carry this judgement (`retryable`):
  // 'unknown' is "could not ask", 'unreadable' is the server's definite answer.
  if (error instanceof ServerProjectDetectionError && error.report.retryable) {
    return { kind: 'retry', delayMs: projectDetectionRetryDelayMs(failures) };
  }
  // The compatibility handshake runs FIRST, so this — not the probe report
  // above — is the shape an unreachable or restarting server produces.
  if (error instanceof ProjectCompatibilityError && error.recovery.kind === 'retry-editor') {
    return { kind: 'retry', delayMs: projectDetectionRetryDelayMs(failures) };
  }
  return { kind: 'terminal', reason: 'definite-answer' };
}

/** Read the `?hub` escape hatch off a query string. Present-and-not-"0" wins,
 *  so `?hub`, `?hub=1`, and `?hub=true` all work — a user typing this into the
 *  address bar to escape a bad auto-reopen should not have to guess a spelling. */
export function hubRequestedFromSearch(search: string): boolean {
  const raw = new URLSearchParams(search).get('hub');
  if (raw === null) return false;
  return raw !== '0' && raw.toLowerCase() !== 'false';
}

// ---------------------------------------------------------------------------
// Removed boot params
// ---------------------------------------------------------------------------

/**
 * The one boot-param gate, run before the session's project is resolved.
 *
 * Three removals, one guard — the `assertNoRemoved*` shape the repo uses for
 * every retired format/param (legacy-removal doctrine, docs/ARCHITECTURE-CORE.md
 * §Vocabulary "how content opens"). A removed boot param must never fall
 * through silently; it errors naming the mechanism that replaced it.
 *
 * 1. `?project=`. Project identity lives in the SESSION: the editor server
 *    holds "which project is open" as server-side state
 *    (`GET /__editor/project`, re-rooted by `POST /__editor/open-project`),
 *    the client boots by ASKING it, and the URL is BARE. That is why a
 *    refresh — or a tab-heal navigation back to the bare origin — reopens the
 *    same project, exactly like a VS Code window. There is no surface where
 *    the URL names the project instead.
 *
 * 2. `?ingest=`. A vendored game is a PROJECT — every one carries its own
 *    `vgai.project.json` — so opening one is opening a project, and it opens
 *    through the session like every other (the gallery's Imported group
 *    re-roots the server at the game's manifest folder; the manifest ingest
 *    route mounts it). A param that names the MECHANISM ("ingest") rather than
 *    the thing being opened is exactly what §Vocabulary forbids.
 *
 * 3. `?scene=<path>`: the FLAT SCENE POOL it names is gone. There is
 *    deliberately no silent boot-time rewrite for it — a redirect is a second
 *    way to say the same thing, and a rewrite table rots into a redirect to
 *    nowhere.
 *
 * Pure over a search string, so it is readable without a window. Returns
 * normally when the URL names nothing removed.
 */
export function assertNoRemovedBootParams(search: string): void {
  const params = new URLSearchParams(search);
  const project = params.get('project');

  if (project !== null) {
    throw new Error(
      `Editor boot: \`?project=${project}\` — project identity does NOT live in the URL on a ` +
        'local editor. It lives in the SESSION (the legacy-removal doctrine, ' +
        'docs/ARCHITECTURE-CORE.md §Vocabulary "how content opens"). The local editor server ' +
        'holds which project is open as server-side state, which is why this URL is bare and a ' +
        'refresh reopens the same project — like a VS Code window.\n' +
        `Fix: open the project THROUGH the session — run ${commandLine('edit <path>')}, or use the ` +
        "editor's own project browser; both re-root this server via POST /__editor/open-project. " +
        'There is no surface where the URL names the project instead.',
    );
  }

  const ingest = params.get('ingest');
  if (ingest !== null) {
    throw new Error(
      `Editor boot: \`?ingest=${ingest}\` — REMOVED. A vendored game carries its own ` +
        '`vgai.project.json`, so it IS a project, and there is ONE boot param for opening a ' +
        'project. A param naming the MECHANISM rather than the thing being opened is what the ' +
        'legacy-removal doctrine forbids (docs/ARCHITECTURE-CORE.md §Vocabulary "how content ' +
        'opens").\n' +
        `Fix: open the game folder through the SESSION — ${commandLine('edit <path-to-the-game-folder>')}, ` +
        "or the New Project screen's IMPORTED group, which re-roots this server via " +
        'POST /__editor/open-project at that folder; the manifest ingest route then mounts it.',
    );
  }

  const scene = params.get('scene');
  if (scene !== null) {
    throw new Error(
      `Editor boot: \`?scene=${scene}\` — the flat scene pool it names was REMOVED, and so ` +
        'was the redirect that rewrote these links (the legacy-removal ' +
        'doctrine, docs/ARCHITECTURE-CORE.md §Vocabulary).\n' +
        `Fix: open the project through the session (${commandLine('edit <path>')}) and open the document ` +
        'inside it.',
    );
  }
}
