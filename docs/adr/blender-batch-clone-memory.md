# Packed batch clones share immutable geometry arrays

Status: Accepted
Date: 2026-10-01
Card: t_65c85042

Three r180's `BatchedMesh.copy` clones its packed `BufferGeometry` arrays before
our code replaces every cloned array with the family's shared arrays. The
ordered-batch cache admits 1,024 runs of families up to four MiB each, so
building runs could allocate up to four GiB of immediately discarded packed
arrays under a 32 MiB resident family budget.

## Decision

Only the owned immutable packed geometry uses a `BufferGeometry` subclass whose
`copy` creates independent metadata over the shared index and attributes.
`BatchedMesh.copy` still owns each run's matrix and command resources. The
canonical geometry, packed data, material order, run capacity and fallback are
unchanged. Retiring a run detaches the shared attributes before disposal; the
family disposes its buffers after all its runs are retired.

Run state is private to the run. Three r180's `Texture.clone` shares its
`Source`, and `BatchedMesh.copy` replaces `image.data` after cloning the matrix
and indirection textures, so a shared image shell let one run overwrite
another's inputs and share one upload. Only the owned template's
`DataTexture`s get a clone hook that gives each copy its own `Source` and image
shell. No Three prototype or ambient clone behaviour changes.
