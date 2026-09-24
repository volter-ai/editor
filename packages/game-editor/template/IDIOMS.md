# IDIOMS.md — project architecture checks

`AGENTS.md` is the working contract. This page is the compact map of what
`npm run check-idioms` can enforce mechanically and what still requires live
judgment.

Legend: **ERROR** fails every run; **WARN** prints but fails only with
`--strict`; **LOOK** is judged in the live editor and recorded in `DEVLOG.md`.

## Source and roots

- The source is the document. Three roots are ordinary R3F TSX, Canvas roots
  are ordinary Pixi/React source, and DOM roots are ordinary React. The world
  node is the entity; no mirror ECS, registration layer, or vgai runtime API
  belongs in gameplay components. **LOOK**
- A DOM HUD is a manifest `dom` root and reads the project's own React
  context/store. A timer repeatedly copying game state into React state is a
  manual polling pump. **WARN W1**
- A positive `useFrame(callback, priority)` priority takes over rendering;
  use zero/negative values for ordering unless that callback actually calls
  `render`. **WARN W8**
- Display names are editable presentation, not gameplay identity. Trigger
  logic comparing `.name` can silently break after an editor rename. **WARN
  W4**

## Scenes, prefabs, and supporting components

- `src/world.tsx` is thin: root-wide providers/instruments and the active scene
  swap slot. Complete compositions live as `src/scenes/*Scene.tsx`; support
  that is not a scene belongs in `src/components/`. Stories inside
  `src/scenes/`, or helper-shaped files there, are misclassification. **ERROR
  E11**
- A prefab is one independently placeable/duplicable/reusable object under
  `src/prefabs/`. Its colocated portable story names it as `meta.component`;
  that story is its Content registration. A module claiming prefab residence
  without that registration is incomplete. **ERROR E10**
- Owned construction pieces remain inside their owner; do not create a prefab
  per mesh/primitive. Conversely, independent entities do not hide inside
  scenery or one scene monolith. The template demonstrates the contrast with
  `HeroBox` (prefab) and `Ground` (support).
- A Three project with no correctly story-backed prefab is suspicious. Fully
  procedural or wholly simulation-owned games can be honest exceptions, but
  ordinary games should not silently lose the architecture when replacing the
  starter subject. **WARN W10**
- R3F placeables forward ordinary `ThreeElements[...]` props to one native
  outer root and every spatial instance has a meaningful `name`; runtime
  motion belongs on an inner child so it cannot fight authored placement.
  The editor's own `R3F00x` analyzer supplies the finding. **WARN E9**

## Mechanics, tester, and studio surfaces

- Every mechanic exports the functions and readings needed to arrange and
  judge it. The developer calls the running instance directly through
  `game.run(({ modules }) => ...)`; contributions read the same instances
  through `src/tools/use-game-modules.ts`. There is no command registry or
  prescribed vocabulary. **LOOK**
- The resident QA tester is game code. It receives intent-level goals, runs at
  simulation speed, and actuates only the game's normal input store. Setup
  functions may arrange an expensive situation; they do not perform the
  behavior being judged. The tester's repertoire grows in the slice that adds
  each mechanic. **LOOK**
- `src/tools/` is literal contribution TSX. The unfinished Tester/Data/Analytics stubs
  emit `VGAI_STUB_UNIMPLEMENTED`; replacing or honestly deleting the relevant
  stub is required before completion. **ERROR E6**
- Tester holds live QA state, controller ownership, goals/mind, setup cheats,
  and judgment readings. Analytics holds historical session data. Data holds
  authored typed literals and derived views. A HUD number does not earn an
  inspector row merely because it exists. **LOOK**
- Analytics receives a durable Gameplay Session and cursor, not a live `play`
  handle. Every chart derives from the selected `logs/play-*.jsonl` session so
  it survives Stop and reload. A raw event listing does not fulfill Analytics;
  supply game-specific analysis using the editor's existing playback shell. **LOOK**

## Live proof

- Playtesting is interactive: arrange, direct the tester, advance sim time,
  observe, read the log, redirect. No committed route, test file, test-runner
  dependency, or test script belongs in a game project. **ERROR E12**
- Do not boot a private Playwright harness, reach through `window.__vgai`, or
  add `?bot=` boot plumbing. Use the editor-owned session and the game's
  running modules. **ERROR E1–E4**
- Gameplay source must not accumulate for many commits before the first Play
  receipt. `logs/play-*.jsonl` is written by the editor and cannot be replaced
  by an assertion that somebody intended to play. **WARN W9**
- At handoff, read `npx volter-game-editor console`, inspect the live hierarchy and Content
  gallery, look at several relevant situations, and promote only reviewed
  screenshots/clips into `media/`. **LOOK**

## Native libraries

- Call Three, Rapier, React, Pixi, XState, and Colyseus directly. A helper that
  returns the library's own object is fine; a wrapper or registry that becomes
  a second programming model is not. **LOOK**
- Dynamically import the Colyseus client so a single-player bundle does not
  pay for it. **WARN W3**
- If this project's manifest explicitly claims seeded determinism, raw
  gameplay `Math.random()` or wall-clock reads violate that claim. **ERROR
  E5**
- Every owner releases what it creates: listeners, timers, bodies, scene
  objects, and GPU resources. Play→Stop must leave `npx volter-game-editor console` silent.
  **LOOK**

## Run the scanner

```bash
npm run check-idioms
npm run check-idioms -- --strict
```

A heuristic false positive may be suppressed on the relevant source line with
a real reason:

```ts
setTimeout(closeSdkToast, 250); // idioms-ignore W1 one-shot SDK transition, not a state pump
```

Project-wide warnings such as W10 accept the same comment anywhere under
`src/`. An empty or missing reason does not suppress a finding.
