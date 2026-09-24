# Detailed VGAI game project reference

This is the procedural reference behind the compact project `AGENTS.md`
router. Load only the section the current decision needs. The source files
named here are the examples an agent should copy; no hidden generator or
registry supplies their semantics.

## Contents

- [Starting a game](#starting-a-game)
- [Roadmap and journal](#roadmap-and-journal)
- [Source architecture](#source-architecture)
- [Playable slices](#playable-slices)
- [The resident QA tester](#the-resident-qa-tester)
- [Studio surfaces](#studio-surfaces)
- [Analytics and gameplay sessions](#analytics-and-gameplay-sessions)
- [Game data](#game-data)
- [UI roots](#ui-roots)
- [Capabilities and assets](#capabilities-and-assets)
- [Multiplayer](#multiplayer)
- [Live verification](#live-verification)

## Starting a game

Read the brief, create the first `ROADMAP.md` arc, inspect
`vgai.project.json`, then start the editor immediately:

```bash
npm run dev
```

Tell the user the printed URL in the first visible message and keep that
session running. The editor is where the source is observed and verified;
source edits remain ordinary file edits. `npm run dev:standalone` serves only
an exported build and is not a development bypass.

Study the closest shipped example before inventing a structure:

```bash
npm run --silent vgai -- examples
npm run --silent vgai -- create study --example <id>
```

The study project is a disposable copy. Never put a user game in the engine
repo's `examples/` directory.

## Roadmap and journal

`ROADMAP.md` is the only game-level tracker. Its first entry is the complete
playable prototype from the brief, not one task per mechanic, UI, tool, or
test. Later entries are only major features of comparable scope. Each entry
has one `status:` and one `Summary:`; do not add acceptance criteria yet.
`ztrack check` verifies this shape.

`DEVLOG.md` is not another tracker. Add one entry when a coherent feature arc
finishes, covering what changed, why, important decisions, the live playtest
outcome, and what remains. Link only evidence you inspected. Copy selected
screenshots into `media/screenshots/` and selected short clips into
`media/clips/`; bounded `.vgai/` history is working material, not a permanent
journal attachment.

## Source architecture

Read `vgai.project.json` and `src/main.ts` first. Every manifest root has one
adapter and lifecycle. Its entry is the source document: TSX for a Three or
Canvas root, JSX for a DOM root. Do not call `createRoot`, `hydrateRoot`, or
`ReactDOM.render` inside a root component; host mounting belongs to the
adapter boundary.

The neutral Three starter demonstrates the complete taxonomy:

```text
src/world.tsx                         thin persistent root + scene swap slot
src/scenes/MainScene.tsx              complete replaceable composition
src/prefabs/HeroBox.tsx               independently placeable object
src/prefabs/HeroBox.stories.tsx       Content registration/design state
src/components/environment/Ground.tsx non-placeable support assembly
```

Preserve the meanings when replacing the starter content:

- A scene composes environment, prefabs, and cameras. It is not a Content
  prefab and does not hide independent repeated entities inside scenery.
- A prefab is a thing a designer selects, places, duplicates, or reuses as one
  piece. It accepts ordinary `ThreeElements[...]` props, forwards them to one
  native outer root, has meaningful node names, and ships a colocated story
  naming it as `meta.component`.
- Construction pieces that only make sense as part of a prefab stay inside
  that owner. Do not create a prefab per primitive.
- Supporting components are non-placeable implementation: sky, atmosphere,
  a one-per-scene floor assembly, a light rig. They belong under
  `src/components/` and do not receive hollow stories.
- A character is the rigged humanoid-generator asset path, never a stack of
  capsules and boxes.

`check-idioms` makes the objective edges loud: E10 for a prefab without its
story, E11 for scene-folder misclassification, E9 for R3F authoring warnings,
and W10 when a Three project has no registered prefab at all. W10 is a prompt,
not a claim that fully procedural games are impossible; record and suppress a
genuine exception with a reason.

The world node is the entity. Behavior on an R3F root is an ordinary React
component using `useFrame`; physics is ordinary `@react-three/rapier` JSX.
Use the ecosystem library directly. No mirror tree, gameplay registry, or
vgai phase vocabulary belongs in game code.

## Playable slices

Ship one vertical slice at a time. A mechanic slice includes all of:

- the player-visible behavior;
- the rendering/HUD required to read it;
- an ordinary exported state readout beside the mechanic;
- an ordinary exported setup function when reaching a QA situation costs
  roughly more than 30 seconds of honest play;
- a tester behavior that exercises the mechanic through normal input;
- any game-specific Tester/Data/Analytics presentation the slice earns;
- a live playtest, reviewed visual evidence, and a commit.

The exported function is the debug door. There is no command registry:

```ts
// src/sim/cooling.ts
export function readCooling() {
  return { temperature, capacity, throttled };
}

export function setupHeatSpike() {
  // Arrange the expensive precondition only. Do not perform the behavior
  // the tester is meant to exercise.
}
```

The developer reaches that exact running module from the session:

```js
game.run(async ({ modules }) => {
  const cooling = await modules('src/sim/cooling.ts');
  cooling.setupHeatSpike();
  return cooling.readCooling();
})
```

Do not press the player's controls from the developer REPL in a realtime game.
The developer arranges and observes; the resident tester holds the controller
at simulation speed. A genuinely turn-paced action is the narrow exception
where developer-paced input can still be honest.

## The resident QA tester

The tester is ordinary game code under `src/bot/`, not an LLM service and not
gameplay automation that belongs to the shipped player's economy. It is the QA
person holding this game instance's controller.

The starter demonstrates the mechanics without standardizing the game's
vocabulary:

- `src/input.ts` is the game's own input store. Human key bindings and virtual
  tester actuation merge into the same action reads.
- `src/bot/behaviors.ts` is the game-specific repertoire. Replace the starter
  `sweep` with intent-level goals named for real outcomes and grow it with
  every mechanic.
- `src/bot/tester-station.ts` exports `hireTester`, `describeTester`, and the
  sim-tick stepper.
- `src/bot/bot-station.ts` exports status plus pause, resume, abort, and
  handoff controls.
- `src/bot/QaTester.tsx` is the thin frame hook that steps the tester before
  gameplay reads input.

A tester behavior actuates only `ctx.hands` and reads the game's own state. It
never teleports, buys resources directly, or calls setup functions. A setup
function may establish the hard-to-reach state before the goal begins; the
goal must still play the behavior under judgment normally.

Handoff releases virtual input and returns the controller to the human.
Pause, refusal, a goal that completes within one paint, blockers, and terminal
outcomes must all narrate themselves on the Tester surface and in the play
log.

## Studio surfaces

`src/contributions/` contains this game's editor panels. Contributions are ordinary
TSX discovered by filename (`*.inspector.tsx`, `*.document.tsx`,
`*.utility.tsx`, `*.analytics.tsx`). They export a contribution `point`, a
`title`, and a default React component. There is no registry, declaration API,
generated form, command vocabulary, or required section layout.

Live contributions read the running mount through
`src/contributions/use-game-modules.ts`. Never directly import a live gameplay module
from a contribution; that would create a second module instance under the
editor importer. Hand-type the narrow slice the surface uses and call the
same exported functions the developer reaches through `game.run`.

The `studio` addition (`game-editor create <name> --with studio`, or `--template full`)
brings three unfinished surfaces. No other preset does, because nothing a
project inherits may error and these three throw until they are rewritten:

- Tester is the live QA cockpit: controller ownership, repertoire, current
  goal mind and outcome, controls, setup cheats, and live judgment readings.
- Data edits the game's authored content and mechanic parameters.
- Analytics shows game-specific charts and metrics from the selected recorded
  Gameplay Session, using the editor's existing playback controls.

All three stubs emit `VGAI_STUB_UNIMPLEMENTED`, which makes the live console and
`check-idioms` report remaining work. Rewrite the files whole in the game's
vocabulary.

## Analytics and gameplay sessions

One Play interval is one durable Gameplay Session. The editor writes
`logs/play-*.jsonl`, including lifecycle rows and structured game events. A
WebM recording is also captured by CLI Play. The log itself is the session catalog, so
sessions survive Stop and editor reload without a second manifest.

`workspace.analytics` has a shared host shell: session selector, real-time
scrub rail, current elapsed time, and optional video hover preview. The game's
`analytics.analytics.tsx` is only the body. It receives a stable Gameplay
Session store and deliberately receives no live `play` handle, so charts
cannot accidentally depend on ephemeral simulation state.

In a React component, `useDebugEmit` from `@vgai/game-runtime/react/world-state`
returns the event callback: `const emit = useDebugEmit()`. Call
`emit('gem-collected', { count })` in the mechanic's collection handler; the
editor stamps and records it. Build charts from the selected log at the shared cursor.

Record motion while Play runs:

```bash
npm run --silent vgai -- eval 'return editor.recording.start({ fps: 30 })'
# direct tester goals and advance with game.waitSimTime(...)
npm run --silent vgai -- eval 'return editor.recording.stop()'
```

Recordings are standard WebM files under `.vgai/recordings/`. Use ordinary
`ffprobe`/`ffmpeg` to inspect and trim them.

## Game data

Game rules and content are plain typed TS literals under `src/data/`, named
for the mechanic or content they describe:

```ts
// src/data/cooling.ts
export const cooling = {
  baseCapacity: 120,
  throttleAt: 86,
} as const;

export type Cooling = typeof cooling;
```

Mechanics import the literal directly. TypeScript is the schema; Vite HMR is
the edit transport. There is no engine data format, handle, emitted schema, or
runtime parse layer. Put derived calculations beside the data as plain
functions, then render the useful derived columns/graphs in the Data
contribution. A table too large to balance by hand should be generated from a
small set of authored parameters; the generated table is build output.

## UI roots

A player HUD is a `dom` root in `vgai.project.json`, default-exporting an
ordinary React component. It reads the project's own React context/store and
uses normal React subscriptions. Do not mount a second React root from project
code, and do not use Drei `Html` for a HUD—it is absent from clean composite
captures.

The host owns root mounting. `src/main.ts` registers the root adapters and the
manifest supplies root identity/entry. The source component itself stays free
of vgai runtime context.

## Capabilities and assets

Capabilities are optional standard libraries copied into the project. Before
writing reusable plumbing, list what already exists:

```bash
npm run --silent vgai -- add
npm run --silent vgai -- add <id>
```

The copied source under `src/lib/` is project-owned and editable. Use its
native library API; do not wrap Three, Rapier, Pixi, React, Colyseus, or XState
behind another programming model.

For 3D, 2D, animation, humanoid, environment, or generated assets, load the
matching `.agents/skills/vgai-*` skill before acting. The 3D asset floor is a
named prefab component, a colocated story, named nodes, and inspected visual
evidence. Provider generation must go through the provider-native skill and
`ctx.projectOutputs.write(...)`; never spend funds by calling a provider ad
hoc.

Repeatable creative sequences are flat scripts under
`scripts/<task>/steps/`, with a README at each meaningful step and
intermediates under `.vgai/tmp/<task>/`. Helpers under `src/lib/<domain>/` are
only for reusable, purely mechanical operations—not workflow runners,
registries, or auto-judges.

## Multiplayer

Call Colyseus directly with typed rooms and the callbacks API. Dynamically
import the client so single-player bundles remain clean. A multiplayer seat is
a person; in the editor it lives in one full game instance with its own
resident tester or a human handoff.

Use one editor, not extra browser tabs or synthetic clients:

```js
await editor.instances(['host', 'guest'])
const host = game.instance('host')
const guest = game.instance('guest')
```

Address each instance explicitly, load its running tester module, and direct
its tester toward the seat's goal. Keyboard focus, the Inspector's currently
viewed instance, and the instance addressed by code are separate; never assume
a human click retargeted the developer wire.

## Live verification

After every slice:

```bash
npm run check-idioms
npm run typecheck
npm run validate
npm run validate-manifest
npm run --silent vgai -- status
```

Then verify through the live editor-owned session:

1. Enter Play and wait for the full mount acknowledgement.
2. Arrange one situation through exported setup functions.
3. Direct the resident tester toward an intent-level goal.
4. Advance with `game.waitSimTime({ simSeconds })`; never use wall-clock
   sleeps, rAF loops, or synthetic keyboard events.
5. Read module state and `logs/play-*.jsonl`, one observation at a time.
6. Look at the visible result and capture a legible screenshot. Exercise the
   face control itself when validating a visible button.
7. Repeat for the few varied situations that could expose the slice.
8. Inspect hierarchy and Content: prefabs appear as prefabs, repeated
   primitives are collapsed under their owner, and independent entities are
   not hidden in scenery.
9. `npm run --silent vgai -- console` must be silent. Any unresolved warning/error is
   remaining work or must be explicitly acknowledged with an honest reason.
10. Commit the verified slice immediately. When the arc finishes, update
    `DEVLOG.md` with the judged result and reviewed media.

Do not add automated tests, specs, or committed autoplay routes to a game
project. The live interactive playtest is the approved proof; its play log is
the receipt.
