# Web export: a model's game as a static page

`cyclotron export web` turns a Blender-based Play game (a `.blend` and its `.play.ts`, with the
project's `dom` UI roots) into a folder of static files: `index.html` and its assets. The page
plays in any browser from any static host. It contains no editor UI, and Blender does not run
in it.

```sh
npx --no-install cyclotron edit .            # the editor, with the model whose game you export open
npx --no-install cyclotron export web . --out dist/web
npx serve dist/web                           # or any static host
```

| Flag | Meaning |
| --- | --- |
| `[folder]` | The project, or a folder inside it (default: the working directory). |
| `--out <dir>` | Where the page is written (default `<project>/dist/web`). An earlier export there is replaced. A folder that holds anything else is refused. |
| `--document <id>` | The model document to export (default: the model on screen). |
| `--no-dump` | Build from the dump already in `.volter/export/web/` instead of asking the editor for a new one. |

## What it does

1. **The dump.** Blender runs in the editor tab, so the CLI asks the running tab for the game
   with the `blender-export-play` verb (`@volter/editor-blender`'s
   `contributions/blender-export.command.ts`). The tab writes three files into the project's
   ignored `.volter/export/web/`:
   - `scene.frame.bin` holds the model exactly as Play's detached copy is built from it
     (`BlenderRuntimeView.exportFrame()`): meshes with their skins and draw-vertex maps,
     armatures with their NLA, materials with their node graphs, image bytes, lights, cameras and
     the World. It uses a binary-safe frame file (`web-export/frame-codec.ts`): the JSON tree,
     with every typed array moved into one binary section after it.
   - `clips.json` holds every action baked for every armature, the bake Play itself reads from
     Blender (`blenderActionClip`). Armatures with the same bones share one bake per action
     unless the action has several object slots, which is how Play's clip cache shares them.
     Each bake holds Blender for about 1.5 s, so a file with many skeletons and actions takes a
     few minutes. A clip that could not be read is listed in the CLI's output.
   - `export.json` names the model and its play script, Blender's display transform for the
     scene (`view_settings`), the scene camera and the project's `resolution`.
2. **The page.** The CLI writes an entry beside the dump. It is modelled on the game editor's
   standalone boot (`packages/game-editor/template/src/main.ts`). The entry imports the play
   script and each `dom` root of `volter.project.json`, then calls `bootWebPlayer`
   (`@volter/editor-blender/web-export/web-player.ts`).
3. **The build.** The CLI runs the project's own Vite in production mode (`base: './'`). Workers,
   OCIO tables and other assets the engine loads through `new URL(…, import.meta.url)` are emitted
   like any import. The project's `public/` is copied, and the dump's frame and clips go into
   `data/` beside `index.html`.

## What the page does

It follows the editor's Play, step by step:

- **The scene.** A `BlenderRuntimeView` built with `applyFrame` from the exported frame, which is
  how `detach()` builds Play's copy. It is held in Blender's Rendered shading with render
  visibility (`holdRendered(…, 'render')`) and prepared before the first frame
  (`prepareRendered`).
- **The camera.** It starts as the scene camera fitted to the project's `resolution`. From then on
  it belongs to the script, as in the editor.
- **Animation.** Play's own evaluator (`playAnimation`, `blender-pose.ts`) poses the
  characters. Its clip lookup answers from `clips.json` instead of Blender.
- **The script.** `@volter/play`'s host-free runner (`play-runner.ts`) runs it. The script gets
  the same `ModelPlayContext` the editor builds (`play-context.ts`): `find`, `camera`, `keys`,
  `log`, `tint`, `setOpacity`, `autoplay`, `setAction`, `setTrack`, `setConstraint` and
  `actions`. Each frame is split into updates of at most 0.1 s. Each update advances the clips by
  its `dt` and then calls `update(dt)`. The material copies are kept after the updates.
- **The draw.** `refreshRendered` and `prepareDraw` run for the posed camera. Then the scene is
  drawn into a 4× multisampled half-float target, and Blender's display transform
  (`BlenderDisplayTransform`) maps it onto the canvas. This is the editor's Rendered viewport.
- **The UI.** Each `dom` root is mounted with react-dom in its own layer over the canvas, stacked
  by `zOrder`. Pointer events fall through to the game except where the UI's own elements claim
  them. The script and the UI are one bundle, so they share module instances (a store both
  import), as they do in the editor.
- **Input.** Keys come from the window by `KeyboardEvent.code`. Pointer events and pointer lock
  belong to the game's own listeners. Escape belongs to the game: there is no editor for it to
  stop.
- **Layout.** The stage keeps the project's `resolution` aspect inside the window, with black
  bars, as the editor's play area does. The canvas draws at the stage's size in device pixels,
  at most 2×.

`window.__volterExport` holds the view, runner, camera, renderer and the count of frames drawn,
for a look from the console. `__volterExport.runner.log()` reads the play log.

## What the editor has and the page does not

- The Game panel's transport: pause, step, speed and restart.
- Reloading on save.
- The camera's blend into and out of Play.
- Autoplay: a game offers its bot with `play.autoplay`, and nothing drives it.
- The world-volume photograph pass. The editor's live Play does not draw it either.
- A project stylesheet served through the editor's scoped game CSS. The UI layers carry the scope
  attribute, so a game that imports its CSS from its UI modules is styled as in the editor.
