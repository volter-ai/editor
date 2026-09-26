/**
 * read/grid-map.ts — a Godot 3 `GridMap`'s packed `data.cells` → the placements it stands for.
 *
 * A `.tscn` that authors a tile level writes ONE property for the whole thing:
 *
 *     [node name="GridMap" type="GridMap" parent="."]
 *     mesh_library = ExtResource( 1 )
 *     cell_scale = 1.001
 *     data = { "cells": PoolIntArray( 3, 0, 1048584, 12, 0, 1441800, … ) }
 *
 * Nothing else in the document says where a tile is, which tile it is, or which way it faces:
 * 2,598 placements in `stage/stage.tscn` are 7,794 integers and a `MeshLibrary` reference. Without
 * this module a level built the way Godot's own 3D platformer demo builds its whole world is a
 * node the lane can read the existence of and nothing more.
 *
 * ## This is a TRANSCRIPTION, not an interpretation
 *
 * Every rule below is Godot 3.6's own, from `modules/gridmap/grid_map.cpp` and `grid_map.h` at
 * 3.6-stable (`de2f0f147`), and from `core/math/basis.cpp`:
 *
 *  - **the triple.** `GridMap::_set` (grid_map.cpp:50–63) reads `data.cells` three ints at a time:
 *    `ik.key = decode_uint64((const uint8_t *)&r[i * 3])` over the FIRST TWO, and
 *    `cell.cell = decode_uint32((const uint8_t *)&r[i * 3 + 2])` over the third. Both decodes are
 *    LITTLE-ENDIAN reads over the ints' own memory, which is why {@link readGridMapCells} goes
 *    through a `DataView` rather than doing arithmetic on the ints: `key = lo + hi * 2^32` gives
 *    the same answer only while every int is non-negative, and a cell at a negative `y` makes the
 *    first int negative.
 *  - **the key.** `union IndexKey` (grid_map.h:52–65) overlays that `uint64_t` with
 *    `{ int16_t x; int16_t y; int16_t z; }` — so x is bits 0–15, y is 16–31, z is 32–47, each
 *    SIGNED, and bits 48–63 are unused. The fixture reaches x = -2 and y = -1, so reading them
 *    unsigned would put two thousand tiles at x = 65534.
 *  - **the value.** `union Cell` (grid_map.h:70–86) overlays the `uint32_t` with
 *    `{ unsigned int item : 16; unsigned int rot : 5; unsigned int layer : 8; }` — item in bits
 *    0–15, orientation in bits 16–20, layer in bits 21–28.
 *  - **the placement.** `GridMap::get_meshes` (grid_map.cpp:1055–1088) and `_octant_update`
 *    (521–530) compose the SAME transform, statement for statement:
 *
 *        xform.basis.set_orthogonal_index(c.rot);
 *        xform.set_origin(cellpos * cell_size + ofs);
 *        xform.basis.scale(Vector3(cell_scale, cell_scale, cell_scale));
 *
 *    with `ofs = _get_offset()` (1091–1096) being `cell_size * 0.5` on each axis the map centres
 *    (`center_x`/`y`/`z`, all `true` by default — the constructor at 1218–1240). Note the ORDER:
 *    the origin is set before the basis is scaled, so `cell_scale` scales the tile and never its
 *    position. The same 1055–1088 expression is what `map_to_world` (424–431) computes for the
 *    origin alone.
 *  - **the orientation.** `Basis::set_orthogonal_index` (basis.cpp:856–861) is a lookup into the
 *    private 24-entry `_ortho_bases` table (basis.cpp:802–827) — the 24 rotations that map a cube
 *    onto itself. {@link GODOT_ORTHOGONAL_BASES} is that table transposed into COLUMN vectors (the
 *    images of the unit axes), because Godot stores a `Basis` as rows and three's `Matrix4.set`
 *    takes rows while its `makeBasis` takes columns — a convention a reader is free to get wrong
 *    in a way that transposes every rotation in the level and still renders something.
 *
 * The table and the composition are both checked against Godot 3.6 itself:
 * `test/ground-truth/probe-gridmap.gd` recovers `_ortho_bases` through the engine's own bound
 * inverse (`Basis.get_orthogonal_index`) and dumps `GridMap.get_meshes()`'s composed transform for
 * every one of the 2,598 cells; the generated native fixture preserves the complete array.
 *
 * ## What it refuses
 *
 * The anti-shim rule applies here the way it applies to geometry: a level decoded with the wrong
 * key layout still renders, as a plausible pile of tiles nobody authored. So this module throws on
 * a `cells` array whose length is not a multiple of three (Godot's own `ERR_FAIL_COND_V(amount %
 * 3, false)`), on an orientation outside the 24 the engine has bases for (Godot's
 * `ERR_FAIL_INDEX`), and on a key whose unused top 16 bits are set — which is not a Godot check,
 * but is the exact signature of a triple read at the wrong offset.
 */

import type { GodotValue } from './godot-value';

/** One decoded cell: where it is, which `MeshLibrary` item fills it, and how it is turned. */
export interface GridMapCell {
  /** Cell coordinates. Signed 16-bit by construction — see `union IndexKey`. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** The `MeshLibrary` item id. */
  readonly item: number;
  /** An index into {@link GODOT_ORTHOGONAL_BASES}, 0–23. */
  readonly orientation: number;
  /** `Cell.layer`. Godot 3.6 writes 0 for every cell a `GridMap` authors; carried so a document
   *  that does not is visible rather than silently flattened. */
  readonly layer: number;
}

/** A `Vector3`, in the plain shape the rest of this package uses. */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Godot 3.6's `_ortho_bases` (`core/math/basis.cpp:802–827`), as the images of the unit axes.
 *
 * Row `i` of this table is `[xImage, yImage, zImage]` for orientation index `i`: `xImage` is where
 * the basis sends `(1, 0, 0)`. Godot's own table lists each basis by ROWS
 * (`Basis(xx, xy, xz, yx, …)`, and `elements[0]` is the first row), so entry `i`'s `xImage` here is
 * the first COLUMN of Godot's entry `i` — transposed once, in one place, with the transpose stated.
 *
 * All 24 are recovered from the engine in `test/ground-truth/godot36-gridmap.json` and compared
 * entry by entry in the generated fixture; this table is never the only witness to itself.
 *
 * ONE other copy exists in the repo and it is deliberate: `GODOT_ORTHO_BASES` in
 * `packages/gd-analyze/capabilities/catalog/project-source/src/lib/godot-compat/basis.ts`, the RUNTIME's. The two
 * cannot be one table — this is the compiler, and the translator must not import capability
 * source, because a user's port owns and edits its copied `src/lib/godot-compat/`. Same numbers,
 * same column convention, each citing the other. Do not add a third: the runtime's four consumers
 * (`Basis.get_orthogonal_index`, `set_orthogonal_index`, the GridMap runtime paint and the
 * authored-`data.cells` bake) were three separate tables until 2026-08-20, and the copies had
 * silently come to mean different index spaces.
 */
export const GODOT_ORTHOGONAL_BASES: readonly (readonly [Vec3, Vec3, Vec3])[] = [
  // Godot: Basis(1, 0, 0, 0, 1, 0, 0, 0, 1)
  [v(1, 0, 0), v(0, 1, 0), v(0, 0, 1)],
  // Basis(0, -1, 0, 1, 0, 0, 0, 0, 1)
  [v(0, 1, 0), v(-1, 0, 0), v(0, 0, 1)],
  // Basis(-1, 0, 0, 0, -1, 0, 0, 0, 1)
  [v(-1, 0, 0), v(0, -1, 0), v(0, 0, 1)],
  // Basis(0, 1, 0, -1, 0, 0, 0, 0, 1)
  [v(0, -1, 0), v(1, 0, 0), v(0, 0, 1)],
  // Basis(1, 0, 0, 0, 0, -1, 0, 1, 0)
  [v(1, 0, 0), v(0, 0, 1), v(0, -1, 0)],
  // Basis(0, 0, 1, 1, 0, 0, 0, 1, 0)
  [v(0, 1, 0), v(0, 0, 1), v(1, 0, 0)],
  // Basis(-1, 0, 0, 0, 0, 1, 0, 1, 0)
  [v(-1, 0, 0), v(0, 0, 1), v(0, 1, 0)],
  // Basis(0, 0, -1, -1, 0, 0, 0, 1, 0)
  [v(0, -1, 0), v(0, 0, 1), v(-1, 0, 0)],
  // Basis(1, 0, 0, 0, -1, 0, 0, 0, -1)
  [v(1, 0, 0), v(0, -1, 0), v(0, 0, -1)],
  // Basis(0, 1, 0, 1, 0, 0, 0, 0, -1)
  [v(0, 1, 0), v(1, 0, 0), v(0, 0, -1)],
  // Basis(-1, 0, 0, 0, 1, 0, 0, 0, -1)
  [v(-1, 0, 0), v(0, 1, 0), v(0, 0, -1)],
  // Basis(0, -1, 0, -1, 0, 0, 0, 0, -1)
  [v(0, -1, 0), v(-1, 0, 0), v(0, 0, -1)],
  // Basis(1, 0, 0, 0, 0, 1, 0, -1, 0)
  [v(1, 0, 0), v(0, 0, -1), v(0, 1, 0)],
  // Basis(0, 0, -1, 1, 0, 0, 0, -1, 0)
  [v(0, 1, 0), v(0, 0, -1), v(-1, 0, 0)],
  // Basis(-1, 0, 0, 0, 0, -1, 0, -1, 0)
  [v(-1, 0, 0), v(0, 0, -1), v(0, -1, 0)],
  // Basis(0, 0, 1, -1, 0, 0, 0, -1, 0)
  [v(0, -1, 0), v(0, 0, -1), v(1, 0, 0)],
  // Basis(0, 0, 1, 0, 1, 0, -1, 0, 0)
  [v(0, 0, -1), v(0, 1, 0), v(1, 0, 0)],
  // Basis(0, -1, 0, 0, 0, 1, -1, 0, 0)
  [v(0, 0, -1), v(-1, 0, 0), v(0, 1, 0)],
  // Basis(0, 0, -1, 0, -1, 0, -1, 0, 0)
  [v(0, 0, -1), v(0, -1, 0), v(-1, 0, 0)],
  // Basis(0, 1, 0, 0, 0, -1, -1, 0, 0)
  [v(0, 0, -1), v(1, 0, 0), v(0, -1, 0)],
  // Basis(0, 0, 1, 0, -1, 0, 1, 0, 0)
  [v(0, 0, 1), v(0, -1, 0), v(1, 0, 0)],
  // Basis(0, 1, 0, 0, 0, 1, 1, 0, 0)
  [v(0, 0, 1), v(1, 0, 0), v(0, 1, 0)],
  // Basis(0, 0, -1, 0, 1, 0, 1, 0, 0)
  [v(0, 0, 1), v(0, 1, 0), v(-1, 0, 0)],
  // Basis(0, -1, 0, 0, 0, -1, 1, 0, 0)
  [v(0, 0, 1), v(-1, 0, 0), v(0, -1, 0)],
];

function v(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

/** Godot 3.6's `GridMap()` constructor defaults (grid_map.cpp:1218–1240). A `.tscn` that does not
 *  write one of these properties means exactly this value. */
export const GRID_MAP_DEFAULTS = {
  /** `cell_size = Vector3(2, 2, 2)`. */
  cellSize: v(2, 2, 2),
  /** `cell_scale = 1.0`. */
  cellScale: 1,
  /** `center_x`/`center_y`/`center_z`, all `true`. */
  center: { x: true, y: true, z: true },
  /** `octant_size = 8`, exposed as `cell_octant_size`. */
  octantSize: 8,
} as const;

/** Thrown by this module. A `GridMap` this reader cannot read is loud, never partially decoded. */
export class GridMapReadError extends Error {
  constructor(
    readonly at: string,
    message: string,
  ) {
    super(`${at}: ${message}`);
    this.name = 'GridMapReadError';
  }
}

/**
 * The Variant array type a `GridMap`'s `data.cells` is written as, in each dialect Godot spells it.
 *
 * Godot 4 renamed the packed-array family (`PoolIntArray` → `PackedInt32Array`) and changed NOTHING
 * else about this payload, which is the whole finding: the same demo level, read out of Godot 3's
 * text `.tscn` and out of Godot 4's BINARY `.scn`, decodes through the identical code below to
 * identical cell records — same (key-low, key-high, value) stride, same `union IndexKey` overlay,
 * same 16/5/8 split of `CellData`. Measured on the two `platformer-3d` fixtures: 2,598 cells against
 * 2,616 (the Godot 4 port of the demo edits eighteen tiles), both using MeshLibrary items 1–17 and
 * exactly the orientations {0, 10, 16, 20, 22} out of the 24 orthogonal bases, every layer zero, and
 * not one triple tripping the "bits 48–63 of the key are set" guard below — which is precisely the
 * guard that would fire first if the stride or the key layout had moved.
 *
 * So this is a NAME, and both names are listed rather than either being normalized away: a document
 * that writes something else is still refused loudly, naming what it wrote.
 */
const CELLS_ARRAY_TYPES: ReadonlySet<string> = new Set(['PoolIntArray', 'PackedInt32Array']);

/**
 * `data = { "cells": PoolIntArray( … ) }` (Godot 4: `PackedInt32Array`) → the cells it packs.
 *
 * The value handed in is the whole `data` dictionary as the reader parsed it — from a text `.tscn`
 * or from a binary `.scn`, which produce the same value shape — because `cells` is the only key
 * Godot writes and a document carrying a second one is a fact the caller should see rather than a
 * key this function silently ignored.
 */
export function readGridMapCells(data: GodotValue | undefined, at: string): readonly GridMapCell[] {
  if (data?.kind !== 'dict') {
    throw new GridMapReadError(
      at,
      'a GridMap whose `data` is not a dictionary. Godot writes `data = { "cells": PoolIntArray( … ) }`; a node with no readable cells is a level this stage would render empty.',
    );
  }
  const extra = data.entries.filter((entry) => entry.key !== 'cells').map((entry) => entry.key);
  if (extra.length > 0) {
    throw new GridMapReadError(
      at,
      `a GridMap whose \`data\` carries ${extra.map((key) => `\`${key}\``).join(', ')} beside ` +
        '`cells`. Godot 3.6 writes only `cells` (`GridMap::_get`, grid_map.cpp:96–115); a key ' +
        'this reader does not know the meaning of is not one it may drop.',
    );
  }
  const cells = data.entries.find((entry) => entry.key === 'cells')?.value;
  if (cells === undefined) {
    throw new GridMapReadError(at, 'a GridMap whose `data` declares no `cells`');
  }
  if (cells.kind !== 'ctor' || !CELLS_ARRAY_TYPES.has(cells.name)) {
    throw new GridMapReadError(
      at,
      `a GridMap whose \`data.cells\` is \`${cells.kind === 'ctor' ? cells.name : cells.kind}\`, ` +
        `not one of ${[...CELLS_ARRAY_TYPES].map((name) => `\`${name}\``).join(' / ')}`,
    );
  }
  const ints = cells.args.map((arg) => {
    if (arg.kind !== 'number') {
      throw new GridMapReadError(at, `a \`data.cells\` ${cells.name} holding a non-number`);
    }
    return arg.value;
  });
  // Godot's own check: `ERR_FAIL_COND_V(amount % 3, false)` (grid_map.cpp:54).
  if (ints.length % 3 !== 0) {
    throw new GridMapReadError(
      at,
      `a \`data.cells\` PoolIntArray of ${ints.length} ints, which is not a multiple of three. ` +
        'Godot reads it as (key-low, key-high, value) triples and refuses the same way.',
    );
  }

  // ONE eight-byte window, written as two little-endian int32s and read back as three int16s —
  // which is `decode_uint64` over `&r[i * 3]` overlaid with `union IndexKey`, done as memory
  // rather than as arithmetic. See this module's header for why arithmetic is not equivalent.
  const view = new DataView(new ArrayBuffer(8));
  const out: GridMapCell[] = [];
  for (let i = 0; i < ints.length; i += 3) {
    view.setInt32(0, ints[i] as number, true);
    view.setInt32(4, ints[i + 1] as number, true);
    const unused = view.getUint16(6, true);
    if (unused !== 0) {
      throw new GridMapReadError(
        at,
        `cell triple ${i / 3} has bits 48–63 of its key set (0x${unused.toString(16)}). ` +
          '`union IndexKey` uses only x, y and z, so a non-zero top word means the triples are ' +
          'being read at the wrong offset — which would place every tile in the level plausibly ' +
          'and wrongly.',
      );
    }
    const value = (ints[i + 2] as number) >>> 0;
    const orientation = (value >>> 16) & 0x1f;
    if (orientation >= GODOT_ORTHOGONAL_BASES.length) {
      // Unreachable through a five-bit field only because the table has 24 of 32 possible values;
      // Godot's own `set_orthogonal_index` fails the index rather than rotating by nothing.
      throw new GridMapReadError(
        at,
        `cell triple ${i / 3} carries orientation ${orientation}, and Godot has only ` +
          `${GODOT_ORTHOGONAL_BASES.length} orthogonal bases (\`Basis::set_orthogonal_index\` ` +
          'fails the index)',
      );
    }
    out.push({
      x: view.getInt16(0, true),
      y: view.getInt16(2, true),
      z: view.getInt16(4, true),
      item: value & 0xffff,
      orientation,
      layer: (value >>> 21) & 0xff,
    });
  }
  return out;
}

/** A `GridMap`'s own settings, as the placement arithmetic needs them. */
export interface GridMapSettings {
  readonly cellSize: Vec3;
  readonly cellScale: number;
  readonly center: { readonly x: boolean; readonly y: boolean; readonly z: boolean };
}

/**
 * `GridMap::_get_offset()` (grid_map.cpp:1091–1096): half a cell on every axis the map centres.
 */
export function gridMapOffset(settings: GridMapSettings): Vec3 {
  return v(
    settings.cellSize.x * 0.5 * (settings.center.x ? 1 : 0),
    settings.cellSize.y * 0.5 * (settings.center.y ? 1 : 0),
    settings.cellSize.z * 0.5 * (settings.center.z ? 1 : 0),
  );
}

/**
 * `GridMap::map_to_world` (grid_map.cpp:424–431) — a cell coordinate's world ORIGIN, which is the
 * same expression `get_meshes`/`_octant_update` set on the placement transform.
 */
export function gridMapCellOrigin(
  cell: { x: number; y: number; z: number },
  settings: GridMapSettings,
): Vec3 {
  const offset = gridMapOffset(settings);
  return v(
    cell.x * settings.cellSize.x + offset.x,
    cell.y * settings.cellSize.y + offset.y,
    cell.z * settings.cellSize.z + offset.z,
  );
}

/** One cell's world placement: where the tile sits, and the three columns of its basis. */
export interface GridMapPlacement {
  readonly origin: Vec3;
  /** The images of `(1,0,0)`, `(0,1,0)` and `(0,0,1)` — the basis COLUMNS, `cell_scale` applied. */
  readonly basis: readonly [Vec3, Vec3, Vec3];
}

/**
 * `GridMap::get_meshes`'s composed transform for one cell (grid_map.cpp:1073–1085), including the
 * ORDER that matters: the origin is set from the unscaled cell coordinate, and `cell_scale` scales
 * the basis afterwards. A `cell_scale` folded into the origin would spread the level apart by
 * 0.1% per cell — 40 cells out, four centimetres of gap where Godot has none.
 *
 * `Basis::scale` multiplies each ROW by the matching component (basis.cpp), which for the uniform
 * scale a `GridMap` applies is every entry — so it is the columns here, equivalently.
 */
export function gridMapPlacement(cell: GridMapCell, settings: GridMapSettings): GridMapPlacement {
  const basis = GODOT_ORTHOGONAL_BASES[cell.orientation];
  if (basis === undefined) {
    throw new GridMapReadError(
      'grid-map',
      `orientation ${cell.orientation} has no orthogonal basis`,
    );
  }
  const s = settings.cellScale;
  return {
    origin: gridMapCellOrigin(cell, settings),
    basis: [
      v(basis[0].x * s, basis[0].y * s, basis[0].z * s),
      v(basis[1].x * s, basis[1].y * s, basis[1].z * s),
      v(basis[2].x * s, basis[2].y * s, basis[2].z * s),
    ],
  };
}
