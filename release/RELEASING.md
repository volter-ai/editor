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
   move and leaves nothing it names as kept that the release refuses; after `npm install` it opens, plays and
   passes step 4. Where the candidate's version is not on the registry yet, upgrade to the newest published one
   with the candidate's command, and read the move itself; the open, Play and Chat follow after the promotion.
7. Whatever the release's own changes claim, read through the doors a person uses.

Say in the report which platforms were read and which could not be reached. Step 4 needs a coding agent already
signed in on the machine that reads it, and nobody starts a ChatGPT or Claude sign-in for it without the owner's
yes: a platform with no signed-in agent could not be reached, and the report says that was why.

## After the promotion

- Read every package of the release on the registry: its version, and that it is not npm's staged stub. A new
  name can read as the stub for some minutes.
- `upgrade` to the new release on the project step 6 upgraded, then open, Play and step 4 again in it.

## Pinning a workbench

A workbench release (`packages/cyclotron/package.json`, `volter.product.workbench`, keyed by platform)
carries the editor's half of Code-OSS and the extensions it bundles, among them the Chat (`supercode-chat`, `@volter/supercode-frontend-vscode`). A new
pin changes those for every project at once, so before the pin is committed, on that workbench:

- each bundled extension whose version changed is read through the doors it serves. For the Chat: a new
  conversation's first message runs a turn, a follow-up runs, and the conversation reopens;
- the boot splash and the frame are looked at.

The pin commit names the extension versions it moves from and to, and what was read.
How a workbench is cut and published is [PLAYABLE.md](PLAYABLE.md) step 2; this section is what is read before its pin. A pin made on the workbench
build's own checks alone is not read: those checks do not drive the Chat. (0.5.199 to 0.5.203 shipped a Chat that
refused every new conversation's first message because a pin moved the Chat from 0.1.51 to 0.1.52 on the build's
checks alone; 0.5.204 pinned back.)
