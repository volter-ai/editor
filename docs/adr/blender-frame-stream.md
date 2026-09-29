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

## Native draw columns

The exporter supplies `cornerTri` in Blender's evaluated face order alongside
its evaluated corner normals. The view uses those columns directly and builds
an exact-size indexed draw buffer. Typed hash buckets compare all channel bits
before sharing a vertex; every UV map, material attribute, original vertex
mapping and loose vertex remains represented. Older engines without native
triangles retain the polygon fallback.

On Stoneguard's largest recorded native mesh (Woodland sapling000, 2,062,487
triangles), the same Node geometry-stage benchmark took 10,546.94 ms through
the polygon fallback and 778.12 ms through native columns. Both produced
1,777,278 draw vertices. Every expanded position, normal and UV was checked
against the native columns. End-of-stage RSS was 2,075,197,440 and 763,166,720
bytes respectively; these are snapshots, not peak or hosted load measurements.
The protocol test also covers native face ordering, material groups, seams,
multiple UV maps, a face attribute, loose vertices and invalid corner refusal.

The paired engine source and full-scene evidence are recorded in
[`provenance/stoneguard-memory.json`](../../provenance/stoneguard-memory.json).
The focused native bodice hashes are in
[`provenance/stoneguard-bodice.json`](../../provenance/stoneguard-bodice.json).
The full-scene record explicitly retains residual floating-point differences;
unchanged counts alone are not treated as native bit parity.

## Startup is a pull job

The first independent hosted review of this transport still recorded an
82.508-second startup RPC. Chunked messages alone did not bound that request.
Startup now returns a continuation at real work boundaries. The producer parks
until the owner sends the matching `load-next` request; a stale or duplicated
token cannot advance it. Import writes and frame transfers yield at one MiB
boundaries. The final startup promise still waits for the complete document and
presentation, and `@@VOLTER-LOAD totalMs` retains the aggregate duration.
Call metrics continue to measure actual request lifetimes without timer resets.

The native reader and exporter supply cooperative checkpoints on their calling
thread, including subdivision-table stages. Callbacks only carry transport;
they must never inspect or mutate partially read/evaluated Blender data. Other
commands are refused while this load owns the engine. Checkpointing preserves subdivision levels and arithmetic. Callbacks add
transport allocations, so native comparison is rerun for each binary. An older engine lacking these optional
doors keeps its synchronous native phases, reported at their actual durations.

Directory-channel polling backs off since its last progress, rather than the
start of a long job. Otherwise every later mesh in an initial scene pays the
slow 25 ms poll interval even while it is continuously producing data.
`pull-job.test.mjs` covers producer parking, stale/concurrent requests, error
propagation, bounded import backpressure and the actual worker startup lane.

The paired native implementation is `9fdd05db03b`. Its complete Bridge CPU
session probe took 27.213 seconds across 2,512 actual ask/checkpoint boundaries; the longest work gap
was 1.972 seconds while pulling BezierCurve.002. These timings exclude engine
boot, browser transport and GPU presentation; they do not establish hosted
acceptance. The raw Wasm hash and evidence scopes are in the provenance record.
The same engine rejects a failed file-read checkpoint without replacing the
previous document. A linked-object regression also exposed and fixed revision
increments after the first shared-mesh notice: a geometry revision now advances
once per frame, so the next unchanged frame reuses that mesh.
