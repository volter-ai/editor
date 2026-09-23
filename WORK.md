# Public release status

Volter Editor 0.5.58 is public. Blender packages are 0.1.1; the other six
packages are 0.5.58. The publication boundary remains the eight packages in
[release/modeling.json](release/modeling.json). Game packages are excluded.

## Published artifacts

- [Editor v0.5.58](https://github.com/volter-ai/editor/releases/tag/v0.5.58)
  records npm source commit `0504deca7580bab3d43c552852deeaaa387ef315`.
  [public-npm-release.json](provenance/public-npm-release.json) records all
  archive digests, registry verification, acceptance and its limits.
- The darwin-arm64 workbench is Code-OSS `f8664703ab59` plus clean editor
  overlay `81f87ec200f3`, published as
  `editor-f8664703ab59-81f87ec200f3-darwin-arm64`. SHA-256:
  `2e2139867dda53aaa6fef58005443b9626d2f2975011c342487b1613b8464ef5`.
  Its complete anonymous download matched. Source and extensions compiled with
  zero errors. The asset-cache identity includes the editor overlay through
  upstream's `BUILD_SOURCEVERSION`. See
  [public-workbench-release.json](provenance/public-workbench-release.json).
- Blender corresponding source and all 34 dependency-source archives were
  public before binary distribution. See
  [blender-source-review.json](provenance/blender-source-review.json) and the
  [source release](https://github.com/volter-ai/blender/releases/tag/blender-5.2.0-wasm.1).
- All three public repositories began from reviewed root snapshots without
  private history. Former repositories and legacy releases remain private
  under explicit `*-private-history` names. No recurring export is required.

## Supported-editing work shipped

1. **Native undo/redo:** Code-OSS owns resource ordering and commands; Blender
   owns native snapshots. Redo does not rerun Python. Supported Python/RNA
   edits, Properties values and viewport drags participate. A drag is one
   undo step. Refused read-only edits preserve redo; partially failing Python
   mutations remain undoable. File loading, direct native history moves and
   worker replacement invalidate old entries. History is session-local.
2. **Blender Essentials:** the pinned 17-file CC0 payload mounts at
   `/bw/datafiles/assets`. Smooth by Angle and the Smooth sculpt brush were
   loaded in source acceptance; the installed public release loaded Smooth by
   Angle and restored its modifier through undo/redo. The public LFS bytes and
   packaged manifest hashes were verified.
3. **Rendering:** linked World Background strength and Blender's
   POINT/TEXTURE/VECTOR/NORMAL Mapping semantics are evaluated, including
   inverse mapping with zero scale. This is not complete material-renderer
   parity. World volumes remain outside this pass.
4. **Duplication/deletion:** batch operations are one native edit; copied
   parent/child relationships and selection are preserved. Undo/redo restores
   both objects and relationships. This does not claim Blender's modal
   duplicate-and-move UI or expanded editing of inspection-only panels.

## Verification

Build, all eight package typechecks, 21 tests, release-boundary checks and
packed-import checks covering 1,083 files passed. Generated bundled notices
were reviewed with the release; see [release/NOTICES.md](release/NOTICES.md).

A credential-free, initially cache-empty `create` installed all eight packages
from npm with no workspace links, downloaded the public workbench, verified
its checksum and opened the model in macOS Apple Silicon on Node.js 24.
Every registry archive integrity matched its tested tarball.

The public-installed session verified Python undo/redo (Cube X=0 ↔ 3.75),
RNA undo/redo (3.75 ↔ 5.5), Essentials-backed modifier restoration, duplication,
and deletion/undo/redo. A visible capture showed a centered cube, grid,
Outliner, Properties and Chat. A fresh editor reopened the saved model at
X=5.5 with a silent console. The initial zero-size canvas sample was
acknowledged only after current invariants and the visible capture passed.

## Remaining work and limits

- **Windows/Linux are deferred by the owner.** Do not provision paid runners
  or pursue these builds in the current pass. Platform-specific implementation,
  packaged builds and native acceptance remain incomplete. Only darwin-arm64
  is supported by this release.
- **Intermittent worker lifecycle stall remains unresolved.** Packed and public
  acceptance both encountered a worker stop/restart timeout and an unresponsive
  renderer. Fresh editor reopen recovered saved data, and a separate packed
  worker restart passed, but that does not establish the cause or fix it.
  Do not describe lifecycle acceptance as uniformly clean.
  A focused source trace completed history invalidation, capture abort and
  worker termination after both RNA undo/redo and duplicate/delete undo/redo;
  the following worker starts also passed. This did not reproduce or explain
  the intermittent stall.
- **Explicit worker stop now flushes pending edits in source.** Commands and
  autosaves share one worker queue; frame acknowledgments bypass it so an edit
  waiting for its frame cannot deadlock. Stop and fresh-start wait for the
  document upload before terminating or invalidating history. A failed upload
  refuses the stop and keeps the live model available for retry. Forced teardown
  after losing the editor session remains forced resource teardown.
  Four new regression tests cover ordering, failed-save retry, startup and
  presentation acknowledgment. All 25 tests, eight package typechecks, build,
  release boundary and 1,083-file packed-import checks passed. Live source
  acceptance reopened an immediate RNA edit at X=17.25, then five immediate
  edit/undo/redo/stop/start cycles at X=18.25 through 22.25; deletion/undo/redo
  followed by immediate restart retained six objects (the deleted Cube.001 did
  not return). The console was silent. None of these runs reproduced the
  intermittent renderer stall. This fix is not in published npm 0.5.58.
- **Save-before-ack and guarded close now pass source acceptance.** Each edited
  command writes its complete document before answering, replacing the idle
  debounce. The runtime warns on browser unload while calls or unsaved data
  remain. CLI close asks document owners to drain/save before sending SIGTERM;
  a failed save refuses close, and genuinely headless sessions still close.
  Native browser prompts require user activation and can be overridden; forced
  kills and power loss cannot promise an in-flight edit's final save.
  All 28 tests, eight typechecks, build, release boundary and 1,084-file packed
  import checks passed. Twenty immediate edit/undo/redo/stop/start cycles
  retained X=30.25 through 49.25. Making the probe's model directory read-only
  caused both the edit save and CLI close to refuse while retaining the worker.
  Restoring its original 755 permissions allowed X=61.125 to save and survive
  full close/reopen; the intentional fault was acknowledged after recovery.
  These changes are not yet published. The old npm build also passed 30 worker
  restart attempts and overlapping inspection calls in the comparison run, so
  the intermittent stall still needs an explanation.
- Fresh-install `npm audit` reported six moderate affected dependency entries,
  all through Storybook and `@vitest/mocker`
  ([GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9));
  zero high/critical entries. This release does not resolve that advisory.
- Existing project filenames and protocol/settings identifiers remain unchanged.
  A full rename is a separate migration.
- Game editing/templates/runtime publication and full viewport extraction remain
  outside this release. Emscripten is shipped; optional WALI needs external
  artifacts and is not a shipped browser-substrate claim.
