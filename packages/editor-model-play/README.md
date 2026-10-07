# Volter Model Play

Play scripts on detached model documents. Play (the Game panel's, in the Model Editor) runs
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
`tick` (the update in progress). Facts are snapshotted as JSON when logged. `simT` and `tick` are the Game panel's
clock: they stand still while paused and run at the speed (see Time below). The
runner adds `play-start`, `play-restart` (`{ speed }`, right after a Restart's
`play-start`), `script-reload` (`{ reason: 'saved' | 'dependency-deleted', path }`),
`script-error` (`{ phase, message }`), `tint-unsupported` (`{ object, material, why }`),
`tint-unknown-object` (`{ object, call }`, once per name: `tint` or `setOpacity` was given a
name the model has none of, and did nothing), `autoplay-on` / `autoplay-off`
(`{ by: 'panel' | 'cli' | 'takeover' | 'script' }`, see Autoplay below),
`autoplay-unavailable` (`{ why }`, when a script's first update has run and it registered no
bot; once per run, and again only if a bot came and went),
`pause`, `resume`, `step` (`{ dt }`, one per stepped update), `speed`
(`{ speed, from }` on a change; `{ speed }` at a start that is not 1×) and
`play-stop` (`{ reason }`). Log transitions rather than every frame. Logging
never throws and never changes timing or state; a script's `log`, `tint` and
`setOpacity` do nothing once it has been replaced or Play has stopped.

Each model document keeps its own log; a read takes the active Play's unless it
names a document. The newest 5000 entries are kept (older ones are counted as
`dropped`), each entry's facts up to 2048 characters of JSON. Play from a fresh
copy, and Restart, empty the document's log; a script reload does not, and the log stays readable after Stop until the
next Play. `console.log` does not reach the session's console feed (only
warnings and errors do); the play log does.

```sh
volter-model-editor play-log                     # every kept entry, one per line
volter-model-editor play-log --kind death        # one kind
volter-model-editor play-log --since 12.5 --json # entries at or after simT 12.5, as JSON
volter-model-editor play-log --document <id>     # another model document's log
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
across a script reload. An object with a material the document cannot copy
(one the script made itself) is left as it is, and the log says so once with
`tint-unsupported`.

## Autoplay

A game offers its bot; the editor decides whether it drives.

```ts
play.autoplay(({ dt, simT, tick, keys }) => {
  // the game's own decision, from its own state
  return car.speed < 20 ? ['ArrowUp'] : [];
});
```

The controller is a plain function. While autoplay is on it is called before each `update`
with that update's `dt`, `simT` and `tick` (the stamps that update's log entries carry) and
`keys`, the keys the person holds; it returns the `KeyboardEvent.code` keys the bot holds for
that update (any iterable, or nothing). The runner merges them into `play.keys`, so the bot
drives through the script's own input code exactly as a person does. One bot per script:
registering again replaces it, `play.autoplay(null)` withdraws it, and it goes with the script
on a reload or Stop. The bot is called only inside the editor's Play runner; a game run
anywhere else never drives itself.

Whether it drives is the editor's:

- Autoplay is **off** whenever Play starts or restarts.
- Only the Game panel's **Autoplay** toggle, `volter-model-editor play autoplay on|off` or
  `await editor.command('volter.model-play.autoplay', { on: true })` turn it on (or off).
- **A bot exists only while the game runs**: `play.autoplay` is called by the play script, so
  a stopped game (or one still starting) has none, and neither has a running script that never
  registers one. The panel says which, in words beside the toggle — "Available once the game is
  running" or "No autoplay — this game doesn't provide a bot" — and `on` is refused with the
  same reason, which `play state` also gives as `autoplay.why`.
- **Arming.** Pressed while stopped, the panel's Autoplay arms the next start: autoplay turns
  on (`by: 'panel'`) as soon as that run's script has run its first update with a bot, and the
  arm is dropped if it offers none. A person's key or click in the game before then drops it
  too (`autoplay-off` with `{ by: 'takeover', armed: true }`): the person always wins. Only an
  explicit arm carries over; Stop, and closing the model, drop it.
- **The person always wins.** A new key press the game would hear, or a pointer pressed in the
  game's area (the HUD included), turns autoplay off before that key reaches `play.keys`, and
  the panel reads "You're driving" until someone switches the bot on again. Synthetic keys and
  clicks (`editor.document.key`, `click`) count as a person's: they are how an agent plays by
  hand. A key repeat is not a new press; keys typed in a text field, or while the game's surface
  does not hold the keyboard, are not the game's and do not take over.
- A bot that throws turns autoplay off (`by: 'script'`, with a `script-error` of phase
  `autoplay`), as does a reload whose script offers no bot.

Each change is a play-log entry, `autoplay-on` or `autoplay-off`, with `by`.

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
When the run plays but no game runs — the script failed to start, or threw — the clock's
`failure` says why (the Game panel shows it in place of "Playing"); a save of the script
retries, and the next running game clears it.

## Controls

The tool registers the `model` document Play extension
(`@volter/editor-sdk/kit/document-play-extension`). Beside Play and Stop it offers:

- `transport` — `setPaused`, `step`, `setSpeed`, `restart`, the `clock` and its own
  subscription, the offered `speeds`, and the restart `generation` the document keys its
  detached copy on.
- `transport.autoplay(documentId)` and `transport.setAutoplay(documentId, on, by)` — the bot's
  switch: `{ on, available, by, armed }`, announced through `subscribeClock`;
  `transport.armAutoplay(documentId, armed)` arms it, while stopped, for the next start.
- `log` — `tail(documentId, last, kind?)` (the newest entries and every kind the run wrote) and
  `subscribe`, which the Game panel draws live.
- `scriptPath(sourcePath)` and `hasScript(sourcePath)` — where a model's play script goes and
  whether it exists, so a layout can open a model with a script as a game.

In the Model Editor these are drawn by the Game panel (`@volter/editor-blender`): the Game /
Movie switch at the left of the bottom area's header puts it there in place of the Timeline. The panel's controls
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
| `volter.model-play.autoplay` | `{ on: boolean }` — the game's bot drives, or the person does |

Each takes an optional `document` (the model document's id) and otherwise acts on the model
document on screen; each answers with the panel's state. From the shell:
`volter-model-editor play pause`; under `eval`:
`await editor.command('volter.model-play.speed', { speed: 0.5 })`.
