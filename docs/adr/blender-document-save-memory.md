# Blender document save memory

Status: Accepted
Date: 2026-10-01
Cards: t_65c85042, t_2def0a16

A Blender document save writes the whole `.blend` in the engine, hashes it into
content-defined chunks in the worker, uploads the chunks the server lacks, and
commits them to the project. On the Stoneguard Bridge, a 292,227,269-byte
Zstandard document, one save raised the hosted tab's renderer by 1.75 GB within
40 seconds (t_2def0a16, an edit at 12:50:07Z on 2026-10-01). An earlier save of
the same scene raised Blender's own heap from 3,112 to 3,869 MiB. Each decision
below removes a whole-document copy from that path. Which work saves at all is
[blender-view-state-writes.md](blender-view-state-writes.md).

## The engine writes the document in its own format, once

The session reads the opened document's magic bytes before it releases the
staged input, and saves with the same compression: a gzip or Zstandard
document is written by Blender's lossless compressed writer, a raw one stays
raw. The format is the document's, never a machine preference. An uncompressed
save of the Bridge was 519,048,665 bytes against its 292 MB source.

Before the first save, whose input has already been released, the session
writes a placeholder of the opened file's size. The browser filesystem's
`RawWriteWrap` removes it and reserves its output once from that size, so a
compressed save that crosses a power of two does not double a growing WasmFS
buffer. Later saves start from their prior file's size. Only that backend
reserves; the session reads its presence once (`_WRITE_RESERVATION`).

## The worker reads the saved file in ranges

The worker never holds the saved file whole. Hashing scans it one MiB at a time
and keeps at most one four-MiB chunk; each chunk the server lacks is read again
on its own for upload. Filesystem seams without range reads keep the
whole-file read. The gear table, chunk bounds, cut positions and SHA-256
manifest are unchanged.

## The server consumes verified chunks

Uploaded chunks are files, not buffers: one staging directory per document
under the project's `.volter/tmp/blender-document/`, in the project's own
store rather than a memory-backed `/tmp`. The first chunk a server takes for a
document clears whatever an earlier server left there, so a save abandoned by a
crash is reclaimed; a save another server had in flight then finds its chunks
missing and resends them through the bounded resend protocol.

The commit streams the chunks through the SDK's project-mutation door, each
re-read and re-verified as it is consumed, under the same path lock,
attribution and revision rules. The kit writes a hidden sibling, hashes the
bytes it writes, and renames it into place; a failed stream, short write or
changed chunk removes the sibling and leaves the old file. A large file's
fingerprint stays SHA-256 of its first 64 KiB plus its size, and tags the
expected watcher event without a re-read of the written file.

## Not bounded here

The hosted filesystem's descriptor read caches a whole reused file, and
independent filesystem observers can read the whole document. Both sit below
the editor, in the hosted runtime.
