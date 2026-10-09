# Blind walk runsheet: Cyclotron on Windows (walks 1, 3 and 4)

You are a first-time user. You know only what the Cyclotron page tells you. Do each step through the doors a
person uses (the page, the install line, the editor in the browser, its Chat), write PASS or FAIL beside it with
what you saw, and stop a step at its first FAIL: copy the exact text on screen, save a screenshot, and go on to
the next step that does not depend on it. Do not read the editor's source or docs, do not fix anything, run no
tests, and never start a ChatGPT or Claude sign-in: a walk that reaches a sign-in screen stops there and says so.

| Walk | Starting state | How to run the install line | Goals |
|---|---|---|---|
| 1 | this PC as it is (Node, Claude Code signed in) | in a normal PowerShell | 1, 2, 3, 4 |
| 3 | no Node | `powershell -NoProfile -ExecutionPolicy Bypass -File release/launch/walks/first-time-env.ps1 -NoNode -EmptyProfile -Fresh -Command "<the install line>"` | install up to the first model |
| 4 | no agent signed in | the same with `-EmptyProfile -Fresh` and without `-NoNode` | 1 and 4 |

Record for every walk: the date, the published `@volter/cyclotron` version it installed, and the time from
pressing Enter on the install line to the first model on screen.

## Steps

1. **Find it.** Open https://cyclotron.videogame.ai. Find how to install on Windows. PASS: the page gives one line
   to paste, and says what it needs.
2. **Install.** Paste the line as the page says. PASS: Cyclotron opens in the browser with a starter game, and the
   terminal said nothing alarming (copy any error or warning it printed).
3. **Goal 1: try the race before signing in.** Press Play and drive with the keys the editor shows. Try autoplay.
   PASS: the race runs and responds, and nothing asked you to sign in first.
4. **Goal 4: model, save, undo and redo without an account.** In the Model workspace, select a part, move it, save,
   undo, redo. PASS: each does what it says, and the saved change survives closing and reopening (step 7).
5. **Goal 2, walk 1 only: build with the agent.** In the Chat, ask in one message for three changes: the kart a new
   colour, a higher top speed, and the lap time shown on screen. Check each in Play. Then start a New Chat and ask
   for a second, unrelated change. PASS: all four changes are visible in Play, and the second chat started clean.
6. **Walk 4 only: the Chat with no agent.** Open the Chat. PASS: it says plainly what is missing and offers a way to
   sign in. Stop there.
7. **Goal 3: come back.** Close the editor's tab and its terminal. Paste the install line again (the page says it
   reopens). PASS: the same project opens with your changes, and the Chat shows the conversation from step 5
   intact. (A pending approval surviving the reopen is part of this goal once "Ask for approval" ships; until
   then, note it as not tested.)

## Report

A table of the steps with PASS/FAIL, the exact text of each failure, the screenshots' paths, the version and the
time to first model. Then, in a few sentences, anything that confused you even where the step passed.
