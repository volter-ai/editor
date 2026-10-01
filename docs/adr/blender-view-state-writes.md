# View-state writes ride the next document save

Status: Accepted
Date: 2026-10-01
Card: t_2def0a16, c3 t_be09d187

Selecting an object in the Model document is a write to Blender: one script
sets the view layer's selection flags and active object
(`writeBlenderSelection`), so the frame that comes back carries Blender's own
selection. The script ran through `execute`, and every `execute` marked the
session's document changed. The present after it carried `saveDue`, and the
worker saved the whole `.blend` after the command: Blender wrote the file,
the worker chunked and hashed it, uploaded the chunks the server lacked, and
the server committed them. All of this ran on the command lane, which the
Properties reads for the new selection queue behind.

Measured on the Stoneguard Bridge before this change (stoneguard-diagnostics
`f2-footprint-*`): the selection's present left Blender's heap flat at
3,112 MiB. The save that followed wrote 519,048,665 bytes and sent
481,299,929 of them in about 62 s, and across it the hosted tab's renderer
went from 6.5 GB to 8.9 GB physical footprint (13.6 GB peak). At PR32
7b2c1f8f, whose saves preserve the source's 292 MB compressed form, the
renderer still gained 1.6 GB within a minute of the selection and was killed
at the 8 GB line before Properties completed. The by-category reading at that
head is on the card (c2 t_016af86f).

## Decision

An `execute` outside history does not queue a save. The editor's own gestures
that change Blender's view state rather than the model run with `history`
False: the selection and active object, the 3D cursor, and a locked camera's
pose during navigation (its final pose runs in history and saves). Blender
records none of them as an undo step of their own here, and none of them is
what a person means by an edit.

They are still Blender's state and the document still carries them. The next
save, after any edit, writes them with everything else. What is given up: a
session whose only changes since the last save are view state does not write
them when it closes, so the document reopens with the selection, cursor and
camera pose it last saved. Blender itself does not write a file because its
selection changed either; it writes it when the file is saved.

Every other `execute`, `rna-set`, `outliner-set` and history step still saves
before it is acknowledged. An agent's script through the MCP door always runs
in history and always saves.

## Not decided here

The save's own cost is unchanged. An edit of the Bridge still saves the whole
document through the same path, and the renderer growth measured across that
save applies to it.
