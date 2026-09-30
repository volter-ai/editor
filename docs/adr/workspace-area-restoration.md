# One native group per workspace area

Stoneguard t_65c85042 c20. A hosted status reading on editor 7796fe7e and
substrate ece187ad found one React root but seven native Timeline occurrences,
six visible. Five occupied 24-pixel strips and another occupied 658 pixels;
the model content had only 89 pixels of height.

The workbench document reconciler initially bound its main group to the active
group, which restoration could make the Timeline. It first adopted that group
as the restored area, then rejected it on the next pass because an area cannot
be the main group. It opened another split while retaining the old occurrence
as a wanted document. This path was already present in the initial public
source snapshot 7c61f0a8; Stoneguard's rendering commits did not introduce it.

Before placing areas, reconciliation now binds the main group to an existing
central document or a non-area group. If only areas remain, it creates the main
group on the opposite side of the area's declared placement. A restored area
is adopted from the declared neighbour. Each area keeps one native occurrence;
other restored occurrences are closed, and their groups removed only when
empty. Ordinary document splits and unrelated editors are preserved. A repair
reapplies the area's declared ratio after duplicate groups have gone; ordinary
subsequent reconciliations preserve the person's resize.

The separate inert-control cause was in Blender's scene transport: `playable`
required a bound action, and seeking returned before moving time without a
mixer. Blender's Timeline also advances in a static scene. The scene frame now
moves independently of an optional action pose; controls require an attached
scene transport, not an action. The existing settled bookmark writes Blender's
frame once after pause/scrub, and document teardown clears the old scene clock.

`status.nativeLayout` reports native view identities and surface bounds through
the product door. Independent review must verify one correctly placed Timeline,
repair on reopening an already-stacked project, and play/pause, step and scrub
alongside Blender's own layout. Source diagnosis and build success are not that
visual acceptance.


A later cold hosted open exposed a focus-order race: a restored model pane
mounted while the Timeline was still the host's active document. Its open
correctly declined, but the component kept “Opening model…” and never retried
when the model became active. `BlenderModelDocument` now subscribes to the
host's document activation until its open succeeds or fails. It starts only
for its own active document, does not duplicate an in-flight start, and removes
the subscription on unmount. Utility focus after success retains the model's
published context. Diagnostic: `c19-seams-status2.json` (no worker/renderer) and
`c19-seams-mount-diagnosis.json` (latched opening message).

A visible model may also start while a utility area owns keyboard focus.
`modelDocumentMayOpen` retains the binding and another-model ownership checks
without requiring Timeline focus to move first. The activation subscription
still retries when a genuinely different model relinquishes focus. The
87f77472 load succeeded with the model already active; that reading did not
exercise the Timeline-active restoration case and is not claimed as such.
