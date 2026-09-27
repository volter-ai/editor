# Builder T: Tween into godot-compat

## Kit uses (read from fixtures)
- starter-kit-match-3/scripts/tile.gd: create_tween() on self (Area2D); .set_parallel(true) chained on create_tween;
  tween_property($Sprite2D,"scale",Vector2,0.1); tween_property($Sprite2D,"modulate",Color,0.1);
  tween_property(self,"position",Vector2,0.3).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT);
  .set_trans(Tween.TRANS_ELASTIC).set_ease(Tween.EASE_OUT); tween.finished.connect(_on_move_finished)
- starter-kit-match-3/scripts/main.gd:181: piece.create_tween(); tween_property(piece,"scale",Vector2.ZERO,0.2); tween.finished.connect(piece.queue_free)
- starter-kit-fps/objects/player.gd:33,242-245: var tween: Tween; get_tree().create_tween(); tween.set_ease(Tween.EASE_OUT_IN);
  tween_property(container,"position",Vector3,0.1); tween_callback(change_weapon)
- NOT used by any kit: chain, set_loops, MethodTweener, IntervalTweener, from/as_relative/set_delay.

## Steps
- [x] read GODOT.md, kits
- [x] compat: tween.ts, tweener.ts, property-tweener.ts, callback-tweener.ts; SceneTree.create_tween + processTweens (after timers, both phases); Node.create_tween; entry files; check-godot-compat + tsc clean
- [x] evidence: tween-timeline.ts helper; tween/property-tweener/callback-tweener/tweener cases; create_tween cases in node.cases.ts and scene-tree.cases.ts
- baseline imports running: /Volumes/PeakSSD/volter-work/tmp/godot-tween-scratch/base
- [ ] run evidence tween (next)
- [x] evidence agree: tween 150, property-tweener 15, callback-tweener 5, tweener 2, scene-tree 19, node 55 (planted defects: BACK const -> 7 disagree; pause-mode + zero-duration -> 2 disagree)
- [x] lowering: tween_property passes native entity + {get,set} accessor bindings (lower-official-expression.ts tweenedProperty); NativeProperty.type added
- baseline refusals (first-per-script reporting): 3d-platformer 50, basic-scene 8, city-builder 7, fps 46, match-3 24 (1 tween: tile.gd:12 Tween.set_parallel), racing 35, platformer-3d-godot4 exit 0
- [ ] refresh1 running (pid in refresh1.pid, log refresh1.log)
- refresh1 killed (origin moved). Committed code e3864b57 (local), rebased onto origin/godot ab29c20d.
- [ ] refresh2 running (started 11:24, refresh2.log)
- [x] refresh2 on rebased head (origin/godot ab29c20d): 0 disagreements; liveness: every claim live
- [x] after1 imports: platformer-3d-godot4 exit 0 (run --frames 120 NOT yet taken); kit refusal counts unchanged for 3d-platformer 50, basic-scene 8, city-builder 7, fps 46 (player.gd first refusal is line 51, before tween use), racing 35; match-3 UNMEASURED: official Godot --import SIGABRT this run (crash report Godot-2026-09-27-113126.ips), baseline had 24 incl. tile.gd:12 Tween.set_parallel
- STOPPED by coordinator (lane moving machines). Not pushed to godot. Pushed as origin/godot-wip-t.
- Remaining: rerun match-3 import to see tile.gd/main.gd tween lowering; gd-analyze run platformer --frames 120; then push with re-measure.
