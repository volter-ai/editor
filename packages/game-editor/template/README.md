# VGAI game project

This is a standalone game project created by VGAI. Describe the game you want
to a coding agent, or open the shared visual editor directly:

```bash
npm run dev
```

`npm run dev` opens this project's editor and prints its stable local URL. The
editor is the authoring and verification surface. The standalone player serves
exported builds only.

## Common tasks

```bash
npm run dev               # open/reuse this project's editor
npm run check-idioms      # project architecture and completion diagnostics
npm run typecheck         # game, editor contributions, Node config, and server
npm run validate          # project files and React design states
npm run validate-manifest # vgai.project.json
npm run build             # production game bundle
```

The `studio` addition (`game-editor create <name> --with studio`, or `--template full`)
brings three development contributions; no other preset does. The files are:
`src/contributions/tester.inspector.tsx`, `src/contributions/data.document.tsx` and
`src/contributions/analytics.analytics.tsx`. They emit
`VGAI_STUB_UNIMPLEMENTED`, so the editor console and `check-idioms` remain red
until the game supplies its own Tester, Data and Analytics surfaces (or deletes
Data because it genuinely has no authored content tables). Analytics must provide
game-specific analysis. The editor already provides session selection, playback
and optional recording preview.

The source demonstrates the spatial taxonomy directly:

- `src/world.tsx` is the thin persistent root and scene swap slot;
- `src/scenes/MainScene.tsx` is a complete composition;
- `src/prefabs/HeroBox.tsx` plus its colocated story is an independently
  placeable Content prefab;
- `src/components/environment/Ground.tsx` is non-placeable scene support and
  keeps its owned construction pieces inside itself.

Replace the starter subject, but preserve those distinctions. A Three game
with no story-backed prefabs receives a checker warning because deleting the
example must not silently erase the architecture it demonstrates.

## Live verification and recordings

Drive/read the running game through its own exported modules:

```bash
npm run vgai -- eval 'return game.run(async ({ modules }) => { const bot = await modules("src/bot/tester-station.ts"); return bot.describeTester(); })'
```

Record through the same eval door while Play is running:

```bash
npm run vgai -- eval 'return editor.recording.start({ fps: 30 })'
# direct the resident tester and advance simulation time
npm run vgai -- eval 'return editor.recording.stop()'
```

Recordings are standard WebM files under `.vgai/recordings/`. Inspect and trim
them with ordinary `ffmpeg`/`ffprobe`; promote only reviewed evidence into
`media/`. Structured Gameplay Session logs live under `logs/play-*.jsonl` and
remain the durable Analytics source after Stop or reload.

The project manifest is `vgai.project.json`. `ROADMAP.md` owns major feature
arcs; `DEVLOG.md` is the development journal. Coding agents begin with
`AGENTS.md`, which routes task-specific details to `.agents/` skills and the
project manual.

This project keeps versioned `@volter/*` dependencies. To use a local engine
checkout without changing the manifest or lockfile, follow that checkout's
`docs/LOCAL-DEV.md` link procedure. `npm run vgai -- status` reports the engine
provenance serving the active session.

Learn and manual: https://vgai-learn.pages.dev

Hosted editor: https://vgai-editor.pages.dev
