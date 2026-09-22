/**
 * THE NODE EDITOR — Blender's Shader Editor, READ-ONLY, over the active
 * material's RNA node tree (WORK.md §Blender in the tab is Blender,
 * "Inspection parity", I5; ARCHITECTURE-CORE §Blender north star).
 *
 * OUR PANEL, BLENDER'S DRAWING. Blender's own UI layer — `bl_ui`, the node
 * editor's C++ drawing code — is never run, ported as a UI system, or
 * recorded here. It is READ as the specification of what to draw, and every
 * number it specifies lives in `./blender-node-geometry.ts` with its file and
 * line beside it. This module is an ordinary React component over that data.
 *
 * INSPECTION PARITY, NOT EDITING PARITY. Nothing here writes. A gesture that
 * WOULD edit — dragging a node, dragging a link, typing into a socket's value
 * — is refused BY NAME in the frame's status line rather than quietly doing
 * nothing, which is the ruling's own "never a silent degrade". The only state
 * this view owns is INSPECTION state: which node is looked at, and where the
 * view is panned. Selecting a node here does not write `Node.select` in the
 * engine (that would be a mutation the document saves); the ENGINE's own
 * selection is still drawn, in Blender's own selected outline.
 *
 * WHY SVG AND NOT CANVAS 2D. The tree is a few dozen rounded rects, circles
 * and cubics, and SVG gives three things a 2D context would have to
 * reimplement: the browser's own `C` path segment for `node_link_bezier`'s
 * cubic, real text layout and measurement for the header labels, and hit
 * testing for free on every node and socket. The measured tree this unit was
 * built against is 2 nodes and 37 sockets; a pathological 200-node tree is
 * ~1,200 elements, which is inside what a browser lays out in one frame. The
 * moment a tree is measured slow, the answer is a canvas with the same
 * geometry module behind it — which is why the geometry lives in its own
 * module and this file holds no constants.
 *
 * WHY IT IS THE DRAWER AND NOT A SECOND DOCUMENT. Blender's Shading workspace
 * puts the Shader Editor in the AREA BELOW the 3D viewport, and this host's
 * bottom group (`vgai:bottom-center`) is that area: the Model workspace hides
 * it for exactly this reason, recorded in `workspace-regions.ts` — "Blender's
 * modeling workspace has no timeline strip". The Shading workspace shows it
 * and puts this in it.
 */

import type { BlenderNode, BlenderNodeTree } from '@volter/blender-engine/browser/rna';
import { registerViewVerbs } from '@volter/editor-sdk/views';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  blenderNodeTree,
  blenderRnaVersion,
  NODE_VIEW_VERBS,
  subscribeBlenderRna,
} from '../host/blender-runtime-host';
import type { NodeViewTransform } from '../src/node-view-state';
import {
  nodeViewAllRequest,
  nodeViewState,
  nodeViewVersion,
  refuseNodeViewGesture,
  setNodeViewState,
  subscribeNodeView,
} from '../src/node-view-state';
import nodePanelTable from './blender.node-panels.json';
import {
  BASIS_RAD,
  declarationAgrees,
  FRAME_MARGIN,
  type LaidOutNode,
  type LaidOutPanel,
  type LaidOutSocket,
  LINK_WIDTH,
  layoutHasUnreadableRow,
  layoutNode,
  layoutNodeWithPanels,
  linkHandles,
  MUTED_ALPHA_DROP,
  MUTED_BODY_FACTOR,
  MUTED_HEADER_FACTOR,
  mutedToward,
  NODE_DETAIL_ZOOM_MIN,
  NODE_DY,
  NODE_DYS,
  NODE_FILL_PADDING,
  NODE_FILL_RADIUS,
  NODE_HEADER_ICON_SIZE,
  NODE_MARGIN_X,
  NODE_OUTLINE_RADIUS,
  NODE_SOCKSIZE,
  NODE_THEME,
  type NodeDeclaration,
  nodeBodyColor,
  nodeHeaderColor,
  PANEL_HEADER_BUT_PADDING,
  PANEL_HEADER_MARGIN_X,
  PANEL_SUB_BACK,
  PANEL_SUB_BACK_ALPHA,
  PANEL_TRIANGLE,
  PIXEL_SIZE,
  REROUTE_RADIUS,
  rgbFloatsToHex,
  SOCKET_OUTLINE,
  SOCKET_OUTLINE_VIRTUAL,
  SOCKET_OUTLINE_WIDTH,
  socketColor,
  socketDraws,
  UI_TEXT_POINTS,
  UI_UNIT_X,
} from './blender-node-geometry';

export const point = 'workspace.document';
/** Blender's own name for this editor (`rna_space.cc`'s `SPACE_NODE` item and
 *  the editor-type menu): "Shader Editor" for a `ShaderNodeTree`. */
export const title = 'Shader Editor';

// THE VIEW'S PRODUCT DOOR (WORK.md §The core is Code-OSS U8, ruling 1). This
// view's verbs are published ONCE, here, where the view itself is contributed:
// under the Code-OSS frame each becomes a `vgai.blender-node-view.<verb>`
// command the bridge dispatches into the view, and standalone `vgai edit` —
// which has no command service — reaches the SAME table through the session's
// `blender-node-view` verb. One table, two doors, which is why the remaining
// read-only editors (UV Editing, Animation, Texture Paint) add no session verb
// of their own: they register here instead.
// THIS LINE RUNS ONCE PER EVALUATION, and a contribution is evaluated more
// than once per session by design — the tool loader imports it as
// `?t=<version>`, so a save re-evaluates it against a registry that already
// holds the view. `registerViewVerbs` recognises the re-evaluation and the
// newer table wins; measured live 2026-09-19, before it did, the first reload
// threw and the loader reported "editor app failed to start", taking the whole
// editor down with the view.
registerViewVerbs(NODE_VIEW_VERBS);

/** The N-panel's width. `bl_ui` sizes a sidebar in `UI_UNIT_X`; the node
 *  editor's sidebar opens at the region default, measured in Blender 5.2 at
 *  ~16 units. */
const SIDEBAR_WIDTH = 16 * 20;

/** One unit of tree space per CSS px is Blender's zoom 1 — the node editor
 *  draws without DPI (`node_intern.hh:332`). */
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 4;

type View = NodeViewTransform;

export default function BlenderNodeEditor() {
  // THE TREE'S FRESHNESS IS THE TREE'S, NOT THE PRESENTED FRAME'S (ruling 3,
  // 2026-09-19). This used to read the properties model's version, which moves
  // on a presented frame — and collapsing a socket panel writes
  // `Node.panel_states[n].is_collapsed`, which presents NOTHING, so the view
  // kept drawing the old tree until the document was reopened (measured by the
  // socket-panel step that shipped the panels). `blenderRnaVersion` is the RNA
  // door's own, bumped by the write, and a frame bumps it too.
  const version = useSyncExternalStore(subscribeBlenderRna, blenderRnaVersion, blenderRnaVersion);
  const [tree, setTree] = useState<BlenderNodeTree | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canvas = useRef<HTMLDivElement | null>(null);
  const framed = useRef(false);
  // THE VIEW'S STATE IS THE STORE'S (`../src/node-view-state.ts`), not this
  // component's, because the session verb `blender-node-view` has to reach it:
  // `editor.document.*` is scoped to the active CENTER document and a drawer
  // utility is not one, so a `useState` here would be a surface nothing in the
  // product could read or drive.
  useSyncExternalStore(subscribeNodeView, nodeViewVersion, nodeViewVersion);
  const { transform: view, looked, refusal, size } = nodeViewState();
  const setView = useCallback((next: View | ((current: View) => View)): void => {
    const current = nodeViewState().transform;
    setNodeViewState({ transform: typeof next === 'function' ? next(current) : next });
  }, []);
  const setLooked = useCallback((node: string | null): void => {
    setNodeViewState({ looked: node, refusal: null });
  }, []);
  const setSize = useCallback((next: { w: number; h: number }): void => {
    const current = nodeViewState().size;
    if (current.w === next.w && current.h === next.h) return;
    setNodeViewState({ size: next });
  }, []);
  const refuse = useCallback((text: string) => {
    refuseNodeViewGesture(text);
  }, []);

  // THE READ. The properties model already re-reads on every presented frame
  // and on every selection change, so its version is exactly the signal "the
  // engine moved"; taking it costs no second frame subscription.
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const answer = await blenderNodeTree();
        if (!live) return;
        setTree(answer);
        setError(null);
      } catch (thrown) {
        if (!live) return;
        setError(thrown instanceof Error ? thrown.message : String(thrown));
      }
    })();
    return () => {
      live = false;
    };
  }, [version]);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      setSize({ w: element.clientWidth, h: element.clientHeight });
    });
    observer.observe(element);
    setSize({ w: element.clientWidth, h: element.clientHeight });
    return () => observer.disconnect();
  }, []);

  const laid = useMemo(() => layoutTree(tree), [tree]);

  // PUBLISH WHAT WAS DRAWN. The parity table is read off this, so it measures
  // the shipped drawing rather than re-running the same arithmetic beside it.
  useEffect(() => {
    setNodeViewState({
      drawn: [...laid.frames, ...laid.nodes].map(({ node, laid: box, panels, fallback }) => {
        const first = box.sockets.find((socket) => !socket.panelCollapsed) ?? box.sockets[0];
        return {
          panels: panels.length,
          collapsedPanels: panels.filter((panel) => panel.collapsed).length,
          panelFallback: fallback,
          name: node.name,
          x: box.x,
          yTop: box.yTop,
          yBottom: box.yBottom,
          width: box.width,
          height: box.yTop - box.yBottom,
          sockets: box.sockets.length,
          firstSocketBelowTop: first ? box.yTop - first.y : null,
          header: nodeHeaderColor(node),
        };
      }),
    });
  }, [laid]);

  const viewAll = useCallback(() => {
    const bounds = treeBounds(laid.nodes);
    if (!bounds) return;
    // `NODE_OT_view_all` pads the fitted bounds; the node editor's own
    // `space_node.cc` uses one `NODE_DY` of margin on each side.
    const zoom = clamp(
      Math.min(size.w / (bounds.w + 2 * NODE_DY), size.h / (bounds.h + 2 * NODE_DY)),
      ZOOM_MIN,
      ZOOM_MAX,
    );
    setNodeViewState({
      transform: { cx: bounds.x + bounds.w / 2, cy: bounds.y - bounds.h / 2, zoom },
      framedAt: Date.now(),
    });
  }, [laid.nodes, size.h, size.w]);

  // A `blender-node-view` `view-all` — the session's Home. Framing needs the
  // LAID-OUT tree, which only this component has, so the store raises an ask
  // and the view answers it.
  const viewAllAsk = nodeViewAllRequest();
  const answered = useRef(0);
  useEffect(() => {
    if (viewAllAsk === answered.current) return;
    answered.current = viewAllAsk;
    viewAll();
  }, [viewAllAsk, viewAll]);

  // Blender's node editor opens on View All when a tree is first shown
  // (`node_view.cc`'s `NODE_OT_view_all`, which the space runs on a fresh
  // region). Once a person has panned, it never re-frames under them.
  useEffect(() => {
    if (framed.current || laid.nodes.length === 0 || size.w <= 1) return;
    framed.current = true;
    viewAll();
  }, [laid.nodes.length, size.w, viewAll]);

  const panning = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    // Blender pans the node editor with MMB drag (`view2d.cc`'s
    // `VIEW2D_OT_pan`, bound to `MIDDLEMOUSE` in the default keymap).
    if (event.button !== 1) return;
    event.preventDefault();
    (event.target as Element).setPointerCapture?.(event.pointerId);
    panning.current = { x: event.clientX, y: event.clientY, cx: view.cx, cy: view.cy };
  };
  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const start = panning.current;
    if (!start) return;
    setView((current) => ({
      ...current,
      cx: start.cx - (event.clientX - start.x) / current.zoom,
      cy: start.cy + (event.clientY - start.y) / current.zoom,
    }));
  };
  const endPan = () => {
    panning.current = null;
  };
  const onWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    setView((current) => ({
      ...current,
      zoom: clamp(current.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1), ZOOM_MIN, ZOOM_MAX),
    }));
  };

  const lookedNode = tree?.nodes.find((node) => node.name === looked) ?? null;
  const details = view.zoom > NODE_DETAIL_ZOOM_MIN;

  return (
    <div
      data-testid="blender-node-editor"
      style={{
        display: 'flex',
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 }}>
        <NodeEditorHeader tree={tree} zoom={view.zoom} onViewAll={viewAll} onRefuse={refuse} />
        {/* THE CANVAS BOX. Its height comes from FLEX, never from its own
            content: a `height: 100%` SVG inside an auto-height parent makes
            the parent's height a function of the SVG's, which is a function
            of the parent's — measured live 2026-09-19, that loop settled at
            ~30 px and drew the whole tree in a sliver at 31 % zoom. */}
        <div ref={canvas} style={{ position: 'relative', flex: 1, minHeight: 0 }}>
          <svg
            role="presentation"
            width="100%"
            height="100%"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endPan}
            onPointerCancel={endPan}
            onWheel={onWheel}
            onContextMenu={(event) => {
              event.preventDefault();
              refuse('The node context menu adds, deletes and reconnects nodes — editing.');
            }}
            style={{
              display: 'block',
              // `draw_background_color`: TH_BACK's RGB with a hard 1.0 alpha
              // (`node_draw.cc:4713-4718`).
              background: NODE_THEME.background,
              cursor: 'default',
              // Blender's dot grid is theme `grid` #303030 at alpha ZERO
              // (`userdef_default_theme.c:661`), so a stock node editor shows NO
              // grid at all. Drawing one would be a mark the reference does not
              // make.
            }}
          >
            <g
              transform={`translate(${size.w / 2} ${size.h / 2}) scale(${view.zoom} ${-view.zoom}) translate(${-view.cx} ${-view.cy})`}
            >
              {/* Frames are drawn BEHIND their children (`node_draw_nodetree`
                walks frames first, `node_draw.cc:4285-4345`). */}
              {laid.frames.map((frame) => (
                <FrameNode key={frame.node.name} node={frame.node} laid={frame.laid} />
              ))}
              {laid.links.map((link) => (
                <Noodle key={link.key} link={link} />
              ))}
              {laid.nodes.map((entry) => (
                <NodeBody
                  key={entry.node.name}
                  node={entry.node}
                  laid={entry.laid}
                  panels={entry.panels}
                  looked={entry.node.name === looked}
                  details={details}
                  onLook={() => setLooked(entry.node.name)}
                  onRefuse={refuse}
                />
              ))}
            </g>
          </svg>
        </div>
        <StatusLine entries={laid.nodes} error={error} refusal={refusal} />
      </div>
      <NodePanel node={lookedNode} onRefuse={refuse} />
    </div>
  );
}

const HEADER_HEIGHT = 26;
const STATUS_HEIGHT = 22;

/* -------------------------------------------------------------------------- */

interface LaidLink {
  readonly key: string;
  readonly from: readonly [number, number];
  readonly to: readonly [number, number];
  readonly fromColor: string;
  readonly toColor: string;
  readonly muted: boolean;
  readonly valid: boolean;
}

/**
 * THE TRACED DECLARATIONS — `blender.node-panels.json`, generated by
 * `blender-node-panels.source.mjs` from Blender's own `declare()` bodies at
 * the engine's pin. 36 node types, the only ones that declare a socket panel;
 * every other node's flattened item list IS its socket list, which is what
 * `layoutNode` already draws.
 */
const DECLARATIONS = nodePanelTable as Readonly<Record<string, NodeDeclaration>>;

interface LaidEntry {
  readonly node: BlenderNode;
  readonly laid: LaidOutNode;
  readonly panels: readonly LaidOutPanel[];
  /** Why this node's panels were NOT drawn, when it declares some. Named in
   *  the status line rather than silently drawn flat. */
  readonly fallback: string | null;
  /** The node carries a declaration LAYOUT row, whose drawn height RNA cannot
   *  answer (see `layoutNodeWithPanels`' header). */
  readonly approximate: boolean;
}

function layoutTree(tree: BlenderNodeTree | null): {
  nodes: LaidEntry[];
  frames: LaidEntry[];
  links: LaidLink[];
} {
  if (!tree) return { nodes: [], frames: [], links: [] };
  const placed = new Map<string, LaidOutNode>();
  const entries = tree.nodes.map((node): LaidEntry => {
    const flat = {
      name: node.name,
      location: node.location,
      width: node.width,
      collapsed: node.collapsed,
      inputs: node.inputs,
      outputs: node.outputs,
    };
    // A COLLAPSED node draws no body at all, so its panels are not a question
    // (`node_update_collapsed` never walks the declaration).
    const declaration = node.collapsed ? undefined : DECLARATIONS[node.idname];
    if (node.panelCount > 0 && !declaration) {
      const laid = layoutNode(flat);
      placed.set(node.name, laid);
      return {
        node,
        laid,
        panels: [],
        fallback: node.collapsed
          ? null
          : 'no traced declaration — the trace covers the 36 node types that declare a panel in Blender 5.2.0, and a node group’s panels are runtime data',
        approximate: false,
      };
    }
    if (declaration) {
      const agrees = declarationAgrees(declaration, node.inputs, node.outputs);
      if (agrees.ok) {
        const laid = layoutNodeWithPanels({
          ...flat,
          declaration,
          panelStates: node.panels,
          showOptions: node.showOptions,
        });
        placed.set(node.name, laid);
        return {
          node,
          laid,
          panels: laid.panels,
          fallback: null,
          approximate: layoutHasUnreadableRow(declaration),
        };
      }
      const laid = layoutNode(flat);
      placed.set(node.name, laid);
      return { node, laid, panels: [], fallback: agrees.why, approximate: false };
    }
    const laid = layoutNode(flat);
    placed.set(node.name, laid);
    return { node, laid, panels: [], fallback: null, approximate: false };
  });
  const links: LaidLink[] = tree.links.flatMap((link, index) => {
    const from = placed.get(link.fromNode);
    const to = placed.get(link.toNode);
    if (!from || !to) return [];
    const fromSocket = from.sockets.find((s) => s.output && s.identifier === link.fromSocket);
    const toSocket = to.sockets.find((s) => !s.output && s.identifier === link.toSocket);
    if (!fromSocket || !toSocket) return [];
    return [
      {
        key: `${link.fromNode}.${link.fromSocket}→${link.toNode}.${link.toSocket}#${index}`,
        from: [fromSocket.x, fromSocket.y] as const,
        to: [toSocket.x, toSocket.y] as const,
        fromColor: socketColor(fromSocket.type),
        toColor: socketColor(toSocket.type),
        muted: link.muted,
        valid: link.valid,
      },
    ];
  });
  return {
    nodes: entries.filter((entry) => entry.node.idname !== 'NodeFrame'),
    frames: entries.filter((entry) => entry.node.idname === 'NodeFrame'),
    links,
  };
}

function treeBounds(
  entries: readonly { laid: LaidOutNode }[],
): { x: number; y: number; w: number; h: number } | null {
  if (entries.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const { laid } of entries) {
    minX = Math.min(minX, laid.x);
    maxX = Math.max(maxX, laid.x + laid.width);
    minY = Math.min(minY, laid.yBottom);
    maxY = Math.max(maxY, laid.yTop);
  }
  return { x: minX, y: maxY, w: maxX - minX, h: maxY - minY };
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/* -------------------------------------------------------------------------- */

function NodeBody({
  node,
  laid,
  panels,
  looked,
  details,
  onLook,
  onRefuse,
}: {
  readonly node: BlenderNode;
  readonly laid: LaidOutNode;
  readonly panels: readonly LaidOutPanel[];
  readonly looked: boolean;
  readonly details: boolean;
  readonly onLook: () => void;
  readonly onRefuse: (text: string) => void;
}) {
  // A REROUTE is one socket and nothing else (`reroute_node_prepare_for_draw`,
  // `node_draw.cc:3579-3593`).
  if (node.type === 'REROUTE') {
    const socket = laid.sockets[0];
    return (
      <circle
        cx={laid.x}
        cy={laid.yTop}
        r={REROUTE_RADIUS}
        fill={socket ? socketColor(socket.type) : NODE_THEME.wireInner}
        stroke={SOCKET_OUTLINE}
        strokeWidth={SOCKET_OUTLINE_WIDTH}
        onPointerDown={(event) => {
          if (event.button === 0) onLook();
        }}
      />
    );
  }

  const header = node.muted
    ? mutedToward(nodeHeaderColor(node), MUTED_HEADER_FACTOR)
    : nodeHeaderColor(node);
  const body = node.muted
    ? mutedToward(nodeBodyColor(node), MUTED_BODY_FACTOR)
    : nodeBodyColor(node);
  // `get_color_blend_alpha_4fv(…, -0.2)` — a muted node is drawn slightly
  // transparent "so the wires inside are visible" (`node_draw.cc:2806-2814`).
  const alpha = node.muted ? 1 - MUTED_ALPHA_DROP : 1;
  const outline = node.selected
    ? node.activeOutput || looked
      ? NODE_THEME.active
      : NODE_THEME.select
    : NODE_THEME.outline;
  const outlineOpacity = node.selected ? 1 : NODE_THEME.outlineAlpha;
  const height = laid.yTop - laid.yBottom;
  const label = node.label ?? node.typeLabel;

  return (
    <g
      opacity={alpha}
      onPointerDown={(event) => {
        if (event.button === 0) onLook();
      }}
      onDoubleClick={() =>
        onRefuse(`Renaming "${node.name}" writes Node.name — editing parity is not the program.`)
      }
      style={{ cursor: 'default' }}
    >
      {laid.collapsed ? (
        // The collapsed node is ONE rounded box in the HEADER colour
        // (`node_draw.cc:3258-3276`), not a header over a body.
        <rect
          x={laid.x - NODE_FILL_PADDING}
          y={-laid.yTop - NODE_FILL_PADDING}
          width={laid.width + 2 * NODE_FILL_PADDING}
          height={height + 2 * NODE_FILL_PADDING}
          rx={NODE_FILL_RADIUS}
          fill={header}
          transform="scale(1 -1)"
        />
      ) : (
        <>
          {/* Body: `{xmin-p, xmax+p, ymin-p, ymax-NODE_DY+p}`, bottom corners
              rounded (`node_draw.cc:3167-3180`). */}
          <rect
            x={laid.x - NODE_FILL_PADDING}
            y={-(laid.yTop - NODE_DY) - NODE_FILL_PADDING}
            width={laid.width + 2 * NODE_FILL_PADDING}
            height={height - NODE_DY + 2 * NODE_FILL_PADDING}
            rx={NODE_FILL_RADIUS}
            fill={body}
            transform="scale(1 -1)"
          />
          {/* Header: `{xmin-p, xmax+p, ymax-NODE_DY-p, ymax+p}`, top corners
              rounded (`node_draw.cc:2925-2935`). Both are drawn as full
              round-rects and the outline covers the seam, which is what
              Blender's two corner-set calls amount to at this radius. */}
          <rect
            x={laid.x - NODE_FILL_PADDING}
            y={-laid.yTop - NODE_FILL_PADDING}
            width={laid.width + 2 * NODE_FILL_PADDING}
            height={NODE_DY + 2 * NODE_FILL_PADDING}
            rx={NODE_FILL_RADIUS}
            fill={header}
            transform="scale(1 -1)"
          />
          <rect
            x={laid.x - NODE_FILL_PADDING}
            y={-(laid.yTop - NODE_DY) - NODE_FILL_PADDING}
            width={laid.width + 2 * NODE_FILL_PADDING}
            height={BASIS_RAD}
            fill={header}
            transform="scale(1 -1)"
          />
          {/* PANEL BACKGROUNDS FIRST — `node_draw_panels_background` runs
              before every other node element "so other node elements can be
              rendered on top" (`node_draw.cc:1913-1914, 3183`). */}
          {panels.map((panel) => (
            <PanelBackground key={`bg:${panel.name}`} panel={panel} laid={laid} />
          ))}
        </>
      )}
      {/* Outline: the node rect grown by `U.pixelsize`, radius BASIS_RAD + 1
          (`node_draw.cc:3184-3211`). */}
      <rect
        x={laid.x - PIXEL_SIZE}
        y={-laid.yTop - PIXEL_SIZE}
        width={laid.width + 2 * PIXEL_SIZE}
        height={height + 2 * PIXEL_SIZE}
        rx={NODE_OUTLINE_RADIUS}
        fill="none"
        stroke={outline}
        strokeOpacity={outlineOpacity}
        strokeWidth={PIXEL_SIZE}
        transform="scale(1 -1)"
      />
      {/* The name: a Label button at `xmin + NODE_MARGIN_X`, height NODE_DY
          (`node_draw.cc:3117-3128`), at `UI_DEFAULT_TEXT_POINTS`. */}
      <text
        x={laid.x + NODE_MARGIN_X}
        y={-(laid.yTop - NODE_DY / 2)}
        transform="scale(1 -1)"
        fill={NODE_THEME.text}
        fontSize={UI_TEXT_POINTS}
        dominantBaseline="central"
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        {label}
      </text>
      {details &&
        laid.sockets.map((socket) => (
          <Socket
            key={`${socket.output ? 'o' : 'i'}:${socket.identifier}`}
            socket={socket}
            node={laid}
            onRefuse={onRefuse}
          />
        ))}
      {/* PANEL HEADERS last, over the sockets their collapsed rows carry —
          `node_draw_panels` is called after the node's own buttons
          (`node_draw.cc:3219`). */}
      {details &&
        panels.map((panel) => (
          <PanelHeader key={`hd:${panel.name}`} panel={panel} laid={laid} onRefuse={onRefuse} />
        ))}
    </g>
  );
}

/**
 * A PANEL'S CONTENT BAND — `node_draw_panels_background`
 * (`node_draw.cc:1914-1957`): `TH_PANEL_SUB_BACK` at 1.5x its own alpha, the
 * full node width, `BASIS_RAD` with NO corners set, from the content's
 * `max_y` down to its `min_y`. The FINAL panel's band instead runs to the
 * node's bottom edge with the two bottom corners rounded, and is painted
 * `depth + 1` times — a literal repeat, which at this alpha is what makes a
 * nested final panel read darker.
 */
function PanelBackground({
  panel,
  laid,
}: {
  readonly panel: LaidOutPanel;
  readonly laid: LaidOutNode;
}) {
  if (panel.contentTop === null || panel.contentBottom === null) return null;
  const bands: { y: number; height: number; radius: number; times: number }[] = [
    {
      y: panel.contentTop,
      height: panel.contentTop - panel.contentBottom,
      radius: 0,
      times: 1,
    },
  ];
  if (panel.fillsNodeEnd) {
    bands.push({
      y: panel.contentBottom,
      height: panel.contentBottom - laid.yBottom,
      radius: BASIS_RAD,
      times: panel.depth + 1,
    });
  }
  return (
    <g style={{ pointerEvents: 'none' }}>
      {bands.flatMap((band, index) =>
        Array.from({ length: band.times }, (_unused, pass) => (
          <rect
            key={`${index}:${pass}`}
            x={laid.x}
            y={-band.y}
            width={laid.width}
            height={Math.max(band.height, 0)}
            rx={band.radius}
            fill={PANEL_SUB_BACK}
            fillOpacity={PANEL_SUB_BACK_ALPHA}
            transform="scale(1 -1)"
          />
        )),
      )}
    </g>
  );
}

/**
 * A PANEL'S HEADER ROW — `node_draw_panels` (`node_draw.cc:1986-2102`).
 *
 * The header itself has NO fill: Blender draws an invisible `ButToggle` over
 * the whole band (`:2030-2048`), then the collapse triangle at
 * `xmin + NODE_MARGIN_X/3`, `U.widget_unit * 0.8` square and centred on
 * `header_center_y`, then — if the panel declares a toggle socket that is not
 * linked — a `UI_UNIT_X`-wide checkbox, then the label. The triangle's own
 * geometry is {@link PANEL_TRIANGLE}, read off Blender's icon sources.
 *
 * CLICKING IT IS AN EDIT and is refused by name: the callback is
 * `panel_state->flag ^= NODE_PANEL_COLLAPSED` followed by
 * `BKE_main_ensure_invariants` (`node_draw.cc:1903-1911`), which is a write
 * to the node tree the document would save.
 */
function PanelHeader({
  panel,
  laid,
  onRefuse,
}: {
  readonly panel: LaidOutPanel;
  readonly laid: LaidOutNode;
  readonly onRefuse: (text: string) => void;
}) {
  const size = NODE_HEADER_ICON_SIZE;
  const scale = size / PANEL_TRIANGLE.cell;
  const cx = laid.x + PANEL_HEADER_MARGIN_X + size / 2;
  const cy = panel.centerY;
  const reach = PANEL_TRIANGLE.reach * scale;
  const spread = PANEL_TRIANGLE.spread * scale;
  // `ICON_RIGHTARROW` when collapsed, `ICON_DOWNARROW_HLT` when open
  // (`node_draw.cc:2037-2043`) — the same chevron, turned a quarter.
  const chevron = panel.collapsed
    ? `M ${cx - reach / 2} ${-(cy + spread)} L ${cx + reach / 2} ${-cy} L ${cx - reach / 2} ${-(cy - spread)}`
    : `M ${cx - spread} ${-(cy + reach / 2)} L ${cx} ${-(cy - reach / 2)} L ${cx + spread} ${-(cy + reach / 2)}`;
  const labelX =
    laid.x +
    PANEL_HEADER_MARGIN_X +
    size +
    PANEL_HEADER_BUT_PADDING +
    (panel.toggle && !panel.toggle.linked ? UI_UNIT_X : 0);
  return (
    <g
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        onRefuse(
          `${panel.collapsed ? 'Opening' : 'Collapsing'} "${panel.name}" writes the panel's is_collapsed — editing parity is not the program.`,
        );
      }}
      style={{ cursor: 'default' }}
    >
      {/* The whole band is the button's hit area (`:2030-2048`), and it draws
          nothing: `EmbossType::None`. */}
      <rect
        x={laid.x}
        y={-(cy + NODE_DYS)}
        width={laid.width}
        height={2 * NODE_DYS}
        fill="transparent"
        transform="scale(1 -1)"
      />
      <path
        d={chevron}
        fill="none"
        stroke={NODE_THEME.text}
        strokeWidth={PANEL_TRIANGLE.stroke * scale}
        strokeLinecap="round"
        strokeLinejoin="round"
        transform="scale(1 -1)"
        style={{ pointerEvents: 'none' }}
      />
      {panel.toggle && !panel.toggle.linked && (
        // `uiDefButR(… Checkbox …, "default_value")` (`:2059-2076`), drawn as
        // `wcol_option`'s box: the value is READ here and written nowhere.
        <rect
          x={laid.x + PANEL_HEADER_MARGIN_X + size + PANEL_HEADER_BUT_PADDING}
          y={-(cy + NODE_DYS / 2)}
          width={NODE_DYS}
          height={NODE_DYS}
          rx={0.2 * NODE_DYS}
          fill={panel.toggle.value === true ? '#4772b3' : '#545454'}
          transform="scale(1 -1)"
          style={{ pointerEvents: 'none' }}
        />
      )}
      <text
        x={labelX}
        y={-cy}
        transform="scale(1 -1)"
        fill={NODE_THEME.text}
        fontSize={UI_TEXT_POINTS}
        dominantBaseline="central"
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        {panel.name}
      </text>
    </g>
  );
}

/** Blender's socket mark: a 10×10 box (radius `NODE_SOCKSIZE`) in the socket
 *  TYPE's colour with a 1 px `TH_WIRE` outline, shaped by `display_shape`
 *  (`node_draw.cc:1824-1857`; the shapes themselves are SDFs in
 *  `gpu_shader_2D_node_socket*.glsl`, which is outside the sparse checkout —
 *  the silhouettes below are drawn from the enum's own names). */
function Socket({
  socket,
  node,
  onRefuse,
}: {
  readonly socket: LaidOutSocket;
  readonly node: LaidOutNode;
  readonly onRefuse: (text: string) => void;
}) {
  const fill = socketColor(socket.type);
  const stroke = socket.type === 'CUSTOM' ? SOCKET_OUTLINE_VIRTUAL : SOCKET_OUTLINE;
  const r = NODE_SOCKSIZE;
  const base = socket.shape.replace('_DOT', '');
  const dot = socket.shape.endsWith('_DOT');
  const mark =
    base === 'SQUARE' ? (
      <rect
        x={socket.x - r}
        y={-socket.y - r}
        width={2 * r}
        height={2 * r}
        fill={fill}
        stroke={stroke}
        strokeWidth={SOCKET_OUTLINE_WIDTH}
        transform="scale(1 -1)"
      />
    ) : base === 'DIAMOND' ? (
      <polygon
        points={`${socket.x},${-socket.y - r} ${socket.x + r},${-socket.y} ${socket.x},${-socket.y + r} ${socket.x - r},${-socket.y}`}
        fill={fill}
        stroke={stroke}
        strokeWidth={SOCKET_OUTLINE_WIDTH}
        transform="scale(1 -1)"
      />
    ) : (
      <circle
        cx={socket.x}
        cy={-socket.y}
        r={r}
        fill={fill}
        stroke={stroke}
        strokeWidth={SOCKET_OUTLINE_WIDTH}
        transform="scale(1 -1)"
      />
    );

  return (
    <g
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        onRefuse(
          `Dragging from "${socket.name}" would make a link — editing parity is not the program.`,
        );
      }}
    >
      {mark}
      {dot && (
        <circle cx={socket.x} cy={-socket.y} r={r * 0.35} fill={stroke} transform="scale(1 -1)" />
      )}
      {/* A socket inside a COLLAPSED panel draws its MARK on the panel's
          header row and nothing else — `mark_sockets_collapsed_recursive`
          moves the location and sets `SOCK_PANEL_COLLAPSED`
          (`node_draw.cc:1007-1032`), and the row it would have had was never
          flattened, so there is no name and no widget to draw. */}
      {!node.collapsed && !socket.panelCollapsed && (
        <SocketRow socket={socket} node={node} onRefuse={onRefuse} />
      )}
    </g>
  );
}

/**
 * A SOCKET'S ROW — its name, and for an UNLINKED input with a value, the
 * inline widget Blender draws in its place.
 *
 * `node_update_basis_socket` lays the row's widget out at `locx + NODE_DYS`,
 * `NODE_WIDTH(node) - NODE_DY` wide (`node_draw.cc:498-506`) — inset by
 * `NODE_DYS` = 10 on each side, not `NODE_MARGIN_X` — one `UI_UNIT_Y` tall,
 * `LayoutAlign::Expand` for an input and `::Right` for an output (`:518`,
 * `:529`), which is why an output's name is right-aligned against the node's
 * edge and an input's widget fills the row.
 *
 * WHY THE WIDGET IS DRAWN HERE AND NOT BORROWED FROM THE PROPERTIES RAIL.
 * This surface is a ZOOMING tree-space canvas: a DOM control would need a
 * `foreignObject` per socket and would not scale with the view transform, so
 * it would stop being the same drawing at any zoom but 1. The Properties
 * rail's widgets are reused where they belong — the N-panel, which is
 * ordinary unzoomed DOM.
 */
function SocketRow({
  socket,
  node,
  onRefuse,
}: {
  readonly socket: LaidOutSocket;
  readonly node: LaidOutNode;
  readonly onRefuse: (text: string) => void;
}) {
  const inset = NODE_DYS;
  const left = node.x + inset;
  const right = node.x + node.width - inset;
  const centre = -(socket.rowTop - NODE_DY / 2);
  const drawsValue = !socket.output && !socket.linked && !socket.hideValue && socket.value !== null;

  if (!drawsValue) {
    return (
      <text
        x={socket.output ? right : left}
        y={centre}
        transform="scale(1 -1)"
        textAnchor={socket.output ? 'end' : 'start'}
        fill={NODE_THEME.text}
        fontSize={UI_TEXT_POINTS}
        dominantBaseline="central"
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        {socket.name}
      </text>
    );
  }

  const isColour = Array.isArray(socket.value) && socket.value.length >= 3;
  return (
    <g
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        onRefuse(
          `Changing "${socket.name}" writes the socket's default_value — editing parity is not the program.`,
        );
      }}
      style={{ cursor: 'default' }}
    >
      {/* `wcol_num`/`wcol_numslider`'s field: the widget colour at the theme's
          own roundness (`interface_widgets.cc:3188`, `rad = roundness *
          U.widget_unit`; `.wcol_num.roundness` is 0.2 in the shipped theme,
          the same 4 px BASIS_RAD works out to). */}
      <rect
        x={left}
        y={centre - NODE_DY / 2 + 1}
        width={right - left}
        height={NODE_DY - 2}
        rx={0.2 * NODE_DY}
        fill="#545454"
        transform="scale(1 -1)"
      />
      {/* THE SLIDER'S FILL. A scalar socket with a bounded SOFT range is drawn
          by Blender as `UI_BTYPE_NUM_SLIDER`, whose back is filled to the
          value's proportion of that range (`widget_numslider`,
          `interface_widgets.cc`) — which is why Roughness at 0.5 reads as
          half-filled at a glance and ours read as a text box (sighted read,
          2026-09-20). No range means no fill, which is also what Blender does
          for an unbounded number. The fill is clipped to the field's own
          rounded rect so a full-value slider does not square off its corners. */}
      {sliderFraction(socket) !== null && (
        <>
          <clipPath id={`sl-${socket.identifier}`}>
            <rect
              x={left}
              y={centre - NODE_DY / 2 + 1}
              width={right - left}
              height={NODE_DY - 2}
              rx={0.2 * NODE_DY}
            />
          </clipPath>
          <rect
            x={left}
            y={centre - NODE_DY / 2 + 1}
            width={(right - left) * (sliderFraction(socket) ?? 0)}
            height={NODE_DY - 2}
            fill={NODE_THEME.sliderFill}
            clipPath={`url(#sl-${socket.identifier})`}
            transform="scale(1 -1)"
          />
        </>
      )}
      <text
        x={left + 6}
        y={centre}
        transform="scale(1 -1)"
        fill={NODE_THEME.text}
        fontSize={UI_TEXT_POINTS}
        dominantBaseline="central"
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        {socket.name}
      </text>
      {isColour ? (
        <rect
          x={right - 34}
          y={centre - NODE_DY / 2 + 3}
          width={30}
          height={NODE_DY - 6}
          rx={2}
          fill={rgbFloatsToHex(socket.value as readonly number[])}
          transform="scale(1 -1)"
        />
      ) : (
        <text
          x={right - 6}
          y={centre}
          transform="scale(1 -1)"
          textAnchor="end"
          fill={NODE_THEME.text}
          fontSize={UI_TEXT_POINTS}
          dominantBaseline="central"
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          {formatSocketValue(socket.value)}
        </text>
      )}
    </g>
  );
}

/**
 * How far along its soft range a scalar socket sits, or `null` when it is not
 * a slider at all. Blender's own test is the property's soft range being
 * bounded (`ui_but_is_slider` → `UI_BTYPE_NUM_SLIDER`); the engine reports the
 * pair only for a bounded scalar, so the presence of the pair IS the test.
 */
function sliderFraction(socket: LaidOutSocket): number | null {
  const { softMin, softMax, value } = socket;
  if (softMin === undefined || softMax === undefined) return null;
  if (typeof value !== 'number' || softMax <= softMin) return null;
  return Math.min(1, Math.max(0, (value - softMin) / (softMax - softMin)));
}

function formatSocketValue(value: LaidOutSocket['value']): string {
  if (value === null) return '';
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  if (typeof value === 'number') return value.toFixed(3);
  if (typeof value === 'string') return value;
  return value.map((channel) => channel.toFixed(2)).join(', ');
}

/** A noodle. `node_link_bezier_points`'s two handles, drawn as one cubic with
 *  `TH_WIRE` beneath it as the outline (`drawnode.cc:2309`) and the socket
 *  colours through it when Blender's wire-colour overlay is on — which is
 *  `SpaceNodeOverlay.show_wire_color` (`rna_space.cc:8385-8386`), a space
 *  setting this engine has no node editor to carry, so the inner colour is
 *  `TH_WIRE_INNER` exactly as a node editor with the overlay off draws it. */
function Noodle({ link }: { readonly link: LaidLink }) {
  const [h1, h2] = linkHandles(link.from, link.to);
  const d = `M ${link.from[0]} ${link.from[1]} C ${h1[0]} ${h1[1]}, ${h2[0]} ${h2[1]}, ${link.to[0]} ${link.to[1]}`;
  const colour = link.valid ? NODE_THEME.wireInner : '#ff2020';
  return (
    <g style={{ pointerEvents: 'none' }}>
      <path d={d} fill="none" stroke={NODE_THEME.wire} strokeWidth={LINK_WIDTH + 2 * PIXEL_SIZE} />
      <path
        d={d}
        fill="none"
        stroke={colour}
        strokeWidth={LINK_WIDTH}
        strokeDasharray={link.muted ? '10 10' : undefined}
        strokeOpacity={link.muted ? NODE_THEME.dashAlpha : 1}
      />
    </g>
  );
}

/** A frame: its own colour at `TH_NODE_FRAME`'s alpha, radius `BASIS_RAD` with
 *  no 0.5 padding (`frame_node_draw_background`, `node_draw.cc:3749-3772`),
 *  and a centred label `0.5 * margin_top + 0.35 * label_size` below the top
 *  (`node_draw.cc:3474-3484, 3699-3703`). */
function FrameNode({ node, laid }: { readonly node: BlenderNode; readonly laid: LaidOutNode }) {
  const height = Math.max(laid.yTop - laid.yBottom, FRAME_MARGIN * 2);
  return (
    <g style={{ pointerEvents: 'none' }}>
      <rect
        x={laid.x}
        y={-laid.yTop}
        width={laid.width}
        height={height}
        rx={BASIS_RAD}
        fill={node.useCustomColor ? rgbFloatsToHex(node.color) : NODE_THEME.frame}
        fillOpacity={NODE_THEME.frameAlpha}
        transform="scale(1 -1)"
      />
      {node.label && (
        <text
          x={laid.x + laid.width / 2}
          y={-(laid.yTop - 25)}
          transform="scale(1 -1)"
          textAnchor="middle"
          fill={NODE_THEME.text}
          fontSize={20}
        >
          {node.label}
        </text>
      )}
    </g>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * THE HEADER, per `bl_ui/space_node.py:41-260` — read as a specification and
 * drawn READ-ONLY, which is where it diverges from Blender by design: a
 * control that would WRITE is drawn as what it reads and refuses the click by
 * name. What the shader path's header carries, in order: the tree-type well
 * (`template_header`, `:55`), the shader-type selector (`snode.shader_type`,
 * `:62`), the material slot popover and the material ID (`:79-93`), the pin
 * (`:222-224`), the breadcrumb parent (`:228-230`), snapping
 * (`tool_settings.use_snap_node`, `:249-252`) and the overlays popover
 * (`:254-260`).
 *
 * There is deliberately NO "Use Nodes" checkbox: measured in the source, 5.2
 * draws it only for Line Style (`:119`) and Texture (`:133`) trees, never for
 * a material's.
 */
function NodeEditorHeader({
  tree,
  zoom,
  onViewAll,
  onRefuse,
}: {
  readonly tree: BlenderNodeTree | null;
  readonly zoom: number;
  readonly onViewAll: () => void;
  readonly onRefuse: (text: string) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--vgai-space-2)',
        height: HEADER_HEIGHT,
        padding: '0 var(--vgai-space-2)',
        background: NODE_THEME.background,
        color: NODE_THEME.text,
        font: `${UI_TEXT_POINTS}px inherit`,
        borderBottom: '1px solid #161616',
      }}
    >
      <span data-testid="node-editor-tree-type" style={{ opacity: 0.85 }}>
        {tree?.typeLabel ?? 'Shader Editor'}
      </span>
      <span style={{ opacity: 0.4 }}>·</span>
      <span data-testid="node-editor-material">{tree?.material ?? 'No material'}</span>
      <span style={{ flex: 1 }} />
      <span style={{ opacity: 0.6 }}>{Math.round(zoom * 100)}%</span>
      <button
        type="button"
        className="vgai-btn"
        data-variant="ghost"
        data-size="sm"
        onClick={onViewAll}
        data-testid="node-editor-view-all"
      >
        View All
      </button>
      <button
        type="button"
        className="vgai-btn"
        data-variant="ghost"
        data-size="sm"
        data-testid="node-editor-use-nodes"
        onClick={() =>
          onRefuse('Use Nodes writes Material.use_nodes — editing parity is not the program.')
        }
      >
        Use Nodes
      </button>
    </div>
  );
}

/**
 * THE STATUS LINE — where a refusal lands, and where anything this view
 * cannot draw is named rather than silently skipped.
 *
 * THE PANEL GAP IS CLOSED, and what is left of it is stated here rather than
 * hidden. A node's socket-panel MEMBERSHIP is traced from Blender's own
 * `declare()` bodies (`blender.node-panels.json`) and its COLLAPSED STATE is
 * read live from `Node.panel_states`, so a Principled BSDF draws the eight
 * collapsed panel rows Blender draws. Two things still fall back, and both
 * say so by name: a node whose LIVE socket list disagrees with the traced
 * declaration (the ruling's own condition), and a node the trace does not
 * cover at all — a node GROUP, whose panels are its tree interface's runtime
 * data rather than a declaration.
 */
function StatusLine({
  entries,
  error,
  refusal,
}: {
  readonly entries: readonly LaidEntry[];
  readonly error: string | null;
  readonly refusal: string | null;
}) {
  const fell = entries.filter((entry) => entry.fallback !== null);
  const approximate = entries.filter((entry) => entry.approximate);
  const panels = entries.reduce((sum, entry) => sum + entry.panels.length, 0);
  const message = error
    ? error
    : refusal
      ? refusal
      : fell.length > 0
        ? `${fell.map((entry) => `"${entry.node.name}" draws its sockets flat: ${entry.fallback}`).join('; ')}.`
        : approximate.length > 0
          ? `${approximate.map((entry) => `"${entry.node.name}"`).join(', ')} ${approximate.length === 1 ? 'carries a' : 'carry'} declaration LAYOUT row, whose drawn height RNA cannot answer; one UI unit is reserved for it.`
          : panels > 0
            ? `${panels} socket panel${panels === 1 ? '' : 's'} drawn from Blender's own declarations. Read-only: this view inspects the node tree and never writes it.`
            : 'Read-only: this view inspects the node tree and never writes it.';
  return (
    <div
      data-testid="node-editor-status"
      style={{
        flex: '0 0 auto',
        height: STATUS_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        padding: '0 var(--vgai-space-2)',
        background: NODE_THEME.background,
        color: error || refusal ? '#ffa028' : '#888888',
        font: `${UI_TEXT_POINTS}px inherit`,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {message}
    </div>
  );
}

/**
 * THE N-PANEL'S NODE TAB — `NODE_PT_active_node_generic`
 * (`bl_ui/space_node.py:800-841`), in its own order: `name` (`:819`), `label`
 * (`:820`), the Color heading with `use_custom_color` and `color`
 * (`:822-834`), then `show_options` (`:837`) and `mute` (`:838`). Blender
 * 5.2 has no separate `NODE_PT_active_node_color`; the colour controls are
 * that panel's own sub-column.
 *
 * `NODE_PT_active_node_properties` (`:844-857`) is ONE call —
 * `layout.template_node_inputs(node)` — and that template is C: it draws the
 * same per-socket widgets the node body draws. The node's own inputs are
 * listed here with their values for exactly that reason, which is the same
 * fact through the same door.
 */
function NodePanel({
  node,
  onRefuse,
}: {
  readonly node: BlenderNode | null;
  readonly onRefuse: (text: string) => void;
}) {
  return (
    <aside
      data-testid="node-editor-sidebar"
      style={{
        width: SIDEBAR_WIDTH,
        flex: '0 0 auto',
        overflow: 'auto',
        // THE SIDEBAR IS PART OF THE NODE EDITOR'S AREA, so it wears the
        // space's own `TH_BACK` like the header and the canvas do. It used to
        // paint `--vgai-color-surface-panel`, which is the DOCK's grey
        // (#303030 under the Blender look): Blender fills every region of a
        // node editor area with `TH_BACK` and draws panels ON it
        // (`ED_region_panels`), so the grey was this view wearing its
        // container's colour. MEASURED 2026-09-19 (the frame walk, beat 5):
        // at (600,500) — inside the Shader Editor's pane, which a 320px
        // sidebar had squeezed the canvas out of — the read was #303030 where
        // the beat named #1a1a1a. The frame's `vgai.nodeEditor.background`
        // theme colour carries the same traced value for the workbench's own
        // painting; this is the same number, from the same trace, for the
        // pixels we paint ourselves.
        background: NODE_THEME.background,
        color: NODE_THEME.text,
        font: `${UI_TEXT_POINTS}px inherit`,
        borderLeft: '1px solid #161616',
        padding: 'var(--vgai-space-2)',
      }}
    >
      <div style={{ opacity: 0.6, marginBottom: 'var(--vgai-space-2)' }}>Node</div>
      {!node ? (
        // Blender's panel `poll` is `context.active_node is not None`
        // (`space_node.py:806-808`): with no active node the tab draws nothing.
        <div style={{ opacity: 0.5 }}>No node looked at.</div>
      ) : (
        <>
          <Row label="Name" value={node.name} onRefuse={onRefuse} />
          <Row label="Label" value={node.label ?? ''} onRefuse={onRefuse} />
          <Row
            label="Color"
            value={node.useCustomColor ? rgbFloatsToHex(node.color) : 'Off'}
            onRefuse={onRefuse}
            swatch={node.useCustomColor ? rgbFloatsToHex(node.color) : undefined}
          />
          <Row label="Mute" value={node.muted ? 'On' : 'Off'} onRefuse={onRefuse} />
          <div
            style={{
              opacity: 0.6,
              margin: 'var(--vgai-space-3) 0 var(--vgai-space-1)',
            }}
          >
            Properties
          </div>
          {node.inputs.filter(socketDraws).map((socket) => (
            <Row
              key={socket.identifier}
              label={socket.label ?? socket.name}
              value={socket.linked ? 'Linked' : formatSocketValue(socket.value)}
              onRefuse={onRefuse}
            />
          ))}
        </>
      )}
    </aside>
  );
}

function Row({
  label,
  value,
  swatch,
  onRefuse,
}: {
  readonly label: string;
  readonly value: string;
  readonly swatch?: string | undefined;
  readonly onRefuse: (text: string) => void;
}) {
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 'var(--vgai-space-2)', height: 20 }}
      onPointerDown={() =>
        onRefuse(`"${label}" is read here and written nowhere — inspection parity.`)
      }
    >
      <span style={{ flex: '0 0 45%', opacity: 0.75, textAlign: 'right' }}>{label}</span>
      {swatch && (
        <span
          style={{ width: 14, height: 14, borderRadius: 2, background: swatch, flex: '0 0 auto' }}
        />
      )}
      <span
        style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

// THERE IS DELIBERATELY NO `available` GATE. A `workspace.utility` may gate
// its tab on session state, and the Network utility does because a game may or
// may not expose a networking adapter. This tab's condition is that the
// BLENDER BUILD is loaded, and a contribution of this package cannot be
// registered unless it is — the same reason `model.layout.ts` gates on the
// project declaring a `model` document and nothing else. With no material the
// view draws what Blender draws with no tree: the bare background, and the
// header saying so.
