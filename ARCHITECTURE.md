# Architecture

The editor is a Code-OSS distribution built per product: a media-neutral **kit**,
**integrations** that each make one tool a document kind, and thin **products** that
compose integrations for a purpose. Games stay their own code; the editor reaches them
through adapters and contributions. The rulings this follows were made on
`volter-ai/vgai-engine` (`docs/ARCHITECTURE-CORE.md` §The target shape, owner direction
2026-09-20) and transfer here with the packages.

## The rows

| Row | Here | Knows |
| --- | --- | --- |
| Kit | `@volter/editor-core` (host, session server, workbench tier), `@volter/editor-sdk` (the one API integrations import), `@volter/editor-project` (the project contract) | documents, views, selection, history, source writing, stories as portable CSF, the session. No tool, no product, no purpose. |
| Integration | `@volter/editor-blender`, `@volter/editor-threejs`; React and a canvas lane are due | one tool made a document kind: its adapters, inspectors, instruments, looks, template fragment. No purpose. |
| Product | `@volter/editor` (modeling), `@volter/game-editor` | purpose code only: for the game editor, Play, the transport, input gating, the game layout, ingest of foreign games, the HUD template. |
| Shipped twin | `@volter/threejs-runtime`, `@volter/game-runtime` | what a project's own code ships with. Apache. |

Rules:

1. The kit names no integration and no product.
2. A package imports another package's exports, never kit internals: an integration reaches
   the kit through `@volter/editor-sdk` only.
3. Dependencies point down: product → integration → kit/SDK → project contract.
4. **The code side is unopinionated.** A game's own modules (its world, scenes, prefabs,
   components) are plain library code and import nothing of the editor. What the editor
   needs to know about a game is declared editor-side: `vgai.adapter.ts` and
   `src/contributions/`.

## Measured state (2026-09-24)

- `@volter/editor-blender` and `@volter/editor-threejs` import **zero** kit internals.
  `@volter/editor-blender` is the reference integration.
- `@volter/editor-game` imports kit internals from **156** files (`authoring` 131 imports,
  `stories` 42, `ui-source` 39, `components` 39, `editor-shell-store` 35). It is the
  three.js integration, React authoring and the game product's purpose code fused into one
  package; `@volter/editor-core` exports `./*`, so nothing stops it.
- The kit is not media-neutral. Of its 671 modules: 78 import three.js or
  `@volter/editor-threejs`; 21 run the TypeScript compiler over project source (JSX
  identity stamping, component extraction and forking, React Three Fiber physics, LOD,
  joint, particle and environment bindings); 4 import Pixi (canvas story previews,
  spritesheets); the Play purpose lives here too (`gameplay-*`, `play-boot-phase`,
  `reported-play-state`, `scoped-game-css`, the game globals shadow, `play-stall`).
- The React declared-prop analyzer (`vite-plugin-ui-oid.ts`'s worker) was never carried
  over: its resolver and worker are absent, so the Inspector falls back to syntactic props.
- On the code side, gameplay modules import nothing of the editor. Three places do:
  `src/main.ts` mounts the standalone game through `@volter/game-runtime`'s manifest
  runtime; `src/lib/audio/sfx.ts` types its mute hook against `@volter/editor-project`;
  game entry modules export `systems` and `debug` for the editor host.
- `@volter/editor-threejs` duplicates 18 files of `@volter/threejs-runtime` byte for
  byte. That is the modeling release boundary's cost (modeling depends on no game-runtime
  package), not drift.

## Target map

*Everything below this line is a design derived from the rulings above and the
measurements, not yet an owner ruling.*

| From | To | Door that replaces the direct import |
| --- | --- | --- |
| kit `src/ui-source/` JSX stamping, extract/fork/CSF planning, `vite-plugin-ui-oid.ts`, `editor-game/src/react/`, `contributions/react/`, the declared-prop analyzer | new integration `@volter/editor-react` | a project-serving door: a package declares `vgai.serving` in `package.json`, a Node module whose plugins the session adds to the project's Vite; the browser half stays `vgai.contributions` |
| kit `ui-source/r3f-*` bindings, `editor-game/src/three/`, `contributions/three/`, kit three-viewport, Object3D document sessions, three projection | `@volter/editor-threejs` (in the modeling release already) | SDK doors for stage, selection and picking; the React Three Fiber bindings ride `@volter/editor-react`'s source-writing export |
| kit Pixi story preview and model, spritesheets; `editor-game`'s canvas authoring | the canvas lane, inside the game product until a Pixi integration exists | a story-renderer registry keyed by medium, so the kit's CSF knows no renderer |
| kit Play (`gameplay-*`, `play-boot-phase`, `reported-play-state`, scoped game CSS, game globals, `play-stall`, `support/play`); `editor-game`'s play, bridge, play bar, ingest, State Watch, network, navmesh, XState, profiler, asset budget, build | `@volter/game-editor` | the product composes; the kit keeps only media-neutral lifecycle doors |
| kit `capture-viewport`'s Play branch | the Game document's owner | a capture door the owning document registers |
| `src/main.ts`, `sfx.ts`'s adapter type, entry-module `systems`/`debug` | `vgai.adapter.ts` declares them; the game's modules stay plain | structural types in the adapter contract |

Order: `@volter/editor-react` first, end to end, as the reference; then
`@volter/editor-threejs`; then the product half of `@volter/editor-game`, after which that
package no longer exists; then the code-side items. Each move ends with the package's
kit-internal import count at zero.
