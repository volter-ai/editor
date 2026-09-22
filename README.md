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
verified on darwin-arm64. Public workbench publication, registry installation
acceptance and consumer cutover are tracked in [WORK.md](WORK.md).

## Package map

The npm scope is `@volter`, confirmed by the owner and the organization's member
page. Package availability and release readiness are checked separately.

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
The CLI need not be a separate public package. The old general SDK must be
reviewed and its required code placed with its actual owners, not renamed into
a second ambiguous SDK. Subpath exports represent modules within packages,
not separately installable packages.

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

Transferred code becomes authoritative here after verified cutover. Do not
establish permanently divergent copies or a recurring source-export process.

See [WORK.md](WORK.md) for the migration and release gates.

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

The current background Blender engine does not support native undo. The editor
reports that limitation; an empty history does not claim an edit was undone.

Public product names and commands use Volter Editor. This first release retains
`vgai.project.json`, `vgai.adapter.ts`, `.vgai/` and existing internal protocol
identifiers. Their filenames are not aliases: keep the existing names. A full
format/protocol rename is a separate coordinated migration; existing games are
not automatically converted into modeling projects.
