# Volter Editor roadmap

Open work for both products this repository ships, the model editor and the game editor: one
`## <id>: <title>` section each, with its `Status:` (planned, active, proposed) and the `Completion:` lines
that define done. What shipped and each release's known limits are in [`WORK.md`](WORK.md); the design
records these items cite (`docs/WORK.md`, `docs/ARCHITECTURE-CORE.md`) remain in `volter-ai/vgai-engine`,
where the game editor came from.

## browser-parity: The fifteen references and the five new ones, scored through the browser

Status: active
The historical local-backend baseline is 15 of 15 models and 137 of 137 observed APIs (company
`projects/modeler-launch.md`). A browser replay (vgai-engine `docs/WORK.md` §Blender in the tab is Blender)
replayed every recorded call of the ten-model battery and the five scene models through the editor, geometry
bit-exact apart from named mechanisms; it is not a score on the parity scoreboard, and it does not name the five
hard recordings of the original fifteen.
Completion:
- The original fifteen and the five new real-Blender references are scored through browser-only execution on the same scoreboard, with no local modeling fallback, measured through the tab's `blender-*` doors.

## workbench-rebuilds: Both workbenches rebuilt with the Chat patches

Status: planned
First boot logs "No default agent registered", and under load the workbench's GitHub sign-in lookups time out;
the native Chat patches for both are in `scripts/workbench/overlay.mjs`.
Completion:
- Each product's rebuilt workbench (the model editor's with its own product id) is pinned, and its first boot shows neither message.

## architecture-plan: The architecture plan's remaining units

Status: active
[ARCHITECTURE.md](ARCHITECTURE.md) §The plan: the model editor rename and the frozen reverse-edge baseline are
done (`@volter/model-editor`; `release/boundary-baseline.json`); the viewport unit is measured at 186 modules in
`editor-core`, 47 of them Three-bound, and moves in one step once core stops importing it (`WORK.md` lists the
cut points).
Completion:
- The viewport set leaves `editor-core` for the Three integration, with no core-to-`@volter/editor-threejs` edge.
- Blender is the viewport's first consumer, then idiomatic games.
- `@volter/editor-game` imports no kit internals.

## game-editor-gaps: The game editor's remaining walks and gates

Status: planned
Completion:
- The timeline drives a game's stamped mixer in Edit (the runtime's unset `_animMixer`/`_availableClips` keys leave with the runtime framework).
- A machine document fits on its first size, and an initial arrow cannot enter its state from below.
- Navmesh is walked on real content, and Network through a networking adapter.
- The game bundle builds in 30 s or less, or `VOLTER_EDITOR_FROM_SOURCE=1` resolves `virtual:vgai-manifest-entries` and `@editor/game-module-access` and keeps undo across an Inspector source write.
- Input a game owns (its own `InputManager`, and machine input through the native door) is gated while the tab is on Edit.

## project-model-program: The project model, eight nouns, every kind open and registered

Status: active
Source: vgai-engine `docs/WORK.md` §The project model and §Project shape and the four settings layers. One
unit per commit, each measured on the two probes (a game; a zero-root folder of models) plus the shape it adds.
Chrome derives from declared kinds; nothing enumerates the shapes.
Completion:
- Every numbered unit of the locked program is landed and measured on both probes.
- The four settings layers (defaults, user global, project shared, project local) each hold exactly what the rulings assign them.

## design-skew: Design, the third product skew

Status: planned
Source: vgai-engine `docs/WORK.md` §Design. An editable page preview and a Figma-shaped canvas tab as the
`website` preset; today its DOM root is read-only, its Pages list is empty, and a `page` has no document editor.
Completion:
- A `page` document opens as its editable preview, not its source.
- Every entry in the section's ordered list is proved on a real website project through the product's own doors.

## zero-magic-conversion: Zero-magic conversion, as native as possible

Status: active
Dispatch: hold
Source: vgai-engine `docs/WORK.md` §P0. The pattern is proven in one place first, through sighted owner
passes; until the owner calls it settled, every propagation wave is recorded, not running.
Completion:
- Contribution-imported dependencies are served on the editor's React in general, not only the one measured case.
- The Outline effect no longer exhausts postprocessing's selection layers.
- The owner calls the pattern settled, then each recorded wave runs and is measured.

## editor-and-contributions: Editor and bundled contributions punchlist

Status: planned
Source: vgai-engine `docs/WORK.md` §P2, each item with its own measurement.
Completion:
- Source identity instrumentation preserves application `userData` on native and custom R3F hosts across rerenders, including authored callbacks and refs.
- A model task no longer pays the game template's ceremony; the skill no longer front-loads.
- Grok's two clean Blender-lane runs are run in the modeling bench.
- Visual generalizability: chrome anatomy, the missing axis.
- The browser editor: a static page as an authoring peer (owner decision).
- Findings from the first human play sessions, the serious build session, the authoring checklist and the design-round blind walk are each closed or evidenced as limits.
- Untrusted pointer events drive OrbitControls and TransformControls; `editor.captureActiveDocument()` goes through the EffectComposer.
- Scatter/foliage brush, Tiled `.tmj` ingest, sprite slicing, dialogue (Ink first), localization (i18next), data relations, humanoid polish.

## assets-networking-services: Assets, networking and services

Status: proposed
Source: vgai-engine `docs/WORK.md` §P4.
Completion:
- SSD catalog integrity: SHA-256, duplicate and conflict reports, pack identity.
- Preview usefulness reviewed on representative compositions; AmbientCG in the local catalog; the Sketchfab CC0 acquisition decided by the owner.
- A dedicated-server lane on a BYOK provider; clock synchronization and production interpolation; room boilerplate reduced without a wrapper; player services only behind a real provider boundary.

## public-game-release: The game editor's public release

Status: planned
`@volter/game-editor` is on npm, but its packages do not join [release/modeling.json](release/modeling.json).
The canonical games that must satisfy their briefs first are `volter-ai/game-benchmarks`' `original-trials-slate`.
Completion:
- A qualifying public release of the game editor satisfies the company's G2 acceptance (company `projects/game-engine-launch.md`).
