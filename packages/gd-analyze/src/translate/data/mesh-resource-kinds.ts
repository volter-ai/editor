/**
 * translate/data/mesh-resource-kinds.ts — the bake-vs-interpret ruling per mesh-shaped resource, as
 * DATA and nothing else.
 *
 * A leaf on purpose: it imports nothing. `data/node-class-table.ts` projects its node rows from
 * this table and `data/mesh.ts` implements it, and `data/mesh.ts` reaches `data/scene3d.ts` (which
 * re-exports `node-class-table`) for `vector3Of` — so holding the table inside `mesh.ts` made
 * `mesh → scene3d → node-class-table → mesh` a real initialisation cycle. Importing `data/mesh.ts`
 * FIRST then threw `Cannot access 'MESH_RESOURCE_KINDS' before initialization`: the module was
 * unusable as an entry point, and only the emitter's own import order hid it. The table has one
 * consumer besides its implementation, so the cheapest true break is to give it its own file.
 */

/** How one mesh-shaped resource is carried. The column `data/mesh.ts` implements. */
export type MeshResourceRuling = 'bake' | 'interpret';

/** One row of the bake-vs-interpret table, as data. */
export interface MeshResourceKindRow {
  readonly ruling: MeshResourceRuling;
  /** What the bake produces, or `null` when the kind is interpreted. */
  readonly baked: string | null;
  readonly runtime: string;
}

/**
 * Bake-vs-interpret per mesh resource kind. `ruling` is the column Slice E records: a **bake**
 * becomes typed data literals a `godot-compat` builder consumes; an **interpret** stays a
 * primitive / runtime API the target already has.
 */
export const MESH_RESOURCE_KINDS = {
  ArrayMesh: {
    ruling: 'bake',
    baked: 'concatenated typed arrays; winding reversed for three',
    runtime: 'buildArrayMeshGeometry',
  },
  CubeMesh: {
    ruling: 'interpret',
    baked: null,
    runtime: 'three BoxGeometry args',
  },
  CylinderMesh: {
    ruling: 'interpret',
    baked: null,
    runtime: 'three CylinderGeometry args',
  },
  CapsuleMesh: {
    ruling: 'interpret',
    baked: null,
    runtime: 'three CapsuleGeometry args',
  },
  PrismMesh: {
    ruling: 'interpret',
    baked: null,
    runtime: 'godot-compat createPrismMesh native BufferGeometry',
  },
  MeshLibraryItemMesh: {
    ruling: 'bake',
    baked: 'same ArrayMesh typed arrays as a MeshInstance',
    runtime: 'buildArrayMeshGeometry',
  },
  MeshLibraryItemShapes: {
    ruling: 'bake',
    baked: 'ConcavePolygonShape face soups, keyed by item id',
    runtime: 'buildGridMapTrimeshColliders',
  },
  GridMapAuthored: {
    ruling: 'bake',
    baked: 'cells Int16Array + cellSize/cellScale/offset',
    runtime: 'composeGridMapPlacements + fillGridMapInstances + buildGridMapTrimeshColliders',
  },
  GridMapEmpty: {
    ruling: 'interpret',
    baked: null,
    runtime: 'bindGridMap',
  },
} as const satisfies Record<string, MeshResourceKindRow>;
