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
1,343 MiB as RGBA. The initial serial-decode correction retained finished ImageBitmaps for texture
uploads and context restoration, but all decoder and vertical-flip temporary
workspaces need not coexist. File-image decoding now runs one image at a time.
Blob creation is inside that queue, and a disposed texture skips queued work
or closes an already-running decode's result. A failed image still rejects
its own readiness promise without poisoning later jobs. The exact browser
decoder options, image sizes, texture sources, material samplers, colors and
texturesReady completion barrier remain unchanged; no image is downsized or
discarded. This bounds concurrency rather than claiming a measured reduction
in total renderer footprint. The final recording must establish that result.

## Decoded pixels belong to an upload, not the presented model

The b97812ca recording still lost its renderer before the selected Properties
proof. Serial decoding alone leaves every completed ImageBitmap resident.
The Bridge image census is 1,343 MiB of decoded pixels, retained alongside the
171 MiB encoded files and WebGL textures. This is a concrete retained allocation;
it does not establish the full process-footprint attribution.

The stage now supplies its native renderer to the existing prepareDraw seam.
The file-image owner uploads through Three's public initTexture door for
every current material-input sampler sharing that Source (and the canonical
texture only when image extras use it), and closes the bitmap
after all uploads. It retains dimensions, the original compressed bytes and
Source.dataReady=false; no closed pixel source is passed back to GL.
A hidden document learns image dimensions and closes the initial bitmap rather
than keeping CPU rasters for a context it does not have.

A new renderer, context-restoration generation, or changed sampler parameters
queues a fresh decode using the original flip/alpha/colour options, uploads the
full pixels and closes them again. Renderer admission is weakly held; queued
work reads the current sampler list and does not upload into a detached canvas.
Raster/UDIM paths and detached capture snapshots retain their existing lifetimes.
No image is resized, recompressed, removed or colour-converted by this change.
The required final recording must still prove the total footprint and Properties;
no measured frame-speed gain is attributed to this lifetime correction.

## The document owns its compression format

The protected 9c766fa6 recording plateaued at 6.8–7.1 GB before selection,
then grew by 675 MB in 17 seconds. The renderer exited without a watcher
signal; its exit cause is not established. Selection persistence is therefore
still an open proof, rather than a confirmed unbounded initial-load leak.

The input Bridge is a 292,227,269-byte Zstandard file. The earlier completed
save receipt is 519,048,665 bytes: the session unconditionally wrote an
uncompressed document. Bounded readback did not bound that resident WasmFS
output, nor the server's simultaneous chunk pool and whole-file concatenation.

The session now reads four magic bytes before opening/releasing the staged
document and explicitly preserves its compression choice on saves. New raw
documents stay raw; gzip/Zstandard inputs use Blender's current lossless
compressed writer. This depends on the document, never a machine preference,
and leaves relative_remap=false and copy=true intact. It changes no authored
arrays, packed images, dimensions, paths, undo or selection. This is a source
allocation correction; the final recording must establish its total effect.
