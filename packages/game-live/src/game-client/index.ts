/**
 * The game-control client `@volter/game-live` binds as `game`: a `GameClient` over a
 * `BridgeTransport`, plus the pure logic it is built from (wait budgets, event
 * matching, failure blocks, fast-forward planning, hidden-tab recovery, perf
 * sampling, screenshot-target resolution).
 *
 * Two transports answer the same seam (`bridge-transport.ts`): `RelayTransport`
 * drives a live `volter-game-editor edit` session over the editor dev server's wire — the one
 * `@volter/game-live` itself uses — and `PageTransport` drives a Playwright `Page`
 * directly, for a caller that owns its own browser. Every method body on
 * `GameClient` is written against the seam, never against either transport.
 *
 * This barrel exists so `../index.ts` re-exports one coherent surface instead of
 * a dozen sibling paths; nothing here imports anything from `../`.
 */

export type { BridgeHeartbeatState } from './bridge-heartbeat.js';
export { BRIDGE_HEARTBEAT_INTERVAL_MS, formatBridgeHeartbeatLine } from './bridge-heartbeat.js';
export type { BridgeCallOutcome, BridgeTransport } from './bridge-transport.js';
export type { CaptureListener, CaptureNotes, CaptureRecord } from './capture-notes.js';
export { describeCaptureCaveat } from './capture-notes.js';
export type { GameClientOptions } from './client.js';
export { GameClient, GameEvents, GameInput, PageTransport } from './client.js';
export type { SessionErrorCode } from './errors.js';
export { SESSION_ERROR_CODES, SessionError, SessionFailure } from './errors.js';
export type { EventsMatchOptions, EventsMatchResult } from './events-matcher.js';
export { matchEventsSubsequence } from './events-matcher.js';
export type {
  AssembledFailureBlock,
  FailureBlockContext,
  SessionFailureData,
} from './failure-block.js';
export type {
  FastForwardBudget,
  FastForwardClock,
  FastForwardOptions,
  FastForwardRenderMode,
  FastForwardTime,
} from './fast-forward.js';
export {
  DEFAULT_FAST_FORWARD_BATCH_TICKS,
  DEFAULT_FIXED_DT,
  planFastForwardBatches,
  runFastForward,
  ticksForBudget,
} from './fast-forward.js';
export type {
  HiddenRecoveryAction,
  HiddenRecoveryHooks,
  HiddenRecoveryState,
  PollObservation,
} from './hidden-recovery.js';
export {
  HIDDEN_RECOVERY_STALL_POLLS,
  HiddenRecoveryDriver,
  hiddenRecoveryLogLine,
  initialHiddenRecoveryState,
  shouldSampleHidden,
  stepHiddenRecovery,
} from './hidden-recovery.js';
export type { TpsStats } from './perf-sampling.js';
export {
  computeTicksPerSecond,
  percentile,
  simSpeedRatio,
  summarizeTpsSamples,
  TpsAccumulator,
} from './perf-sampling.js';
export type { RelayTransportOptions } from './relay-transport.js';
export { RelayTransport } from './relay-transport.js';
export type {
  ScreenshotArgKind,
  ScreenshotTarget,
  ScreenshotTargetInput,
} from './screenshot-target.js';
export {
  classifyScreenshotArg,
  resolveScreenshotTarget,
  sanitizeScreenshotLabel,
} from './screenshot-target.js';
export type { CappedJson } from './state-cap.js';
export { capJson } from './state-cap.js';
export type {
  DebugBridgeInput,
  DebugCommandInfo,
  DebugSnapshot,
  ProviderInfo,
  RunTicksOptions,
  TickStampedEvent,
  ValueTier,
  VgaiBridgeHandle,
  VirtualActionResult,
  VirtualActionValue,
} from './types.js';
export type { WaitForBudget } from './wait-for.js';
export {
  assertValidWaitForBudget,
  WAIT_FOR_STALL_POLL_LIMIT,
  WAIT_FOR_TIMEOUT_OPTION_MESSAGE,
} from './wait-for.js';
