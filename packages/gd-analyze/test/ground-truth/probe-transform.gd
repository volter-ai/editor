extends SceneTree

# probe-transform.gd — the GROUND TRUTH generator for the 3D SPATIAL-TRANSFORM requisition:
# `Spatial.get_transform`/`set_transform`/`get_global_transform`/`get_world`/`set_as_toplevel`, and
# the `Transform`/`Basis` Variant members behind them (`Transform.basis`/`looking_at`/
# `orthonormalized`, `Basis.xform`/`scaled`, plus the `Basis(axis, angle)`/`Basis(x, y, z)` and `*`
# operators the emitter writes to build them).
#
# THE QUESTION THIS ANSWERS is the one that decides whether the surface is expressible at all, and
# it is a CONVENTION question that reading C++ does not settle: Godot 3's `Basis` stores its 3x3 as
# ROW vectors internally, but what does GDScript's `basis[i]` return — a row or a column? And does
# `basis.scaled(s)` scale rows or columns? Both flip the whole port if guessed wrong, and both are
# measured here rather than believed. (Answers, for the record the tests pin: `basis[i]` and
# `basis.x/y/z` are the i-th COLUMN — the axis, `M·eᵢ`; `scaled(s)` scales each ROW by `s[i]`, i.e.
# `diag(s)·M`, which in column terms is every column multiplied COMPONENTWISE by `s`.)
#
# HOW IT IS RUN (never against the repo fixture — Godot writes `.import/` sidecars into whatever
# project it opens, and `test/fixtures/platformer-3d/` is byte-locked):
#
#     cp -R packages/gd-analyze/test/fixtures/platformer-3d <scratch>/platformer-3d
#     cp packages/gd-analyze/test/ground-truth/probe-transform.gd <scratch>/platformer-3d/
#     <Godot 3.6>/Godot --no-window --path <scratch>/platformer-3d -s res://probe-transform.gd
#     # -> <scratch>/platformer-3d/godot36-transform.json
#
# (any scratch project works — the probe builds its own Spatials in `_init` and needs no scene or
# asset). The result is committed beside this file as `godot36-transform.json`, so
# `test/transform-3d.test.ts` is hermetic and CI never runs Godot.
#
# WHAT IS PROBED. Four groups, each isolating one thing:
#
#   1. `micro` — one Basis/Transform member per block, with NON-trivial and NON-uniform inputs so a
#      transposed basis, a row/column scale mix-up, or a wrong looking_at eye diverges. `basisScaled`
#      is measured both non-uniform (which disambiguates) and at the fixture's own uniform 0.3.
#   2. `parentChain` — a child under a rotated, translated parent: get_transform (local) vs
#      get_global_transform (world = parent×local), the composition a port gets wrong invisibly.
#   3. `setAsToplevel` — the MEASURED behaviour of the one refused member: enabling it BAKES the
#      current global transform into the local, then treats local AS global while get_parent() still
#      returns the parent. Recorded so the refusal cites a measurement, not a belief.
#   4. `followCamera` — `follow_camera.gd`'s transform math (the physics rays removed, they are the
#      OTHER requisition), reproduced at scene root over three fixed steps: rotate a delta by
#      `Basis(UP, angle).xform(delta)`, `look_at_from_position(target + delta, target, UP)`, then the
#      `t.basis = Basis(t.basis[0], angle_v_adjust) * t.basis` tweak with a NONZERO angle.
#
# DETERMINISM. Nothing here draws a random number, reads a clock, or depends on frame pacing — the
# whole probe runs in `_init` and quits. FLOATS LEAVE AT 17 DECIMALS (Godot's float32, so a value
# like cos(30°) prints 0.86602538…, not 0.86602540…), as this directory's other dumps do; the test
# compares with a float32-width tolerance rather than exactly.

func fj(x):
	return "%.17f" % x

func vj(a):
	return [fj(a.x), fj(a.y), fj(a.z)]

func bj(b):
	# A Basis, dumped as GDScript sees it: b[0], b[1], b[2] — the COLUMNS (axes).
	return {"col0": vj(b[0]), "col1": vj(b[1]), "col2": vj(b[2])}

func tj(t):
	return {"basis": bj(t.basis), "origin": vj(t.origin)}

func _init():
	var out = {}
	out["godotVersion"] = Engine.get_version_info()

	var micro = {}
	var r30 = Basis(Vector3(0, 1, 0), deg2rad(30))
	micro["basisAxisAngle_Y30"] = bj(r30)
	var ax = Vector3(1, 2, 3).normalized()
	var rSkew = Basis(ax, deg2rad(57))
	micro["basisAxisAngle_skew57"] = {"axis": vj(ax), "basis": bj(rSkew)}
	var bcols = Basis(Vector3(1, 2, 3), Vector3(4, 5, 6), Vector3(7, 8, 9))
	micro["basisFromColumns"] = bj(bcols)
	var vtest = Vector3(0.3, -1.7, 2.2)
	micro["basisXform"] = {"basis": bj(rSkew), "v": vj(vtest), "result": vj(rSkew.xform(vtest))}
	micro["basisMulVec"] = vj(rSkew * vtest)
	var scaled = r30.scaled(Vector3(2, 3, 4))
	micro["basisScaled_nonuniform"] = {"base": bj(r30), "scale": vj(Vector3(2, 3, 4)), "result": bj(scaled)}
	var scaledU = rSkew.scaled(Vector3(0.3, 0.3, 0.3))
	micro["basisScaled_uniform"] = bj(scaledU)
	var m = Basis(Vector3(0, 1, 0), deg2rad(90)) * Basis(Vector3(1, 0, 0), deg2rad(90))
	micro["basisMul_Ry90_Rx90"] = bj(m)
	var base = Basis(Vector3(1, 2, 3).normalized(), deg2rad(40))
	var tweaked = Basis(base[0], deg2rad(12)) * base
	micro["basisAxisFromColumnThenMul"] = {"base": bj(base), "angleDeg": "12", "result": bj(tweaked)}
	var dir = Vector3(1, 0, 1).normalized()
	var la = Transform().looking_at(-dir, Vector3(0, 1, 0))
	micro["transformLookingAt"] = {"eye": vj(Vector3(0, 0, 0)), "target": vj(-dir), "up": vj(Vector3(0, 1, 0)), "result": tj(la)}
	var laOff = Transform(Basis(), Vector3(3, 4, 5)).looking_at(Vector3(10, 4, 5), Vector3(0, 1, 0))
	micro["transformLookingAt_offset"] = tj(laOff)
	var skewT = Transform(Basis(Vector3(2, 0, 0), Vector3(0.5, 3, 0), Vector3(0, 0, 4)), Vector3(5, 6, 7))
	micro["transformOrthonormalized"] = {"in": tj(skewT), "out": tj(skewT.orthonormalized())}
	out["micro"] = micro

	var parent = Spatial.new()
	parent.transform = Transform(Basis(Vector3(0, 1, 0), deg2rad(90)), Vector3(10, 5, 0))
	get_root().add_child(parent)
	var child = Spatial.new()
	child.transform = Transform(Basis(Vector3(1, 0, 0), deg2rad(45)), Vector3(1, 2, 3))
	parent.add_child(child)
	out["parentChain"] = {
		"parentGlobal": tj(parent.get_global_transform()),
		"childLocal": tj(child.get_transform()),
		"childGlobal": tj(child.get_global_transform()),
	}

	var tl = {}
	tl["beforeLocal"] = tj(child.get_transform())
	tl["beforeGlobal"] = tj(child.get_global_transform())
	child.set_as_toplevel(true)
	tl["afterEnableLocal"] = tj(child.get_transform())
	tl["afterEnableGlobal"] = tj(child.get_global_transform())
	tl["parentStillLinked"] = child.get_parent() == parent
	child.set_transform(Transform(Basis(Vector3(0, 1, 0), deg2rad(20)), Vector3(7, 8, 9)))
	tl["afterWriteLocal"] = tj(child.get_transform())
	tl["afterWriteGlobal"] = tj(child.get_global_transform())
	out["setAsToplevel"] = tl

	var cam = Spatial.new()
	get_root().add_child(cam)
	var steps = []
	var targets = [Vector3(0, 1, 0), Vector3(2, 1.5, -3), Vector3(-4, 0.5, 5)]
	var deltas = [Vector3(0, 1, 2.5), Vector3(1, 0.8, -1.2), Vector3(-2, 1.3, 0.4)]
	var apertureDeg = 25.0
	var angleVAdjustDeg = 7.0
	for i in range(targets.size()):
		var target = targets[i]
		var delta = deltas[i]
		var leftDir = Basis(Vector3(0, 1, 0), deg2rad(apertureDeg)).xform(delta)
		var rightDir = Basis(Vector3(0, 1, 0), deg2rad(-apertureDeg)).xform(delta)
		var turned = Basis(Vector3(0, 1, 0), deg2rad(0.5 * 50.0)).xform(delta)
		var pos = target + turned
		cam.look_at_from_position(pos, target, Vector3(0, 1, 0))
		var t = cam.get_transform()
		t.basis = Basis(t.basis[0], deg2rad(angleVAdjustDeg)) * t.basis
		cam.set_transform(t)
		steps.append({
			"target": vj(target),
			"delta": vj(delta),
			"leftDir": vj(leftDir),
			"rightDir": vj(rightDir),
			"turnedDelta": vj(turned),
			"camPos": vj(pos),
			"camTransformAfterTweak": tj(cam.get_transform()),
		})
	out["followCamera"] = {"apertureDeg": "25", "angleVAdjustDeg": "7", "autoturnHalfDeg": "25", "steps": steps}

	var f = File.new()
	f.open("res://godot36-transform.json", File.WRITE)
	f.store_string(JSON.print(out, "  "))
	f.close()
	print("WROTE godot36-transform.json")
	quit()
