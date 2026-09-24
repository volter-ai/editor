/**
 * Audio debugger tab (W3c, F3) — the read-only introspection surface over
 * `SystemAdapters.AudioAdapter`:
 *
 *  - active-node GRAPH (live `graphSnapshot()` poll — engine buses + every
 *    Tone node the game routed into the master bus);
 *  - TRANSPORT strip (`transportState()`: state/position/bpm; `null` renders
 *    the honest "no musical transport in this world");
 *  - per-bus METERS (`acquireMeters()` handle, held only while this panel is
 *    mounted with a live adapter and ALWAYS disposed — level updates write
 *    straight to DOM style via refs on a 100 ms interval, so the node
 *    tree/log never re-render at meter rate);
 *  - EVENT LOG (`audioEvents` seq-fenced ring → `AudioEventLogModel`;
 *    pausable).
 *
 * Degradation ladder rendered honestly (W3a contract): no adapter means the
 * editor has not mounted a project audio graph yet; an adapter
 * missing an optional capability marks that section "not provided"; nothing
 * is ever fabricated. Editor code never imports Tone here — only the
 * `AudioAdapter` interface (the networking rule's audio mirror). The full
 * MIXER (sends/effects/gain editing) is SQ-4-gated and deliberately absent.
 */

import { editorHost } from '@volter/editor-sdk/host';
import { Button, fontSizeVar, spaceVar, themeVars } from '@volter/editor-sdk/widgets';
import { meterPercent } from '@volter/game-runtime/adapter/audio-meter';
import type { AudioAdapter, AudioDebugEvent, AudioMeterFrame } from '@volter/editor-project/adapter';
import { useEffect, useReducer, useRef, useState } from 'react';
import {
  AudioEventLogModel,
  deriveAudioCapabilities,
  formatTransportSeconds,
} from './audio-debugger-model';

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

function ResumeAudioButton({
  adapter,
  onResumed,
}: {
  adapter: AudioAdapter;
  onResumed: () => void;
}) {
  if (!adapter.resume) return null;
  return (
    <Button
      type="button"
      variant="secondary"
      data-testid="audio-resume"
      onClick={() => {
        adapter.resume?.();
        onResumed();
      }}
    >
      Enable Audio
    </Button>
  );
}

// --- Transport strip --------------------------------------------------------

const TRANSPORT_COLORS: Record<string, string> = {
  started: themeVars.semantic.success,
  paused: themeVars.semantic.warning,
  stopped: themeVars.content.muted,
};

function TransportStrip({ adapter }: { adapter: AudioAdapter }) {
  const transport = adapter.transportState?.() ?? null;
  if (!transport) {
    return (
      <AbsentNote testId="audio-transport-none">
        No musical transport in this world (the game has not bridged Tone onto its audio context).
      </AbsentNote>
    );
  }
  return (
    <div
      data-testid="audio-transport"
      data-state={transport.state}
      style={{
        display: 'flex',
        gap: spaceVar[6],
        alignItems: 'center',
        padding: `${spaceVar[2]} ${spaceVar[4]}`,
      }}
    >
      <span style={{ color: TRANSPORT_COLORS[transport.state] ?? themeVars.content.primary }}>
        ● {transport.state}
      </span>
      <span
        data-testid="audio-transport-seconds"
        style={{ ...MONO, color: themeVars.content.primary }}
      >
        {formatTransportSeconds(transport.seconds)}
      </span>
      {transport.position !== undefined && (
        <span style={{ ...MONO, color: themeVars.content.muted }}>{transport.position}</span>
      )}
      <span style={{ fontSize: fontSizeVar.sm, color: themeVars.content.muted }}>
        bpm{' '}
        <span style={{ ...MONO, color: themeVars.content.primary }}>
          {transport.bpm.toFixed(0)}
        </span>
      </span>
    </div>
  );
}

// --- Meters -----------------------------------------------------------------

/**
 * Owns one metering session for `adapter`'s lifetime in this panel: acquires
 * the handle on mount / adapter change, disposes it on cleanup (Stop tears
 * the whole panel state down through the adapter-identity poll, so no
 * analyser tap survives a session). Level updates bypass React entirely —
 * a 100 ms interval writes bar width/`data-level` straight onto the DOM.
 */
function MeterBars({ adapter }: { adapter: AudioAdapter }) {
  const [buses, setBuses] = useState<AudioMeterFrame[] | null | undefined>(undefined);
  const fillRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    const handle = adapter.acquireMeters?.() ?? null;
    if (!handle) {
      setBuses(null);
      return;
    }
    setBuses(handle.read()); // bus ids/labels — the one React render
    const id = setInterval(() => {
      for (const frame of handle.read()) {
        const el = fillRefs.current.get(frame.id);
        if (!el) continue;
        el.style.width = `${meterPercent(frame.level)}%`;
        el.dataset['level'] = frame.level.toFixed(4);
      }
    }, 100);
    return () => {
      clearInterval(id);
      handle.dispose();
    };
  }, [adapter]);

  if (buses === undefined) return null; // first effect pass hasn't run yet
  if (buses === null) {
    return (
      <AbsentNote testId="audio-meters-unavailable">
        Metering unavailable in this environment (no real audio context).
      </AbsentNote>
    );
  }
  return (
    <div
      data-testid="audio-meters"
      style={{
        display: 'flex',
        gap: 14,
        alignItems: 'center',
        padding: `${spaceVar[2]} ${spaceVar[4]}`,
      }}
    >
      {buses.map((bus) => (
        <div key={bus.id} style={{ display: 'flex', alignItems: 'center', gap: spaceVar[2] }}>
          <span style={{ fontSize: fontSizeVar.sm, color: themeVars.content.muted }}>
            {bus.label}
          </span>
          <div
            style={{
              width: 96,
              height: 8,
              background: themeVars.surface.inset,
              borderRadius: themeVars.shape.small,
              overflow: 'hidden',
            }}
          >
            <div
              data-testid="audio-meter-fill"
              data-meter-id={bus.id}
              data-level="0.0000"
              ref={(el) => {
                if (el) fillRefs.current.set(bus.id, el);
                else fillRefs.current.delete(bus.id);
              }}
              style={{
                width: '0%',
                height: '100%',
                background: themeVars.semantic.success,
                transition: 'width 80ms linear',
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// --- Node graph -------------------------------------------------------------

function NodeRow({
  node,
}: {
  node: { id: string; type: string; label?: string; outputs: string[]; state?: string };
}) {
  return (
    <div
      data-testid="audio-node-row"
      data-node-id={node.id}
      style={{ ...MONO, lineHeight: '18px', padding: `0 ${spaceVar[4]}`, whiteSpace: 'nowrap' }}
    >
      <span style={{ color: themeVars.content.primary }}>{node.label ?? node.id}</span>
      <span style={{ color: themeVars.content.dim }}> {node.type}</span>
      {node.state !== undefined && (
        <span style={{ color: themeVars.semantic.warning }}> [{node.state}]</span>
      )}
      {node.outputs.length > 0 && (
        <span style={{ color: themeVars.content.muted }}> → {node.outputs.join(', ')}</span>
      )}
    </div>
  );
}

// --- Event log --------------------------------------------------------------

function eventColor(kind: AudioDebugEvent['kind']): string {
  if (kind === 'error') return themeVars.semantic.danger;
  if (kind === 'mute' || kind === 'unmute') return themeVars.semantic.warning;
  return themeVars.accent.default;
}

function EventRow({ event }: { event: AudioDebugEvent }) {
  return (
    <div
      data-testid="audio-log-row"
      data-kind={event.kind}
      style={{
        ...MONO,
        display: 'grid',
        gridTemplateColumns: '64px 1fr',
        gap: spaceVar[2],
        lineHeight: '17px',
        padding: `0 ${spaceVar[4]}`,
      }}
    >
      <span style={{ color: themeVars.content.dim }}>{(event.time / 1000).toFixed(2)}s</span>
      <span style={{ color: eventColor(event.kind) }}>
        {event.kind}
        {event.detail !== undefined ? (
          <span style={{ color: themeVars.content.muted }}> {event.detail}</span>
        ) : null}
      </span>
    </div>
  );
}

// --- The panel --------------------------------------------------------------

export function AudioDebuggerPanel() {
  const [, force] = useReducer((c: number) => c + 1, 0);
  const logRef = useRef(new AudioEventLogModel());
  const adapterRef = useRef<AudioAdapter | null>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const syncAdapter = () => {
      const adapter = editorHost().systems.inspectedAudio() ?? null;
      if (adapter !== adapterRef.current) {
        // Session started/stopped (or a different game mounted): the old
        // session's event log is stale, and MeterBars' `adapter`-keyed effect
        // re-acquires/disposes its handle off this same identity change.
        adapterRef.current = adapter;
        logRef.current = new AudioEventLogModel();
        logRef.current.paused = paused;
      }
      return adapter;
    };
    // 250 ms consume/render poll — the NetworkInspectorPanel idiom; also how
    // the panel notices play-mode start/stop (adapter identity).
    const tick = () => {
      logRef.current.pull(syncAdapter());
      force();
    };
    tick();
    const pollId = setInterval(tick, 250);
    return () => clearInterval(pollId);
  }, [paused]);

  const adapter = adapterRef.current ?? editorHost().systems.inspectedAudio() ?? null;
  const caps = deriveAudioCapabilities(adapter);

  if (!adapter || !caps) {
    return (
      <div
        data-testid="audio-debugger-empty"
        style={{
          padding: spaceVar[8],
          color: themeVars.content.muted,
          fontSize: fontSizeVar.md,
          lineHeight: '18px',
        }}
      >
        <div style={{ color: themeVars.content.primary, marginBottom: spaceVar[2] }}>
          Audio is still initializing.
        </div>
        The editor registers a first-party <code style={MONO}>AudioAdapter</code> in edit mode; Play
        temporarily replaces it with the running game's adapter.
      </div>
    );
  }

  const nodes = caps.graph ? (adapter.graphSnapshot?.() ?? []) : null;
  const events = logRef.current.all;

  return (
    <div
      data-testid="audio-debugger"
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        fontSize: fontSizeVar.md,
      }}
    >
      {/* Header: mute state + transport strip + meters */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: spaceVar[4],
          alignItems: 'center',
          borderBottom: `1px solid ${themeVars.boundary.default}`,
        }}
      >
        <ResumeAudioButton adapter={adapter} onResumed={force} />
        <span
          data-testid="audio-mute-state"
          style={{
            padding: `${spaceVar[2]} ${spaceVar[4]}`,
            color: adapter.isMuted() ? themeVars.semantic.warning : themeVars.semantic.success,
          }}
        >
          {adapter.isMuted() ? 'muted' : 'audible'}
        </span>
        {caps.transport ? (
          <TransportStrip adapter={adapter} />
        ) : (
          <AbsentNote testId="audio-transport-absent">
            Transport not provided by this adapter.
          </AbsentNote>
        )}
        {caps.meters ? (
          <MeterBars adapter={adapter} />
        ) : (
          <AbsentNote testId="audio-meters-absent">Meters not provided by this adapter.</AbsentNote>
        )}
      </div>

      {/* Body: node graph | event log */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div
          data-testid="audio-graph"
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'auto',
            borderRight: `1px solid ${themeVars.boundary.default}`,
            padding: `${spaceVar[2]} 0`,
          }}
        >
          {nodes ? (
            nodes.map((node) => <NodeRow key={node.id} node={node} />)
          ) : (
            <AbsentNote testId="audio-graph-absent">
              Audio graph not provided by this adapter.
            </AbsentNote>
          )}
        </div>

        <div
          data-testid="audio-event-log"
          style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}
        >
          {caps.events ? (
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
                  data-testid="audio-log-pause"
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
                  data-testid="audio-log-clear"
                  onClick={() => {
                    logRef.current.clear();
                    force();
                  }}
                >
                  Clear
                </Button>
                <span style={{ fontSize: fontSizeVar.sm, color: themeVars.content.muted }}>
                  {events.length} events
                </span>
              </div>
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                {events.length === 0 ? (
                  <AbsentNote>No audio events yet.</AbsentNote>
                ) : (
                  events.map((event) => <EventRow key={event.seq} event={event} />)
                )}
              </div>
            </>
          ) : (
            <AbsentNote testId="audio-log-absent">
              Event log not provided by this adapter.
            </AbsentNote>
          )}
        </div>
      </div>
    </div>
  );
}
