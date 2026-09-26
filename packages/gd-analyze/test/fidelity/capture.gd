# F3 — the GROUND-TRUTH capture, run inside the source engine's own build.
#
#   godot --headless --path <sourceProject> -s <this file> -- --out <trace.json>
#
# The same derivation rule as the port driver (unity-analyze/test/fidelity/
# drive.ts): the steps come from the project's OWN InputMap — every non-ui_
# action, sorted — pressed one at a time for a fixed count of PHYSICS TICKS.
# Sampling is tick-anchored (never wall-anchored): each boundary is "after
# exactly N physics frames", so a slow machine produces the same trace as a
# fast one. The RNG is seeded with the same fixed seed the port driver plays
# with, so a script reading randi() diverges only where semantics do.
#
# What a sample holds is the tree the engine itself reports: every node's
# path, class, and (for Node3D) global position — the projection surface the
# cross-engine comparator maps port traces onto.
extends SceneTree

const DRIVE_SEED := 20260821
const SETTLE_TICKS := 60
const HOLD_TICKS := 30

var _out_path := ""
var _steps: Array = []
var _samples: Array = []
var _phase := 0
var _step_index := -1
var _ticks_left := 0
var _booted := false

func _init() -> void:
	var args := OS.get_cmdline_user_args()
	for i in args.size():
		if args[i] == "--out" and i + 1 < args.size():
			_out_path = args[i + 1]
	if _out_path == "":
		push_error("capture.gd: pass -- --out <trace.json>")
		quit(2)
		return
	seed(DRIVE_SEED)

func _sample_tree() -> Array:
	var rows: Array = []
	var stack: Array = [root]
	while not stack.is_empty():
		var node: Node = stack.pop_back()
		var row := {
			"path": String(root.get_path_to(node)) if node != root else ".",
			"type": node.get_class(),
		}
		if node is Node3D:
			var origin: Vector3 = (node as Node3D).global_transform.origin
			row["position"] = [origin.x, origin.y, origin.z]
		rows.append(row)
		for child in node.get_children():
			stack.append(child)
	rows.sort_custom(func(a, b): return a["path"] < b["path"])
	return rows

func _take_sample() -> void:
	_samples.append({
		"tick": Engine.get_physics_frames(),
		"scene": current_scene.scene_file_path if current_scene != null else null,
		"nodes": _sample_tree(),
	})

func _derive_steps() -> void:
	var names: Array = []
	for action in InputMap.get_actions():
		var name := String(action)
		if not name.begins_with("ui_"):
			names.append(name)
	names.sort()
	for name in names:
		_steps.append(name)

func _process(_delta: float) -> bool:
	# A `-s` SceneTree script replaces the main loop, so the project's OWN
	# main scene is not loaded automatically — load exactly the scene the
	# project declares, on the first frame.
	if not _booted:
		if current_scene == null:
			if _phase == 0:
				_phase = 1
				# `change_scene_to_file` refuses under `-s` (measured: err 19),
				# so mount the declared main scene by hand — the same load,
				# instantiate, adopt sequence it performs.
				var main: String = ProjectSettings.get_setting("application/run/main_scene")
				var packed: PackedScene = load(main)
				if packed == null:
					push_error("capture.gd: could not load main scene %s" % main)
					quit(3)
					return false
				var mounted := packed.instantiate()
				root.add_child(mounted)
				current_scene = mounted
			return false
		_booted = true
		_derive_steps()
		# SETTLE_TICKS, not +1: the scene mounts during a `_process`, and the NEXT engine
		# iteration runs its physics BEFORE this script's counting resumes — so the mounted
		# scene always gets ONE physics tick this countdown never sees. Measured: with a +1
		# here the truth's whole trajectory ran one tick ahead of its own window grid (the
		# respawn's threshold crossing landed on window-relative tick 21 where the port
		# driver's landed on 22), and every event-coupled window read as divergent. The
		# uncounted mount tick plus this countdown puts the boot sample after exactly
		# SETTLE_TICKS scene ticks, matching the port driver's settle.
		_ticks_left = SETTLE_TICKS
	return false

# Drive actions with INPUT EVENTS, never Input.action_press: measured on this build, a direct
# action_press from a SceneTree script makes `is_action_pressed` true the SAME tick but
# `is_action_just_pressed` only the NEXT tick — so a just_pressed-gated mechanic (jump) got a
# 29-tick window while polled movement got 30, and the port's jump arc read one tick longer
# than the truth's (the 0.363-vs-0.271 finding). A parsed event lands `pressed` and
# `just_pressed` TOGETHER on the tick after it is sent, matching the port driver's virtual
# input, so every mechanic sees the same 30-tick window.
func _send_action(name: String, pressed: bool) -> void:
	var ev := InputEventAction.new()
	ev.action = name
	ev.pressed = pressed
	Input.parse_input_event(ev)

# The tick geometry (tree callbacks run BEFORE node callbacks each tick, measured): an event
# sent at tree tick E takes effect at node tick E+1, so the RELEASE of window n and the PRESS
# of window n+1 are sent on the SAME tick — windows ABUT with no dead tick between them. This
# matters: a dead tick still runs physics, so mid-air it accrued one extra gravity tick per
# boundary and the truth's fall ran one tick of velocity ahead of the port's (measured: the
# whole move_forward window's per-tick deltas were the same 25/3600 series shifted by one).
# The sample at the boundary tick runs before that tick's node processing, so it captures the
# state after EXACTLY the window's 30th held tick, before the next window's first.
func _physics_process(_delta: float) -> bool:
	if not _booted:
		return false
	if _ticks_left > 0:
		_ticks_left -= 1
		if _ticks_left == 1:
			if _step_index >= 0 and _step_index < _steps.size():
				_send_action(_steps[_step_index], false)
			if _step_index + 1 < _steps.size():
				_send_action(_steps[_step_index + 1], true)
		if _ticks_left > 0:
			return false
	# A window just closed: sample, then count the next (its press is already in flight).
	_take_sample()
	_step_index += 1
	if _step_index >= _steps.size():
		_finish()
		return true
	_ticks_left = HOLD_TICKS
	return false

func _finish() -> void:
	var trace := {
		"schema": "vgai-fidelity-ground-truth@1",
		"engine": "Godot %s" % Engine.get_version_info()["string"],
		"script": {"seed": DRIVE_SEED, "settleTicks": SETTLE_TICKS, "holdTicks": HOLD_TICKS, "steps": _steps},
		"samples": _samples,
	}
	var out := FileAccess.open(_out_path, FileAccess.WRITE)
	out.store_string(JSON.stringify(trace, " ", true))
	out.close()
	quit(0)
