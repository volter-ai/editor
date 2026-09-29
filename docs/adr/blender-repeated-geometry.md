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
Skinned/morphed meshes, custom shaders, transparent and transmissive surfaces
also retain their individual draws. Rendered lighting/capture retain individual
draws and their existing shadow path. The material graph's world position and
normal varyings include the instance transform; local/Generated/UV coordinates
remain local to the source geometry.

The baseline is `stoneguard-diagnostics/review-c7-framecost.json`. A new hosted
measurement and independent appearance/selection/edit review are required for
this implementation; source batching counts alone are not a performance claim.
