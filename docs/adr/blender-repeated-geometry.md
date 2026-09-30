# Repeated Blender geometry in the viewport

Stoneguard t_65c85042 c19. The independent 0e6b1bee review completed Bridge
loading, but measured 14,967 draws and 225,338,458 triangles per preview frame,
with median 332.38 ms at 1197×827. The scene contains 11,720 mesh objects over
1,070 shared geometries. Sharing CPU/GPU vertex buffers did not share draws.

The disposable presenter groups repeated opaque geometry with identical ordered
material slots into Three InstancedMesh draws. Groups are spatially partitioned
to at most 64 members so frustum rejection does not become one all-scene bound.
This reuses the exact resident geometry, including all material groups and
attributes. This batching step introduces no LOD, decimation, hidden-object deletion, evaluation
cache or change to Blender, streaming, deltas, persistence or scene math.

Canonical Mesh objects retain their identities, geometry, material slots,
hierarchy and transforms. Their ordinary drawing layers are suppressed while a
batch draws them; batch raycasts return those original Mesh objects. Selection
mask passes may still enable their own temporary layer. Internal batches are
excluded from the editor hierarchy. After world matrices update, before Three
uploads attributes, the presenter synchronizes instance transforms, ancestor
visibility and bounds. Unchanged matrices require no GPU upload. A changed
frame rebuilds grouping; disposal releases only the instance buffers.

Three's instanced normal path does not support shear or mirrored scale, so those
placements retain individual draws, including when a live drag introduces them.
Skinned/morphed meshes, custom shaders and transmissive surfaces
retain their individual draws. Rendered lighting/capture retain individual
draws and their existing shadow path. The material graph's world position and
normal varyings include the instance transform; local/Generated/UV coordinates
remain local to the source geometry.

The vertex-attribute budget counts each material's actual shader inputs,
including a pending graph program, plus the four instance matrix slots. All
other authored channels stay resident. Counting every stored layer instead of
active inputs unnecessarily excluded repeated geometry in the first candidate.

## Alpha-textured vegetation

Live eligibility counters then identified the dominant exclusion: 10,384 meshes
have non-opaque materials. A read of the scene in native Blender identifies
5,935 grass_medium_02, 2,200 grass_medium_01 and thousands more plant instances
with linked Alpha inputs. Opaque-only batching cannot solve that submission cost.

The Three source contract now has a camera-dependent `prepareDraw` hook, called
by the stage immediately before drawing (including its uncapped frame-cost door).
Blender uses it to frustum-cull and sort transparent surfaces using Three's own
homogeneous clip-z, render-order and object-id ordering. It instances only
consecutive compatible single-material, single-pass surfaces. Other surfaces
remain ordering barriers. Equal-depth ties at a batch boundary remain ordinary
draws, so the new internal object's id cannot change their order. Each batch's
sorting anchor is its first member's original centre; its matrices retain the
order of the original draws. A camera move recomputes the runs, reusing pooled
instance buffers. The stage always invokes the returned cleanup, including on
draw failure: original transparent meshes regain their normal drawing layers
and the internal runs stand down. Picking and a separate snapshot/preview thus
see all original surfaces, not the last camera's culled instance list.
Multi-material transparency, two-pass double-sided blending,
skinning and unsupported transforms retain individual draws.

This keeps the authored Alpha and blending, rather than replacing foliage with
an alpha-test cutoff. Picking returns the original objects; edited transforms
are used on the next draw. Helpers/batches do not become authored scene entries.
The diagnostic `blender-status` reports both opaque and transparent batch counts.
`blender-draw-batching {enabled:false|true}` selects the ordinary/instanced
presentation for a same-tab, same-camera frame-cost comparison. It never invokes
the native engine or persists anything. Held scene counts exclude internal
presentation draws; renderer draw counters continue to report actual work.

Early 137 ms/8,170-call measurements were taken while this work was evolving;
a later run had only seven opaque batches and a changed canvas after a React
error. Those readings are diagnosis, not a settled performance acceptance claim.

The baseline is `stoneguard-diagnostics/review-c7-framecost.json`. A new hosted
measurement and independent appearance/selection/edit review are required for
this implementation; source batching counts alone are not a performance claim.

The same-tab 5cbbee9a diagnostic did not improve frame time: at 1197×287,
ordinary drawing measured 150.75 ms (three-frame median), while settled batching
measured 161.43 ms (five-frame median). Draws fell from 14,811 to 13,229 but
aggregate opaque bounds admitted another 8.18 million triangles. These are
diagnostic numbers, not a comparison to the reviewer's taller canvas.

Opaque batches now compact only the members that pass the same per-object
frustum test as an ordinary draw. Transparent plans reuse their buffers and
ordering on unchanged frames, after exact comparisons of camera, transforms,
visibility, geometry ranges/bounds, material identity/version and draw flags.
A changed input rebuilds the plan; no lossy hash or evaluated-data cache is
involved. Nested group order also remains an ordering barrier. These changes
require a new measurement before any performance claim.

## Navigation geometry

After repairing the native Timeline layout (c20), the restored 1197×827 Bridge
still measured 220.34 ms median over five full-detail frames, 13,382 draws and
225,338,458 triangles (`c20-restored-frame-cost.json`). Submission, including
driver backpressure, took 103.79 ms median; the remaining GPU wait was 90.03 ms.
Native metadata confirms the dominant grasses are saved as BLENDED, so changing
them to cutouts or hashed transparency is not an equivalent optimization.

C19 explicitly calls for temporary simplified geometry during navigation.
The presenter now derives compact geometry copies with meshoptimizer 1.2 in a
worker, one mesh at a time, prioritizing repeated high-cost geometry. It retains
material/chunk boundaries and UV/shader-attribute seams, includes normals and
shader attributes in the error calculation, and retains
every attribute in the compact copy. The cache is capped at 64 MiB; each worker input
has at most 49,152 indices (16,384 triangles). Material ranges are simplified
separately, with locked chunk boundaries and their original ordering retained.
Attribute copying and final compaction yield in 8,192-element slices. Unsupported/deformed surfaces,
unsuccessful reductions and a failed worker use their complete originals.
There is no main-thread simplification fallback or persistent derived cache.

Only an interactive moving camera permits these copies, with a conservative
projected-error check per visible placement of each shared shape.
Culling bounds, transparent sorting anchors, materials and instance ordering
remain the originals'. The renderer's synchronous draw selects geometry before
planning transparent instance runs and restores it in `finally`. A quiet
camera schedules a full-detail redraw after 150 ms. Edit/sculpt/pose and inspection
draw modes, captures, rendered shading,
editing/picking outside the draw, native evaluation and saved data retain full
geometry. Copies own their buffers and are disposed on geometry replacement.

The existing frame-cost door defaults to `quality:"full"`. An explicit
`quality:"navigation"` measures small camera turns through this same navigation
path and reports that label; it restores the original camera even on failure.
Neither reading is substituted for the other. `blender-status` reports copy
count/bytes, pending work, refusals and the last navigation plan's full/reduced
triangle counts (the renderer's actual counters remain in frame cost). A new runtime diagnosis and independent navigation/appearance review
are required; implementation alone is not a speed or appearance claim.

The first 4c48ac57 navigation diagnosis was negative: 149.55 ms versus 133.86 ms
full detail, with 221.89M versus 225.34M drawn triangles. Eight copies occupied
2.9 MB and completed without a worker refusal. Its whole-shape projected-error
gate let one near placement reject every distant copy of the same plant. The
selection is now per placement, before transparent run planning. Opaque members
whose geometry changes use the existing ordinary-draw fallback; full-detail
members remain instanced. This correction needs its own measurement.


The per-placement 5aa1b6d6 diagnosis remained insufficient: 144.45 ms navigation
versus 156.36 ms full detail. The retained native census found that 100 copies
of a 1.78M-vertex sapling account for 206.25M triangles; the old vertex cutoff
excluded the dominant cost. Large geometry now uses bounded per-material
chunks instead. No partial mesh is published: all ranges must finish and the
whole compact copy must fit the same 64 MiB budget. Replacement/disposal
cancels pending worker replies and yielding copies. Absolute errors share the
whole mesh's scale, and the maximum chunk error gates each placement.
This change still needs runtime measurement; it is not a fast-navigation claim.


The 697a8a87 runtime completed loading (43,317 calls, max 3,658 ms, none over
five seconds, 3,168 MiB Wasm). Its bounded sapling reduction completed but still
had 1,378,439 of 2,062,487 triangles and exceeded the compact cache budget, so
it correctly retained the original. No additional frame benchmark was run for
that known unchanged dominant geometry. Native source arrays contain many
split vertices; the next reducer uses meshoptimizer 1.2's
[attribute-aware permissive mode](https://github.com/zeux/meshoptimizer/blob/v1.2/README.md#permissive-simplification),
protecting UV and all other shader-attribute discontinuities while allowing
normal splits to collapse within the same appearance-error limit. Material
and chunk boundaries remain locked. Copies retain the selected original
attribute values; authored geometry is untouched. Reduction diagnostics now
include the required compact byte count. Performance remains unproven.

The earlier blanket `LockBorder` also pinned genuine open leaf silhouettes.
The partitioner now marks vertices shared across chunks/material ranges in
bounded yielding passes, joining Blender UV/normal splits through its source
point map. Only these artificial boundaries are position-locked; genuine open
edges can collapse within the same measured error. This avoids requiring every
leaf border vertex to survive a navigation-only drawing. The original bounds,
material ranges and rest/capture geometry are still retained.


87f77472 accepted the sapling copy (263,503 of 2,062,487 triangles, 17.9 MB;
all copies 20.4 MB). The same-tab 1197×827 five-frame diagnosis measured full
152.64 ms versus navigation 94.77 ms, with 225.34M versus 86.17M drawn triangles.
This is a real improvement, but about 10.5 fps remains insufficient. The
placement transform bound now uses the maximum absolute row sum of AᵀA:
its square root bounds the largest singular value and equals maximum scale
for orthogonal columns, avoiding Frobenius's unnecessary sqrt(3) inflation
for a uniform transform. Preparation phase timings and transparent batching
exclusions are exposed alongside the existing draw diagnostics to attribute
the remaining cost. A new frame reading is still required.

14e6b3d1 measured 137.98 ms full detail and 92.09 ms navigation at 1197×827.
The live material census ruled out two-pass foliage: meadow and forest grass
are single-pass FrontSide surfaces. Many different geometries share those
materials, so geometry-specific instancing leaves most draws separate. A short,
restored draw hook also identified the existing outline depth and transmission
passes; their work is not removed or mistaken for duplicate authored objects.

The presenter now uses Three's BatchedMesh when WEBGL_multi_draw is available.
It merges only consecutive compatible single-material entries in the existing
transparent sort, retaining tie barriers, culling, placement matrices and all
vertex attributes. Named UV maps and attribute layouts must match. The graph
shader includes the batching transform for world-space inputs. Canonical meshes
still handle picking, selection, authored state and fallback drawing.

Packed immutable attributes are shared by independent ordered runs through
public Three APIs. The cache permits 32 MiB total, 4 MiB per family and 1,024
runs of 64 members. Creating at most four runs per frame bounds copy()'s
transient array allocations; ordinary draws fill the remaining runs until they
are available. Attribute identity/version changes rebuild the affected family.
Retiring a run detaches shared attributes before disposal; the template owns
their final release. Unsupported geometry, memory limits or missing multi-draw
support retain ordinary drawing or the prior geometry-specific instancing.
This candidate still needs a settled runtime measurement; it is not a claim
that C19 is complete.

76b1d161 reduced full-detail calls to 10,450 with the same 225,338,458 triangles,
but navigation was 94.46 ms versus the previous 92.09 ms: no speed win is
claimed. Five-frame diagnostic hooks, restored afterward, attributed only
41.56 ms across 28 root matrix updates and 17.19 ms across 42,051 material
bindings. Another census found 608 terrain ranges referring to just two opaque
materials, plus 66/64 character ranges referring to four/two materials.

Opaque material ranges are now consolidated in the order Three already draws
them: material sorting remains the renderer's responsibility, and each material's
triangle order is retained. Only a disposable index copy is allocated (8 MiB
cache); canonical vertex attributes are shared and remain owned by the source.
Ranges must cover the full indexed geometry without overlap, and transparent,
transmissive, custom shader, skinned and morph geometry retain their originals.
Already-instanced meshes are left alone. The canonical geometry is restored in
the draw's finally block, so picking and saved material slots are unchanged.
This is a general rule on range structure, not an asset-name special case.
It still requires measurement. C19 also requires a second real large scene's
performance reading before review; only the Bridge has been measured so far.

The second real scene, Vespucci, measured 17.38 ms full detail / 17.90 ms
navigation in material preview (five frames, 1197×827, 5,395 canonical meshes,
927,448 canonical triangles). With batching disabled it measured 38.10 ms:
34,750 versus 1,112 calls, with exactly 422,861 drawn triangles in both full
detail readings. Its simplification gate stayed off; range consolidation
removed 33,625 ranges using 2.16 MB of indices. This supports the general
batching path, not a claim that navigation LOD has been calibrated on multiple
large scenes. Startup also logged React error 177; that remains an unresolved
condition, not a clean-review result.

The nearest-depth estimate for navigation now intersects the original sphere
and box bounds. Camera-space box support along Z is the absolute Z row of
view×world multiplied by local half extents. Both nearest depths are lower
bounds on every original vertex's depth, so their maximum remains a lower
bound. This avoids projecting a tall shape's vertical radius toward a level
camera without changing the one-pixel gate or the simplifier's error budget.
Transparent plan comparison also skips opaque geometry after checking each
mesh's current materials, preserving detection of transparency transitions
without scanning unrelated attribute versions.

## Material palette experiment removed

The compatible two-material palette reduced navigation calls from 8,211 to
6,383, but added GPU work. After warming each alternative in nine separate
40-frame commands at 1197×827 and ratio 1, ordinary materials measured 82.76 ms
median (67.22 ms submission, 16.38 ms completion wait); the palette measured
87.19 ms (55.90 ms submission, 28.00 ms completion wait). Both alternatives
retained the original scene and transparency ordering. The shader's two graph
evaluations outweighed its submission savings, even with one compiled material
per renderer, packed selectors and explicit physical texture gradients.

The palette implementation and its renderer plumbing have been removed.
Ordered batches again use each source's original material and shader. Native
loading, canonical geometry, fine navigation geometry and the fixed-resolution
measurement door remain. These measurements explain the removal; they do not
meet the 33 ms navigation target or replace independent review.

A separate, temporary ordinary-material geometry-sharing probe also produced
no total improvement: 78.23 versus 77.83 ms with identical 8,211 calls and
66,433,585 drawn triangles after the same warming. That probe was restored and
is not included in the source.

A hosted reattachment changed the stage from 1197×827 at ratio 1 to 2394×1654
at ratio 2. Those timings cannot establish a change against the earlier baseline.
The frame-cost door accepts an explicit `pixelRatio` in 0.25..2 for a fixed
measurement resolution across displays. It resizes every document-compositor
pass, reports the actual measured dimensions and ratio, and restores the original
ratio in `finally`. The default still measures the viewport as it is drawn.

## Skinned-range exclusion probe retired

A candidate allowed index-only range consolidation on skinned meshes. The loaded
Bridge census showed no eligible skinned mesh: its three multi-range meshes
were already ordinary evaluated meshes. The candidate was therefore removed
without a frame-speed claim. The remaining many small opaque draws are distinct
single-material objects: 436 steel-scale geometries and 257 rock-face
geometries, rather than unmerged ranges within one mesh.

### Reopened-stage measurement ratio

The initial stage rig forwards `frameCost`'s requested pixel ratio as well as its frame count and quality. After closing and reopening a document, this binding previously dropped the ratio, so a requested ratio of 1 measured the display's ratio of 2 instead. This is a measurement correction; default viewport resolution stays unchanged. The opaque distinct-shape experiment was retired: it overlapped the repeated-shape instancer's navigation fallbacks, and its small apparent gain had unequal triangle counts.

### Actual native viewport reference (2026-09-30)

The official Blender 5.2.0 LTS build fbe6228777e7, Metal, measured a median 184.04 ms for one actual viewport redraw of Bridge frame 1 at 1197×827 physical pixels and the browser camera. The maximum view/projection matrix errors were 1.746e-7/2.384e-7. A POST_PIXEL callback read one pixel from the active framebuffer to wait for this viewport, giving median 47.60 ms before the callback and 129.46 ms for completion. Seven frames were retained after five warm frames. Native preview samples remained at their default 16. This is native EEVEE with full geometry and forest HDR; browser navigation uses temporary LOD and different shaders. It is a reference, not a hard floor for Three or proof that 33 ms is impossible. GPUOffScreen.draw_view3d runs the image-render path and is not a substitute for this measurement.

The bounded standalone probe is tools/stoneguard/native-viewport-profile.py; supply the diagnostics directory after --. It reads ceiling-camera.json, starts in a fresh Blender window with the scene file already loaded, adjusts only its own layout, asserts dimensions and matrices, records timings, removes its draw callback, and quits its own app through Blender's door. Compact evidence is native-viewport-reference.json. No scene bytes are saved.

### CPU ceiling profile (2026-09-30)

The unsampled 40-frame navigation baseline is 73.30 ms, 54.84 ms CPU, 1197×827 at ratio 1, 8,214 calls and 66,434,419 triangles. A 10 ms JS Self-Profiling run retained 2,783 samples over eight 40-frame batches with identical draw eligibility. Restricting stacks to the frame-cost loop and normalizing CPU sample shares to the unsampled CPU median gives estimates: draw submission/object draw preparation 21.6 ms, uniform/material/texture state 13.5 ms, traversal/queues 7.0 ms, matrices/instance sync 6.8 ms, explicit frustum culling 2.5 ms, presentation planning 1.1 ms, and stage/other JS 2.3 ms. These are sampling estimates, not independent clocks. The profiled batch CPU median is 59.01 ms; sampling overhead and host variation remain. GC is not independently exposed and is never asserted zero. No synchronous WASM stack appeared in this main-thread viewport profile.

The final unsampled seven-frame check, matching the earlier small orbit, measured 73.86 ms / CPU 49.27 ms / completion wait 26.79 ms, with 8,211 calls and 65,881,683 triangles. The per-five-second host series accompanies the compact evidence; no further swapouts occurred after its first sample. Compressions and other host load remain relevant even without swapouts. All owned document panes, Blender workers, attachment and three diagnostic tabs were closed after the reading.

33 ms is neither demonstrated reachable nor a demonstrated WebGL floor. Bare GL draw timing in the earlier intrusive probe was approximately 2 ms; repeated state and object preparation cost much more. Eliminating just matrix and traversal work still leaves about 35 ms CPU before the remaining GPU wait. The next candidate must address repeated pass work and draw preparation together, preserve geometry and transparent ordering, and establish a measured improvement before any gain is claimed. Native EEVEE's 184 ms reference is different shader/full-detail work, not a lower bound for Three. Probe and compact results: tools/stoneguard/profile-viewport-sampling.js and viewport-cpu-reference.json. The host dev page enables sampling only with VOLTER_EDITOR_JS_PROFILING=1.

### Bounded outline depth culling candidate

OutlineEffect samples scene depth at selected surface fragments. The new adapter bounds those fragments conservatively from the selected meshes' current spheres, using Gershgorin's scale bound on the camera-space transform's Gram matrix, covering camera scale, shear and reflection as well as uniform transforms. It restricts the depth pass's CPU frustum to that rectangle. The renderer's first renderBufferDirect call restores the exact original projection and inverse before program/uniform setup; shader raster positions and depths use the original matrices. The color, selection mask and edge passes retain their original inputs. An offscreen selection skips only depth; stock mask clearing prevents stale outline pixels.

Custom scene/object/depth-material callbacks, objects refusing override materials, unsupported cameras, XR/reversed depth, selected non-meshes or unbounded meshes, near-plane crossings and unknown selection-layer users take the original full pass. State restoration is in finally. No evaluated geometry, native math, material opacity or saved data changes. This is a candidate: types/build checks do not establish pixel equality or a performance gain. A bounded cause measurement must separate color and depth submissions before claiming a win; independent review owns visual validation.
