#
# probe-gridmap.gd — the GROUND TRUTH generator for `src/read/grid-map.ts` and for the `GridMap`
# half of `src/translate/scene-module-3d.ts`.
#
# The question this answers is the one no amount of re-reading the file format settles: given
# `stage.tscn`'s `data.cells` PoolIntArray and `stage/tiles.tres`, WHERE does Godot actually put
# each tile, and WHICH tile is it? `GridMap.get_meshes()` is the engine's own answer — it composes
# exactly the transform `_octant_update` renders with (`modules/gridmap/grid_map.cpp` @ 3.6-stable,
# and the two call sites are line-for-line identical), so the decoder is checked against the engine
# rather than against a second reading of the spec it was written from.
#
# HOW IT IS RUN (never against the repo fixture — Godot writes `.import/` and `*.import` sidecars
# into whatever project it opens, and `test/fixtures/platformer-3d/` is byte-locked):
#
#     cp -R packages/gd-analyze/test/fixtures/platformer-3d <scratch>/platformer-3d
#     cp packages/gd-analyze/test/ground-truth/probe-gridmap.gd <scratch>/platformer-3d/
#     <Godot 3.6>/Godot --path <scratch>/platformer-3d -s res://probe-gridmap.gd
#     # -> <scratch>/platformer-3d/probe-gridmap.json
#
# and the result is committed beside this file as `godot36-gridmap.json`, so
# `test/grid-map.test.ts` is hermetic and CI needs no Godot.
#
# EVERY TRANSFORM LEAVES AS BEHAVIOUR, NOT AS STORAGE. A basis is dumped as the images of the three
# unit axes (`basis.xform(Vector3(1, 0, 0))` and its two siblings) rather than as its `elements`,
# because Godot's row-major storage, its `Basis.x`/`y`/`z` column accessors and three's `Matrix4`
# disagree about what "the first three numbers" mean, and a row/column mix-up transposes every
# rotation while looking entirely plausible. An image-of-an-axis means the same thing in both
# engines.
#
# THE ORTHOGONAL-BASIS TABLE IS MEASURED, NOT COPIED. `Basis::set_orthogonal_index` indexes a
# private 24-entry table in `core/math/basis.cpp`; its inverse `get_orthogonal_index()` IS bound to
# GDScript, so the table is recovered by asking the engine which index each of the 24 signed axis
# permutations with determinant +1 carries. That is the same table `_octant_update` rotates a cell
# with, obtained from the engine that owns it.
#
# THE OUTPUT IS COMPACT AND THE CELLS ARE FLAT, unlike this directory's other two dumps. 2,598
# cells is the whole point of the fixture, and `JSON.print`'s indent puts every array element on
# its own line: the same content pretty-printed is 2.3 MB, nine tenths of it whitespace. The stride
# is declared in `cellStride` rather than implied.
#
# THE PER-CELL BASIS IS RECORDED ONCE PER ORIENTATION, AND THE DEDUPLICATION IS VERIFIED HERE
# rather than assumed by the reader: `get_meshes()` is asked for all 2,598 composed transforms, and
# `basisMismatches` counts every cell whose basis differs from the one recorded for its
# orientation. A non-zero count is a dump that must not be trusted, and the test asserts it is zero.

extends SceneTree

const STAGE := "res://stage/stage.tscn"
const GRID_MAP_PATH := "GridMap"
const MESH_LIBRARY := "res://stage/tiles.tres"
const OUT_PATH := "res://probe-gridmap.json"


func _init() -> void:
	var packed: PackedScene = load(STAGE)
	var root: Node = packed.instance()
	var grid: GridMap = root.get_node(GRID_MAP_PATH)

	# `get_meshes()` hands back [Transform, Mesh, Transform, Mesh, …] — the composed per-cell
	# transform the renderer uses. Keyed by ORIGIN, which is unique per cell (the origin is a
	# strictly increasing function of the cell coordinate).
	var placement_by_origin := {}
	var meshes: Array = grid.get_meshes()
	var i := 0
	while i < meshes.size():
		var xform: Transform = meshes[i]
		placement_by_origin[_origin_key(xform.origin)] = xform
		i += 2

	var used: Array = grid.get_used_cells()
	var cells := []
	var placement_bases := {}
	var placement_basis_keys := {}
	var basis_mismatches := 0
	var origin_mismatches := 0
	var missing_placements := 0
	for cell in used:
		var x := int(cell.x)
		var y := int(cell.y)
		var z := int(cell.z)
		var world: Vector3 = grid.map_to_world(x, y, z)
		var orientation: int = grid.get_cell_item_orientation(x, y, z)
		var key := _origin_key(world)
		if placement_by_origin.has(key):
			var placed: Transform = placement_by_origin[key]
			var basis := _basis(placed.basis)
			# Compared as a STRING, deliberately: Godot 3's `Dictionary ==` is reference equality,
			# so comparing the two dictionaries directly would report every cell as a mismatch and
			# a `!=` would report none — the check has to be over values it cannot alias.
			var basis_key := _basis_key(basis)
			var slot := str(orientation)
			if placement_basis_keys.has(slot):
				if placement_basis_keys[slot] != basis_key:
					basis_mismatches += 1
			else:
				placement_basis_keys[slot] = basis_key
				placement_bases[slot] = basis
			# `map_to_world` and the composed placement must agree on the origin; both are the
			# same expression in `grid_map.cpp` and a divergence would mean one of them moved.
			if _origin_key(placed.origin) != key:
				origin_mismatches += 1
		else:
			missing_placements += 1
		cells.append(x)
		cells.append(y)
		cells.append(z)
		cells.append(grid.get_cell_item(x, y, z))
		cells.append(orientation)
		cells.append(_f(world.x))
		cells.append(_f(world.y))
		cells.append(_f(world.z))

	var library: MeshLibrary = load(MESH_LIBRARY)
	var items := []
	for item_id in library.get_item_list():
		var mesh: Mesh = library.get_item_mesh(item_id)
		var shapes: Array = library.get_item_shapes(item_id)
		var shape_records := []
		var s := 0
		while s < shapes.size():
			var shape = shapes[s]
			var shape_xform: Transform = shapes[s + 1]
			var faces: PoolVector3Array = shape.get_faces()
			var flat := []
			for f in faces:
				flat.append(_f(f.x))
				flat.append(_f(f.y))
				flat.append(_f(f.z))
			shape_records.append({
				"class": shape.get_class(),
				"transform": _xform(shape_xform),
				"faceVertexCount": faces.size(),
				"faces": flat,
			})
			s += 2
		items.append({
			"id": item_id,
			"name": library.get_item_name(item_id),
			"meshTransform": _xform(library.get_item_mesh_transform(item_id)),
			"meshSurfaceCount": 0 if mesh == null else mesh.get_surface_count(),
			"shapes": shape_records,
		})

	# `Basis::set_orthogonal_index`'s table, recovered through its bound inverse.
	var ortho := []
	for _k in range(24):
		ortho.append(null)
	for basis in _signed_axis_permutations():
		var index: int = basis.get_orthogonal_index()
		ortho[index] = _basis(basis)

	var file := File.new()
	var err := file.open(OUT_PATH, File.WRITE)
	if err != OK:
		printerr("cannot open %s: %d" % [OUT_PATH, err])
		quit(1)
		return
	file.store_string(JSON.print({
		"godotVersion": Engine.get_version_info(),
		"gridMap": {
			"resPath": STAGE,
			"nodePath": GRID_MAP_PATH,
			"transform": _xform(grid.transform),
			"cellSize": _vec3(grid.cell_size),
			"cellScale": _f(grid.cell_scale),
			"cellOctantSize": grid.cell_octant_size,
			"cellCenterX": grid.cell_center_x,
			"cellCenterY": grid.cell_center_y,
			"cellCenterZ": grid.cell_center_z,
			"meshLibrary": MESH_LIBRARY,
			"cellCount": used.size(),
		},
		"cellStride": ["x", "y", "z", "item", "orientation", "originX", "originY", "originZ"],
		"cells": cells,
		# `GridMap.get_meshes()`'s composed basis, once per ORIENTATION the level uses, with
		# `cell_scale` already applied. `basisMismatches` is what makes the deduplication a
		# measurement: it counts cells whose own composed basis differed from this one.
		"placementBases": placement_bases,
		"basisMismatches": basis_mismatches,
		"originMismatches": origin_mismatches,
		"missingPlacements": missing_placements,
		"meshLibrary": {"resPath": MESH_LIBRARY, "items": items},
		"orthogonalBases": ortho,
		"spatialMaterialDefaults": _spatial_material_defaults(),
	}))
	file.close()
	print("wrote %d cell(s), %d library item(s), %d basis mismatch(es) to %s" % [
		used.size(), items.size(), basis_mismatches, OUT_PATH
	])
	root.free()
	quit(0)


# The 24 orientation-preserving signed axis permutations, as bases. Brute-forced rather than
# listed: the point is to learn Godot's INDEX for each, not to assert an order.
func _signed_axis_permutations() -> Array:
	var axes := [Vector3(1, 0, 0), Vector3(0, 1, 0), Vector3(0, 0, 1)]
	var out := []
	for a in range(3):
		for b in range(3):
			if b == a:
				continue
			for c in range(3):
				if c == a or c == b:
					continue
				for sa in [1, -1]:
					for sb in [1, -1]:
						for sc in [1, -1]:
							# Columns: the images of x, y and z. Godot's 3-Vector3 `Basis`
							# constructor takes ROWS, so the transpose is built explicitly.
							var col_x: Vector3 = axes[a] * sa
							var col_y: Vector3 = axes[b] * sb
							var col_z: Vector3 = axes[c] * sc
							var basis := Basis(
								Vector3(col_x.x, col_y.x, col_z.x),
								Vector3(col_x.y, col_y.y, col_z.y),
								Vector3(col_x.z, col_y.z, col_z.z)
							)
							if abs(basis.determinant() - 1.0) < 0.001:
								out.append(basis)
	return out


# Godot 3.6's own defaults for the two texture-channel selectors, read off a live material. They
# decide whether three's `metalnessMap` (which samples BLUE) and `roughnessMap` (GREEN) can carry a
# Godot metallic/roughness texture at all.
func _spatial_material_defaults() -> Dictionary:
	var material := SpatialMaterial.new()
	return {
		"metallic_texture_channel": material.get("metallic_texture_channel"),
		"roughness_texture_channel": material.get("roughness_texture_channel"),
		"uv1_scale": _vec3(material.get("uv1_scale")),
		"uv1_offset": _vec3(material.get("uv1_offset")),
	}


# A transform as BEHAVIOUR: where the origin lands, and where the three unit axes land.
func _xform(t: Transform) -> Dictionary:
	return {"origin": _vec3(t.origin), "basis": _basis(t.basis)}


func _basis(b: Basis) -> Dictionary:
	return {
		"xImage": _vec3(b.xform(Vector3(1, 0, 0))),
		"yImage": _vec3(b.xform(Vector3(0, 1, 0))),
		"zImage": _vec3(b.xform(Vector3(0, 0, 1))),
	}


# A basis, as an exact key. See the mismatch counter for why this is a string.
func _basis_key(basis: Dictionary) -> String:
	return "%s/%s/%s" % [
		PoolStringArray(basis["xImage"]).join("|"),
		PoolStringArray(basis["yImage"]).join("|"),
		PoolStringArray(basis["zImage"]).join("|"),
	]


# An origin, as an exact key. Two distinct cells can never collide here: `map_to_world` is affine
# and strictly monotone in each coordinate.
func _origin_key(v: Vector3) -> String:
	return "%.17f|%.17f|%.17f" % [v.x, v.y, v.z]


# Every float leaves as a STRING at 17 decimals, for the reason `probe-surface-arrays.gd` records:
# `JSON.print` renders a real at ~6 significant digits, which would force an epsilon comparison and
# stop measuring the last bits. 17 decimals round-trip a float32 exactly.
func _f(v: float) -> String:
	return "%.17f" % v


func _vec3(v: Vector3) -> Array:
	return [_f(v.x), _f(v.y), _f(v.z)]
