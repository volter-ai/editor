# @volter/editor-model-play

Play scripts on detached model documents.

A model's play script is an ordinary project file beside its `.blend`:
`src/models/track.blend` plays `src/models/track.play.ts`. Play detaches a copy of the
model, and the script's default export moves that copy; the model, its selection and its
history stand as they were, and Stop returns to them.

```ts
import type { ModelPlayContext, ModelPlayGame } from '@volter/editor-model-play/play-script';

export default (play: ModelPlayContext): ModelPlayGame => ({
  update(dt) {
    play.find('Car')!.position.x += dt;
  },
});
```

## Time

`update(dt)` is the only clock a play script is given, and the editor decides it:

| Control | What the script sees |
| --- | --- |
| Playing at 1× | One `update` per drawn frame, `dt` = the frame's seconds (at most 0.1). |
| Speed 0.25× – 4× | `dt` scaled by the speed. A scaled frame longer than 0.1 s is split into equal updates, so no single `dt` exceeds 0.1. |
| Pause | No `update` at all. The copy, the camera and the HUD hold the last frame. |
| Step (while paused) | One `update` with `dt` = 1/60. |
| Restart | The run begins again on a fresh detached copy, the clock at zero, without the camera's fly-in. |

A script that reads the page's own clock (`performance.now()`, `Date.now()`) instead of
summing `dt` is outside the reach of pause and speed.

The run's clock — simulation time (the sum of the `dt`s handed to the script) and tick (the
number of updates) — is kept per document beside whether it plays (`src/model-play.ts`).
Speed is kept for the page's life; pause and the clock reset on every Play.

## Controls

The tool registers the `model` document Play extension
(`@volter/editor-sdk/kit/document-play-extension`). Beside Play and Stop it offers:

- `transport` — `setPaused`, `step`, `setSpeed`, `restart`, the `clock` and its own
  subscription, the offered `speeds`, and the restart `generation` the document keys its
  detached copy on.
- `scriptPath(sourcePath)` and `hasScript(sourcePath)` — where a model's play script goes and
  whether it exists, so a layout can open a model with a script as a game.

In the Model Editor these are drawn by the Game panel (`@volter/editor-blender`): the header's
Game / Movie switch puts it in the bottom area in place of the Timeline. The panel's controls
are also commands, `volter.model-play.<verb>`, so an agent drives the same run the person
sees:

| Command | Arguments |
| --- | --- |
| `volter.model-play.state` | — |
| `volter.model-play.play` / `stop` | — (`play` also switches the document to Game mode) |
| `volter.model-play.pause` / `resume` | — |
| `volter.model-play.step` | `{ count?: 1–600 }`, while paused |
| `volter.model-play.speed` | `{ speed: 0.25 \| 0.5 \| 1 \| 2 \| 4 }` |
| `volter.model-play.restart` | — |
| `volter.model-play.mode` | `{ mode?: 'game' \| 'movie' }` |

Each takes an optional `document` (the model document's id) and otherwise acts on the model
document on screen; each answers with the panel's state. From the shell:
`volter-model-editor play pause`; under `eval`:
`await editor.command('volter.model-play.speed', { speed: 0.5 })`.
