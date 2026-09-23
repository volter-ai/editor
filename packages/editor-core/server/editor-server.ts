/**
 * Express app factory for the editor backend.
 *
 * All /__editor/* API routes extracted from vite-plugin-asset-browser.ts.
 * Works in both dev (alongside Vite middleware) and production (standalone).
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import type { Server as HttpServer } from 'node:http';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import type { EditorServerCompatibility } from '@volter/editor-sdk/session/editor-compatibility';
import { isContainedRelativePath } from '@volter/editor-sdk/session/relative-path-guard';
import chokidar, { type FSWatcher } from 'chokidar';
import type { Request, Response, Router } from 'express';
import express from 'express';
import { MANIFEST_FILENAME } from '@volter/editor-project/manifest/filename';
import { resolveManifestPath } from '@volter/editor-project/manifest/locate';
import { GAME_MANIFEST_VERSION } from '@volter/editor-project/manifest/schema';
import type { TripwireGate } from './support/project/build-discipline';
import {
  openSessionJournal,
  type SessionJournal,
  type SessionJournalEvent,
} from './support/project/session-journal';
import type { HarnessChatSnapshot } from '../src/harness-chat-types';
import { EditorAccountService } from './account-service';
import { createAssetLibraryRouter } from './asset-library-routes';
import { canonicalProjectRoot } from './canonical-path';
import {
  checkoutWorkspaceIdentityError,
  createWorkspaceIdentityRestartMonitor,
  type WorkspaceIdentityRestartMonitor,
} from './checkout-workspace-preflight';
// The pieces that used to sit above `createEditorServer` in this file, and the
// public names other modules import FROM this path. The re-exports are
// deliberate: `editor-server.ts` stays the one import site for the server's
// public surface even though the implementations now live beside it.
import {
  type AgentAuthorLease,
  agentAuthorLease,
  filesystemMutationAuthor,
  localCollaborationRole,
} from './collaboration-attribution';
import {
  CollaborationConflictError,
  type CollaborationRole,
  collaborationSession,
} from './collaboration-session';
import { createConsoleLedger } from './console-ledger';
import type { EditorServerOptions } from './editor-server-options';
import { broadcast, sendToAllClients, sendToClient } from './editor-sse';
import { engineProvenance } from './engine-provenance';
import {
  createEngineSourceRestartGate,
  type EngineSourceRestartGate,
} from './engine-source-restart';
import { reconcileGenerationJobs } from './generation-reconciler';
import { harnessChatCallerSessionFromEnv } from './harness-chat-caller';
import { type FrontendHandoffResult, HarnessChatService } from './harness-chat-service';
import { LAUNCHER_SETTINGS_PATH } from './launcher-settings';
import { openBrowserUrl, shouldOpenTabInBackground } from './open-browser';
import { acceptPagePhase, type PlayPhaseRecord } from './play-stall';
import { withDependencyChangeInvalidation } from './project-dependency-invalidation';
import {
  hashAndSize,
  headerValue,
  readRunningEngineVersion,
  unlinkIfPresent,
} from './project-file-scan';
import { setKindModuleLoader } from './project-kinds';
import { createProjectWatch } from './project-watch';
import { ProjectWorkCoordinator } from './project-work-coordinator';
import { addToRecentProjects, RECENT_PROJECTS_PATH } from './recent-projects-store';
import { registerAccountRoutes } from './routes/account';
import { registerAgentRoutes } from './routes/agents';
import { registerAssetRoutes } from './routes/assets';
import { registerBuildRoutes } from './routes/build';
import { registerCollaborationRoutes } from './routes/collaboration';
import { registerConfigurationRoutes, stopAllConfigurations } from './routes/configurations';
import type { RouteContext, SourceValidationState, TrustedShareIdentity } from './routes/context';
import { createControlPlane } from './routes/control-plane';
import { registerLogRoutes } from './routes/logs';
import {
  registerProjectAttributionRoute,
  registerProjectIdentityRoutes,
} from './routes/project-identity';
import { registerProjectOpenRoutes } from './routes/project-open';
import {
  registerModuleTransportNotFound,
  registerProjectSourceRoutes,
} from './routes/project-source';
import { registerProjectStateRoutes } from './routes/project-state';
import { registerRelayRoutes } from './routes/relay';
import { registerServedModuleRoutes } from './routes/served-modules';
import { registerSessionTabRoutes } from './routes/session-tabs';
import { registerSettingsRoutes } from './routes/settings';
import { registerShareControlRoutes } from './routes/share-control';
import { registerThemeRoutes } from './routes/themes';
import { registerToolRoutes } from './routes/tools';
import { registerWorktreeRoutes } from './routes/worktrees';
import {
  isAllowedEditorOrigin,
  isCanonicalPathInside,
  isCanonicalWritePathInside,
  isPathInside,
} from './server-utils';
import { processSessionId, sessionIdentity, writesRecentProjects } from './session-registry';
import { verifyShareClaimHeaders } from './share-claims';
import { ShareHost } from './share-host';
import { createTabHeartbeatServer } from './tab-heartbeat';
import { createTabLifecycle, type TabLifecycleController } from './tab-lifecycle';
import { TeamAgentMirror } from './team-agent-mirror';

export {
  AGENT_AUTHOR_LEASE_MS,
  type AgentAuthorLease,
  agentAuthorLease,
  filesystemMutationAuthor,
  localCollaborationRole,
  setGatewayParticipantRole,
} from './collaboration-attribution';
export {
  type EditorServerOptions,
  noEditorConnectedMessage,
} from './editor-server-options';
export {
  headerValue,
  installProjectDependencies,
} from './project-file-scan';
export {
  loadRecentProjects,
  playLogFilename,
  playRunSlug,
  saveRecentProjects,
  slugify,
} from './recent-projects-store';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export type EditorServerRouter = Router & {
  close(): Promise<void>;
  /**
   * Serve the duplex control socket on this HTTP server (`upgrade` for
   * `/__editor/events`). Every host that calls `listen` must call this, or
   * local tabs fall back to nothing — the browser's WebSocket handshake gets
   * no answer. Routes by pathname and leaves every other upgrade (Vite's HMR
   * socket) to its own listener.
   */
  attachControlSocket(server: HttpServer): void;
  /**
   * Tab bijection, session end: best-effort `tab-close` to EVERY connected
   * tab. Hosts MUST run this before tearing the HTTP server down (the write
   * needs a live connection); a no-op when bijection is off or a restart
   * handoff was announced (`POST /__editor/tab/expect-restart`).
   */
  notifyTabSessionEnded(): Promise<void>;
  /**
   * Absolute path of the project-local session journal this server is
   * appending to (`<project>/logs/editor-*.jsonl`), or `null` when no project
   * is open / the project is unwritable. Hosts print it at boot so the one
   * file an agent should read is named where the URL is named.
   */
  sessionJournalPath(): string | null;
  /**
   * RECORD A SHUTDOWN TASK THAT DID NOT FINISH. The host owns the shutdown
   * list (`process-shutdown.ts`) and this server owns the journal, so the host
   * hands the record through this door rather than opening a second writer on
   * the same file. Named-task-only on purpose: a shutdown that WORKS is already
   * recorded by `session-shutdown`, and the line worth having is the one that
   * says which resource is still alive.
   */
  journalShutdownTask(record: {
    readonly task: string;
    readonly outcome: 'timeout' | 'failed';
    readonly ms: number;
    readonly detail?: string;
  }): void;
  /**
   * THE CHAT VIEW'S RUNTIME, as the environment the REH must be SPAWNED with
   * (`frontend-handoff.ts`). The host calls this once, immediately before
   * `startFrameWorkbench`, because an extension host inherits its server's
   * environment and that environment is fixed at spawn. Never throws: a box with
   * no signed-in harness answers with a `refusal` sentence and an empty `env`,
   * and the session opens anyway.
   */
  frontendHandoff(): Promise<FrontendHandoffResult>;
  /** The standing reason the Chat view has no agent, or `null` — re-raised per page load
   *  because the console ledger's clearing rule (a) is page-scoped and this condition is not. */
  frontendRefusal(): string | null;
};

export function createEditorServer(options: EditorServerOptions): EditorServerRouter {
  const { engineRoot } = options;
  const recentProjectsPath = options.recentProjectsPath ?? RECENT_PROJECTS_PATH;
  const recordsRecentProjects = options.recordsRecentProjects ?? writesRecentProjects();
  /** `addToRecentProjects`, unless this session is not somebody's launcher. */
  const recordRecentProject = async (name: string, projectDir: string): Promise<void> => {
    if (!recordsRecentProjects) return;
    await addToRecentProjects(name, projectDir, recentProjectsPath);
  };
  const launcherSettingsPath = options.launcherSettingsPath ?? LAUNCHER_SETTINGS_PATH;
  const serverStartedAt = new Date().toISOString();
  const runningEngineVersion = readRunningEngineVersion(engineRoot);
  // WHICH engine source, not just which version — see engine-provenance.ts.
  // Primed here (not awaited) so the first `/__editor/project` answer already
  // has it and no boot path ever waits on git.
  const enginePromise = engineProvenance(engineRoot);
  let staleSource: { changedPath: string; changedAt: string } | null = null;
  let engineSourceWatcher: FSWatcher | null = null;
  let engineSourceRestartGate: EngineSourceRestartGate | null = null;
  let workspaceIdentityRestartMonitor: WorkspaceIdentityRestartMonitor | null = null;
  // Mutable project state — updated by open-project endpoint. Declared before
  // the source monitors because workspace-link identity follows the active
  // project dynamically.
  let projectRoot = options.projectPath ?? engineRoot;

  const markSourceStale = (change: { changedPath: string; changedAt: string }): void => {
    if (staleSource) return;
    staleSource = change;
    options.onEngineSourceStale?.(staleSource);
  };

  if (options.watchEngineSource) {
    // ONLY the Node process's own source belongs here: the restart-required
    // banner BLOCKS the whole editor, so it must fire only when the running
    // process genuinely holds outdated code. package.json / package-lock.json
    // are deliberately NOT watched (owner, 2026-08-07): a manifest or lockfile
    // edit changes nothing the running process has already loaded — deps take
    // effect per-use through the project dependency fingerprint
    // (`project-dependency-invalidation.ts`), and a truly reinstalled
    // node_modules surfaces as real module errors, not silently. Measured
    // cost of watching them: a sibling PR's lockfile entries (#1278) reached
    // a serving worktree via an ordinary git refresh and locked a live
    // authoring session behind the banner, on a change with zero effect on
    // the running server.
    const watchedPaths = [
      join(engineRoot, 'packages', 'editor', 'server'),
      join(engineRoot, 'packages', 'engine', 'src'),
      join(engineRoot, 'packages', 'create-vgai-project', 'src'),
      join(engineRoot, 'vite.config.ts'),
      join(engineRoot, 'tsconfig.json'),
      join(engineRoot, 'tsconfig.server.json'),
    ].filter(existsSync);
    // Debounce + content-aware suppression (diagnosis cause 4): raw chokidar
    // events restarted the dev host on every mtime change — content-identical
    // touches and multi-file bursts (git branch switch, editor "save all")
    // produced back-to-back restart storms. The gate baselines each watched
    // file's content hash during the initial scan (ignoreInitial: false —
    // pre-`ready` add events ARE the scan), ignores events whose bytes are
    // unchanged, and coalesces a burst into one restart after a quiet window.
    engineSourceRestartGate = createEngineSourceRestartGate({
      onRestart: (change) => {
        markSourceStale({
          changedPath: relative(engineRoot, resolve(change.changedPath)).split(sep).join('/'),
          changedAt: change.changedAt,
        });
      },
    });
    engineSourceWatcher = chokidar.watch(watchedPaths, {
      ignoreInitial: false,
      ignored: (watchedPath) => {
        const name = basename(watchedPath);
        return name.startsWith('.') || name.endsWith('~') || /\.(?:swp|swo|tmp|temp)$/i.test(name);
      },
    });
    let engineSourceScanDone = false;
    engineSourceWatcher.once('ready', () => {
      engineSourceScanDone = true;
    });
    engineSourceWatcher.on('all', (event, changedPath: string) => {
      if (!engineSourceScanDone) {
        engineSourceRestartGate?.recordBaseline(changedPath);
        return;
      }
      engineSourceRestartGate?.handleEvent(event, changedPath);
    });
    workspaceIdentityRestartMonitor = createWorkspaceIdentityRestartMonitor({
      engineRoot,
      projectPath: () => (projectRoot === engineRoot ? undefined : projectRoot),
      onStale: markSourceStale,
    });
  }

  let publicRoot = resolve(projectRoot, 'public');
  // Repository/worktree identity belongs to the opened SESSION, not to each
  // HTTP request. Resolving it shells out synchronously to Git several times;
  // doing that from `/__editor/project`, presence, SSE and worktree chrome
  // during the same cold boot blocked Vite's single Node event loop while the
  // browser was waiting for CSS, shaders and source modules. Cache it for the
  // current project. A project switch changes the key and recomputes; the
  // worktree picker still performs its own explicit fresh repository scan.
  let sessionIdentityCache: {
    projectRoot: string;
    identity: ReturnType<typeof sessionIdentity>;
  } | null = null;
  const currentSessionIdentity = () => {
    if (projectRoot === engineRoot) return null;
    if (sessionIdentityCache?.projectRoot === projectRoot) return sessionIdentityCache.identity;
    const identity = sessionIdentity(projectRoot);
    sessionIdentityCache = { projectRoot, identity };
    return identity;
  };
  // Pay the one identity resolution before the server advertises readiness,
  // never in competition with the browser's cold module graph.
  currentSessionIdentity();
  // When this server started serving THIS project — the clock behind the
  // "never once played" tripwire below. Reset by the open-project endpoint,
  // because a switch starts a new build on a new project, not minute 40 of the
  // previous one.
  let servingProjectSince = Date.now();
  /**
   * The page's last word on its play boot — which of play's eight steps it was
   * ENTERING. `null` until a page reports one. See `play-stall.ts` for the
   * three-silent-timeouts measurement this exists for, and
   * `src/play-boot-phase.ts` for the page's half.
   */
  let livePlayPhase: PlayPhaseRecord | null = null;
  // The session journal (`<project>/logs/editor-*.jsonl`) — the DURABLE half of
  // everything this server says. Every emit point below journals first and
  // renders second, so nothing can print without leaving a readable line
  // behind. Opened per PROJECT, because the file lives inside the project; a
  // live switch closes one and opens the next (see the open-project route).
  let journal: SessionJournal | null =
    projectRoot === engineRoot ? null : openSessionJournal(projectRoot);
  /** The ONE call every renderer makes before it prints. */
  function journalEvent(event: SessionJournalEvent): void {
    journal?.append(event);
  }

  /** The open project's parsed `vgai.project.json`, or `null` when there is no
   *  project (engine-repo mode) or the file is missing/unparseable. Read fresh
   *  each call and never cached: the manifest is editable while the server
   *  runs, and every caller here is answering a question about the CURRENT
   *  project shape. `null` degrades to "the project's own `src/`", never to an
   *  error — nothing that consults this may fail because a manifest is
   *  mid-edit. */
  function readProjectManifest(): unknown {
    if (projectRoot === engineRoot) return null;
    try {
      return JSON.parse(readFileSync(resolveManifestPath(projectRoot), 'utf8')) as unknown;
    } catch {
      return null;
    }
  }
  journalEvent({ kind: 'session-started', project: projectRoot, pid: process.pid });
  /**
   * The 8-character id every transport journal line carries. Long enough to
   * correlate `command-relayed` with the `client-connected` that owns it,
   * short enough to read a column of them.
   */
  function short(id: string | null | undefined): string {
    return typeof id === 'string' ? id.slice(0, 8) : '';
  }
  /**
   * Which TAB owns a control connection.
   *
   * A control socket is a per-page-load thing; a TAB outlives its reloads
   * (tab-presence.ts). The page declares its `tabId` on the events URL, so
   * the relay can say which tab it addressed even after the connection that
   * carried the command is gone.
   */
  const clientTabIds = new Map<string, string>();
  /**
   * Pre-listener page errors, keyed by client id — which IS the page-load id,
   * so a reload starts from nothing rather than inheriting the dead page's
   * errors. Same lifetime and same teardown path as `clientTabIds` beside it.
   */
  const pageErrorsByClient = new Map<string, string[]>();
  /**
   * THE UNRESOLVED CONSOLE SET — errors and warnings that outlive the tab that
   * reported them (`console-ledger.ts`). Distinct from `pageErrorsByClient`
   * beside it in every way that matters: that map is a per-page-load, first-8,
   * bootstrap-only buffer that is DELETED when its connection closes, and this
   * ledger is the session's durable record, accumulated across reloads and tab
   * deaths, cleared only by a reload that does not reproduce the condition or
   * by a named acknowledgment. Every CLI response envelope carries its counts.
   */
  const consoleLedger = createConsoleLedger({
    journal: (event) => journalEvent(event),
  });
  function tabIdForClient(clientId: string | null): string | null {
    return clientId === null ? null : (clientTabIds.get(clientId) ?? null);
  }
  /** Every live control connection this TAB currently holds. A tab has more
   *  than one only across a reload's overlap, and none at all mid-reload —
   *  which is precisely why the relay waits instead of refusing. */
  function clientIdsForTab(tabId: string): string[] {
    return [...clientTabIds].filter(([, id]) => id === tabId).map(([clientId]) => clientId);
  }
  /** Lifecycle events address a TAB; delivery finds its current channel(s). */
  function sendToTab(tabId: string, event: string, data: unknown): boolean {
    let delivered = false;
    for (const clientId of clientIdsForTab(tabId)) {
      if (sendToClient(clientId, event, data)) delivered = true;
    }
    return delivered;
  }
  let collaborationUnsubscribe: (() => void) | null = null;
  const participantConnections = new Map<string, number>();
  const participantLeaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const localParticipantIds = new Set<string>();
  let localShareHost: {
    participantId: string;
    account: { id: string; email: string; name?: string };
  } | null = null;
  let shareHost: ShareHost | null = null;
  const currentCollaboration = () =>
    projectRoot === engineRoot ? null : collaborationSession(canonicalProjectRoot(projectRoot));
  const currentCollaborationLocation = () => {
    if (projectRoot === engineRoot) return undefined;
    const identity = currentSessionIdentity();
    return identity
      ? {
          repositoryId: identity.repositoryId,
          worktreeId: identity.worktreeId,
          sessionId: processSessionId(),
        }
      : undefined;
  };
  const bindCollaboration = () => {
    currentCollaboration()?.flush();
    if (shareHost?.status().active) void shareHost.stop();
    localShareHost = null;
    collaborationUnsubscribe?.();
    collaborationUnsubscribe = null;
    const collaboration = currentCollaboration();
    if (collaboration) {
      collaborationUnsubscribe = collaboration.subscribeEvents((event) =>
        broadcast(`collaboration-${event.channel}`, event),
      );
    }
  };
  // Every Node-side project-module load goes through this one wrapper, so a
  // dependency installed under a live session is picked up by tool discovery,
  // tool execution and generation reconciliation alike.
  const loadProjectModule = withDependencyChangeInvalidation(options.loadProjectModule, {
    getProjectRoot: () => projectRoot,
    invalidateModules: options.invalidateProjectModules,
  });
  setKindModuleLoader(loadProjectModule ?? null);
  const initialHarnessCaller = harnessChatCallerSessionFromEnv();
  const collaborationAgents = new Map<string, { participantId: string; projectRoot: string }>();
  let recentAgentAuthor: AgentAuthorLease | null = null;
  const markAgentTurnRunning = (participantId: string): void => {
    recentAgentAuthor = agentAuthorLease(participantId);
  };
  const markAgentTurnEnded = (participantId: string): void => {
    if (recentAgentAuthor?.participantId !== participantId) return;
    recentAgentAuthor = { participantId, until: Date.now() + 2_000, running: false };
  };
  const teamMirror = new TeamAgentMirror();
  /** Post whatever the room is owed for this snapshot. Called from the harness
   *  subscription AND straight after an `@agent` dispatch, because a fast turn
   *  can settle before the subscription's next snapshot arrives. */
  const postMirroredTeamMessages = (snapshot: HarnessChatSnapshot): void => {
    const collaboration = currentCollaboration();
    if (!collaboration) return;
    const authorId = `agent:${snapshot.activeSessionId}`;
    // Drain only once the author is in the room: a drained answer is consumed,
    // so posting it at a participant that does not exist yet would lose it.
    // The next snapshot re-offers it, by which time the session has joined.
    if (!collaboration.snapshot().participants.some((entry) => entry.participantId === authorId)) {
      return;
    }
    for (const text of teamMirror.drain(snapshot)) {
      try {
        collaboration.postMessage({ authorId, text, references: [] });
      } catch {
        // The participant can disappear between the harness snapshot and this projection.
      }
    }
  };
  const syncHarnessParticipant = (snapshot: HarnessChatSnapshot): void => {
    const active = snapshot.sessions.find((session) => session.id === snapshot.activeSessionId);
    const root = canonicalProjectRoot(projectRoot);
    const relevant =
      projectRoot === engineRoot
        ? []
        : snapshot.sessions.filter((session) => {
            if (session.id === snapshot.activeSessionId && snapshot.mode !== 'none') return true;
            if (!session.live || !session.cwd) return false;
            return canonicalProjectRoot(session.cwd) === root;
          });
    const desired = new Set(relevant.map((session) => `agent:${session.id}`));
    for (const [sessionId, agent] of collaborationAgents) {
      if (agent.projectRoot === root && desired.has(agent.participantId)) continue;
      if (recentAgentAuthor?.participantId === agent.participantId) {
        markAgentTurnEnded(agent.participantId);
      }
      collaborationSession(agent.projectRoot).leave(agent.participantId);
      collaborationAgents.delete(sessionId);
      teamMirror.forget(sessionId);
    }
    if (relevant.length === 0) return;
    const collaboration = currentCollaboration();
    if (!collaboration) return;
    for (const session of relevant) {
      const participantId = `agent:${session.id}`;
      const isActive = session.id === active?.id;
      const status = isActive
        ? snapshot.requests.some((request) => request.status === 'pending') || snapshot.error
          ? 'needs-input'
          : snapshot.turn.state !== 'idle'
            ? 'active'
            : snapshot.taskPlan.items.length > 0 &&
                snapshot.taskPlan.items.every((item) =>
                  ['completed', 'cancelled'].includes(item.status),
                )
              ? 'done'
              : 'idle'
        : 'idle';
      if (!collaborationAgents.has(session.id)) {
        collaboration.join({
          participantId,
          displayName: session.title || session.harness || 'Coding agent',
          kind: 'agent',
          role: collaboration.roleFor(participantId) ?? 'terminal',
          location: currentCollaborationLocation(),
          status,
          agent: { harness: session.harness, conversationId: session.identity },
        });
        collaborationAgents.set(session.id, { participantId, projectRoot: root });
      } else {
        collaboration.updateParticipant(participantId, {
          displayName: session.title || session.harness || 'Coding agent',
          location: currentCollaborationLocation(),
          status,
          agent: { harness: session.harness, conversationId: session.identity },
        });
      }
      collaboration.updatePresence(participantId, {
        document: `agent:${session.id}`,
        file: null,
        oid: null,
        selection: [],
        camera: null,
        gesture: {
          harness: session.harness,
          turn: session.id === active?.id ? snapshot.turn.state : 'available',
          operation: session.id === active?.id ? snapshot.operation : null,
        },
      });
    }
    if (!active || snapshot.mode === 'none') return;
    const nextId = `agent:${active.id}`;
    if (snapshot.turn.state === 'running') {
      // Every fresh running snapshot RENEWS the lease; a harness that stops
      // producing snapshots stops renewing, and attribution falls back to the
      // host within AGENT_AUTHOR_LEASE_MS.
      markAgentTurnRunning(nextId);
    } else if (recentAgentAuthor?.participantId === nextId && recentAgentAuthor.running) {
      markAgentTurnEnded(nextId);
    }
    postMirroredTeamMessages(snapshot);
  };
  const account = new EditorAccountService();
  const harnessChat = new HarnessChatService({
    engineRoot,
    getProjectRoot: () => projectRoot,
    resolveCodingInference: (workspace) => account.resolvedCodingInference(workspace),
    onChange: (snapshot) => {
      broadcast('harness-chat', snapshot);
      syncHarnessParticipant(snapshot);
    },
    ...(initialHarnessCaller ? { callerSessions: [initialHarnessCaller] } : {}),
  });
  const projectWork = new ProjectWorkCoordinator({
    getProjectRoot: () => projectRoot,
    harnessChat,
    onChange: (snapshot) => broadcast('project-work', snapshot),
  });
  void projectWork.initialize();
  const shareGatewaySecret = options.shareGatewaySecret ?? randomBytes(32).toString('base64url');
  /** The three fields share-claim verification actually reads. Structural so
   *  a raw WebSocket upgrade request can be checked by the same function an
   *  Express `Request` is. */
  interface ShareClaimSource {
    readonly method: string;
    readonly originalUrl: string;
    header(name: string): string | undefined;
  }
  const trustedShareIdentity = (req: ShareClaimSource) => {
    const claims = verifyShareClaimHeaders(
      shareGatewaySecret,
      req.method,
      req.originalUrl,
      (name) => req.header(name),
    );
    return claims
      ? {
          participantId: claims.participantId,
          invitationId: claims.invitationId,
          credentialId: claims.credentialId,
          role: claims.role as CollaborationRole,
          account: claims.account,
        }
      : null;
  };
  const browserShareControlSecret = randomBytes(32).toString('base64url');
  if (options.collaborationPort) {
    shareHost = new ShareHost(
      options.collaborationPort,
      processSessionId(),
      account,
      () => canonicalProjectRoot(projectRoot),
      shareGatewaySecret,
    );
  }
  let generationReconcileInFlight = false;
  const reconcileGenerations = async () => {
    if (generationReconcileInFlight || projectRoot === engineRoot) return;
    generationReconcileInFlight = true;
    try {
      // No credential is read here, and none is read by a tick that finds
      // nothing to reconcile: `executeProjectTool` reads the ONE provider a
      // pending job names, at the moment it runs it. See
      // `provider-credentials.ts`'s header — this five-second timer used to
      // sweep every provider's Keychain item on the first tick of every
      // session, which is a stack of unlock prompts per `vgai edit`.
      await reconcileGenerationJobs(projectRoot, loadProjectModule, 3, account);
    } catch (error) {
      broadcast('server-log', {
        level: 'error',
        message: `Generation reconciliation failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      generationReconcileInFlight = false;
    }
  };
  const generationReconcileTimer = setInterval(() => void reconcileGenerations(), 5_000);
  void reconcileGenerations();

  const compatibilityIdentity = (): EditorServerCompatibility => {
    // Unlike source bytes, project-local npm links can change without a file
    // event the engine watcher observes. Re-evaluate them on the reuse
    // handshake so `vgai edit` restarts a server from checkout A after the
    // project is relinked to checkout B, instead of composing both identities.
    const workspaceIdentityError = checkoutWorkspaceIdentityError(
      engineRoot,
      projectRoot === engineRoot ? undefined : projectRoot,
    );
    if (workspaceIdentityError && !staleSource) {
      markSourceStale({
        changedPath: 'node_modules workspace package links',
        changedAt: new Date().toISOString(),
      });
    }
    return {
      apiVersion: 1,
      engineVersion: runningEngineVersion,
      manifestVersion: GAME_MANIFEST_VERSION,
      startedAt: serverStartedAt,
      source: staleSource ? { state: 'restart-required', ...staleSource } : { state: 'current' },
    };
  };

  // #run2-cold-vite: last time this server served the editor's own INDEX
  // page (as opposed to an API/SSE/asset request) to a browser. Detected by
  // response Content-Type rather than by route/path, because the index page
  // is served by two different mechanisms depending on mode (Vite's dev
  // middleware at `/` in dev.ts, the packaged server's own
  // `express.static` + SPA fallback) and none of those routes
  // are owned by this file. Exposed on `/__editor/state` so the CLI's
  // verified-open polling (`waitForVerifiedEditorOpen` in
  // packages/vgai-cli/src/editor-sessions.ts) can tell "the browser tab
  // arrived and is loading" apart from "the auto-open never reached a
  // browser at all" — the distinction a cold Vite dep-optimize on drvfs
  // needs, since that alone can blow past the old flat 15s timeout on a
  // project's very first page load.
  let lastIndexRequestAt: number | null = null;

  // The TAB TABLE, and the bijection that reads it (tab-presence.ts /
  // tab-lifecycle.ts): one browser tab per edited game, chosen from tabs that
  // prove themselves by heartbeat.
  //
  // The table exists for EVERY session, including a headless one. Presence is
  // not a maintenance feature — it is how the relay and `vgai status` know
  // whether anybody is home — and a `--no-open` session that a person later
  // opens the URL on must see that tab and take its commands. What the flag
  // turns off is `maintain`: this session enforces one tab and never OPENS
  // one.
  const tabBijectionOptions = options.tabBijection?.enabled ? options.tabBijection : null;
  /** Who wants to know a tab's page reloaded (the control plane, to settle
   *  the commands the old page-load was holding). Every lifecycle reports
   *  through here, host and participant alike. */
  const tabReloadListeners = new Set<(tabId: string, epochCount: number) => void>();
  const makeTabLifecycle = (
    participantId: string | null,
    maintain: boolean,
  ): TabLifecycleController =>
    createTabLifecycle({
      editorUrl: tabBijectionOptions?.editorUrl ?? '',
      onTabReloaded: (tabId, epochCount) => {
        for (const listener of tabReloadListeners) listener(tabId, epochCount);
      },
      // Placement is decided per OPEN, not once at boot: `projectRoot` is
      // reassignable (`/__editor/open-project`), so a session that switches
      // from a human checkout into an agent worktree switches with it.
      openUrl:
        tabBijectionOptions?.openUrl ??
        ((url: string) =>
          openBrowserUrl(url, {
            background: shouldOpenTabInBackground({
              projectRoot: canonicalProjectRoot(projectRoot),
              env: process.env,
            }),
          })),
      journal: journalEvent,
      probeTabs: (tabIds) => heartbeat.probe(tabIds),
      sendToTab: (tabId, event, data) =>
        sendToTab(tabId, event, {
          ...(typeof data === 'object' && data !== null ? data : {}),
          participantId,
        }),
      // The HOST lifecycle owns no participant, so its session-end
      // broadcast is genuinely everyone; a per-participant lifecycle
      // stays inside its own participant's connections.
      broadcastToClients: (event, data) =>
        sendToAllClients(
          event,
          { ...(typeof data === 'object' && data !== null ? data : {}), participantId },
          participantId ?? undefined,
        ),
      lastIndexRequestAt: () => lastIndexRequestAt,
      maintain: maintain && tabBijectionOptions !== null,
    });
  const hostTabLifecycle = makeTabLifecycle(null, true);
  /**
   * The tab table's transport. It exists even for a `--no-open` session (no
   * bijection controller at all): presence is not a maintenance feature, it
   * is how `vgai status` and the relay know whether anybody is home, and a
   * headless session that a person later opens the URL on must still see
   * that tab. Beats with no controller to feed simply have nowhere to land.
   */
  const heartbeat = createTabHeartbeatServer({
    authorize: (request) =>
      isAllowedEditorOrigin(
        headerValue(request, 'origin'),
        process.env['VGAI_EDITOR_HOST'] ? [process.env['VGAI_EDITOR_HOST']] : [],
      )
        ? null
        : 'Cross-origin request rejected.',
    beat: (beat) => {
      const answer = hostTabLifecycle.onBeat(beat);
      // The phase the page's main thread is inside, carried on the beat
      // because the page's own socket cannot send once it is blocked. The
      // stall diagnosis reads livePlayPhase; this is its second road.
      if (beat.phase !== undefined && hostTabLifecycle.blessedTabId() === beat.tabId &&
          hostTabLifecycle.tab(beat.tabId)?.epoch === beat.epoch) {
        // Two roads carry the same announcement; journal a CHANGE, not both
        // copies (a session's builds wrote 121 lines in eight minutes).
        const next = acceptPagePhase(livePlayPhase, { phase: beat.phase,
          ...(beat.phaseSource === undefined ? {} : { source: beat.phaseSource }),
          ...(beat.phaseSequence === undefined ? {} : { sequence: beat.phaseSequence }),
          at: Date.now(), run: 0, receivedAt: Date.now() });
        const changed = livePlayPhase?.phase !== next.phase;
        livePlayPhase = next;
        if (changed) journalEvent({ kind: 'page-phase', phase: next.phase });
      }
      return answer;
    },
    hint: () => hostTabLifecycle.tick(),
  });
  let hostParticipantId: string | null = null;
  const participantTabLifecycles = new Map<string, TabLifecycleController>();
  const clientTabLifecycles = new Map<string, TabLifecycleController>();
  const tabLifecycleForParticipant = (
    participantId: string,
    hostEligible = true,
  ): TabLifecycleController => {
    const existing = participantTabLifecycles.get(participantId);
    if (existing) return existing;
    if (hostEligible) {
      // EVERY local page shares the host's tab table. A participant id is
      // localStorage per browser PROFILE, and `open <url>` lands in whichever
      // profile window the owner last touched — so a tab opened by a later
      // `vgai edit` routinely carries a participant id the first tab never
      // had. Giving that id its own lifecycle split one tab's facts across
      // two tables: its heartbeat reached the host table (beats carry no
      // participant), its control channel reached the new table, and the
      // host table read a beating tab with no channel — the zombie rule —
      // and told it to yield 30 s after it appeared. Measured on the blind
      // modeling bench (2026-09-05): every replacement tab of a session died
      // that way, 8 of 8, until the agent gave up. The host PARTICIPANT ID
      // (control ownership) stays the first local one; only the table is
      // shared, which is what "one tab per edited game" meant all along.
      if (hostParticipantId === null) hostParticipantId = participantId;
      participantTabLifecycles.set(participantId, hostTabLifecycle);
      return hostTabLifecycle;
    }
    const lifecycle = makeTabLifecycle(participantId, false);
    participantTabLifecycles.set(participantId, lifecycle);
    return lifecycle;
  };
  // The filesystem half of the session. Constructed BEFORE the route context,
  // because the context reads several of its outputs; it takes live root
  // getters rather than values so a project switch moves it too.
  const watch = createProjectWatch({
    engineRoot,
    consoleLedger,
    projectRoot: () => projectRoot,
    publicRoot: () => publicRoot,
    journalEvent,
    servingProjectSince: () => servingProjectSince,
    currentCollaboration,
    bindCollaboration,
    recentAgentAuthor: () => recentAgentAuthor,
    readProjectManifest,
  });
  const startWatcher = watch.start;
  // ---- Editor command relay + state ----
  let editorState: Record<string, unknown> = {};
  const editorStatesByClient = new Map<
    string,
    { state: Record<string, unknown>; updatedAt: number }
  >();
  // When `editorState` was last POSTed by a browser tab (epoch ms), so a
  // caller reading a cached snapshot (no live SSE client, `connected: false`
  // below) can say HOW STALE it is instead of just THAT it's stale. `null`
  // until the first POST of this server's lifetime (or after a project
  // switch clears the cache).
  let editorStateUpdatedAt: number | null = null;

  const collaborationOr400 = (res: Response) => {
    const collaboration = currentCollaboration();
    if (!collaboration) res.status(400).json({ error: 'No project is open.' });
    return collaboration;
  };
  const defaultCollaborationRole = (
    participantId: string,
    invitedRole?: CollaborationRole,
  ): CollaborationRole => {
    const collaboration = currentCollaboration();
    if (!collaboration) return 'viewer';
    if (invitedRole) return invitedRole;
    return localCollaborationRole(
      collaboration.hasMaintainer(),
      collaboration.roleFor(participantId),
    );
  };

  const localOwnerRequest = (req: Request): boolean => {
    const address = req.socket.remoteAddress ?? '';
    const loopback = address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
    return loopback && trustedShareIdentity(req) === null;
  };

  const requireLocalOwner = (req: Request, res: Response): boolean => {
    if (localOwnerRequest(req)) return true;
    res.status(403).json({ error: 'Worktree controls are local to the editor owner.' });
    return false;
  };

  /** The play-run log file being appended to. Owned by the log family's
   *  session routes; the relay's recording route names it in its manifest. */
  let activeLogFile: string | null = null;

  const mutationTails = new Map<string, Promise<void>>();
  const sourceVersions = new Map<string, Array<{ revision: number; content: string | null }>>();
  const sourceConflictTickets = new Map<string, { paths: Set<string>; expiresAt: number }>();
  /**
   * Read a path's remembered versions and mark it as the most recently USED.
   *
   * A `Map` iterates in insertion order, so evicting `keys().next()` drops the
   * oldest-INSERTED path — the file everyone keeps editing was still first out,
   * which is the opposite of what the cache is for. Re-inserting on every
   * access is what makes that eviction a true LRU.
   */
  const touchSourceVersions = (
    path: string,
  ): Array<{ revision: number; content: string | null }> | null => {
    const versions = sourceVersions.get(path);
    if (!versions) return null;
    sourceVersions.delete(path);
    sourceVersions.set(path, versions);
    return versions;
  };
  const rememberSourceVersion = async (
    path: string,
    absolute: string,
    revision: number,
  ): Promise<void> => {
    const versions = touchSourceVersions(path) ?? [];
    if (versions.some((entry) => entry.revision === revision)) return;
    let content: string | null;
    try {
      const info = await stat(absolute);
      if (!info.isFile() || info.size > 2 * 1024 * 1024) return;
      content = await readFile(absolute, 'utf8');
      if (content.includes('\0')) return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return;
      content = null;
    }
    versions.push({ revision, content });
    sourceVersions.delete(path);
    sourceVersions.set(path, versions.slice(-4));
    if (sourceVersions.size > 100) {
      const oldest = sourceVersions.keys().next().value;
      if (oldest) sourceVersions.delete(oldest);
    }
  };
  const withResourceMutationLock = async <T>(
    paths: readonly string[],
    task: () => Promise<T>,
  ): Promise<T> => {
    const ordered = [...new Set(paths)].sort();
    const predecessors = ordered.map((path) => mutationTails.get(path) ?? Promise.resolve());
    let release = () => {};
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    for (const path of ordered) mutationTails.set(path, gate);
    await Promise.all(predecessors);
    try {
      return await task();
    } finally {
      release();
      for (const path of ordered) {
        if (mutationTails.get(path) === gate) mutationTails.delete(path);
      }
    }
  };

  const commitProjectMutation = async (
    req: Request,
    resources: readonly { path: string; content: string | Buffer | null }[],
  ) => {
    const trusted = trustedShareIdentity(req);
    const normalized = await Promise.all(
      resources.map(async (resource) => {
        const path = resource.path.split('\\').join('/');
        const absolute = resolve(projectRoot, path);
        if (!isContainedRelativePath(path) || !isPathInside(projectRoot, absolute)) {
          throw new Error(`Project mutation path is outside the project: ${resource.path}`);
        }
        if (trusted && !(await isCanonicalWritePathInside(projectRoot, absolute))) {
          throw new Error(`Shared project mutation path leaves the project: ${resource.path}`);
        }
        return { ...resource, path, absolute };
      }),
    );
    return withResourceMutationLock(
      normalized.map((resource) => resource.path),
      async () => {
        const collaboration = currentCollaboration();
        const body = (req.body ?? {}) as Record<string, unknown>;
        const localClaim =
          typeof body['participantId'] === 'string' &&
          localParticipantIds.has(body['participantId'])
            ? body['participantId']
            : null;
        const actorId =
          trusted?.participantId ?? localClaim ?? filesystemMutationAuthor(recentAgentAuthor);
        if (collaboration) {
          const states = new Map(
            collaboration
              .resourceStates(normalized.map((resource) => resource.path))
              .map((state) => [state.path, state.revision]),
          );
          await Promise.all(
            normalized.map((resource) =>
              rememberSourceVersion(
                resource.path,
                resource.absolute,
                states.get(resource.path) ?? collaboration.snapshot().revision,
              ),
            ),
          );
        }
        if (collaboration && trusted) {
          if (!Number.isInteger(body['expectedRevision'])) {
            throw new Error('Remote project mutations require expectedRevision.');
          }
          collaboration.assertSourceMutation(
            actorId,
            body['expectedRevision'] as number,
            normalized.map((resource) => resource.path),
          );
        } else if (collaboration && localClaim && Number.isInteger(body['expectedRevision'])) {
          collaboration.assertSourceMutation(
            actorId,
            body['expectedRevision'] as number,
            normalized.map((resource) => resource.path),
          );
        }
        for (const resource of normalized) {
          const sha =
            resource.content === null
              ? null
              : createHash('sha256').update(resource.content).digest('hex').slice(0, 16);
          // Atomic renames can produce both add and change events. Retain the
          // digest briefly so every duplicate event for this one write is
          // ignored; a different digest invalidates it immediately.
          watch.expectedEditorMutations.set(resource.path, { sha, expiresAt: Date.now() + 5_000 });
        }
        while (watch.expectedEditorMutations.size > 200) {
          const oldest = watch.expectedEditorMutations.keys().next().value;
          if (!oldest) break;
          watch.expectedEditorMutations.delete(oldest);
        }
        for (const resource of normalized) {
          if (resource.content === null) {
            await unlinkIfPresent(resource.absolute);
            continue;
          }
          await mkdir(dirname(resource.absolute), { recursive: true });
          const temporary = join(
            dirname(resource.absolute),
            `.${basename(resource.absolute)}.vgai-${randomUUID()}.tmp`,
          );
          try {
            await writeFile(temporary, resource.content);
            await rename(temporary, resource.absolute);
          } finally {
            await unlinkIfPresent(temporary);
          }
        }
        const committed = await Promise.all(
          normalized.map(async (resource) => ({
            path: resource.path,
            sha: resource.content === null ? null : (await hashAndSize(resource.absolute)).hash,
          })),
        );
        const recorded = collaboration?.recordSourceMutation({
          authorId: actorId,
          source: 'editor',
          resources: committed,
        });
        if (recorded || !collaboration) return recorded;
        // A filesystem observer may have won the event-loop race after the
        // atomic rename. If it already recorded these exact resulting bytes,
        // return that real revision rather than reporting a null mutation.
        const states = collaboration.resourceStates(committed.map((resource) => resource.path));
        const matchingRevision = Math.max(
          0,
          ...states
            .filter((state, index) => state.sha === committed[index]?.sha)
            .map((state) => state.revision),
        );
        return (
          collaboration
            .snapshot()
            .revisions.find((revision) => revision.revision === matchingRevision) ?? null
        );
      },
    );
  };

  const projectMutationError = (res: Response, error: unknown): void => {
    if (error instanceof CollaborationConflictError) {
      const collaboration = currentCollaboration();
      const conflictId = randomUUID();
      for (const [id, ticket] of sourceConflictTickets) {
        if (ticket.expiresAt < Date.now()) sourceConflictTickets.delete(id);
      }
      if (sourceConflictTickets.size >= 100) {
        const oldest = sourceConflictTickets.keys().next().value;
        if (oldest) sourceConflictTickets.delete(oldest);
      }
      sourceConflictTickets.set(conflictId, {
        paths: new Set(error.resources),
        expiresAt: Date.now() + 10 * 60 * 1_000,
      });
      res.status(409).json({
        code: 'SOURCE_REVISION_CONFLICT',
        conflictId,
        expectedRevision: error.expectedRevision,
        currentRevision: error.currentRevision,
        conflicts: collaboration?.resourceStates(error.resources) ?? [],
        bases: Object.fromEntries(
          error.resources.flatMap((path) => {
            const version = touchSourceVersions(path)
              ?.filter((candidate) => candidate.revision <= error.expectedRevision)
              .at(-1);
            return version ? [[path, version.content]] : [];
          }),
        ),
      });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  };

  // ---- The closure, named once ----
  // Everything above this line is the editor session's state. Everything below
  // it is routing. `ctx` is the one hand-off between the two: see
  // `routes/context.ts` for why mutable session state crosses as accessors
  // rather than as values.
  const ctx: RouteContext = {
    engineRoot,
    get projectRoot() {
      return projectRoot;
    },
    set projectRoot(next: string) {
      projectRoot = next;
    },
    get publicRoot() {
      return publicRoot;
    },
    set publicRoot(next: string) {
      publicRoot = next;
    },
    account,
    commitProjectMutation,
    projectMutationError,
    sourceConflictTickets,
    readProjectManifest,
    loadProjectModule,
    currentProjectComponents: watch.currentProjectComponents,
    currentSessionIdentity,
    localOwnerRequest,
    requireLocalOwner,
    launcherSettingsPath,
    recentProjectsPath,
    recordRecentProject,
    startWatcher,
    reconcileGenerations,
    compatibilityIdentity,
    enginePromise,
    editorStatesByClient,
    consoleLedger,
    projectValidation: watch.projectValidation,
    projectWarnings: watch.projectWarnings,
    currentValidationLogEntries: watch.currentValidationLogEntries,
    clientIdsForTab,
    participantConnections,
    tabIdForClient,
    clientTabIds,
    hostTabLifecycle,
    participantTabLifecycles,
    clientTabLifecycles,
    tabLifecycleForParticipant,
    onTabReloaded: (listener) => {
      tabReloadListeners.add(listener);
    },
    tabBijectionOptions,
    heartbeat,
    pageErrorsByClient,
    participantLeaveTimers,
    short,
    get livePlayPhase() {
      return livePlayPhase;
    },
    set livePlayPhase(next: PlayPhaseRecord | null) {
      livePlayPhase = next;
    },
    get hostParticipantId() {
      return hostParticipantId;
    },
    set hostParticipantId(next: string | null) {
      hostParticipantId = next;
    },
    get publicAssetsLastChangedAt() {
      return watch.publicAssetsLastChangedAt;
    },
    set publicAssetsLastChangedAt(next: number | null) {
      watch.publicAssetsLastChangedAt = next;
    },
    get publicAssetsLastPath() {
      return watch.publicAssetsLastPath;
    },
    set publicAssetsLastPath(next: string | null) {
      watch.publicAssetsLastPath = next;
    },
    get publicAssetsChangedCount() {
      return watch.publicAssetsChangedCount;
    },
    set publicAssetsChangedCount(next: number) {
      watch.publicAssetsChangedCount = next;
    },
    get lastIndexRequestAt() {
      return lastIndexRequestAt;
    },
    set lastIndexRequestAt(next: number | null) {
      lastIndexRequestAt = next;
    },
    get sourceValidation() {
      return watch.sourceValidation;
    },
    set sourceValidation(next: SourceValidationState) {
      watch.sourceValidation = next;
    },
    get servingProjectSince() {
      return servingProjectSince;
    },
    set servingProjectSince(next: number) {
      servingProjectSince = next;
    },
    get journal() {
      return journal;
    },
    set journal(next: SessionJournal | null) {
      journal = next;
    },
    get cadenceGate() {
      return watch.cadenceGate;
    },
    set cadenceGate(next: TripwireGate) {
      watch.cadenceGate = next;
    },
    get unplayedGate() {
      return watch.unplayedGate;
    },
    set unplayedGate(next: TripwireGate) {
      watch.unplayedGate = next;
    },
    get editorState() {
      return editorState;
    },
    set editorState(next: Record<string, unknown>) {
      editorState = next;
    },
    get editorStateUpdatedAt() {
      return editorStateUpdatedAt;
    },
    set editorStateUpdatedAt(next: number | null) {
      editorStateUpdatedAt = next;
    },
    harnessChat,
    frontendRefusal: () => harnessChat.frontendRefusal(),
    projectWork,
    journalEvent,
    announceBuildDisciplineTripwires: watch.announceBuildDisciplineTripwires,
    get activeLogFile() {
      return activeLogFile;
    },
    set activeLogFile(next: string | null) {
      activeLogFile = next;
    },
    options,
    currentCollaboration,
    currentCollaborationLocation,
    collaborationOr400,
    defaultCollaborationRole,
    markAgentTurnRunning,
    markAgentTurnEnded,
    teamMirror,
    postMirroredTeamMessages,
    localParticipantIds,
    trustedShareIdentity,
    browserShareControlSecret,
    get shareHost() {
      return shareHost;
    },
    set shareHost(next: ShareHost | null) {
      shareHost = next;
    },
    get localShareHost() {
      return localShareHost;
    },
    set localShareHost(next: {
      participantId: string;
      account: TrustedShareIdentity['account'];
    } | null) {
      localShareHost = next;
    },
  };

  // ---- Router ----
  const router = express.Router() as EditorServerRouter;
  router.use((req: Request, res: Response, next) => {
    try {
      verifyShareClaimHeaders(shareGatewaySecret, req.method, req.originalUrl, (name) =>
        req.header(name),
      );
      next();
    } catch (error) {
      res.status(403).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  router.use(express.json({ limit: '50mb' }));

  // ---- CSRF / drive-by protection (S3) ----
  // This MUST be installed before every mutating /__editor route, including
  // global account and billing mutations. Express middleware is ordered; the
  // former placement below the account routes silently exempted exactly those
  // routes from the protection it claimed to provide.
  router.use((req: Request, res: Response, next) => {
    const method = req.method.toUpperCase();
    const isMutating =
      method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
    if (isMutating && req.path.startsWith('/__editor')) {
      const host = process.env['VGAI_EDITOR_HOST'];
      const extra = host ? [host] : [];
      if (!isAllowedEditorOrigin(req.headers.origin, extra)) {
        res.status(403).json({ error: 'Cross-origin request rejected.' });
        return;
      }
    }
    next();
  });
  registerAccountRoutes(router, ctx);
  // ---- Cold-Vite verified-open signal ----
  // Stamp `lastIndexRequestAt` for any GET response that turns out to be
  // genuine HTML (status 2xx, `Content-Type: text/html…`) — that is, purely
  // observational, via `res.on('finish')`, so it applies no matter which
  // downstream middleware (Vite, express.static, the SPA fallback) actually
  // produced the response. A cached root document is the one exception:
  // browsers may receive a 304 with no Content-Type, but that request is still
  // positive proof that an editor tab arrived. Missing that reload signal
  // makes tab self-heal open replacements beneath the already-loading tab.
  // API responses are JSON, SSE is `text/event-stream`, and assets carry their
  // own MIME types — none of those match, so only real page loads stamp.
  router.use((req: Request, res: Response, next) => {
    if (req.method === 'GET') {
      res.on('finish', () => {
        const contentType = res.get('Content-Type');
        const servedHtml =
          res.statusCode >= 200 && res.statusCode < 300 && contentType?.includes('text/html');
        const servedCachedIndex = req.path === '/' && res.statusCode === 304;
        if (servedHtml || servedCachedIndex) {
          lastIndexRequestAt = Date.now();
        }
      });
    }
    next();
  });

  // ---- Asset Library (online asset browsing + download) ----
  router.use(
    '/__editor/asset-library',
    createAssetLibraryRouter(() => publicRoot),
  );

  registerProjectAttributionRoute(router, ctx);

  // ---- Project file serving middleware ----
  // Serves the v2 manifest from root and static files from project's public/
  router.use(async (req: Request, res: Response, next) => {
    // Only handle non-API requests when a project is open
    if (projectRoot === engineRoot) return next();
    const pathname = req.path;

    // Skip editor API endpoints
    if (pathname.startsWith('/__')) return next();
    if (pathname.startsWith('/@')) return next();
    if (pathname.startsWith('/node_modules')) return next();

    // Serve the RAW manifest (no view synthesis — the browser-side adapter
    // resolver parses it itself via the pure `@vgai/project/manifest/load` half;
    // T3.3 slice 2 part C) from the project root, not public/. 404s (falls
    // through to `next()`, same as any other missing project-root file) for
    // folders without a valid manifest.
    if (pathname === `/${MANIFEST_FILENAME}`) {
      const manifestPath = resolveManifestPath(projectRoot);
      if (trustedShareIdentity(req) && !(await isCanonicalPathInside(projectRoot, manifestPath))) {
        res.status(403).json({ error: 'Shared path leaves the project root.' });
        return;
      }
      try {
        const raw = await readFile(manifestPath, 'utf-8');
        res.setHeader('Content-Type', 'application/json');
        res.send(raw);
      } catch {
        next();
      }
      return;
    }

    const filePath = resolve(publicRoot, pathname.slice(1));
    // `isPathInside`, not `startsWith`: a bare prefix test admits the SIBLING
    // `<root>/publicX/…` as if it were inside `<root>/public`.
    if (!isPathInside(publicRoot, filePath)) return next();

    try {
      const s = await stat(filePath);
      if (!s.isFile()) return next();
      if (trustedShareIdentity(req) && !(await isCanonicalPathInside(publicRoot, filePath))) {
        res.status(403).json({ error: 'Shared path leaves the public project root.' });
        return;
      }
      const data = await readFile(filePath);
      // Public files include executable web assets, not only model/media formats.
      res.type(extname(filePath));
      res.setHeader('Content-Length', s.size);
      res.end(data);
    } catch {
      next();
    }
  });

  registerProjectIdentityRoutes(router, ctx);

  registerServedModuleRoutes(router, ctx);

  registerWorktreeRoutes(router, ctx);

  registerShareControlRoutes(router, ctx);

  registerProjectSourceRoutes(router, ctx);

  registerCollaborationRoutes(router, ctx);

  const plane = createControlPlane(router, ctx);

  registerSessionTabRoutes(router, ctx, plane);

  registerAgentRoutes(router, ctx);

  registerRelayRoutes(router, ctx, plane);

  registerProjectStateRoutes(router, ctx, plane);

  registerAssetRoutes(router, ctx);

  registerBuildRoutes(router, ctx);
  registerConfigurationRoutes(router, ctx);
  registerSettingsRoutes(router, ctx);
  registerThemeRoutes(router, ctx);

  registerProjectOpenRoutes(router, ctx);

  registerToolRoutes(router, ctx);

  registerModuleTransportNotFound(router, ctx);

  registerLogRoutes(router, ctx);

  router.notifyTabSessionEnded = async () => {
    await Promise.all(
      [...new Set([hostTabLifecycle, ...participantTabLifecycles.values()])].map((lifecycle) =>
        lifecycle?.notifySessionEnded(),
      ),
    );
  };

  router.sessionJournalPath = () => journal?.path ?? null;
  router.frontendRefusal = () => harnessChat.frontendRefusal();
  router.frontendHandoff = async () => {
    const handoff = await harnessChat.frontendHandoff();
    // A Chat view with no runtime behind it is REMAINING WORK, not log noise:
    // it rides the unresolved-console ledger, so every `vgai` command reprints
    // it and exits non-zero until the harness is signed in or the condition is
    // acked with a reason. The extension's own empty state says the same thing
    // in the panel; this is the half a terminal can read.
    if (handoff.refusal) {
      consoleLedger.observe({
        severity: 'warn',
        message: `The Chat view has no agent runtime: ${handoff.refusal}`,
        source: 'session/frontend-handoff',
        loadId: 'session',
      });
    }
    return handoff;
  };

  router.journalShutdownTask = (record) => {
    journalEvent({ kind: 'session-shutdown-task', ...record });
  };

  router.close = async () => {
    // Best-effort: a SIGKILL logs nothing, and the ABSENCE of this line is
    // what identifies that case (same reasoning as dev.ts's last-gasp line).
    journalEvent({ kind: 'session-shutdown' });
    currentCollaboration()?.flush();
    plane.close();
    heartbeat.close();
    for (const lifecycle of new Set([hostTabLifecycle, ...participantTabLifecycles.values()])) {
      lifecycle?.stop();
    }
    for (const agent of collaborationAgents.values()) {
      collaborationSession(agent.projectRoot).leave(agent.participantId);
    }
    collaborationAgents.clear();
    for (const timer of participantLeaveTimers.values()) clearTimeout(timer);
    participantLeaveTimers.clear();
    collaborationUnsubscribe?.();
    collaborationUnsubscribe = null;
    clearInterval(generationReconcileTimer);
    engineSourceRestartGate?.dispose();
    workspaceIdentityRestartMonitor?.dispose();
    await Promise.all([
      watch.close(),
      engineSourceWatcher?.close(),
      harnessChat.close(),
      // Declared processes die with the session (`routes/run.ts`).
      stopAllConfigurations(),
      shareHost?.stop(),
      projectWork.close(),
    ]);
  };

  return router;
}
