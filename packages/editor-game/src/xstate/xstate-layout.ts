/**
 * E3 — a deterministic, dependency-free layered layout for an
 * {@link XStateGraph}. No graph-layout library exists in this repo (checked:
 * no reactflow/dagre/elkjs/d3 in `packages/editor/package.json` or the root
 * manifest) and the spec explicitly says a fancy graph engine is not
 * required ("a simple deterministic layout is fine — grid/columns by depth").
 *
 * Layout rule: one COLUMN per state-tree depth (root=0, its children=1,
 * grandchildren=2, …) — this both (a) reads naturally for the shallow
 * behavior machines (§5.6's examples are 1-2 levels
 * deep) and (b) guarantees a parent is always positioned before/left-of its
 * children, which keeps nesting legible even before any edges are drawn.
 * Within a column, nodes are stacked top-to-bottom in the machine's own
 * declaration order (`StateNode.order` is xstate's own deterministic
 * document-order counter) — so the layout is 100% a pure function of the
 * machine, not randomized/force-simulated, and is stable across renders
 * (required for a sane React key/position diff and for tests to assert
 * exact pixel positions).
 */

import type { XStateGraph, XStateGraphNode } from './xstate-graph';

export interface LayoutNode {
  node: XStateGraphNode;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface XStateLayout {
  nodes: LayoutNode[];
  positionById: Map<string, LayoutNode>;
  width: number;
  height: number;
}

const COLUMN_WIDTH = 220;
const COLUMN_GAP = 100;
const ROW_HEIGHT = 64;
const ROW_GAP = 24;
const NODE_WIDTH = 180;
const MARGIN = 24;

/** Lay out a graph's nodes into depth-based columns, declaration order within each column. */
export function layoutXStateGraph(graph: XStateGraph): XStateLayout {
  const byDepth = new Map<number, XStateGraphNode[]>();
  for (const node of graph.nodes) {
    const bucket = byDepth.get(node.depth);
    if (bucket) bucket.push(node);
    else byDepth.set(node.depth, [node]);
  }

  const nodes: LayoutNode[] = [];
  const positionById = new Map<string, LayoutNode>();
  let maxDepth = 0;
  let maxRows = 0;

  for (const [depth, column] of byDepth) {
    maxDepth = Math.max(maxDepth, depth);
    maxRows = Math.max(maxRows, column.length);
    const x = MARGIN + depth * (COLUMN_WIDTH + COLUMN_GAP);
    column.forEach((node, row) => {
      const y = MARGIN + row * (ROW_HEIGHT + ROW_GAP);
      const laidOut: LayoutNode = { node, x, y, width: NODE_WIDTH, height: ROW_HEIGHT };
      nodes.push(laidOut);
      positionById.set(node.id, laidOut);
    });
  }

  const width = MARGIN * 2 + (maxDepth + 1) * COLUMN_WIDTH + maxDepth * COLUMN_GAP;
  const height =
    MARGIN * 2 + Math.max(1, maxRows) * ROW_HEIGHT + Math.max(0, maxRows - 1) * ROW_GAP;

  return { nodes, positionById, width, height };
}
