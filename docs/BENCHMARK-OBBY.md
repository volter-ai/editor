# The obby benchmark

One fixed request, run the way a new user would run it, on every Cyclotron
release. It measures whether an AI agent working in the editor's own Chat can
build a playable game in front of a person, and whether the editor helps or gets
in the way. It is a live run observed by a person or an agent, not an automated
test.

## Setup

1. On the platform under test (Windows first; it is where most regressions
   surfaced), in an empty folder:
   `npx -y @volter/cyclotron@latest create obby`.
   Do not reuse a project, a workbench override or packages from a checkout:
   the point is what a user gets.
2. Open the editor from the URL `create` prints. Record whether that URL opens
   the project.
3. In Chat, choose Claude Code with the harness default model unless the run is
   comparing models, and send exactly:

   > Make me a simple obby course I can play: platforms to jump across over a
   > drop, a couple of hazards, a checkpoint and a finish, and a player I control
   > with WASD and Space to jump. Build the level in this project and make it
   > playable with Play.

4. Do not help the agent. Answer an approval only if the editor asks for one;
   count it. Record the editor window for the whole turn.

## What to record

| Measure | How |
| --- | --- |
| Printed URL opens the project | yes / no |
| Chat starts on a local agent without setup | yes / no |
| Time to first visible change | from send to the first change in the document on screen |
| Longest stretch with nothing visible changing | from the recording (the journal only marks stalls past ~60–75 s, as tripwire rows) |
| Approval prompts | count |
| Page reloads during the turn | count; any reload that loses the conversation is a failure |
| Nudges steered into the turn | count `tripwire-nudge` journal rows with outcome `steered` |
| Level saved to its own `.blend` | yes / no |
| Play starts without errors | yes / no |
| Autoplay completions | completed runs / runs the agent tried |
| Uses the play log to explain a failure | yes / no, from the transcript |
| Total turn time | minutes |
| Files left outside `src/` and `.volter/` | count |
| Unresolved console errors at the end | `cyclotron status` |

Add one line on what the person watching saw that a report would not show.

## Baseline (2026-10-06, Windows)

| Measure | npm 0.5.187 | editor main f265f77 + Chat 0.1.40 workbench |
| --- | --- | --- |
| Printed URL opens the project | no | no |
| Chat starts on a local agent | no (Copilot) | yes |
| Time to first visible change | ~5 min | ~7 min |
| Approval prompts | 25 | 0 |
| Page reloads | 1 (lost the conversation, blocked all sends) | 0 |
| Level in its own `.blend` | no (saved into `cube.blend`) | yes |
| Play starts | no (`cube.play.ts did not start`) | yes |
| Autoplay completions | — | 9 / 9, 0 deaths, 14.6–15.4 s |
| Total turn time | ~6 min, then stuck | 48 min |
| Files left behind | — | 49 (`tools/`, `evidence/`) plus `cube.blend` |
