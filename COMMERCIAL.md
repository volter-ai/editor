# Which license reaches what

Volter Editor is three kinds of code under three kinds of license. Each package's
`LICENSE` and `NOTICE` are the authority for that package; [LICENSE.md](LICENSE.md)
lists them. This page says which is which and what Volter AI, Inc. can offer
other terms for.

The owner's sentence it rests on: "the runtime should be apache, the editor is
agpl". Which packages are the runtime is the reading below.

## The editor is AGPL

The editor and its products are AGPL-3.0-only: `@volter/editor-core`,
`@volter/editor-threejs`, `@volter/editor-react`, `@volter/editor-ui`,
`@volter/editor-xstate`, `@volter/editor-game`, `@volter/editor-dawproject`, and
Volter's own code in `@volter/editor-blender`, `@volter/cyclotron` and
`@volter/game-editor`. Some of these carry Apache-2.0 or GPL parts beside the
AGPL code; the package's `NOTICE`, or its `LICENSE` where it has no `NOTICE`
(`@volter/editor-blender`), names the files.

## The runtime is Apache-2.0

The runtime is what a game ships and runs: the packages its gameplay code
imports and that go out with it. Those are Apache-2.0. A game's own code stays
the game author's, under whatever terms they choose.

| Package | What it is to a game |
| --- | --- |
| `@volter/game-runtime` | a dependency a Game Editor game declares and ships |
| `@volter/threejs-runtime` | a dependency a Game Editor game declares and ships |
| `@volter/editor-project` | the project contract (`volter.adapter.ts`, the manifest); a dependency a Game Editor game declares |
| `@volter/editor-model-play` | the play-script API a Cyclotron game's `*.play.ts` is written against |
| `@volter/editor-sdk` | the API a project's own contributions and tools import |

`@volter/game-live`, `@volter/editor-live` and `@volter/dawproject` are also
Apache-2.0. So is `@volter/ztrack`, which is published from another repository
and which a Game Editor project's `.volter/tracker/` files import.

**A project is more than its game.** Its adapter (`volter.adapter.ts`), its
contributions (`src/contributions/`) and its tools (`src/tools/`) extend the
editor and run inside it. They import editor packages under those packages'
own licenses, and the Apache-2.0 claim above does not reach them:

- the project `cyclotron create` writes has a `volter.adapter.ts` that imports
  `@volter/editor-blender` (AGPL and GPL), and it depends on `@volter/cyclotron`
  and `@volter/editor-blender` to be edited;
- a Game Editor project's tools and contributions may import
  `@volter/editor-dawproject` and `@volter/editor-threejs` (AGPL).

A Cyclotron game's gameplay files (`*.play.ts`, `src/ui/`) import three and
React, and of Volter's only, optionally, the types of
`@volter/editor-model-play`. Play runs a play script inside the editor.

## Blender, and anything derived from it, is GPL

`@volter/blender-engine` is Blender compiled to WebAssembly and is
GPL-3.0-or-later in whole. Blender's icon artwork traced into
`@volter/editor-blender` and the workbench theme, and
`@volter/editor-blender`'s `contributions/blender-pose.ts`, which follows
Blender's own source, are GPL-3.0-or-later; the `LICENSE` beside them names
them. None of it is part of the runtime: no Apache-2.0 package contains or
imports it.

## Other terms

Volter AI, Inc. holds the copyright in its own AGPL code and can offer it under
other terms. It cannot offer other terms for Blender, for anything derived from
Blender, or for any third-party code: that copyright is its authors', and no
commercial license from Volter AI, Inc. reaches it.

To ask about other terms, write to Volter AI, Inc. at
[contact@videogame.ai](mailto:contact@videogame.ai).
