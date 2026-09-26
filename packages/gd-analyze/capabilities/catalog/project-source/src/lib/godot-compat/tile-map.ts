/** Godot TileSet/TileMap/TileMapLayer on @pixi/tilemap's batched CompositeTilemap primitive. */

import { CompositeTilemap } from '@pixi/tilemap';
import { Container, Matrix, Texture } from 'pixi.js';
import RAPIER from '@dimforge/rapier2d-compat';
import { registerGodotObjectIdentity } from './object';
import {
  bindGodotResourceProtocol,
  duplicateGodotSubresource,
  godotResourceEmitChanged,
} from './resource-io';
import {
  rapierColliderDesc2D,
  releasePhysicsShapeResource2D,
  retainPhysicsShapeResource2D,
  type GodotShape2D,
  type PhysicsShapeResource2DConsumer,
} from './physics-query-2d';
import {
  bindCanvasLightOccluder2D,
  releaseCanvasLightOccluder2D,
  type GodotCanvasLightOccluder2D,
  type GodotOccluderPolygon2D,
} from './canvas-light-2d';
import type { CollisionLayers } from './collision-layers';
import type { GodotColliderOwner, GodotMutableColliderRegistry } from './collider-registry';
import type { ColorValue } from './variant';
import {
  GodotCanvasItemMaterial,
  releaseCanvasItemMaterial,
  setCanvasItemMaterial,
  type GodotCanvasMaterial,
} from './canvas-item-material';
import { GodotShaderMaterial } from './shader-material';
import {
  GodotTileMapPattern,
  createTileMapPattern,
  type TileMapPatternCell,
} from './tile-map-pattern';
import { bindGodotCanvasNode2DApi, registerCanvasNodeRelease } from './node';

export { GodotTileMapPattern, createTileMapPattern } from './tile-map-pattern';
export type { TileMapPatternCell } from './tile-map-pattern';

export interface TileVector2i {
  readonly x: number;
  readonly y: number;
}

export interface TileRect2 {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface TileTransform2D {
  readonly x: TileVector2i;
  readonly y: TileVector2i;
  readonly origin: TileVector2i;
}

export interface Godot3TileShape {
  readonly shape: GodotShape2D;
  readonly transform: TileTransform2D;
  readonly oneWay: boolean;
  readonly oneWayMargin: number;
  readonly autotileCoord: TileVector2i;
}

export interface Godot3Tile {
  readonly id: number;
  name: string;
  texture: Texture | null;
  normalMap: Texture | null;
  textureOffset: TileVector2i;
  material: unknown;
  modulate: ColorValue;
  region: TileRect2;
  tileMode: number;
  autotileSize: TileVector2i;
  autotileSpacing: number;
  autotileIconCoordinate: TileVector2i;
  autotileZIndices: Map<string, number>;
  occluderOffset: TileVector2i;
  occluder: GodotOccluderPolygon2D | null;
  navigationPolygon: unknown;
  navigationPolygonOffset: TileVector2i;
  shapes: Godot3TileShape[];
  zIndex: number;
}

export interface Godot3TileInput extends Partial<Omit<Godot3Tile, 'id' | 'autotileZIndices'>> {
  readonly id: number;
  readonly autotileZIndices?: readonly {
    readonly coords: TileVector2i;
    readonly zIndex: number;
  }[];
}

export interface GodotTileAlternative {
  id: number;
  readonly flipH: boolean;
  readonly flipV: boolean;
  readonly transpose: boolean;
}

/** Stable TileData identity owned by one atlas tile alternative. */
export interface GodotTileData extends GodotTileAlternative {}

interface RetainedTileDataState {
  customData: ReadonlyMap<string, unknown>;
  material: GodotCanvasMaterial | null;
  modulate: ColorValue;
  textureOrigin: TileVector2i;
  collisionPolygons: Map<number, TileVector2i[][]>;
  terrainSet: number;
  terrain: number;
  terrainPeering: Map<number, number>;
  changed: () => void;
}

const TILE_DATA_STATE = new WeakMap<GodotTileData, RetainedTileDataState>();

function requireTileDataState(data: GodotTileData, member: string): RetainedTileDataState {
  const state = TILE_DATA_STATE.get(data);
  if (state === undefined) {
    throw new TypeError(`TileData.${member} requires an atlas-owned retained TileData identity.`);
  }
  return state;
}

/** Seat authored TileSet custom-layer values on the atlas-owned TileData identity. */
export function bindTileDataCustomData(
  data: GodotTileData,
  values: ReadonlyMap<string, unknown> | Readonly<Record<string, unknown>>,
): void {
  const state = TILE_DATA_STATE.get(data);
  if (state === undefined) {
    throw new TypeError('TileData custom data requires an atlas-owned retained TileData identity.');
  }
  state.customData = new Map(
    values instanceof Map ? values : Object.entries(values),
  );
  state.changed();
}

/** `TileData.get_custom_data(layer_name)` — return the retained Variant or null when absent. */
export function getTileDataCustomData(data: GodotTileData, layerName: string): unknown {
  if (typeof layerName !== 'string') {
    throw new TypeError('TileData.get_custom_data requires a StringName layer name.');
  }
  return requireTileDataState(data, 'get_custom_data').customData.get(layerName) ?? null;
}

export function getTileDataCollisionPolygonsCount(data: GodotTileData, layerId: number): number {
  const layer = nonNegativeInteger(layerId, 'TileData layer_id');
  return requireTileDataState(data, 'get_collision_polygons_count').collisionPolygons.get(layer)?.length ?? 0;
}

export function setTileDataCollisionPolygonsCount(
  data: GodotTileData,
  layerId: number,
  polygonsCount: number,
): void {
  const layer = nonNegativeInteger(layerId, 'TileData layer_id');
  const count = nonNegativeInteger(polygonsCount, 'TileData polygons_count');
  const state = requireTileDataState(data, 'set_collision_polygons_count');
  const polygons = state.collisionPolygons.get(layer) ?? [];
  if (polygons.length === count) return;
  if (polygons.length > count) polygons.length = count;
  while (polygons.length < count) polygons.push([]);
  if (count === 0) state.collisionPolygons.delete(layer);
  else state.collisionPolygons.set(layer, polygons);
  state.changed();
}

export function getTileDataCollisionPolygonPoints(
  data: GodotTileData,
  layerId: number,
  polygonIndex: number,
): TileVector2i[] {
  const layer = nonNegativeInteger(layerId, 'TileData layer_id');
  const index = nonNegativeInteger(polygonIndex, 'TileData polygon_index');
  const polygon = requireTileDataState(data, 'get_collision_polygon_points').collisionPolygons.get(layer)?.[index];
  if (polygon === undefined) throw new RangeError(`TileData collision polygon ${index} does not exist in layer ${layer}.`);
  return polygon.map(copyCoords);
}

export function setTileDataCollisionPolygonPoints(
  data: GodotTileData,
  layerId: number,
  polygonIndex: number,
  points: readonly TileVector2i[],
): void {
  const layer = nonNegativeInteger(layerId, 'TileData layer_id');
  const index = nonNegativeInteger(polygonIndex, 'TileData polygon_index');
  if (!Array.isArray(points)) throw new TypeError('TileData.set_collision_polygon_points requires PackedVector2Array.');
  const state = requireTileDataState(data, 'set_collision_polygon_points');
  const polygons = state.collisionPolygons.get(layer);
  if (polygons?.[index] === undefined) {
    throw new RangeError(`TileData collision polygon ${index} does not exist in layer ${layer}.`);
  }
  polygons[index] = points.map((point) => finiteCoords(point, 'TileData collision polygon point'));
  state.changed();
}

export function getTileDataMaterial(data: GodotTileData): GodotCanvasMaterial | null {
  return requireTileDataState(data, 'material').material;
}

export function setTileDataMaterial(data: GodotTileData, value: GodotCanvasMaterial | null): void {
  const state = requireTileDataState(data, 'material');
  if (state.material === value) return;
  if (value !== null && !(value instanceof GodotCanvasItemMaterial) && !(value instanceof GodotShaderMaterial)) {
    throw new TypeError('TileData.material must be a CanvasItemMaterial, ShaderMaterial, or null.');
  }
  state.material = value;
  state.changed();
}

export function getTileDataModulate(data: GodotTileData): ColorValue {
  return copyColor(requireTileDataState(data, 'modulate').modulate);
}

export function setTileDataModulate(data: GodotTileData, value: ColorValue): void {
  const state = requireTileDataState(data, 'modulate');
  state.modulate = finiteColor(value, 'TileData.modulate');
  state.changed();
}

export function getTileDataTextureOrigin(data: GodotTileData): TileVector2i {
  return copyCoords(requireTileDataState(data, 'texture_origin').textureOrigin);
}

export function setTileDataTextureOrigin(data: GodotTileData, value: TileVector2i): void {
  const state = requireTileDataState(data, 'set_texture_origin');
  state.textureOrigin = finiteCoords(value, 'TileData.texture_origin');
  state.changed();
}

export function getTileDataTerrainSet(data: GodotTileData): number {
  return requireTileDataState(data, 'terrain_set').terrainSet;
}

export function setTileDataTerrainSet(data: GodotTileData, value: number): void {
  const next = integer(value, 'TileData.terrain_set');
  const state = requireTileDataState(data, 'terrain_set');
  if (state.terrainSet === next) return;
  state.terrainSet = next;
  state.changed();
}

export function getTileDataTerrain(data: GodotTileData): number {
  return requireTileDataState(data, 'terrain').terrain;
}

export function setTileDataTerrain(data: GodotTileData, value: number): void {
  const next = integer(value, 'TileData.terrain');
  const state = requireTileDataState(data, 'terrain');
  if (state.terrain === next) return;
  state.terrain = next;
  state.changed();
}

/** Seat one authored TileSet terrain peering bit on its atlas-owned TileData identity. */
export function setTileDataTerrainPeeringBit(
  data: GodotTileData,
  cellNeighbor: number,
  terrain: number,
): void {
  const neighbor = integer(cellNeighbor, 'TileData terrain peering neighbor');
  const next = integer(terrain, 'TileData terrain peering terrain');
  const state = requireTileDataState(data, 'terrain_peering_bit');
  if (state.terrainPeering.get(neighbor) === next) return;
  state.terrainPeering.set(neighbor, next);
  state.changed();
}

export interface GodotAtlasTile {
  atlasCoords: TileVector2i;
  sizeInAtlas: TileVector2i;
  readonly alternatives: Map<number, GodotTileData>;
}

export interface GodotTileSetAtlasSourceOptions {
  readonly texture?: Texture | null;
  readonly textureRegionSize?: TileVector2i;
  readonly margins?: TileVector2i;
  readonly separation?: TileVector2i;
  readonly useTexturePadding?: boolean;
}

/** One Godot 4 TileSetAtlasSource: an atlas texture plus its authored tile coordinate table. */
export class GodotTileSetAtlasSource {
  private liveTexture: Texture | null;
  private liveTextureRegionSize: TileVector2i;
  private liveMargins: TileVector2i;
  private liveSeparation: TileVector2i;
  private liveUseTexturePadding: boolean;
  private readonly tiles = new Map<string, GodotAtlasTile>();
  private readonly observers = new Set<() => void>();

  constructor(options: GodotTileSetAtlasSourceOptions = {}) {
    this.liveTexture = options.texture ?? null;
    this.liveTextureRegionSize = positiveCoords(options.textureRegionSize ?? { x: 16, y: 16 }, 'TileSetAtlasSource.texture_region_size');
    this.liveMargins = nonNegativeCoords(options.margins ?? ZERO_COORDS, 'TileSetAtlasSource.margins');
    this.liveSeparation = nonNegativeCoords(options.separation ?? ZERO_COORDS, 'TileSetAtlasSource.separation');
    this.liveUseTexturePadding = options.useTexturePadding ?? true;
    registerGodotObjectIdentity(this, 'TileSetAtlasSource');
    bindGodotResourceProtocol(this, {
      createDuplicate(source, subresources, memo) {
        const duplicate = new GodotTileSetAtlasSource({
          texture: subresources ? duplicateGodotSubresource(source.texture, memo) : source.texture,
          textureRegionSize: source.texture_region_size,
          margins: source.margins,
          separation: source.separation,
          useTexturePadding: source.use_texture_padding,
        });
        for (const tile of source.tiles.values()) {
          duplicate.create_tile(tile.atlasCoords, tile.sizeInAtlas);
          for (const id of tile.alternatives.keys()) {
            if (id !== 0) duplicate.create_alternative_tile(tile.atlasCoords, id);
          }
        }
        return duplicate as typeof source;
      },
    });
  }

  get texture(): Texture | null { return this.liveTexture; }
  set texture(value: Texture | null) { this.set_texture(value); }
  get texture_region_size(): TileVector2i { return copyCoords(this.liveTextureRegionSize); }
  set texture_region_size(value: TileVector2i) { this.set_texture_region_size(value); }
  get margins(): TileVector2i { return copyCoords(this.liveMargins); }
  set margins(value: TileVector2i) { this.set_margins(value); }
  get separation(): TileVector2i { return copyCoords(this.liveSeparation); }
  set separation(value: TileVector2i) { this.set_separation(value); }
  get use_texture_padding(): boolean { return this.liveUseTexturePadding; }
  set use_texture_padding(value: boolean) { this.set_use_texture_padding(value); }

  set_texture(value: Texture | null): void {
    if (value !== null && !(value instanceof Texture)) {
      throw new TypeError('TileSetAtlasSource.texture requires a native Pixi Texture2D.');
    }
    if (this.liveTexture !== value) { this.liveTexture = value; this.changed(); }
  }
  get_texture(): Texture | null { return this.liveTexture; }
  set_texture_region_size(value: TileVector2i): void { this.liveTextureRegionSize = positiveCoords(value, 'TileSetAtlasSource.texture_region_size'); this.changed(); }
  get_texture_region_size(): TileVector2i { return copyCoords(this.liveTextureRegionSize); }
  set_margins(value: TileVector2i): void { this.liveMargins = nonNegativeCoords(value, 'TileSetAtlasSource.margins'); this.changed(); }
  get_margins(): TileVector2i { return copyCoords(this.liveMargins); }
  set_separation(value: TileVector2i): void { this.liveSeparation = nonNegativeCoords(value, 'TileSetAtlasSource.separation'); this.changed(); }
  get_separation(): TileVector2i { return copyCoords(this.liveSeparation); }
  set_use_texture_padding(value: boolean): void { if (this.liveUseTexturePadding !== Boolean(value)) { this.liveUseTexturePadding = Boolean(value); this.changed(); } }
  get_use_texture_padding(): boolean { return this.liveUseTexturePadding; }

  observe(observer: () => void): () => void {
    this.observers.add(observer);
    return () => { this.observers.delete(observer); };
  }

  private changed(): void {
    for (const observer of this.observers) observer();
    godotResourceEmitChanged(this);
  }

  create_tile(atlasCoords: TileVector2i, size: TileVector2i = ONE_COORDS): void {
    const key = coordsKey(atlasCoords);
    if (this.tiles.has(key)) return;
    const coords = nonNegativeCoords(atlasCoords, 'TileSetAtlasSource.atlas_coords');
    const tileSize = positiveCoords(size, 'TileSetAtlasSource.tile_size_in_atlas');
    if (!this.hasRoom(coords, tileSize)) throw new Error(`TileSetAtlasSource cannot create tile at ${coords.x},${coords.y}: region occupied or outside texture.`);
    this.tiles.set(key, {
      atlasCoords: copyCoords(coords),
      sizeInAtlas: copyCoords(tileSize),
      alternatives: new Map([[0, createTileData(0, () => this.changed())]]),
    });
    this.changed();
  }

  remove_tile(atlasCoords: TileVector2i): void {
    if (this.tiles.delete(coordsKey(atlasCoords))) this.changed();
  }

  has_tile(atlasCoords: TileVector2i): boolean {
    return this.tiles.has(coordsKey(atlasCoords));
  }

  get_tiles_count(): number { return this.tiles.size; }

  get_tile_id(index: number): TileVector2i {
    const tile = [...this.tiles.values()][index];
    if (tile === undefined) throw new RangeError(`TileSetAtlasSource tile index ${index} is invalid.`);
    return copyCoords(tile.atlasCoords);
  }

  get_tile_size_in_atlas(atlasCoords: TileVector2i): TileVector2i {
    return copyCoords(this.requireTile(atlasCoords).sizeInAtlas);
  }

  move_tile_in_atlas(atlasCoords: TileVector2i, newAtlasCoords: TileVector2i = INVALID_COORDS, newSize: TileVector2i = INVALID_COORDS): void {
    const tile = this.requireTile(atlasCoords);
    const destination = coordsEqual(newAtlasCoords, INVALID_COORDS) ? tile.atlasCoords : nonNegativeCoords(newAtlasCoords, 'TileSetAtlasSource.new_atlas_coords');
    const size = coordsEqual(newSize, INVALID_COORDS) ? tile.sizeInAtlas : positiveCoords(newSize, 'TileSetAtlasSource.new_size');
    if (!this.hasRoom(destination, size, tile.atlasCoords)) throw new Error(`TileSetAtlasSource cannot move tile to ${destination.x},${destination.y}: region occupied or outside texture.`);
    this.tiles.delete(coordsKey(tile.atlasCoords));
    tile.atlasCoords = copyCoords(destination);
    tile.sizeInAtlas = copyCoords(size);
    this.tiles.set(coordsKey(destination), tile);
    this.changed();
  }

  get_tile_at_coords(coords: TileVector2i): TileVector2i {
    for (const tile of this.tiles.values()) if (rectContainsTileCell(tile.atlasCoords, tile.sizeInAtlas, coords)) return copyCoords(tile.atlasCoords);
    return copyCoords(INVALID_COORDS);
  }

  get_atlas_grid_size(): TileVector2i {
    return atlasGridSize(this.liveTexture, this.liveMargins, this.liveSeparation, this.liveTextureRegionSize);
  }

  has_room_for_tile(
    atlasCoords: TileVector2i,
    size: TileVector2i,
    animationColumns: number,
    animationSeparation: TileVector2i,
    framesCount: number,
    ignoredTile: TileVector2i = INVALID_COORDS,
  ): boolean {
    if (animationColumns !== 1 || framesCount !== 1 || !coordsEqual(animationSeparation, ZERO_COORDS)) {
      throw new Error('godot-compat: TileSetAtlasSource.has_room_for_tile supports the retained non-animated tile state only.');
    }
    return this.hasRoom(
      nonNegativeCoords(atlasCoords, 'TileSetAtlasSource.atlas_coords'),
      positiveCoords(size, 'TileSetAtlasSource.size'),
      coordsEqual(ignoredTile, INVALID_COORDS) ? undefined : ignoredTile,
    );
  }

  has_tiles_outside_texture(): boolean {
    const grid = this.get_atlas_grid_size();
    return [...this.tiles.values()].some((tile) => !tileFitsGrid(tile, grid));
  }

  clear_tiles_outside_texture(): void {
    const grid = this.get_atlas_grid_size();
    let changed = false;
    for (const [key, tile] of this.tiles) {
      if (!tileFitsGrid(tile, grid)) { this.tiles.delete(key); changed = true; }
    }
    if (changed) this.changed();
  }

  get_tiles_to_be_removed_on_change(
    texture: Texture | null,
    margins: TileVector2i,
    separation: TileVector2i,
    textureRegionSize: TileVector2i,
  ): TileVector2i[] {
    const grid = atlasGridSize(
      texture,
      nonNegativeCoords(margins, 'TileSetAtlasSource.margins'),
      nonNegativeCoords(separation, 'TileSetAtlasSource.separation'),
      positiveCoords(textureRegionSize, 'TileSetAtlasSource.texture_region_size'),
    );
    return [...this.tiles.values()].filter((tile) => !tileFitsGrid(tile, grid)).map((tile) => copyCoords(tile.atlasCoords));
  }

  get_tile_texture_region(atlasCoords: TileVector2i, frame = 0): TileRect2 {
    if (frame !== 0) throw new Error('godot-compat: animated TileSetAtlasSource frames are not implemented; only frame 0 is retained.');
    const tile = this.requireTile(atlasCoords);
    return {
      x: this.liveMargins.x + tile.atlasCoords.x * (this.liveTextureRegionSize.x + this.liveSeparation.x),
      y: this.liveMargins.y + tile.atlasCoords.y * (this.liveTextureRegionSize.y + this.liveSeparation.y),
      width: this.liveTextureRegionSize.x * tile.sizeInAtlas.x + this.liveSeparation.x * (tile.sizeInAtlas.x - 1),
      height: this.liveTextureRegionSize.y * tile.sizeInAtlas.y + this.liveSeparation.y * (tile.sizeInAtlas.y - 1),
    };
  }

  get_runtime_texture(): Texture | null { return this.liveTexture; }
  get_runtime_tile_texture_region(coords: TileVector2i, frame = 0): TileRect2 { return this.get_tile_texture_region(coords, frame); }

  create_alternative_tile(atlasCoords: TileVector2i, alternativeId = -1): number {
    const tile = this.requireTile(atlasCoords);
    const id = alternativeId >= 0 ? alternativeId : firstUnusedAlternative(tile.alternatives);
    if (tile.alternatives.has(id)) return -1;
    tile.alternatives.set(id, createTileData(id, () => this.changed()));
    this.changed();
    return id;
  }

  remove_alternative_tile(atlasCoords: TileVector2i, alternativeId: number): void {
    if (alternativeId !== 0 && this.requireTile(atlasCoords).alternatives.delete(alternativeId)) this.changed();
  }

  has_alternative_tile(atlasCoords: TileVector2i, alternativeId: number): boolean {
    return this.requireTile(atlasCoords).alternatives.has(alternativeId);
  }

  get_alternative_tiles_count(atlasCoords: TileVector2i): number {
    return this.requireTile(atlasCoords).alternatives.size;
  }

  get_alternative_tile_id(atlasCoords: TileVector2i, index: number): number {
    const id = [...this.requireTile(atlasCoords).alternatives.keys()][index];
    if (id === undefined) throw new RangeError(`Alternative tile index ${index} is invalid.`);
    return id;
  }

  set_alternative_tile_id(atlasCoords: TileVector2i, alternativeId: number, newId: number): void {
    const tile = this.requireTile(atlasCoords);
    if (alternativeId === 0 || newId === 0) throw new Error('TileSetAtlasSource base alternative 0 cannot be renamed.');
    if (!tile.alternatives.has(alternativeId)) throw new Error(`TileSetAtlasSource has no alternative ${alternativeId}.`);
    if (tile.alternatives.has(newId)) throw new Error(`TileSetAtlasSource alternative ${newId} already exists.`);
    const data = tile.alternatives.get(alternativeId)!;
    tile.alternatives.delete(alternativeId);
    data.id = newId;
    tile.alternatives.set(newId, data);
    this.changed();
  }

  get_next_alternative_tile_id(atlasCoords: TileVector2i): number { return firstUnusedAlternative(this.requireTile(atlasCoords).alternatives); }

  get_tile_data(atlasCoords: TileVector2i, alternativeId: number): GodotTileData | null {
    const tile = this.tiles.get(coordsKey(finiteCoords(atlasCoords, 'TileSetAtlasSource.atlas_coords')));
    if (tile === undefined) return null;
    const id = integer(alternativeId, 'TileSetAtlasSource.alternative_tile') &
      ~(FLIP_H | FLIP_V | TRANSPOSE);
    return tile.alternatives.get(id) ?? null;
  }

  tile(atlasCoords: TileVector2i): GodotAtlasTile {
    return this.requireTile(atlasCoords);
  }

  /** Internal retained identities used when TileSet layer indices are structurally edited. */
  tileDataIdentities(): GodotTileData[] {
    return [...this.tiles.values()].flatMap((tile) => [...tile.alternatives.values()]);
  }

  tilesWithData(): { readonly atlasCoords: TileVector2i; readonly alternativeTile: number; readonly data: GodotTileData }[] {
    return [...this.tiles.values()].flatMap((tile) => [...tile.alternatives].map(([alternativeTile, data]) => ({
      atlasCoords: copyCoords(tile.atlasCoords),
      alternativeTile,
      data,
    })));
  }

  private requireTile(atlasCoords: TileVector2i): GodotAtlasTile {
    const tile = this.tiles.get(coordsKey(atlasCoords));
    if (tile === undefined) {
      throw new Error(`TileSetAtlasSource has no tile at ${atlasCoords.x},${atlasCoords.y}.`);
    }
    return tile;
  }

  private hasRoom(atlasCoords: TileVector2i, size: TileVector2i, ignored?: TileVector2i): boolean {
    if (atlasCoords.x < 0 || atlasCoords.y < 0 || size.x <= 0 || size.y <= 0) return false;
    const grid = this.get_atlas_grid_size();
    if (this.liveTexture !== null && (atlasCoords.x + size.x > grid.x || atlasCoords.y + size.y > grid.y)) return false;
    for (const tile of this.tiles.values()) {
      if (ignored !== undefined && coordsEqual(tile.atlasCoords, ignored)) continue;
      if (tileRectsOverlap(atlasCoords, size, tile.atlasCoords, tile.sizeInAtlas)) return false;
    }
    return true;
  }
}

export interface GodotTileSetOptions {
  readonly tileSize: TileVector2i;
  readonly sources?: ReadonlyMap<number, GodotTileSetAtlasSource>;
  readonly patterns?: readonly GodotTileMapPattern[];
  readonly godot3Tiles?: readonly Godot3TileInput[];
  readonly physicsLayers?: readonly GodotTileSetPhysicsLayer[];
  readonly terrainNames?: ReadonlyMap<number, ReadonlyMap<number, string>>;
  readonly terrainModes?: ReadonlyMap<number, number>;
  readonly tileShape?: number;
  readonly tileLayout?: number;
  readonly tileOffsetAxis?: number;
}

interface TerrainTileIdentity {
  readonly sourceId: number;
  readonly atlasCoords: TileVector2i;
  readonly alternativeTile: number;
  readonly data: GodotTileData;
}

export interface GodotTileSetPhysicsLayer {
  readonly collisionLayer: number;
  readonly collisionMask: number;
}

/** TileSet data remains renderer-neutral; layers consume it into batched Pixi tilemaps. */
export class GodotTileSet {
  private liveTileSize: TileVector2i;
  private readonly sources = new Map<number, GodotTileSetAtlasSource>();
  private readonly sourceReleases = new Map<number, () => void>();
  private readonly patterns: GodotTileMapPattern[] = [];
  private readonly godot3Tiles = new Map<number, Godot3Tile>();
  private readonly physicsLayers: GodotTileSetPhysicsLayer[] = [];
  private readonly terrainNames = new Map<number, Map<number, string>>();
  private readonly terrainModes = new Map<number, number>();
  private readonly liveTileShape: number;
  private readonly liveTileLayout: number;
  private readonly liveTileOffsetAxis: number;
  private readonly observers = new Set<() => void>();

  constructor(options: GodotTileSetOptions) {
    this.liveTileSize = positiveCoords(options.tileSize, 'TileSet.tile_size');
    for (const [id, source] of options.sources ?? []) this.retainSource(id, source);
    for (const pattern of options.patterns ?? []) this.retainPattern(pattern);
    for (const tile of options.godot3Tiles ?? []) this.defineGodot3Tile(tile);
    for (const layer of options.physicsLayers ?? []) this.physicsLayers.push(normalizeTileSetPhysicsLayer(layer));
    for (const [terrainSet, names] of options.terrainNames ?? []) {
      this.terrainNames.set(terrainSet, new Map(names));
    }
    for (const [terrainSet, mode] of options.terrainModes ?? []) {
      this.terrainModes.set(
        nonNegativeInteger(terrainSet, 'TileSet terrain_set'),
        enumInteger(mode, 0, 2, 'TileSet terrain mode'),
      );
    }
    this.liveTileShape = enumInteger(options.tileShape ?? TILE_SHAPE_SQUARE, 0, 3, 'TileSet.tile_shape');
    this.liveTileLayout = enumInteger(options.tileLayout ?? TILE_LAYOUT_STACKED, 0, 5, 'TileSet.tile_layout');
    this.liveTileOffsetAxis = enumInteger(options.tileOffsetAxis ?? TILE_OFFSET_AXIS_HORIZONTAL, 0, 1, 'TileSet.tile_offset_axis');
    registerGodotObjectIdentity(this, 'TileSet');
    bindGodotResourceProtocol(this, {
      createDuplicate(source) {
        return new GodotTileSet({
          tileSize: source.tile_size,
          physicsLayers: source.physicsLayers,
          terrainNames: source.terrainNames,
          terrainModes: source.terrainModes,
          patterns: [],
          tileShape: source.liveTileShape,
          tileLayout: source.liveTileLayout,
          tileOffsetAxis: source.liveTileOffsetAxis,
        }) as typeof source;
      },
      populateDuplicate(source, target, subresources, memo) {
        for (const [id, atlas] of source.sources) {
          target.add_source(subresources ? duplicateGodotSubresource(atlas, memo) : atlas, id);
        }
        for (const pattern of source.patterns) {
          target.add_pattern(subresources ? duplicateGodotSubresource(pattern, memo) : pattern);
        }
        for (const tile of source.godot3Tiles.values()) {
          target.defineGodot3Tile(copyGodot3Tile(tile, subresources, memo));
        }
      },
    });
  }

  get tile_size(): TileVector2i { return copyCoords(this.liveTileSize); }
  set tile_size(value: TileVector2i) {
    this.liveTileSize = positiveCoords(value, 'TileSet.tile_size');
    this.changed();
  }

  observe(observer: () => void): () => void {
    this.observers.add(observer);
    return () => { this.observers.delete(observer); };
  }

  private changed(): void {
    for (const observer of this.observers) observer();
    godotResourceEmitChanged(this);
  }

  private retainSource(id: number, source: GodotTileSetAtlasSource): void {
    this.sources.set(id, source);
    this.sourceReleases.set(id, source.observe(() => this.changed()));
  }

  add_source(source: GodotTileSetAtlasSource, sourceId = -1): number {
    const id = sourceId >= 0 ? sourceId : firstUnusedSource(this.sources);
    if (this.sources.has(id)) return -1;
    this.retainSource(id, source);
    this.changed();
    return id;
  }

  remove_source(sourceId: number): void {
    if (!this.sources.delete(sourceId)) return;
    this.sourceReleases.get(sourceId)?.();
    this.sourceReleases.delete(sourceId);
    this.changed();
  }
  has_source(sourceId: number): boolean { return this.sources.has(sourceId); }
  get_source_count(): number { return this.sources.size; }
  get_next_source_id(): number { return firstUnusedSource(this.sources); }

  set_source_id(sourceId: number, newSourceId: number): void {
    const current = integer(sourceId, 'source_id');
    const next = integer(newSourceId, 'new_source_id');
    if (current === next) return;
    const source = this.sources.get(current);
    if (source === undefined) throw new RangeError(`TileSet source ${String(current)} does not exist.`);
    if (this.sources.has(next)) throw new Error(`TileSet source ${String(next)} already exists.`);
    const release = this.sourceReleases.get(current);
    this.sources.delete(current);
    this.sourceReleases.delete(current);
    this.sources.set(next, source);
    if (release !== undefined) this.sourceReleases.set(next, release);
    this.changed();
  }

  get_source_id(index: number): number {
    const id = [...this.sources.keys()][index];
    if (id === undefined) throw new RangeError(`TileSet source index ${index} is invalid.`);
    return id;
  }

  get_source(sourceId: number): GodotTileSetAtlasSource | null {
    return this.sources.get(sourceId) ?? null;
  }

  private retainPattern(pattern: GodotTileMapPattern, index = this.patterns.length): void {
    if (!(pattern instanceof GodotTileMapPattern)) {
      throw new TypeError('TileSet pattern must be a retained TileMapPattern Resource.');
    }
    if (pattern.is_empty()) throw new Error('TileSet cannot retain an empty TileMapPattern.');
    if (this.patterns.includes(pattern)) throw new Error('TileSet already retains this TileMapPattern identity.');
    this.patterns.splice(index, 0, pattern);
  }

  add_pattern(pattern: GodotTileMapPattern, index = -1): number {
    if (!(pattern instanceof GodotTileMapPattern)) {
      throw new TypeError('TileSet.add_pattern requires a retained TileMapPattern Resource.');
    }
    const requested = integer(index, 'TileSet pattern index');
    const insertion = requested < 0 ? this.patterns.length : requested;
    if (pattern.is_empty() || this.patterns.includes(pattern) || insertion > this.patterns.length) return -1;
    this.retainPattern(pattern, insertion);
    this.changed();
    return insertion;
  }

  get_pattern(index = -1): GodotTileMapPattern | null {
    const requested = integer(index, 'TileSet pattern index');
    return this.patterns[requested] ?? null;
  }

  remove_pattern(index: number): void {
    const resolved = nonNegativeInteger(index, 'TileSet pattern index');
    if (this.patterns[resolved] === undefined) {
      throw new RangeError(`TileSet pattern ${String(resolved)} does not exist.`);
    }
    this.patterns.splice(resolved, 1);
    this.changed();
  }

  get_patterns_count(): number { return this.patterns.length; }

  source(sourceId: number): GodotTileSetAtlasSource {
    const source = this.sources.get(sourceId);
    if (source === undefined) throw new Error(`TileSet source ${sourceId} does not exist.`);
    return source;
  }

  add_physics_layer(toPosition = -1): void {
    const requested = integer(toPosition, 'TileSet.to_position');
    const position = requested < 0 ? this.physicsLayers.length : requested;
    if (position > this.physicsLayers.length) {
      throw new RangeError(`TileSet physics-layer insertion ${position} exceeds layer count ${this.physicsLayers.length}.`);
    }
    for (const source of this.sources.values()) {
      for (const data of source.tileDataIdentities()) shiftTileDataCollisionLayers(data, position);
    }
    this.physicsLayers.splice(position, 0, { collisionLayer: 1, collisionMask: 1 });
    this.changed();
  }

  get_physics_layers_count(): number { return this.physicsLayers.length; }

  physicsLayer(index: number): GodotTileSetPhysicsLayer {
    const retained = this.physicsLayers[nonNegativeInteger(index, 'TileSet physics layer')];
    if (retained === undefined) throw new RangeError(`TileSet physics layer ${index} does not exist.`);
    return retained;
  }

  get_terrain_name(terrainSet: number, terrain: number): string {
    const setIndex = nonNegativeInteger(terrainSet, 'TileSet terrain_set');
    const terrainIndex = nonNegativeInteger(terrain, 'TileSet terrain');
    const name = this.terrainNames.get(setIndex)?.get(terrainIndex);
    if (name === undefined) {
      throw new RangeError(`TileSet terrain ${terrainIndex} does not exist in set ${setIndex}.`);
    }
    return name;
  }

  /** Cell coordinates sharing an edge in the retained TileSet topology. */
  surroundingCells(coords: TileVector2i): TileVector2i[] {
    const cell = finiteCoords(coords, 'TileSet surrounding cell');
    if (this.liveTileLayout !== TILE_LAYOUT_STACKED) {
      throw new Error(
        `godot-compat: TileSet.get_surrounding_cells cannot exactly map tile_layout=${this.liveTileLayout}.`,
      );
    }
    if (this.liveTileShape === TILE_SHAPE_SQUARE || this.liveTileShape === TILE_SHAPE_ISOMETRIC) {
      return CARDINAL_NEIGHBORS.map((delta) => ({ x: cell.x + delta.x, y: cell.y + delta.y }));
    }
    throw new Error(
      `godot-compat: TileSet.get_surrounding_cells requires retained half-offset/hex layout mapping for tile_shape=${this.liveTileShape}.`,
    );
  }

  terrainNeighbors(terrainSet: number, coords: TileVector2i): readonly TerrainNeighbor[] {
    const cell = finiteCoords(coords, 'TileSet terrain cell');
    if (this.liveTileLayout !== TILE_LAYOUT_STACKED ||
        (this.liveTileShape !== TILE_SHAPE_SQUARE && this.liveTileShape !== TILE_SHAPE_ISOMETRIC)) {
      throw new Error('godot-compat: terrain painting currently requires an exact stacked square/isometric TileSet topology.');
    }
    const mode = this.terrainModes.get(nonNegativeInteger(terrainSet, 'TileSet terrain_set')) ?? 0;
    const topology = mode === TERRAIN_MODE_MATCH_CORNERS
      ? CORNER_TERRAIN_NEIGHBORS
      : mode === TERRAIN_MODE_MATCH_SIDES
        ? SIDE_TERRAIN_NEIGHBORS
        : ALL_TERRAIN_NEIGHBORS;
    return topology.map((neighbor) => ({
      peeringBit: neighbor.peeringBit,
      coords: { x: cell.x + neighbor.coords.x, y: cell.y + neighbor.coords.y },
    }));
  }

  /** Exact terrain alternatives retained by the authored atlas inventory. */
  terrainTiles(terrainSet: number, terrain: number): TerrainTileIdentity[] {
    const set = integer(terrainSet, 'TileMap terrain_set');
    const value = integer(terrain, 'TileMap terrain');
    const matches: TerrainTileIdentity[] = [];
    for (const [sourceId, source] of this.sources) {
      for (const tile of source.tilesWithData()) {
        const state = requireTileDataState(tile.data, 'terrain');
        if (state.terrainSet !== set || state.terrain !== value) continue;
        matches.push({ sourceId, ...tile });
      }
    }
    return matches;
  }

  defineGodot3Tile(input: Godot3TileInput): void {
    const id = tileId(input.id);
    if (input.normalMap !== undefined && input.normalMap !== null) {
      throw new Error(`TileSet tile ${id}.normal_map has no exact per-tile @pixi/tilemap lighting binding.`);
    }
    if (input.material !== undefined && input.material !== null) {
      throw new Error(`TileSet tile ${id}.material has no exact per-tile @pixi/tilemap shader binding.`);
    }
    if (input.navigationPolygon !== undefined && input.navigationPolygon !== null) {
      throw new Error(`TileSet tile ${id}.navigation has no retained TileMap navigation consumer.`);
    }
    const tile: Godot3Tile = {
      id,
      name: input.name ?? '',
      texture: input.texture ?? null,
      normalMap: input.normalMap ?? null,
      textureOffset: finiteCoords(input.textureOffset ?? ZERO_COORDS, `TileSet tile ${id} texture_offset`),
      material: input.material ?? null,
      modulate: copyColor(input.modulate ?? WHITE),
      region: finiteRect(input.region ?? ZERO_RECT, `TileSet tile ${id} region`),
      tileMode: tileMode(input.tileMode ?? 0),
      autotileSize: positiveCoords(
        input.autotileSize ?? { x: 64, y: 64 },
        `TileSet tile ${id} autotile size`,
      ),
      autotileSpacing: nonNegativeInteger(
        input.autotileSpacing ?? 0,
        `TileSet tile ${id} autotile spacing`,
      ),
      autotileIconCoordinate: finiteCoords(
        input.autotileIconCoordinate ?? ZERO_COORDS,
        `TileSet tile ${id} autotile icon coordinate`,
      ),
      autotileZIndices: new Map((input.autotileZIndices ?? []).map((entry) => [
        coordsKey(finiteCoords(entry.coords, `TileSet tile ${id} autotile z-index coordinate`)),
        integer(entry.zIndex, `TileSet tile ${id} autotile z-index`),
      ])),
      occluderOffset: finiteCoords(input.occluderOffset ?? ZERO_COORDS, `TileSet tile ${id} occluder_offset`),
      occluder: input.occluder ?? null,
      navigationPolygon: input.navigationPolygon ?? null,
      navigationPolygonOffset: finiteCoords(
        input.navigationPolygonOffset ?? ZERO_COORDS,
        `TileSet tile ${id} navigation_polygon_offset`,
      ),
      shapes: (input.shapes ?? []).map((shape) => copyTileShape(shape)),
      zIndex: integer(input.zIndex ?? 0, `TileSet tile ${id} z_index`),
    };
    this.godot3Tiles.set(id, tile);
    this.changed();
  }

  create_tile(id: number): void {
    const retained = tileId(id);
    if (this.godot3Tiles.has(retained)) return;
    this.defineGodot3Tile({ id: retained });
  }

  remove_tile(id: number): void {
    if (this.godot3Tiles.delete(tileId(id))) this.changed();
  }

  has_tile(id: number): boolean { return this.godot3Tiles.has(tileId(id)); }
  clear(): void {
    if (this.godot3Tiles.size === 0) return;
    this.godot3Tiles.clear();
    this.changed();
  }

  get_tiles_ids(): number[] { return [...this.godot3Tiles.keys()]; }
  get_last_unused_tile_id(): number {
    let next = 0;
    for (const id of this.godot3Tiles.keys()) if (id >= next) next = id + 1;
    return next;
  }
  find_tile_by_name(name: string): number {
    for (const tile of this.godot3Tiles.values()) if (tile.name === name) return tile.id;
    return -1;
  }

  legacyTile(id: number): Godot3Tile | null { return this.godot3Tiles.get(tileId(id)) ?? null; }
  hasLegacyAutotiles(): boolean {
    return [...this.godot3Tiles.values()].some((tile) => tile.tileMode !== 0);
  }

  tile_set_name(id: number, value: string): void { this.mutateTile(id, (tile) => { tile.name = string(value, 'name'); }); }
  tile_get_name(id: number): string { return this.requireLegacyTile(id).name; }
  tile_set_texture(id: number, value: Texture | null): void { this.mutateTile(id, (tile) => { tile.texture = value; }); }
  tile_get_texture(id: number): Texture | null { return this.requireLegacyTile(id).texture; }
  tile_set_normal_map(id: number, value: Texture | null): void {
    if (value !== null) throw new Error('TileSet.tile_set_normal_map has no exact per-tile @pixi/tilemap lighting binding.');
    this.mutateTile(id, (tile) => { tile.normalMap = null; });
  }
  tile_get_normal_map(id: number): Texture | null { return this.requireLegacyTile(id).normalMap; }
  tile_set_texture_offset(id: number, value: TileVector2i): void {
    this.mutateTile(id, (tile) => { tile.textureOffset = finiteCoords(value, 'texture_offset'); });
  }
  tile_get_texture_offset(id: number): TileVector2i { return copyCoords(this.requireLegacyTile(id).textureOffset); }
  tile_set_material(id: number, value: unknown): void {
    if (value !== null) throw new Error('TileSet.tile_set_material has no exact per-tile @pixi/tilemap shader binding.');
    this.mutateTile(id, (tile) => { tile.material = null; });
  }
  tile_get_material(id: number): unknown { return this.requireLegacyTile(id).material; }
  tile_set_modulate(id: number, value: ColorValue): void {
    this.mutateTile(id, (tile) => { tile.modulate = finiteColor(value, 'modulate'); });
  }
  tile_get_modulate(id: number): ColorValue { return copyColor(this.requireLegacyTile(id).modulate); }
  tile_set_region(id: number, value: TileRect2): void {
    this.mutateTile(id, (tile) => { tile.region = finiteRect(value, 'region'); });
  }
  tile_get_region(id: number): TileRect2 { return copyRect(this.requireLegacyTile(id).region); }
  tile_set_tile_mode(id: number, value: number): void {
    this.mutateTile(id, (tile) => { tile.tileMode = tileMode(value); });
  }
  tile_get_tile_mode(id: number): number { return this.requireLegacyTile(id).tileMode; }
  autotile_set_size(id: number, value: TileVector2i): void {
    this.mutateTile(id, (tile) => { tile.autotileSize = positiveCoords(value, 'autotile size'); });
  }
  autotile_get_size(id: number): TileVector2i { return copyCoords(this.requireLegacyTile(id).autotileSize); }
  autotile_set_spacing(id: number, value: number): void {
    this.mutateTile(id, (tile) => { tile.autotileSpacing = nonNegativeInteger(value, 'autotile spacing'); });
  }
  autotile_get_spacing(id: number): number { return this.requireLegacyTile(id).autotileSpacing; }
  autotile_set_icon_coordinate(id: number, value: TileVector2i): void {
    this.mutateTile(id, (tile) => { tile.autotileIconCoordinate = finiteCoords(value, 'autotile icon coordinate'); });
  }
  autotile_get_icon_coordinate(id: number): TileVector2i {
    return copyCoords(this.requireLegacyTile(id).autotileIconCoordinate);
  }
  autotile_set_z_index(id: number, coord: TileVector2i, value: number): void {
    this.mutateTile(id, (tile) => {
      tile.autotileZIndices.set(
        coordsKey(finiteCoords(coord, 'autotile z-index coordinate')),
        integer(value, 'autotile z-index'),
      );
    });
  }
  autotile_get_z_index(id: number, coord: TileVector2i): number {
    return this.requireLegacyTile(id).autotileZIndices.get(
      coordsKey(finiteCoords(coord, 'autotile z-index coordinate')),
    ) ?? 0;
  }
  tile_set_occluder_offset(id: number, value: TileVector2i): void {
    this.mutateTile(id, (tile) => { tile.occluderOffset = finiteCoords(value, 'occluder_offset'); });
  }
  tile_get_occluder_offset(id: number): TileVector2i { return copyCoords(this.requireLegacyTile(id).occluderOffset); }
  tile_set_light_occluder(id: number, value: GodotOccluderPolygon2D | null): void {
    this.mutateTile(id, (tile) => { tile.occluder = value; });
  }
  tile_get_light_occluder(id: number): GodotOccluderPolygon2D | null { return this.requireLegacyTile(id).occluder; }
  tile_set_navigation_polygon(id: number, value: unknown): void {
    if (value !== null) throw new Error('TileSet.tile_set_navigation_polygon has no retained TileMap navigation consumer.');
    this.mutateTile(id, (tile) => { tile.navigationPolygon = null; });
  }
  tile_get_navigation_polygon(id: number): unknown { return this.requireLegacyTile(id).navigationPolygon; }
  tile_set_navigation_polygon_offset(id: number, value: TileVector2i): void {
    this.mutateTile(id, (tile) => { tile.navigationPolygonOffset = finiteCoords(value, 'navigation_polygon_offset'); });
  }
  tile_get_navigation_polygon_offset(id: number): TileVector2i {
    return copyCoords(this.requireLegacyTile(id).navigationPolygonOffset);
  }
  tile_set_shapes(id: number, value: readonly unknown[]): void {
    if (!Array.isArray(value)) throw new TypeError('TileSet.tile_set_shapes requires Array<Dictionary>.');
    this.mutateTile(id, (tile) => { tile.shapes = value.map((shape, index) => normalizeTileShape(shape, index)); });
  }
  tile_get_shapes(id: number): Map<string, unknown>[] {
    return this.requireLegacyTile(id).shapes.map((shape) => new Map<string, unknown>([
      ['shape', shape.shape],
      ['shape_transform', copyTransform(shape.transform)],
      ['one_way', shape.oneWay],
      ['one_way_margin', shape.oneWayMargin],
      ['autotile_coord', copyCoords(shape.autotileCoord)],
    ]));
  }
  tile_add_shape(
    id: number,
    shape: GodotShape2D,
    transform: TileTransform2D = IDENTITY_TRANSFORM_2D,
    oneWay = false,
    autotileCoord: TileVector2i = ZERO_COORDS,
  ): void {
    this.mutateTile(id, (tile) => {
      tile.shapes.push(copyTileShape({ shape, transform, oneWay, oneWayMargin: 1, autotileCoord }));
    });
  }
  tile_remove_shape(id: number, shapeId: number): void {
    const tile = this.requireLegacyTile(id);
    const index = integer(shapeId, 'shape_id');
    if (tile.shapes[index] === undefined) {
      throw new RangeError(`TileSet tile ${String(id)} shape ${String(shapeId)} does not exist.`);
    }
    tile.shapes.splice(index, 1);
    this.changed();
  }
  tile_get_shape_count(id: number): number { return this.requireLegacyTile(id).shapes.length; }
  tile_get_shape(id: number, shapeId: number): GodotShape2D { return this.requireShape(id, shapeId).shape; }
  tile_set_shape(id: number, shapeId: number, value: GodotShape2D): void {
    this.mutateShape(id, shapeId, (shape) => ({ ...shape, shape: value }));
  }
  tile_get_shape_transform(id: number, shapeId: number): TileTransform2D {
    return copyTransform(this.requireShape(id, shapeId).transform);
  }
  tile_set_shape_transform(id: number, shapeId: number, value: TileTransform2D): void {
    this.mutateShape(id, shapeId, (shape) => ({ ...shape, transform: finiteTransform(value, 'shape_transform') }));
  }
  tile_get_shape_offset(id: number, shapeId: number): TileVector2i {
    return copyCoords(this.requireShape(id, shapeId).transform.origin);
  }
  tile_set_shape_offset(id: number, shapeId: number, value: TileVector2i): void {
    this.mutateShape(id, shapeId, (shape) => ({
      ...shape,
      transform: { ...shape.transform, origin: finiteCoords(value, 'shape_offset') },
    }));
  }
  tile_get_shape_one_way(id: number, shapeId: number): boolean { return this.requireShape(id, shapeId).oneWay; }
  tile_set_shape_one_way(id: number, shapeId: number, value: boolean): void {
    this.mutateShape(id, shapeId, (shape) => ({ ...shape, oneWay: boolean(value, 'shape_one_way') }));
  }
  tile_get_shape_one_way_margin(id: number, shapeId: number): number {
    return this.requireShape(id, shapeId).oneWayMargin;
  }
  tile_set_shape_one_way_margin(id: number, shapeId: number, value: number): void {
    this.mutateShape(id, shapeId, (shape) => ({ ...shape, oneWayMargin: finite(value, 'shape_one_way_margin') }));
  }
  tile_set_z_index(id: number, value: number): void {
    this.mutateTile(id, (tile) => { tile.zIndex = integer(value, 'z_index'); });
  }
  tile_get_z_index(id: number): number { return this.requireLegacyTile(id).zIndex; }

  private requireLegacyTile(id: number): Godot3Tile {
    const tile = this.godot3Tiles.get(tileId(id));
    if (tile === undefined) throw new RangeError(`TileSet tile ${id} does not exist.`);
    return tile;
  }

  private requireShape(id: number, shapeId: number): Godot3TileShape {
    const index = integer(shapeId, 'shape_id');
    const shape = this.requireLegacyTile(id).shapes[index];
    if (shape === undefined) throw new RangeError(`TileSet tile ${id} shape ${shapeId} does not exist.`);
    return shape;
  }

  private mutateTile(id: number, mutation: (tile: Godot3Tile) => void): void {
    mutation(this.requireLegacyTile(id));
    this.changed();
  }

  private mutateShape(
    id: number,
    shapeId: number,
    mutation: (shape: Godot3TileShape) => Godot3TileShape,
  ): void {
    const tile = this.requireLegacyTile(id);
    const index = integer(shapeId, 'shape_id');
    if (tile.shapes[index] === undefined) throw new RangeError(`TileSet tile ${id} shape ${shapeId} does not exist.`);
    tile.shapes[index] = copyTileShape(mutation(tile.shapes[index]!));
    this.changed();
  }
}

export interface GodotTileCell {
  readonly coords: TileVector2i;
  readonly sourceId: number;
  readonly atlasCoords: TileVector2i;
  readonly alternativeTile: number;
  readonly flipH: boolean;
  readonly flipV: boolean;
  readonly transpose: boolean;
}

export interface AuthoredTileCell {
  readonly coords: TileVector2i;
  readonly sourceId: number;
  readonly atlasCoords: TileVector2i;
  readonly alternativeTile?: number;
  readonly flipH?: boolean;
  readonly flipV?: boolean;
  readonly transpose?: boolean;
}

export interface AuthoredTilePayload {
  readonly format: 'godot3-triples' | 'godot4-int32-records' | 'godot4-byte-records';
  /** Literal numeric payload extracted from the authored scene; decoding remains compat-owned. */
  readonly values: readonly number[];
}

function signed16(value: number): number {
  const word = value & 0xffff;
  return word >= 0x8000 ? word - 0x10000 : word;
}

/** Decode Godot's packed TileMap storage at the engine-compat boundary, never in translation. */
export function decodeAuthoredTileCells(payload: AuthoredTilePayload): AuthoredTileCell[] {
  if (payload.format === 'godot4-byte-records') {
    const bytes = Uint8Array.from(payload.values, (value) => value & 0xff);
    if (bytes.length === 0) return [];
    if (bytes.length < 2 || (bytes.length - 2) % 12 !== 0) {
      throw new Error(
        `TileMapLayer byte payload has ${bytes.length} bytes; Godot 4 requires a 2-byte version and 12 bytes per cell.`,
      );
    }
    const view = new DataView(bytes.buffer);
    const version = view.getUint16(0, true);
    if (version !== 0) {
      throw new Error(`TileMapLayer byte payload uses unsupported Godot data format ${version}.`);
    }
    const cells: AuthoredTileCell[] = [];
    for (let offset = 2; offset < bytes.length; offset += 12) {
      const sourceId = view.getUint16(offset + 4, true);
      if (sourceId === 0xffff) continue;
      cells.push({
        coords: { x: view.getInt16(offset, true), y: view.getInt16(offset + 2, true) },
        sourceId,
        atlasCoords: { x: view.getUint16(offset + 6, true), y: view.getUint16(offset + 8, true) },
        alternativeTile: view.getUint16(offset + 10, true),
      });
    }
    return cells;
  }
  if (payload.format === 'godot4-int32-records') {
    if (payload.values.length % 3 !== 0) {
      throw new Error(
        `TileMap compatibility payload has ${payload.values.length} words; Godot 4 format 3 requires triples.`,
      );
    }
    const cells: AuthoredTileCell[] = [];
    for (let index = 0; index < payload.values.length; index += 3) {
      const packedCoords = (payload.values[index] as number) >>> 0;
      const packedSourceAndAtlasX = (payload.values[index + 1] as number) >>> 0;
      const packedAtlasYAndAlternative = (payload.values[index + 2] as number) >>> 0;
      const sourceId = packedSourceAndAtlasX & 0xffff;
      if (sourceId === 0xffff) continue;
      cells.push({
        coords: { x: signed16(packedCoords), y: signed16(packedCoords >>> 16) },
        sourceId,
        atlasCoords: {
          x: (packedSourceAndAtlasX >>> 16) & 0xffff,
          y: packedAtlasYAndAlternative & 0xffff,
        },
        alternativeTile: (packedAtlasYAndAlternative >>> 16) & 0xffff,
      });
    }
    return cells;
  }
  if (payload.values.length % 3 !== 0) {
    throw new Error(`TileMap triple payload has ${payload.values.length} words; Godot 3 cell records require multiples of 3.`);
  }
  const cells: AuthoredTileCell[] = [];
  for (let index = 0; index < payload.values.length; index += 3) {
    const packedCoords = payload.values[index] as number;
    const packedTile = (payload.values[index + 1] as number) >>> 0;
    const packedAtlas = payload.values[index + 2] as number;
    cells.push({
      coords: { x: signed16(packedCoords), y: signed16(packedCoords >>> 16) },
      sourceId: packedTile & 0x1fffffff,
      // Godot 3 serializes Cell.autotile_coord_x/y as unsigned 16-bit words.
      atlasCoords: { x: packedAtlas & 0xffff, y: (packedAtlas >>> 16) & 0xffff },
      alternativeTile: 0,
      flipH: (packedTile & 0x20000000) !== 0,
      flipV: (packedTile & 0x40000000) !== 0,
      transpose: (packedTile & 0x80000000) !== 0,
    });
  }
  return cells;
}

export interface GodotTileMapLayerOptions {
  readonly tileSet?: GodotTileSet | null;
  readonly cells?: readonly AuthoredTileCell[];
  readonly quadrantSize?: number;
  readonly visible?: boolean;
  readonly zIndex?: number;
  readonly modulate?: number;
  readonly enabled?: boolean;
  readonly ySortEnabled?: boolean;
  readonly collisionEnabled?: boolean;
  readonly occlusionRoot?: Container;
  readonly physics?: GodotTileMapPhysicsOptions;
}

export interface GodotTileMapPhysicsOptions {
  readonly world: RAPIER.World;
  readonly layers: CollisionLayers;
  readonly colliders: GodotMutableColliderRegistry<RAPIER.Collider, GodotColliderOwner>;
  readonly owner: GodotColliderOwner;
  readonly collisionLayer?: number;
  readonly collisionMask?: number;
}

/** A TileMapLayer is one Container of quadrant-sized CompositeTilemap batches. */
export class GodotTileMapLayer extends Container {
  private liveTileSet: GodotTileSet | null;
  private releaseTileSetObserver: (() => void) | null;
  private liveRenderingQuadrantSize: number;
  private readonly cells = new Map<string, GodotTileCell>();
  private readonly quadrants = new Map<string, Container>();
  private readonly dirtyQuadrants = new Set<string>();
  private readonly occlusionRoot: Container | null;
  private readonly physics: GodotTileMapPhysicsOptions | null;
  private liveCollisionLayer: number;
  private liveCollisionMask: number;
  private liveEnabled: boolean;
  private liveYSortEnabled: boolean;
  private liveCollisionEnabled: boolean;
  private readonly physicsBody: RAPIER.RigidBody | null;
  private readonly colliders: RAPIER.Collider[] = [];
  private readonly shapeConsumers: { readonly shape: GodotShape2D; readonly consumer: PhysicsShapeResource2DConsumer }[] = [];
  private readonly occluders: GodotCanvasLightOccluder2D[] = [];
  private released = false;

  constructor(options: GodotTileMapLayerOptions = {}) {
    super();
    bindGodotCanvasNode2DApi(this);
    registerGodotObjectIdentity(this, 'TileMapLayer');
    registerCanvasNodeRelease(this, () => this.release());
    this.liveTileSet = options.tileSet ?? null;
    this.releaseTileSetObserver = this.liveTileSet?.observe(() => this.update_internals()) ?? null;
    this.liveRenderingQuadrantSize = positiveInteger(options.quadrantSize ?? 16, 'TileMapLayer.rendering_quadrant_size');
    this.visible = options.visible ?? true;
    this.zIndex = options.zIndex ?? 0;
    this.tint = options.modulate ?? 0xffffff;
    this.liveEnabled = boolean(options.enabled ?? options.visible ?? true, 'TileMapLayer.enabled');
    this.liveYSortEnabled = boolean(options.ySortEnabled ?? false, 'TileMapLayer.y_sort_enabled');
    this.liveCollisionEnabled = boolean(options.collisionEnabled ?? true, 'TileMapLayer.collision_enabled');
    this.visible = this.liveEnabled;
    this.sortableChildren = this.liveYSortEnabled;
    this.occlusionRoot = options.occlusionRoot ?? null;
    this.physics = options.physics ?? null;
    this.liveCollisionLayer = (options.physics?.collisionLayer ?? 1) >>> 0;
    this.liveCollisionMask = (options.physics?.collisionMask ?? 1) >>> 0;
    this.physicsBody = this.physics?.world.createRigidBody(RAPIER.RigidBodyDesc.fixed()) ?? null;
    for (const cell of options.cells ?? []) this.setCellData(cell);
    this.update_internals();
  }

  get tile_set(): GodotTileSet | null { return this.liveTileSet; }
  set tile_set(value: GodotTileSet | null) {
    if (value !== null && !(value instanceof GodotTileSet)) {
      throw new TypeError('TileMapLayer.tile_set requires a retained TileSet Resource or null.');
    }
    if (value === this.liveTileSet) return;
    this.releaseTileSetObserver?.();
    this.releaseNativeConsumers();
    this.releaseRenderedQuadrants();
    this.liveTileSet = value;
    this.releaseTileSetObserver = value?.observe(() => this.update_internals()) ?? null;
    this.update_internals();
  }

  private requireTileSet(member: string): GodotTileSet {
    if (this.liveTileSet === null) {
      throw new Error(`godot-compat: TileMapLayer.${member} requires a retained TileSet Resource.`);
    }
    return this.liveTileSet;
  }

  get rendering_quadrant_size(): number { return this.liveRenderingQuadrantSize; }
  set rendering_quadrant_size(value: number) {
    const size = positiveInteger(value, 'TileMapLayer.rendering_quadrant_size');
    if (size === this.liveRenderingQuadrantSize) return;
    this.liveRenderingQuadrantSize = size;
    this.releaseRenderedQuadrants();
    for (const cell of this.cells.values()) this.dirtyQuadrants.add(this.quadrantKey(cell.coords));
    this.flushDirtyQuadrants();
  }

  get enabled(): boolean { return this.liveEnabled; }
  set enabled(value: boolean) {
    this.liveEnabled = boolean(value, 'TileMapLayer.enabled');
    this.visible = this.liveEnabled;
  }
  set_enabled(value: boolean): void { this.enabled = value; }
  is_enabled(): boolean { return this.enabled; }

  get y_sort_enabled(): boolean { return this.liveYSortEnabled; }
  set y_sort_enabled(value: boolean) {
    this.liveYSortEnabled = boolean(value, 'TileMapLayer.y_sort_enabled');
    this.sortableChildren = this.liveYSortEnabled;
  }
  set_y_sort_enabled(value: boolean): void { this.y_sort_enabled = value; }
  is_y_sort_enabled(): boolean { return this.y_sort_enabled; }

  get collision_enabled(): boolean { return this.liveCollisionEnabled; }
  set collision_enabled(value: boolean) {
    const next = boolean(value, 'TileMapLayer.collision_enabled');
    if (next === this.liveCollisionEnabled) return;
    this.liveCollisionEnabled = next;
    this.refreshNativeConsumers();
  }
  set_collision_enabled(value: boolean): void { this.collision_enabled = value; }
  is_collision_enabled(): boolean { return this.collision_enabled; }

  set_tile_set(value: GodotTileSet | null): void { this.tile_set = value; }
  get_tile_set(): GodotTileSet | null { return this.tile_set; }
  set_rendering_quadrant_size(value: number): void { this.rendering_quadrant_size = value; }
  get_rendering_quadrant_size(): number { return this.rendering_quadrant_size; }

  get_collision_layer_bit(bit: number): boolean {
    const index = integer(bit, 'collision layer bit');
    if (index < 0 || index > 31) throw new RangeError('TileMap collision layer bit must be 0..31.');
    return ((this.liveCollisionLayer >>> index) & 1) !== 0;
  }

  set_collision_layer_bit(bit: number, enabled: boolean): void {
    const index = integer(bit, 'collision layer bit');
    if (index < 0 || index > 31) throw new RangeError('TileMap collision layer bit must be 0..31.');
    if (typeof enabled !== 'boolean') throw new TypeError('TileMap collision layer enabled must be bool.');
    const flag = (1 << index) >>> 0;
    this.liveCollisionLayer = (enabled
      ? this.liveCollisionLayer | flag
      : this.liveCollisionLayer & ~flag) >>> 0;
    if (this.physics !== null) {
      for (const collider of this.colliders) {
        this.physics.layers.set(collider, this.liveCollisionLayer, this.liveCollisionMask);
      }
    }
  }

  get_collision_mask_bit(bit: number): boolean {
    const index = integer(bit, 'collision mask bit');
    if (index < 0 || index > 31) throw new RangeError('TileMap collision mask bit must be 0..31.');
    return ((this.liveCollisionMask >>> index) & 1) !== 0;
  }

  set_collision_mask_bit(bit: number, enabled: boolean): void {
    const index = integer(bit, 'collision mask bit');
    if (index < 0 || index > 31) throw new RangeError('TileMap collision mask bit must be 0..31.');
    if (typeof enabled !== 'boolean') throw new TypeError('TileMap collision mask enabled must be bool.');
    const flag = (1 << index) >>> 0;
    this.liveCollisionMask = (enabled
      ? this.liveCollisionMask | flag
      : this.liveCollisionMask & ~flag) >>> 0;
    if (this.physics !== null) {
      for (const collider of this.colliders) {
        this.physics.layers.set(collider, this.liveCollisionLayer, this.liveCollisionMask);
      }
    }
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    this.releaseTileSetObserver?.();
    this.releaseTileSetObserver = null;
    this.releaseNativeConsumers();
    if (this.physics !== null && this.physicsBody !== null) this.physics.world.removeRigidBody(this.physicsBody);
    this.clear();
  }

  preparePhysics(root: Container): void {
    if (this.physicsBody === null || !this.liveCollisionEnabled) return;
    const transform = root.worldTransform.clone().invert().append(this.worldTransform);
    const xLength = Math.hypot(transform.a, transform.b);
    const yLength = Math.hypot(transform.c, transform.d);
    const dot = transform.a * transform.c + transform.b * transform.d;
    const determinant = transform.a * transform.d - transform.b * transform.c;
    if (Math.abs(xLength - 1) > 1e-6 || Math.abs(yLength - 1) > 1e-6 || Math.abs(dot) > 1e-6 || determinant < 0) {
      throw new Error('TileMap collision transform includes scale, shear, or reflection; Rapier fixed bodies require a rigid transform.');
    }
    this.physicsBody.setTranslation({ x: transform.tx, y: transform.ty }, true);
    this.physicsBody.setRotation(Math.atan2(transform.b, transform.a), true);
  }

  set_cell(
    coords: TileVector2i,
    sourceId = -1,
    atlasCoords: TileVector2i = INVALID_COORDS,
    alternativeTile = 0,
  ): void {
    if (sourceId < 0 || atlasCoords.x < 0 || atlasCoords.y < 0) {
      this.erase_cell(coords);
      return;
    }
    const alternative = decodeAlternative(alternativeTile);
    this.setCellData({
      coords,
      sourceId,
      atlasCoords,
      alternativeTile,
      flipH: alternative.flipH,
      flipV: alternative.flipV,
      transpose: alternative.transpose,
    });
    this.flushDirtyQuadrants();
    this.refreshNativeConsumers();
  }

  set_cell_with_transform(cell: AuthoredTileCell): void {
    this.setCellData(cell);
    this.flushDirtyQuadrants();
    this.refreshNativeConsumers();
  }

  set_cell_autotile_coord(coords: TileVector2i, value: TileVector2i): void {
    const at = finiteCoords(coords, 'TileMap.set_cell_autotile_coord coords');
    const existing = this.cells.get(coordsKey(at));
    if (existing === undefined) return;
    this.setCellData({ ...existing, atlasCoords: godot3AutotileCoords(value) });
    this.flushDirtyQuadrants();
    this.refreshNativeConsumers();
  }

  erase_cell(coords: TileVector2i): void {
    const at = finiteCoords(coords, 'TileMapLayer.erase_cell coords');
    const key = coordsKey(at);
    if (!this.cells.delete(key)) return;
    this.dirtyQuadrants.add(this.quadrantKey(at));
    this.flushDirtyQuadrants();
    this.refreshNativeConsumers();
  }

  clear(): void {
    this.releaseNativeConsumers();
    this.cells.clear();
    this.releaseRenderedQuadrants();
    this.dirtyQuadrants.clear();
  }

  get_cell_source_id(coords: TileVector2i, useProxies = false): number {
    requireCellLookupBoolean(useProxies, 'get_cell_source_id');
    return this.cells.get(coordsKey(finiteCoords(coords, 'TileMapLayer coords')))?.sourceId ?? -1;
  }

  get_cell_atlas_coords(coords: TileVector2i, useProxies = false): TileVector2i {
    requireCellLookupBoolean(useProxies, 'get_cell_atlas_coords');
    return copyCoords(this.cells.get(coordsKey(finiteCoords(coords, 'TileMapLayer coords')))?.atlasCoords ?? INVALID_COORDS);
  }

  get_cell_alternative_tile(coords: TileVector2i, useProxies = false): number {
    requireCellLookupBoolean(useProxies, 'get_cell_alternative_tile');
    return this.cells.get(coordsKey(finiteCoords(coords, 'TileMapLayer coords')))?.alternativeTile ?? -1;
  }

  get_cell_tile_data(coords: TileVector2i): GodotTileData | null {
    const cell = this.cells.get(coordsKey(finiteCoords(coords, 'TileMapLayer.coords')));
    if (cell === undefined) return null;
    if (this.liveTileSet === null) return null;
    const source = this.liveTileSet.get_source(cell.sourceId);
    if (!(source instanceof GodotTileSetAtlasSource)) return null;
    return source.get_tile_data(cell.atlasCoords, cell.alternativeTile);
  }

  is_cell_transposed(coords: TileVector2i): boolean {
    return this.cells.get(coordsKey(coords))?.transpose ?? false;
  }

  is_cell_y_flipped(coords: TileVector2i): boolean {
    return this.cells.get(coordsKey(coords))?.flipV ?? false;
  }

  is_cell_x_flipped(coords: TileVector2i): boolean {
    return this.cells.get(coordsKey(coords))?.flipH ?? false;
  }

  get_used_cells(sourceId = -1, atlasCoords = INVALID_COORDS, alternativeTile = -1): TileVector2i[] {
    return [...this.cells.values()]
      .filter((cell) => sourceId < 0 || cell.sourceId === sourceId)
      .filter((cell) => coordsEqual(atlasCoords, INVALID_COORDS) || coordsEqual(cell.atlasCoords, atlasCoords))
      .filter((cell) => alternativeTile < 0 || cell.alternativeTile === alternativeTile)
      .map((cell) => copyCoords(cell.coords));
  }

  /** Godot 4's exact four-part retained-cell identity filter. */
  get_used_cells_by_id(
    sourceId = -1,
    atlasCoords: TileVector2i = INVALID_COORDS,
    alternativeTile = -1,
  ): TileVector2i[] {
    const source = integer(sourceId, 'TileMapLayer.get_used_cells_by_id source_id');
    const atlas = finiteCoords(atlasCoords, 'TileMapLayer.get_used_cells_by_id atlas_coords');
    const alternative = integer(
      alternativeTile,
      'TileMapLayer.get_used_cells_by_id alternative_tile',
    );
    return this.get_used_cells(source, atlas, alternative);
  }

  get_surrounding_cells(coords: TileVector2i): TileVector2i[] {
    return this.requireTileSet('get_surrounding_cells').surroundingCells(coords);
  }

  set_cells_terrain_connect(
    cells: readonly TileVector2i[],
    terrainSet: number,
    terrain: number,
    ignoreEmptyTerrains = true,
  ): void {
    this.setTerrainCells(cells, terrainSet, terrain, ignoreEmptyTerrains, false);
  }

  set_cells_terrain_path(
    path: readonly TileVector2i[],
    terrainSet: number,
    terrain: number,
    ignoreEmptyTerrains = true,
  ): void {
    const cells = finiteCellArray(path, 'TileMapLayer.set_cells_terrain_path path');
    for (let index = 1; index < cells.length; index += 1) {
      if (!areSurroundingCells(this.requireTileSet('set_cells_terrain_path'), cells[index - 1]!, cells[index]!)) {
        throw new Error('godot-compat: TileMapLayer.set_cells_terrain_path requires each retained path cell to be adjacent.');
      }
    }
    this.setTerrainCells(cells, terrainSet, terrain, ignoreEmptyTerrains, true);
  }

  get_used_rect(): { position: TileVector2i; size: TileVector2i } {
    if (this.cells.size === 0) return { position: copyCoords(ZERO_COORDS), size: copyCoords(ZERO_COORDS) };
    const cells = [...this.cells.values()];
    const xs = cells.map((cell) => cell.coords.x);
    const ys = cells.map((cell) => cell.coords.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return {
      position: { x: minX, y: minY },
      size: { x: Math.max(...xs) - minX + 1, y: Math.max(...ys) - minY + 1 },
    };
  }

  get_pattern(coordsArray: readonly TileVector2i[]): GodotTileMapPattern {
    if (!Array.isArray(coordsArray)) throw new TypeError('TileMap.get_pattern requires an Array of Vector2i coordinates.');
    const requested = coordsArray.map((coords) => finiteCoords(coords, 'TileMap.get_pattern coords'));
    if (requested.length === 0) return new GodotTileMapPattern();
    const minX = Math.min(...requested.map((coords) => coords.x));
    const minY = Math.min(...requested.map((coords) => coords.y));
    const cells: TileMapPatternCell[] = [];
    for (const coords of requested) {
      const cell = this.cells.get(coordsKey(coords));
      if (cell === undefined) continue;
      cells.push({
        coords: { x: coords.x - minX, y: coords.y - minY },
        sourceId: cell.sourceId,
        atlasCoords: copyCoords(cell.atlasCoords),
        alternativeTile: cell.alternativeTile,
      });
    }
    return new GodotTileMapPattern(cells);
  }

  set_pattern(position: TileVector2i, pattern: GodotTileMapPattern): void {
    const origin = finiteCoords(position, 'TileMap.set_pattern position');
    if (!(pattern instanceof GodotTileMapPattern)) throw new TypeError('TileMap.set_pattern requires a TileMapPattern Resource.');
    for (const cell of pattern.cells()) {
      this.setCellData({
        coords: { x: origin.x + cell.coords.x, y: origin.y + cell.coords.y },
        sourceId: cell.sourceId,
        atlasCoords: cell.atlasCoords,
        alternativeTile: cell.alternativeTile,
        ...decodeAlternative(cell.alternativeTile),
      });
    }
    this.flushDirtyQuadrants();
    this.refreshNativeConsumers();
  }

  map_pattern(position: TileVector2i, coordsInPattern: TileVector2i, pattern: GodotTileMapPattern): TileVector2i {
    if (!(pattern instanceof GodotTileMapPattern)) throw new TypeError('TileMap.map_pattern requires a TileMapPattern Resource.');
    const origin = finiteCoords(position, 'TileMap.map_pattern position');
    const coords = finiteCoords(coordsInPattern, 'TileMap.map_pattern coords_in_pattern');
    return { x: origin.x + coords.x, y: origin.y + coords.y };
  }

  local_to_map(position: TileVector2i): TileVector2i {
    const local = finiteCoords(position, 'TileMapLayer.local_to_map position');
    const tileSet = this.requireTileSet('local_to_map');
    return {
      x: Math.floor(local.x / tileSet.tile_size.x),
      y: Math.floor(local.y / tileSet.tile_size.y),
    };
  }

  map_to_local(coords: TileVector2i): TileVector2i {
    const tileSet = this.requireTileSet('map_to_local');
    return {
      x: (coords.x + 0.5) * tileSet.tile_size.x,
      y: (coords.y + 0.5) * tileSet.tile_size.y,
    };
  }

  notify_runtime_tile_data_update(): void {
    for (const cell of this.cells.values()) this.dirtyQuadrants.add(this.quadrantKey(cell.coords));
    this.flushDirtyQuadrants();
    this.refreshNativeConsumers();
  }

  update_internals(): void {
    this.notify_runtime_tile_data_update();
  }

  private setTerrainCells(
    input: readonly TileVector2i[],
    terrainSet: number,
    terrain: number,
    ignoreEmptyTerrains: boolean,
    pathOnly: boolean,
  ): void {
    const cells = finiteCellArray(input, pathOnly
      ? 'TileMapLayer.set_cells_terrain_path path'
      : 'TileMapLayer.set_cells_terrain_connect cells');
    const set = integer(terrainSet, 'TileMapLayer terrain_set');
    const target = integer(terrain, 'TileMapLayer terrain');
    const ignoreEmpty = boolean(ignoreEmptyTerrains, 'TileMapLayer ignore_empty_terrains');
    const tileSet = this.requireTileSet(pathOnly ? 'set_cells_terrain_path' : 'set_cells_terrain_connect');
    const requested = new Set(cells.map(coordsKey));
    const affected = new Map(cells.map((coords) => [coordsKey(coords), coords]));
    if (!pathOnly) {
      for (const coords of cells) {
        for (const neighbor of tileSet.terrainNeighbors(set, coords)) {
          affected.set(coordsKey(neighbor.coords), neighbor.coords);
        }
      }
    }
    const writes: AuthoredTileCell[] = [];
    for (const coords of affected.values()) {
      const existing = this.cells.get(coordsKey(coords));
      const desiredCenter = requested.has(coordsKey(coords)) ? target : this.cellTerrain(existing, set);
      if (desiredCenter < 0 && ignoreEmpty) continue;
      const candidates = tileSet.terrainTiles(set, desiredCenter);
      const matching = candidates.filter((candidate) => this.terrainCandidateMatches(
        tileSet,
        candidate.data,
        coords,
        set,
        target,
        requested,
        ignoreEmpty,
      ));
      if (matching.length !== 1) {
        throw new Error(
          `godot-compat: terrain painting at ${coords.x},${coords.y} requires one exact authored terrain tile; found ${matching.length}.`,
        );
      }
      const selected = matching[0]!;
      writes.push({
        coords,
        sourceId: selected.sourceId,
        atlasCoords: selected.atlasCoords,
        alternativeTile: selected.alternativeTile,
      });
    }
    for (const write of writes) this.setCellData(write);
    this.flushDirtyQuadrants();
    this.refreshNativeConsumers();
  }

  private cellTerrain(cell: GodotTileCell | undefined, terrainSet: number): number {
    if (cell === undefined || this.liveTileSet === null) return -1;
    const source = this.liveTileSet.get_source(cell.sourceId);
    if (!(source instanceof GodotTileSetAtlasSource)) return -1;
    const data = source.get_tile_data(cell.atlasCoords, cell.alternativeTile);
    if (data === null) return -1;
    const state = requireTileDataState(data, 'terrain');
    return state.terrainSet === terrainSet ? state.terrain : -1;
  }

  private terrainCandidateMatches(
    tileSet: GodotTileSet,
    data: GodotTileData,
    coords: TileVector2i,
    terrainSet: number,
    targetTerrain: number,
    requested: ReadonlySet<string>,
    ignoreEmpty: boolean,
  ): boolean {
    const state = requireTileDataState(data, 'terrain_peering_bit');
    const neighbors = tileSet.terrainNeighbors(terrainSet, coords);
    return neighbors.every((neighbor) => {
      const existing = this.cells.get(coordsKey(neighbor.coords));
      const desired = requested.has(coordsKey(neighbor.coords))
        ? targetTerrain
        : this.cellTerrain(existing, terrainSet);
      if (ignoreEmpty && desired < 0) return true;
      return (state.terrainPeering.get(neighbor.peeringBit) ?? -1) === desired;
    });
  }

  private releaseNativeConsumers(): void {
    for (const retained of this.shapeConsumers.splice(0)) {
      releasePhysicsShapeResource2D(retained.shape, retained.consumer);
    }
    for (const collider of this.colliders.splice(0)) {
      this.physics?.colliders.delete(collider);
      this.physics?.world.removeCollider(collider, true);
    }
    for (const occluder of this.occluders.splice(0)) {
      releaseCanvasLightOccluder2D(occluder);
      occluder.removeFromParent();
      occluder.destroy({ children: true });
    }
  }

  private releaseRenderedQuadrants(): void {
    for (const quadrant of this.quadrants.values()) {
      for (const child of quadrant.children) {
        if (child instanceof CompositeTilemap) releaseCanvasItemMaterial(child);
      }
      quadrant.removeFromParent();
      quadrant.destroy({ children: true });
    }
    this.quadrants.clear();
  }

  private refreshNativeConsumers(): void {
    this.releaseNativeConsumers();
    if (this.cells.size === 0 || this.liveTileSet === null) return;
    const tileSet = this.requireTileSet('update_internals');
    for (const cell of this.cells.values()) {
      const tile = tileSet.legacyTile(cell.sourceId);
      if (tile === null) {
        if (!this.liveCollisionEnabled || this.physics === null || this.physicsBody === null) continue;
        const source = tileSet.get_source(cell.sourceId);
        const data = source?.get_tile_data(cell.atlasCoords, cell.alternativeTile) ?? null;
        if (data === null) continue;
        const state = requireTileDataState(data, 'collision polygons');
        for (const [layerId, polygons] of state.collisionPolygons) {
          const physicsLayer = tileSet.physicsLayer(layerId);
          for (const [polygonIndex, polygon] of polygons.entries()) {
            if (polygon.length === 0) continue;
            if (polygon.length < 3) {
              throw new Error(
                `TileData collision polygon ${polygonIndex} in layer ${layerId} needs at least three points.`,
              );
            }
            const descriptor = RAPIER.ColliderDesc.convexHull(
              rapierVertices(polygon, tileDataCellTransform(cell, tileSet.tile_size)),
            );
            if (descriptor === null) {
              throw new Error(`TileData collision polygon ${polygonIndex} in layer ${layerId} is degenerate.`);
            }
            const collider = this.physics.world.createCollider(descriptor, this.physicsBody);
            this.physics.layers.set(collider, physicsLayer.collisionLayer, physicsLayer.collisionMask);
            this.physics.colliders.set(collider, this.physics.owner);
            this.colliders.push(collider);
          }
        }
        continue;
      }
      if (this.liveCollisionEnabled && this.physics !== null && this.physicsBody !== null) {
        for (const authoredShape of tile.shapes) {
          if (tile.tileMode !== 0 && !coordsEqual(authoredShape.autotileCoord, cell.atlasCoords)) {
            continue;
          }
          if (authoredShape.oneWay) {
            throw new Error(
              `TileSet tile ${tile.id} uses one-way collision with margin ${authoredShape.oneWayMargin}; ` +
              'Rapier has no exact one-way TileMap contact solver.',
            );
          }
          const transform = composeTileShapeTransform(cell, tileSet.tile_size, authoredShape.transform);
          const descriptor = transformedTileCollider(authoredShape.shape, transform);
          const collider = this.physics.world.createCollider(descriptor, this.physicsBody);
          this.physics.layers.set(
            collider,
            this.liveCollisionLayer,
            this.liveCollisionMask,
          );
          this.physics.colliders.set(collider, this.physics.owner);
          this.colliders.push(collider);
          const consumer: PhysicsShapeResource2DConsumer = {
            setShape: () => {
              const refreshed = transformedTileCollider(authoredShape.shape, transform);
              collider.setShape(refreshed.shape);
              collider.setTranslationWrtParent(refreshed.translation);
              collider.setRotationWrtParent(refreshed.rotation);
            },
          };
          retainPhysicsShapeResource2D(authoredShape.shape, consumer);
          this.shapeConsumers.push({ shape: authoredShape.shape, consumer });
        }
      }
      if (this.occlusionRoot !== null && tile.tileMode === 0 && tile.occluder !== null) {
        const transform = composeTileShapeTransform(cell, tileSet.tile_size, {
          ...IDENTITY_TRANSFORM_2D,
          origin: tile.occluderOffset,
        });
        const node = new Container({ label: `Tile ${tile.id} occluder ${cell.coords.x},${cell.coords.y}` });
        applyTileTransform(node, transform);
        this.addChild(node);
        this.occluders.push(bindCanvasLightOccluder2D(node, this.occlusionRoot, { occluder: tile.occluder }));
      }
    }
  }

  private setCellData(cell: AuthoredTileCell): void {
    const alternative = decodeAlternative(cell.alternativeTile ?? 0);
    const stored: GodotTileCell = {
      coords: copyCoords(cell.coords),
      sourceId: cell.sourceId,
      atlasCoords: copyCoords(cell.atlasCoords),
      alternativeTile: cell.alternativeTile ?? 0,
      flipH: cell.flipH ?? alternative.flipH,
      flipV: cell.flipV ?? alternative.flipV,
      transpose: cell.transpose ?? alternative.transpose,
    };
    this.cells.set(coordsKey(cell.coords), stored);
    this.dirtyQuadrants.add(this.quadrantKey(cell.coords));
  }

  private quadrantKey(coords: TileVector2i): string {
    return `${Math.floor(coords.x / this.rendering_quadrant_size)},${Math.floor(coords.y / this.rendering_quadrant_size)}`;
  }

  private flushDirtyQuadrants(): void {
    if (this.liveTileSet === null) return;
    for (const key of this.dirtyQuadrants) this.rebuildQuadrant(key);
    this.dirtyQuadrants.clear();
  }

  private rebuildQuadrant(key: string): void {
    const previous = this.quadrants.get(key);
    if (previous !== undefined) {
      for (const child of previous.children) {
        if (child instanceof CompositeTilemap) releaseCanvasItemMaterial(child);
      }
      this.removeChild(previous);
      previous.destroy({ children: true });
      this.quadrants.delete(key);
    }
    const cells = [...this.cells.values()].filter((cell) => this.quadrantKey(cell.coords) === key);
    if (cells.length === 0) return;
    const tileSet = this.requireTileSet('update_internals');
    const quadrant = new Container({ label: `Tile quadrant ${key}`, sortableChildren: true });
    const batches: {
      readonly zIndex: number;
      readonly color: number;
      readonly material: GodotCanvasMaterial | null;
      readonly batch: CompositeTilemap;
    }[] = [];
    for (const cell of cells) {
      const legacy = tileSet.legacyTile(cell.sourceId);
      const data = legacy === null
        ? tileSet.get_source(cell.sourceId)?.get_tile_data(cell.atlasCoords, cell.alternativeTile) ?? null
        : null;
      const dataState = data === null ? null : requireTileDataState(data, 'render');
      const zIndex = legacy === null
        ? 0
        : legacy.zIndex + (legacy.tileMode === 0
          ? 0
          : legacy.autotileZIndices.get(coordsKey(cell.atlasCoords)) ?? 0);
      const color = colorHex(legacy?.modulate ?? dataState?.modulate ?? WHITE);
      const material = dataState?.material ?? null;
      let retained = batches.find((candidate) => (
        candidate.zIndex === zIndex && candidate.color === color && candidate.material === material
      ));
      if (retained === undefined) {
        const batch = new CompositeTilemap();
        batch.label = `Tile batch ${zIndex}:${color.toString(16)}`;
        batch.zIndex = zIndex;
        batch.tint = color;
        setCanvasItemMaterial(batch, material);
        retained = { zIndex, color, material, batch };
        batches.push(retained);
        quadrant.addChild(batch);
      }
      this.paintCell(retained.batch, cell);
    }
    this.quadrants.set(key, quadrant);
    this.addChild(quadrant);
  }

  private paintCell(batch: CompositeTilemap, cell: GodotTileCell): void {
    const tileSet = this.requireTileSet('update_internals');
    const legacy = tileSet.legacyTile(cell.sourceId);
    if (legacy !== null) {
      if (legacy.texture === null) return;
      const autotile = legacy.tileMode !== 0;
      const width = autotile
        ? legacy.autotileSize.x
        : legacy.region.width > 0 ? legacy.region.width : tileSet.tile_size.x;
      const height = autotile
        ? legacy.autotileSize.y
        : legacy.region.height > 0 ? legacy.region.height : tileSet.tile_size.y;
      const regionX = legacy.region.x + (autotile
        ? (legacy.autotileSize.x + legacy.autotileSpacing) * cell.atlasCoords.x
        : 0);
      const regionY = legacy.region.y + (autotile
        ? (legacy.autotileSize.y + legacy.autotileSpacing) * cell.atlasCoords.y
        : 0);
      let textureOffsetX = legacy.textureOffset.x;
      let textureOffsetY = legacy.textureOffset.y;
      if (cell.transpose) [textureOffsetX, textureOffsetY] = [textureOffsetY, textureOffsetX];
      if (cell.flipH) textureOffsetX = -textureOffsetX;
      if (cell.flipV) textureOffsetY = -textureOffsetY;
      batch.tile(
        legacy.texture,
        cell.coords.x * tileSet.tile_size.x + textureOffsetX,
        cell.coords.y * tileSet.tile_size.y + textureOffsetY,
        {
          u: regionX,
          v: regionY,
          tileWidth: width,
          tileHeight: height,
          rotate: tileTransform(cell.flipH, cell.flipV, cell.transpose),
          alpha: legacy.modulate.a,
        },
      );
      return;
    }
    const source = tileSet.source(cell.sourceId);
    if (source.texture === null) return;
    const atlasTile = source.tile(cell.atlasCoords);
    const data = source.get_tile_data(cell.atlasCoords, cell.alternativeTile);
    if (data === null) return;
    const dataState = requireTileDataState(data, 'render');
    const region = source.texture_region_size;
    const u = source.margins.x + cell.atlasCoords.x * (region.x + source.separation.x);
    const v = source.margins.y + cell.atlasCoords.y * (region.y + source.separation.y);
    const tileWidth = region.x * atlasTile.sizeInAtlas.x + source.separation.x * (atlasTile.sizeInAtlas.x - 1);
    const tileHeight = region.y * atlasTile.sizeInAtlas.y + source.separation.y * (atlasTile.sizeInAtlas.y - 1);
    batch.tile(
      source.texture,
      cell.coords.x * tileSet.tile_size.x + dataState.textureOrigin.x,
      cell.coords.y * tileSet.tile_size.y + dataState.textureOrigin.y,
      {
        u,
        v,
        tileWidth,
        tileHeight,
        rotate: tileTransform(cell.flipH, cell.flipV, cell.transpose),
        alpha: dataState.modulate.a,
      },
    );
  }
}

export interface GodotTileMapOptions {
  readonly tileSet: GodotTileSet;
  readonly layers?: readonly (Omit<GodotTileMapLayerOptions, 'tileSet'> & { readonly index?: number })[];
}

/** Godot 3/4 TileMap facade: runtime cell methods dispatch to native batched layer primitives. */
export class GodotTileMap extends Container {
  private liveTileSet: GodotTileSet;
  private readonly layers = new Map<number, GodotTileMapLayer>();
  private readonly layerModulates = new Map<number, ColorValue>();

  constructor(options: GodotTileMapOptions) {
    super();
    bindGodotCanvasNode2DApi(this);
    registerGodotObjectIdentity(this, 'TileMap');
    registerCanvasNodeRelease(this, () => this.release());
    this.liveTileSet = options.tileSet;
    for (const [ordinal, optionsLayer] of (options.layers ?? []).entries()) {
      this.add_layer(optionsLayer.index ?? ordinal, optionsLayer);
    }
  }

  get tile_set(): GodotTileSet { return this.liveTileSet; }
  set tile_set(value: GodotTileSet) {
    if (value === this.liveTileSet) return;
    this.liveTileSet = value;
    for (const layer of this.layers.values()) layer.tile_set = value;
  }

  /** Godot 3's TileMap.cell_size aliases the retained TileSet grid size. */
  get cell_size(): TileVector2i { return this.liveTileSet.tile_size; }
  set cell_size(value: TileVector2i) { this.liveTileSet.tile_size = value; }
  get rendering_quadrant_size(): number { return this.layer(0).rendering_quadrant_size; }
  set rendering_quadrant_size(value: number) { this.layer(0).rendering_quadrant_size = value; }
  get_collision_layer_bit(bit: number): boolean { return this.layer(0).get_collision_layer_bit(bit); }
  set_collision_layer_bit(bit: number, enabled: boolean): void { this.layer(0).set_collision_layer_bit(bit, enabled); }
  get_collision_mask_bit(bit: number): boolean { return this.layer(0).get_collision_mask_bit(bit); }
  set_collision_mask_bit(bit: number, enabled: boolean): void { this.layer(0).set_collision_mask_bit(bit, enabled); }

  add_layer(index: number, options: Omit<GodotTileMapLayerOptions, 'tileSet'> = {}): GodotTileMapLayer {
    this.remove_layer(index);
    const layer = new GodotTileMapLayer({ ...options, tileSet: this.tile_set });
    layer.label = `TileMap layer ${index}`;
    this.layers.set(index, layer);
    this.addChild(layer);
    return layer;
  }

  remove_layer(index: number): void {
    const layer = this.layers.get(index);
    if (layer === undefined) return;
    this.layers.delete(index);
    this.layerModulates.delete(index);
    this.removeChild(layer);
    layer.release();
    layer.destroy({ children: true });
  }

  get_layers_count(): number { return this.layers.size; }
  layer(index: number): GodotTileMapLayer { return this.layers.get(index) ?? this.add_layer(index); }

  move_layer(layer: number, toPosition: number): void {
    const ordered = [...this.layers.entries()].sort(([left], [right]) => left - right);
    const from = ordered.findIndex(([index]) => index === layer);
    if (from < 0) throw new RangeError(`TileMap layer ${String(layer)} does not exist.`);
    const target = toPosition < 0 ? ordered.length - 1 : integer(toPosition, 'to_position');
    if (target < 0 || target >= ordered.length) throw new RangeError(`TileMap move target ${String(toPosition)} is out of range.`);
    const [moved] = ordered.splice(from, 1);
    ordered.splice(target, 0, moved!);
    const modulates = new Map(this.layerModulates);
    this.layers.clear();
    this.layerModulates.clear();
    ordered.forEach(([oldIndex, retained], index) => {
      retained.label = `TileMap layer ${index}`;
      this.layers.set(index, retained);
      const modulate = modulates.get(oldIndex);
      if (modulate !== undefined) this.layerModulates.set(index, modulate);
      this.setChildIndex(retained, index);
    });
  }

  set_layer_enabled(layer: number, enabled: boolean): void {
    this.layer(integer(layer, 'layer')).visible = boolean(enabled, 'enabled');
  }
  is_layer_enabled(layer: number): boolean { return this.layer(integer(layer, 'layer')).visible; }
  set_layer_modulate(layer: number, value: ColorValue): void {
    const color = finiteColor(value, 'layer_modulate');
    const retained = this.layer(integer(layer, 'layer'));
    this.layerModulates.set(layer, color);
    retained.tint = colorHex(color);
    retained.alpha = color.a;
  }
  get_layer_modulate(layer: number): ColorValue {
    return copyColor(this.layerModulates.get(integer(layer, 'layer')) ?? WHITE);
  }
  set_layer_z_index(layer: number, zIndex: number): void {
    this.layer(integer(layer, 'layer')).zIndex = integer(zIndex, 'z_index');
  }
  get_layer_z_index(layer: number): number { return this.layer(integer(layer, 'layer')).zIndex; }

  set_cell(
    layer: number,
    coords: TileVector2i,
    sourceId?: number,
    atlasCoords?: TileVector2i,
    alternativeTile?: number,
  ): void;
  set_cell(
    x: number,
    y: number,
    tile: number,
    flipX?: boolean,
    flipY?: boolean,
    transpose?: boolean,
    autotileCoord?: TileVector2i,
  ): void;
  set_cell(
    first: number,
    second: TileVector2i | number,
    third = -1,
    fourth: TileVector2i | boolean = false,
    fifth: number | boolean = 0,
    sixth = false,
    seventh: TileVector2i = ZERO_COORDS,
  ): void {
    if (typeof second === 'number') {
      const x = integer(first, 'x');
      const y = integer(second, 'y');
      const tile = integer(third, 'tile');
      if (tile < 0) { this.layer(0).erase_cell({ x, y }); return; }
      if (typeof fourth !== 'boolean' || typeof fifth !== 'boolean') {
        throw new TypeError('Godot 3 TileMap.set_cell flip_x and flip_y require bool.');
      }
      const flipX = boolean(fourth, 'flip_x');
      const flipY = boolean(fifth, 'flip_y');
      const transpose = boolean(sixth, 'transpose');
      const atlasCoords = godot3AutotileCoords(seventh);
      this.layer(0).set_cell_with_transform({
        coords: { x, y },
        sourceId: tile,
        atlasCoords,
        alternativeTile: encodeAlternative(flipX, flipY, transpose),
        flipH: flipX,
        flipV: flipY,
        transpose,
      });
      return;
    }
    const atlasCoords = typeof fourth === 'boolean' ? INVALID_COORDS : fourth;
    const alternativeTile = typeof fifth === 'boolean' ? 0 : fifth;
    this.layer(integer(first, 'layer')).set_cell(
      finiteCoords(second, 'coords'),
      integer(third, 'source_id'),
      finiteCoords(atlasCoords, 'atlas_coords'),
      integer(alternativeTile, 'alternative_tile'),
    );
  }
  set_cellv(
    position: TileVector2i,
    tile: number,
    flipX = false,
    flipY = false,
    transpose = false,
    autotileCoord: TileVector2i = ZERO_COORDS,
  ): void {
    const coords = finiteCoords(position, 'position');
    this.set_cell(coords.x, coords.y, tile, flipX, flipY, transpose, autotileCoord);
  }
  erase_cell(layer: number, coords: TileVector2i): void;
  erase_cell(x: number, y: number): void;
  erase_cell(first: number, second: TileVector2i | number): void {
    if (typeof second === 'number') this.layer(0).erase_cell({ x: integer(first, 'x'), y: integer(second, 'y') });
    else this.layer(integer(first, 'layer')).erase_cell(finiteCoords(second, 'coords'));
  }
  get_cell_source_id(layer: number, coords: TileVector2i, useProxies = false): number {
    return this.layer(layer).get_cell_source_id(coords, useProxies);
  }
  /** Godot 3 TileMap.get_cell(x, y): legacy tile/source id from layer zero. */
  get_cell(x: number, y: number): number {
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
      throw new TypeError('Godot TileMap.get_cell requires integer x and y coordinates.');
    }
    return this.layers.get(0)?.get_cell_source_id({ x, y }) ?? -1;
  }
  get_cellv(position: TileVector2i): number {
    const coords = finiteCoords(position, 'position');
    return this.get_cell(coords.x, coords.y);
  }
  get_used_rect(): { position: TileVector2i; size: TileVector2i } {
    return this.layers.get(0)?.get_used_rect() ?? { position: copyCoords(ZERO_COORDS), size: copyCoords(ZERO_COORDS) };
  }
  is_cell_transposed(x: number, y: number): boolean {
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
      throw new TypeError('Godot TileMap.is_cell_transposed requires integer x and y coordinates.');
    }
    return this.layers.get(0)?.is_cell_transposed({ x, y }) ?? false;
  }
  is_cell_y_flipped(x: number, y: number): boolean {
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
      throw new TypeError('Godot TileMap.is_cell_y_flipped requires integer x and y coordinates.');
    }
    return this.layers.get(0)?.is_cell_y_flipped({ x, y }) ?? false;
  }
  is_cell_x_flipped(x: number, y: number): boolean {
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
      throw new TypeError('Godot TileMap.is_cell_x_flipped requires integer x and y coordinates.');
    }
    return this.layers.get(0)?.is_cell_x_flipped({ x, y }) ?? false;
  }
  get_cell_autotile_coord(x: number, y: number): TileVector2i {
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
      throw new TypeError('Godot TileMap.get_cell_autotile_coord requires integer x and y coordinates.');
    }
    const layer = this.layers.get(0);
    if (layer === undefined || layer.get_cell_source_id({ x, y }) < 0) return copyCoords(ZERO_COORDS);
    return layer.get_cell_atlas_coords({ x, y });
  }
  set_cell_autotile_coord(x: number, y: number, coord: TileVector2i): void {
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
      throw new TypeError('Godot TileMap.set_cell_autotile_coord requires integer x and y coordinates.');
    }
    this.layers.get(0)?.set_cell_autotile_coord({ x, y }, coord);
  }
  /**
   * Godot 3 recomputes autotile coordinates in this region. Authored coordinates render exactly,
   * but a runtime recomputation still requires the TileSet bitmask/priority selection mechanism.
   */
  update_bitmask_region(start: TileVector2i = ZERO_COORDS, end: TileVector2i = ZERO_COORDS): void {
    finiteCoords(start, 'TileMap.update_bitmask_region start');
    finiteCoords(end, 'TileMap.update_bitmask_region end');
    if (this.liveTileSet.hasLegacyAutotiles()) {
      throw new Error(
        'TileMap.update_bitmask_region requires Godot 3 autotile bitmask selection, which this retained TileSet does not own.',
      );
    }
  }
  world_to_map(position: TileVector2i): TileVector2i {
    const world = finiteCoords(position, 'position');
    const local = this.toLocal(world);
    return this.layer(0).local_to_map({ x: local.x, y: local.y });
  }
  local_to_map(position: TileVector2i): TileVector2i {
    const local = finiteCoords(position, 'TileMap.local_to_map position');
    return this.layer(0).local_to_map(local);
  }
  map_to_world(coords: TileVector2i, ignoreHalfOfs = false): TileVector2i {
    const cell = finiteCoords(coords, 'coords');
    const local = this.layer(0).map_to_local(cell);
    return ignoreHalfOfs
      ? { x: local.x - this.cell_size.x / 2, y: local.y - this.cell_size.y / 2 }
      : local;
  }
  get_cell_atlas_coords(layer: number, coords: TileVector2i, useProxies = false): TileVector2i {
    return this.layer(layer).get_cell_atlas_coords(coords, useProxies);
  }
  get_cell_alternative_tile(layer: number, coords: TileVector2i, useProxies = false): number {
    return this.layer(layer).get_cell_alternative_tile(coords, useProxies);
  }
  get_cell_tile_data(layer: number, coords: TileVector2i, useProxies = false): GodotTileData | null {
    const index = integer(layer, 'layer');
    if (typeof useProxies !== 'boolean') {
      throw new TypeError('TileMap.get_cell_tile_data use_proxies requires bool.');
    }
    return this.layers.get(index)?.get_cell_tile_data(finiteCoords(coords, 'coords')) ?? null;
  }
  get_pattern(layer: number, coordsArray: readonly TileVector2i[]): GodotTileMapPattern {
    return this.layer(integer(layer, 'layer')).get_pattern(coordsArray);
  }
  set_pattern(layer: number, position: TileVector2i, pattern: GodotTileMapPattern): void {
    this.layer(integer(layer, 'layer')).set_pattern(position, pattern);
  }
  map_pattern(
    positionInTilemap: TileVector2i,
    coordsInPattern: TileVector2i,
    pattern: GodotTileMapPattern,
  ): TileVector2i {
    return this.layer(0).map_pattern(positionInTilemap, coordsInPattern, pattern);
  }
  get_used_cells(layer = 0): TileVector2i[] { return this.layer(layer).get_used_cells(); }
  get_used_cells_by_id(
    godotMajor: 3 | 4,
    first = -1,
    second = -1,
    third: TileVector2i = INVALID_COORDS,
    fourth = -1,
  ): TileVector2i[] {
    if (godotMajor === 3) {
      return this.layer(0).get_used_cells_by_id(integer(first, 'tile id'), INVALID_COORDS, -1);
    }
    return this.layer(integer(first, 'layer')).get_used_cells_by_id(second, third, fourth);
  }
  set_cells_terrain_connect(
    layer: number,
    cells: readonly TileVector2i[],
    terrainSet: number,
    terrain: number,
    ignoreEmptyTerrains = true,
  ): void {
    this.layer(integer(layer, 'layer')).set_cells_terrain_connect(
      cells,
      terrainSet,
      terrain,
      ignoreEmptyTerrains,
    );
  }
  set_cells_terrain_path(
    layer: number,
    path: readonly TileVector2i[],
    terrainSet: number,
    terrain: number,
    ignoreEmptyTerrains = true,
  ): void {
    this.layer(integer(layer, 'layer')).set_cells_terrain_path(
      path,
      terrainSet,
      terrain,
      ignoreEmptyTerrains,
    );
  }
  get_surrounding_cells(coords: TileVector2i): TileVector2i[] {
    return this.liveTileSet.surroundingCells(coords);
  }
  notify_runtime_tile_data_update(layer = -1): void {
    const index = integer(layer, 'layer');
    if (index < 0) {
      for (const retained of this.layers.values()) retained.notify_runtime_tile_data_update();
      return;
    }
    this.layer(index).notify_runtime_tile_data_update();
  }
  clear_layer(layer: number): void { this.layer(layer).clear(); }
  clear(): void { for (const layer of this.layers.values()) layer.clear(); }

  release(): void {
    for (const layer of this.layers.values()) layer.release();
  }

  preparePhysics(root: Container): void {
    for (const layer of this.layers.values()) layer.preparePhysics(root);
  }
}

const ZERO_COORDS: TileVector2i = { x: 0, y: 0 };
const ONE_COORDS: TileVector2i = { x: 1, y: 1 };
const INVALID_COORDS: TileVector2i = { x: -1, y: -1 };
const ZERO_RECT: TileRect2 = { x: 0, y: 0, width: 0, height: 0 };
const WHITE: ColorValue = { r: 1, g: 1, b: 1, a: 1 };
const IDENTITY_TRANSFORM_2D: TileTransform2D = {
  x: { x: 1, y: 0 },
  y: { x: 0, y: 1 },
  origin: { x: 0, y: 0 },
};
const FLIP_H = 1 << 12;
const FLIP_V = 1 << 13;
const TRANSPOSE = 1 << 14;
const TILE_SHAPE_SQUARE = 0;
const TILE_SHAPE_ISOMETRIC = 1;
const TILE_LAYOUT_STACKED = 0;
const TILE_OFFSET_AXIS_HORIZONTAL = 0;
const CARDINAL_NEIGHBORS: readonly TileVector2i[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];
const TERRAIN_MODE_MATCH_CORNERS = 1;
const TERRAIN_MODE_MATCH_SIDES = 2;
interface TerrainNeighbor { readonly peeringBit: number; readonly coords: TileVector2i }
const SIDE_TERRAIN_NEIGHBORS: readonly TerrainNeighbor[] = [
  { peeringBit: 0, coords: { x: 1, y: 0 } },
  { peeringBit: 4, coords: { x: 0, y: 1 } },
  { peeringBit: 8, coords: { x: -1, y: 0 } },
  { peeringBit: 12, coords: { x: 0, y: -1 } },
];
const CORNER_TERRAIN_NEIGHBORS: readonly TerrainNeighbor[] = [
  { peeringBit: 1, coords: { x: 1, y: -1 } },
  { peeringBit: 5, coords: { x: 1, y: 1 } },
  { peeringBit: 9, coords: { x: -1, y: 1 } },
  { peeringBit: 13, coords: { x: -1, y: -1 } },
];
const ALL_TERRAIN_NEIGHBORS: readonly TerrainNeighbor[] = [
  SIDE_TERRAIN_NEIGHBORS[0]!, CORNER_TERRAIN_NEIGHBORS[0]!,
  SIDE_TERRAIN_NEIGHBORS[1]!, CORNER_TERRAIN_NEIGHBORS[1]!,
  SIDE_TERRAIN_NEIGHBORS[2]!, CORNER_TERRAIN_NEIGHBORS[2]!,
  SIDE_TERRAIN_NEIGHBORS[3]!, CORNER_TERRAIN_NEIGHBORS[3]!,
];

function copyCoords(coords: TileVector2i): TileVector2i { return { x: coords.x, y: coords.y }; }
function copyRect(rect: TileRect2): TileRect2 {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}
function copyColor(color: ColorValue): ColorValue {
  return { r: color.r, g: color.g, b: color.b, a: color.a };
}
function copyTransform(transform: TileTransform2D): TileTransform2D {
  return { x: copyCoords(transform.x), y: copyCoords(transform.y), origin: copyCoords(transform.origin) };
}
function copyTileShape(shape: Godot3TileShape): Godot3TileShape {
  return {
    shape: shape.shape,
    transform: finiteTransform(shape.transform, 'shape_transform'),
    oneWay: boolean(shape.oneWay, 'shape_one_way'),
    oneWayMargin: finite(shape.oneWayMargin, 'shape_one_way_margin'),
    autotileCoord: finiteCoords(shape.autotileCoord, 'autotile_coord'),
  };
}
function dictionaryValue(value: unknown, key: string): unknown {
  if (value instanceof Map) return value.get(key);
  if (typeof value === 'object' && value !== null) return Reflect.get(value, key);
  return undefined;
}
function isGodotShape2D(value: unknown): value is GodotShape2D {
  if (typeof value !== 'object' || value === null) return false;
  return ['circle', 'rectangle', 'capsule', 'ray', 'segment', 'convex-polygon', 'concave-polygon']
    .includes(String(Reflect.get(value, 'kind')));
}
function normalizeTileShape(value: unknown, index: number): Godot3TileShape {
  if (!(value instanceof Map) && (typeof value !== 'object' || value === null)) {
    throw new TypeError(`TileSet.tile_set_shapes entry ${index} requires Dictionary.`);
  }
  const shape = dictionaryValue(value, 'shape');
  if (!isGodotShape2D(shape)) throw new TypeError(`TileSet.tile_set_shapes entry ${index}.shape requires Shape2D.`);
  return copyTileShape({
    shape,
    transform: (dictionaryValue(value, 'shape_transform') ?? IDENTITY_TRANSFORM_2D) as TileTransform2D,
    oneWay: (dictionaryValue(value, 'one_way') ?? false) as boolean,
    oneWayMargin: (dictionaryValue(value, 'one_way_margin') ?? 1) as number,
    autotileCoord: (dictionaryValue(value, 'autotile_coord') ?? ZERO_COORDS) as TileVector2i,
  });
}
function finite(value: number, member: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`TileSet.${member} requires a finite number.`);
  return value;
}
function integer(value: number, member: string): number {
  const retained = finite(value, member);
  if (!Number.isSafeInteger(retained)) throw new TypeError(`TileSet.${member} requires an integer.`);
  return retained;
}
function enumInteger(value: number, minimum: number, maximum: number, member: string): number {
  const retained = integer(value, member);
  if (retained < minimum || retained > maximum) {
    throw new RangeError(`TileSet.${member} is outside the pinned enum range ${minimum}..${maximum}.`);
  }
  return retained;
}
function boolean(value: boolean, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`TileSet.${member} requires bool.`);
  return value;
}
function string(value: string, member: string): string {
  if (typeof value !== 'string') throw new TypeError(`TileSet.${member} requires String.`);
  return value;
}
function tileId(value: number): number {
  const id = integer(value, 'tile id');
  if (id < 0) throw new RangeError('TileSet tile id must be non-negative.');
  return id;
}
function tileMode(value: number): number {
  const mode = integer(value, 'tile_mode');
  if (mode < 0 || mode > 2) throw new RangeError('TileSet.tile_mode must be SINGLE_TILE, AUTO_TILE, or ATLAS_TILE.');
  return mode;
}
function finiteCoords(coords: TileVector2i, member: string): TileVector2i {
  if (typeof coords !== 'object' || coords === null) throw new TypeError(`TileSet.${member} requires Vector2.`);
  return { x: finite(coords.x, `${member}.x`), y: finite(coords.y, `${member}.y`) };
}
function godot3AutotileCoords(coords: TileVector2i): TileVector2i {
  const value = finiteCoords(coords, 'TileMap autotile_coord');
  return { x: Math.trunc(value.x) & 0xffff, y: Math.trunc(value.y) & 0xffff };
}
function finiteCellArray(value: readonly TileVector2i[], member: string): TileVector2i[] {
  if (!Array.isArray(value)) throw new TypeError(`TileSet.${member} requires Array[Vector2i].`);
  return value.map((coords, index) => finiteCoords(coords, `${member}[${index}]`));
}
function requireCellLookupBoolean(useProxies: boolean, member: string): void {
  if (typeof useProxies !== 'boolean') throw new TypeError(`TileMapLayer.${member} use_proxies requires bool.`);
}
function areSurroundingCells(tileSet: GodotTileSet, left: TileVector2i, right: TileVector2i): boolean {
  return tileSet.surroundingCells(left).some((coords) => coordsEqual(coords, right));
}
function positiveCoords(coords: TileVector2i, member: string): TileVector2i {
  const value = finiteCoords(coords, member);
  if (value.x <= 0 || value.y <= 0) throw new RangeError(`TileSet.${member} must be positive.`);
  return value;
}
function nonNegativeCoords(coords: TileVector2i, member: string): TileVector2i {
  const value = finiteCoords(coords, member);
  if (value.x < 0 || value.y < 0) throw new RangeError(`TileSet.${member} must be non-negative.`);
  return value;
}
function tileRectsOverlap(a: TileVector2i, as: TileVector2i, b: TileVector2i, bs: TileVector2i): boolean {
  return a.x < b.x + bs.x && a.x + as.x > b.x && a.y < b.y + bs.y && a.y + as.y > b.y;
}
function rectContainsTileCell(origin: TileVector2i, size: TileVector2i, point: TileVector2i): boolean {
  return point.x >= origin.x && point.y >= origin.y && point.x < origin.x + size.x && point.y < origin.y + size.y;
}
function atlasGridSize(texture: Texture | null, margins: TileVector2i, separation: TileVector2i, region: TileVector2i): TileVector2i {
  if (texture === null) return copyCoords(ZERO_COORDS);
  return {
    x: Math.max(0, Math.floor((texture.width - margins.x + separation.x) / (region.x + separation.x))),
    y: Math.max(0, Math.floor((texture.height - margins.y + separation.y) / (region.y + separation.y))),
  };
}
function tileFitsGrid(tile: GodotAtlasTile, grid: TileVector2i): boolean {
  return tile.atlasCoords.x >= 0 && tile.atlasCoords.y >= 0 &&
    tile.atlasCoords.x + tile.sizeInAtlas.x <= grid.x && tile.atlasCoords.y + tile.sizeInAtlas.y <= grid.y;
}
function finiteRect(rect: TileRect2, member: string): TileRect2 {
  if (typeof rect !== 'object' || rect === null) throw new TypeError(`TileSet.${member} requires Rect2.`);
  const value = {
    x: finite(rect.x, `${member}.x`),
    y: finite(rect.y, `${member}.y`),
    width: finite(rect.width, `${member}.width`),
    height: finite(rect.height, `${member}.height`),
  };
  if (value.width < 0 || value.height < 0) throw new RangeError(`TileSet.${member} size must be non-negative.`);
  return value;
}
function finiteColor(color: ColorValue, member: string): ColorValue {
  if (typeof color !== 'object' || color === null) throw new TypeError(`TileSet.${member} requires Color.`);
  return {
    r: finite(color.r, `${member}.r`),
    g: finite(color.g, `${member}.g`),
    b: finite(color.b, `${member}.b`),
    a: finite(color.a, `${member}.a`),
  };
}
function colorHex(color: ColorValue): number {
  const channel = (value: number): number => Math.round(Math.max(0, Math.min(1, value)) * 255);
  return channel(color.r) * 0x10000 + channel(color.g) * 0x100 + channel(color.b);
}
function finiteTransform(transform: TileTransform2D, member: string): TileTransform2D {
  if (typeof transform !== 'object' || transform === null) {
    throw new TypeError(`TileSet.${member} requires Transform2D.`);
  }
  return {
    x: finiteCoords(transform.x, `${member}.x`),
    y: finiteCoords(transform.y, `${member}.y`),
    origin: finiteCoords(transform.origin, `${member}.origin`),
  };
}
function duplicateNested<T>(value: T, subresources: boolean, memo: Map<object, object>): T {
  return subresources ? duplicateGodotSubresource(value, memo) : value;
}
function copyGodot3Tile(
  tile: Godot3Tile,
  subresources: boolean,
  memo: Map<object, object>,
): Godot3TileInput {
  return {
    id: tile.id,
    name: tile.name,
    texture: duplicateNested(tile.texture, subresources, memo),
    normalMap: duplicateNested(tile.normalMap, subresources, memo),
    textureOffset: tile.textureOffset,
    material: duplicateNested(tile.material, subresources, memo),
    modulate: tile.modulate,
    region: tile.region,
    tileMode: tile.tileMode,
    autotileSize: copyCoords(tile.autotileSize),
    autotileSpacing: tile.autotileSpacing,
    autotileIconCoordinate: copyCoords(tile.autotileIconCoordinate),
    autotileZIndices: [...tile.autotileZIndices].map(([key, zIndex]) => {
      const [x, y] = key.split(',').map(Number);
      return { coords: { x: x!, y: y! }, zIndex };
    }),
    occluderOffset: tile.occluderOffset,
    occluder: duplicateNested(tile.occluder, subresources, memo),
    navigationPolygon: duplicateNested(tile.navigationPolygon, subresources, memo),
    navigationPolygonOffset: tile.navigationPolygonOffset,
    shapes: tile.shapes.map((entry) => ({
      ...entry,
      shape: duplicateNested(entry.shape, subresources, memo),
      transform: copyTransform(entry.transform),
      autotileCoord: copyCoords(entry.autotileCoord),
    })),
    zIndex: tile.zIndex,
  };
}
function coordsKey(coords: TileVector2i): string { return `${coords.x},${coords.y}`; }
function coordsEqual(a: TileVector2i, b: TileVector2i): boolean { return a.x === b.x && a.y === b.y; }

function firstUnusedSource(sources: ReadonlyMap<number, unknown>): number {
  let id = 0;
  while (sources.has(id)) id += 1;
  return id;
}

function positiveInteger(value: number, member: string): number {
  const decoded = integer(value, member);
  if (decoded < 1) throw new RangeError(`${member} must be a positive integer.`);
  return decoded;
}

function nonNegativeInteger(value: number, member: string): number {
  const decoded = integer(value, member);
  if (decoded < 0) throw new RangeError(`${member} must be a non-negative integer.`);
  return decoded;
}

function normalizeTileSetPhysicsLayer(layer: GodotTileSetPhysicsLayer): GodotTileSetPhysicsLayer {
  return {
    collisionLayer: nonNegativeInteger(layer.collisionLayer, 'TileSet physics_layer collision_layer'),
    collisionMask: nonNegativeInteger(layer.collisionMask, 'TileSet physics_layer collision_mask'),
  };
}

function shiftTileDataCollisionLayers(data: GodotTileData, insertedAt: number): void {
  const state = requireTileDataState(data, 'collision layer insertion');
  const shifted = [...state.collisionPolygons.entries()]
    .sort(([left], [right]) => right - left);
  for (const [layer, polygons] of shifted) {
    if (layer < insertedAt) continue;
    state.collisionPolygons.delete(layer);
    state.collisionPolygons.set(layer + 1, polygons);
  }
}

function firstUnusedAlternative(alternatives: ReadonlyMap<number, unknown>): number {
  let id = 1;
  while (alternatives.has(id)) id += 1;
  return id;
}

function encodeAlternative(flipH: boolean, flipV: boolean, transpose: boolean): number {
  return (flipH ? FLIP_H : 0) | (flipV ? FLIP_V : 0) | (transpose ? TRANSPOSE : 0);
}

function decodeAlternative(id: number): GodotTileAlternative {
  return {
    id,
    flipH: (id & FLIP_H) !== 0,
    flipV: (id & FLIP_V) !== 0,
    transpose: (id & TRANSPOSE) !== 0,
  };
}

function createTileData(id: number, changed: () => void): GodotTileData {
  const data = decodeAlternative(id) as GodotTileData;
  TILE_DATA_STATE.set(data, {
    customData: new Map(),
    material: null,
    modulate: copyColor(WHITE),
    textureOrigin: copyCoords(ZERO_COORDS),
    collisionPolygons: new Map(),
    terrainSet: -1,
    terrain: -1,
    terrainPeering: new Map(),
    changed,
  });
  registerGodotObjectIdentity(data, 'TileData');
  return data;
}

/** @pixi/tilemap consumes Pixi's GroupD8 rotation/reflection ordinal. */
function tileTransform(flipH: boolean, flipV: boolean, transpose: boolean): number {
  if (transpose) {
    if (flipH && flipV) return 14;
    if (flipH) return 2;
    if (flipV) return 6;
    return 10;
  }
  if (flipH && flipV) return 4;
  if (flipH) return 12;
  if (flipV) return 8;
  return 0;
}

function multiplyBasis(left: TileTransform2D, right: TileTransform2D): TileTransform2D {
  return {
    x: {
      x: left.x.x * right.x.x + left.y.x * right.x.y,
      y: left.x.y * right.x.x + left.y.y * right.x.y,
    },
    y: {
      x: left.x.x * right.y.x + left.y.x * right.y.y,
      y: left.x.y * right.y.x + left.y.y * right.y.y,
    },
    origin: {
      x: left.origin.x + left.x.x * right.origin.x + left.y.x * right.origin.y,
      y: left.origin.y + left.x.y * right.origin.x + left.y.y * right.origin.y,
    },
  };
}

function cellTransform(cell: GodotTileCell, size: TileVector2i): TileTransform2D {
  let transform: TileTransform2D = {
    ...IDENTITY_TRANSFORM_2D,
    origin: { x: cell.coords.x * size.x, y: cell.coords.y * size.y },
  };
  let width = size.x;
  let height = size.y;
  if (cell.transpose) {
    transform = multiplyBasis(transform, {
      x: { x: 0, y: 1 }, y: { x: 1, y: 0 }, origin: ZERO_COORDS,
    });
    [width, height] = [height, width];
  }
  if (cell.flipH) {
    transform = multiplyBasis(transform, {
      x: { x: -1, y: 0 }, y: { x: 0, y: 1 }, origin: { x: width, y: 0 },
    });
  }
  if (cell.flipV) {
    transform = multiplyBasis(transform, {
      x: { x: 1, y: 0 }, y: { x: 0, y: -1 }, origin: { x: 0, y: height },
    });
  }
  return transform;
}

function composeTileShapeTransform(
  cell: GodotTileCell,
  tileSize: TileVector2i,
  shape: TileTransform2D,
): TileTransform2D {
  return multiplyBasis(cellTransform(cell, tileSize), shape);
}

function tileDataCellTransform(cell: GodotTileCell, tileSize: TileVector2i): TileTransform2D {
  let x = { x: 1, y: 0 };
  let y = { x: 0, y: 1 };
  if (cell.transpose) [x, y] = [y, x];
  if (cell.flipH) x = { x: -x.x, y: -x.y };
  if (cell.flipV) y = { x: -y.x, y: -y.y };
  return {
    x,
    y,
    origin: {
      x: (cell.coords.x + 0.5) * tileSize.x,
      y: (cell.coords.y + 0.5) * tileSize.y,
    },
  };
}

function applyTileTransform(node: Container, transform: TileTransform2D): void {
  node.setFromMatrix(new Matrix(
    transform.x.x,
    transform.x.y,
    transform.y.x,
    transform.y.y,
    transform.origin.x,
    transform.origin.y,
  ));
}

function transformedPoint(point: TileVector2i, transform: TileTransform2D): TileVector2i {
  return {
    x: transform.origin.x + transform.x.x * point.x + transform.y.x * point.y,
    y: transform.origin.y + transform.x.y * point.x + transform.y.y * point.y,
  };
}

function rapierVertices(points: readonly TileVector2i[], transform: TileTransform2D): Float32Array {
  const values = new Float32Array(points.length * 2);
  for (const [index, point] of points.entries()) {
    const transformed = transformedPoint(point, transform);
    values[index * 2] = transformed.x;
    values[index * 2 + 1] = transformed.y;
  }
  return values;
}

function orthonormal(transform: TileTransform2D): boolean {
  const epsilon = 1e-6;
  const xLength = Math.hypot(transform.x.x, transform.x.y);
  const yLength = Math.hypot(transform.y.x, transform.y.y);
  const dot = transform.x.x * transform.y.x + transform.x.y * transform.y.y;
  return Math.abs(xLength - 1) <= epsilon && Math.abs(yLength - 1) <= epsilon && Math.abs(dot) <= epsilon;
}

function transformedTileCollider(shape: GodotShape2D, transform: TileTransform2D): RAPIER.ColliderDesc {
  if (shape.kind === 'circle' || shape.kind === 'capsule') {
    if (!orthonormal(transform)) {
      throw new Error(`TileSet ${shape.kind} shape transform includes scale or shear; Rapier has no exact equivalent.`);
    }
    return rapierColliderDesc2D(shape)
      .setTranslation(transform.origin.x, transform.origin.y)
      .setRotation(Math.atan2(transform.y.y, transform.y.x) - Math.PI / 2);
  }
  if (shape.kind === 'segment') {
    return RAPIER.ColliderDesc.segment(
      transformedPoint(shape.a, transform),
      transformedPoint(shape.b, transform),
    );
  }
  if (shape.kind === 'ray') {
    return RAPIER.ColliderDesc.segment(
      transformedPoint({ x: 0, y: 0 }, transform),
      transformedPoint({ x: 0, y: shape.length }, transform),
    );
  }
  if (shape.kind === 'world-boundary') {
    if (!orthonormal(transform)) {
      throw new Error('TileSet world-boundary transform includes scale or shear; Rapier has no exact equivalent.');
    }
    const magnitude = Math.hypot(shape.normal.x, shape.normal.y);
    if (!(magnitude > 0)) throw new Error('WorldBoundaryShape2D.normal must be non-zero.');
    const localNormal = { x: shape.normal.x / magnitude, y: shape.normal.y / magnitude };
    const normal = {
      x: transform.x.x * localNormal.x + transform.y.x * localNormal.y,
      y: transform.x.y * localNormal.x + transform.y.y * localNormal.y,
    };
    const signedDistance = shape.distance / magnitude;
    const point = transformedPoint(
      { x: localNormal.x * signedDistance, y: localNormal.y * signedDistance },
      transform,
    );
    return RAPIER.ColliderDesc.halfspace(normal).setTranslation(point.x, point.y);
  }
  if (shape.kind === 'rectangle') {
    const halfX = shape.size.x / 2;
    const halfY = shape.size.y / 2;
    const vertices = rapierVertices([
      { x: -halfX, y: -halfY }, { x: halfX, y: -halfY },
      { x: halfX, y: halfY }, { x: -halfX, y: halfY },
    ], transform);
    const descriptor = RAPIER.ColliderDesc.convexHull(vertices);
    if (descriptor === null) throw new Error('TileSet rectangle transform produced a degenerate collision polygon.');
    return descriptor;
  }
  const points = shape.kind === 'convex-polygon' ? shape.points : shape.segments;
  const vertices = rapierVertices(points, transform);
  if (shape.kind === 'convex-polygon') {
    const descriptor = RAPIER.ColliderDesc.convexHull(vertices);
    if (descriptor === null) throw new Error('TileSet convex shape transform produced a degenerate collision polygon.');
    return descriptor;
  }
  const indices = new Uint32Array(points.length);
  for (let index = 0; index < indices.length; index += 1) indices[index] = index;
  return RAPIER.ColliderDesc.polyline(vertices, indices);
}

export function createTileSet(options: GodotTileSetOptions): GodotTileSet { return new GodotTileSet(options); }
export function createTileSetAtlasSource(options: GodotTileSetAtlasSourceOptions = {}): GodotTileSetAtlasSource {
  return new GodotTileSetAtlasSource(options);
}
export function createTileMapLayer(options: GodotTileMapLayerOptions = {}): GodotTileMapLayer {
  return new GodotTileMapLayer(options);
}
export function createTileMap(options: GodotTileMapOptions): GodotTileMap { return new GodotTileMap(options); }
export const createGodotTileMap = createTileMap;
export const createGodotTileMapLayer = createTileMapLayer;

export function createTileMapLayerFromAuthored(
  options: Omit<GodotTileMapLayerOptions, 'cells'> & { readonly payload: AuthoredTilePayload },
): GodotTileMapLayer {
  const { payload, ...layer } = options;
  return new GodotTileMapLayer({ ...layer, cells: decodeAuthoredTileCells(payload) });
}

export interface AuthoredTileMapLayerOptions extends Omit<GodotTileMapLayerOptions, 'tileSet' | 'cells'> {
  readonly index?: number;
  readonly payload: AuthoredTilePayload;
}

export function createTileMapFromAuthored(options: {
  readonly tileSet: GodotTileSet;
  readonly layers: readonly AuthoredTileMapLayerOptions[];
}): GodotTileMap {
  return new GodotTileMap({
    tileSet: options.tileSet,
    layers: options.layers.map(({ payload, ...layer }) => ({
      ...layer,
      cells: decodeAuthoredTileCells(payload),
    })),
  });
}
