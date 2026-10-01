# Bound saved-document readback

Status: Accepted
Date: 2026-10-01
Card: t_65c85042, c3 t_0152c963

The final-head recording at 13b7ef1d lost its renderer after loading the
Bridge. A footprint diagnostic subsequently completed Wooden cart Properties,
but its renderer peaked at 13.6 GiB and Blender's reported linear memory grew
from 3,112 to 3,869 MiB after selection and persistence. These readings do not
attribute every allocation to one subsystem. They leave F2 open.

One whole-document allocation is established at source: saveDocument reads
the saved file with WasmFS readFile before hashing and uploading its chunks.
That bridge allocates a whole-file temporary in the nonshrinking Wasm heap,
then copies the file to a whole-file JavaScript array. The Bridge's saved
file is hundreds of MiB. Bounded network chunks alone do not bound readback.

The standalone filesystem now exposes bounded range reads. Hashing scans
one MiB at a time, retaining a maximum four-MiB content-defined chunk; missing
chunks are reread individually for upload. The gear table, minimum/maximum
chunk lengths, exact cut positions, SHA-256 manifest and atomic server commit
remain the same. WasmFS read temporaries are at most one MiB. No authored file,
geometry, image, undo state or selection is discarded. The command lane owns
the file throughout its scan and upload; short reads or server hash refusals
fail the save and preserve the dirty state. Legacy filesystem seams without
range reads retain their previous behavior.

This removes a known component of the save peak. It is not a claim that all
renderer growth is diagnosed, that initial presentation is fixed, or that the
final recorded run passes. Evidence is in stoneguard-diagnostics/
f2-footprint-{live,ready,selected,final}-vmmap.txt and the corresponding status
and Properties reads. No performance optimization or new frame-time claim.

Initial presentation has a separate unbounded concurrency path:
loadEncodedTexture starts every PNG/JPEG decode in the manifest immediately.
The existing Bridge image census records 84 images, 171 MiB compressed and
1,343 MiB as RGBA. Finished ImageBitmaps must remain available for texture
uploads and context restoration, but all decoder and vertical-flip temporary
workspaces need not coexist. File-image decoding now runs one image at a time.
Blob creation is inside that queue, and a disposed texture skips queued work
or closes an already-running decode's result. A failed image still rejects
its own readiness promise without poisoning later jobs. The exact browser
decoder options, image sizes, texture sources, material samplers, colors and
texturesReady completion barrier remain unchanged; no image is downsized or
discarded. This bounds concurrency rather than claiming a measured reduction
in total renderer footprint. The final recording must establish that result.
