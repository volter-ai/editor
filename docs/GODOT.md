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

**The compiler binds no Godot API.** `godotCodeTranslationAuthority` returns a binding table with
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

The compat that came back from the tag does not meet this contract. It is removed from the lane
and rebuilt class by class from the closure. The Godot source is the authority, and the old module
at the tag is a reference (vgai-engine `archive/godot-lane-2026-09-19:packages/editor/catalog/project-source/src/lib/godot-compat/`).

## What comes next

Measured facts end above. From here on, this is proposal: the order in which to close the gap.

1. **Close the first reading's read gaps, by family.** Open audio, texture, shader and cubemap
   assets as asset copies or conversions, and expand a `.glb` instanced as a scene through
   `read/gltf-godot-scene.ts`. Each family lands whole, with its evidence, then the import runs
   again until it produces a project.
2. **Make evidence cheap.** Every accepted rule needs a native differential record, and today each
   one is written by hand. Throughput is the constraint, so build the instrument before breadth:
   one command that runs official Godot 4.7 and the translated TypeScript on the same input for a
   member family and writes the `SemanticClaimRecord`.
3. **Rebuild compat as bindings.** Bind each canonical symbol the corpus closure needs to a typed
   export. Classify each as BINDING or PROTOCOL, and read the old module as source material. The
   dispatch tables, the server reimplementations and the sibling imports go. Push general supply
   down to `@volter/threejs-runtime` or `@volter/game-runtime`, as `ground-projection` already is.
4. **Reconcile the runtime with rule 4.** Take the neutral host events from the native libraries
   (R3F frame, Rapier step) at the generated composition site, not a Godot runtime package.
   Retire the manifest mount along with plan unit 5.
5. **Widen the corpus.** Pin a 4.6 exporter (same module, 4.6-stable source) for the five 4.6
   games, and add a canvas integration before any 2D game.
6. **Open question: the frontend in the tab.** Blender runs in the browser as WebAssembly. The
   Godot exporter is the same substrate, a C++ program built from pinned source. Built with
   emsdk, import would need no native binary on the importer's machine, and the pin would be one
   checked-in artifact digest.
