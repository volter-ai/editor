/**
 * BLENDER'S NODE EDITOR, AS NUMBERS — the geometry and the colours the node
 * view draws with, each one READ from Blender 5.2.0's own source at the
 * engine's pin (`fbe6228777e7`) and cited beside it.
 *
 * WORK.md §Blender in the tab is Blender, "Inspection parity", I5;
 * ARCHITECTURE-CORE §Blender north star, "Inspection parity, not editing
 * parity" and "The reference is Blender's SOURCE as well as its frames".
 * Blender's own drawing code is never run, ported as a UI system, or
 * recorded — it is READ as the specification of what to draw, which is what
 * every citation below is doing.
 *
 * THE SCALE. Every constant here is stated at `UI_SCALE_FAC = 1` and
 * `U.pixelsize = 1`, which makes `U.widget_unit = int(round(18 * 1)) + 2 * 1`
 * = **20** (`windowmanager/intern/wm_window.cc:779`). The node editor draws
 * WITHOUT DPI — "Nodes draw without DPI - the view zoom is flexible", the
 * comment above the macro block (`space_node/node_intern.hh:332`) — so a node's
 * tree-space size is these numbers exactly and the VIEW's zoom is the only
 * scale between them and the screen.
 *
 * WHY THE LAYOUT IS COMPUTED HERE AND NOT READ. `Node.dimensions` is RNA's
 * answer for a node's drawn size, and it is `bNode.runtime->draw_bounds`,
 * which only the node editor's own draw pass fills in. Measured 2026-09-19 on
 * the engine in the tab: every node of a freshly built Principled material
 * answers `dimensions == [0, 0]`, because this Blender has no node editor
 * region and never will. So the height is derived the way
 * `node_update_basis` derives it, from facts RNA does answer.
 */

/* -------------------------------------------------------------------------- */
/* Geometry — `space_node/node_intern.hh:332-344`                             */
/* -------------------------------------------------------------------------- */

/** `U.widget_unit` at scale 1 (`wm_window.cc:779`). */
export const WIDGET_UNIT = 20;

/** `U.pixelsize` at scale 1 — the node outline's width (`node_draw.cc:2922`). */
export const PIXEL_SIZE = 1;

/** `#define NODE_DY U.widget_unit` (`node_intern.hh:335`) — the header's
 *  height and a socket row's height, the same number. */
export const NODE_DY = WIDGET_UNIT;

/** `#define NODE_DYS (U.widget_unit / 2)` (`node_intern.hh:334`) — how far
 *  below a row's top its socket sits, and the body's side inset. */
export const NODE_DYS = WIDGET_UNIT / 2;

/** `#define BASIS_RAD (0.2f * U.widget_unit)` (`node_intern.hh:333`). */
export const BASIS_RAD = 0.2 * WIDGET_UNIT;

/** `#define NODE_SOCKSIZE (0.25f * U.widget_unit)` (`node_intern.hh:340`) —
 *  a socket's RADIUS: `node_draw_socket` builds a rect `location ± (5, 5)`
 *  (`node_draw.cc:1835`). */
export const NODE_SOCKSIZE = 0.25 * WIDGET_UNIT;

/** `#define NODE_MARGIN_X (1.2f * U.widget_unit)` (`node_intern.hh:339`) —
 *  where the header's label starts (`node_draw.cc:3117-3128`). */
export const NODE_MARGIN_X = 1.2 * WIDGET_UNIT;

/** `#define NODE_ITEM_SPACING_Y (0.1f * U.widget_unit)` (`node_intern.hh:336`)
 *  — the unit every inter-item margin of the declaration layout is a multiple
 *  of (`node_draw.cc:886-1000`). */
export const NODE_ITEM_SPACING_Y = 0.1 * WIDGET_UNIT;

/** `#define NODE_HEADER_ICON_SIZE (0.8f * U.widget_unit)` (`node_draw.cc:2143`). */
export const NODE_HEADER_ICON_SIZE = 0.8 * WIDGET_UNIT;

/** `#define NODE_MULTI_INPUT_LINK_GAP (0.25f * U.widget_unit)`
 *  (`node_intern.hh:341`) — how far apart a multi-input socket fans its links. */
export const NODE_MULTI_INPUT_LINK_GAP = 0.25 * WIDGET_UNIT;

/** The 0.5 every filled rect is grown by "to prevent transparent gaps with the
 *  outline" (`node_draw.cc:2920`), and the radius that goes with it. */
export const NODE_FILL_PADDING = 0.5;
export const NODE_FILL_RADIUS = BASIS_RAD + NODE_FILL_PADDING;
/** The outline sits `U.pixelsize` outside the rect at `BASIS_RAD + 1`
 *  (`node_draw.cc:3184-3211`). */
export const NODE_OUTLINE_RADIUS = BASIS_RAD + PIXEL_SIZE;

/** `NODE_GRID_UNIT` (`editors/include/ED_node_c.hh:31-32`) — the dot grid's
 *  finest step, and the snapping unit. */
export const NODE_GRID_STEP = 20;

/** `LINK_WIDTH` (`space_node/drawnode.cc:1959`) — a noodle's stroke at 100 %,
 *  clamped never to go below this as the view zooms out
 *  (`drawnode.cc:2299-2302`); a FIELD link draws at 0.7 of it. */
export const LINK_WIDTH = 2.5;
export const LINK_FIELD_WIDTH_FACTOR = 0.7;

/** `NODE_LINK_RESOL` (`node_intern.hh:343`) — how many segments Blender's own
 *  CPU evaluation of a noodle uses. SVG draws the cubic itself, so this is
 *  here as the record of what the reference samples, not as a step count. */
export const NODE_LINK_RESOL = 12;

/** `NODE_TREE_SCALE_SMALL` (`node_draw.cc:1596`) — below `1/aspect > 0.2`,
 *  `draw_node_details` is false and Blender draws NO sockets, no reroute
 *  labels and no group marks at all (`node_draw.cc:1607-1610`). */
export const NODE_DETAIL_ZOOM_MIN = 0.2;

/** A collapsed node: `dy = NODE_DY * 0.5`, `height = dy * max(in, out, 2) +
 *  BASIS_RAD * 2`, and the whole bar is offset `NODE_DY * -0.5` below
 *  `location.y` (`node_update_collapsed`, `node_draw.cc:1345-1353`). */
export const COLLAPSED_SOCKET_PITCH = NODE_DY * 0.5;
export const COLLAPSED_OFFSET_Y = NODE_DY * -0.5;

/** A reroute is `NODE_SOCKSIZE` in every direction — a 10×10 box drawn as one
 *  socket (`reroute_node_prepare_for_draw`, `node_draw.cc:3579-3593`). */
export const REROUTE_RADIUS = NODE_SOCKSIZE;

/** A frame's margin is `1.5f * U.widget_unit` (`frame_node_layout`,
 *  `node_draw.cc:3472`); there is no `NODE_FRAME_MARGIN` macro in 5.2. The
 *  top margin makes room for the label: `max(margin, 1.5 * label_size + 0.2 *
 *  margin)`, and the baseline sits `0.5 * margin_top + 0.35 * label_size`
 *  below the top (`node_draw.cc:3474-3484`). */
export const FRAME_MARGIN = 1.5 * WIDGET_UNIT;
export const FRAME_LABEL_SIZE_DEFAULT = 20;

/** The label's point size — `UI_DEFAULT_TEXT_POINTS` (`UI_interface_c.hh:425`),
 *  which `style->widget` takes (`interface_style.cc:91`). A node's name is an
 *  ordinary `ButtonType::Label`: there is no `node_draw_label` in 5.2. */
export const UI_TEXT_POINTS = 11;

/* -------------------------------------------------------------------------- */
/* Colours — `release/datafiles/userdef/userdef_default_theme.c:652-698`,      */
/* the `.space_node` block, mapped through `interface/resources.cc`           */
/* -------------------------------------------------------------------------- */

/** Every value is the DEFAULT THEME's, by member and line. A member absent
 *  from the initializer takes the struct's zero and is called out. */
export const NODE_THEME = {
  /** `wcol_numslider.item` — the FILLED portion of a number slider's back
   *  (`widget_numslider`, `interface_widgets.cc`, which draws the item rect to
   *  the value's proportion before the text).
   *
   *  SAMPLED FROM THE FRAME, not recalled: `rgb(70,113,178)` at the Roughness
   *  and Alpha fills on Blender 5.2.0 LTS's own shader editor at 2x, against
   *  `rgb(83,83,83)` in the same row's unfilled remainder. It is BLUE — the
   *  playhead's family — and the first pass here guessed a grey a step lighter
   *  than the field, drew it, and produced a slider nobody could see. The
   *  frame was on screen the whole time. */
  sliderFill: '#4671b2',
  /** `.back` `0x1a1a1a00` (`:653`). The alpha is 0x00 and IRRELEVANT:
   *  `draw_background_color` clears with the RGB and a hard 1.0
   *  (`node_draw.cc:4713-4718`), so the canvas is opaque #1a1a1a. */
  background: '#1a1a1a',
  /** `.grid` `0x30303000` (`:661`) — alpha ZERO. Blender's dot grid is
   *  therefore INVISIBLE under the shipped theme, and drawing one here would
   *  be a mark the reference does not make. `.grid_levels` is 3 (`:671`) and
   *  the draw is `view2d_dot_grid_draw(&v2d, TH_GRID, NODE_GRID_STEP_SIZE,
   *  grid_levels)` (`node_draw.cc:4755-4756`) — a DOT grid, not
   *  `UI_view2d_multi_grid_draw`, which the node editor does not call. */
  grid: '#303030',
  gridAlpha: 0,
  gridLevels: 3,
  /** `.syntaxl` `0x303030ff` (`:673`), which `resources.cc:659-660` returns
   *  for `TH_NODE`. EVERY node's BODY is this colour whatever its class
   *  (`node_draw.cc:3149`); only the header carries the class hue. */
  body: '#303030',
  /** `.node_outline` `0xffffff26` (`:681`) → `TH_NODE_OUTLINE`
   *  (`resources.cc:662-663`): white at alpha 0x26 (`node_draw.cc:3206`). */
  outline: '#ffffff',
  outlineAlpha: 0x26 / 255,
  /** `.select` `0xed5700ff` (`:663`) → `TH_SELECT` (`node_draw.cc:3196`). */
  select: '#ed5700',
  /** `.active` `0xffffffff` (`:664`) → `TH_ACTIVE`, the outline of a node that
   *  is selected AND active (`node_draw.cc:3196`). */
  active: '#ffffff',
  /** `.syntaxr` `0x8d8d8dff` (`:680`) → `TH_WIRE_INNER` (`resources.cc:364-365`)
   *  — a noodle's own colour when wire colours are off (`drawnode.cc:2312`). */
  wireInner: '#8d8d8d',
  /** `.wire` `0x1a1a1aff` (`:662`) → `TH_WIRE`: a noodle's OUTLINE
   *  (`drawnode.cc:2309`) and a socket's outline (`node_draw.cc:1502-1505`). */
  wire: '#1a1a1a',
  /** `.edge_select` `0xffffffb3` (`:665`), whose Python name IS `wire_select`
   *  (`rna_userdef.cc:3604-3605`) — a SELECTED noodle blends toward this by
   *  its own alpha (`drawnode.cc:2338-2352`). */
  wireSelect: '#ffffff',
  wireSelectAlpha: 0xb3 / 255,
  /** `.noodle_curving` `4` (`:670`) → `TH_NODE_CURVING`
   *  (`resources.cc:713-714`). NOTE the divergence worth recording: RNA's
   *  property default is 5 (`rna_userdef.cc:3658-3663`), but the SHIPPED THEME
   *  initialises 4, and the theme is what a stock Blender runs with. */
  noodleCurving: 4,
  /** `.dash_alpha` `0.5f` (`:672`) — a muted/field noodle's dashes. */
  dashAlpha: 0.5,
  /** `.text` `0xe6e6e6ff` (`:655`) — the header label and socket names. */
  text: '#e6e6e6',
  /** `.movie` `0x0f0f0fcc` (`:694`), whose Python name is `frame_node`
   *  (`rna_userdef.cc:3640`) → `TH_NODE_FRAME` (`resources.cc:704-705`). */
  frame: '#0f0f0f',
  frameAlpha: 0xcc / 255,
} as const;

/**
 * THE HEADER COLOUR PER NODE CLASS, and it is a READ rather than a table of
 * ours: `Node.color_tag` (`rna_nodetree.cc:9480-9484`) is RNA reporting
 * `bke::node_color_tag(*node)`, which is the very value `node_get_colorid`
 * (`node_draw.cc:1388-1434`) switches on. This map is that switch's targets,
 * resolved through `resources.cc`'s `SPACE_NODE` branch to the theme members
 * at `userdef_default_theme.c`'s stated lines.
 */
export const NODE_HEADER_COLOR: Readonly<Record<string, string>> = {
  /** `TH_NODE_INPUT` ← `.syntaxn` (`:676`, `resources.cc:665-666`). */
  INPUT: '#82354c',
  /** `TH_NODE_OUTPUT` ← `.nodeclass_output` (`:682`, `resources.cc:668-669`).
   *  Only for the ACTIVE output — see {@link nodeHeaderColor}. */
  OUTPUT: '#3e232a',
  /** `TH_NODE_CONVERTER` ← `.syntaxv` (`:677`, `resources.cc:695-696`). */
  CONVERTER: '#246283',
  /** `TH_NODE_COLOR` ← `.syntaxb` (`:675`, `resources.cc:671-672`). */
  COLOR: '#6e6e23',
  /** `TH_NODE_VECTOR` ← `.nodeclass_vector` (`:684`, `resources.cc:677-678`). */
  VECTOR: '#3c3c83',
  /** `TH_NODE_FILTER` ← `.nodeclass_filter` (`:683`, `resources.cc:674-675`). */
  FILTER: '#412b51',
  /** `TH_NODE_GROUP` ← `.syntaxc` (`:678`, `resources.cc:698-699`). */
  GROUP: '#374725',
  /** `TH_NODE_INTERFACE` ← `.console_output` (`:666`, `resources.cc:701-702`). */
  INTERFACE: '#1d1d1d',
  /** `TH_NODE_MATTE` ← `.syntaxs` (`:674`, `resources.cc:707-708`). */
  MATTE: '#5a3838',
  /** `TH_NODE_DISTORT` ← `.syntaxd` (`:679`, `resources.cc:710-711`). */
  DISTORT: '#3e5a5b',
  /** `TH_NODE_TEXTURE` ← `.nodeclass_texture` (`:685`, `resources.cc:680-681`). */
  TEXTURE: '#79461d',
  /** `TH_NODE_SHADER` ← `.nodeclass_shader` (`:686`, `resources.cc:692-693`). */
  SHADER: '#2b652b',
  /** `TH_NODE_SCRIPT` ← `.nodeclass_script` (`:687`, `resources.cc:683-684`). */
  SCRIPT: '#203c3c',
  /** `TH_NODE_GEOMETRY` ← `.nodeclass_geometry` (`:688`, `resources.cc:686-687`). */
  GEOMETRY: '#1d725e',
  /** `TH_NODE_ATTRIBUTE` ← `.nodeclass_attribute` (`:689`, `resources.cc:689-690`). */
  ATTRIBUTE: '#1d2546',
  /** No class of its own in `node_get_colorid`: falls to `TH_NODE`. */
  NONE: NODE_THEME.body,
  PATTERN: NODE_THEME.body,
};

/**
 * SOCKET COLOUR BY `NodeSocket.type` — `std_node_socket_colors[][4]`
 * (`space_node/drawnode.cc:987-1013`), indexed by the `SOCK_*` enum. The
 * spellings are RNA's own (`NodeSocket.type`); each hex is that row's floats
 * rounded to 8 bits.
 */
export const SOCKET_COLOR: Readonly<Record<string, string>> = {
  VALUE: '#a1a1a1', // SOCK_FLOAT, drawnode.cc:988
  VECTOR: '#6363c7', // :989
  RGBA: '#c7c729', // :990
  SHADER: '#63c763', // :991
  BOOLEAN: '#cca6d6', // :992
  INT: '#598c5c', // :994
  STRING: '#70b3ff', // :995
  OBJECT: '#ed9e5c', // :996
  IMAGE: '#633863', // :997
  GEOMETRY: '#00d6a3', // :998
  COLLECTION: '#f5f5f5', // :999
  TEXTURE: '#9e4fa3', // :1000
  MATERIAL: '#eb7582', // :1001
  ROTATION: '#a663c7', // :1002
  MENU: '#666666', // :1003
  MATRIX: '#b83385', // :1004
  BUNDLE: '#4d8080', // :1005
  CLOSURE: '#7d7d3b', // :1006
  FONT: '#635742', // :1007
  SOUND: '#635742', // :1011
  INT_VECTOR: '#5c789c', // :1012
  /** The virtual (reroute-through) socket: `virtual_node_socket_color`
   *  `{0.2, 0.2, 0.2, 1.0}` (`drawnode.cc:984`). */
  CUSTOM: '#333333',
};

/** A socket type Blender itself has no `draw_color` for falls back to magenta
 *  (`node_draw.cc:1514-1521`) — so an unrecognised type is LOUD here too,
 *  never quietly grey. */
export const SOCKET_COLOR_UNKNOWN = '#ff00ff';

/** A socket's outline: `TH_ACTIVE` when selected, `{0.5,0.5,0.5}` for a
 *  virtual socket, otherwise `TH_WIRE` with alpha forced to 1
 *  (`node_socket_outline_color_get`, `node_draw.cc:1485-1506`). */
export const SOCKET_OUTLINE = NODE_THEME.wire;
export const SOCKET_OUTLINE_VIRTUAL = '#808080';
/** `NODE_SOCKET_OUTLINE = U.pixelsize` (`node_draw.cc:1570`). */
export const SOCKET_OUTLINE_WIDTH = PIXEL_SIZE;

/* -------------------------------------------------------------------------- */
/* The layout                                                                  */
/* -------------------------------------------------------------------------- */

export interface LaidOutSocket {
  readonly identifier: string;
  readonly name: string;
  readonly type: string;
  readonly shape: string;
  readonly output: boolean;
  readonly linked: boolean;
  readonly multiInput: boolean;
  readonly hideValue: boolean;
  readonly value: number | string | boolean | readonly number[] | null;
  /** See {@link LayoutSocketInput.softMin} — carried through so the inline
   *  widget can draw Blender's slider fill. */
  readonly softMin?: number;
  readonly softMax?: number;
  /** Tree space. `x` is the node's own edge — a socket sits ON the edge, not
   *  inset (`node_update_basis_socket`, `node_draw.cc:533-541`). */
  readonly x: number;
  readonly y: number;
  /** The top of the row this socket owns, for the inline value widget. */
  readonly rowTop: number;
  /** `SOCK_PANEL_COLLAPSED` (`node_draw.cc:1025`): this socket lives inside a
   *  COLLAPSED socket panel, so its MARK is drawn on that panel's header row
   *  and it draws no row of its own. Blender puts the mark there so a link
   *  into a hidden socket still lands somewhere visible. */
  readonly panelCollapsed: boolean;
}

export interface LaidOutNode {
  readonly name: string;
  readonly x: number;
  readonly yTop: number;
  readonly yBottom: number;
  readonly width: number;
  readonly collapsed: boolean;
  readonly sockets: readonly LaidOutSocket[];
}

interface LayoutSocketInput {
  readonly identifier: string;
  readonly name: string;
  readonly label: string | null;
  readonly type: string;
  readonly shape: string;
  readonly enabled: boolean;
  readonly hide: boolean;
  readonly hideValue: boolean;
  readonly linked: boolean;
  readonly multiInput: boolean;
  readonly value: number | string | boolean | readonly number[] | null;
  /** The `default_value` property's SOFT range, present only when the socket
   *  is a bounded scalar — which is exactly Blender's own test for drawing a
   *  NUMBER SLIDER rather than a flat number field. Absent means no fill. */
  readonly softMin?: number;
  readonly softMax?: number;
}

interface LayoutNodeInput {
  readonly name: string;
  readonly location: readonly number[];
  readonly width: number;
  readonly collapsed: boolean;
  readonly inputs: readonly LayoutSocketInput[];
  readonly outputs: readonly LayoutSocketInput[];
}

/** Blender's own availability test: a socket that is not `enabled`, or is
 *  `hide`, occupies no row and draws no mark. */
export function socketDraws(socket: LayoutSocketInput): boolean {
  return socket.enabled && !socket.hide;
}

/**
 * ONE NODE, LAID OUT — `node_update_basis` (`node_draw.cc:1288-1324`) run
 * over the facts RNA answers.
 *
 * ```
 * loc = node.location            node_draw.cc:1295
 * dy  = loc.y                    node_draw.cc:1297
 * dy -= NODE_DY                  node_draw.cc:1300   // the header, exactly 20
 * …outputs, then inputs…
 * xmin = loc.x ; xmax = loc.x + NODE_WIDTH(node)     node_draw.cc:1309-1310
 * ymax = loc.y ; ymin = min(dy, loc.y - 2 * NODE_DY) node_draw.cc:1311-1312
 * ```
 * — so a node is never shorter than two header-heights, 40.
 *
 * WHICH OF BLENDER'S TWO BODY PATHS THIS IS, and the one divergence it
 * carries. `node_update_basis` branches on `is_node_panels_supported()` =
 * `decl->use_custom_socket_order` (`node_draw.cc:343-346, 1302-1307`):
 *
 *  - the DECLARATION path (`node_update_basis_from_declaration`, `:1086-1218`)
 *    spaces items through one margin table in units of `NODE_ITEM_SPACING_Y`
 *    (`:886-1000`): 2× before the first socket, 1× between two sockets, 2×
 *    after the last;
 *  - the LEGACY path (`node_update_basis_from_socket_lists`, `:1227-1283`)
 *    uses `NODE_DYS / 2` = 5 at the top, `NODE_ITEM_SPACING_Y` between
 *    sockets, `NODE_DY / 4` = 5 between the outputs and the inputs, and
 *    `NODE_DYS / 2` = 5 at the bottom.
 *
 * RNA EXPOSES NO `use_custom_socket_order`, so this cannot be read from the
 * engine. The declaration path is the one Blender 5.2 lays nearly every
 * built-in node out with, so it is the one implemented, and the cost is
 * STATED rather than hidden: a node Blender lays out the legacy way sits
 * 1 px lower at its first socket, 3 px lower at its first input, and ends
 * 1 px further down — at most 5 px over a whole node.
 */
export function layoutNode(node: LayoutNodeInput): LaidOutNode {
  const x = node.location[0] ?? 0;
  const top = node.location[1] ?? 0;
  const width = node.width;
  const outputs = node.outputs.filter(socketDraws);
  const inputs = node.inputs.filter(socketDraws);

  if (node.collapsed) {
    // `node_update_collapsed`, node_draw.cc:1345-1378.
    const pitch = COLLAPSED_SOCKET_PITCH;
    const height = pitch * Math.max(inputs.length, outputs.length, 2) + BASIS_RAD * 2;
    const yTop = top + height / 2 + COLLAPSED_OFFSET_Y;
    const yBottom = top - height / 2 + COLLAPSED_OFFSET_Y;
    const place = (list: readonly LayoutSocketInput[], output: boolean): LaidOutSocket[] => {
      let y = top + pitch * (list.length - 1) * 0.5 + COLLAPSED_OFFSET_Y;
      return list.map((socket) => {
        const placed = socketAt(socket, output, output ? x + width : x, y, y);
        y -= pitch;
        return placed;
      });
    };
    return {
      name: node.name,
      x,
      yTop,
      yBottom,
      width,
      collapsed: true,
      sockets: [...place(outputs, true), ...place(inputs, false)],
    };
  }

  let dy = top - NODE_DY; // the header — node_draw.cc:1300
  const sockets: LaidOutSocket[] = [];
  const row = (socket: LayoutSocketInput, output: boolean): void => {
    const rowTop = dy;
    // `input.location = (locx, locy - NODE_DYS)` — node_draw.cc:533-541.
    sockets.push(socketAt(socket, output, output ? x + width : x, rowTop - NODE_DYS, rowTop));
    // `buty = min(buty, topy - NODE_DY)` — node_draw.cc:567: a row is never
    // shorter than one unit, and an inline value widget is exactly one
    // `UI_UNIT_Y` (= NODE_DY) tall, so it never grows the row.
    dy = rowTop - NODE_DY;
  };

  if (outputs.length > 0 || inputs.length > 0) {
    dy -= 2 * NODE_ITEM_SPACING_Y; // top margin before a Socket — node_draw.cc:841-859
  }
  outputs.forEach((socket, index) => {
    if (index > 0) dy -= NODE_ITEM_SPACING_Y; // Socket→Socket — node_draw.cc:886-1000
    row(socket, true);
  });
  if (outputs.length > 0 && inputs.length > 0) dy -= NODE_ITEM_SPACING_Y;
  inputs.forEach((socket, index) => {
    if (index > 0 || outputs.length > 0) {
      if (index > 0) dy -= NODE_ITEM_SPACING_Y;
    }
    row(socket, false);
  });
  if (outputs.length > 0 || inputs.length > 0) {
    dy -= 2 * NODE_ITEM_SPACING_Y; // bottom margin after a Socket — node_draw.cc:863-882
  } else {
    dy -= NODE_DYS; // `get_margin_empty()` — node_draw.cc:835-838
  }

  return {
    name: node.name,
    x,
    yTop: top,
    // `ymin = min_ff(dy, loc.y - 2 * NODE_DY)` — node_draw.cc:1311.
    yBottom: Math.min(dy, top - 2 * NODE_DY),
    width,
    collapsed: false,
    sockets,
  };
}

function socketAt(
  socket: LayoutSocketInput,
  output: boolean,
  x: number,
  y: number,
  rowTop: number,
  panelCollapsed = false,
): LaidOutSocket {
  return {
    identifier: socket.identifier,
    name: socket.label ?? socket.name,
    type: socket.type,
    shape: socket.shape,
    output,
    linked: socket.linked,
    multiInput: socket.multiInput,
    hideValue: socket.hideValue,
    value: socket.value,
    ...(socket.softMin === undefined ? {} : { softMin: socket.softMin }),
    ...(socket.softMax === undefined ? {} : { softMax: socket.softMax }),
    x,
    y,
    rowTop,
    panelCollapsed,
  };
}

/**
 * A NOODLE'S TWO CONTROL POINTS — `calculate_inner_link_bezier_points`
 * (`space_node/drawnode.cc:1747-1773`), verbatim:
 *
 * ```
 * if (curving == 0) { P1 = lerp(P0,P3,1/3); P2 = lerp(P0,P3,2/3); }
 * else {
 *   dist_x = |P3.x - P0.x| ; dist_y = |P3.y - P0.y| ; slope = dist_y / dist_x
 *   clamp_factor  = min(1, slope * (4.5 - 0.25 * curving))
 *   handle_offset = curving * 0.1 * dist_x * clamp_factor
 *   P1 = (P0.x + handle_offset, P0.y) ; P2 = (P3.x - handle_offset, P3.y)
 * }
 * ```
 * `curving` is the THEME's `TH_NODE_CURVING` (`resources.cc:713-714`), which
 * the shipped theme sets to 4 (`userdef_default_theme.c:670`).
 */
export function linkHandles(
  from: readonly [number, number],
  to: readonly [number, number],
  curving: number = NODE_THEME.noodleCurving,
): [[number, number], [number, number]] {
  if (curving === 0) {
    return [
      [from[0] + (to[0] - from[0]) / 3, from[1] + (to[1] - from[1]) / 3],
      [from[0] + ((to[0] - from[0]) * 2) / 3, from[1] + ((to[1] - from[1]) * 2) / 3],
    ];
  }
  const distX = Math.abs(to[0] - from[0]);
  const distY = Math.abs(to[1] - from[1]);
  // `slope` divides by dist_x; Blender's own code does the same and relies on
  // the clamp below, which `min(1, Infinity)` answers correctly for a
  // perfectly vertical link.
  const slope = distX === 0 ? Number.POSITIVE_INFINITY : distY / distX;
  const clampFactor = Math.min(1, slope * (4.5 - 0.25 * curving));
  const handle = curving * 0.1 * distX * clampFactor;
  return [
    [from[0] + handle, from[1]],
    [to[0] - handle, to[1]],
  ];
}

/**
 * THE HEADER'S COLOUR for one node, following `node_get_colorid`'s two
 * conditions that a colour tag alone does not answer:
 *
 *  - an OUTPUT-class node takes the output colour only when it is the ACTIVE
 *    output, and otherwise `TH_NODE` (`node_draw.cc:1395-1401`);
 *  - a FRAME takes `TH_NODE_FRAME`, the `NODE_CLASS_LAYOUT` branch
 *    (`node_draw.cc:1429-1430`); `color_tag` has no member for it.
 *
 * A node with `use_custom_color` keeps the CLASS header and recolours its
 * BODY (`node_draw.cc:2793-2795, 3145-3147`): the custom-colour header is the
 * COLLAPSED path only, which {@link nodeBodyColor} and the view both follow.
 */
export function nodeHeaderColor(node: {
  readonly colorTag: string;
  readonly idname: string;
  readonly activeOutput: boolean;
}): string {
  if (node.idname === 'NodeFrame') return NODE_THEME.frame;
  if (node.colorTag === 'OUTPUT' && !node.activeOutput) return NODE_THEME.body;
  return NODE_HEADER_COLOR[node.colorTag] ?? NODE_THEME.body;
}

/** `TH_NODE`, or the node's own colour when `NODE_CUSTOM_COLOR`
 *  (`node_draw.cc:3145-3149`). */
export function nodeBodyColor(node: {
  readonly useCustomColor: boolean;
  readonly color: readonly number[];
}): string {
  if (!node.useCustomColor) return NODE_THEME.body;
  return rgbFloatsToHex(node.color);
}

export function rgbFloatsToHex(channels: readonly number[]): string {
  const byte = (value: number): string =>
    Math.round(Math.min(1, Math.max(0, value)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${byte(channels[0] ?? 0)}${byte(channels[1] ?? 0)}${byte(channels[2] ?? 0)}`;
}

/**
 * A MUTED NODE. `get_color_blend_alpha_4fv(color, TH_BACK, factor, -0.2)`:
 * the header blends 0.6 toward the background and the body 0.8, and both lose
 * 0.2 of alpha (`node_draw.cc:2806-2814` and `:3159-3163`). Two different
 * factors on one node, which is why this takes one.
 */
export function mutedToward(color: string, factor: number): string {
  const back = hexToRgb(NODE_THEME.background);
  const own = hexToRgb(color);
  return rgbFloatsToHex([
    own[0] * (1 - factor) + back[0] * factor,
    own[1] * (1 - factor) + back[1] * factor,
    own[2] * (1 - factor) + back[2] * factor,
  ]);
}
export const MUTED_HEADER_FACTOR = 0.6;
export const MUTED_BODY_FACTOR = 0.8;
export const MUTED_ALPHA_DROP = 0.2;

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

/** The colour a socket's mark is filled with. */
export function socketColor(type: string): string {
  return SOCKET_COLOR[type] ?? SOCKET_COLOR_UNKNOWN;
}

/* -------------------------------------------------------------------------- */
/* SOCKET PANELS — `node_update_basis_from_declaration`'s other half           */
/* -------------------------------------------------------------------------- */

/**
 * A PANEL HEADER'S ROW, in the layout: `NODE_DYS` tall, its centre exactly
 * half that below where the row starts — `locy -= h/2; center = locy;
 * locy -= h/2` (`node_draw.cc:1189-1195`). It is HALF a socket row, which is
 * the whole reason eight collapsed panels cost 160 px where their thirty
 * sockets cost 660.
 */
export const PANEL_HEADER_HEIGHT = NODE_DYS;

/**
 * The header's DRAWN band is twice its laid-out height — `center ± NODE_DYS`
 * (`node_draw.cc:2005-2008`) — so two consecutive headers' bands abut exactly
 * at the 20-unit pitch they sit at.
 */
export const PANEL_HEADER_BAND = 2 * NODE_DYS;

/** `header_but_margin = NODE_MARGIN_X / 3` — where the triangle starts, and
 *  the inset the whole header button takes (`node_draw.cc:2031-2038`). */
export const PANEL_HEADER_MARGIN_X = NODE_MARGIN_X / 3;
/** `but_padding = NODE_MARGIN_X / 4` — triangle to label (`node_draw.cc:2034`). */
export const PANEL_HEADER_BUT_PADDING = NODE_MARGIN_X / 4;
/** `UI_UNIT_X` (`UI_interface_c.hh:2346`) — the width a panel TOGGLE checkbox
 *  takes before the label, when the panel declares one
 *  (`node_draw.cc:2059-2078`). */
export const UI_UNIT_X = WIDGET_UNIT;

/**
 * BLENDER'S PANEL TRIANGLE, as geometry rather than as a lookalike.
 *
 * `node_draw_panels` asks for `ICON_RIGHTARROW` when the panel is collapsed
 * and `ICON_DOWNARROW_HLT` when it is open, at `but_size = U.widget_unit *
 * 0.8` = {@link NODE_HEADER_ICON_SIZE} (`node_draw.cc:2035-2046`). Both marks
 * are single stroked chevrons, and these numbers are read straight off their
 * own path data in the checkout:
 *
 * - `release/datafiles/icons_svg/rightarrow.svg` —
 *   `l3.64649 3.64648 -3.64649 3.64648` with a `.50005` round cap, under
 *   `matrix(100 0 0 100 -40899.645 -60100.058)`: a chevron reaching **4**
 *   units along its axis and **±3.646** across, stroked **1** unit wide, on
 *   Blender's **8**-unit small-icon cell.
 * - `downarrow_hlt.svg` — `l4 4 4 -4`, the same chevron turned a quarter.
 *
 * DELIBERATELY NOT ADDED TO `blender.icons.traced.json`, and the reason is a
 * measured defect in that trace rather than a preference:
 * `traceBlenderIcon`'s one scaling rule is `16 / viewBox.width`, which is
 * right only for the 1600-wide artboards that carry a `matrix(100 …)`.
 * These two files are 700x1100 and 1100x700, and **13 glyphs already in that
 * set** come from non-1600 artboards and are scaled wrong —
 * `blender-mod-particle-instance` traces to a box at **[273, -60]**, off the
 * 16-unit grid entirely, and `rightarrow` would have traced to a 10.8x20.3
 * mark. Correcting that trace moves twelve shipped marks and belongs to
 * whoever owns the icon set; stating it here, with the numbers, is this
 * unit's honest half.
 */
export const PANEL_TRIANGLE = {
  /** Blender's small-icon cell — the space the numbers below are on. */
  cell: 8,
  /** The chevron's reach along its axis, and across it. */
  reach: 4,
  spread: 3.64648,
  /** `2 x .50005`, the round cap's diameter. */
  stroke: 1,
} as const;

/**
 * A PANEL'S CONTENT BACKGROUND — `TH_PANEL_SUB_BACK`
 * (`resources.cc:298-300` ← `.tui.panel_sub_back` `0x0000001f`,
 * `userdef_default_theme.c:283`), with its alpha multiplied by **1.5** to
 * "increase contrast in nodes a bit" (`node_draw.cc:1918-1920`). The final
 * panel — the one whose content runs to the node's bottom edge — is filled
 * `depth + 1` TIMES over (`node_draw.cc:1951-1956`), so a nested final panel
 * is visibly darker; that repetition is alpha compositing and is drawn as
 * such rather than pre-multiplied into a second constant.
 */
export const PANEL_SUB_BACK = '#000000';
export const PANEL_SUB_BACK_ALPHA = (0x1f / 255) * 1.5;

/**
 * One item of a TRACED declaration — a row of `blender.node-panels.json`,
 * which is `blender-node-panels.source.mjs`'s reading of the node's C++
 * `declare()` body. The five kinds are `flat_item::Type`'s five
 * (`node_draw.cc:798-831`).
 */
export type NodeDeclItem =
  | {
      readonly kind: 'input' | 'output';
      readonly name: string;
      readonly identifier?: string;
      readonly panelToggle?: boolean;
      readonly conditional?: boolean;
      readonly alignWithPrevious?: boolean;
    }
  | {
      readonly kind: 'panel';
      readonly name: string;
      readonly defaultClosed?: boolean;
      readonly items: readonly NodeDeclItem[];
    }
  | { readonly kind: 'layout' }
  | { readonly kind: 'separator' };

export interface NodeDeclaration {
  readonly customSocketOrder: boolean;
  readonly conditional?: boolean;
  readonly items: readonly NodeDeclItem[];
}

/** A socket's identifier defaults to its name
 *  (`DeclarationListBuilder::add_socket`), which is what the traced table
 *  omits when the two agree. */
const declIdentifier = (item: { readonly name: string; readonly identifier?: string }): string =>
  item.identifier ?? item.name;

/**
 * DOES THE TRACED DECLARATION DESCRIBE THIS LIVE NODE?
 *
 * The ruling's own condition — "when the live socket list disagrees with the
 * traced declaration the view draws flat with the frame warning it draws
 * today". The check is STRICT and ordered: every socket the declaration
 * names, in declaration order, against `node.inputs`/`node.outputs` by
 * IDENTIFIER.
 *
 * Strict is the right strength because an UNAVAILABLE socket is still in the
 * live list: `.available(false)` sets `SOCK_UNAVAIL`, which RNA reports as
 * `enabled == False`, not as an absent socket. So a declaration that matches
 * the engine matches it exactly, and anything less is the engine having moved
 * out from under the trace — a different Blender, a `declare()` that took the
 * other arm of an `if`, a node group whose panels are runtime data. Each of
 * those must fall back, and be SEEN to.
 */
export function declarationAgrees(
  declaration: NodeDeclaration,
  inputs: readonly { readonly identifier: string }[],
  outputs: readonly { readonly identifier: string }[],
): { readonly ok: true } | { readonly ok: false; readonly why: string } {
  if (!declaration.customSocketOrder) {
    return {
      ok: false,
      why: 'its declaration does not set use_custom_socket_order, so Blender lays it out the legacy way',
    };
  }
  const declaredIn: string[] = [];
  const declaredOut: string[] = [];
  const collect = (items: readonly NodeDeclItem[]): void => {
    for (const item of items) {
      if (item.kind === 'input') declaredIn.push(declIdentifier(item));
      else if (item.kind === 'output') declaredOut.push(declIdentifier(item));
      else if (item.kind === 'panel') collect(item.items);
    }
  };
  collect(declaration.items);
  const compare = (
    declared: readonly string[],
    live: readonly { readonly identifier: string }[],
    side: string,
  ): string | null => {
    if (declared.length !== live.length) {
      return `the declaration names ${declared.length} ${side}${declared.length === 1 ? '' : 's'} and the engine reports ${live.length}`;
    }
    for (let index = 0; index < declared.length; index++) {
      if (declared[index] !== live[index]?.identifier) {
        return `${side} ${index} is "${live[index]?.identifier}" in the engine and "${declared[index]}" in the declaration`;
      }
    }
    return null;
  };
  const why = compare(declaredOut, outputs, 'output') ?? compare(declaredIn, inputs, 'input');
  return why === null ? { ok: true } : { ok: false, why };
}

/** A panel as the view draws it: the band, the label, and the extent of the
 *  content beneath it while it is open. */
export interface LaidOutPanel {
  readonly name: string;
  readonly depth: number;
  readonly collapsed: boolean;
  /** `panel_runtime.header_center_y` (`node_draw.cc:1193`). */
  readonly centerY: number;
  /** `content_extent` (`node_draw.cc:1204-1210`) — absent while the panel is
   *  collapsed, because a collapsed panel appends no `PanelContentBegin`. */
  readonly contentTop: number | null;
  readonly contentBottom: number | null;
  /** `content_extent->fill_node_end` (`tag_final_panel`,
   *  `node_draw.cc:1063-1082`): this panel's fill runs to the node's bottom
   *  edge, and is drawn `depth + 1` times. */
  readonly fillsNodeEnd: boolean;
  /** The panel's own header checkbox, when it declares one
   *  (`PanelDeclaration::panel_input_decl()`). */
  readonly toggle: LaidOutSocket | null;
}

/** What a flattened item is, for the margin table. Named exactly as
 *  `flat_item::Type` names them (`node_draw.cc:798-831`). */
type FlatType =
  | 'Socket'
  | 'Layout'
  | 'Separator'
  | 'PanelHeader'
  | 'PanelContentBegin'
  | 'PanelContentEnd';

/** `get_margin_from_top` (`node_draw.cc:838-857`), in units of
 *  `NODE_ITEM_SPACING_Y`. */
const MARGIN_FROM_TOP: Partial<Record<FlatType, number>> = {
  Socket: 2,
  Separator: 0.5,
  Layout: 3,
  PanelHeader: 4,
};

/** `get_margin_to_bottom` (`node_draw.cc:860-882`). */
const MARGIN_TO_BOTTOM: Partial<Record<FlatType, number>> = {
  Socket: 2,
  Separator: 1,
  Layout: 5,
  PanelHeader: 4,
  PanelContentEnd: 1,
};

/**
 * `get_margin_between_elements` (`node_draw.cc:885-1000`) — Blender's own
 * "handle all cases explicitly" table, transcribed whole, in units of
 * `NODE_ITEM_SPACING_Y`. A pair the source marks `BLI_assert_unreachable` is
 * absent here and answers 0, which is what that branch returns.
 */
const MARGIN_BETWEEN: Partial<Record<FlatType, Partial<Record<FlatType, number>>>> = {
  Socket: { Socket: 1, Separator: 0, Layout: 2, PanelHeader: 3, PanelContentEnd: 2 },
  Layout: { Socket: 2, Separator: 0, Layout: 1, PanelHeader: 3, PanelContentEnd: 2 },
  Separator: { Socket: 2, Separator: 1, Layout: 1, PanelHeader: 1, PanelContentEnd: 1 },
  PanelHeader: {
    Socket: 4,
    Separator: 3,
    Layout: 3,
    PanelHeader: 5,
    PanelContentBegin: 3,
    PanelContentEnd: 3,
  },
  PanelContentBegin: { Socket: 2, Separator: 1, Layout: 2, PanelHeader: 3, PanelContentEnd: 1 },
  PanelContentEnd: { Socket: 1, Separator: 1, Layout: 1, PanelHeader: 3, PanelContentEnd: 0 },
};

interface FlatItem {
  readonly type: FlatType;
  readonly input?: LayoutSocketInput | undefined;
  readonly output?: LayoutSocketInput | undefined;
  readonly panel?: PanelState | undefined;
}

interface PanelState {
  readonly name: string;
  readonly depth: number;
  readonly collapsed: boolean;
  readonly toggle: LayoutSocketInput | null;
  /** Every socket the panel owns, at any depth — what
   *  `mark_sockets_collapsed_recursive` (`node_draw.cc:1007-1032`) walks to
   *  put a collapsed panel's sockets on its own header row. */
  readonly owned: LayoutSocketInput[];
  centerY: number;
  contentTop: number | null;
  contentBottom: number | null;
  fillsNodeEnd: boolean;
}

/**
 * `make_flat_node_items` (`node_draw.cc:797-831`) over a TRACED declaration
 * and the engine's LIVE sockets.
 *
 * `determine_visible_panels` (`node_draw.cc:691-703`) is folded in as the
 * `owned.some(socketDraws)` test: a panel stands only when it contains a
 * socket that is available and not hidden, and a sub-panel of a COLLAPSED
 * panel never stands at all because `flatten` does not descend into one.
 */
function flatten(
  items: readonly NodeDeclItem[],
  sockets: Map<string, LayoutSocketInput>,
  collapsedOf: (defaultClosed: boolean) => boolean,
  showOptions: boolean,
  depth: number,
  out: FlatItem[],
  panels: PanelState[],
): void {
  let previousVisible = false;
  for (const item of items) {
    if (item.kind === 'input' || item.kind === 'output') {
      const socket = sockets.get(`${item.kind}:${declIdentifier(item)}`);
      if (!socket || !socketDraws(socket)) {
        previousVisible = false;
        continue;
      }
      // `add_flat_items_for_socket`: an ALIGNED socket joins the previous
      // item's row instead of opening one (`node_draw.cc:703-717`).
      const last = out[out.length - 1];
      if (item.alignWithPrevious === true && previousVisible && last && last.type === 'Socket') {
        out[out.length - 1] = {
          type: 'Socket',
          input: item.kind === 'input' ? socket : last.input,
          output: item.kind === 'output' ? socket : last.output,
        };
        previousVisible = true;
        continue;
      }
      out.push({
        type: 'Socket',
        input: item.kind === 'input' ? socket : undefined,
        output: item.kind === 'output' ? socket : undefined,
      });
      previousVisible = true;
      continue;
    }
    previousVisible = false;
    if (item.kind === 'separator') {
      out.push({ type: 'Separator' });
      continue;
    }
    if (item.kind === 'layout') {
      // `add_flat_items_for_layout` returns early unless `NODE_OPTIONS` is set
      // (`node_draw.cc:739-746`), which is `Node.show_options`.
      if (showOptions) out.push({ type: 'Layout' });
      continue;
    }
    // A DISCRIMINANT THAT IS ITSELF A UNION (`kind: 'input' | 'output'`) does
    // not narrow away in the NEGATIVE branch of `a === 'input' || a ===
    // 'output'`, so without this guard `item` still carries that member here
    // and `item.items` does not typecheck. It is a compiler fact, not a real
    // branch.
    if (item.kind !== 'panel') continue;
    // A PANEL. `panel_input_decl()` (`node_declaration.cc:528-542`): the
    // panel's FIRST item, when it is a `panel_toggle` boolean input, is drawn
    // in the header and takes no row of its own.
    const first = item.items[0];
    const toggleDecl = first && first.kind === 'input' && first.panelToggle === true ? first : null;
    const toggle = toggleDecl ? (sockets.get(`input:${declIdentifier(toggleDecl)}`) ?? null) : null;
    const owned: LayoutSocketInput[] = [];
    const gather = (list: readonly NodeDeclItem[]): void => {
      for (const child of list) {
        if (child.kind === 'input' || child.kind === 'output') {
          const socket = sockets.get(`${child.kind}:${declIdentifier(child)}`);
          if (socket) owned.push(socket);
        } else if (child.kind === 'panel') gather(child.items);
      }
    };
    gather(item.items);
    // `determine_potentially_visible_panels` — no available socket, no panel.
    if (!owned.some(socketDraws)) continue;
    const collapsed = collapsedOf(item.defaultClosed === true);
    const panel: PanelState = {
      name: item.name,
      depth,
      collapsed,
      toggle,
      owned,
      centerY: 0,
      contentTop: null,
      contentBottom: null,
      fillsNodeEnd: false,
    };
    panels.push(panel);
    out.push({ type: 'PanelHeader', panel });
    if (collapsed) continue;
    out.push({ type: 'PanelContentBegin', panel });
    flatten(
      item.items.filter((child) => child !== toggleDecl),
      sockets,
      collapsedOf,
      showOptions,
      depth + 1,
      out,
      panels,
    );
    out.push({ type: 'PanelContentEnd', panel });
  }
}

export interface PanelLayoutInput extends LayoutNodeInput {
  readonly declaration: NodeDeclaration;
  /** `Node.panel_states`, in declaration order — `is_collapsed` per panel.
   *  Blender indexes `panel_states_array` by the declaration's panel INDEX
   *  (`node_draw.cc:1037`) and RNA's collection IS that array, so position is
   *  the join and no uid lookup is needed. */
  readonly panelStates: readonly { readonly collapsed: boolean }[];
  /** `Node.show_options` → `NODE_OPTIONS`, which gates a Layout item. */
  readonly showOptions: boolean;
}

export interface LaidOutPanelledNode extends LaidOutNode {
  readonly panels: readonly LaidOutPanel[];
}

/**
 * ONE NODE LAID OUT **WITH ITS PANELS** —
 * `node_update_basis_from_declaration` (`node_draw.cc:1085-1218`) run over
 * the traced declaration and the engine's live sockets.
 *
 * The caller has already satisfied {@link declarationAgrees}; this does not
 * re-check, because a layout that silently half-applies a stale declaration
 * is exactly the failure that check exists to make loud.
 *
 * THE ONE HEIGHT THIS CANNOT READ is a `LayoutDeclaration`'s: its height is
 * whatever its C++ lambda's `block_layout_resolve` answers, and RNA exposes
 * neither the lambda nor its result. Blender's own node layouts here are a
 * single `layout.prop()` row, so ONE `NODE_DY` is reserved — stated rather
 * than assumed, and the divergence is bounded by it: a two-row layout leaves
 * the node 20 short. {@link layoutHasUnreadableRow} is what the view says so
 * with.
 */
export function layoutNodeWithPanels(node: PanelLayoutInput): LaidOutPanelledNode {
  const x = node.location[0] ?? 0;
  const top = node.location[1] ?? 0;
  const width = node.width;
  const sockets = new Map<string, LayoutSocketInput>();
  for (const socket of node.inputs) sockets.set(`input:${socket.identifier}`, socket);
  for (const socket of node.outputs) sockets.set(`output:${socket.identifier}`, socket);

  let panelIndex = 0;
  const states = node.panelStates;
  const items: FlatItem[] = [];
  const panels: PanelState[] = [];
  flatten(
    node.declaration.items,
    sockets,
    (defaultClosed) => states[panelIndex++]?.collapsed ?? defaultClosed,
    node.showOptions,
    0,
    items,
    panels,
  );

  const laid: LaidOutSocket[] = [];
  let dy = top - NODE_DY; // the header — node_draw.cc:1300

  if (items.length === 0) {
    dy -= NODE_DYS; // `get_margin_empty()` — node_draw.cc:833-836
  }
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (!item) continue;
    const previous = items[index - 1];
    const margin =
      index === 0
        ? (MARGIN_FROM_TOP[item.type] ?? 0)
        : (MARGIN_BETWEEN[previous?.type ?? 'Socket']?.[item.type] ?? 0);
    dy -= margin * NODE_ITEM_SPACING_Y;

    if (item.type === 'Socket') {
      const rowTop = dy;
      if (item.output) laid.push(socketAt(item.output, true, x + width, rowTop - NODE_DYS, rowTop));
      if (item.input) laid.push(socketAt(item.input, false, x, rowTop - NODE_DYS, rowTop));
      dy = rowTop - NODE_DY; // `buty = min(buty, topy - NODE_DY)` — node_draw.cc:567
      continue;
    }
    if (item.type === 'Layout' || item.type === 'Separator') {
      // A separator is `layout.separator(1.0, Line)` in a `NODE_DY`-tall block
      // (`node_draw.cc:1176-1187`); the Layout's reservation is the header's
      // stated approximation.
      dy -= NODE_DY;
      continue;
    }
    if (item.type === 'PanelHeader' && item.panel) {
      dy -= PANEL_HEADER_HEIGHT / 2;
      item.panel.centerY = dy;
      dy -= PANEL_HEADER_HEIGHT / 2;
      if (item.panel.toggle) {
        laid.push(socketAt(item.panel.toggle, false, x, item.panel.centerY, item.panel.centerY));
      }
      continue;
    }
    if (item.type === 'PanelContentBegin' && item.panel) item.panel.contentTop = dy;
    if (item.type === 'PanelContentEnd' && item.panel) item.panel.contentBottom = dy;
  }

  const last = items[items.length - 1];
  if (last) dy -= (MARGIN_TO_BOTTOM[last.type] ?? 0) * NODE_ITEM_SPACING_Y;

  // `update_collapsed_sockets` (`node_draw.cc:1050-1060`): every socket inside
  // a COLLAPSED panel is placed on that panel's HEADER row at the node's own
  // edge and marked `SOCK_PANEL_COLLAPSED`, which is how a link into a hidden
  // socket still lands somewhere visible.
  for (const panel of panels) {
    if (!panel.collapsed) continue;
    for (const socket of panel.owned) {
      if (!socketDraws(socket)) continue;
      const output = node.outputs.includes(socket);
      laid.push(
        socketAt(socket, output, output ? x + width : x, panel.centerY, panel.centerY, true),
      );
    }
  }

  // `tag_final_panel` (`node_draw.cc:1063-1082`): walking back from the end,
  // the innermost panel whose content runs to the node's very bottom.
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index];
    if (!item || item.type !== 'PanelContentEnd') break;
    if (item.panel) item.panel.fillsNodeEnd = true;
  }

  return {
    name: node.name,
    x,
    yTop: top,
    yBottom: Math.min(dy, top - 2 * NODE_DY),
    width,
    collapsed: false,
    sockets: laid,
    panels: panels.map((panel) => ({
      name: panel.name,
      depth: panel.depth,
      collapsed: panel.collapsed,
      centerY: panel.centerY,
      contentTop: panel.contentTop,
      contentBottom: panel.contentBottom,
      fillsNodeEnd: panel.fillsNodeEnd,
      toggle: panel.toggle ? socketAt(panel.toggle, false, x, panel.centerY, panel.centerY) : null,
    })),
  };
}

/** Does this declaration contain a `LayoutDeclaration`, whose drawn height
 *  cannot be read? The view names the node in its status line when it does,
 *  rather than let a bounded approximation pass as a measurement. */
export function layoutHasUnreadableRow(declaration: NodeDeclaration): boolean {
  const walk = (items: readonly NodeDeclItem[]): boolean =>
    items.some((item) =>
      item.kind === 'layout' ? true : item.kind === 'panel' ? walk(item.items) : false,
    );
  return walk(declaration.items);
}
