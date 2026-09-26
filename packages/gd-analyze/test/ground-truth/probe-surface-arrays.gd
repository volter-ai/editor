#
# probe-surface-arrays.gd — the GROUND TRUTH generator for `src/read/array-mesh.ts`.
#
# Godot itself owns the only authoritative answer about what an `ArrayMesh` surface's
# `array_data` bytes mean: `ArrayMesh.surface_get_arrays(i)` hands back the DECOMPRESSED
# arrays, because `VisualServer::_get_array_from_surface` is the inverse of the writer that
# produced those bytes. So the decoder is not checked against a re-reading of the same spec
# it was written from — it is checked against the engine.
#
# HOW IT IS RUN (never against the repo fixture — Godot writes `.import/` and `*.import`
# sidecars into whatever project it opens, and `test/fixtures/platformer-3d/` is byte-locked):
#
#     cp -R packages/gd-analyze/test/fixtures/platformer-3d <scratch>/platformer-3d
#     cp packages/gd-analyze/test/ground-truth/probe-surface-arrays.gd <scratch>/platformer-3d/
#     <Godot 3.6>/Godot --path <scratch>/platformer-3d -s res://probe-surface-arrays.gd
#     # -> <scratch>/platformer-3d/probe-surface-arrays.json
#
# and the result is committed beside this file as `godot36-surface-arrays.json`, so
# `test/array-mesh.test.ts` is hermetic and CI needs no Godot.
#
# WHAT IT EMITS. One record per (document, mesh, surface), each carrying a LOCATOR the test
# resolves back to the `sub_resource` id the decoder is handed — a node path for a `.tscn`,
# an item id for a `MeshLibrary`, `resource` for a `.tres` that IS the mesh. Correlating by
# name/vertex-count would be ambiguous: `stage/tiles.tres` holds three unnamed 4-vertex
# surfaces.
#
# VERTICES ARE SAMPLED, not dumped whole: a full dump of `player.tscn`'s two skinned surfaces
# alone is ~1,300 vertices x 14 numbers. The sample is deterministic (see `_sample_indices`)
# and always includes both ends, which is where an off-by-one stride or a missed attribute
# offset shows up first.

extends SceneTree

const ARRAY_VERTEX := 0
const ARRAY_NORMAL := 1
const ARRAY_TANGENT := 2
const ARRAY_COLOR := 3
const ARRAY_TEX_UV := 4
const ARRAY_TEX_UV2 := 5
const ARRAY_BONES := 6
const ARRAY_WEIGHTS := 7
const ARRAY_INDEX := 8

# Every document in the fixture that authors an inline `ArrayMesh`, covering all three of the
# formats the project uses: 98051 (coin, bullet), 98067 (the MeshLibrary tiles, floor_mesh)
# and 98243 (the two skinned characters).
const SCENES := [
	"res://coin/coin.tscn",
	"res://player/bullet/bullet.tscn",
	"res://enemy/enemy.tscn",
	"res://player/player.tscn",
	"res://stage/tiles.tscn",
]
const MESH_LIBRARIES := ["res://stage/tiles.tres"]
const MESH_RESOURCES := ["res://stage/floor_mesh.tres"]

const OUT_PATH := "res://probe-surface-arrays.json"


func _init() -> void:
	var records := []
	for res_path in SCENES:
		var packed: PackedScene = load(res_path)
		var root: Node = packed.instance()
		_walk(root, root, res_path, records)
		root.free()
	for res_path in MESH_LIBRARIES:
		var library: MeshLibrary = load(res_path)
		for item_id in library.get_item_list():
			var mesh: Mesh = library.get_item_mesh(item_id)
			if mesh == null or not (mesh is ArrayMesh):
				continue
			_record(mesh, res_path, {"kind": "meshLibraryItem", "itemId": item_id}, records)
	for res_path in MESH_RESOURCES:
		var mesh: Mesh = load(res_path)
		if mesh is ArrayMesh:
			_record(mesh, res_path, {"kind": "resource"}, records)

	var file := File.new()
	var err := file.open(OUT_PATH, File.WRITE)
	if err != OK:
		printerr("cannot open %s: %d" % [OUT_PATH, err])
		quit(1)
		return
	file.store_string(JSON.print({
		"godotVersion": Engine.get_version_info(),
		"splitStream": ProjectSettings.get_setting("rendering/misc/mesh_storage/split_stream"),
		"surfaces": records,
	}, "  "))
	file.close()
	print("wrote %d surface record(s) to %s" % [records.size(), OUT_PATH])
	quit(0)


func _walk(node: Node, root: Node, res_path: String, records: Array) -> void:
	if node is MeshInstance and node.mesh != null and node.mesh is ArrayMesh:
		var node_path := "." if node == root else String(root.get_path_to(node))
		_record(node.mesh, res_path, {"kind": "node", "path": node_path}, records)
	for child in node.get_children():
		_walk(child, root, res_path, records)


func _record(mesh: ArrayMesh, res_path: String, locator: Dictionary, records: Array) -> void:
	for surface in range(mesh.get_surface_count()):
		var arrays: Array = mesh.surface_get_arrays(surface)
		var vertices: PoolVector3Array = arrays[ARRAY_VERTEX]
		var vertex_count := vertices.size()
		var indices = arrays[ARRAY_INDEX]
		var index_count := 0 if indices == null else indices.size()

		var samples := []
		for i in _sample_indices(vertex_count):
			var sample := {"i": i, "vertex": _vec3(vertices[i])}
			if arrays[ARRAY_NORMAL] != null:
				sample["normal"] = _vec3(arrays[ARRAY_NORMAL][i])
			if arrays[ARRAY_TANGENT] != null:
				sample["tangent"] = _slice4(arrays[ARRAY_TANGENT], i)
			if arrays[ARRAY_COLOR] != null:
				var c: Color = arrays[ARRAY_COLOR][i]
				sample["color"] = [_f(c.r), _f(c.g), _f(c.b), _f(c.a)]
			if arrays[ARRAY_TEX_UV] != null:
				sample["uv"] = _vec2(arrays[ARRAY_TEX_UV][i])
			if arrays[ARRAY_TEX_UV2] != null:
				sample["uv2"] = _vec2(arrays[ARRAY_TEX_UV2][i])
			if arrays[ARRAY_BONES] != null:
				sample["bones"] = _slice4(arrays[ARRAY_BONES], i)
			if arrays[ARRAY_WEIGHTS] != null:
				sample["weights"] = _slice4(arrays[ARRAY_WEIGHTS], i)
			samples.append(sample)

		var index_samples := []
		for i in _sample_indices(index_count):
			index_samples.append({"i": i, "value": indices[i]})

		records.append({
			"resPath": res_path,
			"locator": locator,
			"surface": surface,
			"resourceName": mesh.resource_name,
			"format": mesh.surface_get_format(surface),
			"primitive": mesh.surface_get_primitive_type(surface),
			"vertexCount": vertex_count,
			"indexCount": index_count,
			"samples": samples,
			"indexSamples": index_samples,
		})


# Deterministic and end-inclusive: everything up to 24, otherwise both ends plus a fixed stride
# through the middle. An off-by-one in the stride shows up at the LAST vertex, so the tail is
# not optional.
func _sample_indices(count: int) -> Array:
	if count <= 0:
		return []
	if count <= 24:
		var all := []
		for i in range(count):
			all.append(i)
		return all
	var picked := {}
	for i in range(8):
		picked[i] = true
		picked[count - 1 - i] = true
	var step := int(count / 8)
	for k in range(8):
		picked[k * step] = true
	var out := picked.keys()
	out.sort()
	return out


# EVERY float leaves as a STRING, and that is the difference between a measurement and an
# impression. `JSON.print` renders a real with ~6 significant digits (0.1910400390625 comes out
# "0.19104"), which would force the comparison to a 1e-6 tolerance and quietly stop measuring the
# last four bits of every half-float. 17 decimal places round-trip the float32 EXACTLY, so
# `test/array-mesh.test.ts` compares bit patterns and states a tolerance of zero.
func _f(v: float) -> String:
	return "%.17f" % v


func _vec3(v: Vector3) -> Array:
	return [_f(v.x), _f(v.y), _f(v.z)]


func _vec2(v: Vector2) -> Array:
	return [_f(v.x), _f(v.y)]


func _slice4(flat, i: int) -> Array:
	var out := []
	for k in range(4):
		var value = flat[i * 4 + k]
		out.append(value if typeof(value) == TYPE_INT else _f(value))
	return out
