/**
 * A face-culled surface mesh for a dense grid of cubic cells, as one real `THREE.BufferGeometry`.
 *
 * A game that stores its world as a grid of cubes — terrain a player digs, a builder's block
 * palette, a level authored as a 3D tilemap — cannot draw a `BoxGeometry` per cell: a modest
 * 80×7×80 volume is 44 800 boxes, and the ones buried inside the solid are invisible forever. The
 * fix is a single surface built from only the faces that touch an empty neighbour. That is what
 * this file is, and it is the whole of it.
 *
 * ## It is a HELPER, not a wrapper
 *
 * `buildVoxelSurface` takes plain arrays and hands back three's own `BufferGeometry`. Every call
 * after it is three's API — pick your own material, wrap it in a `Mesh` or an `InstancedMesh`,
 * `.translate()` it, hand it to Rapier's trimesh collider. Nothing here holds a scene, a camera, a
 * frame loop or a cache, and nothing here is a class you inherit from.
 *
 * ## The rung audit that put ~200 lines here instead of a dependency (2026-08-14)
 *
 * Checked against the npm registry on the day this landed, not from memory:
 *
 *  - **`voxel-mesh` 0.3.0** (voxel.js) — last publish **2013-06-13**. Its `index.js` builds a
 *    `THREE.Geometry` out of `THREE.Face3`, both REMOVED from three in r125. It cannot run against
 *    this repo's three at all.
 *  - **`voxel-mesher` 0.14.4** (2016-03-26) and **`greedy-mesher` 1.0.3** (2016-02-12) — the
 *    voxel.js meshing pair. Both are `ndarray`-shaped, untyped, and stop at a list of quads: the
 *    `BufferGeometry` is still yours to write. `voxel-mesher` additionally pulls a WebGL1 buffer
 *    stack (`gl-buffer`, `gl-vao`) that has nothing to do with three.
 *  - **`voxel-engine` 0.20.2** (2015-04-11) — a whole game framework (20 dependencies, its own
 *    camera, controls and physics). The thing this rule bans.
 *  - **`@voxelize/core` 3.0.0** (2026-08-03) — the one MAINTAINED option, and the one to say no to
 *    deliberately. It is a client for a multiplayer voxel platform: `socket.io-client`, its own
 *    wire protocol, its own physics engine and a WASM mesher fed by its own chunk/world objects.
 *    You do not call its mesher; you build your game inside it. Adopting it to draw a static grid
 *    would put a platform between the game and three.
 *
 * So: every maintained option is an ENGINE you build inside, and every option that is a helper died
 * with voxel.js a decade ago against a three that no longer exists. The general shape *is* ready —
 * "cull the hidden faces of a dense grid" has been settled since 2012 — it is the packaging that is
 * not. Hence a helper here, in host vocabulary, that hands back three's own object.
 *
 * ## What is deliberately NOT here
 *
 * **Greedy meshing.** Merging coplanar same-type faces into larger quads is the standard next step
 * and it does not fall out of this one: it needs a per-slice sweep with its own visited mask and
 * its own bugs, and it changes the vertex↔cell relationship that per-face culling keeps exact.
 * Per-face culling already removes the interior, which is the order-of-magnitude win. Add greedy
 * meshing the day a measured frame budget asks for it, as its own function beside this one.
 *
 * **Lighting, ambient occlusion, textures, atlases, transparency sorting and chunking.** Each is a
 * real decision a game makes for itself; this returns geometry and gets out of the way.
 */
import { BufferAttribute, BufferGeometry, Color } from 'three';

/**
 * A dense grid of cubic cells.
 *
 * `cells` is indexed **Y-major, then Z, then X** — `((y * sizeZ) + z) * sizeX + x`. Y outermost is
 * the ordering that makes each horizontal LAYER contiguous, which is what lets a mostly-flat world
 * ship as a handful of runs (see {@link expandVoxelRuns}) instead of a megabyte of literals.
 */
export interface VoxelVolume {
  /** Cell counts along X, Y and Z. */
  readonly size: readonly [number, number, number];
  /** `sizeX * sizeY * sizeZ` type ids. `0` is empty unless {@link VoxelSurfaceOptions.emptyType}. */
  readonly cells: ArrayLike<number>;
  /** World position of the volume's minimum corner. Defaults to the origin. */
  readonly origin?: readonly [number, number, number];
  /** World edge length of one cell. Defaults to 1. */
  readonly cellSize?: number;
}

export interface VoxelSurfaceOptions {
  /**
   * Type id → `0xRRGGBB`, written into the geometry's `color` attribute. Supply it and the mesh
   * draws with `vertexColors: true` in one draw call; omit it and the geometry carries no colour
   * attribute at all. A solid type absent from the map is an ERROR, not a silent default: a
   * missing colour is the shape of a forgotten row, and a mesh that quietly paints it white looks
   * like a lighting bug three files away.
   */
  readonly colors?: ReadonlyMap<number, number>;
  /** The type id that means "no cell here". Defaults to `0`. */
  readonly emptyType?: number;
  /**
   * Whether cells just outside the volume count as solid. `false` (the default) walls the volume
   * in — the right answer for a standalone model. `true` leaves the boundary open, which is what a
   * chunk meshed beside its neighbours wants.
   */
  readonly closedBoundary?: boolean;
}

export interface VoxelSurface {
  /** Indexed, with `position`, `normal` and (when colours were supplied) `color`. */
  readonly geometry: BufferGeometry;
  /** Faces that survived culling. `vertices` is `4 ×` this, `triangles` `2 ×`. */
  readonly quads: number;
  readonly vertices: number;
  readonly triangles: number;
  /** Cells whose type is not the empty type — the input's own size, for a sanity check. */
  readonly solidCells: number;
  /** Faces contributed per type id, in ascending id order. */
  readonly quadsByType: ReadonlyMap<number, number>;
}

export class VoxelSurfaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VoxelSurfaceError';
  }
}

/**
 * The six faces of the unit cell, each as four corners in counter-clockwise order seen from
 * OUTSIDE — which is the winding three's default `FrontSide` draws.
 */
const FACES: readonly {
  readonly normal: readonly [number, number, number];
  readonly corners: readonly (readonly [number, number, number])[];
}[] = [
  {
    normal: [1, 0, 0],
    corners: [
      [1, 0, 1],
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
    ],
  },
  {
    normal: [-1, 0, 0],
    corners: [
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
    ],
  },
  {
    normal: [0, 1, 0],
    corners: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0],
    ],
  },
  {
    normal: [0, -1, 0],
    corners: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
  },
  {
    normal: [0, 0, 1],
    corners: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
  },
  {
    normal: [0, 0, -1],
    corners: [
      [1, 0, 0],
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ],
  },
];

/**
 * Expand `[count, type, count, type, …]` run pairs into a dense cell array.
 *
 * A voxel volume is enormous and almost entirely repetitive, so the compact form is what a game
 * SHIPS — in a source file, in a save, over the wire — and the dense form is what it meshes. The
 * total of the counts must be exactly `cellCount`: a short or long run list is a corrupt volume,
 * and silently padding it with empties would mesh a plausible wrong world.
 */
export function expandVoxelRuns(
  runs: ArrayLike<number>,
  cellCount: number,
): Uint16Array | Uint32Array {
  if (runs.length % 2 !== 0) {
    throw new VoxelSurfaceError(
      `a run list is [count, type] pairs, so its length must be even; got ${runs.length}`,
    );
  }
  let widest = 0;
  let total = 0;
  for (let pair = 0; pair < runs.length; pair += 2) {
    const count = runs[pair] as number;
    if (!Number.isInteger(count) || count <= 0) {
      throw new VoxelSurfaceError(`run ${pair / 2} has a count of ${count}; counts are positive`);
    }
    total += count;
    widest = Math.max(widest, runs[pair + 1] as number);
  }
  if (total !== cellCount) {
    throw new VoxelSurfaceError(`the runs cover ${total} cells; the volume holds ${cellCount}`);
  }
  const cells = widest > 0xffff ? new Uint32Array(cellCount) : new Uint16Array(cellCount);
  let at = 0;
  for (let pair = 0; pair < runs.length; pair += 2) {
    const count = runs[pair] as number;
    cells.fill(runs[pair + 1] as number, at, at + count);
    at += count;
  }
  return cells;
}

/** The volume's size, after checking that the cell array is exactly the size it claims. */
function assertVolumeShape(volume: VoxelVolume): readonly [number, number, number] {
  const [sizeX, sizeY, sizeZ] = volume.size;
  if (sizeX <= 0 || sizeY <= 0 || sizeZ <= 0) {
    throw new VoxelSurfaceError(`a volume needs a positive size on every axis; got ${volume.size}`);
  }
  const cellCount = sizeX * sizeY * sizeZ;
  if (volume.cells.length !== cellCount) {
    throw new VoxelSurfaceError(
      `a ${sizeX}×${sizeY}×${sizeZ} volume holds ${cellCount} cells; got ${volume.cells.length}`,
    );
  }
  return [sizeX, sizeY, sizeZ];
}

/** Every array the walk appends to, so the per-cell step is a plain function. */
interface SurfaceBuffers {
  readonly positions: number[];
  readonly normals: number[];
  readonly colors: number[];
  readonly indices: number[];
  readonly quadsByType: Map<number, number>;
}

/** The linear-space vertex colour for one type, or `undefined` when colours were not asked for. */
function vertexColor(
  colors: ReadonlyMap<number, number> | undefined,
  type: number,
  where: string,
  into: Color,
): Color | undefined {
  if (colors === undefined) return undefined;
  const hex = colors.get(type);
  if (hex === undefined) {
    throw new VoxelSurfaceError(
      `no colour for type ${type}, which cell ${where} holds — every solid type in the volume ` +
        'needs a row, so a forgotten one fails here rather than drawing white',
    );
  }
  // `setHex` defaults to `SRGBColorSpace` and converts INTO the working space itself, which is
  // exactly what a material does with a colour uniform. Do not convert again on top of it: an
  // extra `convertSRGBToLinear()` here squared the conversion and drew a mid-green world in near
  // black, with every channel still plausible enough to read as a lighting problem.
  return into.setHex(hex);
}

/** Append the faces of one solid cell that face an empty neighbour. Returns how many. */
function emitCellFaces(
  buffers: SurfaceBuffers,
  cell: readonly [number, number, number],
  type: number,
  color: Color | undefined,
  solidAt: (x: number, y: number, z: number) => boolean,
  place: (x: number, y: number, z: number) => [number, number, number],
): number {
  const [x, y, z] = cell;
  let emitted = 0;
  for (const face of FACES) {
    const [nx, ny, nz] = face.normal;
    if (solidAt(x + nx, y + ny, z + nz)) continue;
    const base = buffers.positions.length / 3;
    for (const [cx, cy, cz] of face.corners) {
      buffers.positions.push(...place(x + cx, y + cy, z + cz));
      buffers.normals.push(nx, ny, nz);
      if (color !== undefined) buffers.colors.push(color.r, color.g, color.b);
    }
    buffers.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    buffers.quadsByType.set(type, (buffers.quadsByType.get(type) ?? 0) + 1);
    emitted += 1;
  }
  return emitted;
}

/**
 * Build the visible surface of a voxel volume: one indexed `BufferGeometry` carrying every face
 * that touches an empty neighbour, and nothing else.
 */
export function buildVoxelSurface(
  volume: VoxelVolume,
  options: VoxelSurfaceOptions = {},
): VoxelSurface {
  const [sizeX, sizeY, sizeZ] = assertVolumeShape(volume);
  const empty = options.emptyType ?? 0;
  const openBoundary = options.closedBoundary !== true;
  const scale = volume.cellSize ?? 1;
  const [originX, originY, originZ] = volume.origin ?? [0, 0, 0];
  const cells = volume.cells;

  const at = (x: number, y: number, z: number): number =>
    cells[(y * sizeZ + z) * sizeX + x] as number;
  const solidAt = (x: number, y: number, z: number): boolean => {
    const outsideVolume = x < 0 || y < 0 || z < 0 || x >= sizeX || y >= sizeY || z >= sizeZ;
    return outsideVolume ? !openBoundary : at(x, y, z) !== empty;
  };
  const place = (x: number, y: number, z: number): [number, number, number] => [
    originX + x * scale,
    originY + y * scale,
    originZ + z * scale,
  ];

  const buffers: SurfaceBuffers = {
    positions: [],
    normals: [],
    colors: [],
    indices: [],
    quadsByType: new Map(),
  };
  const scratch = new Color();
  let solidCells = 0;
  let quads = 0;
  for (let y = 0; y < sizeY; y += 1) {
    for (let z = 0; z < sizeZ; z += 1) {
      for (let x = 0; x < sizeX; x += 1) {
        const type = at(x, y, z);
        if (type === empty) continue;
        solidCells += 1;
        const color = vertexColor(options.colors, type, `(${x}, ${y}, ${z})`, scratch);
        quads += emitCellFaces(buffers, [x, y, z], type, color, solidAt, place);
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(buffers.positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(buffers.normals), 3));
  if (options.colors !== undefined) {
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(buffers.colors), 3));
  }
  const vertices = buffers.positions.length / 3;
  const indices =
    vertices > 0xffff ? new Uint32Array(buffers.indices) : new Uint16Array(buffers.indices);
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();

  return {
    geometry,
    quads,
    vertices,
    triangles: quads * 2,
    solidCells,
    quadsByType: new Map([...buffers.quadsByType].sort(([a], [b]) => a - b)),
  };
}
