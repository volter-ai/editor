# Public release status

Volter Editor 0.5.62 / Blender packages 0.1.5 are public on npm. Every
registry digest matches its tested archive. Credential-free installation from
an initially empty npm cache succeeded. Only the
eight packages in [release/modeling.json](release/modeling.json) are published;
game packages remain excluded.

## Supported-editing work

1. **Native undo/redo:** Code-OSS owns resource ordering and commands; Blender
   owns native snapshots. Redo does not rerun Python. Supported Python/RNA
   edits, Properties values and viewport drags participate. A drag is one
   undo step. Refused read-only edits preserve redo; partially failing Python
   mutations remain undoable. File loading, direct native history moves and
   worker replacement invalidate old entries. History is session-local.
2. **Blender Essentials:** the pinned 17-file CC0 payload mounts at
   `/bw/datafiles/assets`. Smooth by Angle and the Smooth sculpt brush passed
   source acceptance; packed acceptance restored an Essentials-backed modifier
   through undo/redo and full editor reopen. Public LFS bytes and packaged
   manifest hashes were verified.
3. **Rendering:** linked World Background strength and Blender's
   POINT/TEXTURE/VECTOR/NORMAL Mapping semantics are evaluated, including
   inverse mapping with zero scale. This is not complete material-renderer
   parity. General shader graphs and World volumes are implementation work,
   not established Three.js limitations.
4. **Duplication/deletion:** batch operations are one native edit; copied
   parent/child relationships and selection are preserved. Undo/redo restores
   both objects and relationships. History acknowledgment waits for the
   restored Outliner index, so an immediate delete after redo sees the object.
   Blender's modal duplicate-and-move UI and expanded editing of inspection-only
   panels are not claimed.

**Windows/Linux remain deferred by the owner.** Do not provision runners or
pursue these builds in this pass. Only darwin-arm64 is supported.

## Persistence and startup corrections

- Every edited command uploads its complete document before acknowledging.
  Worker calls and saves share one queue; frame acknowledgments bypass that
  queue so a command waiting for its frame cannot deadlock.
- Explicit worker stop, fresh start and CLI close drain/save before terminating.
  A failed upload refuses close and retains the live worker for retry.
  Browser unload warns while calls or unsaved data remain. Native prompts need
  user activation and can be overridden; forced kills and power loss cannot
  promise an in-flight edit's final save.
- Early package commands wait for contribution discovery. Blender start resolves
  the declared Model table, including custom IDs and a declared default;
  ambiguous Models require a choice rather than a guessed fallback.
- The server gives undiscovered package commands bounded discovery time and
  adopts their declared deadline when registration arrives. Repeated reports
  do not reset elapsed work. This fixes the measured five-second false timeout
  on an otherwise successful 10.925-second Blender startup.
- Properties reads belong to their model revision and selected subject. Late
  success/error responses cannot overwrite a newer selection, and old context
  is cleared while the new subject loads. Four regression tests fail against
  the previous implementation and pass with the correction.

## Verification

All 41 tests, all eight package typechecks, build, release-boundary checks and
packed-import checks covering 1,083 files pass. Generated bundled notices were
reviewed: only Volter package-version labels changed. Blender WASM, Essentials
and the pinned public workbench are unchanged.

The eight 0.5.62 candidate archives installed without workspace links.
Python and RNA undo/redo passed (Cube X=0 ↔ 3.125 ↔ 5.625), followed by an
Essentials-backed modifier undo/redo. Fifteen rapid duplicate/delete/history
cycles checked each structural write for `persisted: true` and checked for
stale Properties errors. Three worker restarts retained X=5.625.
Five full editor close/reopen cycles immediately invoked the default
MCP-shaped Blender start, preserving successive values through X=10.625.
Every cycle had a silent console. The real MCP transport opened a closed
editor and read the saved scene; the Essentials NodesModifier remained.
The workbench initially showed Explorer, so Properties was explicitly focused
before verifying its populated fields and capturing the selected Cube and grid.

In 0.5.61 acceptance, closing during a two-second pending Python edit waited
2.25 seconds; reopening
retained X=6.875. Making the model directory read-only caused both edit save and
CLI close to refuse with EACCES while the worker remained alive. Restoring its
original 755 permissions allowed the pending X=44.625 to save and survive full
close/reopen with a silent console. The intentional fault was acknowledged only
after recovery. An initial zero-size canvas sample was acknowledged against a
visible capture and healthy current canvas invariant at 113.7 fps.

The same save-failure check passed on the exact 0.5.62 archives: both edit and
close refused EACCES, the worker stayed alive, and restoring directory mode
755 allowed the pending X=12.625 to save. Full reopen retained that value with
a silent console. Its initial zero-size canvas warning was acknowledged only
after a visible capture and healthy current rendering at 45.4 fps.

The credential-free public install resolved all eight packages from npm,
matched every archive digest, and contained no workspace links. It repeated
Python/RNA history, Essentials modifier restoration, ten rapid structural
history cycles and two worker restarts. Each structural write persisted;
Properties showed no stale errors. The inspected capture showed the selected
Cube at X=5.625, grid, Outliner, populated Properties and Chat. Its initial
zero-size canvas sample was acknowledged only after the current invariant
passed and visible rendering measured 95.9 fps.
Closing during a two-second pending Python edit waited 2.249 seconds.
Full reopen retained X=9.875 and the Essentials NodesModifier with a silent
console. The task's editor sessions were closed after acceptance.

## Source and artifacts

- npm source: `c488c9fc5e253093b95a014d07bdc0c501dd8408` in the public
  [editor repository](https://github.com/volter-ai/editor). The earlier 0.5.59
  and 0.5.60 patches are immutable: 0.5.59 lacks the Outliner barrier, and
  0.5.60 lacks the cold-start corrections; 0.5.61 lacks revision-safe
  Properties reads.
  [Release v0.5.62](https://github.com/volter-ai/editor/releases/tag/v0.5.62)
  and the [npm receipt](provenance/public-npm-release.json) record the exact
  archive digests, acceptance evidence and remaining limits.
- The workbench is Code-OSS `f8664703ab59` plus editor overlay `81f87ec200f3`,
  release `editor-f8664703ab59-81f87ec200f3-darwin-arm64`, SHA-256
  `2e2139867dda53aaa6fef58005443b9626d2f2975011c342487b1613b8464ef5`.
  Its complete anonymous download was verified for 0.5.58; later patches reuse
  this unchanged cache. See [workbench provenance](provenance/public-workbench-release.json).
- Blender corresponding source and all 34 dependency-source archives were
  public before binary distribution. See [source review](provenance/blender-source-review.json)
  and the [source release](https://github.com/volter-ai/blender/releases/tag/blender-5.2.0-wasm.1).
- All three public repositories began from reviewed root snapshots without
  private history. Former repositories and legacy releases remain private
  under explicit `*-private-history` names. No recurring export is required.

## Remaining work and limits

### Material-rendering implementation (unreleased candidate)

The candidate implements Principled coat weight/roughness/IOR/tint, sheen
weight/roughness/tint, anisotropy/rotation, specular level/tint and thin-film
thickness/IOR. Shader adjustments carry coat absorption and IOR and preserve
Blender's specular grazing behavior. Tangent/object-space image Normal Maps
carry strength and OpenGL/DirectX conventions. Image Texture Clip extension
is implemented; material inputs have independent sampler state even when
they share one image, and connecting Image Color no longer connects its Alpha.
Named UV selection supports all eight Blender layers, including render
snapshots and shared materials on meshes with different layer order. Evaluated
corner normals come from Blender, not from normals recomputed after UV splits.

Nine regression tests cover physical values, live uniform updates, restoration,
sampler ownership/repaint/decode/disposal, Clip/alpha, named UV seams/channel
selection and revision-owned snapshot buffers. Source-linked live GPU captures
verified physical inputs on/off, tangent and object-space DirectX normals,
Repeat versus Clip and first versus eighth named UV. Each edit/history probe
restored its original state and ended with a silent console. The first UV
capture exposed a missing snapshot copy; that path was corrected and both
the regression and live rerun passed. These are feature checks, not complete
BSDF or shader-graph parity.

The corresponding Blender exporter is public at
`68bba09924c2cf08cbceb6608be4a9e1500a62bb` (PR #1). Verification used a rebuilt
WASM override. The candidate now carries that verified binary; public npm is
still unchanged. Fresh packed acceptance has passed; publication remains required.

The candidate also implements homogeneous World Absorption, Scatter, Principled
Volume and Emission closures, including Add/Mix weights and constant linked
input expressions. A depth-aware scene-linear pass integrates absorption and
emission analytically and local-light single scattering numerically. It uses
point/spot shadow maps, rectangle-light quadrature, HG/Draine/Rayleigh phase
functions and Blender's blackbody coefficients. Surface lighting receives
matching medium attenuation; the rectangle surface-light path uses center
distance with its existing LTC approximation. Both capture hosts use the pass
before display transforms, with revision-owned disposal.

This is not Cycles volume parity: heterogeneous fields, multiple scattering,
Mie/Fournier-Forand phases and multilayer transparent depth remain implementation
work. Unsupported spatial inputs and phases refuse by name; unbounded emission
without extinction refuses its divergent radiance instead of inventing a far
boundary. Linked physical sockets, general material graphs and additional
normal/bump paths also remain unfinished implementation, not fundamental
Three.js limitations. No claim that these cannot be implemented is made.

Eight new volume tests cover export, Mix/cycle handling, coefficients, analytic
transport, phase normalization, blackbody, named refusals, surface uniforms and
pass ownership. The live orthographic absorption probe measured exactly 163/255
against the Beer–Lambert/Standard prediction (clear: 255/255), and history
restored the density. Perspective spotlight/point-light and occlusion captures
ran with a silent console. The full engine battery is recorded below. These
feature probes have also passed against the final installed archives, without
a WASM override or workspace links.

The first new-binary battery attempt completed the courtyard's 95 calls with
the accepted baseline's four error positions, but its final verification was
blocked by stale harness imports and an incomplete disposable-project dependency
setup. It also exposed a real missing-named-UV regression: such a lookup now
uses Blender's zero-coordinate behavior instead of throwing or substituting the
active UV map. The complete battery reran with that correction at editor
`c7f0def0d717dfeef7b56f436156834a4b2250b4`: all 362 calls completed, no harness
failures, and all photographed camera poses matched. Courtyard and workshop
matched final geometry and presentation. Bridge, tram and courier retain exact
comparison differences; they are not reported as native-parity passes.
All 70 bridge snapshots are byte-identical to the previous accepted binary.
Courier's five snapshots match that binary after index remapping except two
normal components differing by 0.000001. The bridge/tram presentation reports
still name the same geometry-less curve helpers. Courier now has only its four
native script errors, rather than the old host's 27 error positions.
See [binary verification](provenance/blender-material-verification.json) for
source/harness hashes, timings, errors, runtime checks and comparison evidence.
The public source archive at `blender-5.2.0-wasm.2` was anonymously verified;
the 34 unchanged dependency payloads remain at `blender-5.2.0-wasm.1`.

### Packaged sidebar restoration (unreleased)

The reported outdated-looking UI exposed a reproducible packaged-only issue:
manually opening Properties and Outliner did not survive a full cold reopen.
Code-OSS 1.138's built-launch layout policy substitutes its default Explorer for
a saved non-default sidebar (development and Reload Window do not). The kit now
captures the native saved container before restoration overwrites it and opens
that container through the native view service after restoration. It adds no
layout store, product-specific ID or forced view visibility. The rebuilt macOS
workbench passed five cold-reopen checks, including preservation of a deliberate
Source Control selection. Its complete anonymous download matches the pinned
SHA-256. Source comparison found the
recent Blender header/menu/icon/style fixes already present; the user's other
missing visual changes have not yet been identified.

The same candidate upgrades Storybook to 10.6.0, verifies its real portable
story and ordering APIs and requires Node 24. Its repository and initial packed
install audits reported zero vulnerabilities, resolving the advisory in the
published release below. That packed probe predates the material changes and
does not establish acceptance of the new renderer. The final packed install also
reports zero vulnerabilities.

### Final 0.5.63 packed acceptance

All 72 tests, eight package typechecks, the build, release-boundary check and
1,086-file packed-import check pass. The exact eight archives install without
workspace links or a WASM override. Python/RNA undo/redo, Essentials restoration,
five persisted duplicate/delete/history cycles and five full cold reopens pass.
The final run has no unresolved or acknowledged diagnostics. Earlier attempts
exposed readiness assumptions in the harness (panels mounted before their fields
loaded); bounded UI readiness checks corrected the harness, not the product.

Making the disposable model directory read-only made both edit and close refuse
EACCES while retaining the live worker. Restoring mode 755 allowed the pending
X=12.625 to save and survive reopening. Closing during a two-second Python edit
waited 2,396 ms; reopening retained X=14.625. Real stdio MCP then opened the closed
editor and read that model and its Essentials modifier, with a silent console.

Packed GPU checks passed physical inputs, tangent/object-space DirectX normals,
first/eighth/missing named UVs, Repeat/Clip and edit history. Homogeneous volume
absorption measured 163/255 versus clear 255/255 at the center. A blocker reduced
spotlight scattering; point-light scattering disappeared when energy was zero,
apart from an observed maximum one-code-value residual (not exact black parity).
All probes restored their temporary edits and ended with a silent console.
An inspected settled capture shows populated Cube Properties at X=14.625,
Outliner, grid and the retained material probe. Publication and registry-only
installation acceptance remain to be completed.

### Renderer-hang diagnostics after 0.5.62 (source only)

The original public acceptance log shows no receipt for `blender-stop`;
the page was already failing to pick up commands. That does not establish
worker shutdown as the cause.

Contributions can now announce bounded, operation-only work through the host.
Blender reports worker requests, Model-frame application and runtime release
before entering them. Overlapping calls have distinct lifetimes. The existing
heartbeat carries these labels even while the page is blocked; `status.pageWork`
is server-held rather than a stale page snapshot. Sequence stamps prevent
the heartbeat's delayed copy from resurrecting completed work. Neither request
payloads nor Python code are included, and diagnostics cannot fail teardown.
Labels are observations, not stack traces or claims about the cause.

Seven new tests cover nesting, duplicate labels, reporter failures, request
cleanup, transport ordering and heartbeat delivery without a page callback.
A disposable live probe blocked Model-frame application for four seconds:
the server named that operation throughout the block while heartbeat ages
stayed below one second. It recovered, undo restored Cube X=84.125, and the
console was silent. Fifteen instrumented edit/history/restart cycles passed;
a separate sequential run passed fourteen with Properties explicitly open,
six objects retained and silent consoles. Its fifteenth was interrupted by a
page close beacon and disconnected channels, not a beating unresponsive tab.
Reopening recovered the saved model; the isolated four-second diagnostic
probe then passed again on the final build, restoring X=84.125 and clearing
the work label. Other interrupted attempts (a build replacing live worker
assets, and accidentally overlapping probe drivers) are not counted as passes.
All 48 tests, eight package typechecks, the build, release boundary check and
1,083-file packed-import check passed. These are diagnostic and recovery
proofs, not a reproduction or fix of the older intermittent hang.

### Unresolved observations and release limits

- **The intermittent unresponsive-renderer observation remains unresolved.**
  Packed and public 0.5.58 acceptance encountered a worker stop/restart timeout
  while the renderer stopped answering. Full editor reopen recovered saved
  data. Native sampling did not establish a source-level cause. A 12-cycle JS
  profile found no hang (longest recorded frame 689 ms in viewport rendering);
  profiling itself increased startup latency. Numerous later comparisons,
  including 20 selected-object cycles on the old build, did not reproduce it.
  The last old-build comparison encountered disk exhaustion instead; moving
  this task's retained npm cache to the internal disk restored capacity and a
  subsequent model save succeeded. None of this proves the old renderer stall
  fixed. The separately reproduced cold-start deadline race is diagnosed and
  corrected, not substituted as an explanation for that observation.
- Fresh anonymous 0.5.62 installation reported four moderate dependency entries
  through Storybook and `@vitest/mocker`
  ([GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9));
  zero high/critical entries. This release does not resolve that advisory.
- Existing project filenames and protocol/settings identifiers remain unchanged.
  A full rename is a separate migration. Game publication and full viewport
  extraction remain outside this release. Emscripten is shipped; optional WALI
  requires external artifacts and is not a shipped browser-substrate claim.
