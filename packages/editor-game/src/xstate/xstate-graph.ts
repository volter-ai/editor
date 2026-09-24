/**
 * E3 (spec §11 E3) — pure, UI-free extraction of a renderable node/edge graph
 * from a real XState v5 machine. No separate graph format is persisted
 * anywhere (E3's own AC): this module reads `machine.root` (a `StateNode`) and
 * its `.states`/`.on`/ `.always` directly, every time it's called —
 * the "graph" is just a derived view, recomputed from the live machine
 * configuration.
 *
 * ## Which xstate v5 accessors this uses, and why
 *
 * Confirmed against the installed `xstate@5.32.4` (`node_modules/xstate/dist/
 * declarations/src/StateNode.d.ts`) and by instrumenting the real
 * `characterAnimationMachine` (examples/third-person/src/components.ts) at
 * runtime:
 *
 * - `StateNode.states: Record<string, StateNode>` — child state nodes,
 *   walked recursively for nested/compound machines. Absent (`{}`) on atomic
 *   leaves.
 * - `StateNode.id` — the full dotted id (e.g. `"character-animation.idle"`),
 *   used as this module's node id throughout (stable, globally unique within
 *   one machine).
 * - `StateNode.on: TransitionDefinitionMap` — a `Record<eventType,
 *   TransitionDefinition[]>` of this state's OWN event-triggered transitions
 *   (does NOT include ancestor/root `on` handlers with no target on this
 *   node, and does NOT include `always` — confirmed by probing the real
 *   machine: `idle.on` has only `JUMP`, not the root-level `UPDATE`).
 * - `StateNode.always: TransitionDefinition[] | undefined` — eventless
 *   ("always"/guarded-every-microstep) transitions, kept SEPARATE from `.on`
 *   by xstate itself; each has `eventType: ''`. Rendered as edges labeled
 *   "always" rather than an event name.
 * - `TransitionDefinition.target: readonly StateNode[] | undefined` —
 *   resolved target state node(s) (already-resolved, not a string to
 *   re-parse); `undefined` for an internal/actionless transition (no target
 *   state change) — those are skipped as edges (nothing to point an arrow at).
 * - `TransitionDefinition.guard` — a string (named guard), a `{type, params}`
 *   object (parameterized named guard), or a plain predicate function
 *   (`(args, params) => boolean`, the common case for hand-authored
 *   machines like `characterAnimationMachine`, which uses inline
 *   `({ context }) => context.speed > 0.1` arrows). `guardLabel` below
 *   normalizes all three to a short display string.
 * - `StateNode.type: 'atomic' | 'compound' | 'parallel' | 'final' |
 *   'history'` — surfaced per node so the panel can show it (a compound/
 *   parallel state has children; the graph still renders it as its own node
 *   PLUS its children as separate nodes with a parent edge implied by
 *   nesting depth, not a literal drawn edge).
 *
 * No `getStateNodes()` call is needed here: that xstate helper resolves the
 * set of state nodes ACTIVE for one `StateValue` (a snapshot-shaped query).
 * This module wants the machine's full STATIC configuration (every declared
 * state, reachable or not, active or not) — a plain recursive walk of
 * `.states` from `machine.root` is the correct and sufficient tool for that.
 */

import type { AnyStateMachine, AnyStateNode, StateValue } from 'xstate';
import { getStateNodes } from 'xstate';

export interface XStateGraphNode {
  /** Full dotted state id, e.g. `"character-animation.locomotion"`. */
  id: string;
  /** The relative key, e.g. `"locomotion"`. */
  key: string;
  /** Dotted id of the immediate parent state node, or `null` for the root. */
  parentId: string | null;
  /** Depth from the root (root = 0), used by the layered layout. */
  depth: number;
  type: 'atomic' | 'compound' | 'parallel' | 'final' | 'history';
  /** True for the machine's single configured initial leaf-path state at each level. */
  isInitial: boolean;
}

export interface XStateGraphEdge {
  /** Stable synthetic id for React `key` props: `${source}--${eventLabel}--${target}--${index}`. */
  id: string;
  source: string;
  target: string;
  /** The triggering event name, or `'always'` for eventless transitions. */
  eventLabel: string;
  /** `true` for an `always` (eventless) transition. */
  isEventless: boolean;
  /** Normalized guard display label, or `undefined` when the transition is unguarded. */
  guardLabel: string | undefined;
}

export interface XStateGraph {
  machineId: string;
  nodes: XStateGraphNode[];
  edges: XStateGraphEdge[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Normalize an xstate v5 `TransitionDefinition['guard']` to a short display
 * label. Handles the three shapes xstate allows (confirmed above):
 *  - a string → the guard name verbatim (`"someNamedGuard"`).
 *  - a `{ type, params? }` object → `.type` (a parameterized named guard).
 *  - a function → its `.name` when xstate/JS gave it a real one (property-
 *    shorthand functions like `guard: someNamedFn` keep their declared name),
 *    otherwise (the common inline-arrow case, e.g.
 *    `({ context }) => context.speed > 0.1`) fall back to a truncated
 *    `.toString()` of the function body so the condition is still legible
 *    rather than showing a useless generic "guard" (xstate's own destructured-
 *    param naming quirk: an arrow assigned to an object property named
 *    `guard` is named `"guard"` by the JS engine itself, which conveys
 *    nothing — confirmed by probing the real `characterAnimationMachine`).
 */
export function guardLabel(guard: unknown): string | undefined {
  if (guard == null) return undefined;
  if (typeof guard === 'string') return guard;
  if (typeof guard === 'function') {
    const name = guard.name;
    if (name && name !== 'guard' && name !== 'anonymous') return name;
    const src = guard.toString().replace(/\s+/g, ' ').trim();
    return src.length > 60 ? `${src.slice(0, 57)}...` : src;
  }
  if (isPlainObject(guard) && typeof guard['type'] === 'string') {
    return guard['type'];
  }
  return '(guard)';
}

/** Every dotted-id descendant state node of `node`, depth-first, including `node` itself. */
function* walkStateNodes(
  node: AnyStateNode,
  parentId: string | null,
  depth: number,
): Generator<{
  node: AnyStateNode;
  parentId: string | null;
  depth: number;
}> {
  yield { node, parentId, depth };
  for (const child of Object.values(node.states)) {
    yield* walkStateNodes(child, node.id, depth + 1);
  }
}

/** True iff `node` is the configured initial child of its parent (root-relative; always true for the root itself). */
function isInitialChild(node: AnyStateNode): boolean {
  const parent = node.parent;
  if (!parent) return true;
  if (parent.type !== 'compound') return false; // parallel/atomic parents have no single "initial" child
  return parent.initial?.target?.some((t) => t.id === node.id) ?? false;
}

/**
 * One state node's outgoing edges: its own event-triggered (`on`) transitions
 * plus its eventless (`always`) transitions — kept as a separate helper from
 * {@link buildXStateGraph} purely to keep that function's cognitive
 * complexity low; the logic is unchanged from a single inline loop.
 */
function edgesFromNode(node: AnyStateNode, nextEdgeId: () => number): XStateGraphEdge[] {
  const edges: XStateGraphEdge[] = [];
  for (const [eventType, defs] of Object.entries(node.on)) {
    for (const def of defs) {
      for (const target of def.target ?? []) {
        edges.push({
          id: `${node.id}--${eventType}--${target.id}--${nextEdgeId()}`,
          source: node.id,
          target: target.id,
          eventLabel: eventType,
          isEventless: false,
          guardLabel: guardLabel(def.guard),
        });
      }
    }
  }
  for (const def of node.always ?? []) {
    for (const target of def.target ?? []) {
      edges.push({
        id: `${node.id}--always--${target.id}--${nextEdgeId()}`,
        source: node.id,
        target: target.id,
        eventLabel: 'always',
        isEventless: true,
        guardLabel: guardLabel(def.guard),
      });
    }
  }
  return edges;
}

/**
 * Extract a renderable {@link XStateGraph} from a real XState machine.
 * Accepts `AnyStateMachine` (what `setup(...).createMachine(...)` and
 * `createMachine(...)` both return) — works for the shipped
 * `characterAnimationMachine` and any other hand-authored machine.
 *
 * Animation metadata is intentionally absent: this graph represents behavior
 * statechart structure only. Animation playback has its own native-runtime
 * projection in the Animation workspace.
 */
export function buildXStateGraph(machine: AnyStateMachine): XStateGraph {
  const root = machine.root;

  const nodes: XStateGraphNode[] = [];
  const edges: XStateGraphEdge[] = [];
  let edgeSeq = 0;
  const nextEdgeId = () => edgeSeq++;

  for (const { node, parentId, depth } of walkStateNodes(root, null, 0)) {
    nodes.push({
      id: node.id,
      key: node.key,
      parentId,
      depth,
      type: node.type,
      isInitial: isInitialChild(node),
    });
    edges.push(...edgesFromNode(node, nextEdgeId));
  }

  return { machineId: root.id, nodes, edges };
}

/**
 * The full state ids XState reports as ACTIVE for a given snapshot value —
 * every ancestor plus the leaf (e.g. a snapshot in `"locomotion"` reports
 * both `"character-animation"` and `"character-animation.locomotion"`).
 *
 * Uses xstate's own `getStateNodes(rootNode, stateValue)` (`xstate` package
 * root export, confirmed present in the installed v5.32.4 and exercised
 * directly against a real machine) rather than `snapshot.getMeta()` —
 * `getMeta()` only returns states that declare a `meta` object at all
 * (confirmed by probing a real machine: a meta-less compound ancestor is
 * silently absent from `getMeta()`'s keys even while active), which would
 * under-highlight the graph for any machine with meta-less parent/compound
 * states. `getStateNodes` returns the complete active set regardless of
 * whether a node has `meta`.
 */
export function activeStateIdsOf(machine: AnyStateMachine, stateValue: StateValue): string[] {
  return getStateNodes(machine.root, stateValue).map((n) => n.id);
}
