# Volter Editor public source

This repository began from a reviewed source snapshot with no inherited private
git history. Never merge or graft the private migration history into it. The
private-history repositories and their legacy releases remain private.

Read `README.md` for the release boundaries and `WORK.md` for remaining work.
Publish only the packages a reviewed list names: `release/modeling.json` (the
modeling product, eight packages) or `release/game.json` (the game editor: those
eight and its five), and keep Blender's corresponding source publicly available
before distributing its binary. Preserve package licenses, notices and the exact
source/artifact mapping.

This repository is where the modeling and game editors are developed. Their
packages began as renamed copies of the private `vgai-engine` packages; nothing
is synced between the two, so a fix lands here.

Volter Editor names this whole stack. Its products are named for their purpose:
`@volter/model-editor` and `@volter/game-editor` (owner ruling 2026-09-24).
[ARCHITECTURE.md](ARCHITECTURE.md) states the rows and rules every package follows.
