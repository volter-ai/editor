/**
 * Volter host adapter for Supercode's headless client.
 *
 * Supercode owns harness/session/runtime semantics, lifecycle normalization,
 * transcript projection, retries, reconciliation, and concurrency. Volter owns
 * authenticated local launch controls and the HTTP/SSE boundary. Native Chat
 * owns presentation and conversation-scoped approval choices. Keep this file as a mapping layer; reusable agent logic
 * belongs in @volter/supercode-client.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { NormalizedSession, SessionDescriptor } from '@volter/supercode-harness-sdk';
import {
  type projectClientSnapshot,
  projectSubagentInventory,
  projectSubagentTranscript,
} from '@volter/supercode-ui/controller';
import type { SupercodeUiIntent, SupercodeUiState } from '@volter/supercode-ui/core';
import {
  createRemoteControllerHost,
  type RemoteControllerHost,
  type RemoteUiFrame,
} from '@volter/supercode-ui/host';
import type {
  HarnessChatCapabilities,
  HarnessChatHarness,
  HarnessChatSession,
  HarnessChatSnapshot,
  HarnessChatTaskPlan,
  JsonValue,
} from '../src/harness-chat-types';
import { unavailableHarnessChatSnapshot } from '../src/harness-chat-types';
import type { ResolvedCodingInference } from './account-service';
import { type HarnessReadiness, withCodingInference } from './coding-inference-launch';
import {
  type FrontendHandoff,
  FRONTEND_UNAVAILABLE_ENV,
  mintFrontendHandoff,
} from './frontend-handoff';
import { FrontendControls, DEFAULT_CHAT_SELECTION, chatModels, selectedChatLaunch, validateChatSelection, type ChatSelection } from './frontend-controls';
import { effectiveChat } from './harness-effective';
import { ChatSessionCatalog } from './chat-session-catalog';
import { CHAT_SETUP_PROVIDERS, chatExecutable, chatProcessEnvironment, chatSetupActions, chatSetupAgents, signInPath } from './chat-setup';
import { projectMcpServers } from './project-mcp-servers';
import type { HarnessChatCallerSession } from './harness-chat-caller';

type HeadlessUiSnapshot = Parameters<typeof projectClientSnapshot>[0];

// @volter/supercode-client is an optional runtime peer. The mandatory UI
// package already declares its exact frontend snapshot contract, so do not
// shadow that contract with a partial Volter interface. The validator loaded
// atomically from the runtime peer remains the authority for production data.
type RuntimeCapabilities = HeadlessUiSnapshot['harnesses'][number]['effective_capabilities'];
type StructuredLaunch = Omit<NonNullable<HeadlessUiSnapshot['terminalLaunch']>, 'env'> & {
  env?: Record<string, string>;
};
type HeadlessSessionDescriptor = SessionDescriptor & {
  live_endpoint?: string | null;
  live_status?: 'running' | 'busy' | 'idle' | null;
};
type HeadlessDescriptorMessage = NonNullable<
  HeadlessSessionDescriptor['preview_candidates']
>[number];
type HeadlessConversationEntry = HeadlessUiSnapshot['conversation'][number];
type HeadlessLoadedSession = NonNullable<HeadlessUiSnapshot['activeSession']> & {
  [key: string]: unknown;
};
type HeadlessSnapshot = Omit<HeadlessUiSnapshot, 'activeSession' | 'availableActions'> & {
  activeSession: HeadlessLoadedSession | null;
  // Optional only for a rolling package upgrade: the new controller owns this
  // field, while an already-running older optional peer must remain readable
  // until the editor dependency update lands.
  history?: { transcriptLimit: number | null; hasEarlier: boolean };
  availableActions: HeadlessUiSnapshot['availableActions'] & { loadEarlier: boolean };
};
type HeadlessAction =
  | { type: 'refresh'; autoObserve?: boolean; silent?: boolean }
  | { type: 'observe'; sessionKey: string }
  | { type: 'loadEarlier' }
  | { type: 'start'; harness: string }
  | { type: 'resume'; sessionKey: string }
  | { type: 'attach'; sessionKey: string; baseUrl?: string }
  | { type: 'branch'; sessionKey: string; targetHarness?: string }
  | { type: 'reduce'; sessionKey: string; targetHarness?: string }
  | { type: 'restore'; identity: string; connection: 'observe' | 'attach' }
  | { type: 'detach' }
  | { type: 'openTerminal' }
  | {
      type: 'send';
      text: string;
      context?: Array<{ id?: string; kind?: string; label: string; detail: string }>;
      images?: Array<{ id?: string; label: string; url: string }>;
    }
  | { type: 'steer'; text: string }
  | { type: 'interrupt' }
  | {
      type: 'configureHarness';
      harness: string;
      changes: Array<{ key: string; value: string | null }>;
      expectedRevision: string;
    }
  | { type: 'respond'; requestId: JsonValue; optionId: string | null }
  | { type: 'respond'; requestId: JsonValue; response: JsonValue };
type HeadlessController = {
  getSnapshot(): HeadlessSnapshot;
  subscribe(listener: () => void): () => void;
  initialize(): Promise<HeadlessSnapshot>;
  dispatch(action: HeadlessAction): Promise<HeadlessSnapshot>;
  loadSession(sessionKey: string, options?: {view?: {displayHistory?: boolean; tailMessages?: number; maxMessageChars?: number; includeSubagents?: boolean}}): Promise<HeadlessLoadedSession>;
  setWorkspace(workspace: string, options?: { autoObserve?: boolean }): Promise<HeadlessSnapshot>;
  close(): Promise<void>;
};
type HeadlessControllerConstructor = new (options: {
  client: SupercodeClient;
  workspace: string;
  /** Supercode's own `SupercodeControllerOptions['policy']`. It decides whether the
   *  runtime launch skips the harness's permission prompts — see {@link RUNTIME_POLICY}. */
  policy: 'default' | 'yolo';
  ownsClient: true;
  autoObserve: boolean;
  allowHarnessConfiguration?: boolean;
}) => HeadlessController;
/** The fields of the SDK's `ObservedRuntimeEvent` (its `NormalizedRuntimeEvent`)
 *  this service reads. Optional because the runtime is an optional peer. */
type ObservedChatRuntimeEvent = {
  type?: string;
  kind?: string;
  role?: string;
  text?: string | null;
  requestId?: unknown;
  raw?: { payload?: unknown };
};
type HeadlessManagedRuntime = {
  readonly closed?: boolean;
  on?(
    event: 'event',
    listener: (event: ObservedChatRuntimeEvent) => void,
  ): unknown;
  /** The SDK's own `RuntimeHandle`. `runtime_id` is the string the runtime wrote into
   *  its live receipt as `runtime_session_id`, so it is how the frontend handoff finds
   *  the loopback address and the mint door. */
  readonly handle?: { harness: string; runtime_id: string; endpoint?: string | null };
  steer(text: string): Promise<Record<string, never>>;
};
type HeadlessSnapshotAssertion = (value: unknown) => HeadlessSnapshot;
type HeadlessProjectConversation = (session: HeadlessLoadedSession) => HeadlessConversationEntry[];
type HeadlessDeriveTaskPlan = (session: HeadlessLoadedSession | null) => HarnessChatTaskPlan;
type HeadlessSessionIdentity = (locator: HeadlessSessionDescriptor['locator']) => Promise<string>;
type SupercodeClient = {
  close(): Promise<void>;
  discover(query: {
    workspace?: string;
    query?: string;
    harnesses?: string[];
    limit?: number;
    include_topic_candidates?: boolean;
    include_child_sessions?: boolean;
  }): Promise<{ sessions: HeadlessSessionDescriptor[] }>;
  load(
    locator: HeadlessSessionDescriptor['locator'],
    options?: {
      view?: { tailMessages?: number; maxMessageChars?: number; includeSubagents?: boolean; displayHistory?: boolean };
    },
  ): Promise<{ session: NormalizedSession }>;
  /** Supercode's own readiness inventory — `installed`, `auth`, and the `repair` text
   * naming that harness's login command. The SDK's `listHarnesses`, not a shell-out. */
  listHarnesses?(query?: {
    workspace?: string;
    harnesses?: string[];
    probe?: 'passive' | 'handshake';
    include_sessions?: boolean;
    skip_versions?: boolean;
  }): Promise<{ harnesses: SupercodeLocalHarness[] }>;
  [key: string]: unknown;
};
type SupercodeLocalHarness = {
  id: string;
  display_name: string;
  installed: boolean;
  auth: HarnessReadiness['auth'];
  reason: string | null;
  repair: string | null;
};
type SupercodeClientConstructor = new (options?: {
  command?: string;
  cwd?: string;
  env?: Record<string, string>;
}) => SupercodeClient;

type ChatProcessContext = Awaited<ReturnType<typeof chatProcessEnvironment>> & { supercode: string | undefined };

/** Use the native harness's default permission policy for Chat and terminal launches. */
const RUNTIME_POLICY = 'default' as const;

/**
 * WHICH AGENT FILLS THE CHAT VIEW: whichever one supercode says can run here. Supercode
 * probes every harness it knows (Claude Code, Codex, Grok, Gemini, …) and reports, per
 * harness, whether it is installed and signed in and what it can do now
 * (`availableActions`); the editor names none of them. A project's own most recent
 * session is resumed with the harness that ran it, when that harness can still resume;
 * otherwise only a harness the SDK marks autoStart is selected automatically. When none
 * can, the refusal names each one with supercode's own reason and repair.
 */
function harnessRefusal(harnesses: readonly HarnessChatHarness[]): string {
  if (harnesses.length === 0) return 'Volter Harness reports no coding agents on this machine, so the Chat view has none to start.';
  const lines = harnesses.map((harness) => {
    const why = harness.reason ?? (harness.installed ? `not ready (${harness.auth})` : 'not installed');
    return `${harness.label}: ${why}${harness.repair ? ` — ${harness.repair}` : ''}`;
  });
  return `No coding agent was automatically selected. Sign in or choose an installed agent. ${lines.join('; ')}.`;
}

/** What the host gets back: the environment to spawn the REH with, or why there is none. */
export interface FrontendHandoffResult {
  readonly env: Readonly<Record<string, string>>;
  readonly refusal: string | null;
}

const MANAGED_RUNTIME_METHODS = new Set([
  'startManagedRuntime',
  'resumeManagedRuntime',
  'attachManagedRuntime',
]);
const MANAGED_RUNTIME_START_TIMEOUT_MS = 180_000;

/** Retain the SDK's own managed-runtime object without changing its behavior. */
export function withManagedRuntimeObserver(
  client: SupercodeClient,
  observe: (runtime: HeadlessManagedRuntime) => void,
  transformBackend: (backend: unknown) => Promise<unknown> = async (backend) => backend,
): SupercodeClient {
  return new Proxy(client, {
    get(target, property) {
      const value = Reflect.get(target, property, target) as unknown;
      if (!MANAGED_RUNTIME_METHODS.has(String(property)) || typeof value !== 'function') {
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return async (...args: unknown[]) => {
        const suppliedOptions =
          args[1] && typeof args[1] === 'object' && !Array.isArray(args[1])
            ? (args[1] as Record<string, unknown>)
            : {};
        const runtime = (await Reflect.apply(value, target, [
          await transformBackend(args[0]),
          { ...suppliedOptions, timeoutMs: MANAGED_RUNTIME_START_TIMEOUT_MS },
        ])) as HeadlessManagedRuntime;
        observe(runtime);
        return runtime;
      };
    },
  });
}

/**
 * One Chat runtime event, reduced to what the tripwires need: where a turn
 * starts and ends, when the agent is talking in the Chat (a watcher can see
 * that), and when the turn is waiting on the person (an approval or question
 * is pending — never a moment to steer).
 */
export type ChatRuntimeActivity =
  | 'turn-started'
  /** A synthetic reopen within `STEER_ECHO_WINDOW_MS` of this editor's own
   *  steer: the same real turn carrying on (or the turn the steer itself
   *  started), so the per-turn nudge allowance must NOT reset. */
  | 'turn-resumed'
  | 'turn-ended'
  | 'narration'
  | 'waiting'
  | 'answered'
  | 'other';

/**
 * How long after this editor's own steer a synthetic turn reopen is read as
 * that steer's consequence rather than a new turn, in ms. A steer sent just
 * after Claude Code's `result`, while the runtime still reports busy, can
 * echo back and be answered within seconds; counting that as a fresh turn
 * would hand the same real turn a second nudge.
 */
const STEER_ECHO_WINDOW_MS = 10_000;

/**
 * Is this event the agent's own words, visible to the person in the Chat?
 * Assistant text only — never thinking (`reasoning_delta`), never a tool's
 * streamed input. The SDK projects Claude Code's `stream_event` content-block
 * deltas to `output_delta` whatever the block, so there the delta's own type
 * must be `text_delta`; a hosted runtime's `output_delta` is already text.
 */
function isNarration(event: ObservedChatRuntimeEvent): boolean {
  if (event.type === 'message') {
    return event.role === 'assistant' && typeof event.text === 'string' && event.text.trim() !== '';
  }
  if (event.type !== 'output_delta') return false;
  if (String(event.kind ?? '').toLowerCase() !== 'stream_event') return true;
  const payload = event.raw?.payload as
    | { event?: { delta?: { type?: unknown } }; stream_event?: { delta?: { type?: unknown } }; delta?: { type?: unknown } }
    | undefined;
  const delta = (payload?.event ?? payload?.stream_event ?? payload)?.delta;
  return String(delta?.type ?? '').toLowerCase() === 'text_delta';
}

/**
 * The key one runtime request is tracked under, the same on both of its
 * events. From the wire payload the runtime sent — `payload.request.id` on a
 * `request`, `payload.request_id` on its `request_resolved` (the bundled Chat
 * extension's reads) — because the SDK's normalized `requestId` on a request
 * is read after spreading the request's own inner payload over it, which can
 * replace the id. Stringified, so a numeric id and its string form match.
 */
function runtimeRequestKey(event: ObservedChatRuntimeEvent, type: 'request' | 'request_resolved'): string {
  const wire = event.raw?.payload as
    | { request?: { id?: unknown }; request_id?: unknown }
    | undefined;
  const id = type === 'request'
    ? (wire?.request?.id ?? wire?.request_id ?? event.requestId)
    : (wire?.request_id ?? event.requestId);
  return String(id ?? null);
}

/** Where a Chat turn stands, for a caller deciding whether to steer it.
 *  `unknown` — the runtime could not be read this time (a failed or timed-out
 *  `describe`); nothing was learned, so nothing may be decided on it. */
export type ChatTurnState = 'idle' | 'running' | 'waiting' | 'unknown';

export interface HarnessChatServiceOptions {
  getProjectRoot: () => string;
  onChange: (snapshot: HarnessChatSnapshot) => void;
  initializeTimeoutMs?: number;
  /** Compatibility refresh for clients without an index or external caller sessions.
   * Ordinary indexed workspace sessions do not poll. Zero disables the fallback. */
  discoveryPollMs?: number;
  /** Sessions that invoked volter for this project from outside its workspace. */
  callerSessions?: readonly HarnessChatCallerSession[];
  /** What the Chat's own runtime just did. The native Chat's turns do not pass
   *  through the headless controller, so `onChange` never sees them run; this is
   *  the push signal that one is, for a listener (the visible-progress tripwire)
   *  that must stay idle until a turn starts. Called on every event: cheap. */
  onRuntimeActivity?: (activity: ChatRuntimeActivity) => void;
  /** Trusted account route resolved only when Supercode launches a process. */
  resolveCodingInference?: (workspace: string) => Promise<ResolvedCodingInference | null>;
  /** Test seam. Production loads the real zero-dependency Supercode SDK. */
  createClient?: ((workspace: string) => Promise<SupercodeClient>) | undefined;
  /** Test seam for the framework-neutral controller. */
  createController?:
    | ((
        client: SupercodeClient,
        workspace: string,
        options: { autoObserve: boolean },
      ) => HeadlessController)
    | undefined;
  /** Test seam for Supercode's collision-free descriptor identity. */
  sessionReconnectIdentity?: HeadlessSessionIdentity;
}

function locatorKey(descriptor: HeadlessSessionDescriptor): string {
  const { locator } = descriptor;
  const storage =
    locator.storage.kind === 'file'
      ? `file:${locator.storage.path}`
      : `sqlite:${locator.storage.path}:${locator.storage.selector}`;
  return `${locator.harness}\0${locator.session_id}\0${storage}`;
}

/**
 * Supercode's ordinary controller discovers by workspace. A caller session is
 * different evidence: its native id is authoritative even when its cwd is
 * elsewhere. Ask Supercode globally for only the named harnesses, select the
 * exact ids, and union their full locators into the controller's normal
 * discovery result. No session/workspace association is fabricated or stored.
 */
export function withCallerSessionDiscovery(
  client: SupercodeClient,
  getCallers: () => readonly HarnessChatCallerSession[],
  onDiscover: (sessions: readonly HeadlessSessionDescriptor[]) => void | Promise<void> = () => {},
  getSelectedHarness: () => string = () => '',
): SupercodeClient {
  const topicCandidatesByLocator = new Map<string, HeadlessDescriptorMessage[]>();
  const retainTopicCandidates = (
    sessions: readonly HeadlessSessionDescriptor[],
  ): HeadlessSessionDescriptor[] =>
    sessions.map((descriptor) => {
      const key = locatorKey(descriptor);
      if (descriptor.preview_candidates) {
        topicCandidatesByLocator.set(key, descriptor.preview_candidates);
        return descriptor;
      }
      const retained = topicCandidatesByLocator.get(key);
      return retained ? { ...descriptor, preview_candidates: retained } : descriptor;
    });
  return new Proxy(client, {
    get(target, property) {
      if (property !== 'discover') {
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return async (query: {
        workspace?: string;
        query?: string;
        harnesses?: string[];
        limit?: number;
        include_topic_candidates?: boolean;
        include_child_sessions?: boolean;
      }): Promise<{ sessions: HeadlessSessionDescriptor[] }> => {
        const discover = target.discover.bind(target);
        const includeTopicCandidates = query.include_topic_candidates !== false;
        // The selected agent's project inbox need not scan unrelated native stores.
        // Explicit query harnesses remain authoritative; the picker inventory stays complete.
        const selected = getSelectedHarness();
        const basePromise = discover({ ...query, ...(selected && !query.harnesses?.length ? { harnesses: [selected] } : {}), include_topic_candidates: includeTopicCandidates });
        const callers = getCallers();
        if (callers.length === 0) {
          const base = await basePromise;
          const sessions = retainTopicCandidates(base.sessions);
          await onDiscover(sessions);
          return { sessions };
        }

        const wantedByHarness = new Map<string, Set<string>>();
        for (const caller of callers) {
          const ids = wantedByHarness.get(caller.harness) ?? new Set<string>();
          ids.add(caller.sessionId);
          wantedByHarness.set(caller.harness, ids);
        }
        const supplementalPromise = Promise.all(
          [...wantedByHarness].flatMap(([harness, ids]) => [...ids].map(async (sessionId) => {
            const exact = await discover({
              harnesses: [harness],
              query: sessionId,
              limit: 1,
              include_child_sessions: true,
              include_topic_candidates: includeTopicCandidates,
            });
            return exact.sessions.filter(
              (descriptor) =>
                descriptor.locator.harness === harness && descriptor.locator.session_id === sessionId,
            );
          })),
        );
        const [base, supplemental] = await Promise.all([basePromise, supplementalPromise]);
        const union = new Map(
          base.sessions.map((descriptor) => [locatorKey(descriptor), descriptor]),
        );
        for (const descriptor of supplemental.flat()) {
          union.set(locatorKey(descriptor), descriptor);
        }
        const sessions = retainTopicCandidates([...union.values()]);
        await onDiscover(sessions);
        return { sessions };
      };
    },
  });
}

const EMPTY_CAPABILITIES: HarnessChatCapabilities = {
  startSession: false,
  resumeSession: false,
  attachExistingProcess: false,
  sendInput: false,
  streamEvents: false,
  interrupt: false,
  respondToRequests: false,
};

function capabilities(value: RuntimeCapabilities | undefined): HarnessChatCapabilities {
  if (!value) return { ...EMPTY_CAPABILITIES };
  return {
    startSession: value.start_session,
    resumeSession: value.resume_session,
    attachExistingProcess: value.attach_existing_process,
    sendInput: value.send_input,
    streamEvents: value.stream_events,
    interrupt: value.interrupt,
    respondToRequests: value.respond_to_requests ?? false,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// A cold editor boot can be optimizing Vite dependencies while Supercode scans
// several local harness stores. Real five-harness startup can cross ten seconds
// without being stuck, so keep the failure bounded but leave enough cold-start
// grace for the first inventory pass to finish.
const DEFAULT_INITIALIZE_TIMEOUT_MS = 30_000;

function moduleCandidate(explicit: string | undefined, defaultFile: string): string[] {
  if (!explicit) return [];
  const absolute = resolve(explicit);
  try {
    return [
      existsSync(absolute) && statSync(absolute).isDirectory()
        ? join(absolute, defaultFile)
        : absolute,
    ];
  } catch {
    return [absolute];
  }
}

/** The thrown message reaches the chat panel verbatim, so it stays one
 *  human-sized sentence; the per-candidate resolution dump (absolute paths of
 *  every import attempt) goes to the editor server log instead. */
function unavailableModule(label: string, failures: string[]): Error {
  console.error(`[harness-chat] ${label} failed to load:\n  ${failures.join('\n  ')}`);
  return new Error(
    `${label} could not be loaded in this editor install. The editor server log lists every import location tried.`,
  );
}

async function importOptional<T>(
  label: string,
  exportName: string,
  candidates: string[],
): Promise<T> {
  const failures: string[] = [];
  for (const candidate of candidates) {
    try {
      const specifier = candidate.startsWith('/') ? pathToFileURL(candidate).href : candidate;
      const module = (await import(specifier)) as Record<string, unknown>;
      const value = module[exportName];
      if (value) return value as T;
      failures.push(`${candidate}: missing ${exportName} export`);
    } catch (error) {
      failures.push(`${candidate}: ${errorMessage(error)}`);
    }
  }
  throw unavailableModule(label, failures);
}

async function importOptionalModule<const Names extends readonly string[]>(
  label: string,
  exportNames: Names,
  candidates: string[],
): Promise<{ [Key in Names[number]]: unknown }> {
  const failures: string[] = [];
  for (const candidate of candidates) {
    try {
      const specifier = candidate.startsWith('/') ? pathToFileURL(candidate).href : candidate;
      const module = (await import(specifier)) as Record<string, unknown>;
      const missing = exportNames.filter((name) => !module[name]);
      if (missing.length === 0) return module as { [Key in Names[number]]: unknown };
      failures.push(`${candidate}: missing ${missing.join(', ')} export`);
    } catch (error) {
      failures.push(`${candidate}: ${errorMessage(error)}`);
    }
  }
  throw unavailableModule(label, failures);
}

async function importSupercodePackages(): Promise<{
  SupercodeHarnessClient: SupercodeClientConstructor;
  SupercodeController: HeadlessControllerConstructor;
  assertSupercodeClientSnapshot: HeadlessSnapshotAssertion;
  projectConversation: HeadlessProjectConversation;
  deriveTaskPlan: HeadlessDeriveTaskPlan;
  sessionReconnectIdentity: HeadlessSessionIdentity;
}> {
  const controllerCandidates = [
    ...moduleCandidate(process.env['SUPERCODE_CLIENT_PATH'], 'client.mjs'),
    '@volter/supercode-client',
  ];
  const [SupercodeHarnessClient, clientModule] = await Promise.all([
    importOptional<SupercodeClientConstructor>('Volter Harness SDK', 'SupercodeHarnessClient', [
      ...moduleCandidate(process.env['SUPERCODE_SDK_PATH'], 'client.mjs'),
      '@volter/supercode-harness-sdk',
    ]),
    importOptionalModule(
      'Volter Harness headless client',
      [
        'SupercodeController',
        'assertSupercodeClientSnapshot',
        'projectConversation',
        'deriveTaskPlan',
        'sessionReconnectIdentity',
      ] as const,
      controllerCandidates,
    ),
  ]);
  const SupercodeController = clientModule.SupercodeController as HeadlessControllerConstructor;
  const assertSupercodeClientSnapshot =
    clientModule.assertSupercodeClientSnapshot as HeadlessSnapshotAssertion;
  return {
    SupercodeHarnessClient,
    SupercodeController,
    assertSupercodeClientSnapshot,
    projectConversation: clientModule.projectConversation as HeadlessProjectConversation,
    deriveTaskPlan: clientModule.deriveTaskPlan as HeadlessDeriveTaskPlan,
    sessionReconnectIdentity: clientModule.sessionReconnectIdentity as HeadlessSessionIdentity,
  };
}

async function importSupercodeController(): Promise<{
  SupercodeController: HeadlessControllerConstructor;
  assertSupercodeClientSnapshot: HeadlessSnapshotAssertion;
  projectConversation: HeadlessProjectConversation;
  deriveTaskPlan: HeadlessDeriveTaskPlan;
  sessionReconnectIdentity: HeadlessSessionIdentity;
}> {
  const candidates = [
    ...moduleCandidate(process.env['SUPERCODE_CLIENT_PATH'], 'client.mjs'),
    '@volter/supercode-client',
  ];
  const clientModule = await importOptionalModule(
    'Volter Harness headless client',
    [
      'SupercodeController',
      'assertSupercodeClientSnapshot',
      'projectConversation',
      'deriveTaskPlan',
      'sessionReconnectIdentity',
    ] as const,
    candidates,
  );
  const SupercodeController = clientModule.SupercodeController as HeadlessControllerConstructor;
  const assertSupercodeClientSnapshot =
    clientModule.assertSupercodeClientSnapshot as HeadlessSnapshotAssertion;
  return {
    SupercodeController,
    assertSupercodeClientSnapshot,
    projectConversation: clientModule.projectConversation as HeadlessProjectConversation,
    deriveTaskPlan: clientModule.deriveTaskPlan as HeadlessDeriveTaskPlan,
    sessionReconnectIdentity: clientModule.sessionReconnectIdentity as HeadlessSessionIdentity,
  };
}

function findSourceLinkedSupercodeCommand(): string | undefined {
  let clientRoot: string;
  try {
    clientRoot = dirname(fileURLToPath(import.meta.resolve('@volter/supercode-client')));
  } catch {
    return undefined;
  }
  const sourceRoot = resolve(clientRoot, '..', '..');
  if (!existsSync(join(sourceRoot, 'Cargo.toml'))) return undefined;
  for (const candidate of [
    join(sourceRoot, 'target', 'release', 'supercode'),
    join(sourceRoot, 'target', 'debug', 'supercode'),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  throw new Error(
    `The source-linked Volter Harness SDK at ${clientRoot} has no built core binary. Run \`cargo build --bin supercode\` in ${sourceRoot}.`,
  );
}

/**
 * How to run `supercode <args>` given the resolved command. The installed front door is
 * `bin/supercode.js`, which POSIX runs through its shebang and Windows cannot spawn at all
 * (`spawn UNKNOWN`: a script is not an executable there), so a script runs through this Node.
 */
export function supercodeInvocation(command: string, args: readonly string[]): { command: string; args: string[] } {
  return /\.[cm]?js$/i.test(command)
    ? { command: process.execPath, args: [command, ...args] }
    : { command, args: [...args] };
}

/**
 * Whether `command` is the Teams daemon's own per-version core (`<teams home>/service/bin/<version>/…`).
 * The daemon sets SUPERCODE_BIN to it for the panes it launches, so its hooks call back into the same build; an
 * editor started from such a pane inherits that value, which names whatever release the daemon ran when the pane
 * opened (hours old, and older than the machine's install). It is not a person's override, so Chat does not run on it.
 */
export function isTeamsServiceSupercode(command: string, teamsHome = supercodeTeamsHome()): boolean {
  const normalize = (value: string) => {
    const full = resolve(value);
    return process.platform === 'win32' ? full.toLowerCase() : full;
  };
  const serviceBin = normalize(join(teamsHome, 'service', 'bin'));
  const target = normalize(command);
  return target.startsWith(serviceBin + sep);
}

/** The Teams home as supercode resolves it (crates/harness teams_home, agent global_instructions_dir):
 *  SUPERCODE_TEAMS_HOME, else SUPERCODE_HOME/teams, else XDG_CONFIG_HOME/supercode/teams, else
 *  ~/.config/supercode/teams. An empty variable counts as unset, as it does there. */
function supercodeTeamsHome(env = process.env): string {
  if (env['SUPERCODE_TEAMS_HOME']) return env['SUPERCODE_TEAMS_HOME'];
  if (env['SUPERCODE_HOME']) return join(env['SUPERCODE_HOME'], 'teams');
  if (env['XDG_CONFIG_HOME']) return join(env['XDG_CONFIG_HOME'], 'supercode', 'teams');
  return join(homedir(), '.config', 'supercode', 'teams');
}

export function findSupercodeCommand(cwd = process.cwd(), path = process.env['PATH'] ?? ''): string | undefined {
  const explicit = process.env['SUPERCODE_BIN'];
  if (explicit && !isTeamsServiceSupercode(explicit)) {
    const command = chatExecutable(explicit, cwd, path);
    if (!command) throw new Error(`SUPERCODE_BIN does not resolve to an executable: ${explicit}`);
    return command;
  }
  // A source-linked SDK must run the core from that same checkout. Falling
  // through to an unrelated npm install creates a mixed-version system that
  // can be protocol-compatible enough to start while returning stale or
  // incorrectly classified sessions.
  const sourceCommand = findSourceLinkedSupercodeCommand();
  if (sourceCommand) return sourceCommand;
  const require = createRequire(import.meta.url);
  try {
    const packageRoot = dirname(require.resolve('@volter/supercode/package.json'));
    const installedCommand = join(packageRoot, 'bin', 'supercode.js');
    if (existsSync(installedCommand) && statSync(installedCommand).isFile())
      return installedCommand;
  } catch {
    // Optional dependency omitted: resolve the executable from PATH.
  }
  return chatExecutable('supercode', cwd, path);
}

function shellQuote(value: string): string {
  if (/^[a-zA-Z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function launchCommand(launch: StructuredLaunch): string {
  return `cd ${shellQuote(launch.cwd)} && ${[launch.program, ...launch.arguments].map(shellQuote).join(' ')}`;
}

const TRANSCRIPT_SCAN_MULTIPLIER = 4;

function snapshotStatus(snapshot: HeadlessSnapshot): HarnessChatSnapshot['status'] {
  if (snapshot.availability === 'unavailable') return 'unavailable';
  if (snapshot.availability === 'error') return 'error';
  if (snapshot.availability === 'loading') return 'loading';
  return snapshot.turn.state === 'idle' ? 'ready' : 'working';
}

function snapshotMode(snapshot: HeadlessSnapshot): HarnessChatSnapshot['mode'] {
  if (snapshot.connection.mode === 'mirror') return 'observe';
  if (snapshot.connection.mode === 'control') return 'control';
  return 'none';
}

function toSnapshot(snapshot: HeadlessSnapshot, frame: RemoteUiFrame): HarnessChatSnapshot {
  const taskPlan = snapshot.taskPlan ?? {
    source: 'none',
    items: [],
    residue: [],
    observedAt: null,
  };
  const harnesses: HarnessChatHarness[] = snapshot.harnesses.map((item) => ({
    id: item.id,
    label: item.display_name,
    installed: item.installed,
    auth: item.auth,
    runtime: item.runtime,
    protocol: item.protocol,
    capabilities: capabilities(item.effective_capabilities),
    availableActions: { ...item.availableActions },
    reason: item.reason,
    repair: item.repair,
  }));
  const rowByKey = new Map(frame.state.sessions.map((row) => [row.key, row]));
  // The controller key is the React key of every messenger row. Two rows under
  // one key made React warn 51 times per frame and the messenger's effects
  // loop until "Maximum update depth exceeded" — the crash that took the
  // Agents panel down in every Claude session of the blind modeling bench
  // (2026-09-05). The server saw ONE row whenever it was asked, so the double
  // is transient; it is dropped here (first wins) and journaled with both
  // identities so the next occurrence names its source instead of a stack.
  const seenKeys = new Set<string>();
  const doubled: string[] = [];
  const uniqueSessions = snapshot.sessions.filter((item) => {
    if (seenKeys.has(item.key)) {
      doubled.push(`${item.key} (${item.harness} ${item.sessionId} ${item.identity})`);
      return false;
    }
    seenKeys.add(item.key);
    return true;
  });
  if (doubled.length > 0) {
    console.warn(
      `[harness-chat] the controller listed one session key twice; keeping the first: ${doubled.join('; ')}`,
    );
  }
  const seenRowKeys = new Set<string>();
  const uniqueRows = frame.state.sessions.filter((row) => {
    if (seenRowKeys.has(row.key)) return false;
    seenRowKeys.add(row.key);
    return true;
  });
  const dedupedFrame =
    uniqueRows.length === frame.state.sessions.length
      ? frame
      : { ...frame, state: { ...frame.state, sessions: uniqueRows } };
  const sessions: HarnessChatSession[] = uniqueSessions.map((item) => ({
    // The controller key is intentionally opaque and collision-free. Native
    // IDs can collide between harnesses and stores.
    id: item.key,
    identity: item.identity,
    nativeId: item.sessionId,
    harness: item.harness,
    title: rowByKey.get(item.key)?.title || item.displayTitle?.trim() || 'Untitled chat',
    cwd: item.cwd,
    updatedAt: item.updatedAt,
    messageCount: item.messageCount,
    model: item.model,
    storage: item.storage,
    live: item.liveStatus ?? (item.liveEndpoint ? 'running' : null),
  }));
  const {
    branch: canFork,
    loadEarlier: _canLoadEarlier,
    ...availableActions
  } = snapshot.availableActions;
  return {
    workspace: snapshot.workspace,
    status: snapshotStatus(snapshot),
    mode: snapshotMode(snapshot),
    schema: 'volter.harness-chat.v4',
    serverInstanceId: frame.hostInstanceId,
    revision: snapshot.revision,
    workspaceGeneration: frame.generation,
    operation: snapshot.operation === 'branch' ? 'fork' : snapshot.operation,
    harnesses,
    sessions,
    activeHarness: snapshot.activeHarness,
    activeSessionId: snapshot.activeSessionKey,
    connection: {
      strategy: snapshot.connection.strategy === 'branch' ? 'fork' : snapshot.connection.strategy,
      follow: snapshot.connection.follow,
      ownsRuntime: snapshot.connection.ownsRuntime,
    },
    turn: { ...snapshot.turn },
    frame: dedupedFrame,
    taskPlan: {
      ...taskPlan,
      items: taskPlan.items.map((item) => ({
        ...item,
        ...(item.blockedBy ? { blockedBy: [...item.blockedBy] } : {}),
      })),
      residue: structuredClone(taskPlan.residue),
    },
    requests: snapshot.requests.map((request) => ({
      ...request,
      options: request.options.map((option) => ({ ...option })),
    })),
    availableActions: { ...availableActions, fork: canFork },
    error: snapshot.error
      ? {
          ...snapshot.error,
          operation: snapshot.error.operation === 'branch' ? 'fork' : snapshot.error.operation,
        }
      : null,
    terminalCommand: snapshot.terminalLaunch ? launchCommand(snapshot.terminalLaunch) : null,
  };
}


function unavailable(
  workspace: string | null,
  error: string,
  workspaceGeneration = 0,
  serverInstanceId: string | null = null,
): HarnessChatSnapshot {
  // The ~40-field literal lives in ONE place (`harness-chat-types.ts`); this
  // wrapper only supplies the server's workspace identity on top.
  return {
    ...unavailableHarnessChatSnapshot(error, { code: 'unavailable', recoverable: true }),
    workspace,
    workspaceGeneration,
    serverInstanceId,
  };
}

function loading(
  workspace: string,
  workspaceGeneration: number,
  serverInstanceId: string,
): HarnessChatSnapshot {
  return {
    ...unavailable(workspace, 'Volter Harness is loading.', workspaceGeneration, serverInstanceId),
    status: 'loading' as const,
    error: null,
  };
}

export class HarnessChatService {
  private readonly serverInstanceId = randomUUID();
  private workspace: string | null = null;
  private controller: HeadlessController | null = null;
  private remoteHost: RemoteControllerHost | null = null;
  private unsubscribe: (() => void) | null = null;
  private starting: Promise<void> | null = null;
  private closing: Promise<void> | null = null;
  private workspaceGeneration = 0;
  private closed = false;
  private discoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private discoveryClient: SupercodeClient | null = null;
  private assertSnapshot: HeadlessSnapshotAssertion = (value) => value as HeadlessSnapshot;
  private projectConversation: HeadlessProjectConversation = () => [];
  private deriveTaskPlan: HeadlessDeriveTaskPlan = () => ({
    source: 'none',
    items: [],
    residue: [],
    observedAt: null,
  });
  private lastHeadlessSnapshot: HeadlessSnapshot | null = null;
  private sessionDescriptorsByIdentity = new Map<string, HeadlessSessionDescriptor>();
  private sessionIdentity: HeadlessSessionIdentity | null = null;
  private subagentDescriptorsByKey = new Map<string, HeadlessSessionDescriptor>();
  private subagentInspector: SupercodeUiState['subagentInspector'] = null;
  private inventoryCaptureGeneration = 0;
  private readonly bridgeListeners = new Set<() => void>();
  private lastSnapshot: HarnessChatSnapshot = unavailable(
    null,
    'Volter Harness is loading.',
    0,
    this.serverInstanceId,
  );
  /** The last managed runtime the SDK handed back, for the frontend handoff's receipt lookup. */
  private managedRuntime: HeadlessManagedRuntime | null = null;
  /** Runtime requests (approvals, questions) the person has not answered. */
  private readonly pendingRuntimeRequests = new Set<string>();
  /** Whether the Chat runtime's current turn is open, from its own boundary
   *  events and the synthetic reopen: `null` before any runtime is observed,
   *  `false` when a new one is. */
  private runtimeTurnOpen: boolean | null = null;
  /** Bumped at every runtime turn boundary, so a steer that awaited across one
   *  can tell. */
  private runtimeTurnGeneration = 0;
  /** Has this runtime ever reported a turn START? Claude Code's native stream
   *  ends turns (`result`) but never starts one, so for such a runtime the
   *  open/closed bit is inferred and steering must not be gated on it. */
  private runtimeReportsTurnStarts = false;
  /** The last line this service steered in, and when — so its echo as a user
   *  message, and the reopen it causes, are recognised as ours. */
  private lastSteer: { readonly text: string; readonly at: number } | null = null;
  private observedModel: string | null = null;
  private chatSelection: ChatSelection = { ...DEFAULT_CHAT_SELECTION };
  private selectingChat = false;
  private readonly chatCatalog: ChatSessionCatalog;
  private readonly frontendControls = new FrontendControls(() => this.chatControlState(true), (selection) => this.selectChat(selection), id => this.openChat(id), (id, nativeId) => this.bindChatIdentity(id, nativeId), (kind, harness) => this.prepareChatSetup(kind, harness));
  private setupHarness: string | null = null;
  /** An install or sign-in started from Chat and not yet seen in the inventory: while it runs, /state re-probes
   *  the inventory even with a conversation handed off, so the flow sees the agent arrive. Not the handoff target
   *  (`setupHarness`, sign-ins only). */
  private setupProbe: { kind: string; harness: string } | null = null;
  private setupRefresh: Promise<void> | null = null;
  private chatProcess: { workspace: string; context: Promise<ChatProcessContext>; failed: boolean } | null = null;
  private controllerProcess: ChatProcessContext | null = null;
  private chatProcessRefresh: Promise<void> | null = null;
  private frontendHandoffValue: FrontendHandoff | null = null;
  /** The standing reason the Chat view has no agent, or `null`. Held because a refusal
   *  OUTLIVES a page load and the console ledger's clearing rule (a) retires an entry whose
   *  last load is older than the current one — so the condition is re-observed per load
   *  rather than raised once and swept. */
  private frontendRefusalValue: string | null = null;
  private frontendHandoffInFlight: Promise<FrontendHandoffResult> | null = null;
  private readonly callerSessionsByWorkspace = new Map<
    string,
    Map<string, HarnessChatCallerSession>
  >();

  constructor(private readonly options: HarnessChatServiceOptions) {
    const workspace = resolve(options.getProjectRoot());
    try { this.chatSelection = validateChatSelection(JSON.parse(readFileSync(join(workspace, '.volter', 'chat-selection.json'), 'utf8'))); } catch { /* no saved selection */ }
    this.chatCatalog = new ChatSessionCatalog(join(workspace, '.volter', 'chat-sessions.json'));
    if (this.chatCatalog.invalid) {
      console.warn(`[chat] Saved conversations were not loaded and are left as they are: ${this.chatCatalog.invalid}`);
    }
    const active = this.chatCatalog.active && this.chatCatalog.sessions.get(this.chatCatalog.active);
    if (active) this.chatSelection = {...active.selection};
    for (const caller of options.callerSessions ?? []) this.rememberCaller(workspace, caller);
  }

  private callerKey(caller: HarnessChatCallerSession): string {
    return `${caller.harness}\0${caller.sessionId}`;
  }

  private rememberCaller(workspace: string, caller: HarnessChatCallerSession): boolean {
    const callers = this.callerSessionsByWorkspace.get(workspace) ?? new Map();
    this.callerSessionsByWorkspace.set(workspace, callers);
    const key = this.callerKey(caller);
    if (callers.has(key)) return false;
    callers.set(key, caller);
    return true;
  }

  private callerSessions(): readonly HarnessChatCallerSession[] {
    if (!this.workspace) return [];
    return [...(this.callerSessionsByWorkspace.get(this.workspace)?.values() ?? [])];
  }

  async includeCallerSession(caller: HarnessChatCallerSession): Promise<HarnessChatSnapshot> {
    const workspace = resolve(this.options.getProjectRoot());
    if (!this.rememberCaller(workspace, caller)) return this.snapshot();
    if (this.controller && this.workspace === workspace) {
      await this.controller.dispatch({ type: 'refresh', autoObserve: false });
      this.capture();
      this.scheduleDiscovery();
    }
    return this.snapshot();
  }

  snapshot(): HarnessChatSnapshot {
    return {
      ...this.lastSnapshot,
      harnesses: this.lastSnapshot.harnesses.map((item) => ({
        ...item,
        capabilities: { ...item.capabilities },
        availableActions: { ...item.availableActions },
      })),
      sessions: this.lastSnapshot.sessions.map((item) => ({ ...item })),
      connection: { ...this.lastSnapshot.connection },
      turn: { ...this.lastSnapshot.turn },
      frame: this.lastSnapshot.frame ? structuredClone(this.lastSnapshot.frame) : null,
      taskPlan: {
        ...this.lastSnapshot.taskPlan,
        items: this.lastSnapshot.taskPlan.items.map((item) => ({
          ...item,
          ...(item.blockedBy ? { blockedBy: [...item.blockedBy] } : {}),
        })),
        residue: structuredClone(this.lastSnapshot.taskPlan.residue),
      },
      requests: this.lastSnapshot.requests.map((item) => ({
        ...item,
        options: item.options.map((option) => ({ ...option })),
      })),
      availableActions: { ...this.lastSnapshot.availableActions },
      error: this.lastSnapshot.error ? { ...this.lastSnapshot.error } : null,
    };
  }

  async refresh(autoObserve = true): Promise<HarnessChatSnapshot> {
    await this.refreshChatProcessContext();
    const created = !this.controller;
    await this.ensureController(autoObserve);
    if (!this.controller) return this.snapshot();
    if (!created) await this.controller.dispatch({ type: 'refresh', autoObserve });
    this.capture();
    return this.snapshot();
  }

  /** Ensure the live controller exists without re-running full harness/session
   * discovery when an editor tab mounts or reloads. Supercode's controller owns
   * the retained session index and delivers inventory changes through subscribe.
   * Compatibility clients and external callers get a bounded fallback; explicit
   * Refresh remains immediate. */
  async load(autoObserve = true): Promise<HarnessChatSnapshot> {
    const next = resolve(this.options.getProjectRoot());
    if (!this.controller && !this.starting) {
      this.beginWorkspace(next);
      void this.ensureController(autoObserve);
    } else if (this.controller && this.workspace === next) {
      this.capture();
    } else if (this.workspace !== next) {
      this.beginWorkspace(next);
      void this.ensureController(autoObserve);
    }
    return this.snapshot();
  }


  /**
   * Where the Chat's AI turn stands right now.
   *
   * Two places can know, because there are two ways a turn starts: the native
   * Chat view drives its runtime directly (only the runtime's own `turn_state`
   * sees it — the same read `chatControlState` makes), and an `@agent` hand-off
   * runs through the headless controller (its snapshot sees it).
   *
   * `waiting` — the turn is blocked on the PERSON (an approval or a question is
   * pending: the controller's `requests`, or a runtime `request` event not yet
   * resolved). A busy turn that is waiting is not a turn to steer: the line
   * would land on top of the question the person is reading.
   *
   * Never throws: a runtime that cannot be asked this time is `unknown`, and
   * leaves every pending ask exactly as it was.
   */
  async chatTurnState(): Promise<ChatTurnState> {
    if (this.lastSnapshot.requests.some((request) => request.status === 'pending')) return 'waiting';
    let busy = this.lastSnapshot.turn.state === 'running';
    if (!busy) {
      try {
        busy = (await this.frontendHandoffValue?.isBusy()) === true;
      } catch {
        // A failed or timed-out read is not a reading of `idle`: dropping the
        // person's open ask on it would let the next tick steer onto it.
        return 'unknown';
      }
    }
    // Only a SUCCESSFUL not-busy reading ends an ask: an approval can only be
    // outstanding while a turn runs (the runtime's `decide_approval` blocks
    // the agent loop — the bundled Chat extension clears its own
    // `pendingRequests` on an idle descriptor for this reason). Silence never
    // does: a person may leave an approval open for as long as they like, and
    // until its `request_resolved`, a turn boundary or an idle runtime, the
    // turn is `waiting` and nothing is steered onto it.
    if (!busy) {
      this.pendingRuntimeRequests.clear();
      return 'idle';
    }
    return this.pendingRuntimeRequests.size > 0 ? 'waiting' : 'running';
  }

  /**
   * Put `text` into the Chat's RUNNING turn — the one door by which something
   * the editor notices reaches the in-editor agent's context. An in-editor agent
   * tails no journal and watches no terminal; a steered line lands in its
   * conversation, between its own tool calls, and the person sees it in the Chat.
   *
   * `false` when no turn is running (an idle agent is not working, and a steer
   * would start nothing) or the turn is waiting on the person. Throws when the
   * harness refuses the steer, so the caller can record why.
   */
  async steerRunningTurn(text: string): Promise<boolean> {
    const generation = this.runtimeTurnGeneration;
    if ((await this.chatTurnState()) !== 'running') return false;
    // Re-checked AFTER the await, immediately before the steer: a turn that
    // ended while its state was being read must not be steered, because a
    // steer into an idle runtime can START a turn nobody asked for.
    // The open/closed bit gates only a runtime that reports turn starts; one
    // that never does (Claude Code's native stream) falls back to the
    // descriptor's `turn_state` busy, read just above.
    if (generation !== this.runtimeTurnGeneration) return false;
    if (this.runtimeReportsTurnStarts && this.runtimeTurnOpen === false) return false;
    this.lastSteer = { text, at: Date.now() };
    const runtime = this.managedRuntime;
    if (runtime && !runtime.closed) {
      await runtime.steer(text);
      return true;
    }
    await this.actIntent({ action: 'steer', text });
    return true;
  }

  /** Dispatch the package-owned messenger intent without translating it into
   * a second Volter action vocabulary. */
  async actIntent(intent: SupercodeUiIntent): Promise<HarnessChatSnapshot> {
    await this.ensureController();
    const host = this.remoteHost;
    if (!host) {
      throw new Error(this.lastSnapshot.error?.message ?? 'Volter Harness is unavailable.');
    }
    await host.dispatch(intent);
    this.capture();
    return this.snapshot();
  }


  /**
   * The initial Chat runtime is handed to the extension host before it starts.
   * The private lifecycle channel supplies replacement handoffs when the user
   * selects another harness or model; conversation actions still use frontend.v2.
   *
   * It never throws. A box with no signed-in harness is an ordinary state (B9c: the
   * refusal names the harness and its own login command), and the session still opens —
   * the sentence goes to the cover and the REH starts without the variables, which is
   * exactly the extension's own empty state.
   */
  /** The standing refusal, for a caller that must re-raise it (the console ledger is
   *  page-scoped and this condition is not). `null` once a runtime is attached. */
  frontendRefusal(): string | null {
    return this.frontendRefusalValue;
  }

  async frontendHandoff(): Promise<FrontendHandoffResult> {
    const controls = await this.frontendControls.start();
    const handoff = await this.runtimeFrontendHandoff();
    return { ...handoff, env: { ...handoff.env, ...controls } };
  }

  private observeChatRuntime(runtime: HeadlessManagedRuntime): void {
    this.managedRuntime = runtime;
    this.observedModel = null;
    this.pendingRuntimeRequests.clear();
    // A fresh runtime starts CLOSED, so its first activity is a (synthetic)
    // turn start — the watcher arms nothing after a turn end until one.
    this.runtimeTurnOpen = false;
    this.runtimeReportsTurnStarts = false;
    this.runtimeTurnGeneration++;
    runtime.on?.('event', event => {
      if (this.managedRuntime !== runtime) return;
      this.options.onRuntimeActivity?.(this.runtimeActivity(event));
      const payload = event.raw?.payload;
      if (!payload || typeof payload !== 'object') return;
      const record = payload as { model?: unknown; message?: { model?: unknown }; parent_tool_use_id?: unknown };
      // A subagent's reply (a Task on another model) names its own model, not the conversation's.
      if (typeof record.parent_tool_use_id === 'string') return;
      const model = record.message?.model ?? record.model;
      if (typeof model === 'string' && model.length > 0 && model.length < 200) this.observedModel = model;
    });
  }

  /**
   * Reduce one runtime event to a `ChatRuntimeActivity`, keeping the set of
   * requests the person has not answered yet — the native Chat answers them
   * itself, so these events are the only place this service sees them.
   *
   * THE NAMES ARE THE SDK'S NORMALIZED `type`s (`@volter/supercode-harness-sdk`
   * `normalizeRuntimeEvent`, checked against 0.3.77), not the runtime's wire
   * `kind`s. The hosted runtime's wire kinds — the ones the bundled Chat
   * extension's `projectEvent` reads — map onto them as:
   *   - `turn_started` → `turn_started`;
   *   - `turn_succeeded` / `turn_failed` / `turn_interrupted` → `turn_completed`
   *     (the END of a submitted turn). The wire `turn_completed` is one model
   *     round-trip and the SDK passes it through as `native`, so it never
   *     reads as an end here — the extension's own comment: treating it as
   *     idle ends the turn exactly when an approval is about to be raised;
   *   - `request` (`payload.request.id`) → `request`, `request_resolved`
   *     (`payload.request_id`) → `request_resolved`, same numeric id;
   *   - `runtime_disconnected` → `closed`;
   *   - `text_delta` → `output_delta`, `thinking_delta` → `reasoning_delta`.
   * A Claude Code runtime's native stream ends its turn with `result` →
   * `turn_completed` and streams `stream_event` content-block deltas, where
   * the SDK labels TOOL-INPUT deltas (`input_json_delta`) `output_delta` too —
   * which is why narration below reads the delta's own type there.
   */
  private runtimeActivity(event: ObservedChatRuntimeEvent): ChatRuntimeActivity {
    switch (event.type) {
      case 'turn_started':
        this.runtimeReportsTurnStarts = true;
        this.openRuntimeTurn(true);
        return 'turn-started';
      case 'turn_completed':
      case 'closed':
        this.openRuntimeTurn(false);
        return 'turn-ended';
      case 'request': {
        // A request opens a turn that never announced itself (it is raised
        // from inside one); the ask is added after, so the reopen keeps it.
        const reopened = this.reopenOnActivity();
        this.pendingRuntimeRequests.add(runtimeRequestKey(event, 'request'));
        return reopened ?? 'waiting';
      }
      case 'request_resolved':
        this.pendingRuntimeRequests.delete(runtimeRequestKey(event, 'request_resolved'));
        return 'answered';
      case 'output_delta':
      case 'reasoning_delta':
      case 'tool':
        // NOT a reason to clear a pending approval: in Claude Code a subagent
        // can stream while the main thread waits on the person's decision.
        // An ask ends only on its own `request_resolved`, a turn boundary,
        // or a successful idle reading in `chatTurnState` — never silence.
        return this.reopenOnActivity() ?? (isNarration(event) ? 'narration' : 'other');
      case 'message':
        // This editor's own steer echoing back is not a new turn.
        if (event.role === 'user' && this.isOwnSteerEcho(event)) return 'other';
        // A new user message, or the agent speaking, after a turn ended is
        // the next turn beginning.
        if (event.role === 'user' || isNarration(event)) {
          const reopened = this.reopenOnActivity();
          if (reopened) return reopened;
        }
        return isNarration(event) ? 'narration' : 'other';
      default:
        return 'other';
    }
  }

  /**
   * The SYNTHETIC turn start: agent activity after a turn END opens the next
   * turn, because Claude Code's native stream ends every turn (`result`) and
   * starts none. Reported upward as `turn-started`, so the visible-progress
   * stall clock and the per-turn nudge allowance reset exactly as they do for
   * a runtime that announces its turns — unless it follows this editor's own
   * steer within `STEER_ECHO_WINDOW_MS`, when it is `turn-resumed` and the
   * allowance stands. `null` when no turn was reopened.
   */
  private reopenOnActivity(): 'turn-started' | 'turn-resumed' | null {
    if (this.runtimeTurnOpen !== false) return null;
    this.openRuntimeTurn(true);
    const sinceSteer = this.lastSteer ? Date.now() - this.lastSteer.at : Infinity;
    return sinceSteer < STEER_ECHO_WINDOW_MS ? 'turn-resumed' : 'turn-started';
  }

  /** Is this user message the line this service last steered in? Matched on
   *  the text, either way round, because a harness may trim or wrap it. */
  private isOwnSteerEcho(event: ObservedChatRuntimeEvent): boolean {
    const sent = this.lastSteer?.text.trim();
    const seen = typeof event.text === 'string' ? event.text.trim() : '';
    return Boolean(sent && seen && (seen.includes(sent) || sent.includes(seen)));
  }

  /** A runtime turn boundary: any open ask belongs to the turn it ended. */
  private openRuntimeTurn(open: boolean): void {
    this.pendingRuntimeRequests.clear();
    this.runtimeTurnOpen = open;
    this.runtimeTurnGeneration++;
  }

  /** The private controls channel's environment for the extension host: started
   *  at once, with no runtime behind it yet (the channel answers with it). */
  async frontendControlsEnv(): Promise<Record<string, string>> {
    return this.frontendControls.start();
  }

  private chatProcessContext(workspace = resolve(this.options.getProjectRoot()), retryFailed = false): Promise<ChatProcessContext> {
    if (this.chatProcess?.workspace !== workspace || (retryFailed && this.chatProcess.failed)) {
      const context = chatProcessEnvironment(workspace).then(environment => ({
        ...environment,
        supercode: findSupercodeCommand(workspace, environment.env.PATH),
      }));
      const cached = { workspace, context, failed: false };
      // An installError is a failed discovery even though the promise fulfilled.
      // Keep it for this request; the next explicit state/refresh request retries.
      void context.then(value => { cached.failed = Boolean(value.installError); }, () => { cached.failed = true; });
      this.chatProcess = cached;
    }
    return this.chatProcess.context;
  }

  private refreshChatProcessContext(): Promise<void> {
    if (this.options.createClient) return Promise.resolve();
    this.chatProcessRefresh ??= (async () => {
      await this.starting;
      const workspace = resolve(this.options.getProjectRoot());
      const next = await this.chatProcessContext(workspace, true);
      if (workspace !== resolve(this.options.getProjectRoot())) return;
      const previous = this.controllerProcess;
      if (!this.controller || !previous || (previous.env.PATH === next.env.PATH && previous.supercode === next.supercode)) return;
      // Never retire a controller that owns a conversation. A later controller
      // will use the recovered context; first-run discovery has no runtime yet.
      if (this.closed || this.selectingChat || this.frontendHandoffValue || this.managedRuntime
        || this.lastSnapshot.turn.state === 'running' || this.lastSnapshot.requests.length) return;
      const controller = this.controller;
      if (this.discoveryTimer) clearTimeout(this.discoveryTimer);
      this.discoveryTimer = null;
      this.unsubscribe?.(); this.unsubscribe = null;
      this.remoteHost?.close(); this.remoteHost = null;
      this.controller = null;
      this.discoveryClient = null;
      this.controllerProcess = null;
      const generation = this.workspaceGeneration;
      const restarting = (async () => {
        await controller.close();
        if (!this.closed && generation === this.workspaceGeneration) {
          await this.startController(workspace, false, generation);
        }
      })();
      this.starting = restarting;
      try { await restarting; }
      finally { if (this.starting === restarting) this.starting = null; }
    })().finally(() => { this.chatProcessRefresh = null; });
    return this.chatProcessRefresh;
  }

  private async chatControlState(retryDiscovery = false) {
    // The extension asks for this at activation; a runtime still being handed
    // over is waited for, so the answer carries its connection.
    await this.frontendHandoffInFlight?.catch(() => undefined);
    if (retryDiscovery) await this.refreshChatProcessContext();
    await this.ensureController(false);
    // A refused startup is recoverable after a terminal install/sign-in. Serialize
    // passive inventory refresh and handoff retries across extension-host callers.
    if ((!this.frontendHandoffValue || this.setupHarness || this.setupProbe) && this.controller && !this.selectingChat) {
      this.setupRefresh ??= this.refreshChatSetup().finally(() => { this.setupRefresh = null; });
      await this.setupRefresh;
    }
    const snapshot = this.snapshot();
    const launchContext = await this.chatProcessContext();
    const actions = chatSetupActions(snapshot.harnesses, launchContext);
    return {
      selection: { ...this.chatSelection },
      activeSession: this.chatCatalog.active,
      openSessionCommand: 'volter.chat.openSession',
      revealReadySessionCommand: 'volter.chat.revealReadySession',
      sessions: [...this.chatCatalog.sessions.values()],
      actualModel: this.observedModel,
      connection: this.frontendHandoffValue?.env,
      busy: (await this.frontendHandoffValue?.isBusy()) || snapshot.turn.state === 'running' || snapshot.requests.length > 0,
      harnesses: snapshot.harnesses.filter(h => h.availableActions.start).map(h => ({ id: h.id, name: h.label, autoStart: h.availableActions.autoStart === true,
        description: h.auth === 'unknown' || h.auth === 'configured' ? 'Authentication unverified' : undefined })),
      models: chatModels(this.chatSelection.harness, launchContext.env),
      modelsByHarness: Object.fromEntries(snapshot.harnesses.filter(h => h.availableActions.start).map(h => [h.id, chatModels(h.id, launchContext.env)])),
      // What each chat actually runs with, so the Chat names its model and effort and never says "default model"
      // (harness-effective.ts): this conversation's, with its runtime's reported model once a turn has run, and a new
      // chat's for every startable harness.
      effective: effectiveChat(this.chatSelection, this.options.getProjectRoot(), launchContext.env, this.observedModel),
      effectiveByHarness: Object.fromEntries(snapshot.harnesses.filter(h => h.availableActions.start)
        .map(h => [h.id, effectiveChat({ harness: h.id, model: '', effort: '' }, this.options.getProjectRoot(), launchContext.env)])),
      configurable: ['claude-code', 'codex'].includes(this.chatSelection.harness),
      // A NEW chat approves its agent's tool calls unless the person picks Ask (the owner's ask, 2026-10-06); each
      // chat created from now on carries it (chat-session-catalog.ts), so a chat saved before keeps asking. Not
      // `defaultPermission`: frontend-vscode 0.1.36-0.1.38 applies that to every chat without a stored pick,
      // which turned Auto on for existing chats (0.5.187). The Chat applies it only where it can answer the
      // runtime's approvals (Claude Code, Codex); other harnesses keep their prompts.
      newChatPermission: 'autoApprove',
      setup: {
        ready: Boolean(this.frontendHandoffValue),
        actions,
        // Per agent: installed, signed in, account (docs/CHAT-WELCOME.md). The welcome renders its rows from these.
        agents: chatSetupAgents(snapshot.harnesses),
        reason: this.frontendHandoffValue ? null : [this.frontendRefusalValue, actions.length ? null : launchContext.installError].filter(Boolean).join('\n') || null,
        cwd: this.options.getProjectRoot(),
      },
    };
  }

  private async refreshChatSetup(): Promise<void> {
    const controller = this.controller;
    if (!controller) return;
    await controller.dispatch({ type: 'refresh', autoObserve: false, silent: true });
    this.capture();
    if (this.closed || controller !== this.controller) return;
    // The operation is over once the inventory shows its result: an install the agent installed, a sign-in the
    // agent able to start.
    const probed = this.setupProbe && this.lastSnapshot.harnesses.find(h => h.id === this.setupProbe!.harness);
    if (probed && (this.setupProbe!.kind === 'install' ? probed.installed : probed.availableActions.autoStart === true)) this.setupProbe = null;
    if (this.frontendHandoffValue) {
      // A sign-in from the picker refreshes availability without replacing the
      // conversation underneath the person. New Session applies their next choice.
      if (this.setupHarness && this.lastSnapshot.harnesses.some(h => h.id === this.setupHarness && h.availableActions.autoStart)) this.setupHarness = null;
      return;
    }
    const ready = this.lastSnapshot.harnesses.find(h => h.availableActions.autoStart === true &&
      (!this.setupHarness || h.id === this.setupHarness));
    if (!ready) return;
    if (this.setupHarness) this.chatSelection = { harness: this.setupHarness, model: '', effort: '' };
    await this.runtimeFrontendHandoff();
    if (this.frontendHandoffValue) this.setupHarness = null;
  }

  private async prepareChatSetup(kind: string, harness: string) {
    await this.chatControlState(true);
    const launchContext = await this.chatProcessContext();
    const action = chatSetupActions(this.lastSnapshot.harnesses, launchContext).find(a => a.kind === kind && a.harness === harness);
    if (!action) throw new Error('This setup action is no longer available.');
    const program = kind === 'login' ? launchContext.supercode : launchContext.npm;
    if (!program) throw new Error('The setup executable is no longer available.');
    // Only a sign-in names the agent the chat hands off to: an install that is cancelled or
    // fails must not keep another agent, signed in elsewhere, from opening the chat by itself.
    if (kind === 'login') this.setupHarness = harness;
    this.setupProbe = { kind, harness };
    // The extension runs this exact, host-authored command in a visible terminal.
    // It never executes arbitrary repair prose or receives provider credentials.
    const invocation = kind === 'login'
      ? supercodeInvocation(program, ['harness', 'login', harness])
      : { command: program, args: [...(launchContext.npmArgs ?? []), 'install', '-g', '--prefix', launchContext.npmPrefix!, CHAT_SETUP_PROVIDERS[harness]!.npmPackage] };
    return { ...action, cwd: this.options.getProjectRoot(),
      program: invocation.command,
      arguments: invocation.args,
      env: kind === 'login'
        ? { ...launchContext.env, PATH: signInPath(launchContext.env.PATH, launchContext.npmPrefix, CHAT_SETUP_PROVIDERS[harness]?.command ?? harness) }
        : launchContext.env,
    };
  }

  private rememberChatSession(): void {
    if (this.selectingChat || !this.chatCatalog.active) return;
    const entry = this.chatCatalog.sessions.get(this.chatCatalog.active);
    const session = this.lastSnapshot.sessions.find(s => s.id === this.lastSnapshot.activeSessionId);
    if (!entry?.identity || !session || session.harness !== entry.selection.harness) return;
    if (entry.identity && entry.identity !== session.identity) return;
    if (entry.identity !== session.identity || entry.title !== session.title) {
      entry.identity = session.identity;
      entry.title = session.title;
      this.chatCatalog.save();
    }
  }

  private async bindChatIdentity(id: string, nativeId: string) {
    if (id !== this.chatCatalog.active || this.selectingChat) throw new Error('Cannot bind an inactive conversation.');
    await this.ensureController();
    await this.controller!.dispatch({type:'refresh', autoObserve:false, silent:true});
    this.capture();
    const entry = this.chatCatalog.sessions.get(id);
    const session = this.lastSnapshot.sessions.find(s => s.nativeId === nativeId && s.harness === entry?.selection.harness && s.cwd && resolve(s.cwd) === resolve(this.options.getProjectRoot()));
    if (!entry || !session) throw new Error('The harness has not persisted this conversation yet.');
    // A saved identity the harness no longer lists (an earlier runtime home's; see openChat) binds nothing: the chat
    // takes the conversation it now has instead of refusing every New Chat that lands on it.
    if (entry.identity && entry.identity !== session.identity && this.lastSnapshot.sessions.some(s => s.identity === entry.identity)) {
      throw new Error('The conversation is already bound to a different harness session.');
    }
    entry.identity = session.identity;
    entry.title = session.title;
    this.chatCatalog.save();
    return this.chatControlState();
  }

  private async openChat(id: string) {
    const entry = this.chatCatalog.sessions.get(id);
    if (!entry) throw new Error('This chat session is not available. Start a new chat explicitly.');
    // Each editor start makes a new runtime home, and a conversation saved under an earlier one is not listed there:
    // it cannot be resumed or read. Such a chat opens fresh in its place. Throwing "The saved conversation history is
    // unavailable." on every open left the active chat stuck, and with it every send and New Chat (t_41195fa5).
    const gone = entry.identity !== null && await this.savedIdentityGone(entry.identity, entry.selection.harness);
    if (gone) {
      console.warn(`[chat] The saved conversation of chat ${id} (${entry.identity}) is no longer listed by its harness; the chat opens fresh.`);
      entry.identity = null;
      this.chatCatalog.save();
    }
    if (!(id === this.chatCatalog.active && this.frontendHandoffValue && !this.managedRuntime?.closed)) {
      if (!entry.identity && !gone) throw new Error('This chat has no persisted harness session to resume. Start a new chat.');
      await this.selectChat(entry.selection, gone ? undefined : id, gone ? id : undefined);
    }
    let history: unknown[] = [];
    let historyTruncated = false;
    if (entry.identity) {
      const session = this.lastSnapshot.sessions.find(s => s.identity === entry.identity);
      if (!session) throw new Error('The saved conversation history is unavailable.');
      // This read fills visible scrollback, not a model's continuation input.
      // The harness owns its native display projection and keeps the source
      // transcript intact for resume/export through their separate doors.
      const transcript = await this.controller!.loadSession(session.id, {
        view: { displayHistory: true, tailMessages: 120, maxMessageChars: 16_000, includeSubagents: false },
      }) as unknown as NormalizedSession;
      const messages = transcript.messages;
      historyTruncated = Math.max(messages.length, transcript.total_message_count ?? 0) > 120;
      history = messages.slice(-120);
    }
    return {...await this.chatControlState(), history, historyTruncated};
  }

  /** Whether `identity` is a conversation its own harness no longer lists, after asking that harness afresh. The
   *  controller's refresh can't say: it lists only the active chat's harness (a saved chat of another agent would
   *  read as gone) and at most its discovery limit (an older conversation would too). Only a complete listing of
   *  the saved chat's harness proves a conversation gone; anything less keeps the saved link. */
  private async savedIdentityGone(identity: string, harness: string): Promise<boolean> {
    await this.ensureController();
    const listedGone = await this.unlistedByHarness(identity, harness);
    // After that listing, so the controller's own refresh is the inventory left standing (the discovery client
    // remembers each listing's sessions), and the open below reads history from a current snapshot.
    await this.controller!.dispatch({type:'refresh', autoObserve:false, silent:true});
    this.capture();
    return listedGone && !this.lastSnapshot.sessions.some(s => s.identity === identity);
  }

  private async unlistedByHarness(identity: string, harness: string): Promise<boolean> {
    const client = this.discoveryClient;
    const identityFor = this.sessionIdentity;
    if (!client || !identityFor || !this.workspace) return false;
    const limit = 500;
    const listed = await client.discover({workspace: this.workspace, harnesses: [harness], limit, include_topic_candidates: false});
    if (listed.sessions.length >= limit) return false;
    for (const descriptor of listed.sessions) {
      if (descriptor.locator.harness === harness && await identityFor(descriptor.locator) === identity) return false;
    }
    return true;
  }

  /** `freshFor`: start a new conversation for that saved chat, whose own conversation is gone, rather than a new chat. */
  private async selectChat(selection: ChatSelection, resumeId?: string, freshFor?: string) {
    if (this.selectingChat) throw new Error('A chat selection is already being applied.');
    this.selectingChat = true;
    const previous = this.chatSelection;
    let activated = false;
    try {
      await this.ensureController();
      this.capture();
      if ((await this.frontendHandoffValue?.isBusy()) || this.lastSnapshot.turn.state === 'running' || this.lastSnapshot.requests.length) throw new Error('Finish or cancel the current turn before starting a new chat.');
      if (!this.lastSnapshot.harnesses.some(h => h.id === selection.harness && (resumeId ? h.availableActions.resume : h.availableActions.start))) throw new Error('This harness is unavailable or cannot perform the requested chat action.');
      this.chatSelection = selection;
      let action: HeadlessAction = {type:'start', harness:selection.harness};
      if (resumeId) {
        const entry = this.chatCatalog.sessions.get(resumeId)!;
        await this.controller!.dispatch({type:'refresh', autoObserve:false, silent:true});
        this.capture();
        const session = this.lastSnapshot.sessions.find(s => s.identity === entry.identity && s.harness === selection.harness);
        if (!session) throw new Error('The exact harness session could not be found. No replacement conversation was created.');
        // The SDK refuses resume while its controller owns another runtime.
        // Close our idle controller through its lifecycle API, then rediscover
        // the exact durable identity in the replacement controller.
        const previousController = this.controller!;
        this.unsubscribe?.(); this.unsubscribe = null;
        this.remoteHost?.close(); this.remoteHost = null;
        this.controller = null;
        this.discoveryClient = null;
        const oldHandoff = this.frontendHandoffValue;
        this.frontendHandoffValue = null;
        // State/load requests can arrive while the old runtime is closing.
        // Keep them behind the entire replacement, including discovery, so
        // none starts an auto-observing controller in the disposal gap.
        const workspace = this.workspace!;
        const generation = this.workspaceGeneration;
        const restarting = (async () => {
          await oldHandoff?.dispose();
          await withTimeout(previousController.close(), 10_000, 'Closing previous chat runtime');
          if (this.closed || generation !== this.workspaceGeneration) throw new Error('The chat workspace changed while closing its previous runtime.');
          this.managedRuntime = null;
          this.observedModel = null;
          await this.startController(workspace, false, generation);
        })();
        this.starting = restarting;
        try { await restarting; }
        finally { if (this.starting === restarting) this.starting = null; }
        const restored = this.lastSnapshot.sessions.find(s => s.identity === entry.identity && s.harness === selection.harness);
        if (!restored) throw new Error('The saved conversation could not be rediscovered after closing its previous runtime.');
        action = {type:'resume', sessionKey:restored.id};
      }
      const result = await this.controller!.dispatch(action);
      if (result.error) throw new Error(result.error.message);
      activated = true;
      if (resumeId) { this.chatCatalog.active = resumeId; this.chatCatalog.save(); }
      else if (freshFor && this.chatCatalog.sessions.has(freshFor)) { this.chatCatalog.active = freshFor; this.chatCatalog.save(); }
      else this.chatCatalog.create(selection);
      const runtimeId = this.managedRuntime?.handle?.runtime_id;
      if (!runtimeId) throw new Error('The selected harness did not start.');
      const handoff = await mintFrontendHandoff({ runtimeSessionId: runtimeId,
        directory: join(homedir(), '.volter', 'runtime', `frontend-${process.pid}-${randomUUID()}`) });
      const old = this.frontendHandoffValue;
      this.frontendHandoffValue = handoff;
      this.frontendRefusalValue = null;
      await old?.dispose();
      const folder = join(this.options.getProjectRoot(), '.volter');
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, 'chat-selection.json'), JSON.stringify(selection, null, 2) + '\n');
      this.capture();
      return { ...await this.chatControlState(), connection: handoff.env };
    } catch (error) {
      if (!activated) this.chatSelection = previous;
      else this.frontendRefusalValue = errorMessage(error);
      throw error;
    }
    finally { this.selectingChat = false; this.rememberChatSession(); }
  }

  private async runtimeFrontendHandoff(): Promise<FrontendHandoffResult> {
    if (this.frontendHandoffValue) {
      return { env: { ...this.frontendHandoffValue.env }, refusal: null };
    }
    this.frontendHandoffInFlight ??= this.mintFrontendHandoff().finally(() => {
      this.frontendHandoffInFlight = null;
    });
    return this.frontendHandoffInFlight;
  }

  /**
   * The key of this project's saved conversation, or else of its most recent session whose
   * harness the SDK permits to resume automatically (or the explicitly selected harness
   * can resume), or `null` when it
   * has none. Only sessions whose `cwd` IS this project count: a session the person ran
   * somewhere else is not this project's history, and resuming it would put another folder's
   * conversation in this folder's panel.
   */
  private resumableSessionKey(): string | null {
    const saved = this.chatCatalog.active ? this.chatCatalog.sessions.get(this.chatCatalog.active) : undefined;
    // A saved conversation that never persisted a session (nothing was sent) starts again
    // with its own selection; one that did resumes exactly that session or says why not.
    if (saved?.identity) {
      const exact = this.lastSnapshot.sessions.find(s => s.identity === saved.identity && s.harness === saved.selection.harness);
      if (!exact) throw new Error('The saved harness session could not be found. Start a new chat explicitly.');
      return exact.id;
    }
    if (saved) return null;
    const root = resolve(this.options.getProjectRoot());
    // A discovered session is not a saved choice. Apply the SDK's automatic
    // policy only when the person has chosen neither a conversation nor an agent.
    const resumable = new Set(
      this.lastSnapshot.harnesses.filter((harness) =>
        this.chatSelection.harness
          ? harness.availableActions.resume
          : harness.availableActions.autoResume === true,
      ).map((harness) => harness.id),
    );
    const mine = this.lastSnapshot.sessions
      .filter((session) => resumable.has(session.harness) && session.cwd !== null)
      .filter((session) => !this.chatSelection.harness || session.harness === this.chatSelection.harness)
      .filter((session) => resolve(session.cwd as string) === root)
      .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
    return mine[0]?.id ?? null;
  }

  private async mintFrontendHandoff(): Promise<FrontendHandoffResult> {
    try {
      // Native Chat owns its conversation. Inventory must not first mirror the
      // newest caller transcript merely because it was discovered most recently.
      await this.ensureController(false);
      const controller = this.controller;
      if (!controller) throw new Error(this.lastSnapshot.error?.message ?? 'Volter Harness is unavailable.');
      if (!this.managedRuntime || this.managedRuntime.closed) {
        // REOPENING A PROJECT RESUMES ITS LAST SESSION, it does not start a second one.
        // the editor's `close` command ends the runtime with the session, so without this every reopen
        // handed the panel a FRESH Claude session and the person's own conversation was
        // gone — measured: close, reopen, and the Chat view came back empty while the
        // extension's status door listed a brand new runtime id.
        //
        // Both doors are the controller's own and both ask readiness first, so a harness
        // that is not signed in is still refused BY NAME with its own login command —
        // which is the sentence a person needs, and the one that travels to the cover,
        // `.volter/session.json` and the console ledger.
        this.capture();
        if (this.lastSnapshot.harnesses.length === 0) {
          await controller.dispatch({ type: 'refresh', autoObserve: false });
          this.capture();
        }
        const resumable = this.resumableSessionKey();
        // Selection policy belongs to the SDK. Unknown authentication is not an
        // automatic fallback; an explicitly selected agent can still be started.
        const startable = this.lastSnapshot.harnesses.find(harness =>
          this.chatSelection.harness
            ? harness.id === this.chatSelection.harness && harness.availableActions.start
            : harness.availableActions.autoStart === true);
        if (resumable === null && !startable) throw new Error(harnessRefusal(this.lastSnapshot.harnesses));
        // With no choice made, the conversation's selection is the harness this dispatch
        // runs: the resumed session's, or the one started. Decided before dispatching,
        // so it never depends on reading the result back.
        const harness =
          resumable === null
            ? this.chatSelection.harness || startable!.id
            : this.lastSnapshot.sessions.find((s) => s.id === resumable)?.harness;
        if (!harness) throw new Error('The session to resume names no harness.');
        this.chatSelection = { ...this.chatSelection, harness };
        await controller.dispatch(
          resumable === null
            ? { type: 'start', harness }
            : { type: 'resume', sessionKey: resumable },
        );
        this.capture();
      }
      const runtimeId = this.managedRuntime?.handle?.runtime_id;
      if (!runtimeId) {
        throw new Error(
          'Volter Harness started no agent runtime for this project, so the Chat view has nothing to attach to.',
        );
      }
      const handoff = await mintFrontendHandoff({
        runtimeSessionId: runtimeId,
        directory: join(homedir(), '.volter', 'runtime', `frontend-${process.pid}`),
      });
      this.frontendHandoffValue = handoff;
      this.frontendRefusalValue = null;
      if (!this.chatCatalog.active) {
        const entry = this.chatCatalog.create(this.chatSelection);
        const session = this.lastSnapshot.sessions.find(s => s.id === this.lastSnapshot.activeSessionId);
        if (session?.harness === entry.selection.harness) { entry.identity = session.identity; entry.title = session.title; this.chatCatalog.save(); }
      }
      this.rememberChatSession();
      return { env: { ...handoff.env }, refusal: null };
    } catch (error) {
      // THE REFUSAL TRAVELS TO THE PANEL. The extension reads
      // `SUPERCODE_FRONTEND_UNAVAILABLE` at activation and shows it as the session's first
      // turn, so the sentence a person needs — the harness named, with its own login command —
      // is on the screen they are looking at, not only in this terminal and the ledger.
      this.frontendRefusalValue = errorMessage(error);
      return {
        env: { [FRONTEND_UNAVAILABLE_ENV]: this.frontendRefusalValue },
        refusal: this.frontendRefusalValue,
      };
    }
  }

  async setWorkspace(): Promise<void> {
    const next = resolve(this.options.getProjectRoot());
    if (this.workspace === next) return;
    this.beginWorkspace(next);
    if (this.controller) {
      await this.controller.setWorkspace(next, { autoObserve: true });
      this.capture();
      this.scheduleDiscovery();
      return;
    }
    await this.ensureController(true);
  }

  async close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    if (this.discoveryTimer) clearTimeout(this.discoveryTimer);
    this.discoveryTimer = null;
    this.frontendControls.close();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.remoteHost?.close();
    this.remoteHost = null;
    const controller = this.controller;
    this.controller = null;
    this.discoveryClient = null;
    this.lastHeadlessSnapshot = null;
    this.sessionDescriptorsByIdentity.clear();
    this.sessionIdentity = null;
    this.subagentDescriptorsByKey.clear();
    this.subagentInspector = null;
    this.inventoryCaptureGeneration++;
    this.bridgeListeners.clear();
    const handoff = this.frontendHandoffValue;
    this.frontendHandoffValue = null;
    this.managedRuntime = null;
    void handoff?.dispose();
    this.closing = controller
      ? withTimeout(controller.close(), 2_500, 'Volter Harness shutdown').then(
          () => undefined,
          () => undefined,
        )
      : Promise.resolve();
    return this.closing;
  }

  private async ensureController(autoObserve = true): Promise<void> {
    if (this.closed) throw new Error('Harness Chat service is closed.');
    // A controller is assigned before initialize finishes. Its empty inventory
    // must not be mistaken for completed discovery by concurrent callers.
    if (this.starting) {
      await this.starting;
      return;
    }
    const next = resolve(this.options.getProjectRoot());
    if (this.controller) {
      if (this.workspace !== next) {
        this.beginWorkspace(next);
        await this.controller.setWorkspace(next, { autoObserve: true });
        this.capture();
        this.scheduleDiscovery();
      }
      return;
    }
    this.beginWorkspace(next);
    const generation = this.workspaceGeneration;
    this.starting = this.startController(next, autoObserve, generation);
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private async startController(
    workspace: string,
    autoObserve: boolean,
    generation: number,
  ): Promise<void> {
    let controller: HeadlessController | null = null;
    try {
      controller = await this.createHeadlessController(workspace, autoObserve);
      if (this.closed || generation !== this.workspaceGeneration) {
        await withTimeout(controller.close(), 2_500, 'Volter Harness shutdown').catch(() => undefined);
        return;
      }
      this.workspace = workspace;
      this.controller = controller;
      this.remoteHost = createRemoteControllerHost(
        controller as unknown as Parameters<typeof createRemoteControllerHost>[0],
        {
          hostInstanceId: this.serverInstanceId,
          projection: (state) => this.projectionOptions(state),
          handleIntent: (intent) => intent.action === 'release',
          onLoadSessions: async () => {
            await controller?.dispatch({ type: 'refresh', autoObserve: false });
          },
          onOpenSubagents: (key) => this.openSubagents(key),
          onOpenSubagent: (parentKey, key) => this.openSubagent(parentKey, key),
          onCloseSubagents: () => this.closeSubagents(),
          onStartTerminal: () => {
            throw new Error('Starting directly in a terminal is not available in this editor.');
          },
          onResumeTerminal: () => {
            throw new Error('Terminal continuation must be opened by the editor shell.');
          },
          onUnsupported: (intent) => {
            throw new Error(
              `Volter Harness UI action is not available in this editor: ${intent.action}`,
            );
          },
        },
      );
      this.unsubscribe = controller.subscribe(() => this.capture());
      this.capture();
      const timeoutMs = this.options.initializeTimeoutMs ?? DEFAULT_INITIALIZE_TIMEOUT_MS;
      await withTimeout(controller.initialize(), timeoutMs, 'Volter Harness initialization');
      this.capture();
      this.scheduleDiscovery();
    } catch (error) {
      if (controller && controller === this.controller) {
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.remoteHost?.close();
        this.remoteHost = null;
        this.controller = null;
      }
      if (generation === this.workspaceGeneration && !this.closed) {
        this.lastSnapshot = unavailable(
          workspace,
          errorMessage(error),
          generation,
          this.serverInstanceId,
        );
        this.options.onChange(this.snapshot());
      }
      if (controller) {
        await withTimeout(controller.close(), 2_500, 'Volter Harness shutdown').catch(() => undefined);
      }
    }
  }

  private async createHeadlessController(
    workspace: string,
    autoObserve: boolean,
  ): Promise<HeadlessController> {
    const piExtensionPath = join(homedir(), '.volter', 'runtime', 'pi-openrouter-extension.mjs');
    // Every managed-runtime start passes through here. By default it injects nothing and
    // the stock CLI runs on the person's own login, so readiness is asked for FIRST and a
    // harness that is not signed in is refused by name (ARCHITECTURE-CORE §Managed
    // services, "A coding harness is not a provider").
    const transformBackend = async (backend: unknown) => {
      let params = await withCodingInference(
        backend,
        () => this.options.resolveCodingInference?.(workspace) ?? Promise.resolve(null),
        piExtensionPath,
        (harness) => this.harnessReadiness(harness, workspace),
      );
      const configured = this.chatSelection;
      if (params && typeof params === 'object' && (params as { harness?: string }).harness === configured.harness && (configured.model || configured.effort)) {
        const client = this.discoveryClient as SupercodeClient & { supportReport(): Promise<{ harnesses: Array<{ id: string; runtime: { default_launch: { program: string; arguments: string[]; env?: Record<string, string> } | null } }> }> };
        const report = await client.supportReport();
        const launch = (params as { launch?: { program: string; arguments: string[]; env?: Record<string, string> } }).launch ?? report.harnesses.find(h => h.id === configured.harness)?.runtime.default_launch;
        if (!launch) throw new Error('This harness exposes no configurable launch.');
        params = { ...params, launch: selectedChatLaunch(configured, launch) };
      }
      // THE PROJECT'S OWN MCP SERVERS ride the start, because discovery cannot reach them:
      // a `--print` runtime has no trust dialog, and Claude Code loads a project `.mcp.json`
      // only for a project the person has already approved by hand
      // (`project-mcp-servers.ts` carries the measurement). Supplied ones are never
      // overwritten — a caller that already named them meant it.
      if (params === null || typeof params !== 'object') return params;
      const supplied = params as { mcp_servers?: unknown };
      if (supplied.mcp_servers !== undefined) return params;
      const servers = projectMcpServers(workspace);
      return servers.length > 0 ? { ...supplied, mcp_servers: servers } : params;
    };
    if (this.options.createClient) {
      const module = this.options.createController
        ? null
        : await importSupercodeController();
      const sessionReconnectIdentity =
        this.options.sessionReconnectIdentity ?? module?.sessionReconnectIdentity;
      if (!sessionReconnectIdentity) {
        throw new Error(
          'An injected Volter Harness controller must provide its sessionReconnectIdentity test seam.',
        );
      }
      this.sessionIdentity = sessionReconnectIdentity;
      const client = withCallerSessionDiscovery(
        withManagedRuntimeObserver(
          await this.options.createClient(workspace),
          (runtime) => this.observeChatRuntime(runtime),
          transformBackend,
        ),
        () => this.callerSessions(),
        (sessions) => this.rememberSessionInventory(sessions, sessionReconnectIdentity, workspace),
        () => this.chatSelection.harness,
      );
      this.discoveryClient = client;
      if (this.options.createController) {
        return this.options.createController(client, workspace, { autoObserve });
      }
      if (!module) throw new Error('Volter Harness controller could not be loaded.');
      this.assertSnapshot = module.assertSupercodeClientSnapshot;
      this.projectConversation = module.projectConversation;
      this.deriveTaskPlan = module.deriveTaskPlan;
      return new module.SupercodeController({
        client,
        workspace,
        policy: RUNTIME_POLICY,
        ownsClient: true,
        autoObserve,
      });
    }
    const {
      SupercodeHarnessClient,
      SupercodeController,
      assertSupercodeClientSnapshot,
      projectConversation,
      deriveTaskPlan,
      sessionReconnectIdentity,
    } = await importSupercodePackages();
    this.assertSnapshot = assertSupercodeClientSnapshot;
    this.projectConversation = projectConversation;
    this.deriveTaskPlan = deriveTaskPlan;
    this.sessionIdentity = sessionReconnectIdentity;
    const launchContext = await this.chatProcessContext(workspace);
    this.controllerProcess = launchContext;
    const command = launchContext.supercode;
    const client = withCallerSessionDiscovery(
      withManagedRuntimeObserver(
        new SupercodeHarnessClient({
          cwd: workspace,
          ...(command ? supercodeInvocation(command, ['harness', 'serve']) : {}),
          env: launchContext.env,
        }),
        (runtime) => this.observeChatRuntime(runtime),
        transformBackend,
      ),
      () => this.callerSessions(),
      (sessions) => this.rememberSessionInventory(sessions, sessionReconnectIdentity, workspace),
        () => this.chatSelection.harness,
    );
    this.discoveryClient = client;
    return new SupercodeController({
      client,
      workspace,
      policy: RUNTIME_POLICY,
      ownsClient: true,
      autoObserve,
      allowHarnessConfiguration: true,
    });
  }

  /**
   * Ask Supercode whether this harness can start on the login the person already did.
   * The SDK's own `listHarnesses` is the door (the same report `supercode harness list
   * --json` prints), asked fresh at launch time so a sign-in completed in a terminal a
   * moment ago counts; the controller's last inventory answers when a test seam supplies
   * a client without it. `null` means Supercode had nothing to say, and nothing is
   * refused on silence.
   *
   * Native authentication status belongs to Supercode. A protocol handshake is
   * not authentication and must never promote an unknown agent into an automatic choice.
   */
  private async harnessReadiness(
    harness: string,
    workspace: string,
  ): Promise<HarnessReadiness | null> {
    const client = this.discoveryClient;
    if (client?.listHarnesses) {
      const ask = async (probe: 'passive' | 'handshake') => {
        const { harnesses } = (await client.listHarnesses?.({
          workspace,
          harnesses: [harness],
          probe,
          skip_versions: true,
        })) ?? { harnesses: [] };
        return harnesses.find((item) => item.id === harness);
      };
      try {
        const entry = await ask('passive');
        if (entry) {
          return {
            id: entry.id,
            label: entry.display_name,
            installed: entry.installed,
            auth: entry.auth,
            reason: entry.reason,
            repair: entry.repair,
          };
        }
      } catch {
        // An inventory read that fails is not evidence the harness is unusable.
      }
    }
    const known = this.lastSnapshot.harnesses.find((item) => item.id === harness);
    return known
      ? {
          id: known.id,
          label: known.label,
          installed: known.installed,
          auth: known.auth,
          reason: known.reason,
          repair: known.repair,
        }
      : null;
  }

  private async rememberSessionInventory(
    sessions: readonly HeadlessSessionDescriptor[],
    sessionReconnectIdentity: HeadlessSessionIdentity,
    workspace: string,
  ): Promise<void> {
    const captureGeneration = ++this.inventoryCaptureGeneration;
    const entries = await Promise.all(
      sessions.map(
        async (descriptor) =>
          [await sessionReconnectIdentity(descriptor.locator), descriptor] as const,
      ),
    );
    if (this.workspace === workspace && captureGeneration === this.inventoryCaptureGeneration) {
      this.sessionDescriptorsByIdentity = new Map(entries);
    }
  }

  private publishSubagentInspector(inspector: SupercodeUiState['subagentInspector']): void {
    this.subagentInspector = inspector;
    if (!this.remoteHost) return;
    this.remoteHost.refreshProjection();
    this.capture();
  }

  private async openSubagents(parentKey: string): Promise<void> {
    const snapshot = this.lastHeadlessSnapshot;
    const client = this.discoveryClient;
    const identityFor = this.sessionIdentity;
    const parent = snapshot?.sessions.find((session) => session.key === parentKey);
    const parentTitle =
      this.remoteHost?.getFrame().state.sessions.find((row) => row.key === parentKey)?.title ??
      'Conversation';
    this.subagentDescriptorsByKey.clear();
    this.publishSubagentInspector({
      parentKey,
      parentTitle,
      status: 'loading',
      items: [],
      selectedKey: null,
      transcript: [],
      error: null,
    });
    if (!parent || !client || !identityFor || !this.workspace) {
      this.publishSubagentInspector({
        parentKey,
        parentTitle,
        status: 'error',
        items: [],
        selectedKey: null,
        transcript: [],
        error: 'This conversation family is no longer available.',
      });
      return;
    }
    try {
      const discovered = await client.discover({
        workspace: this.workspace,
        limit: 500,
        include_topic_candidates: true,
        include_child_sessions: true,
      });
      const descendants: HeadlessSessionDescriptor[] = [];
      const pendingParents = new Set([parent.sessionId]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const descriptor of discovered.sessions) {
          if (
            !descriptor.parent_session_id ||
            !pendingParents.has(descriptor.parent_session_id) ||
            descendants.includes(descriptor)
          ) {
            continue;
          }
          descendants.push(descriptor);
          pendingParents.add(descriptor.locator.session_id);
          changed = true;
        }
      }
      const keys = new Map<string, string>();
      for (const descriptor of descendants) {
        const key = await identityFor(descriptor.locator);
        keys.set(locatorKey(descriptor), key);
        this.subagentDescriptorsByKey.set(key, descriptor);
      }
      const items = projectSubagentInventory(descendants, {
        keyFor: (descriptor) => keys.get(locatorKey(descriptor)) ?? '',
        home: homedir(),
        preserveOrder: true,
      });
      this.publishSubagentInspector({
        parentKey,
        parentTitle,
        status: 'ready',
        items,
        selectedKey: null,
        transcript: [],
        error: null,
      });
    } catch (error) {
      this.publishSubagentInspector({
        parentKey,
        parentTitle,
        status: 'error',
        items: [],
        selectedKey: null,
        transcript: [],
        error: errorMessage(error),
      });
    }
  }

  private async openSubagent(parentKey: string, key: string): Promise<void> {
    const inspector = this.subagentInspector;
    const descriptor = this.subagentDescriptorsByKey.get(key);
    const client = this.discoveryClient;
    if (!inspector || inspector.parentKey !== parentKey || !descriptor || !client) return;
    this.publishSubagentInspector({
      ...inspector,
      status: 'loading',
      selectedKey: key,
      transcript: [],
      error: null,
    });
    try {
      const loaded = await client.load(descriptor.locator, {
        view: { tailMessages: 120, maxMessageChars: 16_000, includeSubagents: false },
      });
      this.publishSubagentInspector({
        ...inspector,
        status: 'ready',
        selectedKey: key,
        transcript: projectSubagentTranscript(loaded.session, {
          maxEntries: 120,
          maxScanEntries: 480,
          maxEntryChars: 8_000,
          prefix: key,
        }),
        error: null,
      });
    } catch (error) {
      this.publishSubagentInspector({
        ...inspector,
        status: 'error',
        selectedKey: key,
        transcript: [],
        error: errorMessage(error),
      });
    }
  }

  private closeSubagents(): void {
    this.subagentDescriptorsByKey.clear();
    this.publishSubagentInspector(null);
  }

  /** The ONE projection the frame and the image registry are both built from.
   * A reference only resolves while it is inside this same bounded window. */
  private projectionOptions(state: { history?: HeadlessSnapshot['history'] }) {
    const transcriptLimit = state.history?.transcriptLimit ?? 120;
    return {
      maxEntries: transcriptLimit,
      maxEntryChars: 8_000,
      maxScanEntries: transcriptLimit * TRANSCRIPT_SCAN_MULTIPLIER,
      history: {
        transcriptLimit,
        hasEarlier: state.history?.hasEarlier ?? false,
      },
      subagentInspector: this.subagentInspector,
    };
  }


  private capture(): void {
    if (!this.controller || !this.remoteHost) return;
    const snapshot = this.assertSnapshot(this.controller.getSnapshot());
    if (snapshot.workspace !== this.workspace) return;
    let frame = this.remoteHost.getFrame();
    if (frame.controllerRevision !== snapshot.revision) {
      frame = this.remoteHost.refreshProjection();
    }
    this.lastHeadlessSnapshot = snapshot;
    this.lastSnapshot = toSnapshot(snapshot, frame);
    this.rememberChatSession();
    this.options.onChange(this.snapshot());
    for (const listener of this.bridgeListeners) listener();
  }

  private scheduleDiscovery(): void {
    if (this.discoveryTimer) clearTimeout(this.discoveryTimer);
    this.discoveryTimer = null;
    // Supercode owns indexed workspace inventory. Only compatibility clients
    // and explicitly included callers outside that index need a bounded refresh.
    // A refresh goes through the controller once; do not scan and then scan again.
    const delay = this.options.discoveryPollMs ?? 60_000;
    if (this.closed || delay <= 0 || !this.controller || !this.discoveryClient) return;
    if (typeof this.discoveryClient['subscribeSessionIndex'] === 'function'
      && this.callerSessions().length === 0) return;
    const controller = this.controller;
    const generation = this.workspaceGeneration;
    this.discoveryTimer = setTimeout(async () => {
      this.discoveryTimer = null;
      if (this.closed || this.controller !== controller || generation !== this.workspaceGeneration) return;
      try {
        if (!this.selectingChat && this.lastSnapshot.operation === null
          && this.lastSnapshot.turn.state === 'idle') {
          await controller.dispatch({ type: 'refresh', autoObserve: false, silent: true });
        }
      } catch {
        // Explicit Refresh remains the visible recovery path.
      } finally {
        if (this.controller === controller && generation === this.workspaceGeneration) this.scheduleDiscovery();
      }
    }, delay);
  }

  private beginWorkspace(workspace: string): void {
    if (this.workspace === workspace) return;
    if (this.discoveryTimer) clearTimeout(this.discoveryTimer);
    this.discoveryTimer = null;
    this.workspace = workspace;
    this.workspaceGeneration++;
    this.lastHeadlessSnapshot = null;
    this.sessionDescriptorsByIdentity.clear();
    this.subagentDescriptorsByKey.clear();
    this.subagentInspector = null;
    this.inventoryCaptureGeneration++;
    this.lastSnapshot = loading(workspace, this.workspaceGeneration, this.serverInstanceId);
    this.options.onChange(this.snapshot());
    for (const listener of this.bridgeListeners) listener();
  }

  /** The project-work bridge observes the existing controller; it never creates another one. */
  bridgeAdapter() {
    return {
      getSnapshot: () => {
        const raw = this.lastHeadlessSnapshot;
        if (raw)
          return {
            sessions: raw.sessions,
            activeSessionKey: raw.activeSessionKey,
            activeSession: raw.activeSession ?? null,
            conversation: raw.conversation,
            taskPlan: raw.taskPlan ?? this.deriveTaskPlan(raw.activeSession ?? null),
            turn: raw.turn,
            requests: raw.requests,
          };
        return {
          sessions: [],
          activeSessionKey: null,
          activeSession: null,
          conversation: [],
          taskPlan: { source: 'none' as const, items: [], residue: [], observedAt: null },
          turn: { state: 'idle' as const },
          requests: [],
        };
      },
      subscribe: (listener: () => void) => {
        this.bridgeListeners.add(listener);
        return () => this.bridgeListeners.delete(listener);
      },
      projectConversation: (session: HeadlessLoadedSession) => this.projectConversation(session),
      deriveTaskPlan: (session: HeadlessLoadedSession | null) => this.deriveTaskPlan(session),
    };
  }

  async loadSessionForProjectWork(sessionKey: string): Promise<HeadlessLoadedSession> {
    await this.ensureController(false);
    if (!this.controller) throw new Error('Volter Harness is unavailable.');
    return this.controller.loadSession(sessionKey);
  }
}
