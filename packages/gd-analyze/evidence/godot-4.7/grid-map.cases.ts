import { Group } from 'three';
import * as G from '../../capabilities/catalog/project-source/src/lib/godot-compat/grid-map';
import { godot_mesh_library_new } from '../../capabilities/catalog/project-source/src/lib/godot-compat/mesh-library';
import { construct as basis } from '../../capabilities/catalog/project-source/src/lib/godot-compat/basis';
import { construct as vector3 } from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector3';
import { construct as vector3i } from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector3i';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { gd } from './literals';
import { resourceCases } from './resource-cases';

const c = resourceCases('GridMap');
const grid = (): Group => {
  const g = new Group();
  G.godot_grid_map_mount(g);
  return g;
};
/** A GDScript body over a new GridMap `g`, returning `result`, the node freed. */
const body = (lines: readonly string[], result: string): string[] => ['var g := GridMap.new()', ...lines, `var r = ${result}`, 'g.free()', 'return r'];
const vi = (x: number, y: number, z: number) => `Vector3i(${String(x)}, ${String(y)}, ${String(z)})`;

c.add('defaults', 'get_cell_size', body([], '[g.get_cell_size(), g.get_octant_size(), g.get_center_x(), g.get_center_y(), g.get_center_z(), g.get_cell_scale(), g.get_collision_layer(), g.get_collision_mask(), g.get_mesh_library() == null]'), () => {
  const g = grid();
  return [G.get_cell_size(g), G.get_octant_size(g), G.get_center_x(g), G.get_center_y(g), G.get_center_z(g), G.get_cell_scale(g), G.get_collision_layer(g), G.get_collision_mask(g), G.get_mesh_library(g) === null];
});
for (const size of [[1, 1, 1], [0.5, 3, 2.25], [0.0005, 1, 1]] as const) {
  c.add(`set_cell_size-${size.join('-')}`, 'set_cell_size', body([`g.set_cell_size(Vector3(${size.map(gd).join(', ')}))`], 'g.get_cell_size()'), () => {
    const g = grid();
    G.set_cell_size(g, vector3(...size));
    return G.get_cell_size(g);
  });
}
for (const size of [16, 0, -3]) {
  c.add(`set_octant_size-${String(size)}`, 'set_octant_size', body([`g.set_octant_size(${String(size)})`], 'g.get_octant_size()'), () => {
    const g = grid();
    G.set_octant_size(g, size);
    return G.get_octant_size(g);
  });
}
c.add('get_octant_size', 'get_octant_size', body([], 'g.get_octant_size()'), () => G.get_octant_size(grid()));
for (const axis of ['x', 'y', 'z'] as const) {
  c.add(`set_center_${axis}`, `set_center_${axis}`, body([`g.set_center_${axis}(false)`], `[g.get_center_x(), g.get_center_y(), g.get_center_z()]`), () => {
    const g = grid();
    ({ x: G.set_center_x, y: G.set_center_y, z: G.set_center_z })[axis](g, false);
    return [G.get_center_x(g), G.get_center_y(g), G.get_center_z(g)];
  });
  c.add(`get_center_${axis}`, `get_center_${axis}`, body([], `g.get_center_${axis}()`), () => ({ x: G.get_center_x, y: G.get_center_y, z: G.get_center_z })[axis](grid()));
}
c.add('set_cell_scale', 'set_cell_scale', body(['g.set_cell_scale(1.001)'], 'g.get_cell_scale()'), () => {
  const g = grid();
  G.set_cell_scale(g, 1.001);
  return G.get_cell_scale(g);
});
c.add('get_cell_scale', 'get_cell_scale', body([], 'g.get_cell_scale()'), () => G.get_cell_scale(grid()));
c.add('collision_layer_mask', 'set_collision_layer', body(['g.set_collision_layer(5)', 'g.set_collision_mask(12)'], '[g.get_collision_layer(), g.get_collision_mask()]'), () => {
  const g = grid();
  G.set_collision_layer(g, 5);
  G.set_collision_mask(g, 12);
  return [G.get_collision_layer(g), G.get_collision_mask(g)];
});
c.add('set_collision_mask', 'set_collision_mask', body(['g.set_collision_mask(3)'], 'g.get_collision_mask()'), () => {
  const g = grid();
  G.set_collision_mask(g, 3);
  return G.get_collision_mask(g);
});
c.add('get_collision_layer', 'get_collision_layer', body([], 'g.get_collision_layer()'), () => G.get_collision_layer(grid()));
c.add('get_collision_mask', 'get_collision_mask', body([], 'g.get_collision_mask()'), () => G.get_collision_mask(grid()));
c.add('mesh_library', 'set_mesh_library', ['var g := GridMap.new()', 'var ml := MeshLibrary.new()', 'g.set_mesh_library(ml)', 'var r = [g.get_mesh_library() == ml]', 'g.set_mesh_library(null)', 'r.append(g.get_mesh_library() == null)', 'g.free()', 'return r'], () => {
  const g = grid();
  const ml = godot_mesh_library_new();
  G.set_mesh_library(g, ml);
  const r = [G.get_mesh_library(g) === ml];
  G.set_mesh_library(g, null);
  r.push(G.get_mesh_library(g) === null);
  return r;
});
c.add('get_mesh_library', 'get_mesh_library', body([], 'g.get_mesh_library() == null'), () => G.get_mesh_library(grid()) === null);

// Cells: signed 16-bit keys, 16-bit items, 5-bit orientations, insertion order kept by a re-set.
const CELLS: readonly (readonly [number, number, number, number, number])[] = [
  [0, 0, 0, 3, 0],
  [-2, 5, 7, 1, 10],
  [40000, 0, 0, 2, 22],
  [1, -1, -300, 70000, 40],
  [0, 0, 0, 9, 16],
];
const setAll = CELLS.map(([x, y, z, item, rot]) => `g.set_cell_item(${vi(x, y, z)}, ${String(item)}, ${String(rot)})`);
const applyAll = (g: Group) => {
  for (const [x, y, z, item, rot] of CELLS) G.set_cell_item(g, vector3i(x, y, z), item, rot);
};
const probes: readonly (readonly [number, number, number])[] = [[0, 0, 0], [-2, 5, 7], [40000, 0, 0], [-25536, 0, 0], [1, -1, -300], [9, 9, 9], [1 << 20, 0, 0]];
c.add('set_cell_item-get_cell_item', 'set_cell_item', body(setAll, `[${probes.map(([x, y, z]) => `g.get_cell_item(${vi(x, y, z)})`).join(', ')}]`), () => {
  const g = grid();
  applyAll(g);
  return probes.map(([x, y, z]) => G.get_cell_item(g, vector3i(x, y, z)));
});
c.add('get_cell_item', 'get_cell_item', body(['g.set_cell_item(Vector3i(1, 2, 3), 4)'], `[g.get_cell_item(Vector3i(1, 2, 3)), g.get_cell_item(Vector3i(3, 2, 1))]`), () => {
  const g = grid();
  G.set_cell_item(g, vector3i(1, 2, 3), 4);
  return [G.get_cell_item(g, vector3i(1, 2, 3)), G.get_cell_item(g, vector3i(3, 2, 1))];
});
c.add('get_cell_item_orientation', 'get_cell_item_orientation', body(setAll, `[${probes.map(([x, y, z]) => `g.get_cell_item_orientation(${vi(x, y, z)})`).join(', ')}]`), () => {
  const g = grid();
  applyAll(g);
  return probes.map(([x, y, z]) => G.get_cell_item_orientation(g, vector3i(x, y, z)));
});
c.add('get_cell_item_basis', 'get_cell_item_basis', body(setAll, `[${probes.slice(0, 6).map(([x, y, z]) => `g.get_cell_item_basis(${vi(x, y, z)})`).join(', ')}]`), () => {
  const g = grid();
  applyAll(g);
  return probes.slice(0, 6).map(([x, y, z]) => G.get_cell_item_basis(g, vector3i(x, y, z)));
});
c.add('get_used_cells-order', 'get_used_cells', body([...setAll, 'g.set_cell_item(Vector3i(-2, 5, 7), -1)', 'g.set_cell_item(Vector3i(-2, 5, 7), 4)', 'g.set_cell_item(Vector3i(40000, 0, 0), 6)'], 'g.get_used_cells()'), () => {
  const g = grid();
  applyAll(g);
  G.set_cell_item(g, vector3i(-2, 5, 7), -1);
  G.set_cell_item(g, vector3i(-2, 5, 7), 4);
  G.set_cell_item(g, vector3i(40000, 0, 0), 6);
  return G.get_used_cells(g);
});
c.add('get_used_cells_by_item', 'get_used_cells_by_item', body([...setAll, 'g.set_cell_item(Vector3i(8, 8, 8), 1)'], '[g.get_used_cells_by_item(1), g.get_used_cells_by_item(9), g.get_used_cells_by_item(5)]'), () => {
  const g = grid();
  applyAll(g);
  G.set_cell_item(g, vector3i(8, 8, 8), 1);
  return [G.get_used_cells_by_item(g, 1), G.get_used_cells_by_item(g, 9), G.get_used_cells_by_item(g, 5)];
});
c.add('clear', 'clear', body([...setAll, 'g.clear()'], '[g.get_used_cells(), g.get_cell_item(Vector3i(0, 0, 0))]'), () => {
  const g = grid();
  applyAll(g);
  G.clear(g);
  return [G.get_used_cells(g), G.get_cell_item(g, vector3i(0, 0, 0))];
});
for (const index of [...Array.from({ length: 24 }, (_, i) => i), 24, -1]) {
  c.add(`get_basis_with_orthogonal_index-${String(index)}`, 'get_basis_with_orthogonal_index', body([], `g.get_basis_with_orthogonal_index(${String(index)})`), () => G.get_basis_with_orthogonal_index(grid(), index));
}
const bases: readonly (readonly [string, readonly number[]])[] = [
  ['identity', [1, 0, 0, 0, 1, 0, 0, 0, 1]],
  ['rot10', [-1, 0, 0, 0, 1, 0, 0, 0, -1]],
  ['near', [0.1, 0.9, 0, -0.9, 0.2, 0, 0, 0, 0.7]],
  ['none', [0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3]],
];
for (const [name, rows] of bases) {
  const r = rows;
  c.add(`get_orthogonal_index_from_basis-${name}`, 'get_orthogonal_index_from_basis', body([], `g.get_orthogonal_index_from_basis(Basis(Vector3(${gd(r[0] as number)}, ${gd(r[3] as number)}, ${gd(r[6] as number)}), Vector3(${gd(r[1] as number)}, ${gd(r[4] as number)}, ${gd(r[7] as number)}), Vector3(${gd(r[2] as number)}, ${gd(r[5] as number)}, ${gd(r[8] as number)})))`), () =>
    G.get_orthogonal_index_from_basis(grid(), basis(vector3(r[0] as number, r[3] as number, r[6] as number), vector3(r[1] as number, r[4] as number, r[7] as number), vector3(r[2] as number, r[5] as number, r[8] as number))),
  );
}
const layouts: readonly (readonly [string, readonly [number, number, number], readonly [boolean, boolean, boolean]])[] = [
  ['default', [2, 2, 2], [true, true, true]],
  ['uneven', [0.3, 1.7, 2.5], [false, true, false]],
];
const setup = (size: readonly [number, number, number], center: readonly [boolean, boolean, boolean]) => [`g.set_cell_size(Vector3(${size.map(gd).join(', ')}))`, `g.set_center_x(${String(center[0])})`, `g.set_center_y(${String(center[1])})`, `g.set_center_z(${String(center[2])})`];
const layout = (size: readonly [number, number, number], center: readonly [boolean, boolean, boolean]) => {
  const g = grid();
  G.set_cell_size(g, vector3(...size));
  G.set_center_x(g, center[0]);
  G.set_center_y(g, center[1]);
  G.set_center_z(g, center[2]);
  return g;
};
const points: readonly (readonly [number, number, number])[] = [[0, 0, 0], [1.99, -0.01, 3.5], [-7.25, 12.6, -0.3], [0.1, 0.2, 0.3]];
const cellsAt: readonly (readonly [number, number, number])[] = [[0, 0, 0], [3, -2, 17], [-100, 5, 1]];
for (const [name, size, center] of layouts) {
  c.add(`local_to_map-${name}`, 'local_to_map', body(setup(size, center), `[${points.map((p) => `g.local_to_map(Vector3(${p.map(gd).join(', ')}))`).join(', ')}]`), () => {
    const g = layout(size, center);
    return points.map((p) => G.local_to_map(g, vector3(...p)));
  });
  c.add(`map_to_local-${name}`, 'map_to_local', body(setup(size, center), `[${cellsAt.map(([x, y, z]) => `g.map_to_local(${vi(x, y, z)})`).join(', ')}]`), () => {
    const g = layout(size, center);
    return cellsAt.map(([x, y, z]) => G.map_to_local(g, vector3i(x, y, z)));
  });
}

const EVIDENCE: GodotEvidenceCaseFile = {
  kind: 'node',
  godotClass: 'GridMap',
  compatModule: 'lib/godot-compat/grid-map',
  cases: c.cases.map((entry) => ({ ...entry, gdscript: entry.gdscript.includes('return') ? entry.gdscript : `return ${entry.gdscript}` })),
};
export default EVIDENCE;
