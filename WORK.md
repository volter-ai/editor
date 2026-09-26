# Public release status

Volter Editor 0.5.66 (editor-blender 0.1.9, blender-engine 0.1.8) is public on npm from the tag
`release-0.5.66-source`, both lists ([release/modeling.json](release/modeling.json),
[release/game.json](release/game.json)), with `@volter/model-editor`, `@volter/editor-react` and
`@volter/editor-xstate` published for the first time. All fifteen versions are live: every registry digest matches
its tested archive, and every tarball downloads without credentials byte-identical to it. `npx @volter/game-editor
create` and `npx @volter/model-editor create` each installed from an empty npm cache with no credentials and
downloaded their pinned workbench anonymously. The model editor installs with zero vulnerabilities; the game runtime image reports
eight low and moderate ones, all through colyseus's auth dependencies, with no upstream fix
([provenance/public-npm-release.json](provenance/public-npm-release.json)).

## Game editor (branch `game-editor`)

Game editing is built on the `game-editor` branch and does not join
[release/modeling.json](release/modeling.json). Source: `volter-ai/vgai-engine`
at `09c2749ce`. Architecture: vgai-engine's `docs/ARCHITECTURE-CORE.md`
§The target shape — kit, integrations, products, shipped twins; dependencies
point down.

| Package | What it is |
| --- | --- |
| `@volter/game-editor` | The second product: entry composing `@volter/editor-game` and `@volter/editor-blender`, the `volter-game-editor` CLI (kit session verbs plus `play`, `stop`, `restart`, `add`/`remove`/`outdated`, `blender-mcp`), `create` with the game/prototype/full/website/empty presets, the template and capability catalog, its workbench half |
| `@volter/editor-game` | The game side: vgai's `@vgai/game` (`src/`), `@vgai/dom` (`src/react/`), `@vgai/threejs` authoring (`src/three/`), and the kit modules only the game reaches (`src/host/`), including the world-root stage and the Scene document |
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
`src/scenes/MainScene.tsx` and undo/redo round-trip it. vgai's `arena` example,
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
and a Traffic table of join, state, position and patch. Not walked: the focus gate that keeps a
view's keystrokes out of a running game, and Send's typed payload, until a workbench is built
with that overlay.

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
   document (`vgai.document.kind != 'game'`): a W held in Play had run `transform.translate`,
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

For a game, `add music` brings the packages, the `vgai-music` skill and a player;
the `project.music.render` tool (and the `render-piece` CLI it shares its code with) writes
through the project-output door, so `.vgai/provenance.json` records every file a game ships,
with renders byte-deterministic down to the OGG and its AAC twin (`.m4a`, which the player
loads when the browser cannot decode Vorbis); `sections` writes each marker section as its
own seamless loop at the mix's level (lengths exact to the frame against the report's
`barSeconds`) and `oneShot` a stinger. Driven in the editor page on an OfflineAudioContext,
the player switched from one section loop to the next on the bar line it computed (6.05 s,
the report's bar 3 plus the lead), with the output equal to each loop's own samples on either
side of the fade; a second queue before the switch replaced the waiting loop at the same
moment (it never sounded), and a section starting mid-bar switched on the piece's next bar
line inside it. `check-piece` adds an analysis (keys, half-bar chords and degrees, cadences
and loop seams, voicing, line statistics, figures shared with the folder's other pieces);
on Harbor and Tidewatch its chords match the pieces' own chord tables in every bar.
Walked in a fresh game created from the checkout: `add music` copies the player and the render
tool and selects the piece finder in `vgai.adapter.ts`; a worked piece from the package's
`examples/` opens in the same running session; `project.music.render` with sections wrote 32
files under `public/music/harbor` (no problems, −18 LUFS, seam 0.177) with each recorded in
`.vgai/provenance.json`, rendering in its own process (the editor answered in about 270 ms
throughout) and byte-identical to an in-process render; console silent.

Open, with what closes each:
- Bitwig's editing basics, landed and each driven through its own control on Harbor (source
  diff read, undo byte-identical, generated targets refused whole): in the piano roll,
  selection, group move, length, grid, quantize, clipboard, duplicate and articulation; in the
  arranger, clip move/resize/create/delete/duplicate, seek, loop region, metronome, markers,
  tempo and meter, the tempo row, and adding tracks, devices and sends. Playing, read in a
  headless, muted tab hosting the session (`VGAI_NO_OPEN`, Chromium with `--mute-audio` and
  `--autoplay-policy=no-user-gesture-required`): a ruler click at bar 10 while playing moved
  the playhead from beat 5.3 to 36.6 and on; with a loop region of beats 8–16 a play from 0
  ran into it and wrapped from 15.6 to 9.0; the metronome scheduled a blip every 0.75 s at
  80 BPM, the downbeat at 1760 Hz against 1320, and none once off; a paste at playhead 14.32
  wrote the note at 4:3.25 (the 1/16 grid) and undid byte-identically.
- Live against export, synth half. Read from `spessasynth_lib`'s processor: at the start of
  each 128-sample render quantum it applies every queued event whose time has passed, then
  renders the quantum, so each note the preview schedules sounds up to 2.67 ms after its
  performed time (the export is sample-exact). Under a quantum is inaudible; matching the export
  exactly needs the processor to split its quantum at event times, a change to that library. The
  offline null of the two (+1.6 dB at equal level) is not yet a clean reading: in an
  OfflineAudioContext the worklet stayed silent after the preview's channel setup, so the
  instrument has to be settled before its number means anything.
- Sampled instruments: a listening judgement. VS Chamber Orchestra 2 Community Edition (CC0)
  builds as 20 banks, one per instrument, 66 patches (`scripts/vsco2-ce`, into
  `~/.volter/banks/vsco2-ce`, byte-reproducible), through the one engine the editor and the
  export share. A track plays the bank its device names, `articulations` sends a note's `artic`
  (staccato, pizzicato, tremolo) to the patch that recorded it, and the drum channel's program
  chooses the kit. Harbor with every instrument moved to it, each track's level matched to the
  General MIDI render to 0.0 dB, waits for a listen: `music-probe/out/ab/gm/harbor.ogg` against
  `out/ab/orchestra/harbor-orchestra.ogg`, and so does a cue written for it end to end
  (`src/music/tidewatch.tsx`: Explore and Battle loops, `out/tidewatch/sections/`, with the
  `victory.tsx` stinger in `out/victory`). The banks are SF3 (218 MB for the library, round-robin
  members included; an editor tab holding nine grows by about 425 MB, against 1.2 GB
  uncompressed), and repeated notes step through a patch's round-robin recordings.
- A section loop's audio equals its bars in the whole piece only where the synthesizer's
  state does not depend on what it played before: events match to the sample, and a pass
  preceded by the same music is bit-identical. In the probe piece, section A′ nulls against
  its bars in the whole loop at −92 dB past its first 3 s (the wrapped tail), but section A at
  −23 dB (flute and cello most). The state that carries is not identified.

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

**Windows/Linux remain deferred by the owner.** Do not provision runners or
pursue these builds in this pass. Only darwin-arm64 is supported.

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
