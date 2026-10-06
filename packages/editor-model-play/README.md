# Volter Model Play

Play scripts on detached model documents. The header's Play runs
`src/models/<name>.play.ts` beside `src/models/<name>.blend` on a detached copy
of the model; the model, its selection and its history stand as they were, and
Stop returns to them. The script's default export is called once with the play
context (`ModelPlayContext`, `src/play-script.ts`) and answers the game:

```ts
import type { ModelPlayContext, ModelPlayGame } from '@volter/editor-model-play/play-script';

export default (play: ModelPlayContext): ModelPlayGame => {
  const player = play.find('Player')!;
  let checkpoint = false;
  return {
    update(dt) {
      player.position.y += dt;
      if (!checkpoint && player.position.y > 10) {
        checkpoint = true;
        play.tint('Checkpoint.Pad', '#2bff6b');
        play.log('checkpoint', { stage: 2, at: player.position });
      }
    },
  };
};
```

## The play log

`play.log(kind, facts?)` writes one entry, stamped with `simT` (seconds of
simulation since Play started, the sum of the `dt`s given to `update`) and
`tick` (the update in progress). Facts are snapshotted as JSON when logged. The
runner adds `play-start`, `script-reload` (`{ reason: 'saved' | 'dependency-deleted', path }`),
`script-error` (`{ phase, message }`) and `play-stop` (`{ reason }`).
Log transitions rather than every frame. Logging never throws and never changes
timing or state.

The newest 5000 entries are kept (older ones are counted as `dropped`), each
entry's facts up to 2048 characters of JSON. Play from a fresh copy empties the
log; a script reload does not, and the log stays readable after Stop until the
next Play. `console.log` does not reach the session's console feed (only
warnings and errors do); the play log does.

```sh
volter-model-editor play-log                     # every kept entry, one per line
volter-model-editor play-log --kind death        # one kind
volter-model-editor play-log --since 12.5 --json # entries at or after simT 12.5, as JSON
volter-model-editor eval "(await editor.modelPlayLog({ kind: 'death' })).entries"
```

## Recolouring the copy

`play.tint(object, color)` draws an object (a name, or what `find` answered)
and every mesh under it in `color`; an emitting surface glows in it, and an
image texture is multiplied by it. `play.setOpacity(object, opacity)` fades it.
`null` returns the authored look. Other objects wearing the same Blender
material are not affected.

Use these instead of editing materials directly: a presented mesh's `material`
is an array with one `MeshPhysicalMaterial` per Blender material slot, shared by
every object with that material; the presenter re-assigns those slots whenever
it re-applies shading; `clone()` drops its shader hooks; and a node graph that
drives Base Color or Alpha ignores `color` and `opacity`. A tinted or faded
object wears copies of its own slots that draw the material's constant inputs
(so a node graph's other inputs are not drawn while it does), and keeps them
across a script reload.
