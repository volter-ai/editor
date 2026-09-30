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
