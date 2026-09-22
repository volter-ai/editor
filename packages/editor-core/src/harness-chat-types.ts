import { normalizeUiState, type SupercodeUiState } from '@volter-ai-dev/supercode-ui/core';
import type { RemoteUiFrame } from '@volter-ai-dev/supercode-ui/host';

/**
 * Browser/server contract for the permanent coding-agent surface.
 *
 * Supercode owns harness, session, transcript, and runtime semantics. This
 * wire mirrors its frontend state instead of inventing a second state
 * machine; VGAI adds only editor-specific presentation and context.
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type HarnessChatMode = 'none' | 'observe' | 'control';
export type HarnessChatStatus = 'loading' | 'ready' | 'working' | 'error' | 'unavailable';
/** Mirrors Supercode's passive/handshake authentication posture exactly. */
export type HarnessChatAuthState = 'ready' | 'configured' | 'required' | 'unknown';
export type HarnessChatRuntimeState = 'ready' | 'degraded' | 'unavailable';
export type HarnessChatOperation =
  | 'refresh'
  | 'observe'
  | 'start'
  | 'resume'
  | 'attach'
  | 'fork'
  | 'reduce'
  | 'restore'
  | 'detach'
  | 'openTerminal'
  | 'send'
  | 'steer'
  | 'interrupt'
  | 'respond'
  | 'configureHarness'
  | 'loadEarlier'
  | 'load'
  | 'import'
  | 'export'
  | 'translate'
  | 'handoff'
  | 'workspace'
  | 'close'
  | null;

export interface HarnessChatCapabilities {
  startSession: boolean;
  resumeSession: boolean;
  attachExistingProcess: boolean;
  sendInput: boolean;
  streamEvents: boolean;
  interrupt: boolean;
  respondToRequests: boolean;
}

export interface HarnessChatHarness {
  id: string;
  label: string;
  installed: boolean;
  auth: HarnessChatAuthState;
  runtime: HarnessChatRuntimeState;
  protocol: string;
  capabilities: HarnessChatCapabilities;
  availableActions: {
    start: boolean;
    resume: boolean;
    attach: boolean;
    send: boolean;
    interrupt: boolean;
    respond: boolean;
  };
  reason: string | null;
  repair: string | null;
}

export interface HarnessChatSession {
  /** Opaque, controller-scoped key used by actions. */
  id: string;
  /** Stable, non-display identity used only to restore this exact selection. */
  identity: string;
  /** Harness-native identity, display/diagnostics only. */
  nativeId?: string;
  harness: string;
  title: string;
  cwd: string | null;
  updatedAt: number | null;
  messageCount: number | null;
  model: string | null;
  storage: 'file' | 'sqlite';
  /** What the session's process reports for itself RIGHT NOW — a live
   *  peer's status — or `null` for a persisted session with no process. */
  live?: 'running' | 'busy' | 'idle' | null;
}

export interface HarnessChatTaskPlanItem {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'unknown';
  nativeStatus?: string;
  blockedBy?: string[];
}

export interface HarnessChatTaskPlan {
  source: 'codex-update-plan' | 'claude-tasks' | 'opencode-todos' | 'none';
  items: HarnessChatTaskPlanItem[];
  residue: unknown[];
  observedAt: number | null;
}

export interface HarnessChatRequestOption {
  optionId: string;
  name: string;
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always' | 'other';
}

export interface HarnessChatRequestEntry {
  id: string;
  kind: 'request';
  requestId: JsonValue;
  requestKind: string;
  payload: JsonValue;
  options: HarnessChatRequestOption[];
  cancellable: boolean;
  status: 'pending' | 'responded';
  resolution: { optionId: string | null; name: string; kind: string } | null;
}

export interface HarnessChatAvailableActions {
  refresh: boolean;
  observe: boolean;
  start: boolean;
  resume: boolean;
  attach: boolean;
  fork: boolean;
  detach: boolean;
  openTerminal: boolean;
  send: boolean;
  interrupt: boolean;
  respond: boolean;
}

export interface HarnessChatError {
  code: string;
  message: string;
  operation: Exclude<HarnessChatOperation, null> | 'runtime' | 'follow';
  recoverable: boolean;
}

export interface HarnessChatSnapshot {
  schema: 'vgai.harness-chat.v4';
  /** Identifies the editor-server process that issued this snapshot. */
  serverInstanceId: string | null;
  revision: number;
  /** Monotonic host generation. Revisions are only comparable within it. */
  workspaceGeneration: number;
  workspace: string | null;
  status: HarnessChatStatus;
  mode: HarnessChatMode;
  operation: HarnessChatOperation;
  harnesses: HarnessChatHarness[];
  sessions: HarnessChatSession[];
  activeHarness: string | null;
  activeSessionId: string | null;
  connection: {
    strategy: 'start' | 'resume' | 'attach' | 'fork' | 'reduce' | null;
    follow: 'inactive' | 'following' | 'retrying';
    ownsRuntime: boolean;
  };
  turn: {
    state: 'idle' | 'running' | 'interrupting' | 'reconciling';
    id: string | null;
    startedAt: number | null;
  };
  /** Ordered Supercode host frame. This is the sole messenger lifecycle authority. */
  frame: RemoteUiFrame | null;
  taskPlan: HarnessChatTaskPlan;
  requests: HarnessChatRequestEntry[];
  availableActions: HarnessChatAvailableActions;
  error: HarnessChatError | null;
  terminalCommand: string | null;
}

/** VGAI's one editor-host extension. Every reusable messenger mutation uses
 * SupercodeUiIntent unchanged through the intent route. */
export type HarnessChatHostAction = {
  type: 'restore';
  sessionIdentity: string;
  connection: 'observe' | 'attach';
};

/** Read the sole canonical messenger projection. A frame-less loading/error
 * snapshot gets a local empty view; it is never serialized as a second state. */
export function harnessChatUiState(snapshot: HarnessChatSnapshot): SupercodeUiState {
  if (snapshot.frame) return snapshot.frame.state;
  return normalizeUiState({
    startup: snapshot.status === 'loading' ? 'connecting' : 'ready',
    workspace: snapshot.workspace ?? '',
    error: snapshot.error?.message ?? null,
    recoverable: snapshot.error?.recoverable ?? true,
  });
}

export function unavailableHarnessChatSnapshot(
  error: string,
  options?: { code?: string; recoverable?: boolean },
): HarnessChatSnapshot {
  return {
    schema: 'vgai.harness-chat.v4',
    serverInstanceId: null,
    revision: 0,
    workspaceGeneration: 0,
    workspace: null,
    status: 'unavailable',
    mode: 'none',
    operation: null,
    harnesses: [],
    sessions: [],
    activeHarness: null,
    activeSessionId: null,
    connection: { strategy: null, follow: 'inactive', ownsRuntime: false },
    turn: { state: 'idle', id: null, startedAt: null },
    frame: null,
    taskPlan: { source: 'none', items: [], residue: [], observedAt: null },
    requests: [],
    availableActions: {
      refresh: false,
      observe: false,
      start: false,
      resume: false,
      attach: false,
      fork: false,
      detach: false,
      openTerminal: false,
      send: false,
      interrupt: false,
      respond: false,
    },
    error: error
      ? {
          code: options?.code ?? 'unavailable',
          message: error,
          operation: 'load',
          recoverable: options?.recoverable ?? true,
        }
      : null,
    terminalCommand: null,
  };
}
