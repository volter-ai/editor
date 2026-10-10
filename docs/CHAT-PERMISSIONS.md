# Chat's visible permission selection

The native permission picker shows the selected permission name beside its
existing icon. Empty and populated conversations use that same renderer. Compact
layout retains the text, and the secondary toolbar measures the control's
rendered width instead of assigning it a 22-pixel icon floor. The Supercode menu
contribution places this existing action first: the pinned toolbar keeps its
first action visible when other actions move into overflow.

The extension's `kind: 'permissions'` group remains the source of its choices and
selection. The control still uses the native delegate, picker commands,
conversation state and accessibility label. There is no second permission
group. Harness permissions, approval behavior and defaults are unchanged.

## Source

Board task `t_f99d6e28` (c171) follows the first-time Windows Cyclotron 0.5.206
finding: after the first message, the selected permission became a tiny lock
icon. The earlier permission-group workaround was removed from Supercode PR
#1380 because it left unrelated native permission levels alongside a new group.
This repair belongs to the editor's native workbench overlay.

- Editor base: `56c56c89ac6870a1828cbe403bc07b338bf83e13`.
- Code-OSS pin: `4782d9a281ef4613e595b28fccd90a2e56890a6b`, as recorded in
  `packages/editor-core/workbench/FORK.json`.
- `scripts/workbench/overlay.mjs#patchNativePermissionPicker` updates
  `permissionPickerActionItem.ts` and `chatInputPart.ts` at that pin. It is called
  by the existing production native Chat overlay. The existing patch helper
  refuses moved source text and accepts an already applied replacement.
- `packages/editor-core/workbench/src/volterChat.ts` orders the existing native
  action before optional provider controls for Supercode conversations.

## Recorded qualification, 2026-10-10

Owned records are under `/Volumes/PeakSSD/volter-work/t08-r3-c171/`.

| Record | Reading |
| --- | --- |
| `01-native-source-overlay.cast` | Production permission overlay applied to the actual pinned Code-OSS sources downloaded through GitHub's blob API; exit 0. |
| `02-source-build.cast` | Overlay JavaScript syntax compilation and esbuild transpilation of both transformed native TypeScript modules and the editor contribution; exit 0. |

`native-source-provenance.json` records the original source bytes: permission
picker 20,657 bytes, SHA-256
`d6bc11fbe56bb05053c22afb8be068ef4273e1ee06d53fde652e77dcfbb07aca`;
Chat input 252,120 bytes, SHA-256
`35b9c85718a2a53ad89e4202fb5bbc7e1360d0b71689a7005b2f3412ef1591f1`.
These are genuine upstream source inputs to a build transform, not a fabricated
Chat session. Compilation here is transpilation, not a complete workbench
typecheck, packaged editor build or runtime proof.

No candidate operation was taken through a live Chat. The real product reading
still needs the selected label and choice in empty, populated and narrow Chat,
during a response, after switching permission, and after reload. The original
Windows screenshots have not been requalified on these bytes. No automated
tests, sign-in, install, publication or service change was performed.
