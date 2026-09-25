/**
 * VGAI host adapter for Supercode's headless client.
 *
 * Supercode owns harness/session/runtime semantics, lifecycle normalization,
 * transcript projection, retries, reconciliation, and concurrency. VGAI owns
 * authenticated local launch controls and the HTTP/SSE boundary. Native Chat
 * owns presentation and conversation-scoped approval choices. Keep this file as a mapping layer; reusable agent logic
 * belongs in @volter-ai-dev/supercode-client.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { NormalizedSession, SessionDescriptor } from '@volter-ai-dev/supercode-harness-sdk';
import {
  type projectClientSnapshot,
  projectSubagentInventory,
  projectSubagentTranscript,
} from '@volter-ai-dev/supercode-ui/controller';
import type { SupercodeUiIntent, SupercodeUiState } from '@volter-ai-dev/supercode-ui/core';
import {
  createRemoteControllerHost,
  type RemoteControllerHost,
  type RemoteUiFrame,
} from '@volter-ai-dev/supercode-ui/host';
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
import { ChatSessionCatalog } from './chat-session-catalog';
import { projectMcpServers } from './project-mcp-servers';
import type { HarnessChatCallerSession } from './harness-chat-caller';

type HeadlessUiSnapshot = Parameters<typeof projectClientSnapshot>[0];

// @volter-ai-dev/supercode-client is an optional runtime peer. The mandatory UI
// package already declares its exact frontend snapshot contract, so do not
// shadow that contract with a partial VGAI interface. The validator loaded
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
  loadSession(sessionKey: string): Promise<HeadlessLoadedSession>;
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
type HeadlessManagedRuntime = {
  readonly closed?: boolean;
  on?(event: 'event', listener: (event: { raw?: { payload?: unknown } }) => void): unknown;
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
    harnesses?: string[];
    limit?: number;
    include_topic_candidates?: boolean;
    include_child_sessions?: boolean;
  }): Promise<{ sessions: HeadlessSessionDescriptor[] }>;
  load(
    locator: HeadlessSessionDescriptor['locator'],
    options?: {
      view?: { tailMessages?: number; maxMessageChars?: number; includeSubagents?: boolean };
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
}) => SupercodeClient;

/**
 * WHETHER THE AGENT ASKS BEFORE IT ACTS, and the one place that is decided.
 *
 * Supercode's runtime launch is policy-gated: `harness_service.rs`'s
 * `runtime_launch(params)` returns a launch ONLY for `yolo`, and the yolo launch for
 * Claude Code is `claude --dangerously-skip-permissions --print …`. Under `default` it
 * returns none and the backend falls back to its OWN prefix
 * (`runtime/adapters.rs`'s `ClaudeCodeRuntimeBackend::new`), which carries
 * `--permission-prompt-tool stdio` instead — so the CLI raises a `can_use_tool` control
 * request, supercode publishes it on `frontend.v2`, and the panel draws Allow / Allow
 * for session / Deny. The same flag decides the terminal attach launch
 * (`resume_instructions`).
 *
 * So the skipped permissions B9c measured on the child process were OURS, not
 * supercode's: the literal is in supercode, the `policy` that selects it was set here.
 *
 * IT HAS A VERSION FLOOR, and that floor is why `packages/editor/package.json` asks for
 * `@volter-ai-dev/supercode` `^0.4.36`. `--permission-prompt-tool stdio` joined the Claude
 * backend's own prefix on 2026-09-04 (`6ef3be26`); the binary an older install resolved here,
 * 0.4.11, is built from 2026-08-24 and predates it. MEASURED on the child of a real session
 * against 0.4.11: `claude --print … --verbose --session-id …` with NO permission handler at
 * all — and supercode's own comment on that flag says a tool call that needs an answer is then
 * refused outright with `permission_denied`. Against 0.4.36 the same launch carries the flag.
 * `default` without the handler is WORSE than `yolo`, so the two move together.
 * The person's approvals are the product's safety and the panel is where they answer
 * them, so the default launch ASKS. Changing this constant changes both launches; there
 * is deliberately no per-call override, because a chat that asks and a terminal that
 * does not is one agent with two safety stories.
 */
const RUNTIME_POLICY = 'default' as const;

/**
 * WHICH AGENT FILLS THE CHAT VIEW: whichever one supercode says can run here. Supercode
 * probes every harness it knows (Claude Code, Codex, Grok, Gemini, …) and reports, per
 * harness, whether it is installed and signed in and what it can do now
 * (`availableActions`); the editor names none of them. A project's own most recent
 * session is resumed with the harness that ran it, when that harness can still resume;
 * otherwise the first harness supercode lists as able to start is started. When none
 * can, the refusal names each one with supercode's own reason and repair.
 */
function harnessRefusal(harnesses: readonly HarnessChatHarness[]): string {
  if (harnesses.length === 0) return 'Supercode reports no coding agents on this machine, so the Chat view has none to start.';
  const lines = harnesses.map((harness) => {
    const why = harness.reason ?? (harness.installed ? `not ready (${harness.auth})` : 'not installed');
    return `${harness.label}: ${why}${harness.repair ? ` — ${harness.repair}` : ''}`;
  });
  return `No coding agent is available for the Chat view. ${lines.join('; ')}.`;
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

export interface HarnessChatServiceOptions {
  engineRoot: string;
  getProjectRoot: () => string;
  onChange: (snapshot: HarnessChatSnapshot) => void;
  initializeTimeoutMs?: number;
  /** Test seam; production periodically discovers sessions launched after editor boot. */
  discoveryPollMs?: number;
  /** Sessions that invoked vgai for this project from outside its workspace. */
  callerSessions?: readonly HarnessChatCallerSession[];
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

function descriptorPresentationFingerprint(sessions: readonly HeadlessSessionDescriptor[]): string {
  return JSON.stringify(
    sessions
      .map((session) => ({
        locator: locatorKey(session),
        title: session.title,
        previewCandidates: session.preview_candidates,
        latestMessageCandidates: session.latest_message_candidates,
        updatedAt: session.updated_at_ms,
        messageCount: session.message_count,
        liveStatus: session.live_status,
        activity: session.activity
          ? {
              presence: session.activity.presence,
              turn: session.activity.turn,
              source: session.activity.evidence.source,
              nativeState: session.activity.evidence.native_state,
              harnessVersion: session.activity.evidence.harness_version,
            }
          : null,
      }))
      .sort((left, right) => left.locator.localeCompare(right.locator)),
  );
}

function sessionIdentityFingerprint(identities: Iterable<string>): string {
  return JSON.stringify([...identities].sort());
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
        harnesses?: string[];
        limit?: number;
        include_topic_candidates?: boolean;
        include_child_sessions?: boolean;
      }): Promise<{ sessions: HeadlessSessionDescriptor[] }> => {
        const discover = target.discover.bind(target);
        const includeTopicCandidates = query.include_topic_candidates !== false;
        const base = await discover({ ...query, include_topic_candidates: includeTopicCandidates });
        const callers = getCallers();
        if (callers.length === 0) {
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
        const supplemental = await Promise.all(
          [...wantedByHarness].map(async ([harness, ids]) => {
            const global = await discover({
              harnesses: [harness],
              include_topic_candidates: includeTopicCandidates,
            });
            return global.sessions.filter(
              (descriptor) =>
                descriptor.locator.harness === harness && ids.has(descriptor.locator.session_id),
            );
          }),
        );
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

async function importSupercodePackages(engineRoot: string): Promise<{
  SupercodeHarnessClient: SupercodeClientConstructor;
  SupercodeController: HeadlessControllerConstructor;
  assertSupercodeClientSnapshot: HeadlessSnapshotAssertion;
  projectConversation: HeadlessProjectConversation;
  deriveTaskPlan: HeadlessDeriveTaskPlan;
  sessionReconnectIdentity: HeadlessSessionIdentity;
}> {
  const sibling = join(dirname(engineRoot), 'supercode', 'sdk');
  const cwdSibling = join(dirname(resolve(process.cwd())), 'supercode', 'sdk');
  const controllerCandidates = [
    ...moduleCandidate(process.env['SUPERCODE_CLIENT_PATH'], 'client.mjs'),
    '@volter-ai-dev/supercode-client',
    join(sibling, 'client', 'client.mjs'),
    join(cwdSibling, 'client', 'client.mjs'),
  ];
  const [SupercodeHarnessClient, clientModule] = await Promise.all([
    importOptional<SupercodeClientConstructor>('Supercode harness SDK', 'SupercodeHarnessClient', [
      ...moduleCandidate(process.env['SUPERCODE_SDK_PATH'], 'client.mjs'),
      '@volter-ai-dev/supercode-harness-sdk',
      join(sibling, 'typescript', 'client.mjs'),
      join(cwdSibling, 'typescript', 'client.mjs'),
    ]),
    importOptionalModule(
      'Supercode headless client',
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

async function importSupercodeController(engineRoot: string): Promise<{
  SupercodeController: HeadlessControllerConstructor;
  assertSupercodeClientSnapshot: HeadlessSnapshotAssertion;
  projectConversation: HeadlessProjectConversation;
  deriveTaskPlan: HeadlessDeriveTaskPlan;
  sessionReconnectIdentity: HeadlessSessionIdentity;
}> {
  const sibling = join(dirname(engineRoot), 'supercode', 'sdk', 'client', 'client.mjs');
  const cwdSibling = join(
    dirname(resolve(process.cwd())),
    'supercode',
    'sdk',
    'client',
    'client.mjs',
  );
  const candidates = [
    ...moduleCandidate(process.env['SUPERCODE_CLIENT_PATH'], 'client.mjs'),
    '@volter-ai-dev/supercode-client',
    sibling,
    cwdSibling,
  ];
  const clientModule = await importOptionalModule(
    'Supercode headless client',
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
    clientRoot = dirname(fileURLToPath(import.meta.resolve('@volter-ai-dev/supercode-client')));
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
    `The source-linked Supercode SDK at ${clientRoot} has no built core binary. Run \`cargo build --bin supercode\` in ${sourceRoot}.`,
  );
}

export function findSupercodeCommand(engineRoot: string): string | undefined {
  if (process.env['SUPERCODE_BIN']) return process.env['SUPERCODE_BIN'];
  // A source-linked SDK must run the core from that same checkout. Falling
  // through to an unrelated npm install creates a mixed-version system that
  // can be protocol-compatible enough to start while returning stale or
  // incorrectly classified sessions.
  const sourceCommand = findSourceLinkedSupercodeCommand();
  if (sourceCommand) return sourceCommand;
  const require = createRequire(import.meta.url);
  try {
    const packageRoot = dirname(require.resolve('@volter-ai-dev/supercode/package.json'));
    const installedCommand = join(packageRoot, 'bin', 'supercode.js');
    if (existsSync(installedCommand) && statSync(installedCommand).isFile())
      return installedCommand;
  } catch {
    // Optional dependency omitted: retain source-checkout fallbacks below.
  }
  for (const candidate of [
    join(dirname(engineRoot), 'supercode', 'target', 'release', 'supercode'),
    join(dirname(engineRoot), 'supercode', 'target', 'debug', 'supercode'),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
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
    schema: 'vgai.harness-chat.v4',
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
    ...unavailable(workspace, 'Supercode is loading.', workspaceGeneration, serverInstanceId),
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
  private discoveryInFlight = false;
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
  private renderedInventoryFingerprint: string | null = null;
  private readonly bridgeListeners = new Set<() => void>();
  private lastSnapshot: HarnessChatSnapshot = unavailable(
    null,
    'Supercode is loading.',
    0,
    this.serverInstanceId,
  );
  /** The last managed runtime the SDK handed back, for the frontend handoff's receipt lookup. */
  private managedRuntime: HeadlessManagedRuntime | null = null;
  private observedModel: string | null = null;
  private chatSelection: ChatSelection = { ...DEFAULT_CHAT_SELECTION };
  private selectingChat = false;
  private readonly chatCatalog: ChatSessionCatalog;
  private readonly frontendControls = new FrontendControls(() => this.chatControlState(), (selection) => this.selectChat(selection), id => this.openChat(id), (id, nativeId) => this.bindChatIdentity(id, nativeId));
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
    try { this.chatSelection = validateChatSelection(JSON.parse(readFileSync(join(workspace, '.vgai', 'chat-selection.json'), 'utf8'))); } catch { /* no saved selection */ }
    this.chatCatalog = new ChatSessionCatalog(join(workspace, '.vgai', 'chat-sessions.json'));
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
    const created = !this.controller;
    await this.ensureController(autoObserve);
    if (!this.controller) return this.snapshot();
    if (!created) await this.controller.dispatch({ type: 'refresh', autoObserve });
    this.capture();
    return this.snapshot();
  }

  /** Ensure the live controller exists without re-running full harness/session
   * discovery when an editor tab mounts or reloads. The service's idle probe
   * detects inventory changes without coupling discovery to browser views. */
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


  /** Dispatch the package-owned messenger intent without translating it into
   * a second VGAI action vocabulary. */
  async actIntent(intent: SupercodeUiIntent): Promise<HarnessChatSnapshot> {
    await this.ensureController();
    const host = this.remoteHost;
    if (!host) {
      throw new Error(this.lastSnapshot.error?.message ?? 'Supercode is unavailable.');
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
    runtime.on?.('event', event => {
      if (this.managedRuntime !== runtime) return;
      const payload = event.raw?.payload;
      if (!payload || typeof payload !== 'object') return;
      const record = payload as { model?: unknown; message?: { model?: unknown } };
      const model = record.message?.model ?? record.model;
      if (typeof model === 'string' && model.length > 0 && model.length < 200) this.observedModel = model;
    });
  }

  /** The private controls channel's environment for the extension host: started
   *  at once, with no runtime behind it yet (the channel answers with it). */
  async frontendControlsEnv(): Promise<Record<string, string>> {
    return this.frontendControls.start();
  }

  private async chatControlState() {
    // The extension asks for this at activation; a runtime still being handed
    // over is waited for, so the answer carries its connection.
    await this.frontendHandoffInFlight?.catch(() => undefined);
    await this.ensureController();
    const snapshot = this.snapshot();
    return {
      selection: { ...this.chatSelection },
      activeSession: this.chatCatalog.active,
      openSessionCommand: 'volter.chat.openSession',
      sessions: [...this.chatCatalog.sessions.values()],
      actualModel: this.observedModel,
      connection: this.frontendHandoffValue?.env,
      busy: (await this.frontendHandoffValue?.isBusy()) || snapshot.turn.state === 'running' || snapshot.requests.length > 0,
      harnesses: snapshot.harnesses.filter(h => h.availableActions.start).map(h => ({ id: h.id, name: h.label })),
      models: chatModels(this.chatSelection.harness),
      modelsByHarness: Object.fromEntries(snapshot.harnesses.filter(h => h.availableActions.start).map(h => [h.id, chatModels(h.id)])),
      configurable: ['claude-code', 'codex'].includes(this.chatSelection.harness),
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
    if (entry.identity && entry.identity !== session.identity) throw new Error('The conversation is already bound to a different harness session.');
    entry.identity = session.identity;
    entry.title = session.title;
    this.chatCatalog.save();
    return this.chatControlState();
  }

  private async openChat(id: string) {
    const entry = this.chatCatalog.sessions.get(id);
    if (!entry) throw new Error('This chat session is not available. Start a new chat explicitly.');
    if (!(id === this.chatCatalog.active && this.frontendHandoffValue && !this.managedRuntime?.closed)) {
      if (!entry.identity) throw new Error('This chat has no persisted harness session to resume. Start a new chat.');
      await this.selectChat(entry.selection, id);
    }
    let history: unknown[] = [];
    let historyTruncated = false;
    if (entry.identity) {
      const session = this.lastSnapshot.sessions.find(s => s.identity === entry.identity);
      if (!session) throw new Error('The saved conversation history is unavailable.');
      const loaded = await this.controller!.loadSession(session.id);
      const transcript = loaded as unknown as NormalizedSession;
      const messages = transcript.messages;
      historyTruncated = Math.max(messages.length, transcript.total_message_count ?? 0) > 120;
      history = messages.slice(-120);
    }
    return {...await this.chatControlState(), history, historyTruncated};
  }

  private async selectChat(selection: ChatSelection, resumeId?: string) {
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
        await oldHandoff?.dispose();
        await withTimeout(previousController.close(), 10_000, 'Closing previous chat runtime');
        this.managedRuntime = null;
        this.observedModel = null;
        await this.ensureController(false);
        const restored = this.lastSnapshot.sessions.find(s => s.identity === entry.identity && s.harness === selection.harness);
        if (!restored) throw new Error('The saved conversation could not be rediscovered after closing its previous runtime.');
        action = {type:'resume', sessionKey:restored.id};
      }
      const result = await this.controller!.dispatch(action);
      if (result.error) throw new Error(result.error.message);
      activated = true;
      if (resumeId) { this.chatCatalog.active = resumeId; this.chatCatalog.save(); }
      else this.chatCatalog.create(selection);
      const runtimeId = this.managedRuntime?.handle?.runtime_id;
      if (!runtimeId) throw new Error('The selected harness did not start.');
      const handoff = await mintFrontendHandoff({ engineRoot: this.options.engineRoot, runtimeSessionId: runtimeId,
        directory: join(homedir(), '.vgai', 'runtime', `frontend-${process.pid}-${randomUUID()}`) });
      const old = this.frontendHandoffValue;
      this.frontendHandoffValue = handoff;
      this.frontendRefusalValue = null;
      await old?.dispose();
      const folder = join(this.options.getProjectRoot(), '.vgai');
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
   * harness can still resume (the selected harness's, when one was chosen), or `null` when it
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
    const resumable = new Set(
      this.lastSnapshot.harnesses.filter((harness) => harness.availableActions.resume).map((harness) => harness.id),
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
      await this.ensureController();
      const controller = this.controller;
      if (!controller) throw new Error('Supercode is unavailable.');
      if (!this.managedRuntime || this.managedRuntime.closed) {
        // REOPENING A PROJECT RESUMES ITS LAST SESSION, it does not start a second one.
        // `vgai close` ends the runtime with the session, so without this every reopen
        // handed the panel a FRESH Claude session and the person's own conversation was
        // gone — measured: close, reopen, and the Chat view came back empty while the
        // extension's status door listed a brand new runtime id.
        //
        // Both doors are the controller's own and both ask readiness first, so a harness
        // that is not signed in is still refused BY NAME with its own login command —
        // which is the sentence a person needs, and the one that travels to the cover,
        // `.vgai/session.json` and the console ledger.
        this.capture();
        if (this.lastSnapshot.harnesses.length === 0) {
          await controller.dispatch({ type: 'refresh', autoObserve: false });
          this.capture();
        }
        const resumable = this.resumableSessionKey();
        // A harness that reports a login goes before one whose login is unknown, so a
        // signed-in agent is never passed over for one that will refuse; within each group
        // supercode's own order stands.
        const signedIn = (harness: HarnessChatHarness) => harness.auth === 'ready' || harness.auth === 'configured';
        const startable = [...this.lastSnapshot.harnesses]
          .filter((harness) => harness.availableActions.start)
          .sort((left, right) => Number(signedIn(right)) - Number(signedIn(left)))[0];
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
          'Supercode started no agent runtime for this project, so the Chat view has nothing to attach to.',
        );
      }
      const handoff = await mintFrontendHandoff({
        engineRoot: this.options.engineRoot,
        runtimeSessionId: runtimeId,
        directory: join(homedir(), '.vgai', 'runtime', `frontend-${process.pid}`),
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
      return;
    }
    await this.ensureController(true);
  }

  async close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.frontendControls.close();
    if (this.discoveryTimer) clearTimeout(this.discoveryTimer);
    this.discoveryTimer = null;
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
    this.renderedInventoryFingerprint = null;
    this.bridgeListeners.clear();
    const handoff = this.frontendHandoffValue;
    this.frontendHandoffValue = null;
    this.managedRuntime = null;
    void handoff?.dispose();
    this.closing = controller
      ? withTimeout(controller.close(), 2_500, 'Supercode shutdown').then(
          () => undefined,
          () => undefined,
        )
      : Promise.resolve();
    return this.closing;
  }

  private async ensureController(autoObserve = true): Promise<void> {
    if (this.closed) throw new Error('Harness Chat service is closed.');
    const next = resolve(this.options.getProjectRoot());
    if (this.controller) {
      if (this.workspace !== next) {
        this.beginWorkspace(next);
        await this.controller.setWorkspace(next, { autoObserve: true });
        this.capture();
      }
      return;
    }
    if (this.starting) {
      await this.starting;
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
        await withTimeout(controller.close(), 2_500, 'Supercode shutdown').catch(() => undefined);
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
              `Supercode UI action is not available in this editor: ${intent.action}`,
            );
          },
        },
      );
      this.unsubscribe = controller.subscribe(() => this.capture());
      this.capture();
      const timeoutMs = this.options.initializeTimeoutMs ?? DEFAULT_INITIALIZE_TIMEOUT_MS;
      await withTimeout(controller.initialize(), timeoutMs, 'Supercode initialization');
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
        await withTimeout(controller.close(), 2_500, 'Supercode shutdown').catch(() => undefined);
      }
    }
  }

  private async createHeadlessController(
    workspace: string,
    autoObserve: boolean,
  ): Promise<HeadlessController> {
    const piExtensionPath = join(homedir(), '.vgai', 'runtime', 'pi-openrouter-extension.mjs');
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
        : await importSupercodeController(this.options.engineRoot);
      const sessionReconnectIdentity =
        this.options.sessionReconnectIdentity ?? module?.sessionReconnectIdentity;
      if (!sessionReconnectIdentity) {
        throw new Error(
          'An injected Supercode controller must provide its sessionReconnectIdentity test seam.',
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
      );
      this.discoveryClient = client;
      if (this.options.createController) {
        return this.options.createController(client, workspace, { autoObserve });
      }
      if (!module) throw new Error('Supercode controller could not be loaded.');
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
    } = await importSupercodePackages(this.options.engineRoot);
    this.assertSnapshot = assertSupercodeClientSnapshot;
    this.projectConversation = projectConversation;
    this.deriveTaskPlan = deriveTaskPlan;
    this.sessionIdentity = sessionReconnectIdentity;
    const command = findSupercodeCommand(this.options.engineRoot);
    const client = withCallerSessionDiscovery(
      withManagedRuntimeObserver(
        new SupercodeHarnessClient({
          cwd: workspace,
          ...(command ? { command } : {}),
        }),
        (runtime) => this.observeChatRuntime(runtime),
        transformBackend,
      ),
      () => this.callerSessions(),
      (sessions) => this.rememberSessionInventory(sessions, sessionReconnectIdentity, workspace),
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
   * A passive probe that answers `unknown` is escalated to the HANDSHAKE probe for this
   * one harness — Supercode's own recommended next step, and the only way to tell "not
   * signed in" from "cannot tell without opening it". Measured 2026-09-21: OpenCode on
   * this box reads `auth: unknown` passively and `auth: ready` under the handshake (3.9s),
   * so treating the passive answer as a refusal would have blocked a working harness.
   *
   * WHAT THIS ADDS OVER SUPERCODE'S OWN DOOR, so the next reader does not take it for a
   * duplicate: the controller already refuses a not-installed or `required` harness in
   * `harnessActions` (`start: installed && auth !== 'required' && …`) from its LAST
   * INVENTORY — measured verbatim here on a not-installed harness, which never reaches
   * this seam. This read is FRESH at the moment of launch, so a sign-in or sign-out since
   * that refresh counts, and it escalates the `unknown` the controller treats as
   * startable into a verdict instead of an opaque failure inside the harness.
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
        let entry = await ask('passive');
        if (entry?.installed && entry.auth === 'unknown') entry = (await ask('handshake')) ?? entry;
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
    this.renderedInventoryFingerprint = descriptorPresentationFingerprint([
      ...this.sessionDescriptorsByIdentity.values(),
    ]);
    this.options.onChange(this.snapshot());
    for (const listener of this.bridgeListeners) listener();
  }

  private scheduleDiscovery(): void {
    if (this.discoveryTimer) clearTimeout(this.discoveryTimer);
    this.discoveryTimer = null;
    const delay = this.options.discoveryPollMs ?? 4_000;
    if (this.closed || delay <= 0) return;
    this.discoveryTimer = setTimeout(() => {
      this.discoveryTimer = null;
      void this.pollDiscovery();
    }, delay);
  }

  private async pollDiscovery(): Promise<void> {
    if (this.closed || this.discoveryInFlight) return;
    if (this.selectingChat) { this.scheduleDiscovery(); return; }
    const controller = this.controller;
    const client = this.discoveryClient;
    const snapshot = this.lastSnapshot;
    const raw = this.lastHeadlessSnapshot;
    if (
      !controller ||
      !client ||
      !raw ||
      !this.workspace ||
      snapshot.operation !== null ||
      snapshot.turn.state !== 'idle'
    ) {
      this.scheduleDiscovery();
      return;
    }
    this.discoveryInFlight = true;
    try {
      const discovered = await client.discover({
        workspace: this.workspace,
        limit: 100,
        include_topic_candidates: false,
      });
      const presentationFingerprint = descriptorPresentationFingerprint(discovered.sessions);
      const controllerInventoryChanged =
        sessionIdentityFingerprint(this.sessionDescriptorsByIdentity.keys()) !==
        sessionIdentityFingerprint(raw.sessions.map((session) => session.identity));
      if (controllerInventoryChanged) {
        await controller.dispatch({
          type: 'refresh',
          autoObserve: false,
          silent: true,
        });
        if (!this.closed && controller === this.controller) this.capture();
      } else if (presentationFingerprint !== this.renderedInventoryFingerprint) {
        // Presentation evidence belongs in the controller snapshot too. Feed
        // the changed inventory back through Supercode instead of joining raw
        // descriptors into a second VGAI-owned list projection.
        await controller.dispatch({
          type: 'refresh',
          autoObserve: false,
          silent: true,
        });
        if (!this.closed && controller === this.controller) this.capture();
      }
    } catch {
      // Explicit Refresh remains the visible recovery path. Background discovery
      // is observational and must not replace a healthy chat snapshot with noise.
    } finally {
      this.discoveryInFlight = false;
      this.scheduleDiscovery();
    }
  }

  private beginWorkspace(workspace: string): void {
    if (this.workspace === workspace) return;
    this.workspace = workspace;
    this.workspaceGeneration++;
    this.lastHeadlessSnapshot = null;
    this.sessionDescriptorsByIdentity.clear();
    this.subagentDescriptorsByKey.clear();
    this.subagentInspector = null;
    this.inventoryCaptureGeneration++;
    this.renderedInventoryFingerprint = null;
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
    if (!this.controller) throw new Error('Supercode is unavailable.');
    return this.controller.loadSession(sessionKey);
  }
}
