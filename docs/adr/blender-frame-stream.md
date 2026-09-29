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

## Avoid exporting the just-opened document twice

The hosted continuation build completed its initial load, but a later RPC still
reached 13.798 seconds. The operation label on the unchanged call meter identified
`present`: `openModelDocumentBlend` unconditionally called it after `start`, even
though Python's `bind_document` had already presented before `start` resolved.
This repeated evaluation/export also delayed the inspection reads queued behind it.

The open path now compares the published view's actual session/revision with the
runtime's latest frame. Matching holdings need no second present. A reopened pane,
a new file with no initial frame, a different session, or an outdated view still
requests its missing frame. Host tests cover those cases. The call meter also
carries an optional operation/load-boundary label so a later slow call identifies
which work owns it; timers and duration buckets are unchanged.

The hosted follow-up identified a 12.401 s rig read after removing the redundant
initial presentation. Rig reads and explicit presentations now use the same pull
protocol as startup. Rig extraction yields between objects and every 50 ms at a
1024-vertex boundary without changing influence selection or normalization.
Continuation tokens identify the job as well as its step. While Python is parked,
history and persistence cannot re-enter it. The page serializes whole logical
operations, drains accepted edits before the close barrier, and protects queued
work against unload. Wire-call timing remains measured from post to reply;
`@@VOLTER-WORK` records total logical duration including queue time separately.

A fresh-cache hosted run subsequently measured 13.451 s in `start`, before the
first engine-ready checkpoint. Runtime `.data`, Wasm and Essentials reads now
use the same one-MiB producer backpressure on both cache hits and misses.
Artifact status, package readiness, Wasm instantiation, runtime initialization,
Python readiness and Essentials file installation are separate work units.
The artifact cache retains exactly the same bytes and digests; a cold/warm
reader test verifies byte identity and producer checkpoints in both paths.

The 4b870d67 hosted review found an unfinished initial open despite short wire
calls. Continuation requests inherited a per-request page-work begin/end pair.
Each transition travels through the control channel and is synchronously appended
to the hosted session journal, so thousands of bounded units produced thousands
of extra control messages and filesystem writes. Work reporting now belongs to
one logical operation, while each wire request retains its actual start/end timer.
A 3001-request regression requires exactly one begin/end pair. The ordinary census
samples the current phase and completed-call count; it does not push per-unit
progress events. This removes a concrete control-channel amplification; fresh
hosted diagnosis must establish whether any separate completion problem remains.
