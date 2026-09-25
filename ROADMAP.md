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

## workbench-rebuilds: Both workbenches boot clean

Status: active
Both products' workbenches are rebuilt with the Chat patches and pinned at `2a8d872b50d0`; the later sign-in patch
(`507e47d`, no Copilot sign-in in a workbench whose product names no provider) is not in that pin yet.
Completion:
- A release carrying `507e47d` is pinned, and each product's first boot logs neither "No default agent registered" nor a GitHub sign-in timeout.

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
What `WORK.md` records as unwalked or ungated in the game editor.
Completion:
- The timeline drives a game's stamped mixer in Edit (the runtime's unset `_animMixer`/`_availableClips` keys leave with the runtime framework).
- A machine document fits on its first size, and an initial arrow cannot enter its state from below.
- Navmesh is walked on real content, and Network through a networking adapter.
- The game bundle builds in 30 s or less, or `VOLTER_EDITOR_FROM_SOURCE=1` resolves `virtual:vgai-manifest-entries` and `@editor/game-module-access` and keeps undo across an Inspector source write.
- Input a game owns (its own `InputManager`, and machine input through the native door) is gated while the tab is on Edit.

## project-model-program: The project model, eight nouns, every kind open and registered

Status: active
Source: vgai-engine `docs/WORK.md` §Project shape and the four settings layers, as re-cut for Code-OSS (U6, U7).
Chrome derives from declared kinds; nothing enumerates the shapes.
Completion:
- The project-local sections not yet moved (viewport pose, hierarchy expansion, state-watch pins, chat attention and history, project-work reminders, board guides) live in the storage service's workspace scope.
- Keybindings are keybinding contributions and the style bundle id is a theme id.
- The standalone modeler is the no-roots shape, and a project's finders (`src/tools/`) reach the finder registry through a contribution.

## design-skew: Design, a product skew

Status: planned
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
- Contribution-imported dependencies are served on the editor's React in general, not only the one measured case.
- One Outline effect per leased renderer, so postprocessing's selection layers are never exhausted (the console warning is only muted today).
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
The game's packages are on npm under their own [release/game.json](release/game.json), except `@volter/editor-react` and
`@volter/editor-xstate`, which that release names and npm does not have.
The canonical games that must satisfy their briefs first are `volter-ai/game-benchmarks`' `original-trials-slate`.
Completion:
- `@volter/editor-react` and `@volter/editor-xstate` are published with the next game release.
- A qualifying public release of the game editor satisfies the company's G2 acceptance (company `projects/game-engine-launch.md`).
