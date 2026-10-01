# Blender file images: decoded pixels live until their upload

Status: Accepted
Date: 2026-10-01
Card: t_65c85042

A file image (a PNG or JPEG that is its file's own bytes) crosses to the tab
encoded and is decoded by the browser. The Stoneguard Bridge carries 84 such
images: 171 MiB encoded, 1,343 MiB as RGBA.

## Decision

Decodes run one image at a time, in one queue per page. Blob creation is inside
the queue, a disposed texture skips its queued decode or closes a decode
already running, and a failed image rejects its own readiness without stopping
the images after it. Decoder options (flip, alpha, colour), sizes, samplers and
the `texturesReady` barrier are unchanged.

Decoded pixels belong to the upload, not to the presented model. The stage
passes its renderer to `prepareDraw`; the image uploads through three's public
`initTexture` for every material sampler that shares its `Source` (and for its
own texture when an image empty draws it), then closes the bitmap. The texture
keeps its dimensions and the original encoded bytes, with `dataReady` false so
closed pixels never reach GL. A document with no viewport learns the image's
dimensions and closes the bitmap at once.

A new renderer, a restored context or a changed sampler decodes the image again
from its encoded bytes with the same options, uploads, and closes it again.
Raster and UDIM images and detached capture snapshots keep their own lifetimes.
No image is resized, recompressed, dropped or colour-converted.
