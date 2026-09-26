#
# probe-canvas-overlay.gd — the GROUND TRUTH generator for `src/translate/target.ts`'s
# WORLD-vs-OVERLAY split, and for the `TouchScreenButton` deviation `src/translate/scene3d.ts`
# records.
#
# The question this answers is the one the `.tscn` cannot: `player.tscn` parents four
# `TouchScreenButton`s (a `Node2D`) directly under a `KinematicBody` (a `Spatial`), and the editor's
# tree view shows them as children of the 3D player. WHAT DOES THE ENGINE ACTUALLY DO WITH THEM —
# which canvas do they attach to, in which coordinate space, at which draw order, and are they
# visible in this game at all?
#
# HOW IT IS RUN (never against the repo fixture — Godot writes `.import/` and `*.import` sidecars
# into whatever project it opens, and `test/fixtures/platformer-3d/` is byte-locked):
#
#     cp -R packages/gd-analyze/test/fixtures/platformer-3d <scratch>/platformer-3d
#     cp packages/gd-analyze/test/ground-truth/probe-canvas-overlay.gd <scratch>/platformer-3d/
#     <Godot 3.6>/Godot --path <scratch>/platformer-3d --editor --quit   # imports; see below
#     <Godot 3.6>/Godot --path <scratch>/platformer-3d -s res://probe-canvas-overlay.gd
#     # -> <scratch>/platformer-3d/probe-canvas-overlay.json
#
# THE `--editor --quit` LINE IS NOT OPTIONAL HERE, unlike for this directory's other probes. Those
# read documents; this one RENDERS, and a `.png` reaches a frame only through `.import/`, which the
# editor writes and `-s` does not — a `-s` run against an unimported copy hangs instead of saying
# so. It takes seconds and then the probe is ordinary.
#
# and the result is committed beside this file as `godot36-canvas-overlay.json`, so
# `test/canvas-overlay.test.ts` is hermetic and CI needs no Godot.
#
# FOUR MEASUREMENTS, and each is a question a re-reading of the file format cannot settle.
#
# (1) THE CANVAS ATTACHMENT. `CanvasItem::_enter_canvas` (`scene/2d/canvas_item.cpp`:519-546 @
#     3.6-stable) branches on whether the PARENT is a `CanvasItem`. When it is not — which is
#     exactly this case, the parent being a `KinematicBody` — the item walks up for a `CanvasLayer`,
#     finds none, and attaches to `get_viewport()->find_world_2d()->get_canvas()`: the viewport's
#     own root canvas. So the probe asks each button for `get_canvas()` and compares it to the
#     viewport's World2D canvas RID. Nothing about that is inferable from the tree view.
#
# (2) THE COORDINATE SPACE, measured as INDEPENDENCE rather than asserted. Because the item is not
#     parented to a canvas item, no `Spatial` transform composes into it. The probe reads each
#     button's `global_position` with the player at the origin and again with the player translated
#     and rotated in 3D, and records both. Equal means viewport coordinates; the `.tscn`'s
#     `position = Vector2(72, 301)` is a screen position.
#
# (3) IS IT VISIBLE IN THIS GAME AT ALL. All four buttons author `visibility_mode = 1`, which is
#     `VISIBILITY_TOUCHSCREEN_ONLY`. `TouchScreenButton::_notification`
#     (`scene/2d/touch_screen_button.cpp`:118-165 @ 3.6-stable) returns early from BOTH
#     `NOTIFICATION_DRAW` and `NOTIFICATION_ENTER_TREE` when that mode is set and
#     `OS::has_touchscreen_ui_hint()` is false — so the node draws nothing AND never reaches its
#     `set_process_input(...)` call, making it inert as well as invisible. The probe records
#     `OS.has_touchscreen_ui_hint()`, `is_visible_in_tree()` (still TRUE — the `visible` property is
#     untouched, which is why reading it would give the wrong answer) and `is_processing_input()`.
#
#     And it MEASURES the drawing rather than trusting the source read: three frames are captured
#     from a real viewport — the scene as authored, the same scene with `visibility_mode` flipped to
#     `VISIBILITY_ALWAYS`, and that second one with the player moved in 3D — and the pixel diffs are
#     reported as bounding boxes. Authored-vs-ALWAYS differing exactly at four rects is the
#     touchscreen gate suppressing the draw; ALWAYS-vs-moved-player differing NOWHERE is (2) again,
#     seen from the rasteriser.
#
# (4) WHAT THE PROJECT ACTUALLY DECLARES. Each button names an input `action`, and
#     `InputMap.has_action` is the engine's own answer to whether that action exists — the probe
#     asks for all four and dumps every event bound to them, because an action a keyboard already
#     drives is the difference between "this control is the only way to play" and "this control is a
#     touch alternative to a binding the port already emits". `project.godot` also declares no
#     `[display]` section at all, so `ProjectSettings.get_setting("display/window/size/width")` is
#     asked for the ENGINE'S OWN default rather than one being picked here, and the live
#     `get_viewport().size` is recorded beside it.
#
# THE RENDER PASSES USE THE REAL `player.tscn`, so the buttons sit under the real `KinematicBody`
# with the real `Camera` drawing a real 3D frame behind them. Its SCRIPT is detached
# (`set_script(null)`) and its two animation nodes are stopped before the instance enters the tree:
# `player.gd` drives itself from a stage that is not mounted here, and a frame that also moved a
# skeleton would put gameplay pixels in a diff that is asking about four buttons.

extends SceneTree

const PLAYER := "res://player/player.tscn"
const OUT_PATH := "res://probe-canvas-overlay.json"
const BUTTON_PATHS := ["Forward", "Backward", "Left", "Right"]

# Godot 3.6 `TouchScreenButton::VisibilityMode`, spelled here so the dump carries the NAME and not
# only the integer (`scene/2d/touch_screen_button.h`).
const VISIBILITY_MODE_NAMES := ["VISIBILITY_ALWAYS", "VISIBILITY_TOUCHSCREEN_ONLY"]

var _frames := 0
var _stage := 0
var _player: Node = null
var _shots := {}
var _out := {}


func _init() -> void:
	_out["godotVersion"] = Engine.get_version_info()["string"]
	_out["os"] = {
		"name": OS.get_name(),
		"hasTouchscreenUiHint": OS.has_touchscreen_ui_hint(),
	}

	# (4) The window the engine itself runs this project at. `project.godot` declares no `[display]`
	# section, so these are ProjectSettings' own defaults, read from the engine rather than picked.
	_out["window"] = {
		"projectGodotDeclaresDisplaySection": false,
		"settingWidth": ProjectSettings.get_setting("display/window/size/width"),
		"settingHeight": ProjectSettings.get_setting("display/window/size/height"),
		"settingTestWidth": ProjectSettings.get_setting("display/window/size/test_width"),
		"settingTestHeight": ProjectSettings.get_setting("display/window/size/test_height"),
	}

	_player = load(PLAYER).instance()
	_player.set_script(null)
	_player.get_node("AnimationTree").active = false
	_player.get_node("AnimationPlayer").playback_active = false
	get_root().add_child(_player)
	connect("idle_frame", self, "_on_idle_frame")

	_out["window"]["viewportSize"] = _vec2(get_root().size)
	_out["viewportWorld2dCanvasId"] = int(get_root().find_world_2d().get_canvas().get_id())

	var buttons := []
	for path in BUTTON_PATHS:
		buttons.append(_describe(path))
	_out["buttons"] = buttons

	# (2) The same read again, with the player somewhere else entirely in 3D. A canvas item that
	# composed its Spatial ancestors would move; one attached to the viewport canvas cannot.
	_player.transform = Transform(Basis(Vector3(0.3, 0.7, 0.1)), Vector3(37.0, -12.0, 91.0))
	var moved := []
	for path in BUTTON_PATHS:
		var node: Node2D = _player.get_node(path)
		moved.append({
			"path": path,
			"globalPosition": _vec2(node.global_position),
			"globalTransformOrigin": _vec2(node.get_global_transform().origin),
		})
	_out["buttonsWithPlayerMovedInThreeD"] = moved
	_player.transform = Transform.IDENTITY


## One button, as the ENGINE answers for it.
func _describe(path: String) -> Dictionary:
	var node: Node2D = _player.get_node(path)
	var parent: Node = node.get_parent()
	var texture: Texture = node.normal

	# Walk to the viewport the way `_enter_canvas` does, recording whether a `CanvasLayer` is found
	# on the way. None here — which is why the attachment lands on the viewport's own canvas.
	var layer_ancestor = null
	var walk: Node = node
	while walk != null:
		if walk is CanvasLayer:
			layer_ancestor = walk.get_path()
			break
		if walk is Viewport:
			break
		walk = walk.get_parent()

	return {
		"path": path,
		"class": node.get_class(),
		"parentPath": parent.get_path(),
		"parentClass": parent.get_class(),
		"parentIsCanvasItem": parent is CanvasItem,
		"parentIsSpatial": parent is Spatial,
		"canvasId": int(node.get_canvas().get_id()),
		"canvasIsViewportWorld2d": node.get_canvas() == get_root().find_world_2d().get_canvas(),
		"canvasLayerAncestor": layer_ancestor,
		"position": _vec2(node.position),
		"globalPosition": _vec2(node.global_position),
		"globalTransformOrigin": _vec2(node.get_global_transform().origin),
		"visibilityMode": node.visibility_mode,
		"visibilityModeName": VISIBILITY_MODE_NAMES[node.visibility_mode],
		"visible": node.visible,
		"visibleInTree": node.is_visible_in_tree(),
		"processingInput": node.is_processing_input(),
		"passbyPress": node.passby_press,
		"shapeCentered": node.shape_centered,
		"action": node.action,
		"actionDeclaredInInputMap": InputMap.has_action(node.action),
		"actionEvents": _action_events(node.action),
		"normalTexturePath": "" if texture == null else texture.resource_path,
		"normalTextureSize": [0, 0] if texture == null else _vec2(texture.get_size()),
	}


## Every event bound to an action, by CLASS plus the one field that identifies it. An action the
## keyboard already drives is why a dropped touch control is not a dropped capability.
func _action_events(action: String) -> Array:
	if not InputMap.has_action(action):
		return []
	var out := []
	for event in InputMap.get_action_list(action):
		if event is InputEventKey:
			out.append({"class": "InputEventKey", "scancode": event.scancode})
		elif event is InputEventJoypadButton:
			out.append({"class": "InputEventJoypadButton", "buttonIndex": event.button_index})
		elif event is InputEventJoypadMotion:
			out.append({"class": "InputEventJoypadMotion", "axis": event.axis})
		elif event is InputEventMouseButton:
			out.append({"class": "InputEventMouseButton", "buttonIndex": event.button_index})
		else:
			out.append({"class": event.get_class()})
	return out


# Three captures, a few frames apart so the importer and the first draw have settled:
#   0 -> "authored"      the scene exactly as `player.tscn` writes it
#   1 -> "always"        `visibility_mode = VISIBILITY_ALWAYS` on all four
#   2 -> "alwaysMoved"   the same, with the player somewhere else in 3D
func _on_idle_frame() -> void:
	_frames += 1
	if _frames < 30:
		return
	if _stage == 0:
		_shots["authored"] = _capture()
		for path in BUTTON_PATHS:
			_player.get_node(path).visibility_mode = 0
		_stage = 1
		_frames = 0
		return
	if _stage == 1:
		_shots["always"] = _capture()
		_player.transform = Transform(Basis(Vector3(0.3, 0.7, 0.1)), Vector3(37.0, -12.0, 91.0))
		_stage = 2
		_frames = 0
		return

	_shots["alwaysMoved"] = _capture()
	_out["render"] = {
		"size": [_shots["authored"].get_width(), _shots["authored"].get_height()],
		"authoredVsAlways": _diff(_shots["authored"], _shots["always"]),
		"alwaysVsAlwaysMoved": _diff(_shots["always"], _shots["alwaysMoved"]),
	}
	_write()
	quit()


func _capture() -> Image:
	VisualServer.force_draw()
	var image: Image = get_root().get_texture().get_data()
	image.flip_y()
	return image


## Where two frames differ, as disjoint bounding boxes. `TouchScreenButton` draws its texture with
## `draw_texture(texture, Point2())` (`touch_screen_button.cpp`:136), so a box whose top-left is the
## node's own `position` is the anchor convention measured rather than assumed.
func _diff(a: Image, b: Image) -> Dictionary:
	# Byte arrays rather than `get_pixel`: this walks 614,400 pixels three times, and a `Color`
	# allocated per pixel turns a measurement into a wait.
	var wide := a.get_width()
	var high := a.get_height()
	var da := a.get_data()
	var db := b.get_data()
	var stride := da.size() / (wide * high)
	var changed := 0
	var seeds := []
	for y in range(high):
		var row := y * wide * stride
		for x in range(wide):
			var i := row + x * stride
			var same := true
			for c in range(stride):
				if da[i + c] != db[i + c]:
					same = false
					break
			if same:
				continue
			changed += 1
			var placed := false
			for box in seeds:
				# Grow an existing box when the pixel touches it (with a small slack, so an
				# antialiased gap inside one texture does not split it into two).
				if x >= box[0] - 4 and x <= box[2] + 4 and y >= box[1] - 4 and y <= box[3] + 4:
					box[0] = min(box[0], x)
					box[1] = min(box[1], y)
					box[2] = max(box[2], x)
					box[3] = max(box[3], y)
					placed = true
					break
			if not placed:
				seeds.append([x, y, x, y])

	var boxes := []
	var bounds = null
	for box in seeds:
		boxes.append({
			"x": box[0],
			"y": box[1],
			"width": box[2] - box[0] + 1,
			"height": box[3] - box[1] + 1,
		})
		if bounds == null:
			bounds = [box[0], box[1], box[2], box[3]]
		else:
			bounds[0] = min(bounds[0], box[0])
			bounds[1] = min(bounds[1], box[1])
			bounds[2] = max(bounds[2], box[2])
			bounds[3] = max(bounds[3], box[3])
	boxes.sort_custom(self, "_by_origin")
	# `bounds` is the answer to read: the per-pixel boxes are grown GREEDILY in scan order, so a
	# pixel that seeded its own box before the growing one reached it stays a nested duplicate. The
	# overall extent is what a claim about WHERE the difference is can be made from.
	return {
		"changedPixels": changed,
		"bounds": null if bounds == null else {
			"x": bounds[0],
			"y": bounds[1],
			"width": bounds[2] - bounds[0] + 1,
			"height": bounds[3] - bounds[1] + 1,
		},
		"boxes": boxes,
	}


func _by_origin(a: Dictionary, b: Dictionary) -> bool:
	if a["y"] != b["y"]:
		return a["y"] < b["y"]
	return a["x"] < b["x"]


func _vec2(v) -> Array:
	return [float(v.x), float(v.y)]


func _write() -> void:
	var file := File.new()
	var err := file.open(OUT_PATH, File.WRITE)
	if err != OK:
		push_error("could not open %s: %d" % [OUT_PATH, err])
		return
	file.store_string(JSON.print(_out, "  "))
	file.close()
	print("WROTE ", OUT_PATH)
