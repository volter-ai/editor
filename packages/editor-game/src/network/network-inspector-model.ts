/**
 * Pure data-path logic for the Network inspector (W3b) — no React/DOM, so the
 * whole consumer side of the `NetworkingAdapter` inspector capabilities is
 * headless-testable (`network-inspector.test.ts` drives it against a REAL
 * loopback Colyseus server through the real arena adapter).
 *
 * The rendering component (`NetworkInspectorPanel.tsx`) owns only JSX; every
 * behavior — capability detection, the seq-fenced message-log ring with
 * pause/filter, the sparkline sample history, and the polyline geometry —
 * lives here.
 *
 * The inspector reads only the `NetworkingAdapter` interface; decoding a
 * game's Colyseus rooms is the observer's (`services/game-network.ts`).
 */

import type {
  ConnectionState,
  NetMessageEvent,
  NetRates,
  NetworkingAdapter,
  ReplicationStats,
  RoomInfo,
} from '@volter/editor-project/adapter';

/**
 * The three headline readings the inspector's header shows.
 *
 * Every field is TRI-STATE, and the third state is the point: `undefined`
 * means the adapter has no READER for it, which is not the same claim as the
 * reader's own negative answer (`disconnected`, no room, zero counts). A row
 * whose capability is absent is not rendered at all — never rendered as the
 * negative, which would be a measurement the adapter never made.
 */
export interface NetworkView {
  connectionState: ConnectionState | undefined;
  roomInfo: RoomInfo | null | undefined;
  stats: ReplicationStats | undefined;
}

/** Adapter -> header view model. Pure: no React, no DOM.
 *
 *  Overloaded so a caller that has already established it HAS an adapter (the
 *  inspector panel returns the register-an-adapter notice before this point)
 *  is not handed a `| null` it would have to re-narrow with a branch that can
 *  never run. */
export function deriveNetworkView(adapter: NetworkingAdapter): NetworkView;
export function deriveNetworkView(
  adapter: NetworkingAdapter | null | undefined,
): NetworkView | null;
export function deriveNetworkView(
  adapter: NetworkingAdapter | null | undefined,
): NetworkView | null {
  if (!adapter) return null;
  return {
    connectionState: adapter.getConnectionState?.(),
    roomInfo: adapter.getRoomInfo?.(),
    stats: adapter.getReplicationStats?.(),
  };
}

/** Which optional inspector capabilities the active adapter actually
 *  provides — the degradation ladder's per-section verdict. `null` input
 *  (no adapter registered) stays `null`: the panel renders the
 *  register-an-adapter notice instead of a fabricated all-false map. */
export interface NetworkCapabilityMap {
  stateTree: boolean;
  messageLog: boolean;
  rates: boolean;
  conditioning: boolean;
  /** The adapter can read connection lifecycle state (`getConnectionState`).
   *  Absent ⇒ the link row is unsupported, NOT "disconnected". */
  connection: boolean;
  /** The adapter can name the active room (`getRoomInfo`). Absent ⇒ the room
   *  row is unsupported, NOT "connected to no room". */
  room: boolean;
  /** The adapter counts replication activity (`getReplicationStats`). Absent ⇒
   *  the stats row is unsupported, NOT a measured-quiet link. */
  stats: boolean;
  /** The adapter reports a local player identity (`getPlayerIdentity`) — the
   *  inspector shows the current name. */
  identity: boolean;
  /** The adapter can SET the local identity (`setPlayerIdentity`) — the
   *  inspector shows an EDITABLE name field. Implies `identity`. */
  identitySettable: boolean;
  /** Traffic per message type (`getTrafficByType`). */
  traffic: boolean;
  /** Sending a message into the room as this client (`sendMessage`). */
  send: boolean;
}

export function deriveNetworkCapabilities(
  adapter: NetworkingAdapter | null | undefined,
): NetworkCapabilityMap | null {
  if (!adapter) return null;
  return {
    stateTree: typeof adapter.getStateSnapshot === 'function',
    messageLog: typeof adapter.messageEvents === 'function',
    rates: typeof adapter.getRates === 'function',
    // A conditioner needs BOTH the read and the write to render controls
    // honestly (write-only would show state it can't verify; read-only
    // couldn't apply anything).
    conditioning:
      typeof adapter.getConditioning === 'function' &&
      typeof adapter.setConditioning === 'function',
    connection: typeof adapter.getConnectionState === 'function',
    room: typeof adapter.getRoomInfo === 'function',
    stats: typeof adapter.getReplicationStats === 'function',
    identity: typeof adapter.getPlayerIdentity === 'function',
    identitySettable: typeof adapter.setPlayerIdentity === 'function',
    traffic: typeof adapter.getTrafficByType === 'function',
    send: typeof adapter.sendMessage === 'function',
  };
}

/**
 * Consumer-side message log over `NetworkingAdapter.messageEvents`.
 *
 * Pulls seq-fenced events from the adapter's ring into its own bounded ring.
 * PAUSE stops consuming — the fence stays where it was, so resuming picks up
 * whatever the adapter's ring still holds (a long pause loses only what the
 * adapter itself evicted; nothing is fabricated to fill the gap).
 */
export class MessageLogModel {
  private entries: NetMessageEvent[] = [];
  private lastSeq = 0;
  paused = false;

  constructor(private readonly capacity = 500) {}

  /** Consume new events (`seq > fence`) from the adapter. Returns how many
   *  were appended (0 while paused or when the capability is absent). */
  pull(adapter: NetworkingAdapter | null | undefined): number {
    if (this.paused || !adapter?.messageEvents) return 0;
    const fresh = adapter.messageEvents(this.lastSeq);
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

  get all(): readonly NetMessageEvent[] {
    return this.entries;
  }

  clear(): void {
    // Deliberately NOT resetting the fence: clear empties the view; already-
    // observed events don't come back.
    this.entries = [];
  }
}

/** Case-insensitive substring filter on `type` (the log's filter box). An
 *  empty/whitespace filter passes everything. */
export function filterMessages(
  events: readonly NetMessageEvent[],
  filter: string,
): NetMessageEvent[] {
  const needle = filter.trim().toLowerCase();
  if (!needle) return [...events];
  return events.filter((e) => e.type.toLowerCase().includes(needle));
}

/** Fixed-capacity rolling series feeding one sparkline. */
export class RateSeries {
  private values: number[] = [];

  constructor(readonly capacity = 60) {}

  push(value: number): void {
    this.values.push(value);
    if (this.values.length > this.capacity) this.values.shift();
  }

  get data(): readonly number[] {
    return this.values;
  }

  get latest(): number | null {
    return this.values.length > 0 ? (this.values[this.values.length - 1] as number) : null;
  }
}

/**
 * Rolling history of `getRates()` samples driving the sparklines. A byte
 * field the adapter OMITS pushes nothing — its series stays empty and the
 * panel marks that direction "n/a" instead of drawing a fabricated zero line
 * (the arena adapter omits `bytesInPerSec`: Colyseus patch bytes aren't
 * observable through the Callbacks API).
 */
export class RateHistory {
  readonly msgsIn = new RateSeries();
  readonly msgsOut = new RateSeries();
  readonly bytesIn = new RateSeries();
  readonly bytesOut = new RateSeries();

  sample(rates: NetRates): void {
    this.msgsIn.push(rates.msgsInPerSec);
    this.msgsOut.push(rates.msgsOutPerSec);
    if (rates.bytesInPerSec !== undefined) this.bytesIn.push(rates.bytesInPerSec);
    if (rates.bytesOutPerSec !== undefined) this.bytesOut.push(rates.bytesOutPerSec);
  }
}

/**
 * SVG polyline `points` for a sparkline: newest sample at the right edge,
 * y auto-scaled to the series max (min 1 so an all-zero series draws a flat
 * baseline, not NaN). Fewer than 2 samples → `''` (nothing to draw yet).
 */
export function sparklinePoints(
  values: readonly number[],
  width: number,
  height: number,
  pad = 1,
): string {
  if (values.length < 2) return '';
  const max = Math.max(1, ...values);
  const innerH = height - pad * 2;
  const stepX = width / (values.length - 1);
  return values
    .map((v, i) => {
      const x = i * stepX;
      const y = pad + innerH * (1 - v / max);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}
