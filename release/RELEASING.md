# Releasing the editor

How a release of the editor packages (`release/game.json`) and a workbench pin are made, and what is read before
each. The publish mechanics are `.github/workflows/publish.yml` and [WORK.md](../WORK.md); this file is what a person
or agent does before they run.

A release is made from one measured `main` commit pushed to `publish`. Nothing below is a gate in CI: each reading is
done by whoever cuts the release, on a real machine, and its results go in the release's report.

## Before the promotion: the end-of-coding run

On the exact commit to be promoted, from a clean worktree:

1. `npm ci`, `npm run build:game`, and `npm pack` of every package in `release/game.json`, into one folder.
2. In an empty folder, install all of those tarballs together. `npx --no-install cyclotron --help` and
   `npx --no-install volter-game-editor --help` exit 0, and the install holds one copy of `@volter/sdk`.
3. A playable project created from that build opens; Play runs; its manual controls and autoplay work; the console
   has no unresolved errors.
4. **The Chat, on each platform's pinned workbench that can be reached:** in that project, a new conversation's
   first message runs a turn (the agent answers in the Chat), a follow-up in the same conversation runs, and the
   conversation reopens after the editor is closed and opened again. A conversation already under way is not
   enough: only a new conversation's first message meets the start of the path every person takes first.
5. The refusals the release claims: a folder with the product but no `editor/volter.adapter.ts` is refused by name;
   a game build that imports from `editor/` fails.
6. **Upgrade, before anything is published:** a project made by the previous release (and by the oldest release
   people are known to be on), upgraded with the candidate's own `upgrade` from the packed install, reports each
   move and leaves nothing it names as kept that the release refuses; once its packages are installed (`npm
   install`, or for a game on the runtime image the link `upgrade` makes) it opens, plays and passes step 4. The
   candidate is not on the registry yet, so upgrade to the newest published release with the candidate's command
   (that reads the move), then install the candidate's packed tarballs from step 1 over the upgraded project, and
   open, Play and step 4 there, all before the promotion. Install them so the project declares only what it
   declared: each `@volter` package it names points at its tarball, and an `overrides` entry per tarball sends every
   other `@volter` package there too (installing all the tarballs by name declares packages the project never
   declares, and the editor then serves and crawls them: a false failure). The tarballs carry main's pre-release
   versions, one below what the upgrade pinned, so set the project's `engine.version` to the candidate's own version
   for this reading; the published release matches its pin.
7. Whatever the release's own changes claim, read through the doors a person uses.

Say in the report which platforms were read and which could not be reached. Step 4 needs a coding agent already
signed in on the machine that reads it, and nobody starts a ChatGPT or Claude sign-in for it without the owner's
yes: a platform with no signed-in agent could not be reached, and the report says that was why.

## The promotion

A release writes its version commit back to `publish` only. Before the next promotion, that commit is merged into
main (a "Reconcile published <version> versions" pull request, as #274 and #315 did): without it, main's packages
still read the last release's numbers, the push to `publish` is not a fast-forward and is rejected, and autorelease
would try to publish a version npm already has. Merge it into the measured commit itself (the merge changes only
versions, the lockfile's version fields and the release's pinned files; read that it does), land that merge on main,
and push that same commit to `publish`. 0.5.204's push was refused because 0.5.203's version commit was never merged.

## After the promotion

- Read every package of the release on the registry: its version, and that it is not npm's staged stub. A new
  name can read as the stub for some minutes.
- `upgrade` to the new release on the project step 6 upgraded, then open, Play and step 4 again in it.
- Merge this release's version commit from `publish` into main now (the reconcile pull request above), so the next
  promotion is not refused.

## Pinning a workbench

A workbench release (`packages/cyclotron/package.json`, `volter.product.workbench`, keyed by platform)
carries the editor's half of Code-OSS and the extensions it bundles, among them the Chat (`supercode-chat`,
`@volter/supercode-frontend-vscode`). A new pin changes those for every project at once, so before the pin is
committed, on that workbench:

- each bundled extension whose version changed is read through the doors it serves. For the Chat: a new
  conversation's first message runs a turn, a follow-up runs, and the conversation reopens;
- the boot splash and the frame are looked at.

The pin commit names the extension versions it moves from and to, and what was read.
How a workbench is cut and published is [PLAYABLE.md](PLAYABLE.md) step 2; this section is what is read before
its pin. A pin made on the workbench build's own checks alone is not read: those checks do not drive the Chat.
(0.5.199 to 0.5.203 shipped a Chat that refused every new conversation's first message because a pin moved the
Chat from 0.1.51 to 0.1.52 on the build's checks alone; 0.5.204 pinned back.)
