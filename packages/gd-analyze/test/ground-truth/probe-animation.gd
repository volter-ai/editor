extends SceneTree

# probe-animation.gd — GROUND TRUTH for the platformer-3d ANIMATION-PLAYBACK requisition:
# the AnimationTree blend graph (AnimationNodeBlendTree with Blend2 / TimeScale / Transition /
# Animation leaves) that player.tscn drives, plus AnimationPlayer.play / queue.
#
# THE QUESTION THIS ANSWERS: what WEIGHT does each of the five leaf clips receive for a given
# parameter vector, and what TimeScale factor reaches the on-floor subtree? Those weights are the
# faithful port's whole job — three's AnimationMixer blends AnimationActions by weight exactly as
# Godot's AnimationTree does, so reproducing the weights reproduces the pose. Rather than read a
# skeleton pose (which folds in clip sampling), this isolates the GRAPH: every leaf clip is a
# UNIT-CONSTANT clip that writes 1.0 to its own probe node, so the blended output of probe node i
# reads back EXACTLY leaf i's effective weight. TimeScale is measured separately, by how far the
# clip head advances under a known scale.
#
# TOPOLOGY (copied from player.tscn's tree_root, SubResource 23):
#   output <- gun
#   gun    = Blend2(in0<-state, in1<-shooting), param parameters/gun/blend_amount
#   state  = Transition(in0 "on floor"<-scale, in1 "in air"<-air_dir), param parameters/state/current
#   scale  = TimeScale(in<-walk), param parameters/scale/scale
#   walk   = Blend2(in0<-idle,  in1<-walkcycle), param parameters/walk/blend_amount
#   air_dir= Blend2(in0<-jumpup,in1<-falling),   param parameters/air_dir/blend_amount
#
# HOW IT IS RUN (never against the byte-locked repo fixture):
#   <Godot 3.6>/Godot --no-window --path <scratch>/probe-proj -s res://probe-animation.gd
#   # -> <scratch>/probe-proj/godot36-animation.json
#
# DETERMINISM. No random, no clock, no frame pacing: the probe builds its tree, advances it by a
# FIXED delta per case, and quits. Floats leave at 17 decimals (Godot float32), as this directory's
# other dumps do; the test compares at float32 width.

func fj(x):
	return "%.17f" % x

var root_node
var anim_player
var anim_tree

# A clip whose x-translation RAMPS with time (key 0.0 -> 0, key 1.0 -> 1, linear, NON-looping) so
# the read-back x reports the playback head position — used to measure TimeScale's time advance.
func make_ramp_clip(target_name):
	var a = Animation.new()
	a.length = 1.0
	a.loop = false
	var ti = a.add_track(Animation.TYPE_VALUE)
	a.track_set_path(ti, target_name + ":translation")
	a.track_set_interpolation_type(ti, Animation.INTERPOLATION_LINEAR)
	a.track_insert_key(ti, 0.0, Vector3(0, 0, 0))
	a.track_insert_key(ti, 1.0, Vector3(1, 0, 0))
	return a

func make_loc_clip(loc):
	# A one-key TRANSFORM track on the SHARED probe node, holding a distinct constant location so
	# the AnimationTree's real (order-dependent, un-normalized, first-track-init) blend is decodable
	# on orthogonal axes. Looped, 1.0s.
	var a = Animation.new()
	a.length = 1.0
	a.loop = true
	var ti = a.add_track(Animation.TYPE_TRANSFORM)
	a.track_set_path(ti, NodePath("shared"))
	a.transform_track_insert_key(ti, 0.0, loc, Quat(), Vector3(1, 1, 1))
	return a

func build_tree():
	root_node = Spatial.new()
	root_node.name = "Root"
	root.add_child(root_node)

	var shared = Spatial.new()
	shared.name = "shared"
	root_node.add_child(shared)

	anim_player = AnimationPlayer.new()
	anim_player.name = "AnimationPlayer"
	root_node.add_child(anim_player)
	# On-floor leaves and the air leaves are never active together (the Transition selects one), so
	# X/Y/Z can be reused across the two states: X=idle|jumpup, Y=walkcycle|falling, Z=shooting.
	anim_player.add_animation("idle", make_loc_clip(Vector3(1, 0, 0)))
	anim_player.add_animation("walkcycle", make_loc_clip(Vector3(0, 1, 0)))
	anim_player.add_animation("jumpup", make_loc_clip(Vector3(1, 0, 0)))
	anim_player.add_animation("falling", make_loc_clip(Vector3(0, 1, 0)))
	anim_player.add_animation("shooting", make_loc_clip(Vector3(0, 0, 1)))

	var bt = AnimationNodeBlendTree.new()

	var n_idle = AnimationNodeAnimation.new(); n_idle.animation = "idle"
	var n_walk = AnimationNodeAnimation.new(); n_walk.animation = "walkcycle"
	var n_jump = AnimationNodeAnimation.new(); n_jump.animation = "jumpup"
	var n_fall = AnimationNodeAnimation.new(); n_fall.animation = "falling"
	var n_shoot = AnimationNodeAnimation.new(); n_shoot.animation = "shooting"
	bt.add_node("idle", n_idle)
	bt.add_node("walkcycle", n_walk)
	bt.add_node("jumpup", n_jump)
	bt.add_node("falling", n_fall)
	bt.add_node("shooting", n_shoot)

	bt.add_node("walk", AnimationNodeBlend2.new())
	bt.add_node("air_dir", AnimationNodeBlend2.new())
	bt.add_node("scale", AnimationNodeTimeScale.new())
	var trans = AnimationNodeTransition.new()
	trans.input_count = 2
	trans.set("input_0/name", "on floor")
	trans.set("input_1/name", "in air")
	bt.add_node("state", trans)
	bt.add_node("gun", AnimationNodeBlend2.new())

	bt.connect_node("walk", 0, "idle")
	bt.connect_node("walk", 1, "walkcycle")
	bt.connect_node("air_dir", 0, "jumpup")
	bt.connect_node("air_dir", 1, "falling")
	bt.connect_node("scale", 0, "walk")
	bt.connect_node("state", 0, "scale")
	bt.connect_node("state", 1, "air_dir")
	bt.connect_node("gun", 0, "state")
	bt.connect_node("gun", 1, "shooting")
	bt.connect_node("output", 0, "gun")

	anim_tree = AnimationTree.new()
	anim_tree.name = "AnimationTree"
	anim_tree.tree_root = bt
	root_node.add_child(anim_tree)
	anim_tree.anim_player = anim_tree.get_path_to(anim_player)
	anim_tree.active = true

func eval_case(walk_b, air_b, state_c, gun_b, scale_v):
	root_node.get_node("shared").transform = Transform()
	anim_tree.set("parameters/walk/blend_amount", walk_b)
	anim_tree.set("parameters/air_dir/blend_amount", air_b)
	anim_tree.set("parameters/state/current", state_c)
	anim_tree.set("parameters/gun/blend_amount", gun_b)
	anim_tree.set("parameters/scale/scale", scale_v)
	anim_tree.advance(0.0)
	# The blended pose on the shared node. Because the active leaves sit on orthogonal axes,
	# (x,y,z) decode to the effective contribution of (idle|jumpup, walkcycle|falling, shooting).
	var t = root_node.get_node("shared").translation
	return {
		"params": {
			"walk_blend": fj(walk_b), "air_dir_blend": fj(air_b),
			"state_current": state_c, "gun_blend": fj(gun_b), "scale": fj(scale_v),
		},
		"pose": {"x": fj(t.x), "y": fj(t.y), "z": fj(t.z)},
	}

func _init():
	build_tree()

	var out = {}
	out["godotVersion"] = Engine.get_version_info()
	out["note"] = "Blended POSE of player.tscn's AnimationTree, measured on ONE shared Spatial " + \
		"whose leaf clips sit on orthogonal axes: X=idle|jumpup, Y=walkcycle|falling, Z=shooting. " + \
		"So pose (x,y,z) == the effective weight Godot's AnimationTree gives each active leaf — " + \
		"which is an ORDER-DEPENDENT incremental lerp (animation_tree.cpp:928, first track inits " + \
		"and near-zero-blend tracks are skipped at :846), NOT the naive multiplicative product. " + \
		"The weights sum to 1, so three's weighted AnimationAction blend reproduces the pose. " + \
		"scale is TimeScale's factor: it does not change weights, only the on-floor subtree's " + \
		"time base (see timeScale block)."

	var cases = []
	# state=0 (on floor): idle/walk split by walk_blend, air clips zero; gun_blend mixes in shooting.
	cases.append(eval_case(0.0, 0.0, 0, 0.0, 1.5))   # pure idle
	cases.append(eval_case(1.0, 0.0, 0, 0.0, 1.5))   # pure walk-cycle
	cases.append(eval_case(0.5, 0.0, 0, 0.0, 1.5))   # half idle / half walk
	cases.append(eval_case(0.25, 0.0, 0, 0.0, 1.5))  # non-symmetric split
	cases.append(eval_case(0.5, 0.7, 0, 0.5, 1.5))   # on floor + half gun (air params ignored)
	cases.append(eval_case(0.3, 0.0, 0, 0.4, 1.5))   # non-telescoping 3-clip: idle/walk/shoot
	cases.append(eval_case(0.5, 0.0, 0, 0.5, 1.0))   # weight-invariance under a different scale
	cases.append(eval_case(1.0, 0.0, 0, 1.0, 1.5))   # full gun -> pure shooting
	# state=1 (in air): jumpup/falling split by air_dir_blend, floor clips zero.
	cases.append(eval_case(0.5, 0.0, 1, 0.0, 1.5))   # pure jump-up (walk ignored)
	cases.append(eval_case(0.5, 1.0, 1, 0.0, 1.5))   # pure falling
	cases.append(eval_case(0.5, 0.5, 1, 0.0, 1.5))   # half jump / half fall
	cases.append(eval_case(0.5, 0.25, 1, 0.0, 1.5))  # non-symmetric air split
	cases.append(eval_case(0.5, 0.5, 1, 0.5, 1.5))   # in air + half gun
	cases.append(eval_case(0.5, 0.6, 1, 0.25, 1.5))  # non-telescoping 3-clip: jump/fall/shoot
	cases.append(eval_case(0.5, 0.3, 1, 1.0, 1.5))   # full gun in air -> pure shooting
	out["cases"] = cases

	# TimeScale time-base: a ramp clip under scale=2.0 for dt should advance the head by 2*dt.
	# Rebuild a tiny tree: TimeScale(scale) -> Animation(ramp). Read the ramp node's x = head pos.
	var ramp_target = Spatial.new(); ramp_target.name = "ramp"; root_node.add_child(ramp_target)
	anim_player.add_animation("ramp", make_ramp_clip("ramp"))
	var bt2 = AnimationNodeBlendTree.new()
	var an = AnimationNodeAnimation.new(); an.animation = "ramp"
	bt2.add_node("ramp", an)
	bt2.add_node("ts", AnimationNodeTimeScale.new())
	bt2.connect_node("ts", 0, "ramp")
	bt2.connect_node("output", 0, "ts")
	var tree2 = AnimationTree.new(); tree2.name = "TS"; tree2.tree_root = bt2
	root_node.add_child(tree2)
	tree2.anim_player = tree2.get_path_to(anim_player)
	tree2.active = true
	tree2.set("parameters/ts/scale", 2.0)
	tree2.advance(0.1)   # head should be at 0.1 * 2.0 = 0.2
	var ts_block = {"scale": fj(2.0), "dt": fj(0.1), "headAfter": fj(ramp_target.translation.x)}
	out["timeScale"] = ts_block

	var f = File.new()
	f.open("res://godot36-animation.json", File.WRITE)
	f.store_string(JSON.print(out, "  "))
	f.close()
	print("wrote godot36-animation.json")
	quit()
