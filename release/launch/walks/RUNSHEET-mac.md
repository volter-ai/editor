# Blind walk runsheet: Cyclotron on a Mac (walk 2)

You are a first-time user. You know only what the Cyclotron page tells you. Do each step through the doors a
person uses (the page, the install line, the editor in the browser, its Chat), write PASS or FAIL beside it with
what you saw, and stop a step at its first FAIL: copy the exact text on screen, save a screenshot, and go on to
the next step that does not depend on it. Do not read the editor's source or docs, do not fix anything, run no
tests, never submit a form, and never start a ChatGPT or Claude sign-in: a step that reaches a sign-in screen
stops there and says so.

Walk it on a Mac with Apple Silicon as the Mac is (Node, Claude Code signed in): the same goals as Windows walk 1.

Record: the date, the published `@volter/cyclotron` version it installed, and the time from pressing Return on the
install line to the first model on screen.

## Steps

1. **Find it.** Open https://cyclotron.videogame.ai. Find how to install on a Mac. PASS: the page gives one line to
   paste, and says what it needs.
2. **Install.** Paste the macOS line in Terminal as the page says. PASS: Cyclotron opens in the browser with a
   starter game, and Terminal said nothing alarming (copy any error or warning it printed).
3. **Goal 1: try the race before signing in.** Press Play and drive with the keys the editor shows. Try autoplay.
   PASS: the race runs and responds, and nothing asked you to sign in first.
4. **Goal 4: model, save, undo and redo without an account.** In the Model workspace, select a part, move it, save,
   undo, redo. PASS: each does what it says. (Step 7 checks that the saved change survives a reopen.)
5. **Goal 2: build with the agent.** In the Chat, ask in one message for three changes: the kart a new colour, a
   higher top speed, and the lap time shown on screen. Check each in Play. Then start a New Chat and ask for a
   second, unrelated change. PASS: all four changes are visible in Play, and the second chat started clean. Then
   choose "Ask for approval" from the permission control under the Chat's input and ask for one more change.
   PASS: it waits for Allow, and Deny stops it. Ask for it once more and leave that approval unanswered for step 7.
6. (Windows walk 4 only; there is no step 6 on the Mac.)
7. **Goal 3: come back.** Close the editor's tab and its Terminal window. Paste the install line again. PASS: the
   same project opens with step 4's saved change, and the Chat shows step 5's conversation intact, including one
   left waiting on an approval before closing.

## Report

A table of the steps with PASS/FAIL, the exact text of each failure, the screenshots' paths, the version and the
time to first model. Then, in a few sentences, anything that confused you even where the step passed.
