/**
 * @godot-class TileMapLayer
 * @role BINDING
 *
 * Godot 4.7's `TileMapLayer` (`scene/2d/tile_map_layer.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a Node2D painting a grid of its TileSet's tiles.
 * Each cell is a source's tile at atlas coordinates, one of its alternatives (flipped or
 * transposed), drawn centred in the cell from the atlas texture's region; its collision polygons
 * make the layer a static body (`collision-object-2d.ts`) on the tile set's first physics layer.
 * The cells come from the scene's `tile_map_data` (12 bytes a cell after a 2-byte format:
 * x, y, source, atlas x, atlas y, alternative, `tile_map_layer.cpp:1650`). Square tiles only;
 * scene tiles, terrains, navigation and occlusion are not bound.
 */

import type { ReactElement } from 'react';
import { Group, type Object3D, type Texture } from 'three';
import { godot_canvas_item_self_filter } from './canvas-item';
import { godot_collision_object_2d_mount, godot_collision_object_2d_shapes, set_collision_layer, set_collision_mask } from './collision-object-2d';
import { godot_node_2d_mount, godot_node_2d_props } from './node-2d';
import { godot_node_adopt, godot_node_entity } from './node';
import { construct as rect2i, type Rect2i } from './rect2i';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import { get_height as heightOf, get_width as widthOf } from './texture-2d';
import type { TileSet } from './tile-set';
import { construct as vector2, type Vector2 } from './vector2';
import { construct as vector2i, type Vector2i } from './vector2i';

const CLASSES = ['TileMapLayer', 'Node2D', 'CanvasItem', 'Node', 'Object'];

interface Cell {
  readonly source: number;
  readonly atlasX: number;
  readonly atlasY: number;
  readonly alternative: number;
}

interface LayerState {
  tileSet: TileSet | null;
  readonly cells: Map<string, Cell>;
  enabled: boolean;
  collisionEnabled: boolean;
  version: number;
}

const LAYERS = new WeakMap<object, LayerState>();

function stateOf(self: object, member: string): LayerState {
  const state = LAYERS.get(godot_node_entity(self));
  if (state === undefined) throw new Error(`godot-compat: ${member} on an object that is not a TileMapLayer`);
  return state;
}

const key = (x: number, y: number): string => `${String(x)},${String(y)}`;

function tileSize(state: LayerState): Vector2i {
  return state.tileSet?.tileSize ?? vector2i(16, 16);
}

function imageSource(texture: Texture): string {
  const image = texture.image as { readonly src?: string; readonly toDataURL?: () => string } | null | undefined;
  if (image === null || image === undefined) return '';
  if (typeof image.src === 'string') return image.src;
  return typeof image.toDataURL === 'function' ? image.toDataURL() : '';
}

const DRAWN = new WeakMap<Object3D, { readonly nodes: HTMLElement[]; readonly sources: Map<Texture, string> }>();

/** `NOTIFICATION_DRAW` of the layer's quadrants: each cell's tile at its place. */
function draw(entity: Object3D, element: HTMLElement): void {
  const state = LAYERS.get(entity) as LayerState;
  let drawn = DRAWN.get(entity);
  if (drawn === undefined) {
    drawn = { nodes: [], sources: new Map() };
    DRAWN.set(entity, drawn);
  }
  const size = tileSize(state);
  let index = 0;
  const filter = godot_canvas_item_self_filter(entity, element);
  for (const [at, cell] of state.enabled ? state.cells : []) {
    const source = state.tileSet?.sources.get(cell.source);
    const tile = source?.tiles.get(`${String(cell.atlasX)}:${String(cell.atlasY)}`);
    const alternative = tile?.alternatives.get(cell.alternative);
    if (source === undefined || source.texture === null || tile === undefined) continue;
    let url = drawn.sources.get(source.texture);
    if (url === undefined) {
      url = imageSource(source.texture);
      if (url !== '') drawn.sources.set(source.texture, url);
    }
    const [x, y] = at.split(',').map(Number) as [number, number];
    const w = source.regionSize.x * tile.size.x;
    const h = source.regionSize.y * tile.size.y;
    const sx = source.margins.x + cell.atlasX * (source.regionSize.x + source.separation.x);
    const sy = source.margins.y + cell.atlasY * (source.regionSize.y + source.separation.y);
    let node = drawn.nodes[index];
    if (node === undefined) {
      node = element.ownerDocument.createElement('div');
      node.style.position = 'absolute';
      node.style.backgroundRepeat = 'no-repeat';
      drawn.nodes[index] = node;
    }
    if (node.parentElement !== element) element.appendChild(node);
    index += 1;
    const cx = (x + 0.5) * size.x;
    const cy = (y + 0.5) * size.y;
    node.style.display = '';
    node.style.left = `${String(cx - w / 2)}px`;
    node.style.top = `${String(cy - h / 2)}px`;
    node.style.width = `${String(w)}px`;
    node.style.height = `${String(h)}px`;
    node.style.backgroundImage = `url("${url}")`;
    node.style.backgroundSize = `${String(widthOf(source.texture))}px ${String(heightOf(source.texture))}px`;
    node.style.backgroundPosition = `${String(-sx)}px ${String(-sy)}px`;
    // A transposed tile swaps its axes; flips mirror it (`TileMapLayer::draw_tile`, `tile_map_layer.cpp:2580`).
    const fh = alternative?.flipH === true ? -1 : 1;
    const fv = alternative?.flipV === true ? -1 : 1;
    node.style.transform = alternative?.transpose === true ? `matrix(0, ${String(fv)}, ${String(fh)}, 0, 0, 0)` : fh === 1 && fv === 1 ? '' : `scale(${String(fh)}, ${String(fv)})`;
    node.style.filter = filter;
  }
  for (const extra of drawn.nodes.slice(index)) extra.remove();
  drawn.nodes.length = index;
}

function drawKey(entity: Object3D, element: HTMLElement): string {
  const state = LAYERS.get(entity) as LayerState;
  return `${String(state.version)}:${String(state.enabled)}:${godot_canvas_item_self_filter(entity, element)}`;
}

/** The layer's tiles' collision polygons, each in the layer's space. */
function shapes(state: LayerState): { readonly points: readonly (readonly [number, number])[]; readonly radius: number }[] {
  if (!state.collisionEnabled || state.tileSet === null) return [];
  const size = tileSize(state);
  const found: { readonly points: readonly (readonly [number, number])[]; readonly radius: number }[] = [];
  for (const [at, cell] of state.cells) {
    const alternative = state.tileSet.sources.get(cell.source)?.tiles.get(`${String(cell.atlasX)}:${String(cell.atlasY)}`)?.alternatives.get(cell.alternative);
    const polygons = alternative?.polygons.get(0);
    if (polygons === undefined) continue;
    const [x, y] = at.split(',').map(Number) as [number, number];
    const cx = (x + 0.5) * size.x;
    const cy = (y + 0.5) * size.y;
    for (const flat of polygons) {
      const points: (readonly [number, number])[] = [];
      for (let i = 0; i + 1 < flat.length; i += 2) points.push([cx + (flat[i] as number), cy + (flat[i + 1] as number)]);
      found.push({ points, radius: 0 });
    }
  }
  return found;
}

/**
 * @godot TileMapLayer (protocol)
 * @source scene/2d/tile_map_layer.cpp:3380
 */
export function godot_tile_map_layer_mount(entity: Object3D): void {
  const state: LayerState = { tileSet: null, cells: new Map(), enabled: true, collisionEnabled: true, version: 0 };
  LAYERS.set(entity, state);
  godot_node_2d_mount(entity, CLASSES, { draw, drawKey });
  godot_collision_object_2d_mount(entity, 'static', false);
  godot_collision_object_2d_shapes(entity, () => shapes(state));
}

/**
 * @godot TileMapLayer.TileMapLayer
 * @source scene/2d/tile_map_layer.cpp:3380
 */
export function construct(): Group {
  const entity = new Group();
  godot_node_adopt(entity, { kind: 'node', classes: CLASSES });
  godot_tile_map_layer_mount(entity);
  return entity;
}

/**
 * The tile set, whose first physics layer's collision layer and mask the layer's tiles take.
 *
 * @godot TileMapLayer.set_tile_set
 * @source scene/2d/tile_map_layer.cpp:3180
 */
export function set_tile_set(self: object, tile_set: TileSet | null): void {
  const state = stateOf(self, 'set_tile_set');
  state.tileSet = tile_set;
  const physics = tile_set?.physicsLayers.get(0);
  if (physics !== undefined) {
    set_collision_layer(self, physics.layer);
    set_collision_mask(self, physics.mask);
  }
  state.version += 1;
}

/**
 * @godot TileMapLayer.get_tile_set
 * @source scene/2d/tile_map_layer.cpp:3206
 */
export function get_tile_set(self: object): TileSet | null {
  return stateOf(self, 'get_tile_set').tileSet;
}

/**
 * The cells as the scene stores them (`tile_map_data`).
 *
 * @godot TileMapLayer.set_tile_map_data_from_array
 * @source scene/2d/tile_map_layer.cpp:1650
 */
export function set_tile_map_data_from_array(self: object, data: readonly number[]): void {
  const state = stateOf(self, 'set_tile_map_data_from_array');
  state.cells.clear();
  const bytes = Uint8Array.from(data);
  const view = new DataView(bytes.buffer);
  for (let offset = 2; offset + 12 <= bytes.length; offset += 12) {
    const x = view.getInt16(offset, true);
    const y = view.getInt16(offset + 2, true);
    const source = view.getUint16(offset + 4, true);
    const atlasX = view.getUint16(offset + 6, true);
    const atlasY = view.getUint16(offset + 8, true);
    const alternative = view.getUint16(offset + 10, true);
    state.cells.set(key(x, y), { source, atlasX, atlasY, alternative });
  }
  state.version += 1;
}

/**
 * Paints a cell; a source of -1 (or atlas coords of -1) erases it.
 *
 * @godot TileMapLayer.set_cell
 * @source scene/2d/tile_map_layer.cpp:2930
 */
export function set_cell(self: object, coords: Vector2i, source_id = -1, atlas_coords: Vector2i = vector2i(-1, -1), alternative_tile = 0): void {
  const state = stateOf(self, 'set_cell');
  if (source_id < 0 || atlas_coords.x < 0 || atlas_coords.y < 0) state.cells.delete(key(coords.x, coords.y));
  else state.cells.set(key(coords.x, coords.y), { source: source_id, atlasX: atlas_coords.x, atlasY: atlas_coords.y, alternative: alternative_tile });
  state.version += 1;
}

/**
 * @godot TileMapLayer.erase_cell
 * @source scene/2d/tile_map_layer.cpp:2968
 */
export function erase_cell(self: object, coords: Vector2i): void {
  set_cell(self, coords);
}

/**
 * @godot TileMapLayer.clear
 * @source scene/2d/tile_map_layer.cpp:3080
 */
export function clear(self: object): void {
  const state = stateOf(self, 'clear');
  state.cells.clear();
  state.version += 1;
}

/**
 * @godot TileMapLayer.get_cell_source_id
 * @source scene/2d/tile_map_layer.cpp:2980
 */
export function get_cell_source_id(self: object, coords: Vector2i): number {
  return stateOf(self, 'get_cell_source_id').cells.get(key(coords.x, coords.y))?.source ?? -1;
}

/**
 * @godot TileMapLayer.get_cell_atlas_coords
 * @source scene/2d/tile_map_layer.cpp:2990
 */
export function get_cell_atlas_coords(self: object, coords: Vector2i): Vector2i {
  const cell = stateOf(self, 'get_cell_atlas_coords').cells.get(key(coords.x, coords.y));
  return cell === undefined ? vector2i(-1, -1) : vector2i(cell.atlasX, cell.atlasY);
}

/**
 * @godot TileMapLayer.get_cell_alternative_tile
 * @source scene/2d/tile_map_layer.cpp:3000
 */
export function get_cell_alternative_tile(self: object, coords: Vector2i): number {
  return stateOf(self, 'get_cell_alternative_tile').cells.get(key(coords.x, coords.y))?.alternative ?? -1;
}

/**
 * @godot TileMapLayer.get_used_cells
 * @source scene/2d/tile_map_layer.cpp:3100
 */
export function get_used_cells(self: object): Vector2i[] {
  return [...stateOf(self, 'get_used_cells').cells.keys()].map((at) => {
    const [x, y] = at.split(',').map(Number) as [number, number];
    return vector2i(x, y);
  });
}

/**
 * @godot TileMapLayer.get_used_cells_by_id
 * @source scene/2d/tile_map_layer.cpp:3110
 */
export function get_used_cells_by_id(self: object, source_id = -1, atlas_coords: Vector2i = vector2i(-1, -1), alternative_tile = -1): Vector2i[] {
  const found: Vector2i[] = [];
  for (const [at, cell] of stateOf(self, 'get_used_cells_by_id').cells) {
    if (source_id !== -1 && cell.source !== source_id) continue;
    if (atlas_coords.x !== -1 && (cell.atlasX !== atlas_coords.x || cell.atlasY !== atlas_coords.y)) continue;
    if (alternative_tile !== -1 && cell.alternative !== alternative_tile) continue;
    const [x, y] = at.split(',').map(Number) as [number, number];
    found.push(vector2i(x, y));
  }
  return found;
}

/**
 * @godot TileMapLayer.get_used_rect
 * @source scene/2d/tile_map_layer.cpp:3130
 */
export function get_used_rect(self: object): Rect2i {
  const cells = get_used_cells(self);
  if (cells.length === 0) return rect2i();
  const xs = cells.map((cell) => cell.x);
  const ys = cells.map((cell) => cell.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return rect2i(x, y, Math.max(...xs) - x + 1, Math.max(...ys) - y + 1);
}

/**
 * The cell's centre in the layer's space.
 *
 * @godot TileMapLayer.map_to_local
 * @source scene/2d/tile_map_layer.cpp:3240
 */
export function map_to_local(self: object, map_position: Vector2i): Vector2 {
  const size = tileSize(stateOf(self, 'map_to_local'));
  return vector2((map_position.x + 0.5) * size.x, (map_position.y + 0.5) * size.y);
}

/**
 * The cell a point in the layer's space is in.
 *
 * @godot TileMapLayer.local_to_map
 * @source scene/2d/tile_map_layer.cpp:3246
 */
export function local_to_map(self: object, local_position: Vector2): Vector2i {
  const size = tileSize(stateOf(self, 'local_to_map'));
  return vector2i(Math.floor(local_position.x / size.x), Math.floor(local_position.y / size.y));
}

/**
 * @godot TileMapLayer.set_enabled
 * @source scene/2d/tile_map_layer.cpp:3150
 */
export function set_enabled(self: object, enabled: boolean): void {
  const state = stateOf(self, 'set_enabled');
  state.enabled = enabled;
  state.version += 1;
}

/**
 * @godot TileMapLayer.set_collision_enabled
 * @source scene/2d/tile_map_layer.cpp:3330
 */
export function set_collision_enabled(self: object, enabled: boolean): void {
  stateOf(self, 'set_collision_enabled').collisionEnabled = enabled;
}

const TILE_MAP_LAYER = {
  create: () => new Group(),
  classes: CLASSES,
  spatial: false,
  mount: godot_tile_map_layer_mount,
  props: new Map<string, GodotElementProp<Object3D>>([
    ...godot_node_2d_props(),
    ['tileSet', (entity, value: TileSet | null) => set_tile_set(entity, value)],
    ['tileMapData', (entity, value: readonly number[]) => set_tile_map_data_from_array(entity, value)],
    ['enabled', (entity, value: boolean) => set_enabled(entity, value)],
    ['collisionEnabled', (entity, value: boolean) => set_collision_enabled(entity, value)],
    ['renderingQuadrantSize', () => undefined],
    ['ySortOrigin', () => undefined],
    ['navigationEnabled', () => undefined],
    ['useKinematicBodies', () => undefined],
    ['collisionVisibilityMode', () => undefined],
    ['navigationVisibilityMode', () => undefined],
  ]),
};

/**
 * A TileMapLayer as a scene writes it: `<GodotTileMapLayer tileSet={tiles} tileMapData={cells} />`.
 *
 * @godot TileMapLayer (protocol)
 * @source scene/2d/tile_map_layer.cpp:3380
 */
export function GodotTileMapLayer(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(TILE_MAP_LAYER, props);
}
