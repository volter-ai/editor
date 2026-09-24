# Volter Editor

Volter Editor is an extensible editor. It ships two products from this
repository: Blender-based modeling (`@volter/editor`) and game editing
(`@volter/game-editor`).

The public source repositories begin with reviewed snapshots and no inherited
private git history. The previous repositories and their legacy releases remain
private under explicit `*-private-history` names.

The installed product starts its session
server and opens Blender in a packaged Code-OSS workbench. Installed MCP can
inspect, edit and photograph the model. Modeling edits persist to the project's
`.blend` file and survive reopening. Packaged-workbench startup and reuse are
verified on darwin-arm64. The matching workbench is public and anonymously
downloadable. The public npm packages download anonymously byte-identical to
the tested archives, and cache-empty installations of both products from the
registry have passed live acceptance.

The packaged workbench currently supports **macOS on Apple Silicon**
(`darwin-arm64`). Installation and startup were verified with Node.js 24.

```bash
npx @volter/editor@0.5.65 create my-models
```

The command creates a modeling project, installs the pinned public workbench on
first use, and opens Volter Editor.

The Chat pane runs whichever coding agent Supercode finds installed and signed in
(Claude Code, Codex, Grok, Gemini and the others it supports), resuming the
project's last conversation with the agent that held it. A machine with none can
open the modeling surface, and the pane names each agent with Supercode's own
repair; this package does not install or authenticate any agent.

To reopen the project later:

```bash
cd my-models
npm run dev
```

From that project directory, `npx volter-editor status` reports the session,
`npx volter-editor console` reports unresolved diagnostics, and
`npx volter-editor close` stops the session. Release 0.5.58 adds native Blender
undo/redo for supported model edits through VS Code's history, bundled Blender
Essentials, coherent duplicate/delete operations, and World mapping/strength
rendering fixes. Release 0.5.62 additionally makes edit acknowledgment wait for
the saved file, guards close against failed saves, and fixes rapid history and
cold-start races, including stale Properties reads after rapid edits.
Release 0.5.63 adds physical material inputs, normal maps, named UV layers,
Clip sampling and homogeneous World volumes. Its rebuilt workbench preserves
the chosen sidebar across cold restarts, and its fresh product install reports
zero npm vulnerabilities. These renderer features are not full Cycles parity.
Release 0.5.64 renders a Principled BSDF's or Emission's linked inputs,
including Normal, from the material's node graph with Blender's own node
shaders (the procedural textures, image textures with every projection and
UDIM tiles, bump and normal maps, geometry and attributes, colour and vector
math) and composes Mix and Add Shader surfaces; see [WORK.md](WORK.md) for the
compiled node set and its limits. It also keeps
Properties on screen while an edit re-reads them, removes the empty header
strips above the model, timeline and side panels, and restores a view's
orientation after a tab switch. Projects pinned to 0.5.63 update their
`@volter` pins and `vgai.project.json`'s engine version to open in 0.5.64.
Release 0.5.65 publishes the game editor beside modeling from the same
source revision, and every bundled dependency notice names its source.
Projects pinned to 0.5.64 update their `@volter` pins and engine version the
same way to open in 0.5.65.
Windows/Linux remain deferred. An older intermittent renderer
hang remains unexplained; see the acceptance limits in [WORK.md](WORK.md).

Existing projects keep their machine-local workbench declaration. Updating npm
packages alone does not replace that explicit choice. To use the newly pinned
workbench, close the editor, update the project's declared `@volter` packages,
and move `.vgai/workbench.json` aside before reopening; the product downloads and
records its matching release. Preserve an intentional source-checkout declaration.

## Game editor

```bash
npx @volter/game-editor@0.5.65 create my-game
```

`create` takes a preset: `game` (the default 3D starter), `prototype`,
`full`, `website` or `empty`. The game opens in the Game workspace: Scene
editing writes the game's own source and undoes through the workbench's
history, Play runs it beside the editor, and Export builds a web bundle.

A game is only its code. Its `node_modules` is a link to the game editor's
**runtime image**: one installation per version, carrying every package the
template and the capability catalog use (React, Three.js and its React
bindings, Rapier, Colyseus, Storybook, Vite, TypeScript and the rest). The
first `create` of a version installs the image into
`~/.volter/images/game-editor-<version>` (or `$VOLTER_HOME/images/...`); every
later game of that version installs nothing. `vgai.project.json`'s
`engine.version` names the image a game opens with. A game that needs a
package outside the image installs its own dependencies into a real
`node_modules` directory instead of the link.

From a game directory, `npx volter-game-editor` provides `status`, `console`,
`eval`, `play`, `stop`, `screenshot`, `add`/`remove`/`outdated` for catalog
capabilities, and `close`. The game editor pins its own public workbench
release, verified on darwin-arm64.

## Package map

The npm scope is `@volter`.

| Package | Responsibility |
| --- | --- |
| `@volter/editor` | Installable product and `volter-editor` executable |
| `@volter/editor-core` | Shared editor host and Code-OSS integration |
| `@volter/editor-sdk` | Extension and contribution APIs |
| `@volter/editor-live` | Independently installable session automation client |
| `@volter/editor-project` | Project manifest and adapter contracts |
| `@volter/editor-threejs` | Shared Three.js editor functionality |
| `@volter/editor-blender` | Blender documents, tools and presentation |
| `@volter/blender-engine` | Blender WebAssembly engine and worker |
| `@volter/game-editor` | Installable game product, `volter-game-editor` executable, template and capability catalog |
| `@volter/editor-react` | React source authoring: JSX identity, source writes, component contracts and declared props |
| `@volter/editor-game` | Game documents, Play, Scene/UI authoring and game host modules |
| `@volter/game-live` | Session client for a running game: `game`, `page`, recordings |
| `@volter/game-runtime` | Runtime a game ships with |
| `@volter/threejs-runtime` | Three.js runtime a game ships with |

Users install one product; required supporting packages install transitively.
The modeling CLI ships in `@volter/editor`, the game CLI in
`@volter/game-editor`. Subpath exports represent modules within
packages, not separately installable packages.

Blender and Code-OSS source forks remain separate repositories, pinned by this
repository's build configuration. Their source and release provenance
are part of distribution readiness.

## Release boundary

The publication lists are [release/modeling.json](release/modeling.json) and
[release/game.json](release/game.json). `npm run check:release` and
`npm run check:release:game` check their manifest dependency boundaries. Only
these explicitly reviewed package lists may be published. Repository membership does
not imply publication.

The modeling release must not depend on unreleased game runtime, game editor,
DOM/canvas authoring, game templates, examples or provider packages. Renaming,
bundling or making those dependencies optional does not establish separation.
Actual packed files, declarations, lazy imports, generated bundles and assets
must satisfy the boundary as well as package manifests.

Three-aware core is permitted for this release. Full viewport extraction is
deferred; this migration must not restart that refactor or duplicate Code-OSS
workbench responsibilities.

This repository is authoritative for the released modeling product. The previous
repositories are archived and private.

See [WORK.md](WORK.md) for the recorded release acceptance.

Source products may open an explicitly supplied matching Code-OSS checkout. The
identity check still applies. Published product manifests pin a public workbench
release and its SHA-256.

Licenses vary by component; see [LICENSE.md](LICENSE.md) and each package’s
license and notice files.

The installed product owns the command line: `volter-editor edit` opens the
project, `volter-editor eval` drives its automation API, and
`volter-editor blender-mcp` serves the Blender MCP interface over stdio from
inside a project. MCP initialization does not start Blender; its first scene
request attaches to or opens that project's editor.

Blender supports explicit native undo in background mode. The editor connects
its checkpoints to VS Code's history; native snapshots stay in Blender, and
redo never reruns a Python script. History is session-local and is reset when
another `.blend` is opened. Use the dedicated inspection tools for read-only
queries: arbitrary Python executions are conservatively treated as edits,
including scripts that change data before failing.
Use the editor's Undo/Redo for integrated history; scripts should not manage
`bpy.ops.ed.undo_push` themselves. Loading a file or moving Blender's native
history directly invalidates the workbench's previous model entries.

## Building from source

With Node.js 24 and npm, install the lockfile and build before typechecking:

```bash
npm ci
npm run build
npm run typecheck
npm test
npm run check:release
npm run check:packed-imports
```

`npm run build:game`, `npm run check:release:game` and
`npm run check:packed-imports:game` do the same for the game release.

The build generates modules needed by the typechecks and packaging checks.
Building the separate Code-OSS workbench is described in
[`scripts/workbench/build-release.mjs`](scripts/workbench/build-release.mjs).

Public product names and commands use Volter Editor. This first release retains
`vgai.project.json`, `vgai.adapter.ts`, `.vgai/` and existing internal protocol
identifiers. Their filenames are not aliases: keep the existing names. A full
format/protocol rename is a separate coordinated migration; existing games are
not automatically converted into modeling projects.
