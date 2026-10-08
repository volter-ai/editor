# Cyclotron project

This project opens in Volter Cyclotron. Blender runs in the editor's live
worker; the project-local `blender` MCP server connects to that same session.

## Work in front of the person watching

A person watches this editor the whole time you work, as they would watch
someone build at a desk beside them. What they see on screen is your work; a
file written off screen or a long silent run of commands looks to them like
nothing is happening.

Your first minute:

1. Say in Chat, in a sentence or two, what you are going to build.
2. Open the document you will work in and frame it:
   `npx --no-install cyclotron camera --position x,y,z --target x,y,z`
   (Blender metres, Z up). For a game in a models-only project, run
   `npx --no-install cyclotron add-play` first, then `npm install`,
   and reload the editor once as `add-play` says, before your first build step.
3. Put the plan beside the work (`Build Notes`, below) with the current step.
4. Check what the person sees: `npx --no-install cyclotron capture --region document`.

Only then read packages or write scripts. Research the project as you need it,
but keep it short between visible steps. Throughout:

- Show before you change: open and frame the document before editing it, keep
  that view visible while you edit source or run Blender operations, and show
  each meaningful result before the next step. Never leave the starter
  placeholder, an unrelated document or an obstructed view on screen while the
  real work happens elsewhere.
- Say what you are doing and why in Chat as you go, in a sentence they can
  read while watching. The person should rarely wait more than a minute
  without seeing the work move; the editor nudges you in Chat when nothing
  visible has changed for a minute, which is the person asking what is
  happening. Prefer bounded visible milestones over one long opaque build, and
  while an operation is busy, say what is running.
- Arrange the layout for the task: a whole-object view and a detail view when
  helpful (View → Area → Vertical Split; each area has its own camera), the
  reference beside the work, React UI in the UI canvas, and the running game
  and HUD while observing a game. Preserve deliberate human layout and camera
  changes, and avoid needless switching or cramped panels.
- `Build Notes`: at the start of substantial work, store a concise plan as a
  Blender Text data-block named `Build Notes` with a fake user, and keep a
  readable copy beside the work as Text objects in a `Notes` collection (a
  text buffer alone is not visible in the viewport). Include the current step,
  pending steps, and verified completed steps with their times; update both at
  real milestones and preserve them across rebuilds and reopening. Keep notes
  out of the intended shot, renders, exports and gameplay, and verify that in
  the actual output (`hide_render` alone does not exclude an object from every
  path).
- Check what they actually see in captures: framing, the reference and the
  notes visible together before the first substantial build and again before
  each substantial step, and text legible at normal size (adjust its size,
  framing and contrast). When the target camera excludes the reference and
  notes, use a second authoring view for them, keep the working view framed on
  the asset, and keep that arrangement while comparing the clean target shot.
  Do not claim progress or completion before the result is verified.

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
- **A character or an animation:** see Characters and Animation below; check
  motion in the Timeline at representative and extreme poses.
- **An interactive model:** implement the requested interaction, preview it in
  the editor, and verify the requested controls and transitions.
- **A working game:** follow Working games below, including Play, autoplay and
  manual controls. Match the mechanics and success/failure behavior to the
  requested game.
- **UI or a HUD:** follow React UI below. A standalone screen needs its own
  visual and interaction checks; UI attached to a game also needs checks in Play.
- **An edit or repair:** inspect the existing result first and change the
  requested parts. Capture its existing appearance before visual edits and use
  it as a reference for continuity. Behavior-only, setup or diagnostic work
  focuses on the behavior; the reference steps apply when appearance changes.

## Author in the live editor

Apply this section to models, scenes and the Blender parts of games.

- `src/models/*.blend` are the saved documents, including full scenes.
  `*.py` beside them record how they were authored. Editing a script alone does
  not update the document.
- Look in the asset library before authoring an asset from nothing:
  `GET <editor>/__editor/asset-library/search?source=local&type=model&q=<words>`
  at the editor's address (the one `cyclotron edit` printed). Results carry
  `tags` (such as `animated`), a license and attribution; fetch one with `POST <editor>/__editor/asset-library/download`,
  import it through Blender, and record the asset and its license in the project.
- Inspect the open scene with `get_scene_info` and `get_object_info` before
  changing it. Rerunning a script that clears the scene replaces existing work;
  update scripts to preserve user edits and the `References` and `Notes`
  collections when rebuilding procedural content.
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
- Verify object properties and inspect captures after meaningful changes.
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

## References

- Inspect the supplied images, videos, written specifications, linked sources
  and relevant existing project assets. Open the actual content rather than
  inferring it from filenames or descriptions, and inspect several moments of
  a motion reference. If a reference is inaccessible, say so rather than
  claiming to have inspected it.
- Derive appearance from the references: composition and camera, silhouette
  and proportions, relative scale, palette, material finish, texture detail,
  lighting and shadows, background, and UI placement and density. Record a
  concise working interpretation for your own comparison; the user should not
  need to spell out what is visible in their reference.
- Combine references by purpose: an image may define style, a video motion and
  timing, a specification mechanics or dimensions. The user's explicit changes
  take precedence; preserve unaffected details of existing work. Ask only when
  conflicting references or a missing detail materially prevent progress.
- A request for an original or different character or object changes its
  identity, not the reference's art style: keep its proportions, curvature,
  material finish, surface detail and lighting unless asked otherwise.
- A still image does not prove controls, collisions, unseen geometry or rules.
  Infer conventions from the kind of result, verify them in the editor, and do
  not promise an unseen feature from an image.
- Read written constraints, and use reasonable assumptions for gaps that do
  not prevent progress. A stylized reference still has a specific visual style.
- Reuse relevant existing references when continuing a project, and extract
  useful frames from video references for side-by-side comparison.
- New visual work with no image reference: generate one from the requested
  appearance when an image-generation tool is available; otherwise tell the
  user and work from their description (for a character, a design sheet; see
  Characters).
- Save references in `references/` and add them to the scene as named image
  Empties in a `References` collection beside the work, viewport display on,
  packed into the `.blend` (keep the original files too). Image Empties are
  editor overlays: they show in `capture --region document`, not in the MCP's
  `get_viewport_screenshot`, which is for clean 3D views. For UI work, also
  open the reference as an image document beside the UI canvas.
- Choose capture scope deliberately and label evidence by it: `page` is the
  whole editor, `document` the document with its overlays, `play` the running
  game with its React HUD (a raw game-canvas capture omits the UI). An editor
  capture reconstructs DOM and canvas pixels; it is not a browser or desktop
  screenshot.

## Establish the visual match first

For new visual work, match the requested view before adding behavior. For a new
game, this first pass is the authored 3D scene and React UI composed as a static
game screenshot; movement, scoring, opponents and items come afterward. A
behavior-only repair preserves the established appearance.

- Match the reference's aspect ratio, crop, camera angle, perspective and object
  scale, with the real 3D model and React components at comparable resolution;
  editor chrome is outside the comparison. For a game, declare the reference's
  dimensions in the project's `resolution` so the game frame keeps its aspect
  ratio as panels resize.
- Compare large shapes and their screen positions first, then regional color,
  brightness, contrast, saturation, shadows and highlights, then texture and
  small details, with overlays, difference images or sampled colors where you
  can, and by eye. Judge silhouettes, curvature, proportions and surface detail,
  not only which objects are present. A simpler or "stylized" interpretation
  does not resolve a visible mismatch.
- Compare in one display color space. When colors differ, inspect texture color
  spaces, renderer output, exposure and tone mapping; do not repaint assets to
  hide a rendering-pipeline defect.
- Before gameplay, save a comparison of the reference and the static scene
  with UI at matching crop and resolution, and record its largest remaining
  differences in Build Notes as measured observations (landmark positions,
  regional colors), not categories. Track capture, comparison and visual match
  as separate results: saving a comparison proves a capture, not a match. Keep
  gameplay behind this gate, and keep the visual pass open, and keep correcting geometry, framing,
  materials and UI, until those differences are resolved or a renderer
  limitation is shown with a focused reproduction and reported. Recheck the
  reference view after behavior is added.
- A native Cycles render (`scene.render.engine = 'CYCLES'`,
  `bpy.ops.render.render(write_still=True)`, CPU in the browser build, a
  suitable sample count, the source's compositor and passes kept) is a
  reference, not evidence that the editor's view matches it; compare the actual
  viewport and game capture too. `VOLTER_THREE` requests a raster photograph.

## Working games

- Complete the visual pass before implementing gameplay for a new game.
- Implement and run the game inside the editor. Continue an existing game's
  runtime and source organization, and preserve its models, source and settings. For a new model-based game, use the
  `playable` template; in an existing models-only project run
  `npx --no-install cyclotron add-play` (it never overwrites files). Its
  `src/models/*.play.ts` scripts implement gameplay; Play runs them on a
  detached copy of the model. When extending an existing model-based project,
  declare `@volter/play` and the React/UI dependencies with
  compatible project versions, and add the UI root as needed.
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
  doing and why ("heading to nest 2"). The Game panel shows that state and the
  play log records each change (`bot-state`), so return it whenever the bot's
  intention changes. The keys are merged into `keys`, so the bot drives through
  the same movement, collision and scoring code as manual play. Autoplay is off
  at every Play and Restart, and any key or click in the game hands control back
  to the person (`autoplay-off` with `by: 'takeover'` in the play log).
- Every autoplay run is limited to simulation seconds, 300 unless you pass
  `--for <seconds>`; at the limit autoplay turns off, the game pauses and the
  log says `autoplay-limit` with the bot's last state. Reaching the limit is a
  finding: the behaviour has no reachable ending, or the bot is stuck. Give
  every game a terminal state reachable in bounded time (a mission timer that
  fails the mission), and wait on a run by reading `play-log` until a deadline,
  never open-ended.
- Keep a gameplay log with `play.log(kind, facts)`: it stamps each entry with
  simulation time and tick, keeps a bounded history, and records Play start,
  stop, script reloads and errors itself. Log transitions with the facts that
  explain them: phase changes and restarts; autoplay's decisions and the inputs
  it held; manual inputs that start an action; contacts that matter (by object
  name); checkpoints, pickups, score and inventory; deaths, failures and
  finishes with cause and position. Log transitions rather than every frame,
  so a full run stays readable; logging must not change timing, inputs or
  state. Read it with `npx --no-install cyclotron play-log [--since <simTime>]
  [--kind <kind>]` during and after each run, and explain what happened from it
  before changing code: where autoplay stalled or died and why, and whether
  that is a level, physics or controller problem. `console.log` does not reach the console feed (only
  warnings and errors do).
- Animate characters from the play script: `play.setAction(object, name)` sets
  the active action, crossfading from the last; `play.setTrack(object, track,
  { action, influence })` sets an NLA track; `play.setConstraint(object, bone,
  name, { influence })` a constraint; `play.actions(object)` lists the actions.
  Recolour or fade an object with `play.tint(object, color)` and
  `play.setOpacity(object, value)`: the presenter reapplies its own materials,
  so editing `mesh.material.color` does not show.
- Run each behaviour (`play autoplay on <behaviour>`) and exercise manual
  controls through representative continuous play, including turning, braking
  and special actions; inspect movement while a key is held for sustained
  actions. Inspect runtime errors and game state with captures; a still image
  alone does not verify gameplay. Use public controls and observable state, not
  private state writes that skip the behavior being checked.
- Observe a complete session through every participant's terminal state,
  including finish, failure and post-finish clearance as applicable, then
  use the actual Restart control and complete another, checking that every
  entity's position, movement, progression, inventory, effects and terminal
  state reset. Stop/Play alone does not verify restart.
- During active gameplay, verify pause freezes simulation time, entity state,
  effects and inventory, that input while paused preserves it, and that resume
  restores normal controls. Presenting another editor document can stop Play;
  it does not verify an in-game pause.
- Make meaningful game state observable through the HUD or a read-only
  inspection surface: phase, simulation time, participants' positions and
  signed movement, progression, terminal states and inventory as applicable.
- Capture the running game, HUD included (`capture --region play`), at the
  start, during representative actions and after changes; fix what you see,
  play again and report what was actually observed.

## Animation

- Characters and creatures that move are animated as in Blender: an armature,
  and its motions as named actions in the `.blend`. The action an armature has
  assigned (`animation_data.action`) is the one it plays.
- The Timeline and a game play it as Blender does: NLA tracks, then the active
  action, then Damped Track constraints. Layer motions with NLA tracks (an
  action keyed only on the upper body, on a track over a run, aims while the
  legs run), and aim a bone with a Damped Track at an Empty the game moves.
  Other constraints and IK play only in Blender: bake them into the action. The
  console names any difference from Blender's own pose.
- Give every action that may play a fake user (`action.use_fake_user = True`):
  Blender drops an action nothing uses when the file saves, so an unassigned
  clip library vanishes on the next save.

## Characters

A character is two jobs, in this order: how it looks, then how it moves.

- Decide the look before modeling. With reference images, keep them beside
  the work; with none, write a short design sheet in Build Notes: silhouette,
  proportions (head height, shoulder and hip width), palette and the details
  that identify the character. Match the character to it at rest, front and
  side, before rigging.
- Start from a library rig of the same body plan and design the character on
  its joints: limb lengths and joint positions are the rig's, volume is free
  (a big helmet, bulky armor). Do not move the rig's bones; scaling the whole
  rig is the only change. Its actions are bone rotations, which break when
  bones move. No rig fits: build an armature and key a few short loops.
- Build the character in its own style. Do not shape it from the library's
  body mesh, which carries that body's proportions and topology; once its
  weights are transferred, delete it (hiding does not keep it out of every
  render, export or Play path).
- Set weights mechanically, never by hand: a hard piece (a plate, a helmet, a
  prop) is rigid on the one bone it sits on; a part that bends across a joint
  (an undersuit, cloth) takes its weights from the library body with a Data
  Transfer modifier. At most four influences per vertex.
- Check the motion the Blender way: assign each action
  (`animation_data.action`), scrub the Timeline to its extremes (arms
  overhead, a crouch, the end of a fall), capture the front and side, and read
  the console. A character needs no game to be checked; Play is for checking
  game behaviour.

## React UI

- Build HUDs, menus and screens as React components in `src/ui/`. A game's
  DOM root is `src/ui/game.tsx`; the playable template includes the required
  React/UI tools and manifest root. Existing projects need `react`, `react-dom`,
  `@volter/editor-ui` and `@volter/editor-react`, with compatible project versions.
  Declare the UI story region in `editor/volter.adapter.ts` (the playable template uses
  `regionIncludes.ui` for `src/ui/**/*.tsx`). Preserve the project's other content.
- Add `.stories.tsx` states and open them in the UI canvas: representative
  states such as normal, empty, error and active, with their captures and
  interactions inspected. Reveal the board with
  `editor.present({ version: 1, document: { kind: 'workspace', id: 'workspace:ui-components' } })`
  in eval; it appears after UI story discovery (read console errors if it is
  missing). A declared UI root alone does not supply stories.
- Give the intended initial state an explicit default and inspect opening the
  canvas without selecting a story. Keep previews deterministic and isolated:
  a timer in one preview must not advance it into another state or change
  another preview. Keep each state's entities, inventory and results
  consistent with the real game.
- For a game HUD, verify the same components over the running game against live
  game state. For standalone UI, verify its interactions in the UI canvas.

## Session controls

Drive this editor through its public SDK/CLI and project Blender MCP. Keep the
existing editor session and native Chat; private browser automation or a separate
browser profile would bypass the user's actual authoring experience. Work in
the project's source and assets. Diagnose and report failures in editor or
runtime dependencies to their owning repository; preserve installed packages
rather than patching them inside the project.

Source, manifest and reference edits reach the running editor through its
watchers. Inspect the current document and console before attempting recovery.
Open a model with `editor.open("model:src/models/example.blend")`; `openAsset`
opens generic assets such as images and audio, and its `"model"` kind does not
make a `.blend` the live Blender document. Closing the editor also ends its
hosted AI runtime and can abort your own turn; recover a document or page
through its scoped controls, and preserve the active conversation when
diagnosing a problem. Do not call `editor.reloadPage()` to reveal new
files, boards, references or scripts: a reload interrupts the editor and its
chat, so reserve it for an explicit request or a diagnosed problem.

The bottom area has two layouts, Game (the Game panel) and Movie (the
Timeline); they arrange the editor and do not change what plays. Play is
running the game.

Commands, all through `npx --no-install cyclotron`:

- `status`, `console [--all]`, `chat status`: the editor, its console and its
  AI session. `chat send "<prompt>"` sends to the visible conversation and
  `chat stop` stops its turn. Inspect the transcript and pending requests for
  the outcome; a dispatch receipt does not mean an edit is done.
- `eval '<JavaScript>'`: `return` what you need; `eval --list` lists what is
  available.
- `camera --position x,y,z --target x,y,z [--fov n]`: the open document's view,
  Blender metres, Z up. (In eval, `editor.present({ version: 1, viewport:
  { camera } })` takes stage space, Y up: a Blender point (x, y, z) is
  `{ x, y: z, z: -y }`.)
- `capture --region document|play|page [--name <words>] [--out file.png [--force]]`:
  what the person sees, saved (default under `.volter/captures/`) and shown in
  the editor's corner, captioned and named by `--name`. `document` is the
  active document with its overlays; `play` is the running game with its HUD.
- `add-play`: make a models project playable. `play-log`: the running game's log.
- The Game panel's controls, each printing its state: `play autoplay on
  <behaviour> [--for <seconds>]` and `play autoplay off`; `play pause` (no
  `update` calls; the game's clock stops) and `play resume`; `play step
  [count]` (one 1/60 s update of a paused game each); `play speed
  0.25|0.5|1|2|4` (scales the `dt` the script is handed); `play restart` (a
  fresh copy of the model, clock at zero); `play mode game|movie` (the layout).
- Timeline: `eval 'return await editor.command("volter.timeline.frame", { frame: 24 })'`
  moves the playhead.

If the project uses a Volter World, run app and test commands through that World.

Keep the project clean. Once the real document exists, remove the template
placeholder unless the person is using it: `cube.blend` and `cube.py` in a
models project; in a playable one, the Canyon Comet example (`src/models/canyon.*`
with the step scripts beside it, `course.ts`, `race-state.ts`, `src/textures/`
and the race UI in `src/ui/`). Put your
own helper scripts and evidence images under `.volter/scratch/`, not in the
project's source folders, and do not leave them behind as project files.
