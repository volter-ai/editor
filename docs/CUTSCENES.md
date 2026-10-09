# From the movie to the game: cutscenes in Model Play

A `.blend` holds two things a game can use: its objects, and its own animation — the movie the
bottom area's Animation side (the Timeline) plays. Model Play has always run the objects; with
`play.cutscene` (`@volter/play`, see `packages/play/README.md`, "Cutscenes") it runs the movie
too, so a cutscene authored in Blender plays inside the game and hands control back to the play
script.

## Authoring

Author the cutscene in the file, as for a render:

- Key cameras and objects (location, rotation, scale; a camera's focal length and sensor), or
  put actions on their NLA tracks. Armatures play their NLA strips and assigned action.
- Cut between cameras with markers bound to them (select a camera, then Marker ▸ Bind Camera to
  Markers). Without bound markers the scene camera is used.
- Name markers for the beats a script needs: where the cutscene starts and ends, and lines a
  script may subtitle.

The Timeline previews exactly what the game will play.

## The hand-off

1. **Loading.** When Play starts, the document reads the scene's movie from Blender once (the
   `scene-movie` door, `session.py`'s `rna_scene_movie`) beside the characters' starting clips:
   the scene's range, rate and camera, the markers and their cameras, what each collection holds,
   and every animated object's transform (and every keyed camera's projection) sampled by Blender at
   every scene frame (`FCurve.evaluate`). No frame is moved in Blender to read it.
2. **The cutscene.** `play.cutscene('Intro', { end: 'Gameplay' })` holds the scene at a frame
   that advances on the game's clock (pause, step and speed hold it too). Each update the
   document poses its copy at that frame on three.js's own `AnimationMixer`
   (`blender-play-movie.ts` for objects and cameras, `blender-play-skin.ts` and
   `blender-mixer-pose.ts` for armatures, as the Timeline plays them), and after the script's
   update the runner looks through the movie's camera at that frame.
3. **The game's turn.** The script's `update` keeps running, so it decides when to skip; its
   camera is overwritten while the movie owns it.
4. **Back to the game.** At the span's end (or `stop()`), armatures return to what the game set
   them to, objects stay where the movie left them, the camera's own settings come back, and the
   camera blends from the movie's last shot to the pose the script states (`blend` seconds,
   using the same `camera-transition.ts` that blends Play's entry and exit).

Every step is in the play log as a `cutscene` entry (`start`, `cut`, `marker`, `end`), so
`cyclotron play-log --kind cutscene` shows what played and when.

## Sequences: the movie inside the game

`play.sequence(span, { collection, at, anchor, camera })` plays the same movie for what happens
inside the game rather than instead of it: a set piece the player runs through, an ultimate
attack, an emote. Only the objects and characters of `collection` move (the rest stay the
game's); with `at` (a game object) the collection is carried so its anchor (an Empty, default
`<collection>.Anchor`) stands where that object stands, turned as it is turned, still props
included; the camera stays the script's unless `camera` is `true` (the marker cuts) or names one.
The span's markers are its events (`onMarker`): an attack's hit frame is a marker the script deals
damage on, so moving the hit in Blender moves the damage with it.

## Not played

Sound, subtitles (a script may draw its own at markers: `play.markers()`, `onMarker`), object
constraints other than Damped Track and Track To, drivers, keyed delta transforms, an object's NLA
layering (its active action, else its top strip, plays), and parenting to a bone or vertex (held at
the offset it has when Play starts). Between Blender's frames three.js interpolates. Each is named once in the
console when Play starts.
