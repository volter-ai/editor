# Volter Editor

Volter Editor is an extensible editor. Its first release provides Blender-based
modeling. Game editing will join the same repository when ready.

The public source repositories begin with reviewed snapshots and no inherited
private git history. The previous repositories and their legacy releases remain
private under explicit `*-private-history` names.

The installed product starts its session
server and opens Blender in a packaged Code-OSS workbench. Installed MCP can
inspect, edit and photograph the model. Modeling edits persist to the project's
`.blend` file and survive reopening. Packaged-workbench startup and reuse are
verified on darwin-arm64. The matching workbench is public and anonymously
downloadable. The public npm packages and a credential-free, cache-empty
installation have passed live modeling acceptance.

The packaged workbench currently supports **macOS on Apple Silicon**
(`darwin-arm64`). Installation and startup were verified with Node.js 24.

```bash
npx @volter/editor@0.5.64 create my-models
```

The command creates a modeling project, installs the pinned public workbench on
first use, and opens Volter Editor.

The Chat pane uses a separately installed `claude` executable on PATH. A machine
without it can open the modeling surface, but reports a missing-agent-runtime
diagnostic; this package does not install or authenticate that external runtime.

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
Release 0.5.64 renders a Principled BSDF's or Emission's linked inputs from the
material's node graph with Blender's own node shaders (texture coordinates,
mapping, math, mix, color ramp, noise, Voronoi, checker and image textures);
see [WORK.md](WORK.md) for the compiled node set and its limits. It also keeps
Properties on screen while an edit re-reads them, removes the empty header
strips above the model, timeline and side panels, and restores a view's
orientation after a tab switch. Projects pinned to 0.5.63 update their
`@volter` pins and `vgai.project.json`'s engine version to open in 0.5.64.
Windows/Linux remain deferred. An older intermittent renderer
hang remains unexplained; see the acceptance limits in [WORK.md](WORK.md).

Existing projects keep their machine-local workbench declaration. Updating npm
packages alone does not replace that explicit choice. To use the newly pinned
workbench, close the editor, update the project's declared `@volter` packages,
and move `.vgai/workbench.json` aside before reopening; the product downloads and
records its matching release. Preserve an intentional source-checkout declaration.

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

Users install one product; required supporting packages install transitively.
The CLI ships in `@volter/editor`. Subpath exports represent modules within
packages, not separately installable packages.

Blender and Code-OSS source forks remain separate repositories, pinned by this
repository's build configuration. Their source and release provenance
are part of distribution readiness.

## Release boundary

The publication list is [release/modeling.json](release/modeling.json).
`npm run check:release` checks its manifest dependency boundary. Only this
explicitly reviewed package list may be published. Repository membership does
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

The build generates modules needed by the typechecks and packaging checks.
Building the separate Code-OSS workbench is described in
[`scripts/workbench/build-release.mjs`](scripts/workbench/build-release.mjs).

Public product names and commands use Volter Editor. This first release retains
`vgai.project.json`, `vgai.adapter.ts`, `.vgai/` and existing internal protocol
identifiers. Their filenames are not aliases: keep the existing names. A full
format/protocol rename is a separate coordinated migration; existing games are
not automatically converted into modeling projects.
