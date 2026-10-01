# Packed batch clones share immutable geometry arrays

Status: Accepted
Date: 2026-10-01
Card: t_65c85042, c7 t_83f9f624 / t_0152c963

The F2 diagnostic reproduced lost attachment after initial presentation. A
second run disabled batching through the document door: selected Wooden cart
Properties completed, but only after a 30,774 ms selection request, and reported
JS heap rose transiently to 3.7 GB. That does not attribute all memory growth to
batching. Native data, authored geometry and persistence must remain intact.

One allocation defect is established in the owned batch code: Three r180
BatchedMesh.copy clones its packed BufferGeometry arrays before our code
replaces every cloned array with the family's shared arrays. The cache admits
1,024 runs of families up to four MiB each, so constructing runs can allocate
up to four GiB of immediately discarded packed arrays despite a 32 MiB resident
family budget. Construction's four-runs-per-frame bound does not bound that
cumulative garbage or ensure prompt collection alongside a large selection
export and document save.

Only the owned immutable packed geometry uses a BufferGeometry subclass whose
copy creates independent metadata with shared index and attributes. Three's
BatchedMesh.copy still owns each run's matrix/command resources. The canonical
geometry, packed data, material order, run capacity and fallback behavior are
unchanged. Retiring a run still detaches shared attributes before disposal;
the family disposes its buffers after all its runs are retired.

Selection scripts use the existing bounded pull protocol, just like initial
load and explicit presentation, so native/export/transfer checkpoints return
through load-next rather than accumulating inside one long execute reply.
The script writes only selection flags whose native values differ, preserving
the view-layer scope and active-object semantics. No native math changes,
retired performance probes, full-scene benchmark cycle or 33 ms claim is added.

Evidence: stoneguard-diagnostics/f2-off-selected-reading.json and
f2-off-selected-later.json; source type checks f2-shared-batch-types.log and
f2-execute-types.log. These are cause readings, not independent arc acceptance.
The candidate's F2 stability remains to be observed through the board's review.
