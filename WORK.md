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
- The background Blender engine does not support native undo. Unsupported undo
  reports `moved: false`; no alternate undo implementation was introduced.
- Public names and commands use Volter Editor. Project filenames and internal
  protocol/settings identifiers remain unchanged, as documented in
  [README.md](README.md). A full format/protocol rename is a separate migration.
- Game editing, game templates and game runtime publication remain excluded.
  Full viewport extraction is deferred by the release's scope decision.
- The shipped engine is Emscripten. Optional WALI support requires externally
  supplied artifacts and is not a claim of a shipped WALI browser substrate.

No required work remains for this modeling release on darwin-arm64. The limits
above are not claims of completed support or authorization to expand this release.
