/**
 * Runtime `MeshLibrary` / `SceneState` / `GridMap` — starter-kit-city-builder
 * `builder.gd` is the measured surface.
 *
 * `_ready` (`:25-35`) builds a MeshLibrary from each `Structure.model` (a
 * `.glb` PackedScene) by walking `PackedScene.get_state()` for the first
 * `MeshInstance3D.mesh` and `duplicate()`ing it. `_process` (`:81-95`) paints
 * and clears cells with `set_cell_item` / `get_cell_item`. Orientation is
 * `get_orthogonal_index_from_basis(selector.basis)` after `rotate_y(90)`.
 *
 * ## The orientation number is Godot's 24-index, and used to be two things
 *
 * `GridMap` orientation is `Basis::get_orthogonal_index` — the same table
 * `basis.ts` owns as `GODOT_ORTHO_BASES` and the same one an authored
 * `data.cells` `rot` field indexes (`grid-map-instances.ts`). This file used to
 * carry a PRIVATE four-entry Y-turn table and have
 * {@link getOrthogonalIndexFromBasis} return 0..3 into it, on the reasoning that
 * the 4.7 dump does not spell the 24 out. That was a live bug, not a
 * simplification: the pooled `InstancedMesh` path already called
 * `basisAtOrthogonalIndex` on the SAME number, so `builder.gd:132`'s
 * `set_cell_item(cell, item, get_orthogonal_index_from_basis(selector.basis))`
 * fed a Y-turn ordinal into the 24-table — index 1 there is a 90° turn about
 * **Z**, so a rotated building came out tipped on its side. One table now, and
 * the two paths agree by construction.
 *
 * **Owns:** the MeshLibrary item map, the SceneState node list, the WeakMap
 * of GridMap cell state. **Shares:** the cloned `.glb` `Object3D` the world
 * loaded into `ctx.models`. **Teardown:** dropping the GridMap node drops
 * the WeakMap entry; tile clones are children of that node.
 */

import {
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  Object3D,
  Texture,
  Vector3 as ThreeVector3,
} from 'three';
import {
  TRANSFORM3D_IDENTITY,
  type Basis,
  basisAtOrthogonalIndex,
  basisOrthogonalIndex,
} from './basis';
import { registerGodotObjectIdentity } from './object';
import {
  bindGodotResourceProtocol,
  duplicateGodotSubresource,
  godotResourceDuplicate,
  godotResourceEmitChanged,
} from './resource-io';
import type { Transform, Vector3 } from './variant-3d';
import { vec3 } from './variant-3d';

export type MeshLibraryShape = readonly [shape: unknown, transform: Transform];

/** One complete MeshLibrary palette item from Godot's `scene/resources/mesh_library.h`. */
export interface MeshLibraryItem {
  name: string;
  mesh: Object3D | undefined;
  meshTransform: Transform;
  meshCastShadow: number;
  navigationMesh: unknown;
  navigationMeshTransform: Transform;
  navigationLayers: number;
  shapes: MeshLibraryShape[];
  preview: Texture | undefined;
}

/** Godot's `MeshLibrary` — a numbered palette. builder.gd:25-33. */
export interface MeshLibrary {
  readonly items: Map<number, MeshLibraryItem>;
}

function createMeshLibraryItem(): MeshLibraryItem {
  return {
    name: '',
    mesh: undefined,
    meshTransform: TRANSFORM3D_IDENTITY,
    meshCastShadow: 1,
    navigationMesh: null,
    navigationMeshTransform: TRANSFORM3D_IDENTITY,
    navigationLayers: 1,
    shapes: [],
    preview: undefined,
  };
}

function requireMeshLibraryId(id: number, member: string): number {
  if (!Number.isSafeInteger(id) || id < 0) {
    throw new Error(`MeshLibrary.${member} requires a non-negative integer id; received ${String(id)}.`);
  }
  return id;
}

function requireMeshLibraryItem(library: MeshLibrary, id: number, member: string): MeshLibraryItem {
  const item = library.items.get(requireMeshLibraryId(id, member));
  if (item === undefined) {
    throw new Error(`MeshLibrary.${member}(${id}) requires an existing item.`);
  }
  return item;
}

function requireMeshLibraryTransform(transform: Transform, member: string): Transform {
  if (
    transform === null || typeof transform !== 'object' ||
    !Array.isArray(transform.basis) || transform.basis.length !== 3 ||
    transform.origin === null || typeof transform.origin !== 'object'
  ) {
    throw new TypeError(`MeshLibrary.${member} requires a Transform3D value.`);
  }
  const components = [
    transform.basis[0].x, transform.basis[0].y, transform.basis[0].z,
    transform.basis[1].x, transform.basis[1].y, transform.basis[1].z,
    transform.basis[2].x, transform.basis[2].y, transform.basis[2].z,
    transform.origin.x, transform.origin.y, transform.origin.z,
  ];
  if (!components.every(Number.isFinite)) {
    throw new Error(`MeshLibrary.${member} requires a finite Transform3D value.`);
  }
  return transform;
}

function sameMeshLibraryTransform(a: Transform, b: Transform): boolean {
  return a.origin.x === b.origin.x && a.origin.y === b.origin.y && a.origin.z === b.origin.z &&
    a.basis.every((axis, index) => {
      const other = b.basis[index]!;
      return axis.x === other.x && axis.y === other.y && axis.z === other.z;
    });
}

/** `MeshLibrary.new()`. */
export function createMeshLibrary(): MeshLibrary {
  const library: MeshLibrary = { items: new Map() };
  registerGodotObjectIdentity(library, 'MeshLibrary');
  return bindGodotResourceProtocol(library, {
    createDuplicate() {
      return createMeshLibrary();
    },
    populateDuplicate(source, target, subresources, memo) {
      for (const [id, item] of source.items) {
        target.items.set(id, {
          name: item.name,
          mesh: item.mesh === undefined
            ? undefined
            : subresources
              ? duplicateResource(item.mesh, false) as Object3D
              : item.mesh,
          meshTransform: item.meshTransform,
          meshCastShadow: item.meshCastShadow,
          navigationMesh: subresources
            ? duplicateGodotSubresource(item.navigationMesh, memo)
            : item.navigationMesh,
          navigationMeshTransform: item.navigationMeshTransform,
          navigationLayers: item.navigationLayers,
          shapes: item.shapes.map(([shape, transform]) => [
            subresources ? duplicateGodotSubresource(shape, memo) : shape,
            transform,
          ]),
          preview: item.preview,
        });
      }
    },
  });
}

/** `mesh_library.get_last_unused_item_id()` — dump: returns int. Next free id. */
export function getLastUnusedItemId(library: MeshLibrary): number {
  let next = 0;
  for (const id of library.items.keys()) {
    if (id >= next) next = id + 1;
  }
  return next;
}

/** `mesh_library.create_item(id)` — dump: `(id: int)`. */
export function createItem(library: MeshLibrary, id: number): void {
  requireMeshLibraryId(id, 'create_item');
  if (!library.items.has(id)) {
    library.items.set(id, createMeshLibraryItem());
    godotResourceEmitChanged(library);
  }
}

/** `MeshLibrary.clear()`. */
export function clearMeshLibrary(library: MeshLibrary): void {
  if (library.items.size === 0) return;
  library.items.clear();
  godotResourceEmitChanged(library);
}

/** `MeshLibrary.remove_item(id)`. */
export function removeMeshLibraryItem(library: MeshLibrary, id: number): void {
  requireMeshLibraryId(id, 'remove_item');
  if (library.items.delete(id)) godotResourceEmitChanged(library);
}

/** `MeshLibrary.get_item_list()` is sorted by numeric id in Godot. */
export function getMeshLibraryItemList(library: MeshLibrary): number[] {
  return [...library.items.keys()].sort((a, b) => a - b);
}

export function getMeshLibraryItemCount(library: MeshLibrary): number {
  return library.items.size;
}

export function findMeshLibraryItemByName(library: MeshLibrary, name: string): number {
  if (typeof name !== 'string') throw new TypeError('MeshLibrary.find_item_by_name requires a StringName.');
  for (const id of getMeshLibraryItemList(library)) {
    if (library.items.get(id)?.name === name) return id;
  }
  return -1;
}

export function setMeshLibraryItemName(library: MeshLibrary, id: number, name: string): void {
  if (typeof name !== 'string') throw new TypeError('MeshLibrary.set_item_name requires a String.');
  const item = requireMeshLibraryItem(library, id, 'set_item_name');
  if (item.name === name) return;
  item.name = name;
  godotResourceEmitChanged(library);
}

export function getMeshLibraryItemName(library: MeshLibrary, id: number): string {
  return requireMeshLibraryItem(library, id, 'get_item_name').name;
}

/** `mesh_library.set_item_mesh(id, mesh)` — dump: `(id: int, mesh: Mesh)`.
 *  builder.gd:32 passes `get_mesh(…)` which is untyped in GDScript and whose
 *  emit is `unknown` (`Resource.duplicate` has no compat class). Narrow here. */
export function setItemMesh(library: MeshLibrary, id: number, mesh: unknown): void {
  const item = requireMeshLibraryItem(library, id, 'set_item_mesh');
  if (!(mesh instanceof Object3D)) {
    throw new Error(
      `godot-compat: MeshLibrary.set_item_mesh(${id}) expected a THREE.Object3D (the Mesh ` +
        'SceneState.duplicate handed builder.gd:74).',
    );
  }
  if (item.mesh === mesh) return;
  item.mesh = mesh;
  godotResourceEmitChanged(library);
}

export function getItemMesh(library: MeshLibrary, id: number): Object3D | null {
  return requireMeshLibraryItem(library, id, 'get_item_mesh').mesh ?? null;
}

/**
 * `mesh_library.set_item_mesh_transform(id, transform)` — dump: `(id, Transform3D)`.
 * builder.gd:33 writes `Transform3D()` (identity). A non-identity transform is
 * unmeasured and refused: the 4.7 dump does not say which side of the cell
 * placement Godot composes it on.
 */
export function setItemMeshTransform(
  library: MeshLibrary,
  id: number,
  transform: Transform,
): void {
  const next = requireMeshLibraryTransform(transform, 'set_item_mesh_transform');
  const origin = next.origin;
  if (
    origin !== undefined &&
    (origin.x !== 0 || origin.y !== 0 || origin.z !== 0)
  ) {
    throw new Error(
      'godot-compat: MeshLibrary.set_item_mesh_transform with a non-identity origin. ' +
        'builder.gd:33 writes Transform3D(); a non-zero origin is unmeasured.',
    );
  }
  const item = requireMeshLibraryItem(library, id, 'set_item_mesh_transform');
  if (sameMeshLibraryTransform(item.meshTransform, next)) return;
  item.meshTransform = next;
  godotResourceEmitChanged(library);
}

export function getItemMeshTransform(library: MeshLibrary, id: number): Transform {
  return requireMeshLibraryItem(library, id, 'get_item_mesh_transform').meshTransform;
}

export function setItemMeshCastShadow(library: MeshLibrary, id: number, mode: number): void {
  if (!Number.isSafeInteger(mode) || mode < 0 || mode > 3) {
    throw new Error(`MeshLibrary.set_item_mesh_cast_shadow requires a GeometryInstance3D shadow mode; received ${String(mode)}.`);
  }
  const item = requireMeshLibraryItem(library, id, 'set_item_mesh_cast_shadow');
  item.meshCastShadow = mode;
  godotResourceEmitChanged(library);
}

export function getItemMeshCastShadow(library: MeshLibrary, id: number): number {
  return requireMeshLibraryItem(library, id, 'get_item_mesh_cast_shadow').meshCastShadow;
}

export function setItemNavigationMesh(library: MeshLibrary, id: number, navigationMesh: unknown): void {
  const item = requireMeshLibraryItem(library, id, 'set_item_navigation_mesh');
  item.navigationMesh = navigationMesh;
  godotResourceEmitChanged(library);
}

export function getItemNavigationMesh(library: MeshLibrary, id: number): unknown {
  return requireMeshLibraryItem(library, id, 'get_item_navigation_mesh').navigationMesh;
}

export function setItemNavigationMeshTransform(library: MeshLibrary, id: number, transform: Transform): void {
  const item = requireMeshLibraryItem(library, id, 'set_item_navigation_mesh_transform');
  const next = requireMeshLibraryTransform(transform, 'set_item_navigation_mesh_transform');
  if (sameMeshLibraryTransform(item.navigationMeshTransform, next)) return;
  item.navigationMeshTransform = next;
  godotResourceEmitChanged(library);
}

export function getItemNavigationMeshTransform(library: MeshLibrary, id: number): Transform {
  return requireMeshLibraryItem(library, id, 'get_item_navigation_mesh_transform').navigationMeshTransform;
}

/** Godot 3 API spelling for the same retained NavigationMesh Resource. */
export const setItemNavmesh = setItemNavigationMesh;
export const getItemNavmesh = getItemNavigationMesh;
export const setItemNavmeshTransform = setItemNavigationMeshTransform;
export const getItemNavmeshTransform = getItemNavigationMeshTransform;

export function setItemNavigationLayers(library: MeshLibrary, id: number, layers: number): void {
  if (!Number.isSafeInteger(layers) || layers < 0 || layers > 0xffffffff) {
    throw new Error('MeshLibrary.set_item_navigation_layers requires a 32-bit navigation mask.');
  }
  const item = requireMeshLibraryItem(library, id, 'set_item_navigation_layers');
  if (item.navigationLayers === layers) return;
  item.navigationLayers = layers;
  godotResourceEmitChanged(library);
}

export function getItemNavigationLayers(library: MeshLibrary, id: number): number {
  return requireMeshLibraryItem(library, id, 'get_item_navigation_layers').navigationLayers;
}

export function setItemShapes(library: MeshLibrary, id: number, shapes: readonly unknown[]): void {
  if (shapes.length % 2 !== 0) {
    throw new Error('MeshLibrary.set_item_shapes requires alternating Shape3D and Transform3D values.');
  }
  const parsed: MeshLibraryShape[] = [];
  for (let index = 0; index < shapes.length; index += 2) {
    parsed.push([shapes[index], shapes[index + 1] as Transform]);
  }
  requireMeshLibraryItem(library, id, 'set_item_shapes').shapes = parsed;
  godotResourceEmitChanged(library);
}

export function getItemShapes(library: MeshLibrary, id: number): unknown[] {
  return requireMeshLibraryItem(library, id, 'get_item_shapes').shapes.flatMap(([shape, transform]) => [shape, transform]);
}

export function setItemPreview(library: MeshLibrary, id: number, preview: Texture | null): void {
  if (preview !== null && !(preview instanceof Texture)) {
    throw new TypeError('MeshLibrary.set_item_preview requires a native THREE.Texture or null.');
  }
  requireMeshLibraryItem(library, id, 'set_item_preview').preview = preview ?? undefined;
  godotResourceEmitChanged(library);
}

export function getItemPreview(library: MeshLibrary, id: number): Texture | null {
  return requireMeshLibraryItem(library, id, 'get_item_preview').preview ?? null;
}


/** One authored node a `SceneState` presents. */
interface SceneStateNode {
  readonly type: string;
  readonly properties: readonly { readonly name: string; readonly value: unknown }[];
}

/** Godot's `SceneState` — a PackedScene's packed node list. builder.gd:66-74. */
export interface SceneState {
  readonly nodes: readonly SceneStateNode[];
}

/**
 * `packed_scene.get_state()` — dump: `PackedScene.get_state() -> SceneState`.
 *
 * `structure.model` is the `res://….glb` path the Resource carry stored. The
 * world already loaded that file into `ctx.models`. A Mesh is reported as
 * `MeshInstance3D` with property `mesh`, which is what builder.gd:68-74 looks
 * for. Other nodes are `Node3D` with no properties this game reads.
 */
function modelRoot(entry: unknown, resPath: string): Object3D {
  if (entry instanceof Object3D) return entry;
  if (entry !== null && typeof entry === 'object' && 'scene' in entry) {
    const scene = (entry as { scene: unknown }).scene;
    if (scene instanceof Object3D) return scene;
  }
  throw new Error(
    `godot-compat: PackedScene.get_state() for "${resPath}" held a value that is neither a ` +
      'THREE.Object3D nor a GodotModel `{ scene }`. ctx.models stores GodotModel.',
  );
}

export function sceneStateFromModel(
  models: ReadonlyMap<string, unknown>,
  resPath: string,
): SceneState {
  const entry = models.get(resPath);
  if (entry === undefined) {
    throw new Error(
      `godot-compat: PackedScene.get_state() for "${resPath}", which ctx.models did not load.`,
    );
  }
  const root = modelRoot(entry, resPath);
  const nodes: SceneStateNode[] = [];
  root.traverse((child) => {
    if (child instanceof Mesh) {
      nodes.push({ type: 'MeshInstance3D', properties: [{ name: 'mesh', value: child }] });
      return;
    }
    nodes.push({ type: 'Node3D', properties: [] });
  });
  return { nodes };
}

export function getNodeCount(state: SceneState): number {
  return state.nodes.length;
}

export function getNodeType(state: SceneState, idx: number): string {
  return state.nodes[idx]?.type ?? '';
}

export function getNodePropertyCount(state: SceneState, idx: number): number {
  return state.nodes[idx]?.properties.length ?? 0;
}

export function getNodePropertyName(state: SceneState, idx: number, propIdx: number): string {
  return state.nodes[idx]?.properties[propIdx]?.name ?? '';
}

export function getNodePropertyValue(state: SceneState, idx: number, propIdx: number): unknown {
  return state.nodes[idx]?.properties[propIdx]?.value;
}

/**
 * `Resource.duplicate(deep=false)`. Copied compat resources expose their own source-derived
 * duplicate operation; native Three resources retain the existing shallow-clone path.
 */
export function duplicateResource(value: unknown, deep = false): unknown {
  if (
    typeof value === 'object' &&
    value !== null &&
    'duplicate' in value &&
    typeof value.duplicate === 'function'
  ) {
    return value.duplicate(deep);
  }
  if (value instanceof Object3D) {
    if (deep) {
      throw new Error(
        'Resource.duplicate(true) refused for THREE.Object3D: native clone cannot reproduce ' +
          'Godot deep subresource duplication.',
      );
    }
    return value.clone(false);
  }
  if ((typeof value === 'object' && value !== null) || typeof value === 'function') {
    return godotResourceDuplicate(value, deep);
  }
  throw new Error(
    'godot-compat: Resource.duplicate() refused a value with neither a copied Godot duplicate ' +
      'protocol nor a native THREE.Object3D shallow clone.',
  );
}

interface GridMapSettings {
  readonly cellSize: readonly [number, number, number];
  readonly cellScale?: number;
  readonly center: { readonly x: boolean; readonly y: boolean; readonly z: boolean };
}

interface GridMapPool {
  readonly mesh: InstancedMesh;
  readonly keys: string[];
  readonly indexByKey: Map<string, number>;
}

interface GridMapCellState {
  readonly item: number;
  readonly orientation: number;
  readonly tile?: Object3D;
}

interface GridMapState {
  settings: GridMapSettings;
  library: MeshLibrary | undefined;
  readonly cells: Map<string, GridMapCellState>;
  readonly pools: Map<number, GridMapPool>;
}

const GRID_MAPS = new WeakMap<Object3D, GridMapState>();

function cellKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

function cellCoords(position: { x: number; y: number; z?: number }): {
  x: number;
  y: number;
  z: number;
} {
  return {
    x: Math.round(position.x),
    y: Math.round(position.y),
    z: Math.round(position.z ?? 0),
  };
}

/**
 * Bind authored cell settings onto the empty GridMap Object3D. The scene
 * emitter calls this from attach; script members then read the WeakMap.
 */
export function bindGridMap(
  node: Object3D,
  settings: GridMapSettings,
): void {
  const existing = GRID_MAPS.get(node);
  if (existing !== undefined) {
    existing.settings = settings;
    rebuildGridMap(node, existing);
    return;
  }
  GRID_MAPS.set(node, {
    settings,
    library: undefined,
    cells: new Map(),
    pools: new Map(),
  });
}

/**
 * Register one native `InstancedMesh` as the render pool for a MeshLibrary item.
 *
 * A script-populated GridMap begins with no cells, so the scene emitter creates one empty pool per
 * declared library item and calls this from the pool's R3F ref. Cell writes then mutate instance
 * matrices in place; no React rerender and no display-object clone per tile is involved.
 */
export function bindGridMapPool(node: Object3D, item: number, mesh: InstancedMesh): void {
  const state = stateOf(node, 'bindGridMapPool');
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  state.pools.set(item, { mesh, keys: [], indexByKey: new Map() });
}

function stateOf(node: Object3D, caller: string): GridMapState {
  const state = GRID_MAPS.get(node);
  if (state === undefined) {
    throw new Error(
      `godot-compat: ${caller} on a GridMap bindGridMap was not called for.`,
    );
  }
  return state;
}

/** `gridmap.mesh_library = library`. */
export function setMeshLibrary(node: Object3D, library: MeshLibrary): void {
  const state = stateOf(node, 'GridMap.mesh_library');
  state.library = library;
  rebuildGridMap(node, state);
}

export function getMeshLibrary(node: Object3D): MeshLibrary | undefined {
  return stateOf(node, 'GridMap.mesh_library').library;
}

function finiteCellSize(value: { readonly x: number; readonly y: number; readonly z: number }): readonly [number, number, number] {
  const parts = [value?.x, value?.y, value?.z];
  if (parts.some((part) => typeof part !== 'number' || !Number.isFinite(part) || part <= 0)) {
    throw new RangeError('GridMap.cell_size requires a finite positive Vector3.');
  }
  return [value.x, value.y, value.z];
}

function finiteCellScale(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RangeError('GridMap.cell_scale requires a finite positive number.');
  }
  return value;
}

export function getGridMapCellSize(node: Object3D): Vector3 {
  const [x, y, z] = stateOf(node, 'GridMap.cell_size').settings.cellSize;
  return vec3(x, y, z);
}

export function setGridMapCellSize(
  node: Object3D,
  value: { readonly x: number; readonly y: number; readonly z: number },
): void {
  const state = stateOf(node, 'GridMap.cell_size');
  state.settings = { ...state.settings, cellSize: finiteCellSize(value) };
  rebuildGridMap(node, state);
}

export function getGridMapCellScale(node: Object3D): number {
  return stateOf(node, 'GridMap.cell_scale').settings.cellScale ?? 1;
}

export function gridMapLocalToMap(
  node: Object3D,
  value: { readonly x: number; readonly y: number; readonly z: number },
): Vector3 {
  const state = stateOf(node, 'GridMap.local_to_map');
  if ([value?.x, value?.y, value?.z].some((part) => typeof part !== 'number' || !Number.isFinite(part))) {
    throw new TypeError('GridMap.local_to_map requires a finite Vector3.');
  }
  const [x, y, z] = state.settings.cellSize;
  return vec3(Math.floor(value.x / x), Math.floor(value.y / y), Math.floor(value.z / z));
}

export function gridMapMapToLocal(
  node: Object3D,
  value: { readonly x: number; readonly y: number; readonly z: number },
): Vector3 {
  const state = stateOf(node, 'GridMap.map_to_local');
  const coords = cellCoords(value);
  return cellOrigin(state.settings, coords.x, coords.y, coords.z);
}

export function setGridMapCellScale(node: Object3D, value: number): void {
  const state = stateOf(node, 'GridMap.cell_scale');
  state.settings = { ...state.settings, cellScale: finiteCellScale(value) };
  rebuildGridMap(node, state);
}

export type GridMapCenterAxis = 'x' | 'y' | 'z';

export function isGridMapCellCentered(node: Object3D, axis: GridMapCenterAxis): boolean {
  return stateOf(node, `GridMap.center_${axis}`).settings.center[axis];
}

export function setGridMapCellCentered(node: Object3D, axis: GridMapCenterAxis, value: boolean): void {
  if (typeof value !== 'boolean') throw new TypeError(`GridMap.center_${axis} requires bool.`);
  const state = stateOf(node, `GridMap.center_${axis}`);
  state.settings = { ...state.settings, center: { ...state.settings.center, [axis]: value } };
  rebuildGridMap(node, state);
}

/**
 * `gridmap.get_orthogonal_index_from_basis(basis)` — dump: `(basis: Basis) -> int`
 * (`godot-4.7-extension_api.json` GridMap). `selector.basis` is `spatial.ts`'s three-column array.
 *
 * This IS `Basis.get_orthogonal_index` — Godot's GridMap does not have a second, smaller
 * orientation space — so it delegates to {@link basisOrthogonalIndex} over `basis.ts`'s one
 * `GODOT_ORTHO_BASES` table rather than matching a private subset. See this module's header for
 * the bug that private subset caused. Godot's own snap-then-compare returns 0 for a basis that is
 * not orthogonal, and so does this: matching the source engine beats a refusal we invented, and
 * the sibling member already answered that way.
 *
 * The parameter stays the loose column shape the emitter hands over (`y` optional, because a
 * translated 2D-ish column can arrive without one); it is normalized to a `Basis` here.
 */
export function getOrthogonalIndexFromBasis(
  basis: readonly { readonly x: number; readonly y?: number; readonly z: number }[],
): number {
  const columns = [0, 1, 2].map((i) => {
    const column = basis[i];
    return vec3(column?.x ?? 0, column?.y ?? 0, column?.z ?? 0);
  }) as unknown as Basis;
  return basisOrthogonalIndex(columns);
}

function cellOrigin(
  settings: GridMapSettings,
  x: number,
  y: number,
  z: number,
): Vector3 {
  const [sx, sy, sz] = settings.cellSize;
  const ox = settings.center.x ? 0.5 : 0;
  const oy = settings.center.y ? 0.5 : 0;
  const oz = settings.center.z ? 0.5 : 0;
  return vec3((x + ox) * sx, (y + oy) * sy, (z + oz) * sz);
}

function placeTile(
  node: Object3D,
  state: GridMapState,
  x: number,
  y: number,
  z: number,
  item: number,
  orientation: number,
): void {
  const key = cellKey(x, y, z);
  const pool = state.pools.get(item);
  if (pool !== undefined) {
    addPoolCell(pool, state.settings, key, x, y, z, orientation);
    state.cells.set(key, { item, orientation });
    return;
  }
  const library = state.library;
  const source = library?.items.get(item)?.mesh;
  if (source === undefined) return;
  const tile = source.clone(true);
  const origin = cellOrigin(state.settings, x, y, z);
  tile.position.set(origin.x, origin.y, origin.z);
  // The SAME orientation space the pooled path above uses — Godot's 24 orthogonal bases. This
  // clone path used to read the number as `orientation % 4` Y-turns, so an item with a render
  // pool and an item without one faced different ways for one `set_cell_item` call.
  const [c0, c1, c2] = basisAtOrthogonalIndex(orientation);
  TILE_MATRIX.makeBasis(
    TILE_AXIS_X.set(c0.x, c0.y, c0.z),
    TILE_AXIS_Y.set(c1.x, c1.y, c1.z),
    TILE_AXIS_Z.set(c2.x, c2.y, c2.z),
  );
  tile.quaternion.setFromRotationMatrix(TILE_MATRIX);
  node.add(tile);
  state.cells.set(key, { item, orientation, tile });
}

// Scratch for {@link placeTile}'s basis -> quaternion conversion. Written and read within one
// call and never escaping, the same way `basis.ts` keeps its own.
const TILE_MATRIX = new Matrix4();
const TILE_AXIS_X = new ThreeVector3();
const TILE_AXIS_Y = new ThreeVector3();
const TILE_AXIS_Z = new ThreeVector3();

const CELL_MATRIX = new Matrix4();
const SWAP_MATRIX = new Matrix4();

function ensurePoolCapacity(pool: GridMapPool, needed: number): void {
  const current = pool.mesh.instanceMatrix.count;
  if (current >= needed) return;
  const capacity = Math.max(needed, current * 2, 1);
  const values = new Float32Array(capacity * 16);
  values.set(pool.mesh.instanceMatrix.array as ArrayLike<number>);
  pool.mesh.instanceMatrix = new InstancedBufferAttribute(values, 16).setUsage(DynamicDrawUsage);
}

function addPoolCell(
  pool: GridMapPool,
  settings: GridMapSettings,
  key: string,
  x: number,
  y: number,
  z: number,
  orientation: number,
): void {
  const basis = basisAtOrthogonalIndex(orientation);
  const origin = cellOrigin(settings, x, y, z);
  const scale = settings.cellScale ?? 1;
  ensurePoolCapacity(pool, pool.keys.length + 1);
  CELL_MATRIX.set(
    basis[0].x * scale,
    basis[1].x * scale,
    basis[2].x * scale,
    origin.x,
    basis[0].y * scale,
    basis[1].y * scale,
    basis[2].y * scale,
    origin.y,
    basis[0].z * scale,
    basis[1].z * scale,
    basis[2].z * scale,
    origin.z,
    0,
    0,
    0,
    1,
  );
  const index = pool.keys.length;
  pool.keys.push(key);
  pool.indexByKey.set(key, index);
  pool.mesh.setMatrixAt(index, CELL_MATRIX);
  pool.mesh.count = pool.keys.length;
  pool.mesh.instanceMatrix.needsUpdate = true;
}

function removePoolCell(pool: GridMapPool, key: string): void {
  const index = pool.indexByKey.get(key);
  if (index === undefined) return;
  const lastIndex = pool.keys.length - 1;
  const lastKey = pool.keys[lastIndex] as string;
  if (index !== lastIndex) {
    pool.mesh.getMatrixAt(lastIndex, SWAP_MATRIX);
    pool.mesh.setMatrixAt(index, SWAP_MATRIX);
    pool.keys[index] = lastKey;
    pool.indexByKey.set(lastKey, index);
  }
  pool.keys.pop();
  pool.indexByKey.delete(key);
  pool.mesh.count = pool.keys.length;
  pool.mesh.instanceMatrix.needsUpdate = true;
}

/**
 * `gridmap.set_cell_item(position, item, orientation=0)` — dump:
 * `(position: Vector3i, item: int, orientation: int = 0)`.
 * builder.gd also passes a Vector3 from the rounded mouse hit. item -1 clears
 * (builder.gd:95).
 */
export function setCellItem(
  node: Object3D,
  position: { x: number; y: number; z?: number },
  item: number,
  orientation?: number,
): void;
export function setCellItem(
  node: Object3D,
  x: number,
  y: number,
  z: number,
  item: number,
  orientation?: number,
): void;
export function setCellItem(
  node: Object3D,
  positionOrX: { x: number; y: number; z?: number } | number,
  itemOrY: number,
  orientationOrZ = 0,
  godot3Item?: number,
  godot3Orientation = 0,
): void {
  const state = stateOf(node, 'GridMap.set_cell_item');
  const godot3 = typeof positionOrX === 'number';
  const position = godot3
    ? { x: positionOrX, y: itemOrY, z: orientationOrZ }
    : positionOrX;
  const item = godot3 ? (godot3Item as number) : itemOrY;
  const orientation = godot3 ? godot3Orientation : orientationOrZ;
  const { x, y, z } = cellCoords(position);
  const key = cellKey(x, y, z);
  const previous = state.cells.get(key);
  if (previous !== undefined) {
    const pool = state.pools.get(previous.item);
    if (pool !== undefined) removePoolCell(pool, key);
    if (previous.tile !== undefined) node.remove(previous.tile);
    state.cells.delete(key);
  }
  if (item < 0) return;
  placeTile(node, state, x, y, z, item, orientation);
}

/** `gridmap.get_cell_item(position)` — dump: `-> int`. Missing cell is -1. */
export function getCellItem(
  node: Object3D,
  position: { x: number; y: number; z?: number },
): number {
  const state = stateOf(node, 'GridMap.get_cell_item');
  const { x, y, z } = cellCoords(position);
  return state.cells.get(cellKey(x, y, z))?.item ?? -1;
}

/** `gridmap.get_cell_item_orientation(position)` — dump: `-> int`. */
export function getCellItemOrientation(
  node: Object3D,
  position: { x: number; y: number; z?: number },
): number {
  const state = stateOf(node, 'GridMap.get_cell_item_orientation');
  const { x, y, z } = cellCoords(position);
  return state.cells.get(cellKey(x, y, z))?.orientation ?? 0;
}

/** `gridmap.get_used_cells()` — dump: `-> Vector3i[]`. */
export function getUsedCells(node: Object3D): Vector3[] {
  const state = stateOf(node, 'GridMap.get_used_cells');
  const out: Vector3[] = [];
  for (const key of state.cells.keys()) {
    const [x, y, z] = key.split(',').map(Number) as [number, number, number];
    out.push(vec3(x, y, z));
  }
  return out;
}

/** `GridMap.get_used_cells_by_item(item)` over the same exact retained cell table. */
export function getUsedCellsByItem(node: Object3D, item: number): Vector3[] {
  if (!Number.isSafeInteger(item)) {
    throw new TypeError('GridMap.get_used_cells_by_item requires an integer item id.');
  }
  const state = stateOf(node, 'GridMap.get_used_cells_by_item');
  const out: Vector3[] = [];
  for (const [key, cell] of state.cells) {
    if (cell.item !== item) continue;
    const [x, y, z] = key.split(',').map(Number) as [number, number, number];
    out.push(vec3(x, y, z));
  }
  return out;
}

function rebuildGridMap(node: Object3D, state: GridMapState): void {
  const cells = [...state.cells.entries()].map(([key, cell]) => {
    const [x, y, z] = key.split(',').map(Number) as [number, number, number];
    return { x, y, z, item: cell.item, orientation: cell.orientation };
  });
  for (const [key, cell] of state.cells) {
    const pool = state.pools.get(cell.item);
    if (pool !== undefined) removePoolCell(pool, key);
    if (cell.tile !== undefined) node.remove(cell.tile);
  }
  state.cells.clear();
  for (const cell of cells) {
    placeTile(node, state, cell.x, cell.y, cell.z, cell.item, cell.orientation);
  }
}

/** `gridmap.clear()` — dump: removes every cell. */
export function clearGridMap(node: Object3D): void {
  const state = stateOf(node, 'GridMap.clear');
  for (const [key, cell] of state.cells) {
    const pool = state.pools.get(cell.item);
    if (pool !== undefined) removePoolCell(pool, key);
    if (cell.tile !== undefined) node.remove(cell.tile);
  }
  state.cells.clear();
}
