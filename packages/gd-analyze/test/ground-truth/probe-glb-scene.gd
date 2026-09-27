#
# probe-glb-scene.gd — the GROUND TRUTH generator for `src/read/gltf/`, the lane-local reader that
# opens a `.glb` AS A SCENE.
#
# ## Why this probe exists
#
# A `.glb` in a Godot project is not a scene the way a `.tscn` is a scene. Godot's
# `ResourceImporterScene` reads the glTF document and BUILDS a node tree out of it, and the tree it
# builds is not the glTF's node list: it synthesizes a `Skeleton3D` for every glTF skin, REPARENTS
# every skinned `MeshInstance3D` under that skeleton (leaving the glTF node that carried the mesh
# behind as nothing), synthesizes one `AnimationPlayer` holding every glTF animation as an
# `Animation` with Godot-spelled track paths, applies a root node whose name and class come from the
# `.import` sidecar rather than from the document, and renames every node through a sanitizer that
# no part of the glTF spec describes.
#
# Every one of those is a transform the reader has to reproduce, and every one of them is
# SILENTLY PLAUSIBLE if reproduced wrong — a bone list in the wrong order, a skeleton parented one
# level too high, or a track path spelled `Skeleton3D:bone` where Godot writes `%Skeleton3D:bone`
# all produce a tree that looks like a scene and resolves the wrong overrides. So the reader is not
# validated against the glTF spec (which does not describe any of this) and not against Godot's
# source (which describes intent, not output). It is validated against the tree the real engine
# actually produces, node for node.
#
# ## HOW IT IS RUN (never against the repo fixture — Godot writes `.godot/` and `*.import` into
# whatever project it opens, and `test/fixtures/**` is byte-locked by `verify-unaltered.mjs`)
#
#     cp -R packages/gd-analyze/test/fixtures/<fixture> <scratch>/<fixture>
#     cp packages/gd-analyze/test/ground-truth/probe-glb-scene.gd <scratch>/<fixture>/
#     <Godot 4.7>/Godot --headless --path <scratch>/<fixture> --import      # builds .godot/imported/
#     <Godot 4.7>/Godot --headless --path <scratch>/<fixture> -s res://probe-glb-scene.gd
#     # -> <scratch>/<fixture>/probe-glb-scene.json
#
# and the result is committed beside this file as `godot47-glb-scene-<fixture>.json`, so
# `test/glb-scene-read.test.ts` is hermetic and nothing in the repo needs Godot to run.
#
# The regen driver is `test/ground-truth/regenerate-glb-scene.ts`, which does exactly the four
# lines above for both fixtures in ONE editor boot each and writes both JSONs.
#
# ## THE BINARY THIS WAS RUN WITH, and why the version is not a detail
#
# `Godot_v4.7-stable_macos.universal`, `4.7.stable.official.5b4e0cb0f`. Verified to be the same
# engine the lane's pinned API dump came from by DUMPING IT: `--headless --dump-extension-api`
# produced a file whose sha256 is `53d37f85…c00943`, byte-identical to
# `vendor/extension-api/godot-4.7-extension_api.json.sha256`. That is the check that matters —
# `--version` agreeing is a string, an identical dump is the same engine.
#
# The importer's output is version-specific in ways that are not announced (4.0 named the
# synthesized skeleton after the glTF skin; later versions name it `Skeleton3D`; the `%`-prefixed
# unique-name spelling in animation track paths arrived with scene-unique names). Re-running this
# against a different 4.x therefore measures a different oracle, which is why the header records
# the build hash and the test names the file.
#
# ## WHAT IT DUMPS, and why each field is here
#
# Per `.glb` in the project, the tree `load(<path>).instantiate()` produces:
#
#  - `name` / `class` / `path` — the tree's shape and the classes the census reads. `path` is the
#    node path RELATIVE TO THE INSTANTIATED ROOT, spelled the way a `.tscn`'s `parent=` spells it,
#    because resolving a `.tscn` override against this tree is the entire consumer.
#  - `transform` — `Transform3D` basis rows + origin, NOT position/rotation/scale. Godot's
#    decomposition of a basis with negative or sheared scale is lossy and its Euler order is a
#    choice; the basis is the value the engine holds.
#  - `mesh` — surface count, per-surface material name and `resource_path`, and the mesh's own
#    resource name. A `.tscn` override addressing a `MeshInstance3D` inside the glb is resolved by
#    NAME, but what it overrides is a material, so the material identity has to be in the oracle.
#  - `skin` / `skeleton` — the `MeshInstance3D`'s `skeleton` NodePath and its `Skin`'s bind count.
#    This is the reparenting transform's observable: get it wrong and the mesh hangs off the node
#    the glTF authored instead of the skeleton Godot built.
#  - `bones` — for every `Skeleton3D`, each bone's name, parent index and rest `Transform3D`. The
#    ORDER is the oracle: glTF skin joints are a list of node indices and Godot's bone indices are
#    its own, so "same set of bones" is not the same claim as "same bone list".
#  - `animations` — for every `AnimationPlayer`, each clip's name, length, loop mode, step, and
#    every track's type, `path` (the exact NodePath string, `:` subpath included), interpolation
#    and key count. Track paths are how an `AnimationPlayer` override in a `.tscn` finds anything.
#  - `owner` — whether the node is owned by the instantiated scene. A node with no owner is one
#    Godot built but did not put in the PackedScene, and a `.tscn` cannot address it.
#
# Floats are rounded to 6 decimals. Godot writes `float` doubles here but the values came through
# single-precision glTF accessors and a single-precision importer, so digits past ~7 significant
# figures are noise that would make an otherwise-correct reader fail parity on a different CPU.
#

# Godot runs `-s` scripts as the MainLoop, so the probe IS a `SceneTree`; `_init` runs before the
# loop starts and `quit()` ends it without a single frame.
extends SceneTree

const FLOAT_DP := 6


func _round(v: float) -> float:
	return snappedf(v, pow(10.0, -FLOAT_DP))


func _vec3(v: Vector3) -> Array:
	return [_round(v.x), _round(v.y), _round(v.z)]


func _transform(t: Transform3D) -> Dictionary:
	# Basis rows as Godot itself indexes them (`basis.x` is the FIRST COLUMN in Godot's
	# column-major storage but prints as row 0 of `[b.x, b.y, b.z]` — dumped as the three
	# basis vectors by their own names so no reader has to guess a convention).
	return {
		"basis_x": _vec3(t.basis.x),
		"basis_y": _vec3(t.basis.y),
		"basis_z": _vec3(t.basis.z),
		"origin": _vec3(t.origin),
	}


func _material(m: Material) -> Dictionary:
	if m == null:
		return {"null": true}
	return {
		"class": m.get_class(),
		"resource_name": m.resource_name,
		"resource_path": m.resource_path,
	}


func _mesh_info(mi: MeshInstance3D) -> Dictionary:
	var mesh := mi.mesh
	if mesh == null:
		return {"null": true}
	var surfaces: Array = []
	for i in range(mesh.get_surface_count()):
		surfaces.append(
			{
				"index": i,
				"material": _material(mesh.surface_get_material(i)),
				"override": _material(mi.get_surface_override_material(i)),
			}
		)
	return {
		"class": mesh.get_class(),
		"resource_name": mesh.resource_name,
		"surface_count": mesh.get_surface_count(),
		"surfaces": surfaces,
	}


func _skeleton_info(sk: Skeleton3D) -> Array:
	var bones: Array = []
	for i in range(sk.get_bone_count()):
		bones.append(
			{
				"index": i,
				"name": sk.get_bone_name(i),
				"parent": sk.get_bone_parent(i),
				"rest": _transform(sk.get_bone_rest(i)),
			}
		)
	return bones


func _animation_info(player: AnimationPlayer) -> Array:
	var clips: Array = []
	for clip_name in player.get_animation_list():
		var anim := player.get_animation(clip_name)
		var tracks: Array = []
		for t in range(anim.get_track_count()):
			tracks.append(
				{
					"index": t,
					"type": anim.track_get_type(t),
					"path": str(anim.track_get_path(t)),
					"interpolation": anim.track_get_interpolation_type(t),
					"key_count": anim.track_get_key_count(t),
				}
			)
		clips.append(
			{
				"name": clip_name,
				"length": _round(anim.length),
				"loop_mode": anim.loop_mode,
				"step": _round(anim.step),
				"track_count": anim.get_track_count(),
				"tracks": tracks,
			}
		)
	return clips


func _walk(node: Node, root: Node, out: Array) -> void:
	var entry := {
		"name": node.name,
		"class": node.get_class(),
		"path": "." if node == root else str(root.get_path_to(node)),
		"owned": node.owner == root or node == root,
		"unique_name_in_owner": node.unique_name_in_owner,
	}
	if node is Node3D:
		entry["transform"] = _transform((node as Node3D).transform)
		entry["visible"] = (node as Node3D).visible
	if node is MeshInstance3D:
		var mi := node as MeshInstance3D
		entry["mesh"] = _mesh_info(mi)
		entry["skeleton_path"] = str(mi.skeleton)
		entry["skin_bind_count"] = -1 if mi.skin == null else mi.skin.get_bind_count()
	if node is Skeleton3D:
		entry["bones"] = _skeleton_info(node as Skeleton3D)
	if node is AnimationPlayer:
		var ap := node as AnimationPlayer
		entry["root_node"] = str(ap.root_node)
		entry["animations"] = _animation_info(ap)
	out.append(entry)
	for child in node.get_children():
		_walk(child, root, out)


func _collect_glb(dir_path: String, found: Array) -> void:
	var dir := DirAccess.open(dir_path)
	if dir == null:
		return
	dir.list_dir_begin()
	var entry := dir.get_next()
	while entry != "":
		if entry.begins_with("."):
			entry = dir.get_next()
			continue
		var full := dir_path.path_join(entry)
		if dir.current_is_dir():
			_collect_glb(full, found)
		elif entry.get_extension().to_lower() in ["glb", "gltf"]:
			found.append(full)
		entry = dir.get_next()
	dir.list_dir_end()


func _init() -> void:
	var paths: Array = []
	_collect_glb("res://", paths)
	paths.sort()

	var scenes: Array = []
	for res_path in paths:
		var packed: PackedScene = load(res_path)
		if packed == null:
			scenes.append({"res_path": res_path, "error": "load returned null"})
			continue
		var root := packed.instantiate()
		var nodes: Array = []
		_walk(root, root, nodes)
		scenes.append({"res_path": res_path, "node_count": nodes.size(), "nodes": nodes})
		root.free()

	var out := {
		"godot_version": Engine.get_version_info(),
		"probe": "probe-glb-scene.gd",
		"float_decimal_places": FLOAT_DP,
		"scene_count": scenes.size(),
		"scenes": scenes,
	}
	var f := FileAccess.open("res://probe-glb-scene.json", FileAccess.WRITE)
	f.store_string(JSON.stringify(out, "\t", false))
	f.close()
	print("wrote probe-glb-scene.json for ", scenes.size(), " scene(s)")
	quit()
