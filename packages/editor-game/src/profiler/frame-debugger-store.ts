/**
 * Shared capture ring for the Frame debugger (W4b, F11). A single module store
 * (the `utility-view-state.ts` idiom) so the TWO entry points that trigger a
 * capture — the Game-tab `game-capture-frame` button and the Frame debugger
 * panel's own `frame-capture-button` — append to and read from ONE bounded
 * history. Without this, a capture fired from the Game tab would be lost to the
 * panel it opens.
 *
 * HONESTY: `captureFrame` awaits the adapter's real capture, which REJECTS (it
 * never fabricates) when no frame renders within the bounded timeout — a
 * paused/stopped world. That rejection surfaces as `lastCaptureError`, shown
 * verbatim in the panel. The ring is reset on adapter identity change (a new
 * game mounted / play stopped) — captures from a prior session are stale.
 */

import { CaptureHistoryModel } from '@editor/components/frame-debugger-model';
import type { RenderDebugAdapter } from '@vgai/project/adapter';

let history = new CaptureHistoryModel();
let boundAdapter: RenderDebugAdapter | null = null;
let capturing = false;
let lastError: string | null = null;
let version = 0;
const listeners = new Set<() => void>();

function notify(): void {
  version++;
  for (const listener of listeners) listener();
}

export function subscribeFrameDebugger(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Monotonic version — the `getSnapshot` for `useSyncExternalStore`. */
export function frameDebuggerVersion(): number {
  return version;
}

/** Reset the shared ring when the bound adapter identity changes (new mount /
 *  play stopped). Idempotent for the same identity, so it is safe to call on
 *  every render/tick. */
export function syncFrameDebuggerAdapter(adapter: RenderDebugAdapter | null): void {
  if (adapter === boundAdapter) return;
  boundAdapter = adapter;
  history = new CaptureHistoryModel();
  lastError = null;
  notify();
}

export function getCaptureHistory(): CaptureHistoryModel {
  return history;
}

export function isCapturing(): boolean {
  return capturing;
}

export function lastCaptureError(): string | null {
  return lastError;
}

export function selectCapture(id: number): void {
  history.select(id);
  notify();
}

export function clearCaptures(): void {
  history.clear();
  lastError = null;
  notify();
}

/**
 * Capture one frame through the adapter and append it to the shared ring.
 * Binds the adapter (resetting a stale ring) first. A rejection — the honest
 * "no frame rendered" of a paused/stopped world — is recorded as
 * `lastCaptureError`; nothing is fabricated. No-op while a capture is already
 * in flight or when no adapter is present.
 */
export async function captureFrame(adapter: RenderDebugAdapter | null): Promise<void> {
  if (!adapter || capturing) return;
  syncFrameDebuggerAdapter(adapter);
  capturing = true;
  lastError = null;
  notify();
  try {
    const capture = await adapter.captureFrame();
    history.add(capture);
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
  } finally {
    capturing = false;
    notify();
  }
}
