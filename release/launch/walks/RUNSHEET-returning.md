# Blind walk runsheet: a returning user upgrades (walk 7)

You made a game with an earlier Cyclotron and come back after a new release. You know only what Cyclotron, its
terminal output and its page tell you. Write PASS or FAIL beside each step with what you saw; stop a step at its
first FAIL, copy the exact text on screen and save a screenshot. Do not read the editor's source, do not fix
anything, run no tests, never submit a form, and never start a ChatGPT or Claude sign-in: a step that reaches a
sign-in screen stops there and says so.

**Look, don't read the markup.** Judge every web page and the editor from screenshots, as a person sees them: take one,
look at it, act (click, scroll, type), take the next. Never read a page through its source, its accessibility tree,
innerText or a fetch. A wall of text, or the same thing said twice, is a finding, never a pass.
Terminal output is read as printed.

Walk it on Windows and on a Mac, once per starting release: 0.5.202 and 0.5.203 (from before the package rename),
0.5.204, and 0.5.205 (the previous release). The starting state is made before the walk by whoever sets it up, not
by you: a playable project created with `npx @volter/cyclotron@<release> create my-race --template playable`,
opened once, its race played, one change made with the Chat and saved, and the editor closed.

## Steps

1. **Open it as you always did.** In the project folder, run `npx @volter/cyclotron`. PASS: it opens, or it says
   plainly that a newer release exists and how to move to it.
2. **Upgrade.** Do what step 1 said. If nothing in the terminal, the editor or Cyclotron's page tells you how to
   upgrade, this step is a FAIL: write down where you looked. PASS: the upgrade reports what it changed and ends
   without an error you must decode.
3. **Open again.** PASS: the project opens on the new release (the status bar shows its version), with your saved
   change in the model.
4. **Play.** PASS: the race runs and responds.
5. **Goal 3: the conversation.** Open the Chat. PASS: your earlier conversation is there, intact, and a new
   message in it gets an answer.

## Report

A table of platform and starting release by step with PASS/FAIL, the exact text of each failure and the
screenshots' paths; then anything that confused you even where the step passed.
