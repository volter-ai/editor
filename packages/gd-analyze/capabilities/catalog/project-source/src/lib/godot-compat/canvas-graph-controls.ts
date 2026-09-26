/** Godot 4 GraphEdit/GraphElement/GraphNode/GraphFrame over retained Pixi containers. */

import {
  Container,
  Graphics,
  Rectangle,
  Text,
  type FederatedPointerEvent,
  type FederatedWheelEvent,
  type Texture,
} from 'pixi.js';

import type { ColorValue } from './variant';
import type { ControlPoint } from './control-state';
import { bindCanvasControl, getCanvasControlSize, setCanvasControlSize } from './canvas-control-state';
import { getName, markInternalCanvasChild, registerCanvasNodeRelease } from './node';
import { registerGodotObjectIdentity } from './object';
import { createSignal, type GodotSignal } from './signal';

export interface GodotGraphConnection {
  readonly from_node: string;
  readonly from_port: number;
  readonly to_node: string;
  readonly to_port: number;
  readonly keep_alive: boolean;
}

export interface GodotGraphConnectionHit extends GodotGraphConnection {
  readonly segment: number;
}

export interface GodotGraphSlot {
  enabledLeft: boolean;
  typeLeft: number;
  colorLeft: ColorValue;
  customIconLeft: Texture | null;
  metadataLeft: unknown;
  enabledRight: boolean;
  typeRight: number;
  colorRight: ColorValue;
  customIconRight: Texture | null;
  metadataRight: unknown;
  drawStyleBox: boolean;
}

export interface GodotCanvasGraphElement extends Container {
  position_offset: ControlPoint;
  resizable: boolean;
  draggable: boolean;
  selectable: boolean;
  selected: boolean;
  scaling_menus: boolean;
  readonly node_selected: GodotSignal<readonly []>;
  readonly node_deselected: GodotSignal<readonly []>;
  readonly dragged: GodotSignal<readonly [ControlPoint, ControlPoint]>;
  readonly resize_request: GodotSignal<readonly [ControlPoint]>;
  readonly resize_end: GodotSignal<readonly [ControlPoint]>;
  readonly delete_request: GodotSignal<readonly []>;
  readonly position_offset_changed: GodotSignal<readonly []>;
  readonly raise_request: GodotSignal<readonly []>;
  set_position_offset(value: ControlPoint): void;
  get_position_offset(): ControlPoint;
  set_resizable(enabled: boolean): void;
  is_resizable(): boolean;
  set_draggable(enabled: boolean): void;
  is_draggable(): boolean;
  set_selectable(enabled: boolean): void;
  is_selectable(): boolean;
  set_selected(enabled: boolean): void;
  is_selected(): boolean;
  set_scaling_menus(enabled: boolean): void;
  is_scaling_menus(): boolean;
}

export interface GodotCanvasGraphNode extends GodotCanvasGraphElement {
  title: string;
  ignore_invalid_connection_type: boolean;
  slots_focus_mode: number;
  readonly slot_updated: GodotSignal<readonly [number]>;
  readonly slot_sizes_changed: GodotSignal<readonly []>;
  set_title(value: string): void;
  get_title(): string;
  get_titlebar_hbox(): Container;
  set_slot(
    slot: number,
    enableLeft: boolean,
    typeLeft: number,
    colorLeft: ColorValue,
    enableRight: boolean,
    typeRight: number,
    colorRight: ColorValue,
    customIconLeft?: Texture | null,
    customIconRight?: Texture | null,
    drawStyleBox?: boolean,
  ): void;
  clear_slot(slot: number): void;
  clear_all_slots(): void;
  is_slot_enabled_left(slot: number): boolean;
  set_slot_enabled_left(slot: number, enabled: boolean): void;
  set_slot_type_left(slot: number, type: number): void;
  get_slot_type_left(slot: number): number;
  set_slot_color_left(slot: number, color: ColorValue): void;
  get_slot_color_left(slot: number): ColorValue;
  set_slot_custom_icon_left(slot: number, texture: Texture | null): void;
  get_slot_custom_icon_left(slot: number): Texture | null;
  set_slot_metadata_left(slot: number, metadata: unknown): void;
  get_slot_metadata_left(slot: number): unknown;
  is_slot_enabled_right(slot: number): boolean;
  set_slot_enabled_right(slot: number, enabled: boolean): void;
  set_slot_type_right(slot: number, type: number): void;
  get_slot_type_right(slot: number): number;
  set_slot_color_right(slot: number, color: ColorValue): void;
  get_slot_color_right(slot: number): ColorValue;
  set_slot_custom_icon_right(slot: number, texture: Texture | null): void;
  get_slot_custom_icon_right(slot: number): Texture | null;
  set_slot_metadata_right(slot: number, metadata: unknown): void;
  get_slot_metadata_right(slot: number): unknown;
  is_slot_draw_stylebox(slot: number): boolean;
  set_slot_draw_stylebox(slot: number, enabled: boolean): void;
  set_ignore_invalid_connection_type(enabled: boolean): void;
  is_ignoring_valid_connection_type(): boolean;
  set_slots_focus_mode(mode: number): void;
  get_slots_focus_mode(): number;
  get_input_port_count(): number;
  get_input_port_position(port: number): ControlPoint;
  get_input_port_type(port: number): number;
  get_input_port_color(port: number): ColorValue;
  get_input_port_slot(port: number): number;
  get_output_port_count(): number;
  get_output_port_position(port: number): ControlPoint;
  get_output_port_type(port: number): number;
  get_output_port_color(port: number): ColorValue;
  get_output_port_slot(port: number): number;
}

export interface GodotCanvasGraphFrame extends GodotCanvasGraphElement {
  title: string;
  autoshrink_enabled: boolean;
  autoshrink_margin: number;
  drag_margin: number;
  tint_color_enabled: boolean;
  tint_color: ColorValue;
  readonly autoshrink_changed: GodotSignal<readonly []>;
  set_title(value: string): void;
  get_title(): string;
  get_titlebar_hbox(): Container;
  set_autoshrink_enabled(enabled: boolean): void;
  is_autoshrink_enabled(): boolean;
  set_autoshrink_margin(value: number): void;
  get_autoshrink_margin(): number;
  set_drag_margin(value: number): void;
  get_drag_margin(): number;
  set_tint_color_enabled(enabled: boolean): void;
  is_tint_color_enabled(): boolean;
  set_tint_color(value: ColorValue): void;
  get_tint_color(): ColorValue;
}

export interface GodotCanvasGraphEdit extends Container {
  scroll_offset: ControlPoint;
  show_grid: boolean;
  grid_pattern: number;
  snapping_enabled: boolean;
  snapping_distance: number;
  panning_scheme: number;
  right_disconnects: boolean;
  type_names: Readonly<Record<number, string>>;
  connection_lines_curvature: number;
  connection_lines_thickness: number;
  connection_lines_antialiased: boolean;
  zoom: number;
  zoom_min: number;
  zoom_max: number;
  zoom_step: number;
  minimap_enabled: boolean;
  minimap_size: ControlPoint;
  minimap_opacity: number;
  show_menu: boolean;
  show_zoom_label: boolean;
  show_zoom_buttons: boolean;
  show_grid_buttons: boolean;
  show_minimap_button: boolean;
  show_arrange_button: boolean;
  connections: readonly GodotGraphConnection[];
  readonly connection_request: GodotSignal<readonly [string, number, string, number]>;
  readonly disconnection_request: GodotSignal<readonly [string, number, string, number]>;
  readonly connection_drag_started: GodotSignal<readonly [string, number, boolean]>;
  readonly connection_drag_ended: GodotSignal<readonly []>;
  readonly connection_to_empty: GodotSignal<readonly [string, number, ControlPoint]>;
  readonly connection_from_empty: GodotSignal<readonly [string, number, ControlPoint]>;
  readonly copy_nodes_request: GodotSignal<readonly []>;
  readonly cut_nodes_request: GodotSignal<readonly []>;
  readonly paste_nodes_request: GodotSignal<readonly []>;
  readonly duplicate_nodes_request: GodotSignal<readonly []>;
  readonly delete_nodes_request: GodotSignal<readonly [readonly string[]]>;
  readonly node_selected: GodotSignal<readonly [GodotCanvasGraphElement]>;
  readonly node_deselected: GodotSignal<readonly [GodotCanvasGraphElement]>;
  readonly begin_node_move: GodotSignal<readonly []>;
  readonly end_node_move: GodotSignal<readonly []>;
  readonly scroll_offset_changed: GodotSignal<readonly [ControlPoint]>;
  readonly frame_rect_changed: GodotSignal<readonly [GodotCanvasGraphFrame, { position: ControlPoint; size: ControlPoint }]>;
  readonly popup_request: GodotSignal<readonly [ControlPoint]>;
  readonly graph_elements_linked_to_frame_request: GodotSignal<readonly [readonly string[], string]>;
  connect_node(fromNode: string, fromPort: number, toNode: string, toPort: number, keepAlive?: boolean): number;
  is_node_connected(fromNode: string, fromPort: number, toNode: string, toPort: number): boolean;
  disconnect_node(fromNode: string, fromPort: number, toNode: string, toPort: number): void;
  set_connection_activity(fromNode: string, fromPort: number, toNode: string, toPort: number, amount: number): void;
  set_connections(connections: readonly GodotGraphConnection[]): void;
  get_connection_list(): readonly GodotGraphConnection[];
  get_connection_count(): number;
  get_closest_connection_at_point(point: ControlPoint, maxDistance?: number): GodotGraphConnectionHit | Readonly<Record<string, never>>;
  get_connection_list_from_node(node: string): readonly GodotGraphConnection[];
  get_connections_intersecting_with_rect(rect: { position: ControlPoint; size: ControlPoint }): readonly GodotGraphConnection[];
  clear_connections(): void;
  force_connection_drag_end(): void;
  set_scroll_offset(value: ControlPoint): void;
  get_scroll_offset(): ControlPoint;
  add_valid_right_disconnect_type(type: number): void;
  remove_valid_right_disconnect_type(type: number): void;
  add_valid_left_disconnect_type(type: number): void;
  remove_valid_left_disconnect_type(type: number): void;
  add_valid_connection_type(fromType: number, toType: number): void;
  remove_valid_connection_type(fromType: number, toType: number): void;
  is_valid_connection_type(fromType: number, toType: number): boolean;
  get_connection_line(from: ControlPoint, to: ControlPoint): readonly ControlPoint[];
  attach_graph_element_to_frame(element: string, frame: string): void;
  detach_graph_element_from_frame(element: string): void;
  get_element_frame(element: string): string;
  get_attached_nodes_of_frame(frame: string): readonly string[];
  set_panning_scheme(value: number): void;
  get_panning_scheme(): number;
  set_zoom(value: number): void;
  get_zoom(): number;
  set_zoom_min(value: number): void;
  get_zoom_min(): number;
  set_zoom_max(value: number): void;
  get_zoom_max(): number;
  set_zoom_step(value: number): void;
  get_zoom_step(): number;
  set_show_grid(enabled: boolean): void;
  is_showing_grid(): boolean;
  set_grid_pattern(value: number): void;
  get_grid_pattern(): number;
  set_snapping_enabled(enabled: boolean): void;
  is_snapping_enabled(): boolean;
  set_snapping_distance(value: number): void;
  get_snapping_distance(): number;
  set_connection_lines_curvature(value: number): void;
  get_connection_lines_curvature(): number;
  set_connection_lines_thickness(value: number): void;
  get_connection_lines_thickness(): number;
  set_connection_lines_antialiased(enabled: boolean): void;
  is_connection_lines_antialiased(): boolean;
  set_minimap_size(value: ControlPoint): void;
  get_minimap_size(): ControlPoint;
  set_minimap_opacity(value: number): void;
  get_minimap_opacity(): number;
  set_minimap_enabled(enabled: boolean): void;
  is_minimap_enabled(): boolean;
  set_show_menu(enabled: boolean): void;
  is_showing_menu(): boolean;
  set_show_zoom_label(enabled: boolean): void;
  is_showing_zoom_label(): boolean;
  set_show_grid_buttons(enabled: boolean): void;
  is_showing_grid_buttons(): boolean;
  set_show_zoom_buttons(enabled: boolean): void;
  is_showing_zoom_buttons(): boolean;
  set_show_minimap_button(enabled: boolean): void;
  is_showing_minimap_button(): boolean;
  set_show_arrange_button(enabled: boolean): void;
  is_showing_arrange_button(): boolean;
  set_right_disconnects(enabled: boolean): void;
  is_right_disconnects_enabled(): boolean;
  set_type_names(value: Readonly<Record<number, string>>): void;
  get_type_names(): Readonly<Record<number, string>>;
  arrange_nodes(): void;
  set_selected(element: GodotCanvasGraphElement | null): void;
  get_menu_hbox(): Container;
}

interface GraphElementState {
  readonly chrome: Graphics;
  readonly titleText: Text;
  readonly titleBar: Container;
  readonly nodeSelected: ReturnType<typeof createSignal<readonly []>>;
  readonly nodeDeselected: ReturnType<typeof createSignal<readonly []>>;
  readonly dragged: ReturnType<typeof createSignal<readonly [ControlPoint, ControlPoint]>>;
  readonly resizeRequest: ReturnType<typeof createSignal<readonly [ControlPoint]>>;
  readonly resizeEnd: ReturnType<typeof createSignal<readonly [ControlPoint]>>;
  readonly deleteRequest: ReturnType<typeof createSignal<readonly []>>;
  readonly positionOffsetChanged: ReturnType<typeof createSignal<readonly []>>;
  readonly raiseRequest: ReturnType<typeof createSignal<readonly []>>;
  positionOffset: ControlPoint;
  resizable: boolean;
  draggable: boolean;
  selectable: boolean;
  selected: boolean;
  scalingMenus: boolean;
  dragOrigin: ControlPoint | null;
  pointerOrigin: ControlPoint | null;
  pointerDown(event: FederatedPointerEvent): void;
  pointerMove(event: FederatedPointerEvent): void;
  pointerUp(): void;
  releaseNode(): void;
}

interface GraphNodeState {
  readonly slots: Map<number, GodotGraphSlot>;
  readonly slotUpdated: ReturnType<typeof createSignal<readonly [number]>>;
  readonly slotSizesChanged: ReturnType<typeof createSignal<readonly []>>;
  title: string;
  ignoreInvalidConnectionType: boolean;
  slotsFocusMode: number;
}

interface GraphFrameState {
  readonly autoshrinkChanged: ReturnType<typeof createSignal<readonly []>>;
  title: string;
  autoshrinkEnabled: boolean;
  autoshrinkMargin: number;
  dragMargin: number;
  tintColorEnabled: boolean;
  tintColor: ColorValue;
}

interface GraphEditState {
  readonly connectionLayer: Graphics;
  readonly chromeLayer: Graphics;
  readonly connections: GodotGraphConnection[];
  readonly activity: Map<string, number>;
  readonly validConnections: Set<string>;
  readonly validLeftDisconnectTypes: Set<number>;
  readonly validRightDisconnectTypes: Set<number>;
  readonly elementFrames: Map<string, string>;
  readonly connectionRequest: ReturnType<typeof createSignal<readonly [string, number, string, number]>>;
  readonly disconnectionRequest: ReturnType<typeof createSignal<readonly [string, number, string, number]>>;
  readonly connectionDragStarted: ReturnType<typeof createSignal<readonly [string, number, boolean]>>;
  readonly connectionDragEnded: ReturnType<typeof createSignal<readonly []>>;
  readonly connectionToEmpty: ReturnType<typeof createSignal<readonly [string, number, ControlPoint]>>;
  readonly connectionFromEmpty: ReturnType<typeof createSignal<readonly [string, number, ControlPoint]>>;
  readonly copyNodesRequest: ReturnType<typeof createSignal<readonly []>>;
  readonly cutNodesRequest: ReturnType<typeof createSignal<readonly []>>;
  readonly pasteNodesRequest: ReturnType<typeof createSignal<readonly []>>;
  readonly duplicateNodesRequest: ReturnType<typeof createSignal<readonly []>>;
  readonly deleteNodesRequest: ReturnType<typeof createSignal<readonly [readonly string[]]>>;
  readonly nodeSelected: ReturnType<typeof createSignal<readonly [GodotCanvasGraphElement]>>;
  readonly nodeDeselected: ReturnType<typeof createSignal<readonly [GodotCanvasGraphElement]>>;
  readonly beginNodeMove: ReturnType<typeof createSignal<readonly []>>;
  readonly endNodeMove: ReturnType<typeof createSignal<readonly []>>;
  readonly scrollOffsetChanged: ReturnType<typeof createSignal<readonly [ControlPoint]>>;
  readonly frameRectChanged: ReturnType<typeof createSignal<readonly [GodotCanvasGraphFrame, { position: ControlPoint; size: ControlPoint }]>>;
  readonly popupRequest: ReturnType<typeof createSignal<readonly [ControlPoint]>>;
  readonly graphElementsLinkedToFrameRequest: ReturnType<typeof createSignal<readonly [readonly string[], string]>>;
  readonly menuBox: Container;
  scrollOffset: ControlPoint;
  showGrid: boolean;
  gridPattern: number;
  snappingEnabled: boolean;
  snappingDistance: number;
  panningScheme: number;
  rightDisconnects: boolean;
  typeNames: Readonly<Record<number, string>>;
  curvature: number;
  thickness: number;
  antialiased: boolean;
  zoom: number;
  zoomMin: number;
  zoomMax: number;
  zoomStep: number;
  minimapEnabled: boolean;
  minimapSize: ControlPoint;
  minimapOpacity: number;
  showMenu: boolean;
  showZoomLabel: boolean;
  showZoomButtons: boolean;
  showGridButtons: boolean;
  showMinimapButton: boolean;
  showArrangeButton: boolean;
  panOrigin: ControlPoint | null;
  panPointerOrigin: ControlPoint | null;
  pointerDown(event: FederatedPointerEvent): void;
  pointerMove(event: FederatedPointerEvent): void;
  pointerUp(): void;
  wheel(event: FederatedWheelEvent): void;
  releaseNode(): void;
}

const ELEMENT = new WeakMap<Container, GraphElementState>();
const GRAPH_NODE = new WeakMap<Container, GraphNodeState>();
const GRAPH_FRAME = new WeakMap<Container, GraphFrameState>();
const GRAPH_EDIT = new WeakMap<Container, GraphEditState>();

const WHITE: ColorValue = { r: 1, g: 1, b: 1, a: 1 };

function bool(member: string, value: unknown): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${member} requires bool.`);
  return value;
}

function integer(member: string, value: unknown, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`${member} requires an integer >= ${minimum}.`);
  }
  return value;
}

function finite(member: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${member} requires a finite number.`);
  return value;
}

function nonNegative(member: string, value: unknown): number {
  const retained = finite(member, value);
  if (retained < 0) throw new RangeError(`${member} must be non-negative.`);
  return retained;
}

function point(member: string, value: unknown): ControlPoint {
  if (typeof value !== 'object' || value === null) throw new TypeError(`${member} requires Vector2.`);
  return {
    x: finite(`${member}.x`, Reflect.get(value, 'x')),
    y: finite(`${member}.y`, Reflect.get(value, 'y')),
  };
}

function color(member: string, value: unknown): ColorValue {
  if (typeof value !== 'object' || value === null) throw new TypeError(`${member} requires Color.`);
  return {
    r: finite(`${member}.r`, Reflect.get(value, 'r')),
    g: finite(`${member}.g`, Reflect.get(value, 'g')),
    b: finite(`${member}.b`, Reflect.get(value, 'b')),
    a: finite(`${member}.a`, Reflect.get(value, 'a')),
  };
}

function copyPoint(value: ControlPoint): ControlPoint { return { x: value.x, y: value.y }; }
function copyColor(value: ColorValue): ColorValue { return { r: value.r, g: value.g, b: value.b, a: value.a }; }

function colorNumber(value: ColorValue): number {
  const channel = (part: number): number => Math.max(0, Math.min(255, Math.round(part * 255)));
  return channel(value.r) * 0x10000 + channel(value.g) * 0x100 + channel(value.b);
}

function elementState(node: Container): GraphElementState {
  const state = ELEMENT.get(node);
  if (state === undefined) throw new Error('GraphElement is not bound to a retained Pixi Container.');
  return state;
}

function nodeState(node: Container): GraphNodeState {
  const state = GRAPH_NODE.get(node);
  if (state === undefined) throw new Error('GraphNode is not bound to a retained Pixi Container.');
  return state;
}

function frameState(node: Container): GraphFrameState {
  const state = GRAPH_FRAME.get(node);
  if (state === undefined) throw new Error('GraphFrame is not bound to a retained Pixi Container.');
  return state;
}

function editState(node: Container): GraphEditState {
  const state = GRAPH_EDIT.get(node);
  if (state === undefined) throw new Error('GraphEdit is not bound to a retained Pixi Container.');
  return state;
}

function slotDefault(): GodotGraphSlot {
  return {
    enabledLeft: false,
    typeLeft: 0,
    colorLeft: copyColor(WHITE),
    customIconLeft: null,
    metadataLeft: null,
    enabledRight: false,
    typeRight: 0,
    colorRight: copyColor(WHITE),
    customIconRight: null,
    metadataRight: null,
    drawStyleBox: true,
  };
}

function slot(node: Container, indexValue: unknown): GodotGraphSlot {
  const index = integer('GraphNode slot', indexValue);
  const state = nodeState(node);
  const retained = state.slots.get(index) ?? slotDefault();
  state.slots.set(index, retained);
  return retained;
}

function graphSize(node: Container): ControlPoint {
  try { return getCanvasControlSize(node); } catch { return { x: Math.max(0, node.width), y: Math.max(0, node.height) }; }
}

function redrawElement(node: Container): void {
  const state = elementState(node);
  const size = graphSize(node);
  const frame = GRAPH_FRAME.get(node);
  const graphNode = GRAPH_NODE.get(node);
  state.chrome.clear();
  const tint = frame?.tintColorEnabled === true ? frame.tintColor : undefined;
  const fill = tint === undefined ? 0x242934 : colorNumber(tint);
  const alpha = tint === undefined ? 0.96 : Math.max(0, Math.min(1, tint.a));
  state.chrome.roundRect(0, 0, Math.max(1, size.x), Math.max(1, size.y), 6)
    .fill({ color: fill, alpha })
    .stroke({ color: state.selected ? 0x75b7ff : 0x596273, width: state.selected ? 2 : 1 });
  if (graphNode !== undefined) {
    state.chrome.rect(0, 0, Math.max(1, size.x), Math.min(28, Math.max(1, size.y))).fill({ color: 0x343b49 });
  }
  state.titleText.text = graphNode?.title ?? frame?.title ?? '';
  state.titleText.position.set(9, 5);
}

function notifyGraphAncestors(node: Container): void {
  let current = node.parent;
  while (current !== null) {
    if (GRAPH_EDIT.has(current)) redrawGraphEdit(current);
    current = current.parent;
  }
}

function graphElements(root: Container): GodotCanvasGraphElement[] {
  const result: GodotCanvasGraphElement[] = [];
  const visit = (node: Container): void => {
    for (const child of node.children) {
      if (!(child instanceof Container)) continue;
      if (ELEMENT.has(child)) result.push(child as GodotCanvasGraphElement);
      visit(child);
    }
  };
  visit(root);
  return result;
}

function findElement(root: Container, name: string): GodotCanvasGraphElement | null {
  return graphElements(root).find((candidate) => getName(candidate) === name) ?? null;
}

function inputPorts(node: Container): { slot: number; value: GodotGraphSlot }[] {
  return [...nodeState(node).slots.entries()]
    .filter(([, value]) => value.enabledLeft)
    .map(([slot, value]) => ({ slot, value }))
    .sort((a, b) => a.slot - b.slot);
}

function outputPorts(node: Container): { slot: number; value: GodotGraphSlot }[] {
  return [...nodeState(node).slots.entries()]
    .filter(([, value]) => value.enabledRight)
    .map(([slot, value]) => ({ slot, value }))
    .sort((a, b) => a.slot - b.slot);
}

function portPosition(node: Container, port: number, output: boolean): ControlPoint {
  const ports = output ? outputPorts(node) : inputPorts(node);
  integer(`GraphNode ${output ? 'output' : 'input'} port`, port);
  if (port >= ports.length) throw new RangeError(`GraphNode ${output ? 'output' : 'input'} port ${port} is out of range.`);
  const size = graphSize(node);
  const y = 34 + port * 24;
  return { x: output ? size.x : 0, y: Math.min(Math.max(0, size.y), y) };
}

function worldPort(edit: Container, nodeName: string, port: number, output: boolean): ControlPoint {
  const element = findElement(edit, nodeName);
  if (element === null || !GRAPH_NODE.has(element)) {
    throw new Error(`GraphEdit connection references missing GraphNode ${JSON.stringify(nodeName)}.`);
  }
  const local = portPosition(element, port, output);
  const global = element.toGlobal(local);
  return edit.toLocal(global);
}

function connectionKey(connection: GodotGraphConnection): string {
  return `${connection.from_node}\u0000${connection.from_port}\u0000${connection.to_node}\u0000${connection.to_port}`;
}

function bezierLine(from: ControlPoint, to: ControlPoint, curvature: number): readonly ControlPoint[] {
  const distance = Math.abs(to.x - from.x);
  const handle = Math.max(40, distance * Math.max(0, curvature));
  const points: ControlPoint[] = [];
  for (let index = 0; index <= 24; index += 1) {
    const t = index / 24;
    const u = 1 - t;
    points.push({
      x: u * u * u * from.x + 3 * u * u * t * (from.x + handle) + 3 * u * t * t * (to.x - handle) + t * t * t * to.x,
      y: u * u * u * from.y + 3 * u * u * t * from.y + 3 * u * t * t * to.y + t * t * t * to.y,
    });
  }
  return points;
}

function redrawGraphEdit(node: Container): void {
  const state = editState(node);
  for (const element of graphElements(node)) {
    const offset = element.position_offset;
    element.position.set(
      (offset.x - state.scrollOffset.x) * state.zoom,
      (offset.y - state.scrollOffset.y) * state.zoom,
    );
    element.scale.set(state.zoom);
  }
  const size = graphSize(node);
  state.chromeLayer.clear();
  if (state.showGrid && state.snappingDistance > 0) {
    const spacing = Math.max(4, state.snappingDistance * state.zoom);
    const offsetX = ((-state.scrollOffset.x * state.zoom) % spacing + spacing) % spacing;
    const offsetY = ((-state.scrollOffset.y * state.zoom) % spacing + spacing) % spacing;
    for (let x = offsetX; x < size.x; x += spacing) {
      state.chromeLayer.moveTo(x, 0).lineTo(x, size.y);
    }
    for (let y = offsetY; y < size.y; y += spacing) {
      state.chromeLayer.moveTo(0, y).lineTo(size.x, y);
    }
    state.chromeLayer.stroke({ color: state.gridPattern === 1 ? 0x3b4250 : 0x303641, alpha: 0.65, width: 1 });
  }
  state.connectionLayer.clear();
  for (const connection of state.connections) {
    let from: ControlPoint;
    let to: ControlPoint;
    try {
      from = worldPort(node, connection.from_node, connection.from_port, true);
      to = worldPort(node, connection.to_node, connection.to_port, false);
    } catch {
      continue;
    }
    const points = bezierLine(from, to, state.curvature);
    const activity = state.activity.get(connectionKey(connection)) ?? 0;
    state.connectionLayer.moveTo(points[0]?.x ?? from.x, points[0]?.y ?? from.y);
    for (const point of points.slice(1)) state.connectionLayer.lineTo(point.x, point.y);
    state.connectionLayer.stroke({
      color: activity > 0 ? 0xffc85a : 0x83a5d8,
      alpha: 0.9,
      width: state.thickness + Math.max(0, activity),
    });
  }
  if (state.minimapEnabled) {
    const width = Math.min(size.x, state.minimapSize.x);
    const height = Math.min(size.y, state.minimapSize.y);
    state.chromeLayer.rect(Math.max(0, size.x - width - 8), Math.max(0, size.y - height - 8), width, height)
      .fill({ color: 0x11151d, alpha: state.minimapOpacity })
      .stroke({ color: 0x657080, alpha: state.minimapOpacity, width: 1 });
  }
}

export function bindCanvasGraphElement(node: Container): GodotCanvasGraphElement {
  releaseCanvasGraphElement(node);
  const chrome = markInternalCanvasChild(new Graphics());
  const titleText = markInternalCanvasChild(new Text({ text: '', style: { fill: 0xf3f5f8, fontFamily: 'sans-serif', fontSize: 14 } }));
  const titleBar = markInternalCanvasChild(new Container());
  node.addChildAt(chrome, 0);
  node.addChild(titleText);
  node.addChild(titleBar);
  const nodeSelected = createSignal<readonly []>();
  const nodeDeselected = createSignal<readonly []>();
  const dragged = createSignal<readonly [ControlPoint, ControlPoint]>();
  const resizeRequest = createSignal<readonly [ControlPoint]>();
  const resizeEnd = createSignal<readonly [ControlPoint]>();
  const deleteRequest = createSignal<readonly []>();
  const positionOffsetChanged = createSignal<readonly []>();
  const raiseRequest = createSignal<readonly []>();
  const state: GraphElementState = {
    chrome,
    titleText,
    titleBar,
    nodeSelected,
    nodeDeselected,
    dragged,
    resizeRequest,
    resizeEnd,
    deleteRequest,
    positionOffsetChanged,
    raiseRequest,
    positionOffset: { x: node.position.x, y: node.position.y },
    resizable: false,
    draggable: true,
    selectable: true,
    selected: false,
    scalingMenus: false,
    dragOrigin: null,
    pointerOrigin: null,
    pointerDown: () => {},
    pointerMove: () => {},
    pointerUp: () => {},
    releaseNode: () => {},
  };
  ELEMENT.set(node, state);
  node.eventMode = 'static';
  node.hitArea = new Rectangle(0, 0, Math.max(1, graphSize(node).x), Math.max(1, graphSize(node).y));
  const down = (event: FederatedPointerEvent): void => {
    if (state.selectable && !state.selected) (node as GodotCanvasGraphElement).set_selected(true);
    if (!state.draggable || event.button !== 0) return;
    state.dragOrigin = copyPoint(state.positionOffset);
    state.pointerOrigin = { x: event.global.x, y: event.global.y };
    state.raiseRequest.emit();
  };
  const move = (event: FederatedPointerEvent): void => {
    if (state.dragOrigin === null || state.pointerOrigin === null) return;
    const previous = copyPoint(state.positionOffset);
    (node as GodotCanvasGraphElement).set_position_offset({
      x: state.dragOrigin.x + event.global.x - state.pointerOrigin.x,
      y: state.dragOrigin.y + event.global.y - state.pointerOrigin.y,
    });
    state.dragged.emit(previous, copyPoint(state.positionOffset));
  };
  const up = (): void => { state.dragOrigin = null; state.pointerOrigin = null; };
  state.pointerDown = down;
  state.pointerMove = move;
  state.pointerUp = up;
  node.on('pointerdown', state.pointerDown);
  node.on('globalpointermove', state.pointerMove);
  node.on('pointerup', state.pointerUp);
  node.on('pointerupoutside', state.pointerUp);
  state.releaseNode = registerCanvasNodeRelease(node, () => releaseCanvasGraphElement(node));
  Object.assign(node, {
    node_selected: nodeSelected.signal,
    node_deselected: nodeDeselected.signal,
    dragged: dragged.signal,
    resize_request: resizeRequest.signal,
    resize_end: resizeEnd.signal,
    delete_request: deleteRequest.signal,
    position_offset_changed: positionOffsetChanged.signal,
    raise_request: raiseRequest.signal,
    set_position_offset(value: ControlPoint): void {
      state.positionOffset = point('GraphElement.position_offset', value);
      node.position.set(state.positionOffset.x, state.positionOffset.y);
      state.positionOffsetChanged.emit();
      notifyGraphAncestors(node);
    },
    get_position_offset: (): ControlPoint => copyPoint(state.positionOffset),
    set_resizable(value: boolean): void { state.resizable = bool('GraphElement.resizable', value); },
    is_resizable: (): boolean => state.resizable,
    set_draggable(value: boolean): void { state.draggable = bool('GraphElement.draggable', value); },
    is_draggable: (): boolean => state.draggable,
    set_selectable(value: boolean): void { state.selectable = bool('GraphElement.selectable', value); },
    is_selectable: (): boolean => state.selectable,
    set_selected(value: boolean): void {
      const selected = bool('GraphElement.selected', value);
      if (selected === state.selected) return;
      state.selected = selected;
      redrawElement(node);
      if (selected) nodeSelected.emit(); else nodeDeselected.emit();
      let parent = node.parent;
      while (parent !== null) {
        const edit = GRAPH_EDIT.get(parent);
        if (edit !== undefined) {
          if (selected) edit.nodeSelected.emit(node as GodotCanvasGraphElement);
          else edit.nodeDeselected.emit(node as GodotCanvasGraphElement);
          break;
        }
        parent = parent.parent;
      }
    },
    is_selected: (): boolean => state.selected,
    set_scaling_menus(value: boolean): void { state.scalingMenus = bool('GraphElement.scaling_menus', value); },
    is_scaling_menus: (): boolean => state.scalingMenus,
  } satisfies Partial<GodotCanvasGraphElement>);
  Object.defineProperties(node, {
    position_offset: { get: () => copyPoint(state.positionOffset), set: (value) => (node as GodotCanvasGraphElement).set_position_offset(value) },
    resizable: { get: () => state.resizable, set: (value) => (node as GodotCanvasGraphElement).set_resizable(value) },
    draggable: { get: () => state.draggable, set: (value) => (node as GodotCanvasGraphElement).set_draggable(value) },
    selectable: { get: () => state.selectable, set: (value) => (node as GodotCanvasGraphElement).set_selectable(value) },
    selected: { get: () => state.selected, set: (value) => (node as GodotCanvasGraphElement).set_selected(value) },
    scaling_menus: { get: () => state.scalingMenus, set: (value) => (node as GodotCanvasGraphElement).set_scaling_menus(value) },
  });
  redrawElement(node);
  return node as GodotCanvasGraphElement;
}

export function bindCanvasGraphNode(node: Container): GodotCanvasGraphNode {
  if (!ELEMENT.has(node)) bindCanvasGraphElement(node);
  const slotUpdated = createSignal<readonly [number]>();
  const slotSizesChanged = createSignal<readonly []>();
  const state: GraphNodeState = {
    slots: new Map(),
    slotUpdated,
    slotSizesChanged,
    title: '',
    ignoreInvalidConnectionType: false,
    slotsFocusMode: 0,
  };
  GRAPH_NODE.set(node, state);
  const changed = (index: number): void => { slotUpdated.emit(index); slotSizesChanged.emit(); redrawElement(node); notifyGraphAncestors(node); };
  const portEntry = (portValue: number, output: boolean) => {
    const port = integer(`GraphNode ${output ? 'output' : 'input'} port`, portValue);
    const entries = output ? outputPorts(node) : inputPorts(node);
    const retained = entries[port];
    if (retained === undefined) throw new RangeError(`GraphNode ${output ? 'output' : 'input'} port ${port} is out of range.`);
    return retained;
  };
  Object.assign(node, {
    slot_updated: slotUpdated.signal,
    slot_sizes_changed: slotSizesChanged.signal,
    set_title(value: string): void { if (typeof value !== 'string') throw new TypeError('GraphNode.title requires String.'); state.title = value; redrawElement(node); },
    get_title: (): string => state.title,
    get_titlebar_hbox: (): Container => elementState(node).titleBar,
    set_slot(indexValue: number, enableLeft: boolean, typeLeft: number, colorLeft: ColorValue, enableRight: boolean, typeRight: number, colorRight: ColorValue, customIconLeft: Texture | null = null, customIconRight: Texture | null = null, drawStyleBox = true): void {
      const index = integer('GraphNode slot', indexValue);
      state.slots.set(index, {
        enabledLeft: bool('GraphNode enable_left', enableLeft), typeLeft: integer('GraphNode type_left', typeLeft), colorLeft: color('GraphNode color_left', colorLeft), customIconLeft, metadataLeft: null,
        enabledRight: bool('GraphNode enable_right', enableRight), typeRight: integer('GraphNode type_right', typeRight), colorRight: color('GraphNode color_right', colorRight), customIconRight, metadataRight: null,
        drawStyleBox: bool('GraphNode draw_stylebox', drawStyleBox),
      });
      changed(index);
    },
    clear_slot(indexValue: number): void { const index = integer('GraphNode slot', indexValue); state.slots.delete(index); changed(index); },
    clear_all_slots(): void { state.slots.clear(); slotSizesChanged.emit(); redrawElement(node); notifyGraphAncestors(node); },
    is_slot_enabled_left: (index: number): boolean => slot(node, index).enabledLeft,
    set_slot_enabled_left(index: number, value: boolean): void { slot(node, index).enabledLeft = bool('GraphNode.slot_enabled_left', value); changed(index); },
    set_slot_type_left(index: number, value: number): void { slot(node, index).typeLeft = integer('GraphNode.slot_type_left', value); changed(index); },
    get_slot_type_left: (index: number): number => slot(node, index).typeLeft,
    set_slot_color_left(index: number, value: ColorValue): void { slot(node, index).colorLeft = color('GraphNode.slot_color_left', value); changed(index); },
    get_slot_color_left: (index: number): ColorValue => copyColor(slot(node, index).colorLeft),
    set_slot_custom_icon_left(index: number, value: Texture | null): void { slot(node, index).customIconLeft = value; changed(index); },
    get_slot_custom_icon_left: (index: number): Texture | null => slot(node, index).customIconLeft,
    set_slot_metadata_left(index: number, value: unknown): void { slot(node, index).metadataLeft = value; changed(index); },
    get_slot_metadata_left: (index: number): unknown => slot(node, index).metadataLeft,
    is_slot_enabled_right: (index: number): boolean => slot(node, index).enabledRight,
    set_slot_enabled_right(index: number, value: boolean): void { slot(node, index).enabledRight = bool('GraphNode.slot_enabled_right', value); changed(index); },
    set_slot_type_right(index: number, value: number): void { slot(node, index).typeRight = integer('GraphNode.slot_type_right', value); changed(index); },
    get_slot_type_right: (index: number): number => slot(node, index).typeRight,
    set_slot_color_right(index: number, value: ColorValue): void { slot(node, index).colorRight = color('GraphNode.slot_color_right', value); changed(index); },
    get_slot_color_right: (index: number): ColorValue => copyColor(slot(node, index).colorRight),
    set_slot_custom_icon_right(index: number, value: Texture | null): void { slot(node, index).customIconRight = value; changed(index); },
    get_slot_custom_icon_right: (index: number): Texture | null => slot(node, index).customIconRight,
    set_slot_metadata_right(index: number, value: unknown): void { slot(node, index).metadataRight = value; changed(index); },
    get_slot_metadata_right: (index: number): unknown => slot(node, index).metadataRight,
    is_slot_draw_stylebox: (index: number): boolean => slot(node, index).drawStyleBox,
    set_slot_draw_stylebox(index: number, value: boolean): void { slot(node, index).drawStyleBox = bool('GraphNode.slot_draw_stylebox', value); changed(index); },
    set_ignore_invalid_connection_type(value: boolean): void { state.ignoreInvalidConnectionType = bool('GraphNode.ignore_invalid_connection_type', value); },
    is_ignoring_valid_connection_type: (): boolean => state.ignoreInvalidConnectionType,
    set_slots_focus_mode(value: number): void { state.slotsFocusMode = integer('GraphNode.slots_focus_mode', value); },
    get_slots_focus_mode: (): number => state.slotsFocusMode,
    get_input_port_count: (): number => inputPorts(node).length,
    get_input_port_position: (port: number): ControlPoint => portPosition(node, port, false),
    get_input_port_type: (port: number): number => portEntry(port, false).value.typeLeft,
    get_input_port_color: (port: number): ColorValue => copyColor(portEntry(port, false).value.colorLeft),
    get_input_port_slot: (port: number): number => portEntry(port, false).slot,
    get_output_port_count: (): number => outputPorts(node).length,
    get_output_port_position: (port: number): ControlPoint => portPosition(node, port, true),
    get_output_port_type: (port: number): number => portEntry(port, true).value.typeRight,
    get_output_port_color: (port: number): ColorValue => copyColor(portEntry(port, true).value.colorRight),
    get_output_port_slot: (port: number): number => portEntry(port, true).slot,
  } satisfies Partial<GodotCanvasGraphNode>);
  Object.defineProperties(node, {
    title: { get: () => state.title, set: (value) => (node as GodotCanvasGraphNode).set_title(value) },
    ignore_invalid_connection_type: { get: () => state.ignoreInvalidConnectionType, set: (value) => (node as GodotCanvasGraphNode).set_ignore_invalid_connection_type(value) },
    slots_focus_mode: { get: () => state.slotsFocusMode, set: (value) => (node as GodotCanvasGraphNode).set_slots_focus_mode(value) },
  });
  redrawElement(node);
  return node as GodotCanvasGraphNode;
}

export function bindCanvasGraphFrame(node: Container): GodotCanvasGraphFrame {
  if (!ELEMENT.has(node)) bindCanvasGraphElement(node);
  const autoshrinkChanged = createSignal<readonly []>();
  const state: GraphFrameState = {
    autoshrinkChanged,
    title: '',
    autoshrinkEnabled: true,
    autoshrinkMargin: 40,
    dragMargin: 16,
    tintColorEnabled: false,
    tintColor: { r: 0.3, g: 0.3, b: 0.3, a: 0.75 },
  };
  GRAPH_FRAME.set(node, state);
  Object.assign(node, {
    autoshrink_changed: autoshrinkChanged.signal,
    set_title(value: string): void { if (typeof value !== 'string') throw new TypeError('GraphFrame.title requires String.'); state.title = value; redrawElement(node); },
    get_title: (): string => state.title,
    get_titlebar_hbox: (): Container => elementState(node).titleBar,
    set_autoshrink_enabled(value: boolean): void { state.autoshrinkEnabled = bool('GraphFrame.autoshrink_enabled', value); autoshrinkChanged.emit(); },
    is_autoshrink_enabled: (): boolean => state.autoshrinkEnabled,
    set_autoshrink_margin(value: number): void { state.autoshrinkMargin = nonNegative('GraphFrame.autoshrink_margin', value); autoshrinkChanged.emit(); },
    get_autoshrink_margin: (): number => state.autoshrinkMargin,
    set_drag_margin(value: number): void { state.dragMargin = nonNegative('GraphFrame.drag_margin', value); },
    get_drag_margin: (): number => state.dragMargin,
    set_tint_color_enabled(value: boolean): void { state.tintColorEnabled = bool('GraphFrame.tint_color_enabled', value); redrawElement(node); },
    is_tint_color_enabled: (): boolean => state.tintColorEnabled,
    set_tint_color(value: ColorValue): void { state.tintColor = color('GraphFrame.tint_color', value); redrawElement(node); },
    get_tint_color: (): ColorValue => copyColor(state.tintColor),
  } satisfies Partial<GodotCanvasGraphFrame>);
  Object.defineProperties(node, {
    title: { get: () => state.title, set: (value) => (node as GodotCanvasGraphFrame).set_title(value) },
    autoshrink_enabled: { get: () => state.autoshrinkEnabled, set: (value) => (node as GodotCanvasGraphFrame).set_autoshrink_enabled(value) },
    autoshrink_margin: { get: () => state.autoshrinkMargin, set: (value) => (node as GodotCanvasGraphFrame).set_autoshrink_margin(value) },
    drag_margin: { get: () => state.dragMargin, set: (value) => (node as GodotCanvasGraphFrame).set_drag_margin(value) },
    tint_color_enabled: { get: () => state.tintColorEnabled, set: (value) => (node as GodotCanvasGraphFrame).set_tint_color_enabled(value) },
    tint_color: { get: () => copyColor(state.tintColor), set: (value) => (node as GodotCanvasGraphFrame).set_tint_color(value) },
  });
  redrawElement(node);
  return node as GodotCanvasGraphFrame;
}

function segments(points: readonly ControlPoint[]): readonly [ControlPoint, ControlPoint][] {
  return points.slice(1).map((point, index) => [points[index] as ControlPoint, point]);
}

function distanceToSegment(pointValue: ControlPoint, start: ControlPoint, end: ControlPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(pointValue.x - start.x, pointValue.y - start.y);
  const t = Math.max(0, Math.min(1, ((pointValue.x - start.x) * dx + (pointValue.y - start.y) * dy) / lengthSquared));
  return Math.hypot(pointValue.x - (start.x + t * dx), pointValue.y - (start.y + t * dy));
}

function intersectsRect(points: readonly ControlPoint[], rect: { position: ControlPoint; size: ControlPoint }): boolean {
  const x1 = Math.min(rect.position.x, rect.position.x + rect.size.x);
  const y1 = Math.min(rect.position.y, rect.position.y + rect.size.y);
  const x2 = Math.max(rect.position.x, rect.position.x + rect.size.x);
  const y2 = Math.max(rect.position.y, rect.position.y + rect.size.y);
  return points.some((value) => value.x >= x1 && value.x <= x2 && value.y >= y1 && value.y <= y2);
}

export function bindCanvasGraphEdit(node: Container): GodotCanvasGraphEdit {
  releaseCanvasGraphEdit(node);
  const connectionLayer = markInternalCanvasChild(new Graphics());
  const chromeLayer = markInternalCanvasChild(new Graphics());
  node.addChildAt(connectionLayer, 0);
  node.addChildAt(chromeLayer, 0);
  const state: GraphEditState = {
    connectionLayer,
    chromeLayer,
    connections: [],
    activity: new Map(),
    validConnections: new Set(),
    validLeftDisconnectTypes: new Set(),
    validRightDisconnectTypes: new Set(),
    elementFrames: new Map(),
    connectionRequest: createSignal(),
    disconnectionRequest: createSignal(),
    connectionDragStarted: createSignal(),
    connectionDragEnded: createSignal(),
    connectionToEmpty: createSignal(),
    connectionFromEmpty: createSignal(),
    copyNodesRequest: createSignal(),
    cutNodesRequest: createSignal(),
    pasteNodesRequest: createSignal(),
    duplicateNodesRequest: createSignal(),
    deleteNodesRequest: createSignal(),
    nodeSelected: createSignal(),
    nodeDeselected: createSignal(),
    beginNodeMove: createSignal(),
    endNodeMove: createSignal(),
    scrollOffsetChanged: createSignal(),
    frameRectChanged: createSignal(),
    popupRequest: createSignal(),
    graphElementsLinkedToFrameRequest: createSignal(),
    menuBox: markInternalCanvasChild(new Container()),
    scrollOffset: { x: 0, y: 0 },
    showGrid: true,
    gridPattern: 0,
    snappingEnabled: true,
    snappingDistance: 20,
    panningScheme: 0,
    rightDisconnects: false,
    typeNames: {},
    curvature: 0.5,
    thickness: 4,
    antialiased: true,
    zoom: 1,
    zoomMin: 0.25,
    zoomMax: 2,
    zoomStep: 1.2,
    minimapEnabled: true,
    minimapSize: { x: 240, y: 160 },
    minimapOpacity: 0.65,
    showMenu: true,
    showZoomLabel: false,
    showZoomButtons: true,
    showGridButtons: true,
    showMinimapButton: true,
    showArrangeButton: true,
    panOrigin: null,
    panPointerOrigin: null,
    pointerDown: () => {},
    pointerMove: () => {},
    pointerUp: () => {},
    wheel: () => {},
    releaseNode: () => {},
  };
  GRAPH_EDIT.set(node, state);
  const property = <K extends keyof GraphEditState>(key: K, redraw = true) => ({
    get: () => state[key],
    set: (value: GraphEditState[K]) => { Reflect.set(state, key, value); if (redraw) redrawGraphEdit(node); },
  });
  const api = {
    connection_request: state.connectionRequest.signal,
    disconnection_request: state.disconnectionRequest.signal,
    connection_drag_started: state.connectionDragStarted.signal,
    connection_drag_ended: state.connectionDragEnded.signal,
    connection_to_empty: state.connectionToEmpty.signal,
    connection_from_empty: state.connectionFromEmpty.signal,
    copy_nodes_request: state.copyNodesRequest.signal,
    cut_nodes_request: state.cutNodesRequest.signal,
    paste_nodes_request: state.pasteNodesRequest.signal,
    duplicate_nodes_request: state.duplicateNodesRequest.signal,
    delete_nodes_request: state.deleteNodesRequest.signal,
    node_selected: state.nodeSelected.signal,
    node_deselected: state.nodeDeselected.signal,
    begin_node_move: state.beginNodeMove.signal,
    end_node_move: state.endNodeMove.signal,
    scroll_offset_changed: state.scrollOffsetChanged.signal,
    frame_rect_changed: state.frameRectChanged.signal,
    popup_request: state.popupRequest.signal,
    graph_elements_linked_to_frame_request: state.graphElementsLinkedToFrameRequest.signal,
    connect_node(fromNode: string, fromPort: number, toNode: string, toPort: number, keepAlive = false): number {
      if ([fromNode, toNode].some((value) => typeof value !== 'string')) throw new TypeError('GraphEdit.connect_node node names require StringName.');
      const connection: GodotGraphConnection = { from_node: fromNode, from_port: integer('GraphEdit from_port', fromPort), to_node: toNode, to_port: integer('GraphEdit to_port', toPort), keep_alive: bool('GraphEdit keep_alive', keepAlive) };
      worldPort(node, fromNode, connection.from_port, true);
      worldPort(node, toNode, connection.to_port, false);
      if (state.connections.some((value) => connectionKey(value) === connectionKey(connection))) return 1;
      state.connections.push(connection);
      redrawGraphEdit(node);
      return 0;
    },
    is_node_connected(fromNode: string, fromPort: number, toNode: string, toPort: number): boolean {
      const key = connectionKey({ from_node: fromNode, from_port: fromPort, to_node: toNode, to_port: toPort, keep_alive: false });
      return state.connections.some((value) => connectionKey(value) === key);
    },
    disconnect_node(fromNode: string, fromPort: number, toNode: string, toPort: number): void {
      const key = connectionKey({ from_node: fromNode, from_port: fromPort, to_node: toNode, to_port: toPort, keep_alive: false });
      const index = state.connections.findIndex((value) => connectionKey(value) === key);
      if (index >= 0) state.connections.splice(index, 1);
      state.activity.delete(key);
      redrawGraphEdit(node);
    },
    set_connection_activity(fromNode: string, fromPort: number, toNode: string, toPort: number, amount: number): void {
      const key = connectionKey({ from_node: fromNode, from_port: fromPort, to_node: toNode, to_port: toPort, keep_alive: false });
      if (!state.connections.some((value) => connectionKey(value) === key)) throw new Error('GraphEdit.set_connection_activity requires an existing connection.');
      state.activity.set(key, Math.max(0, finite('GraphEdit connection activity', amount)));
      redrawGraphEdit(node);
    },
    set_connections(connections: readonly GodotGraphConnection[]): void {
      if (!Array.isArray(connections)) throw new TypeError('GraphEdit.connections requires Array[Dictionary].');
      const retained = connections.map((entry) => ({
        from_node: String(entry.from_node), from_port: integer('GraphEdit connection from_port', entry.from_port),
        to_node: String(entry.to_node), to_port: integer('GraphEdit connection to_port', entry.to_port), keep_alive: entry.keep_alive === true,
      }));
      state.connections.splice(0, state.connections.length, ...retained);
      redrawGraphEdit(node);
    },
    get_connection_list: (): readonly GodotGraphConnection[] => state.connections.map((value) => ({ ...value })),
    get_connection_count: (): number => state.connections.length,
    get_closest_connection_at_point(value: ControlPoint, maxDistance = 4): GodotGraphConnectionHit | Readonly<Record<string, never>> {
      const target = point('GraphEdit point', value);
      const maximum = nonNegative('GraphEdit max_distance', maxDistance);
      let best: GodotGraphConnectionHit | null = null;
      let bestDistance = maximum;
      for (const connection of state.connections) {
        const line = bezierLine(worldPort(node, connection.from_node, connection.from_port, true), worldPort(node, connection.to_node, connection.to_port, false), state.curvature);
        segments(line).forEach(([from, to], segment) => {
          const distance = distanceToSegment(target, from, to);
          if (distance <= bestDistance) { bestDistance = distance; best = { ...connection, segment }; }
        });
      }
      return best ?? {};
    },
    get_connection_list_from_node(name: string): readonly GodotGraphConnection[] { return state.connections.filter((value) => value.from_node === name || value.to_node === name).map((value) => ({ ...value })); },
    get_connections_intersecting_with_rect(rectValue: { position: ControlPoint; size: ControlPoint }): readonly GodotGraphConnection[] {
      const rect = { position: point('GraphEdit rect.position', rectValue.position), size: point('GraphEdit rect.size', rectValue.size) };
      return state.connections.filter((connection) => intersectsRect(bezierLine(worldPort(node, connection.from_node, connection.from_port, true), worldPort(node, connection.to_node, connection.to_port, false), state.curvature), rect)).map((value) => ({ ...value }));
    },
    clear_connections(): void { state.connections.length = 0; state.activity.clear(); redrawGraphEdit(node); },
    force_connection_drag_end(): void { state.connectionDragEnded.emit(); },
    set_scroll_offset(value: ControlPoint): void { state.scrollOffset = point('GraphEdit.scroll_offset', value); state.scrollOffsetChanged.emit(copyPoint(state.scrollOffset)); redrawGraphEdit(node); },
    get_scroll_offset: (): ControlPoint => copyPoint(state.scrollOffset),
    add_valid_right_disconnect_type(value: number): void { state.validRightDisconnectTypes.add(integer('GraphEdit type', value)); },
    remove_valid_right_disconnect_type(value: number): void { state.validRightDisconnectTypes.delete(integer('GraphEdit type', value)); },
    add_valid_left_disconnect_type(value: number): void { state.validLeftDisconnectTypes.add(integer('GraphEdit type', value)); },
    remove_valid_left_disconnect_type(value: number): void { state.validLeftDisconnectTypes.delete(integer('GraphEdit type', value)); },
    add_valid_connection_type(fromType: number, toType: number): void { state.validConnections.add(`${integer('GraphEdit from_type', fromType)}:${integer('GraphEdit to_type', toType)}`); },
    remove_valid_connection_type(fromType: number, toType: number): void { state.validConnections.delete(`${integer('GraphEdit from_type', fromType)}:${integer('GraphEdit to_type', toType)}`); },
    is_valid_connection_type(fromType: number, toType: number): boolean { return fromType === toType || state.validConnections.has(`${integer('GraphEdit from_type', fromType)}:${integer('GraphEdit to_type', toType)}`); },
    get_connection_line(fromValue: ControlPoint, toValue: ControlPoint): readonly ControlPoint[] { return bezierLine(point('GraphEdit from', fromValue), point('GraphEdit to', toValue), state.curvature); },
    attach_graph_element_to_frame(element: string, frame: string): void { if (findElement(node, element) === null || findElement(node, frame) === null) throw new Error('GraphEdit frame attachment requires retained named elements.'); state.elementFrames.set(element, frame); },
    detach_graph_element_from_frame(element: string): void { state.elementFrames.delete(element); },
    get_element_frame(element: string): string { return state.elementFrames.get(element) ?? ''; },
    get_attached_nodes_of_frame(frame: string): readonly string[] { return [...state.elementFrames].filter(([, value]) => value === frame).map(([element]) => element); },
    set_panning_scheme(value: number): void { state.panningScheme = integer('GraphEdit.panning_scheme', value); },
    get_panning_scheme: (): number => state.panningScheme,
    set_zoom(value: number): void { state.zoom = Math.max(state.zoomMin, Math.min(state.zoomMax, finite('GraphEdit.zoom', value))); redrawGraphEdit(node); },
    get_zoom: (): number => state.zoom,
    set_zoom_min(value: number): void { state.zoomMin = nonNegative('GraphEdit.zoom_min', value); if (state.zoomMax < state.zoomMin) state.zoomMax = state.zoomMin; api.set_zoom(state.zoom); },
    get_zoom_min: (): number => state.zoomMin,
    set_zoom_max(value: number): void { state.zoomMax = nonNegative('GraphEdit.zoom_max', value); if (state.zoomMin > state.zoomMax) state.zoomMin = state.zoomMax; api.set_zoom(state.zoom); },
    get_zoom_max: (): number => state.zoomMax,
    set_zoom_step(value: number): void { const retained = finite('GraphEdit.zoom_step', value); if (retained <= 1) throw new RangeError('GraphEdit.zoom_step must be greater than 1.'); state.zoomStep = retained; },
    get_zoom_step: (): number => state.zoomStep,
    set_show_grid(value: boolean): void { state.showGrid = bool('GraphEdit.show_grid', value); redrawGraphEdit(node); },
    is_showing_grid: (): boolean => state.showGrid,
    set_grid_pattern(value: number): void { state.gridPattern = integer('GraphEdit.grid_pattern', value); redrawGraphEdit(node); },
    get_grid_pattern: (): number => state.gridPattern,
    set_snapping_enabled(value: boolean): void { state.snappingEnabled = bool('GraphEdit.snapping_enabled', value); },
    is_snapping_enabled: (): boolean => state.snappingEnabled,
    set_snapping_distance(value: number): void { state.snappingDistance = nonNegative('GraphEdit.snapping_distance', value); redrawGraphEdit(node); },
    get_snapping_distance: (): number => state.snappingDistance,
    set_connection_lines_curvature(value: number): void { state.curvature = nonNegative('GraphEdit.connection_lines_curvature', value); redrawGraphEdit(node); },
    get_connection_lines_curvature: (): number => state.curvature,
    set_connection_lines_thickness(value: number): void { state.thickness = nonNegative('GraphEdit.connection_lines_thickness', value); redrawGraphEdit(node); },
    get_connection_lines_thickness: (): number => state.thickness,
    set_connection_lines_antialiased(value: boolean): void { state.antialiased = bool('GraphEdit.connection_lines_antialiased', value); },
    is_connection_lines_antialiased: (): boolean => state.antialiased,
    set_minimap_size(value: ControlPoint): void { state.minimapSize = point('GraphEdit.minimap_size', value); redrawGraphEdit(node); },
    get_minimap_size: (): ControlPoint => copyPoint(state.minimapSize),
    set_minimap_opacity(value: number): void { const retained = finite('GraphEdit.minimap_opacity', value); if (retained < 0 || retained > 1) throw new RangeError('GraphEdit.minimap_opacity must be in [0, 1].'); state.minimapOpacity = retained; redrawGraphEdit(node); },
    get_minimap_opacity: (): number => state.minimapOpacity,
    set_minimap_enabled(value: boolean): void { state.minimapEnabled = bool('GraphEdit.minimap_enabled', value); redrawGraphEdit(node); },
    is_minimap_enabled: (): boolean => state.minimapEnabled,
    set_show_menu(value: boolean): void { state.showMenu = bool('GraphEdit.show_menu', value); }, is_showing_menu: (): boolean => state.showMenu,
    set_show_zoom_label(value: boolean): void { state.showZoomLabel = bool('GraphEdit.show_zoom_label', value); }, is_showing_zoom_label: (): boolean => state.showZoomLabel,
    set_show_grid_buttons(value: boolean): void { state.showGridButtons = bool('GraphEdit.show_grid_buttons', value); }, is_showing_grid_buttons: (): boolean => state.showGridButtons,
    set_show_zoom_buttons(value: boolean): void { state.showZoomButtons = bool('GraphEdit.show_zoom_buttons', value); }, is_showing_zoom_buttons: (): boolean => state.showZoomButtons,
    set_show_minimap_button(value: boolean): void { state.showMinimapButton = bool('GraphEdit.show_minimap_button', value); }, is_showing_minimap_button: (): boolean => state.showMinimapButton,
    set_show_arrange_button(value: boolean): void { state.showArrangeButton = bool('GraphEdit.show_arrange_button', value); }, is_showing_arrange_button: (): boolean => state.showArrangeButton,
    set_right_disconnects(value: boolean): void { state.rightDisconnects = bool('GraphEdit.right_disconnects', value); }, is_right_disconnects_enabled: (): boolean => state.rightDisconnects,
    set_type_names(value: Readonly<Record<number, string>>): void { if (typeof value !== 'object' || value === null) throw new TypeError('GraphEdit.type_names requires Dictionary.'); state.typeNames = { ...value }; },
    get_type_names: (): Readonly<Record<number, string>> => ({ ...state.typeNames }),
    arrange_nodes(): void {
      const elements = graphElements(node).filter((value) => GRAPH_FRAME.get(value)?.autoshrinkEnabled !== true);
      elements.forEach((element, index) => element.set_position_offset({ x: (index % 4) * 260, y: Math.floor(index / 4) * 180 }));
      redrawGraphEdit(node);
    },
    set_selected(element: GodotCanvasGraphElement | null): void { for (const candidate of graphElements(node)) candidate.set_selected(candidate === element); },
    get_menu_hbox: (): Container => state.menuBox,
  } satisfies Partial<GodotCanvasGraphEdit>;
  Object.assign(node, api);
  Object.defineProperties(node, {
    scroll_offset: { get: () => copyPoint(state.scrollOffset), set: (value) => api.set_scroll_offset(value) },
    show_grid: { get: () => state.showGrid, set: (value) => api.set_show_grid(value) },
    grid_pattern: { get: () => state.gridPattern, set: (value) => api.set_grid_pattern(value) },
    snapping_enabled: { get: () => state.snappingEnabled, set: (value) => api.set_snapping_enabled(value) },
    snapping_distance: { get: () => state.snappingDistance, set: (value) => api.set_snapping_distance(value) },
    panning_scheme: { get: () => state.panningScheme, set: (value) => api.set_panning_scheme(value) },
    right_disconnects: { get: () => state.rightDisconnects, set: (value) => api.set_right_disconnects(value) },
    type_names: { get: () => ({ ...state.typeNames }), set: (value) => api.set_type_names(value) },
    connection_lines_curvature: { get: () => state.curvature, set: (value) => api.set_connection_lines_curvature(value) },
    connection_lines_thickness: { get: () => state.thickness, set: (value) => api.set_connection_lines_thickness(value) },
    connection_lines_antialiased: { get: () => state.antialiased, set: (value) => api.set_connection_lines_antialiased(value) },
    zoom: { get: () => state.zoom, set: (value) => api.set_zoom(value) },
    zoom_min: { get: () => state.zoomMin, set: (value) => api.set_zoom_min(value) },
    zoom_max: { get: () => state.zoomMax, set: (value) => api.set_zoom_max(value) },
    zoom_step: { get: () => state.zoomStep, set: (value) => api.set_zoom_step(value) },
    minimap_enabled: { get: () => state.minimapEnabled, set: (value) => api.set_minimap_enabled(value) },
    minimap_size: { get: () => copyPoint(state.minimapSize), set: (value) => api.set_minimap_size(value) },
    minimap_opacity: { get: () => state.minimapOpacity, set: (value) => api.set_minimap_opacity(value) },
    show_menu: property('showMenu'), show_zoom_label: property('showZoomLabel'), show_zoom_buttons: property('showZoomButtons'),
    show_grid_buttons: property('showGridButtons'), show_minimap_button: property('showMinimapButton'), show_arrange_button: property('showArrangeButton'),
    connections: { get: () => api.get_connection_list(), set: (value) => api.set_connections(value) },
  });
  state.pointerDown = (event) => {
    if (event.button === 1) {
      state.panOrigin = copyPoint(state.scrollOffset);
      state.panPointerOrigin = { x: event.global.x, y: event.global.y };
      event.stopPropagation();
      return;
    }
    if (event.button === 0 && event.target === node) api.set_selected(null);
    if (event.button === 2 && event.target === node) state.popupRequest.emit(event.getLocalPosition(node));
  };
  state.pointerMove = (event) => {
    if (state.panOrigin === null || state.panPointerOrigin === null) return;
    api.set_scroll_offset({
      x: state.panOrigin.x - (event.global.x - state.panPointerOrigin.x) / state.zoom,
      y: state.panOrigin.y - (event.global.y - state.panPointerOrigin.y) / state.zoom,
    });
  };
  state.pointerUp = () => {
    state.panOrigin = null;
    state.panPointerOrigin = null;
  };
  state.wheel = (event) => {
    if (event.deltaY === 0 && event.deltaX === 0) return;
    if (state.panningScheme === 1 || event.shiftKey) {
      api.set_scroll_offset({
        x: state.scrollOffset.x + (event.shiftKey ? event.deltaY : event.deltaX) / state.zoom,
        y: state.scrollOffset.y + (event.shiftKey ? event.deltaX : event.deltaY) / state.zoom,
      });
    } else {
      const local = event.getLocalPosition(node);
      const graphPoint = {
        x: state.scrollOffset.x + local.x / state.zoom,
        y: state.scrollOffset.y + local.y / state.zoom,
      };
      const nextZoom = Math.max(state.zoomMin, Math.min(state.zoomMax, state.zoom * (event.deltaY < 0 ? state.zoomStep : 1 / state.zoomStep)));
      if (nextZoom === state.zoom) return;
      state.zoom = nextZoom;
      state.scrollOffset = {
        x: graphPoint.x - local.x / nextZoom,
        y: graphPoint.y - local.y / nextZoom,
      };
      state.scrollOffsetChanged.emit(copyPoint(state.scrollOffset));
      redrawGraphEdit(node);
    }
    event.preventDefault();
    event.stopPropagation();
  };
  node.eventMode = 'static';
  node.on('pointerdown', state.pointerDown);
  node.on('globalpointermove', state.pointerMove);
  node.on('pointerup', state.pointerUp);
  node.on('pointerupoutside', state.pointerUp);
  node.on('wheel', state.wheel);
  state.releaseNode = registerCanvasNodeRelease(node, () => releaseCanvasGraphEdit(node));
  redrawGraphEdit(node);
  return node as GodotCanvasGraphEdit;
}

export function createGodotCanvasGraphEdit(): GodotCanvasGraphEdit {
  const node = new Container();
  registerGodotObjectIdentity(node, 'GraphEdit');
  bindGraphControlBase(node);
  return bindCanvasGraphEdit(node);
}

export function createGodotCanvasGraphNode(): GodotCanvasGraphNode {
  const node = new Container();
  registerGodotObjectIdentity(node, 'GraphNode');
  bindGraphControlBase(node);
  return bindCanvasGraphNode(node);
}

export function createGodotCanvasGraphFrame(): GodotCanvasGraphFrame {
  const node = new Container();
  registerGodotObjectIdentity(node, 'GraphFrame');
  bindGraphControlBase(node);
  return bindCanvasGraphFrame(node);
}

function bindGraphControlBase(node: Container): void {
  bindCanvasControl(node, {
    position: { x: 0, y: 0 },
    size: { x: 0, y: 0 },
    anchor: { x: 0, y: 0 },
    customMinimumSize: { x: 0, y: 0 },
    sizeFlagsHorizontal: 1,
    sizeFlagsVertical: 1,
    mouseFilter: 0,
    nativeSize: false,
  });
}

export function resizeCanvasGraphControl(node: Container, sizeValue: ControlPoint): void {
  const size = point('Graph control size', sizeValue);
  if (size.x < 0 || size.y < 0) throw new RangeError('Graph control size must be non-negative.');
  setCanvasControlSize(node, size);
  node.hitArea = new Rectangle(0, 0, Math.max(1, size.x), Math.max(1, size.y));
  if (ELEMENT.has(node)) redrawElement(node);
  if (GRAPH_EDIT.has(node)) redrawGraphEdit(node);
}

export function releaseCanvasGraphElement(node: Container): void {
  const state = ELEMENT.get(node);
  if (state === undefined) return;
  state.releaseNode();
  node.off('pointerdown', state.pointerDown);
  node.off('globalpointermove', state.pointerMove);
  node.off('pointerup', state.pointerUp);
  node.off('pointerupoutside', state.pointerUp);
  state.chrome.removeFromParent();
  state.chrome.destroy();
  state.titleText.removeFromParent();
  state.titleText.destroy();
  state.titleBar.removeFromParent();
  state.titleBar.destroy({ children: true });
  ELEMENT.delete(node);
  GRAPH_NODE.delete(node);
  GRAPH_FRAME.delete(node);
}

export function releaseCanvasGraphEdit(node: Container): void {
  const state = GRAPH_EDIT.get(node);
  if (state === undefined) return;
  state.releaseNode();
  state.connectionLayer.removeFromParent();
  state.connectionLayer.destroy();
  state.chromeLayer.removeFromParent();
  state.chromeLayer.destroy();
  state.menuBox.removeFromParent();
  state.menuBox.destroy({ children: true });
  state.connections.length = 0;
  state.activity.clear();
  state.elementFrames.clear();
  GRAPH_EDIT.delete(node);
}
