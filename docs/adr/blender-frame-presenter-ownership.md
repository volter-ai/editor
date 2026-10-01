# Blender frame presenter ownership across document switches

Status: Accepted
Date: 2026-09-30
Card: t_65c85042

Switching to another document while the Model document was still loading, then
returning, failed with "Blender frame manifest does not match its staged
revision" and left no viewport. The host resolved the active Model binding for
every staged piece and for the final manifest. Hiding the pane cleared that
binding, so later pieces and the manifest were acknowledged without reaching
the retained Model view, which still held partial geometry at the earlier
revision. The next presentation then met that stranded revision.

## Decision

The worker and the module-scoped Model view outlive pane activation. Binding
records that view for the worker's file, independently of focus. A streamed
frame captures its session, revision, document address and presenter once, at
its begin; every piece and its manifest go to that same owner, including while
the pane is inactive. A frame begun headless stays headless until its manifest.
A conflicting file cannot replace the remembered presenter, and worker
teardown releases it.

An abort names its session and revision and cannot dispose a newer pending
frame. Host and view both keep their manifest and piece revision checks; stale
sessions and resource conflicts remain refusals. No second view or retained
column copy is introduced. Returning to the pane uses the frame the retained
view completed instead of exporting it again.
