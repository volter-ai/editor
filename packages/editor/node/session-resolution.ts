/**
 * Session-resolution decisions for `vgai edit` and `vgai close` — pure, so the
 * rules that decide WHICH editor session a command acts on are testable as
 * data-in/decision-out instead of only through a live dev server.
 *
 * The two defects these exist for were both "the command ignored the
 * argument it was given".
 *
 * 1. `vgai edit` claimed ANY idle (projectless) session it found, printing
 *    "Reused the idle editor", even when the launch had named a port. An
 *    agent's `vgai edit <scratchpad>` therefore retargeted the OWNER'S idle
 *    repo editor — which is also how the owner's scratchpad ended up in the
 *    person-scoped Recents list (the `open-project` switch writes it) and how
 *    a "restarted repo server" came up serving a project nobody asked it for.
 *    The recorded contract (CLAUDE.md, D12) is that `vgai edit` "reuses the
 *    editor already serving THAT project … never silently retargets" another.
 *
 * 2. `vgai close --url X` swept every session matching the CWD's project
 *    rather than closing the session at X — the shape that took the owner's
 *    live editor down twice while an agent was cleaning up its own.
 *
 * Both decisions are expressed over an already-gathered session list so the
 * caller keeps every I/O concern (registry read, liveness probe, canonical
 * path resolution) and this module keeps none.
 */

/**
 * Where the port a launch is aiming at came from. The distinction is
 * load-bearing, not decoration:
 *
 * - `flag` / `env` — the CALLER named a port for THIS invocation (`--port`,
 *   `VGAI_EDITOR_PORT`). An instruction: never traded for another session's
 *   port, and never quietly swapped for a free one.
 * - `worktree` — the machine-local stable allocation for this worktree/project.
 *   It is RESERVED: reuse-or-refuse on that exact port, never free-port drift.
 * - `default` — nobody named anything (`DEFAULT_EDITOR_PORT`). A preference in
 *   every direction, and the ONLY source that may free-port-fall-back.
 */
export type EditorPortSource = 'flag' | 'env' | 'worktree' | 'default';

/** A live editor session, as the caller has already verified it. `project` is
 *  the canonical project root, or `null` for an idle (projectless) server. */
export interface ResolvableSession {
  port: number;
  project: string | null;
  pid: number | null;
  /**
   * Does this session have a live entry in the session registry — i.e. can the
   * CONTROL commands reach it? Optional because the targeting table below
   * never asked, and absent must keep meaning "not asked", never
   * "unreachable"; `classifyProjectSession` is the one decision that reads it.
   */
  registered?: boolean;
  /** `VGAI_EPHEMERAL_SESSION` — a throwaway probe server (`vgai doctor`) that
   *  deliberately keeps itself out of the registry and dies in seconds. */
  ephemeral?: boolean;
}

/**
 * FX-1 — is the session answering for this project one `vgai edit` may ATTACH
 * to, i.e. one every other command can reach too?
 *
 * The measured defect: `vgai edit` printed `Editor already open on this
 * project — http://localhost:29423/` and exited 0, no editor process was owned
 * by that project, and once the answering process died `vgai status` reported
 * `No live editor session matches …` from then on. The two commands do not
 * resolve sessions the same way — `vgai edit` probes LIVE (`verifiedSessions`,
 * which also includes an unregistered listener found on the preferred port),
 * while `vgai status`/`play`/`eval` (`getClient`) read the session REGISTRY
 * alone. Anything in the gap between those two sets is a session `vgai edit`
 * can claim and nothing else can talk to.
 *
 * Registration is not a heuristic here: dev.ts/packaged.ts both call
 * `registerSession` INSIDE their listen callback, before the server can answer
 * a single request — so a server that answers and is still absent from the
 * registry is not an ordinary session at all (an ephemeral `vgai doctor`
 * probe, a server from another checkout, or one whose registry entry was
 * lost). None of those may be reported as this project's editor.
 */
export type ProjectSessionVerdict =
  /** Serving this project AND reachable by every command — attach to it. */
  | { kind: 'attach'; session: ResolvableSession }
  /** Answering for this project, but no control command can reach it. */
  | { kind: 'unreachable'; session: ResolvableSession; reason: 'ephemeral' | 'unregistered' }
  | { kind: 'none' };

export function classifyProjectSession(
  sessions: readonly ResolvableSession[],
  project: string,
): ProjectSessionVerdict {
  const serving = sessions.filter((s) => s.project !== null && s.project === project);
  const reachable = serving.find((s) => s.registered !== false && s.ephemeral !== true);
  if (reachable) return { kind: 'attach', session: reachable };
  const answering = serving[0];
  if (!answering) return { kind: 'none' };
  return {
    kind: 'unreachable',
    session: answering,
    reason: answering.ephemeral === true ? 'ephemeral' : 'unregistered',
  };
}

/** What `vgai edit` says out loud before starting its own session instead of
 *  claiming one nothing else can reach. */
export function describeUnreachableProjectSession(
  verdict: Extract<ProjectSessionVerdict, { kind: 'unreachable' }>,
  freshPort: number,
): string {
  const { port, pid } = verdict.session;
  const who = pid === null ? 'an unidentified process' : `pid ${pid}`;
  const cause =
    verdict.reason === 'ephemeral'
      ? `it is a throwaway probe server, which never joins the session ` +
        'registry and exits on its own in seconds'
      : 'it has no session-registry entry, so `volter-editor status` / `volter-editor eval` cannot ' +
        'find it — attaching to it would report success and then leave every control command ' +
        'answering "No live editor session matches this project"';
  return (
    `A server on port ${port} (${who}) answers for this project, but ${cause}. ` +
    `Not claiming it — starting this project's own editor on port ${freshPort} instead. ` +
    `If port ${port} is a real editor you want back, stop that process and re-run \`volter-editor edit\`.`
  );
}

export interface EditTargetInput {
  /** Canonical root of the project being edited. */
  project: string;
  /** The port this launch is aiming at, already resolved from the sources below. */
  requestedPort: number;
  requestedPortSource: EditorPortSource;
  /** Live EDITOR sessions, with
   *  `project` already canonicalized so this module never touches the disk. */
  sessions: readonly ResolvableSession[];
  /** `--switch`: the caller explicitly asked to retarget an existing editor. */
  switchExisting: boolean;
}

export type EditTarget =
  /** A session is already serving this project — talk to it. */
  | { kind: 'reuse'; port: number; portDivergedFromRequest: boolean }
  /** Claim an idle (projectless) server by switching it to this project. */
  | { kind: 'adopt-idle'; port: number }
  /** `--switch`: retarget this session to the project. */
  | { kind: 'switch'; port: number }
  /** Start a new server. `allowPortFallback` is false when the requested port
   *  is an instruction the caller must not silently drift off. */
  | { kind: 'start-fresh'; port: number; allowPortFallback: boolean }
  /** The named port is held by a session serving a DIFFERENT project, and the
   *  caller named that port explicitly. Refuse loudly rather than pick another
   *  port the caller never asked for. */
  | { kind: 'port-conflict'; port: number; heldBy: string };

/**
 * Which editor session should `vgai edit <project>` act on?
 *
 * The table, in order (first match wins):
 *
 * | # | condition                                                     | result |
 * |---|---------------------------------------------------------------|--------|
 * | 1 | a session already serves THIS project                          | `reuse` at its port (`portDivergedFromRequest` when it is not the requested one) |
 * | 2 | `--switch`, port named    → a session on the REQUESTED port     | `switch` it |
 * | 3 | `--switch`, port named    → nothing on the requested port       | `start-fresh` there (never retarget a session on another port) |
 * | 4 | `--switch`, no port named → any editor session                  | `switch` the first |
 * | 5 | port named → an IDLE session on the REQUESTED port              | `adopt-idle` |
 * | 6 | port named → an idle session on a DIFFERENT port                | ignored — fall through |
 * | 7 | no port named → any idle session                                | `adopt-idle` (the pre-existing "unclaimed editor" rule) |
 * | 8 | requested port held by another project, source `flag`/`env`/`worktree` | `port-conflict` |
 * | 9 | otherwise                                                       | `start-fresh` at the requested port; fallback allowed only for `default` |
 *
 * Rule 1 matches on PROJECT alone, deliberately — not on "same project AND
 * requested port". Under the stricter reading, a project whose live session
 * landed on a fallback port would get a SECOND server on the next
 * `vgai edit` — precisely the
 * duplicate-session failure D12 and the tab bijection exist to prevent
 * ("per edited game, one and only one tab"; a duplicate for one project was
 * reproduced live 2026-07-25). Reusing the project's own session is never the
 * hijack the port rules guard against; the divergence is reported to the caller
 * through `portDivergedFromRequest` so the CLI can say so out loud instead of
 * silently.
 */
export function resolveEditTarget(input: EditTargetInput): EditTarget {
  const { project, requestedPort, requestedPortSource, sessions, switchExisting } = input;
  const portWasNamed = requestedPortSource !== 'default';

  const sameProject = sessions.find((s) => s.project !== null && s.project === project);
  if (sameProject) {
    return {
      kind: 'reuse',
      port: sameProject.port,
      portDivergedFromRequest: portWasNamed && sameProject.port !== requestedPort,
    };
  }

  const onRequestedPort = sessions.find((s) => s.port === requestedPort);
  const fresh: EditTarget = {
    kind: 'start-fresh',
    port: requestedPort,
    allowPortFallback: allowsFallback(requestedPortSource),
  };

  // Rows 2-4. A named port narrows --switch to that port; without one it keeps
  // its historical "retarget whatever editor is open" meaning.
  if (switchExisting) {
    const retarget = portWasNamed ? onRequestedPort : sessions[0];
    if (retarget) return { kind: 'switch', port: retarget.port };
    if (portWasNamed) return fresh;
  }

  // Rows 5-7. An idle server is unclaimed and safe to take — but a launch that
  // named a port is asking for THAT server, not for whichever one is idle.
  const idle = portWasNamed ? onRequestedPort : sessions.find((s) => s.project === null);
  if (idle?.project === null) return { kind: 'adopt-idle', port: idle.port };

  // Row 8. This port was RESERVED for this run — named for the invocation
  // (`flag`/`env`) or the worktree's machine-local allocation — and another
  // project holds it: refuse rather than pick one nobody reserved. Only
  // `default` (nobody named anything) is allowed to drift to a free port.
  const heldBy = onRequestedPort?.project;
  if (
    heldBy &&
    (requestedPortSource === 'flag' ||
      requestedPortSource === 'env' ||
      requestedPortSource === 'worktree')
  ) {
    return { kind: 'port-conflict', port: requestedPort, heldBy };
  }

  return fresh;
}

function allowsFallback(source: EditorPortSource): boolean {
  // Only an unnamed default may drift. Worktree allocations are reservations.
  return source === 'default';
}

/**
 * The port an explicit `--url`/`VGAI_EDITOR_URL` names, or `null` when the
 * string is not a URL this CLI can target. Implicit ports count: an editor is
 * always an HTTP origin, so `http://localhost` is port 80 as surely as
 * `http://localhost:80` is.
 */
export function editorUrlPort(rawUrl: string): number | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.port !== '') {
    const port = Number(parsed.port);
    return Number.isInteger(port) ? port : null;
  }
  if (parsed.protocol === 'http:') return 80;
  if (parsed.protocol === 'https:') return 443;
  return null;
}

export interface CloseSelectionInput {
  /** Live registered sessions, with `project` already canonicalized. */
  sessions: readonly ResolvableSession[];
  /** `--port`, or the port parsed out of `--url`/`VGAI_EDITOR_URL`. */
  requestedPort: number | null;
  /**
   * `--everywhere`: the explicit cross-project opt-in. EVERY live session on
   * the machine, including other agents' and the owner's. `--all` does NOT set
   * this — see the table below.
   */
  everywhere: boolean;
  /** The canonical project to sweep when no address was named (bare
   *  `vgai close`, `vgai close <project>`, or `vgai close --all`). */
  projectSweep: string | null;
}

export type CloseSelection =
  | { kind: 'close'; sessions: ResolvableSession[] }
  | { kind: 'no-session-at-port'; port: number }
  | { kind: 'no-session-for-project'; project: string };

/**
 * Which sessions does a `vgai close` invocation stop?
 *
 * | target                              | result |
 * |-------------------------------------|--------|
 * | `--everywhere`                      | every live session on the machine, whatever project it serves |
 * | `--port <n>` / `--url <u>`          | EXACTLY the session on that port (`no-session-at-port` when there is none) |
 * | bare / `<project>` / `--all`        | every session serving that project (`no-session-for-project` when there is none) |
 *
 * Two measured defects shaped this table, and both were "the command closed
 * more than it was pointed at".
 *
 * - An explicit address used to be collected and then discarded, so
 *   `vgai close --url http://localhost:5180` swept every session on the CWD's
 *   project — including, twice, the owner's. A named target is a target.
 * - `--all` used to mean every session on the BOX. On a machine running
 *   several concurrent agents it took two unrelated agents' editors down
 *   alongside the caller's — the `pkill -f` blast radius, with nothing at the
 *   call site saying so. `--all` now means "all of THIS project's sessions",
 *   and crossing the project boundary requires the differently-named
 *   `--everywhere`, which prints what it is about to stop first.
 */
export function selectCloseTargets(input: CloseSelectionInput): CloseSelection {
  if (input.everywhere) return { kind: 'close', sessions: [...input.sessions] };

  if (input.requestedPort !== null) {
    const targets = input.sessions.filter((s) => s.port === input.requestedPort);
    if (targets.length === 0) return { kind: 'no-session-at-port', port: input.requestedPort };
    return { kind: 'close', sessions: targets };
  }

  const wanted = input.projectSweep;
  if (wanted === null) return { kind: 'close', sessions: [...input.sessions] };
  const targets = input.sessions.filter((s) => s.project !== null && s.project === wanted);
  if (targets.length === 0) return { kind: 'no-session-for-project', project: wanted };
  return { kind: 'close', sessions: targets };
}
