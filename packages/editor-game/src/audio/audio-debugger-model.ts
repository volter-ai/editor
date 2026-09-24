/**
 * Pure data-path logic for the Audio debugger tab (W3c) — no React/DOM, so
 * the consumer side of the `AudioAdapter` introspection capabilities is
 * headless-testable. The rendering component (`AudioDebuggerPanel.tsx`) owns
 * only JSX; capability detection, the seq-fenced event-log ring with pause,
 * and the meter geometry math live here (the W3b
 * `network-inspector-model.ts` split, applied to audio).
 *
 * Editor code never imports Tone — only the `AudioAdapter` interface (the
 * networking rule's audio mirror). Read-only debugger: the full mixer is
 * SQ-4-gated and has no surface here.
 */

import type { AudioAdapter, AudioDebugEvent } from '@vgai/project/adapter';

/** Which optional introspection capabilities the active adapter provides —
 *  the degradation ladder's per-section verdict. `null` input (no adapter =
 *  no running session) stays `null`: the panel renders the honest no-session
 *  notice instead of a fabricated all-false map. Mute (`setMuted`/`isMuted`)
 *  is a REQUIRED `AudioAdapter` member, so it needs no entry. */
export interface AudioCapabilityMap {
  graph: boolean;
  transport: boolean;
  meters: boolean;
  events: boolean;
}

export function deriveAudioCapabilities(
  adapter: AudioAdapter | null | undefined,
): AudioCapabilityMap | null {
  if (!adapter) return null;
  return {
    graph: typeof adapter.graphSnapshot === 'function',
    transport: typeof adapter.transportState === 'function',
    meters: typeof adapter.acquireMeters === 'function',
    events: typeof adapter.audioEvents === 'function',
  };
}

/**
 * Consumer-side event log over `AudioAdapter.audioEvents` — the
 * `MessageLogModel` idiom: pulls seq-fenced events from the adapter's ring
 * into a bounded local ring. PAUSE stops consuming with the fence frozen, so
 * resume picks up whatever the adapter's ring still holds (a long pause
 * loses only what the adapter itself evicted; nothing fills the gap).
 */
export class AudioEventLogModel {
  private entries: AudioDebugEvent[] = [];
  private lastSeq = 0;
  paused = false;

  constructor(private readonly capacity = 500) {}

  /** Consume new events (`seq > fence`). Returns how many were appended
   *  (0 while paused or when the capability is absent). */
  pull(adapter: AudioAdapter | null | undefined): number {
    if (this.paused || !adapter?.audioEvents) return 0;
    const fresh = adapter.audioEvents(this.lastSeq);
    if (fresh.length === 0) return 0;
    for (const event of fresh) {
      this.entries.push(event);
      if (event.seq > this.lastSeq) this.lastSeq = event.seq;
    }
    if (this.entries.length > this.capacity) {
      this.entries.splice(0, this.entries.length - this.capacity);
    }
    return fresh.length;
  }

  get all(): readonly AudioDebugEvent[] {
    return this.entries;
  }

  clear(): void {
    // Fence deliberately NOT reset: clear empties the view; already-observed
    // events don't come back.
    this.entries = [];
  }
}

/** Transport seconds → `m:ss.t` (e.g. `1:03.4`) for the transport strip. */
export function formatTransportSeconds(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const minutes = Math.floor(clamped / 60);
  const rest = clamped - minutes * 60;
  return `${minutes}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
}
