# Public release status

Volter Editor 0.5.64 / Blender packages 0.1.7 are public on npm. Every
registry digest matches its tested archive, and every tarball downloads without
credentials byte-identical to it. Installation from an initially empty npm cache
and automatic public workbench download succeeded and passed live acceptance;
that install ran in a shell holding npm tokens and a gh login, so the
credential-free proof is the anonymous downloads (provenance/public-npm-release.json).
The new install reports zero npm vulnerabilities. Only the
eight packages in [release/modeling.json](release/modeling.json) are published;
game packages remain excluded.

## Game editor (branch `game-editor`)

Game editing is built on the `game-editor` branch and does not join
[release/modeling.json](release/modeling.json). Source: `volter-ai/vgai-engine`
at `09c2749ce`. Architecture: vgai-engine's `docs/ARCHITECTURE-CORE.md`
§The target shape — kit, integrations, products, shipped twins; dependencies
point down.

| Package | What it is |
| --- | --- |
| `@volter/game-editor` | The second product: `product()` entry composing `@volter/editor-game` and `@volter/editor-blender`, `volter-game-editor` CLI, `create` with the game/prototype/full/website/empty presets, the game template and copied capabilities, its workbench half |
| `@volter/editor-game` | The game side: vgai's `@vgai/game` (`src/`), `@vgai/dom` (`src/react/`), `@vgai/threejs` authoring (`src/three/`), and the kit modules only the game reaches (`src/host/`), including the world-root stage and the Scene document |
| `@volter/game-runtime`, `@volter/threejs-runtime` | The Apache twins a shipped game carries |

The kit gained product-neutral doors only: the launcher (`editor-core/server/launcher`)
takes the launching product; the stage host takes a package's world-root
binding; project roots are served through the globals shadow and mount
isolation; the game runtimes are known runtime packages, reported missing only
when a project declares them; doorway addresses live on `@volter/editor-sdk/host`.

Measured on fresh `volter-game-editor create --template game` projects over a
sources workbench (`scripts/workbench/dev.mjs --product game-editor`): the
first boot opens the Game workspace with the Scene document open by default;
Play reaches `playing`, the Game document draws the starter world, and Stop
returns to the Scene; Inspector edits of the Hero Box's position and colour
are written to `src/scenes/MainScene.tsx` and drawn.

Remaining, each closed by the same live walk:

1. `editor.screenshot()` returns a blank white frame during Play (correct in
   Edit); the active document capture is correct in both.
2. First boot logs one console error, "No default agent registered", from
   the workbench's chat.
3. The CLI lacks verbs the template's guides teach: `screenshot`, `restart`,
   `sessions`, `project`/`projects`, `open`, `blender-mcp` (the MCP server is
   the modeling product's; it belongs with `@volter/editor-blender` for both
   products), `add`, `examples`, `doctor`.
4. 156 of `editor-game`'s 297 modules import kit internals
   (`@volter/editor-core/*`); each becomes an SDK door or moves.
5. `editor-threejs` carries 19 files identical to `@volter/threejs-runtime`'s
   (the twin's `user-data.ts` also has the game keys): one owner is decided
   with the modeling release's dependency boundary.
6. The served-bundle table keys `@editor/game-module-access` (now
   `editor-game`'s) and `@volter/editor-sdk/tools` (no such export) resolve
   nothing; ingest is unwalked.
7. Packed archives, installation without checkout links, and a released game
   workbench are not yet built.

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
   parity. Release 0.5.63 adds the physical-material and homogeneous World-volume
   features described below; remaining shader-graph and volume features are
   implementation work, not established Three.js limitations.
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

## Earlier 0.5.62 verification

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

- npm source for 0.5.64: `839179069050f6965cf51d27adfcd5b60a3898be` in the public
  [editor repository](https://github.com/volter-ai/editor);
  [release v0.5.64](https://github.com/volter-ai/editor/releases/tag/v0.5.64).
  0.5.63's source was `377651068f63e359589735f9b707e00df58b39b4`. The earlier 0.5.59
  and 0.5.60 patches are immutable: 0.5.59 lacks the Outliner barrier, and
  0.5.60 lacks the cold-start corrections; 0.5.61 lacks revision-safe
  Properties reads.
  [Release v0.5.62](https://github.com/volter-ai/editor/releases/tag/v0.5.62)
  records the preceding acceptance. The current [npm receipt](provenance/public-npm-release.json) records the exact
  archive digests, acceptance evidence and remaining limits.
- The workbench is Code-OSS `f8664703ab59` plus editor overlay `2896a2901bb6`,
  release `editor-f8664703ab59-2896a2901bb6-darwin-arm64`, SHA-256
  `98e0a485119020be52bd81e4ada0b37ec1dd100ae2e96e3d6c07ccda5c4f8269`.
  Its complete anonymous download and fresh installer fetch were verified.
  See [workbench provenance](provenance/public-workbench-release.json).
- Blender corresponding source and all 34 dependency-source archives were
  public before binary distribution. See [source review](provenance/blender-source-review.json)
  and the [source/binary release](https://github.com/volter-ai/blender/releases/tag/blender-5.2.0-wasm.3)
  (source `071e080a`; the archive and all six binary files downloaded
  anonymously byte-identical before and after upload).
- All three public repositories began from reviewed root snapshots without
  private history. Former repositories and legacy releases remain private
  under explicit `*-private-history` names. No recurring export is required.

## Remaining work and limits

### Material node graphs (0.5.64)

A Principled BSDF's or Emission's linked Base Color, Metallic, Roughness,
Alpha, Emission and Normal inputs render from the material's node graph. The
session ships the flattened graph (`material_graph` in `session.py`); the
presenter compiles it as EEVEE's codegen does, calling Blender's own node GLSL
(`blender-node-glsl.generated.ts`, 56 files from Blender's processed shaders
by `scripts/generate-node-glsl.mjs`, with a counted patch table for GLSL ES
3.00, every file compiled in the page's WebGL2). Compiled nodes: Texture
Coordinate, UV Map, Geometry (not Parametric), Attribute (Geometry type),
Color Attribute, Value, RGB, Image Texture (Flat/Box/Sphere/Tube,
Linear/Closest/Cubic/Smart, UDIM tiles), Mapping, Math, Vector Math, Vector
Rotate, Mix, MixRGB, Color Ramp, Invert, Separate/Combine XYZ and Color,
Map Range, Clamp, RGB/Vector/Float Curves, Hue/Saturation, Bright/Contrast, Gamma, RGB to BW, Noise,
Voronoi, White Noise, Checker, Wave, Gradient, Magic, Brick, Fresnel, Layer
Weight, Bump (EEVEE's height sub-function at the dF offsets) and Normal Map.
Mix and Add Shader over one Principled BSDF, Emissions and gray Transparent
BSDFs compose as EEVEE weights closures. A deformed mesh whose graph reads
Generated coordinates draws them from Blender's orco of the undeformed mesh.
The exporter gains `graph_materials`/`graph_images`/`graph_generated`, the
one Principled BSDF a graph-drawn mix reaches, UDIM tiles, and revisions keyed
by `session_uid` (Blender fork `071e080a`).

Measured against desktop Blender 5.2 EEVEE on emission planes and spheres,
seven scenes: flat and interior regions within 1-3 of 255 for every node
above, including bump, normal map, geometry, attributes, deformed orco and
UDIM; larger differences only on high-contrast edges, cell borders and
filtered image detail (EEVEE's TAA and anisotropic sampling). Mixes are
identical to their Principled equivalents (Transparent mix vs Alpha, Add
Emission vs Principled Emission: 0 levels). A constant edit updates uniforms
without recompiling; a structural edit compiles its program off the draw
(`compileAsync`), the material showing its previous state until the program
links; WebGL compile and link blocked the main thread 0 ms across three
structural edits. A graph the GPU refuses falls back to the constants with a
named warning.

Limits: a Principled BSDF inside a group on a shader mix's path, two
Principled BSDFs in one mix, a tinted or linked Transparent colour, Box
projection with Clip, Geometry's Parametric output, non-Geometry attribute
types, and Generated coordinates through a topology-changing modifier are each
a named warning.

The Model viewport draws only when something changed. A source that
announces its changes (`ToolObject3DPreviewSource.onChange`, offered by the
Blender view for every frame and every completion after one) skips the
render on frames where nothing changed; the stage store, input on the stage,
the editor's own invalidations (`stage-invalidation.ts`), camera, size,
background, tone mapping, playback, flights, pending photographs, presence
markers and particles all still draw, and sources without `onChange` draw
every frame as before. Measured live: 0 draws in 3 idle seconds (was ~6,750
per 2 s); an edit, a selection, a framing, a capture, pointer movement and a
graph program's asynchronous swap each drew and then returned to 0; the idle
main thread went from 49% busy to 2% at machine load 54-69.

The session's graph pass reads each node tree's links once per present
(`NodeSocket.links` walks the whole tree per read): 15.5 s of a profiled pass
down to 0.74 s in the battery's 28-material workshop scene, identical graphs.

The engine is served with a validator (`ETag`, `no-cache`, 304 while
unchanged), so Chrome keeps the code it compiled from the 86 MB module:
fresh boots measured 12-36 s at load 32-37 before and 1.9-2.2 s at load
48-52 after. A present re-reads which document it waits for, so a command
sent before the Model pane has bound no longer waits out 15 s for
`document:blender:runtime`; three close/open/first-command cycles answered in
2.3-2.8 s.

Also in this candidate, ported from fixes verified in the private-history
checkout on 2026-09-23 but never committed there: no empty header strips
above the Model and Timeline editors or in the side panels; a view's camera
up vector survives a tab switch; a refused second `.blend` cannot expose or
edit the first; closing a hidden document releases its stage state.
Properties no longer blanks and repaints on every edit (measured through one
edit: 0.5.63 went 225/28 elements/inputs to 38/1 and back; the candidate held
225/28).

Packed acceptance (0.5.64): the eight archives from
`8391790` installed into an empty directory with no workspace links and no
engine override; the product resolved its pinned workbench
`editor-f8664703ab59-2896a2901bb6` (seeded in the local workbench cache, since
it is unpublished) and served the engine from the installed package
(`blender_browser.wasm.br` sha256 `63098ef8…`, matching BUNDLE.json) with its
validator, so the first command after opening answered in 2.7 s (boot 2.2 s).
The curve and UDIM/orco comparison scenes rendered with the development
build's numbers; a graph constant's edit undid and redid exactly; a full
close/reopen kept the edited value, the three UDIM tiles and the graph
materials; console silent throughout. The five-model battery on `8391790`
completed 362 of 362 calls with every model's status and error sequence
identical to the accepted wasm.2 run, and 387 of 388 raw snapshots
byte-identical to it (the one other differs in element order only).

### Material-rendering implementation (0.5.63)

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
WASM override. Public npm now carries that verified binary. Fresh packed
acceptance passed before publication; corresponding source was public first.

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

### Packaged sidebar restoration (0.5.63)

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
Outliner, grid and the retained material probe.

### Public 0.5.63 installation and acceptance

All eight immutable archives are public and every registry digest matches.
Fresh-cache creation installed 436 packages with zero audit findings, no links
and no npm or GitHub credentials (including no `gh` login fallback). The product
automatically downloaded the new public workbench and verified its checksum.
Registry installation metadata and GitHub asset listings initially lagged their
direct endpoints; those attempts refused and were retried after propagation,
without replacing any archive.

The public install repeated Python/RNA and structural history, Essentials and
five full cold-reopen checks including Source Control selection. Failed-save
recovery preserved X=12.625; close during a two-second edit waited 2,424 ms and
reopen retained X=14.625. Cold stdio MCP read the saved scene and Essentials.
Missing named UV rendering and undo passed. Final capture was inspected: selected
Cube, grid, Outliner, populated Properties at X=14.625 and Chat. The final console
is silent with no acknowledged diagnostics in that session.

The initial public launch's zero-size canvas sample was acknowledged only after
visible capture and healthy current rendering at 120 fps. The credential-free
test PATH also hid the separately installed Claude runtime; its warning was
recorded, and normal PATH restored before the final acceptance. Neither initial
warning is claimed never to have occurred. The current editor is left open for
the owner; other task probe sessions are closed.

### Renderer-hang diagnostics (included in 0.5.63)

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
  zero high/critical entries. Release 0.5.63 resolves those entries; both its packed
  and anonymous public installations report zero vulnerabilities. This is the
  installed product audit, not a claim about the workbench's build-only toolchain.
- Existing project filenames and protocol/settings identifiers remain unchanged.
  A full rename is a separate migration. Game publication and full viewport
  extraction remain outside this release. Emscripten is shipped; optional WALI
  requires external artifacts and is not a shipped browser-substrate claim.
