# The Godot lane

The Godot lane translates a Godot project into a game this editor opens: its scenes become React
components, its scripts become ordinary TypeScript, and what Godot's API means at runtime comes
from a copied capability. The owner called its turn on 2026-09-25. It came back from volter-engine's
tag `archive/godot-lane-2026-09-19` (volter-engine `6499489cb`); nothing here was re-derived.

## The lane's law (owner, 2026-09-27)

These rulings supersede everything below that conflicts with them. Sections that still describe
the code as it stands, and which the conformance work changes, carry a banner saying so.

**1. Read Godot, then translate idiomatically.** Godot's source is how the lane learns what a
member, node or system really does. It is never the thing the lane ports. The output, and the
body of every compat member, is what a three.js, R3F, Rapier or DOM developer would write to get
that behaviour. Scripts still call Godot's API by name, so compat still exports Godot's members
under Godot's names; their bodies are ordinary library code. The host owns the frame and physics
(R3F's frame, @react-three/rapier's fixed step and its hooks) and all time in the game, React owns
mounting, and these are never ported:

- Godot's main loop and timing (`Main::iteration`, `MainTimerSync`);
- its servers and their storage (`RenderingServer`, `ParticlesStorage`, `PhysicsServer3D`
  internals, text and display servers);
- its scene-tree bookkeeping beyond what a public member needs;
- any registry, spawn host, mirrored tree or class-name table that exists because Godot has one.

**2. No formal accuracy standard.** Correctness is judged by playing the game, not by numeric
equivalence. There are no claim records, comparators, tolerances or evidence gate: the import
uses what compat implements and refuses only what it does not. Running a snippet in official
Godot stays a building tool for when behaviour is unclear, never a gate.

The two rulings are one change. A gate that demands bit-exact agreement with Godot can only be
passed by reproducing Godot's implementation, so the evidence gate is what drove the transcription:
`MainTimerSync`, the spawn host, class-mount registries, gles3's particle storage. Retiring the
gate is what makes idiomatic translation possible.

**Acceptance is a blind walk.** A game is ported when a fresh subagent, told only what a player
would do, plays the imported game in the game editor through a Playwright REPL one action at a
time, side by side with the original running in official Godot, and reports that it plays like the
original (the workspace's standing directive). The walk reports what a player sees and whether it
plays the same; it never measures or compares values, so it cannot become a comparator again. One walk per game when its work is done, never per
change. Changes in between are checked cheaply: typecheck, import, `gd-analyze run`, a look in
the editor.

**The architecture review gate.** The structural bar is ARCHITECTURE.md (rule 4 especially) and
these rows, judged by a context-free reviewer who is given only this section, ARCHITECTURE.md and
the code, including an emitted game:

1. One pipeline: snapshot, official frontend, read, analyze, plan, emit, materialize.
   `import-project.ts` is the only caller of the phases; no CLI command, proof or script composes
   them itself.
2. Each phase owns its concern: read decodes, analyze decides (types, reachability), translate
   plans, emit prints mechanically.
3. The mapping from Godot classes to library idioms is one plan-time data table in `translate/data`.
   Emit, lowering and compat never branch on, compare with or index by a Godot class name, and
   compat keeps no registry keyed by one.
4. Compat is bindings onto libraries: no main loop, clock, physics stepping, scheduler, spawn host,
   mirrored tree or server of its own (ruling 1). A node that advances itself (an animation, a
   particle system) may do so from its own component's `useFrame` or `useBeforePhysicsStep`, as a
   drei component does; compat never drives other nodes' work from the frame.
5. The output is plain library code a three.js or R3F developer would recognize: no runtime
   framework the game is written against, no generated shared helper or dispatcher, no exports
   for the editor.
6. Every emitted file and dependency is reachable from the game's entry; nothing is emitted for
   the editor or for debugging.

The review is periodic, not per change: the mechanical checks run on every commit, and the review
is there to catch the shapes they cannot see before they pile up. It runs, by the procedure and
the fixed brief in `docs/GODOT-REVIEW.md` (one context-free reviewer), when 30 commits touching
compat, the planner, lowering or emit have landed since the ledger's latest reviewed commit, and
before a game's acceptance walk; its verdict is appended to the ledger below. The pre-push hook
refuses a push to `godot` past that count without a review. Until every row passes, a review may
not find anything beyond the ledger's latest entry; after that, every row must pass.

**The ratchet.** `scripts/check-godot-architecture.mjs`, run by the pre-commit hook, counts the
patterns the review keeps finding against the baseline committed at `HEAD`, rule by rule, and fails
when a count grows: a Godot class name (from the pinned API dump) used as a `case`, compared with
`===`/`!==`, or used as a table or `Map` key in emit, lowering or compat; class-mount registries;
time and stepping primitives in compat; exported declarations the emitted world carries beyond its
component; the pipeline's phases called outside `import-project.ts`; emit deciding by a setter's
name or by walking the project's other scenes; lowering comparing a built-in type's name. Moving a finding between files passes; editing the working baseline does not. Conformance work lowers the baseline in the
same commit that removes a pattern. The reviewer judges; the ratchet stops the slow creep a
reviewer run only at milestones misses: the 09-26 regrowth was about 300 commits, each locally
reasonable.

**Decide from the law.** A design question the law answers is decided by whoever meets it,
without asking: the answer is what the rulings and rows imply. Only a genuine conflict between
them goes to the owner. The composition-site design below was built on an author's ruling that
contradicted ruling 1; the law, not a new ruling, is what settles such a case.

**Ledger.**

The pre-push hook reads this table: the Commit column's first backquoted hash is the reviewed
commit, and the Verdict column starts with `baseline`, `pass`, `holds` or `regressed`.

| Date | Commit | Reviewed against | Verdict |
| --- | --- | --- | --- |
| 2026-09-27 | `69edd5ae` | volter-engine's ten rows (before these rulings) | baseline: all ten fail. Compat owns the main loop and physics stepping (`scene-tree.ts` `godot_main_iteration`, the paused `<Physics>` in `main.tsx`), class-name registries (`CLASS_MOUNTS`, `godot_node_class_mount`), a spawn host and a mirrored canvas tree; emit dispatches on class names (`switch (className)` in `idiomatic-scene-syntax.ts`, `GODOT_ELEMENTS[className]`); lowering special-cases `AnimationTree`; the emitted `world.tsx` exports `debug`; claim records store one digest as both sides. The baseline the conformance work starts from. |
| 2026-09-27 | `d3afcb62` | §The lane's law | regressed: every row and both rulings still fail; new since `69edd5ae`: the SceneTree's timers, tweens and deletion queue driven per frame from `useGodotTree` (`advance.tsx`, which the ratchet's scheduler rule skips); the emitted world's `useFrame` running input, camera and canvas work; spawning's `SPAWNERS` registry, stand-ins, `flushSync` in `add_child` and the emitted `rootScript` static; reachability decided in emit (`reachable-capabilities.ts`). |
| 2026-09-27 | `5c36cca7` | §The lane's law | regressed: every row and both rulings still fail; new since `d3afcb62`: row 6 again (the reverted reachability leaves 29 unreached compat modules in the game); ruling 1, ports of Godot's renderer into three's shader chunks (the gles3 additive light passes, `world-environment.ts`; `scene.glsl`'s diffuse and specular modes, rim, backlight, grow, distance fade and gles3's depth-draw rule, `base-material-3d.ts`) and of `CPUParticles3D::convert_from_particles` (`gpu-particles-3d.ts`, `particle-process-material.ts`); row 2, emit deciding material transparency, `depthWrite` and `specularIntensity` (`scene-family-elements.ts`). Not counted as new but still failing: the root Window's per-frame canvas drawing (moved from the world), the added-scenes state (the spawner registry moved into node state). The emit judged was made from the working tree with uncommitted script-typing changes. |
| 2026-09-28 | `7ba339e1` | §The lane's law | regressed: every row and both rulings still fail (the shader-chunk ports, emit's material decisions, the particle port and the unreached modules are gone); new since `5c36cca7`: reachability as a phase after emit that rewrites the accepted plan (`reachability.ts`, `withoutCapabilityCopies`); lowering inferring a loop's element type (`elementTypedIterable`); emit deciding a scene root's ref (`rootRef`) and the transform override (`exportName === 'set_transform'`); the plan collecting scripts' signals (`scriptSignals`); lowering comparing built-in type names (`ARRAY_INDEXED`); `FontFile` bound to compat's text-server port (`font-file.ts`, `label.ts`); a generated ternary dispatch for `load(path)`. |
| 2026-09-28 | `7218faba` | §The lane's law | holds: nothing new since `7ba339e1`, and row 1 and ruling 2 now pass. Rows 2 to 6 and ruling 1 still fail on shapes present before: emit reads setters by name and walks the project's scenes (row 2); compat's class readers and class-name comparisons, lowering's class-name lookups (row 3); the SceneTree's clock, timers, tweens and deletion queue from `useGodotTree`, the root Window drawing every canvas item, the spawner and stand-ins (row 4); the emitted game written against compat's hooks, with editor callsite plumbing in compat (row 5); `@volter/game-runtime` and the editor-facing files and devDependencies (row 6); the SceneTree, the tagged Variant and compat's own line breaker as ports (ruling 1). Open: `capability-reach.ts` restates what emit imports, so the two can drift. Emitted from a clean copy of `7218faba`. |
| 2026-09-28 | `3716fa8e` | §The lane's law | regressed: row 1 and ruling 2 pass; rows 2 to 6 and ruling 1 fail on the shapes `7218faba` named, and four are new: (1) compat reads a scene's three primitive geometry back as PlaneMesh, SphereMesh or CylinderMesh (`mesh-instance-3d.ts` `sceneMesh`, the `READ` map), a reversed class mapping outside the plan's table (row 3, ruling 1); (2) Godot's primitive builders rebuild three's own scene geometry in place from per-resource storage modelled on the rendering server (`primitive-mesh.ts` `GEOMETRY`, `fill`, `godot_primitive_mesh_changed`) (ruling 1); (3) the sky's module-wide tree and child-order observers and `scene.onBeforeRender` walk the scene for directional lights (`world-environment.ts`) (row 4); (4) every plane, sphere and cylinder is flipped to Godot's UV origin (`godot_primitive_mesh_uv_top`) and every texture uploads with `flipY` false, where three's own convention gives the same image (row 5, ruling 1). Emitted from a clean copy of `3716fa8e`. |
| 2026-09-28 | `e1ca070f` | §The lane's law | holds: nothing new since `7218faba`; the four findings of `3716fa8e` are gone (no mesh read-back: `get_mesh` of a scene-drawn mesh fails by name; no rebuild of drawn geometry: a drawn primitive's setters fail by name; the sky's lights come from the plan as refs, with no tree observers or scene walk; three's UV convention, with only a glTF model's geometry unflipped). Row 1 and ruling 2 pass; rows 2 to 6 and ruling 1 still fail on the shapes `7218faba` named. Named as compliant but to watch: the model-variant materials chosen through a WeakSet of the loader's geometries, and the emitted reflections-capability materials. Emitted from a clean copy of `e1ca070f`. |
| 2026-09-28 | `d184a015` | §The lane's law | regressed: row 1 and ruling 2 pass; rows 2 to 6 and ruling 1 fail on the shapes `e1ca070f` named, less the timers, tweens and deletion queue (now each script's own, stepped from its component) and the audio players' frame signals. Two are new: (1) `queue_free`'s leave machinery, a module-level `LEAVE_OBSERVERS` list classes fill at load (`node.ts`, `collision-object-3d.ts`) and a subtree-wide `leaving` flag no Godot member exposes, read by processing, input and owned stepping (rows 3 and 4, ruling 1); (2) the soft-particle depth pass's `writesDepth`, which transcribes Forward+'s `uses_depth_in_alpha_pass` rule to decide which materials write depth (ruling 1). Emitted from a clean copy of `d184a015`. |
| 2026-09-28 | `546b057c` | §The lane's law | holds: nothing new since `e1ca070f`; both `d184a015` findings are gone (queue_free reads the node's own queued state; the depth pass takes three's rule). Row 4 is smaller: the SceneTree has no clock, frame counters, frame signals, timer, tween or deletion lists (timers and tweens are their creators', deltas read from Rapier and R3F, just-pressed the Input library's edges), `useGodotTree` is gone from the emitted world, and the audio players use the page's `onended`. Rows 2 to 6 and ruling 1 still fail on: emit's setter-name decisions and project walks (row 2); compat's class readers and class-name tests (row 3); the root Window flushing input to every node and drawing every canvas item, and the spawner, stand-ins and `flushSync` (row 4); the world's remaining hooks, `$native` and `__godot_value_N` in scripts (row 5); `@volter/game-runtime` and the editor files (row 6); `numeric.ts`'s tagged Variant, the SceneTree protocol and the Window's input and canvas machinery (ruling 1). To watch: the delta clamp's origin in Godot's main loop, Input's frame tracking by a microtask, the stretch math, the soft-particle depth pass, the runtime Variant helpers. Emitted from a clean copy of `546b057c`. |

**Order of work.**

Two conventions hold throughout (the orchestrator's, from the law, 2026-09-28). Where Godot's debug
and release builds differ, the lane follows the release build, which the originals ship as: an Array
store outside the array is dropped, since only a debug build reports it (`gdscript_vm.cpp:1084-1098`).
A script error in Godot aborts the function it is in and its caller carries on
(`gdscript_vm.cpp:3963-3993`). The lane approximates that per callback, not per function: each place
that runs a script's callback catches what it throws, so a throw deep in a helper aborts the whole
callback, where Godot would abort only the helper. The places are:
- the emitted scene's own `useFrame`/`useBeforePhysicsStep` running `_process`/`_physics_process`,
  which are the game's own hooks, so the catch is written there;
- compat's `_enter_tree`, `_ready` and `_exit_tree`, input, `_gui_input` and `_integrate_forces`;
- signal handlers, tween callbacks, `call_deferred` targets and animation method tracks.
It reports the error with `console.error`: release Godot prints nothing (the report is under
`DEBUG_ENABLED`), and the developer console is the web's place for it. One failing callback never
skips the frame or unmounts the game.

1. Retire the evidence gate from the import: bindings are what compat implements, and the plan
   stops reading claims. The claim records, the refresh, liveness and the case files go with it.
   Done: unit 1 (`b11f661e`) derived the bindings from compat; unit 2 deleted the claims and the
   evidence tooling (`src/evidence/`, `evidence/`, the measured records, the `evidence` and
   `liveness` commands).
2. Conform to rows 3 to 5 (unit 3 onward):
   - scripts run from their scene component's own hooks: `_ready` from a `useEffect` (React runs
     children's effects first, as Godot readies children first), `_process(delta)` from
     `useFrame`, `_physics_process` from `useBeforePhysicsStep` under `<Physics timeStep={1 / 60}>`,
     `_exit_tree` from the effect's cleanup, `_input` from a DOM listener the component adds;
   - the world is a plain component: `<Physics>` with the project's gravity and tick rate, the main
     scene inside it, settings and the input map as constant data;
   - spawning is React state: adding an instantiated scene is a state update its parent renders;
   - timers and tweens advance from the host's frame, in the hooks of the component that owns
     them; no library clock and no `setTimeout`;
   - physics is Rapier's own, through @react-three/rapier: each body's component registers its
     node and Rapier body when it mounts (no per-step listing of bodies, no per-kind declarers);
     CharacterBody3D's `move_and_slide` is Rapier's kinematic character controller (slide, floor
     snap, maximum slope, autostep); RigidBody3D is Rapier's dynamics, with gravity from
     `<Physics gravity>`, damping and gravity scale as props, and `_integrate_forces` run from
     the component's `useBeforePhysicsStep` through a body-state binding over the Rapier body;
     Area3D is a sensor's intersection events; RayCast3D and space queries are Rapier queries
     when asked; collision layers and masks are Rapier collision groups where Godot's 32 bits fit
     Rapier's 16, and a contact filter only where they do not;
   - class-name registries go, class-name dispatch leaves emit and compat, and `world.tsx` exports
     only its component; the editor and the walk drive a game with DOM input, as a player does.

   Landed (2026-09-27, `30c10e09` to `aad36aae`): scripts' frame and input callbacks are their
   component's hooks, gated by `godot_node_processes` so `set_process` and `set_physics_process`
   still stop them; a scene component attaches its scripts, connects its signals and enters the
   tree in its last effect, once React's commit is done, readying children first; the SceneTree's
   frames, timers, tweens and deletion queue run on the host's clock from the world's component
   (`useGodotTree`), and `Main::iteration`, `MainTimerSync` and the process lists are deleted;
   physics is Rapier's (the kinematic character controller, dynamics with a body-state binding,
   sensor events, ray and shape queries, collision groups, a contact filter for exceptions);
   `instantiate()` makes the root's script instance over a stand-in and `add_child` is a state
   update of the owning scene component, rendered as a portal and flushed at once, so the spawn
   host is gone and the output check allows no framework import; the class-mount registry is gone
   (a three camera is a Camera3D by type). Class-name dispatch left emit, lowering and compat
   (`b47fdc1c`): `translate/data/scene-node-idioms.ts`, `scene-resource-idioms.ts` and
   `lowering-shapes.ts` are the tables, the planner stamps each node and resource with its idiom,
   and emit, lowering and compat read the idiom; the ratchet's remaining findings read the API
   dump by class name (`lower-official-bound.ts`, `native-types.ts`) or name a keyboard code
   (`Control`). An emitted game carries the compat modules it reaches (`0d628816`). Compat's elements are
   idempotent under a re-render of their scene: each is made once and sets its authored values
   once (`GodotImportedScene`'s overrides, `aad36aae`; `GodotWorldEnvironment`'s registration).
   The headless runner (`gd-analyze run`, `src/run/`) loads one three, as the bundler does
   (`tsx/esm`, and `three` resolved to its module build for `require` too), so it plays what the
   browser plays.
   After the `d3afcb62` review (2026-09-27): the emitted world runs no frame work. The current
   camera is handed to R3F when it changes (`godot_camera_3d_attach_renderer`) and its projection
   written when its lens or the viewport's size changes; the root Window, a node, delivers the
   page's input and draws its canvas items from its own hook (`useGodotRootWindow`, `advance.tsx`).
   Spawning keeps no registry: a scene root's added scenes are that node's own state
   (`godot_node_added_scenes`), and `rootScript` is lowering's argument to `preload`. Ruled from
   the law, not changed (superseded 2026-09-28 by the owner, §The emitted game's shape steps 6
   and 7): the SceneTree's timers, tweens and deletion queue stay with the world's
   component, because the SceneTree owns them (`SceneTree::process_timers` and `process_tweens`,
   `scene_tree.cpp:793` and `:825`, walk the tree's own lists; a node's tween is only bound to the node for
   pausing and freeing, and a `create_timer` timer outlives the node that made it), and the world
   is the SceneTree's component. `add_child` keeps `flushSync` and the stand-in: Godot's
   `add_child` returns with the child in the tree and readied, and a script configures an
   instantiated root before adding it.
   After the `5c36cca7` review: no compat module patches three's shared shader chunks (the gles3
   light passes and `scene.glsl`'s material modes are gone, `3241f28c`); a material's settings map
   to three's own materials in the plan (`scene-material-idioms.ts`, `0920ce53`: unshaded is
   `MeshBasicMaterial`, toon `MeshToonMaterial`, `metallic_specular` a physical material's
   `reflectivity`; rim, backlight, grow and the fades are stored), and emit prints them; CPU and
   GPU particles are one three.js `InstancedMesh` emitter advanced from the node's own component
   (`7c3f0e5d`); and a reachability phase between emit and materialize keeps the compat modules
   the game's own files reach (`5260df45`).
   Merged with `main` (2026-09-28, `841f2c07`): `vgai` is retired and every name is Volter
   (`volter.project.json`, `volter.adapter.ts`, `.volter/`, `VOLTER_*`, the `volter-game-editor`
   CLI). The rename changed the bound exporter's source, so the 4.7 exporter is rebuilt from the
   pinned `5b4e0cb0` tree and re-pinned: exporter source `9e93aa85…`, executable `5fba713d…`,
   stored at `/Volumes/GodotWork/tools/godot-4.7-bound-exporter-volter/` (the old `c8034e90…`
   binary no longer matches). The 4.6 row was already stale, and its binary still speaks the
   retired `vgai.*` protocol, so its re-pin is open. `main` publishes every push (`38bfb751`), so
   landing `godot` on `main` publishes the public packages whose files differ from `main`'s
   (`git diff --stat origin/main godot -- packages/<name>`; `gd-analyze` is private and never
   publishes). Through the 0.5.77 merge those are `game-editor` and `threejs-runtime`: `main`
   already carries the editor's studio-light change (`829ec8eb`).
   Merged with `main` again (0.5.76): the import plan asks for `^` plus each workspace package's
   own version (`direct-project-data-plan.ts`, read through the monorepo's `node_modules`, which
   link the workspace packages; never the newest on npm), so after a merge that moves those versions the import refuses with "frozen
   package-lock.json … ranges differ from the planned merge", and the frozen import lock
   (`toolchain/package-lock.json`) is re-resolved (at `^0.5.76`, then `^0.5.77`). The recipe:
   - rebuild `package.json` from the lock's own root entry, with each range set as the plan sets
     it (`plannedPackageManifest`): each `@volter/*` range to that package's workspace version;
     the compat's own packages (`@dimforge/rapier3d-compat`, `@jsquash/webp`, the postprocessing,
     Rapier and `fast-png` ranges) to the lane's catalog entry
     (`packages/gd-analyze/capabilities/catalog/entries/godot-compat.json`); every other range to
     the game template's (`packages/game-editor/template/package.json`), which a merge from `main`
     can move too (`ztrack` at 0.5.77). The root lists only the 0.5.x
     lockstep packages; `blender-engine` and `editor-blender` come in transitively at their own
     0.1.x versions;
   - add the template's `overrides` (`packages/game-editor/template/package.json`, which pins
     drei's `stats-gl`), since a lock's root entry does not record them;
   - run `npm@11 install --package-lock-only` over the previous lock, which keeps npm's libc
     filters and the `lock-template` name;
   - check it: the 0.5.x editor and game packages are one lockstep set (`@volter/supercode*`,
     pulled in by `editor-core`, versions on its own); no nested copy of the game's runtime
     (`three`, `game-runtime`, `threejs-runtime`), while `editor-core`'s own nested React and R3F
     copies are expected (`main`'s lock has them too), and from `ztrack` 1.5.10 on, the supercode
     client is nested under `editor-core` too (`ztrack`'s optional peer asks a newer one);
     `stats-gl` unchanged; the libc filters kept; a few transitive packages may float, so read the
     list of changed versions; then both typechecks (gd-analyze and its project source), the platformer
     import and its probe.
   Only a version whose whole lockstep set is published resolves: the `@volter` packages pin each
   other exactly, and `game-editor` 0.5.76 sat staged on npm for a while after its release run
   reported success.
   Walks compare with Godot's web exports, which render with the Compatibility renderer, while
   the lane draws with three, which lights as Forward+ does. So compat reports `forward_plus` from
   `get_current_rendering_method()`. A game's own Compatibility-only branch (the 3D platformer kit's
   `main.gd` sets its sun to 0.24 and its background energy to 0.25 on `gl_compatibility`) then takes the look its
   author made for Forward+, as the kit's own screenshots show. A difference that comes only from
   the renderer (the Compatibility renderer's brighter additive light passes, a sky the
   Compatibility branch darkens) is accepted in a walk, not ported (ruling 1).
3. Ports resume closest first (`starter-kit-basic-scene`: model images outside the file, now
   landed, and CSGBox3D), each accepted by a walk.

Parked by these rulings: the GPUParticles3D branch (`godot-particles`, a transcription of gles3's
particle storage; superseded by the three.js emitter, `7c3f0e5d`), the Sprite3D branch (`godot-sprite3d`;
its members carry over, its emitter wiring waits for step 2), and `evidence --refresh --stale`
(`godot-stale`, moot once the gate goes).


## How a lane lands (2026-09-28, owner-approved: "go")

This is how the lane's work reaches `godot`. It adds no standard: the standard is §The lane's law
and its rows. It exists because three periodic reviews in a row came back `regressed`: new findings
arrived faster than reviews cleared them. The lanes were briefed to clear refusals, and they merged
with no check of the shapes the review hunts.

1. Every lane's brief carries §The lane's law and this reading of how its rows apply. The lane
   checks its own diff against it before committing:
   - Row 2: each phase owns its concern. Analysis types values. The plan decides every idiom,
     prop, ref and artifact. Lowering selects rules for the types analysis gives. Emit prints.
     None of them re-derives what an earlier phase decided, so emit reading a setter by its name
     is emit deciding what the plan should have stamped.
   - Row 3: a mapping from a Godot class, a built-in type or a setter to an idiom is a
     plan-time data table, not a branch.
   - Ruling 1: nothing of Godot's implementation is ported (its servers, renderer, particle,
     text or physics internals, update order or storage). The library's idiom gives the
     behaviour. A rendering detail may look like three.js rather than Godot's renderer, where a
     player would not take it for a different game.
   - Row 4: compat keeps no clock, scheduler, registry, spawn host or mirrored tree, and never
     drives other nodes' work from the frame.
   - Row 5: the output is what a three.js or R3F developer would write, with no generated
     dispatchers or helpers and nothing for tooling.
   - Ruling 2: no record, capture or comparison of Godot's output is kept.
2. Before a lane's commits merge to `godot`, one read-only skeptic who did not write them reviews
   that lane's commits alone, with this brief: "Review commits `<a>..<b>` in this repository
   against the section '## The lane's law' of docs/GODOT.md and ARCHITECTURE.md rule 4, read-only.
   For each finding: file:line, severity (blocker, should-fix or nit) and a one-line fix. End with
   `MERGE` (no blockers) or `HOLD`." A blocker is fixed before the merge. The merge's first
   commit on `godot` carries the trailer `Lane-review: MERGE` with the skeptic's should-fixes
   listed or fixed.
   Lanes share one checkout and branch, so a push carries every commit on it: before pushing,
   `git log origin/godot..HEAD` is read and each commit in the range is one whose review said
   `MERGE` (on 2026-09-28 a push of reviewed commits carried `c83f124c` ahead of its review).
3. A periodic review's `regressed` verdict means the change does not land (docs/GODOT-REVIEW.md).
   Its findings are fixed and the review re-run before more of the lane lands. New game work waits
   until the verdict is `holds` or `pass`.
4. The rows that fail by the emitted game's shape (rows 4 and 5) are their own track
   (§The emitted game's shape), not a lane's side effect.

## The emitted game's shape: the track for rows 4 and 5 (2026-09-28)

Rows 4 and 5 fail because of the shape every scene is emitted in, not because of any one lane.
The platformer's coin is the smallest whole example:
- `coin.gd` is thirteen lines;
- the emitted script reaches its node through
  `godot_node_entity(Node_get_node(this.$native, "Animation"))`, in `__godot_value_N` temporaries;
- the emitted scene is written against compat's scene machinery: `useGodotScript` adopting a
  script instance, `useGodotConnection` with a signal accessor for its own `body_entered`,
  `useGodotScene` entering the tree, and an `animationBindings` dispatch table.

What a three.js developer would write for the same coin keeps the script a class and gives it
refs, not tree lookups:

```tsx
export function CoinScene(props: RigidBodyProps) {
  const body = useRef<RapierRigidBody>(null);
  const { actions } = useAnimations(coinClips, body);          // three's AnimationMixer
  const coin = useMemo(() => new Coin({ animation: actions }), [actions]);
  return (
    <RigidBody ref={body} type="fixed" sensor colliders={false} {...props}
      onIntersectionEnter={({ other }) => {
        const script = scriptOf(other.rigidBodyObject);        // the body's script instance
        if (other.collider.isSensor()) return;                 // body_entered: bodies, not areas
        coin.onBodyEntered(script);                             // `body is Player` is `instanceof Player`
      }}>
      …meshes, particles, the sound…
    </RigidBody>
  );
}
```

The track moves the output toward that, one construct at a time, each a plan-time decision the
emitter prints:

1. **Static node access is a ref.** `$Path`, `get_node("literal")`, `%Unique` and an `@onready`
   member holding one resolve at plan time to the scene's own refs, handed to the script as
   typed fields. Only a path computed at run time keeps the tree lookup.
2. **A signal is a prop or a callback.** A scene `[connection]` and an engine signal a body
   raises (`body_entered`, `area_entered`, `timeout`, `animation_finished`) become the element's
   event prop, or a callback the element takes, calling the method directly. Only
   `connect()` with a computed target keeps the signal object.
3. **A script is the component's own state.** The script class stays a class. The scene makes it
   with `useMemo`/`useRef` and hands it its refs. Godot's orders are kept by the scene, which owns
   its nodes as Godot instantiates a scene as a unit:
   - `_enter_tree` runs parent-first and `_ready` children-first, from the scene root's effect in
     tree order (React effects alone run children-first);
   - `_process` and `_physics_process` run in tree order, by `process_priority`, gated by
     `set_process`, `set_physics_process` and `process_mode`, from the scene's own frame hook;
   - effects run once (no StrictMode double mount).
   The adoption machinery (`useGodotScript`'s pending instances, bindings on the native) goes.
4. **Values read as written.** A single-use temporary is inlined, so `__godot_value_N` appears only
   where evaluation order needs a statement.
5. **An animation is three's.** AnimationPlayer's tracks are `AnimationClip`s on three's
   `AnimationMixer` (drei's `useAnimations` idiom) over real object properties. The
   `animationBindings` dispatch table goes.
6. **The world is a scene.** Settings and the input map are plain data. Input is the page's DOM
   events. The world is `<Physics>` holding the main scene, with no hooks of compat's in it.
   Timers and tweens are owned by what creates them (the owner, 2026-09-28, superseding the
   ruling that they stay with the world's component): the owner is the script whose code makes
   one, `create_timer`, `get_tree().create_tween()` and `node.create_tween()` alike; the last is
   also bound to `node`, for pausing and freeing as in Godot, but it is the creating script's
   component that steps it, so a node only known at run time needs no component of its own. The
   plan records which scripts create them; the owner's component steps them from its own
   `useFrame` (and physics step), as a three.js component calls a tween library's `update`, and
   the binding takes its owner as an argument (a column of the call-shape table, never a
   "current script" held in compat). So there is no tree-wide list and no per-frame scheduler. An
   instance, its own code or its script ancestors', owns them, and one made before the instance
   mounts (between `instantiate` and `add_child`, or in `_init`) waits for its component. A
   caller with no component to own them is refused by name: a script no node or autoload runs (a
   RefCounted or Resource script) by the plan, a static function by compat. A node made by
   `Class.new()`, which React never renders, steps none of its own, which is stated where it is
   bound. A timer or tween, tree-made or bound to another live node, stops with its owner, where
   Godot's outlives a freed node; an
   owner that unmounts with a timer still pending and connected reports it (`console.error`), so
   that difference is never silent. An owner steps its own after its `_process`, where Godot
   steps every timer after every node's, so a timeout's effect on another node's `_process` can
   land a frame apart. `queue_free` takes the node out of play at once through its queued state
   (`is_queued_for_deletion`: no more callbacks, input or owned timers and tweens), as Godot,
   which frees it at the end of the step or frame it was queued in, never runs it again; at once,
   where Godot still runs it for the rest of that step or frame. Only the node: its children and
   its colliders carry on until it is freed, so a queued body can still collide in the frame's
   later physics steps (a state no Godot member exposes would be needed to stop them; the
   `d184a015` review counted one against the law). It is then freed as JavaScript defers, a microtask
   as `call_deferred` is, after the frame's draw (R3F runs callbacks, physics steps and draw in one
   task), so it is drawn one frame more than in Godot. There is no deletion queue. The inner
   classes and `Class.new()` nodes of an attached script own timers nobody steps, which the plan
   does not catch.
7. **What stays dynamic is bindings.** A path computed at run time, groups, `add_child` of an
   instantiated scene, `queue_free` and `get_tree()` stay compat's, as bindings over three's
   object graph and React state, not a tree compat keeps, and only where a script uses them. The
   plan records which scenes need them; a scene that doesn't carries none of it. `add_child` of
   an instantiated scene renders into the parent scene's own state, found through the parent
   scene's component, with no registry of spawners. The stand-in `instantiate` makes today (a
   three `Group` before the scene mounts, which the ledger counts under row 4) is this step's to
   remove: `instantiate` returns the root's script instance, which a script configures before
   `add_child`, and the added scene takes that instance as its script when it mounts.

The SceneTree's clock, what `useGodotTree` still runs after steps 6 and 7, goes the same way, from
what the corpus uses (the seven Godot 4 games, 2026-09-28):
- a delta is read from the host, never kept: `get_physics_process_delta_time()` is the physics
  world's own timestep (Rapier's), `get_process_delta_time()` R3F's frame delta, bounded as a
  script's `_process` delta is (racing's `vehicle.gd` reads the first); the world hands compat
  R3F's clock and the Rapier world together, and the frame's delta is the change in the clock's
  `elapsedTime` since the start read before (the root Window reads it every frame);
- `is_action_just_pressed` and `_released` (eight scripts) are the Input library's own edges:
  an action records when it changed, in the page's time, and "just" is a change since the host's
  current frame began, read from R3F's clock, not from frames the tree counts; where several
  physics steps run in one frame, it holds for each of them, where Godot holds it for the first
  (built 2026-09-28: the root Window's flush, first in every frame, opens the frame and a microtask
  closes it when R3F's frame task ends, so a change made between frames, such as `action_press` in
  `_ready`, belongs to the next frame as in Godot; a press a script makes mid-frame holds for the
  rest of that frame only, where Godot also holds it for the next physics step);
- the frame counters (`Engine.get_process_frames`, `get_physics_frames`, `is_in_physics_frame`)
  and the `process_frame` and `physics_frame` signals, which no corpus game uses, are refused by
  name until one does, and then are owned as timers are (the script awaiting or connecting to one
  is its owner);
- with nothing left to run, `useGodotTree` goes from the emitted world.

The emitted game is idiomatic three.js, which can still use libraries at its edges (the owner,
2026-09-28). Compat is such a library, never plumbing: what the game's code calls (a
Tween, a Timer, a Vector3, a binding over three's objects) is allowed, and so is a node's own
component advancing that node; what drives the game from outside it (a clock over every node, a
scheduler, a spawn host, a mirrored tree, hooks the emitted world is written against) is not.
Each step lands as its own lane under §How a lane lands. The ratchet gains a rule per step once
the step removes its pattern (compat hooks per emitted scene, `__godot_value_` temporaries,
`animationBindings` tables), so the output only moves one way. Each step is checked cheaply:
typecheck, the imports of every game that imports, and the headless probe. The behaviour must not
change, only the shape, and the games are walked once when the track is done.

## Where it lives

| Path | What it is |
| --- | --- |
| `packages/gd-analyze` | `@volter/gd-analyze`, the compiler: snapshot, official frontend, read, analyze, translate, emit, materialize. One CLI, `src/cli.ts` (`import`, `sweep`, `closure`, `refusals`, `run`). |
| `packages/gd-analyze/test/fixtures` | The pinned upstream corpus, each game unmodified under its `<id>.UPSTREAM.lock`. |
| `packages/gd-analyze/capabilities` | The lane's own catalog (`catalog/`, `template/.agents/skills`), shaped like the product's. It holds `godot-compat`, `godot-runtime`, `character`, `sprite` and the `fastlz` codec. The compiler copies from here. |
| `packages/gd-analyze/godot-frontend` | The exporter module compiled into Godot, its official-source patch, and the capture script. |

The capabilities stay out of `@volter/game-editor`'s catalog on purpose. That catalog's served
bundle must carry every package a capability imports (`scripts/check-served-bundle-modules.mjs`).
A capability moves there with the first translated game that runs in the editor, carrying only
that port's dependency closure.

## The intended architecture

> Superseded in part by §The lane's law (2026-09-27): the evidence law and the acceptance below are retired; the lane's own review rows replace volter-engine's ten.

The design is volter-engine `docs/ARCHITECTURE-CORE.md` §Foreign games and §Migration compiler
reference architecture, at the tag. In short:

- One compile-time pipeline: an immutable project and toolchain snapshot, the official Godot
  frontend run once, `read`, `analyze` into one data-only `BoundGodotProject`, `translate/data` and
  `translate/code` into one `TranslationPlan`, a mechanical `emit`, and an atomic `materialize`. The
  compiler disappears after import.
- Output is owned native TS/TSX with four artifact origins (source translation, project data, asset
  copy, capability copy). There is no generated shared helper, registry, dispatcher, mirrored
  scene tree or scheduler.
- Code lowering maps each official symbol through one data-only binding table to a native export,
  a typed `godot-compat` export, or a refusal. Nothing dispatches by Godot class name.
- `godot-compat` modules are BINDINGs onto native libraries or PROTOCOLs for Godot semantics that
  no library supplies. They never recreate Godot's renderer, servers, physics engine, scheduler or
  tree. `godot-runtime` is a neutral host (native identity, mount, frame, fixed frame, clock,
  hierarchy events) that names no Godot policy.
- The evidence law: every accepted rule carries an exact-pin citation and a native differential
  observation (official Godot 4.7 against the translated result) in a `SemanticClaimRecord`.
- Acceptance comes twice. The architecture passes a context-free blind review on ten rows, where
  any failed row means rejection. The product passes when the frozen corpus freshly translates,
  builds, boots with a silent console, plays, and matches native references.

This repository adds two rules the lane predates. ARCHITECTURE.md rule 4 says a game is plain
library code, and a runtime framework it is written against is a second programming model. Plan
unit 5 retires the manifest mount (`mountGameFromManifest`) that the emitted project shell still
uses.

## What was built (measured 2026-09-25)

**The compiler has the ruled shape.** volter-engine's 2026-09-03 series (`ca737bcbd` onward) deleted
the handwritten translator (`lang36`/`lang40`, `translate.ts`, `surface.ts`). Production lowering
now goes official bound nodes → `TargetTsSyntax` → TypeScript's printer, behind accepted/refused
plans. No blind review has run on it.

**The compiler bound no Godot API.** `godotCodeTranslationAuthority` returned a binding table with
`entries: []`. About 44 evidenced rules exist in total (language constructs, 8 scene-node rules,
read and field-value rules). Any script that calls a Godot API refuses. Before 09-03, the
handwritten translator ported twelve games that booted. Since then, nothing real translates.

**`godot-compat` is the pre-refactor compat, never conformed.** It is 612 files and 20.7 MB. Of that:

- 9.9 MB is four generated tables (`object-dispatch-{3,4}-{three,canvas}.ts`) keyed by Godot class
  name. The entry's own description names them "the sole ClassDB binding inventory consumed by
  emitted code". Rows 5 and 9 of the review forbid exactly this.
- 77 modules (1.2 MB) reimplement Godot internals: RenderingServer, RenderingDevice,
  PhysicsServer2D/3D, TextServer, DisplayServer, NavigationServer, XR/OpenXR, `*Extension`
  classes, and virtual shadow pages.
- The production compiler reaches none of it: no binding points in, and
  `registry/compat-dispatch-metadata.ts` has no importer.
- `sprite-3d.ts` and `kinematic-body-3d.ts` import the sibling `sprite` and `character`
  capabilities, which the compat import rule forbids.

**`godot-runtime` is the runtime framework rule 4 retires.** It exports
`createGodotSceneScheduler`, `createGodotSharedRuntime`, the input map, a game random stream and
physics and audio system slots, and it imports `@volter/editor-project`'s adapter seams. The
production path never copies it: the snapshot selects only `godot-compat` and what it requires.

**One corpus game is eligible.** Of the twelve pinned games, six are Godot 3, refused until a
Godot 3 exporter meets the 4.7 contract. Five declare 4.6, and no 4.6 frontend is pinned.
`platformer-3d-godot4` is the only 4.7 game. The emitted project declares one Three root, so no
2D game has a target yet (this repository has no canvas integration).

**The generated goldens stayed at the tag.** There are fourteen trees, last regenerated 2026-08-26
by the retired translator. They import names the 09-03 lifecycle refactor removed, and they inline
what row 8 forbids (`components/scene-runtime.ts`, `sampleCurve`, per-scene particle simulators).

**The frontend is pinned.** volter-engine's 09-15 record found no way to tell which of eight exporter
builds was authoritative. The answer was already on disk: each build's `identity.json` records its
exporter-source digest. The restored source matched `-current`, `-full` and `-multiplayer`. Only
`-full` enables every engine module, which a game's scripts need (GridMap, CSG, navigation), and
the committed build script built the modules-off variant. The script now builds with every module
enabled. `source-authority.ts` pins the build by executable, exporter-source, engine-tree and
build-option identity, and the toolchain snapshot refuses any other build by name. The pinned
build is `/Volumes/PeakSSD/volter-work/tools/godot-4.7-bound-exporter-seal`, rebuilt from this
repository's module (`scripts/build-godot-bound-exporter.mjs`). The official Godot 4.7-stable
binary is the native oracle the evidence records cite (`445c6f95…`).

**First reading, `import platformer-3d-godot4`.** The toolchain now passes: the pinned frontend
binds all eight scripts, and the import refuses in `analyze` on 46 read diagnostics. That list is
the lane's work order:

- 32 asset references the reader does not open: `.wav` audio, `.webp`/`.png` textures, a
  `.gdshader` and a compressed cubemap (`ext-resource-opaque`);
- `enemy.glb` and `player.glb` instanced as scenes stay opaque (`instance-expansion-opaque`),
  although `read/gltf-godot-scene.ts` exists;
- the authored children under those instances cannot find their parents
  (`node-parent-dependency-unresolved`).

Six walls came before it, each fixed:

- in this repository's layout: capability packages missing from the workspace lock; the engine's
  workspace-linked packages, now recorded as build identity rather than npm resolutions; and
  capability files declared outside `src/lib`;
- in the exporter's C++, each then rebuilt and re-pinned:
  - `player.gd:159` preloads `bullet.tscn`, so Godot's analyzer finishes `bullet.gd` through
    ResourceLoader before the exporter seals its cache. The seal now accepts the prepared object
    from either cache.
  - A headless capture has no global class cache, so every `class_name` failed to resolve
    (`coin.gd`: "Could not find type Player"). The exporter now registers each source's class
    through the two calls the editor's filesystem scan makes.
  - Every plain assignment asked Godot for the name of `OP_MAX` and printed an engine error, 79
    times on this game. The output is byte-identical and stderr is clean.

**Unlanded branches.** 100 `velocity/godot-*`, `feat/godot-compat-*`, `codex/godot-*` and
related branches (2026-08-27 to 09-01, about 183k added lines, many stacked on one another)
predate the 09-03 refactor. The three largest (`velocity/godot-endless-ui-code30-36`,
`…-endless-core-code30-38`, `velocity/godot-rendering-a299`) grow the dispatch tables, the files
the refactor deleted, and the server modules above. They are source material for single
protocols, never merges.

## The capability closure

`gd-analyze closure` reports what the pinned corpus uses: the official compiler's selected call
targets, the calls it left unresolved, attributes on typed bases, operators, node classes,
resource types, signals and asset formats. The report is read-only. It reads Godot 4.6 projects with the
pinned 4.7 frontend as a measuring instrument, and lists Godot 3 projects as unread. It is the
denominator for "capture all the capabilities": compat and translation are complete for the
corpus when every row the report prints is bound or planned.

Measured 2026-09-25 over the five readable Godot 4 games: 147 call targets on about 40 classes,
207 attributes, 49 operator forms, 35 node classes, 38 resource types and 16 asset formats.
`starter-kit-fps` does not read yet. Its `preload` of a scene holding imported assets needs
Godot's import cache, which only an editor build produces.

## The compat contract

> Superseded in part by §The lane's law (2026-09-27): members are idiomatic library code informed by Godot's source, not transcriptions of it; evidence, comparators and claim records are retired. The module layout, naming and native receivers stand.

This contract says what `godot-compat` is, and a mechanical check enforces it (`scripts/check-godot-compat.mjs`,
run by the pre-commit hook). It applies ARCHITECTURE-CORE §10 and ARCHITECTURE.md rule 4 to one
package. The owner's direction (2026-09-25) was that Godot's own source is readable, so behaviour is read
from it rather than guessed; the 2026-09-27 ruling keeps that and drops transcription (§The lane's
law).

**One module per Godot class.** `godot-compat/<kebab-name>.ts` holds the members of exactly one
Godot class, built-in type or singleton, named as Godot names it: `character-body-3d.ts`,
`vector3.ts`, `input.ts`, `global-scope.ts`. A module's header names its class
(`@godot-class CharacterBody3D`) and its role: `BINDING` (onto an existing native library) or
`PROTOCOL` (Godot semantics that no library supplies).

**Exports are Godot's members, by Godot's names.** Every bound member is an exported function
named exactly as Godot's method (`move_and_slide`, `normalized`, `get_velocity`), and its first
parameter is the receiver. A property binds through the getter and setter ClassDB declares for it
(the API dump names them), so every binding is a method binding. Operators are
`op_<variant-operator>` functions in the left operand's module, and constructors are
`construct`. Each export's doc comment carries `@godot Class.member` and `@source <file>:<line>` at
the pinned revision.

**Receivers are native.** A node's receiver is its native entity: the `THREE.Object3D` the
generated JSX mounted (`Mesh`, `PerspectiveCamera`, a light), with its Rapier body or collider
reachable from it; a `Control`'s receiver is its DOM element, as the Unity lane's uGUI already
does. Godot state that no native object holds (a body's `velocity`, a node's groups, process mode)
lives in a module-level `WeakMap` keyed by the native entity, in the module of the class that
declares it. Compat indexes native identity; it never owns a second tree.

**Built-in types are values.** `Vector3`, `Basis`, `Transform3D`, `Color`, `Plane`, `Rect2` and
the rest are immutable records created only by their module. Components are stored as Godot stores
them (`real_t` is 32-bit in the pinned build, so `Math.fround`). Code lowering gives Godot's value
semantics explicitly: `v.x = 1` becomes a new value assigned back.

**Forbidden, and checked:** a table or switch that selects behaviour by Godot class name; any
module for a Godot server, `RenderingDevice`, XR/OpenXR or an `*Extension` class; a frame loop,
timer loop or scheduler of compat's own (`requestAnimationFrame`, `setInterval`, a queue drained
outside a host event); imports of `@volter/editor-*` or of a sibling capability; an export without
`@godot` and `@source`. `godot-runtime` is gone. The generated composition site hands compat's
lifecycle protocol the host's own events (R3F's frame, the Rapier step), and no Godot runtime
package sits in between.

**The target platform is Godot's web platform.** Where Godot's behaviour depends on the
platform, a translated game gets the answer Godot's own web export gives:
`RenderingServer.get_current_rendering_method()` is `"gl_compatibility"`, and a function Godot
delegates to the C library is the browser's (the `platform-libm` comparator). A server singleton
(`RenderingServer`, `PhysicsServer3D`, `DisplayServer`) may therefore have a module, but only for
its public members: each is a `BINDING` onto three's renderer settings, Rapier or the browser,
cited to the web platform's code path. It never reimplements the server.
The same rule decides renderer features the Compatibility renderer ignores: they draw as it draws
them. `GeometryInstance3D.transparency` is stored and read back but draws nothing on the web,
because the Compatibility renderer never reads the instance's `force_alpha`
(`drivers/gles3/rasterizer_scene_gles3.cpp:1477`, and `rendering_method.web` is fixed to
`gl_compatibility`, `main/main.cpp:2644`); the material keeps its opacity.
Environment effects the Compatibility renderer draws only in its post pass (glow, SSAO,
brightness/contrast/saturation) are drawn by one `EffectComposer` (`@react-three/postprocessing`,
the library `threejs-runtime` already builds its chain on), mounted only when the environment
enables one. Its effect transcribes gles3's own `post.glsl`, `glow.glsl` and `s4ao` passes (vendored
with Godot's license); the `post-effects` proof evaluates them bit-exact against Godot's shader
math. Not yet measured at runtime: no proof renders WebGL.
Engine-generated shaders (PanoramaSkyMaterial, ProceduralSkyMaterial, PhysicalSkyMaterial) are
lowered like a project `.gdshader`: the exporter module captures the text Godot generates for each
variant (`export_engine_shader`) and runs it through the same frontend. The exporter's source patch
keeps shader code in the headless RenderingServer so it can be read; the patch affects only the
capture tool, never the official binary evidence runs against.
A `Decal` likewise draws nothing: the Compatibility renderer's decal API is empty
(`drivers/gles3/storage/texture_storage.cpp:2497`), so `<GodotDecal>` stores and reads back its
parameters and bakes no geometry.

**Comparators.** A claim compares native and target with one named comparator, and a
tolerance records the measured maximum:

- `exact` compares bit for bit. It is the default and covers everything Godot computes itself.
- `platform-libm` allows ≤1 ulp, for members Godot delegates to the C library.
- `web-platform-fact` and `render-mapping` cover facts headless Godot cannot show (the web
  renderer, parameter mappings onto three). A cited source line stands in for the native run.
- `rapier-geometry` is a bounded deviation for anything derived from collision geometry: contact
  points, depths and normals, contact and collision counts, and the motion that follows. Rapier
  owns collision detection.
- `physics-trajectory` is a bounded deviation for integrated rigid-body motion from another
  solver.

A derived quantity (velocity from position change) is compared through what it derives from. A
bounded deviation names, in the claim, each value the substituted library decides (for example
"contact points: Godot 2 / Rapier 1, capsule side on box"). Its bound is justified from the
geometry, never set at the measurement. A claim's identity covers every compat module its
cases ran, transitively, so an edit to a shared module makes every claim that used it stale.

**Physics.** Rapier holds the world, bodies, broad phase, collision detection and rigid
dynamics. Compat keeps Godot's protocol above it: `move_and_slide` and `move_and_collide`
(recovery, bisection, rest contacts, floor/wall classification), Area3D membership and signal
timing, 32-bit layers, masks and exceptions through Rapier's hooks, and shape resource data.
A cast counts as a hit only where Rapier confirms the shapes touch; Rapier's casts report
impacts early in proportion to the target's size. The check refuses a server-named module
that binds no library, exceeds 320 code lines, or defines narrow-phase algorithms (GJK, EPA,
SAT, support, Minkowski, simplex, closest points).

**Untyped code is typed by analysis, not dispatched at runtime.** `analyze` gives a receiver the
type Godot itself guarantees there, and records the rule as evidence:

- an engine virtual's parameters (`_integrate_forces(state)`) take the virtual's declared types
  from the API dump;
- `$Path` and `get_node("Path")` take the class of the node at that path in every scene the script
  is attached to (they must agree);
- an untyped local takes its initializer's type while no other assignment reaches it;
- an `@onready` member initialized from `$Path` or `get_node(literal)` (optionally `as T`), with no
  setter, not exported and assigned nowhere else in the project, takes the node's class
  (`@implicit_ready`, `gdscript_compiler.cpp:2409`). An `AnimationTree` subscript on such a
  member must name a parameter of that tree's graph. Assignment through reflection
  (`set("name", …)`) is not seen.
- an untyped parameter takes the one type every caller passes (engine virtuals, a scene
  connection's signal, script calls by name); a parameter reachable any other way (a `Callable`,
  a string naming the function) stays untyped;
- an untyped signal's handler parameter takes the one type every `.emit()`/`emit_signal()` in the
  project passes; disagreement or a dynamic emit leaves it untyped;
- an untyped member takes the one type every assignment in the project gives it.

A freed object is null to GDScript 4: `freed == null` is true, `if freed:` is false,
`is_instance_valid(freed)` is false, and two freed objects compare equal (measured on official
4.7). Every `==`, `!=`, `not` and truthiness rule over Object types reads compat's freed state.

Compound assignment on a Variant subscript (`x[k] += v`) refuses: Godot's evaluator picks the
operator from the runtime type, and compat's numbers carry no int/float tag. No game in the
corpus uses it; when one does, the element is typed by analysis so the typed operator applies.

A call whose receiver is still unknown lowers to a callsite-local switch over the finite set of
classes that can reach it, the pattern ARCHITECTURE-CORE already rules for dynamic resource paths.
A call whose set is unbounded refuses.

**Evidence is produced by an instrument, not written by hand.** `gd-analyze evidence <class>`
runs a module's cases in two places and compares them. Each case sits in
`evidence/godot-4.7/<class>.cases.ts`: GDScript run by the official Godot 4.7 binary headless, and
the same inputs run through the compat export in Node. The command writes the
`SemanticClaimRecord`s and the binding rows to `src/translate/code/authority/godot-4.7/<class>.json`.
A node-level case builds its scene in both places and steps physics frames in both. The binding
table loads those files; a row whose claim is not live refuses, as before. (Deleted in unit 2 with
the rest of the evidence machinery: the binding table now comes from compat's exports.)

**Allowed imports** are npm packages (three, Rapier, pixi.js…), `@volter/threejs-runtime` and
`@volter/game-runtime`, and other `godot-compat` modules. The check refuses every other
`@volter/*` package and any `../` outside `godot-compat/`. It also refuses a class-name `Map`,
object literal or `switch`, and an entry whose `files` differ from the files on disk.

A class's PROTOCOL may span modules when one would pass a readable size: the Node lifecycle is
`node-process.ts` (ordering) and `react-lifecycle.tsx` (the generated composition's hooks), both
`@godot-class Node`.

**State (2026-09-25).** The compat that came back from the tag did not meet this contract and is
removed (609 of 612 modules, with `godot-runtime`, `character`, `sprite` and the codec). Three
modules remain: `node-process.ts`, `react-lifecycle.tsx` and `signal.ts`. `signal.ts` keys a
connection by reference identity until a conformant `callable.ts` supplies Godot's Callable
equality. Everything else is rebuilt class by class from the closure. The Godot source is the
authority; the old module at the tag is a reference (volter-engine
`archive/godot-lane-2026-09-19:packages/editor/catalog/project-source/src/lib/godot-compat/`).

**First class through the instrument: `Vector3`.** 413 cases agree bit-exactly with official Godot
4.7, including `rotated` through `sinf`/`cosf`. Planted defects (a double-precision `dot`, an
unrounded `cos`) produce 23 mismatches and write nothing. One finding: GDScript's bytecode
generator merges `-0.0` into an earlier `0.0` constant in the same function
(`gdscript_byte_codegen.h:107`), so each case runs in its own function.

## The output is idiomatic three.js (owner ruling, 2026-09-26)

> Superseded in part by §The lane's law (2026-09-27): the owner's 09-26 ruling on idiomatic output stands and is extended; where this section has compat as a frame clock running Godot's callbacks, or rows as evidenced rules, ruling 1 and row 4 replace it.

The owner's words: "we're supposed to be writing idiomatic threejs while using godot compat
runtime for the godot lib stuff."

A translated game reads like a game written by hand in React Three Fiber, and the editor
authors it like one. Scenes are ordinary JSX: transforms as `position`/`rotation`/`scale`
props, geometry and materials as child elements with literal args, lights and cameras with
three's own props, physics through `@react-three/rapier`'s components. Values are converted at
import into three's units and written as literals. The godot-compat runtime is what the
translated scripts call for Godot's API (`rotate_y`, `move_and_slide`, `Input`, signals,
timers) and the frame clock that runs Godot's callbacks. It never builds or configures the
scene the JSX already states.

The same scene, as it must be emitted:

```tsx
export function MainScene() {
  const ball = useRef<Mesh>(null);
  useGodotScript(ball, Spin, { speed: 1.5 });   // script attachment: the runtime's one door
  return (
    <group name="Main">
      <directionalLight name="Sun" position={[0, 4, 0]} rotation={[-Math.PI / 4, 0, 0]} intensity={3.77} />
      <PerspectiveCamera name="Camera" makeDefault position={[0, 2, 6]} rotation={[-0.347, 0, 0]} fov={75} near={0.05} far={4000} />
      <RigidBody name="Floor" type="fixed" colliders={false}>
        <CuboidCollider args={[2, 0.1, 2]} />
        <mesh name="Mesh">
          <planeGeometry args={[4, 4]} />
          <meshStandardMaterial color="#cc4d33" />
        </mesh>
      </RigidBody>
      <mesh name="Ball" ref={ball} position={[0, 1, 0]}>
        <sphereGeometry args={[0.5, 64, 32]} />
        <meshStandardMaterial />
      </mesh>
    </group>
  );
}
```

**Where the rollout stands.** These are emitted in the idiomatic shape, with the old
setter-at-mount path deleted:

- nodes, transforms, instanced scenes (as prefabs), scripts through `useGodotScript`, and autoloads;
- static, rigid and character bodies, areas and their colliders on `@react-three/rapier`, and
  `<GodotRayCast3D>`, driven by compat's physics through one Rapier (0.19.2) stepped by Godot's
  clock;
- `<GodotAnimationPlayer>` and `<GodotAnimationTree>` over compat's one mixer, WorldEnvironment
  with its Environment and Sky (a sky `ShaderMaterial` lowered from Godot's own shader AST),
  `<GodotDecal>`, `<GodotGridMap>`, imported models as `<GodotImportedScene>`, and runtime
  instancing through the spawn host;
- primitive meshes as three's geometries, ArrayMesh as a `<bufferGeometry>` from a data file,
  StandardMaterial3D as `<meshStandardMaterial>`/`<meshBasicMaterial>`, textures through
  `useGodotTexture`, lights, and the camera;
- canvas items, Label3D and audio players as compat JSX components with literal props
  (`<GodotLabel …/>`, `<GodotAudioStreamPlayer3D …/>`), through `useGodotElement`.

A resource Godot shares between nodes is one object in the output, declared once and referenced
by each user, because a script that mutates it changes every user. Named render deviations:
`colour-quantization`, `primitive-geometry`, `primitive-uv`, `sphere-pole-u`,
`cylinder-uv-layout`, `uv-origin`, `light-direction`, `shadow-mapping`, `transform-decomposition`
and `disabled-scale-omitted`. A GridMap is its cells' collision object: a `<GodotGridMap>` with
one declared fixed body.

What follows from the ruling:

- **A family maps to three's idiom first.** A primitive mesh is three's matching geometry with
  Godot's parameters. A material is three's material with converted colours. A light's energy
  and range become three's intensity and distance, computed at import. Where three's geometry
  or shading differs from Godot's (vertex order, UV seams, shading model), the difference is a
  recorded `render-mapping` deviation, not a reason to build the object imperatively. Only a
  Godot resource with no three equivalent becomes a compat component used as JSX (for example
  `<GodotCylinderMesh .../>`), and it still reads as a React element.
- **Compat reads the scene; it does not own it.** A Node3D's Godot transform is read from the
  Object3D's own `position`, `quaternion` and `scale` (float32 at read). `matrixAutoUpdate`
  stays on. Godot-only state (the euler/scale split, groups, process mode) lives in compat's
  WeakMaps, seeded from the JSX. A body is the `RigidBody` the JSX declares, and compat's
  physics protocol drives it through its API.
- **Scripts attach through one hook.** An authored export value is a prop of that hook. `$Path`
  lookups resolve over the mounted tree, so node names in JSX are Godot's names.
- **Project data is data.** The input map and settings are JSON files the world imports, and
  they hold only the actions the project defines or uses.
- **Scripts stay as they are.** Classes over Godot API calls into compat are the ruling's "godot
  compat runtime for the godot lib stuff".

Audit against the ruling (2026-09-26), since carried out by the rollout above: the emitted scenes contradicted it throughout. Every node
is adopted and configured in a `useLayoutEffect` through compat setters, resources are built at
module scope through compat constructors, every transform is a `matrix` with
`matrixAutoUpdate={false}`, bodies are compat-owned instead of `@react-three/rapier`, and
`world.tsx` inlines all 91 built-in input actions. That list is the work order: the scene
emitter and the families' scene rules are rewritten to this shape. It is proven first on the
worked example above, then carried to each family.

## Scene structure

> Superseded in part by §The lane's law (2026-09-27): rows are plan data, not evidenced rules; there is no evidence gate.

What a `.tscn` says about structure, independent of any node class, lowers as follows. Each row
is one evidenced rule, measured by building the same scene in official Godot and in the generated
component:

- **An instanced scene** (`instance=ExtResource(...)`) is that scene's generated component used as
  a JSX element (`<MobScene />`), the prefab form. Properties authored on the instance root are
  the component's props. Children authored under it are its children. Editable-children overrides
  deeper in the instance refuse until their own rule lands.
- **Groups** are data handed to compat's Node protocol at the composition site
  (`add_to_group` on mount, in authored order); the protocol owns group queries.
- **NodePath properties** (an exported `@export var target: Node3D` set in the scene) resolve at
  the composition site to the referenced node's native entity, passed to the script instance.
- **Authored sibling order** is JSX order.
- **Property values** convert by type: a built-in value becomes its compat record through
  `construct`, and a resource becomes its planned native object. A native property's value goes
  through the property rule of its node family.

## Node, SceneTree and the composition site

> Superseded in part by §The lane's law (2026-09-27): this describes the current code. The main loop, `MainTimerSync`, the spawn host and class mounts are what ruling 1 and row 4 remove; the host owns frame and physics, React owns mounting.

The design for the tree, set from what Node3D measured. The first native classes are proven:
Node3D and Camera3D, 724 cases, exact.

- **One native entity per Godot node.** A 3D node is the `THREE.Object3D` its JSX mounts, and a
  Control is its DOM element. A plain `Node` in a 3D tree mounts as a `<group>` that compat marks
  non-spatial: its matrix stays identity, and Node3D's parent rule skips it. A Node3D under it
  therefore takes global = local, as in Godot.
- **Transforms are idiomatic props.** A scene node's authored `Transform3D` is written as
  `position`, `rotation` and `scale` props (§The output is idiomatic three.js), under the named
  `transform-decomposition` deviation. Node3D's module owns the decomposition three reads.
- **Tree structure is read, not kept.** A node's parent and children are the native links
  (three's `parent`/`children`, the DOM's), and `get_node` walks names over them. Name, groups,
  process mode, ready state and owner are Node PROTOCOL state in WeakMaps keyed by the entity.
- **React mounts; the SceneTree notifies.** React mounts and unmounts native objects, and its
  effects only register them and their script bindings. Every Godot notification (enter tree,
  ready, exit tree) is run by compat's SceneTree from the main loop, as `Main` and `SceneTree` run
  them: the startup forest (autoloads, then the main scene) enters at the start of the first
  iteration, before any physics step; a scene React mounts later enters on a script's
  `add_child`, or, placed under the tree root by the editor, at the next iteration.
- **Runtime instancing mounts the same scene component.** `preload` of a project scene is one
  `PackedScene` per path holding the scene component the editor authors. `instantiate()` mounts it
  synchronously (R3F's `flushSync`) through one spawn host in `<GodotMain>`, as a portal into a
  group outside the tree, so the R3F store, the Rapier world and the autoloads reach it, and
  returns the root not in the tree. `free`, `queue_free` and `remove_child` exit through compat;
  freeing an instanced root then unmounts its component. A declared Rapier body whose node is
  outside the tree is disabled until the node enters. `instantiate()` while React is committing
  (a script's `_init`) is a named error; no corpus script does it. The `scene-spawn` proof
  (spawn in `_ready` and in `_physics_process`, remove, re-add, free) agrees with official Godot.
  A native node made with `Class.new()` attaches imperatively to its parent's entity, which React
  never reconciles.
- **SceneTree's clock is the host's.** The generated world runs Godot's frame order from R3F's
  frame and a fixed physics step (`physics/common/physics_ticks_per_second`, default 60):
  notifications, `_process`, `_physics_process`, deferred calls, timers (`create_timer`), tweens
  and signals. Compat implements the ordering (`scene/main/scene_tree.cpp`) over those two
  events and creates no loop of its own.
- **The composition site is `<GodotMain>`** (compat `main.tsx`), which the generated `world.tsx`
  renders from plan data:
  1. R3F's scene is the tree root; autoloads and then the main scene enter the tree, scripted or
     not.
  2. Each R3F frame runs one `Main::iteration`: the page's buffered keys are delivered, then the
     iteration runs, then the canvas is drawn. Timing is a transcription of `MainTimerSync` with its
     delta smoother, the project's physics tick rate, and the cap of 8 physics steps per frame.
  3. It creates the Rapier world and hands it to World3D. Rapier's own gravity is zero, because
     compat applies the project's gravity and damping. The world is stepped only by the clock.
  4. The root window takes the canvas's drawing-buffer size on every resize; the renderer is
     handed to the viewport.
  5. Canvas items draw into a layer over the canvas, which the pointer passes through. Godot's
     default font comes from the capability's copied bytes.
  6. DOM keyboard, mouse and touch events become Godot's event records as the web display server
     makes them (its key table and modifier rules). The InputMap is plan data: Godot's 91 built-in
     actions, with the project's `[input]` actions over them.
  7. The viewport's current Camera3D, under Godot's current-camera rules, becomes R3F's camera each
     frame.

  The `project-world` proof runs a generated world in Node for 23 frames against official Godot.
  It presses real DOM keys, and callbacks, action states, the Label, the camera and a rigid body's
  path agree. Not yet measured: irregular frame timing (native Godot runs at fixed fps here),
  wheel, gamepad and IME input, and device-pixel ratios above 1.

## The canvas: Controls, Node2D and text

> Superseded in part by §The lane's law (2026-09-27): members are idiomatic DOM and three.js code read from Godot's source, not transcriptions of it.

Each canvas node (Control, Node2D) is a non-spatial three `Group`, so the Node tree needs no
second kind of entity. Its layout is Godot's own, transcribed from `control.cpp` and the
container classes and recomputed at the moments Godot recomputes it. It is drawn by
`godot_canvas_draw(viewport, root)`: one absolutely placed DOM element per item, layers stacked
by `layer`, Control origins snapped to whole pixels as Godot does, `modulate` as an sRGB colour
filter. The DOM is only where the item is drawn; CSS never lays anything out.

Text is the browser's. A font is a CSS family registered with the page as a `FontFace`: the
default theme's Open Sans SemiBold (the file the pinned revision embeds, shipped beside compat)
and each imported `FontFile`. Compat measures with a 2D canvas context's `measureText` (an em-box
estimate where there is no canvas, as in jsdom) and wraps by the autowrap mode with a greedy
word or character break; a Label is drawn as DOM text in its element (CSS font, colour,
`-webkit-text-stroke` outline, `text-shadow`, `text-align`), a Label3D on a 2D canvas textured
onto its quad. Godot's text server (FreeType metrics, HarfBuzz shaping, ICU breaks) is not ported
(`font.ts`, after the `7ba339e1` review).

Input reaches nodes as Godot delivers it: `Viewport.push_input` runs `_input`, then the GUI,
then shortcut, unhandled-key and unhandled input, in reverse tree order, and stops at
`set_input_as_handled`. It is fed the same event records `Input` receives.

## Node families

> Superseded in part by §The lane's law (2026-09-27): families are added as idiomatic library code with no instrument evidence; where a family below transcribes a Godot builder or keeps a Godot system over a library's own (a Godot `AnimationMixer` over three's), ruling 1 replaces it as the family is conformed.

A scene node becomes native JSX in the generated scene component. The JSX element is its native
entity, and compat's receiver for that node. Each family below is one unit: a scene-node rule
per class (its target element), a property rule per authored property (serialized value → JSX
prop, a transcription of the setter), and the compat module for its members. Each family lands
with instrument evidence. The mapping follows the library a hand-written R3F game would use, so
the output is plain library code (ARCHITECTURE.md rule 4):

| Godot family | Target |
| --- | --- |
| `Node3D`, `Node` | `<group>` |
| `MeshInstance3D` + primitive meshes (`PlaneMesh`, `QuadMesh`, `SphereMesh`, `CylinderMesh`) | `<mesh>` with geometry generated by transcribing Godot's `PrimitiveMesh` builders (vertex order, UVs and normals as Godot writes them) |
| `ArrayMesh`, imported `.glb`, `.res` meshes | the asset converted at import to glTF, loaded by three's `GLTFLoader` through R3F's `useLoader`; an instanced `.glb` keeps its node names so `$Path` and authored children resolve |
| `StandardMaterial3D` | `MeshStandardMaterial`, parameters transcribed from Godot's scene shader |
| `ShaderMaterial` + `.gdshader` | the shader text parsed by Godot's own `ShaderLanguage`, its AST exported by the exporter module and lowered to GLSL. Landed for the sky shader mode (built-ins named as the Compatibility renderer's sky pass names them); a sky shader that reads a built-in not carried refuses by name. Other shader modes: later units |
| `Camera3D`, `DirectionalLight3D`, `OmniLight3D`, `WorldEnvironment`/`Environment`/`Sky` | three's camera, lights and scene environment, Godot's units converted by transcribed formula. `WorldEnvironment`, `Environment` and `Sky` landed with evidence |
| `CharacterBody3D`, `RigidBody3D`, `StaticBody3D`, `Area3D`, `CollisionShape3D` + shapes, `RayCast3D` | `@react-three/rapier` bodies and colliders; `move_and_slide` and the contact state are compat PROTOCOL over Rapier's character controller and queries |
| `AnimationPlayer`, `AnimationTree` | ONE Godot `AnimationMixer` in compat, as PROTOCOL (three's `AnimationMixer` is not used: two mixers would disagree on blending and track caching). `<GodotAnimationPlayer bindings libraries autoplay/>` and `<GodotAnimationTree>`; each library and blend tree is a data file, tree parameters are a prop. Track paths bind at plan time: a value track to the property's setter or a script field, a method track to the native method; a script's own function is called by name, as Godot does. Bone tracks start from the bone's rest. An imported model's clips are keyed as Godot's importer keys them (`read/gltf-animation-import.ts`: resampled at `animation/fps`, missing tracks filled, `Animation::optimize(0.01, 0.01, 3)`), 3,173 of 3,176 platformer keys bit-exact, and its RESET is applied at mount. Named deviation: rotation within one float32 step (Godot's slerp goes through the platform's `acosf`/`sinf`). Not transcribed, erroring by name: angle and cubic interpolation, root motion, capture, blend-shape, audio and animation tracks, ping-pong loops, state machines, blend spaces, one-shots and transitions, custom timelines |
| `AudioStreamPlayer`, `AudioStreamPlayer3D` | Web Audio through three's `Audio`/`PositionalAudio` |
| `CanvasLayer`, `Control`, `Label`, `TextureRect`, `HBoxContainer`, `Node2D`, `Sprite2D`, `TouchScreenButton` | non-spatial Groups laid out by Godot's own layout code and drawn into a DOM root (§The canvas). Landed: exact against official Godot, proven from a scene file by the `scene-ui` proof. Layout-mode and anchor setters, which have no hash in the API dump, are resolved from the scene file by name. |
| Imported textures (PNG, lossless WebP), `ArrayMesh`, `Label3D`, `AudioStreamPlayer`/`AudioStreamPlayer3D` with WAV streams and randomizers | Landed in the pre-ruling output shape (proofs `scene-textures`, `scene-meshes`, `scene-audio`); their Godot-semantics modules carry over, their scene emission is redone in the idiomatic shape. Named deviations: `audio-compression`, `web-audio-attenuation`. Not yet: audio buses, sequential randomizer playback. GridMap waits on a ruling for static collision that is not a node. |
| `GPUParticles3D`, `CPUParticles3D`, `GridMap`, `ReflectionProbe`, `CSGBox3D`, `Label3D`, `Sprite3D` | later units, in closure order |

## Where it stands (2026-09-27)

> Superseded in part by §The lane's law (2026-09-27): a record of the state before the rulings; the evidence it describes is retired.

Measured through the lane's own commands and, for the platformer, the game editor's own doors.

- **Frontend.** Every Godot 4.x project up to the pinned 4.7 runs under the 4.7 authority: its
  exporter, its editor's `--headless --import`, and every table. The snapshot records the release
  the project was authored in beside the authority it ran under; a project newer than 4.7 refuses
  by name. The feature vocabulary is measured on 4.6 and 4.7; older minors are assumed to share
  it (an extrapolation, not a measurement), and a tag outside it refuses.
- **Evidence.** `gd-analyze evidence --refresh` produces every claim by running official Godot and
  the translated code on the same input, and every proof agrees at the current head.
- **`platformer-3d-godot4`.** The production `import` plans, emits, installs, typechecks (0
  errors) and builds with vite. Output: `game.tsx` is plain R3F, each instanced `.tscn` a
  component, scripts as classes, `world.tsx` a `<GodotMain>` with the editor's `scenes` slot and
  `systems.physics` (since dropped: the editor reads the game's own `<Physics>`). In the game
  editor (0.5.68) the scene document opens and renders the level, and Play runs it: the robot
  moves and jumps through the editor's input door (`debug.input` over Godot's own
  `Input.action_press`), animates, and the Label3D coin counter draws; 0 console errors.
  Measured headless (`gd-analyze run`, 120 Hz physics, load 9–11): physics per frame p50
  5.1–5.6 ms, p99 7.7–10.7 ms.
- **The six 4.6 starter kits** import through the 4.7 authority as far as their refusals (below).

**Only what the game loads is planned.** The reader walks the main scene, autoloads, project
settings, every `res://`/`uid://` path spelled in scripts or data (a prefix reaches every path
under it), ext_resources and extracted materials. A document outside that walk is reported as
unplanned with its reason; a reachable one with a missing dependency refuses. A path assembled from
pieces that never spell `res://` is not seen.

**Official Godot's own `--headless --import` crashed twice** (SIGSEGV on a worker thread, same
frame chain, stripped binary) and 0 of 80 instrumented reruns reproduced it. Unexplained; the
import reports the signal and does not retry.

**Godot 4.6 projects run as Godot 4.7 runs them.** Godot 4.x minor releases are forward
compatible, and the supported path for a 4.6 project is opening it in the 4.7 editor, so a 4.6
project imports under the 4.7 authority with no 4.6 fork of compat. The same cases run on the
official 4.6 binary: 58 cases in 14 files behave differently, each explained by a source change
recorded in `evidence/godot-4.6/upgrade-deltas.ts` (one, the AnimationTree player re-attach, is
unexplained). For a 4.6-authored project the import report lists each delta member the game
reaches; it informs and never gates.

**Rulings made while building (the author's; the owner has not reviewed them):**

- **Transcendental functions.** A member Godot delegates to the C library (`Math::sin` is
  `::sin`) differs across Godot's own platforms. Its claim is "within the platform library's
  error": at most 1 ulp, with the measured maximum recorded in the claim. Everything Godot
  computes itself is compared bit for bit.
- **Godot 3.** Godot's official 3-to-4 converter was measured on the five Godot 3 games. Only
  `dodge-the-creeps` comes out with every script analyzing (kaykit 1/2, platformer-3d 2/5, rota
  65/92, squash 2/4). Fixing converted scripts by hand would modify the source, so the converter
  is not an import path. The Godot 3 games need a Godot 3.6.2 exporter and a lowering for
  GDScript 3's tree. That is its own lane-sized unit.

## Handoff (2026-09-27): moving the lane to another machine

> Superseded in part by §The lane's law (2026-09-27): a record of the handoff. Its instructions to re-measure and to push only after liveness is live are void: there is no evidence gate.

The lane was stopped cleanly at the owner's word. Nothing runs; every builder's work is on a
branch of `volter-ai/editor`.

**Where the work is.**
- `main` carries the lane (`godot` merged). `godot` is the lane's branch; resume from it.
- `origin/godot-wip-e` (`a648c53b`): imported-model external images, working, not verified.
  Resume: print the `scene-imported` proof's rows, plant the two reverts (one texture per model
  must make the shared row false; letting three's loader decode the image must empty the texture
  path), add the named same-frame deviation to `collision-object-3d.ts`'s header, full refresh,
  platformer gate, push to `godot`.
- `origin/godot-wip-r` (`87e44ea6`): GPUParticles3D, never refreshed or gated. It captures each
  ParticleProcessMaterial's generated shader (bound-program protocol 13), lowers `start()`/
  `process()`, vendors Godot's `particles*.glsl`, and runs them through WebGL2 transform feedback
  (not the ping-pong ruled earlier; transform feedback is what gles3 itself does, so either is
  defensible; decide before finishing). Still to do: scene rules, cases for the node, material and
  CurveTexture, particles in the shader evaluator, a structural proof, draw passes, the first live
  run. Headless official Godot cannot simulate GPU particles, so the simulation is recorded as
  unmeasured. Also holds the Sprite3D drafts (`packages/gd-analyze/wip-r/d-drafts/`).
- `origin/godot-wip-t` (`9a8f8ae6`): Tween, PropertyTweener, CallbackTweener, `create_tween` on
  Node and SceneTree, bit-exact cases (150 Tween cases, every transition and ease). Resume:
  re-run the match-3 import (official Godot crashed on it), the platformer gate, rebase, push.

**Open work.**
- [core] Plan from the full denominator (`gd-analyze refusals`, §Resumed below).
- [core] `evidence --refresh --stale`: re-measure only what `gd-analyze liveness` reports stale.
- [core] The platformer traced against official Godot on the same scripted inputs, frame by frame.
- [core] Land the three wip branches (above), then GPUParticles2D (one shared WebGL context, each
  emitter's frame into its own DOM element), Sprite3D, scripts extending Resource.
- [core] The Godot 3 frontend (six games): a 3.6.2 bound exporter and a GDScript 1 lowering; the
  scope of 3.x runtime semantics against 4.x compat is undecided and needs characterizing first.
- [core] Move the capabilities into `@volter/game-editor`'s catalog with their dependency closure.
- [minor] Quiet-machine timings (all measurements so far ran at load 7–49); the frame-130 hitch.
- [minor] Official Godot's own `--headless --import` crashes intermittently (SIGSEGV/SIGABRT on a
  worker thread, stripped binary; 1 in ~40 runs); the import reports the signal and does not retry.

Refusal counts at the stop (first refusal per script): basic-scene 8, fps 46, match-3 24,
3d-platformer 50, city-builder 7, racing 35. Superseded by the full counts in §Resumed.

**Prerequisites on the new machine.**
- macOS on arm64: the official editors and the bound exporters are macOS arm64 builds.
- Node 22 or later (the lane ran on 26.8.1); `npm ci` at the repository root.
- Official Godot 4.7-stable (executable sha256 `445c6f95…`, reports
  `4.7.stable.official.5b4e0cb0f`) and 4.6-stable (`974197a7…`), from the Godot releases.
- The bound exporters, pinned by executable sha in `src/godot-frontend/source-authority.ts`
  (4.7 `c8034e90…` since the resume, §Resumed). Either copy them (`tools/godot-4.7-bound-exporter-engine-shader`, 600 MB;
  `tools/godot-4.6-bound-exporter-shader`, 619 MB), or rebuild with
  `node packages/gd-analyze/scripts/build-godot-bound-exporter.mjs --version 4.7` from the pinned
  source trees (`godot-4.7-source`, `godot-4.6-source`, revision and tree sha in the same file;
  needs scons and the Xcode command-line tools) into a new out-dir, then check the sha against the
  pin. A rebuild that differs means re-pinning and a full refresh.
- The Godot 3.6.2 source (307 MB) for the Godot 3 frontend.
- About 4 GB for the tools; the corpus fixtures are in git (`packages/gd-analyze/test/fixtures`).
- No fixed ports: `volter-game-editor edit` picks a free one.
- `TMPDIR` on a large volume: imports and refreshes write several GB of temporary projects.

**Resuming the evidence refresh.**
- `GODOT_OFFICIAL_4_7=<Godot binary> GODOT_BOUND_EXPORTER_4_7=<exporter> npm run
  godot-evidence-refresh -w packages/gd-analyze` (15–20 minutes); `npx tsx src/cli.ts liveness`
  (seconds) says whether any claim is stale.
- Never edit compat or the translator while a refresh runs (it hashes them). After a rebase that
  conflicts on authority JSON, take upstream's and refresh.
- Push only with the re-measure in the same push, after liveness is live and the platformer gate
  passes: `cli.ts import packages/gd-analyze/test/fixtures/platformer-3d-godot4 <out>
  --bound-exporter-binary … --official-binary …`, then `cli.ts run <out> --frames 120` (0 thrown,
  stepped physics frames). Live reading: `npm ci` in `<out>`, `npx volter-game-editor edit .`,
  `play`, and drive it through `game.input.set/tap` (the game's `debug.input` door).

## Resumed (2026-09-27, second machine)

> Superseded in part by §The lane's law (2026-09-27): a record from before the rulings; its refresh and liveness steps are void.

The lane moved to a second machine the same day. Tools live in an APFS sparse image on its
external drive (`Backup Driv/volter/godot-work.sparsebundle`, mounted at `/Volumes/GodotWork`:
`tools/`, `src/`, `tmp/`, and the `godot` worktree `editor-godot/`). The drive itself is exFAT,
which has no symlinks or Unix modes, so npm and scons cannot run on it directly. Its USB
throughput makes `node_modules` trees slow there: an import's output directory belongs on the
internal disk, with `TMPDIR` on the image.

**Toolchain.** Official 4.7 and 4.6 and both pinned source archives downloaded at their pinned
sha256. The 4.7 bound exporter, rebuilt with Apple clang 17 from the pinned tree, matched the
tree, archive and exporter-source digests; only its executable differed, so 4.7 is re-pinned to
`c8034e90…` with a full refresh (every proof agrees, every claim live). The 4.6 rebuild's
exporter-source digest is `9c6e0243…` against the pinned `50b326cc…`: the exporter module moved on
after 4.6 was last pinned. Re-pinning 4.6 is a `--godot 4.6` refresh, still open.

**The full denominator.** Lowering now records each refusal and skips the statement or member it
refused (`LoweringContext.recover`), so a refused script reports every refusal it holds; a script
with any is still refused whole, and an accepted script lowers byte-identically. A refused
inheritance still stops its script, because everything after it resolves the base.
`gd-analyze refusals` plans each fixture read-only (no emit, install or build) and groups every
refusal by family: the message with its paths, numbers and API-dump class names masked, the names
kept as the family's subjects. Measured at the resume:

| Kit | Refusals |
| --- | --- |
| starter-kit-fps | 77 |
| starter-kit-match-3 | 66 |
| starter-kit-3d-platformer | 62 |
| starter-kit-racing | 56 |
| starter-kit-city-builder | 39 |
| starter-kit-basic-scene | 8 |
| platformer-3d-godot4 | 0 (imports) |
| five Godot 3 games | the frontend pin, by name |

The largest families: scene field values with no target binding (84: GPUParticles3D's
`set_process_material`/`set_draw_pass_mesh`/`set_amount`, `set_material_override`,
AnimatedSprite3D, LabelSettings), code calls with no target binding (32: Tween, `GDScript.new`,
`print`), model images outside the file (25, `godot-wip-e`), scene nodes with no live evidence
(18: GPUParticles3D, AnimatedSprite3D, Timer, CSGBox3D, SubViewport, the 2D nodes), and GDScript
language rules over Variant (about 50: subscripts, `if`, `for`, assignment conversions,
coroutines, defaulted parameters).

**The import lock was not installable.** The frozen import lock left out
`@colyseus/uwebsockets-transport`, a required peer of `colyseus` (under `@volter/game-editor`),
and so `uWebSockets.js`: it had been resolved with peer dependencies off, and `npm ci` of every
imported game failed under npm's defaults. The lock now carries both rows, as npm resolves them.
`uWebSockets.js` is published only on GitHub, so its row is a git URL pinned to a full commit
with no integrity; the lock plan accepts exactly that form (the commit names the content) and
nothing looser. npm fetches it as GitHub's https tarball with no git credentials (measured with
ssh disabled and an empty cache). The monorepo's own lock resolves it the same way.

The platformer gate passes on this machine: import (plan, emit, `npm ci`, typecheck, vite build)
and `run --frames 120`: 0 thrown, 239 physics frames, physics per frame p50 4.7 ms, p99 8.5 ms.

## What comes next

> Superseded by §The lane's law, §Order of work (2026-09-27). The list below is the order before the rulings.

In order.

1. **The platformer in the game editor.** Render, Play, and compare it side by side with official
   Godot on the same inputs.
2. **The 4.6 starter kits' shared families**, by count across the five that read: Environment
   bindings (21), GPUParticles3D (21), authored node references (20), explicit sibling order (20),
   nodes placed inside instanced scenes (14), scene inheritance (12), GPUParticles2D (11),
   imported models with external images (9), GDScript language rules (13), untyped dynamic
   `new` (6). The racing kit's fixture lacks `res://models/track-ramp.glb`.
3. **The Godot 3 frontend.**
4. **Capabilities into `@volter/game-editor`**, with their dependency closure.
5. **Open question: the frontend in the tab.** Blender runs in the browser as WebAssembly. The
   Godot exporter is the same substrate, a C++ program built from pinned source. Built with
   emsdk, import would need no native binary on the importer's machine.
