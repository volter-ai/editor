# Volter Editor roadmap

Open work for both products this repository ships, the model editor and the game editor: one
`## <id>: <title>` section each, with its `Status:` (planned, active, proposed) and the `Completion:` lines
that define done. What shipped and each release's known limits are in [`WORK.md`](WORK.md); the design
records these items cite (`docs/WORK.md`, `docs/ARCHITECTURE-CORE.md`) remain in `volter-ai/vgai-engine`,
where the game editor came from.

## browser-parity: The fifteen references and the five new ones, scored through the browser

Status: active
The historical local-backend baseline is 15 of 15 models and 137 of 137 observed APIs (company
`projects/modeler-launch.md`); the battery and its scoreboard are vgai-engine's
`packages/blender-engine/bench/battery`. A browser replay (vgai-engine `docs/WORK.md` §Blender in the tab is Blender)
replayed every recorded call of the ten-model battery and the five scene models through the editor, geometry
bit-exact apart from named mechanisms; it is not a score on the parity scoreboard, and it does not name the five
hard recordings of the original fifteen.
Completion:
- The original fifteen and the five new real-Blender references are scored through browser-only execution on the same scoreboard, with no local modeling fallback, measured through the tab's `blender-*` doors.

## viewport-stage: The viewport stage themes into Blender, Unity, Godot and Unreal

Status: active
Design and measurements: [docs/VIEWPORT-STAGE.md](docs/VIEWPORT-STAGE.md) (ARCHITECTURE.md rule 6: a component is themable only when it can be themed into each of several real targets). An independent judge passes all four; Blender's judged objections are closed by Blender's own rules, and a blind walk of a fresh Blender model has its defects fixed. Unity's Move handle is at Unity's own 80-point size.
Completion:
- Every target is judged again from the page capture cropped to its viewport, with the overlay pass in it.
- Unreal's remaining differences (a faint floor shadow, a hard floor-sky line, thin Move shafts) are closed or named as limits.
- Blender's Rendered mode and Unreal's capability row are accepted, and the world stage is seen on a project with a world.

## architecture-plan: The architecture plan's remaining units

Status: active
[ARCHITECTURE.md](ARCHITECTURE.md) §The plan: the model editor rename and the frozen reverse-edge baseline are
done (`@volter/model-editor`; `release/boundary-baseline.json`); the Three viewport has left the kit for
`@volter/editor-threejs` and no kit module imports three, Blender's viewport defaults are `@volter/editor-blender`'s specialization (the stage's camera is the view's), and Blender is walked as its first consumer
(`WORK.md` lists what remains of unit 3).
Completion:
- The SDK's Object3D and viewport doors are Three's own exports.

## game-editor-gaps: The game editor's remaining walks and gates

Status: active
What `WORK.md` records as unwalked or ungated in the game editor.
Completion:
- A collider row is shown for a body in a running world, or the reason none can be is recorded.
- `arena`'s port lives in a repository.

## canvas-editor: A canvas (Pixi) root authored in the editor, at parity with its nearest products

Status: active
The owner brought the canvas lane back into scope (vgai-engine's `packages/canvas`, held at
`archive/launch-scope-2026-09-20`). The bar for every UI capability is parity with its nearest real
product, learned from that product's own UI: Figma for the design canvas, Godot's 2D editor for a game's
2D scene. Each product's panel structure (every panel, what it owns, which controls are shortcuts to a
home elsewhere) is written down, from the installed product, before any of ours is laid out.
Completion:
- A canvas root opens in Edit on a design surface and is authored through the same doors a `three` root is.
- Every control of ours maps to its owner in the reference structure, and the surface is judged at parity with it.

## netcode: A networked game observed and inspected in the editor, at parity with its nearest products

Status: active
The owner brought netcode back into scope (the catalog's `netcode` capability, held at
`archive/launch-scope-2026-09-20`). The editor observes a game's own Colyseus client as it observes its Web
Audio and its Rapier world, and the Network inspector is held to the same bar as the canvas editor: its
nearest products (Colyseus Monitor, Godot's network profiler, Unity's multiplayer tools) are read from their
own UI first.
Completion:
- A template game that joins a room is walked through the Network inspector: peers, replicated state, messages and rates.
- Every control of ours maps to its owner in the reference structure, and the inspector is judged at parity with it.

## project-model-program: The project shape and settings layers on Code-OSS

Status: active
Source: vgai-engine `docs/WORK.md` §Project shape and the four settings layers, as re-cut for Code-OSS (U6, U7).
Chrome derives from declared kinds; nothing enumerates the shapes.
Completion:
- The project-local sections live in the workbench's workspace storage scope, and that scope lives in the project's folder: the fork's `workspaceStorageUrl` (volter-ai/code-oss `50214fb5`) keeps it in `.vgai/workbench-storage.json`, and the frame hands the scope to the kit at mount. Walked on the pinned game workbench: a layout change survives `close` (even one made just before it) and a rename of the project's folder. Remaining: the same reading from a second browser.

## design-skew: Design, a product skew

Status: planned (the owner took it after `canvas-editor` and `netcode`)
Source: vgai-engine `docs/WORK.md` §Design. An editable page preview and a Figma-shaped canvas tab as the
`website` preset; today its DOM root is read-only, its Pages list is empty, and a `page` has no document editor.
The `pasteboard` capability its list needs is archived (`archive/launch-scope-2026-09-20`) and is restored first.
Completion:
- A `page` document opens as its editable preview, not its source.
- Every entry in the section's ordered list is proved on a real website project through the product's own doors.

## zero-magic-conversion: Zero-magic conversion, as native as possible

Status: active
Source: vgai-engine `docs/WORK.md` §P0 (propagation waits for the owner). The pattern is proven in one place first, through sighted owner
passes; until the owner calls it settled, every propagation wave is recorded, not running.
Completion:
- The owner calls the pattern settled, then each recorded wave runs and is measured.

## editor-and-contributions: Editor and bundled contributions punchlist

Status: planned
Source: vgai-engine `docs/WORK.md` §P2, each item with its own measurement.
Completion:
- A model task no longer pays the game template's ceremony; the skill no longer front-loads.
- Grok's two clean Blender-lane runs are run in the modeling bench.
- Visual generalizability: chrome anatomy, the missing axis.
- The browser editor: a static page as an authoring peer (owner decision).
- Findings from the first human play sessions, the serious build session, the authoring checklist and the design-round blind walk are each closed or evidenced as limits.
- Scatter/foliage brush, Tiled `.tmj` ingest, sprite slicing, dialogue (Ink first), localization (i18next), data relations, humanoid polish.

## assets-networking-services: Assets, networking and services

Status: proposed
Source: vgai-engine `docs/WORK.md` §P4.
Completion:
- SSD catalog integrity: SHA-256, duplicate and conflict reports, pack identity.
- Preview usefulness reviewed on representative compositions; AmbientCG in the local catalog; the Sketchfab CC0 acquisition decided by the owner.
- A dedicated-server lane on a BYOK provider; clock synchronization and production interpolation; room boilerplate reduced without a wrapper; player services only behind a real provider boundary.

## after-launch-lanes: The lines parked for after the first launch

Status: proposed; after the first launch, by the owner's launch rule
Source: vgai-engine `docs/WORK.md` §The Godot lane is ARCHIVED, §The Roblox, Unity and Minecraft lanes are ARCHIVED (owner, 2026-09-19: "incomplete lines of work that won't go into this first launch") and §The launch-scope sweep (owner, 2026-09-20: "for later"). Each line is whole at a tag in `volter-ai/vgai-engine` and comes back from it, never re-derived:
- the engine compatibility lanes, incomplete when archived (the owner's words), each an analyzer and runtime that brings a game from that engine into VGAI: Godot (`archive/godot-lane-2026-09-19`), Roblox (`archive/roblox-lane-2026-09-19`), Unity (`archive/unity-lane-2026-09-19`) and Minecraft (`archive/minecraft-lane-2026-09-19`)
- the example games (`archive/examples-2026-09-19`); `arena` has already come back
- the built capabilities held out of the first launch's scope (`archive/launch-scope-2026-09-20`), not unfinished work: several are back in this repository (game audio, the ingest door, collaboration, the asset library, the multiplayer template's Colyseus server); back in scope is the netcode (`netcode` above); still only at the tag are the IK, ragdoll, terrain, HUD, sprite and stylized capabilities, the AI generation providers (Fal, Tripo, World Labs, OpenRouter) and the learn site
Completion:
- Each line is restored from its tag when the owner calls its turn, or is retired by the owner's word.

## public-game-release: The game editor's public release

Status: planned
The game's packages are on npm at 0.5.66 under their own [release/game.json](release/game.json).
The canonical games that must satisfy their briefs first are `volter-ai/game-benchmarks`' `original-trials-slate`.
Completion:
- A qualifying public release of the game editor satisfies the company's G2 acceptance (company `projects/game-engine-launch.md`).
