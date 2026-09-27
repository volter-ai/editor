/**
 * The statechart's geometry: a `MachineDefinition` laid out by ELK's layered algorithm with
 * hierarchy (the layout Stately's own visualizer uses). States nest inside their parents, a
 * parallel state's regions stack, every compound state gets an initial dot and arrow, and each
 * transition is an edge from its source to its target routed across levels with its event as the
 * label. Everything comes back in ABSOLUTE coordinates for one SVG.
 */

import ELK from 'elkjs/lib/elk.bundled.js';
import type { MachineDefinition, MachineState, MachineTransition } from './machine-model';

export interface LaidOutState {
  readonly state: MachineState;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  /** A region of a parallel state (drawn dashed). */
  readonly region: boolean;
}

export interface LaidOutEdge {
  readonly id: string;
  /** `null` for an initial arrow. */
  readonly transition: MachineTransition | null;
  readonly target: string;
  readonly points: readonly { x: number; y: number }[];
  readonly label?: { readonly text: string; readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

export interface MachineLayout {
  readonly states: readonly LaidOutState[];
  readonly initials: readonly { readonly x: number; readonly y: number }[];
  readonly edges: readonly LaidOutEdge[];
  readonly width: number;
  readonly height: number;
}

interface ElkLabel { text: string; width: number; height: number; x?: number; y?: number }
interface ElkNode {
  id: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  children?: ElkNode[];
  edges?: ElkEdge[];
  labels?: ElkLabel[];
  layoutOptions?: Record<string, string>;
}
interface ElkEdge {
  id: string;
  sources: string[];
  targets: string[];
  labels?: ElkLabel[];
  container?: string;
  sections?: { startPoint: { x: number; y: number }; endPoint: { x: number; y: number }; bendPoints?: { x: number; y: number }[] }[];
}

const elk = new ELK();
const CHAR = 7;
const HEADER = 34;
const LINE = 15;
const INITIAL = 10;

const textWidth = (text: string): number => text.length * CHAR;

/** The lines a state box lists under its name: entry/exit actions and targetless transitions. */
export function stateLines(state: MachineState): string[] {
  const lines: string[] = [];
  if (state.entry.length) lines.push(`entry / ${state.entry.join(', ')}`);
  if (state.exit.length) lines.push(`exit / ${state.exit.join(', ')}`);
  for (const transition of state.transitions) {
    if (transition.targets.length === 0) lines.push(`${edgeText(transition)}${transition.actions.length ? ` / ${transition.actions.join(', ')}` : ''}`);
  }
  if (state.tags.length) lines.push(`tags: ${state.tags.join(', ')}`);
  return lines;
}

export function edgeText(transition: MachineTransition): string {
  const event =
    transition.kind === 'always' ? 'always' : transition.kind === 'after' ? `after ${transition.event}` : transition.kind === 'onDone' ? 'done' : transition.event;
  return transition.guard ? `${event} [${transition.guard}]` : event;
}

const nodeId = (id: string): string => `s:${id}`;

/** What the machine's own box is titled: the name the module gives it. */
export function machineTitle(machine: MachineDefinition): string {
  return machine.exportName ?? machine.machineId ?? 'machine';
}

function buildNode(state: MachineState, rootTitle: string): ElkNode {
  const lines = stateLines(state);
  const title = state.id === '' ? rootTitle : state.key;
  const minWidth = Math.max(textWidth(title) + 56, ...lines.map((line) => textWidth(line) + 24), 120);
  if (state.children.length === 0) {
    return {
      id: nodeId(state.id),
      width: Math.min(minWidth, 320),
      height: HEADER + lines.length * LINE + (lines.length ? 8 : 0),
    };
  }
  const children: ElkNode[] = state.children.map((child) => buildNode(child, rootTitle));
  if (state.kind === 'compound' && state.initial !== undefined) {
    children.unshift({
      id: `i:${state.id}`,
      width: INITIAL,
      height: INITIAL,
      // The initial dot leads its region, as every statechart draws it.
      layoutOptions: { 'elk.layered.layering.layerConstraint': 'FIRST' },
    });
  }
  const top = HEADER + lines.length * LINE + 6;
  return {
    id: nodeId(state.id),
    children,
    layoutOptions: {
      'elk.padding': `[top=${top},left=18,bottom=18,right=18]`,
      'elk.nodeSize.constraints': 'MINIMUM_SIZE',
      'elk.nodeSize.minimum': `(${Math.min(minWidth, 320)},${top + 30})`,
      'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
      ...(state.kind === 'parallel' ? { 'elk.direction': 'DOWN', 'elk.layered.spacing.nodeNodeBetweenLayers': '18' } : {}),
    },
  };
}

function collectEdges(state: MachineState, edges: ElkEdge[]): void {
  if (state.kind === 'compound' && state.initial !== undefined) {
    const initialId = state.id ? `${state.id}.${state.initial}` : state.initial;
    if (state.children.some((child) => child.id === initialId)) {
      edges.push({ id: `init:${state.id}`, sources: [`i:${state.id}`], targets: [nodeId(initialId)] });
    }
  }
  for (const transition of state.transitions) {
    transition.resolved.forEach((target, index) => {
      if (target === null) return;
      const text = edgeText(transition);
      edges.push({
        id: `t:${transition.id}:${index}`,
        sources: [nodeId(transition.source)],
        targets: [nodeId(target)],
        labels: [{ text, width: textWidth(text) + 12, height: 18 }],
      });
    });
  }
  for (const child of state.children) collectEdges(child, edges);
}

export async function layoutMachine(machine: MachineDefinition): Promise<MachineLayout> {
  const edges: ElkEdge[] = [];
  collectEdges(machine.root, edges);
  const graph: ElkNode = {
    id: '__graph',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.spacing.nodeNodeBetweenLayers': '70',
      'elk.spacing.nodeNode': '28',
      'elk.spacing.edgeNode': '16',
      'elk.spacing.edgeEdge': '10',
      'elk.spacing.edgeLabel': '4',
      'elk.layered.edgeLabels.sideSelection': 'ALWAYS_UP',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
      'elk.padding': '[top=24,left=24,bottom=24,right=24]',
    },
    children: [buildNode(machine.root, machineTitle(machine))],
    edges,
  };
  const result = (await elk.layout(graph as never)) as unknown as ElkNode;

  const absolute = new Map<string, { x: number; y: number }>();
  const states: LaidOutState[] = [];
  const initials: { x: number; y: number }[] = [];
  const byNode = new Map<string, MachineState>();
  const index = (state: MachineState): void => {
    byNode.set(nodeId(state.id), state);
    state.children.forEach(index);
  };
  index(machine.root);
  const walk = (node: ElkNode, offsetX: number, offsetY: number, depth: number, parent: MachineState | null): void => {
    const x = offsetX + (node.x ?? 0);
    const y = offsetY + (node.y ?? 0);
    absolute.set(node.id, { x, y });
    const state = byNode.get(node.id);
    if (state) {
      states.push({ state, x, y, width: node.width ?? 0, height: node.height ?? 0, depth, region: parent?.kind === 'parallel' });
    } else if (node.id.startsWith('i:')) {
      initials.push({ x: x + INITIAL / 2, y: y + INITIAL / 2 });
    }
    for (const child of node.children ?? []) walk(child, x, y, state ? depth + 1 : depth, state ?? parent);
  };
  absolute.set('__graph', { x: 0, y: 0 });
  for (const child of result.children ?? []) walk(child, 0, 0, 0, null);

  const transitions = new Map<string, MachineTransition>();
  const indexTransitions = (state: MachineState): void => {
    for (const transition of state.transitions) transitions.set(transition.id, transition);
    state.children.forEach(indexTransitions);
  };
  indexTransitions(machine.root);

  const laidEdges: LaidOutEdge[] = [];
  for (const edge of result.edges ?? []) {
    const origin = absolute.get(edge.container ?? '__graph') ?? { x: 0, y: 0 };
    const points: { x: number; y: number }[] = [];
    for (const section of edge.sections ?? []) {
      points.push(section.startPoint, ...(section.bendPoints ?? []), section.endPoint);
    }
    const shifted = points.map((point) => ({ x: point.x + origin.x, y: point.y + origin.y }));
    const transitionId = edge.id.startsWith('t:') ? edge.id.slice(2, edge.id.lastIndexOf(':')) : null;
    const label = edge.labels?.[0];
    laidEdges.push({
      id: edge.id,
      transition: transitionId ? (transitions.get(transitionId) ?? null) : null,
      target: (edge.targets[0] ?? '').slice(2),
      points: shifted,
      ...(label
        ? { label: { text: label.text, x: (label.x ?? 0) + origin.x, y: (label.y ?? 0) + origin.y, width: label.width, height: label.height } }
        : {}),
    });
  }
  return { states, initials, edges: laidEdges, width: result.width ?? 0, height: result.height ?? 0 };
}
