# AGENTS.md — VGAI Game Project

A standalone game built with VGAI — work here, not in the engine repo.
The editor is the authoring and verification surface.

## Route the request first

| Intent | First action |
| --- | --- |
| Build or change this game | This file + the relevant `.agents/references/project-manual.md` section |
| Open, play, or verify it | `.agents/skills/editor/SKILL.md` |
| Model or revise a game prop with Blender | `.agents/skills/vgai-3d-models/SKILL.md` |
| The game needs a 3D asset placed, rigged, or baked | `.agents/skills/vgai-3d-assets/SKILL.md` |
| Other craft (2D/3D art, animation, humanoids, generated assets) | The matching `.agents/skills/vgai-*/SKILL.md` |
| Import an existing web game | Read-only compatibility report; never rewrite its source |
| Browse or modify an example | Read-only, or scaffold a copy; user games never go in `examples/` |

`.agents/` is canonical; `.claude/skills/` and `.github/skills/` are
generated projections (never edit); `CLAUDE.md` and
`.github/copilot-instructions.md` only point here.

**Capabilities are this project's standard libraries, and they are ADDED.**
Before writing reusable plumbing, run
bare `npm run --silent vgai -- add` (lists), inspect the match, and `add <id>` it —
the installed source is project-owned and editable. A doc naming
`src/lib/<x>` describes what that capability installs.

## Before writing code

1. Read the brief; write the initial `ROADMAP.md` task first (shape:
   the ROADMAP rule below).
2. Read `vgai.project.json` — each root's `adapter` owns its document
   and lifecycle; read the root entry files and any data schema before
   editing. `src/main.ts` registers each root's adapter (`three`, `dom`).
3. Start the editor now (`npm run dev`); tell the user the URL in your
   FIRST visible message. Keep it running and narrate as you build. The
   editor IS the Code-OSS workbench this machine declares in
   `.vgai/workbench.json` (the product's `create --workbench <dir>` writes it); with
   no declaration `npm run dev` refuses and prints the exact JSON to write —
   write it, do not work around it.
4. Multiplayer: every SEAT is a person — an INSTANCE in one editor,
   played by its resident tester (`game.instance(id)` → the running
   `tester-station.ts` module's `hireTester`) or a human via handoff; never a
   second browser or synthetic player.

Everything else is in the project manual; read only the sections the
request needs.

## Non-negotiable rules

- **Author in playable slices, playtested LIVE by two people: you are
  the DEVELOPER, the bot is your QA TESTER.** All in-game action is the
  tester's honest input at sim speed, directed by calling `hireTester` on the
  running `src/bot/tester-station.ts` module,
  never by sending inputs yourself. The playtest is INTERACTIVE; its
  receipt is the play log — never a script.
- **A control is done when ITS OWN CLICK visibly changes something.**
  Acceptance for any face control is driving the control itself in the live
  session (a DOM click through `game.run`) and seeing a change a human would
  see—never merely calling the function it wraps. An action whose success can
  be invisible (for example, a goal completing before the next paint) must
  narrate itself in the face.
- **Development panels are game-specific.** The `game` starter includes required
  Inspector, Data and Analytics stubs; replace them with useful fields and controls.
  The `prototype` starter omits them. Any panels you add must use game vocabulary,
  not raw JSON or generic event lists. The editor already provides session playback.
- **Every mechanic ships its debug function and readout in the same slice.**
  Export them beside the mechanic for the REPL and tester; provide setup helpers
  for situations that are costly to reach through normal play.
- **Keep game data in typed `src/data/` modules named for the mechanic or content.**
  Editor panels read that data; they do not determine its storage shape.
- Use the real audio adapter even when the game is silent.
- Contributions live in `src/contributions/`. Use `use-game-modules.ts` for live
  state and the selected Gameplay Session for Analytics. Implementation details
  are in the project manual's Studio surfaces section.
- **Game-level feature arcs live in `ROADMAP.md` — one file.** Task one
  is the complete playable prototype from the brief — mechanics,
  rendering, UI, tooling, readouts are parts of it, not peer tasks; later
  entries are only major features of comparable scope. One `Summary:` and
  one lifecycle `status:` each; no acceptance criteria yet; never a
  second task file; never done before a DEVLOG'd live playtest proves
  the arc (`ztrack check` verifies structure).
- **`DEVLOG.md` is the development journal, not a second tracker.** One
  entry per arc: what changed, why, decisions, playtest outcome, what
  remains — with reviewed screenshots (a clip when motion matters)
  promoted from `.vgai/` history into `media/`; inspect every artifact
  you attach, never the latest blindly.
- **Record through the eval door**: Play running →
  `eval 'return editor.recording.start({ fps: 30 })'`, drive via
  `game.*`, `eval 'return editor.recording.stop()'` → WebM under
  `.vgai/recordings/`. Inspect/trim with ordinary `ffmpeg`; no wrappers.
- **Keep Three source modular:** thin `src/world.tsx`; compositions in
  `src/scenes/*Scene.tsx` (no stories); placeables in `src/prefabs/` with
  stories; support in `src/components/`. Owned parts stay inside their
  owner; independent entities never hide in scenery; no monoliths, no
  prefab-per-primitive. E10/E11 enforce declared classifications and W10
  warns when a Three project silently loses all prefabs. Characters are ALWAYS rigged models
  authored in Blender (`vgai-3d-models`), never primitive stacks.
- Use Three.js, PixiJS, React, Rapier, and Colyseus directly — no
  wrappers, no parallel ECS or mirror tree.
- The world node is the entity. On a TSX root, behavior is a React
  component calling `useFrame`; physics is `@react-three/rapier` JSX.
  Debug state is ordinary exported functions in the game's own modules —
  reached via `game.run` and the contributions the game writes. Static
  scenery, lights, and UI stay native objects.
- The source is the document: TSX for a Three root, JSX for React; an
  unrecognized manifest key is rejected. Never call `createRoot`,
  `hydrateRoot`, or `ReactDOM.render` from project code.
- One component, one concern.
- A player HUD is a `dom` root, never drei `Html` (invisible in
  captures).
- Never fabricate first-party data, modify imported game source without
  consent, or author schema fields with no runtime reader. The game's
  numbers and tables are plain typed literals under `src/data/`.
- Preserve existing user edits and unrelated files.
- Generated assets: provider-native APIs + `ctx.projectOutputs.write(...)`;
  load the generative-assets skill before spending funds.
- Keep reference images and motion studies in `references/`; Content shows
  them without shipping them. Put assets the game loads in `public/`.
- Repeatable sequences: flat scripts in `scripts/<task>/steps/` (README
  per step); intermediates in `.vgai/tmp/<task>/`. Helpers in
  `src/lib/<domain>/` only when reusable and purely mechanical; no
  runners, task graphs, or auto-judges.
- Editor control is observation and verification; write through source
  edits, not UI automation. `npm run dev:standalone` serves EXPORTED
  builds only — until exported it refuses; the editor is the one surface.

## Verification contract — after every slice

**Never write automated tests — no vitest, no `tests/` (E12 enforces).**
Games are fundamentally unpredictable; pre-written assertions enter an
endless rewrite cycle. Playtest live; the play log is the receipt.

1. Run `check-idioms`, `typecheck`, `validate`, and `validate-manifest`.
   **`npm run typecheck` is the gate, never bare `tsc`** (bare `tsc`
   skips `src/tools`).
2. The ONLY approved slice test is LIVE: a REPL-style manual session in
   the editor-owned tab — set up, enter Play, advance sim time, inspect,
   act one step at a time. Keep the probe disposable (never a spec,
   script, or harness). After init-time edits, `restart`.
3. `npx volter-game-editor status` must show `connected: true`; it tails the session
   journal (`logs/editor-*.jsonl`). Read the play logs. Any
   `UNRESOLVED CONSOLE SET` is remaining work; `npx volter-game-editor console` silent is
   the only all-clear.
4. Enter Play and look. Capture a legible screenshot; **a hidden tab
   captures t≈0** — drive `game.waitSimTime` first.
5. Drive the game with `npm run --silent vgai -- eval '<js>'` — the one general
   door (`{ editor, game, page, tools, session }`). Never synthetic
   keys, rAF loops, wall-clock sleeps, or `window.__vgai*` reads.
6. Repeat for the few varied situations that could expose the change;
   the observations and screenshots ARE the proof.
7. Inspect the live hierarchy against the taxonomy above; every prefab
   appears in Content; collapse repeated primitives.
8. **Commit NOW, one commit per slice**, message naming the mechanic. A
   single end-of-build commit is a process failure.
9. Arc complete → update `DEVLOG.md` (rule above).
10. Before handoff, report what was tested and which optional harnesses
    were absent; remaining major arcs go in `ROADMAP.md`.

## Commands

```bash
npm run dev                   # open/reuse this project's editor (the workbench .vgai/workbench.json names)
npm run --silent vgai -- status        # require connected: true
npm run --silent vgai -- play          # editor Play mode
npm run --silent vgai -- restart       # remount after init-time edits
npm run --silent vgai -- screenshot    # visible evidence
npm run --silent vgai -- eval '<js>'   # THE door onto the running game
npm run check-idioms          # every slice
npm run validate              # manifest/files + React design states
npm run typecheck             # THE gate: src + src/tools + server
npm run dev:standalone        # EXPORTED builds only
```

Always `npm run --silent vgai -- <verb>`, never a bare `vgai` (a global one may
belong to another checkout).
