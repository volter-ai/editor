# Public release status

## Model Editor first-run walkthrough (2026-10-05)

Bare `volter-model-editor` now opens the current project, or creates and reopens
`~/Documents/Volter Models/Untitled Model` with a saved cube. Occupied unrelated
folders get a numbered sibling. Explicit `create <folder>` still creates a separate
project. This saved folder is our product choice: Blender's
[startup file](https://docs.blender.org/manual/en/dev/getting_started/configuration/defaults.html)
opens an unsaved scene. Native Blender 5.2.0 LTS was measured with factory startup:
a selected 2 m Cube, Camera and Light, with an empty filepath. The modeling starter
keeps the existing 1 m cube without a camera or light.

New projects carry `AGENTS.md` and `CLAUDE.md` (`@AGENTS.md`), plus the existing
project-local MCP configurations. Walked from the source checkout with the pinned
released workbench: Claude Code and Codex reused their existing sign-ins, read the
instructions and inspected the live cube through MCP. Claude changed a test cube
to blue with a bevel, updated `cube.py` and saved `cube.blend`; native Blender read
back its dimensions, material and modifier from disk. `chat send`, `chat status`
and `chat stop` drive the visible native Chat. Switching to Codex, stopping a turn,
and closing/reopening resumed the exact Codex session. Frontend attachment finishes
after the launcher returns; wait for Chat readiness before sending.

Remaining evidence gaps: fresh OAuth sign-in and a fresh registry install were
not walked. One Claude conversation completed a turn but retained a null resume
identity in the existing host catalog; another Claude test conversation bound
successfully. Do not count that first conversation as verified resumable. Six new
first-run tests, the Model Editor typecheck and the modeling release build pass.
The full repository suite currently fails in seven unchanged fixtures referencing
removed source paths or missing mock exports, before reaching the model tests.

Game-panel follow-up: a fresh checkout-linked `playable` project opened Track
with Play, Chat, Outliner/Properties and Timeline. Play mounted the React HUD;
Stop returned to the model. The UI board opened through
`editor.present({version:1,document:{kind:'workspace',id:'workspace:ui-components'}})`
and showed the three HUD stories with the UI hierarchy. These were live visual
checks, without a new model inference turn.

Native Chat game walkthrough: submitted only `Make a really simple 3D game with
UI.` to a new Codex conversation in the default project's actual editor Chat.
The editor agent created Pocket Collector, generated a reference image and
packed it into the Blender scene, added the playable model and React HUD, and
rendered five HUD states in the UI canvas. It inspected screenshots, repaired
the initial stylesheet and primary-button contrast problems, and tested manual
movement, coin pickups, rail bounds, timeout, restart, demo win and manual
takeover. Final screenshots show the playable scene with Chat and Properties;
the agent's saved status reports no current page or session errors. The editor
is left in Play, ready at 0/6 coins and 45 seconds, with native Chat idle.
The supervising session did not author game code. Native session
`01a10f08-f891-7641-9dbb-53e1f237ebdb` completed; its JSONL is retained in
`.volter/native-game-session.jsonl` and the full editor still is
`.volter/native-game-editor.png`. The project and its detailed visual evidence
are in `~/Documents/Volter Models/Untitled Model`. This demonstrates native Chat
creation and transcript retention; replay had not been run at that boundary.

Requested 8× video: replayed the retained transcript at speed 1 in a disposable
project and owned workbench copy, using the retained development Supercode binary
and the frontend candidate's ordinary connection handoff. Scoped path mappings
preserved the finished project and original temporary helpers. A local performer
adapter supplied real Blender MCP calls and persistent code-mode storage; image
generation reused the original cached asset. All 153 events were delivered and
38 calls performed, with zero runner failures. Tool execution adds wall time;
live gameplay is not deterministic transcript playback (the replay's timeout
capture was still playing at 1/6, while its demo reached 6/6 with 40 seconds).
The final saved game returned to ready at 0/6. Reloads required reattachment;
the last reload cached a failed Chat widget. Opening a fresh native view of the
same attached conversation restored its completed history for the final still.
The original capture and diagnostics are retained, including that failure.
Recorded 1,622 full editor frames over 851.047 seconds and accelerated the video
timestamps by exactly eight. The export is 1920×1080 H.264 at 24 fps, 108.417
seconds including a two-second restored final-view hold. Timestamp error is
−0.006 seconds; full-file decoding and visual review passed. Artifacts, video and
metrics are in `.volter/pocket-replay-20261005/`. The replay observer was detached
and revoked, the replay editor closed gracefully and its runtime stopped. The
original game editor and its World remain available.

Video review correction after owner feedback: the original game-start screenshot
(`.volter/game-request-chat.png`) shows a plain gray cube. The replay copy was
made from the earlier Claude test project's blue, beveled cube. That was the
wrong starting state; this export is not a faithful reproduction of the initial
project. Earlier review used sampled frames and decoding, not continuous visual
review, and missed the opening's extended loss of Chat. At video 18.808 s Vite
finished optimizing newly reached `typescript` and `axe-core` dependencies and
automatically reloaded the editor. At 30.407 s the recorded agent's explicit
`editor.reloadPage()` reloaded it again. The replay attachment was restored only
at 37.386 s; during that interval Chat fell back to the default Claude placeholder
even though the replay runtime continued. These are editor reloads plus a replay
reattachment failure, not video speed changes or new Claude inference. The later
reload at 92.987 s hit the cached failed-widget problem described above. The
opening has now been inspected at half-second intervals and correlated with
the original replay calls, Vite output and tab-reload ledger. Do not describe
the first export as a clean or faithful replay.

Recording/replay audit: the reusable Abrams capture workflow is retained in
`/Users/yueranyuan/volter/media-creation/model-comparison/README.md`, and the
Supercode development workflow is in
`/Users/yueranyuan/volter/supercode-chair-replay-20261005/docs/guides/editor-replay.md`.
Full-page capture plus native transcripts is available. The installed Supercode
CLI rejects `replay`; the retained `feat/replay` binary's help works. The pinned
frontend 0.1.31 ignores connection-handoff arguments to `supercode.frontend.connect`,
whereas the replay frontend candidate accepts them. The retained performer
executes shell/file/Codex code-mode calls but skips direct Blender MCP calls.
Re-executing an arbitrary session from these defaults is therefore not verified.

Volter Editor 0.5.72 (editor-blender 0.1.13, blender-engine 0.1.11) is published by CI:
`.github/workflows/publish.yml` builds the game release only after a measured main commit is promoted to `publish`, runs `check:release:game` and
`check:packed-imports:game`, moves every package of [release/game.json](release/game.json) together to its next
patch version when any changed, publishes them with npm provenance and commits the versions back to `publish`.
Main is built, used and measured from source; a push or manual workflow dispatch on main cannot publish.
A version npm is still processing counts as released. From the registry, `npx @volter/game-editor@0.5.72 create reg-game --with
three,ui` scaffolded a project whose first commit carries no `node_modules` link, and its session read connected,
no console errors and no mount failures; Play ran and `screenshot` photographed the world with its styled HUD.
Not re-walked since 0.5.68: music, scene launch and render
([provenance/public-npm-release.json](provenance/public-npm-release.json)).

## Game editor (branch `game-editor`)

Game editing is built on the `game-editor` branch and does not join
[release/modeling.json](release/modeling.json). Source: `volter-ai/volter-engine`
at `09c2749ce`. Architecture: volter-engine's `docs/ARCHITECTURE-CORE.md`
§The target shape — kit, integrations, products, shipped twins; dependencies
point down.

| Package | What it is |
| --- | --- |
| `@volter/game-editor` | The second product: entry composing `@volter/editor-game` and `@volter/editor-blender`, the `volter-game-editor` CLI (kit session verbs plus `play`, `stop`, `restart`, `add`/`remove`/`outdated`, `blender-mcp`), `create` with the game/prototype/full/website/empty presets, the template and capability catalog, its workbench half |
| `@volter/editor-game` | The game side: the predecessor's game package (`src/`), its DOM package (`src/react/`), its three.js authoring (`src/three/`), and the kit modules only the game reaches (`src/host/`), including the world-root stage and the Scene document |
| `@volter/game-live` | The game client over a session: `game`, `page`, recording; `eval` scope and tester scripts |
| `@volter/game-runtime`, `@volter/threejs-runtime` | The Apache twins a shipped game carries |

A game is its own code. The product's dependencies are a game's full runtime
set — the union of what the template and the catalog's capabilities declare,
held there by the pre-commit check — so one installation per version is the
runtime image every game of that version links as `node_modules`
(`~/.volter/images/game-editor-<version>`; a checkout's root in development).
`create` links it instead of installing, and `add` never installs into it.

The kit gained product-neutral doors only: the launcher takes the launching
product; the served product's command and display name come from its own
`package.json` and name every message; the stage host takes a package's
world-root binding; project roots are served through the globals shadow and
mount isolation; the game runtimes are known runtime packages; doorway
addresses live on `@volter/editor-sdk/host`; the eval scope takes product
additions.

Walked live over a sources workbench on fresh projects of every preset:
`game` and `prototype` open in Game with the Scene document; Play reaches
`playing` and Stop returns to the Scene; Inspector edits write source, and
undo/redo round-trip it; `full` plays its three.js and React roots, runs two
named instances side by side, opens the UI and 3D component boards, and the
web build packages `<project>-web.zip`; Profiler, Asset Budget and Build
Profiles work; `website` opens its page source in Design.

On the runtime image: a game whose `node_modules` links the checkout's image
plays (`screenshot` shows the rendered scene), and an Inspector edit writes
`src/scenes/MainScene.tsx` and undo/redo round-trip it. Volter's `arena` example,
ported with registry pins and linked to the image, opened on the published
pinned workbench (hash matched): its `.blend` model and its World (59 entities)
render; Play runs the three.js world under its React HUD with enemies engaging;
`game.input.hold('fire', { simSeconds: 0.6 })` spent two rounds (12 → 10);
moving the Center Jump Pad wrote `src/scenes/ArenaScene.tsx:33` and undo
restored it. The one console warning is Rapier's own initialization notice.

The canvas root (Pixi) authors in Edit, held to Godot's 2D editor
([docs/CANVAS-EDITOR.md](docs/CANVAS-EDITOR.md) maps each control to its owner there).
Walked on a canvas root: the selection frame and its eight handles resize from the opposite
corner; the View menu switches rulers, guides, origin and the game's viewport rectangle; Smart
Snap aligns a move to a neighbour's edge (580 against the free 581.5); an edit made on disk
remounts the scene. Open, from the reference: List Select, Pan and Ruler modes, a frame turned
with a rotated node, Pivot, Lock and Group in the toolbar.

Netcode: the editor observes a game's own Colyseus rooms (`services/game-network.ts`), held
to Godot's network profiler and Colyseus Monitor ([docs/NETCODE.md](docs/NETCODE.md)). The
`server` addition brings the `server` and `play + server` configurations and the client half
(`src/net/`); Play starts the room server from the button and the relayed verb alike. Walked on
a scaffold carrying the addition's output: connection, room, 10 entities, the state tree, the log
and a Traffic table of join, state, position and patch; the room server's side through Colyseus
Monitor (rooms, clients, Disconnect), Ping, Send, and state edited from the tree. The workbench
focus gate keeps a view's keystrokes out of a running game (walked on a release built locally from
this overlay at the fork pin: typing into Send left the player where it was); the product's
declared workbench release does not carry it until the next release is cut. Not walked: the
conditioner (scrub fields the door does not drive).

Released as 0.5.65 with modeling from one revision
([provenance/public-npm-release.json](provenance/public-npm-release.json)):
from an empty npm cache, `npx @volter/game-editor@0.5.65 create` installed the
runtime image from the registry and linked it, the game played, and an edit
with undo/redo round-tripped in source; a second game installed nothing.
Acceptance from the archives found three defects the checkout could not show
(`game-live`'s external import of the SDK's TypeScript source, a bare `create`
making the empty preset, and machine-local files a new game showed as
changes); all three are fixed in the release.

Remaining:

1. **The architecture plan** ([ARCHITECTURE.md](ARCHITECTURE.md) §The plan): the model editor
   rename, the frozen reverse-edge baseline, the viewport unit, Blender as its first consumer,
   then idiomatic games.
   The kit's Blender server routes are `@volter/editor-blender`'s serving half (walked: Blender
   boots and saves through them). A lane's worker-call meter rides the tab census under the name
   the lane publishes (`host.session.reportWorkerCallMeter('Blender', …)`), and the kit prints
   that name (walked on `arena`: `workerCalls.Blender` reports 512 MB engine memory beside the
   page's `stalls`). The standing `blender:runtime` Model is listed by `modelsFromBlendFiles` when
   it finds no `.blend`, not injected by the kit (walked: a project with none opens it). The kit
   server names no Blender package: a declared package's tree that reaches a package spawning a
   module-relative worker has that package served as source, found on disk
   (`PackageContributionCrawl.sourceServed`; on a model project it finds exactly
   `@volter/blender-engine`, and Vite's exclusion covers its subpaths). Its regression shows only
   in a registry install, so the next packed private release is its walk. The Edit/Play tab is derived from workspace
   focus, and the shell store is split: `ShellStore` is its neutral half, and Three code asks for
   its half through `threeStateOf`. Walked on `arena` on a product build: Play focuses Game and a
   key moves the player; another document turns the tab to Edit; Stop restores the pre-play
   document; an Inspector edit and its undo round-trip source byte for byte. Product builds need
   3–5 GB and thrash this box while other workloads hold its memory.
   Units 1–2 are done (`@volter/model-editor`; `release/boundary-baseline.json`, 696 edges). The
   model editor's workbench is released for its own product id; both products pin releases cut
   from Code-OSS `9ef15b1f` (W71: extension-host reconnections reach the host),
   `model-editor-9ef15b1f345b-7b9222405623` and `game-editor-9ef15b1f345b-e22708e88dca`, private,
   both with the native Chat repairs and `supercode-frontend-vscode` 0.1.7.
   The Three viewport binds its keys through `host.keyboard.bindActions` and publishes its
   palette entries from the active three stage (walked on `arena`: the transform keys set the
   mode, `tool:` palette entries toggle grid and shading, an entity entry selects and frames, and
   the entries leave while a machine document is focused). The viewport's relay verbs are its
   command contribution; a document's viewport is answered by the stage that draws it
   (`kit/document-viewports`); the Asset Lab's three.js viewers are registered by route
   (`kit/asset-viewers`); the Inspector's preview is the node's medium's answer
   (`kit/inspection-node-media`). Walked on `arena`: Scene grid, wireframe and top view set and
   read back, a Model document's view presented and read back, a glTF opened, orbited and
   inspected, a light's Preview section and Asset Editor jump.
   Unit 3: the Three viewport has left the kit. The assembled viewport, its stage host, the
   Three half of the shell store (a companion `threeStateOf` makes; the kit constructs only
   `ShellStore`), the Object3D document sessions, the Three asset viewers, thumbnails and Play's
   camera flight live in `@volter/editor-threejs/kit`; no module in `@volter/editor-core` imports
   three (kit-to-media edges 190 → 12). The Three integration installs itself
   (`three-integration.service.ts`, and every viewport ensures it) and answers the kit through SDK
   registries: Object3D surfaces, hierarchy row media, host hierarchy objects, document-stage
   sessions, renderer counts, editor controls, the play camera flight. The R3F prefab-story preview
   is `@volter/editor-game`'s. Walked on `arena` from product builds: select and inspect with
   preview, the shelf's tools reaching status, a source edit and undo byte for byte, Play with W
   and Stop restoring the scene, selection and camera pose, a glb and a Blender Model document.
   Unit 4, walked in the model editor on this code (a fresh `create`d project): the Cube moved
   through `blender-execute` shows moved and its `.blend` is rewritten on disk; undo returns it;
   the Outliner eye hides and reveals it; the state survives a full editor reopen; closing the
   Model document unbinds it from the engine and returns its renderer to the pool. The game
   editor's Scene edit and Play were walked on the same code. The adapter contract names no
   medium: `@volter/editor-project` states the `three` surface's scene, camera, renderer,
   hierarchy objects, physics debug draw and navigation mesh opaquely (generic parameters or
   `unknown`), `@volter/editor-threejs/adapter/three-contract` names them as three.js objects for
   the editor, and each runtime names its own (the Pixi mounted root and 2D physics key are
   `@volter/game-runtime`'s, the asset cache `@volter/threejs-runtime`'s).
   `@volter/editor-game` imports nothing from `@volter/editor-core`; the kit it reaches is the
   SDK's (ARCHITECTURE.md §Measured state). Blender's lens and opening direction are
   `@volter/editor-blender`'s specialization: the stage's field of view and opening are the view's
   presentation (`ViewportCamera`), which each target states (Blender 71.5° on the larger side
   and its solved direction, a `.blend`'s saved lens as its document's layer; Unity 60 on the
   smaller side, Godot 70 vertical, Unreal 90 horizontal), and the kernel keeps the editor's own
   (three's 50° vertical, the three-quarter view, its own axis colours for the compass); the grid's
   and axes' colours were already the look's. Measured: the Blender stage opens unchanged, and
   the game editor's Unity, Godot and Unreal views read 60, 70 and 72.3 (90 horizontal) degrees.
   The Object3D contribution types are Three's own API (`@volter/editor-threejs/object3d-contributions`),
   which adds `Object3DPreview` and `Object3DAuthoring` to `ToolContributionSurfaces`; the SDK
   imports nothing from three. The surfaces stay on the contribution props, registered by name in
   the kit's medium-neutral `contribution-surfaces`, because a project's contributions live in the
   project's graph and cannot import the editor's components. Walked: a `.blend` Model document
   mounts through the registered surface. The workbench's stage and panel chords stand down on the Game
   document (`volter.document.kind != 'game'`): a W held in Play had run `transform.translate`,
   which refused and warned into every Play log. The Scene's W still sets translate through the
   workbench's own keybinding (walked through the document door on the regenerated keymap: W and E
   set translate and rotate). The Game side is not walked:
   the door refuses synthetic keys on the Game document by ruling, and no other door delivers a
   keystroke to it.
   Unit 5 retires the runtime framework a game was written against. A game's own code imports
   none of it: the template's `src/main.ts` mounts each declared root in its own library
   (`<Canvas>` for `three`, react-dom for `dom`), a root's debugger is a module-level `debug`
   export, static batching reads Vite's own dev flag, and the editor observes a game's Web Audio
   (`services/game-audio.ts`) and its `@react-three/rapier` world (`services/game-physics.ts`,
   through the R3F doorway) instead of taking declarations. The editor mounts `three` and
   `canvas` entries itself (`host/roots/r3f-root.tsx`, `host/roots/canvas-root.tsx`, React and
   the renderer's reconciler taken from the project's graph through the doorways), renders `dom`
   entries bare, and its game host (the `Game`, loop, debug registry, manifest mount, input seams,
   render control, instruments) lives in `editor-game/src/runtime`; `game-runtime` keeps only
   helpers a game may call, and imports nothing of the editor. Walked under the packaged server:
   the template's `full` and `website` projects play and build; `arena`, on the editor's local
   `@volter` copy with its own input store (now `examples/arena` in this repository), plays with
   no console error, moves
   and fires through the input door, and reads "Moves the physics body that owns this node." on
   EnemyBody; a scratch canvas project plays and animates. The observer also answers a body's
   colliders and joints, and the design session gets it too. Not walked: a physical keystroke, a
   drag visibly holding a body (arena's moving bodies are kinematic). A body's collider rows read
   in Edit, from the design world's own `<Physics>`: EnemyBody shows its Capsule Collider (Half
   height, Radius) and names why its size is read-only; the Inspector refreshing by itself once
   Rapier loads is not walked. A canvas root mounts in Edit (see the canvas lane below).
2. **Animation seen from outside.** The editor finds a game's mixers through a served stamp on
   the project's own `new AnimationMixer(...)` and `useAnimations(...)` call sites
   (`@volter/editor-threejs/serving`); `status` reports them as `liveMixers` (walked on `arena`:
   five mixers, their clips and the characters they animate). A game's Web Audio is heard the
   same way: the editor routes each context's output through its own gain and records the
   connections (`services/game-audio.ts`), and a root that declares no audio gets that observer
   as its `systems.audio`, so the template and its audio capability name no editor type (walked
   on `arena` with its audio declaration removed: the Audio panel shows the game's gain graph,
   Pause mutes it with no gate warning, resume makes it audible). The Animation utility (View → Animation) lists
   every stamped subject and its clips and scrubs it in Edit (walked on `arena`: five subjects;
   a picked clip moves between 0 s and 1 s). Open: a world's own fades run on the mixer's clock,
   which Edit never ticks, so arena's characters stand in their bind pose until the playhead
   first moves past the fade; settling the fades instead drops arena's enemies below the floor
   without their per-frame grip and IK pass (the player stands). Which pose Edit shows before
   the first scrub is undecided.
3. **Machine documents.** Authored edits and the live overlay are walked on `arena`, and the
   fit on first size too (the enemy machine opens whole). ELK breaks each cycle depth-first from
   the initial dot, so a state in a cycle with the initial state lands after it and the dot's row
   stays free: measured on `arena`'s two machines, all six initial arrows run level for 20px into
   their state's left side (four climbed into it from below before).
4. **The design skew** (`website`): the DOM root is read-only, the Pages list is empty, and a
   `page` has no document editor.
5. **Unwalked instruments:** Network needs a game that joins a room: the template ships the
   Colyseus rooms but no client (`server/main.ts`), and the netcode capability is at the
   launch-scope tag, so no networking adapter exists to walk it through. Navmesh is walked on `arena`
   with its level tagged `userData.navRole = 'walkable'` and a first-party navigation adapter in
   its `systems`: Debug > Bake NavMesh draws the walkable carpet over the floor, ramps and bridge,
   and Clear NavMesh removes it. Contributed application-menu items (`workspace.menu`) are palette
   entries too ("Debug: Bake NavMesh"), because under the Code-OSS frame the editor draws no
   menubar of its own; the workbench's native menubar does not carry them yet.
6. **Input gating.** A game's own input listeners take the realm gate (measured on `arena`, then
   on its engine input manager: during Play with a Model document active, a held W no longer
   reached `gameInput`; with the Game tab focused it did; its own store is not re-measured), and the document door refuses synthetic key, type, paste and drag while the
   Game document is active. Virtual input through the game's own debug door
   (`native-debug-module.ts`, `game.input.*`) is delivered whatever the focus, by ruling: the gate
   keeps a person's keystrokes aimed at another document out of a running game, and a call to the
   game's own `debug.input` is an agent's explicit act on that game, the same as `game.command`,
   which also runs whatever is focused.
7. **Source mode's `.wasm?url` imports.** With `VOLTER_EDITOR_FROM_SOURCE=1`, editor-game's
   asset-budget contributions (`asset-budget*.ts`) fail to load: they reach
   `draco3d/draco_{en,de}coder.wasm?import&url`, which the session answers as the raw file
   (`application/wasm`, Express) instead of Vite's URL module, so the page refuses it as a module
   script (measured by importing each module of the graph in the page). Packaged sessions are
   clean. Closes when a `?url` import of a `.wasm` answers `export default "<url>"` in source mode.

## Music: pieces as DAWproject components

A piece is a React component of `@volter/dawproject` elements, mounted by its own
reconciler; `@volter/editor-dawproject` is its document (a Bitwig-shaped arranger, clip
editor and mixer) and its offline renderer. Measured in the game editor on the probe
project's 16-bar orchestral piece: moving, transposing, adding and deleting notes, velocity,
automation points, faders, pan, mute, send levels and device parameters (a member of
`params={{ … }}`, added when unwritten) each write the literal in the piece's source, and
Freeze writes a generated clip out as literals; each undoes and redoes through the workbench's
stack byte-identically, and generated notes refuse and name their line; an undo whose element
was changed since (a note transposed outside the editor after a drag) refuses and leaves the
file as it is. Renders are
byte-deterministic; stems null against the mix to −143.6 dB with the master's dynamics
bypassed (−30.7 dB with them: nonlinear, as expected).
A render of the probe piece takes 86 s. `freeze-clip` wrote the piece's three generated
clips out as literals with the vertical view and `check-piece` unchanged. The editor's mix
graph, rendered offline in the page on the export's own dry signals, nulls against the
export's mix at −140.1 dB over the whole piece (strips, reverb bus, master dynamics). The
export plays every note and controller on its exact sample (two passes of one slice null at
−104 dB wherever the loop falls against the synth's 128-sample block).

For a game, `add music` brings the packages, the `volter-music` skill and a player;
the `project.music.render` tool (and the `render-piece` CLI it shares its code with) writes
through the project-output door, so `.volter/provenance.json` records every file a game ships,
with renders byte-deterministic down to the OGG and its AAC twin (`.m4a`, which the player
loads when the browser cannot decode Vorbis); `sections` writes each marker section as its
own seamless loop at the mix's level (lengths exact to the frame against the report's
`barSeconds`; a render's passes are whole samples, so each section's channels are
bit-identical to its bars in the piece wherever nothing rings in from the music before it:
on Harbor, flute, strings and cello past A's first second, only the harp's decay out of A′
differing) and `oneShot` a stinger. Driven in the editor page on an OfflineAudioContext,
the player switched from one section loop to the next on the bar line it computed (6.05 s,
the report's bar 3 plus the lead), with the output equal to each loop's own samples on either
side of the fade; a second queue before the switch replaced the waiting loop at the same
moment (it never sounded), and a section starting mid-bar switched on the piece's next bar
line inside it. `check-piece` adds an analysis (keys, half-bar chords and degrees, cadences
and loop seams, voicing, line statistics, figures shared with the folder's other pieces);
on Harbor and Tidewatch its chords match the pieces' own chord tables in every bar.
Walked in a fresh game created from the checkout: `add music` copies the player and the render
tool and selects the piece finder in `volter.adapter.ts`; a worked piece from the package's
`examples/` opens in the same running session; `project.music.render` with sections wrote 32
files under `public/music/harbor` (no problems, −18 LUFS, seam 0.177) with each recorded in
`.volter/provenance.json`, rendering in its own process (the editor answered in about 270 ms
throughout) and byte-identical to an in-process render; console silent.

Bitwig's mixing, session and recording layer, each written in the piece's source and read in
the headless, muted host (edits undone byte-identically): track automation of volume, pan and
sends; `<Lfo>` modulators on the same targets; group tracks (`role="submix"`); sidechained
compressors; audio tracks (`<Audio file offset gain>`); and comping of `<Audio take>`
recordings with `<Comp take at>`. Offline in the page on the export's dry signals, the editor's
graph nulls against the export's mix at −139.6 dB with lanes moving, −138.2 dB with groups,
−139.9 dB sidechained, −139.7 dB with an audio track, −139 dB with four LFOs (which move the mix
by −19.2 dB), and −140 dB across comp boundaries. The clip launcher (`<Scene>` of
`<ClipSlot track>`) launches a scene or a slot on the next bar: a scene launched at beat 23.6
switched at 24, the tracks it leaves out reading −inf on the strips' peak meters while its own
metered (Drums −18.6 dBFS); `render-piece` writes each scene as a seamless loop and the game's
player queues scenes by name. Rec records notes from Web MIDI or the computer keyboard into the
selected track (driven by keyboard; no MIDI device in the host), and on a track without an
instrument the audio input: on the host's fake input a take was saved, placed on its bar and
metered at −4.7 dBFS in playback, and over a one-bar loop it cut into one take per pass. The
DAWproject export carries scenes, audio (embedded), LFOs (as points) and comps (as segments)
and validates against `Project.xsd`.

Open, with what closes each:
- Bitwig's editing basics, landed and each driven through its own control on Harbor (source
  diff read, undo byte-identical, generated targets refused whole): in the piano roll,
  selection, group move, length, grid, quantize, clipboard, duplicate and articulation; in the
  arranger, clip move/resize/create/delete/duplicate, seek, loop region, metronome, markers,
  tempo and meter, the tempo row, and adding tracks, devices and sends. Playing, read in a
  headless, muted tab hosting the session (`VOLTER_NO_OPEN`, Chromium with `--mute-audio` and
  `--autoplay-policy=no-user-gesture-required`): a ruler click at bar 10 while playing moved
  the playhead from beat 5.3 to 36.6 and on; with a loop region of beats 8–16 a play from 0
  ran into it and wrapped from 15.6 to 9.0; the metronome scheduled a blip every 0.75 s at
  80 BPM, the downbeat at 1760 Hz against 1320, and none once off; a paste at playhead 14.32
  wrote the note at 4:3.25 (the 1/16 grid) and undid byte-identically.
- [minor] Live against export, synth half: the preview only, under a quantum and below what a
  listener hears, while the export every game ships is sample-exact. Read from `spessasynth_lib`'s processor: at the start of
  each 128-sample render quantum it applies every queued event whose time has passed, then
  renders the quantum, so each note the preview schedules sounds up to 2.67 ms after its
  performed time (the export is sample-exact). Under a quantum is inaudible; matching the export
  exactly needs the processor to split its quantum at event times, a change to that library. The
  offline null of the two (+1.6 dB at equal level) is not yet a clean reading: in an
  OfflineAudioContext the worklet stayed silent after the preview's channel setup, so the
  instrument has to be settled before its number means anything.
- Sampled instruments: decided without a listen (Aaron's rule, relayed 2026-09-26: a question
  whose answer can be guessed is not waited on). VS Chamber Orchestra 2 Community Edition
  (CC0) is the finished palette and the General MIDI SoundFont the sketch palette, as the skill
  teaches: VSCO is recorded orchestral instruments with their own articulations and round-robin
  repetitions, which a General MIDI preset has none of; no listening test was run, and a
  listening verdict against it reopens this. A blind listen began 2026-09-27 (Runhuman, project Volter Hosted
  Editor; Harbor on each palette, loudness matched, unlabeled, one play order per job;
  volter-listening.aaron-0ed.workers.dev, `/a/` General MIDI first, `/b/` VSCO first): the one verdict in (order a)
  heard the two as "almost the same", both like real musicians, and mildly preferred General MIDI. The renders differ
  (they do not null: +3.3 dB residual) with near-equal band balance, since every track was matched. One listener in
  one order is not a verdict; a VSCO-first listen is what reopens or keeps this call. The evidence a listener would use stays in the probe:
  `music-probe/out/ab/gm/harbor.ogg` against `out/ab/orchestra/harbor-orchestra.ogg` (levels
  matched to 0.0 dB), and Tidewatch and Victory on the orchestra. The library builds as 20 banks,
  66 patches (`scripts/vsco2-ce`, into `~/.volter/banks/vsco2-ce`, byte-reproducible; SF3,
  218 MB with round-robin members; an editor tab holding nine grows by about 425 MB).

## Both products in the browser substrate

Both products run as images of `browser-substrate`'s `examples/volter-editor`
(branch `examples/volter-editor-products`: `/model-editor`, `/game-editor`). The image's
build step is the product's own `prepare` (the session's dependency optimizer), so its
packs cover what the session pre-bundles and the tab builds none. Measured on a warm
origin, navigation to the Model Editor's model read in Blender: 19.5–25 s, from 80 s to
the workbench alone before the image carried its pre-bundle (load 12–35, so single
runs vary by seconds). Where it goes (ms): runtime and image link 0–3,600; `edit` to the
session listening 4,300; Code-OSS server 2,500; workbench and product bundle 3,300; the
product mounting its model document 5,700; Blender 2,800 (its wasm, `.data` and
Essentials come from Cache Storage after the first open). The Game Editor opens its
scene in the tab, prefab thumbnails included, with no in-tab builds: warm, the session
listens at 3.4 s and the extension host starts at 5.4 s; the first open of a new image
takes 12–14 s while the tab fetches and places its packs. Memory: a warm open peaks near
3 GB of renderer and settles near 1 GB; the peak is uncollected garbage (a forced
collection took 3.1 GB to 0.4 GB), and the largest remaining producers are Vite's
per-module sourcemaps in the session and the page's workbench. Measured on a box at
load under 20; at load 40–60 the same opens take 15–30 s. Open: the pack archives,
unpublished while the editor is private. Under 10 s cold needs the substrate to resume
processes (its W74), not only prebaked files.

## Chat sign-in (source, 2026-10-04)

The source overlay now routes the native toolbar/keyboard New Chat action
through the resolved non-delegating provider's existing creation command, including
its Harness/Model/Effort flow. Provider-owned creation dispatches before native
edit confirmation or stopping the old editing session, so picker cancellation
preserves review tabs as well as the old conversation and draft. It follows the
same lifecycle as invoking the provider's own New Session command directly.
The shared clear helper used by Send to New Chat is unchanged.

Supercode's native Chat frontend owns sign-in; the editor's
private host controls supply readiness, revalidated install/login terminal launches
and conversation state. Codex is offered first as **Sign in with ChatGPT**; the only
first-run install uses npm's resolved global prefix, shown before the person clicks.
Passive refresh retries a refused runtime handoff after sign-in, without reloading.
Default coding launches still inject no provider settings or account credential.
Login and install buttons display quoted absolute executable paths. Login uses
the same resolver as the running harness: `SUPERCODE_BIN`, a source-linked SDK's
own binary, the installed `@volter/supercode/bin/supercode.js`, then PATH. The terminal
runs that program directly with argument arrays (no interactive shell). Both terminal and inventory process receive the launch Node
directory, inherited PATH and npm's global bin directory. The install fixes that
same prefix explicitly, so a new Codex executable is visible to fresh inventory
probes without restarting the editor. This path is source-verified, not live-walked.

Two first-run retry repairs follow the independent review, source-only until a
new build grant. The frontend now keeps setup pending until both connection and
native reveal succeed; a ready host alone cannot stop its retry timer or make
**Check again** skip a failed reveal. The host caches successful executable/PATH
discovery but marks npm-prefix errors and rejected executable resolution as failed.
The next `/state` refresh (including **Check again** and setup polling), explicit
service refresh or setup action retries failures. If recovery changes PATH or the
Supercode executable, the idle discovery controller is closed through its own API
and recreated before inventory refresh. A controller owning a conversation is
preserved; its eventual replacement uses the recovered context. Verification needs
frontend build, editor-core server build, then overlay copy, serially; no product
browser build or Code-OSS compile-client. No live failure/retry acceptance claimed.

## React source authoring through Retrace

Replace `editor-react`'s custom OID/edit planning (`serving/ui-oid-plugin.ts`, `src/source`)
with Volter's `@retrace/core`, `@retrace/element` and `@retrace/format-tsx-babel`
([Retrace](https://github.com/volter-ai/retrace); local checkout `/Users/yueranyuan/volter/retrace`).
State: the editor names Retrace nowhere; its three central stamping/writer/plugin files total
5,626 lines, including shared R3F work. Retrace's element lane parses TSX and plans literal,
structural and import edits; stamping, OID compatibility, persistence and stale-write guards
remain caller-owned. Closes when UI selection, literal/style and structural edits use Retrace
and recorded writes, undo/redo and dynamic-value refusals round-trip through the UI board.
Size: several days across the serving plugin, source adapters and persistence; scope must
separate DOM work from the shared R3F bindings. Packages are not on npm yet. Tracker only;
no migration started.

## Play on the Model document

The `playable` Model Editor template declares `editor-model-play`, `editor-ui` and
`editor-react` on its project; the base `models` template declares none of them. The Play
tool contributes header/View controls through `kit/document-play-extension`; Blender
lends its detached Rendered stage. Stop/Escape disposes it and returns to the saved model.
The UI tool mounts the declared `dom` root through `kit/project-play-layers`, sharing one
mount epoch with the script (`editor-model-play/src/play-script.ts`), so its plain race
store has one instance. The existing UI board opens the HUD's CSF stories beside Track.
State: walked in source and built sessions of Volter Model Editor, built on Blender;
fresh `create --template playable` ships the built circuit, script and React HUD, while
`models` shows no Play control. Scene empties group the circuit; Outliner pages after
parent folding. Render and Play at the same pose match (1.10/255 mean absolute RGB
difference after grouping). Play awaits the
World before revealing its first frame; HUD typography matches the UI board, with chat
closed and a thin timeline. Ramp selection/gizmo, visible airtime and corner smoke were
captured under `/tmp/model-play-frames`. Driving measured 85–100 fps; frameCost measured
8.03 ms median / 10.72 ms p95 at 3209×1129. Review measured the ordinary Rendered editing
view at that size (12 settled frames): shadow fitting on every draw took 10.55 ms median /
12.47 ms p95; fitting only when camera/object pose or visibility changed took 10.63 ms /
13.71 ms. CPU submission medians were 5.09 / 5.00 ms; these samples show no material total
frame-cost improvement. Scene/shading changes invalidate the fit too. The packaged SDK doorways share tool registries
and project state. PR #37 carries recording steps; one fresh session is stopped at the
start line. The product key door drove all three ordered checkpoints and crossed the start
line again: LAP 2, LAST 8:07.41 (`lap-complete.png`). This stop-and-inspect lap includes
inspection pauses and one infield recovery; it is not a racing-time benchmark. Off-road drag
was reduced so the capped off-road speed can actually recover onto the track. Temporary
HUD state attributes used for the check were removed. No automated tests ran.

First-run follow-up: the playable adapter declares Track as its default; available root
fallbacks wait for the settled document table. Fresh creation opens Track with Cube selected,
Play visible, Chat open, Outliner/Properties and a thin Timeline. The starter saves Material
Preview with scene World/lights enabled. Blender deliberately demotes Rendered shading on
file read; its load rule is unchanged. The presenter now carries Material Preview's two
scene-lighting flags independently, and uses the scene display transform in Preview too.
The Play tool owns a 0.8-second eased camera handoff (pose, projection and field of view),
locks input on entry, freezes the detached scene for the return, and fades its React layer
away before revealing the editing stage. Escape completes an in-progress blend. The race's
resting chase distance is 11 metres, keeping the road ahead readable.

Independent-review follow-up: Material Preview retains viewport visibility independently of
Scene World/Scene Lights; captures still use render visibility and restore the preview on
return. The UI Play provider reports all declared entry paths before importing/mounting,
and the Play tool retains failed-attempt paths through first-update failure so a relevant
save retries. The second modeling area stays mounted but hidden during Play; only its
header/shelf chrome stands down. Source review and commit boundary hooks passed; no builds,
tests or live sessions ran for these fixes. The three checks for the next granted regression
session B are in [docs/MODEL-PLAY-REGRESSION.md](docs/MODEL-PLAY-REGRESSION.md).

Keymap verification remains open: the checked-in play guard was edited by substitution;
at review time no compiled Code-OSS fork was found in the local checkout/build locations (home checkouts,
`.volter`, temporary directories; source/parser filename search and Spotlight). The cached
`~/.volter/workbenches/model-editor-f16dc165c0df-ae7600a80ae8-darwin-arm64` is a packaged
workbench, not a fork checkout. `generate-keymaps.mjs` requires the fork's
`out/vs/base/common/keybindingParser.js` and `keyCodes.js`. Closes when it runs against a
compiled public fork and the resulting manifest/carried-keymap diff is reviewed. The sign-in
worker has since supplied its compiled integration fork; its generator handoff is pending.

## Tab recorder frame rate

Raise the shared browser controller's optional recording rate without changing its low-rate
watcher defaults. State: `~/.codex/skills/browser/scripts/open-session.ts:990` clamps
`/screencast` to 15 fps; `screencast.ts` forwards only after `1000 / fps` milliseconds and
resets its deadline to the latest send time, losing cadence when incoming frames do not
divide evenly into the requested rate. CDP already uses `everyNthFrame: 1`; moving frames
are capped at 1280 pixels wide. The accepted race take is a 15 fps storyboard; the owner
records the real clip at full frame rate. Closes when an opt-in 30/60 fps recording path
preserves source timestamps, accumulates deadlines, bounds backpressure and reports actual
received/sent/dropped frames, with sustained cadence and native 1920×1080 checked on a
moving tab through the existing shared connection. Coordinate controller maintenance with
its owners; preserve tabs and leases. Size: roughly 2–3 controller/recording files, 60–120
lines and half a day including validation. Tracker only; no controller change or fixed-step
replay work started.

## Skeletons and actions in Play

State: a detached or following copy binds no skeleton; the frame used to build it carries
no bones or actions. A rigged character is a frozen mesh in Play, and a play script cannot
start a clip. Skin and Timeline bind only to the presented view
(`blender-runtime-skin.ts`). Closes when a Timeline-authored character plays the same
action in Play, started by the script; Blender camera animation can drive the play camera;
and Timeline and script can hand an object to each other. Cinematic and game then share
the scene and clips, so a film made in the editor can become playable. Tracker only;
no animation implementation started.

## Supported-editing work

1. **Native undo/redo:** Code-OSS owns resource ordering and commands; Blender
   owns native snapshots. Redo does not rerun Python. Supported Python/RNA
   edits, Properties values and viewport drags participate. A drag is one
   undo step. Refused read-only edits preserve redo; partially failing Python
   mutations remain undoable. File loading, direct native history moves and
   worker replacement invalidate old entries. History is session-local.
2. **Blender Essentials:** the pinned 17-file CC0 payload mounts at
   `/bw/datafiles/assets`. Smooth by Angle and the Smooth sculpt brush passed
   source acceptance; packed acceptance restored an Essentials-backed modifier
   through undo/redo and full editor reopen. Public LFS bytes and packaged
   manifest hashes were verified.
3. **Rendering:** linked World Background strength and Blender's
   POINT/TEXTURE/VECTOR/NORMAL Mapping semantics are evaluated, including
   inverse mapping with zero scale. This is not complete material-renderer
   parity. Release 0.5.63 adds the physical-material and homogeneous World-volume
   features described below; remaining shader-graph and volume features are
   implementation work, not established Three.js limitations.
4. **Duplication/deletion:** batch operations are one native edit; copied
   parent/child relationships and selection are preserved. Undo/redo restores
   both objects and relationships. History acknowledgment waits for the
   restored Outliner index, so an immediate delete after redo sees the object.
   Blender's modal duplicate-and-move UI and expanded editing of inspection-only
   panels are not claimed.

**Windows and Linux (owner, 2026-10-06).** The Model Editor ships darwin-arm64, win32-x64 and
linux-x64 workbench releases, each cut on its own platform (win32 on a Windows 11 desktop, linux
in WSL), declared per platform in `packages/model-editor/package.json`. Code-OSS's win32 package
task no longer rcedits native binaries (Smart App Control blocks the rewritten hashes). Open:
Chat on Windows reports no ready local agent though `supercode harness list` reports Claude Code
and Codex ready; Linux (WSL) finds them.

## Persistence and startup corrections

- Every edited command uploads its complete document before acknowledging.
  Worker calls and saves share one queue; frame acknowledgments bypass that
  queue so a command waiting for its frame cannot deadlock.
- Explicit worker stop, fresh start and CLI close drain/save before terminating.
  A failed upload refuses close and retains the live worker for retry.
  Browser unload warns while calls or unsaved data remain. Native prompts need
  user activation and can be overridden; forced kills and power loss cannot
  promise an in-flight edit's final save.
- Early package commands wait for contribution discovery. Blender start resolves
  the declared Model table, including custom IDs and a declared default;
  ambiguous Models require a choice rather than a guessed fallback.
- The server gives undiscovered package commands bounded discovery time and
  adopts their declared deadline when registration arrives. Repeated reports
  do not reset elapsed work. This fixes the measured five-second false timeout
  on an otherwise successful 10.925-second Blender startup.
- Properties reads belong to their model revision and selected subject. Late
  success/error responses cannot overwrite a newer selection, and old context
  is cleared while the new subject loads. Four regression tests fail against
  the previous implementation and pass with the correction.

## Earlier 0.5.62 verification

All 41 tests, all eight package typechecks, build, release-boundary checks and
packed-import checks covering 1,083 files pass. Generated bundled notices were
reviewed: only Volter package-version labels changed. Blender WASM, Essentials
and the pinned public workbench are unchanged.

The eight 0.5.62 candidate archives installed without workspace links.
Python and RNA undo/redo passed (Cube X=0 ↔ 3.125 ↔ 5.625), followed by an
Essentials-backed modifier undo/redo. Fifteen rapid duplicate/delete/history
cycles checked each structural write for `persisted: true` and checked for
stale Properties errors. Three worker restarts retained X=5.625.
Five full editor close/reopen cycles immediately invoked the default
MCP-shaped Blender start, preserving successive values through X=10.625.
Every cycle had a silent console. The real MCP transport opened a closed
editor and read the saved scene; the Essentials NodesModifier remained.
The workbench initially showed Explorer, so Properties was explicitly focused
before verifying its populated fields and capturing the selected Cube and grid.

In 0.5.61 acceptance, closing during a two-second pending Python edit waited
2.25 seconds; reopening
retained X=6.875. Making the model directory read-only caused both edit save and
CLI close to refuse with EACCES while the worker remained alive. Restoring its
original 755 permissions allowed the pending X=44.625 to save and survive full
close/reopen with a silent console. The intentional fault was acknowledged only
after recovery. An initial zero-size canvas sample was acknowledged against a
visible capture and healthy current canvas invariant at 113.7 fps.

The same save-failure check passed on the exact 0.5.62 archives: both edit and
close refused EACCES, the worker stayed alive, and restoring directory mode
755 allowed the pending X=12.625 to save. Full reopen retained that value with
a silent console. Its initial zero-size canvas warning was acknowledged only
after a visible capture and healthy current rendering at 45.4 fps.

The credential-free public install resolved all eight packages from npm,
matched every archive digest, and contained no workspace links. It repeated
Python/RNA history, Essentials modifier restoration, ten rapid structural
history cycles and two worker restarts. Each structural write persisted;
Properties showed no stale errors. The inspected capture showed the selected
Cube at X=5.625, grid, Outliner, populated Properties and Chat. Its initial
zero-size canvas sample was acknowledged only after the current invariant
passed and visible rendering measured 95.9 fps.
Closing during a two-second pending Python edit waited 2.249 seconds.
Full reopen retained X=9.875 and the Essentials NodesModifier with a silent
console. The task's editor sessions were closed after acceptance.

## Source and artifacts

- npm source for 0.5.64: `839179069050f6965cf51d27adfcd5b60a3898be` in the public
  [editor repository](https://github.com/volter-ai/editor);
  [release v0.5.64](https://github.com/volter-ai/editor/releases/tag/v0.5.64).
  0.5.63's source was `377651068f63e359589735f9b707e00df58b39b4`. The earlier 0.5.59
  and 0.5.60 patches are immutable: 0.5.59 lacks the Outliner barrier, and
  0.5.60 lacks the cold-start corrections; 0.5.61 lacks revision-safe
  Properties reads.
  [Release v0.5.62](https://github.com/volter-ai/editor/releases/tag/v0.5.62)
  records the preceding acceptance. The current [npm receipt](provenance/public-npm-release.json) records the exact
  archive digests, acceptance evidence and remaining limits.
- The workbench is Code-OSS `f8664703ab59` plus editor overlay `2896a2901bb6`,
  release `editor-f8664703ab59-2896a2901bb6-darwin-arm64`, SHA-256
  `98e0a485119020be52bd81e4ada0b37ec1dd100ae2e96e3d6c07ccda5c4f8269`.
  Its complete anonymous download and fresh installer fetch were verified.
  See [workbench provenance](provenance/public-workbench-release.json).
- Blender corresponding source and all 34 dependency-source archives were
  public before binary distribution. See [source review](provenance/blender-source-review.json)
  and the [source/binary release](https://github.com/volter-ai/blender/releases/tag/blender-5.2.0-wasm.3)
  (source `071e080a`; the archive and all six binary files downloaded
  anonymously byte-identical before and after upload).
- All three public repositories began from reviewed root snapshots without
  private history. Former repositories and legacy releases remain private
  under explicit `*-private-history` names. No recurring export is required.

## Remaining work and limits

### Material node graphs (0.5.64)

A Principled BSDF's or Emission's linked Base Color, Metallic, Roughness,
Alpha, Emission and Normal inputs render from the material's node graph. The
session ships the flattened graph (`material_graph` in `session.py`); the
presenter compiles it as EEVEE's codegen does, calling Blender's own node GLSL
(`blender-node-glsl.generated.ts`, 56 files from Blender's processed shaders
by `scripts/generate-node-glsl.mjs`, with a counted patch table for GLSL ES
3.00, every file compiled in the page's WebGL2). Compiled nodes: Texture
Coordinate, UV Map, Geometry (not Parametric), Attribute (Geometry type),
Color Attribute, Value, RGB, Image Texture (Flat/Box/Sphere/Tube,
Linear/Closest/Cubic/Smart, UDIM tiles), Mapping, Math, Vector Math, Vector
Rotate, Mix, MixRGB, Color Ramp, Invert, Separate/Combine XYZ and Color,
Map Range, Clamp, RGB/Vector/Float Curves, Hue/Saturation, Bright/Contrast, Gamma, RGB to BW, Noise,
Voronoi, White Noise, Checker, Wave, Gradient, Magic, Brick, Fresnel, Layer
Weight, Bump (EEVEE's height sub-function at the dF offsets) and Normal Map.
Mix and Add Shader over one Principled BSDF, Emissions and gray Transparent
BSDFs compose as EEVEE weights closures. A deformed mesh whose graph reads
Generated coordinates draws them from Blender's orco of the undeformed mesh.
The exporter gains `graph_materials`/`graph_images`/`graph_generated`, the
one Principled BSDF a graph-drawn mix reaches, UDIM tiles, and revisions keyed
by `session_uid` (Blender fork `071e080a`).

Measured against desktop Blender 5.2 EEVEE on emission planes and spheres,
seven scenes: flat and interior regions within 1-3 of 255 for every node
above, including bump, normal map, geometry, attributes, deformed orco and
UDIM; larger differences only on high-contrast edges, cell borders and
filtered image detail (EEVEE's TAA and anisotropic sampling). Mixes are
identical to their Principled equivalents (Transparent mix vs Alpha, Add
Emission vs Principled Emission: 0 levels). A constant edit updates uniforms
without recompiling; a structural edit compiles its program off the draw
(`compileAsync`), the material showing its previous state until the program
links; WebGL compile and link blocked the main thread 0 ms across three
structural edits. A graph the GPU refuses falls back to the constants with a
named warning.

Limits: a Principled BSDF inside a group on a shader mix's path, two
Principled BSDFs in one mix, a tinted or linked Transparent colour, Box
projection with Clip, Geometry's Parametric output, non-Geometry attribute
types, and Generated coordinates through a topology-changing modifier are each
a named warning.

The Model viewport draws only when something changed. A source that
announces its changes (`ToolObject3DPreviewSource.onChange`, offered by the
Blender view for every frame and every completion after one) skips the
render on frames where nothing changed; the stage store, input on the stage,
the editor's own invalidations (`stage-invalidation.ts`), camera, size,
background, tone mapping, playback, flights, pending photographs, presence
markers and particles all still draw, and sources without `onChange` draw
every frame as before. Measured live: 0 draws in 3 idle seconds (was ~6,750
per 2 s); an edit, a selection, a framing, a capture, pointer movement and a
graph program's asynchronous swap each drew and then returned to 0; the idle
main thread went from 49% busy to 2% at machine load 54-69.

The session's graph pass reads each node tree's links once per present
(`NodeSocket.links` walks the whole tree per read): 15.5 s of a profiled pass
down to 0.74 s in the battery's 28-material workshop scene, identical graphs.

The engine is served with a validator (`ETag`, `no-cache`, 304 while
unchanged), so Chrome keeps the code it compiled from the 86 MB module:
fresh boots measured 12-36 s at load 32-37 before and 1.9-2.2 s at load
48-52 after. A present re-reads which document it waits for, so a command
sent before the Model pane has bound no longer waits out 15 s for
`document:blender:runtime`; three close/open/first-command cycles answered in
2.3-2.8 s.

Also in this candidate, ported from fixes verified in the private-history
checkout on 2026-09-23 but never committed there: no empty header strips
above the Model and Timeline editors or in the side panels; a view's camera
up vector survives a tab switch; a refused second `.blend` cannot expose or
edit the first; closing a hidden document releases its stage state.
Properties no longer blanks and repaints on every edit (measured through one
edit: 0.5.63 went 225/28 elements/inputs to 38/1 and back; the candidate held
225/28).

Packed acceptance (0.5.64): the eight archives from
`8391790` installed into an empty directory with no workspace links and no
engine override; the product resolved its pinned workbench
`editor-f8664703ab59-2896a2901bb6` (seeded in the local workbench cache, since
it is unpublished) and served the engine from the installed package
(`blender_browser.wasm.br` sha256 `63098ef8…`, matching BUNDLE.json) with its
validator, so the first command after opening answered in 2.7 s (boot 2.2 s).
The curve and UDIM/orco comparison scenes rendered with the development
build's numbers; a graph constant's edit undid and redid exactly; a full
close/reopen kept the edited value, the three UDIM tiles and the graph
materials; console silent throughout. The five-model battery on `8391790`
completed 362 of 362 calls with every model's status and error sequence
identical to the accepted wasm.2 run, and 387 of 388 raw snapshots
byte-identical to it (the one other differs in element order only).

### Material-rendering implementation (0.5.63)

The candidate implements Principled coat weight/roughness/IOR/tint, sheen
weight/roughness/tint, anisotropy/rotation, specular level/tint and thin-film
thickness/IOR. Shader adjustments carry coat absorption and IOR and preserve
Blender's specular grazing behavior. Tangent/object-space image Normal Maps
carry strength and OpenGL/DirectX conventions. Image Texture Clip extension
is implemented; material inputs have independent sampler state even when
they share one image, and connecting Image Color no longer connects its Alpha.
Named UV selection supports all eight Blender layers, including render
snapshots and shared materials on meshes with different layer order. Evaluated
corner normals come from Blender, not from normals recomputed after UV splits.

Nine regression tests cover physical values, live uniform updates, restoration,
sampler ownership/repaint/decode/disposal, Clip/alpha, named UV seams/channel
selection and revision-owned snapshot buffers. Source-linked live GPU captures
verified physical inputs on/off, tangent and object-space DirectX normals,
Repeat versus Clip and first versus eighth named UV. Each edit/history probe
restored its original state and ended with a silent console. The first UV
capture exposed a missing snapshot copy; that path was corrected and both
the regression and live rerun passed. These are feature checks, not complete
BSDF or shader-graph parity.

The corresponding Blender exporter is public at
`68bba09924c2cf08cbceb6608be4a9e1500a62bb` (PR #1). Verification used a rebuilt
WASM override. Public npm now carries that verified binary. Fresh packed
acceptance passed before publication; corresponding source was public first.

The candidate also implements homogeneous World Absorption, Scatter, Principled
Volume and Emission closures, including Add/Mix weights and constant linked
input expressions. A depth-aware scene-linear pass integrates absorption and
emission analytically and local-light single scattering numerically. It uses
point/spot shadow maps, rectangle-light quadrature, HG/Draine/Rayleigh phase
functions and Blender's blackbody coefficients. Surface lighting receives
matching medium attenuation; the rectangle surface-light path uses center
distance with its existing LTC approximation. Both capture hosts use the pass
before display transforms, with revision-owned disposal.

This is not Cycles volume parity: heterogeneous fields, multiple scattering,
Mie/Fournier-Forand phases and multilayer transparent depth remain implementation
work. Unsupported spatial inputs and phases refuse by name; unbounded emission
without extinction refuses its divergent radiance instead of inventing a far
boundary. Linked physical sockets, general material graphs and additional
normal/bump paths also remain unfinished implementation, not fundamental
Three.js limitations. No claim that these cannot be implemented is made.

Eight new volume tests cover export, Mix/cycle handling, coefficients, analytic
transport, phase normalization, blackbody, named refusals, surface uniforms and
pass ownership. The live orthographic absorption probe measured exactly 163/255
against the Beer–Lambert/Standard prediction (clear: 255/255), and history
restored the density. Perspective spotlight/point-light and occlusion captures
ran with a silent console. The full engine battery is recorded below. These
feature probes have also passed against the final installed archives, without
a WASM override or workspace links.

The first new-binary battery attempt completed the courtyard's 95 calls with
the accepted baseline's four error positions, but its final verification was
blocked by stale harness imports and an incomplete disposable-project dependency
setup. It also exposed a real missing-named-UV regression: such a lookup now
uses Blender's zero-coordinate behavior instead of throwing or substituting the
active UV map. The complete battery reran with that correction at editor
`c7f0def0d717dfeef7b56f436156834a4b2250b4`: all 362 calls completed, no harness
failures, and all photographed camera poses matched. Courtyard and workshop
matched final geometry and presentation. Bridge, tram and courier retain exact
comparison differences; they are not reported as native-parity passes.
All 70 bridge snapshots are byte-identical to the previous accepted binary.
Courier's five snapshots match that binary after index remapping except two
normal components differing by 0.000001. The bridge/tram presentation reports
still name the same geometry-less curve helpers. Courier now has only its four
native script errors, rather than the old host's 27 error positions.
See [binary verification](provenance/blender-material-verification.json) for
source/harness hashes, timings, errors, runtime checks and comparison evidence.
The public source archive at `blender-5.2.0-wasm.2` was anonymously verified;
the 34 unchanged dependency payloads remain at `blender-5.2.0-wasm.1`.

### Packaged sidebar restoration (0.5.63)

The reported outdated-looking UI exposed a reproducible packaged-only issue:
manually opening Properties and Outliner did not survive a full cold reopen.
Code-OSS 1.138's built-launch layout policy substitutes its default Explorer for
a saved non-default sidebar (development and Reload Window do not). The kit now
captures the native saved container before restoration overwrites it and opens
that container through the native view service after restoration. It adds no
layout store, product-specific ID or forced view visibility. The rebuilt macOS
workbench passed five cold-reopen checks, including preservation of a deliberate
Source Control selection. Its complete anonymous download matches the pinned
SHA-256. Source comparison found the
recent Blender header/menu/icon/style fixes already present; the user's other
missing visual changes have not yet been identified.

The same candidate upgrades Storybook to 10.6.0, verifies its real portable
story and ordering APIs and requires Node 24. Its repository and initial packed
install audits reported zero vulnerabilities, resolving the advisory in the
published release below. That packed probe predates the material changes and
does not establish acceptance of the new renderer. The final packed install also
reports zero vulnerabilities.

### Final 0.5.63 packed acceptance

All 72 tests, eight package typechecks, the build, release-boundary check and
1,086-file packed-import check pass. The exact eight archives install without
workspace links or a WASM override. Python/RNA undo/redo, Essentials restoration,
five persisted duplicate/delete/history cycles and five full cold reopens pass.
The final run has no unresolved or acknowledged diagnostics. Earlier attempts
exposed readiness assumptions in the harness (panels mounted before their fields
loaded); bounded UI readiness checks corrected the harness, not the product.

Making the disposable model directory read-only made both edit and close refuse
EACCES while retaining the live worker. Restoring mode 755 allowed the pending
X=12.625 to save and survive reopening. Closing during a two-second Python edit
waited 2,396 ms; reopening retained X=14.625. Real stdio MCP then opened the closed
editor and read that model and its Essentials modifier, with a silent console.

Packed GPU checks passed physical inputs, tangent/object-space DirectX normals,
first/eighth/missing named UVs, Repeat/Clip and edit history. Homogeneous volume
absorption measured 163/255 versus clear 255/255 at the center. A blocker reduced
spotlight scattering; point-light scattering disappeared when energy was zero,
apart from an observed maximum one-code-value residual (not exact black parity).
All probes restored their temporary edits and ended with a silent console.
An inspected settled capture shows populated Cube Properties at X=14.625,
Outliner, grid and the retained material probe.

### Public 0.5.63 installation and acceptance

All eight immutable archives are public and every registry digest matches.
Fresh-cache creation installed 436 packages with zero audit findings, no links
and no npm or GitHub credentials (including no `gh` login fallback). The product
automatically downloaded the new public workbench and verified its checksum.
Registry installation metadata and GitHub asset listings initially lagged their
direct endpoints; those attempts refused and were retried after propagation,
without replacing any archive.

The public install repeated Python/RNA and structural history, Essentials and
five full cold-reopen checks including Source Control selection. Failed-save
recovery preserved X=12.625; close during a two-second edit waited 2,424 ms and
reopen retained X=14.625. Cold stdio MCP read the saved scene and Essentials.
Missing named UV rendering and undo passed. Final capture was inspected: selected
Cube, grid, Outliner, populated Properties at X=14.625 and Chat. The final console
is silent with no acknowledged diagnostics in that session.

The initial public launch's zero-size canvas sample was acknowledged only after
visible capture and healthy current rendering at 120 fps. The credential-free
test PATH also hid the separately installed Claude runtime; its warning was
recorded, and normal PATH restored before the final acceptance. Neither initial
warning is claimed never to have occurred. The current editor is left open for
the owner; other task probe sessions are closed.

### Renderer-hang diagnostics (included in 0.5.63)

The original public acceptance log shows no receipt for `blender-stop`;
the page was already failing to pick up commands. That does not establish
worker shutdown as the cause.

Contributions can now announce bounded, operation-only work through the host.
Blender reports worker requests, Model-frame application and runtime release
before entering them. Overlapping calls have distinct lifetimes. The existing
heartbeat carries these labels even while the page is blocked; `status.pageWork`
is server-held rather than a stale page snapshot. Sequence stamps prevent
the heartbeat's delayed copy from resurrecting completed work. Neither request
payloads nor Python code are included, and diagnostics cannot fail teardown.
Labels are observations, not stack traces or claims about the cause.

Seven new tests cover nesting, duplicate labels, reporter failures, request
cleanup, transport ordering and heartbeat delivery without a page callback.
A disposable live probe blocked Model-frame application for four seconds:
the server named that operation throughout the block while heartbeat ages
stayed below one second. It recovered, undo restored Cube X=84.125, and the
console was silent. Fifteen instrumented edit/history/restart cycles passed;
a separate sequential run passed fourteen with Properties explicitly open,
six objects retained and silent consoles. Its fifteenth was interrupted by a
page close beacon and disconnected channels, not a beating unresponsive tab.
Reopening recovered the saved model; the isolated four-second diagnostic
probe then passed again on the final build, restoring X=84.125 and clearing
the work label. Other interrupted attempts (a build replacing live worker
assets, and accidentally overlapping probe drivers) are not counted as passes.
All 48 tests, eight package typechecks, the build, release boundary check and
1,083-file packed-import check passed. These are diagnostic and recovery
proofs, not a reproduction or fix of the older intermittent hang.

### Unresolved observations and release limits

- **The intermittent unresponsive-renderer observation remains unresolved.**
  Packed and public 0.5.58 acceptance encountered a worker stop/restart timeout
  while the renderer stopped answering. Full editor reopen recovered saved
  data. Native sampling did not establish a source-level cause. A 12-cycle JS
  profile found no hang (longest recorded frame 689 ms in viewport rendering);
  profiling itself increased startup latency. Numerous later comparisons,
  including 20 selected-object cycles on the old build, did not reproduce it.
  The last old-build comparison encountered disk exhaustion instead; moving
  this task's retained npm cache to the internal disk restored capacity and a
  subsequent model save succeeded. None of this proves the old renderer stall
  fixed. The separately reproduced cold-start deadline race is diagnosed and
  corrected, not substituted as an explanation for that observation.
- Fresh anonymous 0.5.62 installation reported four moderate dependency entries
  through Storybook and `@vitest/mocker`
  ([GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9));
  zero high/critical entries. Release 0.5.63 resolves those entries; both its packed
  and anonymous public installations report zero vulnerabilities. This is the
  installed product audit, not a claim about the workbench's build-only toolchain.
- Existing project filenames and protocol/settings identifiers remain unchanged.
  A full rename is a separate migration. Game publication and full viewport
  extraction remain outside this release. Emscripten is shipped; optional WALI
  requires external artifacts and is not a shipped browser-substrate claim.

### Model-to-UI authoring reload, 2026-10-06 (unpublished worktree)

The retained game replay still showed two opening reloads. The first was Vite
discovering `typescript` and `axe-core` only after a running model-only project
declared React/UI tooling; the second was an explicit `editor.reloadPage()` in
the original agent transcript. Connection recovery did not prevent either.

The packaged host now prepares those two installed browser-tool utilities in
its initial optimizer pass. A fresh gray-cube project then received the UI
dependencies, UI manifest root, adapter story region and five HUD stories while
open. The UI canvas rendered all five states without a reload: the same tab
`0f18783c` remained at page generation 1, with no current console errors or
warnings and no story failures. Its server log has no optimizer reload.
Receipts and the inspected capture are retained in this worktree under
`.volter/reload-prevention-20261006/`.

The generated AGENTS.md tells future authoring sessions to use normal file
watchers and inspect the current document rather than reload to reveal source,
UI boards or references. This guidance cannot change reload calls already in
a recorded transcript. A faithful replay retains those deliberate calls.
The editor host and project instructions contain no replay-specific behavior.

The server build and diff whitespace check passed. Core typechecking stops at
the unchanged `vite-plugin-shared-sdk.ts:34` nullability error (`module.exports`
may be null); the same expression is present in HEAD. No automated tests were
added or run for this follow-up. Arbitrary new third-party dependencies can
still require a new optimizer generation; this check covers the observed
model-to-UI tool activation, not every possible package installation.

### Fresh kart authoring cycle follow-up, 2026-10-06 (unpublished)

Cycle 1 remains an unsuccessful smooth-workflow check: the agent recovered a wrong
reference mount path, Unicode export lookup, model worker ownership, a material-preview
exception, excessive rendered material ranges, and one crashed renderer. The parent
reopened the saved project after that crash. Native conversation identity recovered;
recording has an explicit capture gap. Its visual match still needs improvement.
No replay-specific behavior was added to the editor.

Generic candidate fixes now use UTF-8 for the native export JSON door, serialize
opening another saved model after draining/saving its worker, scope dot-directory
watcher exclusions to the project root, and enable existing bounded opaque material
range grouping in rendered mode. MCP/starter guidance names the actual project mount
and recommends batched Blender geometry operations. Removal diagnostics compare
Blender session IDs so renaming does not claim deletion.

Manual probes retained under `.volter/kart-cycles-20261006/` establish: a newly
saved second blend appeared and opened without reloading, with zero console errors
or warnings; Unicode bullet/accent/CJK/emoji object and mesh names export and display;
400 alternating opaque faces group to two ranges (398 ranges saved, 9,600 cached
index bytes) in rendered mode, with an unchanged 1,200×350 interior pixel crop.
The combined rename/material probe also reported React #177 twice. Those errors
were retained, not acknowledged away; it is not a clean overall probe. The separate
frontend worktree fixes harness-switch registration and filters the known
account-update lifecycle notice; fresh native visual checks confirm both behaviors.

Browser, Node and editor-server builds pass. Blender-engine typechecking stops at
existing missing `session.py?raw` declarations; editor-core has the previously
recorded nullability failure. No automated tests were added or run for this follow-up.
The cycle loop and recordings remain ongoing; none of these probes counts toward
its required five fresh native game-authoring cycles.


## Cycle 2 recovery continuation

Full editor close interrupted the native author and a null durable native binding
caused a fresh native conversation on reopen. Host-verified rememberSession bound
the exact original native ID, and ordinary close/open then resumed it. The private
frontend now saves during submitted and observed turns; the fresh automatic path
still needs manual interruption verification. Frontend build and docs check pass.

The Blender hold diagnostic found an absent context even though the public REPL
had earlier observed the same registry's valid runtime view. A remounted same-file
pane queued its publication behind the still-booting open that needed it. The
candidate publishes the current worker's same-file replacement before that queue,
and SDK publication cleanup now identifies its own publication rather than a shared
live handle. The previously failing Cycle 2 scene now opens and Blender status
reports started/document true. This is one recovered saved-scene check, not a claim
that all crashes or general smoothness are resolved. Long restored chat history
still emits Code-OSS listener warnings/errors; these remain in the console ledger.

Macro-task document updates and one-shot capture resource cleanup build and have
limited small-scene manual checks. The context-wait diagnostic also yields when an
incompatible context already exists, avoiding a timeout-long microtask spin. The
no-context case, not an incompatible object, was observed in Cycle 2.

Cycle 1 encoded video sampled visual review is complete: 64 opening and 64 timeline
samples in addition to source frame review. Normal-speed recording runs 2548.083 s;
8x derived from that video runs 318.5 s. Capture errors and a final 103.376 s image
hold remain visible and documented. Cycle 1 fails smoothness and full visual match.
Cycle 2's original native author resumed with a disclosed infrastructure intervention;
only one game authoring cycle is complete. The five-cycle goal remains active.


## Continued recovery checks and fresh Cycle 3

The fresh persistence probe saved its exact native ID while busy and restored that
same ID after a full owned close/open without manual binding. The native turn was
aborted by closing; its original prompt and tool-abort result remain displayed.
The probe exposed setup turns shown as user messages. The generic display loader
now omits only Codex user messages explicitly tagged entirely as agents_md.instructions
or environments.environment_context. Raw and continuation loading are unchanged.
Headless loadSession forwards a read view through its verified full-locator lookup;
the editor requests bounded display history. A coherent private CLI/client/TypeScript
SDK recovered the same conversation with its human prompt and tool result visible,
no setup block, and zero console errors/warnings. Prior binary-only runtime failure
and an intermediate missing-locator failure remain in probe receipts. Rust build,
formatting, editor Node build and documentation checks pass; no tests run.

Cycle 2's original author completed a live three-lap race; parent observation saw
all six finish. Its renderer disappeared again at 06:15:54.950 UTC with last JS
heap 329.49 MB, WASM 512 MB and no in-flight Blender call/close beacon. Cause remains
unproven; one-shot capture cleanup did not eliminate it. A retained recording
segment lowers capture to one image per five seconds. This is a capture limitation,
not accepted smoothness. Cycle 3's clean placeholder project opened but empty-to-Codex
selection still produced a native content-provider error and lost prompt dispatch;
no game authoring turn started yet. This opening is retained as another failure.

## Six-cycle continuation, 2026-10-06

Five fresh native authors have completed. All five original-speed videos and the
8x videos derived from them pass full decoding and timing checks. Every encoded
opening and timeline contact page was inspected. All five cycles fail smoothness
or full reference match; none is accepted merely because it completed a race.
These editor recordings use timestamped screenshots, with capture errors and held
gaps preserved. They do not establish continuous gameplay fluidity.

Cycle 6 is authoring in a fresh project with all Volter packages privately
snapshotted. Its first opening and native prompt dispatch had zero console errors
and one browser epoch. Keep its private source and workbench immutable until the
session closes. The active cycle and exact native IDs are tracked under
`.volter/kart-cycles-20261006/cycles.json`.

After the earlier projects closed, the reviewed key latch, Play return ownership,
game CSS host scope, bounded file streaming and passive native startup candidates
were transferred into this worktree. Actual editor-core server, Blender serving
and model browser builds pass. No automated tests were added or run. A disposable
manual file fixture verified a stale index, append-after-response-headers with
actual wire EOF, and Blender importing while the file grew through 109 appends.
The worker opened the cube with zero errors or warnings and one browser epoch.

Restoring Cycle 4's exact completed conversation now produces nine canvases,
compared with 175 before the tool-history display change. Its saved native bytes
are an exact prefix of the current transcript; reconnection appended one settings
event. A startup No default agent error remains in that recovery receipt. This
does not establish the cause of the earlier renderer losses. Model projects still
lack the game editor's public continuous gameplay recording commands.

Cycle 6 exposed a separate generic timeout: its 6.5-second key hold exceeded the
document-probe relay's fixed five-second budget. The relay now adds a validated
explicit key duration to the ordinary probe budget, retaining fast reads. Holds
are bounded to 120 seconds, with invalid durations refused before keydown and
keyup in a finally block. Core server and model browser builds pass. A disposable
public control walk verified a 6.5-second hold, a subsequent new press, and refusal
of an oversized hold with the visible React counter unchanged; zero console
errors/warnings after corrected fixture setup. The observer's two fixture setup
mistakes are retained separately.

Cycle 6's later full reload has an identified trigger: creating tsconfig.json at
08:33:21 UTC caused Vite to reload. Project creation now writes the shared compiler
configuration before boot. Node build passes, and a fresh native-ready project
contains the configuration in its 12-file baseline. Its live authoring check is
still pending; existing Cycle 6 packages were not changed.

Cycle 6's native author completed at 08:53:11.666 UTC. Its renderer disappeared
about 29 seconds later; public reopening restored the exact original idle native
conversation. Parent autoplay independently finished all six racers and all 24
ordered checkpoints, and manual acceleration, braking to zero, exact pause and
a fresh ready grid were observed. Reverse was not independently verified. This
cycle still fails smoothness and full visual match. No renderer-crash cause is
established, and all failure receipts remain retained.

A parent public-document MediaRecorder walk captured the world canvas at its
original speed. It excludes DOM HUD, editor chrome and audio. All six encoded
contact sheets were reviewed, precise decoding emitted no diagnostics, and the
normal video was actually sped up to 8x. Half-second frame gaps lined up with
concurrent five-second full-editor screenshots. A second moving clip after
stopping screenshots had 575 frames and a 70 ms maximum interval, versus 496
frames and a 935 ms maximum (513 ms during racing) with screenshots. All six
second-clip contact sheets were also reviewed. This supports an observer effect
for frame delivery in these clips, not a renderer-crash explanation. An invalid
parent selector and its resulting static clip remain in the evidence.

Cycle 6's full editor recording ended with 666 sparse images and 20 capture
errors. Original timing includes the shared-capacity pause and renderer-loss gap;
the 1x export decodes completely and differs from source timing by 2.7 ms. Older
closed cycles' frame archives were moved to PeakSSD only after full byte/SHA256
verification, with logical paths preserved. No other actor's files were removed.

Cycle 7 now runs a fresh native author from the private typed-starter snapshot.
Its 12-file baseline includes tsconfig before boot. Opening had zero console
errors/warnings and one browser epoch; the first prompt is verified busy in its
original native conversation. Its sources and workbench remain immutable while
the author works. The additional visual feedback names the actual previous
lighting, canyon-shape, camera and UI-preview gaps.

The shared-capacity peer paused Cycle 7's owned screenshot consumer at
09:16:51.989 UTC. The native author and editor remained live. Completed Cycle
2/4/6 media was copied to PeakSSD and every file's byte count, SHA256 and inventory
verified before original paths became symlinks. Cycle 2's shared image hardlinks
were preserved. Actual local free space recovered to 22 GiB and the owner resumed
the exact recorder PID through the World; frame receipts preserve a 216.911-second
pixel gap. No other actor's World, cache, worktree or process was changed.
If another fresh cycle is needed, its screenshot directory should be allocated
on the evidence volume before capture starts, with the same logical project
path. Do not move a live recorder's directory underneath its open writes.

Cycle 7 exposed two source-opening problems in the public editor doors. The
generic asset opener previously allowed a `.blend` when an explicit asset kind
was supplied, bypassing its Model document. The SDK now refuses that form too,
and starter guidance uses `editor.open('model:<path>')`. The editor-live build
passes. An idle disposable fixture verified refusal without changing its
document, selection or camera, then opened the suggested Model ID successfully.
That fixture's existing No default agent startup error was retained; its public
close completed gracefully.

Opening Cycle 7's React HUD source also invoked its default component as an
Object3D builder, producing an invalid hook call. Source opening now consults
the actual manifest root entries and loaded adapter region declarations before
calling a candidate model builder. Declared DOM/canvas files remain readable
source; unplaced modules retain the Object3D contract. The model browser build
passes in 31.76 seconds and the editor-sdk TypeScript check passes. A separate manual public SDK walk opened a DOM root
using useSyncExternalStore, a declared include using useState outside the UI
folder, and an ordinary Three Object3D builder. Both components showed their
source, the builder showed its cube and model inspector, and all three had zero
errors/warnings/acknowledgments. Screenshots and receipts are retained under
`.volter/kart-cycles-20261006/probe-key-hold/`. All three screenshots were inspected
and the fixture closed gracefully. No automated tests were run.
Cycle 7's private packages remain unchanged, so its original errors remain
part of that cycle's evidence. A later renderer frame error was also retained;
the loop and same browser epoch continued, and its cause is not established.

Cycle 7 completed at 10:05:53.397 UTC. One renderer loss required reopening the
same native conversation. Public crash vitals show 388.97 MB last heap, 512 MB
Blender WASM and no in-flight Blender call; they do not establish the cause. An
owned auxiliary UI fixture was open in that interval, so Cycle 8 will run without
one. No initial pair of reloads occurred. Parent fresh autoplay finished all five
racers, cleared/parked them after the line, and observed all 24 player gates and
three laps. Public pause held an item, exact race time and all racer positions
for over 16 seconds. Manual acceleration, braking to zero, hopping, item use and
restart were observed. An observer durationMs/holdMs mistake is retained and was
repeated correctly; manual race completion and reverse were not proved.

The final public UI-canvas walk selected Ready with seven preview states and no
mount/story failures. A separate before-boot DOM-root fixture also selected Ready
when Countdown was first; the earlier default-selection issue remains unresolved,
so no speculative production change was made. The final game remains simpler
than the reference in canyon/cloud shape and sculpted kart details. It fails
smoothness and style acceptance.

The full editor recording ended with 736 sparse images, 21 errors and retained
216.911-, 30.318- and 108.461-second missing-pixel intervals. Its 1x video fully
decodes and differs from requested timing by 18 ms. After stopping screenshots,
a separate 24.003-second moving world-only clip was recorded; 576 frames decode,
with 51 ms p95 and 57 ms maximum intervals. All six contact pages / 96 samples
were viewed. The world-only 8x video is derived from the normal encoded video,
decodes and lasts three seconds; it excludes DOM HUD/editor/audio. Cycle 7 then
returned to a fresh manual grid and its public close completed gracefully.

Cycle 8 is prepared from a private all-package snapshot of the compiled generic
source guards and all earlier fixes. Its frames directory was allocated directly
on PeakSSD before any capture, with the logical project path retained. It has not
yet been opened or dispatched. The author prompt includes precise visual feedback;
the parent still does not write cycle game code.

Cycle 7's actual-derived full-editor 8x video passes decoding and timing at
502.291667 seconds, 12,055 frames and -10.4 ms timing error. All four opening
contact pages and seven timeline pages were viewed (64 opening / 100 timeline
samples), plus the final encoded frame. The opening shows the new placeholder
and then the actual prompt, without a pair of reloads or recovered transcript.
The later renderer recovery is visible. The finalized frame archive was moved
only after every file's SHA256, size and inventory matched; it preserves logical
paths and contains 978,796,618 bytes. Cycle 7 is reviewed-failed; seven authors
have completed, and none is accepted as smooth. Cycle 8 opening has now begun.

Cycle8 independent review failed: interrupted native verification, late renderer replacement, finish overlap, retained parking lanes on restart and incorrect Countdown/three-racer UI fixtures. Native original transcript preserved; no final completion claimed. Full1x/actual8x and world clip fully decode/timing pass; all17 contact pages plus encoded final frame viewed. Video ends on UI canvas, finalReady separate PNG only. Root Play chrome/async sampler build23.80s and corrected Blender typecheck pass; manual verification pending.

Manual public comparison PASS after correction: previous packages36 missing-image warnings on first Play and visible shelf; corrected root first+repeat Play0 new missing-image warnings/0 errors/0 acknowledgements, shelf absent, public Stop button retained; both Stops restore5 tools, same public viewport camera. No-extension plain Models control5 tools/noPlaybutton preserved. All relevant screenshots directly viewed. Startup warning1 retained; selection was empty, so selected-object restoration was not exercised. SDK typecheckPASS and browserbuild16.71s. Owned fixture gracefully closed. Final recorder fixture9frames ends on actual stopped Model; requested1791288131746/completed1791288131913 before end1791288131916, lastPNG directly viewed.

Cycle9 native author started from fresh12-file Models preset and20 private current packages, originalsession01a1111a-4f9a-7ea0-bc54-b4f84b1f562c. Ready cube/zero errors+warnings/one epoch verified before actual Ask prompt. Recorder23646/PID82212 .2FPS/direct external; no auxiliary editors/builds. Prompt includesC8finish-overlap, restart lane, Countdown/five-racer fixture and manual handling feedback. Active snapshot immutable.

## Reference interpretation and visual-first defaults (2026-10-06)

User clarified that reusable failures belong first in the owning engine/editor, otherwise in default agent guidance, and that the task prompt should stay short. Repository AGENTS.md records that iteration policy. Model Editor starter AGENTS.md now derives requirements from actual images, videos, specs, linked sources and existing assets, distinguishes observations from assumptions, and requires a static authored 3D scene plus React UI reference match before new gameplay. Comparisons cover framing, geometry, palette, lighting, display color space, exposure and tone mapping. Generic restart, complete-session, active-pause, sustained manual-input and deterministic UI-preview checks are default guidance. CLAUDE.md continues importing the shared file.

The next-cycle user prompt is fixed at 18 words in .volter/kart-cycles-20261006/next-user-prompt.txt. Historical prompts and live/private cycle packages were preserved. Manual calls to the real product preset created fresh Models and Playable projects inside the owned World; both copied the exact updated defaults and CLAUDE import. No editor was opened or AI turn dispatched for this check. These are instruction and scaffold delivery changes, not proof that a new author achieves visual convergence. No automated tests or runtime changes were added for this follow-up.

## Capture diagnosis after cycle 9

Cycle 9's original native author completed; parent autoplay independently finished
and parked all five racers with 24 gates and three laps, and actual Restart
restored the full initial grid/counters. The planned uninterrupted second race
was not observed because the original page closed with an explicit close beacon.
Recovery preserved the original native session; the cause of closure remains
unknown. Visual fidelity still fails. Parent pause-with-item and all UI previews
were not independently verified. Native claims remain distinct from parent checks.

The five-second full-editor PNG recorder caused roughly 317–333 ms gaps in the
original C9 A/B, while capture-off had no >100 ms gaps and a 25 ms maximum. This
capture is DOM/canvas reconstruction, not CDP or desktop capture. A closed-scene
fixture reproduced up to 493 ms gaps. The owning editor capture code now avoids
duplicate megapixel encoding for the Three host viewport, skips invisible retained
canvases, respects ancestor overflow clips and encodes final PNG in an owned
worker. Initial async-only candidates did not solve the problem and were rejected.
Manual image checks, SDK typechecks, browser builds and diff checks passed.
Warm screenshot completion reached 355 ms, but active-race full-page DOM/SVG
reconstruction still caused 141–142 ms gaps; capture-off again measured 25 ms max.
Do not claim smooth capture or blame the earlier whole-machine freeze on this
proof. All probes/editors/recorders are stopped; private author packages preserved.
See .volter/kart-cycles-20261006/probe-async-capture/REVIEW.md and raw receipts.

Cycle 9's preserved full-session segments contain 1,059 successful source images
and 210 capture errors. Their original timing, resize failures and page-closure
gaps are retained; varying window dimensions are letterboxed at export only.
Media review and the next reference-first cycle remain pending.

## Cycle 9 review and capture scope (2026-10-06T15:02:56.451525+00:00)

Cycle 9 is closed and not accepted: visual match fails; parent all-five finish and
actual Restart reset pass, uninterrupted second race/manual/held-item Pause remain
unverified. All 1060 decoded editor frames reviewed; both 1× and actual derived
8× decode/timing pass, errors and gaps preserved. Canvas clip reviewed separately
with its HUD omission explicit. Full-page capture worker/clip improvements still
leave 141–142 ms running-race stalls. Capture scope documented in SDK README and
project defaults. Videos retained and linked from watch-recordings.html.

## Continuous visible authoring defaults (2026-10-06)

The user requires the work to remain understandable to a person watching while
it is being built. Starter AGENTS now requires opening and framing the current
work before edits, useful model/detail/reference/UI/Play views throughout the
task, and preserving deliberate human layout changes. Substantial work keeps
an internal Blender `Build Notes` Text data-block and readable in-scene notes
with current, pending and timestamped verified milestones. Procedural rebuilds
preserve Notes alongside References. Notes must be checked outside actual
game/render/export output, rather than assuming hide_render covers every path.

Both real Models and Playable preset calls copied the exact new AGENTS and
CLAUDE import. Unopened fixtures and receipt live at
.volter/kart-cycles-20261006/visible-authoring-defaults/. Cycle 10's original
native author completed; a distinct native follow-up now applies the user's
visibility/notes request using the updated defaults. Original baseline
instructions, short task prompt and references remain archived. Visibility and
note persistence/exclusion are still awaiting direct inspection of that phase.

The original native follow-up completed at 16:09:45 UTC. Parent directly inspected
the final editor view: readable timestamped checklist and reference on the left,
focused karts on the right. Native evidence records text roundtrip persistence,
fake-user retention and GLB exclusion. The instructions remain authoring guidance;
this retroactive setup is not proof of continuous compliance in a fresh build.

That author exposed a generic engine bug: Rendered editing views incorrectly
applied hide_render. Blender runtime/editor now keep viewport visibility for
authoring in every shading mode and explicitly select render visibility for the
detached game, including preparation. Actual render snapshots still select
render visibility. An owned closed fixture directly verified readable Rendered
notes, their exclusion from a real bpy render, restoration afterward, ordinary
game/HUD Play and restoration after a fully completed Stop. Public camera,
selection and shading were retained. Renderer/SDK typechecks and browser build
(43.85s) passed. Full editor-core typecheck failed in harness client declarations,
project-work-coordinator and shared-SDK nullability; it is not a full-check pass.
One startup error retained, zero new Play/Stop errors and no acknowledgements.
Raw limits and premature capture/file-transfer mistakes are retained in
.volter/kart-cycles-20261006/probe-notes-visibility/REVIEW.md. A viewport capture
was initially mistaken for a final render; SDK docs now distinguish that too.
Native split-area Stop/FOV observation is separate and not yet reproduced/fixed.

Cycle 10 was subsequently closed through its own public CLI (graceful, exit 0),
after verifying idle author/no pending requests and the saved 20,422,015-byte
model. Exact PID 12859 and its listeners exited. A peer reported repeated costly
session discovery and machine slowness; source confirms four-second idle polling.
Its cost needs investigation before another fresh build. No new editor/build was
started for this step. Receipt and peer delivery record live in the cycle evidence;
this closes the completed editor, without accepting the still-incomplete cycle.

Idle discovery correction: ordinary indexed project sessions now use Supercode's
existing controller subscription, without Volter's repeated scan/fingerprint/
second refresh. Legacy clients and explicitly linked caller sessions retain a
60-second idle-only refresh through the controller, instead of the 4-second
scan-then-refresh pair. Explicit Refresh remains immediate; workspace changes
and closure cancel fallback timers. The legacy/caller fallback does not prove
cross-workspace caller retention by Supercode's workspace index; that coverage
still needs independent review before claiming complete external-session support.

The workspace UI dependency could not resolve its optional client peer: the
locked 0.3.66 client was nested under editor-core. Declared that same version as
a root development dependency and installed offline with scripts disabled;
lockfile now hoists that existing exact package. This resolved the harness and
coordinator type errors. The remaining shared-SDK plugin nullability was fixed
by skipping modules without an exports list. Core typecheck and server/plugin
builds passed before the final compatibility fallback change; final source is
being rechecked. Manual isolated service exercise uses the installed real
SupercodeController with a synthetic inventory, not an editor or AI author:
session-discovery-review/receipt.json under the cycle evidence. It verifies idle
and tab-load scan suppression, indexed add/update/remove, explicit Refresh,
index release, and automatic legacy fallback with timer cancellation. The first
manual receipt's strict subscription-count check ran before asynchronous
replacement settled; that failed receipt is preserved. The corrected check
waits for settling and verifies no remaining active subscription identifiers.
No new fresh cycle has been launched; continuous visible work and matching the
reference before gameplay remain unverified in a fresh build.

Final discovery source check: editor-core typecheck passed (exit 0), packaged
server rebuild passed, and the plugin build passed. Final manual receipt passes
all three service cases with zero active subscriptions after Close. Diff check
passed. The public editor remains closed. Read-only uptime still reported load
averages 12.89/12.00/15.68; that is machine evidence, not attribution to this editor.
Remaining before a fresh cycle: split-viewport Play/Stop camera restoration,
root/dependency entry-deletion lifecycle review, and scoped external-caller index
coverage. Notes/reference defaults and actual render exclusion are already checked.

Continuation verification: split authoring Play/Stop reproduced the 38-to-71.5
degree jump. Explicit setPose wrote only the current camera, leaving resize to
reuse the old field-of-view source. The shared Three viewport now updates that
source; document camera requests also record their explicit lens in the view's
presentation, and shell camera actions go through the same session setter.
Three typecheck and browser build passed (17.88s). Manual two-area fixture
restored main pose/FOV/selection/shading exactly and retained the second area's
presentation; before/after PNGs were directly inspected. A comparison of whole
presentation responses initially included timestamps/bound-stage inventories;
only actual presentation settings are the restoration comparison. The original
baseline visibly shrank notes; fixed output preserves their readability.

The pending entry-deletion lifetime candidate now passed a real public editor
exercise: removing the Play entry stops Play/disposes HUD, restoring it plays
again, removing a dependency reports the missing module without treating it as
entry removal, and restoring the dependency recovers. No page reloads (one epoch),
files restored, final Stop complete and public CLI close graceful. Missing-module
errors are retained and unacknowledged. Evidence lives in play-module-lifetime/.

External caller review confirmed the pinned Supercode workspace index removed an
explicitly included caller from another folder. Owning fix is in the existing
isolated supercode-replay-recovery-20261006/sdk/client/client.mjs: replacement
removals apply only to rows in the index's workspace. Manual review passed with
that real owner-source controller and a private same-fix candidate of the exact
installed 0.3.66 client. Both preserve the caller, exclude unrelated sessions,
still remove a stale in-workspace row, and release subscriptions. No shared
package modified, native session/store written, or package published. The private
candidate records original/candidate hashes and source provenance; next cycle
uses that immutable candidate without downgrading to the owner checkout's 0.3.60.
No automated Supercode tests were written or run. All editor fixtures are closed.

2026-10-06 cycle 11 supersedes closed-editor guidance above. All three pending
checks completed: main split-camera 38-degree FOV now preserved across Play/Stop;
entry deletion stops Play/HUD, dependency restoration recovers in one page epoch;
Supercode scoped index preserves explicit external caller and removes stale local
row. Read WORK.md and split-play-stop-fixed/REVIEW.md for evidence/limits.
C11 fresh native author dispatched at 1791306898637, original unchanged prompt.
Project cycle-11/project; URL http://127.0.0.1:20414/?project=project. Native
01a11232-d954-7f62-9c88-1e938fec2999, connection
2f829fb9-6240-4e42-b708-f9d019edd7ac. Immutable private snapshot on PeakSSD
source-snapshot-visible-authoring-scoped-client-20261006 and private pinned
0.3.66 scoped-index candidate; runtime-candidate.json owns paths/hashes.
No periodic full-page recorder. Baseline and opening-author PNGs directly viewed;
startup secret-storage Not Found retained, no reload yet (one page epoch).
Nine completed authors/zero accepted remains until C11 actually completes.
Parent must monitor continuous human-visible static/reference/UI-first compliance
and independently review visuals/gameplay. Do not edit private live snapshot.

C11 first substantial canyon capture at17:19UTC: one healthy page epoch; scene
visible, reference and notes offscreen. Parent directly inspected
cycle-11/canyon-static-stage.png. This fails continuous human-visible compliance
although the assets are present in the Outliner. Native continues unchanged;
no parent correction prompt/game authoring. Default AGENTS now adds an explicit
pre-build captured layout check plus a second authoring view when the target
camera excludes references/notes. This new default is for future projects, not
an unrecorded modification to live C11.
SDK unchanged-styles capture cache prepared and manually checked; see
style-capture-cache-corrected/REVIEW.md. Root SDK typecheck/browser build passed;
fixture closed. C11 serves older immutable snapshot, so this optimization is
not in C11. No claim remaining game/capture stalls are all solved.

Live-run evidence owning fix: shared SDK status now reports the live registry's
successful run window. Core observes a new valid run since the current project
was opened and retains logs/live-run.json; the canonical freshness reader uses
its recorded observation timestamp, never a later file touch. No document,
product or replay knowledge. Actual C11 logs incorrectly escalated to NEVER
ONCE PLAYED after its static composed Play had run three times, confirming the
previous recording-only evidence gap. New root candidate is not in immutable C11.
Core/SDK typechecks passed; packaged server build passed; browser build35.05s
passed with existing nonfatal bundler warnings. Final SDK public type field
check pending13315. Owned idle fixture public UI review live-run-evidence/receipt.json:
first successful Play recorded; repeated status/Stop did not rewrite evidence;
first-frame throwing game stayed stopped and did not manufacture new evidence;
restored entry's next successful Play produced a newer run. Original source
restored, final Stop/CLIclose graceful, expected failure console retained.
Next defaults add pre-build visible-layout capture and actual comparison artifact
with largest remaining mismatches before gameplay. Models and Playable fresh
scaffolds exact defaults and shared CLAUDE import verified, SHA
864ebf01d4e3a3611a1c228052b106bf11175a4d7d2126d0f3bd775b2bf98db8.
C11 parent directly viewed author static-refined and UI-start images; visual match
is still insufficient (geometry, light, scale). Native progressed to gameplay
anyway, a visual-gate failure. Parent observed six finished/stopped at17:34UTC,
parent-race-observations.jsonl, not yet a parent full-race/restart/control check.
Native author still active. No original prompt changes or parent game source edits.

2026-10-06 18:08 UTC continuation supersedes C11 active guidance: native author
completed17:50:34.312Z; independent review in cycle-11/parent-review.md. Actual
public inputs verified Restart, exact pause with boost through W/Space/T, Resume,
fresh full three-lap autoplay race/all six stopped/stable, manual forward and
reverse, opposing steering, boost consumption and settled Stop/Play Ready.
Retained failed helper receipt: incorrect left-heading convention and transient
No HUD during remount; separate settled return review passed. No full manual
race or Mario Kart handling equivalence claim. Two racers show46 collisions.
Directly viewed Ready/Pause/Finish/full editor. Still visually insufficient;
reference/notes offscreen during build. 10 completed authors,0accepted across11
started. Closed C11 via public CLI,11,273,576-byte model retained. No videos
deleted; C11 original native transcript retained, no periodic recorder/video.

New Model Play frame candidate now checked in the actual copied idle editor:
play-frame-fit-final/REVIEW.md and receipt.json. Declared aspect contained and
exact world-canvas/HUD bounds at landscape/portrait; unspecified fills document.
Generic Three surface fillContainer suppresses dock-padding bleed for composed
Play. SDK region:play photographs visible live frame with React HUD, excludes
authoring navigation, refuses after Stop. Authoring view exact/FOV38 restored.
All three PNGs directly viewed; portrait fixture UI itself overlaps (project
responsiveness remains its responsibility). Three/SDK/Blender checks passed,
browser build26.84s passed with existing warnings; final SDK run evidence types
had also passed13315. Owned fixture manifest restored/editor gracefulclose.
Earlier failed frame reviews retained. Configuration refresh stops/remounts
Play (frame-refresh-diagnostic), not a scope-query omission; not fixed here.
No live resolution-change continuity claim, no replay-specific engine API.

Starter capture guidance now chooses composed Play frame and reference resolution
for visual comparisons. Fresh Models/Playable exact defaults/shared CLAUDE import
verified without editor or AI via visible-authoring-defaults-play-frame/receipt,
SHA5f13ce8cd07d46dccf9c354d486f6add3dd2895893422a270bd1800322c1febf.
Prepared fresh20-package immutable snapshot source-snapshot-composed-frame-visible-
gate-20261006 on PeakSSD for C12. Original18-word prompt/reference unchanged;
no source/game/transcript from C11 carried into its project.

2026-10-06 later continuation: C12 original native Codex dispatched18:09:31.080Z,
session01a11267-7ea6-77f0-9ab6-b2066e06ba21, editor21000/session29474; unchanged
18-word prompt/reference, source-snapshot-composed-frame-visible-gate-20261006.
Pre-build captured reference/readable notes/placeholder together, directly viewed.
Later target-camera shots exclude notes/reference; returned authoring board shows
both again. Continuous visibility still unproved/failed at those moments. Parent
directly inspected saved static-comparison and static-final1672×941: exact reference
dimensions now; geometry/framing/kart details/shadows/map outline still differ.
parent-static-review.json records descriptive RGB MAE46.85/42.97/42.33, no inferred
acceptance threshold. Author cited shadow limitation but no focused reproduction
independently verified. New future-default sentence requires such support while
continuing authorable corrections; immutable C12 instructions unchanged. Original
native still active, fixing guardrail snag and canyon/road overlap before final
race/UI checks; do not count its claims as parent review.

Generic SDK contribution module-version fix prepared and verified after C12's
snapshot. Scans previously assigned Date.now to every contribution's React mount
key, tearing down unchanged bundled document modules on configuration refresh.
WeakMap versions now identify imported namespace instances; new imports get a new
version. SDK check/browser build19.50s passed. Actual owned fixture moving race
kept same live run ID through landscape→portrait→landscape, HUD/state retained,
simulation advanced; Stop exact authoring view/FOV38 restored. Directly viewed
paused image; original manifest restored/fixture gracefulclosed. See module-
version-continuity/REVIEW.md. Real source edit/removal review passed in module-
version-changed-source-corrected: First0→First1 click, edit→Second0, removal→noUI;
probe removed/fixtureclosed. Project-authored contribution cache-busting behavior
is unchanged; no claim every source contribution avoids refresh.
Earlier look-registration retention candidate did not keep Play and was rolled
back. Its receipts retained. First HMR probe used wrong folder/open API, was
stopped after retries; both owned probe links removed, fixtureclosed, failed
receipt retained. No source fix claiming success from that failed attempt.

Answered peer ownership inquiry via supercode-teams: this exact task tree, install,
toolchain, active World, unique source/evidence and linked snapshots remain held;
no release/prune authorization. Native C12 author and our task remain active.

2026-10-06 19:14 UTC: tool access recovered. Timing probe took3824ms despite hook error: PostToolUse ran AFTER command and hid successful result. Read hooks.json confirmed PostToolUse/Stop/UserPromptSubmit message hook. No global hook config edited. Earlier rollback DID execute: renderer source exact byte-equal saved original (SHA2ea1c69ab4b83ef1667d3f7963b4d48076e4894bfee0a8b73619ce018b1a6c5f). Root browser rebuilt32.44s from restored source. probe-shadow-extent/restoration-receipt.json; fixture graceful closed. Earlier claim rollback was blocked was incorrect. Original/small→large→small images show contact shadow disappears on enlarged floor. Rebuilt zero-bias large-floor has only faint broad shadow; candidate NOT accepted. Source restored. No general shadow-quality fix landed.

C12 native no transcript rows18:36:50→19:08:46 (~32min), screenshot parent-stalled-native.png shows Retry warnings as unsupported JSON; healthy editor/epoch1, no pendingapprovals. Normal chatCancel19:08:46 and minimal Continue19:09:31 preserved exact session/connection and recovered progress. native-recovery.jsonl and continuations.jsonl retain intervention. Cycle12state authoring-after-native-recovery, not authorcomplete or accepted. Original prompt/ref unchanged; recovery is NOT a clean uninterrupted blindcycle. Latestauthor19:13:39 checking UIpreview buttons then two final races.

Owning Supercodefrontend source sdk/frontend-vscode/src/view.ts now treats warning through existing bounded cache_warning path. Locked dependency compile passed (missing @types/vscode on first tries; npmci normal registry installed4deps into previously absent owned frontendnode_modules). Manual compiled projection receipt frontend-warning-projection.json verifies warningpart/proposal fallback; unknownkinds retainbounded raw. No automated tests, publish, shared install or liveC12Workbench changed. This candidate is NOT live-editor-UI verified.

### 2026-10-06 — cycle 12 closed; cycle 13 dispatched

Cycle 12 completed at 19:20:35.093Z. Independent public-control review passed forward, reverse, separate fresh-grid left/right steering, boost consumption/effects, pause freeze, one complete autoplay race with all six racers stopped, finish restart and Stop/Play reset. The earlier combined steering sample was inconclusive after boundary contact and remains retained. No full manual race or handling-quality claim. Visual reference match remains false. Reviewed artifacts: cycle-12/parent-review.md and parent-review.json. Public CLI close succeeded and retained the saved Blender scene.

Cycle 13 launched from a fresh baseline with the exact 18-word original prompt and approved reference. Immutable product snapshot carries stable imported-module versions and focused renderer-blocker proof guidance; rejected zero-bias shadow experiment and unverified frontend warning display candidate are excluded. Fresh original native session 01a112ae-de11-7251-98b9-c7ac12d1f10e dispatched at 2026-10-06T19:30:03.101Z. URL http://127.0.0.1:27237/?project=project . Initial page epoch 1; one recurring startup secret-storage 404 retained. 13 started, 11 completed authors, 0 accepted visual/smoothness cycles. No periodic full-page recorder; transcripts and existing videos retained.

### 2026-10-06 — cycle 13 visual gate failed; general diagnostic fix verified

Cycle 13 remains the exact original native editor session, one page epoch. Independent saved-static review: cycle-13/parent-static-review.json. Matching aspect and saved side-by-side comparison improved; cliff/kart silhouettes, material/shadow appearance, framing and oval minimap remain visibly different. Author called terrain a simpler interpretation and moved to gameplay at 19:46:03.128Z. It independently found and corrected racing-corridor cliff intersections and overlapping finished karts; gameplay review is pending original author completion.

Owning defect identified: public diagnostic material was accepted despite the API vocabulary preview. The diagnostic renderer indexed variants by the invalid name, temporarily assigning undefined draw materials; the author image-Empty diagnosis was incorrect. Public presentEditorView now rejects invalid diagnostics before any view mutation, and Object3D setMode guards its own state. URL diagnostics share the published list (also restores clay/matcap parsing). Temporary pre-draw instrumentation removed. SDK/Three typechecks, browser build14.88s and diff check passed. Actual fresh public editor fixture rejects material with camera/shading/grid unchanged; valid preview/text/packed image Empty, clay/matcap/Solid/Rendered captures pass with epoch1/no new frame errors. Directly viewed image/cube/notes capture. The first two image checks were invalid (image outside mounted project); retained and corrected in probe-diagnostic-validation-image/review. Report: probe-diagnostic-validation/REVIEW.md. All parent fixtures closed. No shadow quality fix landed; zero-bias experiment remains restored/rejected.

Default starter instruction refinement checks silhouette curvature/proportions/surface detail instead of object coverage; leaves visual milestone pending for remaining authorable differences; checks actual note words/contrast at normal view size. Both fresh models/playable defaults match SHA252b2c75c4ab77edf159a05e6eccd3a712771199581b6887dc4a474e70f7e653 and CLAUDE imports shared AGENTS. Prompt/ref unchanged. Cycle14 baseline prepared (12 files; original cube/reference), not yet launched/dispatched. Immutable snapshot /Volumes/PeakSSD/model-editor-kart-evidence-20261006/source-snapshot-diagnostic-validation-fidelity-gate-20261006 contains compiled diagnostic fix; unverified SC frontend warning candidate excluded. Ledger: 13 started,11 completed,0 accepted. Existing videos retained.

### 2026-10-06 — cycle 13 completed and independently reviewed

Original author completed20:09:16.097Z without a parent continuation. Final saved reference comparison directly viewed: visual match and visual milestone remain false. Gameplay independent review passed; initialReset=true, forward=true, boost=true, pauseFreeze=true, resume=true, reverse=true, left=true, right=true, allSixFinish=true, finishStable=true, finishEffectsClear=true, autoplayCoins=true, separateFinishPositions=true, finishRestartReset=true, stopPlayReady=true.  Minimum parked separation 5.9999999999999964m. No complete manual race/handling-quality claim. Notes/reference not continuously legible. Reports cycle-13/parent-review.md/json and parent-controls-review/receipt.json; failures retained. Ledger 13 started,4 completed authors,0 accepted. C12 closed flag corrected to actual nested closed.code receipt. C14 prepared same prompt/reference, not yet launched.

Cycle13 review bookkeeping correction: older cycles use differing completion fields; counting only nativeAuthorComplete incorrectly gave4. Retained historical aggregate11 + newly completedC13 =12 completed authors. Gameplay15checks pass; no acceptance. Initial observer screenshots caught telemetry open or first-camera/HUD transition; settled public page+Play captures directly viewed correct chase frame/opaque HUD, details closed. No new engine capture bug established by these observer images.

### 2026-10-06 — cycle 14 dispatched

Cycle13 public CLI gracefulclose retained8,008,904byte canyon.blend; all evidence and videos retained. Cycle14 fresh baseline opened onhttp://127.0.0.1:29864/?project=project and original18word prompt dispatched2026-10-06T20:13:56.637Z, native01a112d9-a986-7810-aeed-61cf0d45fd1c, connectionda1b76d8-ceb4-4871-81e0-2055b2179933. Ready page directly viewed; cube/no copied chat, epoch1, one known startup404, no pending requests. Immutable snapshot diagnostic-validation-fidelity-gate carries verified invalid-mode rejection and stricter visual/notes defaults. Same prompt/reference hashes. Ledger14 started,12 completed authors,0 accepted. No periodic full-page recorder.

Installed resumable World remains running with zero services; app and helper commands run through it. This installed volter CLI has no world app-url verb and no volter-world executable, so endpoint registration requested by current instructions is unavailable here. No second runtime version or upgrade introduced over the active World. Actual editor URL retained in runtime/ledger.

### User-directed next model trial

Once the editor workflow is totally smooth, repeat the fresh-project experiment with GPT-6 Astra at xhigh to nail the look and game. Keep the same approved reference and short request. Current native author/model unchanged. Workflow smoothness and overall visual acceptance are separate assessments: do not wait for perfect reference fidelity before the requested stronger-model trial, and do not call tooling improvements a visual success. Resolve the actual native model selection when the trial begins; no availability claim or switch made now.


## Integrate verified editor batches (owner instruction, 2026-10-06)

The owner requires routine integration into shared main so other agents can see
and reuse completed fixes. A worktree is for isolation, not delayed integration.
This batch contains the Model Editor starter/native Chat controls, shared agent
defaults, document/Play lifetime and camera fixes, module discovery, composed
Play capture, PNG encoding, diagnostics and successful-run evidence described
above. Integrate with current origin/main and verify the combined result before
merging; preserve independent release and concurrent-agent changes.

The kart trials are evidence, not an accepted finished game. Cycle 14's static
comparison still fails its visual target; the native author required cancellation
and continuation after a provider stall and has not completed. Its independent
controls review passed driving, pause/resume, boost, coins, all-six finish and
restart, then failed the observer's immediate Stop/Play read. Retain that failure
and investigate settled teardown before claiming a workflow pass. No general
shadow-quality fix or Astra trial is included in this integration.

Integration verification against origin/main caf05824: all 103 existing and
first-run tests passed through the owned World (2 session, 83 Node, 12 native
history, 6 first-run/chat). Typechecks passed for SDK, Three.js, Blender editor,
core, Model Editor, Blender engine, game editor and live editor. The Model Play
package does not declare a standalone typecheck script; its source was included
in the successful Model Editor browser build. Core plugin/server builds and
Model Editor browser/node builds passed. Ownership/publication conflicts retain
main's newer queued lifecycle and generation guards; the branch's incompatible
context wait yields and richer diagnostics remain. Main's release versions and
frontend 0.1.40 are preserved. No packages are being released in this merge.

2026-10-06 continuation: the repeated startup `Not Found` came from a browser
cookie, `vscode-secret-key-path=/_vscode-cli/mint-key`, shared by every port on
127.0.0.1. The pinned REH workbench does not own that serve-web CLI endpoint.
Forwarding the path alone cannot fix an unrelated app's cookie selecting the
wrong secret-storage provider. The editor now opens each project on a stable
hashed `editor-<id>.localhost` hostname and redirects legacy document URLs there.
The proxy, launcher and tab identity use the same URL. The origin guard accepts
localhost subdomains and still rejects remote lookalikes. Existing cookies are
untouched; browser-local profile settings begin at the new origin, while native
AI login remains owned by the harness and workspace state by the project.

The public CLI focus check exposed another reload: `tab-refocus` replayed the
launch URL, while the live page had already redirected to its workspace URL.
Ready project tabs now receive a focus event without navigation. Launcher tabs
retain adoption. A fresh real Workbench opened with no console entries and one
page epoch; three successive `edit` calls preserved that epoch and its view.
Close/reopen reached a ready single-epoch page, but retained a distinct older
Workbench chat startup error, `No default agent contributed`; that is not a
clean reopen claim. Original failed probes and diagnostics remain at
`.volter/kart-cycles-20261006/probe-origin-focus-final/verification-receipt.json`.
World verification passed 105 repository tests, five workbench download/origin
tests, SDK/core typechecks and core server/Model CLI builds. No temporary cookie
instrumentation is included.

Cycle 14's settled teardown review passed three Stop/Play pairs (HUD removal
920–1041 ms, fresh mounts 551–823 ms); the earlier fixed-400-ms observer failure
is retained. The native author never completed after three cancellations and
two continuations. Public frontend observer evidence identified native response
WebSocket idle timeout and a server close before `response.completed`, not
editor freeze or context overflow. The incomplete game and transcript were
saved and closed. No provider setting or credentials were changed. Supercode's
caller-preservation fix is merged in PR1267, cf27eba8. A fresh cycle 15 uses the
same 18-word prompt/reference with an immutable editor snapshot and that merged
controller fix. A provenance audit corrected the packed extension's label:
the actual installed/packed VS Code extension is 0.1.31, embedding frontend
contract 0.2.7; an earlier helper incorrectly stamped the requested 0.1.40 into
BUILD.json. The owned candidate and receipts now distinguish actual bytes from
the requested pin. Its author is testing races;
visual acceptance and a complete workflow pass remain pending. Astra xhigh is
listed by the native catalog but has not been dispatched yet.


### 2026-10-06 — locate blank Local chat reveal and repair source builds

The genuine published frontend 0.1.40 connected Codex but left the native chat
on an empty Local session. The public `supercode.frontend.refreshSetup` command
reproduced `Canceled` with the empty native resource unchanged and
`setupHandoff.complete: false`. The guarded reveal command is present in the
compiled browser bundle; this is not a missing-command failure. The pinned
Workbench was built 2026-10-06T10:18:47.450Z from bcb58a166b10, before shared
main's a1825177/578ae6b5 blank-untyped-chat matcher. Its exact-focus guard treats
the empty Local placeholder as a person-selected conversation while the
frontend reports no harness focus. The existing source fix allows the blank
placeholder to match null while preserving typed drafts and existing chats.

A separate source-build defect originated in 585f71a0: the overlay removes
`extensions/vscode-api-tests` and its install directory but left its tsconfig in
the development compiler list. The overlay now excludes that compilation entry
with an idempotent, pinned-upstream patch. An isolated warm fork copy at
f16dc165c0df and the genuine frontend 0.1.40 package completed `dev.mjs`:
`compile-client` typechecked/emitted with zero errors and `compile-web` passed.
No shared Workbench, dependency installation, credentials or other actor's
checkout was changed. The candidate is an unpublished sources Workbench.

The public startup/reopen observer now checks handoff completion and the exact
selected/active native conversation rather than inferring success from console
health. Both visibility checks passed on the matched source build. Its first
viewport-preservation check sampled before Blender had loaded the initial view;
that failure is retained, and the observer now waits for the initial viewport
camera before testing repeated focus. All 15 settled checks passed: startup/reopen visible chat, clean console, one
page epoch, and three focus operations preserving both page and viewport.
Full settled verification is recorded in
`.volter/kart-cycles-20261006/probe-real-frontend40/verification-receipt.json`;
the origin receipt is `origin-refresh-reproduction.json`. No game sources were
edited and no new chat matcher was duplicated.


### 2026-10-06 — source browser product matches the framed server

Preparing the fresh Astra trial exposed a source-only startup difference: the
browser fallback in `vs/platform/product/common/product.ts` still named upstream
Copilot and its GitHub default account, while overlaid `product.json` named the
Volter frontend and no default account. The public console recorded a GitHub
provider timeout before the remote extension host registered it. The packaged
Workbench receives build-time product injection; the unbundled browser did not.

The overlay now copies the reviewed product configuration into that empty
browser fallback after configuring the product. It preserves the release
builder's insertion marker and replaces its generated block on repeat. No
credentials, sign-in state, authentication timeout or game prompt was changed.

Verification: the isolated pinned fork completed `compile-client` with zero
errors and `compile-web`. Importing the compiled fallback verified the exact
agent, proposal grants and extension gallery against the server's product.json;
the release insertion marker remains intact. Two full overlay repeats preserved
the exact generated source bytes and a single marker block. Fifteen public
startup/focus/reopen checks passed on the fresh GPT-6 Astra xhigh project.
Delayed-startup observations are retained in cycle-16/persistent-startup-receipt.json.
The first pre-prompt timeout and screenshot remain retained; no authoring turn
was sent before the repair. No packages were published.

Cycle 15 completed and passed all 15 independent public gameplay checks: manual
forward/reverse/steering, boost cost, pause freeze/resume, all six racers finishing
and parking separately, restart and settled Stop/Play reset. Minimum parked
separation was 3.298m. Directly viewed static/game captures still differ in
cliffs, lighting, kart/character proportions and UI/map. The old immutable
candidate unloaded during idle after completion; shutdown diagnostics do not
establish why. Its saved project was reopened for review and gracefully closed.
This is a gameplay pass, not a visual or uninterrupted smoothness acceptance.

### 2026-10-06 — distinguish reference comparison from a visual match

The fresh GPT-6 Astra xhigh author completed cycle 16 in the native editor.
All 18 independent public gameplay checks passed, including drift release,
manual takeover from autoplay, pause, restart and six separate parked finishes.
The original page remained connected with one epoch and no unresolved errors.
Minimum parked separation was 3.667m. The visual comparison still differs in
canyon depth and detail, kart proportions, pavement, shadows and route-map shape;
the author proceeded to gameplay while describing it as a simpler recreation.

The shared starter now separates captured, compared and matched results and
requires concrete comparison observations. Requests for original assets retain
the reference's visual style unless the user explicitly changes that style.
Calling the output stylized or simpler does not complete the visual milestone.
The short task prompt and reference remain unchanged. This instruction change
has not yet been validated by another complete native authoring cycle.

Fresh Models and Playable project generation both copied the exact shared
instructions and retained CLAUDE's AGENTS import. The generation receipt is
`.volter/kart-cycles-20261006/probe-visual-gate-defaults-1791327717838/receipt.json`.
Cycle 16 evidence remains in its parent static and controls review folders.
