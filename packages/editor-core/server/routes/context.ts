/**
 * `RouteContext` — the editor server's closure, named once.
 *
 * `createEditorServer` used to be a single ~7,700-line function body: every
 * route handler was a closure over the same pile of `const`/`let` bindings, so
 * the only way to know what a route touched was to read the whole file. The
 * split moves route bodies OUT, into `register<Family>Routes(router, ctx)`
 * modules, and this interface is what crosses that boundary: the same
 * bindings, materialized once, in one place a reader can enumerate.
 *
 * Two rules keep it honest:
 *
 *  - **Immutable bindings are plain properties.** A family module destructures
 *    them (`const { account } = ctx`), which is why the moved route bodies are
 *    otherwise byte-for-byte what they were.
 *  - **Mutable session state is a getter/setter pair**, and a route reads it as
 *    `ctx.projectRoot`. Destructuring a `let` would copy it, and the copy would
 *    silently go stale the moment the project changed — the one failure this
 *    boundary could plausibly introduce, so it is made unrepresentable.
 */

import type {
  CollaborationParticipantLocation,
  CollaborationRole,
  SourceRevision,
} from '@volter/editor-sdk/session/collaboration-types';
import type { EditorServerCompatibility } from '@volter/editor-sdk/session/editor-compatibility';
import type { Request, Response } from 'express';
import type { TripwireGate } from '../support/project/build-discipline';
import type {
  SessionJournal,
  SessionJournalEvent,
} from '../support/project/session-journal';
import type { ProjectComponentEntry } from '@volter/editor-sdk/kit/asset-workflow/project-content';
import type { HarnessChatSnapshot } from '../../src/harness-chat-types';
import type { EditorAccountService } from '../account-service';
import type { CollaborationSession } from '../collaboration-session';
import type { ConsoleLedger } from '../console-ledger';
import type { EditorServerOptions } from '../editor-server';
import type { EngineProvenance } from '../engine-provenance';
import type { HarnessChatService } from '../harness-chat-service';
import type { PlayPhaseRecord } from '../play-stall';
import type { ProjectModuleLoader } from '../project-tools';
import type { ProjectWorkCoordinator } from '../project-work-coordinator';
import type { ShareGatewayClaims } from '../share-claims';
import type { ShareHost } from '../share-host';
import type { TabHeartbeatServer } from '../tab-heartbeat';
import type { TabLifecycleController } from '../tab-lifecycle';
import type { TeamAgentMirror } from '../team-agent-mirror';
import type { WorktreeIdentity } from '../worktree-identity';

/**
 * The three fields share-claim verification actually reads. Structural so a
 * raw WebSocket upgrade request can be checked by the same function an Express
 * `Request` is.
 */
export interface ShareClaimSource {
  readonly method: string;
  readonly originalUrl: string;
  header(name: string): string | undefined;
}

/** A verified share claim, as the routes read it. */
export interface TrustedShareIdentity extends Omit<ShareGatewayClaims, 'role'> {
  role: CollaborationRole;
}

/**
 * What a control message answers with. A tab reports four facts upstream — it
 * picked a command up, the command finished, its state snapshot, which surface
 * it is showing — over its control socket OR as a POST, and both land on the
 * same handler so the two transports cannot answer differently.
 */
export type ControlOutcome = { status: 200 } | { status: 400 | 403 | 409; error: string };

/** Whether the `<project>/src` validation watcher is running, and why not. */
export type SourceValidationState = 'active' | 'awaiting-src' | 'no-project';

export interface RouteContext {
  // ---- Roots ------------------------------------------------------------
  /** The engine checkout serving this editor. Also the "no project" sentinel. */
  readonly engineRoot: string;
  /** Where the shared scaffolder reads templates and capabilities from. */
  /** The open project, or `engineRoot` when none is open. Reassigned by open. */
  projectRoot: string;
  /** `<projectRoot>/public` — the served asset root. Follows `projectRoot`. */
  publicRoot: string;

  // ---- Project mutation (the ONE write path for project-owned files) ----
  /**
   * Write a set of project resources as one attributed, conflict-checked
   * transaction, returning the collaboration revision it produced (or `null`
   * when no session is recording). Every family that writes the project's own
   * files goes through this — there is no second write path.
   */
  readonly commitProjectMutation: (
    req: Request,
    resources: readonly { path: string; content: string | Buffer | null }[],
  ) => Promise<SourceRevision | null | undefined>;
  /** The matching error answer, including the structured conflict shape. */
  readonly projectMutationError: (res: Response, error: unknown) => void;
  /**
   * Live conflict tickets: a 409 hands the client an id, and the client's
   * resolve call redeems it. Written by `projectMutationError`, read by the
   * source-conflict routes.
   */
  readonly sourceConflictTickets: Map<string, { paths: Set<string>; expiresAt: number }>;
  /** The open project's parsed manifest, or `null` when it cannot be read. */
  readonly readProjectManifest: () => unknown;

  // ---- Loading the project's own modules on the Node side ---------------
  readonly loadProjectModule: ProjectModuleLoader | undefined;

  // ---- Global account (never project state) -----------------------------
  readonly account: EditorAccountService;

  /** The project's component index (cached, invalidated by the src watcher). */
  readonly currentProjectComponents: () => Promise<ProjectComponentEntry[]>;

  /** WHICH engine source this server is running, resolved once at boot. */
  readonly enginePromise: Promise<EngineProvenance>;

  // ---- Session identity -------------------------------------------------
  /** This process's registered session, as other editors and the CLI see it. */
  readonly currentSessionIdentity: () => WorktreeIdentity | null;

  // ---- Owner-local authority --------------------------------------------
  /**
   * Loopback AND not carrying a share-gateway claim — i.e. the person who
   * launched this editor, not one of their session's guests.
   */
  readonly localOwnerRequest: (req: Request) => boolean;
  /** `localOwnerRequest`, having already answered 403 when it is false. */
  readonly requireLocalOwner: (req: Request, res: Response) => boolean;

  // ---- Opening a project (the runtime switch) ---------------------------
  /** Where the launcher's user-global settings live. */
  readonly launcherSettingsPath: string;
  /** Where the recent-projects list lives. */
  readonly recentProjectsPath: string;
  /** Record a visit, unless this session is not somebody's launcher. */
  readonly recordRecentProject: (name: string, projectDir: string) => Promise<void>;
  /** (Re)start the project file watchers for whatever `projectRoot` now is. */
  readonly startWatcher: () => void;
  /** Re-poll generation jobs for the open project. */
  readonly reconcileGenerations: () => Promise<void>;
  /** This server's editor/project compatibility identity. */
  readonly compatibilityIdentity: () => EditorServerCompatibility;
  /** When this server started serving THIS project. Reset by a switch. */
  servingProjectSince: number;
  /** The project-local session journal, reopened on a switch. */
  journal: SessionJournal | null;
  /** The two build-discipline gates, reset to idle on a switch. */
  cadenceGate: TripwireGate;
  unplayedGate: TripwireGate;

  // ---- The live session's own vitals -----------------------------------
  /** The unresolved error/warning ledger every `vgai` command reprints. */
  readonly consoleLedger: ConsoleLedger;
  /** Per-file validation state, as the watchers computed it. */
  readonly projectValidation: Map<string, { errors: string[]; at: number }>;
  readonly projectWarnings: Map<string, { warnings: string[]; at: number }>;
  /** The same validation state, pre-formatted as replayable `server-log`s. */
  readonly currentValidationLogEntries: () => { level: 'error' | 'warn'; message: string }[];
  /** Server-OBSERVED writes under `public/` — never browser-reported. */
  publicAssetsLastChangedAt: number | null;
  publicAssetsLastPath: string | null;
  publicAssetsChangedCount: number;
  /** When a GET last produced genuine editor HTML — the verified-open signal. */
  lastIndexRequestAt: number | null;
  /** Whether the `<project>/src` validation watcher is actually running. */
  sourceValidation: SourceValidationState;

  // ---- Tabs, clients and the command relay ------------------------------
  /** Every SSE client id currently attached to one tab. */
  readonly clientIdsForTab: (tabId: string) => string[];
  /** Which tab an SSE client belongs to, and the reverse map. */
  readonly tabIdForClient: (clientId: string | null) => string | null;
  readonly clientTabIds: Map<string, string>;
  /** The tab bijection's tables. `hostTabLifecycle` is the local owner's. */
  readonly hostTabLifecycle: TabLifecycleController;
  /** Subscribe to a tab's page reloading under the same tabId (any table). */
  readonly onTabReloaded: (listener: (tabId: string, epochCount: number) => void) => void;
  readonly participantTabLifecycles: Map<string, TabLifecycleController>;
  readonly clientTabLifecycles: Map<string, TabLifecycleController>;
  readonly tabLifecycleForParticipant: (
    participantId: string,
    hostEligible?: boolean,
  ) => TabLifecycleController;
  /** `null` when this session runs headless — the whole loop is off. */
  readonly tabBijectionOptions: {
    enabled: boolean;
    editorUrl: string;
    openUrl?: ((url: string) => void) | undefined;
  } | null;
  /** The tab heartbeat server (worker beats and their socket fallback). */
  readonly heartbeat: TabHeartbeatServer;
  /** Pre-listener page errors, per SSE client. */
  readonly pageErrorsByClient: Map<string, string[]>;
  /** Debounced leave timers, so a reload is not read as a departure. */
  readonly participantLeaveTimers: Map<string, ReturnType<typeof setTimeout>>;
  /** An id's first 8 characters — every log line in the relay uses it. */
  readonly short: (id: string | null | undefined) => string;
  /** The play phase the running game last reported. */
  livePlayPhase: PlayPhaseRecord | null;
  /** Live connection counts per collaboration participant. */
  readonly participantConnections: Map<string, number>;
  /** Which participant IS the local host, once a tab has claimed it. */
  hostParticipantId: string | null;

  // ---- Editor state, as tabs report it ----------------------------------
  editorState: Record<string, unknown>;
  editorStateUpdatedAt: number | null;
  readonly editorStatesByClient: Map<string, { state: Record<string, unknown>; updatedAt: number }>;

  // ---- The session journal & build-discipline tripwires ------------------
  /** Append one event to `<project>/logs/editor-*.jsonl`. */
  readonly journalEvent: (event: SessionJournalEvent) => void;
  /** Re-evaluate the commit-cadence / never-played banners. Guarded inside. */
  readonly announceBuildDisciplineTripwires: () => void;
  /** The play-run log file currently being appended to, or `null`. */
  activeLogFile: string | null;

  // ---- Agent harness ----------------------------------------------------
  readonly harnessChat: HarnessChatService;
  /** The standing reason the Chat view has no agent, or `null` (`frontend-handoff.ts`). */
  readonly frontendRefusal: () => string | null;
  /** The project's own work tracker, as a snapshot + one action endpoint. */
  readonly projectWork: ProjectWorkCoordinator;

  // ---- How this server was constructed ----------------------------------
  readonly options: EditorServerOptions;

  // ---- Collaboration ----------------------------------------------------
  /** The open project's collaboration session, or `null` when none is open. */
  readonly currentCollaboration: () => CollaborationSession | null;
  /** Where a joining participant is, as the session records it. */
  readonly currentCollaborationLocation: () => CollaborationParticipantLocation | undefined;
  /** `currentCollaboration()`, having already answered 400 when it is null. */
  readonly collaborationOr400: (res: Response) => CollaborationSession | null;
  /** The role a joining participant gets when their invitation names none. */
  readonly defaultCollaborationRole: (
    participantId: string,
    invitedRole?: CollaborationRole,
  ) => CollaborationRole;
  /** Agent-turn bookkeeping, shared with the harness-chat snapshot listener. */
  readonly markAgentTurnRunning: (participantId: string) => void;
  readonly markAgentTurnEnded: (participantId: string) => void;
  /** Mirrors harness output into the team thread. */
  readonly teamMirror: TeamAgentMirror;
  readonly postMirroredTeamMessages: (snapshot: HarnessChatSnapshot) => void;
  /** Participants attributed to THIS machine rather than a gateway credential. */
  readonly localParticipantIds: Set<string>;

  // ---- Sharing ----------------------------------------------------------
  /** The verified share claim on a request, or `null` for the local owner. */
  readonly trustedShareIdentity: (req: ShareClaimSource) => TrustedShareIdentity | null;
  /** The cookie secret the local tab presents to reach `/__editor/share-control`. */
  readonly browserShareControlSecret: string;
  /** The live share host, once one has been started. */
  shareHost: ShareHost | null;
  /** Which local participant IS the owner, once their account is verified. */
  localShareHost: { participantId: string; account: ShareGatewayClaims['account'] } | null;
}
