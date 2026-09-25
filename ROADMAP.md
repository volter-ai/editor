# Volter Editor roadmap

Open work for the modeling product (`volter-ai/editor`): one `## <id>: <title>` section each, with its
`Status:` and the `Completion:` lines that define done. What shipped and the release's known limits are in
[`WORK.md`](WORK.md); the game editor's work stays in `volter-ai/vgai-engine` until game moves here.

## browser-parity: The fifteen references and the five new ones, scored through the browser

Status: active
The historical local-backend baseline is 15 of 15 models and 137 of 137 observed APIs. The browser replay
(vgai-engine `docs/WORK.md` §Blender in the tab is Blender, 2026-09-18) replayed every recorded call of the
ten-model battery and the five scene models through the editor, geometry bit-exact apart from named
mechanisms; that reading is not a score on the parity scoreboard, and it does not name the five hard
recordings of the original fifteen.
Completion:
- The original fifteen and the five new real-Blender references are scored through browser-only execution on the same scoreboard, with no local modeling fallback, measured through the tab's `blender-*` doors.

