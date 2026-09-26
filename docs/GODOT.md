# The Godot lane

The Godot lane translates a Godot project into a game this editor opens: its scenes become React
components, its scripts become ordinary TypeScript, and what Godot's API means at runtime comes
from a copied capability. The owner called its turn on 2026-09-25. It came back from vgai-engine's
tag `archive/godot-lane-2026-09-19` (vgai-engine `6499489cb`); nothing here was re-derived.

## Where it lives

| Path | What it is |
| --- | --- |
| `packages/gd-analyze` | `@volter/gd-analyze`, the compiler: snapshot, official frontend, read, analyze, translate, emit, materialize. One CLI, `src/cli.ts` (`import`, `sweep`). |
| `packages/gd-analyze/test/fixtures` | The pinned upstream corpus, each game unmodified under its `<id>.UPSTREAM.lock`. |
| `packages/gd-analyze/capabilities` | The lane's own catalog (`catalog/`, `template/.agents/skills`), shaped like the product's. It holds `godot-compat`, `godot-runtime`, `character`, `sprite` and the `fastlz` codec. The compiler copies from here. |
| `packages/gd-analyze/godot-frontend` | The exporter module compiled into Godot, its official-source patch, and the capture script. |

The capabilities stay out of `@volter/game-editor`'s catalog on purpose. That catalog's served
bundle must carry every package a capability imports (`scripts/check-served-bundle-modules.mjs`).
A capability moves there with the first translated game that runs in the editor, carrying only
that port's dependency closure.

## The intended architecture

The design is vgai-engine `docs/ARCHITECTURE-CORE.md` §Foreign games and §Migration compiler
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

**The compiler has the ruled shape.** vgai-engine's 2026-09-03 series (`ca737bcbd` onward) deleted
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

**The frontend is pinned.** vgai-engine's 09-15 record found no way to tell which of eight exporter
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

This contract says what `godot-compat` is, and a mechanical check enforces it (`scripts/check-godot-compat.mjs`,
run by the pre-commit hook). It applies ARCHITECTURE-CORE §10 and ARCHITECTURE.md rule 4 to one
package. The owner's direction (2026-09-25) is that Godot's own source is readable, so every
member is a transcription of that source, not a reconstruction from behaviour.

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

**Untyped code is typed by analysis, not dispatched at runtime.** `analyze` gives a receiver the
type Godot itself guarantees there, and records the rule as evidence:

- an engine virtual's parameters (`_integrate_forces(state)`) take the virtual's declared types
  from the API dump;
- `$Path` and `get_node("Path")` take the class of the node at that path in every scene the script
  is attached to (they must agree);
- an untyped local takes its initializer's type while no other assignment reaches it.

A call whose receiver is still unknown lowers to a callsite-local switch over the finite set of
classes that can reach it, the pattern ARCHITECTURE-CORE already rules for dynamic resource paths.
A call whose set is unbounded refuses.

**Evidence is produced by an instrument, not written by hand.** `gd-analyze evidence <class>`
runs a module's cases in two places and compares them. Each case sits in
`evidence/godot-4.7/<class>.cases.ts`: GDScript run by the official Godot 4.7 binary headless, and
the same inputs run through the compat export in Node. The command writes the
`SemanticClaimRecord`s and the binding rows to `src/translate/code/authority/godot-4.7/<class>.json`.
A node-level case builds its scene in both places and steps physics frames in both. The binding
table loads those files; a row whose claim is not live refuses, as before.

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
authority; the old module at the tag is a reference (vgai-engine
`archive/godot-lane-2026-09-19:packages/editor/catalog/project-source/src/lib/godot-compat/`).

**First class through the instrument: `Vector3`.** 413 cases agree bit-exactly with official Godot
4.7, including `rotated` through `sinf`/`cosf`. Planted defects (a double-precision `dot`, an
unrounded `cos`) produce 23 mismatches and write nothing. One finding: GDScript's bytecode
generator merges `-0.0` into an earlier `0.0` constant in the same function
(`gdscript_byte_codegen.h:107`), so each case runs in its own function.

## Scene structure

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

The design for the tree, set from what Node3D measured. The first native classes are proven:
Node3D and Camera3D, 724 cases, exact.

- **One native entity per Godot node.** A 3D node is the `THREE.Object3D` its JSX mounts, and a
  Control is its DOM element. A plain `Node` in a 3D tree mounts as a `<group>` that compat marks
  non-spatial: its matrix stays identity, and Node3D's parent rule skips it. A Node3D under it
  therefore takes global = local, as in Godot.
- **Transforms are handed over exact.** A mounted Node3D receives its authored `Transform3D` as
  the Object3D's matrix (`matrixAutoUpdate` off), never as decomposed position, rotation and
  scale props. Node3D's module owns the decomposition three reads.
- **Tree structure is read, not kept.** A node's parent and children are the native links
  (three's `parent`/`children`, the DOM's), and `get_node` walks names over them. Name, groups,
  process mode, ready state and owner are Node PROTOCOL state in WeakMaps keyed by the entity.
- **Runtime tree changes go through the generated scene's hierarchy authority.**
  `PackedScene.instantiate()` returns that scene's factory. `add_child` of an instanced scene
  renders it through the parent scene's React state, and `queue_free` removes it at the end of
  the frame (Godot's deletion queue, in compat). A native node made with `Class.new()` attaches
  imperatively to its parent's entity, which React never reconciles.
- **SceneTree's clock is the host's.** The generated world runs Godot's frame order from R3F's
  frame and a fixed physics step (`physics/common/physics_ticks_per_second`, default 60):
  notifications, `_process`, `_physics_process`, deferred calls, timers (`create_timer`), tweens
  and signals. Compat implements the ordering (`scene/main/scene_tree.cpp`) over those two
  events and creates no loop of its own.
- **Host duties the composition site performs:** feed input events and frame stamps to `input.ts`;
  call `SubViewport.set_size` on the viewport's Scene when the canvas resizes; mount Camera3D with
  Godot's defaults (fov 75, near 0.05, far 4000).

## Node families

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
| `ArrayMesh`, imported `.glb`, `.res` meshes | the asset converted at import to glTF, loaded by drei's `useGLTF`; an instanced `.glb` keeps its node names so `$Path` and authored children resolve |
| `StandardMaterial3D` | `MeshStandardMaterial`, parameters transcribed from Godot's scene shader |
| `ShaderMaterial` + `.gdshader` | refused until a shader-language family lands |
| `Camera3D`, `DirectionalLight3D`, `OmniLight3D`, `WorldEnvironment`/`Environment`/`Sky` | three's camera, lights and scene environment, Godot's units converted by transcribed formula |
| `CharacterBody3D`, `RigidBody3D`, `StaticBody3D`, `Area3D`, `CollisionShape3D` + shapes, `RayCast3D` | `@react-three/rapier` bodies and colliders; `move_and_slide` and the contact state are compat PROTOCOL over Rapier's character controller and queries |
| `AnimationPlayer`, `AnimationTree` | three's `AnimationMixer` over the imported clips; Godot's blend-tree semantics in compat |
| `AudioStreamPlayer`, `AudioStreamPlayer3D` | Web Audio through three's `Audio`/`PositionalAudio` |
| `CanvasLayer` with `Control`s (`Label`, `TextureRect`, `HBoxContainer`, `TouchScreenButton`) | a DOM root beside the world, each Control an absolutely placed element from its anchors and offsets, as the Unity lane's uGUI does |
| `GPUParticles3D`, `CPUParticles3D`, `GridMap`, `Decal`, `ReflectionProbe`, `CSGBox3D`, `Label3D`, `Sprite3D` | later units, in closure order |

## Where it stands (2026-09-26, 03:30)

Measured through the lane's own commands.

- **Frontend.** The pinned 4.7 exporter binds every script of the 4.7 game. Before capture, the
  official editor performs Godot's own `--headless --import`, so preloads of imported assets
  resolve. `gd-analyze closure` reads all six Godot 4 games. Godot 4.6 has its own authority:
  the official binary, API dump, source tree and a ported patch. Its exporter is being built.
- **Evidence.** `gd-analyze evidence <class>` and `gd-analyze evidence --refresh` produce every
  claim by running official Godot and the translated code on the same input. Before the refresh
  existed, digests were copied into TypeScript by hand. 16 built-in types and utilities are
  proven: 3,165 cases, all bit-exact apart from the platform-maths comparator below, and 126 bindings.
  The instrument's own findings are recorded in each module's header: signed zeros merged by GDScript's constant pool,
  `atan2f`'s range at ±π, float literals Godot does not parse to the nearest double, and
  float-to-int saturation on arm64.
- **Lowering.** Operators, constants and built-in member writes (`v.x = e` becomes
  `v = with_x(v, e)`) go through evidenced bindings. Structural rules key a datatype class where
  semantics do not depend on the type. Dynamic calls are typed from project facts
  (`analyze/call-receivers.ts`); the two rules' evidence is in progress.
- **Import of `platformer-3d-godot4`.** It stops in planning. On the script side the gaps are
  language rules and native-class bindings; on the scene side, the structure and node families
  above.

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

## What comes next

In order. The first three run now.

1. **Native classes, one family at a time.** Node3D and Camera3D first; they set the native
   receiver pattern. Then Node and SceneTree (tree operations, groups, timers, signals),
   Input, the physics bodies over Rapier, AnimationPlayer, audio and Tween. Each is proven by
   node cases in the instrument: the same tree built in Godot and in three.
2. **Language rules** until the platformer's scripts lower completely, including static
   built-in calls, Dictionary literals and Godot's own literal values.
3. **Pin the 4.6 exporter**, then refresh every claim for the 4.6 revision. The instrument
   re-runs the same cases against the official 4.6 binary.
4. **Scene structure and node families** (the sections above), until the platformer produces a
   project. Then build it, boot it in the game editor, and compare it side by side with Godot.
5. **The Godot 3 frontend.**
6. **Open question: the frontend in the tab.** Blender runs in the browser as WebAssembly. The
   Godot exporter is the same substrate, a C++ program built from pinned source. Built with
   emsdk, import would need no native binary on the importer's machine.
