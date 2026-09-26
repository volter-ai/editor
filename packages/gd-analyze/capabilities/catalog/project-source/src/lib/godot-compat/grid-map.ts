/**
 * @godot-class GridMap
 * @role BINDING
 *
 * Godot 4.7's `GridMap` (`modules/gridmap/grid_map.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): cells by signed 16-bit coordinates (`IndexKey`), in
 * the order they were set (a `HashMap`), each a MeshLibrary item and one of the 24 orthogonal
 * orientations. A scene writes it as `<GodotGridMap meshLibrary={…} data={…} />`: each item's
 * cells drawn as one three `InstancedMesh`, and one fixed `@react-three/rapier` body holding each
 * cell's item shapes as colliders at the cell's placement, which the physics protocol registers as
 * the GridMap itself (`get_collider()` is the GridMap, its layers the GridMap's), as Godot attaches
 * its octant bodies to the GridMap (`grid_map.cpp:420`). Octants, baked meshes and navigation are
 * not bound.
 */

import { CapsuleCollider, ConvexHullCollider, CuboidCollider, BallCollider, RigidBody, type RapierRigidBody, TrimeshCollider } from '@react-three/rapier';
import { createElement, type ReactElement, useEffect, useRef, useSyncExternalStore } from 'react';
import { Group, type InstancedMesh, Matrix4, type Object3D, Quaternion as ThreeQuaternion, Vector3 as ThreeVector3 } from 'three';
import { construct as basis, type Basis } from './basis';
import { godot_collision_object_adopt, godot_collision_object_stand_in, godot_collision_object_state, set_collision_layer as setBodyLayer, set_collision_mask as setBodyMask } from './collision-object-3d';
import { godot_mesh_library_connect_changed, godot_mesh_library_item, type MeshLibrary } from './mesh-library';
import { godot_node_entity } from './node';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import { construct as transform3d, op_multiply, type Transform3D } from './transform-3d';
import { construct as vector3, type Vector3 } from './vector3';
import { construct as vector3i, type Vector3i } from './vector3i';

const f32 = Math.fround;

/** `GridMap::INVALID_CELL_ITEM` (`grid_map.h:228`). */
const INVALID_CELL_ITEM = -1;

interface Cell {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly item: number;
  readonly rot: number;
}

interface GridMapState {
  library: MeshLibrary | null;
  releaseLibrary: (() => void) | undefined;
  cellSize: Vector3;
  octantSize: number;
  center: [boolean, boolean, boolean];
  cellScale: number;
  layer: number;
  mask: number;
  readonly cells: Map<string, Cell>;
  version: number;
  readonly listeners: Set<() => void>;
}

const STATE = new WeakMap<object, GridMapState>();

function stateOf(self: object, member: string): GridMapState {
  const state = STATE.get(godot_node_entity(self));
  if (state === undefined) throw new TypeError(`godot-compat: GridMap.${member} requires a GridMap.`);
  return state;
}

/** The map's cells, layout or library changed: its elements redraw (`_recreate_octant_data`). */
function changed(state: GridMapState): void {
  state.version += 1;
  for (const listener of [...state.listeners]) listener();
}

const int16 = (value: number): number => (value << 16) >> 16;
const keyOf = (x: number, y: number, z: number): string => `${String(x)},${String(y)},${String(z)}`;

/**
 * Makes `entity` a GridMap with its defaults (`grid_map.h:163-180`: cell size 2, octants of 8,
 * centred, scale 1, layer and mask 1); its cells' body registers it as a collision object once the
 * body exists.
 *
 * @godot GridMap (protocol)
 * @source modules/gridmap/grid_map.cpp:1965
 */
export function godot_grid_map_mount(entity: Object3D): void {
  STATE.set(entity, {
    library: null,
    releaseLibrary: undefined,
    cellSize: vector3(2, 2, 2),
    octantSize: 8,
    center: [true, true, true],
    cellScale: 1,
    layer: 1,
    mask: 1,
    cells: new Map(),
    version: 0,
    listeners: new Set(),
  });
}

/**
 * `data` (`GridMap::_set`, `grid_map.cpp:67`): the cells, three ints each, read as one
 * little-endian `IndexKey` (signed 16-bit x, y, z) over the first two and one `Cell` (item in bits
 * 0-15, orientation in 16-20) in the third; the map is cleared first.
 *
 * @godot GridMap (protocol)
 * @source modules/gridmap/grid_map.cpp:67
 */
export function godot_grid_map_set_data(self: object, cells: readonly number[]): void {
  const state = stateOf(self, 'data');
  if (cells.length % 3 !== 0) return;
  state.cells.clear();
  const view = new DataView(Int32Array.from(cells).buffer);
  for (let index = 0; index < cells.length / 3; index += 1) {
    const x = view.getInt16(index * 12, true);
    const y = view.getInt16(index * 12 + 2, true);
    const z = view.getInt16(index * 12 + 4, true);
    const cell = view.getUint32(index * 12 + 8, true);
    state.cells.set(keyOf(x, y, z), { x, y, z, item: cell & 0xffff, rot: (cell >>> 16) & 0x1f });
  }
  changed(state);
}

/** `_ortho_bases` (`grid_map.cpp:504`): `Basis(xx, xy, xz, yx, …)` takes rows. */
const ORTHO_ROWS: readonly (readonly number[])[] = [
  [1, 0, 0, 0, 1, 0, 0, 0, 1],
  [0, -1, 0, 1, 0, 0, 0, 0, 1],
  [-1, 0, 0, 0, -1, 0, 0, 0, 1],
  [0, 1, 0, -1, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, -1, 0, 1, 0],
  [0, 0, 1, 1, 0, 0, 0, 1, 0],
  [-1, 0, 0, 0, 0, 1, 0, 1, 0],
  [0, 0, -1, -1, 0, 0, 0, 1, 0],
  [1, 0, 0, 0, -1, 0, 0, 0, -1],
  [0, 1, 0, 1, 0, 0, 0, 0, -1],
  [-1, 0, 0, 0, 1, 0, 0, 0, -1],
  [0, -1, 0, -1, 0, 0, 0, 0, -1],
  [1, 0, 0, 0, 0, 1, 0, -1, 0],
  [0, 0, -1, 1, 0, 0, 0, -1, 0],
  [-1, 0, 0, 0, 0, -1, 0, -1, 0],
  [0, 0, 1, -1, 0, 0, 0, -1, 0],
  [0, 0, 1, 0, 1, 0, -1, 0, 0],
  [0, -1, 0, 0, 0, 1, -1, 0, 0],
  [0, 0, -1, 0, -1, 0, -1, 0, 0],
  [0, 1, 0, 0, 0, -1, -1, 0, 0],
  [0, 0, 1, 0, -1, 0, 1, 0, 0],
  [0, 1, 0, 0, 0, 1, 1, 0, 0],
  [0, 0, -1, 0, 1, 0, 1, 0, 0],
  [0, -1, 0, 0, 0, -1, 1, 0, 0],
];

function orthoBasis(index: number): Basis {
  const r = ORTHO_ROWS[index] as readonly number[];
  const at = (i: number) => r[i] as number;
  return basis(vector3(at(0), at(3), at(6)), vector3(at(1), at(4), at(7)), vector3(at(2), at(5), at(8)));
}

/** `_get_offset` (`grid_map.cpp:1592`): half a cell on each centred axis. */
function offsetOf(state: GridMapState): Vector3 {
  return vector3(
    f32(state.cellSize.x * 0.5 * Number(state.center[0])),
    f32(state.cellSize.y * 0.5 * Number(state.center[1])),
    f32(state.cellSize.z * 0.5 * Number(state.center[2])),
  );
}

/**
 * A cell's placement in the GridMap (`_octant_update`, `grid_map.cpp:717`): its orientation's
 * basis, its origin at the cell times the cell size plus the offset, then the basis scaled.
 */
function cellTransform(state: GridMapState, cell: Cell): Transform3D {
  const b = orthoBasis(cell.rot);
  const offset = offsetOf(state);
  const origin = vector3(
    f32(f32(cell.x * state.cellSize.x) + offset.x),
    f32(f32(cell.y * state.cellSize.y) + offset.y),
    f32(f32(cell.z * state.cellSize.z) + offset.z),
  );
  const s = f32(state.cellScale);
  const scaled = basis(
    vector3(f32(b.x.x * s), f32(b.x.y * s), f32(b.x.z * s)),
    vector3(f32(b.y.x * s), f32(b.y.y * s), f32(b.y.z * s)),
    vector3(f32(b.z.x * s), f32(b.z.y * s), f32(b.z.z * s)),
  );
  return transform3d(scaled, origin);
}

function matrixOf(t: Transform3D): Matrix4 {
  const b = t.basis;
  return new Matrix4().set(b.x.x, b.y.x, b.z.x, t.origin.x, b.x.y, b.y.y, b.z.y, t.origin.y, b.x.z, b.y.z, b.z.z, t.origin.z, 0, 0, 0, 1);
}

function inBounds(position: Vector3i): boolean {
  return Math.abs(position.x) < 1 << 20 && Math.abs(position.y) < 1 << 20 && Math.abs(position.z) < 1 << 20;
}

/**
 * @godot GridMap.set_mesh_library
 * @source modules/gridmap/grid_map.cpp:318
 */
export function set_mesh_library(self: object, library: MeshLibrary | null): void {
  const state = stateOf(self, 'set_mesh_library');
  state.releaseLibrary?.();
  state.library = library;
  state.releaseLibrary = library === null ? undefined : godot_mesh_library_connect_changed(library, () => changed(state));
  changed(state);
}

/**
 * @godot GridMap.get_mesh_library
 * @source modules/gridmap/grid_map.cpp:331
 */
export function get_mesh_library(self: object): MeshLibrary | null {
  return stateOf(self, 'get_mesh_library').library;
}

/**
 * A size under 0.001 on any axis fails.
 *
 * @godot GridMap.set_cell_size
 * @source modules/gridmap/grid_map.cpp:335
 */
export function set_cell_size(self: object, size: Vector3): void {
  if (size.x < f32(0.001) || size.y < f32(0.001) || size.z < f32(0.001)) return;
  const state = stateOf(self, 'set_cell_size');
  state.cellSize = size;
  changed(state);
}

/**
 * @godot GridMap.get_cell_size
 * @source modules/gridmap/grid_map.cpp:342
 */
export function get_cell_size(self: object): Vector3 {
  return stateOf(self, 'get_cell_size').cellSize;
}

/**
 * A size of 0 fails.
 *
 * @godot GridMap.set_octant_size
 * @source modules/gridmap/grid_map.cpp:346
 */
export function set_octant_size(self: object, size: number): void {
  if (size === 0) return;
  const state = stateOf(self, 'set_octant_size');
  state.octantSize = size;
  changed(state);
}

/**
 * @godot GridMap.get_octant_size
 * @source modules/gridmap/grid_map.cpp:352
 */
export function get_octant_size(self: object): number {
  return stateOf(self, 'get_octant_size').octantSize;
}

function centerSetter(axis: 0 | 1 | 2, member: string) {
  return (self: object, enable: boolean): void => {
    const state = stateOf(self, member);
    state.center[axis] = enable;
    changed(state);
  };
}

/**
 * @godot GridMap.set_center_x
 * @source modules/gridmap/grid_map.cpp:356
 */
export function set_center_x(self: object, enable: boolean): void {
  centerSetter(0, 'set_center_x')(self, enable);
}

/**
 * @godot GridMap.get_center_x
 * @source modules/gridmap/grid_map.cpp:361
 */
export function get_center_x(self: object): boolean {
  return stateOf(self, 'get_center_x').center[0];
}

/**
 * @godot GridMap.set_center_y
 * @source modules/gridmap/grid_map.cpp:365
 */
export function set_center_y(self: object, enable: boolean): void {
  centerSetter(1, 'set_center_y')(self, enable);
}

/**
 * @godot GridMap.get_center_y
 * @source modules/gridmap/grid_map.cpp:370
 */
export function get_center_y(self: object): boolean {
  return stateOf(self, 'get_center_y').center[1];
}

/**
 * @godot GridMap.set_center_z
 * @source modules/gridmap/grid_map.cpp:374
 */
export function set_center_z(self: object, enable: boolean): void {
  centerSetter(2, 'set_center_z')(self, enable);
}

/**
 * @godot GridMap.get_center_z
 * @source modules/gridmap/grid_map.cpp:379
 */
export function get_center_z(self: object): boolean {
  return stateOf(self, 'get_center_z').center[2];
}

/**
 * @godot GridMap.set_cell_scale
 * @source modules/gridmap/grid_map.cpp:1336
 */
export function set_cell_scale(self: object, scale: number): void {
  const state = stateOf(self, 'set_cell_scale');
  state.cellScale = f32(scale);
  changed(state);
}

/**
 * @godot GridMap.get_cell_scale
 * @source modules/gridmap/grid_map.cpp:1341
 */
export function get_cell_scale(self: object): number {
  return stateOf(self, 'get_cell_scale').cellScale;
}

/**
 * The cells' body takes the layer (`_update_physics_bodies_collision_properties`).
 *
 * @godot GridMap.set_collision_layer
 * @source modules/gridmap/grid_map.cpp:165
 */
export function set_collision_layer(self: object, layer: number): void {
  const state = stateOf(self, 'set_collision_layer');
  state.layer = layer >>> 0;
  const entity = godot_node_entity(self);
  if (godot_collision_object_state(entity) !== undefined) setBodyLayer(entity, state.layer);
}

/**
 * @godot GridMap.get_collision_layer
 * @source modules/gridmap/grid_map.cpp:170
 */
export function get_collision_layer(self: object): number {
  return stateOf(self, 'get_collision_layer').layer;
}

/**
 * @godot GridMap.set_collision_mask
 * @source modules/gridmap/grid_map.cpp:174
 */
export function set_collision_mask(self: object, mask: number): void {
  const state = stateOf(self, 'set_collision_mask');
  state.mask = mask >>> 0;
  const entity = godot_node_entity(self);
  if (godot_collision_object_state(entity) !== undefined) setBodyMask(entity, state.mask);
}

/**
 * @godot GridMap.get_collision_mask
 * @source modules/gridmap/grid_map.cpp:179
 */
export function get_collision_mask(self: object): number {
  return stateOf(self, 'get_collision_mask').mask;
}

/**
 * A coordinate beyond 2^20 fails; a negative item erases the cell; a set cell keeps its place in
 * the map's order. The key keeps each coordinate's low 16 bits, signed (`IndexKey`).
 *
 * @godot GridMap.set_cell_item
 * @source modules/gridmap/grid_map.cpp:383
 */
export function set_cell_item(self: object, position: Vector3i, item: number, orientation = 0): void {
  if (!inBounds(position)) return;
  const state = stateOf(self, 'set_cell_item');
  const x = int16(position.x);
  const y = int16(position.y);
  const z = int16(position.z);
  const key = keyOf(x, y, z);
  if (item < 0) {
    if (state.cells.delete(key)) changed(state);
    return;
  }
  state.cells.set(key, { x, y, z, item: item & 0xffff, rot: orientation & 0x1f });
  changed(state);
}

/**
 * `INVALID_CELL_ITEM` for an empty cell or a coordinate beyond 2^20.
 *
 * @godot GridMap.get_cell_item
 * @source modules/gridmap/grid_map.cpp:473
 */
export function get_cell_item(self: object, position: Vector3i): number {
  if (!inBounds(position)) return INVALID_CELL_ITEM;
  return stateOf(self, 'get_cell_item').cells.get(keyOf(int16(position.x), int16(position.y), int16(position.z)))?.item ?? INVALID_CELL_ITEM;
}

/**
 * -1 for an empty cell or a coordinate beyond 2^20.
 *
 * @godot GridMap.get_cell_item_orientation
 * @source modules/gridmap/grid_map.cpp:489
 */
export function get_cell_item_orientation(self: object, position: Vector3i): number {
  if (!inBounds(position)) return -1;
  return stateOf(self, 'get_cell_item_orientation').cells.get(keyOf(int16(position.x), int16(position.y), int16(position.z)))?.rot ?? -1;
}

/**
 * The identity for an empty cell.
 *
 * @godot GridMap.get_cell_item_basis
 * @source modules/gridmap/grid_map.cpp:532
 */
export function get_cell_item_basis(self: object, position: Vector3i): Basis {
  const orientation = get_cell_item_orientation(self, position);
  return orientation === -1 ? basis() : orthoBasis(orientation);
}

/**
 * An index outside 0-23 is the identity.
 *
 * @godot GridMap.get_basis_with_orthogonal_index
 * @source modules/gridmap/grid_map.cpp:542
 */
export function get_basis_with_orthogonal_index(_self: object, index: number): Basis {
  return index >= 0 && index < 24 ? orthoBasis(index) : basis();
}

/**
 * Each component snapped to -1, 0 or 1 (beyond ±0.5), then the first matching orientation, else 0.
 *
 * @godot GridMap.get_orthogonal_index_from_basis
 * @source modules/gridmap/grid_map.cpp:548
 */
export function get_orthogonal_index_from_basis(_self: object, b: Basis): number {
  const snap = (value: number) => (value > 0.5 ? 1 : value < -0.5 ? -1 : 0);
  // Row i, column j: `orth[i][j]`.
  const rows = [
    [snap(b.x.x), snap(b.y.x), snap(b.z.x)],
    [snap(b.x.y), snap(b.y.y), snap(b.z.y)],
    [snap(b.x.z), snap(b.y.z), snap(b.z.z)],
  ].flat();
  const found = ORTHO_ROWS.findIndex((entry) => entry.every((value, index) => value === rows[index]));
  return found < 0 ? 0 : found;
}

/**
 * `(position / cell_size).floor()` as a Vector3i.
 *
 * @godot GridMap.local_to_map
 * @source modules/gridmap/grid_map.cpp:600
 */
export function local_to_map(self: object, position: Vector3): Vector3i {
  const size = stateOf(self, 'local_to_map').cellSize;
  return vector3i(
    vector3(Math.floor(f32(position.x / size.x)), Math.floor(f32(position.y / size.y)), Math.floor(f32(position.z / size.z))),
  );
}

/**
 * The cell times the cell size, plus the offset.
 *
 * @godot GridMap.map_to_local
 * @source modules/gridmap/grid_map.cpp:605
 */
export function map_to_local(self: object, position: Vector3i): Vector3 {
  const state = stateOf(self, 'map_to_local');
  const offset = offsetOf(state);
  return vector3(
    f32(f32(position.x * state.cellSize.x) + offset.x),
    f32(f32(position.y * state.cellSize.y) + offset.y),
    f32(f32(position.z * state.cellSize.z) + offset.z),
  );
}

/**
 * In the order the cells were set.
 *
 * @godot GridMap.get_used_cells
 * @source modules/gridmap/grid_map.cpp:1345
 */
export function get_used_cells(self: object): Vector3i[] {
  return [...stateOf(self, 'get_used_cells').cells.values()].map((cell) => vector3i(cell.x, cell.y, cell.z));
}

/**
 * @godot GridMap.get_used_cells_by_item
 * @source modules/gridmap/grid_map.cpp:1357
 */
export function get_used_cells_by_item(self: object, item: number): Vector3i[] {
  return [...stateOf(self, 'get_used_cells_by_item').cells.values()].filter((cell) => cell.item === item).map((cell) => vector3i(cell.x, cell.y, cell.z));
}

/**
 * @godot GridMap.clear
 * @source modules/gridmap/grid_map.cpp:1183
 */
export function clear(self: object): void {
  const state = stateOf(self, 'clear');
  state.cells.clear();
  changed(state);
}

const GRID_MAP = {
  create: () => new Group(),
  classes: ['GridMap', 'Node3D', 'Node', 'Object'],
  spatial: true,
  mount: godot_grid_map_mount,
  props: new Map<string, GodotElementProp<Object3D>>([
    ['meshLibrary', (entity, value: MeshLibrary | null) => set_mesh_library(entity, value)],
    ['cellSize', (entity, value: readonly [number, number, number]) => set_cell_size(entity, vector3(...value))],
    ['cellOctantSize', (entity, value: number) => set_octant_size(entity, value)],
    ['cellCenterX', (entity, value: boolean) => set_center_x(entity, value)],
    ['cellCenterY', (entity, value: boolean) => set_center_y(entity, value)],
    ['cellCenterZ', (entity, value: boolean) => set_center_z(entity, value)],
    ['cellScale', (entity, value: number) => set_cell_scale(entity, value)],
    ['collisionLayer', (entity, value: number) => set_collision_layer(entity, value)],
    ['collisionMask', (entity, value: number) => set_collision_mask(entity, value)],
    ['data', (entity, value: readonly number[]) => godot_grid_map_set_data(entity, value)],
  ]),
};

/** One item's cells drawn as an `InstancedMesh`: each cell's placement times the item's mesh placement. */
function ItemInstances({ state, item }: { readonly state: GridMapState; readonly item: number }): ReactElement | null {
  const entry = state.library === null ? undefined : godot_mesh_library_item(state.library, item);
  const cells = [...state.cells.values()].filter((cell) => cell.item === item);
  const mesh = useRef<InstancedMesh | null>(null);
  useEffect(() => {
    const instanced = mesh.current;
    if (instanced === null || entry === undefined) return;
    cells.forEach((cell, index) => instanced.setMatrixAt(index, matrixOf(op_multiply(cellTransform(state, cell), entry.meshTransform))));
    instanced.instanceMatrix.needsUpdate = true;
  });
  const drawn = entry?.mesh ?? null;
  if (entry === undefined || drawn === null || cells.length === 0) return null;
  const materials = drawn.materials.length === 1 ? drawn.materials[0] : [...drawn.materials];
  return createElement('instancedMesh', {
    ref: mesh,
    args: [drawn.geometry, materials, cells.length],
    castShadow: entry.castShadow !== 0,
    receiveShadow: true,
  });
}

/** The `@react-three/rapier` component of a shape's collider. */
function colliderComponent(component: string): unknown {
  switch (component) {
    case 'cuboid':
      return CuboidCollider;
    case 'ball':
      return BallCollider;
    case 'capsule':
      return CapsuleCollider;
    case 'convexHull':
      return ConvexHullCollider;
    default:
      return TrimeshCollider;
  }
}

/** The cells' shapes as one fixed body's colliders, the body standing for the GridMap. */
function CellBody({ state, entity }: { readonly state: GridMapState; readonly entity: object }): ReactElement {
  const body = useRef<RapierRigidBody | null>(null);
  // Each collider's Godot shape: the item shape it was made from.
  const shapes = useRef(new Map<number, object>()).current;
  // The GridMap is a collision object from when its body exists (`set_cell_item` creates the
  // octant bodies with the GridMap's layer and mask, `grid_map.cpp:420`).
  useEffect(() => {
    const held = body.current;
    if (held === null) return undefined;
    godot_collision_object_adopt(entity, 'static');
    setBodyLayer(entity, state.layer);
    setBodyMask(entity, state.mask);
    return godot_collision_object_stand_in(held as never, entity, (collider) => shapes.get(collider.handle));
  }, []);
  const colliders: ReactElement[] = [];
  for (const cell of state.cells.values()) {
    const entry = state.library === null ? undefined : godot_mesh_library_item(state.library, cell.item);
    if (entry === undefined) continue;
    entry.shapes.forEach((shape, index) => {
      const position = new ThreeVector3();
      const rotation = new ThreeQuaternion();
      matrixOf(op_multiply(cellTransform(state, cell), shape.transform)).decompose(position, rotation, new ThreeVector3());
      colliders.push(
        createElement(colliderComponent(shape.collider.component) as never, {
          key: `${String(cell.x)},${String(cell.y)},${String(cell.z)}:${String(index)}`,
          ref: (collider: { readonly handle: number } | null) => {
            if (collider !== null) shapes.set(collider.handle, shape.shape);
          },
          args: shape.collider.args,
          position: [position.x, position.y, position.z],
          quaternion: [rotation.x, rotation.y, rotation.z, rotation.w],
        }),
      );
    });
  }
  return createElement(RigidBody, { ref: body, type: 'fixed', colliders: false }, ...colliders);
}

/**
 * A GridMap as a scene writes it: `<GodotGridMap meshLibrary={tiles} data={cells} />`, its
 * transform three's; its item instances and its cells' body redrawn as its cells change.
 *
 * @godot GridMap (protocol)
 * @source modules/gridmap/grid_map.cpp:644
 */
export function GodotGridMap(props: GodotElementProps<Group>): ReactElement {
  const element = useGodotElement(GRID_MAP, props);
  const entity = (element.props as { readonly object: Group }).object;
  const state = STATE.get(entity) as GridMapState;
  useSyncExternalStore(
    (listener) => {
      state.listeners.add(listener);
      return () => state.listeners.delete(listener);
    },
    () => state.version,
  );
  const items = [...new Set([...state.cells.values()].map((cell) => cell.item))];
  return createElement(
    'primitive',
    { ...(element.props as object) },
    // An item's instance count is fixed when its InstancedMesh is made: a new count, a new mesh.
    ...items.map((item) => createElement(ItemInstances, { key: `item:${String(item)}:${String([...state.cells.values()].filter((cell) => cell.item === item).length)}`, state, item })),
    createElement(CellBody, { key: 'body', state, entity }),
    props.children,
  );
}
