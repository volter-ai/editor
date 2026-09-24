/**
 * E3 + E4 (spec §11) — a visual, READ-ONLY inspector for a real XState v5 machine: states
 * render as boxes (nodes), transitions as labeled arrows (edges), and the
 * currently active state(s) are highlighted. XState behavior machines are
 * hand-authored TypeScript; this component INSPECTS them, it never edits/generates/round-trips
 * machine config. That boundary is also stated inline in the panel itself (the "Inspect-only"
 * badge below) — not just in a doc a user might not read.
 *
 * Pure presentation: `buildXStateGraph`/`layoutXStateGraph` (this directory)
 * do all the machine-introspection and layout work; this component only
 * renders their output plus the small amount of interaction state
 * (hover/selection for the per-state metadata detail panel).
 *
 * Visual language (house style — see DataPanel.tsx for the canonical dock
 * tab): chrome is the sans default; monospace is reserved for CODE — state
 * ids and event tokens on edges. Blue
 * (the palette accent) is selection (the clicked node); green (the `success` token) is strictly
 * the LIVE status color (the running state's border + "● ACTIVE" pip and the
 * active transition edge) — two different signals, two different colors.
 */

import { faCircleInfo, faLock } from '@fortawesome/free-solid-svg-icons';
import {
  Button,
  EditorIcon,
  fontSizeVar,
  spaceVar,
  TONE_WARNING,
  themeVars,
} from '@volter/editor-sdk/widgets';
import type { InspectableXStateActor } from '@volter/threejs-runtime/behavior/xstate-inspection';
import { useMemo, useState } from 'react';
import type { AnyStateMachine } from 'xstate';
import { useLiveActorState } from './use-live-actor-state';
import { buildXStateGraph, type XStateGraphNode } from './xstate-graph';
import { layoutXStateGraph } from './xstate-layout';

export interface XStateMachineInspectorProps {
  machine: AnyStateMachine;
  /**
   * Static "current state id" highlight (e.g. `"character-animation.idle"`).
   * Ignored while `actor` is provided AND has emitted at least one snapshot
   * (the live actor becomes the source of truth for the highlight once
   * available). Useful for tests and for callers with no live actor.
   */
  currentStateId?: string | undefined;
  /**
   * A LIVE xstate actor to highlight and follow in real time (play mode).
   * Optional — when omitted, the panel is a static graph view of the machine
   * shape, optionally highlighted via `currentStateId`. When provided, this
   * component subscribes to it (`actor.subscribe`) and re-highlights on every
   * transition, unsubscribing on unmount/actor change.
   */
  actor?: InspectableXStateActor | undefined;
  /** Optional heading override (defaults to the machine's root id). */
  title?: string | undefined;
}

// U6 sweep: this used to be a fully hand-typed local palette re-spelling the
// token values; the chrome slots now IMPORT the tokens they always mirrored.
// Graph paint follows the same semantic roles as surrounding editor chrome.
// State/data identity is expressed through labels and graph structure, not a
// private syntax palette that becomes illegible under alternate themes.
const COLORS = {
  bg: themeVars.surface.inset,
  panelBg: themeVars.surface.panel,
  border: themeVars.boundary.default,
  innerBorder: themeVars.boundary.default,
  nodeBg: themeVars.surface.panel,
  nodeHoverBg: themeVars.surface.chrome,
  nodeBorder: themeVars.boundary.strong,
  /** Green = LIVE status only (running state / active edge), never selection.
   *  Now the shared `success` token (§3 absorbs the old one-off `#5ec26a`). */
  live: themeVars.semantic.success,
  text: themeVars.content.primary,
  dim: themeVars.content.dim,
  edge: themeVars.content.dim,
  guard: themeVars.semantic.warning,
  /** Blue = selection (the clicked node) / interactive accent. */
  accent: themeVars.accent.default,
  /** Clip names / event tokens remain code, using the theme accent. */
  codeBlue: themeVars.accent.default,
};

/** Monospace is for CODE only: state ids, event tokens, clip names, JSON.
 *  (U6: the one shared editor mono stack, not a fifth local spelling.) */
const MONO = themeVars.typography.mono;

/** DataPanel-style uppercase eyebrow label (detail-pane section headers). */
const eyebrowStyle: React.CSSProperties = {
  fontSize: fontSizeVar.sm,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  color: COLORS.dim,
};

function nodeTestId(id: string): string {
  return `xstate-node-${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

/** One state box. Purely presentational — position comes from the layout. */
function StateNodeBox({
  n,
  x,
  y,
  width,
  height,
  isActive,
  isSelected,
  onSelect,
}: {
  n: XStateGraphNode;
  x: number;
  y: number;
  width: number;
  height: number;
  isActive: boolean;
  isSelected: boolean;
  onSelect: () => void;
}) {
  // Selection (blue) wins the border; live (green) keeps its pip either way.
  return (
    <Button
      className="vgai-xstate-node"
      variant="ghost"
      data-testid={nodeTestId(n.id)}
      data-active={String(isActive)}
      data-selected={isSelected || undefined}
      onClick={onSelect}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width,
        height,
      }}
      title={n.id}
    >
      <span
        className="vgai-xstate-node-type"
        style={{
          ...eyebrowStyle,
          fontSize: fontSizeVar.xs,
        }}
      >
        {n.type}
        {n.isInitial ? ' · initial' : ''}
      </span>
      <span
        style={{
          fontWeight: 600,
          fontSize: fontSizeVar.md,
          display: 'flex',
          alignItems: 'center',
          gap: spaceVar[3],
        }}
      >
        {n.key}
        {isActive && (
          <span
            data-testid={`xstate-node-active-badge-${n.key}`}
            style={{
              color: COLORS.live,
              fontSize: fontSizeVar.xs,
              fontWeight: 700,
              letterSpacing: 0.4,
            }}
          >
            ● ACTIVE
          </span>
        )}
      </span>
    </Button>
  );
}

/** SVG arrow connecting two laid-out node boxes, labeled with its event/guard. */
function EdgeArrow({
  x1,
  y1,
  x2,
  y2,
  label,
  guard,
  isEventless,
  isActive,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
  guard: string | undefined;
  isEventless: boolean;
  isActive: boolean;
}) {
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const stroke = isActive ? COLORS.live : isEventless ? COLORS.guard : COLORS.edge;
  const labelColor = isActive ? COLORS.live : isEventless ? COLORS.guard : COLORS.codeBlue;
  // DISPLAY-only guard tidy-up (the full guardLabel stays in the detail
  // panel's transitions list): an inline arrow-predicate guard reads better
  // on a chip as just its body (`context.speed <= 0.1`), and anything still
  // longer than ~30 chars gets an ellipsis so chips stay near the line's
  // midpoint instead of sprawling across node columns.
  const guardBody = guard?.includes('=>') ? guard.slice(guard.indexOf('=>') + 2).trim() : guard;
  const guardDisplay =
    guardBody && guardBody.length > 30 ? `${guardBody.slice(0, 29)}…` : guardBody;
  // Size the label chip from the FULL displayed text (event + guard suffix) —
  // 9px monospace is ~5.6px/char.
  const fullLabel = guardDisplay ? `${label} [${guardDisplay}]` : label;
  const chipWidth = fullLabel.length * 5.6 + 14;
  return (
    <g data-testid="xstate-edge" opacity={isActive ? 1 : 0.8}>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={stroke}
        strokeWidth={isActive ? 1.5 : 1}
        markerEnd={isActive ? 'url(#xstate-arrowhead-active)' : 'url(#xstate-arrowhead)'}
      />
      <rect
        x={midX - chipWidth / 2}
        y={midY - 8}
        width={chipWidth}
        height={16}
        fill={COLORS.panelBg}
        stroke={COLORS.border}
        strokeWidth={1}
        rx={4}
      />
      <text
        x={midX}
        y={midY + 3}
        fill={labelColor}
        fontSize={9}
        textAnchor="middle"
        fontFamily={MONO}
      >
        {label}
        {guardDisplay && <tspan fill={COLORS.guard}>{` [${guardDisplay}]`}</tspan>}
      </text>
    </g>
  );
}

function displayedActiveIds(
  liveIds: string[] | null,
  currentStateId: string | undefined,
): string[] {
  if (liveIds) return liveIds;
  return currentStateId ? [currentStateId] : [];
}

export function XStateMachineInspector({
  machine,
  currentStateId,
  actor,
  title,
}: XStateMachineInspectorProps) {
  const graph = useMemo(() => buildXStateGraph(machine), [machine]);
  const layout = useMemo(() => layoutXStateGraph(graph), [graph]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Live actor (play mode) takes over the highlight once it has emitted a
  // snapshot; otherwise fall back to the static `currentStateId` prop.
  const liveActiveIds = useLiveActorState(machine, actor);
  const activeIds = displayedActiveIds(liveActiveIds, currentStateId);
  const activeSet = useMemo(() => new Set(activeIds), [activeIds]);

  const selectedNode = graph.nodes.find((n) => n.id === selectedId) ?? null;
  const selectedEdges = selectedNode ? graph.edges.filter((e) => e.source === selectedNode.id) : [];
  const context = actor?.getSnapshot().context;
  const contextEntries =
    context && typeof context === 'object' && !Array.isArray(context)
      ? Object.entries(context as Record<string, unknown>)
      : [];

  return (
    // Responsive by construction (no width measuring): the graph and the detail
    // pane sit SIDE BY SIDE when there is room and WRAP — detail STACKS BELOW —
    // when the container is narrow (the inspector rail). `flex-wrap` plus a
    // per-pane min-width floor forces the wrap instead of shrinking either pane
    // to an unusable sliver; `min(…, 100%)` keeps the floor from overflowing a
    // container narrower than the floor itself. The graph is an inherently
    // absolute-positioned 2D canvas, so it is BOUNDED in a fixed-min-height box
    // that scrolls internally (below) — it never forces the section wider.
    <div
      data-testid="xstate-inspector-panel"
      style={{
        display: 'flex',
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignContent: 'flex-start',
        height: '100%',
        minHeight: 0,
        overflowY: 'auto',
        background: COLORS.bg,
        color: COLORS.text,
        fontSize: fontSizeVar.md,
      }}
    >
      <div
        style={{
          flex: '1 1 260px',
          minWidth: 'min(260px, 100%)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header: machine id + the E4 inspect-only badge/explanation. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: spaceVar[5],
            padding: `${spaceVar[3]} ${spaceVar[5]}`,
            borderBottom: `1px solid ${COLORS.border}`,
            flexShrink: 0,
          }}
        >
          <span style={{ fontWeight: 600, fontSize: fontSizeVar.md }}>
            {title ?? graph.machineId}
          </span>
          <span
            data-testid="xstate-inspect-only-badge"
            title="XState behavior is hand-authored TypeScript. This view derives the live statechart for debugging and never creates a second machine document."
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: spaceVar[2],
              padding: `${spaceVar[1]} ${spaceVar[4]}`,
              borderRadius: themeVars.shape.full,
              // U6: the shared warning banner tone (banner-tones.ts), not a
              // fourth hand-mixed amber triple.
              background: TONE_WARNING.bg,
              color: TONE_WARNING.fg,
              border: `1px solid ${TONE_WARNING.border}`,
              fontSize: fontSizeVar.xs,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: 0.4,
            }}
          >
            <EditorIcon icon={faLock} style={{ fontSize: fontSizeVar.xs }} />
            Inspect-only
          </span>
          <span style={{ color: COLORS.dim, fontSize: fontSizeVar.sm, flex: 1 }}>
            Live behavior statechart · source-owned TypeScript
          </span>
        </div>

        {/* Graph canvas */}
        <div
          data-testid="xstate-graph-canvas"
          // `flex: 1` fills a tall panel; `minHeight` is the floor that keeps
          // the graph a usable, internally-scrolled box when the container is
          // auto-height (a section body in the inspector column has no fixed
          // height to fill), so a wide graph pans inside this box rather than
          // pushing the section open.
          style={{ flex: '1 1 auto', minHeight: 300, overflow: 'auto', position: 'relative' }}
        >
          <div style={{ position: 'relative', width: layout.width, height: layout.height }}>
            <svg
              width={layout.width}
              height={layout.height}
              style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
            >
              <defs>
                <marker
                  id="xstate-arrowhead"
                  markerWidth="8"
                  markerHeight="8"
                  refX="7"
                  refY="4"
                  orient="auto"
                >
                  <path d="M0,0 L8,4 L0,8 Z" fill={COLORS.edge} />
                </marker>
                <marker
                  id="xstate-arrowhead-active"
                  markerWidth="8"
                  markerHeight="8"
                  refX="7"
                  refY="4"
                  orient="auto"
                >
                  <path d="M0,0 L8,4 L0,8 Z" fill={COLORS.live} />
                </marker>
              </defs>
              {graph.edges.map((edge) => {
                const from = layout.positionById.get(edge.source);
                const to = layout.positionById.get(edge.target);
                if (!from || !to) return null;
                const isActive = activeSet.has(edge.source) && activeSet.has(edge.target);
                // Anchor at the right/left edges of the boxes when moving
                // forward in depth, else box-center — keeps arrows readable
                // without a full routing algorithm (deliberately simple, per
                // the "no fancy graph engine required" AC).
                const x1 = from.x + from.width;
                const y1 = from.y + from.height / 2;
                const x2 = to.x;
                const y2 = to.y + to.height / 2;
                return (
                  <EdgeArrow
                    key={edge.id}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    label={edge.eventLabel}
                    guard={edge.guardLabel}
                    isEventless={edge.isEventless}
                    isActive={isActive}
                  />
                );
              })}
            </svg>
            {layout.nodes.map(({ node, x, y, width, height }) => (
              <StateNodeBox
                key={node.id}
                n={node}
                x={x}
                y={y}
                width={width}
                height={height}
                isActive={activeSet.has(node.id)}
                isSelected={selectedId === node.id}
                onSelect={() => setSelectedId(node.id)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Per-state metadata detail panel — beside the graph when wide, wrapped
          BELOW it when narrow (its min-width floor is what forces the wrap). It
          does not grow past `maxWidth`, so a wide panel keeps the graph
          dominant rather than handing half the width to the detail list. */}
      <div
        data-testid="xstate-detail-panel"
        style={{
          flex: '1 1 240px',
          minWidth: 'min(240px, 100%)',
          maxWidth: 320,
          borderLeft: `1px solid ${COLORS.border}`,
          padding: spaceVar[5],
          overflowY: 'auto',
          fontSize: fontSizeVar.md,
        }}
      >
        <div
          style={{
            ...eyebrowStyle,
            display: 'flex',
            alignItems: 'center',
            gap: spaceVar[2],
            marginBottom: spaceVar[4],
          }}
        >
          <EditorIcon icon={faCircleInfo} />
          State detail
        </div>
        {!selectedNode ? (
          <div style={{ color: COLORS.dim }}>Click a state node to inspect its metadata.</div>
        ) : (
          <div data-testid="xstate-detail-content">
            <div
              style={{
                fontFamily: MONO,
                fontWeight: 600,
                fontSize: fontSizeVar.base,
                marginBottom: spaceVar[2],
                wordBreak: 'break-all',
              }}
            >
              {selectedNode.id}
            </div>
            <div
              style={{ color: COLORS.dim, fontSize: fontSizeVar.base, marginBottom: spaceVar[5] }}
            >
              {selectedNode.type}
              {selectedNode.isInitial ? ' · initial' : ''}
              {activeSet.has(selectedNode.id) ? (
                <span style={{ color: COLORS.live, fontWeight: 700, letterSpacing: 0.4 }}>
                  {' · ● '}ACTIVE
                </span>
              ) : (
                ''
              )}
            </div>

            <div>
              <div style={{ ...eyebrowStyle, marginBottom: spaceVar[2] }}>Outgoing transitions</div>
              {selectedEdges.length === 0 ? (
                <div style={{ color: COLORS.dim, fontSize: fontSizeVar.base }}>None.</div>
              ) : (
                selectedEdges.map((e) => (
                  <div key={e.id} style={{ marginBottom: 5, fontSize: fontSizeVar.base }}>
                    <span
                      style={{
                        fontFamily: MONO,
                        fontSize: fontSizeVar.sm,
                        color: COLORS.accent,
                        background: COLORS.panelBg,
                        border: `1px solid ${COLORS.innerBorder}`,
                        borderRadius: themeVars.shape.small,
                        padding: '1px 5px',
                      }}
                    >
                      {e.eventLabel}
                    </span>
                    <span style={{ color: COLORS.dim }}>{' → '}</span>
                    <span style={{ fontFamily: MONO, fontSize: fontSizeVar.sm }}>{e.target}</span>
                    {e.guardLabel && (
                      <div style={{ color: COLORS.guard, fontSize: fontSizeVar.sm, marginTop: 1 }}>
                        guard: <span style={{ fontFamily: MONO }}>{e.guardLabel}</span>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            {contextEntries.length > 0 && (
              <div style={{ marginTop: 14 }} data-testid="xstate-context-table">
                <div style={{ ...eyebrowStyle, marginBottom: 5 }}>Context</div>
                {contextEntries.map(([key, value]) => (
                  <div
                    key={key}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(70px, 1fr) minmax(60px, 1fr)',
                      gap: spaceVar[4],
                      padding: '3px 0',
                      borderBottom: `1px solid ${COLORS.innerBorder}`,
                      fontSize: fontSizeVar.sm,
                    }}
                  >
                    <span style={{ color: COLORS.dim }}>{key}</span>
                    <span
                      style={{ fontFamily: MONO, overflow: 'hidden', textOverflow: 'ellipsis' }}
                    >
                      {typeof value === 'string' ||
                      typeof value === 'number' ||
                      typeof value === 'boolean'
                        ? String(value)
                        : value == null
                          ? 'null'
                          : Array.isArray(value)
                            ? `${value.length} items`
                            : 'object'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
