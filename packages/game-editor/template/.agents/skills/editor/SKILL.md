---
name: editor
description: Launch, control, inspect, and verify a VGAI game through its live visual editor. Use for editor sessions, Play mode, selection, hierarchy or inspector work, screenshots, status, logs, restart after setup changes, or the live playtest loop.
---

# Control the VGAI editor

## Open the observable session

1. Run `npm run dev` from the game project. Let it auto-open unless the run is
   genuinely unattended CI.
2. Tell the user the printed editor URL and keep the process running.
3. Run `npm run --silent vgai -- status`; require `connected: true` before treating the
   response as live state. A running server without a browser tab only has a
   cached snapshot.
4. Use Play mode for user-visible game runs. The standalone page
   (`npm run dev:standalone`) serves EXPORTED builds only — until the game is
   exported it refuses to mount, so the editor is the one surface for a game
   in development.

Always invoke the scaffold-pinned CLI as `npm run --silent vgai -- <verb>`. Never use
a bare global `vgai` command, which may come from a different checkout.

## Verify the loop

- Use `play`, `stop`, `status`, and `screenshot` to observe work — selection,
  focus, and panels go through the eval door (`vgai eval
  'editor.select("<id>")'` / `editor.focus()` / `editor.showPanel(...)`);
  edit project source directly when that is the simplest authoring path.
- Use `restart` after init-time registrations, listeners, resources, or
  ownership changes. Ordinary component HMR does not rerun `init()`. Its ack
  IS the readiness guarantee (relay up, tab attached, play running); a
  failure names the next step.
- Playtest LIVE from first playability: exported setup functions arrange the
  situation, the resident tester is hired through its running module, and the
  event log is read on an interval while the run is redirected until
  satisfied. The play log is the receipt.
- Read persisted Play logs and visible pixels as well as state. Screenshots
  must make the result being claimed legible.
- **Every `vgai play` records video automatically** — the ack prints the
  recording path (`.vgai/recordings/play-latest.webm`, replaced by the next
  play; `vgai play --record <name>` keeps a clip forever), play auto-stops
  after 2 idle minutes, and stopping finalizes the WebM. A claim about
  MOTION (an effect, an animation, a stutter, anything that lives between
  frames) is judged from that clip: find the moment via the play log's
  event timestamps against the recording's start time, then examine at
  least 10 frames within a ≤5-second span around it. `vgai screenshot`
  while play is running refuses and points at the clip; screenshots are for
  static states.

Read [references/editor-control.md](references/editor-control.md) when exact
CLI verbs, connection behavior, E2E exit codes, SDK methods, or worked command
sequences are needed.
