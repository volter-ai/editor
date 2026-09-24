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
| Integration | `@volter/editor-blender`, `@volter/editor-threejs`, `@volter/editor-react`; a canvas lane is due | one tool made a document kind: its adapters, inspectors, instruments, looks, template fragment. No purpose. |
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
- `@volter/editor-game` imports kit internals from **153** files (156 before the React move) (`authoring`,
  `stories`, `components` and `editor-shell-store` lead). It is the
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

## Target map

*Everything below this line is a design derived from the rulings above and the
measurements, not yet an owner ruling.*

| From | To | Door that replaces the direct import |
| --- | --- | --- |
| `editor-game/src/react/`, `contributions/react/`, kit `ui-source/inspect.ts` (React fiber reads) | `@volter/editor-react` (its server half moved 2026-09-24) | `vgai.contributions`; a fiber-inspection door for the kit's selection overlay |
| the `r3f-*` bindings (in `@volter/editor-react` since the React move), `editor-game/src/three/`, `contributions/three/`, kit three-viewport, Object3D document sessions, three projection | `@volter/editor-threejs` (in the modeling release already) | SDK doors for stage, selection and picking; the React Three Fiber bindings ride `@volter/editor-react`'s source-writing export |
| kit Pixi story preview and model, spritesheets; `editor-game`'s canvas authoring | the canvas lane, inside the game product until a Pixi integration exists | a story-renderer registry keyed by medium, so the kit's CSF knows no renderer |
| kit Play (`gameplay-*`, `play-boot-phase`, `reported-play-state`, scoped game CSS, game globals, `play-stall`, `support/play`); `editor-game`'s play, bridge, play bar, ingest, State Watch, network, navmesh, XState, profiler, asset budget, build | `@volter/game-editor` | the product composes; the kit keeps only media-neutral lifecycle doors |
| `src/main.ts`, `sfx.ts`'s adapter type, entry-module `systems`/`debug` | `vgai.adapter.ts` declares them; the game's modules stay plain | structural types in the adapter contract |

Order: `@volter/editor-react` first, end to end, as the reference (its server half and
contract have moved); then
`@volter/editor-threejs`; then the product half of `@volter/editor-game`, after which that
package no longer exists; then the code-side items. Each move ends with the package's
kit-internal import count at zero.
