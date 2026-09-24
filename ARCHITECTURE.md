# Architecture

Volter Editor is this whole stack. It is a Code-OSS distribution built per product: a media-neutral **kit**,
**integrations** that each make one tool a document kind, and thin **products** that
compose integrations for a purpose. Games stay their own code; the editor reaches them
through adapters and contributions. The rulings this follows were made on
`volter-ai/vgai-engine` (`docs/ARCHITECTURE-CORE.md` §The target shape, owner direction
2026-09-20) and transfer here with the packages.

## The rows

| Row | Here | Knows |
| --- | --- | --- |
| Kit | `@volter/editor-core` (host, session server, workbench tier), `@volter/editor-sdk` (the one API integrations import), `@volter/editor-project` (the project contract) | documents, views, selection, history, source writing, stories as portable CSF, the session. No tool, no product, no purpose. |
| Integration | `@volter/editor-blender`, `@volter/editor-threejs`, `@volter/editor-react`, `@volter/editor-xstate`; a canvas lane is due | one tool made a document kind: its adapters, inspectors, instruments, looks, template fragment. No purpose. |
| Product | `@volter/model-editor`, `@volter/game-editor` | purpose code only: for the game editor, Play, the transport, input gating, the game layout, ingest of foreign games, the HUD template. The model editor is the Blender integration on the kit. |
| Shipped twin | `@volter/threejs-runtime`, `@volter/game-runtime` | helpers a project's own code may call that return the library's own objects. Apache. |

Rules:

1. The kit names no integration and no product.
2. A package imports another package's exports, never kit internals: an integration reaches
   the kit through `@volter/editor-sdk` only.
3. Dependencies point down: product → integration → kit/SDK → project contract.
4. **The code side is unopinionated.** A game's own modules (its world, scenes, prefabs,
   components) are plain library code and import nothing of the editor. What the editor
   needs to know about a game is declared editor-side: `vgai.adapter.ts` and
   `src/contributions/`. The game is idiomatic code in its own libraries (XState's
   `createActor`, React Three Fiber components); the editor and its adapters make it the
   engine (owner ruling, 2026-09-24). A game never calls a registration API so the editor can
   see it: what the editor needs, it observes from the served module graph or the adapter.
   The ruling reaches the shipped runtimes: a runtime framework a game is written against
   (mounting, physics bridges, input, world state, system adapters) is a second programming
   model, and the adapter contract is editor-side.
5. **The kit knows no medium.** Neither core runtime nor core and SDK contracts name Three,
   React Three Fiber, Pixi or Blender types (owner ruling 2026-09-24: editor-core is the library
   other editors use; Blender is one editor that uses it). `@volter/editor-threejs` owns the
   assembled viewport; Blender and the game's Three integration extend it; core hosts views.

## Doors

- `package.json#vgai.contributions`: an integration's browser half (documents, inspectors,
  services), mounted by the product that composes it.
- `package.json#vgai.serving`: an integration's server half, a built Node module whose
  `servingPlugins(services)` joins the project's Vite. `services` are the kit's region decision,
  recorded writes and collaboration record (`@volter/editor-sdk/session/project-serving`); the
  module may also answer the kit's source questions (dialect evidence, authoring diagnostics,
  component contracts). `@volter/editor-react` is the first.
- `@volter/editor-sdk/source-authoring` and `/source-analysis`: the contract types and the
  browser-side analyzer registry shared by the kit and a source-authoring integration.

## Measured state (2026-09-24)

- `@volter/editor-blender` and `@volter/editor-threejs` import **zero** kit internals.
  `@volter/editor-blender` is the reference integration.
- `@volter/editor-react` (React source authoring, moved out of the kit) imports **zero** kit
  internals.
- `@volter/editor-xstate` imports **zero** kit internals. A project's XState machines are `machine`
  documents: read and written through the module's syntax tree, with the running actors shown
  on them. The actors are observed through a serving-side stamp on each machine the project
  declares; the game registers nothing. It replaced the inspect-only Behavior document, which
  read actors a game had to register.
- `@volter/editor-game` imports kit internals from **122** files (156 before this work). 70
  self-contained kit modules integrations share now live in `@volter/editor-sdk/kit/*`
  (registries, ids, types, codecs, the console, the session's HTTP clients); the kit imports
  them from there too. What remains is the store, the composite authoring adapter, the story
  system and the registries whose signatures name them. It is the
  three.js integration, React authoring and the game product's purpose code fused into one
  package; `@volter/editor-core` exports `./*`, so nothing stops it.
- The kit is not media-neutral. Of its 671 modules: 78 import three.js or
  `@volter/editor-threejs`; 6 still run the TypeScript compiler over project source (the
  JSX transform and the React Three Fiber bindings left with `@volter/editor-react`); 4 import Pixi (canvas story previews,
  spritesheets); the Play purpose lives here too (`gameplay-*`, `play-boot-phase`,
  `reported-play-state`, `scoped-game-css`, the game globals shadow, `play-stall`).
- On the code side, gameplay modules import nothing of the editor. Three places do:
  `src/main.ts` mounts the standalone game through `@volter/game-runtime`'s manifest
  runtime; `src/lib/audio/sfx.ts` types its mute hook against `@volter/editor-project`;
  game entry modules export `systems` and `debug` for the editor host.
- `@volter/editor-threejs` duplicates 18 files of `@volter/threejs-runtime` byte for
  byte. That is the modeling release boundary's cost (modeling depends on no game-runtime
  package), not drift.

## The plan (owner decision, 2026-09-24)

The extraction deferred on 2026-09-22 proceeds. [docs/DOCUMENT-VIEW-OWNERSHIP.md](docs/DOCUMENT-VIEW-OWNERSHIP.md)
is the specification (ownership, identity, lifecycle, the A1–A18 acceptance matrix) with
this repository's measured corrections at its head. Units, in order:

1. `@volter/editor` becomes `@volter/model-editor` (package, directory, command, product id,
   workbench).
2. Every current reverse edge is frozen by exact importer and imported module as a baseline
   that may only shrink, checked before each commit.
3. **The viewport unit:** the assembled Three viewport, its SDK contracts, its callers and the
   three-way split of `EditorShellStore` move together into `@volter/editor-threejs`; Blender's
   defaults become `@volter/editor-blender`'s specialization; the Three-typed adapter contract
   leaves `@volter/editor-project`; the kit's Blender server pieces (the WASM route, the verb
   relay, tab metrics) and the injected model document leave the kit. Acceptance: the kit
   constructs no viewport; the model editor's closure carries no game or React Three Fiber
   code; a composition without Three carries none.
4. Blender as the first consumer of document-owned evaluation and native views, walked on the
   product: open, edit, save, undo, hide/reveal, capture, disposal. The game editor's Scene edit
   and Play keep working.
5. Games become idiomatic: the template and `arena` are written in plain libraries and the
   runtime framework retires into the ingest-style adapter. Then the matrix's Play (A11–A13),
   preview (A14–A17) and split-view (A1–A10) rows.

`@volter/editor-game` dissolves along the same lines: its three.js authoring into
`@volter/editor-threejs`, its React authoring into `@volter/editor-react`, its Play, ingest and
instruments into `@volter/game-editor`. Each move ends with the package importing no kit
internals.
