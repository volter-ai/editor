#
# probe-physics-state.gd — the GROUND TRUTH generator for the 3D PHYSICS-STATE requisition:
# `PhysicsDirectBodyState`, `PhysicsDirectSpaceState.intersect_ray`, `PhysicsServer` /
# `World.get_space`, and `RigidBody.set_mode`/`MODE_*`.
#
# THE QUESTION THIS ANSWERS is the one that decides whether the surface is expressible at all:
# `enemy.gd` drives its whole walk cycle from inside `_integrate_forces(state)`, and the name says
# "inside the solver". WHEN does Godot actually call it, what has already happened to the body by
# then, and what does a write to `state.set_linear_velocity()` change? Reading `step_sw.cpp` gives
# an answer; only the engine settles it, so this dump records the values a script SEES, step by
# step, for a body whose entire integrator is the script (`custom_integrator = true`, which
# `enemy.tscn` authors).
#
# HOW IT IS RUN (never against the repo fixture — Godot writes `.import/` and `*.import` sidecars
# into whatever project it opens, and `test/fixtures/platformer-3d/` is byte-locked):
#
#     cp -R packages/gd-analyze/test/fixtures/platformer-3d <scratch>/platformer-3d
#     cp packages/gd-analyze/test/ground-truth/probe-physics-state.gd <scratch>/platformer-3d/
#     <Godot 3.6>/Godot --path <scratch>/platformer-3d -s res://probe-physics-state.gd
#     # -> <scratch>/platformer-3d/probe-physics-state.json
#
# and the result is committed beside this file as `godot36-physics-state.json`, so
# `test/physics-state-3d.test.ts` is hermetic and CI needs no Godot.
#
# WHAT IS PROBED, AND WHAT IS DELIBERATELY NOT. The probe body runs `enemy.gd`'s INTEGRATOR IDIOM
# and not its walk cycle:
#
#     var delta = state.get_step()
#     var lv = state.get_linear_velocity()
#     var g = state.get_total_gravity()
#     lv += g * delta
#     state.set_linear_velocity(lv)
#
# — which is `enemy.gd:17-19,24,72` with the steering removed. The steering is `Basis`/`Transform`
# arithmetic, i.e. the SPATIAL TRANSFORM requisition's surface, not this one's; folding it in would
# make every number here depend on a second unshipped backend and measure nothing about the state
# object. What the idiom above isolates is exactly the thing a port can get wrong invisibly: the
# FRAME a write lands in.
#
# DETERMINISM. Nothing here draws a random number, reads a clock, or depends on frame pacing. The
# scene is built from primitives in `_init` (no `.tscn`, no imported asset, no `.import` sidecar
# needed), `physics/common/physics_fps` is the project's own 60, and the dump is keyed on the
# physics ITERATION COUNT (`_iteration` is the physics tick), so a slow machine records the same
# numbers as a fast one. The probe quits itself at a fixed iteration count.
#
# FLOATS LEAVE AT 17 DECIMALS, as this directory's other dumps do, so the comparison in the test is
# float-exact rather than epsilon-fuzzy where it can be.
#
# THE FOUR PHASES, each isolating one thing:
#
#   1. FREE FALL (`freeFall`) — a custom-integrator body with nothing to touch. No solver
#      participation at all, so every number is the script's own arithmetic plus Godot's transform
#      integration, and a port that lands the velocity write in the wrong frame diverges on step 1.
#      This is also where `get_total_gravity()`'s documented "returns zero for the first few frames"
#      is measured rather than believed.
#   2. RESTING (`resting`) — the same body dropped onto a static box floor, recorded until it
#      settles. This is the only phase whose numbers involve the SOLVER, and it is here for the
#      contact array: `get_contact_count()` and the SIGN and FRAME of `get_contact_local_normal()`.
#   3. RAYS (`rays`) — `PhysicsServer.space_get_direct_state(get_world().get_space())` and three
#      `intersect_ray` calls against the same static box: a hit, a miss, and a hit with the box's
#      own body excluded. Pure geometry, so a port reproduces these exactly.
#   4. MODES (`modes`) — the `RigidBody.MODE_*` enum's own integer values (the script writes
#      `set_mode(MODE_RIGID)`, and the number behind that name is not guessable), plus what
#      switching a MODE_CHARACTER body to MODE_RIGID does to a body that is then given an angular
#      velocity: CHARACTER zeroes the inertia tensor, so the answer is whether it tumbles.

extends SceneTree

const OUT_PATH := "res://probe-physics-state.json"

# Long enough for the falling body to land on the floor and settle, short enough to stay a small
# committed file. The floor is 6 m below the drop and gravity is the project's 14 m/s^2.
const FREE_FALL_STEPS := 12
const MODE_STEPS := 10
const RESTING_STEPS := 90

var _iterations := 0
var _out := {}

var _fall_body: RigidBody
var _fall_log := []

var _rest_body: RigidBody
var _rest_log := []

var _mode_body: RigidBody
var _mode_log := []

var _character_body: RigidBody
var _character_log := []

# The probe body's script, built in memory so this file stays the whole probe — a second `.gd` on
# disk would be a second thing to keep in step with the comment above that describes it. This IS
# `enemy.gd`'s integrator idiom (`:17-19`, `:24`, `:72`), with a `seen` meta recorded first so the
# test can compare what the SCRIPT was handed, not what the node looked like afterwards.
#
# EVERY WRITE HAPPENS THROUGH THE STATE OBJECT, INSIDE THE CALLBACK, which is not a stylistic
# choice: `RigidBody::_direct_state_changed` (scene/3d/physics_body.cpp:355-372) caches the state
# singleton in a member and never clears it, so `node.angular_velocity = v` from OUTSIDE the
# callback goes through a `PhysicsDirectBodyState` whose `body` pointer belongs to whichever body
# ran the LAST callback. An earlier revision of this probe set the spin that way and measured a
# body that never turned. `enemy.gd:39` writes through the state object, so the probe does too, and
# the dump measures the member this order actually implements.
const INTEGRATOR_SOURCE := """
extends RigidBody

func _integrate_forces(state):
	var delta = state.get_step()
	var lv = state.get_linear_velocity()
	var g = state.get_total_gravity()

	var normals = []
	var names = []
	for i in range(state.get_contact_count()):
		normals.append(_v3(state.get_contact_local_normal(i)))
		var cc = state.get_contact_collider_object(i)
		names.append(cc.name if cc else null)

	var written = lv + g * delta
	set_meta("seen", {
		"step": _f(delta),
		"totalGravity": _v3(g),
		"linearVelocity": _v3(lv),
		"linearVelocityWritten": _v3(written),
		"contactCount": state.get_contact_count(),
		"contactLocalNormals": normals,
		"contactColliderNames": names,
		"mode": mode,
		"angularVelocity": _v3(state.get_angular_velocity()),
		"upAxisImage": _v3(state.get_transform().basis.xform(Vector3(0, 1, 0))),
	})
	state.set_linear_velocity(written)

	# `enemy.gd:37-39` verbatim, minus the bullet test: flip the mode, then spin.
	if has_meta("spin"):
		if get_meta("switchToRigid"):
			set_mode(MODE_RIGID)
		state.set_angular_velocity(get_meta("spin"))
		remove_meta("spin")

func _v3(v):
	return [_f(v.x), _f(v.y), _f(v.z)]

func _f(value):
	return "%.17f" % value
"""


func _init() -> void:
	var root := get_root()

	# One static floor, shared by the resting phase and the ray phase. A 20x1x20 box whose TOP face
	# is exactly y = 0, so every expected value below is a whole number a reader can check by hand.
	var floor_body := StaticBody.new()
	floor_body.name = "Floor"
	floor_body.transform = Transform(Basis(), Vector3(0, -0.5, 0))
	var floor_shape := CollisionShape.new()
	var floor_box := BoxShape.new()
	floor_box.extents = Vector3(10, 0.5, 10)
	floor_shape.shape = floor_box
	floor_body.add_child(floor_shape)
	root.add_child(floor_body)

	# An Area standing in for the game's `coin.tscn` pickups, so the ray phase can measure whether
	# Godot's `intersect_ray` sees a sensor by default. It is placed where a ray can only reach it
	# by passing through it first, well away from the floor.
	var area := Area.new()
	area.name = "PickupArea"
	area.transform = Transform(Basis(), Vector3(0, 3, 30))
	var area_shape := CollisionShape.new()
	var area_box := BoxShape.new()
	area_box.extents = Vector3(1, 1, 1)
	area_shape.shape = area_box
	area.add_child(area_shape)
	root.add_child(area)

	# A small static box floating over the floor at (6, 3, 6), so the ray that starts INSIDE the
	# floor has something to reach if Godot skips the shape it began in. Off the x = z = 0 column
	# every other ray uses.
	var blocker := StaticBody.new()
	blocker.name = "RayBlocker"
	blocker.transform = Transform(Basis(), Vector3(6, 3, 6))
	var blocker_shape := CollisionShape.new()
	var blocker_box := BoxShape.new()
	blocker_box.extents = Vector3(0.5, 0.5, 0.5)
	blocker_shape.shape = blocker_box
	blocker.add_child(blocker_shape)
	root.add_child(blocker)

	_fall_body = _make_probe_body("FreeFall", Vector3(-40, 6, 0))
	root.add_child(_fall_body)

	# On the floor but OFF the ray columns, so the ray phase measures the static geometry it means
	# to and not a body that happens to be falling through it.
	_rest_body = _make_probe_body("Resting", Vector3(-5, 2, -5))
	root.add_child(_rest_body)

	# The mode phase's body is a CHARACTER exactly as `enemy.tscn` authors it, parked far from
	# everything else so nothing touches it.
	_mode_body = _make_probe_body("Modes", Vector3(40, 6, 0))
	root.add_child(_mode_body)

	_character_body = _make_probe_body("CharacterControl", Vector3(80, 6, 0))
	root.add_child(_character_body)

	_out["godotVersion"] = Engine.get_version_info()
	_out["physicsFps"] = Engine.get_iterations_per_second()
	_out["projectGravity"] = _v3(
		ProjectSettings.get_setting("physics/3d/default_gravity") *
		ProjectSettings.get_setting("physics/3d/default_gravity_vector")
	)
	_out["modes"] = {
		"MODE_RIGID": RigidBody.MODE_RIGID,
		"MODE_STATIC": RigidBody.MODE_STATIC,
		"MODE_CHARACTER": RigidBody.MODE_CHARACTER,
		"MODE_KINEMATIC": RigidBody.MODE_KINEMATIC,
	}


# A RigidBody configured the way `enemy.tscn`'s `Enemy` node is: MODE_CHARACTER, the script as the
# whole integrator, contact reporting on with Godot's own five slots, and frictionless like the
# enemy's `PhysicsMaterial`. The shape is a unit sphere so the resting contact normal is
# unambiguous.
func _make_probe_body(p_name: String, p_at: Vector3) -> RigidBody:
	var script := GDScript.new()
	script.source_code = INTEGRATOR_SOURCE
	script.reload()

	var body := RigidBody.new()
	body.set_script(script)
	body.name = p_name
	body.mode = RigidBody.MODE_CHARACTER
	body.custom_integrator = true
	body.contact_monitor = true
	body.contacts_reported = 5
	body.can_sleep = false
	var material := PhysicsMaterial.new()
	material.friction = 0.0
	body.physics_material_override = material
	body.transform = Transform(Basis(), p_at)

	var shape_node := CollisionShape.new()
	var sphere := SphereShape.new()
	sphere.radius = 1.0
	shape_node.shape = sphere
	body.add_child(shape_node)
	return body


func _iteration(_delta: float) -> bool:
	# `_iteration` IS the physics tick, and Godot has already run `flush_queries()` for this tick by
	# the time it is called — so every `_integrate_forces` the bodies saw for iteration N is already
	# in the logs when iteration N gets here.
	_record(_fall_body, _fall_log)
	_record(_rest_body, _rest_log)
	_record(_mode_body, _mode_log)
	_record(_character_body, _character_log)

	if _iterations == 0:
		_out["rays"] = _probe_rays()
	if _iterations == 2:
		# Switch the CHARACTER body to RIGID and give it a spin, which is what `enemy.gd:37-39`
		# does. A CHARACTER's inverse inertia tensor is zero, so whether it tumbles is the whole
		# question — and `_character_body` is the CONTROL that answers it, kept in MODE_CHARACTER
		# and given the IDENTICAL spin through the IDENTICAL call. Without the control, "MODE_RIGID
		# is what makes it spin" is an assumption, and a port that maps the mode onto Rapier's
		# rotation lock would inherit it. Both flags are read inside the next callback.
		_mode_body.set_meta("switchToRigid", true)
		_mode_body.set_meta("spin", Vector3(0, 0, 3.0))
		_character_body.set_meta("switchToRigid", false)
		_character_body.set_meta("spin", Vector3(0, 0, 3.0))

	_iterations += 1
	if _iterations >= RESTING_STEPS:
		_finish()
		return true
	return false


# The per-tick record. `linearVelocity` and `transformOrigin` are read from the NODE rather than
# from the state object, which is the point: they are what the world looks like after the step the
# script's own write fed.
func _record(p_body: RigidBody, p_log: Array) -> void:
	var seen = p_body.get_meta("seen") if p_body.has_meta("seen") else null
	if seen == null:
		return
	p_log.append({
		"iteration": _iterations,
		"step": seen["step"],
		"totalGravity": seen["totalGravity"],
		"linearVelocityAtEntry": seen["linearVelocity"],
		"linearVelocityWritten": seen["linearVelocityWritten"],
		"contactCount": seen["contactCount"],
		"contactLocalNormals": seen["contactLocalNormals"],
		"contactColliderNames": seen["contactColliderNames"],
		"mode": seen["mode"],
		"angularVelocity": seen["angularVelocity"],
		"upAxisImage": seen["upAxisImage"],
		"originAfterStep": _v3(p_body.global_transform.origin),
	})


func _probe_rays() -> Dictionary:
	# The three-hop lookup `follow_camera.gd:48` makes, verbatim.
	var space_state := PhysicsServer.space_get_direct_state(get_root().get_world().get_space())
	var floor_body: StaticBody = get_root().get_node("Floor")

	var hit := space_state.intersect_ray(Vector3(0, 5, 0), Vector3(0, -5, 0))
	var miss := space_state.intersect_ray(Vector3(0, 5, 40), Vector3(0, -5, 40))
	var excluded := space_state.intersect_ray(
		Vector3(0, 5, 0), Vector3(0, -5, 0), [floor_body.get_rid()]
	)
	# A ray whose `to` is SHORTER than the distance to the surface: Godot's intersect_ray takes two
	# POINTS, not an origin and a direction, so this must miss.
	var short := space_state.intersect_ray(Vector3(0, 5, 0), Vector3(0, 2, 0))
	# Straight through the Area. `follow_camera.gd:50-52` passes neither `collide_with_bodies` nor
	# `collide_with_areas`, so this measures Godot's DEFAULTS — and the game is full of `Area`
	# pickups a camera ray must not snag on.
	var through_area := space_state.intersect_ray(Vector3(0, 3, 26), Vector3(0, 3, 34))
	# A ray that STARTS INSIDE the floor box and points up out of it. `follow_camera.gd:50-52` casts
	# from the player's own origin outward with an exception list this game never fills (the `while`
	# at `:19-24` looks for a `RigidBody` ancestor and the player is a `KinematicBody`), so whether
	# a ray sees the shape it begins inside decides whether the camera slams onto the player.
	var from_inside := space_state.intersect_ray(Vector3(6, -0.25, 6), Vector3(6, 5, 6))

	return {
		"hit": _ray_result(hit),
		"missSideways": _ray_result(miss),
		"hitWithColliderExcluded": _ray_result(excluded),
		"tooShortToReach": _ray_result(short),
		"throughAreaWithDefaultFlags": _ray_result(through_area),
		"startingInsideTheShape": _ray_result(from_inside),
		"spaceIsRid": typeof(get_root().get_world().get_space()) == TYPE_RID,
	}


func _ray_result(p_result: Dictionary) -> Dictionary:
	if p_result.empty():
		return {"empty": true, "keys": []}
	var keys := []
	for key in p_result.keys():
		keys.append(str(key))
	keys.sort()
	return {
		"empty": false,
		"keys": keys,
		"position": _v3(p_result["position"]),
		"normal": _v3(p_result["normal"]),
		"colliderName": p_result["collider"].name,
	}


func _finish() -> void:
	_out["freeFall"] = _fall_log.slice(0, FREE_FALL_STEPS - 1)
	_out["resting"] = _rest_log
	_out["modeSwitchToRigid"] = _mode_log.slice(0, MODE_STEPS - 1)
	_out["modeStaysCharacter"] = _character_log.slice(0, MODE_STEPS - 1)
	var file := File.new()
	file.open(OUT_PATH, File.WRITE)
	file.store_string(JSON.print(_out, "  "))
	file.close()
	print("probe-physics-state: wrote ", OUT_PATH)


func _v3(p_v: Vector3) -> Array:
	return [_f(p_v.x), _f(p_v.y), _f(p_v.z)]


func _f(p_value: float) -> String:
	return "%.17f" % p_value
