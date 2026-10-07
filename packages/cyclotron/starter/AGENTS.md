# Cyclotron project

This project opens in Volter Cyclotron. Blender runs in the editor's live
worker; the project-local `blender` MCP server connects to that same session.

## You are working in front of an audience

A person is watching this editor window the whole time you work, the way they
would watch someone build at a desk beside them. What they see on screen is your
work; a file written off screen or a long silent run of commands looks to them
like nothing is happening. Make every action legible to them:

- Show before you change. Open and frame the document you are about to edit
  before reading packages, writing scripts or running Blender code against it.
- Build in small steps they can follow, and show each step's result before the
  next. Never leave the starter placeholder on screen while the real work
  happens elsewhere.
- Say what you are doing and why in Chat as you go, in a sentence they can read
  while watching, and keep a readable plan with the current step beside the
  work (see "Keep the work visible to a person watching").
- Check what they actually see: inspect editor captures for framing and for text
  they can read at normal size, and fix what is cut off, tilted or cramped.

Research the project as you need it, but keep it short between visible steps;
the person should rarely wait more than a minute without seeing the work move.

### Your first minute

1. Say in Chat, in a sentence or two, what you are going to build.
2. Open the document you will work in and frame it:
   `npx --no-install cyclotron camera --position x,y,z --target x,y,z`
   (Blender metres, Z up). For a game in a models-only project, run
   `npx --no-install cyclotron add-play` first, then `npm install`,
   and reload the editor once as `add-play` says, before your first build step.
3. Put the `Build Notes` board beside the work with the plan and current step.
4. Check what the person sees:
   `npx --no-install cyclotron capture --region document`.

Only then read packages or write scripts. The editor nudges you in Chat when
nothing visible has changed for a minute during your turn; treat that as the
person asking what is happening.

## Match the requested result

Read the request and inspect the project before choosing a workflow. Continue
in the current project and preserve user-authored content and manual edits.
Replace unused scaffold placeholders as the requested result calls for.

- **A model or asset:** author the requested object in `src/models/*.blend`.
  Check its silhouette, proportions, topology, materials, dimensions and origin
  from several useful angles. Keep its organization suitable for reuse.
- **A scene or environment:** compose the requested set of objects in a saved
  `.blend` document. Address layout, scale relationships, materials, lighting
  and the intended viewpoints; add cameras when the requested shot needs them.
  A game-like reference can describe a static scene. Implement playable behavior
  when the user asks for a working game or interactive mechanics.
- **An animation or interactive model:** implement the requested motion or
  interaction and preview it in the editor. Inspect representative poses or
  moments, and verify the requested controls and transitions.
- **A working game:** follow the gameplay workflow below, including live Play,
  autoplay and manual controls. Match the mechanics and success/failure behavior
  to the requested game.
- **UI or a HUD:** follow the React UI workflow below. A standalone screen needs
  its own visual and interaction checks; UI attached to a game also needs checks
  during Play.
- **An edit or repair:** inspect the existing result first and change the
  requested parts. Capture its existing appearance before visual edits and use
  it as a reference for continuity. For behavior-only, setup or diagnostic
  work, focus on the requested behavior; the image-reference
  steps apply when designing or changing appearance.

## Author in the live editor

Apply this section to models, scenes and the Blender parts of games.

- `src/models/*.blend` are the saved documents, including full scenes.
  `*.py` beside them record how they were authored. Editing a script alone does
  not update the document.
- Inspect the open scene with `get_scene_info` and `get_object_info` before
  changing it. Rerunning a script that clears the scene replaces existing work.
  Update scripts to preserve user edits and the `References` and `Notes` collections when
  rebuilding procedural content.
- For procedural changes, update the relevant `.py` and execute it through
  `execute_blender_code` in the project Blender MCP, running the file itself:
  `exec(open("<project root>/src/models/<name>.py").read())`, with the root the
  tool's description names (source files you just wrote are in place when the
  call runs; keep scripts out of dot-directories, `node_modules`, `dist`,
  `coverage` and `logs`, which are not copied in). Pass the user's request
  verbatim as `user_prompt` when the tool asks for it. Use the existing editor
  session rather than a separate Blender process. If the tool says Blender is
  editing another document, wait and retry, then switch to another document
  and back or run `editor.reloadPage()` in eval; do not build through `eval`
  instead.
- Orient procedural closed-mesh faces outward and inspect their exterior in
  Rendered shading before building many copies. Recalculate normals when needed.
- Verify object properties and inspect screenshots after meaningful changes.
  The editor autosaves edits to the open `.blend`; confirm the saved file
  before reporting completion. Arbitrary Python execution creates an undo step,
  so prefer the inspection tools for reads.
- Blender coordinates are metres with Z up. The glTF exporter converts to Y up.
  Preserve the existing script license headers.
- Blender mounts project files at the project's actual absolute filesystem
  path. Use that path for image loads, saves and exports; `/project` is not an
  alias. Derive it from the project folder rather than guessing a virtual root.
- For large scenes, build mesh data in batches and reuse meshes/materials.
  Thousands of separate `bpy.ops` primitive and modifier calls can keep the
  editor's Blender worker occupied for minutes. Inspect worker-call timing in
  `status().tabs[].census` and let an active call finish before retrying it.

## Keep the work visible to a person watching

Apply this throughout authoring, not only when taking a screenshot or presenting
the finished result. Someone watching the editor should be able to see what you
are changing, why, and how far along it is.

- Before changing an asset, open its live document and frame the relevant work
  at a useful scale and angle. Keep that view visible while editing source or
  running Blender operations. After each meaningful change, show the result
  before moving on; do not leave a placeholder, an unrelated document or an
  obstructed view on screen while building elsewhere.
- Arrange the layout for the current task. Use a whole-object view and a detail
  view when helpful, show the reference beside the work, and show React UI work
  in the UI canvas. For gameplay, keep the running game and HUD visible during
  observation. Use the model's View → Area → Vertical Split when two 3D views
  help; each area has its own camera. Preserve deliberate human layout and
  camera changes, and avoid needless switching or cramped panels.
- At the start of substantial work, store a concise plan as an internal Blender
  Text data-block named `Build Notes`, with a fake user so it survives saving.
  Keep a readable version visible beside the work, such as Text objects in a
  `Notes` collection; an embedded text buffer alone is not visible in this
  editor's 3D viewport. Include the current step, pending steps, and verified
  completed steps with their completion times. Update both versions at real
  milestones. Preserve these notes across procedural rebuilds and reopening.
  Read the actual words in an editor capture at the normal viewing size;
  adjust text size, framing and foreground/background contrast until legible.
- Keep authoring notes outside the intended shot and out of rendered/exported
  assets and gameplay. Verify this in the actual output; `hide_render` alone
  does not guarantee every export or Play path excludes an object.
- Before the first substantial build, inspect an editor capture that shows
  the work, reference and readable current-step notes together. Creating a
  reference or notes collection does not satisfy this if it is offscreen,
  behind the camera or too small to read. When the target camera excludes
  them, use a second authoring view for reference and notes, and keep the
  working view framed on the asset. Recheck this arrangement before each
  substantial build step; retain it while comparing the clean target shot.
- Prefer bounded visible milestones over one long opaque build. While an
  operation is busy, leave the relevant work and its current-step note visible
  and explain what is running. Inspect meaningful editor captures to check
  framing, reference and note legibility; do not claim progress or completion
  before the corresponding result is verified.

## Understand the references

- Inspect the supplied images, videos, written specifications, linked sources
  and relevant existing project assets. Open the actual content rather than
  inferring it from filenames or descriptions. Read written constraints and
  inspect multiple useful moments in motion references. If a reference is
  inaccessible, state that limitation rather than claiming to have inspected it.
- Derive appearance directly from the references: composition and camera,
  silhouette and proportions, relative scale, palette, material finish,
  texture detail, lighting and shadows, background, and UI placement and density.
  Record a concise working interpretation for your own comparison; the user
  should not need to spell out what is visible in their reference.
- Combine references according to their purpose: an image may define style,
  a video motion and timing, and a specification mechanics or dimensions.
  The user's explicit changes take precedence. Preserve unaffected details
  from existing work. Ask only when conflicting references or a missing detail
  materially prevent progress; use reasonable assumptions for other gaps.
- Requests for original or different characters and objects change their
  identities, not the reference's art style. Preserve proportions, curvature,
  material finish, surface detail and lighting unless the user requests a
  different treatment. A stylized reference still has a specific visual style.
- Distinguish visible evidence from assumptions. A still image does not prove
  controls, collisions, unseen geometry or gameplay rules. Infer appropriate
  conventions from the requested kind of result, then verify implemented
  behavior in the editor. Do not promise an unseen feature based on an image.

## Visual references

- Use supplied visual references for the requested model, scene, game or UI.
  Reuse relevant existing references when continuing a project. Extract useful
  frames from video references for side-by-side comparison. For new visual
  work with no image reference and an available image-generation tool, generate a
  reference from the user's requested appearance before building. If that tool
  is unavailable, tell the user and continue using their description.
- Save references in the project's `references/` folder and add them to the
  live Blender scene as named image Empties in a `References` collection.
  Arrange them beside the work for comparison, with their viewport display
  enabled. Pack the images into the `.blend` so they survive reopening;
  preserve the original files too.
- Capture and inspect the visible editor document with
  `editor.captureEditorChrome({ region: 'document' })` for side-by-side
  comparisons. Image Empties are editor overlays and may be absent from render
  captures such as `get_viewport_screenshot`. Use that MCP tool for clean 3D
  views, and the editor capture to verify the reference is actually visible.
- Compare composition, silhouette, proportions, colors and materials after
  meaningful visual changes, then correct visible differences. For UI work,
  also open the reference as an editor image document alongside the UI canvas.
- For Blender rendering comparisons, `scene.render.engine = 'CYCLES'` and
  `bpy.ops.render.render(write_still=True)` use native Cycles. Use CPU in the
  browser build and an appropriate sample count; retain the source's compositor
  and required passes. `VOLTER_THREE` explicitly requests a raster photograph.
  A native render is a reference, not evidence that live Play matches it: compare
  the actual viewport and composed game/UI capture too. Keep gameplay behind
  that visible comparison gate when a reference match is required.
- Choose capture scope deliberately. A full editor-page capture shows authoring,
  chat and panels; a game comparison needs the composed 3D scene and React UI
  in `editor.captureEditorChrome({ region: 'play' })` when using Model Play.
  That capture uses the live Play frame and includes its React HUD; a document
  capture also includes the surrounding authoring viewport. A raw game-canvas
  capture omits the React UI.
  Label these separately when saving evidence. Editor chrome capture reconstructs
  DOM and canvas pixels; it is not a browser/CDP or desktop screenshot.

## Establish the visual match first

For new visual work, match the requested view before adding behavior. For a new
game, this first pass is the authored 3D scene and React UI, composed as a static
game screenshot; movement, scoring, opponents and item logic come afterward.
For a behavior-only repair, preserve the established appearance.

- Match the reference's aspect ratio, crop, camera angle, perspective and object
  scale. Capture the actual composed scene and UI at comparable resolution;
  editor chrome and unrelated panels are outside this comparison. Use the real
  3D model and React components, keeping the reference beside the scene.
  For Model Play, declare the reference dimensions in the project's `resolution`
  so the game frame and camera keep that aspect ratio as editor panels resize.
- Seek the closest practical pixel and color match. Compare large shapes and
  their screen positions first, then regional colors, brightness, contrast,
  saturation, shadows and highlights, and finally texture and small details.
  Use aligned overlays, difference images or sampled colors when available,
  alongside direct visual inspection. Account for explicitly requested changes.
  Judge the rendered silhouettes, curvature, proportions and surface detail,
  as well as which objects are present. Preserve the reference's fidelity
  unless the user requests a different treatment; a simpler interpretation
  does not resolve a visible mismatch.
- Compare images in a consistent display color space. Inspect texture color
  spaces, renderer output, exposure and tone mapping when colors differ;
  do not compensate for a rendering-pipeline defect by repainting the assets.
- Capture, compare and revise the model, materials, lighting, camera and UI
  until visible mismatches are resolved before implementing gameplay. If an
  editor or renderer limitation prevents the match, identify it and report the
  blocker instead of burying the mismatch under additional mechanics. Recheck
  the reference view after behavior is added.
- Before moving to gameplay, save and inspect a comparison of the reference
  and static scene with React UI at matching crop, aspect ratio and resolution.
  Track capture, comparison and visual match as separate results. Saving a
  comparison proves the images were captured; it does not prove a match.
  Record the largest remaining differences in shape, screen position, regional
  color, lighting and UI scale in Build Notes, with actual observations rather
  than a list of categories. Use pixel measurements for representative regions
  and landmark positions when available. Resolve those differences or
  report the specific rendering limitation before checking off the visual pass.
  Support a claimed renderer limitation with a focused comparison or reproduction.
  Continue correcting authorable geometry, framing, materials and UI differences.
  Keep this milestone pending while those differences remain. Continue the
  visual work before adding gameplay instead of checking off object coverage
  as a completed visual match. Calling the result a stylized recreation or
  simpler interpretation does not satisfy a request to match the reference.

## Working games

- Complete the visual pass above before implementing gameplay for a new game.
- Implement and run the game inside the editor. Continue an existing game's
  runtime and source organization. For a new model-based game,
  use the `playable` template; in an existing models-only project run
  `npx --no-install cyclotron add-play` (it never overwrites files).
  Its `src/models/*.play.ts` scripts implement
  gameplay; the Play control runs them on a detached copy of the model.
  When extending an existing model-based project, declare `@volter/editor-model-play`
  and the React/UI dependencies with compatible project versions, and add the
  UI root as needed. Preserve its models, source and settings.
- Register your bot as named behaviours, one per outcome worth checking:
  `play.autoplay({ win: …, lose: … })`, at least one that plays to win and one
  that loses on purpose (walks into enemies, lets the timer run out). Test an
  ending by running the behaviour that reaches it, never by leaving the game
  alone. Never bind autoplay to a game key or start it yourself; the person
  turns it on in the Game panel (or you, with `play autoplay on <behaviour>`).
  Each controller is a plain function called before each `update` while its
  behaviour drives, given `{ behavior, dt, simT, tick, keys }` (`keys` are the
  person's), and returns the `KeyboardEvent.code` keys it holds for that
  update, or `{ keys, state }` where `state` says in a few words what it is
  doing and why ("heading to nest 2", "waiting for resupply"). The Game panel
  shows that state beside the driver and the play log records each change
  (`bot-state`), so return it whenever the bot's intention changes. The keys
  are merged into `keys`, so the bot drives through the same movement,
  collision and scoring code as manual play. Autoplay is off at every Play and
  Restart, and any key or click in the game hands control back to the person
  (`autoplay-off` with `by: 'takeover'` in the play log).
- Every autoplay run is limited to simulation seconds, 300 unless you pass
  `--for <seconds>`; at the limit autoplay turns off, the game pauses and the
  log says `autoplay-limit` with the bot's last state. A run that reaches its
  limit is a finding: the game has no reachable ending for that behaviour, or
  the bot is stuck. Give every game a terminal state reachable in bounded
  time (a mission timer that fails the mission, for example), and wait on a
  run by reading `play-log` until a deadline, never open-ended.
- Keep a gameplay log while the game runs; without it, autoplay is a black box
  and a final position or screenshot cannot tell you what went wrong. Use the
  play script's built-in log, `play.log(kind, facts)`: it stamps each entry
  with simulation time and tick, keeps a bounded history, and records Play
  start, stop, script reloads and script errors itself. Give each entry a kind
  and the facts needed to explain it: phase changes and
  restarts; autoplay's decisions and the inputs it held; manual inputs that
  start an action; contacts that matter (landing on, leaving or being pushed
  by a surface, by object name); checkpoints, pickups, score and inventory
  changes; deaths, failures and finishes with their cause and position. Log
  transitions rather than every frame, so a full run stays readable.
- Read the gameplay log with `npx --no-install cyclotron play-log
  [--since <simTime>] [--kind <kind>]` during and after each autoplay or manual
  run, and explain what happened from it before
  changing code: where autoplay stalled or died and why, and whether that is a
  level, physics or controller problem. `console.log` lines do not reach the
  session's console feed (only warnings and errors do), so the play log is
  what you can read back. Keep logging read-only: it must not change
  timing, inputs or game state.
- Run each behaviour in Play (`play autoplay on <behaviour>`) and observe representative actions, objectives,
  progression and any relevant failure/restart behavior. Exercise manual
  controls too. Inspect runtime errors and game state alongside screenshots;
  a still image alone does not verify gameplay.
- Observe a complete session through every relevant participant's terminal
  state. Check finish, failure and post-finish clearance as appropriate. Use
  the actual Restart control and complete another session; reset every entity's
  position, movement, progression, inventory, effects and terminal state.
  Stop/Play alone does not verify the game's restart behavior.
- During active gameplay, verify pause freezes simulation time, entity state,
  effects and inventory. Gameplay input while paused must preserve that state;
  resume must restore normal controls. Presenting another editor document can
  stop Model Play and does not verify an in-game pause.
- Verify manual controls through representative continuous play, including
  turning, braking and the game's special actions. Inspect movement while a
  key is held when testing sustained actions such as reverse; a stopped sample
  after release is insufficient. Use public controls and observational game
  state, rather than private state writes that skip the behavior being checked.
- Make meaningful race or game state observable through the live HUD or a
  read-only public inspection surface: phase, simulation time, participant
  positions and signed movement, progression, terminal states and inventory
  as applicable. Observation must not bypass normal controls or mutate state.
- Capture and inspect the running game at the start, during representative
  actions and after gameplay or visual changes. Include the HUD in these
  captures using the visible editor document. Fix observed problems, play again
  and report what was actually observed.

## React UI

- Build HUDs, menus and screens as React components in `src/ui/`. A game's
  DOM root is `src/ui/game.tsx`; the playable template includes the required
  React/UI tools and manifest root. Existing projects need `react`, `react-dom`,
  `@volter/editor-ui` and `@volter/editor-react`, with compatible project versions.
  Declare the UI story region in `volter.adapter.ts` (the playable template uses
  `regionIncludes.ui` for `src/ui/**/*.tsx`). Preserve the project's other content.
- Add `.stories.tsx` states and open them in the editor's UI canvas/component
  board. Show representative states such as normal, empty, error and active
  states as appropriate, and inspect their screenshots and interactions.
  Reveal the board through the ordinary eval door with
  `editor.present({ version: 1, document: { kind: 'workspace', id: 'workspace:ui-components' } })`.
  The board becomes available after UI story discovery; read console errors if
  it is missing. A declared UI root alone does not supply component stories.
- Give the intended initial state an explicit default and inspect opening the
  canvas without selecting a story. Keep previews deterministic and isolated:
  a timer in one mounted preview must not advance it into another state or
  change another preview. Inspect each selected state's pixels and interactions,
  and keep its entities, inventory and results consistent with the real game.
- For a game HUD, verify the same components over the running game and check
  they reflect live game state. For standalone UI, verify its own interactions
  and state changes in the UI canvas.

## Session controls

Drive this editor through its public SDK/CLI and project Blender MCP. Keep the
existing editor session and native Chat; private browser automation or a separate
browser profile would bypass the user's actual authoring experience.
Work in the authored project's source and assets. Diagnose and report failures
in editor/runtime dependencies to their owning repository; preserve installed
packages rather than patching them inside the project.

Source, manifest and reference edits update the running editor through its normal
watchers. Inspect the current document and console before attempting recovery.
Open model documents with `editor.open("model:src/models/example.blend")`.
Blender files are Model documents: use their `model:` document IDs with
`editor.open`. `openAsset` opens generic assets such as images and audio; supplying
`"model"` as its kind does not turn a `.blend` into the live Blender document.
Closing the entire editor also ends its hosted AI runtime and can abort your own
turn. Recover the document or page through its scoped controls, and preserve the
active conversation when diagnosing a problem.
Do not call `editor.reloadPage()` just to reveal new files, UI boards, references
or gameplay scripts. A page reload interrupts the visible editor and its chat;
reserve it for an explicitly requested reload or a diagnosed problem that needs it.

The project-local CLI is `npx --no-install cyclotron`: `status`,
`console`, `eval --list`, and `chat status` expose the current editor and AI
session. `chat send "your prompt"` sends to the same visible conversation;
`chat stop` stops its current turn. Inspect the transcript and pending requests
for the outcome. A dispatch receipt does not mean an edit has completed.
In `eval`, explicitly `return` any result you need to inspect; for example,
`eval 'return await editor.currentView()'`. Read `eval --list` for available
objects rather than assuming globals from another tool runner.
If the project uses a Volter World, run app and test commands through that World.

Common commands, all through `npx --no-install cyclotron`:
`camera --position x,y,z --target x,y,z [--fov n]` poses the open document's
view in Blender metres, Z up. In eval, `editor.present({ version: 1, viewport:
{ camera } })` takes stage space, Y up: a Blender point (x, y, z) is
`{ x, y: z, z: -y }`, so prefer the `camera` command, which converts for you.
`capture --region document|play [--out file.png [--force]]` saves what the person sees (default under
`.volter/captures/`); `add-play` makes a models project playable; `play-log`
reads the running game's log. The Game panel's controls, each printing its state:
`play autoplay on <behaviour> [--for <seconds>]` runs one of the game's bot behaviours for at most that many simulation seconds (300 by default), and `play autoplay off` stops it (the Game panel's Autoplay toggle);
`play pause` holds the game (no `update` calls; its clock stops);
`play resume` lets it run again;
`play step [count]` runs one 1/60 s update of a paused game per count;
`play speed 0.25|0.5|1|2|4` scales the `dt` the script is handed;
`play restart` begins again on a fresh copy of the model, the clock at zero;
`play mode game|movie` swaps the bottom area between the Game panel and the Timeline.
In a play script, recolour or fade an object with
`play.tint(object, color)` and `play.setOpacity(object, value)`: Blender meshes
carry one material per slot and the presenter reapplies its own materials, so
editing `mesh.material.color` does not show.

Keep the project clean. Once the real document exists, remove the template
placeholder (`cube.blend`, `cube.py`) unless the person is using it. Put your
own helper scripts and evidence images under `.volter/scratch/`, not in the
project's source folders, and do not leave them behind as project files.
