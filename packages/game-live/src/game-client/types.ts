/**
 * The frozen shape of `window.__vgai`, the in-page debug bridge installed by
 * the engine (`packages/editor-game/src/runtime/debug-bridge.ts`, Task 2.1 —
 * landing concurrently with this package). This module declares that shape
 * independently; it never imports the engine package, so this package can be
 * built and tested independently of the bridge's landing.
 */

export type ValueTier = 'observable' | 'assisted';

export interface ProviderInfo {
  name: string;
  tier: ValueTier;
}

export interface DebugCommandInfo {
  name: string;
  description?: string;
  argsJsonSchema?: unknown;
  locus: 'client' | 'server';
}

/** Run-4 friction #5: `seq` is a registry-lifetime monotonic counter (never
 *  reset, never shared by two events — unlike `tick`, which a debug-command
 *  emission and a fenced consumer's snapshot can legitimately collide on).
 *  Mirrors `@vgai/project`'s `TickStampedEvent` (`adapter/system-adapter.ts`)
 *  — this package never imports the engine (see the module doc above), so
 *  the shape is declared here from the same contract. */
export interface TickStampedEvent {
  tick: number;
  simT: number;
  event: string;
  detail?: unknown;
  seq: number;
}

export type VirtualActionValue = boolean | number | { x: number; y: number };

export interface VirtualActionResult {
  delivered: boolean;
  reason?: string;
}

export interface DebugBridgeInput {
  setVirtualAction(action: string, value: VirtualActionValue): VirtualActionResult;
  tapVirtualAction(action: string): VirtualActionResult;
  clearVirtualActions(): void;
  /** Schedule a virtual actuation for a specific tick, applied
   *  at the start of that tick's input phase. Declared here for the
   *  bridge↔wire coverage-parity gate — type-shape completeness with
   *  `runtime/debug-bridge.ts`'s `VgaiDebugInputHandle` — this package still
   *  exposes no client-side convenience wrapper around it (deliberately
   *  parked; see `GameInput` in `client.ts`), this is pure type-shape
   *  mirroring. */
  scheduleActionAtTick(tick: number, action: string, value: VirtualActionValue): void;
  /** Pointer-dispatch op — mirrors `runtime/debug-bridge.ts`'s
   *  `VgaiDebugInputHandle.injectPointerDelta`: accumulates a synthetic
   *  pointer delta for a named test source (sums within a frame, clears each
   *  frame). Declared here for type-shape completeness with the bridge, same
   *  precedent as `scheduleActionAtTick` above — no client-side convenience
   *  wrapper in `client.ts` (deliberately parked). */
  injectPointerDelta(sourceId: string, delta: { x: number; y: number }): void;
  /** Pointer-dispatch op — mirrors `runtime/debug-bridge.ts`'s
   *  `VgaiDebugInputHandle.injectPointerPosition`: sets a synthetic absolute
   *  pointer position for a named test source (last-write-wins, persists
   *  until changed). Same type-shape-only precedent as `scheduleActionAtTick`. */
  injectPointerPosition(sourceId: string, value: { x: number; y: number }): void;
}

/** D15/T-D15.4 door (a) — `Game.runTicks`'s options, mirrored from the
 *  engine's own `runtime/debug-registry.ts` `RunTicksOptions` (this package
 *  never imports the engine — see the module doc above — so the shape is
 *  declared here from the build plan's/D15 doc's contract text, same as
 *  every other bridge member). */
export interface RunTicksOptions {
  render?: 'last' | 'all' | 'none';
}

/** One coherent read of the whole bridge — `snapshot()` is the fixture's poll
 *  primitive: every field comes from the same synchronous pass. */
export interface DebugSnapshot {
  time: {
    simSeconds: number;
    tick: number;
    /**
     * Issue #175 — the REAL engine `GameLoop.liveness` behind this session
     * (mirrors `@vgai/game-runtime`'s `GameLoopLiveness`; this package never
     * imports the engine — see the module doc above — so the union is
     * declared here from the same contract). `'loop-starved'` means no recent
     * host rAF callback was observed. It may reflect the current visibility
     * gate or an armed callback the browser has starved; it is NOT itself a
     * visibility verdict or proof that the game crashed.
     * `undefined` against an older bridge build that predates this field;
     * `null` when the live bridge has no loop wired at all (should not
     * happen against a real `Game`, but never fabricated either way).
     */
    loopLiveness?: 'running' | 'loop-starved' | 'stopped' | null;
  };
  state: Record<string, unknown>;
  events: TickStampedEvent[];
  pageErrors: string[];
}

/** `window.__vgai`'s shape (version 1, frozen — see the build plan's ground
 *  rule 4). */
export interface VgaiBridgeHandle {
  version: 1;
  providers(): ProviderInfo[];
  state(name: string): unknown;
  stateAll(): Record<string, unknown>;
  commands(): DebugCommandInfo[];
  invoke(name: string, args: unknown[]): Promise<unknown>;
  /** Run-4 friction #5: `sinceSeq`, when given, fences on
   *  `TickStampedEvent.seq` (unambiguous — see that field's doc comment). The
   *  old `sinceTick` fence (`tick > sinceTick`, which dropped any event
   *  sharing the fence's own tick) was REMOVED. */
  events(sinceSeq?: number): TickStampedEvent[];
  input: DebugBridgeInput;
  snapshot(sinceSeq?: number): DebugSnapshot;
  /** D15/T-D15.4 — see `RunTicksOptions`'s doc comment above. */
  runTicks(n: number, opts?: RunTicksOptions): void;
  /** Collapses `input.setVirtualAction(action, true)` → wait `simSeconds` of
   *  sim time (host-loop ticks while visible, deterministic same-phase ticks
   *  while loop-starved) → `input.clearVirtualActions()` into one call — see
   *  `runtime/debug-bridge.ts`'s
   *  `holdFor` doc comment for the full contract (gated-immediately /
   *  play-stopped-mid-wait shapes). */
  holdFor(action: string, simSeconds: number, worldId?: string): Promise<VirtualActionResult>;
}

// Deliberately no `declare global { interface Window { __vgai } }` here:
// the engine's own debug-bridge module (landing concurrently) is the real
// installer and may declare its own global augmentation for `window.__vgai`.
// Two independent ambient declarations of the same global member are only
// safe if structurally identical, and this package must not assume that —
// every access reaches through an explicit `window as { __vgai?: ... }` cast
// at the `page.evaluate()` boundary instead (see client.ts).
