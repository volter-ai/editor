/**
 * THE MACHINE DOCUMENT's surface: one module's machines drawn as statecharts, edited in their own
 * source, with the running actors lit on top.
 *
 * - The chart is the SOURCE's: `/__xstate-source/module` reads it from the module's syntax tree,
 *   and every edit in the panel is `/__xstate-source/edit`, an AST write to that module with the
 *   session's attribution. The file changes; the chart re-reads it.
 * - The live layer is OBSERVED: actors started from these machines, whoever started them, report
 *   through the served stamp (`live-actors.ts`). Their active states are lit, the transition that
 *   last fired is marked, and their events and context are listed. Nothing in the game names them.
 */

import { handleProjectMutationFailure } from '@volter/editor-sdk/kit/source-conflict';
import {
  setCollaborationRevision,
  sourceMutationAttribution,
} from '@volter/editor-sdk/kit/editor-session-attribution';
import { themeVars } from '@volter/editor-sdk/widgets';
import { type CSSProperties, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { liveActors, type LiveActor, useLiveActorsVersion } from './live-actors';
import { edgeText, layoutMachine, type MachineLayout, machineTitle, stateLines } from './machine-layout';
import {
  activeStateIds,
  findMachineState,
  findMachineTransition,
  type MachineDefinition,
  type MachineEdit,
  type MachineModule,
  machineStates,
  type MachineState,
  type MachineTransition,
} from './machine-model';

type Selection = { readonly kind: 'state'; readonly id: string } | { readonly kind: 'transition'; readonly id: string } | null;

const POLL_MS = 2000;

async function readModule(file: string): Promise<MachineModule> {
  const response = await fetch(`/__xstate-source/module?file=${encodeURIComponent(file)}`);
  const body = (await response.json()) as MachineModule & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Reading ${file} failed (${response.status}).`);
  return body;
}

async function writeEdit(file: string, key: string, edit: MachineEdit): Promise<MachineModule> {
  const url = '/__xstate-source/edit';
  const body = { file, key, edit, ...sourceMutationAttribution() };
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (response.status === 409) {
    await handleProjectMutationFailure(response, {
      label: `Machine edit ${edit.op}`,
      attempted: {},
      reapply: () => writeEdit(file, key, edit).then(() => undefined),
    });
  }
  const answer = (await response.json()) as { ok?: boolean; error?: string; revision?: number; module?: MachineModule };
  if (!response.ok || !answer.module) throw new Error(answer.error ?? `The edit failed (${response.status}).`);
  if (typeof answer.revision === 'number') setCollaborationRevision(answer.revision);
  return answer.module;
}

const mono: CSSProperties = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };
const panelText: CSSProperties = { fontSize: 12, color: themeVars.content.primary };
const dim: CSSProperties = { fontSize: 11, color: themeVars.content.muted };
const inputStyle: CSSProperties = {
  background: themeVars.surface.inset,
  color: themeVars.content.primary,
  border: `1px solid ${themeVars.boundary.default}`,
  borderRadius: 3,
  padding: '3px 6px',
  fontSize: 12,
  minWidth: 0,
};
const buttonStyle: CSSProperties = {
  background: themeVars.surface.raised,
  color: themeVars.content.primary,
  border: `1px solid ${themeVars.boundary.default}`,
  borderRadius: 3,
  padding: '3px 8px',
  fontSize: 12,
  cursor: 'pointer',
};
const ACTIVE = themeVars.semantic.success;
const FIRED = themeVars.semantic.warning;

export function MachineEditor({ file, active }: { readonly file: string; readonly active: boolean }) {
  const [module, setModule] = useState<MachineModule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [machineKey, setMachineKey] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [layout, setLayout] = useState<MachineLayout | null>(null);
  const [actorIndex, setActorIndex] = useState(0);

  const refresh = useCallback(async () => {
    try {
      setModule(await readModule(file));
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    }
  }, [file]);

  useEffect(() => {
    void refresh();
    if (!active) return;
    // The module is the truth and anyone may write it (an agent, a text editor); re-read it while
    // this document is in front.
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh, active]);

  const machine: MachineDefinition | null = useMemo(() => {
    if (!module) return null;
    return module.machines.find((candidate) => candidate.key === machineKey) ?? module.machines[0] ?? null;
  }, [module, machineKey]);

  const shape = useMemo(() => (machine ? JSON.stringify(machine.root, (key, value) => (key === 'span' ? undefined : value)) : ''), [machine]);
  useEffect(() => {
    if (!machine) return;
    let cancelled = false;
    layoutMachine(machine).then(
      (next) => !cancelled && setLayout(next),
      (thrown: unknown) => !cancelled && setError(`Layout failed: ${thrown instanceof Error ? thrown.message : String(thrown)}`),
    );
    return () => {
      cancelled = true;
    };
    // Re-laid out when the machine's SHAPE changes, not on every re-read of the same bytes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape]);

  const edit = useCallback(
    async (change: MachineEdit) => {
      if (!machine) return;
      try {
        setError(null);
        setModule(await writeEdit(file, machine.key, change));
      } catch (thrown) {
        setError(thrown instanceof Error ? thrown.message : String(thrown));
      }
    },
    [file, machine],
  );

  useLiveActorsVersion();
  const actors = machine ? liveActors(machine.key) : [];
  const actor: LiveActor | null = actors[Math.min(actorIndex, actors.length - 1)] ?? null;
  const snapshot = actor?.ref.getSnapshot() ?? null;
  const activeIds = useMemo(() => new Set(snapshot ? ['', ...activeStateIds(snapshot.value)] : []), [snapshot]);
  const lastEvent = actor?.events[actor.events.length - 1] ?? null;
  const firedEdges = useMemo(() => {
    const fired = new Set<string>();
    if (!lastEvent || !layout || Date.now() - lastEvent.at > 1500) return fired;
    const from = new Set(['', ...activeStateIds(lastEvent.from)]);
    const to = new Set(activeStateIds(lastEvent.to));
    for (const edge of layout.edges) {
      const transition = edge.transition;
      if (!transition || transition.event !== lastEvent.type) continue;
      if (from.has(transition.source) && to.has(edge.target)) fired.add(edge.id);
    }
    return fired;
  }, [lastEvent, layout]);

  if (!module) {
    return <div style={{ ...panelText, padding: 16 }}>{error ?? `Reading ${file}…`}</div>;
  }
  if (!machine) {
    return (
      <div style={{ ...panelText, padding: 16 }}>
        {file} declares no machine the editor can read.
        {module.notes.map((note) => (
          <div key={note} style={dim}>{note}</div>
        ))}
      </div>
    );
  }

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: themeVars.surface.shell }}>
      <Header
        module={module}
        machine={machine}
        onMachine={setMachineKey}
        actors={actors}
        actorIndex={Math.min(actorIndex, Math.max(actors.length - 1, 0))}
        onActor={setActorIndex}
      />
      {error ? (
        <div style={{ ...panelText, padding: '6px 12px', background: themeVars.semantic.dangerFaint, color: themeVars.semantic.danger }}>
          {error}
        </div>
      ) : null}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <Chart
            rootTitle={machineTitle(machine)}
            layout={layout}
            selection={selection}
            onSelect={setSelection}
            activeIds={actor ? activeIds : null}
            firedEdges={firedEdges}
          />
          {actor ? <LiveStrip actor={actor} /> : null}
        </div>
        <Panel machine={machine} selection={selection} onSelect={setSelection} onEdit={edit} activeIds={actor ? activeIds : null} />
      </div>
    </div>
  );
}

/** An actor by the id its author gave it; XState's generated `x:<n>` names nothing a person wrote. */
function actorLabel(actor: LiveActor, index: number, count: number): string {
  const id = actor.ref.id;
  const named = id && !/^x:\d+$/.test(id) ? id : `actor ${index + 1}`;
  return count > 1 ? `${named} (${index + 1} of ${count})` : named;
}

function Header(props: {
  readonly module: MachineModule;
  readonly machine: MachineDefinition;
  readonly onMachine: (key: string) => void;
  readonly actors: readonly LiveActor[];
  readonly actorIndex: number;
  readonly onActor: (index: number) => void;
}) {
  const { module, machine, actors } = props;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 12px',
        borderBottom: `1px solid ${themeVars.boundary.default}`,
        background: themeVars.surface.chrome,
      }}
    >
      {module.machines.length > 1 ? (
        <select style={inputStyle} value={machine.key} onChange={(event) => props.onMachine(event.target.value)}>
          {module.machines.map((candidate) => (
            <option key={candidate.key} value={candidate.key}>
              {candidate.exportName ?? candidate.key}
            </option>
          ))}
        </select>
      ) : (
        <span style={{ ...panelText, fontWeight: 600 }}>{machine.exportName ?? machine.key}</span>
      )}
      {machine.machineId ? <span style={{ ...dim, ...mono }}>#{machine.machineId}</span> : null}
      <span style={{ ...dim, ...mono }}>{module.file}</span>
      <span style={{ flex: 1 }} />
      {actors.length > 0 ? (
        <>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: ACTIVE }} />
          <span style={panelText}>Live</span>
          <select style={inputStyle} value={props.actorIndex} onChange={(event) => props.onActor(Number(event.target.value))}>
            {actors.map((actor, index) => (
              <option key={actor.ref.sessionId ?? index} value={index}>
                {actorLabel(actor, index, actors.length)}
              </option>
            ))}
          </select>
        </>
      ) : (
        <span style={dim}>No running actor — Play to watch it live</span>
      )}
    </div>
  );
}

function Chart(props: {
  readonly rootTitle: string;
  readonly layout: MachineLayout | null;
  readonly selection: Selection;
  readonly onSelect: (selection: Selection) => void;
  readonly activeIds: ReadonlySet<string> | null;
  readonly firedEdges: ReadonlySet<string>;
}) {
  const { layout, selection, activeIds, firedEdges, rootTitle } = props;
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const fitted = useRef<MachineLayout | null>(null);
  const drag = useRef<{ x: number; y: number; startX: number; startY: number; moved: boolean } | null>(null);

  // Fit once the pane HAS a size: a document opened behind another tab mounts at zero width, and a
  // fit taken then is a speck.
  useEffect(() => {
    const element = host.current;
    if (!layout || !element) return;
    const fit = () => {
      if (fitted.current === layout || element.clientWidth < 40 || element.clientHeight < 40) return;
      fitted.current = layout;
      const scale = Math.min(1, (element.clientWidth - 24) / layout.width, (element.clientHeight - 24) / layout.height);
      setView({ scale, x: (element.clientWidth - layout.width * scale) / 2, y: 12 });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [layout]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      setView((current) => {
        const scale = Math.min(3, Math.max(0.15, current.scale * Math.exp(-event.deltaY * 0.0015)));
        const ratio = scale / current.scale;
        return { scale, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio };
      });
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  if (!layout) return <div ref={host} style={{ flex: 1, ...dim, padding: 16 }}>Laying out…</div>;

  const states = [...layout.states].sort((a, b) => a.depth - b.depth);
  const selectedEdge = selection?.kind === 'transition' ? selection.id : null;
  return (
    <div
      ref={host}
      style={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative', cursor: drag.current ? 'grabbing' : 'default' }}
      onPointerDown={(event) => {
        drag.current = { x: event.clientX, y: event.clientY, startX: view.x, startY: view.y, moved: false };
        (event.target as Element).setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (!current) return;
        const dx = event.clientX - current.x;
        const dy = event.clientY - current.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) current.moved = true;
        if (current.moved) setView((v) => ({ ...v, x: current.startX + dx, y: current.startY + dy }));
      }}
      onPointerUp={() => {
        const moved = drag.current?.moved;
        drag.current = null;
        if (!moved) return;
      }}
    >
      <svg width="100%" height="100%" style={{ display: 'block' }}>
        <defs>
          <marker id="xs-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="10" markerHeight="10" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={themeVars.content.muted} />
          </marker>
          <marker id="xs-arrow-hot" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="10" markerHeight="10" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={FIRED} />
          </marker>
          <marker id="xs-arrow-sel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="10" markerHeight="10" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={themeVars.selection.border} />
          </marker>
        </defs>
        <g transform={`translate(${view.x},${view.y}) scale(${view.scale})`}>
          {states.map((laid) => {
            const { state } = laid;
            const isActive = activeIds?.has(state.id) ?? false;
            const isSelected = selection?.kind === 'state' && selection.id === state.id;
            const compound = state.children.length > 0;
            const lines = stateLines(state);
            const stroke = isSelected ? themeVars.selection.border : isActive ? ACTIVE : themeVars.boundary.strong;
            const title = state.id === '' ? rootTitle : state.key;
            return (
              <g
                key={state.id || '__root'}
                data-testid={`machine-state-${state.id || 'root'}`}
                onPointerUp={(event) => {
                  if (drag.current?.moved) return;
                  event.stopPropagation();
                  props.onSelect({ kind: 'state', id: state.id });
                }}
                style={{ cursor: 'pointer' }}
              >
                <rect
                  x={laid.x}
                  y={laid.y}
                  width={laid.width}
                  height={laid.height}
                  rx={compound ? 10 : 8}
                  fill={compound ? themeVars.surface.panel : themeVars.surface.raised}
                  fillOpacity={compound ? 0.55 : 1}
                  stroke={stroke}
                  strokeWidth={isSelected || isActive ? 2 : 1}
                  strokeDasharray={laid.region ? '6 4' : undefined}
                />
                <text x={laid.x + 12} y={laid.y + 21} fontSize={13} fontWeight={600} fill={themeVars.content.primary}>
                  {title}
                </text>
                <text x={laid.x + laid.width - 10} y={laid.y + 21} fontSize={10} textAnchor="end" fill={isActive ? ACTIVE : themeVars.content.dim}>
                  {isActive ? '● active' : state.kind === 'atomic' ? '' : state.kind}
                </text>
                {state.kind === 'final' ? (
                  <rect x={laid.x + 3} y={laid.y + 3} width={laid.width - 6} height={laid.height - 6} rx={6} fill="none" stroke={stroke} />
                ) : null}
                {lines.map((line, index) => (
                  <text key={line} x={laid.x + 12} y={laid.y + 38 + index * 15} fontSize={11} fill={themeVars.content.muted} style={mono}>
                    {line}
                  </text>
                ))}
              </g>
            );
          })}
          {layout.initials.map((dot) => (
            <circle key={`${dot.x},${dot.y}`} cx={dot.x} cy={dot.y} r={5} fill={themeVars.content.primary} />
          ))}
          {layout.edges.map((edge) => {
            if (edge.points.length < 2) return null;
            const hot = firedEdges.has(edge.id);
            const selected = edge.transition !== null && selectedEdge === edge.transition.id;
            const color = selected ? themeVars.selection.border : hot ? FIRED : themeVars.content.muted;
            const d = edge.points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' ');
            return (
              <g
                key={edge.id}
                style={{ cursor: edge.transition ? 'pointer' : 'default' }}
                onPointerUp={(event) => {
                  if (!edge.transition || drag.current?.moved) return;
                  event.stopPropagation();
                  props.onSelect({ kind: 'transition', id: edge.transition.id });
                }}
              >
                <path d={d} fill="none" stroke="transparent" strokeWidth={10} />
                <path
                  d={d}
                  fill="none"
                  stroke={color}
                  strokeWidth={hot || selected ? 2.2 : 1.3}
                  markerEnd={`url(#${selected ? 'xs-arrow-sel' : hot ? 'xs-arrow-hot' : 'xs-arrow'})`}
                />
                {edge.label ? (
                  <g>
                    <rect
                      x={edge.label.x}
                      y={edge.label.y}
                      width={edge.label.width}
                      height={edge.label.height}
                      rx={4}
                      fill={hot ? FIRED : themeVars.surface.chrome}
                      stroke={selected ? themeVars.selection.border : themeVars.boundary.default}
                    />
                    <text
                      x={edge.label.x + 6}
                      y={edge.label.y + 13}
                      fontSize={11}
                      fill={hot ? themeVars.content.onAccent : themeVars.content.primary}
                      style={mono}
                    >
                      {edge.label.text}
                    </text>
                  </g>
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>
      <div style={{ position: 'absolute', right: 10, bottom: 8, display: 'flex', gap: 6 }}>
        <button
          type="button"
          style={buttonStyle}
          onClick={() => {
            const element = host.current;
            if (!element || !layout) return;
            const scale = Math.min(1, (element.clientWidth - 24) / layout.width, (element.clientHeight - 24) / layout.height);
            setView({ scale, x: (element.clientWidth - layout.width * scale) / 2, y: 12 });
          }}
        >
          Fit
        </button>
      </div>
    </div>
  );
}

function LiveStrip({ actor }: { readonly actor: LiveActor }) {
  const snapshot = actor.ref.getSnapshot();
  // A machine fed every frame repeats itself; consecutive identical events are one row with a count.
  const events: { type: string; at: number; to: unknown; count: number }[] = [];
  for (const event of actor.events) {
    const last = events[events.length - 1];
    if (last && last.type === event.type && JSON.stringify(last.to) === JSON.stringify(event.to)) {
      last.count++;
      last.at = event.at;
    } else events.push({ type: event.type, at: event.at, to: event.to, count: 1 });
  }
  events.splice(0, Math.max(0, events.length - 40));
  events.reverse();
  let context = '';
  try {
    context = JSON.stringify(snapshot.context, (_key, value) => (typeof value === 'number' ? Math.round(value * 1000) / 1000 : value), 2) ?? '';
  } catch {
    context = '(context is not serializable)';
  }
  return (
    <div style={{ display: 'flex', height: 170, borderTop: `1px solid ${themeVars.boundary.default}`, background: themeVars.surface.panel }}>
      <div style={{ flex: 1, overflow: 'auto', padding: '6px 10px' }}>
        <div style={{ ...dim, marginBottom: 4 }}>EVENTS</div>
        {events.length === 0 ? <div style={dim}>No event yet</div> : null}
        {events.map((event, index) => (
          <div key={`${event.at}-${index}`} style={{ ...panelText, ...mono, fontSize: 11, display: 'flex', gap: 8 }}>
            <span style={{ color: themeVars.content.dim }}>{new Date(event.at).toLocaleTimeString()}</span>
            <span style={{ color: FIRED }}>{event.type}</span>
            {event.count > 1 ? <span style={{ color: themeVars.content.dim }}>×{event.count}</span> : null}
            <span style={{ color: themeVars.content.muted }}>→ {JSON.stringify(event.to)}</span>
          </div>
        ))}
      </div>
      <div style={{ width: 280, overflow: 'auto', padding: '6px 10px', borderLeft: `1px solid ${themeVars.boundary.default}` }}>
        <div style={{ ...dim, marginBottom: 4 }}>CONTEXT</div>
        <pre style={{ ...panelText, ...mono, fontSize: 11, margin: 0 }}>{context}</pre>
      </div>
    </div>
  );
}

function StateOptions({
  machine,
  value,
  onChange,
  testId,
}: {
  readonly machine: MachineDefinition;
  readonly value: string;
  readonly onChange: (id: string) => void;
  readonly testId?: string;
}) {
  return (
    <select data-testid={testId} style={{ ...inputStyle, flex: 1 }} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="" disabled>
        target…
      </option>
      {[...machineStates(machine.root)]
        .filter((state) => state.id !== '')
        .map((state) => (
          <option key={state.id} value={state.id}>
            {state.id}
          </option>
        ))}
    </select>
  );
}

function NameInput(props: { readonly value: string; readonly placeholder?: string; readonly onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => setDraft(props.value), [props.value]);
  return (
    <input
      style={{ ...inputStyle, flex: 1 }}
      value={draft}
      placeholder={props.placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && draft.trim() && draft !== props.value) props.onCommit(draft.trim());
        if (event.key === 'Escape') setDraft(props.value);
      }}
      onBlur={() => setDraft(props.value)}
    />
  );
}

function Row({ children }: { readonly children: ReactNode }) {
  return <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>{children}</div>;
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div style={{ padding: '10px 12px', borderBottom: `1px solid ${themeVars.boundary.default}` }}>
      <div style={{ ...dim, letterSpacing: 0.4, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

function TransitionRow(props: {
  readonly machine: MachineDefinition;
  readonly transition: MachineTransition;
  readonly onEdit: (edit: MachineEdit) => void;
  readonly onSelect: (selection: Selection) => void;
}) {
  const { transition, machine } = props;
  const target = transition.resolved[0] ?? '';
  return (
    <div style={{ marginBottom: 8 }}>
      <Row>
        {transition.kind === 'on' ? (
          <NameInput value={transition.event} onCommit={(event) => props.onEdit({ op: 'rename-event', transition: transition.id, event })} />
        ) : (
          <span style={{ ...panelText, ...mono, flex: 1 }}>{edgeText(transition)}</span>
        )}
        <button type="button" data-testid="machine-remove-transition" style={buttonStyle} title="Remove this transition" onClick={() => props.onEdit({ op: 'remove-transition', transition: transition.id })}>
          ×
        </button>
      </Row>
      <Row>
        <span style={dim}>→</span>
        {transition.targets.length === 0 ? (
          <span style={{ ...dim, flex: 1 }}>no target (stays; runs its actions)</span>
        ) : transition.targets.length === 1 ? (
          <StateOptions machine={machine} value={target} onChange={(id) => props.onEdit({ op: 'retarget-transition', transition: transition.id, target: id })} />
        ) : (
          <span style={{ ...panelText, ...mono }}>{transition.targets.join(', ')}</span>
        )}
      </Row>
      {transition.guard ? <div style={{ ...dim, ...mono }}>guard: {transition.guard}</div> : null}
      {transition.actions.length ? <div style={{ ...dim, ...mono }}>actions: {transition.actions.join(', ')}</div> : null}
      {transition.resolved.some((resolved) => resolved === null) ? (
        <div style={{ ...dim, color: themeVars.semantic.danger }}>A target does not resolve to a state.</div>
      ) : null}
    </div>
  );
}

function Panel(props: {
  readonly machine: MachineDefinition;
  readonly selection: Selection;
  readonly onSelect: (selection: Selection) => void;
  readonly onEdit: (edit: MachineEdit) => void;
  readonly activeIds: ReadonlySet<string> | null;
}) {
  const { machine, selection, onEdit } = props;
  const [childName, setChildName] = useState('');
  const [event, setEvent] = useState('');
  const [target, setTarget] = useState('');
  const container: CSSProperties = {
    width: 300,
    borderLeft: `1px solid ${themeVars.boundary.default}`,
    background: themeVars.surface.panel,
    overflow: 'auto',
  };

  if (selection?.kind === 'transition') {
    const transition = findMachineTransition(machine.root, selection.id);
    if (!transition) return <div style={container} />;
    return (
      <div style={container}>
        <Section title={`TRANSITION FROM ${transition.source || 'MACHINE'}`}>
          <TransitionRow machine={machine} transition={transition} onEdit={onEdit} onSelect={props.onSelect} />
          <button type="button" style={buttonStyle} onClick={() => props.onSelect({ kind: 'state', id: transition.source })}>
            Select source state
          </button>
        </Section>
      </div>
    );
  }

  const stateId = selection?.kind === 'state' ? selection.id : '';
  const state: MachineState | null = findMachineState(machine.root, stateId);
  if (!state) return <div style={container} />;
  const parentId = state.id.includes('.') ? state.id.slice(0, state.id.lastIndexOf('.')) : '';
  const parent = state.id === '' ? null : findMachineState(machine.root, parentId);
  const isInitial = parent?.kind === 'compound' && parent.initial === state.key;
  return (
    <div style={container}>
      <Section title={state.id === '' ? 'MACHINE' : 'STATE'}>
        {state.id === '' ? (
          <div style={{ ...panelText, fontWeight: 600, marginBottom: 6 }}>{machine.exportName ?? machine.key}</div>
        ) : (
          <Row>
            <NameInput value={state.key} onCommit={(key) => onEdit({ op: 'rename-state', state: state.id, key })} />
          </Row>
        )}
        <div style={dim}>
          {state.kind}
          {state.initial ? ` · initial ${state.initial}` : ''}
          {isInitial ? ' · initial state' : ''}
          {props.activeIds?.has(state.id) ? ' · active now' : ''}
        </div>
        {state.description ? <div style={{ ...panelText, marginTop: 6 }}>{state.description}</div> : null}
        {state.id !== '' ? (
          <Row>
            {parent?.kind === 'compound' && !isInitial ? (
              <button type="button" style={buttonStyle} onClick={() => onEdit({ op: 'set-initial', parent: parentId, key: state.key })}>
                Make initial
              </button>
            ) : null}
            <button type="button" data-testid="machine-remove-state" style={buttonStyle} onClick={() => onEdit({ op: 'remove-state', state: state.id })}>
              Remove state
            </button>
          </Row>
        ) : null}
        {state.opaque.length ? (
          <div style={{ ...dim, marginTop: 6 }}>
            Read-only here (edit in code): {state.opaque.join('; ')}
          </div>
        ) : null}
      </Section>
      {state.kind !== 'final' && state.kind !== 'history' ? (
        <Section title="CHILD STATES">
          {state.children.map((child) => (
            <div
              key={child.id}
              style={{ ...panelText, cursor: 'pointer', marginBottom: 4 }}
              onClick={() => props.onSelect({ kind: 'state', id: child.id })}
            >
              {state.initial === child.key ? '→ ' : ''}
              {child.key}
              <span style={dim}> {child.kind === 'atomic' ? '' : child.kind}</span>
            </div>
          ))}
          <Row>
            <input
              data-testid="machine-new-state-name"
              style={{ ...inputStyle, flex: 1 }}
              placeholder="new state"
              value={childName}
              onChange={(e) => setChildName(e.target.value)}
            />
            <button
              type="button"
              data-testid="machine-add-state"
              style={buttonStyle}
              disabled={!childName.trim()}
              onClick={() => {
                onEdit({ op: 'add-state', parent: state.id, key: childName.trim() });
                setChildName('');
              }}
            >
              Add
            </button>
          </Row>
        </Section>
      ) : null}
      <Section title="TRANSITIONS">
        {state.transitions.map((transition) => (
          <TransitionRow key={transition.id} machine={machine} transition={transition} onEdit={onEdit} onSelect={props.onSelect} />
        ))}
        <Row>
          <input
            data-testid="machine-new-transition-event"
            style={{ ...inputStyle, flex: 1, ...mono }}
            placeholder="EVENT"
            value={event}
            onChange={(e) => setEvent(e.target.value)}
          />
        </Row>
        <Row>
          <StateOptions testId="machine-new-transition-target" machine={machine} value={target} onChange={setTarget} />
          <button
            type="button"
            data-testid="machine-add-transition"
            style={buttonStyle}
            disabled={!event.trim() || !target}
            onClick={() => {
              onEdit({ op: 'add-transition', source: state.id, event: event.trim(), target });
              setEvent('');
              setTarget('');
            }}
          >
            Add
          </button>
        </Row>
      </Section>
      {state.entry.length || state.exit.length || state.tags.length || state.meta ? (
        <Section title="ACTIONS & META">
          {state.entry.length ? <div style={{ ...panelText, ...mono }}>entry: {state.entry.join(', ')}</div> : null}
          {state.exit.length ? <div style={{ ...panelText, ...mono }}>exit: {state.exit.join(', ')}</div> : null}
          {state.tags.length ? <div style={{ ...panelText, ...mono }}>tags: {state.tags.join(', ')}</div> : null}
          {state.meta ? <pre style={{ ...panelText, ...mono, fontSize: 11, whiteSpace: 'pre-wrap' }}>meta: {state.meta}</pre> : null}
        </Section>
      ) : null}
    </div>
  );
}
