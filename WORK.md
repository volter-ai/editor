# Public release status

Volter Editor's first modeling release is published and its darwin-arm64
acceptance is complete. The eight-package publication boundary is
[release/modeling.json](release/modeling.json). Game packages are excluded;
Three-aware core is permitted.

## Published artifacts

- [Editor v0.5.57](https://github.com/volter-ai/editor/releases/tag/v0.5.57)
  records the npm source commit. All eight packages are public under `@volter`;
  exact versions and archive digests are in
  [public-npm-release.json](provenance/public-npm-release.json).
- The public darwin-arm64 workbench was built from Code-OSS `f8664703ab59`
  with editor overlay `d7489dea9dcd`. The product pins release
  `editor-f8664703ab59-d7489dea9dcd-darwin-arm64` and SHA-256
  `57692dc03bd5e37f1b02c817bf0601ee3f3d410b6147c24ccd978d22ff4f81ca`.
  See [public-workbench-release.json](provenance/public-workbench-release.json).
- Blender corresponding source and dependency-source archives were published
  before binary distribution. The reviewed source mapping is in
  [blender-source-review.json](provenance/blender-source-review.json), with
  artifacts in the
  [Blender release](https://github.com/volter-ai/blender/releases/tag/blender-5.2.0-wasm.1).
- Editor, Code-OSS and Blender public repositories start with reviewed root
  snapshots, without inherited private history. They are authoritative. Former
  repositories and legacy releases remain archived and private under explicit
  `*-private-history` names. There is no recurring source-export process.

## Verified public acceptance

1. A fresh installation resolved all eight packages from the public registry
   with `NODE_AUTH_TOKEN` and `NPM_TOKEN` removed, `/dev/null` as the npm user
   config, an empty npm cache and no workspace links. Verification used Node.js
   24 on macOS Apple Silicon.
2. Installed `@volter/editor@0.5.57` anonymously downloaded the public workbench
   with no pre-existing cache entry, matched its SHA-256, extracted it and opened
   the generated modeling project at its stable URL.
3. The installed session presented the cube, grid, Outliner, Properties and Chat
   in a populated 1728x941 editor capture. Repeating `edit` reused the same tab
   id with one editor client. This does not claim reload-free reuse. The sole
   initial zero-size canvas sample was acknowledged after the current invariant,
   visible capture and live frame rate proved the canvas healthy; the final
   console was silent.
4. Installed Blender MCP exposed 28 tools and one prompt, read the live scene,
   moved Cube to X=3.125, saved the `.blend`, inspected the result and captured a
   valid PNG viewport without rewriting the adapter. A full Blender worker
   stop/start reopened the saved file at X=3.125. Final status reported one
   visible blessed tab, aligned controls, a saved document and zero page,
   console or session errors and warnings. The acceptance session was then
   closed through the product CLI.
5. Build, package typechecks, three tests, release-boundary checks and packed
   import checks passed before publication. Packed import checks covered 1,083
   files across the eight packages. Generated bundled-code notices and pinned
   upstream notices are documented in [release/NOTICES.md](release/NOTICES.md).

Earlier private-candidate provenance remains historical evidence only; it is
not the workbench pinned by the published product.

## Known limits and scope decisions

- Only darwin-arm64 has a published, accepted packaged workbench. Other
  platforms are not part of this release's support claim.
- The published release has no undo integration. Explicit native undo works in
  the background engine; integration is in progress below, not yet released.
- Public names and commands use Volter Editor. Project filenames and internal
  protocol/settings identifiers remain unchanged, as documented in
  [README.md](README.md). A full format/protocol rename is a separate migration.
- Game editing, game templates and game runtime publication remain excluded.
  Full viewport extraction is deferred by the release's scope decision.
- The shipped engine is Emscripten. Optional WALI support requires externally
  supplied artifacts and is not a claim of a shipped WALI browser substrate.

## Supported-editing follow-up (owner requested)

The original darwin-arm64 release is published. The next assigned work is:

1. Native Blender undo/redo for supported UI and Python/MCP edits, integrated
   with Code-OSS history; verify grouping, restoration, redo and saving.
2. Ship Blender Essentials assets and verify the asset-backed operations.
3. Build, publish and verify Windows/Linux workbenches.
4. Close common material/environment rendering gaps within the Three.js renderer;
   world-volume rendering remains outside this pass.
5. Polish duplication/deletion interactions without expanding inspection-only
   panels into full manual authoring tools.

Investigation: the shipped worker successfully executes `bpy.ops.ed.undo_push`,
`undo` and `redo`. Background mode does not prohibit undo; it needs explicit
initialization and edit recording. No engine binary change was needed for that
probe. Integration and full supported-edit verification are still outstanding.

Essentials source integration verified: the pinned 17-file asset payload mounts
at `/bw/datafiles/assets`. In the live worker, Blender loaded the Smooth by
Angle node group, evaluated it on Cube, and loaded the Smooth sculpt brush,
with zero console errors/warnings. An anonymous public LFS download matched
the manifest SHA-256. The next npm release still needs to convey this payload.

Native-history source acceptance (2026-09-23, darwin-arm64): a local validation
workbench exercised the real Code-OSS undo service and Blender worker. Python
and RNA edits restored and redid their exact positions; a refused read-only
property preserved redo; a partially failing Python edit remained undoable.
A Properties number edit and an eight-move viewport gizmo drag each restored in
one undo. Batch duplication preserved the copied parent/child relationship and
selected both copies; one undo removed both, and redo restored both. Batch
deletion restored both objects and their relationship in one undo. File loading
and direct native undo invalidated old workbench entries; worker stop/start
reopened the saved position with empty session history. Final console was silent.
This is source acceptance, not a new published release; the validation workbench
is explicitly dirty and cannot be published.

The follow-up also evaluates linked World Background strength and Blender's
POINT/TEXTURE/VECTOR/NORMAL Mapping semantics, including inverse mapping with a
zero scale. The live worker presented the linked-strength/Texture-mapping world
without warnings. World volumes remain excluded. Duplication is one coherent
native operation; this does not claim Blender's modal duplicate-and-move UI.

The clean workbench from editor `81f87ec200f3` is now published as
`editor-f8664703ab59-81f87ec200f3-darwin-arm64`; a complete anonymous download
matched SHA-256 `2e2139867dda53aaa6fef58005443b9626d2f2975011c342487b1613b8464ef5`.
Its source and all extensions compiled without errors. The workbench's cached
asset identity includes the editor overlay through upstream's `BUILD_SOURCEVERSION`.
The 0.5.58 train (Blender packages 0.1.1) pins this artifact. Build, all package
typechecks, 21 tests, release-boundary and 1,083-file packed-import checks passed.
An installed-tarball project exercised Python and RNA undo/redo, Essentials
Smooth by Angle loading, duplication and deletion restoration in that workbench.
Publication and anonymous-registry acceptance of the npm train remain next.

Windows/Linux still require suitable native runners; none were registered, and
paid capacity has not been authorized. Their platform-specific implementation
and native acceptance remain incomplete, not merely their artifact uploads.
