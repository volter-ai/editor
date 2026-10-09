# Blind walk runsheet: Cyclotron on Windows (walks 1, 3 and 4)

You are a first-time user. You know only what the Cyclotron page tells you. Do each step through the doors a
person uses (the page, the install line, the editor in the browser, its Chat), write PASS or FAIL beside it with
what you saw, and stop a step at its first FAIL: copy the exact text on screen, save a screenshot, and go on to
the next step that does not depend on it. Do not read the editor's source or docs, do not fix anything, run no
tests, and never start a ChatGPT or Claude sign-in: a step that reaches a sign-in screen stops there and says so.

Run the commands below from a checkout of volter-ai/editor (the script's path is relative to it).

| Walk | Starting state | How to run the install line | Steps |
|---|---|---|---|
| 1 | this PC as it is (Node, Claude Code signed in) | in a normal PowerShell | 1, 2, 3, 4, 5, 7 |
| 3 | no Node, empty profile | `powershell -NoProfile -ExecutionPolicy Bypass -File release/launch/walks/first-time-env.ps1 -NoNode -EmptyProfile -Fresh -Command "<the install line>"` | 1, 2 (to the first model on screen) |
| 4 | Node, empty profile: no agent signed in | the same, without `-NoNode` | 1, 2, 3, 4, 6, 7 |

At step 7 (coming back), run the same command **without `-Fresh`**: `-Fresh` deletes the empty profile, and with it
the project the first run made.

Record for every walk: the date, the published `@volter/cyclotron` version it installed, and the time from
pressing Enter on the install line to the first model on screen.

## Steps

1. **Find it.** Open https://cyclotron.videogame.ai. Find how to install on Windows. PASS: the page gives one line
   to paste, and says what it needs.
2. **Install.** Paste the line as the page says. PASS: Cyclotron opens in the browser with a starter game, and the
   terminal said nothing alarming (copy any error or warning it printed, and its exit code).
3. **Goal 1: try the race before signing in.** Press Play and drive with the keys the editor shows. Try autoplay.
   PASS: the race runs and responds, and nothing asked you to sign in first.
4. **Goal 4: model, save, undo and redo without an account.** In the Model workspace, select a part, move it, save,
   undo, redo. PASS: each does what it says. (Step 7 checks that the saved change survives a reopen.)
5. **Goal 2 (walk 1): build with the agent.** In the Chat, ask in one message for three changes: the kart a new
   colour, a higher top speed, and the lap time shown on screen. Check each in Play. Then start a New Chat and ask
   for a second, unrelated change. PASS: all four changes are visible in Play, and the second chat started clean.
6. **Walk 4: the Chat with no agent.** Open the Chat. PASS: it says plainly what is missing and offers a way to
   sign in. Stop this step there; do not start the sign-in.
7. **Goal 3: come back.** Close the editor's tab and its terminal. Paste the install line again (the page says it
   reopens). PASS: the same project opens with step 4's saved change, and, on walk 1, the Chat shows the
   conversation from step 5 intact. (A pending approval surviving the reopen is part of goal 3 once "Ask for
   approval" ships; until then, note it as not tested.)

## Report

A table of the steps with PASS/FAIL, the exact text of each failure, the screenshots' paths, the version and the
time to first model. Then, in a few sentences, anything that confused you even where the step passed.
