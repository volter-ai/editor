# Public release status

The first release is Volter Editor with Blender modeling. The eight-package
publication list is `release/modeling.json`. Game packages are excluded;
Three-aware core is permitted.

## Verified in the new repository

- Project/SDK contracts, shared Three code, Blender engine/integration, editor
  frontend, session server, automation client and product executable are staged.
  Transfers retain licenses and pinned source hashes under `provenance/`.
- The product owns project creation. Core loads its executable declaration;
  core does not choose a game template or import the retired game scaffolder.
- Actual archives installed outside this checkout without npm credentials or
  workspace links. The generated modeling adapter typechecks against them.
- Installed `volter-editor edit` starts the session and the matching isolated
  Code-OSS development checkout. Blender opens the starter `.blend`, presents
  its cube, and populates the Outliner and Properties. A bpy transform survived
  worker disposal/restart and reopening the saved project file. Document capture
  returned the actual viewport. This is development-workbench acceptance, not
  packaged-workbench or public-release acceptance.
- Proxy startup now waits for Code-OSS's route prefix instead of silently serving
  a blank window after a startup race. The adapter participates in initial Vite
  dependency discovery even when the project declares no game roots.
- The bundled server includes its directly served tab-bootstrap script. The
  production workbench no longer requests the development-only React preamble.

- The final archive install includes the declared Supercode runtime; its binary
  starts from the installed package without a global executable. Against the
  clean packaged Code-OSS build at `9b4e5584bdf9`, installed Blender MCP exposes
  28 tools and one prompt and passes live scene read, bpy mutation, object
  inspection and viewport capture. Screenshots use the bound model's address;
  unchanged staged inputs are not rewritten during output mirroring, avoiding
  adapter reloads in the middle of an MCP request.
- Unsupported native Blender undo now returns `moved: false` in the installed
  product. Its pre-existing limitation remains; no second undo implementation
  was introduced.

- `check:packed-imports` checks literal imports in npm's packed source,
  declarations and bundles (1,083 files across eight packages). Runtime imports
  now declare `undici`, `esbuild`, `postcss`, `picomatch`, `fflate` and
  `tinyglobby` directly instead of relying on transitive installation.

- The release build now generates bundled-code license notices and records
  their hashes. Missing npm notices have pinned upstream copies under
  `release/licenses/`; see `release/NOTICES.md` for the exact coverage and limits.

## Verified release preparation

1. Packaged-workbench acceptance passes on darwin-arm64. The clean
   archive records editor source `856753836e29`, fork `9b4e5584bdf9`, the added
   chat license packaging step, and SHA-256
   `c4f5c884853cda029e457a6e4dffa06a12fdc60d38f16b299b2f13b9a22f558a`.
   A fresh modeling project from the installed product opened normally with one
   browser tab, the cube, Outliner, Properties and native Chat. A repeated edit
   reused that tab. One transient initial zero-size-canvas warning was
   acknowledged after visual verification; it did not recur. No unresolved
   console entries remained when the probe closed. The product now pins the
   private candidate release; a cache-empty authenticated download verified the
   archive checksum and installed without an explicit workbench path. That
   intentional stop/start emitted a previous-session orphan notice; after the
   connection settled to one live tab it was acknowledged with that evidence.
   Browser-level closing of old tabs was not independently verified.
2. Public naming changes are verified in the built candidate and CLI. Retain
   project filenames and internal protocol/settings identifiers for this release;
   README names them explicitly. Full CLI creation from the public registry,
   anonymous workbench download and any additional supported platforms remain
   future public-launch acceptance, not claims made by this private probe.
3. The reviewed modeling boundary passes on final archives. Literal
   imports pass across 1,083 packed files. Nonliteral loads use project-owned
   adapter/contribution paths, served module doorways, declared Supercode
   packages, or engine artifact URLs. The shipped engine is Emscripten; the
   optional WALI implementation requires an externally supplied artifact tree
   and does not ship the browser-substrate packages. Non-code payloads are the
   starter cube, engine artifacts/LUTs, Inter and the Blender icon font; engine
   source review and workbench notices cover their separate distribution gates.
4. Fresh public Code-OSS and Blender repositories contain one reviewed root
   snapshot each and no private history. Their former repositories and releases
   remain private under `code-oss-private-history` and
   `blender-private-history`. Blender corresponding source and dependency-source
   archives are publicly available before its binary distribution.
5. The matching public darwin-arm64 workbench was built from Code-OSS
   `f8664703ab59` with editor overlay `d7489dea9dcd`, published as
   `editor-f8664703ab59-d7489dea9dcd-darwin-arm64`, and independently verified
   against SHA-256
   `57692dc03bd5e37f1b02c817bf0601ee3f3d410b6147c24ccd978d22ff4f81ca`.
   An anonymous range download succeeded, and the product manifest pins that
   public release.

## Verified public release

1. The eight modeling packages are public on npm in dependency order. A fresh
   installation resolved all eight from the public registry with `NODE_AUTH_TOKEN`
   and `NPM_TOKEN` removed, `/dev/null` as the npm user config, a new empty npm
   cache, no workspace links and no pre-existing workbench cache entry.
2. Installed `@volter/editor@0.5.57` anonymously downloaded the 142 MB public
   workbench, matched SHA-256
   `57692dc03bd5e37f1b02c817bf0601ee3f3d410b6147c24ccd978d22ff4f81ca`,
   extracted it and opened the generated modeling project at its stable URL.
3. The public installed session presented the cube, grid, Outliner, Properties
   and Chat in a non-degenerate 1728x941 editor capture. Repeating `edit` reused
   the same tab id with one editor client. The sole initial zero-size sample was
   acknowledged only after the current invariant, visible capture and live frame
   rate proved the canvas healthy; the final console was silent.
4. Installed Blender MCP exposed 28 tools and one prompt, read the live scene,
   moved Cube to X=3.125, saved the `.blend`, inspected the result and captured a
   valid PNG viewport without rewriting the adapter. A full Blender worker
   stop/start reopened the saved file at X=3.125. Final status reported one
   visible blessed tab, aligned controls, a saved document and zero page,
   console, session errors or warnings.
5. The fresh public repositories are authoritative. The former repositories are
   retained only as private history under explicit `*-private-history` names;
   there is no recurring source-export process or second public history.

## npm access

`@volter` is the confirmed company scope. The active token permits package
read/write but omits the scope from its organization-management grants; `npm org
ls volter` returning 403 was not a test of package publication permission. No
scope or credential change is required on that evidence.
