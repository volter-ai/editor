# Editor-control reference

## Contents

- [CLI invocation](#cli-invocation--use-the-project-local-cli)
- [Quick start](#quick-start)
- [Connection precondition](#precondition-most-verbs-need-a-connected-browser-tab-not-just-vgai-edit-running)
- [**Drive the running game — `npx volter-game-editor eval`**](#drive-the-running-game--vgai-eval-the-general-door)
- [CLI reference](#cli-reference)
- [Entity IDs](#entity-ids)
- [Typical workflows](#typical-workflows)
- [SDK](#sdk-programmatic-access)

Use the `vgai` CLI to create projects, launch the editor, and control it programmatically. The editor is a browser-based WebGL app; the CLI sends commands to it over HTTP.

**Driving a running GAME is a different question from driving the editor**, and
it has one answer: `npx volter-game-editor eval`. Read that section before the verb list — the
verbs cover the editor, and a game's own commands are never verbs.

## CLI invocation — use the project-local CLI

Inside this scaffold, invoke every CLI verb as `npm run --silent vgai -- <verb>`. The
script points at the versioned `@volter/game-editor` installed with this project. Never
use a bare global `vgai` command here: another installation can own that binary
and can silently target the wrong session or apply different manifest rules.

## Quick Start

```bash
npm run --silent vgai -- create "My Game" # Scaffold a new project in ./my-game
cd my-game
npm run --silent vgai -- edit .           # Launch editor + open browser
npm run --silent vgai -- play             # Enter play mode
npm run --silent vgai -- restart          # Remount all game roots — acks only when the session is READY
                                 # again (relay up, tab attached, play measured running); exits
                                 # non-zero naming the gap otherwise. No sleep-then-play dance.
npm run --silent vgai -- status           # Check editor state
npm run --silent vgai -- eval --list      # Everything you can drive — ask this FIRST
```

**Port cross-talk:** the default editor port (5173) is shared across every
VGAI project on the machine. `npm run --silent vgai -- edit .` never silently retargets a
DIFFERENT project's already-running editor — if one is already open
elsewhere, this one starts a second instance on a fresh free port and prints
that URL instead (use `--switch` to retarget the existing one on purpose).
If you might have another vgai project's tab open in the browser already,
don't assume it's this project: read the URL `npx volter-game-editor edit` actually prints
(check `npx volter-game-editor sessions` to see every live session's port → project), or pass
`npx volter-game-editor edit --port <n>` to pin an explicit port for this project so a stale
tab from a different project can't be mistaken for this session.

## Precondition: most verbs need a connected browser tab, not just `npx volter-game-editor edit` running

`npx volter-game-editor edit` starts the dev server and prints a URL — it does **not** by
itself give the CLI anything to talk to. Every control verb (`play`,
`select`, `focus`, `show`, `status`, ...) is relayed over HTTP/SSE to an
actual browser tab that has the editor page open and running; the dev
server just serves that page. Running `npx volter-game-editor edit` and then immediately
calling `npx volter-game-editor status` with **no tab ever opened** does not error — it
returns the last **cached** state from a previous session (or an empty
default), and prints a prominent multi-line `STALE SNAPSHOT` banner to
stderr (with the snapshot's age, if known) instead of a hard error, so
scripts that legitimately want last-known state still get it. Read that
banner: it means the JSON below it is stale, not live. Before trusting
`npx volter-game-editor status` (or issuing `play`/`select`/etc. and expecting them to do
anything), make sure a tab is actually open on the printed URL — a real
browser, or a Playwright/Puppeteer page you navigated to it yourself.

**`--no-open`: skip the browser auto-open.** Only for contexts where NO
human could possibly be watching (unattended CI). On WSL the auto-open
reaches the WINDOWS browser, so headless WSL is not a reason to pass this —
let `npx volter-game-editor edit` auto-open and tell the user the printed URL instead. The
one legitimate case is a fully unattended CI job that then drives the
editor itself, e.g. via Playwright:

```bash
npm run --silent vgai -- edit . --no-open # ONLY when no human could be watching (e.g. CI)
```

```ts
// then, in a Playwright script, open a page against the printed URL —
// use 'load', NOT 'networkidle': the editor dev server keeps a
// long-lived SSE/websocket connection open for live commands, so the
// network never goes idle and `waitUntil: 'networkidle'` hangs forever.
await page.goto('http://localhost:5173', { waitUntil: 'load' });
```

Once that page has loaded, it registers as a connected client and `vgai
status`/`npx volter-game-editor play`/etc. from another shell will reach it for real.

## Drive the running game — `npx volter-game-editor eval`, the general door

**This is the section to read before the verb list below.** A first-party
game's control and readout surface is its own ordinary exported modules. There
is no command registry, provider registry, or fixed game vocabulary to learn.
`npx volter-game-editor eval` runs literal JS against this project's live session with
`{ editor, game, page, tools, session }` from `@volter/game-live` already in scope:

```bash
npm run --silent vgai -- eval --list                     # what's in scope (no session needed)
npm run --silent vgai -- eval 'return game.run(async ({ modules }) => { const arena = await modules("src/sim/arena.ts"); return arena.readArena(); })'
npm run --silent vgai -- eval 'return game.run(async ({ modules }) => { const arena = await modules("src/sim/arena.ts"); arena.setupBossWave(); return arena.readArena(); })'
npm run --silent vgai -- eval 'return game.run(async ({ modules }) => { const tester = await modules("src/bot/tester-station.ts"); return tester.hireTester("sweep"); })'
npm run --silent vgai -- eval 'await game.waitSimTime({simSeconds: 4})'
npm run --silent vgai -- eval 'await editor.grid(false)' # the editor half, same door
```

`--list` walks the live binding objects themselves rather than a written list,
so it cannot go stale — ask it rather than trusting any prose, including this
page. The game's own source tells you which module functions exist; the
template's `src/tools/use-game-modules.ts` shows how a literal contribution
reads the exact same running instances.

**NEVER pilot a realtime game from the developer REPL, with synthetic key
events, rAF loops, wall-clock sleeps, or direct `window.__vgai*`/scene-graph
reads.** Arrange expensive preconditions with exported setup functions, then
hire the resident tester to act through the game's real input store.
`waitSimTime` advances deterministically even while the editor tab is HIDDEN.
`npx volter-game-editor status` reports the tab's own
visibility MEASUREMENTS (`visibilityReport` — the reported value, its age,
and a live tick probe when the loop looks stopped) instead of letting
`connected: true` read as usable — and instead of asserting a story:
treat its readings as evidence with an age, never as a verdict about
what is on the user's screen. A result obtained by puppeteering the page is
not evidence: it can agree with the pixels while disagreeing with the state
providers every other tool reads.

## When to Use This Skill

- **`create` / `edit`** — bootstrap and launch projects
- **`eval`** — drive or read the running game AND editor; the door above
- **`play` / `stop` / `restart` / `status` / `screenshot`** — the everyday loop
- You do NOT need the CLI for scene/asset changes — a three root's document IS its TSX source (`src/world.tsx`, `src/scenes/`, `src/prefabs/`), so editing the world is editing those files; the dev server validates every save and surfaces failures loudly

## CLI Reference

### Project Management (no running editor needed)

```bash
npm run --silent vgai -- create <name> [location]   # Empty project (default location: ./<name>)
npm run --silent vgai -- create <name> [location] --template game # Game composition; also empty, website, models
npm run --silent vgai -- edit [project-path]        # Launch editor for project (default: cwd).
                                           # Reuses the session already serving THIS
                                           # project; otherwise starts a NEW instance on
                                           # a free port rather than silently retargeting
                                           # a different project's editor (see the port
                                           # cross-talk note above).
                                           #   --switch    retarget an existing instance
                                           #               instead of starting a new one
                                           #   --port <n>  force a port for a fresh instance
npm run --silent vgai -- sessions                   # List live editor sessions (port -> project)
```

### Scene & Project Info (needs running editor)

```bash
npm run --silent vgai -- open <path>      # Switch project in running editor
npm run --silent vgai -- project          # Show current project info
npm run --silent vgai -- projects         # List recent projects
```

`open` / `project` / `projects` stay first-class for a concrete reason: project
management lives on `EditorClient` and was never lifted onto `@volter/editor-live`'s
`editor`, so there is no `eval` equivalent to point them at.

### Play Control

```bash
npm run --silent vgai -- play             # Enter play mode
npm run --silent vgai -- restart          # Dispose + remount every game root — waits out a relaunching dev
                                 # server, re-ensures the one tab, and acks only once play is
                                 # measured running (a failure names the next step)
npm run --silent vgai -- stop             # Exit play mode
```

`pause` / `resume` / `step` were REMOVED — `npx volter-game-editor eval 'editor.pause()'`,
`editor.resume()`, `editor.step(1)`.

Component-source HMR swaps class prototypes onto live instances. That keeps
runtime state and avoids an editor reload, but it deliberately does not rerun
`init()`. Use `restart` after changing init-time debug registrations,
listeners, generated resources, component ownership, or other setup/teardown
behavior. The same action is always available in the Play bar; when the editor
knows a source change is structurally unsafe it highlights the button with the
reason.

### Navigation, Panels, and Display — REMOVED, use `npx volter-game-editor eval`

Every verb in this group was a 1:1 wrapper over a method `eval` already
exposes, so they were deleted rather than kept as aliases. Typing one now
errors with its exact replacement:

```bash
npm run --silent vgai -- eval 'editor.select("<entityId>")'   # or "all"
npm run --silent vgai -- eval 'editor.deselect()'
npm run --silent vgai -- eval 'editor.focus("<entityId>")'    # omit arg = current selection
npm run --silent vgai -- eval 'editor.view("top")'            # top|front|right|perspective
npm run --silent vgai -- eval 'editor.showPanel("inspector")' # viewport|inspector|console|build
npm run --silent vgai -- eval 'editor.openAsset("<path>", "<kind>")'
npm run --silent vgai -- eval 'editor.grid(false)'
npm run --silent vgai -- eval 'editor.helpers(true)'
npm run --silent vgai -- eval 'editor.stats(true)'
npm run --silent vgai -- eval 'editor.shading("wireframe")'   # solid|unlit|wireframe|normals|overdraw
```

The advantage is not brevity — it is that one door composes. Selecting an
entity, framing it, and capturing the result is a single round trip instead of
four processes:

```bash
npm run --silent vgai -- eval 'await editor.select(id); await editor.focus(); await editor.shading("wireframe"); return editor.screenshot()'
```

Shading is temporary, render-only editor state: it never rewrites scene or
game materials and is not saved into a scene. Scene and Game remember separate
session-local modes; `shading` targets whichever viewport is active. Game
shading applies to compatible first-party Three.js roots, while React/Pixi and
other adapter-owned layers continue rendering natively. The Scene helper menu
also exposes independent lights, cameras, colliders, skeletons, audio, and
bounds toggles; use `setHelperType()` through the SDK when you need one category.

### State

```bash
npm run --silent vgai -- status           # Print full editor state as JSON
```

The `status` command returns:
- `playState` — `stopped`, `playing`, or `paused`
- `selectedEntityId` / `selectedEntityIds` — current selection
- `activeViewportTab` — `scene` or `game`
- `showGrid`, `showHelpers`, `showStats`, `shadingMode` — display state
- `transformMode`, `transformSpace`, `snapEnabled` — tool state
- `entityCount` — number of entities in the scene
- `savePath` — path to the currently open scene file
- `connected` — whether an editor browser tab is live right now; if
  `false`, everything else in the payload is a cached snapshot (see the
  precondition note above)

### Verification — the LIVE playtest, in as many seats as it needs

```bash
npm run --silent vgai -- eval 'return game.run(async ({ modules }) => { const mechanic = await modules("src/sim/<mechanic>.ts"); mechanic.<setup>(); return mechanic.<read>(); })'
npm run --silent vgai -- eval 'return game.run(async ({ modules }) => { const tester = await modules("src/bot/tester-station.ts"); return tester.hireTester("<goal>"); })'
npm run --silent vgai -- eval 'return game.run(async ({ modules }) => { const tester = await modules("src/bot/tester-station.ts"); return tester.describeTester(); })'
```

Verification IS the interactive playtest: cheats set the situation, the
resident tester runs behavior, the event log is read on an interval, and the
run is redirected until the operator is satisfied. Games
are fundamentally unpredictable in behavior, so there are no spec files and
no committed route scripts — the play log (`logs/play-*.jsonl`) is the
receipt. Repeat with varied seeds, goals and dials; that variation is how
coverage grows.

A multiplayer game is the same playtest in more than one SEAT — instances of
this game side by side in one editor, each addressed from your program, so
you can watch them play each other. It is not a different kind of test, and
it never needs a second browser or a synthetic second player.

The playtest loop (exported setup/read functions, the tester's repertoire, and
sim-time budgets) is documented in the sibling
`.agents/references/project-manual.md`.

Reading and driving the game's own modules is **`npx volter-game-editor eval`'s job,
permanently**, not a gap waiting on more CLI verbs. A game names its own
functions, which is exactly why the door is general.

### Global Options

```bash
--url <url>                      # Editor URL (default: http://localhost:5173)
                                 # Also: VGAI_EDITOR_URL env var
```

## Entity IDs

Entity ids are minted by the active authoring adapter (a three world's are
keyed on the OID its source carries — stable across reloads). To find one:

1. `npm run --silent vgai -- eval 'return editor.hierarchy()'` — the hierarchy panel's
   rows as data, each with its `id` and label
2. Use that id with `editor.select("<id>")` / `editor.focus("<id>")` through
   `npx volter-game-editor eval`

## Typical Workflows

### Start a new project from scratch

```bash
npm run --silent vgai -- create "My Platformer"
cd my-platformer
npm run --silent vgai -- edit .
```

### Show the user an entity you just created/modified

```bash
# After editing the world's TSX source — select and frame the entity in one round trip:
npm run --silent vgai -- eval 'await editor.select("<entity-id>"); await editor.focus()'
```

### Test gameplay

```bash
npm run --silent vgai -- play
npm run --silent vgai -- eval 'return game.run(async ({ modules }) => { const mechanic = await modules("src/sim/<mechanic>.ts"); mechanic.<setup>(); return mechanic.<read>(); })'
npm run --silent vgai -- eval 'return game.run(async ({ modules }) => { const tester = await modules("src/bot/tester-station.ts"); return tester.hireTester("<goal>"); })'
npm run --silent vgai -- eval 'await game.waitSimTime({simSeconds: 5})'
npm run --silent vgai -- eval 'return game.run(async ({ modules }) => { const mechanic = await modules("src/sim/<mechanic>.ts"); return mechanic.<read>(); })'
npm run --silent vgai -- screenshot                            # and LOOK at the pixels
npm run --silent vgai -- restart                               # after an init-time source change
npm run --silent vgai -- stop
```

Arrange and read through the mechanic's own exported functions; let the
resident tester drive player input. Both halves matter: the scene graph can
agree with your intent while the module readout every other tool consumes
disagrees.

### Debug a specific view angle

```bash
npm run --silent vgai -- eval 'await editor.view("top"); await editor.shading("wireframe"); await editor.helpers(true)'
```

## SDK (Programmatic Access)

For TypeScript automation, use **`@volter/game-live`** — the same surface `npx volter-game-editor eval`
binds, so anything you prototyped at the command line moves into a script
unchanged:

```typescript
import { connect } from '@volter/game-live';

const { editor, game, tools, session } = await connect();
await editor.play();
await game.run(async ({ modules }) => {
  const arena = await modules('src/sim/arena.ts');
  arena.setupBossWave();
  const tester = await modules('src/bot/tester-station.ts');
  tester.hireTester('sweep');
});
await game.waitSimTime({ simSeconds: 4 });
const player = await game.run(async ({ modules }) => {
  const arena = await modules('src/sim/arena.ts');
  return arena.readPlayer();
});
```

`connect()` ATTACHES to a session `npx volter-game-editor edit` is already serving — it never
starts one, and fails with a clear "run `npx volter-game-editor edit` first" rather than silently
booting a second editor. Top-level `editor` / `game` / `page` / `tools`
singletons are also exported for one-liners.

`@volter/editor-sdk`'s `EditorClient` is the lower layer underneath, and remains
the right import for editor-only automation that has no game running — plus the
handful of project-management calls (`createProject()`, `openProject()`,
`getProject()`, `listRecentProjects()`) that `@volter/editor-live` does not re-expose.

Run `npm run --silent vgai -- eval --list` for the current member list on every binding.
It walks the live objects at runtime, so it is accurate in a way this page
cannot promise to be.
