# Levels: a game made of several Blender scenes

Status: proposal. Today a game is one `.blend`: Play runs the open document's scene and nothing else.

## Why

- **A game cannot change level.** Play detaches one copy of the open document
  (`BlenderRuntimeView.detach()`: a view built from the document's current frame) and runs the play
  script over it. The play API has no way to load another scene. Heck Plungers fakes its planets by
  re-dressing one map in script (`dressBiome`), and draws its title, ship and loadout as UI over that
  same scene.
- **A film had nowhere to go.** The recruitment film is its own file (`film-intro.blend`), as a
  production keeps one. To play it in the game it would have had to be linked into the gameplay map
  and parked far away, which is the wrong structure: a cinematic is a level of its own.

## What other engines do

| | Unreal | Unity | Godot |
|---|---|---|---|
| A level | a Level (`.umap`), with streamed sub-levels | a Scene (`.unity`) | a scene (`.tscn`) |
| Changing level | `OpenLevel`, or streaming sub-levels in and out | `SceneManager.LoadScene`, single or additive | `change_scene_to_file`, or instancing a scene |
| State that survives | the GameInstance | `DontDestroyOnLoad` objects | autoload singletons |
| In a build | levels are cooked; the build lists them | scenes are built; Build Settings lists them | scenes are exported resources |
| Loading ahead | async level streaming | `LoadSceneAsync` | `ResourceLoader.load_threaded_request` |

All three agree:
1. A level is a file of its own.
2. The game loads one by name, either replacing the current one or alongside it.
3. Game state lives outside the level and survives the change.
4. A level is cooked into what the runtime loads, so the runtime never needs the authoring tool.
5. The next level can load in the background.

## The design

### 1. A level is a Blender scene

Every scene of every `.blend` in the project is a level, named `<file>` (its active scene) or
`<file>/<scene>`. That is Blender's own unit: a file may hold several scenes, and a production keeps
a film, a set or a map in its own file. Examples: `film-intro`, `mission`, a `ship.blend`, one
`.blend` per planet's map, `training`.

### 2. A cooked level is the web export's dump

The web export already cooks one level. `blender-export-play` writes the model's frame, every
armature's clips baked, the scene's movie, its display transform and camera into
`.volter/export/web/`, and `web-player.ts` plays from those files with no Blender. That is exactly a
cooked level. This design generalises it:

- **One dump per level** in `.volter/levels/<level>/` (`frame.json`, `clips.json`, `movie.json`,
  plus the scene bake of `docs/SCENE-ANIMATION.md` once it lands), keyed by the file's content hash,
  so a level is re-cooked only when its file changed.
- **Cooking happens in the editor's Blender**, outside Play: whenever a level is open (on open
  and on save), and for a stale level by opening, cooking and returning (see "How a level is
  cooked").

### 3. The game loads levels by name

```ts
await play.load('film-intro');               // replace the current level
await play.load('ship', { preload: true });  // fetch and build in the background, show later
play.level();                                // the level now playing
```

- **Replace:** the current level's view is disposed. The cooked level's frame becomes a new view,
  built the way `detach()` builds one. Its clips and movie are bound, and its camera, markers and
  sequences become the ones `play.*` acts on.
- **Preload:** the build happens in the background. The switch is instant when the game asks for it.
- **The script survives.** One play script runs the whole game, and its module state (the career,
  the loadout, the squad) carries across loads, as Unity's `DontDestroyOnLoad` or Unreal's
  GameInstance. The script hears `onLevel(name)` after each load.
- **The starting level** is the open document in the editor (as today), and the manifest's
  `play.start` in an export.

Additive loading (a sub-level streamed into the current one, Unreal's sub-levels) is left for later;
replace and preload cover the intro, the ship, the planets and training.

### 4. The editor shows what plays

While a game runs, the play area shows the level the game is in; the Game panel names it, and the
play log records each load (`level`, with its name and how long it took). Stopping Play returns to
the document being edited.

### 5. Export bundles every level

`cyclotron export web` cooks every level the game can reach (the manifest lists them, as Unity's
Build Settings and Unreal's maps-to-cook list do), copies each dump under `data/levels/`, and the web
player loads them by name.

## How a level is cooked (settled by experiment)

A level other than the open document cannot be read in place. Measured 2026-10-09 from
`helldiver.blend` against `film-intro.blend`:

- Linking the other file's scene works (`bpy.data.libraries.load(..., link=True)`), and removing
  the library afterwards leaves the session as it was.
- But the export door runs only inside a render, on the RENDER depsgraph ("render export requires
  the render engine's RENDER depsgraph"). A scene not shown in a window has no viewport depsgraph
  either (`view_layer.depsgraph` is None).
- Rendering the linked scene through the three.js engine would need its render engine set to it. A
  linked scene is read-only, and making it writable means an override inside the person's file.

So a level is cooked in one of two ways:

1. **While it is open (free).** Opening or saving a level in the editor writes its dump from the
   frame the editor already holds, as the web export's dump step does today. Editing a level keeps
   its cook current.
2. **Open, cook, return (for a stale level).** When the game needs a level whose file changed since
   its cook, the session opens that file, cooks it and reopens the document. The editor says so
   while it runs (it takes seconds on a large file). This happens only for changed files, and
   `cyclotron levels cook` does it for every level up front.

Still to measure: a full frame's size and build time when loaded during Play, which sets how much
preloading the game needs (`mission.blend`'s frame is several megabytes).

## Order of work

1. Cooked levels: the dump per level, written while a level is open and keyed by file hash;
   open-cook-return for stale levels; `cyclotron levels cook`.
2. Measure a full frame's load and build time during Play.
3. `play.load` (replace), `play.level`, `onLevel`, in the editor's Play.
4. Preload.
5. Export: every reachable level cooked and bundled; the web player loads by name.
6. Heck Plungers: the intro becomes `play.load('film-intro')` then `play.load('mission')`, and the
   boot video goes.
