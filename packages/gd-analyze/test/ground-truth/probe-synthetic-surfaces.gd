#
# probe-synthetic-surfaces.gd — the OTHER half of the ground truth for `src/read/array-mesh.ts`.
#
# `probe-surface-arrays.gd` measures the decoder against the vendored game, which is the right
# evidence for the game — but that game authors exactly three formats and between them they
# exercise half of Godot's vertex layouts. Positions are always half-float there, normals are
# always the plain signed-byte form, and nothing in it carries a tangent, a vertex colour, a
# second UV set, a 16-bit bone index, an octahedral normal or a split vertex stream. A decoder
# whose remaining branches were written from the source and never run is a decoder with unproven
# code in it.
#
# So this probe has Godot BUILD the surfaces instead: one `ArrayMesh` per case, from arrays this
# script authors, through `add_surface_from_arrays(..., compress_flags)` — the exact writer whose
# inverse the decoder is. It then reads back BOTH sides of the same surface:
#
#   - `mesh.get("surfaces/0")`   the serialized dictionary, byte for byte, as a `.tscn` stores it
#   - `mesh.surface_get_arrays(0)`  what Godot itself decodes those bytes back to
#
# giving an input and an expected output for every branch, with no spec re-reading in between.
# `rendering/misc/mesh_storage/split_stream` is a project setting read live by `GLOBAL_GET` at
# surface-add time, so the split-stream case simply sets it before building and clears it after.
#
# HOW IT IS RUN (same scratchpad copy as the sibling probe; never against the byte-locked fixture):
#
#     <Godot 3.6>/Godot --path <scratch>/platformer-3d -s res://probe-synthetic-surfaces.gd
#     # -> <scratch>/platformer-3d/probe-synthetic-surfaces.json
#
# committed beside this file as `godot36-synthetic-surfaces.json`.

extends SceneTree

const OUT_PATH := "res://probe-synthetic-surfaces.json"

# Godot 3.6 `servers/visual_server.h`. `Mesh` re-exports most of these to GDScript, but not the
# octahedral flag, so the whole set is spelled numerically here rather than half one way.
const ARRAY_COMPRESS_VERTEX := 1 << 9
const ARRAY_COMPRESS_NORMAL := 1 << 10
const ARRAY_COMPRESS_TANGENT := 1 << 11
const ARRAY_COMPRESS_COLOR := 1 << 12
const ARRAY_COMPRESS_TEX_UV := 1 << 13
const ARRAY_COMPRESS_TEX_UV2 := 1 << 14
const ARRAY_COMPRESS_WEIGHTS := 1 << 16
const ARRAY_FLAG_USE_OCTAHEDRAL_COMPRESSION := 1 << 21

# The compress mask every mesh in the vendored platformer carries (98051 / 98067 / 98243 all
# share it): everything but the index, and no octahedral flag.
const PLATFORMER_COMPRESS := (
	ARRAY_COMPRESS_VERTEX
	| ARRAY_COMPRESS_NORMAL
	| ARRAY_COMPRESS_TANGENT
	| ARRAY_COMPRESS_COLOR
	| ARRAY_COMPRESS_TEX_UV
	| ARRAY_COMPRESS_TEX_UV2
	| ARRAY_COMPRESS_WEIGHTS
)

const SPLIT_STREAM_SETTING := "rendering/misc/mesh_storage/split_stream"


func _init() -> void:
	var cases := []
	# Attribute sets are named so a red test says which ATTRIBUTE broke, not just which case.
	cases.append(_case("uncompressed-all-attributes", "full", 0, false))
	cases.append(_case("compressed-vertex-only", "full", ARRAY_COMPRESS_VERTEX, false))
	cases.append(_case("platformer-compress-mask", "full", PLATFORMER_COMPRESS, false))
	cases.append(_case("compress-default-3.6", "full", Mesh.ARRAY_COMPRESS_DEFAULT, false))
	cases.append(
		_case(
			"octahedral-normal-and-tangent",
			"full",
			PLATFORMER_COMPRESS | ARRAY_FLAG_USE_OCTAHEDRAL_COMPRESSION,
			false
		)
	)
	cases.append(
		_case(
			"octahedral-normal-only",
			"no-tangent",
			PLATFORMER_COMPRESS | ARRAY_FLAG_USE_OCTAHEDRAL_COMPRESSION,
			false
		)
	)
	cases.append(_case("uncompressed-weights-and-bones", "skinned", ARRAY_COMPRESS_VERTEX, false))
	cases.append(_case("bones-over-255", "skinned-wide", PLATFORMER_COMPRESS, false))
	cases.append(_case("split-stream", "full", PLATFORMER_COMPRESS, true))

	var file := File.new()
	var err := file.open(OUT_PATH, File.WRITE)
	if err != OK:
		printerr("cannot open %s: %d" % [OUT_PATH, err])
		quit(1)
		return
	file.store_string(JSON.print({
		"godotVersion": Engine.get_version_info(),
		"cases": cases,
	}, "  "))
	file.close()
	print("wrote %d synthetic case(s) to %s" % [cases.size(), OUT_PATH])
	quit(0)


func _case(label: String, attribute_set: String, compress: int, split_stream: bool) -> Dictionary:
	var previous = ProjectSettings.get_setting(SPLIT_STREAM_SETTING)
	ProjectSettings.set_setting(SPLIT_STREAM_SETTING, split_stream)

	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, _arrays(attribute_set), [], compress)
	var stored: Dictionary = mesh.get("surfaces/0")
	var decoded: Array = mesh.surface_get_arrays(0)

	ProjectSettings.set_setting(SPLIT_STREAM_SETTING, previous)

	var vertex_count: int = decoded[Mesh.ARRAY_VERTEX].size()
	var samples := []
	for i in range(vertex_count):
		var sample := {"i": i, "vertex": _vec3(decoded[Mesh.ARRAY_VERTEX][i])}
		if decoded[Mesh.ARRAY_NORMAL] != null:
			sample["normal"] = _vec3(decoded[Mesh.ARRAY_NORMAL][i])
		if decoded[Mesh.ARRAY_TANGENT] != null:
			sample["tangent"] = _slice4(decoded[Mesh.ARRAY_TANGENT], i)
		if decoded[Mesh.ARRAY_COLOR] != null:
			var c: Color = decoded[Mesh.ARRAY_COLOR][i]
			sample["color"] = [_f(c.r), _f(c.g), _f(c.b), _f(c.a)]
		if decoded[Mesh.ARRAY_TEX_UV] != null:
			sample["uv"] = _vec2(decoded[Mesh.ARRAY_TEX_UV][i])
		if decoded[Mesh.ARRAY_TEX_UV2] != null:
			sample["uv2"] = _vec2(decoded[Mesh.ARRAY_TEX_UV2][i])
		if decoded[Mesh.ARRAY_BONES] != null:
			sample["bones"] = _slice4(decoded[Mesh.ARRAY_BONES], i)
		if decoded[Mesh.ARRAY_WEIGHTS] != null:
			sample["weights"] = _slice4(decoded[Mesh.ARRAY_WEIGHTS], i)
		samples.append(sample)

	var index_samples := []
	for i in range(decoded[Mesh.ARRAY_INDEX].size()):
		index_samples.append({"i": i, "value": decoded[Mesh.ARRAY_INDEX][i]})

	return {
		"label": label,
		"attributeSet": attribute_set,
		"requestedCompress": compress,
		"splitStream": split_stream,
		"format": stored["format"],
		"primitive": stored["primitive"],
		"vertexCount": stored["vertex_count"],
		"indexCount": stored["index_count"],
		"arrayData": Array(stored["array_data"]),
		"arrayIndexData": Array(stored["array_index_data"]),
		"samples": samples,
		"indexSamples": index_samples,
	}


# Six vertices, deliberately asymmetric in every component so a swapped axis or a swapped
# attribute cannot look correct. Values are chosen to survive half-float and signed-byte
# quantization without landing on a tie, so the expected output is not itself a rounding coin flip.
func _arrays(attribute_set: String) -> Array:
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)

	var vertices := PoolVector3Array([
		Vector3(-1.5, 0.25, 3.0),
		Vector3(2.0, -0.75, 0.5),
		Vector3(0.125, 4.5, -2.25),
		Vector3(-3.25, -1.125, 1.75),
		Vector3(0.5, 0.5, 0.5),
		Vector3(-0.0625, 6.75, -0.375),
	])
	arrays[Mesh.ARRAY_VERTEX] = vertices

	var normals := PoolVector3Array()
	for v in vertices:
		normals.append(v.normalized())
	arrays[Mesh.ARRAY_NORMAL] = normals

	if attribute_set != "no-tangent":
		var tangents := PoolRealArray()
		for i in range(vertices.size()):
			var t: Vector3 = normals[i].cross(Vector3(0, 1, 0.25)).normalized()
			tangents.append(t.x)
			tangents.append(t.y)
			tangents.append(t.z)
			tangents.append(1.0 if i % 2 == 0 else -1.0)
		arrays[Mesh.ARRAY_TANGENT] = tangents

	var colors := PoolColorArray()
	var uvs := PoolVector2Array()
	var uv2s := PoolVector2Array()
	for i in range(vertices.size()):
		colors.append(Color(i / 5.0, 1.0 - i / 5.0, 0.25, 0.75))
		uvs.append(Vector2(i / 5.0, 0.125 * i))
		uv2s.append(Vector2(0.75 - i / 8.0, i / 3.0))
	arrays[Mesh.ARRAY_COLOR] = colors
	arrays[Mesh.ARRAY_TEX_UV] = uvs
	arrays[Mesh.ARRAY_TEX_UV2] = uv2s

	if attribute_set.begins_with("skinned"):
		var bones := PoolIntArray()
		var weights := PoolRealArray()
		# `mesh_add_surface_from_arrays` picks 16-bit bone indices only when some index exceeds
		# 255, so one vertex here reaches past it in the "skinned-wide" set and nowhere else.
		var wide: bool = attribute_set == "skinned-wide"
		for i in range(vertices.size()):
			bones.append(300 if (wide and i == 2) else i)
			bones.append((i + 1) % 4)
			bones.append(0)
			bones.append(0)
			weights.append(0.5)
			weights.append(0.25)
			weights.append(0.125)
			weights.append(0.125)
		arrays[Mesh.ARRAY_BONES] = bones
		arrays[Mesh.ARRAY_WEIGHTS] = weights

	arrays[Mesh.ARRAY_INDEX] = PoolIntArray([0, 1, 2, 2, 3, 0, 4, 5, 1])
	return arrays


# See `probe-surface-arrays.gd`: every float leaves as an exactly round-tripping string.
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
