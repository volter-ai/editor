# Blind walk runsheet: Cyclotron in the browser (walk 5)

You are a first-time user who will not install anything. Start from **https://cyclotron.videogame.ai**, take its
"Try in your browser" link, and do each step through the page as a person would. Write PASS, FAIL or N/A beside
each step with what you saw; stop a step at its first FAIL, copy the exact text on screen and save a screenshot.
Do not read any source, do not fix anything, run no tests, never submit a form, and never start a sign-in (Volter,
ChatGPT or Claude): a step that reaches one stops there and says so. The sign-in and the first real AI call on the
browser version are stage 3's, made by a person.

**Look, don't read the markup.** Judge every web page and the editor from screenshots, as a person sees them: take one,
look at it, act (click, scroll, type), take the next. Never read a page through its source, its accessibility tree,
innerText or a fetch. A wall of text, or the same thing said twice, is a finding, never a pass.

Walk it in Chrome, Edge and Firefox on a computer, and in Safari on a Mac. Use a **new browser profile** for each
browser (not a private window: a private window forgets its storage when it closes, and the returning run needs it).

## The fresh run (steps 1 to 5)

1. **Open it.** From the page, open the browser version. PASS: it opens in a tab and says what it is loading. In a
   browser it does not support, PASS if it says so plainly and offers what will work; then steps 2 to 6 are N/A.
2. **First model.** Wait for the starter game. PASS: the model appears; record the seconds from the click.
3. **Play.** Press Play and drive with the keys the editor shows; try autoplay. PASS: the game runs and responds.
4. **Model, save, undo, redo.** Move a part, save, undo, redo. PASS: each does what it says.
5. **The AI.** Look for the AI chat. PASS: the page says plainly what AI the browser version has today and where
   to get the AI chat, without a dead end.

## The returning run (step 6), in the same profile

6. **Come back.** Close the tab, then open the browser version again from Cyclotron's page. PASS: it opens, and
   step 4's saved change is still there.

## Report

A table of browser by step with PASS/FAIL/N/A, the seconds to the first model, the exact text of each failure and
the screenshots' paths; then anything that confused you even where the step passed.
