# Blind walk runsheet: a returning user upgrades (walk 7)

You made a game with an earlier Cyclotron and come back after a new release. You know only what Cyclotron, its
terminal output and its page tell you. Write PASS or FAIL beside each step with what you saw; stop a step at its
first FAIL, copy the exact text on screen and save a screenshot. Do not read the editor's source, do not fix
anything, run no tests, and never start a sign-in.

Starting state, made before the walk by whoever sets it up (not by you): a playable project created with
`npx @volter/cyclotron@<old> create my-race --template playable`, opened once, its race played, one change made
with the Chat and saved, and the editor closed. Walk it twice per platform: `<old>` = the previous release, and
the oldest release people are known to be on (0.5.202).

## Steps

1. **Open it as you always did.** In the project folder, run `npx @volter/cyclotron`. PASS: it opens, or it says
   plainly that a newer release exists and how to move to it.
2. **Upgrade.** Do what it said (or, if it said nothing, what Cyclotron's page says). PASS: the upgrade reports
   what it changed and ends without an error you must decode.
3. **Open again.** PASS: the project opens on the new release (the status bar shows its version), with your saved
   change in the model.
4. **Play.** PASS: the race runs and responds.
5. **Goal 3: the conversation.** Open the Chat. PASS: your earlier conversation is there, intact, and a new
   message in it gets an answer.

## Report

A table of platform and starting release by step with PASS/FAIL, the exact text of each failure and the
screenshots' paths; then anything that confused you even where the step passed.
