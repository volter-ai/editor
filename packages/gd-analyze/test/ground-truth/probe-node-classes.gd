#
# probe-node-classes.gd — the GROUND TRUTH generator for the nine 3D node classes
# `src/translate/scene3d.ts` gained a row for, and for the `[display]` fallback in
# `src/translate/project.ts`.
#
# Every row in `NODE_KINDS_3D` is a claim about what a Godot class IS, and the claims that decide
# whether a row CARRIES or REFUSES are claims about DEFAULTS and about COMPOSITION — neither of
# which a `.tscn` states. A `.tscn` that authors `freeze_bodies = false` says nothing about the
# OTHER enabler; a `project.godot` with no `[display]` section says nothing about the window it
# runs in; and a `Spatial` parented to a `WorldEnvironment` says nothing about whose transform it
# is composed with. Those are engine facts, and this asks the engine.
#
# HOW IT IS RUN (never against the repo fixture — Godot writes `.import/` and `*.import` sidecars
# into whatever project it opens, and `test/fixtures/platformer-3d/` is byte-locked):
#
#     cp -R packages/gd-analyze/test/fixtures/platformer-3d <scratch>/platformer-3d
#     cp packages/gd-analyze/test/ground-truth/probe-node-classes.gd <scratch>/platformer-3d/
#     <Godot 3.6>/Godot --path <scratch>/platformer-3d -s res://probe-node-classes.gd
#     # -> <scratch>/platformer-3d/probe-node-classes.json
#
# and the result is committed beside this file as `godot36-node-classes.json`, so
# `test/node-classes-3d.test.ts` is hermetic and CI needs no Godot.
#
# FOUR THINGS IT MEASURES, each one a row's load-bearing premise:
#
#  1. `projectSettings` — `ProjectSettings.get_setting("display/window/size/*")` on a project whose
#     `project.godot` declares NO `[display]` section, plus the size the root `Viewport` actually
#     comes up at. `core/project_settings.cpp` @ 3.6-stable registers the defaults at lines
#     1076-1079 (`GLOBAL_DEF("display/window/size/width", 1024)` / `height, 600`); this is that
#     registration observed from inside the running engine rather than transcribed from it, and
#     the viewport line is the separate question of whether the setting is what the game gets.
#
#  2. `classDefaults` — a freshly constructed instance of each of the nine classes, read back
#     through the property names the rows reason about. A row that refuses "because the default is
#     on" is only honest if the default IS on, and `VisibilityEnabler`'s two enablers are exactly
#     that case (`scene/3d/visibility_notifier.cpp`:405-411 sets both true in the constructor, so
#     a `.tscn` that turns ONE off leaves the other running).
#
#  3. `authoredNodes` — the fixture's own six `AudioStreamPlayer3D`s, two `RayCast`s, one
#     `VisibilityEnabler`, two `Skeleton`s, one `AnimationTree`, three `CPUParticles`, five
#     `ReflectionProbe`s and its `WorldEnvironment`, read as the ENGINE resolves them: the value
#     after Godot has applied the class default under every property the `.tscn` leaves out. That
#     is the difference between "this scene authors nothing here" and "this scene runs Godot's
#     default here", which a text reader cannot tell apart.
#
#  4. `nonSpatialParent` — a SYNTHESIZED three-node scene the fixture does not contain:
#     `Spatial(root, non-identity) -> Node -> Spatial(child, non-identity)`. Godot's
#     `Spatial::_notification(NOTIFICATION_ENTER_TREE)` (`scene/3d/spatial.cpp`:147-159) sets
#     `data.parent = Object::cast_to<Spatial>(get_parent())`, which is NULL when the parent is a
#     plain `Node`, and `get_global_transform` (:432-436) then returns the LOCAL transform
#     unchanged. Every emitter on this lane puts a non-`Spatial` Godot node in the three graph as
#     an `Object3D` (`Node` has been mapped that way since the table existed), where three
#     composes it with its ancestors unconditionally — so the two engines disagree the moment any
#     ancestor carries a transform. The fixture's own `Stage` root is identity, which makes the
#     disagreement invisible in it; this scene is what makes it visible.
#
# EVERY TRANSFORM LEAVES AS BEHAVIOUR, NOT AS STORAGE — the same rule `probe-gridmap.gd` states
# and for the same reason: a basis is dumped as the images of the three unit axes, because Godot's
# row-major storage, its column accessors and three's `Matrix4` disagree about what "the first
# three numbers" mean, and a row/column mix-up transposes every rotation while looking plausible.

extends SceneTree

const OUT_PATH := "res://probe-node-classes.json"

const SCENES := {
	"stage": "res://stage/stage.tscn",
	"coin": "res://coin/coin.tscn",
	"enemy": "res://enemy/enemy.tscn",
	"player": "res://player/player.tscn",
	"bullet": "res://player/bullet/bullet.tscn",
}

# The properties each row reasons about. Read off a default-constructed instance AND off every
# authored node of that class, so "authored" and "default" are the same shape and comparable.
const PROBED_PROPERTIES := {
	"VisibilityEnabler": ["freeze_bodies", "pause_animations", "aabb"],
	"VisibilityNotifier": ["aabb"],
	"RayCast": ["enabled", "cast_to", "exclude_parent", "collide_with_areas", "collide_with_bodies", "collision_mask"],
	"AudioStreamPlayer3D": ["unit_db", "unit_size", "max_db", "max_distance", "attenuation_model", "out_of_range_mode", "doppler_tracking", "autoplay", "bus", "pitch_scale"],
	"CPUParticles": ["emitting", "amount", "lifetime", "one_shot", "explosiveness", "emission_shape", "local_coords", "draw_order", "spread", "gravity", "initial_velocity", "scale_amount"],
	"RigidBody": ["mode", "mass", "custom_integrator", "contact_monitor", "contacts_reported", "gravity_scale"],
	"ReflectionProbe": ["intensity", "max_distance", "extents", "origin_offset", "box_projection", "interior_enable", "interior_ambient_color", "cull_mask"],
	"Skeleton": [],
	"AnimationTree": ["active", "anim_player"],
	"WorldEnvironment": [],
}


func _init() -> void:
	var out := {
		"godotVersion": Engine.get_version_info(),
		"projectSettings": _project_settings(),
		"classDefaults": _class_defaults(),
		"authoredNodes": _authored_nodes(),
		"nonSpatialParent": _non_spatial_parent(),
	}
	var file := File.new()
	file.open(OUT_PATH, File.WRITE)
	file.store_string(JSON.print(out, "  "))
	file.close()
	print("wrote ", OUT_PATH)
	quit()


# --- 1. the `[display]` fallback ------------------------------------------------------------------


func _project_settings() -> Dictionary:
	var root: Viewport = get_root()
	return {
		# `project.godot` in this fixture has no `[display]` section at all, so these are the
		# ENGINE's registered defaults, observed rather than transcribed.
		"declaresDisplaySection": _project_file_declares_display(),
		"displayWindowSizeWidth": ProjectSettings.get_setting("display/window/size/width"),
		"displayWindowSizeHeight": ProjectSettings.get_setting("display/window/size/height"),
		"displayWindowSizeTestWidth": ProjectSettings.get_setting("display/window/size/test_width"),
		"displayWindowSizeTestHeight": ProjectSettings.get_setting("display/window/size/test_height"),
		# The size the game actually renders at, which is the separate question from what the
		# setting says.
		"rootViewportSize": _vec2(root.size),
	}


# Re-read `project.godot` as TEXT, because `ProjectSettings` cannot distinguish a declared value
# from a default one and the whole point of the number above is that this project declares none.
func _project_file_declares_display() -> bool:
	var file := File.new()
	if file.open("res://project.godot", File.READ) != OK:
		return true # fail toward "declared", so a broken read never reads as evidence of absence
	var text := file.get_as_text()
	file.close()
	return text.find("[display]") != -1


# --- 2. class defaults ----------------------------------------------------------------------------


func _class_defaults() -> Dictionary:
	var out := {}
	for class_name_string in PROBED_PROPERTIES.keys():
		var instance = ClassDB.instance(class_name_string)
		if instance == null:
			out[class_name_string] = null
			continue
		out[class_name_string] = _read_properties(instance, PROBED_PROPERTIES[class_name_string])
		if instance is Node:
			instance.free()
	return out


func _read_properties(object: Object, names: Array) -> Dictionary:
	var out := {}
	for name in names:
		out[name] = _value(object.get(name))
	return out


# --- 3. the fixture's own nodes -------------------------------------------------------------------


func _authored_nodes() -> Dictionary:
	var out := {}
	for key in SCENES.keys():
		var packed: PackedScene = load(SCENES[key])
		var root: Node = packed.instance()
		# The nodes have to be IN a tree for `get_global_transform` to answer, and Godot asserts on
		# it (`spatial.cpp`:425). The probe's own root is the tree root, so the scene's root node
		# is the top of the transform chain exactly as it is at runtime.
		get_root().add_child(root)
		var nodes := []
		_walk(root, root, nodes)
		out[key] = {"scene": SCENES[key], "nodes": nodes}
		get_root().remove_child(root)
		root.free()
	return out


func _walk(node: Node, root: Node, into: Array) -> void:
	var entry := {
		"path": String(root.get_path_to(node)),
		"class": node.get_class(),
		"isSpatial": node is Spatial,
	}
	if node is Spatial:
		entry["transform"] = _transform(node.get_transform())
		entry["globalTransform"] = _transform(node.get_global_transform())
		# The one fact that decides whether an emitter may treat this node as placement-free.
		entry["transformIsIdentity"] = node.get_transform() == Transform()
	if PROBED_PROPERTIES.has(node.get_class()):
		entry["properties"] = _read_properties(node, PROBED_PROPERTIES[node.get_class()])
	if node is Skeleton:
		var bones := []
		for i in range(node.get_bone_count()):
			bones.append({
				"name": node.get_bone_name(i),
				"parent": node.get_bone_parent(i),
				"rest": _transform(node.get_bone_rest(i)),
			})
		entry["bones"] = bones
	if node is AnimationTree:
		var tree_root = node.tree_root
		entry["treeRootClass"] = "" if tree_root == null else tree_root.get_class()
		entry["parameters"] = _animation_tree_parameters(node)
	if node is AnimationPlayer:
		entry["animations"] = node.get_animation_list()
	if node is WorldEnvironment:
		entry["environment"] = _environment(node.environment)
	into.append(entry)
	for i in range(node.get_child_count()):
		var child: Node = node.get_child(i)
		# Do not descend into an INSTANCED subtree: `stage.tscn` instances the coin 45 times and
		# the enemy 5, and 45 identical copies of one node's properties is a dump nobody reads.
		# Each of those scenes is walked on its own above. This is the same skip Godot's own
		# `VisibilityEnabler::_find_nodes` makes (`scene/3d/visibility_notifier.cpp`:303-307).
		if child.get_filename() != "":
			continue
		_walk(child, root, into)


func _animation_tree_parameters(tree: AnimationTree) -> Array:
	var out := []
	for property in tree.get_property_list():
		var name: String = property["name"]
		if name.begins_with("parameters/"):
			out.append({"name": name, "value": _value(tree.get(name))})
	return out


func _environment(environment: Environment) -> Dictionary:
	if environment == null:
		return {}
	var sky = environment.background_sky
	return {
		"backgroundMode": environment.background_mode,
		"backgroundSkyClass": "" if sky == null else sky.get_class(),
		"backgroundSkyPanorama": "" if sky == null or not (sky is PanoramaSky) or sky.panorama == null else sky.panorama.resource_path,
		"tonemapMode": environment.tonemap_mode,
		"tonemapWhite": _f(environment.tonemap_white),
		"ambientLightColor": _value(environment.ambient_light_color),
		"ambientLightEnergy": _f(environment.ambient_light_energy),
	}


# --- 4. a Spatial whose PARENT is not a Spatial ---------------------------------------------------


# Built in code rather than authored as a `.tscn`, because the fixture is byte-locked and this is
# a scene it deliberately does not contain. `ROOT_BASIS` is a plain 90-degree turn about Y with a
# translation, chosen so that composing it with the child's own transform gives a visibly
# different answer from not composing it.
func _non_spatial_parent() -> Dictionary:
	var root := Spatial.new()
	root.set_transform(Transform(Basis(Vector3(0, 1, 0), PI / 2.0), Vector3(10, 0, 0)))

	var plain := Node.new()
	root.add_child(plain)

	var under_plain := Spatial.new()
	under_plain.set_transform(Transform(Basis(), Vector3(0, 0, 3)))
	plain.add_child(under_plain)

	# The control: the same child, parented DIRECTLY to the Spatial root.
	var under_spatial := Spatial.new()
	under_spatial.set_transform(Transform(Basis(), Vector3(0, 0, 3)))
	root.add_child(under_spatial)

	get_root().add_child(root)
	var out := {
		"rootTransform": _transform(root.get_transform()),
		"underPlainNodeLocal": _transform(under_plain.get_transform()),
		"underPlainNodeGlobal": _transform(under_plain.get_global_transform()),
		"underSpatialGlobal": _transform(under_spatial.get_global_transform()),
	}
	get_root().remove_child(root)
	root.free()
	return out


# --- shared value encoding ------------------------------------------------------------------------


func _transform(transform: Transform) -> Dictionary:
	return {
		"basisX": _vec3(transform.basis.xform(Vector3(1, 0, 0))),
		"basisY": _vec3(transform.basis.xform(Vector3(0, 1, 0))),
		"basisZ": _vec3(transform.basis.xform(Vector3(0, 0, 1))),
		"origin": _vec3(transform.origin),
	}


func _vec3(v: Vector3) -> Array:
	return [_f(v.x), _f(v.y), _f(v.z)]


func _vec2(v: Vector2) -> Array:
	return [_f(v.x), _f(v.y)]


# Every float leaves as a STRING at 17 decimals, the rule every dump in this directory follows and
# `probe-surface-arrays.gd` records: `JSON.print` renders a real at ~6 significant digits, which
# would force an epsilon comparison and stop measuring the last bits.
func _f(value: float) -> String:
	return "%.17f" % value


func _value(value):
	if value is Vector3:
		return _vec3(value)
	if value is Vector2:
		return _vec2(value)
	if value is Color:
		return [_f(value.r), _f(value.g), _f(value.b), _f(value.a)]
	if value is AABB:
		return {"position": _vec3(value.position), "size": _vec3(value.size)}
	if value is NodePath:
		return String(value)
	if value is Resource:
		return {"class": value.get_class(), "path": value.resource_path}
	if value is float:
		return _f(value)
	return value
