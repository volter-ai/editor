# Bounded Blender frame delivery

Accepted for t_65c85042 c7. The engine already exports one changed mesh at a
time, but the worker retained every copied mesh until a single postMessage and
the view then built all geometry in one turn. Initial scenes paid that aggregate
memory and latency even though later frames used datablock revisions.

The worker now transfers one value at a time: frame metadata, one mesh or image,
and the final manifest. Metadata and typed-array bytes use at most 1 MiB per
message, with SHA-256 checked before acknowledgement. A sender awaits every
acknowledgement; corruption, truncation and an unexpected offset fail the frame.
Each value is limited to 2 GiB total and each column to 1 GiB. Those are refusal
bounds, not chunk sizes. No mutation is replayed after a transport failure.

The view prepares each mesh before acknowledging its completed transfer. The
worker retains its revision and column digests, not its geometry bytes. Source
positions retain Blender's float precision instead of being widened to doubles.
The final manifest validates references and commits the prepared resources;
partial geometry never replaces the displayed scene. On failure, termination,
new frame or view disposal, pending geometry is discarded. Existing revision
checks still refuse references to absent or different geometry and request a
full resynchronization. Unchanged meshes need no payload on subsequent frames.
Images retain their encoded representation where available; there is no quality
reduction, geometry simplification or UV-channel selection in this transport.

`packages/blender-engine/test/frame-stream.test.mjs` proves chunk bounds and
backpressure, corruption/order/truncation refusal, typed-column preservation,
and staged commit followed by geometry reuse. This protocol check is not a
hosted viewport or scene-load timing claim.
