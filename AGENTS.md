# Volter Editor public source

This repository began from a reviewed source snapshot with no inherited private
git history. Never merge or graft the private migration history into it. The
private-history repositories and their legacy releases remain private.

Read `README.md` for the release boundaries and `WORK.md` for remaining work.
Publish only the packages a reviewed list names: `release/modeling.json` (the
modeling product, eight packages), `release/game.json` (the game editor), or
`release/playable.json` (the playable Model Editor skew and its tool dependency
closure). Keep Blender's corresponding source publicly available
before distributing its binary. Preserve package licenses, notices and the exact
source/artifact mapping.

This repository is where the modeling and game editors are developed. Their
packages began as renamed copies of the private `volter-engine` packages; nothing
is synced between the two, so a fix lands here.

## Learning from editor sessions

Integrate verified task changes into shared main promptly. Worktrees isolate
active work; they must not hide finished fixes from other agents. The owner has
authorized routine merging without another approval. Preserve concurrent work,
resolve conflicts against current main, and verify the integrated result.

Fix a recurring failure in its owning engine or editor package when the product
can enforce the correct behavior. Use the product's default project `AGENTS.md`
for reusable authoring judgment and workflow guidance when a code fix does not
apply; keep `CLAUDE.md` importing that shared source. Do not teach users internal
workarounds or previous failures through longer task prompts.

For first-time-user iterations, keep the user's request and supplied references
fixed while improving the product and its defaults. Inspect the references to
derive the result instead of transcribing them into the prompt. For a new game
with a visual target, establish a matching static model and React UI screenshot
before implementing gameplay. Retain failures and report independently verified
results separately from the author's claims.

Volter Editor names this whole stack. Its products are named for their purpose:
`@volter/model-editor` and `@volter/game-editor` (owner ruling 2026-09-24).
[ARCHITECTURE.md](ARCHITECTURE.md) states the rows and rules every package follows.

The Godot lane (`packages/gd-analyze`) is under the owner's 2026-09-27 law
([docs/GODOT.md](docs/GODOT.md) §The lane's law): read Godot, translate idiomatically,
never transcribe; no formal accuracy standard; mechanical architecture checks on every commit
and a periodic context-free review ([docs/GODOT-REVIEW.md](docs/GODOT-REVIEW.md)) of its compat,
planner, lowering and emit. Read the law before changing anything there.
