import { registerGodotObjectIdentity } from './object';
import { bindGodotResourceProtocol, godotResourceEmitChanged } from './resource-io';

export interface TileMapPatternVector2i {
  readonly x: number;
  readonly y: number;
}

export interface TileMapPatternCell {
  readonly coords: TileMapPatternVector2i;
  readonly sourceId: number;
  readonly atlasCoords: TileMapPatternVector2i;
  readonly alternativeTile: number;
}

/** Serialized Godot 4 `TileMapPattern.tile_data` words, retained until compat decodes them. */
export interface AuthoredTileMapPatternPayload {
  readonly values: readonly number[];
}

const INVALID_COORDS: TileMapPatternVector2i = { x: -1, y: -1 };

function integer(value: number, at: string): number {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${at} must be an integer.`);
  return value;
}

function coords(value: TileMapPatternVector2i, at: string): TileMapPatternVector2i {
  if (value === null || typeof value !== 'object') throw new TypeError(`${at} must be Vector2i.`);
  return { x: integer(value.x, `${at}.x`), y: integer(value.y, `${at}.y`) };
}

function copy(value: TileMapPatternVector2i): TileMapPatternVector2i {
  return { x: value.x, y: value.y };
}

function key(value: TileMapPatternVector2i): string {
  return `${String(value.x)},${String(value.y)}`;
}

function signed16(value: number): number {
  const word = value & 0xffff;
  return word >= 0x8000 ? word - 0x10000 : word;
}

/**
 * Decode Godot 4's `_tile_data` storage contract. Each cell is exactly three little-endian
 * 32-bit words: packed pattern coordinates; source id + atlas x; atlas y + alternative id.
 */
export function decodeAuthoredTileMapPattern(
  payload: AuthoredTileMapPatternPayload,
): TileMapPatternCell[] {
  if (!Array.isArray(payload.values)) {
    throw new TypeError('TileMapPattern.tile_data must be a PackedInt32Array payload.');
  }
  if (payload.values.length % 3 !== 0) {
    throw new Error(
      `TileMapPattern.tile_data has ${String(payload.values.length)} words; records require multiples of 3.`,
    );
  }
  const cells: TileMapPatternCell[] = [];
  for (let index = 0; index < payload.values.length; index += 3) {
    const packedCoords = integer(payload.values[index]!, 'TileMapPattern.tile_data coordinates') >>> 0;
    const packedSourceAtlasX = integer(payload.values[index + 1]!, 'TileMapPattern.tile_data source/atlas_x') >>> 0;
    const packedAtlasYAlternative = integer(payload.values[index + 2]!, 'TileMapPattern.tile_data atlas_y/alternative') >>> 0;
    const cell = {
      coords: { x: signed16(packedCoords), y: signed16(packedCoords >>> 16) },
      sourceId: packedSourceAtlasX & 0xffff,
      atlasCoords: {
        x: packedSourceAtlasX >>> 16,
        y: packedAtlasYAlternative & 0xffff,
      },
      alternativeTile: packedAtlasYAlternative >>> 16,
    };
    if (cell.coords.x < 0 || cell.coords.y < 0) {
      throw new Error('TileMapPattern.tile_data contains a negative pattern coordinate.');
    }
    cells.push(cell);
  }
  return cells;
}

/** Godot 4 TileMapPattern Resource: a sparse, origin-relative set of exact tile identities. */
export class GodotTileMapPattern {
  private readonly liveCells = new Map<string, TileMapPatternCell>();
  private liveSize: TileMapPatternVector2i = { x: 0, y: 0 };

  constructor(cells: readonly TileMapPatternCell[] = []) {
    for (const cell of cells) this.writeCell(cell);
    this.recalculateSize();
    registerGodotObjectIdentity(this, 'TileMapPattern');
    bindGodotResourceProtocol(this, {
      createDuplicate(source) {
        return new GodotTileMapPattern(source.cells()) as typeof source;
      },
    });
  }

  set_cell(
    value: TileMapPatternVector2i,
    sourceId = -1,
    atlasCoords: TileMapPatternVector2i = INVALID_COORDS,
    alternativeTile = -1,
  ): void {
    const at = coords(value, 'TileMapPattern.coords');
    if (at.x < 0 || at.y < 0) throw new RangeError('TileMapPattern.set_cell coords must be non-negative.');
    this.writeCell({
      coords: at,
      sourceId: integer(sourceId, 'TileMapPattern.source_id'),
      atlasCoords: coords(atlasCoords, 'TileMapPattern.atlas_coords'),
      alternativeTile: integer(alternativeTile, 'TileMapPattern.alternative_tile'),
    });
    this.growSizeToContain(at);
    godotResourceEmitChanged(this);
  }

  remove_cell(value: TileMapPatternVector2i, updateSize: boolean): void {
    if (typeof updateSize !== 'boolean') throw new TypeError('TileMapPattern.remove_cell update_size requires bool.');
    const at = coords(value, 'TileMapPattern.coords');
    if (!this.liveCells.delete(key(at))) {
      throw new Error(`TileMapPattern.remove_cell has no cell at (${String(at.x)}, ${String(at.y)}).`);
    }
    if (updateSize) this.recalculateSize();
    godotResourceEmitChanged(this);
  }

  has_cell(value: TileMapPatternVector2i): boolean {
    return this.liveCells.has(key(coords(value, 'TileMapPattern.coords')));
  }

  is_empty(): boolean { return this.liveCells.size === 0; }

  get_cell_source_id(value: TileMapPatternVector2i): number {
    return this.liveCells.get(key(coords(value, 'TileMapPattern.coords')))?.sourceId ?? -1;
  }

  get_cell_atlas_coords(value: TileMapPatternVector2i): TileMapPatternVector2i {
    return copy(this.liveCells.get(key(coords(value, 'TileMapPattern.coords')))?.atlasCoords ?? INVALID_COORDS);
  }

  get_cell_alternative_tile(value: TileMapPatternVector2i): number {
    return this.liveCells.get(key(coords(value, 'TileMapPattern.coords')))?.alternativeTile ?? -1;
  }

  get_used_cells(): TileMapPatternVector2i[] {
    return [...this.liveCells.values()].map((cell) => copy(cell.coords));
  }

  get_size(): TileMapPatternVector2i { return copy(this.liveSize); }

  set_size(value: TileMapPatternVector2i): void {
    const next = coords(value, 'TileMapPattern.size');
    for (const cell of this.liveCells.values()) {
      if (cell.coords.x >= next.x || cell.coords.y >= next.y) {
        throw new RangeError('TileMapPattern.set_size cannot exclude a retained cell.');
      }
    }
    this.liveSize = next;
    godotResourceEmitChanged(this);
  }

  cells(): TileMapPatternCell[] {
    return [...this.liveCells.values()].map((cell) => ({
      coords: copy(cell.coords),
      sourceId: cell.sourceId,
      atlasCoords: copy(cell.atlasCoords),
      alternativeTile: cell.alternativeTile,
    }));
  }

  private writeCell(value: TileMapPatternCell): void {
    const at = coords(value.coords, 'TileMapPattern.coords');
    if (at.x < 0 || at.y < 0) throw new RangeError('TileMapPattern cell coords must be non-negative.');
    this.liveCells.set(key(at), {
      coords: at,
      sourceId: integer(value.sourceId, 'TileMapPattern.source_id'),
      atlasCoords: coords(value.atlasCoords, 'TileMapPattern.atlas_coords'),
      alternativeTile: integer(value.alternativeTile, 'TileMapPattern.alternative_tile'),
    });
  }

  private growSizeToContain(value: TileMapPatternVector2i): void {
    this.liveSize = { x: Math.max(this.liveSize.x, value.x + 1), y: Math.max(this.liveSize.y, value.y + 1) };
  }

  private recalculateSize(): void {
    this.liveSize = { x: 0, y: 0 };
    for (const cell of this.liveCells.values()) this.growSizeToContain(cell.coords);
  }
}

export function createTileMapPattern(
  payload?: AuthoredTileMapPatternPayload,
): GodotTileMapPattern {
  return new GodotTileMapPattern(payload === undefined ? [] : decodeAuthoredTileMapPattern(payload));
}
