# The Godot lane: read this first

The owner's law for this lane (2026-09-27, `docs/GODOT.md` §The lane's law) governs every change here:

1. **Read Godot, then translate idiomatically.** Godot's source tells you what something does; it
   is never what you port. Compat members and the output are ordinary three.js, R3F, Rapier and
   DOM code. Compat never owns a main loop, clock, physics stepping, scheduler, spawn host,
   mirrored tree, registry or server. The host owns the frame and physics; React owns mounting.
2. **No formal accuracy standard.** No evidence gate, claim records, comparators or tolerances. A
   game is accepted by a blind walk, side by side with the original.
3. **No Godot class name selects behaviour** in emit, lowering or compat. The class-to-idiom mapping
   is one data table in `translate/data`.
4. **A periodic context-free review** of compat, the planner, lowering and emit
   (`docs/GODOT-REVIEW.md`, one reviewer), every 30 lane commits and before a game's acceptance
   walk, recorded in the ledger; the pre-push hook refuses a push to `godot` past 30 unreviewed
   lane commits. The pre-commit ratchet
   (`scripts/check-godot-architecture.mjs`) refuses new instances of the patterns reviews find.
5. **Decide from the law.** When a design question comes up, the answer is what the rulings and
   rows imply; decide it and build. Only a genuine conflict between them goes to the owner.

If a family seems to need something these rules forbid, find the idiomatic way the law implies;
never work around a check.

# Godot translation verification

Do not add unit or end-to-end tests to this package. Translation completeness is measured by the
lane's `report`/ladder workflow, regenerated native fixtures, and live editor evidence (`volter-game-editor
status`, Play, deterministic `volter-game-editor eval`, and screenshots). A temporary diagnostic probe must stay
temporary and uncommitted; once it identifies a class fix, delete the probe.

Keep `test/fixtures/`: they are the inputs. There are no ground-truth captures or measured records
of Godot's output (docs/GODOT.md, ruling 2); running a snippet in official Godot stays a building
tool for when behaviour is unclear, and what it shows is written into the code as a source
citation, never kept as a record. A translated app is regenerated only through the
production command `npx tsx packages/gd-analyze/src/cli.ts import <godot-project> <target>`; do not
add a fixture-specific or test-only regeneration path, freshness gate, mount runner, gameplay
assertion program, or per-generated-project TypeScript configuration.
