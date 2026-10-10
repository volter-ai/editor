# One animation system: the scene's animation, baked by Blender, played by three.js

Status: proposal. It replaces two partial systems that grew side by side (#383 and #385), and the
Timeline's character-only clock.

## Why

A short film authored in a `.blend` (cameras and props keyed on the Timeline, shots cut by markers
bound to cameras, no armature of its own) could not be watched in the editor:

- **The Timeline would not play.** Its clock is read through an armature: `BlenderSkinDirector.sync`
  reads the clip header only `if (armature)`, and `playable` is `#clip !== null && #transport !==
  null`. A scene with no armature has no clip, so every control refuses with "No scene transport
  is attached yet". `main` has the same code; character files always have an armature, which is
  why it was never seen.
- **It would not animate the film if it did.** A scrub or a played frame poses armatures on the
  mixer and nothing else. Keyed objects and cameras move only when the settled frame is written
  back to Blender (on pause), and nothing cuts between the markers' cameras.
- **The film's animation does play, but somewhere else.** `play.sequence` / `play.cutscene` sample
  every animated object and camera (`session.py` `_sample_object`, `_sample_camera`,
  `rna_scene_movie`) and play them on a mixer with camera cuts (`blender-play-movie.ts`). That
  path runs only in Play.

So there are two players: armature clips (`_three_bones` → `MixerPose`, the Timeline and Play)
and object/camera clips (the scene movie, Play only). Neither plays a light, a material value, a
shape key or a visibility key. The editor checks one thing and the game ships another.

## What other tools do

| | Blender | Unreal | Unity | Godot | three.js |
|---|---|---|---|---|---|
| Clock | one scene frame | the sequence's time | the director's time | the player's time | the mixer's time |
| A clip | an Action: F-Curves by data path, any property | a Level Sequence: tracks bound to actors' properties | an AnimationClip: curves by object path and property | an Animation: tracks by node path and property | an AnimationClip: tracks by object name and property |
| Layering | NLA → active action → drivers, constraints | sub-sequences, Anim Blueprint | Playables graph, Animator | AnimationTree | weighted actions |
| Camera cuts | markers bound to cameras | Camera Cuts track | Cinemachine track | a track on the camera | none of its own |
| Events | markers | event track | signal track | method-call track | none of its own |
| Editor and game | one evaluator | one asset | one graph | one player | — |

They agree on six things, and this design takes all six:

1. One clock per scene (or sequence).
2. A clip is tracks, each addressed to a target and a property. A bone is not special; it is one
   more target.
3. A binding layer resolves the addresses on whatever copy plays (the document, Play's copy, an
   export), so one clip plays on any of them.
4. One evaluator blends everything. The editor's scrub and the game's frame are the same code.
5. Camera cuts and events are tracks.
6. Character logic (state machines, a game's `setAction`) sits on top as layers, not beside it.

## The design

### 1. One bake: the scene's animation, as three.js clips

Blender samples every animated datablock in the scene into `THREE.AnimationClip`s whose tracks are
`PropertyBinding` paths (sampled at every integer frame with `FCurve.evaluate`, as `_three_bones`
and `_sample_object` do now; three.js interpolates between):

| Blender | Track path (on the presented graph) |
|---|---|
| a pose bone's local transform (rest-relative, as `_three_bones`) | `<bone>.position` / `.quaternion` / `.scale` |
| an object's transform | `<object>.position` / `.quaternion` / `.scale` |
| visibility (`hide_viewport`, `hide_render`) | `<object>.visible` (step) |
| a camera's lens, sensor, clip planes | `<camera>.fov`, `.near`, `.far` (projection updated after apply) |
| a light's energy, colour | `<light>.intensity`, `.color` |
| a material's keyed input (base colour, emission, alpha) | `<mesh>.material.color`, `.emissive`, `.opacity` |
| a shape key's value | `<mesh>.morphTargetInfluences[<key>]` |

Each action becomes one clip per bound datablock (Blender 4.4+ slotted actions: one clip per
slot). Each NLA strip becomes a weighted, time-mapped action, as `blender-pose.ts` places them
now. What Blender evaluates but cannot hand over as curves (drivers, constraints other than
Damped Track, IK, simulation caches) is baked into the sampled tracks for the frames the scene
uses, and the console names each baked channel once, so a difference from Blender's own pose is
never silent.

One read (`rna_scene_animation`) returns the whole bake. It is cached per action revision, as
action clips are now, so editing one action re-bakes only that action.

### 2. One mixer per presented scene, on one clock

The presenter's graph gets one `AnimationMixer`. The scene clock (`frame_current`, the range,
the rate) is the mixer's time. It is read from the scene, not from an armature, so a scene with
no armature has a clock, a range and markers.

- The Timeline drives that clock. A scrub or a played frame sets the mixer's time: zero calls into
  Blender, as now. Blender's `frame_current` is still written once, on pause and at scrub-end.
- Play's copy runs the same mixer on the game's clock. `play.setAction`, `play.setTrack`,
  `play.sequence` and `play.cutscene` become actions and weights on it, not separate players.

### 3. Camera cuts and events are tracks

- Markers bound to cameras become a camera-cut track: at each frame the drawn camera is the
  marker's camera. It is the view the Timeline shows in the camera view (`view3d.view_camera`),
  the one a cutscene looks through, and the one render-movie photographs.
- Named markers become events. The Timeline lists them; a game hears them (`play-log --kind
  cutscene` already logs the ones a sequence crosses).

### 4. The Timeline is scene-level, as Blender's

It shows the scene's range and markers, and the keys of the selected object of any kind (an
armature's action, an object's transform keys, a camera's lens keys), with or without an
armature in the file. `playable` is "a scene transport is attached", nothing more.

### 5. Export carries the same clips

The web export writes the bake as it is (`movie.json` on `feat/export-sequences` today becomes the
whole scene bake). A glTF export maps it onto node animation channels and `KHR_animation_pointer`
for the properties beyond transforms, so a Godot or Unity export plays the clips the editor
played.

## What it replaces

| Now | Becomes |
|---|---|
| `BlenderSkinDirector` (armatures only, clock read through an armature) | the scene mixer's Timeline driver |
| `MixerPose` per armature, `blender-play-skin.ts` | bone tracks on the scene mixer |
| `blender-play-movie.ts`, `packages/play/src/play-movie.ts` | object, camera and cut tracks on the scene mixer |
| `rna_action_clip`, `rna_scene_movie` | `rna_scene_animation` (the action door stays for the Action Editor) |

The fidelity check stays: standing still at Blender's own frame, the mixer's answer is compared
with Blender's pose bone by bone (`poseDivergence`), and object by object.

## Order of work

1. The scene clock without an armature: the Timeline gets its range, markers and transport from
   the scene. A scene with no armature can scrub and play (its armatures, if any, as now).
2. Object, camera, light and visibility tracks on the Timeline's mixer, from the bake; the camera
   view follows the camera-cut track. The film plays in the viewport.
3. Bones join the same bake and mixer; `MixerPose` and the scene movie player retire.
4. Play runs its copy on the same mixer; `play.*` become actions on it.
5. Materials and shape keys.
6. Export: the web export writes the bake; glTF maps it.

Each step ships on its own and is checked the Blender way: open the file, scrub the Timeline to
its extremes, play it through the camera view, read the console, and compare a still with
Blender's own frame.
