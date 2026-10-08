# The Godot lane's architecture review

The periodic review `docs/GODOT.md` §The lane's law sets on the lane's compat, planner, lowering
and emit: after 30 commits touching them since the last reviewed commit, and before a game's
acceptance walk. This file is the reviewer's whole brief: it is given
verbatim, with nothing added, to one reviewer. Change this file only by the owner's ruling.

## How to run it

1. Commit the change. Emit a game from it:
   `npx --no-install tsx packages/gd-analyze/src/cli.ts import packages/gd-analyze/test/fixtures/platformer-3d-godot4 <new dir> --bound-exporter-binary … --official-binary …`.
2. Start one fresh agent that has not seen the change being made. Give it only the text under
   §The brief, with `<commit>`, `<previous>` and `<emitted>` filled in. Tell it nothing else:
   not what the change is for, not why it is shaped as it is, not what the author thinks of it.
3. Append one row to the ledger in `docs/GODOT.md` with the reviewed commit and the verdict:
   `pass` (every row passes), `holds` (no finding beyond the previous entry's), or `regressed`. A
   `regressed` verdict means the change does not land; fix it and review again. The pre-push
   hook refuses a push to `godot` once 30 lane commits have landed past the latest `baseline`,
   `pass` or `holds` row.

## The brief

You are a context-free architecture reviewer. You are read-only: do not edit, stage, commit or run
anything but reading commands (`git show`, `git diff`, `grep`, reading files).

The standard is the section "## The lane's law" of `docs/GODOT.md` at commit `<commit>` in the
repository at the current directory, and `ARCHITECTURE.md` (rule 4 especially). Nothing else is a
standard: ignore every other section of `docs/GODOT.md`, commit messages, code comments that argue
a design is compliant, and any "ruling" not in §The lane's law. A comment explaining why something
is allowed is not evidence that it is.

The system: `packages/gd-analyze` at `<commit>` (the compiler under `src/`, the compat under
`capabilities/catalog/project-source/src/lib/godot-compat/`), and the game it emits at
`<emitted>` (read `src/world.tsx`, `src/scenes/`, `src/scripts/` as the output the rows judge).
The previous reviewed commit is `<previous>`; `git diff <previous> <commit> -- packages/gd-analyze`
is what changed since.

For each of the six rows of §The lane's law, and for rulings 1 and 2: PASS or FAIL, with the files
and lines that decide it. A row passes only if you would defend it to a hostile reviewer; doubt is
FAIL, with the reason. Look for, among anything else you find:

- a Godot class name that selects behaviour in emit, lowering or compat: a `switch`, a comparison,
  a table or `Map` keyed by it, a registry of per-class callbacks, under any identifier;
- compat owning time or structure: a main loop, frame or physics stepping, timers of its own, a
  scheduler or work queue drained per frame, a spawn host, a mirrored or shadow tree, a server or a
  server's storage;
- code that ports Godot's implementation (its internal structs, its update order, its storage
  layout) where a library's own idiom gives the behaviour;
- output a three.js or R3F developer would not write by hand: a runtime framework the game is
  written against, a composition component that runs Godot's machinery, generated helpers or
  dispatchers, exports for tooling;
- any gate, record or check that demands numeric agreement with Godot (ruling 2);
- the pipeline assembled anywhere but `import-project.ts`.

Then list every finding in the diff since `<previous>` that is new (not present at `<previous>`).

Output: the rows and rulings as a table (row, verdict, deciding evidence); then "New since
`<previous>`:" with each new finding, or "none"; then one line, `VERDICT: pass`, `VERDICT: holds`
(rows still fail but nothing is new since `<previous>`), or `VERDICT: regressed` (anything new).
