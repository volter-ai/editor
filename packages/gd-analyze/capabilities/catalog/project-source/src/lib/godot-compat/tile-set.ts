/**
 * @godot-class TileSet
 * @role BINDING
 *
 * Godot 4.7's `TileSet` and `TileSetAtlasSource` (`scene/resources/2d/tile_set.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) read from the properties the scene stores by the
 * names they make up (`_set`, `tile_set.cpp:3960`, `:5130`): the tile size, the physics layers'
 * collision layer and mask, and the sources; an atlas source's texture, margins, separation and
 * region size, and each tile's alternatives with their flips, transpose and collision polygons.
 */

import type { Texture } from 'three';
import { construct as vector2i, type Vector2i } from './vector2i';

export interface TileAlternative {
  readonly flipH: boolean;
  readonly flipV: boolean;
  readonly transpose: boolean;
  /** Collision polygons by physics layer: flat x, y per point, around the tile's centre. */
  readonly polygons: ReadonlyMap<number, readonly (readonly number[])[]>;
}

export interface TileSetAtlasSource {
  readonly texture: Texture | null;
  readonly margins: Vector2i;
  readonly separation: Vector2i;
  readonly regionSize: Vector2i;
  /** Tiles by `x:y`: their size in the atlas, and their alternatives by id. */
  readonly tiles: ReadonlyMap<string, { readonly size: Vector2i; readonly alternatives: ReadonlyMap<number, TileAlternative> }>;
}

export interface TileSet {
  tileSize: Vector2i;
  readonly physicsLayers: Map<number, { layer: number; mask: number }>;
  readonly sources: Map<number, TileSetAtlasSource>;
}

const SETS = new WeakSet<object>();
const SOURCES = new WeakSet<object>();

function record(value: unknown): Vector2i {
  const v = value as { readonly x?: number; readonly y?: number } | null | undefined;
  return vector2i(v?.x ?? 0, v?.y ?? 0);
}

/**
 * A TileSetAtlasSource of the properties a scene stores.
 *
 * @godot TileSet (protocol)
 * @source scene/resources/2d/tile_set.cpp:5130
 */
export function godot_tile_set_atlas_source_new(properties: ReadonlyMap<string, unknown>): TileSetAtlasSource {
  const tiles = new Map<string, { size: Vector2i; alternatives: Map<number, { flipH: boolean; flipV: boolean; transpose: boolean; polygons: Map<number, number[][]> }> }>();
  const tile = (coords: string) => {
    let entry = tiles.get(coords);
    if (entry === undefined) {
      entry = { size: vector2i(1, 1), alternatives: new Map() };
      tiles.set(coords, entry);
    }
    return entry;
  };
  const alternative = (coords: string, id: number) => {
    const entry = tile(coords).alternatives;
    let alt = entry.get(id);
    if (alt === undefined) {
      alt = { flipH: false, flipV: false, transpose: false, polygons: new Map() };
      entry.set(id, alt);
    }
    return alt;
  };
  for (const [name, value] of properties) {
    const match = /^(-?\d+:-?\d+)\/(.+)$/u.exec(name);
    if (match === null) continue;
    const coords = match[1] as string;
    const rest = (match[2] as string).split('/');
    const head = rest[0] as string;
    if (head === 'size_in_atlas') tile(coords).size = record(value);
    if (!/^\d+$/u.test(head)) continue;
    const alt = alternative(coords, Number(head));
    const field = rest[1];
    if (field === 'flip_h') alt.flipH = value === true;
    else if (field === 'flip_v') alt.flipV = value === true;
    else if (field === 'transpose') alt.transpose = value === true;
    else if (field !== undefined && /^physics_layer_\d+$/u.test(field) && rest[3] === 'points') {
      const layer = Number(field.slice('physics_layer_'.length));
      const list = alt.polygons.get(layer) ?? [];
      list.push([...(value as readonly number[])]);
      alt.polygons.set(layer, list);
    }
  }
  const self: TileSetAtlasSource = {
    texture: (properties.get('texture') ?? null) as Texture | null,
    margins: record(properties.get('margins')),
    separation: record(properties.get('separation')),
    regionSize: properties.has('texture_region_size') ? record(properties.get('texture_region_size')) : vector2i(16, 16),
    tiles,
  };
  SOURCES.add(self);
  return self;
}

/**
 * A TileSet of the properties a scene stores.
 *
 * @godot TileSet (protocol)
 * @source scene/resources/2d/tile_set.cpp:3960
 */
export function godot_tile_set_new(properties: ReadonlyMap<string, unknown>): TileSet {
  const self: TileSet = {
    tileSize: properties.has('tile_size') ? record(properties.get('tile_size')) : vector2i(16, 16),
    physicsLayers: new Map(),
    sources: new Map(),
  };
  SETS.add(self);
  for (const [name, value] of properties) {
    const source = /^sources\/(\d+)$/u.exec(name);
    if (source !== null && value !== null && SOURCES.has(value as object)) self.sources.set(Number(source[1]), value as TileSetAtlasSource);
    const physics = /^physics_layer_(\d+)\/(collision_layer|collision_mask)$/u.exec(name);
    if (physics !== null) {
      const layer = Number(physics[1]);
      const entry = self.physicsLayers.get(layer) ?? { layer: 1, mask: 1 };
      if (physics[2] === 'collision_layer') entry.layer = Number(value);
      else entry.mask = Number(value);
      self.physicsLayers.set(layer, entry);
    }
    if (/^physics_layer_(\d+)\//u.test(name) && physics === null) {
      const layer = Number((/^physics_layer_(\d+)\//u.exec(name) as RegExpExecArray)[1]);
      if (!self.physicsLayers.has(layer)) self.physicsLayers.set(layer, { layer: 1, mask: 1 });
    }
  }
  return self;
}

/**
 * @godot TileSet.TileSet
 * @source scene/resources/2d/tile_set.cpp:4440
 */
export function construct(): TileSet {
  return godot_tile_set_new(new Map());
}

/**
 * @godot TileSet.get_tile_size
 * @source scene/resources/2d/tile_set.cpp:190
 */
export function get_tile_size(self: TileSet): Vector2i {
  return self.tileSize;
}

/**
 * @godot TileSet.set_tile_size
 * @source scene/resources/2d/tile_set.cpp:180
 */
export function set_tile_size(self: TileSet, size: Vector2i): void {
  self.tileSize = size;
}

/**
 * @godot TileSet.get_physics_layers_count
 * @source scene/resources/2d/tile_set.cpp:760
 */
export function get_physics_layers_count(self: TileSet): number {
  return self.physicsLayers.size;
}

/**
 * @godot TileSet.has_source
 * @source scene/resources/2d/tile_set.cpp:540
 */
export function has_source(self: TileSet, source_id: number): boolean {
  return self.sources.has(source_id);
}

/**
 * @godot TileSet.get_source_count
 * @source scene/resources/2d/tile_set.cpp:544
 */
export function get_source_count(self: TileSet): number {
  return self.sources.size;
}
