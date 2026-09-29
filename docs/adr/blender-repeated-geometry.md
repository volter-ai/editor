# Repeated Blender geometry in the viewport

Stoneguard t_65c85042 c19. The independent 0e6b1bee review completed Bridge
loading, but measured 14,967 draws and 225,338,458 triangles per preview frame,
with median 332.38 ms at 1197×827. The scene contains 11,720 mesh objects over
1,070 shared geometries. Sharing CPU/GPU vertex buffers did not share draws.

The disposable presenter groups repeated opaque geometry with identical ordered
material slots into Three InstancedMesh draws. Groups are spatially partitioned
to at most 64 members so frustum rejection does not become one all-scene bound.
This reuses the exact resident geometry, including all material groups and
attributes. It introduces no LOD, decimation, hidden-object deletion, evaluation
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

Early 137 ms/8,170-call measurements were taken while this work was evolving;
a later run had only seven opaque batches and a changed canvas after a React
error. Those readings are diagnosis, not a settled performance acceptance claim.

The baseline is `stoneguard-diagnostics/review-c7-framecost.json`. A new hosted
measurement and independent appearance/selection/edit review are required for
this implementation; source batching counts alone are not a performance claim.
