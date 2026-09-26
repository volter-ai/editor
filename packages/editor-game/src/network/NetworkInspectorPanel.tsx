/**
 * Network inspector (W3b, F9) — the full replicated-state introspection
 * surface over `SystemAdapters.NetworkingAdapter`:
 *
 *  - replicated-state TREE (live `getStateSnapshot()`; collapsed nodes mount
 *    no children, so a collapsed subtree costs one row per poll);
 *  - MESSAGE LOG (`messageEvents` seq-fenced ring → `MessageLogModel`;
 *    pausable, filterable by type);
 *  - rate SPARKLINES (`getRates()` sampled once per second into
 *    `RateHistory`; inline SVG polylines);
 *  - latency/loss CONDITIONER (`get/setConditioning` — applied at the
 *    adapter seam, M3).
 *
 * Degradation ladder rendered honestly (W3a contract, first system-adapter
 * consumer): no adapter → the register-an-adapter notice; an adapter missing
 * an optional capability → that section says "not provided by this adapter";
 * nothing is ever fabricated. The panel reads only the `NetworkingAdapter`
 * interface: the game's own, or the editor's observer of its Colyseus rooms
 * (`services/game-network.ts`).
 *
 * Mounted as the `network` workspace utility (drawer tab beside
 * Console/Profiler, `core-utilities.tsx`), available only while a
 * real `NetworkingAdapter` is registered. Every caller that wants network
 * diagnostics reveals that ONE utility.
 */

import { editorHost } from '@volter/editor-sdk/host';
import {
  Button,
  DisclosureIcon,
  fontSizeVar,
  NumberInput,
  spaceVar,
  TextInput,
  themeVars,
} from '@volter/editor-sdk/widgets';
import type {
  ConnectionState,
  NetConditioning,
  NetMessageEvent,
  NetTypeTraffic,
  NetworkingAdapter,
} from '@volter/editor-project/adapter';
import { memo, useEffect, useReducer, useRef, useState } from 'react';
import {
  deriveNetworkCapabilities,
  deriveNetworkView,
  filterMessages,
  MessageLogModel,
  type NetworkCapabilityMap,
  type NetworkView,
  RateHistory,
  type RateSeries,
  sparklinePoints,
} from './network-inspector-model';

const STATE_COLORS: Record<ConnectionState, string> = {
  disconnected: themeVars.content.muted,
  connecting: themeVars.semantic.warning,
  connected: themeVars.semantic.success,
  error: themeVars.semantic.danger,
};

const MONO: React.CSSProperties = {
  fontFamily: themeVars.typography.mono,
  fontSize: fontSizeVar.base,
};

function AbsentNote({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <div
      data-testid={testId}
      style={{
        padding: spaceVar[4],
        color: themeVars.content.muted,
        fontSize: fontSizeVar.base,
        fontStyle: 'italic',
      }}
    >
      {children}
    </div>
  );
}

// --- Replicated-state tree ------------------------------------------------

function isBranch(value: unknown): value is object {
  return value !== null && typeof value === 'object';
}

function formatLeaf(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(3);
  }
  return String(value);
}

/**
 * One tree node. Expansion is per-node LOCAL state (stable across polls —
 * React keeps state for a keyed position), and children of a collapsed node
 * are NOT mounted: a fresh snapshot every poll re-renders only the visible
 * rows, never a collapsed subtree.
 */
function StateTreeNode({ name, value, depth }: { name: string; value: unknown; depth: number }) {
  const [expanded, setExpanded] = useState(depth === 0);
  const rowStyle: React.CSSProperties = {
    ...MONO,
    paddingLeft: 8 + depth * 14,
    lineHeight: '18px',
    whiteSpace: 'nowrap',
  };

  if (!isBranch(value)) {
    return (
      <div style={rowStyle} data-testid="net-tree-leaf">
        <span style={{ color: themeVars.content.primary }}>{name}</span>
        <span style={{ color: themeVars.content.muted }}>: </span>
        <span style={{ color: themeVars.content.primary }}>{formatLeaf(value)}</span>
      </div>
    );
  }

  const entries = Object.entries(value as Record<string, unknown>);
  return (
    <div>
      <div
        style={{ ...rowStyle, cursor: 'pointer', userSelect: 'none' }}
        data-testid="net-tree-branch"
        data-expanded={expanded || undefined}
        onClick={() => setExpanded((e) => !e)}
      >
        <span style={{ color: themeVars.content.muted, display: 'inline-block', width: 12 }}>
          <DisclosureIcon direction={expanded ? 'down' : 'right'} />
        </span>
        <span style={{ color: themeVars.content.primary }}>{name}</span>
        <span style={{ color: themeVars.content.dim }}>
          {' '}
          {Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`}
        </span>
      </div>
      {expanded &&
        entries.map(([key, child]) => (
          <StateTreeNode key={key} name={key} value={child} depth={depth + 1} />
        ))}
    </div>
  );
}

// --- Sparklines -----------------------------------------------------------

const SPARK_W = 96;
const SPARK_H = 22;

/** Memoized on the DERIVED points string (computed by the caller each
 *  render): a sparkline redraws only when a new 1 Hz sample changes the
 *  geometry, not on every 250 ms panel poll. (The comparator must not read
 *  the mutable RateSeries itself — both props would alias the same mutated
 *  instance and compare equal forever, freezing the sparkline.) */
const Sparkline = memo(function Sparkline({ points, color }: { points: string; color: string }) {
  return (
    <svg
      width={SPARK_W}
      height={SPARK_H}
      style={{
        display: 'block',
        background: themeVars.surface.inset,
        borderRadius: themeVars.shape.small,
      }}
      role="img"
      aria-label="rate sparkline"
    >
      {points && <polyline points={points} fill="none" stroke={color} strokeWidth={1.2} />}
    </svg>
  );
});

function RateCell({
  label,
  series,
  unit,
  color,
  testId,
}: {
  label: string;
  series: RateSeries;
  unit: string;
  color: string;
  testId: string;
}) {
  const latest = series.latest;
  return (
    <div
      data-testid={testId}
      style={{ display: 'flex', flexDirection: 'column', gap: spaceVar[1] }}
    >
      <div style={{ fontSize: fontSizeVar.sm, color: themeVars.content.muted }}>
        {label}{' '}
        <span style={{ color: themeVars.content.primary, fontFamily: themeVars.typography.mono }}>
          {/* An empty series = the adapter omits this direction (e.g. inbound
              bytes aren't observable) — say n/a, never draw a fabricated 0. */}
          {latest === null ? 'n/a' : `${latest}${unit}`}
        </span>
      </div>
      <Sparkline points={sparklinePoints(series.data, SPARK_W, SPARK_H)} color={color} />
    </div>
  );
}

// --- Message log ----------------------------------------------------------

function MessageRow({ event }: { event: NetMessageEvent }) {
  const dirColor = event.direction === 'in' ? themeVars.semantic.success : themeVars.accent.default;
  return (
    <div
      data-testid="net-log-row"
      data-direction={event.direction}
      style={{
        ...MONO,
        display: 'grid',
        gridTemplateColumns: '64px 24px 1fr 56px',
        gap: spaceVar[2],
        lineHeight: '17px',
        padding: `0 ${spaceVar[4]}`,
        opacity: event.dropped ? 0.55 : 1,
      }}
    >
      <span style={{ color: themeVars.content.dim }}>{(event.time / 1000).toFixed(2)}s</span>
      <span style={{ color: dirColor }}>{event.direction === 'in' ? '↓in' : '↑out'}</span>
      <span
        style={{
          color: themeVars.content.primary,
          textDecoration: event.dropped ? 'line-through' : 'none',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {event.type}
        {event.dropped ? ' (dropped)' : ''}
      </span>
      <span style={{ color: themeVars.content.muted, textAlign: 'right' }}>
        {event.size !== undefined ? `${event.size} B` : '—'}
      </span>
    </div>
  );
}

// --- Conditioner ----------------------------------------------------------

function ConditionerControls({ adapter }: { adapter: NetworkingAdapter }) {
  // Local mirror initialized from the adapter; commits go through
  // setConditioning on gesture end. Re-reading each render would fight the
  // NumberInput drag, so the adapter's value seeds state once per mount.
  const [cond, setCond] = useState<NetConditioning>(
    () => adapter.getConditioning?.() ?? { latencyMs: 0, jitterMs: 0, packetLoss: 0 },
  );
  const apply = (next: NetConditioning) => {
    setCond(next);
    adapter.setConditioning?.(next);
  };
  return (
    <div
      data-testid="net-conditioner"
      style={{
        display: 'flex',
        gap: spaceVar[4],
        alignItems: 'center',
        padding: `${spaceVar[2]} ${spaceVar[4]}`,
      }}
    >
      <span style={{ fontSize: fontSizeVar.sm, color: themeVars.content.muted }}>Conditioner</span>
      <NumberInput
        label="latency ms"
        value={cond.latencyMs}
        step={10}
        testId="net-cond-latency"
        onChange={(v) => apply({ ...cond, latencyMs: Math.max(0, v) })}
      />
      <NumberInput
        label="jitter ms"
        value={cond.jitterMs}
        step={5}
        testId="net-cond-jitter"
        onChange={(v) => apply({ ...cond, jitterMs: Math.max(0, v) })}
      />
      <NumberInput
        label="loss %"
        value={cond.packetLoss * 100}
        step={5}
        testId="net-cond-loss"
        onChange={(v) => apply({ ...cond, packetLoss: Math.min(1, Math.max(0, v / 100)) })}
      />
    </div>
  );
}

// --- Player identity ------------------------------------------------------

/** The local player's name: an EDITABLE field when the adapter can set it
 *  (`setPlayerIdentity`), a read-only label when it can only read it. Present
 *  in the header only when the game wired identity at all — never fabricated. */
function IdentityControls({
  adapter,
  settable,
}: {
  adapter: NetworkingAdapter;
  settable: boolean;
}) {
  // Seed once per mount from the adapter (re-reading each render would fight
  // typing), same as the conditioner. The live value is re-seeded when the
  // adapter identity changes via `key` on the parent.
  const [name, setName] = useState(() => adapter.getPlayerIdentity?.()?.name ?? '');
  const commit = () => {
    const next = name.trim();
    if (next) void adapter.setPlayerIdentity?.({ name: next });
  };
  return (
    <div
      data-testid="net-identity"
      style={{
        display: 'flex',
        gap: spaceVar[4],
        alignItems: 'center',
        padding: `${spaceVar[2]} ${spaceVar[4]}`,
      }}
    >
      <span style={{ fontSize: fontSizeVar.sm, color: themeVars.content.muted }}>Player name</span>
      {settable ? (
        <TextInput
          data-testid="net-identity-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          style={{ width: 140 }}
        />
      ) : (
        <span data-testid="net-identity-name" style={{ ...MONO, color: themeVars.content.primary }}>
          {name || '—'}
        </span>
      )}
    </div>
  );
}

// --- Header ---------------------------------------------------------------

/** Connection / room / replication-stat / rate row. Extracted from the panel
 *  so each half stays readable: every cell here is a present-or-absent
 *  branch, and the panel below owns state and the body layout. */
function NetworkHeader({
  view,
  caps,
  rates,
}: {
  view: NetworkView;
  caps: NetworkCapabilityMap;
  rates: RateHistory;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: spaceVar[6],
        alignItems: 'center',
        padding: `${spaceVar[2]} ${spaceVar[4]}`,
        borderBottom: `1px solid ${themeVars.boundary.default}`,
      }}
    >
      {view.connectionState !== undefined ? (
        <span
          data-testid="net-connection-state"
          style={{ color: STATE_COLORS[view.connectionState] }}
        >
          ● {view.connectionState}
        </span>
      ) : (
        <AbsentNote testId="net-connection-state-absent">
          Connection state not provided by this adapter.
        </AbsentNote>
      )}
      {view.roomInfo === undefined ? (
        <AbsentNote testId="net-room-absent">Room info not provided by this adapter.</AbsentNote>
      ) : view.roomInfo ? (
        <span style={{ ...MONO, color: themeVars.content.primary }}>
          {view.roomInfo.roomName} · {view.roomInfo.roomId} · session {view.roomInfo.sessionId}
        </span>
      ) : (
        <span style={{ color: themeVars.content.muted }}>no room</span>
      )}
      {view.stats ? (
        <span style={{ color: themeVars.content.muted }}>
          entities <span style={{ color: themeVars.content.primary }}>{view.stats.entities}</span>
        </span>
      ) : (
        <AbsentNote testId="net-stats-absent">
          Replication stats not provided by this adapter.
        </AbsentNote>
      )}
      {caps.rates ? (
        <div data-testid="net-sparklines" style={{ display: 'flex', gap: spaceVar[5] }}>
          <RateCell
            label="msgs in"
            unit="/s"
            series={rates.msgsIn}
            color={themeVars.semantic.success}
            testId="net-rate-msgs-in"
          />
          <RateCell
            label="msgs out"
            unit="/s"
            series={rates.msgsOut}
            color={themeVars.accent.default}
            testId="net-rate-msgs-out"
          />
          <RateCell
            label="bytes in"
            unit=" B/s"
            series={rates.bytesIn}
            color={themeVars.semantic.success}
            testId="net-rate-bytes-in"
          />
          <RateCell
            label="bytes out"
            unit=" B/s"
            series={rates.bytesOut}
            color={themeVars.accent.default}
            testId="net-rate-bytes-out"
          />
        </div>
      ) : (
        <AbsentNote testId="net-rates-absent">Rates not provided by this adapter.</AbsentNote>
      )}
    </div>
  );
}

// --- The panel ------------------------------------------------------------

export function NetworkInspectorPanel() {
  const [, force] = useReducer((c: number) => c + 1, 0);
  const logRef = useRef(new MessageLogModel());
  const ratesRef = useRef(new RateHistory());
  const adapterRef = useRef<NetworkingAdapter | null>(null);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    const syncAdapter = () => {
      const adapter = editorHost().systems.inspectedNetworking() ?? null;
      if (adapter !== adapterRef.current) {
        // New mount (or unmount): the old game's log/rate history is stale.
        adapterRef.current = adapter;
        logRef.current = new MessageLogModel();
        logRef.current.paused = paused;
        ratesRef.current = new RateHistory();
      }
      return adapter;
    };
    // 250 ms consume/render poll — also covers the
    // adapter's IDENTITY changing when a game mounts/unmounts)…
    const tick = () => {
      const adapter = syncAdapter();
      logRef.current.pull(adapter);
      force();
    };
    tick();
    const pollId = setInterval(tick, 250);
    // …and a 1 Hz sparkline sampler (rates are whole-second windows).
    const rateId = setInterval(() => {
      const adapter = syncAdapter();
      const rates = adapter?.getRates?.();
      if (rates) ratesRef.current.sample(rates);
    }, 1000);
    const unsubscribe = editorHost()
      .systems.inspectedNetworking()
      ?.subscribe(() => force());
    return () => {
      clearInterval(pollId);
      clearInterval(rateId);
      unsubscribe?.();
    };
  }, [paused]);

  const adapter = adapterRef.current ?? editorHost().systems.inspectedNetworking() ?? null;
  const caps = deriveNetworkCapabilities(adapter);

  if (!adapter || !caps) {
    return (
      <div
        data-testid="network-inspector-empty"
        style={{
          padding: spaceVar[8],
          color: themeVars.content.muted,
          fontSize: fontSizeVar.md,
          lineHeight: '18px',
        }}
      >
        <div style={{ color: themeVars.content.primary, marginBottom: spaceVar[2] }}>
          No networking adapter is registered.
        </div>
        Games expose replication state to this inspector by registering a{' '}
        <code style={MONO}>NetworkingAdapter</code> during setup:{' '}
        <code style={MONO}>{"ctx.registerSystemAdapter?.('networking', adapter)"}</code> — see the
        third-person-arena example. Single-player games register none; there is nothing to inspect.
      </div>
    );
  }

  // `undefined` here means NO READER, which the header renders as an absent
  // note — never as `disconnected` / `no room` / `entities 0`, each of which is
  // a measurement claim the adapter never made. See `deriveNetworkView`.
  const view = deriveNetworkView(adapter);
  const snapshot = caps.stateTree ? adapter.getStateSnapshot?.() : undefined;
  const messages = filterMessages(logRef.current.all, filter);

  return (
    <div
      data-testid="network-inspector"
      // §2.31 P2 amendment: text-dense output region reads over a local
      // frosted layer (inert for non-frost themes).
      className="vgai-content-frost"
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        fontSize: fontSizeVar.md,
      }}
    >
      {/* Header: connection / room / rates / conditioner */}
      <NetworkHeader view={view} caps={caps} rates={ratesRef.current} />

      {caps.identity ? (
        // `key` re-seeds the field when the game reports a new name (e.g. the
        // server assigned one on join) so the input isn't pinned to a stale mount value.
        <IdentityControls
          key={adapter.getPlayerIdentity?.()?.name ?? ''}
          adapter={adapter}
          settable={caps.identitySettable}
        />
      ) : null}

      {caps.conditioning ? (
        <ConditionerControls adapter={adapter} />
      ) : (
        <AbsentNote testId="net-conditioner-absent">
          Link conditioning not provided by this adapter.
        </AbsentNote>
      )}

      {caps.traffic ? <TrafficTable rows={adapter.getTrafficByType?.() ?? []} /> : null}
      {caps.send ? <SendControls adapter={adapter} /> : null}

      {/* Body: state tree | message log */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div
          data-testid="net-state-tree"
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'auto',
            borderRight: `1px solid ${themeVars.boundary.default}`,
            padding: `${spaceVar[2]} 0`,
          }}
        >
          {caps.stateTree ? (
            snapshot != null ? (
              <StateTreeNode name="state" value={snapshot} depth={0} />
            ) : (
              <AbsentNote>Not connected — no replicated state to show.</AbsentNote>
            )
          ) : (
            <AbsentNote testId="net-tree-absent">
              Replicated-state snapshot not provided by this adapter.
            </AbsentNote>
          )}
        </div>

        <div
          data-testid="net-message-log"
          style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}
        >
          {caps.messageLog ? (
            <>
              <div
                style={{
                  display: 'flex',
                  gap: spaceVar[3],
                  alignItems: 'center',
                  padding: spaceVar[2],
                }}
              >
                <Button
                  type="button"
                  variant="ghost"
                  data-testid="net-log-pause"
                  onClick={() => {
                    const next = !paused;
                    logRef.current.paused = next;
                    setPaused(next);
                  }}
                >
                  {paused ? 'Resume' : 'Pause'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  data-testid="net-log-clear"
                  onClick={() => {
                    logRef.current.clear();
                    force();
                  }}
                >
                  Clear
                </Button>
                <TextInput
                  data-testid="net-log-filter"
                  placeholder="Filter by type"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  style={{ flex: 1, minWidth: 60 }}
                />
                <span style={{ fontSize: fontSizeVar.sm, color: themeVars.content.muted }}>
                  {messages.length}/{logRef.current.all.length}
                </span>
              </div>
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                {messages.length === 0 ? (
                  <AbsentNote>No messages captured yet.</AbsentNote>
                ) : (
                  // Newest last, natural reading order for a tail-follow log.
                  messages.map((event) => <MessageRow key={event.seq} event={event} />)
                )}
              </div>
            </>
          ) : (
            <AbsentNote testId="net-log-absent">
              Message log not provided by this adapter.
            </AbsentNote>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Traffic per message type, both directions — Godot's network profiler reads a game's RPCs and
 * its synchronizers as two tables of counts and sizes; a Colyseus room's are its messages and its
 * state sync, which arrive here as rows of one table (`state`, `patch`, and each message type).
 */
function TrafficTable({ rows }: { rows: readonly NetTypeTraffic[] }) {
  const cell = { padding: `0 ${spaceVar[3]}`, textAlign: 'right' as const, whiteSpace: 'nowrap' as const };
  const bytes = (value: number) => (value >= 1024 ? `${(value / 1024).toFixed(1)} KiB` : `${value} B`);
  return (
    <div
      data-testid="net-traffic"
      style={{ maxHeight: 132, overflow: 'auto', borderBottom: `1px solid ${themeVars.boundary.default}` }}
    >
      {rows.length === 0 ? (
        <AbsentNote>No traffic yet.</AbsentNote>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: fontSizeVar.sm, ...MONO }}>
          <thead>
            <tr style={{ color: themeVars.content.muted }}>
              <th style={{ ...cell, textAlign: 'left' }}>Type</th>
              <th style={cell}>In</th>
              <th style={cell}>Bytes in</th>
              <th style={cell}>Out</th>
              <th style={cell}>Bytes out</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.type} data-testid="net-traffic-row">
                <td style={{ ...cell, textAlign: 'left' }}>{row.type}</td>
                <td style={cell}>{row.countIn || '-'}</td>
                <td style={cell}>{row.countIn ? bytes(row.bytesIn) : '-'}</td>
                <td style={cell}>{row.countOut || '-'}</td>
                <td style={cell}>{row.countOut ? bytes(row.bytesOut) : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/**
 * Send a message into the room as this client — Colyseus Monitor's Send (a message type and a
 * JSON payload), so a server handler can be exercised without writing game code for it.
 */
function SendControls({ adapter }: { adapter: NetworkingAdapter }) {
  const [type, setType] = useState('');
  const [payload, setPayload] = useState('');
  const [error, setError] = useState<string | null>(null);
  const send = () => {
    try {
      const value = payload.trim() === '' ? undefined : (JSON.parse(payload) as unknown);
      adapter.sendMessage?.(type, value);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };
  return (
    <div
      data-testid="net-send"
      style={{ display: 'flex', gap: spaceVar[2], alignItems: 'center', padding: spaceVar[2] }}
    >
      <TextInput
        data-testid="net-send-type"
        placeholder="Message type"
        value={type}
        onChange={(event) => setType(event.target.value)}
        style={{ width: 140 }}
      />
      <TextInput
        data-testid="net-send-payload"
        placeholder='Payload (JSON), e.g. {"x": 1}'
        value={payload}
        onChange={(event) => setPayload(event.target.value)}
        style={{ flex: 1, minWidth: 80 }}
      />
      <Button type="button" variant="ghost" data-testid="net-send-button" disabled={type.trim() === ''} onClick={send}>
        Send
      </Button>
      {error ? (
        <span data-testid="net-send-error" style={{ color: themeVars.semantic.danger, fontSize: fontSizeVar.sm }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
